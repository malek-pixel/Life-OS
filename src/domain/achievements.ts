/**
 * Achievement definitions and evaluation.
 *
 * Master prompt section 32: evaluation is deterministic and based on actual
 * data, never on UI events, and duplicate unlocks are impossible.
 *
 * Two consequences of that, both deliberate:
 *
 *  - `evaluate()` takes an aggregate stats object computed from stored rows and
 *    returns the ids that *should* be unlocked. It never inspects a click.
 *  - It returns only ids not already present in `unlocked`, so calling it twice
 *    with the same data yields nothing the second time. Unlock rows are written
 *    once and never rewritten, so the unlock date stays true.
 */

import type { AchievementDef, AchievementUnlock, LifeArea } from '../data/schema';

/**
 * The achievement catalogue.
 *
 * Seeded definitions rather than user data: they describe the game, so they
 * live in code and ship with the app. Only the *unlocks* are stored.
 * The first eight mirror the design's achievement grid.
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-blood',
    name: 'First Blood',
    description: 'Complete your first task',
    glyph: '◆',
    color: '#D4708A',
    tier: 'BRONZE',
    xpReward: 50,
    rule: { kind: 'TASKS_COMPLETED', count: 1 },
  },
  {
    id: 'streak-keeper',
    name: 'Streak Keeper',
    description: 'Hold a 30-day habit streak',
    glyph: '▲',
    color: '#7BB08A',
    tier: 'SILVER',
    xpReward: 250,
    rule: { kind: 'HABIT_STREAK', days: 30 },
  },
  {
    id: 'deep-worker',
    name: 'Deep Worker',
    description: 'Log 100 hours of focused work',
    glyph: '●',
    color: '#4C6FAE',
    tier: 'GOLD',
    xpReward: 500,
    rule: { kind: 'FOCUS_HOURS', hours: 100 },
  },
  {
    id: 'iron-will',
    name: 'Iron Will',
    description: 'Log 50 training sessions',
    glyph: '■',
    color: '#C25B72',
    tier: 'SILVER',
    xpReward: 250,
    rule: { kind: 'WORKOUTS_LOGGED', count: 50 },
  },
  {
    id: 'scholar',
    name: 'Scholar',
    description: 'Complete an Education goal',
    glyph: '◆',
    color: '#7B9AD0',
    tier: 'GOLD',
    xpReward: 400,
    rule: { kind: 'GOAL_COMPLETED', count: 1, area: 'Education' },
  },
  {
    id: 'century',
    name: 'Century',
    description: 'Complete 100 tasks',
    glyph: '▲',
    color: '#9E304A',
    tier: 'SILVER',
    xpReward: 300,
    rule: { kind: 'TASKS_COMPLETED', count: 100 },
  },
  {
    id: 'architect',
    name: 'Architect',
    description: 'Ship a full project',
    glyph: '●',
    color: '#C23A54',
    tier: 'GOLD',
    xpReward: 400,
    rule: { kind: 'PROJECT_COMPLETED', count: 1 },
  },
  {
    id: 'reflective',
    name: 'Reflective',
    description: 'Write 30 journal entries',
    glyph: '■',
    color: '#9E7BB0',
    tier: 'SILVER',
    xpReward: 250,
    rule: { kind: 'JOURNAL_ENTRIES', count: 30 },
  },
  {
    id: 'first-quest',
    name: 'Quest Taker',
    description: 'Complete your first quest',
    glyph: '◆',
    color: '#D4708A',
    tier: 'BRONZE',
    xpReward: 100,
    rule: { kind: 'QUEST_COMPLETED', count: 1 },
  },
  {
    id: 'contender',
    name: 'Contender',
    description: 'Reach level 13',
    glyph: '▲',
    color: '#D4708A',
    tier: 'GOLD',
    xpReward: 500,
    rule: { kind: 'LEVEL_REACHED', level: 13 },
  },
  {
    id: 'unbroken',
    name: 'Unbroken',
    description: 'Hold a 100-day habit streak',
    glyph: '●',
    color: '#E0637A',
    tier: 'LEGENDARY',
    xpReward: 1000,
    rule: { kind: 'HABIT_STREAK', days: 100 },
  },
  {
    id: 'main-character',
    name: 'Main Character',
    description: 'Reach level 35',
    glyph: '■',
    color: '#E0637A',
    tier: 'LEGENDARY',
    xpReward: 2000,
    rule: { kind: 'LEVEL_REACHED', level: 35 },
  },
];

export const ACHIEVEMENTS_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/**
 * Everything the rules need, computed once from stored rows.
 *
 * Passing a snapshot rather than the whole database keeps `evaluate` pure and
 * makes it trivial to test: build a stats object, assert the unlocks.
 */
export interface AchievementStats {
  tasksCompleted: number;
  /** The longest streak currently held by any habit. */
  bestHabitStreak: number;
  journalEntries: number;
  workoutsLogged: number;
  /** Total logged focus time, in hours. */
  focusHours: number;
  goalsCompleted: number;
  goalsCompletedByArea: Record<string, number>;
  projectsCompleted: number;
  questsCompleted: number;
  level: number;
}

