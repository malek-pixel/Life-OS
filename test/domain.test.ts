/**
 * Unit tests for the calculations that silently corrupt data if wrong.
 *
 * TECHNICAL_SPECIFICATION section 16 names these as the top testing priority:
 * streak calculation, XP calculation, goal progress rollup, and recurrence
 * expansion. Everything covered here is pure, so the tests are fast and exact.
 */

import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayRange,
  daysBetween,
  formatDue,
  monthGrid,
  startOfWeek,
  toDayKey,
  weekDays,
} from '../src/domain/dates';
import {
  levelForXp,
  progressionDelta,
  rankForLevel,
  streakMultiplier,
  xpForHabit,
  xpForTask,
  xpForWorkout,
  xpToAdvance,
} from '../src/domain/xp';
import {
  atRiskHabits,
  calculateStreak,
  completionRate,
  streakBefore,
  weekStrip,
} from '../src/domain/streaks';
import {
  clampPercent,
  goalProgress,
  health,
  projectProgress,
  subtaskProgress,
  wouldCreateCycle,
} from '../src/domain/progress';
import type {
  Goal,
  Habit,
  HabitLog,
  Milestone,
  Project,
  Task,
} from '../src/data/schema';

/* ------------------------------------------------------------------ *
 * Builders - keep the tests about behaviour, not object literals
 * ------------------------------------------------------------------ */

const base = (id: string) => ({
  id,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
});

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    ...base(over.id ?? 'h1'),
    title: 'Read 20 minutes',
    description: '',
    identity: 'Reader',
    area: 'Mind',
    frequency: 'DAILY',
    target: 1,
    weekdays: [],
    startDate: new Date(2026, 0, 1).getTime(),
    endDate: null,
    status: 'ACTIVE',
    protectionAllowance: 1,
    xpPerCompletion: 20,
    ...over,
  } as Habit;
}

function makeLog(date: string, over: Partial<HabitLog> = {}): HabitLog {
  return {
    ...base(`log-${date}-${over.habitId ?? 'h1'}`),
    habitId: 'h1',
    date,
    completed: true,
    value: null,
    protected: false,
    note: '',
    ...over,
  } as HabitLog;
}

function makeTask(over: Partial<Task> = {}): Task {
  return {
    ...base(over.id ?? 't1'),
    projectId: null,
    goalId: null,
    parentTaskId: null,
    habitId: null,
    title: 'Task',
    description: '',
    status: 'TODO',
    priority: 'MEDIUM',
    dueAt: null,
    completedAt: null,
    estimatedMinutes: null,
    actualMinutes: null,
    recurrenceRule: null,
    recurrenceParentId: null,
    orderIndex: 0,
    ...over,
  } as Task;
}

function makeProject(over: Partial<Project> = {}): Project {
  return {
    ...base(over.id ?? 'p1'),
    goalId: null,
    title: 'Project',
    description: '',
    area: 'Projects',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    startDate: null,
    deadline: null,
    progressOverride: null,
    completedAt: null,
    ...over,
  } as Project;
}

function makeMilestone(over: Partial<Milestone> = {}): Milestone {
  return {
    ...base(over.id ?? 'm1'),
    projectId: 'p1',
    title: 'Milestone',
    description: '',
    targetDate: null,
    status: 'PENDING',
    completedAt: null,
    orderIndex: 0,
    ...over,
  } as Milestone;
}

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    ...base(over.id ?? 'g1'),
    title: 'Goal',
    description: '',
    area: 'Education',
    status: 'ACTIVE',
    priority: 'HIGH',
    startDate: null,
    targetDate: null,
    progressType: 'ROLLUP',
    progressValue: 0,
    targetValue: null,
    unit: null,
    completedAt: null,
    ...over,
  } as Goal;
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

