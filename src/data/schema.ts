/**
 * Life OS data model.
 *
 * Implements TECHNICAL_SPECIFICATION section 6 (Core Entity Schemas) and the
 * standards in section 5:
 *   - `id` is a client-generated UUID, never an autoincrement int
 *   - `createdAt` / `updatedAt` are unix ms in UTC
 *   - `deletedAt` is a nullable soft-delete marker; deletes are recoverable
 *
 * Per Development Master section 12 there is deliberately NO `userId` column:
 * Life OS is single-user and every row belongs to that user by definition.
 * Adding it back is a mechanical migration if V2 ever introduces sync.
 */

/** Every persisted entity carries these. */
export interface BaseEntity {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/* ------------------------------------------------------------------ *
 * Enumerations
 * ------------------------------------------------------------------ */

export const GOAL_STATUSES = [
  'BACKLOG',
  'ACTIVE',
  'ON_TRACK',
  'AT_RISK',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const TASK_STATUSES = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUSES = [
  'BACKLOG',
  'ACTIVE',
  'ON_TRACK',
  'AT_RISK',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MILESTONE_STATUSES = ['PENDING', 'COMPLETED'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Life areas, from UI/UX section 06. Drives colour and Life Map grouping. */
export const LIFE_AREAS = [
  'Education',
  'Career',
  'Fitness',
  'Mind',
  'Projects',
  'Relationships',
  'Other',
] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

/** How a goal's completion percentage is derived. */
export const PROGRESS_TYPES = ['ROLLUP', 'MANUAL', 'NUMERIC'] as const;
export type ProgressType = (typeof PROGRESS_TYPES)[number];

export const HABIT_FREQUENCIES = ['DAILY', 'WEEKLY', 'CUSTOM'] as const;
export type HabitFrequency = (typeof HABIT_FREQUENCIES)[number];

export const HABIT_STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type HabitStatus = (typeof HABIT_STATUSES)[number];

export const QUEST_STATUSES = ['LOCKED', 'UPCOMING', 'ACTIVE', 'COMPLETED', 'FAILED'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export const QUEST_TYPES = ['MAIN', 'SIDE', 'BOSS', 'DAILY', 'WEEKLY', 'CHALLENGE'] as const;
export type QuestType = (typeof QUEST_TYPES)[number];

export const MOODS = ['LOW', 'MID', 'GOOD'] as const;
export type Mood = (typeof MOODS)[number];

export const REVIEW_CADENCES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type ReviewCadence = (typeof REVIEW_CADENCES)[number];

export const WORKOUT_DISCIPLINES = [
  'Gym',
  'Kickboxing',
  'Conditioning',
  'Mobility',
  'Recovery',
] as const;
export type WorkoutDiscipline = (typeof WORKOUT_DISCIPLINES)[number];

/**
 * XP sources. Every XP event is attributed to exactly one of these, so
 * "why did I gain XP today" is always answerable from source data.
 */
export const XP_SOURCES = [
  'TASK',
  'HABIT',
  'MILESTONE',
  'GOAL',
  'PROJECT',
  'WORKOUT',
  'JOURNAL',
  'QUEST',
  'ROUTINE',
  'REVIEW',
  'ACHIEVEMENT',
  'ADJUSTMENT',
] as const;
export type XpSource = (typeof XP_SOURCES)[number];

/** AI tool permission levels, from TECH_SPEC section 7. */
export const AI_PERMISSIONS = ['READ', 'SUGGEST', 'WRITE', 'DELETE', 'SENSITIVE'] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

export interface Goal extends BaseEntity {
  title: string;
  description: string;
  area: LifeArea;
  status: GoalStatus;
  priority: Priority;
  startDate: number | null;
  targetDate: number | null;
  progressType: ProgressType;
  /** Only authoritative when progressType is MANUAL or NUMERIC. */
  progressValue: number;
  /** Only meaningful when progressType is NUMERIC (e.g. bench 100kg). */
  targetValue: number | null;
  unit: string | null;
  completedAt: number | null;
}

export interface Project extends BaseEntity {
  goalId: string | null;
  title: string;
  description: string;
  area: LifeArea;
  status: ProjectStatus;
  priority: Priority;
  startDate: number | null;
  deadline: number | null;
  /** Manual override; null means "derive from tasks and milestones". */
  progressOverride: number | null;
  completedAt: number | null;
}

export interface Milestone extends BaseEntity {
  projectId: string;
  title: string;
  description: string;
  targetDate: number | null;
  status: MilestoneStatus;
  completedAt: number | null;
  orderIndex: number;
}

export interface Task extends BaseEntity {
  projectId: string | null;
  goalId: string | null;
  parentTaskId: string | null;
  habitId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  dueAt: number | null;
  completedAt: number | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  /** RRULE-like subset; see domain/recurrence.ts for what is supported. */
  recurrenceRule: string | null;
  /** Set on instances generated from a recurring template. */
  recurrenceParentId: string | null;
  orderIndex: number;
}

export interface Habit extends BaseEntity {
  title: string;
  description: string;
  /** The identity this habit votes for, e.g. "Reader". UI/UX section 15. */
  identity: string;
  area: LifeArea;
  frequency: HabitFrequency;
  /** Completions required per period. DAILY: per day. WEEKLY: per week. */
  target: number;
  /** For CUSTOM frequency: 0=Sunday .. 6=Saturday. */
  weekdays: number[];
  startDate: number;
  endDate: number | null;
  status: HabitStatus;
  /** Streak protections available, per UI/UX section 15 (streak protection). */
  protectionAllowance: number;
  xpPerCompletion: number;
}

export interface HabitLog extends BaseEntity {
  habitId: string;
  /** Local calendar day, as YYYY-MM-DD. See domain/dates.ts for why. */
  date: string;
  completed: boolean;
  /** Optional measured amount (e.g. minutes read). */
  value: number | null;
  /** True when a streak protection was spent to cover this day. */
  protected: boolean;
  note: string;
}

export interface Routine extends BaseEntity {
  title: string;
  description: string;
  area: LifeArea;
  /** Minutes past local midnight this routine is intended to run. */
  scheduledMinute: number | null;
  weekdays: number[];
  status: HabitStatus;
  xpReward: number;
}

export interface RoutineStep extends BaseEntity {
  routineId: string;
  title: string;
  /** Optional duration guidance, in minutes. */
  durationMinutes: number | null;
  orderIndex: number;
  optional: boolean;
}

export interface RoutineRun extends BaseEntity {
  routineId: string;
  date: string;
  startedAt: number;
  completedAt: number | null;
  /** Step ids completed in this run. */
  completedStepIds: string[];
  /** Step ids explicitly skipped in this run. */
  skippedStepIds: string[];
}

export interface CalendarEvent extends BaseEntity {
  title: string;
  description: string;
  /** Unix ms, UTC. */
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  area: LifeArea;
  recurrenceRule: string | null;
  recurrenceParentId: string | null;
  /** 'LOCAL' is the only value until V2 adds external calendars. */
  source: 'LOCAL';
  taskId: string | null;
  workoutId: string | null;
}

export interface Workout extends BaseEntity {
  date: number;
  discipline: WorkoutDiscipline;
  title: string;
  durationMinutes: number;
  notes: string;
  /** 1-10 perceived exertion. */
  intensity: number | null;
}

export interface WorkoutExercise extends BaseEntity {
  workoutId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  /** kg. Null for bodyweight or timed work. */
  weight: number | null;
  /** For conditioning/rounds work. */
  durationSeconds: number | null;
  notes: string;
  orderIndex: number;
}

export interface JournalEntry extends BaseEntity {
  title: string;
  content: string;
  /** Local calendar day, YYYY-MM-DD. One entry per day is the norm, not a rule. */
  date: string;
  mood: Mood | null;
  tags: string[];
}

export interface Note extends BaseEntity {
  title: string;
  content: string;
  folder: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  /** Ids of linked goals/projects/tasks/notes, as `kind:id`. */
  links: string[];
}

export interface Quest extends BaseEntity {
  title: string;
  objective: string;
  type: QuestType;
  status: QuestStatus;
  area: LifeArea;
  goalId: string | null;
  startDate: number | null;
  endDate: number | null;
  xpReward: number;
  completedAt: number | null;
  orderIndex: number;
}

/**
 * A single measurable condition of a quest. Quest progress is the fraction of
 * its requirements met - never a free-floating percentage.
 */
export interface QuestRequirement extends BaseEntity {
  questId: string;
  label: string;
  /** How this requirement is measured. */
  kind: 'MANUAL' | 'TASK_COUNT' | 'HABIT_STREAK' | 'MILESTONE' | 'WORKOUT_COUNT';
  /** Target count for the counted kinds. */
  target: number;
  /** Manual progress, used when kind is MANUAL. */
  manualProgress: number;
  /** Scope for counted kinds, e.g. a habitId or projectId. */
  refId: string | null;
  orderIndex: number;
}

/** The definition of an achievement. Seeded, then evaluated against real data. */
export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Single-character glyph, per the design's achievement cards. */
  glyph: string;
  color: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'LEGENDARY';
  xpReward: number;
  /** Evaluated by domain/achievements.ts against aggregate stats. */
  rule: AchievementRule;
}

export type AchievementRule =
  | { kind: 'TASKS_COMPLETED'; count: number }
  | { kind: 'HABIT_STREAK'; days: number }
  | { kind: 'JOURNAL_ENTRIES'; count: number }
  | { kind: 'WORKOUTS_LOGGED'; count: number }
  | { kind: 'FOCUS_HOURS'; hours: number }
  | { kind: 'GOAL_COMPLETED'; count: number; area?: LifeArea }
  | { kind: 'PROJECT_COMPLETED'; count: number }
  | { kind: 'LEVEL_REACHED'; level: number }
  | { kind: 'QUEST_COMPLETED'; count: number };

/** An actual unlock. Written once, never rewritten - history is evidence. */
export interface AchievementUnlock extends BaseEntity {
  achievementId: string;
  unlockedAt: number;
  /** True until the user has seen it, which drives the "NEW" badge. */
  seen: boolean;
}

/**
 * Append-only XP ledger. Per TECH_SPEC section 6, XP is never a single mutable
 * counter: CharacterState is a cached rollup that can always be rebuilt from
 * these rows, which is what makes undo and "why did I gain XP" answerable.
 */
export interface XpEvent extends BaseEntity {
  sourceType: XpSource;
  sourceId: string | null;
  amount: number;
  reason: string;
  /** Local day the XP landed on, for daily/weekly rollups. */
  date: string;
}

/** Cached rollup of the XP ledger. Rebuildable; never the only copy. */
export interface CharacterState {
  id: 'singleton';
  totalXp: number;
  level: number;
  rank: string;
  /** Per-area XP, for the stat radar and Life Map. */
  areaXp: Record<string, number>;
  updatedAt: number;
}

export interface Review extends BaseEntity {
  cadence: ReviewCadence;
  /** Start of the period being reviewed, local midnight as unix ms. */
  periodStart: number;
  periodEnd: number;
  /** What the user wrote. */
  wins: string;
  misses: string;
  nextFocus: string;
  /** Snapshot of the aggregated metrics at the time of the review. */
  snapshot: Record<string, number>;
  completedAt: number | null;
}

/* --- AI --- */

export interface AiConversation extends BaseEntity {
  title: string;
  /** Domains the user granted this conversation, beyond standing settings. */
  grantedContext: string[];
}

export interface AiMessage extends BaseEntity {
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Proposed tool calls awaiting confirmation, or the executed record. */
  toolCalls: AiToolCallRecord[] | null;
  error: string | null;
}

export interface AiToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  permission: AiPermission;
  status: 'PROPOSED' | 'CONFIRMED' | 'EXECUTED' | 'REJECTED' | 'FAILED';
  result: string | null;
  error: string | null;
}

/** Per TECH_SPEC section 9: a guardrail against runaway AI loops. */
export interface AiUsageLog extends BaseEntity {
  model: string;
  promptTokens: number;
  completionTokens: number;
  toolCallCount: number;
  date: string;
  ok: boolean;
  errorCode: string | null;
}

/** Long-term AI memory, as rows in the local database - not a separate service. */
export interface AiMemory extends BaseEntity {
  kind: 'FACT' | 'PREFERENCE' | 'PATTERN';
  content: string;
  /** Where this came from, so it can be audited and deleted. */
  sourceConversationId: string | null;
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

/**
 * All user-changeable preferences. Persisted as one row; read synchronously
 * everywhere via the settings store so a toggle takes effect immediately.
 *
 * Per TECH_SPEC section 15, journal AI access defaults to OFF.
 */
export interface Settings {
  id: 'singleton';

  /* identity */
  displayName: string;
  createdAt: number;

  /* appearance */
  accent: string;
  compactRows: boolean;
  fontScale: 'S' | 'Default' | 'L';

  /* navigation */
  showRankBadges: boolean;
  defaultScreen: string;
  sidebarCollapsed: boolean;

  /* notifications */
  toastReminders: boolean;
  deadlineWarnings: boolean;
  habitNudges: boolean;
  achievementAlerts: boolean;
  quietHours: boolean;

  /* AI + privacy */
  aiContextTasks: boolean;
  aiContextFitness: boolean;
  aiContextJournal: boolean;
  procrastinationDetection: boolean;
  aiConfirmActions: boolean;
  aiModel: string;

  /* accessibility */
  reduceMotion: boolean;
  ambientMotion: boolean;
  highContrast: boolean;
  largeText: boolean;

  /* behaviour */
  weekStartsMonday: boolean;
  autosaveNotes: boolean;

  /* onboarding */
  onboardingCompletedAt: number | null;
  onboardingStep: number;

  updatedAt: number;
}

export const DEFAULT_SETTINGS: Omit<Settings, 'createdAt' | 'updatedAt'> = {
  id: 'singleton',
  displayName: '',
  accent: '#9E304A',
  compactRows: false,
  fontScale: 'Default',
  showRankBadges: true,
  defaultScreen: '/dashboard',
  sidebarCollapsed: false,
  toastReminders: true,
  deadlineWarnings: true,
  habitNudges: true,
  achievementAlerts: true,
  quietHours: true,
  aiContextTasks: true,
  aiContextFitness: true,
  aiContextJournal: false,
  procrastinationDetection: true,
  aiConfirmActions: true,
  aiModel: 'llama-3.3-70b-versatile',
  reduceMotion: false,
  ambientMotion: true,
  highContrast: false,
  largeText: false,
  weekStartsMonday: true,
  autosaveNotes: true,
  onboardingCompletedAt: null,
  onboardingStep: 0,
};

/* ------------------------------------------------------------------ *
 * Store registry
 * ------------------------------------------------------------------ */

/** Object store names. Kept as a const map so migrations and repos can't drift. */
export const STORES = {
  goals: 'goals',
  projects: 'projects',
  milestones: 'milestones',
  tasks: 'tasks',
  habits: 'habits',
  habitLogs: 'habitLogs',
  routines: 'routines',
  routineSteps: 'routineSteps',
  routineRuns: 'routineRuns',
  calendarEvents: 'calendarEvents',
  workouts: 'workouts',
  workoutExercises: 'workoutExercises',
  journalEntries: 'journalEntries',
  notes: 'notes',
  quests: 'quests',
  questRequirements: 'questRequirements',
  achievementUnlocks: 'achievementUnlocks',
  xpEvents: 'xpEvents',
  reviews: 'reviews',
  aiConversations: 'aiConversations',
  aiMessages: 'aiMessages',
  aiUsageLogs: 'aiUsageLogs',
  aiMemories: 'aiMemories',
  characterState: 'characterState',
  settings: 'settings',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Maps each store to the entity type it holds, for typed repositories. */
export interface StoreTypes {
  goals: Goal;
  projects: Project;
  milestones: Milestone;
  tasks: Task;
  habits: Habit;
  habitLogs: HabitLog;
  routines: Routine;
  routineSteps: RoutineStep;
  routineRuns: RoutineRun;
  calendarEvents: CalendarEvent;
  workouts: Workout;
  workoutExercises: WorkoutExercise;
  journalEntries: JournalEntry;
  notes: Note;
  quests: Quest;
  questRequirements: QuestRequirement;
  achievementUnlocks: AchievementUnlock;
  xpEvents: XpEvent;
  reviews: Review;
  aiConversations: AiConversation;
  aiMessages: AiMessage;
  aiUsageLogs: AiUsageLog;
  aiMemories: AiMemory;
  characterState: CharacterState;
  settings: Settings;
}

/**
 * Index definitions, applied by the migration in db.ts. Indexes exist for the
 * lookups the app actually performs - foreign keys and date ranges.
 */
export const INDEXES: Partial<Record<StoreName, Array<{ name: string; keyPath: string }>>> = {
  projects: [{ name: 'byGoal', keyPath: 'goalId' }],
  milestones: [{ name: 'byProject', keyPath: 'projectId' }],
  tasks: [
    { name: 'byProject', keyPath: 'projectId' },
    { name: 'byGoal', keyPath: 'goalId' },
    { name: 'byParent', keyPath: 'parentTaskId' },
    { name: 'byDueAt', keyPath: 'dueAt' },
    { name: 'byStatus', keyPath: 'status' },
  ],
  habitLogs: [
    { name: 'byHabit', keyPath: 'habitId' },
    { name: 'byDate', keyPath: 'date' },
  ],
  routineSteps: [{ name: 'byRoutine', keyPath: 'routineId' }],
  routineRuns: [
    { name: 'byRoutine', keyPath: 'routineId' },
    { name: 'byDate', keyPath: 'date' },
  ],
  calendarEvents: [{ name: 'byStart', keyPath: 'start' }],
  workouts: [{ name: 'byDate', keyPath: 'date' }],
  workoutExercises: [{ name: 'byWorkout', keyPath: 'workoutId' }],
  journalEntries: [{ name: 'byDate', keyPath: 'date' }],
  quests: [{ name: 'byGoal', keyPath: 'goalId' }],
  questRequirements: [{ name: 'byQuest', keyPath: 'questId' }],
  xpEvents: [{ name: 'byDate', keyPath: 'date' }],
  reviews: [{ name: 'byCadence', keyPath: 'cadence' }],
  aiMessages: [{ name: 'byConversation', keyPath: 'conversationId' }],
  aiUsageLogs: [{ name: 'byDate', keyPath: 'date' }],
  achievementUnlocks: [{ name: 'byAchievement', keyPath: 'achievementId' }],
};

/** Stores keyed by the literal string 'singleton' rather than a UUID. */
export const SINGLETON_STORES: StoreName[] = [STORES.settings, STORES.characterState];
