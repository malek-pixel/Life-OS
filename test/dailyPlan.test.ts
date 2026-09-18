/**
 * Daily task generation: the four-task cap, links to real goals and quests,
 * persistence through the day, AI validation and fallback, regeneration and
 * the edge cases (no goals, deleted goals, completed quests, day rollover).
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import {
  completeGoal,
  completeQuest,
  completeTask,
  createGoal,
  createQuest,
  createTask,
  deleteGoal,
  type GoalInput,
} from '../src/data/actions';
import type { AiProvider } from '../src/ai/provider';
import {
  ensureDailyPlan,
  planNeedsRepair,
  regenerateDailyPlan,
  repairDailyPlan,
  replacePlanTask,
} from '../src/ai/planner';
import { MAX_DAILY_TASKS, planTasksFor, selectDailyPlan } from '../src/domain/dailyPlan';
import { selectGoal } from '../src/domain/selectors';
import { addDays, dayKeyToMs, today } from '../src/domain/dates';

async function freshDb(): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('life-os');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
  resetDbHandle();
  store._resetForTests();
  await store.hydrate();
}

beforeEach(freshDb);

const DAY = 86_400_000;

async function goal(input: Partial<GoalInput> & { title: string }): Promise<string> {
  const result = await createGoal({ area: 'Education', priority: 'MEDIUM', status: 'ACTIVE', progressType: 'MANUAL', ...input });
  return result.createdIds[0]!;
}

/** A provider that answers with whatever the test hands it. */
function fakeAi(answer: string | (() => never)): AiProvider & { calls: number } {
  const provider = {
    name: 'fake',
    calls: 0,
    isConfigured: () => true,
    async complete() {
      provider.calls++;
      if (typeof answer === 'function') answer();
      return { content: answer as string, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 }, model: 'fake' };
    },
  };
  return provider;
}

async function sixGoals(): Promise<string[]> {
  const areas = ['Education', 'Career', 'Fitness', 'Mind', 'Projects', 'Relationships'];
  const ids: string[] = [];
  for (const [i, area] of areas.entries()) {
    ids.push(await goal({ title: `Goal ${i} in ${area}`, area, priority: i < 3 ? 'HIGH' : 'MEDIUM' }));
  }
  return ids;
}

