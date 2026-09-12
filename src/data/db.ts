/**
 * IndexedDB access layer.
 *
 * Life OS has no server, so this is the authoritative datastore - the browser
 * equivalent of the local SQLite file the Technical Specification describes.
 * Everything the app knows lives here.
 *
 * Two rules carried over from TECH_SPEC sections 9 and 19:
 *
 *  1. Schema changes go through a numbered migration in `MIGRATIONS`. There is
 *     exactly one copy of the user's data; a bad migration is a data-loss event,
 *     not a rollback-and-retry.
 *  2. Related writes that must succeed together share one transaction. See
 *     `transact()` - completing a task and writing its XP event is one atomic
 *     unit, never two independent writes that can half-fail.
 */

import { INDEXES, STORES, type StoreName } from './schema';
import { DbError } from './errors';

export const DB_NAME = 'life-os';

/**
 * Schema version. Bump this and append to MIGRATIONS - never edit an existing
 * migration, because it has already run on the real database.
 */
export const DB_VERSION = 1;

type MigrationFn = (db: IDBDatabase, tx: IDBTransaction) => void;

/**
 * Migrations run in order for every version above the user's current one.
 * Index 0 is version 1.
 */
const MIGRATIONS: MigrationFn[] = [
  // v1 - initial schema.
  (db) => {
    for (const name of Object.values(STORES)) {
      if (db.objectStoreNames.contains(name)) continue;
      const store = db.createObjectStore(name, { keyPath: 'id' });
      for (const idx of INDEXES[name as StoreName] ?? []) {
        store.createIndex(idx.name, idx.keyPath, { unique: false });
      }
    }
  },
];

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens (and if needed migrates) the database. Safe to call concurrently. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new DbError(
          'STORAGE_UNAVAILABLE',
          'This browser has no IndexedDB support, so Life OS cannot store your data.',
        ),
      );
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (cause) {
      reject(new DbError('STORAGE_UNAVAILABLE', 'Could not open local storage.', cause));
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!tx) return;
      const from = event.oldVersion;
      for (let v = from; v < DB_VERSION; v++) {
        const migrate = MIGRATIONS[v];
        if (migrate) migrate(db, tx);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab opens a newer version, close this handle rather than
      // blocking that upgrade forever.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () =>
      reject(new DbError('DB_ERROR', 'Could not open the Life OS database.', request.error));

    request.onblocked = () =>
      reject(
        new DbError(
          'DB_BLOCKED',
          'Another Life OS tab is open with an older version. Close it and reload.',
        ),
      );
  });

  return dbPromise;
}

/** Test seam: drops the cached handle so a fresh open happens next call. */
export function resetDbHandle(): void {
  dbPromise = null;
}

type TxMode = 'readonly' | 'readwrite';

/**
 * Runs `fn` inside a single IndexedDB transaction over `stores`.
 *
 * This is the only way writes happen. Multi-entity operations - completing a
 * task, awarding its XP, and updating the cached character rollup - pass all
 * three stores here so they commit together or not at all.
 *
 * `fn` must not await anything outside the transaction: IndexedDB auto-commits
 * when the microtask queue drains, so an external await silently ends the
 * transaction. Use only the request helpers below inside it.
 */
export async function transact<T>(
  stores: StoreName[] | StoreName,
  mode: TxMode,
  fn: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  const names = Array.isArray(stores) ? stores : [stores];

  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(names, mode);
    } catch (cause) {
      reject(new DbError('DB_ERROR', 'Could not start a database transaction.', cause));
      return;
    }

    let result: T;
    let settled = false;

    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new DbError('DB_ERROR', 'A database write failed and was rolled back.', tx.error));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(
          new DbError('DB_ERROR', 'A database write was aborted and rolled back.', tx.error),
        );
      }
    };

    Promise.resolve()
      .then(() => fn(tx))
      .then((value) => {
        result = value;
      })
      .catch((err) => {
        settled = true;
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(err);
      });
  });
}

/* ------------------------------------------------------------------ *
 * Request helpers - promise wrappers around IDBRequest
 * ------------------------------------------------------------------ */

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new DbError('DB_ERROR', 'A database request failed.', request.error));
  });
}

export function txGet<T>(tx: IDBTransaction, store: StoreName, id: string): Promise<T | undefined> {
  return wrap<T | undefined>(tx.objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export function txGetAll<T>(tx: IDBTransaction, store: StoreName): Promise<T[]> {
  return wrap<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export function txGetAllByIndex<T>(
  tx: IDBTransaction,
  store: StoreName,
  index: string,
  key: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  return wrap<T[]>(tx.objectStore(store).index(index).getAll(key) as IDBRequest<T[]>);
}

export function txPut<T>(tx: IDBTransaction, store: StoreName, value: T): Promise<IDBValidKey> {
  return wrap(tx.objectStore(store).put(value as unknown as never));
}

export function txDelete(tx: IDBTransaction, store: StoreName, id: string): Promise<undefined> {
  return wrap(tx.objectStore(store).delete(id));
}

export function txClear(tx: IDBTransaction, store: StoreName): Promise<undefined> {
  return wrap(tx.objectStore(store).clear());
}

/* ------------------------------------------------------------------ *
 * Convenience one-shot reads
 * ------------------------------------------------------------------ */

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return transact(store, 'readonly', (tx) => txGetAll<T>(tx, store));
}

export async function getOne<T>(store: StoreName, id: string): Promise<T | undefined> {
  return transact(store, 'readonly', (tx) => txGet<T>(tx, store, id));
}

/** Wipes every store. Used by Settings > Danger zone, behind a confirmation. */
export async function clearAllData(): Promise<void> {
  const names = Object.values(STORES) as StoreName[];
  await transact(names, 'readwrite', async (tx) => {
    for (const name of names) await txClear(tx, name);
  });
}
