/**
 * Mutations, and the propagation between them.
 *
 * This is the layer that makes Life OS one system rather than twelve screens.
 * The master prompt's worked example is implemented literally here:
 *
 *   complete a task
 *     -> task state updates
 *     -> XP event written to the append-only ledger
 *     -> cached character rollup updated
 *     -> achievements re-evaluated against real totals
 *     -> the next occurrence scheduled, if the task recurs
 *
 * all inside ONE IndexedDB transaction (see `Tx.commit`), so the ledger can
 * never disagree with the thing it is a ledger of. Project and goal progress
 * need no write at all: they are derived on read by domain/progress.ts, which
 * is why they can never drift out of sync.
 *
 * Nothing here talks to React. Screens call these functions and re-render from
 * the store's subscription.
 */

import { store, type Change } from './store';
import { newId, stamps } from './ids';
import { NotFoundError, ValidationError } from './errors';
import { Validator, checkRange, ENUMS, RULES } from './validation';
import {
  STORES,
  type AchievementUnlock,
  type CharacterState,
  type Goal,
  type Habit,
  type HabitLog,
  type JournalEntry,
  type LifeArea,
  type Note,
  type Priority,
  type Project,
  type Quest,
  type QuestRequirement,
  type Review,
  type RoutineRun,
  type RoutineStep,
  type Settings,
  type StoreTypes,
  type Task,
  type Workout,
  type WorkoutExercise,
  type XpEvent,
  type XpSource,
} from './schema';
import { toDayKey, today as todayKey, type DayKey } from '../domain/dates';
import {
  levelForXp,
  xpForGoal,
  xpForHabit,
  xpForJournalEntry,
  xpForMilestone,
  xpForProject,
  xpForReview,
  xpForTask,
  xpForWorkout,
} from '../domain/xp';
import { calculateStreak, streakBefore } from '../domain/streaks';
import { wouldCreateCycle } from '../domain/progress';
import { nextOccurrence, occurrenceInstant, parseRecurrence } from '../domain/recurrence';
import {
  ACHIEVEMENTS_BY_ID,
  emptyStats,
  evaluate,
  type AchievementStats,
} from '../domain/achievements';

/* ================================================================== *
 * Transaction helper
 * ================================================================== */

/** Anything the UI should react to beyond the data change itself. */
export interface ActionResult {
  xpAwarded: number;
  leveledUp: boolean;
  rankedUp: boolean;
  newLevel: number;
  newRank: string;
  unlockedAchievements: string[];
  /** Ids created by this action, in creation order. */
  createdIds: string[];
}

const EMPTY_RESULT: ActionResult = {
  xpAwarded: 0,
  leveledUp: false,
  rankedUp: false,
  newLevel: 1,
  newRank: 'Failure',
  unlockedAchievements: [],
  createdIds: [],
};

/**
 * Collects a set of related writes, then commits them atomically.
 *
 * The XP rollup and achievement evaluation are computed here rather than by
 * each caller, so no feature can award XP without the ledger, the cached level
 * and the achievement check all moving together.
 */
class Tx {
  private changes: Change[] = [];
  private xpTotal = 0;
  private areaXpDelta: Record<string, number> = {};
  private createdIds: string[] = [];
  /** Rows written in this transaction, for projecting post-commit state. */
  private written = new Map<string, unknown>();

  put<K extends keyof StoreTypes>(storeName: K, value: StoreTypes[K]): StoreTypes[K] {
    this.changes.push({ op: 'put', store: STORES[storeName], value });
    this.written.set(`${String(storeName)}:${(value as { id: string }).id}`, value);
    return value;
  }

  create<K extends keyof StoreTypes>(storeName: K, value: StoreTypes[K]): StoreTypes[K] {
    this.createdIds.push((value as { id: string }).id);
    return this.put(storeName, value);
  }

  /**
   * Awards XP.
   *
   * Writes an append-only XpEvent row - never a bare counter increment - so the
   * history behind any total stays answerable, per TECH_SPEC section 6.
   */
  awardXp(
    sourceType: XpSource,
    sourceId: string | null,
    amount: number,
    reason: string,
    area: LifeArea | null = null,
    day: DayKey = todayKey(),
  ): void {
    if (amount === 0) return;
    const event: XpEvent = {
      id: newId(),
      ...stamps(),
      sourceType,
      sourceId,
      amount,
      reason,
      date: day,
    };
    this.put('xpEvents', event);
    this.xpTotal += amount;
    if (area) this.areaXpDelta[area] = (this.areaXpDelta[area] ?? 0) + amount;
  }

  /**
   * Reverses XP previously awarded for a source.
   *
   * Un-completing a task must not leave its XP banked, but the original event
   * is never edited or removed: a compensating negative event is appended, so
   * the ledger stays append-only and the history remains truthful.
   */
  reverseXp(sourceType: XpSource, sourceId: string, reason: string): void {
    const prior = store
      .live('xpEvents')
      .filter((e) => e.sourceType === sourceType && e.sourceId === sourceId);
    const net = prior.reduce((sum, e) => sum + e.amount, 0);
    if (net === 0) return;
    this.awardXp(sourceType, sourceId, -net, reason);
  }

  /**
   * Commits everything. Returns what the UI needs to celebrate or explain.
   *
   * Order matters: the character rollup is computed from the XP delta, then
   * achievements are evaluated against state *projected* to include this
   * transaction's own writes - so completing the 100th task unlocks Century in
   * the same commit rather than one action later.
   */
  async commit(): Promise<ActionResult> {
    if (this.changes.length === 0) return { ...EMPTY_RESULT };

    const before = store.character;
    const beforeLevel = levelForXp(before.totalXp);

    let character = before;
    if (this.xpTotal !== 0) {
      const totalXp = Math.max(0, before.totalXp + this.xpTotal);
      const after = levelForXp(totalXp);
      const areaXp = { ...before.areaXp };
      for (const [area, delta] of Object.entries(this.areaXpDelta)) {
        areaXp[area] = Math.max(0, (areaXp[area] ?? 0) + delta);
      }
      character = {
        id: 'singleton',
        totalXp,
        level: after.level,
        rank: after.rank.title,
        areaXp,
        updatedAt: Date.now(),
      };
      this.put('characterState', character);
    }

    // Achievements: evaluate against the world as it will be after this commit.
    const stats = projectedStats(this.written, character);
    const unlockedIds = evaluate(stats, store.live('achievementUnlocks'));
    for (const id of unlockedIds) {
      const def = ACHIEVEMENTS_BY_ID.get(id);
      if (!def) continue;
      const unlock: AchievementUnlock = {
        id: newId(),
        ...stamps(),
        achievementId: id,
        unlockedAt: Date.now(),
        seen: false,
      };
      this.put('achievementUnlocks', unlock);
    }

    // Achievement XP re-levels the character, so fold it in before writing.
    const achievementXp = unlockedIds.reduce(
      (sum, id) => sum + (ACHIEVEMENTS_BY_ID.get(id)?.xpReward ?? 0),
      0,
    );
    if (achievementXp > 0) {
      for (const id of unlockedIds) {
        const def = ACHIEVEMENTS_BY_ID.get(id);
        if (!def || def.xpReward === 0) continue;
        const event: XpEvent = {
          id: newId(),
          ...stamps(),
          sourceType: 'ACHIEVEMENT',
          sourceId: id,
          amount: def.xpReward,
          reason: `Achievement: ${def.name}`,
          date: todayKey(),
        };
        this.changes.push({ op: 'put', store: STORES.xpEvents, value: event });
        this.xpTotal += def.xpReward;
      }
      const totalXp = Math.max(0, before.totalXp + this.xpTotal);
      const after = levelForXp(totalXp);
      const areaXp = { ...character.areaXp };
      const updated: CharacterState = {
        id: 'singleton',
        totalXp,
        level: after.level,
        rank: after.rank.title,
        areaXp,
        updatedAt: Date.now(),
      };
      // Replace rather than append a second character write.
      this.changes = this.changes.filter(
        (c) => !(c.op === 'put' && c.store === STORES.characterState),
      );
      this.put('characterState', updated);
      character = updated;
    }

    await store.commit(this.changes);

    const afterLevel = levelForXp(character.totalXp);
    return {
      xpAwarded: this.xpTotal,
      leveledUp: afterLevel.level > beforeLevel.level,
      rankedUp: afterLevel.rank.title !== beforeLevel.rank.title,
      newLevel: afterLevel.level,
      newRank: afterLevel.rank.title,
      unlockedAchievements: unlockedIds,
      createdIds: this.createdIds,
    };
  }
}

