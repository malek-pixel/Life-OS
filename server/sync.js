/**
 * Cross-device sync: `/api/sync`.
 *
 * The browser keeps its own complete copy of the data in IndexedDB and works
 * offline. This endpoint is the meeting point between devices: each device
 * pushes the rows it changed and pulls the rows other devices changed.
 *
 * Model
 *  - One record per row, keyed `store/id`, holding the whole row (or `null` for
 *    a hard delete) plus the time the device made the change.
 *  - Last writer wins per row, by that change time. Rows are small and belong to
 *    one person, so a row-level rule is predictable and good enough.
 *  - Every accepted write takes the next number from a server sequence. A device
 *    remembers the highest number it has seen and asks only for newer ones.
 *
 * Storage is Upstash Redis over its REST API (Vercel Storage → Upstash). Each
 * push and pull is ONE Lua script, so the compare-and-write is atomic even when
 * two devices sync at the same moment. An in-memory backend with identical
 * semantics backs the tests and `npm run serve` without Redis.
 */

import { isSameOrigin, json, readAuthConfig, sessionFromRequest } from './auth.js';

const PREFIX = 'lifeos:sync:v1:';
const KEYS = {
  rows: `${PREFIX}rows`,
  stamps: `${PREFIX}stamps`,
  log: `${PREFIX}log`,
  seq: `${PREFIX}seq`,
};

export const MAX_PUSH_CHANGES = 500;
export const MAX_PUSH_BYTES = 4_000_000;
export const PULL_LIMIT = 500;

const STORE_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

/* ------------------------------------------------------------------ *
 * Backends
 * ------------------------------------------------------------------ */

const PUSH_SCRIPT = `
local accepted = 0
for i = 1, #ARGV, 3 do
  local key, ts, payload = ARGV[i], tonumber(ARGV[i + 1]), ARGV[i + 2]
  local current = tonumber(redis.call('HGET', KEYS[2], key) or '-1')
  if ts >= current then
    local seq = redis.call('INCR', KEYS[4])
    redis.call('HSET', KEYS[1], key, payload)
    redis.call('HSET', KEYS[2], key, ARGV[i + 1])
    redis.call('ZADD', KEYS[3], seq, key)
    accepted = accepted + 1
  end
end
return { accepted, tonumber(redis.call('GET', KEYS[4]) or '0') }
`;

const PULL_SCRIPT = `
local head = tonumber(redis.call('GET', KEYS[3]) or '0')
local items = redis.call('ZRANGEBYSCORE', KEYS[2], '(' .. ARGV[1], '+inf', 'WITHSCORES', 'LIMIT', 0, tonumber(ARGV[2]))
local out = { head }
for i = 1, #items, 2 do
  table.insert(out, items[i + 1])
  table.insert(out, redis.call('HGET', KEYS[1], items[i]))
end
return out
`;

export function readSyncConfig(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: String(url).replace(/\/+$/, ''), token: String(token) };
}

/** Upstash Redis over REST. */
export function createRedisBackend(config, fetchImpl = fetch) {
  async function command(args) {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      throw new Error(`redis ${response.status}: ${body.error ?? 'request failed'}`);
    }
    return body.result;
  }

  return {
    async push(entries) {
      const argv = entries.flatMap((e) => [e.key, String(e.ts), e.payload]);
      const [accepted, cursor] = await command([
        'EVAL', PUSH_SCRIPT, '4', KEYS.rows, KEYS.stamps, KEYS.log, KEYS.seq, ...argv,
      ]);
      return { accepted: Number(accepted), cursor: Number(cursor) };
    },
    async pull(since, limit) {
      const out = await command(['EVAL', PULL_SCRIPT, '3', KEYS.rows, KEYS.log, KEYS.seq, String(since), String(limit)]);
      const head = Number(out[0]);
      const items = [];
      for (let i = 1; i < out.length; i += 2) items.push({ seq: Number(out[i]), payload: out[i + 1] });
      return { head, items };
    },
  };
}

