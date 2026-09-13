/**
 * The owner's 2026-27 goals and quests, created once through the normal actions.
 *
 * Everything goes through createGoal / createQuest, so validation, stamps, sync
 * outbox and XP rules are exactly those of a row made in the UI. Creation awards
 * no XP; quests pay out only through completeQuest.
 *
 * Idempotent and safe across synced devices:
 *  - Ids are fixed, so two devices seeding before they first sync create the
 *    same rows, which sync merges instead of duplicating.
 *  - A row whose id already exists - including one the owner has since deleted -
 *    is never recreated.
 *  - A live goal or quest with the same title (made by hand earlier) is reused
 *    rather than duplicated.
 *
 * Mapping notes (the brief used labels from both forms; the existing enums win):
 *  - Goals 8 and 9 asked for "Count completed milestones" / "Reach a habit
 *    streak", which are quest requirement kinds, not goal progress types. Both
 *    use ROLLUP, the goal type computed from real linked projects and tasks.
 *  - Counted requirements need a target the brief did not give; the targets
 *    below follow each objective's wording.
 */

import { createGoal, createQuest } from '../actions';
import { dayKeyToMs } from '../../domain/dates';
import { store } from '../store';

const START = '2026-09-14';

const GOALS = [
  {
    id: 'plan26-goal-sat',
    title: 'Score 1350+ on the SAT',
    description: 'A strong SAT score gives my college applications a stronger academic signal and keeps more university options open.',
    area: 'Education', priority: 'HIGH', targetDate: '2026-12-05',
    progressType: 'NUMERIC', targetValue: 1350, unit: 'SAT score',
  },
  {
    id: 'plan26-goal-essays',
    title: 'Write strong first drafts of my college essays',
    description: 'My grades and projects show what I can do. My essays show who I am and why those things matter.',
    area: 'Education', priority: 'HIGH', targetDate: '2027-06-30', progressType: 'MANUAL',
  },
  {
    id: 'plan26-goal-fitness',
    title: 'Become significantly stronger and better conditioned',
    description: 'Fitness is not just about appearance. Strength, conditioning and consistency build discipline that carries into everything else.',
    area: 'Fitness', priority: 'HIGH', targetDate: '2027-06-30', progressType: 'ROLLUP',
  },
  {
    id: 'plan26-goal-routine',
    title: 'Build a disciplined daily routine that I can maintain even when motivation disappears',
    description: 'Motivation gets me started. Discipline is what lets me actually finish things.',
    area: 'Mind', priority: 'HIGH', targetDate: '2026-12-31', progressType: 'MANUAL',
  },
  {
    id: 'plan26-goal-career',
    title: 'Build a competitive foundation for my future engineering career',
    description: 'College is only one part of the path. Skills, experience, projects and industry exposure will make me more competitive later.',
    area: 'Career', priority: 'HIGH', targetDate: '2027-06-30', progressType: 'ROLLUP',
  },
  {
    id: 'plan26-goal-portfolio',
    title: 'Make my F1 Data Project, InGen Archive and Life OS fully presentable as portfolio projects',
    description: 'I already did the hard part — building them. Now I need to make sure someone reviewing my application can understand and appreciate the work.',
    area: 'Projects', priority: 'HIGH', targetDate: '2026-10-31', progressType: 'MANUAL',
  },
  {
    id: 'plan26-goal-relationships',
    title: 'Become more intentional about maintaining strong relationships with family, friends, teachers and mentors',
    description: 'A good life is not just achievements. The people around me matter, and strong relationships take deliberate effort.',
    area: 'Relationships', priority: 'MEDIUM', targetDate: '2027-06-30', progressType: 'ROLLUP',
  },
  {
    id: 'plan26-goal-certifications',
    title: 'Complete meaningful certifications and technical learning beyond my school curriculum',
    description: 'School gives me the foundation. Independent learning proves that I can teach myself things when nobody is forcing me to.',
    area: 'Education', priority: 'MEDIUM', targetDate: '2027-06-30', progressType: 'ROLLUP',
  },
  {
    id: 'plan26-goal-lifeos',
    title: 'Use Life OS consistently to manage my responsibilities, goals and priorities',
    description: 'I built the system. Now actually living through it is the real test.',
    area: 'Mind', priority: 'MEDIUM', targetDate: '2026-12-31', progressType: 'ROLLUP',
  },
  {
    id: 'plan26-goal-ownership',
    title: 'Take greater ownership of my education, career preparation and personal responsibilities',
    description: 'The next few years are when I transition from having things organized for me to organizing my own future.',
    area: 'Other', priority: 'HIGH', targetDate: '2027-06-30', progressType: 'MANUAL',
  },
] as const;

type Kind = 'MANUAL' | 'MILESTONE' | 'WORKOUT_COUNT' | 'HABIT_STREAK';

