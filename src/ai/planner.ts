/**
 * The daily planner: decides today's tasks and writes them.
 *
 *   ensureDailyPlan()     once per local day, on the dashboard
 *   regenerateDailyPlan() the "Regenerate" button
 *   replacePlanTask(id)   swap one task for another
 *   repairDailyPlan()     drop tasks whose goal or quest was deleted/finished, top up
 *
 * The deterministic engine (domain/dailyPlan.ts) always runs: it decides which
 * tasks to keep and how many slots are open. When the AI is reachable it writes
 * the new tasks from structured context and must answer in JSON; every item is
 * validated against real goal and quest ids and the result is cut to the open
 * slots. Anything wrong with the AI - offline, rate limited, malformed, empty -
 * falls back to the deterministic picks, so the plan always works.
 */

import { applyDailyPlan, type DailyPlanResult, type PlannedTaskInput } from '../data/actions';
import { store } from '../data/store';
import { SYNC_AVAILABLE, syncNow } from '../data/sync';
import type { Priority, Task } from '../data/schema';
import { addDays, daysBetween, toDayKey, today as todayKey, type DayKey } from '../domain/dates';
import {
  MAX_DAILY_TASKS,
  buildCandidates,
  buildPlanContext,
  emptyTaken,
  isPlanTaskValid,
  markTaken,
  normalizeTitle,
  planTasksFor,
  selectCandidates,
  sourceKeyOf,
  takenFromTask,
  type PlanCandidate,
  type PlanContext,
  type Taken,
} from '../domain/dailyPlan';
import { groqProvider, type AiProvider } from './provider';
import { logUsage } from './coach';

export type PlanSource = 'ai' | 'rules' | 'none';

export interface PlannerOutcome extends DailyPlanResult {
  source: PlanSource;
  /** Why the AI was not used, when it was attempted and failed. */
  aiError: string | null;
}

const AI_TIMEOUT_MS = 20_000;

/** One planner run at a time per tab; a second call joins the first. */
let inFlight: Promise<PlannerOutcome> | null = null;

function exclusive(run: () => Promise<PlannerOutcome>): Promise<PlannerOutcome> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

const NOTHING: PlannerOutcome = { written: false, created: 0, carried: 0, dropped: 0, source: 'none', aiError: null };

/* ================================================================== *
 * Entry points
 * ================================================================== */

/** Plans today if it has not been planned yet. Safe to call on every render. */
export function ensureDailyPlan(options: { provider?: AiProvider; useAi?: boolean } = {}): Promise<PlannerOutcome> {
  const day = todayKey();
  if (store.status !== 'ready' || store.settings.dailyPlanDate === day) return Promise.resolve(NOTHING);
  return exclusive(async () => {
    // Another device may already have planned today: pull before deciding.
    if (SYNC_AVAILABLE) await syncNow().catch(() => undefined);
    if (store.settings.dailyPlanDate === day) return NOTHING;
    return plan(day, 'new-day', options);
  });
}

/** Recomputes priorities and replaces the tasks that no longer make the cut. */
export function regenerateDailyPlan(options: { provider?: AiProvider; useAi?: boolean } = {}): Promise<PlannerOutcome> {
  return exclusive(() => plan(todayKey(), 'regenerate', options));
}

/** Replaces one open task with the best alternative. */
export function replacePlanTask(taskId: string, options: { provider?: AiProvider; useAi?: boolean } = {}): Promise<PlannerOutcome> {
  return exclusive(() => plan(todayKey(), 'replace', { ...options, replaceId: taskId }));
}

/** Removes plan tasks that no longer point at live work and tops up. No AI call. */
export function repairDailyPlan(): Promise<PlannerOutcome> {
  const day = todayKey();
  if (store.settings.dailyPlanDate !== day) return Promise.resolve(NOTHING);
  if (!planTasksFor(day).some((t) => t.status !== 'COMPLETED' && !isPlanTaskValid(t))) return Promise.resolve(NOTHING);
  return exclusive(() => plan(day, 'repair', { useAi: false }));
}

/** True when an open task in today's plan points at a deleted or finished goal/quest. */
export function planNeedsRepair(day: DayKey = todayKey()): boolean {
  return (
    store.settings.dailyPlanDate === day &&
    planTasksFor(day).some((t) => t.status !== 'COMPLETED' && !isPlanTaskValid(t))
  );
}

/* ================================================================== *
 * The run
 * ================================================================== */

type Mode = 'new-day' | 'regenerate' | 'replace' | 'repair';

