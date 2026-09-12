/**
 * AI provider abstraction and the Groq client.
 *
 * TECH_SPEC section 8 keeps a thin provider interface even with a single
 * provider, because it is cheap and means swapping models or adding a fallback
 * never touches the tool or UI layers.
 *
 * The API key: the Flutter spec stores it in flutter_secure_storage. A browser
 * has no equivalent — there is no OS keychain a web page can reach. It is kept
 * in localStorage on the user's own device, never sent anywhere except Groq,
 * and never written to a log (see errors.ts `redact`). Settings states this
 * limitation plainly rather than implying a security guarantee the platform
 * cannot make.
 */

import { AiError } from '../data/errors';

const KEY_STORAGE = 'life-os.groq-key';

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

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    // Private browsing or blocked site data.
    return null;
  }
}

export function setApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    throw new AiError('AI_NO_KEY', 'This browser will not let Life OS store the API key.');
  }
}

export function clearApiKey(): void {
  try {
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
    return getApiKey() != null;
  },

  async complete(messages, tools, options): Promise<AiCompletion> {
    const key = getApiKey();
    if (!key) {
      throw new AiError('AI_NO_KEY', 'Add a Groq API key in Settings to use the coach.');
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
          temperature: 0.6,
          max_tokens: 1200,
        }),
        signal: options.signal,
      });
    } catch (err) {
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
