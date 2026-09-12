/**
 * The AI tool registry.
 *
 * TECH_SPEC section 7: tools are plain functions calling the data layer
 * directly, each declaring a name, description, input schema, validation rules,
 * a permission level and explicit error codes.
 *
 * Two guarantees the rest of the system depends on:
 *
 *  1. Tools call the same action functions the UI does, so they pass the same
 *     validation. The AI cannot write a row the UI could not have written, and
 *     it cannot bypass a business rule by going around the boundary.
 *
 *  2. Permission is enforced HERE, not in the prompt. A WRITE, DELETE or
 *     SENSITIVE tool returns a proposal that must be explicitly confirmed
 *     before `execute` runs. No amount of model output can skip that step,
 *     because the model never calls `execute` — the UI does, after the user
 *     clicks confirm.
 */

import type { AiToolSchema } from './provider';
import type { AiPermission } from '../data/schema';
import { AiError } from '../data/errors';
import { store } from '../data/store';
import {
  completeTask,
  createGoal,
  createTask,
  logWorkout,
  toggleHabitLog,
  updateTask,
} from '../data/actions';
import {
  selectDashboard,
  selectGoals,
  selectHabits,
  selectTaskViews,
  selectCalendarItems,
  search,
} from '../domain/selectors';
import {
  dayKeyToMs,
  endOfDay,
  formatDue,
  today as todayKey,
} from '../domain/dates';

