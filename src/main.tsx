/**
 * Entry point.
 *
 * HashRouter rather than BrowserRouter: routes live in the URL fragment, which
 * is never sent to the server, so every deep link and every refresh requests
 * "/" and no host needs history-API fallback configuration.
 *
 * In production the session is confirmed before React mounts, so no private
 * screen - not even its skeleton - renders for a signed-out visitor. See
 * app/session.ts for why this is needed on top of the server gate.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

// Self-hosted fonts: no request to a third party, and they load from the same
// gated origin as the rest of the app.
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

import App from './app/App';
import { checkSession, goToLogin, watchSession } from './app/session';
import './design/global.css';
import './ui/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Life OS could not find its root element.');

if ((await checkSession()) === 'unauthenticated') {
  goToLogin();
} else {
  watchSession();
  createRoot(container).render(
    <StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </StrictMode>,
  );
}
