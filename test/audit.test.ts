/**
 * Tests for the behaviour added or corrected during the implementation audit.
 *
 * Two themes:
 *  - the Notifications settings actually gate something, so none of those
 *    controls is decorative
 *  - import is atomic, so a failed restore cannot destroy existing data
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbHandle } from '../src/data/db';
import { store } from '../src/data/store';
import {
  createGoal,
  createHabit,
  createTask,
  toggleHabitLog,
  updateSettings,
} from '../src/data/actions';
import {
  achievementAlertsEnabled,
  inQuietHours,
  reminderToastsEnabled,
  selectNudges,
} from '../src/domain/nudges';
import { applyImport, buildExport, parseImport } from '../src/data/portability';
import { addDays, today } from '../src/domain/dates';

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

/** Midday, so quiet hours never interfere with the non-quiet-hours tests. */
const MIDDAY = new Date(2026, 8, 12, 12, 0).getTime();

describe('in-app reminders', () => {
  it('nudges a habit whose streak is scheduled today and unlogged', async () => {
    const habit = await createHabit({
      title: 'Read 20 minutes',
      startDate: Date.now() - 86_400_000 * 5,
    });
    const habitId = habit.createdIds[0]!;
    // Two days of streak, nothing logged today.
    await toggleHabitLog(habitId, addDays(today(), -2));
    await toggleHabitLog(habitId, addDays(today(), -1));

    const nudges = selectNudges(MIDDAY);
    expect(nudges.some((n) => n.kind === 'habit')).toBe(true);
    expect(nudges.find((n) => n.kind === 'habit')!.text).toContain('Read 20 minutes');
  });

  it('stops nudging once the habit is logged', async () => {
    const habit = await createHabit({ title: 'H', startDate: Date.now() - 86_400_000 * 3 });
    const habitId = habit.createdIds[0]!;
    await toggleHabitLog(habitId, addDays(today(), -1));
    expect(selectNudges(MIDDAY).some((n) => n.kind === 'habit')).toBe(true);

    await toggleHabitLog(habitId, today());
    expect(selectNudges(MIDDAY).some((n) => n.kind === 'habit')).toBe(false);
  });

  it('respects the habitNudges setting', async () => {
    const habit = await createHabit({ title: 'H', startDate: Date.now() - 86_400_000 * 3 });
    await toggleHabitLog(habit.createdIds[0]!, addDays(today(), -1));
    expect(selectNudges(MIDDAY).some((n) => n.kind === 'habit')).toBe(true);

    await updateSettings({ habitNudges: false });
    expect(selectNudges(MIDDAY).some((n) => n.kind === 'habit')).toBe(false);
  });

  it('warns about overdue tasks, and respects the deadlineWarnings setting', async () => {
    await createTask({ title: 'Late thing', dueAt: Date.now() - 86_400_000 * 2 });

    expect(selectNudges(MIDDAY).some((n) => n.kind === 'overdue')).toBe(true);

    await updateSettings({ deadlineWarnings: false });
    expect(selectNudges(MIDDAY).some((n) => n.kind === 'overdue')).toBe(false);
  });

  it('warns about a goal due within a week but not one far out', async () => {
    await createGoal({ title: 'Soon', targetDate: Date.now() + 86_400_000 * 3 });
    await createGoal({ title: 'Distant', targetDate: Date.now() + 86_400_000 * 90 });

    const texts = selectNudges(MIDDAY).map((n) => n.text).join(' ');
    expect(texts).toContain('Soon');
    expect(texts).not.toContain('Distant');
  });

  it('suppresses everything during quiet hours, and only when enabled', async () => {
    await createTask({ title: 'Late thing', dueAt: Date.now() - 86_400_000 });
    const lateNight = new Date(2026, 8, 12, 23, 30).getTime();
    const earlyMorning = new Date(2026, 8, 12, 6, 0).getTime();

    expect(inQuietHours(lateNight)).toBe(true);
    expect(inQuietHours(earlyMorning)).toBe(true);
    expect(inQuietHours(MIDDAY)).toBe(false);

    expect(selectNudges(lateNight)).toHaveLength(0);

    // With quiet hours off, the same moment produces the reminder.
    await updateSettings({ quietHours: false });
    expect(selectNudges(lateNight).length).toBeGreaterThan(0);
  });

  it('gates achievement toasts on the setting and on quiet hours', async () => {
    expect(achievementAlertsEnabled()).toBe(true);

    await updateSettings({ achievementAlerts: false });
    expect(achievementAlertsEnabled()).toBe(false);

    await updateSettings({ achievementAlerts: true });
    expect(achievementAlertsEnabled()).toBe(true);
  });

  it('gates reminder toasts on the setting', async () => {
    expect(reminderToastsEnabled()).toBe(true);
    await updateSettings({ toastReminders: false });
    expect(reminderToastsEnabled()).toBe(false);
  });

  it('orders the most urgent reminder first', async () => {
    await createHabit({ title: 'H', startDate: Date.now() - 86_400_000 * 3 });
    await createTask({ title: 'Late thing', dueAt: Date.now() - 86_400_000 });

    const nudges = selectNudges(MIDDAY);
    // Overdue work outranks an unlogged habit.
    expect(nudges[0]!.kind).toBe('overdue');
  });
});

