/**
 * The seeded 2026-27 plan, against a real IndexedDB: exact rows, links,
 * tracking from real data, idempotence, and no XP until a quest is claimed.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import {
  completeQuest,
  createGoal,
  createHabit,
  deleteQuest,
  linkQuestRequirementHabit,
  logWorkout,
  toggleQuestRequirement,
} from '../src/data/actions';
import { seedPlan2026 } from '../src/data/seeds/plan2026';
import { selectQuests } from '../src/domain/selectors';
import { dayKeyToMs, toDayKey } from '../src/domain/dates';

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

const questView = (title: string) => selectQuests().find((q) => q.quest.title === title)!;

describe('2026-27 plan seed', () => {
  it('creates all ten goals with the exact areas, priorities, dates and measurement', async () => {
    const result = await seedPlan2026();
    expect(result).toEqual({ goalsCreated: 10, questsCreated: 10 });

    const goals = store.live('goals');
    expect(goals).toHaveLength(10);
    const sat = goals.find((g) => g.title === 'Score 1350+ on the SAT')!;
    expect(sat).toMatchObject({ area: 'Education', priority: 'HIGH', progressType: 'NUMERIC', targetValue: 1350, unit: 'SAT score', progressValue: 0, status: 'ACTIVE' });
    expect(toDayKey(sat.startDate!)).toBe('2026-09-14');
    expect(toDayKey(sat.targetDate!)).toBe('2026-12-05');

    const byArea = (area: string) => goals.filter((g) => g.area === area).length;
    expect([byArea('Education'), byArea('Fitness'), byArea('Mind'), byArea('Career'), byArea('Projects'), byArea('Relationships'), byArea('Other')]).toEqual([3, 1, 2, 1, 1, 1, 1]);
    expect(goals.filter((g) => g.priority === 'MEDIUM').map((g) => g.area).sort()).toEqual(['Education', 'Mind', 'Relationships']);
    expect(goals.filter((g) => g.progressType === 'MANUAL')).toHaveLength(4);
    for (const g of goals) expect(g.targetDate!).toBeGreaterThan(g.startDate!);
  });

  it('links every quest to its goal with the right type, reward and tracking', async () => {
    await seedPlan2026();
    const goals = new Map(store.live('goals').map((g) => [g.id, g.title]));
    const expected: Array<[string, string, string, number, string, number]> = [
      ['SAT Diagnostic', 'Score 1350+ on the SAT', 'BOSS', 500, 'MANUAL', 1],
      ['Build My SAT Attack Plan', 'Score 1350+ on the SAT', 'MAIN', 300, 'MANUAL', 1],
      ['First College Essay Draft', 'Write strong first drafts of my college essays', 'MAIN', 500, 'MANUAL', 1],
      ['Portfolio Showcase', 'Make my F1 Data Project, InGen Archive and Life OS fully presentable as portfolio projects', 'BOSS', 750, 'MILESTONE', 3],
      ['Start a Certification', 'Complete meaningful certifications and technical learning beyond my school curriculum', 'MAIN', 300, 'MILESTONE', 1],
      ['Training Streak', 'Become significantly stronger and better conditioned', 'CHALLENGE', 600, 'WORKOUT_COUNT', 12],
      ['30-Day Discipline Run', 'Build a disciplined daily routine that I can maintain even when motivation disappears', 'BOSS', 750, 'HABIT_STREAK', 30],
      ['Teacher/Mentor Connection', 'Become more intentional about maintaining strong relationships with family, friends, teachers and mentors', 'SIDE', 250, 'MANUAL', 1],
      ['Weekly Life Review', 'Use Life OS consistently to manage my responsibilities, goals and priorities', 'WEEKLY', 100, 'MILESTONE', 1],
      ['Next-Level Career Research', 'Build a competitive foundation for my future engineering career', 'MAIN', 400, 'MANUAL', 1],
    ];
    for (const [title, goal, type, xp, kind, target] of expected) {
      const view = questView(title);
      expect(goals.get(view.quest.goalId!), title).toBe(goal);
      expect(view.quest).toMatchObject({ type, xpReward: xp, status: 'ACTIVE' });
      expect(view.requirements).toHaveLength(1);
      expect(view.requirements[0]!.requirement).toMatchObject({ kind, target, manualProgress: 0 });
      expect(view.percent).toBe(0);
    }
  });

  it('awards no XP on creation', async () => {
    await seedPlan2026();
    expect(store.live('xpEvents')).toHaveLength(0);
    expect(store.character.totalXp).toBe(0);
  });

  it('is idempotent, reuses same-title rows, and never resurrects deleted ones', async () => {
    await createGoal({ title: 'Score 1350+ on the SAT', area: 'Education' });
    await seedPlan2026();
    expect(store.live('goals').filter((g) => g.title === 'Score 1350+ on the SAT')).toHaveLength(1);
    const handmade = store.live('goals').find((g) => g.title === 'Score 1350+ on the SAT')!;
    expect(questView('SAT Diagnostic').quest.goalId).toBe(handmade.id);

    await deleteQuest(questView('Weekly Life Review').quest.id);
    expect(await seedPlan2026()).toEqual({ goalsCreated: 0, questsCreated: 0 });
    expect(store.live('goals')).toHaveLength(10);
    expect(store.live('quests')).toHaveLength(9);
  });

  it('manual requirements tick off, and XP is paid only when claimed', async () => {
    await seedPlan2026();
    const view = questView('SAT Diagnostic');
    await toggleQuestRequirement(view.requirements[0]!.requirement.id);
    expect(questView('SAT Diagnostic').percent).toBe(100);
    expect(store.character.totalXp).toBe(0);
    const result = await completeQuest(view.quest.id);
    expect(result.xpAwarded).toBeGreaterThanOrEqual(500);
  });

  it('tracked requirements follow real data', async () => {
    await seedPlan2026();
    await logWorkout({ title: 'Push day', discipline: 'Gym', date: dayKeyToMs(toDayKey()), durationMinutes: 45 });
    expect(questView('Training Streak').requirements[0]!.progress).toBe(1);

    const req = questView('30-Day Discipline Run').requirements[0]!.requirement;
    expect(req.refId).toBeNull();
    await createHabit({ title: 'Core routine', area: 'Mind', startDate: Date.now() - 86_400_000 });
    const habit = store.live('habits')[0]!;
    await linkQuestRequirementHabit(req.id, habit.id);
    expect(questView('30-Day Discipline Run').requirements[0]!.requirement.refId).toBe(habit.id);
  });
});