async function plan(
  day: DayKey,
  mode: Mode,
  options: { provider?: AiProvider; useAi?: boolean; replaceId?: string },
): Promise<PlannerOutcome> {
  const ctx = buildPlanContext(day);
  const current = planTasksFor(day);
  const completed = current.filter((t) => t.status === 'COMPLETED');
  const open = current.filter((t) => t.status !== 'COMPLETED');

  const drop = new Set<string>();
  for (const t of open) if (!isPlanTaskValid(t)) drop.add(t.id);
  if (mode === 'replace' && options.replaceId) drop.add(options.replaceId);

  const candidates = buildCandidates(ctx);
  const keep: Task[] = [];

  if (mode === 'regenerate') {
    // Keep an open task only if its source still ranks in today's top picks.
    const taken = emptyTaken();
    for (const t of completed) takenFromTask(taken, t);
    for (const t of store.get('tasks')) {
      if (t.generated && t.plannedFor === day && t.deletedAt != null) taken.sourceKeys.add(sourceKeyOf(t));
    }
    const ranked = selectCandidates(
      [...candidates, ...open.filter((t) => !drop.has(t.id)).map((t) => candidateFromTask(t, candidates))],
      MAX_DAILY_TASKS - completed.length,
      taken,
    );
    const survivors = new Set(ranked.map((c) => c.existingTaskId).filter(Boolean));
    for (const t of open) {
      if (drop.has(t.id)) continue;
      if (survivors.has(t.id)) keep.push(t);
      else drop.add(t.id);
    }
  } else {
    for (const t of open) if (!drop.has(t.id)) keep.push(t);
  }

  const taken = emptyTaken();
  for (const t of [...completed, ...keep]) takenFromTask(taken, t);
  // Never offer back what is being replaced now, or what was swapped out earlier today.
  for (const t of current) {
    if (drop.has(t.id)) {
      taken.titles.add(normalizeTitle(t.title));
      if (mode === 'replace') taken.sourceKeys.add(sourceKeyOf(t));
    }
  }
  for (const t of store.get('tasks')) {
    if (t.generated && t.plannedFor === day && t.deletedAt != null) {
      taken.titles.add(normalizeTitle(t.title));
      taken.sourceKeys.add(sourceKeyOf(t));
    }
  }

  const slots = Math.max(0, MAX_DAILY_TASKS - completed.length - keep.length);

  // Yesterday's unfinished generated tasks compete for today's slots on merit.
  const carryPool = mode === 'new-day' ? carryCandidates(day, candidates) : [];
  const base = cloneTaken(taken);
  const picks = selectCandidates([...candidates, ...carryPool], slots, taken);

  const carry = picks.filter((c) => c.existingTaskId).map((c) => c.existingTaskId!);
  // What the AI must avoid: today's kept tasks plus whatever is being carried in.
  const aiTaken = cloneTaken(base);
  for (const c of picks) if (c.existingTaskId) markTaken(aiTaken, c);
  let create: PlannedTaskInput[] = picks.filter((c) => !c.existingTaskId).map(toInput);
  let source: PlanSource = picks.length > 0 ? 'rules' : 'none';
  let aiError: string | null = null;

  const aiSlots = slots - carry.length;
  const provider = options.provider ?? groqProvider;
  if (options.useAi !== false && mode !== 'repair' && aiSlots > 0 && create.length > 0 && provider.isConfigured()) {
    try {
      const fromAi = await generateWithAi(provider, ctx, candidates, aiSlots, [...completed, ...keep], aiTaken);
      if (fromAi.length > 0) {
        // The AI may fill fewer slots than the rules found; top up from the rules only
        // with sources the AI did not already cover.
        const covered = new Set(fromAi.map((t) => t.questId ?? t.goalId));
        const titles = new Set(fromAi.map((t) => normalizeTitle(t.title)));
        const topUp = create.filter((c) => !covered.has(c.questId ?? c.goalId) && !titles.has(normalizeTitle(c.title)));
        create = [...fromAi, ...topUp].slice(0, aiSlots);
        source = 'ai';
      }
    } catch (err) {
      aiError = err instanceof Error ? err.message : 'AI generation failed.';
    }
  }

  const result = await applyDailyPlan({
    day,
    onlyIfUnplanned: mode === 'new-day',
    drop: [...drop],
    carry,
    create,
  });
  return { ...result, source: result.written ? source : 'none', aiError };
}

function cloneTaken(t: Taken): Taken {
  return {
    sourceKeys: new Set(t.sourceKeys),
    goalKeys: new Map(t.goalKeys),
    areas: new Map(t.areas),
    titles: new Set(t.titles),
    minutes: t.minutes,
  };
}

