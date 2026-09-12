/**
 * Recurrence rules.
 *
 * A deliberately small subset of RFC 5545 RRULE - enough for the recurring
 * tasks and events Life OS actually needs, and no more. TECH_SPEC section 16
 * names recurrence expansion as something that silently corrupts data when
 * wrong, so the supported surface is kept narrow enough to test exhaustively.
 *
 * Supported:
 *   FREQ=DAILY[;INTERVAL=n][;COUNT=n|UNTIL=YYYYMMDD]
 *   FREQ=WEEKLY[;INTERVAL=n][;BYDAY=MO,TU,...][;COUNT=n|UNTIL=YYYYMMDD]
 *   FREQ=MONTHLY[;INTERVAL=n][;COUNT=n|UNTIL=YYYYMMDD]   (same day-of-month)
 *   FREQ=YEARLY[;INTERVAL=n][;COUNT=n|UNTIL=YYYYMMDD]
 *
 * Anything else is rejected by `parseRecurrence` rather than silently ignored:
 * a rule the app cannot honour must not be stored as if it will be.
 */

import { addDays, dayKeyToMs, toDayKey, weekdayOf, type DayKey } from './dates';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurrence {
  freq: Frequency;
  /** Every n periods. Always >= 1. */
  interval: number;
  /** For WEEKLY: JS weekday numbers, 0 = Sunday. Empty means "same day as the start". */
  byDay: number[];
  /** Stop after this many occurrences. Null when unbounded or using `until`. */
  count: number | null;
  /** Stop on or before this day. Null when unbounded or using `count`. */
  until: DayKey | null;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Hard ceiling on generated occurrences, so an unbounded rule cannot hang the UI. */
export const MAX_OCCURRENCES = 500;

/**
 * Parses a rule string. Returns null for anything unsupported or malformed,
 * so callers can reject the input instead of storing a rule that will not run.
 */
export function parseRecurrence(rule: string | null): Recurrence | null {
  if (!rule) return null;

  const parts = new Map<string, string>();
  for (const segment of rule.trim().toUpperCase().split(';')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq <= 0) return null;
    parts.set(segment.slice(0, eq), segment.slice(eq + 1));
  }

  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  let interval = 1;
  if (parts.has('INTERVAL')) {
    interval = Number(parts.get('INTERVAL'));
    if (!Number.isInteger(interval) || interval < 1 || interval > 365) return null;
  }

  let byDay: number[] = [];
  if (parts.has('BYDAY')) {
    const codes = parts.get('BYDAY')!.split(',').filter(Boolean);
    for (const code of codes) {
      const i = DAY_CODES.indexOf(code);
      if (i < 0) return null;
      byDay.push(i);
    }
    byDay = Array.from(new Set(byDay)).sort();
  }

  let count: number | null = null;
  if (parts.has('COUNT')) {
    count = Number(parts.get('COUNT'));
    if (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES) return null;
  }

  let until: DayKey | null = null;
  if (parts.has('UNTIL')) {
    const raw = parts.get('UNTIL')!.slice(0, 8);
    if (!/^\d{8}$/.test(raw)) return null;
    until = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  // COUNT and UNTIL are mutually exclusive in RFC 5545, and honouring both
  // ambiguously is exactly the sort of thing that corrupts a schedule.
  if (count != null && until != null) return null;

  return { freq, interval, byDay, count, until };
}

/**
 * Expands a rule into concrete day keys, starting from `start`.
 *
 * `start` is always the first occurrence for DAILY/MONTHLY/YEARLY. For WEEKLY
 * with BYDAY, the start day is included only if it is one of the listed days -
 * matching how a "every Mon/Wed" rule created on a Tuesday should behave.
 *
 * Generation always stops at `limit` (default MAX_OCCURRENCES) so an unbounded
 * rule can never spin.
 */
export function expandRecurrence(
  rule: Recurrence,
  start: DayKey,
  options: { limit?: number; horizon?: DayKey } = {},
): DayKey[] {
  const limit = Math.min(options.limit ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
  const out: DayKey[] = [];

  const past = (day: DayKey): boolean => {
    if (rule.until != null && day > rule.until) return true;
    if (options.horizon != null && day > options.horizon) return true;
    return false;
  };

  if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
    // Walk day by day from the start of the start's week, taking matching
    // weekdays in weeks that fall on the interval.
    const weekStart = addDays(start, -weekdayOf(start));
    let week = 0;
    let cursor = weekStart;

    while (out.length < limit && week < MAX_OCCURRENCES) {
      if (week % rule.interval === 0) {
        for (const dow of rule.byDay) {
          const day = addDays(cursor, dow);
          if (day < start) continue;
          if (past(day)) return out;
          out.push(day);
          if (rule.count != null && out.length >= rule.count) return out;
          if (out.length >= limit) return out;
        }
      }
      cursor = addDays(cursor, 7);
      week++;
    }
    return out;
  }

  let day = start;
  let n = 0;
  while (out.length < limit && n < MAX_OCCURRENCES) {
    if (past(day)) break;
    out.push(day);
    if (rule.count != null && out.length >= rule.count) break;

    n++;
    day = step(start, rule, n);
  }
  return out;
}

/** The nth occurrence after `start` for the non-BYDAY frequencies. */
function step(start: DayKey, rule: Recurrence, n: number): DayKey {
  const [y, m, d] = start.split('-').map(Number);
  const offset = n * rule.interval;

  switch (rule.freq) {
    case 'DAILY':
      return addDays(start, offset);
    case 'WEEKLY':
      return addDays(start, offset * 7);
    case 'MONTHLY': {
      // Clamp to the last day of the target month, so the 31st of a 30-day
      // month lands on the 30th rather than rolling into the next month.
      const target = new Date(y ?? 1970, (m ?? 1) - 1 + offset, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(d ?? 1, lastDay));
      return toDayKey(target.getTime());
    }
    case 'YEARLY': {
      const target = new Date((y ?? 1970) + offset, (m ?? 1) - 1, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(d ?? 1, lastDay));
      return toDayKey(target.getTime());
    }
    default:
      return start;
  }
}

/**
 * The next occurrence strictly after `after`, or null if the rule has run out.
 *
 * Used when completing a recurring task: the completed instance stays completed
 * and the next one is scheduled, rather than the same row being reused.
 */
export function nextOccurrence(
  rule: Recurrence,
  start: DayKey,
  after: DayKey,
): DayKey | null {
  // Expanding to a bounded window is enough: a rule whose next hit is more than
  // MAX_OCCURRENCES periods away is not a schedule anyone is running.
  const days = expandRecurrence(rule, start, { limit: MAX_OCCURRENCES });
  for (const day of days) if (day > after) return day;
  return null;
}

/** Plain-language summary, for the recurrence field and task detail. */
export function describeRecurrence(rule: Recurrence | null): string {
  if (!rule) return 'Does not repeat';

  const every = rule.interval === 1 ? '' : ` ${ordinal(rule.interval)}`;
  let base: string;

  switch (rule.freq) {
    case 'DAILY':
      base = rule.interval === 1 ? 'Every day' : `Every${every} day`;
      break;
    case 'WEEKLY':
      if (rule.byDay.length > 0) {
        const names = rule.byDay.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]);
        base = `Every${every} week on ${names.join(', ')}`;
      } else {
        base = rule.interval === 1 ? 'Every week' : `Every${every} week`;
      }
      break;
    case 'MONTHLY':
      base = rule.interval === 1 ? 'Every month' : `Every${every} month`;
      break;
    default:
      base = rule.interval === 1 ? 'Every year' : `Every${every} year`;
  }

  if (rule.count != null) return `${base}, ${rule.count} times`;
  if (rule.until != null) return `${base}, until ${rule.until}`;
  return base;
}

function ordinal(n: number): string {
  if (n === 2) return ' second';
  if (n === 3) return ' third';
  return ` ${n}th`;
}

/** Presets offered in the recurrence picker. */
export const RECURRENCE_PRESETS: Array<{ label: string; rule: string | null }> = [
  { label: 'Does not repeat', rule: null },
  { label: 'Every day', rule: 'FREQ=DAILY' },
  { label: 'Every weekday', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { label: 'Every week', rule: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Every month', rule: 'FREQ=MONTHLY' },
  { label: 'Every year', rule: 'FREQ=YEARLY' },
];

/** Converts a day key to the instant used when scheduling the next instance. */
export function occurrenceInstant(day: DayKey, timeOfDayMs: number | null): number {
  const base = dayKeyToMs(day);
  if (timeOfDayMs == null) return base;
  const d = new Date(timeOfDayMs);
  return base + d.getHours() * 3_600_000 + d.getMinutes() * 60_000;
}