/**
 * Aggregate stats as they will stand once `written` is committed.
 *
 * Reads the live store and overlays this transaction's own rows, so an
 * achievement threshold crossed *by* the current action is seen immediately.
 */
function projectedStats(
  written: Map<string, unknown>,
  character: CharacterState,
): AchievementStats {
  const overlay = <K extends keyof StoreTypes>(name: K): StoreTypes[K][] => {
    const rows = new Map<string, StoreTypes[K]>();
    for (const row of store.get(name)) rows.set((row as { id: string }).id, row);
    for (const [key, value] of written) {
      const [storeName, id] = key.split(':');
      if (storeName === String(name)) rows.set(id!, value as StoreTypes[K]);
    }
    return Array.from(rows.values()).filter(
      (r) => (r as { deletedAt?: number | null }).deletedAt == null,
    );
  };

  const stats = emptyStats();
  const tasks = overlay('tasks');
  stats.tasksCompleted = tasks.filter((t) => t.status === 'COMPLETED').length;
  stats.journalEntries = overlay('journalEntries').length;

  const workouts = overlay('workouts');
  stats.workoutsLogged = workouts.length;

  // Focus hours come from real logged effort: task minutes plus training time.
  const taskMinutes = tasks
    .filter((t) => t.status === 'COMPLETED')
    .reduce((sum, t) => sum + (t.actualMinutes ?? t.estimatedMinutes ?? 0), 0);
  const workoutMinutes = workouts.reduce((sum, w) => sum + w.durationMinutes, 0);
  stats.focusHours = (taskMinutes + workoutMinutes) / 60;

  const goals = overlay('goals').filter((g) => g.status === 'COMPLETED');
  stats.goalsCompleted = goals.length;
  for (const g of goals) {
    stats.goalsCompletedByArea[g.area] = (stats.goalsCompletedByArea[g.area] ?? 0) + 1;
  }

  stats.projectsCompleted = overlay('projects').filter((p) => p.status === 'COMPLETED').length;
  stats.questsCompleted = overlay('quests').filter((q) => q.status === 'COMPLETED').length;
  stats.level = levelForXp(character.totalXp).level;

  // Best streak across every habit, computed from logs rather than cached.
  const logs = overlay('habitLogs');
  const logsByHabit = new Map<string, HabitLog[]>();
  for (const log of logs) {
    const list = logsByHabit.get(log.habitId);
    if (list) list.push(log);
    else logsByHabit.set(log.habitId, [log]);
  }
  let best = 0;
  for (const habit of overlay('habits')) {
    const result = calculateStreak(habit, logsByHabit.get(habit.id) ?? []);
    if (result.longest > best) best = result.longest;
  }
  stats.bestHabitStreak = best;

  return stats;
}

/* ---------------- shared helpers ---------------- */

function requireRow<K extends keyof StoreTypes>(name: K, id: string, label: string): StoreTypes[K] {
  const row = store.byId(name, id);
  if (!row || (row as { deletedAt?: number | null }).deletedAt != null) {
    throw new NotFoundError(label, id);
  }
  return row;
}

function touch<T extends { updatedAt: number }>(row: T): T {
  return { ...row, updatedAt: Date.now() };
}

/** Next order index for a sortable list. */
function nextOrder(rows: Array<{ orderIndex: number }>): number {
  return rows.reduce((max, r) => Math.max(max, r.orderIndex), -1) + 1;
}

/* ================================================================== *
 * Tasks
 * ================================================================== */

export interface TaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  projectId?: string | null;
  goalId?: string | null;
  parentTaskId?: string | null;
  dueAt?: number | null;
  estimatedMinutes?: number | null;
  recurrenceRule?: string | null;
}

function validateTask(input: TaskInput, existingId?: string): Omit<Task, keyof ReturnType<typeof stamps> | 'id'> {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const status = v.oneOf('status', input.status ?? 'TODO', ENUMS.taskStatus, 'Status');
  const priority = v.oneOf('priority', input.priority ?? 'MEDIUM', ENUMS.priority, 'Priority');
  const dueAt = v.optionalTimestamp('dueAt', input.dueAt, 'Due date');
  const estimatedMinutes = v.optionalNumber('estimatedMinutes', input.estimatedMinutes, 'Estimate', {
    min: 0,
    max: 24 * 60,
    integer: true,
  });

  // Referential integrity: a link to a row that does not exist is a bug, not a
  // preference, and must not be stored.
  const projectId = input.projectId ?? null;
  if (projectId && !store.byId('projects', projectId)) v.fail('projectId', 'That project no longer exists.');
  const goalId = input.goalId ?? null;
  if (goalId && !store.byId('goals', goalId)) v.fail('goalId', 'That goal no longer exists.');

  const parentTaskId = input.parentTaskId ?? null;
  if (parentTaskId) {
    if (!store.byId('tasks', parentTaskId)) {
      v.fail('parentTaskId', 'That parent task no longer exists.');
    } else if (existingId) {
      const byId = new Map(store.live('tasks').map((t) => [t.id, t]));
      // Enforced here, at the data layer, per TECH_SPEC section 6 - not just in the UI.
      if (wouldCreateCycle(existingId, parentTaskId, byId)) {
        v.fail('parentTaskId', 'A task cannot be its own ancestor.');
      }
    }
  }

  if (input.recurrenceRule) {
    // Rejected rather than silently dropped: a rule the app cannot honour must
    // not be stored as though it will run.
    if (!parseRecurrence(input.recurrenceRule)) {
      v.fail('recurrenceRule', 'That repeat rule is not supported.');
    }
  }

  v.assert();

  return {
    projectId,
    goalId,
    parentTaskId,
    habitId: null,
    title,
    description,
    status: status as Task['status'],
    priority: priority as Priority,
    dueAt,
    completedAt: null,
    estimatedMinutes,
    actualMinutes: null,
    recurrenceRule: input.recurrenceRule ?? null,
    recurrenceParentId: null,
    orderIndex: 0,
  };
}

