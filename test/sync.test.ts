/**
 * Cross-device sync: the /api/sync handler and the client engine together.
 *
 * The client runs against a real IndexedDB (fake-indexeddb) and talks to the
 * real handler through an in-memory backend with the same semantics as the
 * Redis scripts. "Another device" is simulated by writing to that backend
 * directly, exactly as its pushes would.
 */

import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSessionToken, hashPassword, readAuthConfig, SESSION_COOKIE } from '../server/auth.js';
import { createMemoryBackend, PULL_LIMIT, sync } from '../server/sync.js';
import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import { createTask, updateSettings } from '../src/data/actions';
import { syncNow, getSyncStatus } from '../src/data/sync';

const ORIGIN = 'https://lifeos.example.com';
let env: Record<string, string>;
let cookie: string;
type Backend = ReturnType<typeof createMemoryBackend>;
let backend: Backend;

beforeAll(async () => {
  env = {
    LIFEOS_PASSWORD_HASH: await hashPassword('sync test password', 100_000),
    LIFEOS_SESSION_SECRET: 'y'.repeat(64),
  };
  const config = readAuthConfig(env);
  if (!config.ok) throw new Error('fixture misconfigured');
  cookie = `${SESSION_COOKIE}=${await createSessionToken(config)}`;
});

async function freshDevice(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('life-os');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  resetDbHandle();
  store._resetForTests();
  await store.hydrate();
}

beforeEach(async () => {
  backend = createMemoryBackend();
  await freshDevice();
});

