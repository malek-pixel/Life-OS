/**
 * Input validation at the data boundary.
 *
 * Master prompt section 50 requires validation at the appropriate boundary and
 * says client-side checks alone are not enough. Life OS has no server, so this
 * module IS the last line of defence before a write reaches storage: the forms
 * validate for good error messages, and every repository revalidates here so a
 * bad write cannot arrive from the command palette, the AI tool layer, or an
 * import file.
 *
 * Validators collect every problem rather than throwing on the first, so a form
 * can highlight all bad fields at once instead of one per submit.
 */

import { ValidationError } from './errors';
import {
  GOAL_STATUSES,
  HABIT_FREQUENCIES,
  LIFE_AREAS,
  MOODS,
  PRIORITIES,
  PROGRESS_TYPES,
  PROJECT_STATUSES,
  QUEST_TYPES,
  TASK_STATUSES,
  WORKOUT_DISCIPLINES,
} from './schema';

/** Accumulates field errors, then raises them as one ValidationError. */
export class Validator {
  private readonly errors: Record<string, string> = {};

  /** Records a problem against a field. The first message for a field wins. */
  fail(field: string, message: string): this {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }

  check(condition: boolean, field: string, message: string): this {
    if (!condition) this.fail(field, message);
    return this;
  }

  /** Required, trimmed, and within a length budget. Returns the clean value. */
  requiredText(field: string, value: unknown, label: string, max = 200): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) this.fail(field, `${label} is required.`);
    else if (text.length > max) this.fail(field, `${label} must be ${max} characters or fewer.`);
    return text;
  }

  /** Optional free text, trimmed and length-capped. */
  optionalText(field: string, value: unknown, label: string, max = 10_000): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length > max) this.fail(field, `${label} must be ${max} characters or fewer.`);
    return text;
  }

  /** A member of a fixed set. */
  oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[], label: string): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
    this.fail(field, `${label} is not a valid option.`);
    return allowed[0]!;
  }

  /** A finite number within bounds. */
  number(
    field: string,
    value: unknown,
    label: string,
    { min = -Infinity, max = Infinity, integer = false } = {},
  ): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
      this.fail(field, `${label} must be a number.`);
      return 0;
    }
    if (integer && !Number.isInteger(n)) {
      this.fail(field, `${label} must be a whole number.`);
      return Math.round(n);
    }
    if (n < min) this.fail(field, `${label} must be at least ${min}.`);
    if (n > max) this.fail(field, `${label} must be at most ${max}.`);
    return n;
  }

  /** An optional number, or null. */
  optionalNumber(
    field: string,
    value: unknown,
    label: string,
    opts: { min?: number; max?: number; integer?: boolean } = {},
  ): number | null {
    if (value == null || value === '') return null;
    return this.number(field, value, label, opts);
  }

  /** A timestamp in a sane range, or null. Guards against 1970 and year 9999. */
  optionalTimestamp(field: string, value: unknown, label: string): number | null {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Date.parse(String(value));
    if (!Number.isFinite(n)) {
      this.fail(field, `${label} is not a valid date.`);
      return null;
    }
    // 1990-01-01 .. 2100-01-01. Outside this is almost always a parsing bug.
    if (n < 631_152_000_000 || n > 4_102_444_800_000) {
      this.fail(field, `${label} is outside a sensible range.`);
      return null;
    }
    return n;
  }

  /** A `YYYY-MM-DD` local day key. */
  dayKey(field: string, value: unknown, label: string): string {
    const text = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      this.fail(field, `${label} is not a valid date.`);
      return '';
    }
    return text;
  }

  /** A list of trimmed, deduplicated, non-empty tags. */
  tags(field: string, value: unknown, max = 20): string[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      this.fail(field, 'Tags must be a list.');
      return [];
    }
    const out = Array.from(
      new Set(
        value
          .map((t) => String(t).trim())
          .filter(Boolean)
          .map((t) => t.slice(0, 40)),
      ),
    );
    if (out.length > max) this.fail(field, `At most ${max} tags.`);
    return out.slice(0, max);
  }

  /** Weekday numbers, 0-6. */
  weekdays(_field: string, value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const out = Array.from(
      new Set(value.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
    ).sort();
    return out;
  }

  get ok(): boolean {
    return Object.keys(this.errors).length === 0;
  }

  get fieldErrors(): Record<string, string> {
    return { ...this.errors };
  }

  /** Throws if anything failed. Call once at the end of a validator. */
  assert(summary = 'Some details need fixing before this can be saved.'): void {
    if (!this.ok) throw new ValidationError(summary, this.errors);
  }
}

/* ------------------------------------------------------------------ *
 * Shared field rules, so every entity agrees on the basics
 * ------------------------------------------------------------------ */

export const RULES = {
  titleMax: 200,
  descriptionMax: 5_000,
  noteContentMax: 100_000,
  journalContentMax: 100_000,
} as const;

export const ENUMS = {
  goalStatus: GOAL_STATUSES,
  projectStatus: PROJECT_STATUSES,
  taskStatus: TASK_STATUSES,
  priority: PRIORITIES,
  area: LIFE_AREAS,
  progressType: PROGRESS_TYPES,
  habitFrequency: HABIT_FREQUENCIES,
  questType: QUEST_TYPES,
  mood: MOODS,
  discipline: WORKOUT_DISCIPLINES,
} as const;

/**
 * Escapes a string for safe use inside a regular expression.
 *
 * Search builds regexes from user input; without this a stray `(` in a query
 * throws and the search box appears broken.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates that a date range is ordered.
 *
 * Returns the pair unchanged so callers can inline it; reports against the end
 * field because that is the one the user most likely mis-set.
 */
export function checkRange(
  v: Validator,
  start: number | null,
  end: number | null,
  endField: string,
  label: string,
): void {
  if (start != null && end != null && end < start) {
    v.fail(endField, `${label} cannot be before the start date.`);
  }
}
