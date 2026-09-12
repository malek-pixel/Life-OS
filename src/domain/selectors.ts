/**
 * Derived views over the store.
 *
 * Every number the UI displays is produced here or in the pure modules this
 * file calls. No screen computes its own progress, streak, or XP total, which
 * is what keeps the dashboard, the analytics page and the entity pages from
 * ever disagreeing about the same fact.
 *
 * These read the store directly and return plain data. They are invoked through
 * `useSelector`, so each one runs once per committed change rather than once
 * per component render.
 */

import { store } from '../data/store';
import type {
  Goal,
  Habit,
  JournalEntry,
  LifeArea,
  Note,
  Project,
  Quest,
  QuestRequirement,
  Task,
  Workout,
  XpEvent,
} from '../data/schema';
import { LIFE_AREAS } from '../data/schema';
import {
  addDays,
  dayKeyToMs,
  daysBetween,
  endOfDay,
  lastNDays,
  startOfDay,
  startOfWeek,
  toDayKey,
  today as todayKey,
  weekDays,
  type DayKey,
} from './dates';
import {
  clampPercent,
  goalProgress,
  health,
  projectProgress,
  type GoalProgress,
  type Health,
  type ProjectProgress,
} from './progress';
import { calculateStreak, completionRate, isDueOn, weekStrip, type DayState } from './streaks';
import { levelForXp, type Progression } from './xp';
import { ACHIEVEMENTS, emptyStats, type AchievementStats } from './achievements';

/* ------------------------------------------------------------------ *
 * Index helpers - built once per selector call, shared by its rollups
 * ------------------------------------------------------------------ */

function groupBy<T, K>(rows: T[], key: (row: T) => K | null): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export interface GoalView {
  goal: Goal;
  progress: GoalProgress;
  health: Health;
  projectCount: number;
  taskCount: number;
  questCount: number;
  dueLabel: string | null;
}

export function selectGoals(): GoalView[] {
  const goals = store.live('goals');
  const projects = store.live('projects');
  const tasks = store.live('tasks');
  const milestones = store.live('milestones');
  const quests = store.live('quests');

  const projectsByGoal = groupBy(projects, (p) => p.goalId);
  const tasksByGoal = groupBy(tasks, (t) => t.goalId);
  const tasksByProject = groupBy(tasks, (t) => t.projectId);
  const milestonesByProject = groupBy(milestones, (m) => m.projectId);
  const questsByGoal = groupBy(quests, (q) => q.goalId);

  return goals.map((goal) => {
    const goalProjects = projectsByGoal.get(goal.id) ?? [];
    const goalTasks = tasksByGoal.get(goal.id) ?? [];
    const progress = goalProgress(goal, goalProjects, goalTasks, milestonesByProject, tasksByProject);

    // Count every task under the goal, whether attached directly or via a project.
    let taskCount = goalTasks.length;
    for (const project of goalProjects) taskCount += (tasksByProject.get(project.id) ?? []).length;

    return {
      goal,
      progress,
      health: health(
        progress.percent,
        goal.startDate,
        goal.targetDate,
        goal.status === 'COMPLETED',
      ),
      projectCount: goalProjects.length,
      taskCount,
      questCount: (questsByGoal.get(goal.id) ?? []).length,
      dueLabel: goal.targetDate ? shortMonth(goal.targetDate) : null,
    };
  });
}

export function selectGoal(id: string): GoalView | undefined {
  return selectGoals().find((v) => v.goal.id === id);
}

function shortMonth(ms: number): string {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    new Date(ms).getMonth()
  ]!;
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export interface ProjectView {
  project: Project;
  progress: ProjectProgress;
  health: Health;
  goal: Goal | null;
  openTasks: number;
  /** The single most urgent open task, shown as "next up". */
  nextTask: Task | null;
  /** XP earned against this project and its tasks. */
  xp: number;
}

export function selectProjects(): ProjectView[] {
  const projects = store.live('projects');
  const tasks = store.live('tasks');
  const milestones = store.live('milestones');
  const goals = new Map(store.live('goals').map((g) => [g.id, g]));
  const xpEvents = store.live('xpEvents');

  const tasksByProject = groupBy(tasks, (t) => t.projectId);
  const milestonesByProject = groupBy(milestones, (m) => m.projectId);

  return projects.map((project) => {
    const projectTasks = tasksByProject.get(project.id) ?? [];
    const open = projectTasks.filter(
      (t) => t.status !== 'COMPLETED' && t.status !== 'ARCHIVED',
    );

    const taskIds = new Set(projectTasks.map((t) => t.id));
    const xp = xpEvents
      .filter(
        (e) =>
          (e.sourceType === 'PROJECT' && e.sourceId === project.id) ||
          (e.sourceType === 'TASK' && e.sourceId != null && taskIds.has(e.sourceId)),
      )
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      project,
      progress: projectProgress(project, projectTasks, milestonesByProject.get(project.id) ?? []),
      health: health(
        projectProgress(project, projectTasks, milestonesByProject.get(project.id) ?? []).percent,
        project.startDate,
        project.deadline,
        project.status === 'COMPLETED',
      ),
      goal: project.goalId ? (goals.get(project.goalId) ?? null) : null,
      openTasks: open.length,
      nextTask: sortByUrgency(open)[0] ?? null,
      xp,
    };
  });
}