export async function createTask(input: TaskInput): Promise<ActionResult> {
  const fields = validateTask(input);
  const tx = new Tx();
  tx.create('tasks', {
    id: newId(),
    ...stamps(),
    ...fields,
    orderIndex: nextOrder(store.live('tasks')),
  });
  return tx.commit();
}

export async function updateTask(id: string, input: TaskInput): Promise<ActionResult> {
  const existing = requireRow('tasks', id, 'task');
  const fields = validateTask(input, id);
  const tx = new Tx();
  tx.put('tasks', touch({ ...existing, ...fields, orderIndex: existing.orderIndex }));
  return tx.commit();
}

/**
 * Completes a task and propagates the consequences.
 *
 * Recurring tasks spawn their next instance here rather than mutating the
 * completed row, so history keeps one row per actual occurrence.
 */
export async function completeTask(id: string): Promise<ActionResult> {
  const task = requireRow('tasks', id, 'task');
  if (task.status === 'COMPLETED') return { ...EMPTY_RESULT };

  const tx = new Tx();
  const now = Date.now();
  tx.put('tasks', { ...task, status: 'COMPLETED', completedAt: now, updatedAt: now });

  const area = areaForTask(task);
  tx.awardXp('TASK', task.id, xpForTask(task), `Completed: ${task.title}`, area);

  // Schedule the next occurrence of a recurring task.
  if (task.recurrenceRule) {
    const rule = parseRecurrence(task.recurrenceRule);
    if (rule) {
      const anchor = toDayKey(task.dueAt ?? task.createdAt);
      const next = nextOccurrence(rule, anchor, toDayKey(task.dueAt ?? now));
      if (next) {
        tx.create('tasks', {
          ...task,
          id: newId(),
          ...stamps(now),
          status: 'TODO',
          completedAt: null,
          actualMinutes: null,
          dueAt: occurrenceInstant(next, task.dueAt),
          recurrenceParentId: task.recurrenceParentId ?? task.id,
          orderIndex: nextOrder(store.live('tasks')),
        });
      }
    }
  }

  return tx.commit();
}

/** Reverses a completion, including its XP. The undo path for the checkbox. */
export async function uncompleteTask(id: string): Promise<ActionResult> {
  const task = requireRow('tasks', id, 'task');
  if (task.status !== 'COMPLETED') return { ...EMPTY_RESULT };

  const tx = new Tx();
  tx.put('tasks', { ...task, status: 'TODO', completedAt: null, updatedAt: Date.now() });
  tx.reverseXp('TASK', task.id, `Reopened: ${task.title}`);
  return tx.commit();
}

export async function setTaskStatus(id: string, status: Task['status']): Promise<ActionResult> {
  if (status === 'COMPLETED') return completeTask(id);
  const task = requireRow('tasks', id, 'task');
  if (task.status === 'COMPLETED') return uncompleteTask(id);

  const tx = new Tx();
  tx.put('tasks', touch({ ...task, status }));
  return tx.commit();
}

/**
 * Soft-deletes a task and its subtrees.
 *
 * Development Master section 34 forbids silently destroying user data: the rows
 * are marked, not removed, so `restoreTask` can bring them back.
 */
export async function deleteTask(id: string): Promise<ActionResult> {
  const task = requireRow('tasks', id, 'task');
  const tx = new Tx();
  const now = Date.now();

  const all = store.live('tasks');
  const toDelete: Task[] = [task];
  const queue = [task.id];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const child of all) {
      if (child.parentTaskId === parent && !toDelete.some((t) => t.id === child.id)) {
        toDelete.push(child);
        queue.push(child.id);
      }
    }
  }

  for (const row of toDelete) {
    tx.put('tasks', { ...row, deletedAt: now, updatedAt: now });
    if (row.status === 'COMPLETED') tx.reverseXp('TASK', row.id, `Deleted: ${row.title}`);
  }
  return tx.commit();
}

export async function restoreTask(id: string): Promise<ActionResult> {
  const task = store.byId('tasks', id);
  if (!task) throw new NotFoundError('task', id);
  const tx = new Tx();
  tx.put('tasks', { ...task, deletedAt: null, updatedAt: Date.now() });
  return tx.commit();
}

/** The life area a task inherits, for per-area XP attribution. */
function areaForTask(task: Task): LifeArea | null {
  if (task.projectId) {
    const project = store.byId('projects', task.projectId);
    if (project) return project.area;
  }
  if (task.goalId) {
    const goal = store.byId('goals', task.goalId);
    if (goal) return goal.area;
  }
  return null;
}

/* ================================================================== *
 * Goals
 * ================================================================== */

export interface GoalInput {
  title: string;
  description?: string;
  area?: string;
  status?: string;
  priority?: string;
  startDate?: number | null;
  targetDate?: number | null;
  progressType?: string;
  progressValue?: number;
  targetValue?: number | null;
  unit?: string | null;
}

function validateGoal(input: GoalInput) {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const area = v.oneOf('area', input.area ?? 'Other', ENUMS.area, 'Life area');
  const status = v.oneOf('status', input.status ?? 'ACTIVE', ENUMS.goalStatus, 'Status');
  const priority = v.oneOf('priority', input.priority ?? 'MEDIUM', ENUMS.priority, 'Priority');
  const progressType = v.oneOf('progressType', input.progressType ?? 'ROLLUP', ENUMS.progressType, 'Progress type');
  const startDate = v.optionalTimestamp('startDate', input.startDate, 'Start date');
  const targetDate = v.optionalTimestamp('targetDate', input.targetDate, 'Target date');
  checkRange(v, startDate, targetDate, 'targetDate', 'Target date');

  const progressValue = v.number('progressValue', input.progressValue ?? 0, 'Progress', {
    min: 0,
    max: progressType === 'MANUAL' ? 100 : Number.MAX_SAFE_INTEGER,
  });
  const targetValue = v.optionalNumber('targetValue', input.targetValue, 'Target value', { min: 0 });

  if (progressType === 'NUMERIC' && (targetValue == null || targetValue === 0)) {
    v.fail('targetValue', 'A measured goal needs a target value above zero.');
  }

  v.assert();
  return {
    title,
    description,
    area: area as LifeArea,
    status: status as Goal['status'],
    priority: priority as Priority,
    startDate,
    targetDate,
    progressType: progressType as Goal['progressType'],
    progressValue,
    targetValue,
    unit: input.unit?.trim() || null,
  };
}

export async function createGoal(input: GoalInput): Promise<ActionResult> {
  const fields = validateGoal(input);
  const tx = new Tx();
  tx.create('goals', { id: newId(), ...stamps(), ...fields, completedAt: null });
  return tx.commit();
}

export async function updateGoal(id: string, input: GoalInput): Promise<ActionResult> {
  const existing = requireRow('goals', id, 'goal');
  const fields = validateGoal(input);
  const tx = new Tx();
  tx.put('goals', touch({ ...existing, ...fields }));
  return tx.commit();
}

