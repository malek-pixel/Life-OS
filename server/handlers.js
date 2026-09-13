/**
 * API route handlers. Web-standard (Request -> Response), so the same functions
 * run as Vercel Functions (re-exported from /api) and inside scripts/serve.js.
 */

import {
  clearedSessionCookie,
  clientIp,
  createRateLimiter,
  createSessionToken,
  isSameOrigin,
  json,
  readAuthConfig,
  sessionCookie,
  sessionFromRequest,
  SESSION_RENEW_AFTER_SECONDS,
  verifyPassword,
} from './auth.js';

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

/** Five attempts per address per fifteen minutes, twenty overall per warm instance. */
const loginByIp = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });
const loginGlobal = createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });

/** Every failure takes at least this long, so response time says nothing. */
const MIN_FAILURE_MS = 750;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (!isSameOrigin(request)) return json(403, { error: 'forbidden', message: 'Cross-site request refused.' });

  const config = readAuthConfig(env);
  if (!config.ok) {
    // Deliberately vague to the visitor; the specific reason is for the owner.
    console.error(`[auth] Sign-in unavailable: ${config.reason}`);
    return json(503, {
      error: 'not_configured',
      message: 'Sign-in is not configured on this server yet.',
    });
  }

  const ip = clientIp(request);
  const perIp = loginByIp.take(ip);
  const global = perIp.allowed ? loginGlobal.take('all') : perIp;
  if (!perIp.allowed || !global.allowed) {
    const retry = Math.max(perIp.retryAfterSeconds, global.retryAfterSeconds);
    return json(
      429,
      { error: 'rate_limited', message: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).`, retryAfterSeconds: retry },
      { 'retry-after': String(retry) },
    );
  }

  const started = Date.now();
  let password = '';
  try {
    const type = request.headers.get('content-type') ?? '';
    if (!type.includes('application/json')) return json(415, { error: 'unsupported_media_type' });
    const text = await request.text();
    if (text.length > 4096) return json(413, { error: 'payload_too_large' });
    const body = JSON.parse(text);
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    return json(400, { error: 'bad_request', message: 'The sign-in request was malformed.' });
  }

  const ok = await verifyPassword(password, config.passwordHash);
  if (!ok) {
    const elapsed = Date.now() - started;
    if (elapsed < MIN_FAILURE_MS) await sleep(MIN_FAILURE_MS - elapsed);
    return json(401, { error: 'invalid_credentials', message: 'That password is not correct.' });
  }

  const token = await createSessionToken(config);
  return json(200, { ok: true }, { 'set-cookie': sessionCookie(request, token) });
}

/* ------------------------------------------------------------------ *
 * Sign out
 * ------------------------------------------------------------------ */

export async function logout(request) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (!isSameOrigin(request)) return json(403, { error: 'forbidden' });
  // Clearing needs no valid session: signing out an expired session must work.
  return json(200, { ok: true }, {
    'set-cookie': clearedSessionCookie(request),
    // Tells the browser to drop cached pages for this origin, so Back after
    // signing out cannot redisplay the application from cache.
    'clear-site-data': '"cache"',
  });
}

/* ------------------------------------------------------------------ *
 * Session check
 * ------------------------------------------------------------------ */

/**
 * Confirms the session and renews it once it is a day old, so an app opened
 * regularly from the Home Screen never expires in normal use.
 */
export async function session(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, { allow: 'GET' });
  const config = readAuthConfig(env);
  if (!config.ok) return json(503, { error: 'not_configured' });

  const current = await sessionFromRequest(request, config);
  if (!current) return json(401, { error: 'unauthenticated' });

  const age = Math.floor(Date.now() / 1000) - current.iat;
  if (age > SESSION_RENEW_AFTER_SECONDS) {
    const token = await createSessionToken(config);
    return json(200, { authenticated: true }, { 'set-cookie': sessionCookie(request, token) });
  }
  return json(200, { authenticated: true });
}

/* ------------------------------------------------------------------ *
 * AI proxy
 * ------------------------------------------------------------------ */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const ALLOWED_MODELS = new Set(['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
const MAX_BODY_BYTES = 200_000;
const MAX_TOKENS = 1200;
const UPSTREAM_TIMEOUT_MS = 55_000;

/** One owner: generous for real use, tight enough to stop a runaway loop. */
const aiLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * Forwards a chat completion to Groq with the server's key.
 *
 * The browser never sees GROQ_API_KEY. The session is verified here as well as
 * in middleware, so this endpoint stays closed even if the middleware matcher
 * were ever misconfigured. Only the fields Life OS uses are forwarded, the model
 * is allow-listed and output length is capped, so a stolen session could not
 * turn the proxy into a general-purpose, unbounded Groq relay.
 */
export async function aiChat(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  if (!isSameOrigin(request)) return json(403, { error: 'forbidden' });

  const config = readAuthConfig(env);
  if (!config.ok || !(await sessionFromRequest(request, config))) {
    return json(401, { error: 'unauthenticated', message: 'Sign in to continue.' });
  }

  if (!env.GROQ_API_KEY) {
    return json(503, {
      error: 'ai_not_configured',
      message: 'The AI coach is not configured on the server. Add GROQ_API_KEY to the deployment.',
    });
  }

  const limit = aiLimiter.take('owner');
  if (!limit.allowed) {
    return json(429, { error: 'rate_limited', message: 'Too many coach requests in a minute.' }, { 'retry-after': String(limit.retryAfterSeconds) });
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'bad_request' });
  }

  if (!ALLOWED_MODELS.has(body?.model) || !Array.isArray(body?.messages) || body.messages.length === 0) {
    return json(400, { error: 'bad_request', message: 'Unsupported model or empty conversation.' });
  }

  const upstreamBody = {
    model: body.model,
    messages: body.messages,
    temperature: 0.6,
    max_tokens: MAX_TOKENS,
    ...(Array.isArray(body.tools) && body.tools.length > 0 ? { tools: body.tools, tool_choice: 'auto' } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  request.signal?.addEventListener?.('abort', () => controller.abort());

  let upstream;
  try {
    upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
  } catch {
    return json(502, { error: 'upstream_unreachable', message: 'Could not reach the AI service.' });
  } finally {
    clearTimeout(timer);
  }

  if (upstream.status === 401 || upstream.status === 403) {
    // The server's key is wrong. Say so without echoing anything from Groq.
    console.error('[ai] Groq rejected GROQ_API_KEY');
    return json(503, { error: 'ai_key_rejected', message: 'The server’s AI key was rejected. Check GROQ_API_KEY in the deployment.' });
  }
  if (upstream.status === 429) {
    return json(429, { error: 'rate_limited', message: 'Groq is rate limiting requests right now.' });
  }
  if (!upstream.ok) {
    return json(502, { error: 'upstream_error', status: upstream.status });
  }

  // Pass the completion through, but only as JSON and never with upstream headers.
  const payload = await upstream.text();
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