export function selectProject(id: string): ProjectView | undefined {
  return selectProjects().find((v) => v.project.id === id);
}

/** Overdue first, then soonest due, then highest priority, then oldest. */
export function sortByUrgency(tasks: Task[]): Task[] {
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return [...tasks].sort((a, b) => {
    if (a.dueAt != null && b.dueAt == null) return -1;
    if (a.dueAt == null && b.dueAt != null) return 1;
    if (a.dueAt != null && b.dueAt != null && a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    const pr = (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
    if (pr !== 0) return pr;
    return a.createdAt - b.createdAt;
  });
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export interface TaskView {
  task: Task;
  project: Project | null;
  goal: Goal | null;
  subtasks: Task[];
  /** "Education · SAT 1550+" style context line from real relationships. */
  contextLabel: string;
  xpValue: number;
  overdue: boolean;
}

export function selectTaskViews(tasks?: Task[]): TaskView[] {
  const all = tasks ?? store.live('tasks');
  const projects = new Map(store.live('projects').map((p) => [p.id, p]));
  const goals = new Map(store.live('goals').map((g) => [g.id, g]));
  const subtasksByParent = groupBy(store.live('tasks'), (t) => t.parentTaskId);
  const now = Date.now();

  return all.map((task) => {
    const project = task.projectId ? (projects.get(task.projectId) ?? null) : null;
    const goal = task.goalId
      ? (goals.get(task.goalId) ?? null)
      : project?.goalId
        ? (goals.get(project.goalId) ?? null)
        : null;

    const bits: string[] = [];
    if (project) bits.push(project.title);
    if (goal) bits.push(goal.title);
    if (bits.length === 0 && task.habitId) bits.push('Habit');

    return {
      task,
      project,
      goal,
      subtasks: subtasksByParent.get(task.id) ?? [],
      contextLabel: bits.join(' · '),
      xpValue: xpValueOf(task),
      overdue:
        task.status !== 'COMPLETED' && task.dueAt != null && task.dueAt < now,
    };
  });
}

function xpValueOf(task: Task): number {
  const base: Record<string, number> = { LOW: 10, MEDIUM: 25, HIGH: 50 };
  const effort = Math.min(60, Math.floor((task.estimatedMinutes ?? 0) / 15) * 5);
  return (base[task.priority] ?? 25) + effort;
}

export interface TaskGroup {
  label: string;
  items: TaskView[];
}

/**
 * The Today view: overdue first, then today, then anything unscheduled that is
 * already in progress. Subtasks are excluded - they show under their parent.
 */
export function selectTodayGroups(): TaskGroup[] {
  const views = selectTaskViews().filter(
    (v) => v.task.parentTaskId == null && v.task.status !== 'ARCHIVED',
  );
  const today = todayKey();
  const todayEnd = endOfDay(dayKeyToMs(today));
  const todayStart = startOfDay(dayKeyToMs(today));

  const open = views.filter((v) => v.task.status !== 'COMPLETED');
  const overdue = open.filter((v) => v.task.dueAt != null && v.task.dueAt < todayStart);
  const dueToday = views.filter(
    (v) => v.task.dueAt != null && v.task.dueAt >= todayStart && v.task.dueAt <= todayEnd,
  );
  const inProgress = open.filter((v) => v.task.dueAt == null && v.task.status === 'IN_PROGRESS');

  const groups: TaskGroup[] = [];
  if (overdue.length > 0) groups.push({ label: 'OVERDUE', items: sortViews(overdue) });
  groups.push({ label: 'TODAY', items: sortViews(dueToday) });
  if (inProgress.length > 0) groups.push({ label: 'IN PROGRESS', items: sortViews(inProgress) });
  return groups;
}

/** The List view: everything open, bucketed by horizon. */
export function selectListGroups(): TaskGroup[] {
  const views = selectTaskViews().filter(
    (v) =>
      v.task.parentTaskId == null &&
      v.task.status !== 'ARCHIVED' &&
      v.task.status !== 'COMPLETED',
  );
  const today = todayKey();
  const weekEnd = endOfDay(dayKeyToMs(addDays(today, 7)));
  const todayStart = startOfDay(dayKeyToMs(today));

  const thisWeek = views.filter(
    (v) => v.task.dueAt != null && v.task.dueAt >= todayStart && v.task.dueAt <= weekEnd,
  );
  const later = views.filter((v) => v.task.dueAt != null && v.task.dueAt > weekEnd);
  const overdue = views.filter((v) => v.task.dueAt != null && v.task.dueAt < todayStart);
  const someday = views.filter((v) => v.task.dueAt == null);

  const groups: TaskGroup[] = [];
  if (overdue.length > 0) groups.push({ label: 'OVERDUE', items: sortViews(overdue) });
  if (thisWeek.length > 0) groups.push({ label: 'THIS WEEK', items: sortViews(thisWeek) });
  if (later.length > 0) groups.push({ label: 'LATER', items: sortViews(later) });
  if (someday.length > 0) groups.push({ label: 'NO DATE', items: sortViews(someday) });
  return groups;
}

/** Completed tasks, most recent first. */
export function selectCompletedTasks(limit = 50): TaskView[] {
  return selectTaskViews()
    .filter((v) => v.task.status === 'COMPLETED')
    .sort((a, b) => (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0))
    .slice(0, limit);
}

function sortViews(views: TaskView[]): TaskView[] {
  const order = sortByUrgency(views.map((v) => v.task));
  const index = new Map(order.map((t, i) => [t.id, i]));
  return [...views].sort((a, b) => (index.get(a.task.id) ?? 0) - (index.get(b.task.id) ?? 0));
}

/* ------------------------------------------------------------------ *
 * Habits
 * ------------------------------------------------------------------ */

export interface HabitView {
  habit: Habit;
  streak: number;
  longest: number;
  pendingToday: boolean;
  dueToday: boolean;
  doneToday: boolean;
  rate30: number;
  week: Array<{ day: DayKey; state: DayState }>;
  protectionsLeft: number;
}

export function selectHabits(): HabitView[] {
  const habits = store.live('habits');
  const logsByHabit = groupBy(store.live('habitLogs'), (l) => l.habitId);
  const today = todayKey();
  const days = weekDays(today, store.settings.weekStartsMonday);

  return habits.map((habit) => {
    const logs = logsByHabit.get(habit.id) ?? [];
    const streak = calculateStreak(habit, logs, today);
    const todayLog = logs.find((l) => l.date === today);
    const used = logs.filter((l) => l.protected).length;

    return {
      habit,
      streak: streak.current,
      longest: streak.longest,
      pendingToday: streak.pendingToday,
      dueToday: isDueOn(habit, today),
      doneToday: !!todayLog?.completed,
      rate30: completionRate(habit, logs, 30, today),
      week: weekStrip(habit, logs, days, today),
      protectionsLeft: Math.max(0, habit.protectionAllowance - used),
    };
  });
}

/** Average completion rate across active habits, for the header stat. */
export function selectHabitRate(): number {
  const views = selectHabits().filter((v) => v.habit.status === 'ACTIVE');
  if (views.length === 0) return 0;
  return Math.round(views.reduce((sum, v) => sum + v.rate30, 0) / views.length);
}

/* ------------------------------------------------------------------ *
 * XP and progression
 * ------------------------------------------------------------------ */

export function selectProgression(): Progression {
  return levelForXp(store.character.totalXp);
}

/** XP earned on a given local day. */
export function selectXpOnDay(day: DayKey): number {
  return store
    .live('xpEvents')
    .filter((e) => e.date === day)
    .reduce((sum, e) => sum + e.amount, 0);
}

/** XP per day across a window, oldest first. */
export function selectXpSeries(days: number): Array<{ day: DayKey; xp: number }> {
  const keys = lastNDays(days);
  const byDay = new Map<DayKey, number>();
  for (const event of store.live('xpEvents')) {
    byDay.set(event.date, (byDay.get(event.date) ?? 0) + event.amount);
  }
  return keys.map((day) => ({ day, xp: byDay.get(day) ?? 0 }));
}

/** The XP ledger, newest first, for "why did I gain XP today". */
export function selectXpLedger(limit = 100): XpEvent[] {
  return [...store.live('xpEvents')]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

export interface DashboardStat {
  label: string;
  value: string;
  delta: string;
  tone: 'accent' | 'muted';
}

export interface DashboardData {
  progression: Progression;
  stats: DashboardStat[];
  todayTasks: TaskView[];
  todayDone: number;
  todayTotal: number;
  habitsToday: HabitView[];
  goals: GoalView[];
  quests: QuestView[];
  upcoming: Array<{ label: string; title: string; color: string; at: number }>;
  hasAnyData: boolean;
}

export function selectDashboard(): DashboardData {
  const today = todayKey();
  const progression = selectProgression();

  const todayGroups = selectTodayGroups();
  const todayTasks = todayGroups.flatMap((g) => g.items);
  const todayDone = todayTasks.filter((v) => v.task.status === 'COMPLETED').length;

  const habits = selectHabits().filter((v) => v.habit.status === 'ACTIVE' && v.dueToday);
  const goals = selectGoals()
    .filter((v) => v.goal.status !== 'ARCHIVED' && v.goal.status !== 'COMPLETED')
    .sort((a, b) => b.progress.percent - a.progress.percent)
    .slice(0, 4);

  const quests = selectQuests()
    .filter((v) => v.quest.status === 'ACTIVE')
    .slice(0, 3);

  /* --- the four header stats, all from real rows --- */
  const bestStreak = selectHabits().reduce((max, v) => Math.max(max, v.streak), 0);
  const xpToday = selectXpOnDay(today);
  const xpYesterday = selectXpOnDay(addDays(today, -1));
  const focusMinutes = focusMinutesOn(today);

  const stats: DashboardStat[] = [
    {
      label: 'DAY STREAK',
      value: String(bestStreak),
      delta: bestStreak > 0 ? 'best active' : 'none yet',
      tone: bestStreak > 0 ? 'accent' : 'muted',
    },
    {
      label: 'XP TODAY',
      value: String(xpToday),
      delta: deltaLabel(xpToday, xpYesterday),
      tone: xpToday >= xpYesterday ? 'accent' : 'muted',
    },
    {
      label: 'TASKS DONE',
      value: `${todayDone}/${todayTasks.length}`,
      delta: 'today',
      tone: 'muted',
    },
    {
      label: 'FOCUS HRS',
      value: (focusMinutes / 60).toFixed(1),
      delta: focusMinutes > 0 ? 'logged' : 'none logged',
      tone: focusMinutes > 0 ? 'accent' : 'muted',
    },
  ];

  /* --- what is coming up, from calendar events and dated tasks --- */
  const now = Date.now();
  const horizon = now + 7 * 86_400_000;
  const upcoming: DashboardData['upcoming'] = [];

  for (const event of store.live('calendarEvents')) {
    if (event.start >= now && event.start <= horizon) {
      upcoming.push({
        label: relativeLabel(event.start),
        title: event.title,
        color: areaHex(event.area),
        at: event.start,
      });
    }
  }
  for (const view of selectTaskViews()) {
    const due = view.task.dueAt;
    if (view.task.status === 'COMPLETED' || due == null) continue;
    if (due >= now && due <= horizon) {
      upcoming.push({
        label: relativeLabel(due),
        title: view.task.title,
        color: view.task.priority === 'HIGH' ? '#C23A54' : '#9E304A',
        at: due,
      });
    }
  }
  upcoming.sort((a, b) => a.at - b.at);

  const hasAnyData =
    store.live('tasks').length > 0 ||
    store.live('goals').length > 0 ||
    store.live('habits').length > 0 ||
    store.live('projects').length > 0;

  return {
    progression,
    stats,
    todayTasks,
    todayDone,
    todayTotal: todayTasks.length,
    habitsToday: habits,
    goals,
    quests,
    upcoming: upcoming.slice(0, 6),
    hasAnyData,
  };
}

/** Logged effort for a day: completed task minutes plus training minutes. */
function focusMinutesOn(day: DayKey): number {
  const start = dayKeyToMs(day);
  const end = endOfDay(start);

  const taskMinutes = store
    .live('tasks')
    .filter(
      (t) =>
        t.status === 'COMPLETED' &&
        t.completedAt != null &&
        t.completedAt >= start &&
        t.completedAt <= end,
    )
    .reduce((sum, t) => sum + (t.actualMinutes ?? t.estimatedMinutes ?? 0), 0);

  const workoutMinutes = store
    .live('workouts')
    .filter((w) => w.date >= start && w.date <= end)
    .reduce((sum, w) => sum + w.durationMinutes, 0);

  return taskMinutes + workoutMinutes;
}

function deltaLabel(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? 'first today' : 'none yet';
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return 'level';
  return `${change > 0 ? '+' : ''}${change}%`;
}

function relativeLabel(ms: number): string {
  const diff = daysBetween(todayKey(), toDayKey(ms));
  if (diff === 0) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (diff === 1) return 'Tomorrow';
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms).getDay()]!;
}

export function areaHex(area: LifeArea): string {
  const map: Record<string, string> = {
    Education: '#7B9AD0',
    Career: '#D4708A',
    Fitness: '#4C6FAE',
    Mind: '#7BB08A',
    Projects: '#C25B72',
    Relationships: '#9E7BB0',
    Other: '#8A8B94',
  };
  return map[area] ?? '#8A8B94';
}

/* ------------------------------------------------------------------ *
 * Quests
 * ------------------------------------------------------------------ */

export interface QuestView {
  quest: Quest;
  requirements: Array<{ requirement: QuestRequirement; progress: number; met: boolean; label: string }>;
  met: number;
  total: number;
  percent: number;
  goal: Goal | null;
}

export function selectQuests(): QuestView[] {
  const quests = store.live('quests');
  const requirements = groupBy(store.live('questRequirements'), (r) => r.questId);
  const goals = new Map(store.live('goals').map((g) => [g.id, g]));

  const tasks = store.live('tasks');
  const milestones = store.live('milestones');
  const workouts = store.live('workouts');
  const habitLogs = groupBy(store.live('habitLogs'), (l) => l.habitId);
  const habits = new Map(store.live('habits').map((h) => [h.id, h]));

  return quests
    .map((quest) => {
      const reqs = (requirements.get(quest.id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex);

      const resolved = reqs.map((requirement) => {
        // Each requirement is measured against real rows, never a stored percent.
        let progress = 0;
        switch (requirement.kind) {
          case 'TASK_COUNT':
            progress = tasks.filter(
              (t) =>
                t.status === 'COMPLETED' &&
                (requirement.refId == null || t.projectId === requirement.refId),
            ).length;
            break;
          case 'MILESTONE':
            progress = milestones.filter(
              (m) =>
                m.status === 'COMPLETED' &&
                (requirement.refId == null || m.projectId === requirement.refId),
            ).length;
            break;
          case 'WORKOUT_COUNT':
            progress = workouts.length;
            break;
          case 'HABIT_STREAK': {
            const habit = requirement.refId ? habits.get(requirement.refId) : undefined;
            progress = habit
              ? calculateStreak(habit, habitLogs.get(habit.id) ?? []).current
              : 0;
            break;
          }
          default:
            progress = requirement.manualProgress;
        }
        const met = progress >= requirement.target;
        return {
          requirement,
          progress,
          met,
          label:
            requirement.target > 1
              ? `${Math.min(progress, requirement.target)} / ${requirement.target}`
              : met
                ? 'done'
                : 'pending',
        };
      });

      const met = resolved.filter((r) => r.met).length;
      return {
        quest,
        requirements: resolved,
        met,
        total: resolved.length,
        percent: resolved.length === 0 ? 0 : clampPercent((met / resolved.length) * 100),
        goal: quest.goalId ? (goals.get(quest.goalId) ?? null) : null,
      };
    })
    .sort((a, b) => a.quest.orderIndex - b.quest.orderIndex);
}

/* ------------------------------------------------------------------ *
 * Fitness
 * ------------------------------------------------------------------ */

export interface PersonalRecord {
  exercise: string;
  weight: number;
  reps: number;
  at: number;
  /** Change against the previous best, in kg. Null when it is the first record. */
  delta: number | null;
}

export interface FitnessData {
  sessionsThisWeek: number;
  volumeThisWeek: number;
  trainStreak: number;
  totalSessions: number;
  records: PersonalRecord[];
  disciplines: Array<{ name: string; count: number; color: string }>;
  recent: Array<{ workout: Workout; exerciseCount: number; volume: number }>;
  weekVolume: Array<{ day: DayKey; volume: number }>;
}

export function selectFitness(): FitnessData {
  const workouts = [...store.live('workouts')].sort((a, b) => b.date - a.date);
  const exercises = groupBy(store.live('workoutExercises'), (e) => e.workoutId);
  const today = todayKey();
  const weekStart = dayKeyToMs(startOfWeek(today, store.settings.weekStartsMonday));

  const thisWeek = workouts.filter((w) => w.date >= weekStart);
  const volumeOf = (workoutId: string): number =>
    (exercises.get(workoutId) ?? []).reduce(
      (sum, e) => sum + e.sets * e.reps * (e.weight ?? 0),
      0,
    );

  /* --- personal records: heaviest set per exercise, from real logged sets --- */
  const bestByExercise = new Map<string, PersonalRecord>();
  const historyByExercise = new Map<string, number[]>();
  for (const workout of [...workouts].sort((a, b) => a.date - b.date)) {
    for (const ex of exercises.get(workout.id) ?? []) {
      if (ex.weight == null || ex.weight <= 0) continue;
      const history = historyByExercise.get(ex.exerciseName) ?? [];
      const previousBest = history.length > 0 ? Math.max(...history) : null;
      history.push(ex.weight);
      historyByExercise.set(ex.exerciseName, history);

      const current = bestByExercise.get(ex.exerciseName);
      if (!current || ex.weight > current.weight) {
        bestByExercise.set(ex.exerciseName, {
          exercise: ex.exerciseName,
          weight: ex.weight,
          reps: ex.reps,
          at: workout.date,
          delta: previousBest != null ? Math.round((ex.weight - previousBest) * 10) / 10 : null,
        });
      }
    }
  }

  /* --- consecutive days with a session, ending today or yesterday --- */
  const trainedDays = new Set(workouts.map((w) => toDayKey(w.date)));
  let trainStreak = 0;
  let cursor = trainedDays.has(today) ? today : addDays(today, -1);
  while (trainedDays.has(cursor)) {
    trainStreak++;
    cursor = addDays(cursor, -1);
  }

  const disciplineColors: Record<string, string> = {
    Gym: '#9E304A',
    Kickboxing: '#C25B72',
    Conditioning: '#4C6FAE',
    Mobility: '#7B9AD0',
    Recovery: '#7BB08A',
  };
  const disciplineCounts = new Map<string, number>();
  for (const w of thisWeek) {
    disciplineCounts.set(w.discipline, (disciplineCounts.get(w.discipline) ?? 0) + 1);
  }

  return {
    sessionsThisWeek: thisWeek.length,
    volumeThisWeek: Math.round(thisWeek.reduce((sum, w) => sum + volumeOf(w.id), 0)),
    trainStreak,
    totalSessions: workouts.length,
    records: Array.from(bestByExercise.values()).sort((a, b) => b.at - a.at).slice(0, 6),
    disciplines: Array.from(disciplineCounts.entries()).map(([name, count]) => ({
      name,
      count,
      color: disciplineColors[name] ?? '#8A8B94',
    })),
    recent: workouts.slice(0, 8).map((workout) => ({
      workout,
      exerciseCount: (exercises.get(workout.id) ?? []).length,
      volume: Math.round(volumeOf(workout.id)),
    })),
    weekVolume: weekDays(today, store.settings.weekStartsMonday).map((day) => {
      const start = dayKeyToMs(day);
      const end = endOfDay(start);
      const volume = workouts
        .filter((w) => w.date >= start && w.date <= end)
        .reduce((sum, w) => sum + volumeOf(w.id), 0);
      return { day, volume: Math.round(volume) };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

export interface AnalyticsData {
  lifeScore: number | null;
  domainScores: Array<{ name: LifeArea; score: number | null; color: string }>;
  weekBars: Array<{ day: DayKey; label: string; score: number }>;
  xpTrend: Array<{ day: DayKey; xp: number }>;
  totals: {
    tasksCompleted: number;
    habitsLogged: number;
    workouts: number;
    journalEntries: number;
    notes: number;
    totalXp: number;
  };
  hasEnoughData: boolean;
}

/**
 * The Life OS Score.
 *
 * UI/UX section 28-29 keeps this explicitly optional and non-reductive, so it
 * is `null` rather than 0 when there is not enough real data to say anything -
 * an honest "not yet" instead of a made-up number.
 */
export function selectAnalytics(): AnalyticsData {
  const today = todayKey();
  const goals = selectGoals();
  const habits = selectHabits();
  const projects = selectProjects();
  const fitness = selectFitness();

  const domainScores = LIFE_AREAS.filter((a) => a !== 'Other').map((area) => ({
    name: area,
    score: scoreForArea(area, goals, habits, projects, fitness),
    color: areaHex(area),
  }));

  const scored = domainScores.filter((d) => d.score != null).map((d) => d.score!);
  const lifeScore =
    scored.length === 0 ? null : Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);

  /* --- a daily "how much moved" score, from completions and logs --- */
  const days = weekDays(today, store.settings.weekStartsMonday);
  const weekBars = days.map((day) => {
    const start = dayKeyToMs(day);
    const end = endOfDay(start);
    const tasksDone = store
      .live('tasks')
      .filter(
        (t) => t.completedAt != null && t.completedAt >= start && t.completedAt <= end,
      ).length;
    const habitsDone = store
      .live('habitLogs')
      .filter((l) => l.date === day && l.completed).length;
    const trained = store.live('workouts').some((w) => w.date >= start && w.date <= end) ? 1 : 0;
    // Weighted so a day is not dominated by a long checklist.
    const raw = tasksDone * 12 + habitsDone * 14 + trained * 20;
    return {
      day,
      label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(start).getDay()]!,
      score: Math.min(100, raw),
    };
  });

  const events = store.live('xpEvents');

  return {
    lifeScore,
    domainScores,
    weekBars,
    xpTrend: selectXpSeries(30),
    totals: {
      tasksCompleted: store.live('tasks').filter((t) => t.status === 'COMPLETED').length,
      habitsLogged: store.live('habitLogs').filter((l) => l.completed).length,
      workouts: store.live('workouts').length,
      journalEntries: store.live('journalEntries').length,
      notes: store.live('notes').length,
      totalXp: store.character.totalXp,
    },
    // Below a week of history, trend charts say more than the data supports.
    hasEnoughData: events.length > 0 && new Set(events.map((e) => e.date)).size >= 3,
  };
}

/**
 * Per-area score, or null when that area has nothing tracked.
 *
 * Blends goal progress, habit consistency and project health for the area -
 * every input a real stored number.
 */
function scoreForArea(
  area: LifeArea,
  goals: GoalView[],
  habits: HabitView[],
  projects: ProjectView[],
  fitness: FitnessData,
): number | null {
  const parts: number[] = [];

  const areaGoals = goals.filter((g) => g.goal.area === area && g.goal.status !== 'ARCHIVED');
  if (areaGoals.length > 0) {
    parts.push(areaGoals.reduce((sum, g) => sum + g.progress.percent, 0) / areaGoals.length);
  }

  const areaHabits = habits.filter((h) => h.habit.area === area && h.habit.status === 'ACTIVE');
  if (areaHabits.length > 0) {
    parts.push(areaHabits.reduce((sum, h) => sum + h.rate30, 0) / areaHabits.length);
  }

  const areaProjects = projects.filter(
    (p) => p.project.area === area && p.project.status !== 'ARCHIVED',
  );
  if (areaProjects.length > 0) {
    parts.push(areaProjects.reduce((sum, p) => sum + p.progress.percent, 0) / areaProjects.length);
  }

  if (area === 'Fitness' && fitness.totalSessions > 0) {
    // Five sessions a week reads as a full score for the training component.
    parts.push(Math.min(100, (fitness.sessionsThisWeek / 5) * 100));
  }

  if (parts.length === 0) return null;
  return clampPercent(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/** Aggregate stats for the achievements screen. */
export function selectAchievementStats(): AchievementStats {
  const stats = emptyStats();
  const tasks = store.live('tasks');

  stats.tasksCompleted = tasks.filter((t) => t.status === 'COMPLETED').length;
  stats.journalEntries = store.live('journalEntries').length;
  stats.workoutsLogged = store.live('workouts').length;
  stats.projectsCompleted = store.live('projects').filter((p) => p.status === 'COMPLETED').length;
  stats.questsCompleted = store.live('quests').filter((q) => q.status === 'COMPLETED').length;
  stats.level = levelForXp(store.character.totalXp).level;
  stats.bestHabitStreak = selectHabits().reduce((max, v) => Math.max(max, v.longest), 0);

  const completedGoals = store.live('goals').filter((g) => g.status === 'COMPLETED');
  stats.goalsCompleted = completedGoals.length;
  for (const goal of completedGoals) {
    stats.goalsCompletedByArea[goal.area] = (stats.goalsCompletedByArea[goal.area] ?? 0) + 1;
  }

  const taskMinutes = tasks
    .filter((t) => t.status === 'COMPLETED')
    .reduce((sum, t) => sum + (t.actualMinutes ?? t.estimatedMinutes ?? 0), 0);
  const workoutMinutes = store.live('workouts').reduce((sum, w) => sum + w.durationMinutes, 0);
  stats.focusHours = (taskMinutes + workoutMinutes) / 60;

  return stats;
}

export interface AchievementView {
  def: (typeof ACHIEVEMENTS)[number];
  unlocked: boolean;
  unlockedAt: number | null;
  isNew: boolean;
  progress: number;
  progressLabel: string;
}

/* ------------------------------------------------------------------ *
 * Life Map
 * ------------------------------------------------------------------ */

export interface LifeAreaView {
  name: LifeArea;
  score: number | null;
  color: string;
  goals: number;
  habits: number;
  projects: number;
  xp: number;
}

export function selectLifeAreas(): LifeAreaView[] {
  const analytics = selectAnalytics();
  const goals = store.live('goals');
  const habits = store.live('habits');
  const projects = store.live('projects');
  const areaXp = store.character.areaXp;

  return LIFE_AREAS.filter((a) => a !== 'Other').map((area) => ({
    name: area,
    score: analytics.domainScores.find((d) => d.name === area)?.score ?? null,
    color: areaHex(area),
    goals: goals.filter((g) => g.area === area && g.status !== 'ARCHIVED').length,
    habits: habits.filter((h) => h.area === area && h.status === 'ACTIVE').length,
    projects: projects.filter((p) => p.area === area && p.status !== 'ARCHIVED').length,
    xp: areaXp[area] ?? 0,
  }));
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

export interface TimelineEvent {
  id: string;
  at: number;
  kind: 'task' | 'goal' | 'project' | 'milestone' | 'workout' | 'journal' | 'achievement' | 'quest' | 'levelup';
  title: string;
  detail: string;
  color: string;
}

/**
 * The life timeline, assembled from real completion records only.
 *
 * Nothing here is synthesised: every entry corresponds to a stored row with a
 * real timestamp, per master prompt section 36.
 */
export function selectTimeline(limit = 100): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const t of store.live('tasks')) {
    if (t.status === 'COMPLETED' && t.completedAt != null) {
      out.push({
        id: `task-${t.id}`,
        at: t.completedAt,
        kind: 'task',
        title: t.title,
        detail: 'Task completed',
        color: '#9E304A',
      });
    }
  }
  for (const g of store.live('goals')) {
    if (g.completedAt != null) {
      out.push({
        id: `goal-${g.id}`,
        at: g.completedAt,
        kind: 'goal',
        title: g.title,
        detail: `Goal reached · ${g.area}`,
        color: areaHex(g.area),
      });
    }
  }
  for (const p of store.live('projects')) {
    if (p.completedAt != null) {
      out.push({
        id: `project-${p.id}`,
        at: p.completedAt,
        kind: 'project',
        title: p.title,
        detail: 'Project shipped',
        color: '#C25B72',
      });
    }
  }
  for (const m of store.live('milestones')) {
    if (m.completedAt != null) {
      out.push({
        id: `milestone-${m.id}`,
        at: m.completedAt,
        kind: 'milestone',
        title: m.title,
        detail: 'Milestone',
        color: '#7B9AD0',
      });
    }
  }
  for (const w of store.live('workouts')) {
    out.push({
      id: `workout-${w.id}`,
      at: w.date,
      kind: 'workout',
      title: w.title,
      detail: `${w.discipline} · ${w.durationMinutes} min`,
      color: '#4C6FAE',
    });
  }
  for (const j of store.live('journalEntries')) {
    out.push({
      id: `journal-${j.id}`,
      at: j.createdAt,
      kind: 'journal',
      title: j.title || 'Journal entry',
      detail: 'Reflection',
      color: '#7BB08A',
    });
  }
  for (const q of store.live('quests')) {
    if (q.completedAt != null) {
      out.push({
        id: `quest-${q.id}`,
        at: q.completedAt,
        kind: 'quest',
        title: q.title,
        detail: `Quest complete · +${q.xpReward} XP`,
        color: '#D4708A',
      });
    }
  }
  for (const u of store.live('achievementUnlocks')) {
    const def = ACHIEVEMENTS.find((a) => a.id === u.achievementId);
    if (!def) continue;
    out.push({
      id: `achievement-${u.id}`,
      at: u.unlockedAt,
      kind: 'achievement',
      title: def.name,
      detail: def.description,
      color: def.color,
    });
  }

  return out.sort((a, b) => b.at - a.at).slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface SearchHit {
  id: string;
  kind: 'task' | 'goal' | 'project' | 'note' | 'journal' | 'habit' | 'quest' | 'workout';
  title: string;
  snippet: string;
  route: string;
  score: number;
}

/**
 * Cross-entity search.
 *
 * Substring matching over titles and bodies, ranked so a title hit beats a body
 * hit and an exact prefix beats a mid-word match. At single-user data volumes
 * this needs no index - TECH_SPEC section 14 is explicit that this is not where
 * engineering effort belongs.
 */
export function search(query: string, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const hits: SearchHit[] = [];

  const add = (
    kind: SearchHit['kind'],
    id: string,
    title: string,
    body: string,
    route: string,
  ) => {
    const t = title.toLowerCase();
    const b = body.toLowerCase();
    let score = 0;
    if (t === q) score = 100;
    else if (t.startsWith(q)) score = 80;
    else if (t.includes(q)) score = 60;
    else if (b.includes(q)) score = 30;
    else return;

    hits.push({
      id,
      kind,
      title,
      snippet: snippetAround(body, q) || title,
      route,
      score,
    });
  };

  for (const t of store.live('tasks')) add('task', t.id, t.title, t.description, `/tasks?open=${t.id}`);
  for (const g of store.live('goals')) add('goal', g.id, g.title, g.description, `/goals/${g.id}`);
  for (const p of store.live('projects')) add('project', p.id, p.title, p.description, `/projects/${p.id}`);
  for (const n of store.live('notes')) add('note', n.id, n.title, n.content, `/notes?open=${n.id}`);
  for (const j of store.live('journalEntries')) {
    add('journal', j.id, j.title || `Entry · ${j.date}`, j.content, `/journal?open=${j.id}`);
  }
  for (const h of store.live('habits')) add('habit', h.id, h.title, h.description, `/habits`);
  for (const q2 of store.live('quests')) add('quest', q2.id, q2.title, q2.objective, `/quests`);
  for (const w of store.live('workouts')) add('workout', w.id, w.title, w.notes, `/fitness`);

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

function snippetAround(text: string, query: string, radius = 60): string {
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/* ------------------------------------------------------------------ *
 * Journal and notes
 * ------------------------------------------------------------------ */

export function selectJournal(): JournalEntry[] {
  return [...store.live('journalEntries')].sort((a, b) => b.date.localeCompare(a.date));
}

export function selectNotes(): Note[] {
  return [...store.live('notes')].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

export interface CalendarItem {
  id: string;
  title: string;
  start: number;
  end: number;
  color: string;
  kind: 'event' | 'task' | 'workout';
  allDay: boolean;
  sourceId: string;
}

/**
 * Everything that appears on the calendar for a window: real events, dated
 * tasks, and logged workouts. Tasks and workouts are read-only overlays - they
 * are edited from their own screens, not dragged around here.
 */
export function selectCalendarItems(fromMs: number, toMs: number): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const event of store.live('calendarEvents')) {
    if (event.end < fromMs || event.start > toMs) continue;
    items.push({
      id: `event-${event.id}`,
      sourceId: event.id,
      title: event.title,
      start: event.start,
      end: event.end,
      color: areaHex(event.area),
      kind: 'event',
      allDay: event.allDay,
    });
  }

  for (const task of store.live('tasks')) {
    if (task.dueAt == null || task.status === 'ARCHIVED') continue;
    if (task.dueAt < fromMs || task.dueAt > toMs) continue;
    items.push({
      id: `task-${task.id}`,
      sourceId: task.id,
      title: task.title,
      start: task.dueAt,
      // A due date is a point in time; it is drawn as a 30-minute block so it
      // is visible, not because it occupies half an hour.
      end: task.dueAt + 30 * 60_000,
      color: task.priority === 'HIGH' ? '#C23A54' : '#9E304A',
      kind: 'task',
      allDay: false,
    });
  }

  for (const workout of store.live('workouts')) {
    if (workout.date < fromMs || workout.date > toMs) continue;
    items.push({
      id: `workout-${workout.id}`,
      sourceId: workout.id,
      title: workout.title,
      start: workout.date,
      end: workout.date + Math.max(30, workout.durationMinutes) * 60_000,
      color: '#B5566B',
      kind: 'workout',
      allDay: false,
    });
  }

  return items.sort((a, b) => a.start - b.start);
}