/** A stored plan task as a candidate, scored like the source it came from. */
function candidateFromTask(task: Task, candidates: PlanCandidate[]): PlanCandidate {
  const key = sourceKeyOf(task);
  const match = candidates.find((c) => c.sourceKey === key || c.existingTaskId === task.id);
  const goal = task.goalId ? store.byId('goals', task.goalId) : undefined;
  return {
    title: task.title,
    description: task.description,
    goalId: task.goalId,
    questId: task.questId ?? null,
    existingTaskId: task.id,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes ?? 30,
    area: match?.area ?? goal?.area ?? 'Other',
    sourceKey: key,
    goalKey: task.goalId ? `goal:${task.goalId}` : key,
    // A small continuity bonus: an equally good task should not churn.
    score: (match?.score ?? 25) + 4,
    urgent: match?.urgent ?? false,
    recurring: match?.recurring ?? false,
    reason: 'already planned',
  };
}

/** Unfinished generated tasks from the last three days, as candidates for today. */
function carryCandidates(day: DayKey, candidates: PlanCandidate[]): PlanCandidate[] {
  const since = addDays(day, -3);
  return store
    .live('tasks')
    .filter(
      (t) =>
        t.generated &&
        t.plannedFor != null &&
        t.plannedFor < day &&
        t.plannedFor >= since &&
        t.status !== 'COMPLETED' &&
        t.status !== 'ARCHIVED' &&
        isPlanTaskValid(t),
    )
    .map((t) => candidateFromTask(t, candidates))
    // A task carried for days is a sign it is the wrong task, not a reason to keep pushing it.
    .map((c) => ({ ...c, score: c.score - 6 * Math.max(0, daysBetween(store.byId('tasks', c.existingTaskId!)!.plannedFor!, day) - 1) }));
}

function toInput(c: PlanCandidate): PlannedTaskInput {
  return {
    title: c.title,
    description: c.description,
    goalId: c.goalId,
    questId: c.questId,
    priority: c.priority,
    estimatedMinutes: c.estimatedMinutes,
  };
}

/* ================================================================== *
 * AI generation
 * ================================================================== */