/** Same semantics as the Redis scripts, held in memory. Tests and local serving. */
export function createMemoryBackend() {
  const rows = new Map();
  const stamps = new Map();
  const log = new Map();
  let seq = 0;
  return {
    async push(entries) {
      let accepted = 0;
      for (const e of entries) {
        if (e.ts >= (stamps.get(e.key) ?? -1)) {
          seq += 1;
          rows.set(e.key, e.payload);
          stamps.set(e.key, e.ts);
          log.set(e.key, seq);
          accepted += 1;
        }
      }
      return { accepted, cursor: seq };
    },
    async pull(since, limit) {
      const items = [...log.entries()]
        .filter(([, s]) => s > since)
        .sort((a, b) => a[1] - b[1])
        .slice(0, limit)
        .map(([key, s]) => ({ seq: s, payload: rows.get(key) }));
      return { head: seq, items };
    },
  };
}

let memoryFallback = null;

/** The backend for this environment, or null when sync is not configured. */
export function backendFromEnv(env) {
  const config = readSyncConfig(env);
  if (config) return createRedisBackend(config);
  if (env.LIFEOS_SYNC_MEMORY === '1') return (memoryFallback ??= createMemoryBackend());
  return null;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

/** Returns a clean change or null. The server never trusts the shape it is sent. */
export function cleanChange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { store, id, ts, value } = raw;
  if (typeof store !== 'string' || !STORE_RE.test(store)) return null;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) return null;
  if (value !== null) {
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.id !== id) return null;
  }
  return { store, id, ts: Math.floor(ts), value };
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

export async function sync(request, env, backend = backendFromEnv(env)) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' }, { allow: 'GET, POST' });
  }
  if (request.method === 'POST' && !isSameOrigin(request)) return json(403, { error: 'forbidden' });

  // Checked here as well as in middleware, like the AI proxy: the data endpoint
  // must stay closed even if the middleware matcher were ever wrong.
  const config = readAuthConfig(env);
  if (!config.ok || !(await sessionFromRequest(request, config))) {
    return json(401, { error: 'unauthenticated', message: 'Sign in to continue.' });
  }

  if (!backend) {
    return json(503, {
      error: 'sync_not_configured',
      message: 'Sync is not set up on the server. Add an Upstash Redis database to the Vercel project.',
    });
  }

  try {
    if (request.method === 'GET') return await pullHandler(request, backend);
    return await pushHandler(request, backend);
  } catch (err) {
    console.error('[sync] storage error:', err instanceof Error ? err.message : err);
    return json(502, { error: 'storage_unavailable', message: 'The sync database could not be reached.' });
  }
}

async function pullHandler(request, backend) {
  const raw = new URL(request.url).searchParams.get('since') ?? '0';
  const since = /^\d{1,15}$/.test(raw) ? Number(raw) : 0;
  const { head, items } = await backend.pull(since, PULL_LIMIT);

  const changes = [];
  for (const item of items) {
    try {
      const change = cleanChange(JSON.parse(item.payload));
      if (change) changes.push(change);
    } catch {
      /* skip a corrupt record rather than wedge every device on it */
    }
  }
  const more = items.length >= PULL_LIMIT;
  const cursor = more ? items[items.length - 1].seq : Math.max(head, since);
  return json(200, { cursor, more, changes }, { 'cache-control': 'no-store' });
}

async function pushHandler(request, backend) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return json(415, { error: 'unsupported_media_type' });
  }
  const text = await request.text();
  if (text.length > MAX_PUSH_BYTES) return json(413, { error: 'payload_too_large' });

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (!Array.isArray(body?.changes) || body.changes.length > MAX_PUSH_CHANGES) {
    return json(400, { error: 'bad_request', message: `Send between 0 and ${MAX_PUSH_CHANGES} changes.` });
  }

  const entries = [];
  for (const raw of body.changes) {
    const change = cleanChange(raw);
    if (!change) return json(400, { error: 'bad_request', message: 'A change was malformed.' });
    entries.push({ key: `${change.store}/${change.id}`, ts: change.ts, payload: JSON.stringify(change) });
  }
  if (entries.length === 0) return json(200, { accepted: 0 });

  const { accepted } = await backend.push(entries);
  return json(200, { accepted }, { 'cache-control': 'no-store' });
}
