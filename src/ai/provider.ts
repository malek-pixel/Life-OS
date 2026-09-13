/**
 * AI provider abstraction and the Groq client.
 *
 * TECH_SPEC section 8 keeps a thin provider interface even with a single
 * provider, because it is cheap and means swapping models or adding a fallback
 * never touches the tool or UI layers.
 *
 * ---------------------------------------------------------------------------
 * API KEY STORAGE - READ THIS BEFORE CHANGING IT
 * ---------------------------------------------------------------------------
 *
 * The Flutter spec stores the key in flutter_secure_storage, which is backed by
 * the OS credential store. A browser has no equivalent. There is no secure
 * storage available to a web page, and nothing in this file should ever be
 * described as secure.
 *
 * What web storage actually gives you:
 *   - Any script running on this origin can read it. That includes anything a
 *     future dependency pulls in.
 *   - A browser extension with host access can read it.
 *   - Anyone with access to this browser profile on disk can read it.
 *   - It is NOT encrypted at rest.
 *
 * Given those constraints, the safest available architecture is chosen here:
 *
 *   1. SESSION SCOPE BY DEFAULT. The key lives in sessionStorage, which is
 *      wiped when the tab closes and is not shared with other tabs. This
 *      meaningfully shrinks the window in which the key exists on disk.
 *   2. PERSISTENCE IS OPT-IN. Storing it across restarts uses localStorage and
 *      requires an explicit choice, made with the tradeoff stated in Settings.
 *   3. NEVER LOGGED. errors.ts `redact()` strips key-shaped tokens from every
 *      log line.
 *   4. NEVER EXPORTED. data/portability.ts deliberately omits it, so a backup
 *      file shared or synced to a cloud drive cannot leak the credential.
 *   5. NEVER IN THE BUNDLE. It is entered at runtime, never an env var - a
 *      VITE_ prefixed value would be inlined into the build and be public.
 *
 * The only genuinely secure option is a server holding the key.
 *
 * ---------------------------------------------------------------------------
 * PRODUCTION: THE KEY IS SERVER-SIDE
 * ---------------------------------------------------------------------------
 *
 * Deployed builds do not use any of the storage above. Every request goes to
 * the authenticated proxy at /api/ai/chat (server/handlers.js), which holds
 * GROQ_API_KEY in the server environment and adds it upstream. The browser
 * never receives the key, so it cannot be recovered from the bundle, from
 * storage or from devtools. The session is verified before any upstream call.
 *
 * The browser-held key remains only for the local Vite dev server, which has no
 * API routes. `AI_SERVER_PROXY` is a build-time constant, so the dev-only path
 * is compiled out of production bundles.
 */

import { AiError } from '../data/errors';
import { goToLogin } from '../app/session';

const KEY_STORAGE = 'life-os.groq-key';

/** True in production builds: AI requests go through the authenticated server proxy. */
export const AI_SERVER_PROXY: boolean = import.meta.env.PROD;

export interface AiMessageInput {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface AiToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiCompletion {
  content: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage: { promptTokens: number; completionTokens: number };
  model: string;
}

export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(
    messages: AiMessageInput[],
    tools: AiToolSchema[],
    options: { model: string; signal?: AbortSignal },
  ): Promise<AiCompletion>;
}

/* ------------------------------------------------------------------ *
 * Key management
 * ------------------------------------------------------------------ */

export type KeyScope = 'session' | 'device';

/**
 * Reads the key, preferring the session copy.
 *
 * Checking session first means that after the user downgrades from persistent
 * to session-only storage, the stale persisted copy can never win.
 */
export function getApiKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? localStorage.getItem(KEY_STORAGE);
  } catch {
    // Private browsing, or site data blocked entirely.
    return null;
  }
}

/** Where the current key is held, or null when there is none. */
export function getKeyScope(): KeyScope | null {
  try {
    if (sessionStorage.getItem(KEY_STORAGE)) return 'session';
    if (localStorage.getItem(KEY_STORAGE)) return 'device';
    return null;
  } catch {
    return null;
  }
}

/**
 * Stores the key at the requested scope.
 *
 * `session` is the default and is wiped when the tab closes. `device` persists
 * and is only ever chosen explicitly by the user. Writing to one scope always
 * clears the other, so exactly one copy exists.
 */
export function setApiKey(key: string, scope: KeyScope = 'session'): void {
  const trimmed = key.trim();
  try {
    sessionStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
    if (!trimmed) return;
    if (scope === 'device') localStorage.setItem(KEY_STORAGE, trimmed);
    else sessionStorage.setItem(KEY_STORAGE, trimmed);
  } catch {
    throw new AiError('AI_NO_KEY', 'This browser will not let Life OS store the API key.');
  }
}

