import { session } from '../../server/handlers.js';
export const GET = (request) => session(request, process.env);
