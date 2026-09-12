/**
 * XP, levels and ranks - the single source of truth.
 *
 * Master prompt section 31 and Development Master section 3 both require that
 * progression logic lives in exactly one place. Nothing outside this module
 * decides how much XP an action is worth or what level a total corresponds to;
 * features call `xpForTask`, `levelForXp`, etc. and never inline a number.
 *
 * The functions here are pure. They take data and return numbers, with no
 * database access, so they are cheap to unit test - which matters because a bug
 * in this file silently corrupts the user's history.
 */

import type { Habit, Priority, ReviewCadence, Task, Workout } from '../data/schema';

/* ------------------------------------------------------------------ *
 * Tuning constants
 *
 * Gathered here so the whole progression curve can be adjusted in one place
 * rather than hunted through the codebase. Changing these does not corrupt
 * history: XpEvent rows record the amount actually awarded at the time.
 * ------------------------------------------------------------------ */

export const XP = {
  /** Task XP by priority, before the effort bonus. */
  taskBase: { LOW: 10, MEDIUM: 25, HIGH: 50 } as Record<Priority, number>,
  /** Extra XP per full 15 minutes of estimated effort. */
  taskPerQuarterHour: 5,
  /** Ceiling on the effort bonus, so a wildly estimated task can't farm XP. */
  taskEffortCap: 60,
  /** Fallback when a habit has no explicit per-completion value. */
  habitDefault: 20,
  /** Habit streaks pay a bonus, capped so a long streak can't dominate. */
  streakBonusPerDay: 0.01,
  streakBonusCap: 0.5,
  milestone: 100,
  goal: 500,
  project: 300,
  workoutBase: 40,
  /** Extra XP per full 10 minutes of training. */
  workoutPerTenMinutes: 5,
  workoutCap: 120,
  journal: 15,
  review: { DAILY: 25, WEEKLY: 100, MONTHLY: 250, YEARLY: 500 } as Record<ReviewCadence, number>,

  /** Level curve: xp needed to advance FROM level n TO n+1. */
  levelBase: 300,
  levelQuadratic: 45,
  levelLinear: 200,
} as const;

/* ------------------------------------------------------------------ *
 * Award calculations
 * ------------------------------------------------------------------ */

/**
 * XP for completing a task: a priority base plus a bonus for estimated effort.
 *
 * Effort is taken from `estimatedMinutes` rather than `actualMinutes` so the
 * reward is known before the work starts - a task is not worth more because it
 * was done slowly.
 */
export function xpForTask(task: Pick<Task, 'priority' | 'estimatedMinutes'>): number {
  const base = XP.taskBase[task.priority] ?? XP.taskBase.MEDIUM;
  const minutes = Math.max(0, task.estimatedMinutes ?? 0);
  const effort = Math.min(
    XP.taskEffortCap,
    Math.floor(minutes / 15) * XP.taskPerQuarterHour,
  );
  return base + effort;
}

/**
 * XP for logging a habit, including the streak bonus.
 *
 * `streakBefore` is the streak length *before* this completion, so day one of a
 * new streak pays the base rate.
 */
export function xpForHabit(
  habit: Pick<Habit, 'xpPerCompletion'>,
  streakBefore: number,
): number {
  const base = habit.xpPerCompletion > 0 ? habit.xpPerCompletion : XP.habitDefault;
  return Math.round(base * streakMultiplier(streakBefore));
}

/** Multiplier applied to habit XP for an ongoing streak. 1.0 at streak 0. */
export function streakMultiplier(streak: number): number {
  const bonus = Math.min(XP.streakBonusCap, Math.max(0, streak) * XP.streakBonusPerDay);
  return 1 + bonus;
}

/** XP for logging a workout: a base plus a duration bonus. */
export function xpForWorkout(workout: Pick<Workout, 'durationMinutes'>): number {
  const minutes = Math.max(0, workout.durationMinutes);
  const bonus = Math.floor(minutes / 10) * XP.workoutPerTenMinutes;
  return Math.min(XP.workoutCap, XP.workoutBase + bonus);
}

export function xpForMilestone(): number {
  return XP.milestone;
}
export function xpForGoal(): number {
  return XP.goal;
}
export function xpForProject(): number {
  return XP.project;
}
export function xpForJournalEntry(): number {
  return XP.journal;
}
export function xpForReview(cadence: ReviewCadence): number {
  return XP.review[cadence];
}

/* ------------------------------------------------------------------ *
 * Level curve
 * ------------------------------------------------------------------ */

/**
 * XP required to advance from `level` to `level + 1`.
 *
 * Quadratic, so early levels come quickly and later ones represent real work.
 * Level 1 costs 300; by level 14 a level costs about 10,500.
 */