/** Removes the key from both scopes. */
export function clearApiKey(): void {
  try {
    sessionStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

/** Masked form for display, so the key is never shown in full after entry. */
export function maskedKey(): string | null {
  const key = getApiKey();
  if (!key) return null;
  return key.length <= 8 ? '••••' : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

/* ------------------------------------------------------------------ *
 * Groq
 * ------------------------------------------------------------------ */

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

function baseUrl(): string {
  try {
    const configured = (import.meta as { env?: Record<string, string> }).env?.VITE_GROQ_BASE_URL;
    return configured || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export const groqProvider: AiProvider = {
  name: 'Groq',

  isConfigured(): boolean {
    // Through the proxy the server decides; a missing server key comes back as
    // a clear error on the first request rather than a disabled input.
    return AI_SERVER_PROXY || getApiKey() != null;
  },

  async complete(messages, tools, options): Promise<AiCompletion> {
    const body = JSON.stringify({
      model: options.model,
      messages,
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      temperature: 0.6,
      max_tokens: 1200,
    });

    let response: Response;
    try {
      if (AI_SERVER_PROXY) {
        // No key and no Authorization header: the session cookie authenticates
        // the request, and the server adds the Groq key upstream.
        response = await fetch('/api/ai/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: options.signal,
        });
      } else {
        const key = getApiKey();
        if (!key) {
          throw new AiError('AI_NO_KEY', 'Add a Groq API key in Settings to use the coach.');
        }
        response = await fetch(`${baseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body,
          signal: options.signal,
        });
      }
    } catch (err) {
      if (err instanceof AiError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AiError('AI_CANCELLED', 'That request was cancelled.');
      }
      // The only feature in Life OS that needs the network, so this is the one
      // place "offline" has to be handled gracefully (TECH_SPEC section 10).
      throw new AiError(
        'AI_UNAVAILABLE',
        'Could not reach Groq. Everything else in Life OS works offline — try the coach again when you are back online.',
        err,
      );
    }

    if (AI_SERVER_PROXY && !response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (response.status === 401) {
        // Session expired while the coach was open: back to sign-in.
        goToLogin();
        throw new AiError('AI_CANCELLED', 'Your session has ended. Sign in again to continue.');
      }
      if (response.status === 429) {
        throw new AiError('AI_RATE_LIMITED', detail.message ?? 'Too many coach requests. Wait a moment and try again.');
      }
      if (detail.error === 'ai_not_configured' || detail.error === 'ai_key_rejected') {
        throw new AiError('AI_NO_KEY', detail.message ?? 'The AI coach is not configured on the server.');
      }
      throw new AiError(
        'AI_UNAVAILABLE',
        `The AI service returned an error (${response.status}). Nothing in your data changed.`,
      );
    }

    if (response.status === 429) {
      throw new AiError(
        'AI_RATE_LIMITED',
        'Groq is rate limiting requests right now. Wait a moment and try again.',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiError(
        'AI_NO_KEY',
        'Groq rejected the API key. Check it in Settings — it may have been revoked.',
      );
    }
    if (!response.ok) {
      // The upstream body can contain request detail, so it is not surfaced.
      throw new AiError(
        'AI_UNAVAILABLE',
        `The AI service returned an error (${response.status}). Nothing in your data changed.`,
      );
    }

    let payload: GroqResponse;
    try {
      payload = (await response.json()) as GroqResponse;
    } catch (err) {
      throw new AiError('AI_UNAVAILABLE', 'The AI returned a response Life OS could not read.', err);
    }

    const choice = payload.choices?.[0];
    const rawCalls = choice?.message?.tool_calls ?? [];

    return {
      content: choice?.message?.content ?? '',
      toolCalls: rawCalls.map((call) => ({
        id: call.id,
        name: call.function.name,
        args: safeParseArgs(call.function.arguments),
      })),
      usage: {
        promptTokens: payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.completion_tokens ?? 0,
      },
      model: payload.model ?? options.model,
    };
  },
};

interface GroqResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Parses tool arguments defensively.
 *
 * A model can emit malformed JSON. Returning an empty object lets the tool's own
 * validation produce a proper VALIDATION_ERROR, which is a far better failure
 * than an unhandled parse exception mid-conversation.
 */
function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Models offered in Settings. Free tier at time of writing. */
export const AI_MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B — best quality' },
  { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B — fastest' },
] as const;