export function emptyStats(): AchievementStats {
  return {
    tasksCompleted: 0,
    bestHabitStreak: 0,
    journalEntries: 0,
    workoutsLogged: 0,
    focusHours: 0,
    goalsCompleted: 0,
    goalsCompletedByArea: {},
    projectsCompleted: 0,
    questsCompleted: 0,
    level: 1,
  };
}

/** Whether a single rule is satisfied by the current stats. */
export function isSatisfied(rule: AchievementDef['rule'], stats: AchievementStats): boolean {
  switch (rule.kind) {
    case 'TASKS_COMPLETED':
      return stats.tasksCompleted >= rule.count;
    case 'HABIT_STREAK':
      return stats.bestHabitStreak >= rule.days;
    case 'JOURNAL_ENTRIES':
      return stats.journalEntries >= rule.count;
    case 'WORKOUTS_LOGGED':
      return stats.workoutsLogged >= rule.count;
    case 'FOCUS_HOURS':
      return stats.focusHours >= rule.hours;
    case 'GOAL_COMPLETED':
      return rule.area
        ? (stats.goalsCompletedByArea[rule.area] ?? 0) >= rule.count
        : stats.goalsCompleted >= rule.count;
    case 'PROJECT_COMPLETED':
      return stats.projectsCompleted >= rule.count;
    case 'LEVEL_REACHED':
      return stats.level >= rule.level;
    case 'QUEST_COMPLETED':
      return stats.questsCompleted >= rule.count;
    default:
      return false;
  }
}

/**
 * Ids that have just become eligible.
 *
 * Already-unlocked achievements are filtered out, which is what makes repeated
 * evaluation safe: the same stats produce an unlock exactly once.
 */
export function evaluate(stats: AchievementStats, unlocked: AchievementUnlock[]): string[] {
  const have = new Set(unlocked.filter((u) => u.deletedAt == null).map((u) => u.achievementId));
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && isSatisfied(a.rule, stats)).map((a) => a.id);
}

/**
 * How close an unearned achievement is, as 0-100.
 *
 * Used for the progress hint on locked cards - real progress against the real
 * rule, not decoration.
 */
export function ruleProgress(rule: AchievementDef['rule'], stats: AchievementStats): number {
  const pct = (have: number, need: number) =>
    need <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((have / need) * 100)));

  switch (rule.kind) {
    case 'TASKS_COMPLETED':
      return pct(stats.tasksCompleted, rule.count);
    case 'HABIT_STREAK':
      return pct(stats.bestHabitStreak, rule.days);
    case 'JOURNAL_ENTRIES':
      return pct(stats.journalEntries, rule.count);
    case 'WORKOUTS_LOGGED':
      return pct(stats.workoutsLogged, rule.count);
    case 'FOCUS_HOURS':
      return pct(stats.focusHours, rule.hours);
    case 'GOAL_COMPLETED':
      return pct(
        rule.area ? (stats.goalsCompletedByArea[rule.area] ?? 0) : stats.goalsCompleted,
        rule.count,
      );
    case 'PROJECT_COMPLETED':
      return pct(stats.projectsCompleted, rule.count);
    case 'LEVEL_REACHED':
      return pct(stats.level, rule.level);
    case 'QUEST_COMPLETED':
      return pct(stats.questsCompleted, rule.count);
    default:
      return 0;
  }
}

/** Human-readable "3 / 30" style progress for a locked achievement. */
export function ruleProgressLabel(
  rule: AchievementDef['rule'],
  stats: AchievementStats,
): string {
  switch (rule.kind) {
    case 'TASKS_COMPLETED':
      return `${stats.tasksCompleted} / ${rule.count} tasks`;
    case 'HABIT_STREAK':
      return `${stats.bestHabitStreak} / ${rule.days} days`;
    case 'JOURNAL_ENTRIES':
      return `${stats.journalEntries} / ${rule.count} entries`;
    case 'WORKOUTS_LOGGED':
      return `${stats.workoutsLogged} / ${rule.count} sessions`;
    case 'FOCUS_HOURS':
      return `${Math.round(stats.focusHours)} / ${rule.hours} hours`;
    case 'GOAL_COMPLETED':
      return `${rule.area ? (stats.goalsCompletedByArea[rule.area] ?? 0) : stats.goalsCompleted} / ${rule.count} goals`;
    case 'PROJECT_COMPLETED':
      return `${stats.projectsCompleted} / ${rule.count} projects`;
    case 'LEVEL_REACHED':
      return `Level ${stats.level} / ${rule.level}`;
    case 'QUEST_COMPLETED':
      return `${stats.questsCompleted} / ${rule.count} quests`;
    default:
      return '';
  }
}

export const TIER_ORDER: Record<AchievementDef['tier'], number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  LEGENDARY: 3,
};

export type { LifeArea };