export async function completeGoal(id: string): Promise<ActionResult> {
  const goal = requireRow('goals', id, 'goal');
  if (goal.status === 'COMPLETED') return { ...EMPTY_RESULT };
  const tx = new Tx();
  const now = Date.now();
  tx.put('goals', { ...goal, status: 'COMPLETED', completedAt: now, updatedAt: now });
  tx.awardXp('GOAL', goal.id, xpForGoal(), `Goal reached: ${goal.title}`, goal.area);
  return tx.commit();
}

export async function reopenGoal(id: string): Promise<ActionResult> {
  const goal = requireRow('goals', id, 'goal');
  if (goal.status !== 'COMPLETED') return { ...EMPTY_RESULT };
  const tx = new Tx();
  tx.put('goals', { ...goal, status: 'ACTIVE', completedAt: null, updatedAt: Date.now() });
  tx.reverseXp('GOAL', goal.id, `Goal reopened: ${goal.title}`);
  return tx.commit();
}

export async function archiveGoal(id: string): Promise<ActionResult> {
  const goal = requireRow('goals', id, 'goal');
  const tx = new Tx();
  tx.put('goals', touch({ ...goal, status: 'ARCHIVED' }));
  return tx.commit();
}

/**
 * Soft-deletes a goal, detaching rather than destroying its children.
 *
 * Deleting a goal must not silently take a year of tasks with it, so projects
 * and tasks are unlinked and survive on their own.
 */
export async function deleteGoal(id: string): Promise<ActionResult> {
  const goal = requireRow('goals', id, 'goal');
  const tx = new Tx();
  const now = Date.now();
  tx.put('goals', { ...goal, deletedAt: now, updatedAt: now });

  for (const project of store.live('projects').filter((p) => p.goalId === id)) {
    tx.put('projects', { ...project, goalId: null, updatedAt: now });
  }
  for (const task of store.live('tasks').filter((t) => t.goalId === id)) {
    tx.put('tasks', { ...task, goalId: null, updatedAt: now });
  }
  for (const quest of store.live('quests').filter((q) => q.goalId === id)) {
    tx.put('quests', { ...quest, goalId: null, updatedAt: now });
  }
  tx.reverseXp('GOAL', goal.id, `Deleted: ${goal.title}`);
  return tx.commit();
}

/* ================================================================== *
 * Projects and milestones
 * ================================================================== */

export interface ProjectInput {
  title: string;
  description?: string;
  goalId?: string | null;
  area?: string;
  status?: string;
  priority?: string;
  startDate?: number | null;
  deadline?: number | null;
  progressOverride?: number | null;
}

function validateProject(input: ProjectInput) {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const area = v.oneOf('area', input.area ?? 'Projects', ENUMS.area, 'Life area');
  const status = v.oneOf('status', input.status ?? 'ACTIVE', ENUMS.projectStatus, 'Status');
  const priority = v.oneOf('priority', input.priority ?? 'MEDIUM', ENUMS.priority, 'Priority');
  const startDate = v.optionalTimestamp('startDate', input.startDate, 'Start date');
  const deadline = v.optionalTimestamp('deadline', input.deadline, 'Deadline');
  checkRange(v, startDate, deadline, 'deadline', 'Deadline');

  const goalId = input.goalId ?? null;
  if (goalId && !store.byId('goals', goalId)) v.fail('goalId', 'That goal no longer exists.');

  const progressOverride = v.optionalNumber('progressOverride', input.progressOverride, 'Progress', {
    min: 0,
    max: 100,
    integer: true,
  });

  v.assert();
  return {
    title,
    description,
    goalId,
    area: area as LifeArea,
    status: status as Project['status'],
    priority: priority as Priority,
    startDate,
    deadline,
    progressOverride,
  };
}

export async function createProject(input: ProjectInput): Promise<ActionResult> {
  const fields = validateProject(input);
  const tx = new Tx();
  tx.create('projects', { id: newId(), ...stamps(), ...fields, completedAt: null });
  return tx.commit();
}

export async function updateProject(id: string, input: ProjectInput): Promise<ActionResult> {
  const existing = requireRow('projects', id, 'project');
  const fields = validateProject(input);
  const tx = new Tx();
  tx.put('projects', touch({ ...existing, ...fields }));
  return tx.commit();
}

export async function completeProject(id: string): Promise<ActionResult> {
  const project = requireRow('projects', id, 'project');
  if (project.status === 'COMPLETED') return { ...EMPTY_RESULT };
  const tx = new Tx();
  const now = Date.now();
  tx.put('projects', { ...project, status: 'COMPLETED', completedAt: now, updatedAt: now });
  tx.awardXp('PROJECT', project.id, xpForProject(), `Shipped: ${project.title}`, project.area);
  return tx.commit();
}

export async function deleteProject(id: string): Promise<ActionResult> {
  const project = requireRow('projects', id, 'project');
  const tx = new Tx();
  const now = Date.now();
  tx.put('projects', { ...project, deletedAt: now, updatedAt: now });
  // Milestones belong to the project and go with it; tasks are detached so
  // work in flight is never silently lost.
  for (const m of store.live('milestones').filter((m) => m.projectId === id)) {
    tx.put('milestones', { ...m, deletedAt: now, updatedAt: now });
  }
  for (const task of store.live('tasks').filter((t) => t.projectId === id)) {
    tx.put('tasks', { ...task, projectId: null, updatedAt: now });
  }
  tx.reverseXp('PROJECT', project.id, `Deleted: ${project.title}`);
  return tx.commit();
}

export async function createMilestone(
  projectId: string,
  input: { title: string; description?: string; targetDate?: number | null },
): Promise<ActionResult> {
  requireRow('projects', projectId, 'project');
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const targetDate = v.optionalTimestamp('targetDate', input.targetDate, 'Target date');
  v.assert();

  const siblings = store.live('milestones').filter((m) => m.projectId === projectId);
  const tx = new Tx();
  tx.create('milestones', {
    id: newId(),
    ...stamps(),
    projectId,
    title,
    description,
    targetDate,
    status: 'PENDING',
    completedAt: null,
    orderIndex: nextOrder(siblings),
  });
  return tx.commit();
}

export async function toggleMilestone(id: string): Promise<ActionResult> {
  const milestone = requireRow('milestones', id, 'milestone');
  const project = store.byId('projects', milestone.projectId);
  const tx = new Tx();
  const now = Date.now();

  if (milestone.status === 'COMPLETED') {
    tx.put('milestones', { ...milestone, status: 'PENDING', completedAt: null, updatedAt: now });
    tx.reverseXp('MILESTONE', milestone.id, `Reopened: ${milestone.title}`);
  } else {
    tx.put('milestones', { ...milestone, status: 'COMPLETED', completedAt: now, updatedAt: now });
    tx.awardXp('MILESTONE', milestone.id, xpForMilestone(), `Milestone: ${milestone.title}`, project?.area ?? null);
  }
  return tx.commit();
}

export async function deleteMilestone(id: string): Promise<ActionResult> {
  const milestone = requireRow('milestones', id, 'milestone');
  const tx = new Tx();
  const now = Date.now();
  tx.put('milestones', { ...milestone, deletedAt: now, updatedAt: now });
  if (milestone.status === 'COMPLETED') {
    tx.reverseXp('MILESTONE', milestone.id, `Deleted: ${milestone.title}`);
  }
  return tx.commit();
}

