/**
 * Goal and project progress rollups.
 *
 * Master prompt sections 21 and 22 forbid displaying a progress percentage that
 * is not derived from real data. Every bar in the UI resolves through one of
 * these functions; none of them accepts a hardcoded number.
 *
 * The rules, defined once because no separate BUSINESS_RULES document exists
 * and TECH_SPEC section 6 only says progress is "computed automatically from
 * linked projects/tasks where possible, manual override allowed":
 *
 *  PROJECT
 *    - An explicit `progressOverride` always wins, so the user can say "this is
 *      really 40% done" when the task list does not capture it.
 *    - Otherwise milestones and tasks are blended 60/40, because a milestone is
 *      a coarser and more meaningful unit than a single task.
 *    - With only one of the two present, that one carries the whole weight.
 *    - With neither, a project is 0% until completed, then 100%.
 *
 *  GOAL
 *    - MANUAL  - the user's number, clamped.
 *    - NUMERIC - measured value against target (bench 92.5 of 100kg).
 *    - ROLLUP  - the mean of its projects' progress and its direct tasks'
 *      completion, weighted by how many of each exist so neither side dominates
 *      just by being smaller.
 *
 * A completed entity always reads 100%, whatever the arithmetic says: the user
 * marking it done is a stronger signal than an unticked leftover subtask.
 */

import type { Goal, Milestone, Project, Task } from '../data/schema';
import { daysBetween, toDayKey, today as todayKey, type DayKey } from './dates';

/** Clamps to the 0-100 integer range every progress bar expects. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

const isLive = <T extends { deletedAt: number | null }>(row: T): boolean => row.deletedAt == null;

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export interface ProjectProgress {
  percent: number;
  /** Where the number came from, so the UI can explain it honestly. */
  source: 'override' | 'milestones' | 'tasks' | 'blended' | 'completed' | 'empty';
  tasksTotal: number;
  tasksDone: number;
  milestonesTotal: number;
  milestonesDone: number;
}

export function projectProgress(
  project: Project,
  tasks: Task[],
  milestones: Milestone[],
): ProjectProgress {
  const liveTasks = tasks.filter((t) => isLive(t) && t.status !== 'ARCHIVED');
  const liveMilestones = milestones.filter(isLive);

  const tasksTotal = liveTasks.length;
  const tasksDone = liveTasks.filter((t) => t.status === 'COMPLETED').length;
  const milestonesTotal = liveMilestones.length;
  const milestonesDone = liveMilestones.filter((m) => m.status === 'COMPLETED').length;

  const counts = { tasksTotal, tasksDone, milestonesTotal, milestonesDone };

  if (project.status === 'COMPLETED') {
    return { percent: 100, source: 'completed', ...counts };
  }
  if (project.progressOverride != null) {
    return { percent: clampPercent(project.progressOverride), source: 'override', ...counts };
  }

  const taskPct = tasksTotal > 0 ? (tasksDone / tasksTotal) * 100 : null;
  const milestonePct = milestonesTotal > 0 ? (milestonesDone / milestonesTotal) * 100 : null;

  if (milestonePct != null && taskPct != null) {
    return {
      percent: clampPercent(milestonePct * 0.6 + taskPct * 0.4),
      source: 'blended',
      ...counts,
    };
  }
  if (milestonePct != null) {
    return { percent: clampPercent(milestonePct), source: 'milestones', ...counts };
  }
  if (taskPct != null) {
    return { percent: clampPercent(taskPct), source: 'tasks', ...counts };
  }
  return { percent: 0, source: 'empty', ...counts };
}