describe('daily plan generation', () => {
  it('with no goals or quests, plans the day with zero tasks and does not invent any', async () => {
    const outcome = await ensureDailyPlan();
    expect(outcome.written).toBe(true);
    expect(planTasksFor(today())).toHaveLength(0);
    expect(store.settings.dailyPlanDate).toBe(today());
    expect(selectDailyPlan(today()).planned).toBe(true);
  });

  it('never generates more than four tasks, each tied to a real goal or quest', async () => {
    const goalIds = await sixGoals();
    await createQuest({ title: 'Boss fight', type: 'BOSS', area: 'Education', goalId: goalIds[0], requirements: [{ label: 'Beat it' }] });
    await ensureDailyPlan({ useAi: false });

    const plan = planTasksFor(today());
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.length).toBeLessThanOrEqual(MAX_DAILY_TASKS);
    for (const t of plan) {
      expect(t.generated).toBe(true);
      expect(t.goalId || t.questId).toBeTruthy();
      if (t.goalId) expect(store.byId('goals', t.goalId)).toBeDefined();
      expect(t.status).toBe('TODO');
    }
    // Balanced: with six equal-ish areas, no single area takes the whole plan.
    const areas = new Set(plan.map((t) => store.byId('goals', t.goalId!)!.area));
    expect(areas.size).toBeGreaterThan(1);
    expect(new Set(plan.map((t) => t.title.toLowerCase())).size).toBe(plan.length);
  });

  it('keeps the same plan on repeated loads of the same day', async () => {
    await sixGoals();
    await ensureDailyPlan({ useAi: false });
    const first = planTasksFor(today()).map((t) => t.id);
    const ai = fakeAi('{"tasks":[]}');
    await ensureDailyPlan({ provider: ai });
    await ensureDailyPlan({ provider: ai });
    expect(planTasksFor(today()).map((t) => t.id)).toEqual(first);
    expect(ai.calls).toBe(0);
  });

  it('excludes completed goals and completed quests', async () => {
    const done = await goal({ title: 'Finished goal', priority: 'HIGH' });
    await completeGoal(done);
    const q = await createQuest({ title: 'Done quest', type: 'MAIN', requirements: [{ label: 'x' }] });
    await completeQuest(q.createdIds[0]!);
    await ensureDailyPlan({ useAi: false });
    expect(planTasksFor(today())).toHaveLength(0);
  });

  it('lets deadlines beat balance: an urgent area may take several slots', async () => {
    const soon = Date.now() + 2 * DAY;
    const sat = await goal({ title: 'SAT', area: 'Education', priority: 'HIGH', targetDate: soon });
    await createQuest({ title: 'SAT practice test', type: 'MAIN', area: 'Education', goalId: sat, endDate: soon, requirements: [{ label: 'Take it' }] });
    await goal({ title: 'Read more', area: 'Mind', priority: 'LOW' });
    await ensureDailyPlan({ useAi: false });
    const plan = planTasksFor(today());
    const education = plan.filter((t) => t.goalId === sat);
    expect(education.length).toBeGreaterThanOrEqual(1);
    // The urgent goal is planned first.
    expect(plan[0]!.goalId).toBe(sat);
  });

  it('does not dump a pile of overdue tasks onto today', async () => {
    const g = await goal({ title: 'Backlog goal' });
    for (let i = 0; i < 10; i++) {
      await createTask({ title: `Overdue ${i}`, goalId: g, dueAt: Date.now() - (i + 1) * DAY, priority: 'HIGH' });
    }
    await ensureDailyPlan({ useAi: false });
    const plan = planTasksFor(today());
    expect(plan.length).toBeLessThanOrEqual(MAX_DAILY_TASKS);
    expect(plan.length).toBeGreaterThan(0);
    // Surfaced, not duplicated: no new tasks were created for them.
    expect(store.live('tasks').filter((t) => t.title.startsWith('Overdue'))).toHaveLength(10);
  });

  it('does not change goal progress by generating tasks, only by completing them', async () => {
    const g = await goal({ title: 'Rollup goal', progressType: 'ROLLUP', priority: 'HIGH' });
    const t = await createTask({ title: 'Already done', goalId: g });
    await completeTask(t.createdIds[0]!);
    expect(selectGoal(g)!.progress.percent).toBe(100);

    await ensureDailyPlan({ useAi: false });
    expect(planTasksFor(today()).some((x) => x.goalId === g)).toBe(true);
    expect(selectGoal(g)!.progress.percent).toBe(100);
    // Nothing was completed automatically.
    expect(planTasksFor(today()).every((x) => x.status === 'TODO')).toBe(true);
  });
});

describe('AI generation', () => {
  it('validates the AI answer: unknown ids, duplicates and extras are dropped, cap enforced', async () => {
    const ids = await sixGoals();
    const answer = JSON.stringify({
      tasks: [
        { title: 'Complete 15 SAT Math questions on systems of equations', goalId: ids[0], priority: 'high', estimatedMinutes: 35 },
        { title: 'Complete 15 SAT Math questions on systems of equations', goalId: ids[0] },
        { title: 'Invented task for a goal that does not exist', goalId: 'made-up' },
        { title: 'Write the Projects section for the portfolio', goalId: ids[4], priority: 'medium' },
        { title: "Complete today's planned back workout", goalId: ids[2], estimatedMinutes: 9999 },
        { title: 'Call grandma for twenty minutes', goalId: ids[5] },
        { title: 'Update resume with internship', goalId: ids[1] },
        { title: 'Extra task beyond the cap', goalId: ids[3] },
      ],
    });
    const outcome = await ensureDailyPlan({ provider: fakeAi(`Sure! ${answer}`) });
    expect(outcome.source).toBe('ai');
    const plan = planTasksFor(today());
    expect(plan).toHaveLength(MAX_DAILY_TASKS);
    expect(plan.some((t) => t.title.includes('Invented'))).toBe(false);
    expect(plan.filter((t) => t.title.startsWith('Complete 15 SAT'))).toHaveLength(1);
    const workout = plan.find((t) => t.title.includes('back workout'));
    if (workout) expect(workout.estimatedMinutes).toBeLessThanOrEqual(240);
  });

  it('falls back to the rules when the AI fails or returns garbage', async () => {
    await sixGoals();
    const failed = await ensureDailyPlan({ provider: fakeAi(() => { throw new Error('offline'); }) });
    expect(failed.source).toBe('rules');
    expect(failed.aiError).toBe('offline');
    expect(planTasksFor(today()).length).toBeGreaterThan(0);

    // A swap opens a slot, so the AI is asked again - and answers with garbage.
    const garbage = await replacePlanTask(planTasksFor(today())[0]!.id, { provider: fakeAi('not json at all') });
    expect(garbage.aiError).toBeTruthy();
    expect(planTasksFor(today()).length).toBeLessThanOrEqual(MAX_DAILY_TASKS);
  });
});

