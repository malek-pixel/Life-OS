/**
 * Daily task planning: which (at most four) things matter today.
 *
 * The plan is not a separate system. Every planned item is an ordinary Task row
 * - so completing one awards XP, rolls into goal progress and syncs exactly like
 * any other task - marked with `plannedFor` (the day) and, when the planner
 * wrote it, `generated`. `Settings.dailyPlanDate` records that a day has been
 * planned, so reloading the dashboard never produces a different plan.
 *
 * This module is the deterministic half: it turns real goals, quests, tasks,
 * habits and workouts into scored candidates and picks a balanced, realistic
 * day. It is the fallback whenever AI generation is unavailable, and it decides
 * how many slots the AI is allowed to fill. It never invents a goal or quest:
 * every candidate is derived from a row that exists.
 */

import { store } from '../data/store';
import type { Goal, LifeArea, Priority, Quest, QuestRequirement, Task } from '../data/schema';
import { addDays, dayKeyToMs, daysBetween, endOfDay, startOfWeek, toDayKey, type DayKey } from './dates';
import { selectGoals, selectQuests, selectTaskViews, selectTodayGroups, type QuestView, type TaskView } from './selectors';
import { isCompletedOn, isDueOn, indexLogs } from './streaks';

/** Hard cap. Enforced here, in the action that writes a plan, and in the selector that reads one. */
export const MAX_DAILY_TASKS = 4;

/** A day with more planned effort than this is not a realistic day. */
const MAX_PLANNED_MINUTES = 300;

/** Candidates scoring below this are not worth a slot; fewer tasks beats filler. */
const MIN_SCORE = 20;

/** Goal statuses that still want work. BACKLOG is deliberately excluded: not started by choice. */
const ACTIVE_GOAL_STATUSES = new Set<Goal['status']>(['ACTIVE', 'ON_TRACK', 'AT_RISK']);

export interface PlanCandidate {
  title: string;
  description: string;
  goalId: string | null;
  questId: string | null;
  /** Set when the candidate is an existing task being surfaced or carried over. */
  existingTaskId: string | null;
  priority: Priority;
  estimatedMinutes: number;
  area: LifeArea;
  /** One plan slot per source: `quest:<id>`, `goal:<id>` or `task:<id>`. */
  sourceKey: string;
  /** Balancing key: at most one task per goal unless it is urgent. */
  goalKey: string;
  score: number;
  /** Deadline-sensitive: may break the balance rules. */
  urgent: boolean;
  /** Genuinely recurring work (a habit, a training day), exempt from repetition checks. */
  recurring: boolean;
  /** Short explanation, shown to the AI and kept for debugging. */
  reason: string;
}

export interface PlanContext {
  day: DayKey;
  goals: Goal[];
  goalPercent: Map<string, number>;
  quests: QuestView[];
  tasks: Task[];
  /** Titles of tasks completed in the last 14 days, lowercased. */
  recentlyCompletedTitles: Set<string>;
  /** How many of the previous 3 days each source key appeared in a plan. */
  recentSourceDays: Map<string, number>;
  /** Most recent earlier planned task per source key, to vary wording. */
  lastPlannedBySource: Map<string, Task>;
  workoutLoggedToday: boolean;
  habitDoneToday: Map<string, boolean>;
  habitDueToday: Map<string, boolean>;
  habitTitle: Map<string, string>;
  pendingMilestones: Map<string, Array<{ title: string; projectTitle: string; projectId: string }>>;
  projectGoal: Map<string, string | null>;
  projectTitle: Map<string, string>;
}

/* ================================================================== *
 * Validity
 * ================================================================== */

export function isGoalActive(goal: Goal | undefined | null): boolean {
  return !!goal && goal.deletedAt == null && ACTIVE_GOAL_STATUSES.has(goal.status);
}

export function isQuestActive(quest: Quest | undefined | null): boolean {
  return !!quest && quest.deletedAt == null && quest.status === 'ACTIVE';
}

