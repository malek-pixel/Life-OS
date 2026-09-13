/**
 * Integration tests for the action layer.
 *
 * These run against a real IndexedDB implementation (fake-indexeddb), not a
 * mock, so transactions, indexes and persistence behave as they do in the
 * browser. They cover the critical end-to-end flows the master prompt section
 * 56 names: create goal -> project -> task -> complete -> progress updates,
 * habit -> streak -> XP, and persistence across a reload.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import {
  completeGoal,
  completeProject,
  completeTask,
  createGoal,
  createHabit,
  createMilestone,
  createProject,
  createQuest,
  createTask,
  deleteGoal,
  deleteTask,
  logWorkout,
  protectHabitDay,
  rebuildCharacterState,
  restoreTask,
  saveJournalEntry,
  saveNote,
  toggleHabitLog,
  toggleMilestone,
  uncompleteTask,
  updateSettings,
} from '../src/data/actions';
import { goalProgress, projectProgress } from '../src/domain/progress';
import { calculateStreak } from '../src/domain/streaks';
import { levelForXp, xpForTask } from '../src/domain/xp';
import { addDays, today } from '../src/domain/dates';
import { ValidationError } from '../src/data/errors';

/** XP paid by the First Blood achievement, which the first completed task unlocks. */
const FIRST_BLOOD_XP = 50;

/** Fresh database per test, so no test can depend on another's leftovers. */
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

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

