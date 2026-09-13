/**
 * The reactive store.
 *
 * Drift gives the Flutter build reactive streams: widgets rebuild automatically
 * when the underlying rows change, with no manual cache invalidation
 * (TECH_SPEC section 11). This is the web equivalent.
 *
 * Shape:
 *   - On boot, every row is read once into memory. A single user's data is
 *     small - thousands of rows, not millions - so holding it all is cheaper
 *     and far simpler than round-tripping IndexedDB for every render, and it
 *     lets derived selectors (XP, streaks, progress) stay synchronous.
 *   - Writes go through `commit()`, which persists to IndexedDB inside ONE
 *     transaction and only then updates memory. If the transaction fails,
 *     memory is untouched, so the UI can never show a change that was not
 *     durably stored.
 *   - Subscribers are notified once per commit, and only the collections that
 *     actually changed get a new array identity, so React components that read
 *     one collection do not re-render when an unrelated one changes.
 */

import {
  clearAllData,
  transact,
  txClear,
  txDelete,
  txGetAll,
  txPut,
} from './db';
import { toAppError } from './errors';
import {
  DEFAULT_SETTINGS,
  STORES,
  type CharacterState,
  type Settings,
  type StoreName,
  type StoreTypes,
} from './schema';

/** Collections held in memory, keyed by store name. */
export type Collections = {
  [K in keyof StoreTypes]: StoreTypes[K][];
};

/** A single pending write. Collected into a changeset and committed together. */
export type Change =
  | { op: 'put'; store: StoreName; value: unknown }
  | { op: 'delete'; store: StoreName; id: string };

type Listener = () => void;

const ALL_STORES = Object.values(STORES) as StoreName[];

function emptyCollections(): Collections {
  const out = {} as Collections;
  for (const name of ALL_STORES) {
    (out as Record<string, unknown[]>)[name] = [];
  }
  return out;
}

export type StoreStatus = 'idle' | 'loading' | 'ready' | 'error';

export class LifeOsStore {
  private collections: Collections = emptyCollections();
  private listeners = new Set<Listener>();
  private version = 0;

  status: StoreStatus = 'idle';
  error: Error | null = null;

  /** Bumped on every commit; the value React subscribes to. */
  getVersion = (): number => this.version;

  /* ---------------- lifecycle ---------------- */

  private hydrating: Promise<void> | null = null;

  /**
   * Loads every store into memory. Idempotent and safe to call concurrently -
   * the second caller awaits the first load rather than starting another.
   */
  async hydrate(): Promise<void> {
    if (this.status === 'ready') return;
    if (this.hydrating) return this.hydrating;

    this.status = 'loading';
    this.error = null;
    this.notify();

    this.hydrating = (async () => {
      try {
        const next = emptyCollections();
        // One read transaction across every store: a consistent snapshot, and
        // far fewer round trips than opening one transaction per collection.
        //
        // Every request is issued SYNCHRONOUSLY before the first await. An
        // IndexedDB transaction auto-commits as soon as its request queue
        // drains, so awaiting each read in turn lets the transaction close
        // underneath the loop and the remaining reads never resolve - which
        // presents as the app hanging on the boot skeleton.
        await transact(ALL_STORES, 'readonly', async (tx) => {
          const pending = ALL_STORES.map((name) =>
            txGetAll<unknown>(tx, name).then((rows) => [name, rows] as const),
          );
          for (const [name, rows] of await Promise.all(pending)) {
            (next as Record<string, unknown[]>)[name] = rows;
          }
        });
        this.collections = next;
        await this.ensureSingletons();
        this.status = 'ready';
      } catch (err) {
        this.error = toAppError(err);
        this.status = 'error';
      } finally {
        this.hydrating = null;
        this.version++;
        this.notify();
      }
    })();

    return this.hydrating;
  }

  /**
   * Guarantees the settings and character rows exist, so every read site can
   * treat them as present rather than defending against undefined.
   */
  private async ensureSingletons(): Promise<void> {
    const now = Date.now();
    const changes: Change[] = [];

    if (this.collections.settings.length === 0) {
      const settings: Settings = { ...DEFAULT_SETTINGS, createdAt: now, updatedAt: now };
      this.collections.settings = [settings];
      changes.push({ op: 'put', store: STORES.settings, value: settings });
    }
    if (this.collections.characterState.length === 0) {
      const character: CharacterState = {
        id: 'singleton',
        totalXp: 0,
        level: 1,
        rank: 'Failure',
        areaXp: {},
        updatedAt: now,
      };
      this.collections.characterState = [character];
      changes.push({ op: 'put', store: STORES.characterState, value: character });
    }

    if (changes.length > 0) await this.persist(changes);
  }

  /* ---------------- reads ---------------- */

  /** Live array for a collection. Treat as immutable; never mutate in place. */
  get<K extends keyof StoreTypes>(name: K): StoreTypes[K][] {
    return this.collections[name];
  }

  /** All non-deleted rows of a collection. */
  live<K extends keyof StoreTypes>(name: K): StoreTypes[K][] {
    const rows = this.collections[name] as Array<{ deletedAt?: number | null }>;
    return rows.filter((r) => r.deletedAt == null) as StoreTypes[K][];
  }

