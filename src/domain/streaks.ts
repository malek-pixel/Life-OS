/**
 * Habit streak and completion maths.
 *
 * TECHNICAL_SPECIFICATION section 6 is explicit: streak and completion-rate
 * numbers are computed deterministically from HabitLog rows and are never
 * stored as the only copy of a derived value. Everything here takes logs in and
 * returns numbers out, so a streak can always be recomputed from source and an
 * incorrect cached value can never become the truth.
 *
 * The semantics, stated once so the UI never has to guess:
 *
 *  - A day is "due" only if the habit schedules it. DAILY schedules every day;
 *    CUSTOM schedules the listed weekdays; WEEKLY is counted in whole weeks.
 *  - An unscheduled day neither extends nor breaks a streak - it is skipped.
 *  - Today never breaks a streak. The day is not over yet, so an unlogged today
 *    is pending, not a miss. This is why `currentStreak` starts at yesterday
 *    when today is unlogged.
 *  - A protected day (UI/UX section 15, streak protection) is treated as met for
 *    streak purposes but is not counted as a completion in the rate.
 *  - Days before the habit started are outside its history entirely.
 */

import type { Habit, HabitLog } from '../data/schema';
import {
  addDays,
  dayRange,
  daysBetween,
  toDayKey,
  today as todayKey,
  weekdayOf,
  startOfWeek,
  type DayKey,
} from './dates';

/** A habit's logs indexed by day, for O(1) lookup while walking backwards. */
export type LogIndex = Map<DayKey, HabitLog>;

/** Builds the day index for one habit. Later rows win if a day is duplicated. */
export function indexLogs(logs: HabitLog[]): LogIndex {
  const map: LogIndex = new Map();
  for (const log of logs) {
    if (log.deletedAt) continue;
    const existing = map.get(log.date);
    if (!existing || existing.updatedAt <= log.updatedAt) map.set(log.date, log);
  }
  return map;
}

/** Whether the habit schedules this day at all. */
export function isDueOn(habit: Habit, day: DayKey): boolean {
  if (daysBetween(toDayKey(habit.startDate), day) < 0) return false;
  if (habit.endDate != null && daysBetween(toDayKey(habit.endDate), day) > 0) return false;

  switch (habit.frequency) {
    case 'DAILY':
      return true;
    case 'CUSTOM':
      return habit.weekdays.includes(weekdayOf(day));
    case 'WEEKLY':
      // Weekly habits have no single due day; any day in the week can satisfy
      // them, so every in-range day is a candidate.
      return true;
    default:
      return false;
  }
}

/** Whether a day's log counts as satisfying the habit. */
export function isMetOn(index: LogIndex, day: DayKey): boolean {
  const log = index.get(day);
  return !!log && (log.completed || log.protected);
}

/** Whether a day was genuinely completed (protection does not count). */
export function isCompletedOn(index: LogIndex, day: DayKey): boolean {
  const log = index.get(day);
  return !!log && log.completed;
}

export interface StreakResult {
  /** Days (or weeks, for WEEKLY habits) currently unbroken. */
  current: number;
  /** The longest run ever achieved. */
  longest: number;
  /** True when today is scheduled and not yet logged. */
  pendingToday: boolean;
  /** Protections spent inside the current streak. */
  protectionsUsed: number;
}

/**
 * Current and longest streak for a habit.
 *
 * Walks backwards from today for the current streak and forwards across the
 * whole history for the longest, both skipping unscheduled days.
 */