describe('store boot', () => {
  it('hydrates to ready and seeds the singleton rows', () => {
    expect(store.status).toBe('ready');
    expect(store.settings.id).toBe('singleton');
    expect(store.character.totalXp).toBe(0);
    expect(store.character.level).toBe(1);
  });

  it('starts with no user data at all', () => {
    expect(store.live('tasks')).toHaveLength(0);
    expect(store.live('goals')).toHaveLength(0);
    expect(store.live('xpEvents')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The core loop
 * ------------------------------------------------------------------ */

describe('goal -> project -> task -> completion', () => {
  it('propagates a task completion through progress, XP and level', async () => {
    const goal = await createGoal({ title: 'Score 1550+ on SAT', area: 'Education' });
    const goalId = goal.createdIds[0]!;

    const project = await createProject({ title: 'SAT prep', goalId, area: 'Education' });
    const projectId = project.createdIds[0]!;

    await createTask({ title: 'Vocab set 7', projectId, priority: 'HIGH', estimatedMinutes: 60 });
    const second = await createTask({ title: 'Practice test', projectId, priority: 'MEDIUM' });
    const secondId = second.createdIds[1 - 1] ?? second.createdIds[0]!;

    // Before any completion, the whole chain reads zero - not a fabricated number.
    let tasks = store.live('tasks').filter((t) => t.projectId === projectId);
    expect(projectProgress(store.byId('projects', projectId)!, tasks, []).percent).toBe(0);

    const result = await completeTask(secondId);

    // XP landed on the ledger, not just a counter. The award is the task's own
    // value plus First Blood, which this same completion unlocks - the whole
    // point of evaluating achievements inside the transaction.
    const taskXp = xpForTask({ priority: 'MEDIUM', estimatedMinutes: null });
    expect(result.unlockedAchievements).toContain('first-blood');
    expect(result.xpAwarded).toBe(taskXp + FIRST_BLOOD_XP);
    expect(store.live('xpEvents').filter((e) => e.sourceType === 'TASK')).toHaveLength(1);
    expect(store.live('xpEvents').filter((e) => e.sourceType === 'ACHIEVEMENT')).toHaveLength(1);
    expect(store.character.totalXp).toBe(taskXp + FIRST_BLOOD_XP);

    // Project progress moved, derived from the tasks.
    tasks = store.live('tasks').filter((t) => t.projectId === projectId);
    expect(projectProgress(store.byId('projects', projectId)!, tasks, []).percent).toBe(50);

    // Goal progress rolled up from the project.
    const tasksByProject = new Map([[projectId, tasks]]);
    const gp = goalProgress(
      store.byId('goals', goalId)!,
      store.live('projects').filter((p) => p.goalId === goalId),
      [],
      new Map(),
      tasksByProject,
    );
    expect(gp.percent).toBe(50);
    expect(gp.source).toBe('rollup');
  });

  it('unlocks First Blood on the very first completed task', async () => {
    const task = await createTask({ title: 'Anything' });
    const result = await completeTask(task.createdIds[0]!);
    expect(result.unlockedAchievements).toContain('first-blood');
    expect(store.live('achievementUnlocks')).toHaveLength(1);
  });

  it('does not unlock the same achievement twice', async () => {
    const a = await createTask({ title: 'One' });
    await completeTask(a.createdIds[0]!);
    const b = await createTask({ title: 'Two' });
    const result = await completeTask(b.createdIds[0]!);
    expect(result.unlockedAchievements).not.toContain('first-blood');
    expect(
      store.live('achievementUnlocks').filter((u) => u.achievementId === 'first-blood'),
    ).toHaveLength(1);
  });

  it('reverses XP with a compensating event when a task is reopened', async () => {
    const task = await createTask({ title: 'Reopen me', priority: 'HIGH' });
    const id = task.createdIds[0]!;
    await completeTask(id);
    expect(store.character.totalXp).toBe(50 + FIRST_BLOOD_XP);

    await uncompleteTask(id);

    // The task's own XP is clawed back. The achievement's is not: the unlock is
    // a historical fact - the first task genuinely was completed - and revoking
    // it would rewrite history rather than correct it.
    expect(store.character.totalXp).toBe(FIRST_BLOOD_XP);

    // The original event is untouched; a negative one is appended alongside it,
    // so the ledger stays append-only.
    const events = store.live('xpEvents').filter((e) => e.sourceId === id);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.amount).sort((x, y) => x - y)).toEqual([-50, 50]);
  });

  it('completing an already-completed task is a no-op, not double XP', async () => {
    const task = await createTask({ title: 'Once' });
    const id = task.createdIds[0]!;
    await completeTask(id);
    const before = store.character.totalXp;
    const again = await completeTask(id);
    expect(again.xpAwarded).toBe(0);
    expect(store.character.totalXp).toBe(before);
  });

  it('blends milestones and tasks for project progress', async () => {
    const project = await createProject({ title: 'AI-BOS' });
    const projectId = project.createdIds[0]!;
    const m = await createMilestone(projectId, { title: 'Auth shipped' });
    await createMilestone(projectId, { title: 'Task engine' });
    await toggleMilestone(m.createdIds[0]!);

    const milestones = store.live('milestones').filter((x) => x.projectId === projectId);
    const p = projectProgress(store.byId('projects', projectId)!, [], milestones);
    expect(p.percent).toBe(50);
    expect(p.source).toBe('milestones');
    // The milestone paid XP.
    expect(store.character.totalXp).toBe(100);
  });

  it('soft-deletes a task and can restore it', async () => {
    const task = await createTask({ title: 'Delete me' });
    const id = task.createdIds[0]!;
    await deleteTask(id);

    expect(store.live('tasks')).toHaveLength(0);
    // The row still exists - the delete is recoverable, not destructive.
    expect(store.byId('tasks', id)).toBeDefined();

    await restoreTask(id);
    expect(store.live('tasks')).toHaveLength(1);
  });

  it('cascades a soft delete to subtasks', async () => {
    const parent = await createTask({ title: 'Parent' });
    const parentId = parent.createdIds[0]!;
    await createTask({ title: 'Child', parentTaskId: parentId });

    await deleteTask(parentId);
    expect(store.live('tasks')).toHaveLength(0);
  });

  it('detaches rather than destroys children when a goal is deleted', async () => {
    const goal = await createGoal({ title: 'Goal' });
    const goalId = goal.createdIds[0]!;
    await createProject({ title: 'Project', goalId });
    await createTask({ title: 'Task', goalId });

    await deleteGoal(goalId);

    expect(store.live('goals')).toHaveLength(0);
    // The work survives, orphaned but intact.
    expect(store.live('projects')).toHaveLength(1);
    expect(store.live('projects')[0]!.goalId).toBeNull();
    expect(store.live('tasks')).toHaveLength(1);
    expect(store.live('tasks')[0]!.goalId).toBeNull();
  });

  it('pays goal and project completion XP', async () => {
    const goal = await createGoal({ title: 'G', area: 'Education' });
    await completeGoal(goal.createdIds[0]!);
    expect(store.character.totalXp).toBeGreaterThanOrEqual(500);
    expect(store.character.areaXp.Education).toBeGreaterThanOrEqual(500);

    const project = await createProject({ title: 'P' });
    const before = store.character.totalXp;
    await completeProject(project.createdIds[0]!);
    // 300 for the project, plus the Architect achievement it unlocks.
    expect(store.character.totalXp).toBe(before + 300 + 400);
  });
});


/* ------------------------------------------------------------------ *
 * Recurrence
 * ------------------------------------------------------------------ */

describe('recurring tasks', () => {
  it('spawns the next occurrence on completion instead of reusing the row', async () => {
    const due = Date.now();
    const task = await createTask({ title: 'Daily standup', dueAt: due, recurrenceRule: 'FREQ=DAILY' });
    const id = task.createdIds[0]!;

    await completeTask(id);

    const all = store.live('tasks');
    expect(all).toHaveLength(2);
    const done = all.find((t) => t.id === id)!;
    const next = all.find((t) => t.id !== id)!;
    expect(done.status).toBe('COMPLETED');
    expect(next.status).toBe('TODO');
    expect(next.dueAt).toBeGreaterThan(done.dueAt!);
    expect(next.recurrenceParentId).toBe(id);
  });

  it('rejects an unsupported repeat rule rather than storing it', async () => {
    await expect(
      createTask({ title: 'Bad rule', recurrenceRule: 'FREQ=HOURLY' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.live('tasks')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Habits
 * ------------------------------------------------------------------ */

describe('habits', () => {
  it('logs a habit, builds the streak and awards XP', async () => {
    const habit = await createHabit({
      title: 'Read 20 minutes',
      identity: 'Reader',
      area: 'Mind',
      startDate: Date.now() - 86_400_000 * 10,
    });
    const habitId = habit.createdIds[0]!;

    await toggleHabitLog(habitId, addDays(today(), -1));
    await toggleHabitLog(habitId, today());

    const logs = store.live('habitLogs').filter((l) => l.habitId === habitId);
    const streak = calculateStreak(store.byId('habits', habitId)!, logs);
    expect(streak.current).toBe(2);
    // 20 for the first, 20 for the second (prior streak 1 -> +1% rounds to 20).
    expect(store.character.totalXp).toBe(40);
  });

  it('untoggles a habit and takes the XP back', async () => {
    const habit = await createHabit({ title: 'H', startDate: Date.now() - 86_400_000 });
    const habitId = habit.createdIds[0]!;
    await toggleHabitLog(habitId, today());
    expect(store.character.totalXp).toBe(20);

    await toggleHabitLog(habitId, today());
    expect(store.character.totalXp).toBe(0);
    expect(calculateStreak(
      store.byId('habits', habitId)!,
      store.live('habitLogs'),
    ).current).toBe(0);
  });

  it('spends a protection to bridge a missed day, without paying XP', async () => {
    const habit = await createHabit({
      title: 'Sleep by 11',
      startDate: Date.now() - 86_400_000 * 5,
      protectionAllowance: 1,
    });
    const habitId = habit.createdIds[0]!;

    await toggleHabitLog(habitId, addDays(today(), -2));
    await protectHabitDay(habitId, addDays(today(), -1));
    await toggleHabitLog(habitId, today());

    const logs = store.live('habitLogs').filter((l) => l.habitId === habitId);
    const streak = calculateStreak(store.byId('habits', habitId)!, logs);
    expect(streak.current).toBe(3);
    expect(streak.protectionsUsed).toBe(1);
    // Two real completions paid; the protected day did not.
    expect(store.character.totalXp).toBe(40);
  });

  it('refuses to overspend streak protections', async () => {
    const habit = await createHabit({
      title: 'H',
      startDate: Date.now() - 86_400_000 * 5,
      protectionAllowance: 1,
    });
    const habitId = habit.createdIds[0]!;
    await protectHabitDay(habitId, addDays(today(), -1));
    await expect(protectHabitDay(habitId, addDays(today(), -2))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a custom habit with no days selected', async () => {
    await expect(
      createHabit({ title: 'Nothing scheduled', frequency: 'CUSTOM', weekdays: [] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/* ------------------------------------------------------------------ *
 * Other domains
 * ------------------------------------------------------------------ */

describe('fitness, journal, notes, quests', () => {
  it('logs a workout with exercises and awards XP', async () => {
    const result = await logWorkout({
      title: 'Push day',
      discipline: 'Gym',
      durationMinutes: 60,
      exercises: [
        { exerciseName: 'Bench press', sets: 4, reps: 8, weight: 92.5 },
        { exerciseName: 'Overhead press', sets: 3, reps: 10, weight: 50 },
      ],
    });
    const workoutId = result.createdIds[0]!;
    expect(store.live('workouts')).toHaveLength(1);
    expect(store.live('workoutExercises').filter((e) => e.workoutId === workoutId)).toHaveLength(2);
    expect(result.xpAwarded).toBe(70);
    expect(store.character.areaXp.Fitness).toBe(70);
  });

  it('rejects a workout exercise with a negative weight', async () => {
    await expect(
      logWorkout({ title: 'Bad', exercises: [{ exerciseName: 'Bench', weight: -5 }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('saves a journal entry and pays XP once, not on every edit', async () => {
    const created = await saveJournalEntry(null, { content: 'Locked in today.', mood: 'GOOD' });
    const id = created.createdIds[0]!;
    expect(store.character.totalXp).toBe(15);

    await saveJournalEntry(id, { content: 'Locked in today. Edited.', mood: 'GOOD' });
    expect(store.character.totalXp).toBe(15);
    expect(store.live('journalEntries')).toHaveLength(1);
    expect(store.live('journalEntries')[0]!.content).toBe('Locked in today. Edited.');
  });

  it('refuses to save an empty journal entry', async () => {
    await expect(saveJournalEntry(null, { content: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('persists and updates a note', async () => {
    const created = await saveNote(null, { title: 'F1 aero', content: 'Ground effect.', tags: ['f1', 'f1'] });
    const id = created.createdIds[0]!;
    // Tags are deduplicated at the boundary.
    expect(store.byId('notes', id)!.tags).toEqual(['f1']);

    await saveNote(id, { title: 'F1 aero notes', content: 'Ground effect, porpoising.' });
    expect(store.live('notes')).toHaveLength(1);
    expect(store.byId('notes', id)!.title).toBe('F1 aero notes');
  });

  it('refuses a quest with no requirements to measure', async () => {
    await expect(createQuest({ title: 'Vague quest', requirements: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('creates a quest with its requirements', async () => {
    const result = await createQuest({
      title: 'SAT Summit',
      requirements: [{ label: 'Three practice tests above 1500', target: 3 }],
    });
    const questId = result.createdIds[0]!;
    expect(store.live('questRequirements').filter((r) => r.questId === questId)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Validation and integrity
 * ------------------------------------------------------------------ */

describe('validation and integrity', () => {
  it('rejects an empty task title with a field-level error', async () => {
    await expect(createTask({ title: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      fields: { title: expect.stringContaining('required') },
    });
    expect(store.live('tasks')).toHaveLength(0);
  });

  it('refuses a task linked to a project that does not exist', async () => {
    await expect(
      createTask({ title: 'Orphan', projectId: 'no-such-project' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a goal whose target date precedes its start', async () => {
    await expect(
      createGoal({
        title: 'Backwards',
        startDate: new Date(2026, 5, 1).getTime(),
        targetDate: new Date(2026, 0, 1).getTime(),
      }),
    ).rejects.toMatchObject({ fields: { targetDate: expect.any(String) } });
  });

  it('refuses a measured goal with no target value', async () => {
    await expect(
      createGoal({ title: 'Bench', progressType: 'NUMERIC', targetValue: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

/* ------------------------------------------------------------------ *
 * Persistence and rebuild
 * ------------------------------------------------------------------ */

describe('persistence', () => {
  it('survives a reload', async () => {
    await createTask({ title: 'Persisted task', priority: 'HIGH' });
    await saveNote(null, { title: 'Persisted note', content: 'body' });

    // Simulate a full app restart: drop memory, reopen, re-hydrate.
    store._resetForTests();
    resetDbHandle();
    await store.hydrate();

    expect(store.status).toBe('ready');
    expect(store.live('tasks')).toHaveLength(1);
    expect(store.live('tasks')[0]!.title).toBe('Persisted task');
    expect(store.live('notes')[0]!.title).toBe('Persisted note');
  });

  it('persists a settings change across a reload', async () => {
    await updateSettings({ weekStartsMonday: false, accent: '#4C6FAE' });
    store._resetForTests();
    resetDbHandle();
    await store.hydrate();

    expect(store.settings.weekStartsMonday).toBe(false);
    expect(store.settings.accent).toBe('#4C6FAE');
  });

  it('rebuilds the cached character rollup from the XP ledger alone', async () => {
    const a = await createTask({ title: 'A', priority: 'HIGH' });
    await completeTask(a.createdIds[0]!);
    const b = await createTask({ title: 'B', priority: 'LOW' });
    await completeTask(b.createdIds[0]!);

    const expected = store.live('xpEvents').reduce((sum, e) => sum + e.amount, 0);

    const rebuilt = await rebuildCharacterState();
    expect(rebuilt.totalXp).toBe(expected);
    expect(rebuilt.level).toBe(levelForXp(expected).level);
    expect(rebuilt.rank).toBe(levelForXp(expected).rank.title);
  });

  it('clears everything on request and comes back to a usable empty state', async () => {
    await createTask({ title: 'Gone soon' });
    await store.clearAll();

    expect(store.live('tasks')).toHaveLength(0);
    expect(store.live('xpEvents')).toHaveLength(0);
    // The singletons are re-seeded so the app still boots.
    expect(store.settings.id).toBe('singleton');
    expect(store.character.totalXp).toBe(0);
  });
});

describe('concurrent actions', () => {
  /*
   * Found by clicking a checkbox five times quickly in the browser. Actions read
   * state from memory and then await their commit, so concurrent calls all read
   * the pre-commit state: five XP awards for one task, and a cached total that
   * disagreed with the ledger. Actions are now serialized.
   */
  const ledgerSum = () => store.live('xpEvents').reduce((sum, e) => sum + e.amount, 0);

  it('awards a task exactly once however many times completion is fired', async () => {
    await createTask({ title: 'First, to spend First Blood' }).then((r) => completeTask(r.createdIds[0]!));
    const { createdIds } = await createTask({ title: 'Clicked five times' });
    const id = createdIds[0]!;
    const before = store.character.totalXp;

    await Promise.all([1, 2, 3, 4, 5].map(() => completeTask(id)));

    const awards = store.live('xpEvents').filter((e) => e.sourceId === id);
    expect(awards).toHaveLength(1);
    expect(store.character.totalXp - before).toBe(awards[0]!.amount);
    expect(store.character.totalXp).toBe(ledgerSum());
  });

  it('does not lose updates when different actions race', async () => {
    const ids = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => createTask({ title: `Task ${n}` }).then((r) => r.createdIds[0]!)),
    );
    expect(new Set(ids).size).toBe(6);

    await Promise.all(ids.map((id) => completeTask(id)));

    // Every completion is counted in the cache, not just the last writer's.
    expect(store.character.totalXp).toBe(ledgerSum());
    expect(store.live('tasks').filter((t) => t.status === 'COMPLETED')).toHaveLength(6);
  });

  it('keeps the ledger and cache in step when complete and undo interleave', async () => {
    const { createdIds } = await createTask({ title: 'Toggled' });
    const id = createdIds[0]!;

    await Promise.all([completeTask(id), uncompleteTask(id), completeTask(id), uncompleteTask(id)]);

    expect(store.byId('tasks', id)!.status).toBe('TODO');
    expect(store.character.totalXp).toBe(ledgerSum());
    // Net zero for this task: every award has its reversal.
    const net = store.live('xpEvents').filter((e) => e.sourceId === id).reduce((s, e) => s + e.amount, 0);
    expect(net).toBe(0);
  });

  it('keeps accepting writes after an action fails', async () => {
    await expect(completeTask('no-such-task')).rejects.toThrow();
    const { createdIds } = await createTask({ title: 'After a failure' });
    await completeTask(createdIds[0]!);
    expect(store.byId('tasks', createdIds[0]!)!.status).toBe('COMPLETED');
  });
});
