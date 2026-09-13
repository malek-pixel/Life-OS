/**
 * `npm run serve` - runs the production build locally with the real auth layer.
 *
 * Serves dist/ behind the same gate (server/gate.js) and the same API handlers
 * (server/handlers.js) that Vercel runs, so authentication can be exercised end
 * to end before deploying. It is also a working self-host option: any Node host
 * that can run this file and set the environment variables can serve Life OS.
 *
 * Headers are read from vercel.json, so both environments send the same ones.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

import { decide } from '../server/gate.js';
import { aiChat, login, logout, session } from '../server/handlers.js';
import { sync } from '../server/sync.js';

const ROOT = normalize(join(process.cwd(), 'dist'));
const PORT = Number(process.env.PORT ?? 4173);
const vercel = JSON.parse(await readFile(join(process.cwd(), 'vercel.json'), 'utf8'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const ROUTES = {
  '/api/auth/login': login,
  '/api/auth/logout': logout,
  '/api/auth/session': session,
  '/api/ai/chat': aiChat,
  '/api/sync': sync,
};

/** Applies vercel.json "headers" rules whose source matches the path. */
function headersFor(pathname) {
  const out = {};
  for (const rule of vercel.headers ?? []) {
    const pattern = new RegExp(`^${rule.source.replace(/\(\.\*\)/g, '.*').replace(/:path\*/g, '.*')}$`);
    if (pattern.test(pathname)) for (const h of rule.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

async function toWebRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

async function send(res, response, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  response.headers.forEach((v, k) => {
    headers[k] = k === 'set-cookie' && headers[k] ? [].concat(headers[k], v) : v;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(pathname) {
  // Mirror vercel.json rewrites: /login -> /login.html; unknown paths -> SPA.
  let file = pathname === '/' ? '/index.html' : pathname === '/login' ? '/login.html' : pathname;
  let full = normalize(join(ROOT, file));
  if (!full.startsWith(ROOT)) return null;
  try {
    if (!(await stat(full)).isFile()) throw new Error('not a file');
  } catch {
    if (extname(pathname)) return null; // a missing asset is a 404, not the app
    full = join(ROOT, 'index.html');
    file = '/index.html';
  }
  return { body: await readFile(full), type: TYPES[extname(full)] ?? 'application/octet-stream' };
}

createServer(async (req, res) => {
  try {
    const request = await toWebRequest(req);
    const { pathname } = new URL(request.url);

    const decision = await decide(request, process.env);
    if (decision.action === 'respond') {
      return send(res, decision.response, headersFor(pathname));
    }

    const route = ROUTES[pathname];
    if (route) return send(res, await route(request, process.env), headersFor(pathname));

    const found = await serveStatic(pathname);
    if (!found) {
      res.writeHead(404, { 'content-type': 'text/plain', ...headersFor(pathname) });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': found.type, ...headersFor(pathname) });
    res.end(found.body);
  } catch (err) {
    console.error('[serve]', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal error');
  }
}).listen(PORT, () => {
  console.log(`Life OS (production build, auth enforced) on http://localhost:${PORT}`);
});