export function xpToAdvance(level: number): number {
  const n = Math.max(1, Math.floor(level));
  const k = n - 1;
  return XP.levelBase + XP.levelQuadratic * k * k + XP.levelLinear * k;
}

/** Cumulative XP required to reach `level` from zero. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < Math.max(1, Math.floor(level)); n++) total += xpToAdvance(n);
  return total;
}

/** Full progression state for a lifetime XP total. */
export interface Progression {
  level: number;
  /** XP earned inside the current level. */
  xpIntoLevel: number;
  /** XP the current level requires in total. */
  xpForLevel: number;
  /** 0-100, how far through the current level. */
  percent: number;
  totalXp: number;
  rank: Rank;
  /** The next rank up, or null at the top of the ladder. */
  nextRank: Rank | null;
  /** Levels remaining until `nextRank`. */
  levelsToNextRank: number;
}

/**
 * Resolves a lifetime XP total into level, progress and rank.
 *
 * Iterative rather than closed-form: the curve is cheap to walk (a few dozen
 * iterations at most) and an exact inverse is easy to get subtly wrong.
 */
export function levelForXp(totalXp: number): Progression {
  const xp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let remaining = xp;

  // Hard ceiling guards against an infinite loop if the curve is ever mis-tuned.
  while (level < 999) {
    const need = xpToAdvance(level);
    if (remaining < need) break;
    remaining -= need;
    level++;
  }

  const need = xpToAdvance(level);
  const rank = rankForLevel(level);
  const nextRank = nextRankAfter(rank);

  return {
    level,
    xpIntoLevel: remaining,
    xpForLevel: need,
    percent: need === 0 ? 0 : Math.round((remaining / need) * 100),
    totalXp: xp,
    rank,
    nextRank,
    levelsToNextRank: nextRank ? Math.max(0, nextRank.minLevel - level) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Rank ladder
 * ------------------------------------------------------------------ */

export interface Rank {
  title: string;
  minLevel: number;
  color: string;
  /** One line on what this rank means, shown on the progression card. */
  blurb: string;
}

/**
 * The ladder from UI/UX section 21-25, in order.
 *
 * "Failure" is the pre-start state rather than a punishment tier: it is what the
 * sidebar shows before any XP exists at all, and the user leaves it permanently
 * with their first completed task.
 */
export const RANKS: Rank[] = [
  { title: 'Failure', minLevel: 0, color: '#6A6B74', blurb: 'Nothing logged yet. One task changes that.' },
  { title: 'NPC', minLevel: 1, color: '#82838D', blurb: 'Going through the motions. Showing up counts.' },
  { title: 'Side Character', minLevel: 3, color: '#7B9AD0', blurb: 'In the story now, not just the background.' },
  { title: 'Rookie', minLevel: 6, color: '#4C6FAE', blurb: 'The habits are forming. Keep them cheap to keep.' },
  { title: 'Novice', minLevel: 9, color: '#9E7BB0', blurb: 'Consistency is the skill you are building.' },
  { title: 'Contender', minLevel: 13, color: '#D4708A', blurb: 'You are in the fight for the goals you set.' },
  { title: 'Champion', minLevel: 18, color: '#9E304A', blurb: 'The system runs you as much as you run it.' },
  { title: 'Final Boss', minLevel: 25, color: '#C23A54', blurb: 'Your own standard is the hardest one left.' },
  { title: 'Main Character', minLevel: 35, color: '#E0637A', blurb: 'The identity is the default now.' },
];

/** The rank a level falls into. */
export function rankForLevel(level: number): Rank {
  let current = RANKS[0]!;
  for (const rank of RANKS) {
    if (level >= rank.minLevel) current = rank;
    else break;
  }
  return current;
}

/** The rank above `rank`, or null at the top. */
export function nextRankAfter(rank: Rank): Rank | null {
  const i = RANKS.findIndex((r) => r.title === rank.title);
  return i >= 0 && i < RANKS.length - 1 ? RANKS[i + 1]! : null;
}

/**
 * Whether crossing from `beforeXp` to `afterXp` triggered a level-up, and
 * whether it also crossed a rank boundary. Drives the level-up and rank-up
 * celebrations without either of them guessing.
 */
export function progressionDelta(
  beforeXp: number,
  afterXp: number,
): { leveledUp: boolean; rankedUp: boolean; from: Progression; to: Progression } {
  const from = levelForXp(beforeXp);
  const to = levelForXp(afterXp);
  return {
    leveledUp: to.level > from.level,
    rankedUp: to.rank.title !== from.rank.title,
    from,
    to,
  };
}
