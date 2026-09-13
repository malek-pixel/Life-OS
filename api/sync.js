import { sync } from '../server/sync.js';
export const config = { maxDuration: 30 };
export const GET = (request) => sync(request, process.env);
export const POST = (request) => sync(request, process.env);