export interface ToolDefinition {
  name: string;
  description: string;
  permission: AiPermission;
  /** JSON schema for the model. */
  parameters: Record<string, unknown>;
  /** Plain-language summary of what confirming will do, shown in the dialog. */
  describe: (args: Record<string, unknown>) => string;
  /** Runs the tool. READ tools run immediately; others only after confirmation. */
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** Permission levels that require an explicit confirmation round-trip. */
const NEEDS_CONFIRMATION: AiPermission[] = ['WRITE', 'DELETE', 'SENSITIVE'];

export function requiresConfirmation(permission: AiPermission): boolean {
  return NEEDS_CONFIRMATION.includes(permission);
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/* ================================================================== *
 * READ tools
 * ================================================================== */

const getTasks: ToolDefinition = {
  name: 'get_tasks',
  description:
    "List the user's tasks. Use filter 'today' for what is due today, 'open' for everything unfinished, 'overdue' for late items.",
  permission: 'READ',
  parameters: {
    type: 'object',
    properties: {
      filter: { type: 'string', enum: ['today', 'open', 'overdue', 'completed'] },
      limit: { type: 'number', description: 'Maximum tasks to return, default 20' },
    },
  },
  describe: () => 'Read your task list',
  async execute(args) {
    const filter = str(args.filter) || 'open';
    const limit = Math.min(50, num(args.limit) ?? 20);
    const now = Date.now();
    const todayEnd = endOfDay(dayKeyToMs(todayKey()));

    let views = selectTaskViews().filter((v) => v.task.status !== 'ARCHIVED');
    if (filter === 'today') {
      views = views.filter((v) => v.task.dueAt != null && v.task.dueAt <= todayEnd && v.task.status !== 'COMPLETED');
    } else if (filter === 'overdue') {
      views = views.filter((v) => v.task.status !== 'COMPLETED' && v.task.dueAt != null && v.task.dueAt < now);
    } else if (filter === 'completed') {
      views = views.filter((v) => v.task.status === 'COMPLETED');
    } else {
      views = views.filter((v) => v.task.status !== 'COMPLETED');
    }

    if (views.length === 0) return `No tasks match filter "${filter}".`;

    return views
      .slice(0, limit)
      .map(
        (v) =>
          `- [${v.task.id}] ${v.task.title} (${v.task.priority.toLowerCase()}${
            v.task.dueAt ? `, due ${formatDue(v.task.dueAt)}` : ''
          }${v.contextLabel ? `, ${v.contextLabel}` : ''})`,
      )
      .join('\n');
  },
};

const getGoals: ToolDefinition = {
  name: 'get_goals',
  description: "List the user's goals with their real progress percentages.",
  permission: 'READ',
  parameters: { type: 'object', properties: {} },
  describe: () => 'Read your goals',
  async execute() {
    const goals = selectGoals().filter((g) => g.goal.status !== 'ARCHIVED');
    if (goals.length === 0) return 'No goals yet.';
    return goals
      .map(
        (g) =>
          `- [${g.goal.id}] ${g.goal.title} — ${g.progress.percent}% (${g.goal.area}, ${g.health.toLowerCase().replace('_', ' ')})`,
      )
      .join('\n');
  },
};

const getHabits: ToolDefinition = {
  name: 'get_habits',
  description: 'List habits with their current streaks and whether they are done today.',
  permission: 'READ',
  parameters: { type: 'object', properties: {} },
  describe: () => 'Read your habits and streaks',
  async execute() {
    const habits = selectHabits().filter((h) => h.habit.status === 'ACTIVE');
    if (habits.length === 0) return 'No active habits.';
    return habits
      .map(
        (h) =>
          `- [${h.habit.id}] ${h.habit.title} — ${h.streak}-day streak, ${
            h.doneToday ? 'done today' : h.dueToday ? 'NOT done today' : 'not scheduled today'
          }, ${h.rate30}% over 30 days`,
      )
      .join('\n');
  },
};

const getCalendar: ToolDefinition = {
  name: 'get_calendar',
  description: 'List calendar events, dated tasks and workouts in a window of days from today.',
  permission: 'READ',
  parameters: {
    type: 'object',
    properties: { days: { type: 'number', description: 'How many days ahead, default 7' } },
  },
  describe: () => 'Read your calendar',
  async execute(args) {
    const days = Math.min(30, Math.max(1, num(args.days) ?? 7));
    const from = Date.now();
    const to = from + days * 86_400_000;
    const items = selectCalendarItems(from, to);
    if (items.length === 0) return `Nothing scheduled in the next ${days} days.`;
    return items
      .map((i) => `- ${new Date(i.start).toLocaleString()} — ${i.title} (${i.kind})`)
      .join('\n');
  },
};

const getDailySummary: ToolDefinition = {
  name: 'get_daily_summary',
  description:
    'A read-only aggregate of today: XP, tasks done, habits due, active goals and what is coming up. Use this first when asked what to do now.',
  permission: 'READ',
  parameters: { type: 'object', properties: {} },
  describe: () => 'Read your daily summary',
  async execute() {
    const data = selectDashboard();
    const lines = [
      `Level ${data.progression.level} (${data.progression.rank.title}), ${data.progression.totalXp} XP total.`,
      ...data.stats.map((s) => `${s.label}: ${s.value} (${s.delta})`),
      '',
      `Tasks today (${data.todayDone}/${data.todayTotal} done):`,
      ...(data.todayTasks.length === 0
        ? ['  none scheduled']
        : data.todayTasks.map(
            (t) => `  - ${t.task.title}${t.task.status === 'COMPLETED' ? ' [done]' : ''}${t.overdue ? ' [OVERDUE]' : ''}`,
          )),
      '',
      'Habits due today:',
      ...(data.habitsToday.length === 0
        ? ['  none']
        : data.habitsToday.map(
            (h) => `  - ${h.habit.title} (${h.streak}d streak)${h.doneToday ? ' [done]' : ''}`,
          )),
      '',
      'Active goals:',
      ...(data.goals.length === 0
        ? ['  none']
        : data.goals.map((g) => `  - ${g.goal.title}: ${g.progress.percent}%`)),
    ];
    return lines.join('\n');
  },
};

const searchNotes: ToolDefinition = {
  name: 'search_notes',
  description: 'Search across notes, tasks, goals and projects by keyword.',
  permission: 'READ',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  describe: (args) => `Search for "${str(args.query)}"`,
  async execute(args) {
    const query = str(args.query);
    if (!query.trim()) throw new AiError('AI_TOOL_ERROR', 'A search needs a query.');
    const hits = search(query, 10);
    if (hits.length === 0) return `Nothing matches "${query}".`;
    return hits.map((h) => `- (${h.kind}) ${h.title}: ${h.snippet}`).join('\n');
  },
};

/* ================================================================== *
 * WRITE tools - each requires an explicit confirmation
 * ================================================================== */

const createTaskTool: ToolDefinition = {
  name: 'create_task',
  description: 'Create a new task. Requires user confirmation before it is saved.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      due_at: { type: 'string', description: 'ISO 8601 date-time' },
      estimated_minutes: { type: 'number' },
    },
    required: ['title'],
  },
  describe: (args) => {
    const due = str(args.due_at);
    return `Create the task "${str(args.title)}"${due ? `, due ${new Date(due).toLocaleString()}` : ''}`;
  },
  async execute(args) {
    const result = await createTask({
      title: str(args.title),
      description: str(args.description),
      priority: str(args.priority) || 'MEDIUM',
      dueAt: args.due_at ? Date.parse(str(args.due_at)) : null,
      estimatedMinutes: num(args.estimated_minutes),
    });
    return `Created task "${str(args.title)}" (id ${result.createdIds[0]}).`;
  },
};

const updateTaskTool: ToolDefinition = {
  name: 'update_task',
  description: 'Update an existing task by id. Requires user confirmation.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      title: { type: 'string' },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      due_at: { type: 'string', description: 'ISO 8601 date-time' },
    },
    required: ['task_id'],
  },
  describe: (args) => {
    const task = store.byId('tasks', str(args.task_id));
    const due = str(args.due_at);
    return `Update "${task?.title ?? 'a task'}"${due ? ` to be due ${new Date(due).toLocaleString()}` : ''}`;
  },
  async execute(args) {
    const id = str(args.task_id);
    const existing = store.byId('tasks', id);
    if (!existing) throw new AiError('AI_TOOL_ERROR', 'That task no longer exists.');

    await updateTask(id, {
      title: str(args.title) || existing.title,
      description: existing.description,
      status: existing.status,
      priority: str(args.priority) || existing.priority,
      dueAt: args.due_at ? Date.parse(str(args.due_at)) : existing.dueAt,
      estimatedMinutes: existing.estimatedMinutes,
      projectId: existing.projectId,
      goalId: existing.goalId,
      recurrenceRule: existing.recurrenceRule,
    });
    return `Updated task "${existing.title}".`;
  },
};

