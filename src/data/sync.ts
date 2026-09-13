/**
 * Cross-device sync engine.
 *
 * Every device keeps a full copy of the data in IndexedDB and stays fully usable
 * offline. When the server has sync configured (server/sync.js), each device:
 *
 *  1. pulls rows other devices changed since its cursor and applies them,
 *  2. on its first sync only, queues everything it already had for upload,
 *  3. pushes its outbox - the rows it changed - and clears what was accepted.
 *
 * Conflicts resolve per row, newest change wins. Local commits are recorded in
 * the outbox inside the same transaction as the change itself (store.persist),
 * so nothing is lost if the app is closed before a push.
 *
 * It runs on start, when the app comes back to the foreground, when the device
 * comes back online, shortly after any local change, and every 30 seconds while
 * visible.
 */

import { useSyncExternalStore } from 'react';

import { rebuildCharacterState, runExclusive } from './actions';
import { STORES } from './schema';
import { store, type OutboxEntry, type RemoteChange } from './store';

export const SYNC_AVAILABLE: boolean = import.meta.env.PROD;

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'not-configured' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: number | null;
  pending: number;
  message: string | null;
}

const POLL_MS = 30_000;
const PUSH_DEBOUNCE_MS = 1_500;
const MAX_BATCH = 400;
const MAX_BATCH_BYTES = 1_500_000;
const KNOWN_STORES: ReadonlySet<string> = new Set(Object.values(STORES));

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

let status: SyncStatus = {
  state: SYNC_AVAILABLE ? 'syncing' : 'off',
  lastSyncedAt: null,
  pending: 0,
  message: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSyncStatus,
    getSyncStatus,
  );
}

/* ------------------------------------------------------------------ *
 * One sync pass
 * ------------------------------------------------------------------ */

export interface SyncOptions {
  fetch?: typeof fetch;
  onUnauthenticated?: () => void;
}

class StopSync extends Error {
  constructor(readonly state: SyncState, message: string | null = null) {
    super(message ?? state);
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Runs a sync pass; if one is already running, runs another straight after it. */
export function syncNow(options: SyncOptions = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce(options);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce(options: SyncOptions): Promise<void> {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  if (store.status !== 'ready') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline', message: null });
    return;
  }

  setStatus({ state: 'syncing' });
  try {
    const request = async (input: string, init?: RequestInit) => {
      let response: Response;
      try {
        response = await doFetch(input, { credentials: 'same-origin', cache: 'no-store', ...init });
      } catch {
        throw new StopSync('offline');
      }
      if (response.status === 401) {
        options.onUnauthenticated?.();
        throw new StopSync('error', 'Signed out.');
      }
      if (response.status === 503) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        if (body.error === 'sync_not_configured') throw new StopSync('not-configured', body.message ?? null);
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new StopSync('error', body.message ?? `The sync server answered ${response.status}.`);
      }
      return response.json();
    };

    // 1. Pull. A device that has not joined yet reads everything from the start.
    const meta = await store.readSyncMeta();
    const joining = !meta.enabled;
    let cursor = joining ? 0 : meta.cursor;
    const serverKeys = new Set<string>();
    let touchedXp = false;

    for (;;) {
      const page = (await request(`/api/sync?since=${cursor}`)) as {
        cursor: number;
        more: boolean;
        changes: RemoteChange[];
      };
      for (const change of page.changes) serverKeys.add(`${change.store}/${change.id}`);
      const touched = await runExclusive(() => store.applyRemote(page.changes, page.cursor, KNOWN_STORES));
      if (touched.has(STORES.xpEvents)) touchedXp = true;
      cursor = page.cursor;
      if (!page.more) break;
    }

    // XP events from another device change the totals; the cached rollup is
    // recomputed from the ledger rather than trusted from either device.
    if (touchedXp) await rebuildCharacterState();

    // 2. Join.
    if (joining) await runExclusive(() => store.enableSync(serverKeys));

    // 3. Push.
    const outbox = await store.readOutbox();
    for (const batch of batches(outbox)) {
      await request('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: batch.map((e) => ({ store: e.store, id: e.id, ts: e.ts, value: e.value })),
        }),
      });
      await runExclusive(() => store.acknowledgePushed(batch));
    }

    const remaining = (await store.readOutbox()).length;
    setStatus({ state: 'synced', lastSyncedAt: Date.now(), pending: remaining, message: null });
  } catch (err) {
    const pending = await store.readOutbox().then((o) => o.length).catch(() => status.pending);
    if (err instanceof StopSync) {
      setStatus({ state: err.state, message: err.state === 'error' ? err.message : null, pending });
    } else {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Sync failed.', pending });
    }
  }
}

function batches(entries: OutboxEntry[]): OutboxEntry[][] {
  const out: OutboxEntry[][] = [];
  let current: OutboxEntry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = JSON.stringify(entry.value).length + 200;
    if (current.length > 0 && (current.length >= MAX_BATCH || bytes + size > MAX_BATCH_BYTES)) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(entry);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/* ------------------------------------------------------------------ *
 * Scheduling
 * ------------------------------------------------------------------ */

/** Starts background sync. Returns a function that stops it. */
export function startSync(options: SyncOptions = {}): () => void {
  if (!SYNC_AVAILABLE) return () => undefined;

  let pushTimer: number | undefined;
  let lastVersion = store.getVersion();
  const run = () => {
    if (status.state === 'not-configured') return;
    void syncNow(options);
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  // Any commit - local or applied from the server - bumps the version. A pass
  // with an empty outbox is one cheap request, so no need to tell them apart.
  const unsubscribe = store.subscribe(() => {
    const version = store.getVersion();
    if (version === lastVersion) return;
    lastVersion = version;
    clearTimeout(pushTimer);
    pushTimer = window.setTimeout(run, PUSH_DEBOUNCE_MS);
  });

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', run);
  const poll = window.setInterval(() => {
    if (document.visibilityState === 'visible') run();
  }, POLL_MS);
  run();

  return () => {
    unsubscribe();
    clearTimeout(pushTimer);
    clearInterval(poll);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', run);
  };
}
