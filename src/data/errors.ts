/**
 * Structured errors.
 *
 * Implements TECHNICAL_SPECIFICATION section 10: every failure carries a stable
 * machine-readable `code` and a message written for the user. Per Development
 * Master section 30, a raw exception is never shown to the user, and per section
 * 33 the Groq API key never appears in a message or a log line.
 */

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'DB_ERROR',
  'DB_BLOCKED',
  'STORAGE_UNAVAILABLE',
  'STORAGE_FULL',
  'NOT_FOUND',
  'CONFLICT',
  'AI_TOOL_ERROR',
  'AI_RATE_LIMITED',
  'AI_UNAVAILABLE',
  'AI_NO_KEY',
  'AI_CANCELLED',
  'AI_PERMISSION_DENIED',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Base class for every error Life OS raises deliberately. */
export class AppError extends Error {
  readonly code: ErrorCode;
  /** Field-level detail, for forms. Keyed by field name. */
  readonly fields: Record<string, string> | undefined;
  /** Whether retrying the same operation could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { cause?: unknown; fields?: Record<string, string>; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = options.fields;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export class DbError extends AppError {
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    // A failed write is worth retrying; a missing/blocked database is not.
    super(code, message, { cause, retryable: code === 'DB_ERROR' });
    this.name = 'DbError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fields: Record<string, string> = {}) {
    super('VALIDATION_ERROR', message, { fields });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `That ${entity} no longer exists. It may have been deleted.`);
    this.name = 'NotFoundError';
    this.entityId = id;
  }
  readonly entityId: string;
}

export class AiError extends AppError {
  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(code, message, {
      cause,
      retryable: code === 'AI_RATE_LIMITED' || code === 'AI_UNAVAILABLE',
    });
    this.name = 'AiError';
  }
}

/**
 * Normalises anything thrown into an AppError with a message safe to display.
 *
 * Unknown throwables deliberately do NOT have their text surfaced: an arbitrary
 * exception message can carry internal detail, so it is logged and replaced.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof DOMException) {
    if (err.name === 'QuotaExceededError') {
      return new AppError(
        'STORAGE_FULL',
        'This device is out of storage, so the change could not be saved. Free up space and try again.',
        { cause: err, retryable: true },
      );
    }
    if (err.name === 'AbortError') {
      return new AppError('AI_CANCELLED', 'That request was cancelled.', { cause: err });
    }
  }

  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return new AiError('AI_UNAVAILABLE', 'Could not reach the AI service. Check your connection.', err);
  }

  logInternal(err);
  return new AppError('UNKNOWN', 'Something went wrong. Your data was not changed.', {
    cause: err,
  });
}

/**
 * The one place errors are logged.
 *
 * Per Development Master section 30 log lines never contain journal content,
 * health data, or the Groq API key. Anything matching a key-shaped token is
 * redacted before it reaches the console.
 */
export function logInternal(err: unknown, context?: string): void {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const safe = redact(text);
  if (isDev()) {
    console.error(`[life-os]${context ? ` ${context}` : ''} ${safe}`, err);
  } else {
    console.error(`[life-os]${context ? ` ${context}` : ''} ${safe}`);
  }
}

function isDev(): boolean {
  try {
    return Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

const KEY_PATTERN = /\b(gsk_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,})\b/g;

/** Redacts anything shaped like an API key. */
export function redact(text: string): string {
  return text.replace(KEY_PATTERN, '[redacted]');
}

/** User-facing copy for a code, when the thrown message is not specific enough. */
export function messageForCode(code: ErrorCode): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Some details need fixing before this can be saved.';
    case 'DB_ERROR':
      return 'The change could not be saved. Nothing was altered.';
    case 'DB_BLOCKED':
      return 'Another Life OS tab is open. Close it and reload.';
    case 'STORAGE_UNAVAILABLE':
      return 'This browser cannot store Life OS data. Private browsing may be blocking it.';
    case 'STORAGE_FULL':
      return 'This device is out of storage. Free up space and try again.';
    case 'NOT_FOUND':
      return 'That item no longer exists.';
    case 'CONFLICT':
      return 'That change conflicts with the current state.';
    case 'AI_TOOL_ERROR':
      return 'The AI tried an action that could not be completed.';
    case 'AI_RATE_LIMITED':
      return 'The AI is rate limited right now. Wait a moment and try again.';
    case 'AI_UNAVAILABLE':
      return 'The AI is unreachable. Everything else in Life OS still works offline.';
    case 'AI_NO_KEY':
      return 'Add a Groq API key in Settings to use the coach.';
    case 'AI_CANCELLED':
      return 'That request was cancelled.';
    case 'AI_PERMISSION_DENIED':
      return 'The AI is not allowed to do that.';
    default:
      return 'Something went wrong. Your data was not changed.';
  }
}