const call = (path: string, init: RequestInit = {}, opts: { signedIn?: boolean; origin?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (opts.signedIn !== false) headers.set('cookie', cookie);
  headers.set('origin', opts.origin ?? ORIGIN);
  return sync(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, backend);
};

/** The fetch the client engine uses, routed into the handler. */
const fetchShim = ((input: string, init?: RequestInit) => call(input, init)) as unknown as typeof fetch;
const runSync = () => syncNow({ fetch: fetchShim });

/** Writes a row as if another device had pushed it. */
const remoteWrite = (store: string, id: string, ts: number, value: unknown) =>
  backend.push([{ key: `${store}/${id}`, ts, payload: JSON.stringify({ store, id, ts, value }) }]);

async function serverRows(): Promise<Map<string, { store: string; ts: number; value: any }>> {
  const { items } = await backend.pull(0, 100_000);
  return new Map(
    items.map((i) => {
      const c = JSON.parse(i.payload);
      return [`${c.store}/${c.id}`, c];
    }),
  );
}

const post = (changes: unknown, opts: { signedIn?: boolean; origin?: string } = {}) =>
  call('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes }) }, opts);

/* ------------------------------------------------------------------ */

describe('sync endpoint', () => {
  it('refuses a request without a session', async () => {
    expect((await call('/api/sync?since=0', {}, { signedIn: false })).status).toBe(401);
    expect((await post([], { signedIn: false })).status).toBe(401);
  });

  it('refuses a cross-site push', async () => {
    expect((await post([], { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('says so when no database is configured', async () => {
    const res = await sync(new Request(`${ORIGIN}/api/sync`, { headers: { cookie } }), env, null);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('sync_not_configured');
  });

  it('rejects malformed changes', async () => {
    for (const bad of [
      { store: '../x', id: 'a', ts: 1, value: null },
      { store: 'tasks', id: '', ts: 1, value: null },
      { store: 'tasks', id: 'a', ts: -1, value: null },
      { store: 'tasks', id: 'a', ts: 1, value: [1] },
      { store: 'tasks', id: 'a', ts: 1, value: { id: 'different' } },
    ]) {
      expect((await post([bad])).status).toBe(400);
    }
  });

  it('keeps the newest write per row, whatever order they arrive in', async () => {
    await post([{ store: 'notes', id: 'n1', ts: 200, value: { id: 'n1', title: 'new' } }]);
    await post([{ store: 'notes', id: 'n1', ts: 100, value: { id: 'n1', title: 'old' } }]);
    const res = await call('/api/sync?since=0');
    const body = await res.json();
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0].value.title).toBe('new');
  });

  it('returns only changes after the cursor, in pages', async () => {
    const changes = Array.from({ length: PULL_LIMIT + 20 }, (_, i) => ({
      store: 'notes', id: `n${i}`, ts: 1, value: { id: `n${i}` },
    }));
    await post(changes.slice(0, 400));
    await post(changes.slice(400));

    const first = await (await call('/api/sync?since=0')).json();
    expect(first.more).toBe(true);
    expect(first.changes).toHaveLength(PULL_LIMIT);
    const second = await (await call(`/api/sync?since=${first.cursor}`)).json();
    expect(second.more).toBe(false);
    expect(second.changes).toHaveLength(20);
    const third = await (await call(`/api/sync?since=${second.cursor}`)).json();
    expect(third.changes).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe('sync engine', () => {
  it('uploads everything the first device already had', async () => {
    await createTask({ title: 'Written before sync existed' } as never);
    await runSync();

    expect(getSyncStatus().state).toBe('synced');
    expect(getSyncStatus().pending).toBe(0);
    const rows = await serverRows();
    const task = [...rows.values()].find((r) => r.value?.title === 'Written before sync existed');
    expect(task).toBeTruthy();
    expect(rows.has('settings/singleton')).toBe(true);
    expect(rows.has('characterState/singleton')).toBe(true);
  });

  it('a new device takes the server copy of shared rows and keeps its own rows', async () => {
    const now = Date.now();
    await remoteWrite('settings', 'singleton', now - 60_000, { ...store.settings, displayName: 'From laptop' });
    await remoteWrite('tasks', 'remote-task', now - 60_000, {
      ...(await taskShape('Made on the laptop')), id: 'remote-task',
    });
    // The phone's own defaults are newer than the laptop's settings, but must not win on join.
    await createTask({ title: 'Made on the phone first' } as never);

    await runSync();

    expect(store.settings.displayName).toBe('From laptop');
    const titles = store.live('tasks').map((t) => t.title).sort();
    expect(titles).toEqual(['Made on the laptop', 'Made on the phone first']);
    const rows = await serverRows();
    expect([...rows.values()].some((r) => r.value?.title === 'Made on the phone first')).toBe(true);
    expect(rows.get('settings/singleton')?.value.displayName).toBe('From laptop');
  });

  it('pushes later local changes and picks up later remote ones', async () => {
    await runSync();
    await updateSettings({ displayName: 'Edited here' });
    expect((await store.readOutbox()).length).toBe(1);
    await runSync();
    expect((await store.readOutbox()).length).toBe(0);
    expect((await serverRows()).get('settings/singleton')?.value.displayName).toBe('Edited here');

    await remoteWrite('settings', 'singleton', Date.now() + 1000, { ...store.settings, displayName: 'Edited there' });
    await runSync();
    expect(store.settings.displayName).toBe('Edited there');
    // Applying a remote row must not queue it to be sent straight back.
    expect((await store.readOutbox()).length).toBe(0);
  });

  it('a newer unsent local change beats an older remote one', async () => {
    await runSync();
    await remoteWrite('settings', 'singleton', Date.now() - 5_000, { ...store.settings, displayName: 'Older remote' });
    await updateSettings({ displayName: 'Newer local' });
    await runSync();
    expect(store.settings.displayName).toBe('Newer local');
    expect((await serverRows()).get('settings/singleton')?.value.displayName).toBe('Newer local');
  });

  it('applies deletions from another device', async () => {
    await createTask({ title: 'Doomed' } as never);
    await runSync();
    const id = store.live('tasks')[0]!.id;
    await remoteWrite('tasks', id, Date.now() + 1000, null);
    await runSync();
    expect(store.get('tasks').find((t) => t.id === id)).toBeUndefined();
  });

  it('recomputes XP totals when XP arrives from another device', async () => {
    await runSync();
    await remoteWrite('xpEvents', 'xp-remote', Date.now(), {
      id: 'xp-remote', amount: 120, sourceType: 'TASK', sourceId: 't', reason: 'remote', createdAt: Date.now(), dayKey: '2026-09-13',
    });
    await runSync();
    expect(store.character.totalXp).toBe(120);
  });

  it('ignores tables this version does not know', async () => {
    await runSync();
    await remoteWrite('futureTable', 'f1', Date.now(), { id: 'f1' });
    await runSync();
    expect(getSyncStatus().state).toBe('synced');
  });

  it('clearing all data clears it on the server too', async () => {
    await createTask({ title: 'Everywhere' } as never);
    await runSync();
    await store.clearAll();
    await runSync();
    const tasks = [...(await serverRows()).values()].filter((r) => r.store === 'tasks');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((r) => r.value === null)).toBe(true);
  });

  it('keeps local data and reports the problem when sync is not configured', async () => {
    await createTask({ title: 'Still here' } as never);
    await syncNow({
      fetch: ((input: string, init?: RequestInit) =>
        sync(new Request(`${ORIGIN}${input}`, { ...init, headers: { cookie, origin: ORIGIN } }), env, null)) as unknown as typeof fetch,
    });
    expect(getSyncStatus().state).toBe('not-configured');
    expect(store.live('tasks')).toHaveLength(1);
  });

  it('reports offline when the server cannot be reached', async () => {
    await syncNow({ fetch: (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch });
    expect(getSyncStatus().state).toBe('offline');
  });
});

/** A valid task row, borrowed from one the app creates, so the shape stays current. */
async function taskShape(title: string) {
  await createTask({ title: '__shape__' } as never);
  const row = store.live('tasks').find((t) => t.title === '__shape__')!;
  await store.commit([{ op: 'delete', store: 'tasks', id: row.id }]);
  return { ...row, title };
}