const QUESTS: Array<{
  id: string; title: string; objective: string; type: string; area: string;
  xpReward: number; goalId: string; kind: Kind; target: number;
}> = [
  { id: 'plan26-quest-sat-diagnostic', title: 'SAT Diagnostic', objective: 'Take a full timed SAT and identify my weakest areas.', type: 'BOSS', area: 'Education', xpReward: 500, goalId: 'plan26-goal-sat', kind: 'MANUAL', target: 1 },
  { id: 'plan26-quest-sat-plan', title: 'Build My SAT Attack Plan', objective: 'Create a weekly SAT study plan based on my diagnostic results.', type: 'MAIN', area: 'Education', xpReward: 300, goalId: 'plan26-goal-sat', kind: 'MANUAL', target: 1 },
  { id: 'plan26-quest-essay-draft', title: 'First College Essay Draft', objective: 'Complete my first serious college essay draft.', type: 'MAIN', area: 'Education', xpReward: 500, goalId: 'plan26-goal-essays', kind: 'MANUAL', target: 1 },
  // One milestone per project: F1 Data Project, InGen Archive, Life OS.
  { id: 'plan26-quest-portfolio', title: 'Portfolio Showcase', objective: 'Prepare polished README pages, screenshots and live links for all three completed projects.', type: 'BOSS', area: 'Projects', xpReward: 750, goalId: 'plan26-goal-portfolio', kind: 'MILESTONE', target: 3 },
  { id: 'plan26-quest-certification', title: 'Start a Certification', objective: 'Begin one meaningful technical certification or course and complete its first milestone.', type: 'MAIN', area: 'Education', xpReward: 300, goalId: 'plan26-goal-certifications', kind: 'MILESTONE', target: 1 },
  // Four weeks at three planned sessions a week.
  { id: 'plan26-quest-training-streak', title: 'Training Streak', objective: 'Complete four consecutive weeks of planned training.', type: 'CHALLENGE', area: 'Fitness', xpReward: 600, goalId: 'plan26-goal-fitness', kind: 'WORKOUT_COUNT', target: 12 },
  { id: 'plan26-quest-discipline-run', title: '30-Day Discipline Run', objective: 'Maintain my core daily routine for 30 consecutive days.', type: 'BOSS', area: 'Mind', xpReward: 750, goalId: 'plan26-goal-routine', kind: 'HABIT_STREAK', target: 30 },
  { id: 'plan26-quest-mentor', title: 'Teacher/Mentor Connection', objective: 'Have a meaningful conversation with a teacher or mentor about my future academic or career direction.', type: 'SIDE', area: 'Relationships', xpReward: 250, goalId: 'plan26-goal-relationships', kind: 'MANUAL', target: 1 },
  { id: 'plan26-quest-weekly-review', title: 'Weekly Life Review', objective: 'Complete a weekly review of school, fitness, projects, relationships and priorities.', type: 'WEEKLY', area: 'Mind', xpReward: 100, goalId: 'plan26-goal-lifeos', kind: 'MILESTONE', target: 1 },
  { id: 'plan26-quest-career-research', title: 'Next-Level Career Research', objective: 'Research three engineering career paths and compare education, skills, salaries, industries and long-term opportunities.', type: 'MAIN', area: 'Career', xpReward: 400, goalId: 'plan26-goal-career', kind: 'MANUAL', target: 1 },
];

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface SeedResult {
  goalsCreated: number;
  questsCreated: number;
}

export async function seedPlan2026(): Promise<SeedResult> {
  const result: SeedResult = { goalsCreated: 0, questsCreated: 0 };
  const goalIds = new Map<string, string>();

  for (const goal of GOALS) {
    if (store.byId('goals', goal.id)) {
      goalIds.set(goal.id, goal.id);
      continue;
    }
    const existing = store.live('goals').find((g) => sameTitle(g.title, goal.title));
    if (existing) {
      goalIds.set(goal.id, existing.id);
      continue;
    }
    await createGoal({
      id: goal.id,
      title: goal.title,
      description: goal.description,
      area: goal.area,
      priority: goal.priority,
      status: 'ACTIVE',
      startDate: dayKeyToMs(START),
      targetDate: dayKeyToMs(goal.targetDate),
      progressType: goal.progressType,
      progressValue: 0,
      targetValue: 'targetValue' in goal ? goal.targetValue : null,
      unit: 'unit' in goal ? goal.unit : null,
    });
    goalIds.set(goal.id, goal.id);
    result.goalsCreated++;
  }

  for (const quest of QUESTS) {
    if (store.byId('quests', quest.id)) continue;
    if (store.live('quests').some((q) => sameTitle(q.title, quest.title))) continue;
    const goalId = goalIds.get(quest.goalId) ?? null;
    // A goal the owner deleted leaves the quest unlinked rather than blocked.
    const liveGoal = goalId ? store.live('goals').some((g) => g.id === goalId) : false;
    await createQuest({
      id: quest.id,
      title: quest.title,
      objective: quest.objective,
      type: quest.type,
      area: quest.area,
      goalId: liveGoal ? goalId : null,
      xpReward: quest.xpReward,
      startDate: dayKeyToMs(START),
      requirements: [{ label: quest.objective, kind: quest.kind, target: quest.target, refId: null }],
    });
    result.questsCreated++;
  }

  return result;
}

let seeding: Promise<SeedResult> | null = null;

/** Runs the seed once per app session, after the first sync so server rows are seen first. */
export function ensurePlan2026(beforeSeed: () => Promise<void> = async () => undefined): Promise<SeedResult> {
  seeding ??= beforeSeed()
    .catch(() => undefined)
    .then(() => seedPlan2026());
  return seeding;
}