/* ================================================================== *
 * Habits
 * ================================================================== */

export interface HabitInput {
  title: string;
  description?: string;
  identity?: string;
  area?: string;
  frequency?: string;
  target?: number;
  weekdays?: number[];
  startDate?: number | null;
  endDate?: number | null;
  xpPerCompletion?: number;
  protectionAllowance?: number;
}

function validateHabit(input: HabitInput) {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const identity = v.optionalText('identity', input.identity, 'Identity', 60);
  const area = v.oneOf('area', input.area ?? 'Other', ENUMS.area, 'Life area');
  const frequency = v.oneOf('frequency', input.frequency ?? 'DAILY', ENUMS.habitFrequency, 'Frequency');
  const target = v.number('target', input.target ?? 1, 'Target', { min: 1, max: 50, integer: true });
  const weekdays = v.weekdays('weekdays', input.weekdays);
  const startDate = v.optionalTimestamp('startDate', input.startDate, 'Start date') ?? Date.now();
  const endDate = v.optionalTimestamp('endDate', input.endDate, 'End date');
  checkRange(v, startDate, endDate, 'endDate', 'End date');
  const xpPerCompletion = v.number('xpPerCompletion', input.xpPerCompletion ?? 20, 'XP', {
    min: 0,
    max: 500,
    integer: true,
  });
  const protectionAllowance = v.number(
    'protectionAllowance',
    input.protectionAllowance ?? 1,
    'Streak protections',
    { min: 0, max: 10, integer: true },
  );

  if (frequency === 'CUSTOM' && weekdays.length === 0) {
    v.fail('weekdays', 'Pick at least one day for a custom schedule.');
  }

  v.assert();
  return {
    title,
    description,
    identity,
    area: area as LifeArea,
    frequency: frequency as Habit['frequency'],
    target,
    weekdays,
    startDate,
    endDate,
    xpPerCompletion,
    protectionAllowance,
  };
}

export async function createHabit(input: HabitInput): Promise<ActionResult> {
  const fields = validateHabit(input);
  const tx = new Tx();
  tx.create('habits', { id: newId(), ...stamps(), ...fields, status: 'ACTIVE' });
  return tx.commit();
}

export async function updateHabit(id: string, input: HabitInput): Promise<ActionResult> {
  const existing = requireRow('habits', id, 'habit');
  const fields = validateHabit(input);
  const tx = new Tx();
  tx.put('habits', touch({ ...existing, ...fields }));
  return tx.commit();
}

/**
 * Toggles a habit for a day.
 *
 * XP is priced off the streak as it stood *before* this completion, so day one
 * of a new streak pays the base rate and the bonus grows honestly from there.
 */
export async function toggleHabitLog(
  habitId: string,
  day: DayKey = todayKey(),
  value: number | null = null,
): Promise<ActionResult> {
  const habit = requireRow('habits', habitId, 'habit');
  const logs = store.live('habitLogs').filter((l) => l.habitId === habitId);
  const existing = logs.find((l) => l.date === day);

  const tx = new Tx();
  const now = Date.now();

  if (existing?.completed) {
    tx.put('habitLogs', { ...existing, completed: false, updatedAt: now });
    tx.reverseXp('HABIT', existing.id, `Unlogged: ${habit.title}`);
  } else if (existing) {
    const prior = streakBefore(habit, logs, day);
    tx.put('habitLogs', { ...existing, completed: true, value, protected: false, updatedAt: now });
    tx.awardXp('HABIT', existing.id, xpForHabit(habit, prior), `Habit: ${habit.title}`, habit.area, day);
  } else {
    const prior = streakBefore(habit, logs, day);
    const log: HabitLog = {
      id: newId(),
      ...stamps(now),
      habitId,
      date: day,
      completed: true,
      value,
      protected: false,
      note: '',
    };
    tx.create('habitLogs', log);
    tx.awardXp('HABIT', log.id, xpForHabit(habit, prior), `Habit: ${habit.title}`, habit.area, day);
  }

  return tx.commit();
}

/**
 * Spends a streak protection on a missed day.
 *
 * No XP: a protected day keeps the streak alive but was not actually done, and
 * paying for it would make the ledger a lie.
 */
export async function protectHabitDay(habitId: string, day: DayKey): Promise<ActionResult> {
  const habit = requireRow('habits', habitId, 'habit');
  const logs = store.live('habitLogs').filter((l) => l.habitId === habitId);
  const used = logs.filter((l) => l.protected).length;
  if (used >= habit.protectionAllowance) {
    throw new ValidationError('No streak protections left for this habit.', {
      protection: `You have used all ${habit.protectionAllowance}.`,
    });
  }

  const tx = new Tx();
  const existing = logs.find((l) => l.date === day);
  if (existing) {
    tx.put('habitLogs', { ...existing, completed: false, protected: true, updatedAt: Date.now() });
  } else {
    tx.create('habitLogs', {
      id: newId(),
      ...stamps(),
      habitId,
      date: day,
      completed: false,
      value: null,
      protected: true,
      note: '',
    });
  }
  return tx.commit();
}

export async function setHabitStatus(id: string, status: Habit['status']): Promise<ActionResult> {
  const habit = requireRow('habits', id, 'habit');
  const tx = new Tx();
  tx.put('habits', touch({ ...habit, status }));
  return tx.commit();
}

/** Soft-deletes a habit and its history together, so a restore is coherent. */
export async function deleteHabit(id: string): Promise<ActionResult> {
  const habit = requireRow('habits', id, 'habit');
  const tx = new Tx();
  const now = Date.now();
  tx.put('habits', { ...habit, deletedAt: now, updatedAt: now });
  for (const log of store.live('habitLogs').filter((l) => l.habitId === id)) {
    tx.put('habitLogs', { ...log, deletedAt: now, updatedAt: now });
    if (log.completed) tx.reverseXp('HABIT', log.id, `Deleted habit: ${habit.title}`);
  }
  return tx.commit();
}

/* ================================================================== *
 * Calendar
 * ================================================================== */

export interface EventInput {
  title: string;
  description?: string;
  start: number;
  end: number;
  allDay?: boolean;
  location?: string;
  area?: string;
  recurrenceRule?: string | null;
  taskId?: string | null;
}

export async function createEvent(input: EventInput): Promise<ActionResult> {
  const fields = validateEvent(input);
  const tx = new Tx();
  tx.create('calendarEvents', {
    id: newId(),
    ...stamps(),
    ...fields,
    recurrenceParentId: null,
    source: 'LOCAL',
    workoutId: null,
  });
  return tx.commit();
}

function validateEvent(input: EventInput) {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const location = v.optionalText('location', input.location, 'Location', 200);
  const area = v.oneOf('area', input.area ?? 'Other', ENUMS.area, 'Life area');
  const start = v.optionalTimestamp('start', input.start, 'Start');
  const end = v.optionalTimestamp('end', input.end, 'End');
  if (start == null) v.fail('start', 'Start time is required.');
  if (end == null) v.fail('end', 'End time is required.');
  if (start != null && end != null && end < start) {
    v.fail('end', 'An event cannot end before it starts.');
  }
  const taskId = input.taskId ?? null;
  if (taskId && !store.byId('tasks', taskId)) v.fail('taskId', 'That task no longer exists.');
  v.assert();

  return {
    title,
    description,
    location,
    area: area as LifeArea,
    start: start!,
    end: end!,
    allDay: !!input.allDay,
    recurrenceRule: input.recurrenceRule ?? null,
    taskId,
  };
}

