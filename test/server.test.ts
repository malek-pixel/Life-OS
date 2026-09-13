/**
 * The server-side access layer: password hashing, session tokens, the request
 * gate and the API handlers.
 *
 * These are the tests that decide whether a stranger can reach the app, so most
 * of them are attacks: forged, tampered, expired and revoked sessions, cross-
 * site requests, path tricks, brute force, and a misconfigured deployment.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createSessionToken,
  hashPassword,
  readAuthConfig,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifyPassword,
  verifySessionToken,
} from '../server/auth.js';
import { decide, isPublicPath } from '../server/gate.js';
import { aiChat, login, logout, session } from '../server/handlers.js';

const PASSWORD = 'correct horse battery staple (test only)';
const ORIGIN = 'https://lifeos.example.com';
let env: Record<string, string>;
let config: { ok: true; passwordHash: string; secret: string };

beforeAll(async () => {
  // Low iteration count keeps the suite fast; production uses 600,000.
  env = {
    LIFEOS_PASSWORD_HASH: await hashPassword(PASSWORD, 100_000),
    LIFEOS_SESSION_SECRET: 'x'.repeat(64),
  };
  const read = readAuthConfig(env);
  if (!read.ok) throw new Error('fixture misconfigured');
  config = read;
});

const req = (path: string, init: RequestInit & { cookie?: string; html?: boolean } = {}) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.html) headers.set('accept', 'text/html');
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};

const validCookie = async () => `${SESSION_COOKIE}=${await createSessionToken(config)}`;

const postLogin = (password: unknown, extra: Record<string, string> = {}) =>
  login(
    req('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': extra.ip ?? '203.0.113.1', ...extra },
      body: JSON.stringify({ password }),
    }),
    env,
  );

/* ------------------------------------------------------------------ */

describe('password hashing', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    expect(await verifyPassword(PASSWORD, env.LIFEOS_PASSWORD_HASH!)).toBe(true);
    expect(await verifyPassword('wrong', env.LIFEOS_PASSWORD_HASH!)).toBe(false);
    expect(await verifyPassword('', env.LIFEOS_PASSWORD_HASH!)).toBe(false);
  });

  it('never stores the password, and salts every hash', async () => {
    const a = await hashPassword(PASSWORD, 100_000);
    const b = await hashPassword(PASSWORD, 100_000);
    expect(a).not.toContain(PASSWORD);
    expect(a).not.toBe(b);
    expect(a.startsWith('pbkdf2$sha256$100000$')).toBe(true);
  });

  it('uses at least the OWASP iteration count by default', async () => {
    const hash = await hashPassword('another test password');
    expect(Number(hash.split('$')[2])).toBeGreaterThanOrEqual(600_000);
  }, 20_000);
});

describe('configuration fails closed', () => {
  it('refuses to run with a missing or weak secret or hash', () => {
    expect(readAuthConfig({}).ok).toBe(false);
    expect(readAuthConfig({ LIFEOS_PASSWORD_HASH: env.LIFEOS_PASSWORD_HASH }).ok).toBe(false);
    expect(readAuthConfig({ ...env, LIFEOS_SESSION_SECRET: 'short' }).ok).toBe(false);
    expect(readAuthConfig({ ...env, LIFEOS_PASSWORD_HASH: 'plaintext-password' }).ok).toBe(false);
  });

  it('lets nobody in when unconfigured, even with a well-formed cookie', async () => {
    const decision = await decide(req('/', { html: true, cookie: await validCookie() }), {});
    expect(decision.action).toBe('respond');
    expect((await postLogin(PASSWORD).then((r) => r.status))).toBe(200); // sanity: configured env works
    const unconfigured = await login(
      req('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{"password":"x"}' }),
      {},
    );
    expect(unconfigured.status).toBe(503);
  });
});

