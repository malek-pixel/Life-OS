/**
 * The access decision for every request to the deployment.
 *
 * PUBLIC: the sign-in page and the few static files it and the Home Screen icon
 * need - none of which contain application code or data.
 * PRIVATE: everything else, including the application HTML, every JavaScript
 * and CSS bundle, and every API route.
 *
 * Gating the bundle as well as the page matters. If only the HTML were
 * protected, the JavaScript would still be downloadable, and a client-side check
 * inside it could simply be skipped. Here, a visitor without a valid session
 * never receives a single byte of the application.
 *
 * Shared by middleware.js (Vercel) and scripts/serve.js (local production
 * server), so both enforce exactly the same rules.
 */

import { readAuthConfig, sessionFromRequest, json } from './auth.js';

/** Exact public paths. Anything not listed here, and not prefixed below, is private. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/login.html',
  '/login.css',
  '/login.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/logo-mark.svg',
  '/robots.txt',
  // iOS requests the Home Screen icon without cookies, so it must be public.
  '/apple-touch-icon.png',
  // Sign-in and sign-out establish or remove the session, so they cannot
  // require one. Each does its own origin and rate-limit checks.
  '/api/auth/login',
  '/api/auth/logout',
]);

const PUBLIC_PREFIXES = ['/icons/'];

export function isPublicPath(pathname) {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function wantsHtml(request) {
  if (request.headers.get('sec-fetch-dest') === 'document') return true;
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * @returns {Promise<{ action: 'allow' } | { action: 'respond', response: Response }>}
 */
export async function decide(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Reject path tricks outright rather than trying to normalise them.
  if (pathname.includes('..') || pathname.includes('//') || pathname.includes('\\')) {
    return { action: 'respond', response: new Response('Bad request', { status: 400 }) };
  }

  const config = readAuthConfig(env);
  const session = config.ok ? await sessionFromRequest(request, config) : null;

  if (isPublicPath(pathname)) {
    // Already signed in: the sign-in page has nothing to offer, go to the app.
    if (session && (pathname === '/login' || pathname === '/login.html') && request.method === 'GET') {
      return { action: 'respond', response: redirect(url, '/') };
    }
    return { action: 'allow' };
  }

  if (session) return { action: 'allow' };

  // Not signed in.
  if (pathname.startsWith('/api/')) {
    return {
      action: 'respond',
      response: json(401, { error: 'unauthenticated', message: 'Sign in to continue.' }),
    };
  }
  if (wantsHtml(request)) {
    // The URL fragment (#/tasks) is not sent to the server, but browsers carry
    // it across a redirect, so the sign-in page can return there afterwards.
    return { action: 'respond', response: redirect(url, '/login') };
  }
  return {
    action: 'respond',
    response: new Response('Unauthorized', {
      status: 401,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' },
    }),
  };
}

function redirect(from, path) {
  // Always same-origin and a fixed path: nothing from the request picks the
  // destination, so this cannot be turned into an open redirect.
  return new Response(null, {
    status: 302,
    headers: { location: new URL(path, from.origin).toString(), 'cache-control': 'no-store' },
  });
}