describe('dates', () => {
  it('round-trips a day key through milliseconds', () => {
    const key = '2026-09-10';
    expect(toDayKey(new Date(2026, 8, 10, 13, 45).getTime())).toBe(key);
  });

  it('counts whole days between keys, signed', () => {
    expect(daysBetween('2026-09-10', '2026-09-12')).toBe(2);
    expect(daysBetween('2026-09-12', '2026-09-10')).toBe(-2);
    expect(daysBetween('2026-09-10', '2026-09-10')).toBe(0);
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
  });

  it('starts the week on the configured day', () => {
    // 2026-09-10 is a Thursday.
    expect(startOfWeek('2026-09-10', true)).toBe('2026-09-07'); // Monday
    expect(startOfWeek('2026-09-10', false)).toBe('2026-09-06'); // Sunday
  });

  it('returns seven days for a week and a full 6x7 month grid', () => {
    expect(weekDays('2026-09-10', true)).toHaveLength(7);
    const grid = monthGrid('2026-09-10', true);
    expect(grid).toHaveLength(42);
    expect(grid).toContain('2026-09-10');
  });

  it('builds an inclusive day range', () => {
    expect(dayRange('2026-09-10', '2026-09-12')).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
  });

  it('labels due dates relative to now', () => {
    const now = new Date(2026, 8, 10, 12, 0).getTime();
    expect(formatDue(new Date(2026, 8, 9, 12, 0).getTime(), now)).toBe('yesterday');
    expect(formatDue(new Date(2026, 8, 11, 12, 0).getTime(), now)).toBe('tomorrow');
    expect(formatDue(null, now)).toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * XP, levels, ranks
 * ------------------------------------------------------------------ */

describe('xp', () => {
  it('prices tasks by priority', () => {
    expect(xpForTask({ priority: 'LOW', estimatedMinutes: null })).toBe(10);
    expect(xpForTask({ priority: 'MEDIUM', estimatedMinutes: null })).toBe(25);
    expect(xpForTask({ priority: 'HIGH', estimatedMinutes: null })).toBe(50);
  });

  it('adds an effort bonus per full quarter hour, capped', () => {
    expect(xpForTask({ priority: 'LOW', estimatedMinutes: 30 })).toBe(20);
    expect(xpForTask({ priority: 'LOW', estimatedMinutes: 29 })).toBe(15);
    // 10 hours would be 200 of bonus; the cap holds it at 60.
    expect(xpForTask({ priority: 'LOW', estimatedMinutes: 600 })).toBe(70);
  });

  it('never pays negative XP for nonsense input', () => {
    expect(xpForTask({ priority: 'MEDIUM', estimatedMinutes: -100 })).toBe(25);
  });

  it('scales habit XP with the prior streak, capped at +50%', () => {
    const h = { xpPerCompletion: 20 };
    expect(xpForHabit(h, 0)).toBe(20);
    expect(xpForHabit(h, 10)).toBe(22);
    expect(streakMultiplier(1000)).toBe(1.5);
    expect(xpForHabit(h, 1000)).toBe(30);
  });

  it('caps workout XP', () => {
    expect(xpForWorkout({ durationMinutes: 0 })).toBe(40);
    expect(xpForWorkout({ durationMinutes: 60 })).toBe(70);
    expect(xpForWorkout({ durationMinutes: 10_000 })).toBe(120);
  });

  it('makes each level cost more than the last', () => {
    for (let n = 1; n < 40; n++) {
      expect(xpToAdvance(n + 1)).toBeGreaterThan(xpToAdvance(n));
    }
  });

  it('resolves zero XP to level 1 with nothing banked', () => {
    const p = levelForXp(0);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(0);
    expect(p.percent).toBe(0);
  });

  it('levels up exactly at the threshold, not before', () => {
    const need = xpToAdvance(1);
    expect(levelForXp(need - 1).level).toBe(1);
    expect(levelForXp(need).level).toBe(2);
    expect(levelForXp(need).xpIntoLevel).toBe(0);
  });

  it('keeps level and remainder self-consistent across the curve', () => {
    for (const xp of [0, 1, 299, 300, 5_000, 10_500, 50_000, 1_000_000]) {
      const p = levelForXp(xp);
      expect(p.xpIntoLevel).toBeGreaterThanOrEqual(0);
      expect(p.xpIntoLevel).toBeLessThan(p.xpForLevel);
      expect(p.percent).toBeGreaterThanOrEqual(0);
      expect(p.percent).toBeLessThanOrEqual(100);
    }
  });

  it('treats negative XP as zero rather than throwing', () => {
    expect(levelForXp(-500).level).toBe(1);
  });

  it('walks the rank ladder in order', () => {
    expect(rankForLevel(0).title).toBe('Failure');
    expect(rankForLevel(1).title).toBe('NPC');
    expect(rankForLevel(6).title).toBe('Rookie');
    expect(rankForLevel(14).title).toBe('Contender');
    expect(rankForLevel(999).title).toBe('Main Character');
  });

  it('reports a level-up and a rank-up when a threshold is crossed', () => {
    const need = xpToAdvance(1);
    const d = progressionDelta(need - 10, need + 10);
    expect(d.leveledUp).toBe(true);
    expect(d.from.level).toBe(1);
    expect(d.to.level).toBe(2);

    const flat = progressionDelta(10, 20);
    expect(flat.leveledUp).toBe(false);
    expect(flat.rankedUp).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Streaks
 * ------------------------------------------------------------------ */

describe('streaks', () => {
  const today = '2026-09-10';

  it('counts consecutive completed days ending today', () => {
    const habit = makeHabit();
    const logs = ['2026-09-08', '2026-09-09', '2026-09-10'].map((d) => makeLog(d));
    expect(calculateStreak(habit, logs, today).current).toBe(3);
  });

  it('does not break the streak when today is simply not logged yet', () => {
    const habit = makeHabit();
    const logs = ['2026-09-08', '2026-09-09'].map((d) => makeLog(d));
    const r = calculateStreak(habit, logs, today);
    expect(r.current).toBe(2);
    expect(r.pendingToday).toBe(true);
  });

  it('breaks the streak on a genuine missed day', () => {
    const habit = makeHabit();
    // 09-09 missing entirely, so the run ends there.
    const logs = ['2026-09-07', '2026-09-08', '2026-09-10'].map((d) => makeLog(d));
    expect(calculateStreak(habit, logs, today).current).toBe(1);
  });

  it('treats an explicit not-completed log as a miss', () => {
    const habit = makeHabit();
    const logs = [
      makeLog('2026-09-09', { completed: false }),
      makeLog('2026-09-10'),
    ];
    expect(calculateStreak(habit, logs, today).current).toBe(1);
  });

  it('bridges a gap with a streak protection', () => {
    const habit = makeHabit();
    const logs = [
      makeLog('2026-09-08'),
      makeLog('2026-09-09', { completed: false, protected: true }),
      makeLog('2026-09-10'),
    ];
    const r = calculateStreak(habit, logs, today);
    expect(r.current).toBe(3);
    expect(r.protectionsUsed).toBe(1);
  });

  it('remembers the longest run even after it is broken', () => {
    const habit = makeHabit();
    const logs = [
      ...dayRange('2026-09-01', '2026-09-05').map((d) => makeLog(d)),
      // 09-06 .. 09-09 missed
      makeLog('2026-09-10'),
    ];
    const r = calculateStreak(habit, logs, today);
    expect(r.current).toBe(1);
    expect(r.longest).toBe(5);
  });

  it('skips unscheduled weekdays for a custom habit', () => {
    // Mondays (1) and Wednesdays (3) only.
    const habit = makeHabit({ frequency: 'CUSTOM', weekdays: [1, 3] });
    // 2026-09-07 Mon, 09-09 Wed - the untouched days between must not break it.
    const logs = [makeLog('2026-09-07'), makeLog('2026-09-09')];
    expect(calculateStreak(habit, logs, '2026-09-09').current).toBe(2);
  });

  it('ignores days before the habit started', () => {
    const habit = makeHabit({ startDate: new Date(2026, 8, 9).getTime() });
    const logs = [makeLog('2026-09-09'), makeLog('2026-09-10')];
    const r = calculateStreak(habit, logs, today);
    expect(r.current).toBe(2);
    expect(r.longest).toBe(2);
  });

  it('counts weekly habits in whole weeks against their target', () => {
    const habit = makeHabit({ frequency: 'WEEKLY', target: 3 });
    const logs = [
      // week of Aug 31 - three completions, satisfied
      makeLog('2026-08-31'), makeLog('2026-09-02'), makeLog('2026-09-04'),
      // week of Sep 7 - three completions, satisfied
      makeLog('2026-09-07'), makeLog('2026-09-08'), makeLog('2026-09-09'),
    ];
    expect(calculateStreak(habit, logs, today).current).toBe(2);
  });

  it('does not count an unfinished weekly target as a broken streak', () => {
    const habit = makeHabit({ frequency: 'WEEKLY', target: 3 });
    const logs = [
      makeLog('2026-08-31'), makeLog('2026-09-02'), makeLog('2026-09-04'),
      makeLog('2026-09-07'), // only one so far this week
    ];
    const r = calculateStreak(habit, logs, today);
    expect(r.current).toBe(1);
    expect(r.pendingToday).toBe(true);
  });

  it('computes a completion rate over scheduled days only', () => {
    const habit = makeHabit();
    // 7-day window ending today; 5 completed, today pending and excluded.
    const logs = dayRange('2026-09-04', '2026-09-08').map((d) => makeLog(d));
    // Window 09-04..09-10: due 09-04..09-09 (today excluded) = 6 days, 5 done.
    expect(completionRate(habit, logs, 7, today)).toBe(83);
  });

  it('reports a zero rate rather than NaN when nothing is due', () => {
    const habit = makeHabit({ startDate: new Date(2027, 0, 1).getTime() });
    expect(completionRate(habit, [], 7, today)).toBe(0);
  });

  it('prices a completion off the streak as it stood yesterday', () => {
    const habit = makeHabit();
    const logs = ['2026-09-08', '2026-09-09'].map((d) => makeLog(d));
    expect(streakBefore(habit, logs, today)).toBe(2);
  });

  it('marks week-strip days as done, missed or future', () => {
    const habit = makeHabit();
    const logs = [makeLog('2026-09-07'), makeLog('2026-09-09')];
    const strip = weekStrip(habit, logs, weekDays(today, true), today);
    const states = strip.map((s) => s.state);
    expect(states[0]).toBe('done'); // Mon 09-07
    expect(states[1]).toBe('missed'); // Tue 09-08
    expect(states[2]).toBe('done'); // Wed 09-09
    expect(states[3]).toBe('future'); // Thu 09-10 = today, unlogged
    expect(states[6]).toBe('future');
  });

  it('flags habits whose streak is at risk today', () => {
    const kept = makeHabit({ id: 'h1' });
    const logs = ['2026-09-08', '2026-09-09'].map((d) => makeLog(d));
    const risk = atRiskHabits([{ habit: kept, logs }], today);
    expect(risk).toHaveLength(1);
    expect(risk[0]!.streak).toBe(2);
  });

  it('does not flag a habit with no streak to lose', () => {
    expect(atRiskHabits([{ habit: makeHabit(), logs: [] }], today)).toHaveLength(0);
  });

  it('ignores soft-deleted logs', () => {
    const habit = makeHabit();
    const logs = [
      makeLog('2026-09-09'),
      makeLog('2026-09-10', { deletedAt: Date.now() }),
    ];
    expect(calculateStreak(habit, logs, today).current).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

describe('progress', () => {
  it('clamps percentages into range', () => {
    expect(clampPercent(-20)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(33.6)).toBe(34);
  });

  it('reports an empty project as 0 rather than NaN', () => {
    const p = projectProgress(makeProject(), [], []);
    expect(p.percent).toBe(0);
    expect(p.source).toBe('empty');
  });

  it('derives project progress from tasks alone', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'COMPLETED' }),
      makeTask({ id: 'b' }),
      makeTask({ id: 'c' }),
      makeTask({ id: 'd' }),
    ];
    const p = projectProgress(makeProject(), tasks, []);
    expect(p.percent).toBe(25);
    expect(p.source).toBe('tasks');
  });

  it('blends milestones and tasks 60/40', () => {
    const tasks = [makeTask({ id: 'a', status: 'COMPLETED' }), makeTask({ id: 'b' })];
    const milestones = [
      makeMilestone({ id: 'm1', status: 'COMPLETED' }),
      makeMilestone({ id: 'm2' }),
      makeMilestone({ id: 'm3' }),
      makeMilestone({ id: 'm4' }),
    ];
    // milestones 25% * .6 + tasks 50% * .4 = 15 + 20 = 35
    expect(projectProgress(makeProject(), tasks, milestones).percent).toBe(35);
  });

  it('lets a manual override win', () => {
    const tasks = [makeTask({ status: 'COMPLETED' })];
    const p = projectProgress(makeProject({ progressOverride: 40 }), tasks, []);
    expect(p.percent).toBe(40);
    expect(p.source).toBe('override');
  });

  it('reads a completed project as 100 regardless of leftover tasks', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    expect(projectProgress(makeProject({ status: 'COMPLETED' }), tasks, []).percent).toBe(100);
  });

  it('excludes soft-deleted and archived tasks from the denominator', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'COMPLETED' }),
      makeTask({ id: 'b', deletedAt: Date.now() }),
      makeTask({ id: 'c', status: 'ARCHIVED' }),
    ];
    expect(projectProgress(makeProject(), tasks, []).percent).toBe(100);
  });

  it('computes numeric goal progress against its target', () => {
    const goal = makeGoal({ progressType: 'NUMERIC', progressValue: 92.5, targetValue: 100, unit: 'kg' });
    const p = goalProgress(goal, [], [], new Map(), new Map());
    expect(p.percent).toBe(93);
    expect(p.source).toBe('numeric');
  });

  it('does not divide by zero on a numeric goal with no target', () => {
    const goal = makeGoal({ progressType: 'NUMERIC', progressValue: 50, targetValue: 0 });
    expect(goalProgress(goal, [], [], new Map(), new Map()).percent).toBe(0);
  });

  it('rolls a goal up from its projects, weighted by size', () => {
    const goal = makeGoal();
    const project = makeProject({ id: 'p1', goalId: 'g1' });
    const tasksByProject = new Map([
      ['p1', [makeTask({ id: 'a', status: 'COMPLETED' }), makeTask({ id: 'b' })]],
    ]);
    const p = goalProgress(goal, [project], [], new Map(), tasksByProject);
    expect(p.percent).toBe(50);
    expect(p.source).toBe('rollup');
  });

  it('rolls a goal up from projects and direct tasks together', () => {
    const goal = makeGoal();
    const project = makeProject({ id: 'p1', goalId: 'g1' });
    const tasksByProject = new Map([['p1', [makeTask({ id: 'a', status: 'COMPLETED' })]]]);
    const direct = [makeTask({ id: 'd1' }), makeTask({ id: 'd2' })];
    // project 100% (weight 1) + tasks 0% (weight 2) => 100 / 3 = 33
    const p = goalProgress(goal, [project], direct, new Map(), tasksByProject);
    expect(p.percent).toBe(33);
  });

  it('calls a goal with nothing linked empty, not zero-of-zero', () => {
    expect(goalProgress(makeGoal(), [], [], new Map(), new Map()).source).toBe('empty');
  });

  it('judges health against elapsed time, not a fixed threshold', () => {
    const start = new Date(2026, 0, 1).getTime();
    const target = new Date(2026, 11, 31).getTime();
    // ~70% through the year at 20% done is behind.
    expect(health(20, start, target, false, '2026-09-10')).toBe('AT_RISK');
    // Same date, 80% done is fine.
    expect(health(80, start, target, false, '2026-09-10')).toBe('ON_TRACK');
  });

  it('reports overdue and completed distinctly', () => {
    const target = new Date(2026, 0, 1).getTime();
    expect(health(50, null, target, false, '2026-09-10')).toBe('OVERDUE');
    expect(health(50, null, target, true, '2026-09-10')).toBe('COMPLETED');
    expect(health(50, null, null, false, '2026-09-10')).toBe('NO_DEADLINE');
  });

  it('allows a 15-point tolerance before calling a goal at risk', () => {
    const start = new Date(2026, 0, 1).getTime();
    const target = new Date(2026, 11, 31).getTime();
    // Expected ~69% on Sep 10; 60% is behind but inside tolerance.
    expect(health(60, start, target, false, '2026-09-10')).toBe('ON_TRACK');
  });

  it('detects a direct parent cycle', () => {
    const a = makeTask({ id: 'a' });
    const byId = new Map([['a', a]]);
    expect(wouldCreateCycle('a', 'a', byId)).toBe(true);
  });

  it('detects an indirect parent cycle', () => {
    // a -> b -> c; making c the parent of a would close the loop.
    const a = makeTask({ id: 'a', parentTaskId: null });
    const b = makeTask({ id: 'b', parentTaskId: 'a' });
    const c = makeTask({ id: 'c', parentTaskId: 'b' });
    const byId = new Map([['a', a], ['b', b], ['c', c]]);
    expect(wouldCreateCycle('a', 'c', byId)).toBe(true);
    expect(wouldCreateCycle('c', null, byId)).toBe(false);
  });

  it('allows a legitimate reparent', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const byId = new Map([['a', a], ['b', b]]);
    expect(wouldCreateCycle('b', 'a', byId)).toBe(false);
  });

  it('summarises subtask completion', () => {
    const subs = [
      makeTask({ id: 's1', status: 'COMPLETED' }),
      makeTask({ id: 's2' }),
      makeTask({ id: 's3', deletedAt: 1 }),
    ];
    expect(subtaskProgress(subs)).toEqual({ done: 1, total: 2, percent: 50 });
  });
});