export async function updateEvent(id: string, input: EventInput): Promise<ActionResult> {
  const existing = requireRow('calendarEvents', id, 'event');
  const fields = validateEvent(input);
  const tx = new Tx();
  tx.put('calendarEvents', touch({ ...existing, ...fields }));
  return tx.commit();
}

/**
 * Moves an event by a delta, preserving its duration.
 *
 * This is what a calendar drag commits - a real persisted update, not a
 * local-only visual move.
 */
export async function moveEvent(id: string, newStart: number): Promise<ActionResult> {
  const event = requireRow('calendarEvents', id, 'event');
  const duration = event.end - event.start;
  const tx = new Tx();
  tx.put('calendarEvents', touch({ ...event, start: newStart, end: newStart + duration }));
  return tx.commit();
}

/** Resizes an event by moving its end. Used by the calendar resize handle. */
export async function resizeEvent(id: string, newEnd: number): Promise<ActionResult> {
  const event = requireRow('calendarEvents', id, 'event');
  if (newEnd <= event.start) {
    throw new ValidationError('An event cannot end before it starts.', {
      end: 'End must be after the start.',
    });
  }
  const tx = new Tx();
  tx.put('calendarEvents', touch({ ...event, end: newEnd }));
  return tx.commit();
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  const event = requireRow('calendarEvents', id, 'event');
  const tx = new Tx();
  const now = Date.now();
  tx.put('calendarEvents', { ...event, deletedAt: now, updatedAt: now });
  return tx.commit();
}

/* ================================================================== *
 * Fitness
 * ================================================================== */

export interface WorkoutInput {
  title: string;
  discipline?: string;
  date?: number;
  durationMinutes?: number;
  notes?: string;
  intensity?: number | null;
  exercises?: Array<{
    exerciseName: string;
    sets?: number;
    reps?: number;
    weight?: number | null;
    durationSeconds?: number | null;
    notes?: string;
  }>;
}

export async function logWorkout(input: WorkoutInput): Promise<ActionResult> {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const discipline = v.oneOf('discipline', input.discipline ?? 'Gym', ENUMS.discipline, 'Discipline');
  const date = v.optionalTimestamp('date', input.date ?? Date.now(), 'Date') ?? Date.now();
  const durationMinutes = v.number('durationMinutes', input.durationMinutes ?? 0, 'Duration', {
    min: 0,
    max: 24 * 60,
    integer: true,
  });
  const notes = v.optionalText('notes', input.notes, 'Notes', RULES.descriptionMax);
  const intensity = v.optionalNumber('intensity', input.intensity, 'Intensity', {
    min: 1,
    max: 10,
    integer: true,
  });

  const exercises = input.exercises ?? [];
  exercises.forEach((ex, i) => {
    v.requiredText(`exercises.${i}.exerciseName`, ex.exerciseName, 'Exercise name', 120);
    v.number(`exercises.${i}.sets`, ex.sets ?? 1, 'Sets', { min: 0, max: 99, integer: true });
    v.number(`exercises.${i}.reps`, ex.reps ?? 0, 'Reps', { min: 0, max: 999, integer: true });
    v.optionalNumber(`exercises.${i}.weight`, ex.weight, 'Weight', { min: 0, max: 1000 });
  });
  v.assert();

  const tx = new Tx();
  const workoutId = newId();
  const workout: Workout = {
    id: workoutId,
    ...stamps(),
    date,
    discipline: discipline as Workout['discipline'],
    title,
    durationMinutes,
    notes,
    intensity,
  };
  tx.create('workouts', workout);

  exercises.forEach((ex, i) => {
    const row: WorkoutExercise = {
      id: newId(),
      ...stamps(),
      workoutId,
      exerciseName: ex.exerciseName.trim(),
      sets: ex.sets ?? 1,
      reps: ex.reps ?? 0,
      weight: ex.weight ?? null,
      durationSeconds: ex.durationSeconds ?? null,
      notes: ex.notes?.trim() ?? '',
      orderIndex: i,
    };
    tx.put('workoutExercises', row);
  });

  tx.awardXp('WORKOUT', workoutId, xpForWorkout(workout), `Trained: ${title}`, 'Fitness');
  return tx.commit();
}

export async function deleteWorkout(id: string): Promise<ActionResult> {
  const workout = requireRow('workouts', id, 'workout');
  const tx = new Tx();
  const now = Date.now();
  tx.put('workouts', { ...workout, deletedAt: now, updatedAt: now });
  for (const ex of store.live('workoutExercises').filter((e) => e.workoutId === id)) {
    tx.put('workoutExercises', { ...ex, deletedAt: now, updatedAt: now });
  }
  tx.reverseXp('WORKOUT', id, `Deleted: ${workout.title}`);
  return tx.commit();
}

/* ================================================================== *
 * Journal
 * ================================================================== */

export interface JournalInput {
  title?: string;
  content: string;
  date?: DayKey;
  mood?: string | null;
  tags?: string[];
}

export async function saveJournalEntry(
  id: string | null,
  input: JournalInput,
): Promise<ActionResult> {
  const v = new Validator();
  const title = v.optionalText('title', input.title, 'Title', RULES.titleMax);
  const content = v.optionalText('content', input.content, 'Entry', RULES.journalContentMax);
  const date = v.dayKey('date', input.date ?? todayKey(), 'Date');
  const tags = v.tags('tags', input.tags);
  const mood = input.mood ? v.oneOf('mood', input.mood, ENUMS.mood, 'Mood') : null;
  if (!content) v.fail('content', 'An empty entry has nothing to save.');
  v.assert();

  const tx = new Tx();
  if (id) {
    const existing = requireRow('journalEntries', id, 'journal entry');
    tx.put('journalEntries', touch({ ...existing, title, content, date, mood, tags }));
  } else {
    const entry: JournalEntry = {
      id: newId(),
      ...stamps(),
      title,
      content,
      date,
      mood: mood as JournalEntry['mood'],
      tags,
    };
    tx.create('journalEntries', entry);
    tx.awardXp('JOURNAL', entry.id, xpForJournalEntry(), 'Journal entry', 'Mind', date);
  }
  return tx.commit();
}

export async function deleteJournalEntry(id: string): Promise<ActionResult> {
  const entry = requireRow('journalEntries', id, 'journal entry');
  const tx = new Tx();
  const now = Date.now();
  tx.put('journalEntries', { ...entry, deletedAt: now, updatedAt: now });
  tx.reverseXp('JOURNAL', id, 'Deleted journal entry');
  return tx.commit();
}

/* ================================================================== *
 * Notes
 * ================================================================== */

export interface NoteInput {
  title: string;
  content?: string;
  folder?: string;
  tags?: string[];
  links?: string[];
}