  byId<K extends keyof StoreTypes>(name: K, id: string): StoreTypes[K] | undefined {
    const rows = this.collections[name] as Array<{ id: string }>;
    return rows.find((r) => r.id === id) as StoreTypes[K] | undefined;
  }

  get settings(): Settings {
    return (
      this.collections.settings[0] ?? {
        ...DEFAULT_SETTINGS,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    );
  }

  get character(): CharacterState {
    return (
      this.collections.characterState[0] ?? {
        id: 'singleton',
        totalXp: 0,
        level: 1,
        rank: 'Failure',
        areaXp: {},
        updatedAt: Date.now(),
      }
    );
  }

  /* ---------------- writes ---------------- */

  /**
   * Persists a changeset and applies it to memory.
   *
   * All changes share one IndexedDB transaction, so a multi-entity operation -
   * completing a task, writing its XP event, updating the cached character
   * rollup - either lands completely or not at all. This is the guarantee that
   * keeps the derived numbers honest.
   *
   * Throws an AppError on failure, with memory unchanged.
   */
  async commit(changes: Change[]): Promise<void> {
    if (changes.length === 0) return;
    await this.persist(changes);
    this.apply(changes);
    this.version++;
    this.notify();
  }

  /** Writes a changeset to IndexedDB inside a single transaction. */
  private async persist(changes: Change[]): Promise<void> {
    const stores = Array.from(new Set(changes.map((c) => c.store)));
    try {
      await transact(stores, 'readwrite', async (tx) => {
        // Issued synchronously, for the same auto-commit reason as hydrate().
        await Promise.all(
          changes.map((change) =>
            change.op === 'put'
              ? txPut(tx, change.store, change.value)
              : txDelete(tx, change.store, change.id),
          ),
        );
      });
    } catch (err) {
      throw toAppError(err);
    }
  }

  /**
   * Mirrors a committed changeset into memory.
   *
   * Only touched collections get a new array identity; the rest keep theirs, so
   * a component reading `notes` does not re-render because a task changed.
   */
  private apply(changes: Change[]): void {
    const touched = new Set<StoreName>();
    const working = new Map<StoreName, unknown[]>();

    const listFor = (name: StoreName): unknown[] => {
      let list = working.get(name);
      if (!list) {
        list = [...((this.collections as Record<string, unknown[]>)[name] ?? [])];
        working.set(name, list);
      }
      return list;
    };

    for (const change of changes) {
      const list = listFor(change.store);
      touched.add(change.store);

      if (change.op === 'delete') {
        const i = list.findIndex((r) => (r as { id: string }).id === change.id);
        if (i >= 0) list.splice(i, 1);
        continue;
      }

      const value = change.value as { id: string };
      const i = list.findIndex((r) => (r as { id: string }).id === value.id);
      if (i >= 0) list[i] = value;
      else list.push(value);
    }

    for (const name of touched) {
      (this.collections as Record<string, unknown[]>)[name] = working.get(name)!;
    }
    // Swap the container too, so a consumer comparing the whole object sees a change.
    this.collections = { ...this.collections };
  }

  /** Wipes every store and resets memory. Settings > Danger zone. */
  async clearAll(): Promise<void> {
    await clearAllData();
    this.collections = emptyCollections();
    await this.ensureSingletons();
    this.version++;
    this.notify();
  }

  /**
   * Replaces the entire database contents, for import.
   *
   * Done as one transaction per store batch so a failed import leaves the
   * previous data intact rather than half-replaced.
   */
  async replaceAll(data: Partial<Record<StoreName, unknown[]>>): Promise<void> {
    const incoming = new Map<StoreName, unknown[]>();
    for (const [name, rows] of Object.entries(data) as Array<[StoreName, unknown[]]>) {
      if (!ALL_STORES.includes(name)) continue;
      incoming.set(name, rows);
    }

    // Clearing and rewriting share ONE transaction. Doing it as two - clear,
    // then write - leaves a window where a failure between them destroys the
    // existing data and restores nothing. Here the import either fully replaces
    // the database or leaves it exactly as it was.
    try {
      await transact(ALL_STORES, 'readwrite', async (tx) => {
        const ops: Array<Promise<unknown>> = [];
        for (const name of ALL_STORES) ops.push(txClear(tx, name));
        for (const [name, rows] of incoming) {
          for (const row of rows) ops.push(txPut(tx, name, row));
        }
        await Promise.all(ops);
      });
    } catch (err) {
      // Nothing was committed, so memory still matches storage.
      throw toAppError(err);
    }

    this.collections = emptyCollections();
    for (const [name, rows] of incoming) {
      (this.collections as Record<string, unknown[]>)[name] = [...rows];
    }
    this.collections = { ...this.collections };
    await this.ensureSingletons();
    this.version++;
    this.notify();
  }

  /* ---------------- subscription ---------------- */

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Test seam: drops in-memory state without touching storage. */
  _resetForTests(): void {
    this.collections = emptyCollections();
    this.status = 'idle';
    this.error = null;
    // Bumped, never reset. The version is a cache key - for React and for
    // memoized selectors - so reusing a number that once meant different data
    // would hand back a stale result.
    this.version++;
    this.hydrating = null;
  }
}

/** The app-wide store instance. */
export const store = new LifeOsStore();
