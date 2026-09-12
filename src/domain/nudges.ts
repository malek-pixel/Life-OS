/**
 * In-app reminders.
 *
 * The Notifications settings section exists in the approved design, and
 * Development Master section 19 puts local reminders in scope. Scheduled
 * background delivery is explicitly deferred, so this module implements the
 * half that can be honest today: reminders computed from real data and surfaced
 * *while the app is open*.
 *
 * That distinction matters, and the Settings screen states it plainly rather
 * than implying delivery that does not exist. What is real here:
 *
 *   habitNudges       - streaks scheduled today and still unlogged
 *   deadlineWarnings  - overdue tasks, and goals/projects due within a week
 *   quietHours        - suppresses both between 23:00 and 08:00
 *   achievementAlerts - gates the unlock toasts
 *   toastReminders    - whether these also surface as a toast, not just a banner
 *
 * Every one of those settings now changes observable behaviour, so none of the
 * controls is decorative.
 */

import { store } from '../data/store';
import { atRiskHabits } from './streaks';
import { daysBetween, toDayKey, today as todayKey } from './dates';

export interface Nudge {
  id: string;
  kind: 'habit' | 'overdue' | 'deadline';
  /** Higher sorts first. */
  weight: number;
  text: string;
  /** Where acting on it takes the user. */
  route: string;
}

/** Quiet hours run 23:00-08:00, matching the design's copy. */
const QUIET_FROM = 23;
const QUIET_TO = 8;

export function inQuietHours(now: number = Date.now()): boolean {
  const hour = new Date(now).getHours();
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

/**
 * Reminders worth showing right now, honouring the user's settings.
 *
 * Returns an empty list when everything is switched off or quiet hours apply,
 * so the caller never has to re-check the settings itself.
 */
export function selectNudges(now: number = Date.now()): Nudge[] {
  const settings = store.settings;

  if (settings.quietHours && inQuietHours(now)) return [];

  const nudges: Nudge[] = [];
  const today = todayKey();

  /* --- habit streaks at risk --- */
  if (settings.habitNudges) {
    const logsByHabit = new Map<string, ReturnType<typeof store.live<'habitLogs'>>>();
    for (const log of store.live('habitLogs')) {
      const list = logsByHabit.get(log.habitId);
      if (list) list.push(log);
      else logsByHabit.set(log.habitId, [log]);
    }

    const entries = store
      .live('habits')
      .map((habit) => ({ habit, logs: logsByHabit.get(habit.id) ?? [] }));

    for (const { habit, streak } of atRiskHabits(entries, today)) {
      nudges.push({
        id: `habit-${habit.id}`,
        kind: 'habit',
        // A longer streak is a bigger thing to lose, so it surfaces first.
        weight: 100 + streak,
        text: `${habit.title} — ${streak}-day streak not logged yet today.`,
        route: '/habits',
      });
    }
  }

  /* --- overdue work and approaching deadlines --- */
  if (settings.deadlineWarnings) {
    const overdue = store
      .live('tasks')
      .filter((t) => t.status !== 'COMPLETED' && t.status !== 'ARCHIVED' && t.dueAt != null && t.dueAt < now);

    if (overdue.length > 0) {
      nudges.push({
        id: 'overdue-tasks',
        kind: 'overdue',
        weight: 200,
        text:
          overdue.length === 1
            ? `"${overdue[0]!.title}" is overdue.`
            : `${overdue.length} tasks are overdue.`,
        route: '/tasks',
      });
    }

    for (const goal of store.live('goals')) {
      if (goal.status === 'COMPLETED' || goal.status === 'ARCHIVED' || goal.targetDate == null) continue;
      const days = daysBetween(today, toDayKey(goal.targetDate));
      if (days >= 0 && days <= 7) {
        nudges.push({
          id: `goal-${goal.id}`,
          kind: 'deadline',
          weight: 150 - days,
          text: `Goal "${goal.title}" is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.`,
          route: `/goals/${goal.id}`,
        });
      }
    }

    for (const project of store.live('projects')) {
      if (project.status === 'COMPLETED' || project.status === 'ARCHIVED' || project.deadline == null) {
        continue;
      }
      const days = daysBetween(today, toDayKey(project.deadline));
      if (days >= 0 && days <= 7) {
        nudges.push({
          id: `project-${project.id}`,
          kind: 'deadline',
          weight: 140 - days,
          text: `Project "${project.title}" is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.`,
          route: `/projects/${project.id}`,
        });
      }
    }
  }

  return nudges.sort((a, b) => b.weight - a.weight);
}

/** Whether achievement unlock toasts should fire. */
export function achievementAlertsEnabled(): boolean {
  const settings = store.settings;
  if (!settings.achievementAlerts) return false;
  if (settings.quietHours && inQuietHours()) return false;
  return true;
}

/** Whether reminders should also surface as a toast rather than only a banner. */
export function reminderToastsEnabled(): boolean {
  return store.settings.toastReminders;
}
