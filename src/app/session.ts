/**
 * Client side of authentication.
 *
 * The real enforcement is on the server: without a valid session cookie the
 * gate never sends this bundle at all (server/gate.js). This module handles the
 * states a server cannot see from a single request:
 *
 *  - The app was opened from memory rather than reloaded. iOS resumes Home
 *    Screen apps from suspension, and Back after signing out can restore a page
 *    from the bfcache. Either way this code is already running, so it asks the
 *    server again before showing anything.
 *  - The session expired while the app sat open.
 *
 * Both lead back to the sign-in page rather than leaving private screens up.
 *
 * Only active in production builds. The Vite dev server has no API, so local
 * development runs unauthenticated, exactly as before; `npm run serve` runs the
 * production build with authentication for testing.
 */

export const AUTH_ENABLED: boolean = import.meta.env.PROD;

export type SessionState = 'authenticated' | 'unauthenticated' | 'unreachable';

/** How often an open, visible app re-confirms its session. */
const RECHECK_MS = 10 * 60_000;

export async function checkSession(): Promise<SessionState> {
  if (!AUTH_ENABLED) return 'authenticated';
  try {
    const response = await fetch('/api/auth/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (response.status === 200) return 'authenticated';
    if (response.status === 401) return 'unauthenticated';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Leaves the app for the sign-in page, keeping the current screen so signing
 * back in returns to it. replace() keeps the private page out of history.
 */
export function goToLogin(): void {
  const hash = /^#\/[A-Za-z0-9\-/?=&._~%]*$/.test(window.location.hash) ? window.location.hash : '';
  // Hide the app immediately; the navigation below takes a moment.
  document.documentElement.style.visibility = 'hidden';
  window.location.replace(`/login${hash}`);
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    // Even if the request failed (offline), leave the app. The cookie is
    // HttpOnly, so it cannot be cleared from here; the server clears it on the
    // next successful request, and the gate refuses the app without it anyway.
    document.documentElement.style.visibility = 'hidden';
    window.location.replace('/login');
  }
}

/**
 * Re-checks the session whenever the app could have been resumed without a
 * reload. "unreachable" is not treated as signed out: the document was served
 * by an authenticated request, and locking someone out of their own local data
 * because they walked into a lift would be the wrong failure.
 */
export function watchSession(): () => void {
  if (!AUTH_ENABLED) return () => undefined;

  const verify = async () => {
    if ((await checkSession()) === 'unauthenticated') goToLogin();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void verify();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    // Restored from the back/forward cache, e.g. pressing Back after signing out.
    if (event.persisted) void verify();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') void verify();
  }, RECHECK_MS);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
    clearInterval(timer);
  };
}