export async function saveNote(id: string | null, input: NoteInput): Promise<ActionResult> {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const content = v.optionalText('content', input.content, 'Content', RULES.noteContentMax);
  const folder = v.optionalText('folder', input.folder, 'Folder', 80);
  const tags = v.tags('tags', input.tags);
  v.assert();

  const links = (input.links ?? []).filter((l) => typeof l === 'string').slice(0, 50);
  const tx = new Tx();
  if (id) {
    const existing = requireRow('notes', id, 'note');
    tx.put('notes', touch({ ...existing, title, content, folder, tags, links }));
  } else {
    tx.create('notes', {
      id: newId(),
      ...stamps(),
      title,
      content,
      folder,
      tags,
      links,
      pinned: false,
      archived: false,
    });
  }
  return tx.commit();
}

export async function toggleNotePinned(id: string): Promise<ActionResult> {
  const note = requireRow('notes', id, 'note');
  const tx = new Tx();
  tx.put('notes', touch({ ...note, pinned: !note.pinned }));
  return tx.commit();
}

export async function toggleNoteArchived(id: string): Promise<ActionResult> {
  const note = requireRow('notes', id, 'note');
  const tx = new Tx();
  tx.put('notes', touch({ ...note, archived: !note.archived }));
  return tx.commit();
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const note = requireRow('notes', id, 'note');
  const tx = new Tx();
  const now = Date.now();
  tx.put('notes', { ...note, deletedAt: now, updatedAt: now });
  return tx.commit();
}

/* ================================================================== *
 * Quests
 * ================================================================== */

export interface QuestInput {
  title: string;
  objective?: string;
  type?: string;
  area?: string;
  goalId?: string | null;
  startDate?: number | null;
  endDate?: number | null;
  xpReward?: number;
  requirements?: Array<{ label: string; kind?: string; target?: number; refId?: string | null }>;
}

export async function createQuest(input: QuestInput): Promise<ActionResult> {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const objective = v.optionalText('objective', input.objective, 'Objective', RULES.descriptionMax);
  const type = v.oneOf('type', input.type ?? 'SIDE', ENUMS.questType, 'Quest type');
  const area = v.oneOf('area', input.area ?? 'Other', ENUMS.area, 'Life area');
  const startDate = v.optionalTimestamp('startDate', input.startDate, 'Start date');
  const endDate = v.optionalTimestamp('endDate', input.endDate, 'End date');
  checkRange(v, startDate, endDate, 'endDate', 'End date');
  const xpReward = v.number('xpReward', input.xpReward ?? 250, 'XP reward', {
    min: 0,
    max: 10_000,
    integer: true,
  });
  const goalId = input.goalId ?? null;
  if (goalId && !store.byId('goals', goalId)) v.fail('goalId', 'That goal no longer exists.');

  const requirements = input.requirements ?? [];
  if (requirements.length === 0) {
    // A quest with no requirements has nothing to measure, which is exactly the
    // "meaningless gamification" the brief rules out.
    v.fail('requirements', 'A quest needs at least one requirement to track.');
  }
  requirements.forEach((r, i) => v.requiredText(`requirements.${i}.label`, r.label, 'Requirement', 200));
  v.assert();

  const tx = new Tx();
  const questId = newId();
  tx.create('quests', {
    id: questId,
    ...stamps(),
    title,
    objective,
    type: type as Quest['type'],
    status: 'ACTIVE',
    area: area as LifeArea,
    goalId,
    startDate,
    endDate,
    xpReward,
    completedAt: null,
    orderIndex: nextOrder(store.live('quests')),
  });

  requirements.forEach((r, i) => {
    const req: QuestRequirement = {
      id: newId(),
      ...stamps(),
      questId,
      label: r.label.trim(),
      kind: (r.kind as QuestRequirement['kind']) ?? 'MANUAL',
      target: Math.max(1, Math.floor(r.target ?? 1)),
      manualProgress: 0,
      refId: r.refId ?? null,
      orderIndex: i,
    };
    tx.put('questRequirements', req);
  });

  return tx.commit();
}

export async function toggleQuestRequirement(id: string): Promise<ActionResult> {
  const req = requireRow('questRequirements', id, 'requirement');
  const tx = new Tx();
  const done = req.manualProgress >= req.target;
  tx.put('questRequirements', touch({ ...req, manualProgress: done ? 0 : req.target }));
  return tx.commit();
}

export async function completeQuest(id: string): Promise<ActionResult> {
  const quest = requireRow('quests', id, 'quest');
  if (quest.status === 'COMPLETED') return { ...EMPTY_RESULT };
  const tx = new Tx();
  const now = Date.now();
  tx.put('quests', { ...quest, status: 'COMPLETED', completedAt: now, updatedAt: now });
  tx.awardXp('QUEST', quest.id, quest.xpReward, `Quest complete: ${quest.title}`, quest.area);
  return tx.commit();
}

export async function deleteQuest(id: string): Promise<ActionResult> {
  const quest = requireRow('quests', id, 'quest');
  const tx = new Tx();
  const now = Date.now();
  tx.put('quests', { ...quest, deletedAt: now, updatedAt: now });
  for (const r of store.live('questRequirements').filter((r) => r.questId === id)) {
    tx.put('questRequirements', { ...r, deletedAt: now, updatedAt: now });
  }
  tx.reverseXp('QUEST', id, `Deleted: ${quest.title}`);
  return tx.commit();
}

/* ================================================================== *
 * Routines
 * ================================================================== */

export interface RoutineInput {
  title: string;
  description?: string;
  area?: string;
  scheduledMinute?: number | null;
  weekdays?: number[];
  xpReward?: number;
  steps?: Array<{ title: string; durationMinutes?: number | null; optional?: boolean }>;
}

export async function createRoutine(input: RoutineInput): Promise<ActionResult> {
  const v = new Validator();
  const title = v.requiredText('title', input.title, 'Title', RULES.titleMax);
  const description = v.optionalText('description', input.description, 'Description', RULES.descriptionMax);
  const area = v.oneOf('area', input.area ?? 'Other', ENUMS.area, 'Life area');
  const weekdays = v.weekdays('weekdays', input.weekdays);
  const xpReward = v.number('xpReward', input.xpReward ?? 50, 'XP reward', {
    min: 0,
    max: 1000,
    integer: true,
  });
  const scheduledMinute = v.optionalNumber('scheduledMinute', input.scheduledMinute, 'Time', {
    min: 0,
    max: 1439,
    integer: true,
  });
  const steps = input.steps ?? [];
  if (steps.length === 0) v.fail('steps', 'A routine needs at least one step.');
  steps.forEach((s, i) => v.requiredText(`steps.${i}.title`, s.title, 'Step', RULES.titleMax));
  v.assert();

  const tx = new Tx();
  const routineId = newId();
  tx.create('routines', {
    id: routineId,
    ...stamps(),
    title,
    description,
    area: area as LifeArea,
    scheduledMinute,
    weekdays,
    status: 'ACTIVE',
    xpReward,
  });
  steps.forEach((s, i) => {
    const step: RoutineStep = {
      id: newId(),
      ...stamps(),
      routineId,
      title: s.title.trim(),
      durationMinutes: s.durationMinutes ?? null,
      orderIndex: i,
      optional: !!s.optional,
    };
    tx.put('routineSteps', step);
  });
  return tx.commit();
}