/** One-line explanation of where a project percentage came from. */
export function describeProjectProgress(p: ProjectProgress): string {
  switch (p.source) {
    case 'override':
      return 'Set manually';
    case 'milestones':
      return `${p.milestonesDone} of ${p.milestonesTotal} milestones`;
    case 'tasks':
      return `${p.tasksDone} of ${p.tasksTotal} tasks`;
    case 'blended':
      return `${p.milestonesDone}/${p.milestonesTotal} milestones · ${p.tasksDone}/${p.tasksTotal} tasks`;
    case 'completed':
      return 'Completed';
    default:
      return 'No tasks or milestones yet';
  }
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export interface GoalProgress {
  percent: number;
  source: 'manual' | 'numeric' | 'rollup' | 'completed' | 'empty';
  projectsTotal: number;
  tasksTotal: number;
  tasksDone: number;
  /** For NUMERIC goals, the measured value and its target. */
  value: number | null;
  target: number | null;
  unit: string | null;
}

export function goalProgress(
  goal: Goal,
  projects: Project[],
  tasks: Task[],
  milestonesByProject: Map<string, Milestone[]>,
  tasksByProject: Map<string, Task[]>,
): GoalProgress {
  const liveProjects = projects.filter((p) => isLive(p) && p.status !== 'ARCHIVED');
  // Tasks attached straight to the goal, not via one of its projects.
  // A planner-generated task only counts once it is done: generating today's
  // plan must never drag a goal's percentage down.
  const directTasks = tasks.filter(
    (t) =>
      isLive(t) &&
      t.projectId == null &&
      t.status !== 'ARCHIVED' &&
      !(t.generated && t.status !== 'COMPLETED'),
  );

  const base = {
    projectsTotal: liveProjects.length,
    tasksTotal: directTasks.length,
    tasksDone: directTasks.filter((t) => t.status === 'COMPLETED').length,
    value: null as number | null,
    target: null as number | null,
    unit: goal.unit,
  };

  if (goal.status === 'COMPLETED') {
    return { percent: 100, source: 'completed', ...base };
  }

  if (goal.progressType === 'MANUAL') {
    return { percent: clampPercent(goal.progressValue), source: 'manual', ...base };
  }

  if (goal.progressType === 'NUMERIC') {
    const target = goal.targetValue;
    const value = goal.progressValue;
    const percent = target && target !== 0 ? clampPercent((value / target) * 100) : 0;
    return { percent, source: 'numeric', ...base, value, target };
  }

  /* ROLLUP */
  const projectPercents = liveProjects.map(
    (p) =>
      projectProgress(p, tasksByProject.get(p.id) ?? [], milestonesByProject.get(p.id) ?? [])
        .percent,
  );

  const hasProjects = projectPercents.length > 0;
  const hasTasks = base.tasksTotal > 0;

  if (!hasProjects && !hasTasks) {
    return { percent: 0, source: 'empty', ...base };
  }

  // Weight each side by how many items it represents, so a goal with one
  // project and twelve loose tasks is not half-decided by that one project.
  const projectWeight = projectPercents.length;
  const taskWeight = base.tasksTotal;
  const projectSum = projectPercents.reduce((a, b) => a + b, 0);
  const taskSum = hasTasks ? (base.tasksDone / base.tasksTotal) * 100 * taskWeight : 0;

  const percent = clampPercent((projectSum + taskSum) / (projectWeight + taskWeight));
  return { percent, source: 'rollup', ...base };
}

export function describeGoalProgress(p: GoalProgress): string {
  switch (p.source) {
    case 'manual':
      return 'Set manually';
    case 'numeric':
      return p.target != null
        ? `${p.value ?? 0}${p.unit ? ` ${p.unit}` : ''} of ${p.target}${p.unit ? ` ${p.unit}` : ''}`
        : 'No target set';
    case 'rollup': {
      const bits: string[] = [];
      if (p.projectsTotal) bits.push(`${p.projectsTotal} project${p.projectsTotal === 1 ? '' : 's'}`);
      if (p.tasksTotal) bits.push(`${p.tasksDone}/${p.tasksTotal} tasks`);
      return bits.join(' · ');
    }
    case 'completed':
      return 'Completed';
    default:
      return 'Nothing linked yet';
  }
}

/* ------------------------------------------------------------------ *
 * Health - on track vs at risk
 * ------------------------------------------------------------------ */

export type Health = 'ON_TRACK' | 'AT_RISK' | 'OVERDUE' | 'COMPLETED' | 'NO_DEADLINE';

/**
 * Compares progress made against time elapsed.
 *
 * A goal due in a year that is 10% done after a month is fine; the same goal
 * 10% done a week before the deadline is not. The comparison is proportional
 * rather than a fixed threshold, with a 15-point tolerance so a goal is not
 * called "at risk" for being marginally behind a perfectly linear pace.
 */
export function health(
  percent: number,
  startDate: number | null,
  targetDate: number | null,
  isComplete: boolean,
  today: DayKey = todayKey(),
): Health {
  if (isComplete) return 'COMPLETED';
  if (targetDate == null) return 'NO_DEADLINE';

  const dueKey = toDayKey(targetDate);
  const daysLeft = daysBetween(today, dueKey);
  if (daysLeft < 0) return 'OVERDUE';

  const startKey = startDate != null ? toDayKey(startDate) : null;
  if (startKey == null) {
    // Without a start date the only signal is proximity: near the deadline with
    // meaningful work left is the honest definition of at-risk.
    return daysLeft <= 7 && percent < 80 ? 'AT_RISK' : 'ON_TRACK';
  }

  const total = daysBetween(startKey, dueKey);
  if (total <= 0) return percent >= 100 ? 'COMPLETED' : 'AT_RISK';

  const elapsed = daysBetween(startKey, today);
  const expected = clampPercent((elapsed / total) * 100);
  return percent + 15 < expected ? 'AT_RISK' : 'ON_TRACK';
}

/** Display label and colour token name for a health value. */
export function healthLabel(h: Health): string {
  switch (h) {
    case 'ON_TRACK':
      return 'On track';
    case 'AT_RISK':
      return 'At risk';
    case 'OVERDUE':
      return 'Overdue';
    case 'COMPLETED':
      return 'Completed';
    default:
      return 'No deadline';
  }
}

/* ------------------------------------------------------------------ *
 * Task tree helpers
 * ------------------------------------------------------------------ */

/**
 * Whether setting `parentId` as the parent of `taskId` would create a cycle.
 *
 * TECH_SPEC section 6 requires this to be enforced at the data layer rather
 * than only in the UI, so the repository calls it before every parent change.
 */
export function wouldCreateCycle(
  taskId: string,
  parentId: string | null,
  byId: Map<string, Task>,
): boolean {
  if (parentId == null) return false;
  if (parentId === taskId) return true;

  const seen = new Set<string>([taskId]);
  let cursor: string | null = parentId;
  while (cursor != null) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentTaskId ?? null;
  }
  return false;
}

/** Completion of a task's direct subtasks, for the subtask progress line. */
export function subtaskProgress(subtasks: Task[]): { done: number; total: number; percent: number } {
  const live = subtasks.filter((t) => isLive(t) && t.status !== 'ARCHIVED');
  const done = live.filter((t) => t.status === 'COMPLETED').length;
  return {
    done,
    total: live.length,
    percent: live.length === 0 ? 0 : clampPercent((done / live.length) * 100),
  };
}
