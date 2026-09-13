/**
 * Server-side authentication for a single-owner deployment.
 *
 * Runs only on the server: Vercel Routing Middleware, Vercel Functions, and the
 * local production server in scripts/serve.js. Nothing here is imported by the
 * browser bundle, and no secret it reads ever reaches the client.
 *
 * Model
 *  - One owner. There is no user table, no registration path and no default
 *    account: the only credential is a password hash supplied through the
 *    environment by whoever deploys the app.
 *  - The password is never stored. LIFEOS_PASSWORD_HASH holds a PBKDF2-SHA256
 *    hash (600,000 iterations, per current OWASP guidance) with a random salt,
 *    generated locally by `npm run auth:setup`.
 *  - A successful login issues a session token signed with HMAC-SHA256 using
 *    LIFEOS_SESSION_SECRET, delivered as an HttpOnly, Secure, SameSite=Strict
 *    cookie. Page script cannot read it, other sites cannot send it, and it
 *    cannot be forged without the secret.
 *  - The token embeds a fingerprint of the password hash, so changing the
 *    password signs every existing session out. Rotating the session secret
 *    does the same.
 *  - Misconfiguration fails closed: with no hash or no secret, nobody can sign
 *    in and every protected request is refused.
 *
 * Only Web Crypto is used, so the same code runs in Edge middleware, Node
 * functions and the test suite without a polyfill.
 */

const enc = new TextEncoder();

export const SESSION_COOKIE = 'lifeos_session';
/** Thirty days; renewed on use, so an app opened regularly stays signed in. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Sessions older than this are re-issued with a fresh expiry when checked. */
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24;

export const PBKDF2_ITERATIONS = 600_000;
const MIN_SECRET_LENGTH = 32;

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

function toBase64Url(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const normal = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Comparison whose duration does not depend on where the inputs differ. */
export function timingSafeEqual(a, b) {
  const x = a instanceof Uint8Array ? a : enc.encode(String(a));
  const y = b instanceof Uint8Array ? b : enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

/**
 * Reads auth configuration, failing closed.
 * @returns {{ ok: true, passwordHash: string, secret: string } | { ok: false, reason: string }}
 */
export function readAuthConfig(env) {
  const passwordHash = env.LIFEOS_PASSWORD_HASH;
  const secret = env.LIFEOS_SESSION_SECRET;
  if (!passwordHash || !parseHash(passwordHash)) {
    return { ok: false, reason: 'LIFEOS_PASSWORD_HASH is missing or malformed.' };
  }
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return { ok: false, reason: `LIFEOS_SESSION_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters.` };
  }
  return { ok: true, passwordHash, secret };
}

/* ------------------------------------------------------------------ *
 * Password hashing
 * ------------------------------------------------------------------ */

function parseHash(stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return null;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 100_000) return null;
  try {
    return { iterations, salt: fromBase64Url(parts[3]), hash: fromBase64Url(parts[4]) };
  } catch {
    return null;
  }
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Produces the value for LIFEOS_PASSWORD_HASH. Used by the setup script. */
export async function hashPassword(password, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || typeof password !== 'string' || password.length === 0 || password.length > 1024) {
    return false;
  }
  const candidate = await pbkdf2(password, parsed.salt, parsed.iterations);
  return timingSafeEqual(candidate, parsed.hash);
}

/* ------------------------------------------------------------------ *
 * Session tokens
 * ------------------------------------------------------------------ */

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** Short fingerprint of the password hash, so a password change revokes sessions. */
async function credentialFingerprint(config) {
  return toBase64Url((await hmac(config.secret, `credential:${config.passwordHash}`)).slice(0, 12));
}

export async function createSessionToken(config, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = {
    sub: 'owner',
    iat: nowSeconds,
    exp: nowSeconds + SESSION_TTL_SECONDS,
    cred: await credentialFingerprint(config),
  };
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await hmac(config.secret, `session:${body}`));
  return `${body}.${signature}`;
}

/**
 * Verifies a session token.
 * @returns {Promise<{ valid: true, iat: number, exp: number } | { valid: false }>}
 */
export async function verifySessionToken(config, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 2048) return { valid: false };
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return { valid: false };

  const expected = toBase64Url(await hmac(config.secret, `session:${body}`));
  if (!timingSafeEqual(signature, expected)) return { valid: false };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return { valid: false };
  }
  if (payload?.sub !== 'owner' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    return { valid: false };
  }
  if (payload.exp <= nowSeconds || payload.iat > nowSeconds + 60) return { valid: false };
  if (!timingSafeEqual(String(payload.cred), await credentialFingerprint(config))) return { valid: false };

  return { valid: true, iat: payload.iat, exp: payload.exp };
}

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

export function readCookie(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Secure is set except on plain-http localhost, where browsers would refuse to
 * store it and the local production server could not be tested at all.
 */
function secureAttribute(request) {
  const url = new URL(request.url);
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  return local ? '' : '; Secure';
}

export function sessionCookie(request, token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secureAttribute(request)}`;
}

export function clearedSessionCookie(request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute(request)}`;
}

/** Returns the verified session on this request, or null. */
export async function sessionFromRequest(request, config) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const result = await verifySessionToken(config, token);
  return result.valid ? result : null;
}

/* ------------------------------------------------------------------ *
 * Request hardening
 * ------------------------------------------------------------------ */

/**
 * Rejects cross-site state-changing requests. SameSite=Strict already stops the
 * cookie being sent cross-site; this is the second, independent check.
 */
export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  const host = new URL(request.url).host;
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  // No Origin header: only accept if the fetch metadata says same-origin.
  const site = request.headers.get('sec-fetch-site');
  return site === 'same-origin' || site === 'none';
}

export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/**
 * Sliding-window limiter, held in memory.
 *
 * Serverless instances do not share memory, so this bounds attempts per warm
 * instance rather than globally. It is one layer of three: the PBKDF2 cost makes
 * each guess slow, the per-attempt delay below adds more, and a long random
 * passphrase makes the search space impractical regardless.
 */
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  return {
    /** @returns {{ allowed: boolean, retryAfterSeconds: number }} */
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) hits.clear(); // bound memory under a flood of distinct keys
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Standard JSON response with no caching. */
export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}