describe('session tokens', () => {
  it('accepts a fresh token', async () => {
    const token = await createSessionToken(config);
    expect((await verifySessionToken(config, token)).valid).toBe(true);
  });

  it('rejects a tampered payload or signature', async () => {
    const token = await createSessionToken(config);
    const [body, sig] = token.split('.');
    const forgedBody = btoa(JSON.stringify({ sub: 'owner', iat: 0, exp: 9_999_999_999, cred: 'x' })).replace(/=+$/, '');
    expect((await verifySessionToken(config, `${forgedBody}.${sig}`)).valid).toBe(false);
    expect((await verifySessionToken(config, `${body}.${sig!.slice(0, -2)}AA`)).valid).toBe(false);
    expect((await verifySessionToken(config, `${body}`)).valid).toBe(false);
    expect((await verifySessionToken(config, 'garbage')).valid).toBe(false);
  });

  it('rejects a token signed with another secret', async () => {
    const other = { ...config, secret: 'y'.repeat(64) };
    expect((await verifySessionToken(config, await createSessionToken(other))).valid).toBe(false);
  });

  it('expires', async () => {
    const issued = Math.floor(Date.now() / 1000) - SESSION_TTL_SECONDS - 10;
    const token = await createSessionToken(config, issued);
    expect((await verifySessionToken(config, token)).valid).toBe(false);
  });

  it('is revoked when the password changes', async () => {
    const token = await createSessionToken(config);
    const newPassword = { ...config, passwordHash: await hashPassword('a new password entirely', 100_000) };
    expect((await verifySessionToken(newPassword, token)).valid).toBe(false);
  });
});

