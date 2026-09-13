/**
 * Vercel Routing Middleware: runs before every request to the deployment.
 *
 * All the logic lives in server/gate.js so the local production server enforces
 * identical rules. This file only adapts the decision to Vercel's API.
 */

import { next } from '@vercel/functions';
import { decide } from './server/gate.js';

export const config = {
  // Every path. The gate itself decides what is public.
  matcher: '/:path*',
};

export default async function middleware(request) {
  const decision = await decide(request, process.env);
  return decision.action === 'allow' ? next() : decision.response;
}
