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
  SYNC_META,
  SYNC_OUTBOX,
  transact,
  txClear,
  txDelete,
  txGet,
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

/** A row change waiting to be pushed to the sync server. One per row, newest wins. */
export interface OutboxEntry {
  key: string;
  store: StoreName;
  id: string;
  /** When this device made the change, unix ms. Decides conflicts. */
  ts: number;
  /** The whole row, or null for a hard delete. */
  value: unknown;
}

/** A row change received from the sync server. */
export interface RemoteChange {
  store: string;
  id: string;
  ts: number;
  value: unknown;
}

export interface SyncMeta {
  id: 'state';
  /** Highest server sequence number this device has applied. */
  cursor: number;
  /** True once this device's existing data has been queued for upload. */
  enabled: boolean;
}

const outboxKey = (store: string, id: string) => `${store}/${id}`;

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

  /**
   * Whether commits are recorded in the sync outbox. Off until this device first
   * joins sync, which queues everything that existed before (see enableSync).
   */
  private syncEnabled = false;
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
        await transact([...ALL_STORES, SYNC_META], 'readonly', async (tx) => {
          const meta = txGet<SyncMeta>(tx, SYNC_META, 'state');
          const pending = ALL_STORES.map((name) =>
            txGetAll<unknown>(tx, name).then((rows) => [name, rows] as const),
          );
          for (const [name, rows] of await Promise.all(pending)) {
            (next as Record<string, unknown[]>)[name] = rows;
          }
          this.syncEnabled = (await meta)?.enabled === true;
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
    const outbox = this.syncEnabled ? this.outboxFor(changes) : [];
    if (outbox.length > 0) stores.push(SYNC_OUTBOX);
    try {
      await transact(stores, 'readwrite', async (tx) => {
        // Issued synchronously, for the same auto-commit reason as hydrate().
        // Outbox entries share the transaction, so a change is never stored
        // without being queued for the other devices, or the reverse.
        await Promise.all([
          ...changes.map((change) =>
            change.op === 'put'
              ? txPut(tx, change.store, change.value)
              : txDelete(tx, change.store, change.id),
          ),
          ...outbox.map((entry) => txPut(tx, SYNC_OUTBOX, entry)),
        ]);
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

  /** Outbox entries for a changeset; a later change to the same row replaces an earlier one. */
  private outboxFor(changes: Change[]): OutboxEntry[] {
    const now = Date.now();
    const entries = new Map<string, OutboxEntry>();
    for (const change of changes) {
      const id = change.op === 'put' ? (change.value as { id: string }).id : change.id;
      const key = outboxKey(change.store, id);
      entries.set(key, {
        key,
        store: change.store,
        id,
        ts: now,
        value: change.op === 'put' ? change.value : null,
      });
    }
    return [...entries.values()];
  }

  /** Deletions for every held row not in `keep`, so a wipe reaches synced devices too. */
  private tombstonesFor(keep: Map<StoreName, unknown[]> = new Map()): Change[] {
    const out: Change[] = [];
    for (const name of ALL_STORES) {
      const kept = new Set(((keep.get(name) ?? []) as Array<{ id: string }>).map((r) => r.id));
      for (const row of (this.collections as Record<string, Array<{ id: string }>>)[name] ?? []) {
        if (!kept.has(row.id)) out.push({ op: 'delete', store: name, id: row.id });
      }
    }
    return out;
  }

  /**
   * Wipes every store and resets memory. Settings > Danger zone.
   *
   * With sync on, the deletions are queued too, so the data is erased on every
   * device rather than downloaded straight back.
   */
  async clearAll(): Promise<void> {
    const outbox = this.syncEnabled ? this.outboxFor(this.tombstonesFor()) : [];
    try {
      // Every clear is issued before the first await; see clearAllData in db.ts.
      await transact([...ALL_STORES, SYNC_OUTBOX], 'readwrite', async (tx) => {
        await Promise.all([
          ...ALL_STORES.map((name) => txClear(tx, name)),
          ...outbox.map((entry) => txPut(tx, SYNC_OUTBOX, entry)),
        ]);
      });
    } catch (err) {
      throw toAppError(err);
    }
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
    // With sync on, an import replaces the data on every device: rows it does
    // not contain are deleted everywhere, and every row it does is sent out.
    const outbox = this.syncEnabled
      ? this.outboxFor([
          ...this.tombstonesFor(incoming),
          ...[...incoming].flatMap(([name, rows]) =>
            rows.map((value): Change => ({ op: 'put', store: name, value })),
          ),
        ])
      : [];

    try {
      await transact([...ALL_STORES, SYNC_OUTBOX], 'readwrite', async (tx) => {
        const ops: Array<Promise<unknown>> = [];
        for (const name of ALL_STORES) ops.push(txClear(tx, name));
        for (const [name, rows] of incoming) {
          for (const row of rows) ops.push(txPut(tx, name, row));
        }
        for (const entry of outbox) ops.push(txPut(tx, SYNC_OUTBOX, entry));
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

  /* ---------------- sync ---------------- */
  //
  // Called only by src/data/sync.ts, inside the action write queue, so no local
  // action can commit between reading the outbox and acting on it.

  async readSyncMeta(): Promise<SyncMeta> {
    const meta = await transact(SYNC_META, 'readonly', (tx) => txGet<SyncMeta>(tx, SYNC_META, 'state'));
    return meta ?? { id: 'state', cursor: 0, enabled: false };
  }

  async readOutbox(): Promise<OutboxEntry[]> {
    return transact(SYNC_OUTBOX, 'readonly', (tx) => txGetAll<OutboxEntry>(tx, SYNC_OUTBOX));
  }

  get isSyncEnabled(): boolean {
    return this.syncEnabled;
  }

  /**
   * Applies rows from other devices and records how far this device has read.
   *
   * A row with a pending local change newer than the incoming one is skipped:
   * the local change wins and will be pushed. Otherwise the incoming row wins
   * and the older pending local change is dropped. Incoming rows are not queued
   * for upload, so changes never echo back and forth.
   *
   * Returns the names of the stores that changed.
   */
  async applyRemote(
    remote: RemoteChange[],
    cursor: number,
    knownStores: ReadonlySet<string>,
  ): Promise<Set<StoreName>> {
    const pending = new Map((await this.readOutbox()).map((e) => [e.key, e]));
    const changes: Change[] = [];
    const superseded: string[] = [];

    for (const r of remote) {
      if (!knownStores.has(r.store)) continue;
      const key = outboxKey(r.store, r.id);
      const local = pending.get(key);
      if (local && local.ts > r.ts) continue;
      if (local) superseded.push(key);
      const name = r.store as StoreName;
      if (r.value === null) {
        if (this.byId(name as keyof StoreTypes, r.id)) changes.push({ op: 'delete', store: name, id: r.id });
      } else {
        changes.push({ op: 'put', store: name, value: r.value });
      }
    }

    const stores = Array.from(new Set([...changes.map((c) => c.store), SYNC_META, SYNC_OUTBOX]));
    const meta: SyncMeta = { id: 'state', cursor, enabled: this.syncEnabled };
    try {
      await transact(stores, 'readwrite', async (tx) => {
        await Promise.all([
          ...changes.map((change) =>
            change.op === 'put'
              ? txPut(tx, change.store, change.value)
              : txDelete(tx, change.store, change.id),
          ),
          ...superseded.map((key) => txDelete(tx, SYNC_OUTBOX, key)),
          txPut(tx, SYNC_META, meta),
        ]);
      });
    } catch (err) {
      throw toAppError(err);
    }

    if (changes.length > 0) {
      this.apply(changes);
      await this.ensureSingletons();
      this.version++;
      this.notify();
    }
    return new Set(changes.map((c) => c.store));
  }

  /**
   * Joins sync: queues every row this device already had, except rows the server
   * already holds. On a device's first sync the server copy of a shared row
   * (settings, the character rollup) wins over the new device's own defaults.
   */
  async enableSync(serverKeys: ReadonlySet<string>): Promise<void> {
    type Row = { id: string; updatedAt?: number; createdAt?: number };
    const entries: OutboxEntry[] = [];
    for (const name of ALL_STORES) {
      for (const row of (this.collections as Record<string, Row[]>)[name] ?? []) {
        const key = outboxKey(name, row.id);
        if (serverKeys.has(key)) continue;
        const ts =
          typeof row.updatedAt === 'number' ? row.updatedAt : typeof row.createdAt === 'number' ? row.createdAt : 0;
        entries.push({ key, store: name, id: row.id, ts, value: row });
      }
    }
    const current = await this.readSyncMeta();
    try {
      await transact([SYNC_OUTBOX, SYNC_META], 'readwrite', async (tx) => {
        await Promise.all([
          ...entries.map((entry) => txPut(tx, SYNC_OUTBOX, entry)),
          txPut(tx, SYNC_META, { ...current, enabled: true }),
        ]);
      });
    } catch (err) {
      throw toAppError(err);
    }
    this.syncEnabled = true;
  }

  /** Drops pushed entries, unless the row changed again while the push was in flight. */
  async acknowledgePushed(sent: OutboxEntry[]): Promise<void> {
    const current = new Map((await this.readOutbox()).map((e) => [e.key, e]));
    const done = sent.filter((e) => current.get(e.key)?.ts === e.ts).map((e) => e.key);
    if (done.length === 0) return;
    await transact(SYNC_OUTBOX, 'readwrite', async (tx) => {
      await Promise.all(done.map((key) => txDelete(tx, SYNC_OUTBOX, key)));
    });
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
    this.syncEnabled = false;
    // Bumped, never reset. The version is a cache key - for React and for
    // memoized selectors - so reusing a number that once meant different data
    // would hand back a stale result.
    this.version++;
    this.hydrating = null;
  }
}

/** The app-wide store instance. */
export const store = new LifeOsStore();