/** Starts a run, or returns the one already open for today. */
export async function startRoutineRun(routineId: string, day: DayKey = todayKey()): Promise<ActionResult> {
  requireRow('routines', routineId, 'routine');
  const existing = store
    .live('routineRuns')
    .find((r) => r.routineId === routineId && r.date === day && r.completedAt == null);
  if (existing) return { ...EMPTY_RESULT, createdIds: [existing.id] };

  const tx = new Tx();
  const run: RoutineRun = {
    id: newId(),
    ...stamps(),
    routineId,
    date: day,
    startedAt: Date.now(),
    completedAt: null,
    completedStepIds: [],
    skippedStepIds: [],
  };
  tx.create('routineRuns', run);
  return tx.commit();
}

export async function toggleRoutineStep(
  runId: string,
  stepId: string,
  mode: 'complete' | 'skip' = 'complete',
): Promise<ActionResult> {
  const run = requireRow('routineRuns', runId, 'routine run');
  const completed = new Set(run.completedStepIds);
  const skipped = new Set(run.skippedStepIds);

  if (mode === 'complete') {
    skipped.delete(stepId);
    if (completed.has(stepId)) completed.delete(stepId);
    else completed.add(stepId);
  } else {
    completed.delete(stepId);
    if (skipped.has(stepId)) skipped.delete(stepId);
    else skipped.add(stepId);
  }

  const tx = new Tx();
  tx.put('routineRuns', touch({
    ...run,
    completedStepIds: Array.from(completed),
    skippedStepIds: Array.from(skipped),
  }));
  return tx.commit();
}

/** Finishes a run and pays out, prorated by how much was actually done. */
export async function finishRoutineRun(runId: string): Promise<ActionResult> {
  const run = requireRow('routineRuns', runId, 'routine run');
  if (run.completedAt != null) return { ...EMPTY_RESULT };
  const routine = requireRow('routines', run.routineId, 'routine');

  const steps = store.live('routineSteps').filter((s) => s.routineId === routine.id);
  const required = steps.filter((s) => !s.optional);
  const doneRequired = required.filter((s) => run.completedStepIds.includes(s.id)).length;
  const share = required.length === 0 ? 1 : doneRequired / required.length;

  const tx = new Tx();
  tx.put('routineRuns', touch({ ...run, completedAt: Date.now() }));
  const xp = Math.round(routine.xpReward * share);
  if (xp > 0) {
    tx.awardXp('ROUTINE', run.id, xp, `Routine: ${routine.title}`, routine.area, run.date);
  }
  return tx.commit();
}

export async function deleteRoutine(id: string): Promise<ActionResult> {
  const routine = requireRow('routines', id, 'routine');
  const tx = new Tx();
  const now = Date.now();
  tx.put('routines', { ...routine, deletedAt: now, updatedAt: now });
  for (const s of store.live('routineSteps').filter((s) => s.routineId === id)) {
    tx.put('routineSteps', { ...s, deletedAt: now, updatedAt: now });
  }
  return tx.commit();
}

/* ================================================================== *
 * Reviews
 * ================================================================== */

export async function saveReview(
  id: string | null,
  input: {
    cadence: Review['cadence'];
    periodStart: number;
    periodEnd: number;
    wins?: string;
    misses?: string;
    nextFocus?: string;
    snapshot?: Record<string, number>;
    complete?: boolean;
  },
): Promise<ActionResult> {
  const v = new Validator();
  const wins = v.optionalText('wins', input.wins, 'Wins', RULES.descriptionMax);
  const misses = v.optionalText('misses', input.misses, 'Misses', RULES.descriptionMax);
  const nextFocus = v.optionalText('nextFocus', input.nextFocus, 'Next focus', RULES.descriptionMax);
  v.assert();

  const tx = new Tx();
  const now = Date.now();
  const completedAt = input.complete ? now : null;

  if (id) {
    const existing = requireRow('reviews', id, 'review');
    const wasComplete = existing.completedAt != null;
    tx.put('reviews', touch({ ...existing, wins, misses, nextFocus, completedAt: completedAt ?? existing.completedAt }));
    if (input.complete && !wasComplete) {
      tx.awardXp('REVIEW', existing.id, xpForReview(existing.cadence), `${existing.cadence} review`, 'Mind');
    }
  } else {
    const review: Review = {
      id: newId(),
      ...stamps(now),
      cadence: input.cadence,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      wins,
      misses,
      nextFocus,
      snapshot: input.snapshot ?? {},
      completedAt,
    };
    tx.create('reviews', review);
    if (input.complete) {
      tx.awardXp('REVIEW', review.id, xpForReview(review.cadence), `${review.cadence} review`, 'Mind');
    }
  }
  return tx.commit();
}

/* ================================================================== *
 * Achievements + settings
 * ================================================================== */

/** Marks unlock notifications as seen, clearing the "NEW" badges. */
export async function markAchievementsSeen(ids: string[]): Promise<void> {
  const tx = new Tx();
  let any = false;
  for (const unlock of store.live('achievementUnlocks')) {
    if (!unlock.seen && ids.includes(unlock.achievementId)) {
      tx.put('achievementUnlocks', { ...unlock, seen: true, updatedAt: Date.now() });
      any = true;
    }
  }
  if (any) await tx.commit();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = store.settings;
  const next: Settings = { ...current, ...patch, id: 'singleton', updatedAt: Date.now() };
  await store.commit([{ op: 'put', store: STORES.settings, value: next }]);
}

/**
 * Rebuilds the cached character rollup from the XP ledger.
 *
 * The ledger is the source of truth; this exists so a rollup that somehow drifts
 * can always be recomputed rather than trusted. Exposed in Settings > Data.
 */
export async function rebuildCharacterState(): Promise<CharacterState> {
  const events = store.live('xpEvents');
  const totalXp = Math.max(0, events.reduce((sum, e) => sum + e.amount, 0));
  const areaXp: Record<string, number> = {};
  for (const event of events) {
    const area = areaForXpEvent(event);
    if (area) areaXp[area] = (areaXp[area] ?? 0) + event.amount;
  }
  const progression = levelForXp(totalXp);
  const character: CharacterState = {
    id: 'singleton',
    totalXp,
    level: progression.level,
    rank: progression.rank.title,
    areaXp,
    updatedAt: Date.now(),
  };
  await store.commit([{ op: 'put', store: STORES.characterState, value: character }]);
  return character;
}

function areaForXpEvent(event: XpEvent): LifeArea | null {
  switch (event.sourceType) {
    case 'WORKOUT':
      return 'Fitness';
    case 'JOURNAL':
    case 'REVIEW':
      return 'Mind';
    case 'GOAL': {
      const goal = event.sourceId ? store.byId('goals', event.sourceId) : null;
      return goal?.area ?? null;
    }
    case 'PROJECT': {
      const project = event.sourceId ? store.byId('projects', event.sourceId) : null;
      return project?.area ?? null;
    }
    case 'QUEST': {
      const quest = event.sourceId ? store.byId('quests', event.sourceId) : null;
      return quest?.area ?? null;
    }
    default:
      return null;
  }
}

export type { Goal, Habit, Note, Project, Task };