async function generateWithAi(
  provider: AiProvider,
  ctx: PlanContext,
  candidates: PlanCandidate[],
  slots: number,
  planned: Task[],
  taken: Taken,
): Promise<PlannedTaskInput[]> {
  const context = buildAiContext(ctx, candidates, slots, planned);
  const model = store.settings.aiModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const completion = await provider.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(context) },
      ],
      [],
      { model, signal: controller.signal },
    );
    promptTokens = completion.usage.promptTokens;
    completionTokens = completion.usage.completionTokens;
    const tasks = parseAiPlan(completion.content, ctx, slots, taken);
    await logUsage({ model: completion.model, totalPrompt: promptTokens, totalCompletion: completionTokens, toolCallCount: 0, ok: true });
    if (tasks.length === 0) throw new Error('The AI returned no usable tasks.');
    return tasks;
  } catch (err) {
    await logUsage({
      model,
      totalPrompt: promptTokens,
      totalCompletion: completionTokens,
      toolCallCount: 0,
      ok: false,
      errorCode: (err as { code?: string }).code ?? 'AI_PLAN_INVALID',
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `You plan one day for the user of Life OS, a personal operating system.
You receive JSON describing the user's real active goals, quests, progress, deadlines and recent activity.
Return ONLY a JSON object, no prose, in exactly this shape:
{"tasks":[{"title":string,"description":string,"goalId":string|null,"questId":string|null,"priority":"high"|"medium"|"low","estimatedMinutes":number}]}

Rules:
- Return at most "slots" tasks. Fewer is fine; never add filler to reach the limit.
- Each task is ONE specific, measurable action finishable today (5-180 minutes), e.g. "Complete 15 SAT Math questions on systems of equations", never vague like "Work on SAT".
- Every task must use a goalId and/or questId copied exactly from the input. Never invent goals, quests, progress or achievements.
- Prefer the ranked "suggestedSources" order: deadlines first, then high priority, then Boss/Main quests, then Daily/Weekly consistency. Side quests last unless nearly overdue.
- Balance life areas when nothing is urgent; an approaching deadline may take several slots.
- Use progress: near-complete work gets finishing tasks; barely-started work gets the next logical first step.
- Do not repeat any title in "recentTasks" or "alreadyPlannedToday". For recurring work, vary it (new topic, review mistakes, next section).
- Title under 110 characters. Description one short sentence of practical detail.`;

function buildAiContext(ctx: PlanContext, candidates: PlanCandidate[], slots: number, planned: Task[]) {
  const goalsById = new Map(ctx.goals.map((g) => [g.id, g]));
  const recent = store
    .live('tasks')
    .filter((t) => t.plannedFor && t.plannedFor < ctx.day && t.plannedFor >= addDays(ctx.day, -7))
    .map((t) => ({ day: t.plannedFor, title: t.title, done: t.status === 'COMPLETED' }));

  const ranked = [...candidates].sort((a, b) => b.score - a.score).slice(0, 10);
  return {
    today: ctx.day,
    weekday: new Date().toLocaleDateString('en', { weekday: 'long' }),
    slots,
    alreadyPlannedToday: planned.map((t) => ({ title: t.title, done: t.status === 'COMPLETED' })),
    suggestedSources: ranked.map((c) => ({
      goalId: c.goalId,
      questId: c.questId,
      why: c.reason,
      exampleStep: c.title,
    })),
    goals: ctx.goals.map((g) => ({
      id: g.id,
      title: g.title,
      area: g.area,
      priority: g.priority,
      deadline: g.targetDate ? toDayKey(g.targetDate) : null,
      progressPercent: ctx.goalPercent.get(g.id) ?? 0,
      ...(g.progressType === 'NUMERIC' ? { current: g.progressValue, target: g.targetValue, unit: g.unit } : {}),
    })),
    quests: ctx.quests.map((v) => ({
      id: v.quest.id,
      title: v.quest.title,
      type: v.quest.type,
      objective: v.quest.objective,
      goalId: v.quest.goalId && goalsById.has(v.quest.goalId) ? v.quest.goalId : null,
      deadline: v.quest.endDate ? toDayKey(v.quest.endDate) : null,
      requirements: v.requirements.map((r) => ({ label: r.requirement.label, progress: r.label, met: r.met })),
    })),
    recentTasks: recent,
    habitsDueToday: [...ctx.habitDueToday]
      .filter(([, due]) => due)
      .map(([id]) => ({ title: ctx.habitTitle.get(id), doneToday: ctx.habitDoneToday.get(id) ?? false })),
    workoutLoggedToday: ctx.workoutLoggedToday,
    todaysEvents: store
      .live('calendarEvents')
      .filter((e) => toDayKey(e.start) === ctx.day)
      .map((e) => e.title),
  };
}

/**
 * Validates an AI answer. Exported for tests.
 *
 * Anything not traceable to a live goal or quest is discarded, as are duplicates
 * and titles already done recently. The result is cut to `slots` no matter how
 * many the model returned.
 */
export function parseAiPlan(
  content: string,
  ctx: PlanContext,
  slots: number,
  taken: Taken = emptyTaken(),
): PlannedTaskInput[] {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI did not return JSON.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('The AI returned malformed JSON.');
  }
  const items = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(items)) throw new Error('The AI response had no task list.');

  const goals = new Map(ctx.goals.map((g) => [g.id, g]));
  const quests = new Map(ctx.quests.map((v) => [v.quest.id, v.quest]));
  const titles = new Set(taken.titles);
  const perSource = new Map<string, number>();
  const out: PlannedTaskInput[] = [];

  for (const raw of items) {
    if (out.length >= Math.min(slots, MAX_DAILY_TASKS)) break;
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    const title = typeof item.title === 'string' ? item.title.trim().replace(/\s+/g, ' ') : '';
    if (title.length < 8 || title.length > 160) continue;
    const key = normalizeTitle(title);
    if (titles.has(key) || ctx.recentlyCompletedTitles.has(key)) continue;

    const quest = typeof item.questId === 'string' ? quests.get(item.questId) : undefined;
    let goal = typeof item.goalId === 'string' ? goals.get(item.goalId) : undefined;
    if (!goal && quest?.goalId) goal = goals.get(quest.goalId);
    if (!goal && !quest) continue;

    const sourceKey = quest ? `quest:${quest.id}` : `goal:${goal!.id}`;
    // A source already in today's plan (or just swapped out) does not get another slot.
    if (taken.sourceKeys.has(sourceKey) || (perSource.get(sourceKey) ?? 0) >= 2) continue;

    const minutes = Number(item.estimatedMinutes);
    const priority = String(item.priority ?? '').toUpperCase();
    out.push({
      title,
      description: typeof item.description === 'string' ? item.description.trim().slice(0, 400) : '',
      goalId: goal?.id ?? null,
      questId: quest?.id ?? null,
      priority: (['HIGH', 'MEDIUM', 'LOW'].includes(priority) ? priority : (goal?.priority ?? 'MEDIUM')) as Priority,
      estimatedMinutes: Number.isFinite(minutes) ? Math.min(240, Math.max(5, Math.round(minutes))) : 30,
    });
    titles.add(key);
    perSource.set(sourceKey, (perSource.get(sourceKey) ?? 0) + 1);
  }
  return out;
}
