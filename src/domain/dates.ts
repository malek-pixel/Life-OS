/**
 * The single time and date strategy for Life OS.
 *
 * Master prompt section 53 requires one standard approach rather than ad-hoc
 * conversions scattered across the app. This is it:
 *
 *  - Every *instant* (createdAt, dueAt, event start) is stored as unix
 *    milliseconds. Milliseconds are absolute, so they are timezone-free on disk.
 *  - Every *calendar day* (habit logs, journal entries, XP rollups) is stored as
 *    a `YYYY-MM-DD` string in the user's LOCAL timezone.
 *
 * The split matters. "Did I keep my streak on Tuesday?" is a question about the
 * user's local Tuesday, not about a UTC window - storing habit logs as instants
 * would break streaks for anyone west of Greenwich after 7pm. Conversely,
 * "when is this due" is a real instant and must not drift with timezone.
 *
 * Nothing outside this module converts between the two.
 */

/** A local calendar day, formatted `YYYY-MM-DD`. */
export type DayKey = string;

const MS_PER_DAY = 86_400_000;

/** The local calendar day containing `ms` (defaults to now). */
export function toDayKey(ms: number = Date.now()): DayKey {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of a day key, as unix ms. */
export function dayKeyToMs(key: DayKey): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).getTime();
}

/** Today's day key. */
export function today(): DayKey {
  return toDayKey();
}

/** Shifts a day key by whole days. Handles DST correctly by going through Date. */
export function addDays(key: DayKey, days: number): DayKey {
  const d = new Date(dayKeyToMs(key));
  d.setDate(d.getDate() + days);
  return toDayKey(d.getTime());
}

/** Whole local days between two keys (`to - from`). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((dayKeyToMs(to) - dayKeyToMs(from)) / MS_PER_DAY);
}

/** Inclusive list of day keys from `from` to `to`. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** The last `count` day keys ending today (oldest first). */
export function lastNDays(count: number, end: DayKey = today()): DayKey[] {
  return dayRange(addDays(end, -(count - 1)), end);
}

/** Local midnight for the instant `ms`. */
export function startOfDay(ms: number): number {
  return dayKeyToMs(toDayKey(ms));
}

/** The last millisecond of the local day containing `ms`. */
export function endOfDay(ms: number): number {
  return startOfDay(ms) + MS_PER_DAY - 1;
}

/** JS weekday of a day key: 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(key: DayKey): number {
  return new Date(dayKeyToMs(key)).getDay();
}

/** Start-of-week day key, honouring the user's week-start preference. */
export function startOfWeek(key: DayKey, weekStartsMonday: boolean): DayKey {
  const dow = weekdayOf(key);
  const offset = weekStartsMonday ? (dow + 6) % 7 : dow;
  return addDays(key, -offset);
}

/** The seven day keys of the week containing `key`. */
export function weekDays(key: DayKey, weekStartsMonday: boolean): DayKey[] {
  const start = startOfWeek(key, weekStartsMonday);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** First day key of the month containing `key`. */
export function startOfMonth(key: DayKey): DayKey {
  const [y, m] = key.split('-').map(Number);
  return `${y}-${pad(m ?? 1)}-01`;
}

/** Last day key of the month containing `key`. */
export function endOfMonth(key: DayKey): DayKey {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y ?? 1970, m ?? 1, 0);
  return toDayKey(d.getTime());
}

/** All day keys of the month containing `key`. */
export function monthDays(key: DayKey): DayKey[] {
  return dayRange(startOfMonth(key), endOfMonth(key));
}

/**
 * The 6x7 grid a month calendar renders: the month's days plus leading and
 * trailing days from adjacent months, so every row is full.
 */
export function monthGrid(key: DayKey, weekStartsMonday: boolean): DayKey[] {
  const first = startOfMonth(key);
  const gridStart = startOfWeek(first, weekStartsMonday);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Single-letter weekday headers, ordered for the user's week start. */
export function weekdayInitials(weekStartsMonday: boolean): string[] {
  const base = WEEKDAY_INITIAL;
  return weekStartsMonday ? [...base.slice(1), base[0]!] : base;
}

/** e.g. "Wed Sep 10". */
export function formatDayShort(key: DayKey): string {
  const d = new Date(dayKeyToMs(key));
  return `${WEEKDAY_SHORT[d.getDay()]} ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** e.g. "Sep 10". */
export function formatMonthDay(key: DayKey): string {
  const d = new Date(dayKeyToMs(key));
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** e.g. "September 2026". */
export function formatMonthYear(key: DayKey): string {
  const d = new Date(dayKeyToMs(key));
  const full = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${full[d.getMonth()]} ${d.getFullYear()}`;
}

/** 24-hour clock, e.g. "18:00". */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes past local midnight for an instant. Used to position calendar events. */
export function minutesIntoDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Combines a day key and minutes-past-midnight into an instant. */
export function atMinute(key: DayKey, minute: number): number {
  return dayKeyToMs(key) + minute * 60_000;
}

/**
 * Human-relative due labels, matching the design's task rows
 * ("yesterday", "5:00pm", "Wed", "Sep 20").
 */
export function formatDue(ms: number | null, now: number = Date.now()): string {
  if (ms == null) return '';
  const key = toDayKey(ms);
  const diff = daysBetween(toDayKey(now), key);
  if (diff === 0) return formatTime(ms);
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY_SHORT[new Date(ms).getDay()]!;
  if (diff < -1 && diff > -7) return `${-diff} days ago`;
  return formatMonthDay(key);
}

/** "Today" / "Yesterday" / "Mon" / "Sep 7", for journal and history lists. */
export function formatRelativeDay(key: DayKey, now: DayKey = today()): string {
  const diff = daysBetween(now, key);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0 && diff > -7) return WEEKDAY_SHORT[weekdayOf(key)]!;
  return formatMonthDay(key);
}

/** Compact duration, e.g. "62 min" or "1h 15m". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Greeting kicker for the dashboard, e.g. "WEDNESDAY - SEP 10 - 21:14". */
export function greetingKicker(ms: number = Date.now()): string {
  const d = new Date(ms);
  const day = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][
    d.getDay()
  ];
  return `${day} · ${MONTH_SHORT[d.getMonth()]!.toUpperCase()} ${d.getDate()} · ${formatTime(ms)}`;
}

/** Time-of-day greeting, e.g. "Good evening". */
export function greeting(ms: number = Date.now()): string {
  const h = new Date(ms).getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