describe('regeneration and repair', () => {
  it('regenerate keeps completed tasks, avoids duplicates and stays within four', async () => {
    await sixGoals();
    await ensureDailyPlan({ useAi: false });
    const first = planTasksFor(today());
    await completeTask(first[0]!.id);

    await regenerateDailyPlan({ useAi: false });
    const after = planTasksFor(today());
    expect(after.find((t) => t.id === first[0]!.id)?.status).toBe('COMPLETED');
    expect(after.length).toBeLessThanOrEqual(MAX_DAILY_TASKS);
    expect(new Set(after.map((t) => t.title.toLowerCase())).size).toBe(after.length);
  });

  it('regenerate preserves tasks that are still the best fit', async () => {
    await sixGoals();
    await ensureDailyPlan({ useAi: false });
    const before = planTasksFor(today()).map((t) => t.id).sort();
    await regenerateDailyPlan({ useAi: false });
    expect(planTasksFor(today()).map((t) => t.id).sort()).toEqual(before);
  });

  it('swap replaces one task with a different source', async () => {
    await sixGoals();
    await ensureDailyPlan({ useAi: false });
    const target = planTasksFor(today())[0]!;
    await replacePlanTask(target.id, { useAi: false });
    const after = planTasksFor(today());
    expect(after.some((t) => t.id === target.id)).toBe(false);
    expect(after.some((t) => t.goalId === target.goalId)).toBe(false);
    expect(after.length).toBeLessThanOrEqual(MAX_DAILY_TASKS);

    // Regenerating later the same day does not bring the swapped-out task back.
    await regenerateDailyPlan({ useAi: false });
    expect(planTasksFor(today()).some((t) => t.title === target.title)).toBe(false);
  });

  it('repairs the plan when a goal behind a task is deleted, without touching other goals', async () => {
    const ids = await sixGoals();
    await ensureDailyPlan({ useAi: false });
    const victim = planTasksFor(today())[0]!;
    await deleteGoal(victim.goalId!);
    expect(planNeedsRepair()).toBe(true);
    await repairDailyPlan();
    expect(planNeedsRepair()).toBe(false);
    expect(planTasksFor(today()).some((t) => t.id === victim.id)).toBe(false);
    expect(store.live('goals')).toHaveLength(ids.length - 1);
  });
});

describe('day rollover', () => {
  it('a new day archives or carries yesterday’s unfinished tasks, never piling them up', async () => {
    await sixGoals();
    await ensureDailyPlan({ useAi: false });
    // Pretend the plan was made yesterday.
    const yesterday = addDays(today(), -1);
    await store.commit([
      ...planTasksFor(today()).map((t) => ({
        op: 'put' as const,
        store: 'tasks' as const,
        value: { ...t, plannedFor: yesterday, dueAt: dayKeyToMs(yesterday) + DAY - 1 },
      })),
      { op: 'put', store: 'settings', value: { ...store.settings, dailyPlanDate: yesterday } },
    ]);

    await ensureDailyPlan({ useAi: false });
    const plan = planTasksFor(today());
    expect(plan.length).toBeLessThanOrEqual(MAX_DAILY_TASKS);
    const stale = store.live('tasks').filter((t) => t.plannedFor === yesterday);
    expect(stale.every((t) => t.status === 'ARCHIVED')).toBe(true);
    // Nothing open is left behind in yesterday's plan to show as overdue.
    expect(store.live('tasks').filter((t) => t.generated && t.status === 'TODO' && t.plannedFor !== today())).toHaveLength(0);
  });
});