export function calculateStreak(
  habit: Habit,
  logs: HabitLog[],
  today: DayKey = todayKey(),
): StreakResult {
  if (habit.frequency === 'WEEKLY') return calculateWeeklyStreak(habit, logs, today);

  const index = indexLogs(logs);
  const start = toDayKey(habit.startDate);

  const pendingToday = isDueOn(habit, today) && !index.has(today);

  /* --- current streak: walk back from today --- */
  let current = 0;
  let protectionsUsed = 0;
  let cursor = today;

  // Today being unlogged is pending, not a miss - start from yesterday instead.
  if (pendingToday) cursor = addDays(today, -1);

  while (daysBetween(start, cursor) >= 0) {
    if (!isDueOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!isMetOn(index, cursor)) break;
    current++;
    if (index.get(cursor)?.protected) protectionsUsed++;
    cursor = addDays(cursor, -1);
  }

  /* --- longest streak: sweep the full history --- */
  let longest = 0;
  let run = 0;
  const end = today;
  if (daysBetween(start, end) >= 0) {
    for (const day of dayRange(start, end)) {
      if (!isDueOn(habit, day)) continue;
      // An unlogged today must not truncate the historical best.
      if (day === today && pendingToday) continue;
      if (isMetOn(index, day)) {
        run++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
  }

  return { current, longest: Math.max(longest, current), pendingToday, protectionsUsed };
}

/**
 * Weekly habits streak in whole weeks: a week counts when the number of
 * completions in it reaches the habit's target.
 */
function calculateWeeklyStreak(
  habit: Habit,
  logs: HabitLog[],
  today: DayKey,
): StreakResult {
  const index = indexLogs(logs);
  const target = Math.max(1, habit.target);
  const thisWeekStart = startOfWeek(today, true);
  const startWeek = startOfWeek(toDayKey(habit.startDate), true);

  const completionsInWeek = (weekStart: DayKey): number => {
    let n = 0;
    for (let i = 0; i < 7; i++) if (isMetOn(index, addDays(weekStart, i))) n++;
    return n;
  };

  const currentWeekCount = completionsInWeek(thisWeekStart);
  const pendingToday = currentWeekCount < target;

  let current = 0;
  let cursor = pendingToday ? addDays(thisWeekStart, -7) : thisWeekStart;
  while (daysBetween(startWeek, cursor) >= 0) {
    if (completionsInWeek(cursor) < target) break;
    current++;
    cursor = addDays(cursor, -7);
  }

  let longest = 0;
  let run = 0;
  for (let w = startWeek; daysBetween(w, thisWeekStart) >= 0; w = addDays(w, 7)) {
    if (w === thisWeekStart && pendingToday) continue;
    if (completionsInWeek(w) >= target) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  return {
    current,
    longest: Math.max(longest, current),
    pendingToday,
    protectionsUsed: 0,
  };
}

/**
 * Completion rate over the last `days` scheduled days, as 0-100.
 *
 * Only scheduled days count in the denominator, so a three-days-a-week habit is
 * not penalised for the four days it was never meant to run. Protected days are
 * excluded from both sides: they are neither a success nor a failure.
 */
export function completionRate(
  habit: Habit,
  logs: HabitLog[],
  days: number,
  today: DayKey = todayKey(),
): number {
  const index = indexLogs(logs);
  const from = addDays(today, -(days - 1));
  let due = 0;
  let done = 0;

  for (const day of dayRange(from, today)) {
    if (!isDueOn(habit, day)) continue;
    if (index.get(day)?.protected) continue;
    // An unlogged today is still pending, so it does not count against the rate.
    if (day === today && !index.has(day)) continue;
    due++;
    if (isCompletedOn(index, day)) done++;
  }

  return due === 0 ? 0 : Math.round((done / due) * 100);
}

/** Per-day state for the seven-square week strip in the habits list. */
export type DayState = 'done' | 'missed' | 'protected' | 'future' | 'off';

/**
 * The week strip for one habit, ordered by the user's week start.
 *
 * 'future' covers both later days this week and today-not-yet-logged, because
 * the design draws both as a neutral square rather than a miss.
 */
export function weekStrip(
  habit: Habit,
  logs: HabitLog[],
  days: DayKey[],
  today: DayKey = todayKey(),
): Array<{ day: DayKey; state: DayState }> {
  const index = indexLogs(logs);
  return days.map((day) => {
    if (!isDueOn(habit, day)) return { day, state: 'off' as DayState };
    const log = index.get(day);
    if (log?.protected) return { day, state: 'protected' as DayState };
    if (log?.completed) return { day, state: 'done' as DayState };
    if (daysBetween(today, day) >= 0) return { day, state: 'future' as DayState };
    return { day, state: 'missed' as DayState };
  });
}

/**
 * The streak a completion on `day` would build on - i.e. the streak as it stood
 * the day before. Used to price the XP award before the log is written.
 */
export function streakBefore(habit: Habit, logs: HabitLog[], day: DayKey): number {
  const yesterday = addDays(day, -1);
  if (daysBetween(toDayKey(habit.startDate), yesterday) < 0) return 0;
  return calculateStreak(habit, logs, yesterday).current;
}

/**
 * Habits whose streak is at risk: scheduled today, not yet logged, and carrying
 * a streak worth protecting. Drives the habit nudge in notifications.
 */
export function atRiskHabits(
  entries: Array<{ habit: Habit; logs: HabitLog[] }>,
  today: DayKey = todayKey(),
): Array<{ habit: Habit; streak: number }> {
  const out: Array<{ habit: Habit; streak: number }> = [];
  for (const { habit, logs } of entries) {
    if (habit.status !== 'ACTIVE') continue;
    const result = calculateStreak(habit, logs, today);
    if (result.pendingToday && result.current > 0) {
      out.push({ habit, streak: result.current });
    }
  }
  return out.sort((a, b) => b.streak - a.streak);
}
