/**
 * Entry point.
 *
 * HashRouter rather than BrowserRouter: Life OS is a single-user local app with
 * no server, so there is nothing to configure a history-API fallback on. A hash
 * route works identically whether the build is served by a dev server, opened
 * from the file system, or dropped on any static host.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './app/App';
import './design/global.css';
import './ui/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Life OS could not find its root element.');

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