const completeTaskTool: ToolDefinition = {
  name: 'complete_task',
  description: 'Mark a task complete by id. Requires user confirmation.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: { task_id: { type: 'string' } },
    required: ['task_id'],
  },
  describe: (args) => {
    const task = store.byId('tasks', str(args.task_id));
    return `Mark "${task?.title ?? 'a task'}" complete`;
  },
  async execute(args) {
    const id = str(args.task_id);
    const task = store.byId('tasks', id);
    if (!task) throw new AiError('AI_TOOL_ERROR', 'That task no longer exists.');
    const result = await completeTask(id);
    return `Completed "${task.title}" for ${result.xpAwarded} XP.`;
  },
};

const createGoalTool: ToolDefinition = {
  name: 'create_goal',
  description: 'Create a goal. Requires user confirmation.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      area: {
        type: 'string',
        enum: ['Education', 'Career', 'Fitness', 'Mind', 'Projects', 'Relationships', 'Other'],
      },
      target_date: { type: 'string', description: 'ISO 8601 date' },
    },
    required: ['title'],
  },
  describe: (args) => `Create the goal "${str(args.title)}"`,
  async execute(args) {
    const result = await createGoal({
      title: str(args.title),
      description: str(args.description),
      area: str(args.area) || 'Other',
      targetDate: args.target_date ? Date.parse(str(args.target_date)) : null,
    });
    return `Created goal "${str(args.title)}" (id ${result.createdIds[0]}).`;
  },
};

const logHabitTool: ToolDefinition = {
  name: 'log_habit',
  description: 'Log a habit as done for today by id. Requires user confirmation.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: { habit_id: { type: 'string' } },
    required: ['habit_id'],
  },
  describe: (args) => {
    const habit = store.byId('habits', str(args.habit_id));
    return `Log "${habit?.title ?? 'a habit'}" as done today`;
  },
  async execute(args) {
    const id = str(args.habit_id);
    const habit = store.byId('habits', id);
    if (!habit) throw new AiError('AI_TOOL_ERROR', 'That habit no longer exists.');
    const result = await toggleHabitLog(id);
    return `Logged "${habit.title}" for ${result.xpAwarded} XP.`;
  },
};

const logWorkoutTool: ToolDefinition = {
  name: 'log_workout',
  description: 'Log a training session. Requires user confirmation.',
  permission: 'WRITE',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      discipline: {
        type: 'string',
        enum: ['Gym', 'Kickboxing', 'Conditioning', 'Mobility', 'Recovery'],
      },
      duration_minutes: { type: 'number' },
    },
    required: ['title'],
  },
  describe: (args) =>
    `Log the session "${str(args.title)}"${args.duration_minutes ? ` (${num(args.duration_minutes)} min)` : ''}`,
  async execute(args) {
    const result = await logWorkout({
      title: str(args.title),
      discipline: str(args.discipline) || 'Gym',
      durationMinutes: num(args.duration_minutes) ?? 45,
    });
    return `Logged "${str(args.title)}" for ${result.xpAwarded} XP.`;
  },
};

/* ================================================================== *
 * Registry
 * ================================================================== */

export const TOOLS: ToolDefinition[] = [
  getDailySummary,
  getTasks,
  getGoals,
  getHabits,
  getCalendar,
  searchNotes,
  createTaskTool,
  updateTaskTool,
  completeTaskTool,
  createGoalTool,
  logHabitTool,
  logWorkoutTool,
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The schema handed to the model. */
export function toolSchemas(): AiToolSchema[] {
  return TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Runs a READ tool immediately.
 *
 * Anything above READ is refused here even if called directly — the confirmation
 * path is the only way a write reaches the data layer, and that is enforced in
 * code rather than left to the caller to remember.
 */
export async function executeReadTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new AiError('AI_TOOL_ERROR', `The AI called an unknown tool: ${name}.`);
  if (requiresConfirmation(tool.permission)) {
    throw new AiError(
      'AI_PERMISSION_DENIED',
      `${name} changes your data and must be confirmed first.`,
    );
  }
  return tool.execute(args);
}

/** Runs a confirmed tool. Only ever called from an explicit user confirmation. */
export async function executeConfirmedTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new AiError('AI_TOOL_ERROR', `Unknown tool: ${name}.`);
  return tool.execute(args);
}