/**
 * Whether an open plan task still points at live, unfinished work.
 *
 * A generated task whose goal was deleted or completed, or whose quest was
 * completed, no longer belongs in today's plan. A surfaced task of the user's
 * own stays valid as long as it exists: it is theirs, not the planner's.
 */
export function isPlanTaskValid(task: Task): boolean {
  if (task.deletedAt != null || task.status === 'ARCHIVED') return false;
  if (!task.generated) return true;
  // Deleting a goal detaches its tasks rather than deleting them; an orphaned
  // generated task no longer serves anything.
  if (!task.goalId && !task.questId) return false;
  if (task.questId) {
    const quest = store.byId('quests', task.questId);
    if (!isQuestActive(quest)) return false;
  }
  if (task.goalId) {
    const goal = store.byId('goals', task.goalId);
    if (!isGoalActive(goal)) return false;
  }
  return true;
}

/** Open tasks in today's plan, de-duplicated. */
export function planTasksFor(day: DayKey): Task[] {
  const seen = new Set<string>();
  return store
    .live('tasks')
    .filter((t) => t.plannedFor === day && t.status !== 'ARCHIVED')
    .sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt)
    .filter((t) => {
      const key = normalizeTitle(t.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The source a stored plan task was generated from, matching PlanCandidate.sourceKey. */
export function sourceKeyOf(task: Task): string {
  if (!task.generated) return `task:${task.id}`;
  if (task.questId) return `quest:${task.questId}`;
  if (task.goalId) return `goal:${task.goalId}`;
  return `task:${task.id}`;
}

/* ================================================================== *
 * Context
 * ================================================================== */

export function buildPlanContext(day: DayKey): PlanContext {
  const goals = store.live('goals').filter(isGoalActive);
  const goalPercent = new Map(selectGoals().map((v) => [v.goal.id, v.progress.percent]));
  const quests = selectQuests().filter((v) => isQuestActive(v.quest));
  const tasks = store.live('tasks');

  const since = dayKeyToMs(addDays(day, -14));
  const recentlyCompletedTitles = new Set(
    tasks
      .filter((t) => t.status === 'COMPLETED' && (t.completedAt ?? 0) >= since)
      .map((t) => normalizeTitle(t.title)),
  );

  const recentSourceDays = new Map<string, number>();
  const lastPlannedBySource = new Map<string, Task>();
  const window = new Set([addDays(day, -1), addDays(day, -2), addDays(day, -3)]);
  // Deleted rows count too: a task the planner swapped out still shows the source was planned.
  const planned = store
    .get('tasks')
    .filter((t) => t.plannedFor && t.plannedFor < day)
    .sort((a, b) => (a.plannedFor! < b.plannedFor! ? -1 : 1));
  const counted = new Set<string>();
  for (const t of planned) {
    const key = sourceKeyOf(t);
    if (t.deletedAt == null) lastPlannedBySource.set(key, t);
    const dayKey = `${key}@${t.plannedFor}`;
    if (window.has(t.plannedFor!) && !counted.has(dayKey)) {
      counted.add(dayKey);
      recentSourceDays.set(key, (recentSourceDays.get(key) ?? 0) + 1);
    }
  }

  const dayStart = dayKeyToMs(day);
  const workoutLoggedToday = store
    .live('workouts')
    .some((w) => w.date >= dayStart && w.date <= endOfDay(dayStart));

  const allLogs = store.live('habitLogs');
  const habitDoneToday = new Map<string, boolean>();
  const habitDueToday = new Map<string, boolean>();
  const habitTitle = new Map<string, string>();
  for (const habit of store.live('habits')) {
    const index = indexLogs(allLogs.filter((l) => l.habitId === habit.id));
    habitDoneToday.set(habit.id, isCompletedOn(index, day));
    habitDueToday.set(habit.id, habit.status === 'ACTIVE' && isDueOn(habit, day));
    habitTitle.set(habit.id, habit.title);
  }

  const projects = store.live('projects');
  const projectGoal = new Map(projects.map((p) => [p.id, p.goalId]));
  const projectTitle = new Map(projects.map((p) => [p.id, p.title]));
  const pendingMilestones = new Map<string, Array<{ title: string; projectTitle: string; projectId: string }>>();
  for (const m of store
    .live('milestones')
    .filter((m) => m.status === 'PENDING')
    .sort((a, b) => a.orderIndex - b.orderIndex)) {
    const project = projects.find((p) => p.id === m.projectId);
    if (!project || project.status === 'COMPLETED' || project.status === 'ARCHIVED') continue;
    const list = pendingMilestones.get(m.projectId) ?? [];
    list.push({ title: m.title, projectTitle: project.title, projectId: project.id });
    pendingMilestones.set(m.projectId, list);
  }

  return {
    day,
    goals,
    goalPercent,
    quests,
    tasks,
    recentlyCompletedTitles,
    recentSourceDays,
    lastPlannedBySource,
    workoutLoggedToday,
    habitDoneToday,
    habitDueToday,
    habitTitle,
    pendingMilestones,
    projectGoal,
    projectTitle,
  };
}

/* ================================================================== *
 * Scoring
 * ================================================================== */

const PRIORITY_SCORE: Record<Priority, number> = { HIGH: 30, MEDIUM: 18, LOW: 8 };

const QUEST_TYPE_SCORE: Record<Quest['type'], number> = {
  BOSS: 22,
  MAIN: 18,
  CHALLENGE: 16,
  DAILY: 20,
  WEEKLY: 10,
  SIDE: 4,
};

function daysUntil(ms: number | null, day: DayKey): number | null {
  if (ms == null) return null;
  return daysBetween(day, toDayKey(ms));
}

/** Deadlines dominate: a near deadline outranks any priority label. */
export function deadlineScore(daysLeft: number | null): number {
  if (daysLeft == null) return 5;
  if (daysLeft <= 0) return 60;
  if (daysLeft <= 3) return 50;
  if (daysLeft <= 7) return 40;
  if (daysLeft <= 14) return 28;
  if (daysLeft <= 30) return 18;
  if (daysLeft <= 90) return 9;
  return 3;
}

function priorityOf(value: unknown): Priority {
  return value === 'HIGH' || value === 'LOW' || value === 'MEDIUM' ? value : 'MEDIUM';
}

/**
 * Spreads work across the days available rather than every day: a source
 * planned on recent days loses score unless its deadline is close, and far
 * deadlines lose more.
 */
function pacingPenalty(ctx: PlanContext, sourceKey: string, daysLeft: number | null, recurring: boolean): number {
  if (recurring) return 0;
  const recent = ctx.recentSourceDays.get(sourceKey) ?? 0;
  if (recent === 0) return 0;
  if (daysLeft != null && daysLeft <= 14) return 0;
  const far = daysLeft == null || daysLeft > 90;
  return recent * (far ? 10 : 5);
}

/** Wording that moves on from what was planned last time, so a source never repeats verbatim. */
function nextStepTitle(ctx: PlanContext, sourceKey: string, name: string, objective: string): { title: string; description: string } {
  const last = ctx.lastPlannedBySource.get(sourceKey);
  const trimmed = objective.trim().replace(/\.$/, '');
  if (!last) {
    return {
      title: `Break "${name}" into concrete steps and finish the first one`,
      description: trimmed
        ? `Objective: ${trimmed}. List the steps, then complete step one today.`
        : 'List the steps, then complete step one today.',
    };
  }
  if (last.status === 'COMPLETED') {
    return {
      title: `Complete the next step of "${name}"`,
      description: `Last done: ${last.title}. Pick the next step on your list and finish it today.`,
    };
  }
  return {
    title: `Finish the step you started on "${name}"`,
    description: `Left open from ${last.plannedFor}: ${last.title}.`,
  };
}

/* ================================================================== *
 * Candidates
 * ================================================================== */

export function buildCandidates(ctx: PlanContext): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  const dayStart = dayKeyToMs(ctx.day);
  const dayEnd = endOfDay(dayStart);
  const goalsById = new Map(ctx.goals.map((g) => [g.id, g]));
  const coveredGoals = new Set<string>();

  /* --- 1. the user's own open tasks that are overdue, due soon, or in progress --- */
  for (const task of ctx.tasks) {
    if (task.generated || task.parentTaskId != null) continue;
    if (task.status !== 'TODO' && task.status !== 'IN_PROGRESS') continue;
    const dueSoon = task.dueAt != null && task.dueAt <= dayEnd + 2 * 86_400_000;
    if (!dueSoon && task.status !== 'IN_PROGRESS') continue;

    const goalId = task.goalId ?? (task.projectId ? (ctx.projectGoal.get(task.projectId) ?? null) : null);
    const goal = goalId ? goalsById.get(goalId) : undefined;
    const daysLeft = daysUntil(task.dueAt, ctx.day);
    const overdue = task.dueAt != null && task.dueAt < dayStart;
    // Overdue work competes on merit: urgent, but not automatically dumped on today.
    const score =
      deadlineScore(daysLeft) +
      PRIORITY_SCORE[priorityOf(task.priority)] +
      (task.status === 'IN_PROGRESS' ? 8 : 0) -
      (overdue && daysLeft != null && daysLeft < -7 ? 15 : 0);

    out.push({
      title: task.title,
      description: task.description,
      goalId: goal ? goal.id : null,
      questId: task.questId ?? null,
      existingTaskId: task.id,
      priority: priorityOf(task.priority),
      estimatedMinutes: task.estimatedMinutes ?? 30,
      area: goal?.area ?? 'Other',
      sourceKey: `task:${task.id}`,
      goalKey: goal ? `goal:${goal.id}` : `task:${task.id}`,
      score,
      urgent: daysLeft != null && daysLeft <= 1,
      recurring: false,
      reason: overdue ? 'overdue task' : task.dueAt != null ? 'due soon' : 'in progress',
    });
  }

  /* --- 2. active quests: the next unmet requirement --- */
  for (const view of ctx.quests) {
    const quest = view.quest;
    const next = view.requirements.find((r) => !r.met);
    if (!next) continue;
    const goal = quest.goalId ? goalsById.get(quest.goalId) : undefined;
    // A quest under a finished goal is done serving its purpose.
    if (quest.goalId && !goal) continue;

    const deadline = quest.endDate ?? goal?.targetDate ?? null;
    const daysLeft = daysUntil(deadline, ctx.day);
    const sourceKey = `quest:${quest.id}`;
    const step = questStep(ctx, quest, next.requirement, next.progress, view.percent);
    if (!step) continue;

    let typeScore = QUEST_TYPE_SCORE[quest.type];
    if (quest.type === 'WEEKLY') {
      const weekStart = dayKeyToMs(startOfWeek(ctx.day, store.settings.weekStartsMonday));
      const doneThisWeek = ctx.tasks.some(
        (t) => t.questId === quest.id && t.status === 'COMPLETED' && (t.completedAt ?? 0) >= weekStart,
      );
      if (doneThisWeek) continue;
      // Weekly work gets more pressing as the week runs out.
      typeScore += Math.min(12, daysBetween(startOfWeek(ctx.day, store.settings.weekStartsMonday), ctx.day) * 2);
    }
    if (quest.type === 'SIDE' && daysLeft != null && daysLeft <= 3) typeScore += 20;

    const priority = goal ? goal.priority : quest.type === 'BOSS' || quest.type === 'MAIN' ? 'HIGH' : 'MEDIUM';
    const nearDone = view.percent >= 70 ? 10 : 0;
    const score =
      deadlineScore(daysLeft) +
      PRIORITY_SCORE[priority] +
      typeScore +
      nearDone -
      pacingPenalty(ctx, sourceKey, daysLeft, step.recurring);

    if (goal) coveredGoals.add(goal.id);
    out.push({
      ...step,
      goalId: goal?.id ?? null,
      questId: quest.id,
      existingTaskId: step.existingTaskId ?? null,
      priority,
      area: quest.area,
      sourceKey,
      goalKey: goal ? `goal:${goal.id}` : sourceKey,
      score,
      urgent: daysLeft != null && daysLeft <= 7,
      reason: `${quest.type.toLowerCase()} quest${daysLeft != null ? `, ${daysLeft}d left` : ''}`,
    });
  }

  /* --- 3. active goals no quest already speaks for --- */
  for (const goal of ctx.goals) {
    if (coveredGoals.has(goal.id)) continue;
    const sourceKey = `goal:${goal.id}`;
    const daysLeft = daysUntil(goal.targetDate, ctx.day);
    const percent = ctx.goalPercent.get(goal.id) ?? 0;
    const step = goalStep(ctx, goal, percent);
    const nearDone = percent >= 70 ? 10 : 0;
    const score =
      deadlineScore(daysLeft) +
      PRIORITY_SCORE[priorityOf(goal.priority)] +
      nearDone -
      pacingPenalty(ctx, sourceKey, daysLeft, false);

    out.push({
      ...step,
      goalId: goal.id,
      questId: null,
      existingTaskId: step.existingTaskId ?? null,
      priority: priorityOf(goal.priority),
      area: goal.area,
      sourceKey: step.existingTaskId ? `task:${step.existingTaskId}` : sourceKey,
      goalKey: sourceKey,
      score,
      urgent: daysLeft != null && daysLeft <= 7,
      recurring: false,
      reason: `${goal.priority.toLowerCase()} priority goal${daysLeft != null ? `, ${daysLeft}d left` : ''}, ${percent}% done`,
    });
  }

  // Never re-suggest something already finished recently, unless it is recurring by nature.
  return out.filter(
    (c) => c.existingTaskId != null || c.recurring || !ctx.recentlyCompletedTitles.has(normalizeTitle(c.title)),
  );
}

type Step = {
  title: string;
  description: string;
  estimatedMinutes: number;
  recurring: boolean;
  existingTaskId?: string | null;
};

function questStep(
  ctx: PlanContext,
  quest: Quest,
  req: QuestRequirement,
  progress: number,
  percent: number,
): Step | null {
  const sourceKey = `quest:${quest.id}`;
  switch (req.kind) {
    case 'HABIT_STREAK': {
      if (req.refId) {
        if (!ctx.habitDueToday.get(req.refId) || ctx.habitDoneToday.get(req.refId)) return null;
        const name = ctx.habitTitle.get(req.refId) ?? 'your habit';
        return {
          title: `Complete and log today's "${name}"`,
          description: `${quest.title}: day ${progress + 1} of ${req.target} in a row.`,
          estimatedMinutes: 20,
          recurring: true,
        };
      }
      return {
        title: `Complete your full core routine today`,
        description: `${quest.title}: ${req.label}`,
        estimatedMinutes: 30,
        recurring: true,
      };
    }
    case 'WORKOUT_COUNT': {
      if (ctx.workoutLoggedToday) return null;
      return {
        title: `Complete and log today's planned training session`,
        description: `${quest.title}: ${progress} of ${req.target} workouts logged.`,
        estimatedMinutes: 60,
        recurring: true,
      };
    }
    case 'MILESTONE': {
      const milestone = milestoneFor(ctx, req.refId, quest.goalId);
      if (milestone) {
        return {
          title: `Finish milestone "${milestone.title}"`,
          description: `${milestone.projectTitle} · counts toward ${quest.title} (${progress}/${req.target}).`,
          estimatedMinutes: 60,
          recurring: false,
        };
      }
      break;
    }
    case 'TASK_COUNT': {
      const task = req.refId ? nextOpenTask(ctx, (t) => t.projectId === req.refId) : null;
      if (task) {
        return {
          title: task.title,
          description: task.description || `Counts toward ${quest.title} (${progress}/${req.target}).`,
          estimatedMinutes: task.estimatedMinutes ?? 30,
          recurring: false,
          existingTaskId: task.id,
        };
      }
      break;
    }
    default:
      break;
  }
  if (req.target > 1) {
    return {
      title: `Complete one more: ${req.label.replace(/\.$/, '')}`,
      description: `${quest.title}: ${Math.min(progress, req.target)} of ${req.target} so far.`,
      estimatedMinutes: 45,
      recurring: false,
    };
  }
  const step = nextStepTitle(ctx, sourceKey, quest.title, quest.objective || req.label);
  return {
    ...step,
    description: percent > 0 ? `${step.description} Quest ${percent}% complete.` : step.description,
    estimatedMinutes: 45,
    recurring: false,
  };
}

function goalStep(ctx: PlanContext, goal: Goal, percent: number): Step {
  const task = nextOpenTask(ctx, (t) =>
    t.goalId === goal.id || (t.projectId != null && ctx.projectGoal.get(t.projectId) === goal.id),
  );
  if (task) {
    return {
      title: task.title,
      description: task.description || `Next open task for ${goal.title}.`,
      estimatedMinutes: task.estimatedMinutes ?? 30,
      recurring: false,
      existingTaskId: task.id,
    };
  }
  const milestone = milestoneFor(ctx, null, goal.id);
  if (milestone) {
    return {
      title: `Finish milestone "${milestone.title}"`,
      description: `${milestone.projectTitle} · ${goal.title}`,
      estimatedMinutes: 60,
      recurring: false,
    };
  }
  const step = nextStepTitle(ctx, `goal:${goal.id}`, goal.title, goal.description);
  if (goal.progressType === 'NUMERIC' && goal.targetValue != null) {
    step.description = `${step.description} Currently ${goal.progressValue} of ${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ''}.`;
  } else if (percent > 0) {
    step.description = `${step.description} Goal ${percent}% complete.`;
  }
  return { ...step, estimatedMinutes: 45, recurring: false };
}

function milestoneFor(
  ctx: PlanContext,
  projectId: string | null,
  goalId: string | null,
): { title: string; projectTitle: string } | null {
  if (projectId) return ctx.pendingMilestones.get(projectId)?.[0] ?? null;
  if (!goalId) return null;
  for (const [pid, list] of ctx.pendingMilestones) {
    if (ctx.projectGoal.get(pid) === goalId && list[0]) return list[0];
  }
  return null;
}

/** The next undated open task matching `match`, highest priority first. */
function nextOpenTask(ctx: PlanContext, match: (t: Task) => boolean): Task | null {
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return (
    ctx.tasks
      .filter(
        (t) =>
          !t.generated &&
          t.parentTaskId == null &&
          (t.status === 'TODO' || t.status === 'IN_PROGRESS') &&
          match(t),
      )
      .sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || a.orderIndex - b.orderIndex)[0] ?? null
  );
}

/* ================================================================== *
 * Selection
 * ================================================================== */

export interface Taken {
  sourceKeys: Set<string>;
  goalKeys: Map<string, number>;
  areas: Map<string, number>;
  titles: Set<string>;
  minutes: number;
}

export function emptyTaken(): Taken {
  return { sourceKeys: new Set(), goalKeys: new Map(), areas: new Map(), titles: new Set(), minutes: 0 };
}

export function markTaken(taken: Taken, c: Pick<PlanCandidate, 'sourceKey' | 'goalKey' | 'area' | 'title' | 'estimatedMinutes'>): void {
  taken.sourceKeys.add(c.sourceKey);
  taken.goalKeys.set(c.goalKey, (taken.goalKeys.get(c.goalKey) ?? 0) + 1);
  taken.areas.set(c.area, (taken.areas.get(c.area) ?? 0) + 1);
  taken.titles.add(normalizeTitle(c.title));
  taken.minutes += c.estimatedMinutes;
}

/** Records an already-planned task so new picks balance against it. */
export function takenFromTask(taken: Taken, task: Task): void {
  const goal = task.goalId ? store.byId('goals', task.goalId) : undefined;
  markTaken(taken, {
    sourceKey: sourceKeyOf(task),
    goalKey: task.goalId ? `goal:${task.goalId}` : sourceKeyOf(task),
    area: goal?.area ?? (task.questId ? (store.byId('quests', task.questId)?.area ?? 'Other') : 'Other'),
    title: task.title,
    estimatedMinutes: task.estimatedMinutes ?? 30,
  });
}

/**
 * Greedy, balanced pick of up to `slots` candidates.
 *
 * Balance is a soft penalty per repeated life area and a limit of one task per
 * goal - both waived for urgent candidates, because balance must never override
 * a deadline. Effort is capped so the result is a day someone can actually do.
 */
export function selectCandidates(candidates: PlanCandidate[], slots: number, taken: Taken = emptyTaken()): PlanCandidate[] {
  const limit = Math.max(0, Math.min(slots, MAX_DAILY_TASKS));
  const picked: PlanCandidate[] = [];
  const pool = candidates.filter((c) => c.score >= MIN_SCORE);

  while (picked.length < limit) {
    let best: PlanCandidate | null = null;
    let bestScore = -Infinity;
    for (const c of pool) {
      if (taken.sourceKeys.has(c.sourceKey) || taken.titles.has(normalizeTitle(c.title))) continue;
      const sameGoal = taken.goalKeys.get(c.goalKey) ?? 0;
      if (sameGoal >= (c.urgent ? 2 : 1)) continue;
      if (taken.minutes > 0 && taken.minutes + c.estimatedMinutes > MAX_PLANNED_MINUTES && !c.urgent) continue;
      const effective = c.score - (c.urgent ? 0 : 15 * (taken.areas.get(c.area) ?? 0));
      if (effective > bestScore) {
        best = c;
        bestScore = effective;
      }
    }
    if (!best || bestScore < MIN_SCORE) break;
    picked.push(best);
    markTaken(taken, best);
  }
  return picked;
}

/* ================================================================== *
 * Reading the plan
 * ================================================================== */

export interface DailyPlanItem {
  view: TaskView;
  quest: Quest | null;
  /** "→ Score 1350+ on the SAT" style link to what this task advances. */
  linkLabel: string | null;
  linkTo: string | null;
}

export interface DailyPlanView {
  day: DayKey;
  /** False until today's plan has been generated. */
  planned: boolean;
  items: DailyPlanItem[];
  done: number;
  /** Today's other open tasks (overdue, due today, in progress) outside the plan. */
  otherOpen: number;
}

export function selectDailyPlan(day: DayKey): DailyPlanView {
  const tasks = planTasksFor(day).slice(0, MAX_DAILY_TASKS);
  const inPlan = new Set(tasks.map((t) => t.id));
  const items = selectTaskViews(tasks).map((view): DailyPlanItem => {
    const quest = view.task.questId ? (store.byId('quests', view.task.questId) ?? null) : null;
    const liveQuest = quest && quest.deletedAt == null ? quest : null;
    if (view.goal) {
      return {
        view,
        quest: liveQuest,
        linkLabel: liveQuest ? `${view.goal.title} · ${liveQuest.title}` : view.goal.title,
        linkTo: `/goals/${view.goal.id}`,
      };
    }
    if (liveQuest) {
      return { view, quest: liveQuest, linkLabel: `${liveQuest.type} quest · ${liveQuest.title}`, linkTo: '/quests' };
    }
    return { view, quest: null, linkLabel: view.project?.title ?? null, linkTo: view.project ? `/projects/${view.project.id}` : null };
  });

  const otherOpen = selectTodayGroups()
    .flatMap((g) => g.items)
    .filter((v) => v.task.status !== 'COMPLETED' && !inPlan.has(v.task.id) && !v.task.generated).length;

  return {
    day,
    planned: store.settings.dailyPlanDate === day,
    items,
    done: items.filter((i) => i.view.task.status === 'COMPLETED').length,
    otherOpen,
  };
}
