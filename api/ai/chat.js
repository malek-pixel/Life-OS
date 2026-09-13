import { aiChat } from '../../server/handlers.js';
export const config = { maxDuration: 60 };
export const POST = (request) => aiChat(request, process.env);