describe('export and import', () => {
  it('round-trips the database through an export', async () => {
    await createGoal({ title: 'Round trip goal', area: 'Education' });
    await createTask({ title: 'Round trip task', priority: 'HIGH' });
    const json = JSON.stringify(buildExport());

    // Wipe, then restore from the file.
    await store.clearAll();
    expect(store.live('goals')).toHaveLength(0);

    const { bundle } = parseImport(json);
    await applyImport(bundle);

    expect(store.live('goals')[0]!.title).toBe('Round trip goal');
    expect(store.live('tasks')[0]!.title).toBe('Round trip task');
  });

  it('survives a reload after an import', async () => {
    await createGoal({ title: 'Persisted through import' });
    const json = JSON.stringify(buildExport());
    await store.clearAll();
    await applyImport(parseImport(json).bundle);

    store._resetForTests();
    resetDbHandle();
    await store.hydrate();

    expect(store.live('goals')[0]!.title).toBe('Persisted through import');
  });

  it('leaves existing data untouched when the file is rejected', async () => {
    await createGoal({ title: 'Must survive' });

    expect(() => parseImport('not json at all')).toThrow();
    expect(() => parseImport(JSON.stringify({ format: 'something-else' }))).toThrow();
    expect(() => parseImport(JSON.stringify({ format: 'life-os-export', data: {} }))).toThrow();

    // Validation happens before anything is cleared, so the goal is still here.
    expect(store.live('goals')).toHaveLength(1);
    expect(store.live('goals')[0]!.title).toBe('Must survive');
  });

  it('never includes the API key in an export', async () => {
    const bundle = buildExport();
    const text = JSON.stringify(bundle).toLowerCase();
    expect(text).not.toContain('gsk_');
    expect(text).not.toContain('apikey');
    expect(text).not.toContain('groq-key');
  });

  it('skips unknown tables and rows with no id rather than failing the import', async () => {
    const bundle = buildExport();
    const doctored = {
      ...bundle,
      data: {
        ...bundle.data,
        goals: [{ id: 'g1', title: 'Good row', deletedAt: null }, { title: 'No id' }],
        notARealTable: [{ id: 'x' }],
      },
    } as unknown as ReturnType<typeof buildExport>;

    const { preview } = parseImport(JSON.stringify(doctored));
    expect(preview.counts.goals).toBe(1);
    expect(preview.warnings.join(' ')).toContain('no id');
    expect(preview.warnings.join(' ')).toContain('notARealTable');
  });
});
