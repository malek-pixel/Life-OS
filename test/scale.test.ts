/**
 * Performance at realistic scale.
 *
 * An empty database proves nothing about responsiveness. This loads roughly a
 * heavy year of use - thousands of tasks, daily habit logs, hundreds of notes
 * and a matching XP ledger - then times the selectors every screen renders
 * from. Budgets are deliberately generous (they run on CI-class machines and in
 * Node, not a tuned browser) but tight enough to catch an accidental O(n^2):
 * at this size a quadratic selector takes seconds, not milliseconds.
 *
 * Rows are written straight into the store rather than through actions, which
 * would take minutes for this volume; shapes match what the actions produce.
 */

import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';

import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import { newId } from '../src/data/ids';
import {
  search,
  selectAnalytics,
  selectDashboard,
  selectGoals,
  selectHabits,
  selectListGroups,
  selectProjects,
  selectTimeline,
  selectTodayGroups,
} from '../src/domain/selectors';
import { addDays, today } from '../src/domain/dates';

const DAY = 86_400_000;
const TASKS = 3000;
const HABITS = 40;
const NOTES = 500;

function time(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('life-os');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  resetDbHandle();
  store._resetForTests();
  await store.hydrate();

  const now = Date.now();
  const stamp = (at: number) => ({ createdAt: at, updatedAt: at, deletedAt: null });

  const goals = Array.from({ length: 12 }, (_, i) => ({
    id: newId(), ...stamp(now - 300 * DAY), title: `Goal ${i}`, description: '', area: 'Career',
    status: 'ACTIVE', priority: 'MEDIUM', startDate: null, targetDate: now + 90 * DAY,
    progressMode: 'AUTO', manualProgress: null, measureUnit: null, measureStart: null,
    measureTarget: null, measureCurrent: null, parentGoalId: null, orderIndex: i,
  }));
  const projects = Array.from({ length: 40 }, (_, i) => ({
    id: newId(), ...stamp(now - 200 * DAY), title: `Project ${i}`, description: '', area: 'Career',
    status: 'ACTIVE', priority: 'MEDIUM', goalId: goals[i % goals.length]!.id, startDate: null,
    dueDate: now + 30 * DAY, progressOverride: null, orderIndex: i,
  }));
  const tasks = Array.from({ length: TASKS }, (_, i) => {
    const done = i % 3 === 0;
    const created = now - (i % 365) * DAY;
    return {
      id: newId(), ...stamp(created), title: `Task number ${i} about quarterly planning`,
      description: 'Some notes', status: done ? 'COMPLETED' : 'TODO',
      priority: (['LOW', 'MEDIUM', 'HIGH'] as const)[i % 3], area: 'Career',
      projectId: i % 4 === 0 ? projects[i % projects.length]!.id : null,
      goalId: i % 7 === 0 ? goals[i % goals.length]!.id : null, parentTaskId: null,
      dueAt: now + ((i % 60) - 30) * DAY, completedAt: done ? created + DAY : null,
      estimateMinutes: 30, actualMinutes: null, recurrenceRule: null, recurrenceParentId: null,
      orderIndex: i, tags: [],
    };
  });
  const habits = Array.from({ length: HABITS }, (_, i) => ({
    id: newId(), ...stamp(now - 365 * DAY), title: `Habit ${i}`, description: '', area: 'Mind',
    frequency: 'DAILY', scheduleDays: [], weeklyTarget: null, targetValue: null, unit: null,
    identity: '', startDate: now - 365 * DAY, archivedAt: null, orderIndex: i,
  }));
  const habitLogs = habits.flatMap((h) =>
    Array.from({ length: 365 }, (_, d) => ({
      id: newId(), ...stamp(now - d * DAY), habitId: h.id, date: addDays(today(), -d),
      completed: d % 5 !== 0, value: null, protected: false, note: '',
    })),
  );
  const notes = Array.from({ length: NOTES }, (_, i) => ({
    id: newId(), ...stamp(now - i * DAY), title: `Note ${i} on aerodynamics`, content: 'Long body text '.repeat(40),
    area: 'Mind', tags: ['f1'], pinned: false, linkedGoalId: null, linkedProjectId: null,
  }));
  const xpEvents = [...tasks.filter((t) => t.status === 'COMPLETED'), ...habitLogs.filter((l) => l.completed)].map((row) => ({
    id: newId(), ...stamp(row.createdAt), sourceType: 'habitId' in row ? 'HABIT' : 'TASK', sourceId: row.id,
    amount: 25, reason: 'Seeded for scale test', date: 'date' in row ? row.date : addDays(today(), 0),
  }));

  await store.replaceAll({ goals, projects, tasks, habits, habitLogs, notes, xpEvents } as never);
}, 60_000);

describe('selectors at a heavy year of data', () => {
  it('loaded the intended volume', () => {
    expect(store.live('tasks')).toHaveLength(TASKS);
    expect(store.live('habitLogs')).toHaveLength(HABITS * 365);
    expect(store.live('xpEvents').length).toBeGreaterThan(10_000);
  });

  it('hydrates from disk quickly', async () => {
    store._resetForTests();
    resetDbHandle();
    const start = performance.now();
    await store.hydrate();
    const ms = performance.now() - start;
    expect(store.live('tasks')).toHaveLength(TASKS);
    expect(ms).toBeLessThan(3000);
  });

  // Budgets per render. A screen recomputes its selector when the store changes.
  const budgets: Array<[string, () => unknown, number]> = [
    ['dashboard', selectDashboard, 250],
    ['task list', selectListGroups, 250],
    ['today', selectTodayGroups, 250],
    ['goals', selectGoals, 250],
    ['projects', selectProjects, 250],
    ['habits (40 habits x 365 logs)', selectHabits, 400],
    ['analytics', selectAnalytics, 400],
    ['timeline', () => selectTimeline(100), 400],
    ['search, common term', () => search('planning'), 150],
    ['search, no match', () => search('zzzz-nothing'), 150],
  ];

  /*
   * Each run follows a real write, so memoized selectors recompute from cold.
   * Timing repeated calls at one store version would only measure a cache hit,
   * which is not what happens after the user ticks a checkbox.
   */
  const touch = () =>
    store.commit([{ op: 'put', store: 'settings', value: { ...store.settings, updatedAt: Date.now() } }]);

  for (const [name, fn, budget] of budgets) {
    it(`${name} stays under ${budget}ms after a write`, async () => {
      fn(); // warm up the JIT once, as a real session would have
      const runs: number[] = [];
      for (let i = 0; i < 3; i++) {
        await touch();
        runs.push(time(fn));
      }
      expect(Math.min(...runs)).toBeLessThan(budget);
    });
  }

  it('shares one habits computation between readers in the same render', async () => {
    await touch();
    const cold = time(selectHabits);
    const warm = time(selectHabits);
    expect(warm).toBeLessThan(Math.max(1, cold / 10));
  });

  it('caps search results rather than returning thousands of hits', () => {
    expect(search('Task', 30).length).toBeLessThanOrEqual(30);
  });
});