describe('the gate', () => {
  it('keeps the public surface to the sign-in page and its static files', () => {
    for (const p of ['/login', '/login.js', '/login.css', '/logo-mark.svg', '/manifest.webmanifest', '/apple-touch-icon.png', '/icons/icon-192.png', '/api/auth/login']) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ['/', '/index.html', '/assets/index-abc123.js', '/assets/index.css', '/api/ai/chat', '/api/auth/session', '/settings', '/anything']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it('redirects a signed-out page load to sign-in, whatever the path', async () => {
    for (const path of ['/', '/index.html', '/tasks', '/settings/data', '/goals/123']) {
      const d = await decide(req(path, { html: true }), env);
      expect(d.action).toBe('respond');
      if (d.action !== 'respond') continue;
      expect(d.response.status).toBe(302);
      expect(d.response.headers.get('location')).toBe(`${ORIGIN}/login`);
    }
  });

  it('never serves the application bundle to a signed-out visitor', async () => {
    const d = await decide(req('/assets/index-abc123.js'), env);
    expect(d.action).toBe('respond');
    if (d.action === 'respond') expect(d.response.status).toBe(401);
  });

  it('refuses private API routes with 401, not a redirect', async () => {
    for (const path of ['/api/ai/chat', '/api/auth/session', '/api/anything']) {
      const d = await decide(req(path, { method: 'POST' }), env);
      expect(d.action === 'respond' && d.response.status).toBe(401);
    }
  });

  it('allows everything with a valid session', async () => {
    const cookie = await validCookie();
    for (const path of ['/', '/assets/index-abc123.js', '/api/ai/chat']) {
      expect((await decide(req(path, { cookie }), env)).action).toBe('allow');
    }
  });

  it('treats a forged, expired or unrelated cookie as signed out', async () => {
    const expired = await createSessionToken(config, Math.floor(Date.now() / 1000) - SESSION_TTL_SECONDS - 5);
    for (const cookie of [`${SESSION_COOKIE}=forged.token`, `${SESSION_COOKIE}=${expired}`, 'other=value']) {
      expect((await decide(req('/', { html: true, cookie }), env)).action).toBe('respond');
    }
  });

  it('sends a signed-in visitor away from the sign-in page', async () => {
    const d = await decide(req('/login', { html: true, cookie: await validCookie() }), env);
    expect(d.action === 'respond' && d.response.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('rejects path traversal tricks', async () => {
    for (const path of ['/login/../index.html', '//assets/x.js', '/icons/..%2F..%2Findex.html'.replace('%2F', '/')]) {
      const d = await decide(req(path), env);
      expect(d.action).toBe('respond');
    }
  });
});

describe('sign in', () => {
  it('sets a hardened session cookie on the right password', async () => {
    const res = await postLogin(PASSWORD, { ip: '198.51.100.10' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain(PASSWORD);
  });

  it('gives one generic message for a wrong password, slowly', async () => {
    const started = Date.now();
    const res = await postLogin('nope', { ip: '198.51.100.11' });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await res.json()).message).toBe('That password is not correct.');
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  });

  it('rate limits repeated attempts from one address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await postLogin('wrong', { ip: '198.51.100.99' })).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // Even the correct password is refused while locked out.
    expect((await postLogin(PASSWORD, { ip: '198.51.100.99' })).status).toBe(429);
  }, 20_000);

  it('refuses cross-site sign-in requests', async () => {
    const res = await login(
      req('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'x-forwarded-for': '198.51.100.20' },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('rejects malformed and non-JSON bodies without crashing', async () => {
    const base = { method: 'POST', headers: { origin: ORIGIN, 'x-forwarded-for': '198.51.100.30' } };
    expect((await login(req('/api/auth/login', { ...base, headers: { ...base.headers, 'content-type': 'application/json' }, body: '{not json' }), env)).status).toBe(400);
    expect((await login(req('/api/auth/login', { ...base, headers: { ...base.headers, 'content-type': 'text/plain' }, body: 'password' }), env)).status).toBe(415);
    expect((await login(req('/api/auth/login', { method: 'GET' }), env)).status).toBe(405);
  });
});

describe('sign out and session', () => {
  it('clears the cookie, and works without a valid session', async () => {
    const res = await logout(req('/api/auth/logout', { method: 'POST', headers: { origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('reports the session, renewing one that is over a day old', async () => {
    expect((await session(req('/api/auth/session'), env)).status).toBe(401);

    const fresh = await session(req('/api/auth/session', { cookie: await validCookie() }), env);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get('set-cookie')).toBeNull();

    const old = `${SESSION_COOKIE}=${await createSessionToken(config, Math.floor(Date.now() / 1000) - 2 * 86400)}`;
    const renewed = await session(req('/api/auth/session', { cookie: old }), env);
    expect(renewed.status).toBe(200);
    expect(renewed.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=`);
  });
});

describe('AI proxy', () => {
  const chat = (cookie: string | undefined, body: unknown, extraEnv: Record<string, string> = {}) =>
    aiChat(
      req('/api/ai/chat', {
        method: 'POST',
        cookie,
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify(body),
      }),
      { ...env, ...extraEnv },
    );

  const valid = { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'hi' }] };

  it('refuses without a session, before touching the key', async () => {
    const res = await chat(undefined, valid, { GROQ_API_KEY: 'gsk_should_never_be_used' });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('gsk_');
  });

  it('says clearly when the server has no key', async () => {
    const res = await chat(await validCookie(), valid);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('ai_not_configured');
  });

  it('only forwards allow-listed models and real conversations', async () => {
    const cookie = await validCookie();
    expect((await chat(cookie, { ...valid, model: 'some-expensive-model' }, { GROQ_API_KEY: 'k' })).status).toBe(400);
    expect((await chat(cookie, { ...valid, messages: [] }, { GROQ_API_KEY: 'k' })).status).toBe(400);
  });

  it('refuses cross-site requests even with a session', async () => {
    const res = await aiChat(
      req('/api/ai/chat', {
        method: 'POST',
        cookie: await validCookie(),
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify(valid),
      }),
      { ...env, GROQ_API_KEY: 'k' },
    );
    expect(res.status).toBe(403);
  });
});
