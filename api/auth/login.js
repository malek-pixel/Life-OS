// Vercel Function. Logic lives in server/handlers.js, shared with the local server.
import { login } from '../../server/handlers.js';
export const POST = (request) => login(request, process.env);
