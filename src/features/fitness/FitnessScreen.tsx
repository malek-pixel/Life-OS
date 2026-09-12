/**
 * Fitness.
 *
 * UI/UX section 20 ships strength, volume and PRs first, with the wider metric
 * list added as logging matures - so that is exactly what this screen reports,
 * and nothing more.
 *
 * Every number here is computed from logged sets: volume is sets x reps x
 * weight, a personal record is the heaviest set actually recorded for that
 * exercise, and the delta beside it is the real improvement over the previous
 * best. Master prompt section 26 rules out inventing any of it.
 */

import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  StatTile,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { BarChart } from '../../ui/charts';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useSelector } from '../../app/hooks';
import { selectFitness } from '../../domain/selectors';
import { deleteWorkout, logWorkout } from '../../data/actions';
import { formatDuration, formatRelativeDay, toDayKey } from '../../domain/dates';
import { achievementName } from '../../domain/achievements';
import { achievementAlertsEnabled } from '../../domain/nudges';
import { WORKOUT_DISCIPLINES } from '../../data/schema';
import { store } from '../../data/store';
import { AppError } from '../../data/errors';

export default function FitnessScreen() {
  const data = useSelector(selectFitness);
  const [logging, setLogging] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  if (data.totalSessions === 0) {
    return (
      <>
        <PageHeader
          title="Fitness"
          subtitle="Training is the one domain that tells you the truth immediately."
          actions={
            <Button variant="primary" icon="plus" onClick={() => setLogging(true)}>
              Log a session
            </Button>
          }
        />
        <Card>
          <EmptyState
            icon="fitness"
            title="No sessions logged"
            body="Volume, personal records and training streaks are all computed from the sets you log — so until there is a session here, there is nothing honest to show. Log the one you just did."
            action={
              <Button variant="primary" icon="plus" onClick={() => setLogging(true)}>
                Log your first session
              </Button>
            }
          />
        </Card>
        <WorkoutModal open={logging} onClose={() => setLogging(false)} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fitness"
        subtitle={`${data.totalSessions} session${data.totalSessions === 1 ? '' : 's'} logged.`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setLogging(true)}>
            Log a session
          </Button>
        }
      />

      <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
        <StatTile
          label="SESSIONS / WK"
          value={String(data.sessionsThisWeek)}
          delta="this week"
          tone={data.sessionsThisWeek > 0 ? 'accent' : 'muted'}
        />
        <StatTile
          label="VOLUME"
          value={data.volumeThisWeek >= 1000 ? `${(data.volumeThisWeek / 1000).toFixed(1)}k` : String(data.volumeThisWeek)}
          delta="kg this week"
        />
        <StatTile
          label="TRAIN STREAK"
          value={String(data.trainStreak)}
          delta="days"
          tone={data.trainStreak > 0 ? 'accent' : 'muted'}
        />
        <StatTile label="TOTAL" value={String(data.totalSessions)} delta="all time" />
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- volume this week ---------- */}
          <Card>
            <CardHeader kicker="VOLUME" title="This week, by day" />
            <BarChart
              label="Training volume by day this week"
              valueSuffix=" kg"
              data={data.weekVolume.map((d) => ({
                label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(d.day + 'T00:00').getDay()] ?? '',
                value: d.volume,
                title: `${formatRelativeDay(d.day)}: ${d.volume} kg`,
              }))}
            />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '10px 0 0' }}>
              Volume is sets × reps × weight from the exercises you logged. Sessions without weights
              (conditioning, mobility) contribute nothing to this figure by design.
            </p>
          </Card>

          {/* ---------- session history ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader kicker="HISTORY" title="Recent sessions" />
            </div>
            <div className="list">
              {data.recent.map(({ workout, exerciseCount, volume }) => (
                <div className="list-row los-row" key={workout.id}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 3,
                      alignSelf: 'stretch',
                      minHeight: 28,
                      borderRadius: 2,
                      background:
                        data.disciplines.find((d) => d.name === workout.discipline)?.color ??
                        'var(--c-accent)',
                      flex: 'none',
                    }}
                  />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-title truncate">{workout.title}</div>
                    <div className="row-meta">
                      {workout.discipline} · {formatRelativeDay(toDayKey(workout.date))} ·{' '}
                      {formatDuration(workout.durationMinutes)}
                      {exerciseCount > 0 ? ` · ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}` : ''}
                      {volume > 0 ? ` · ${volume.toLocaleString()} kg` : ''}
                    </div>
                  </div>
                  {workout.intensity != null ? (
                    <Badge color="var(--c-warn-bright)" border="rgba(194,91,114,.4)">
                      RPE {workout.intensity}
                    </Badge>
                  ) : null}
                  <IconButton
                    icon="trash"
                    label={`Delete "${workout.title}"`}
                    size="sm"
                    onClick={() =>
                      confirm({
                        title: 'Delete this session?',
                        body: `"${workout.title}" and its logged sets will be removed, and your volume and records will recalculate.`,
                        actionLabel: 'Delete session',
                        danger: true,
                        onConfirm: async () => {
                          await deleteWorkout(workout.id);
                          toast.show('Session deleted', { tone: 'muted' });
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- personal records ---------- */}
          <Card>
            <CardHeader kicker="PERSONAL RECORDS" title="Heaviest logged sets" />
            {data.records.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
                No weighted sets logged yet. Add exercises with a weight to a session and your records
                will appear here automatically.
              </p>
            ) : (
              <div className="stack" style={{ gap: 0 }}>
                {data.records.map((pr) => (
                  <div
                    key={pr.exercise}
                    className="spread"
                    style={{ padding: '10px 0', borderBottom: '1px solid var(--c-border-ghost)', gap: 10 }}
                  >
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-strong)' }}>
                        {pr.exercise}
                      </div>
                      <div className="row-meta">
                        {pr.reps > 0 ? `${pr.reps} reps · ` : ''}
                        {formatRelativeDay(toDayKey(pr.at))}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <span className="mono" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
                        {pr.weight}
                      </span>
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)' }}>
                        {' '}
                        kg
                      </span>
                      {pr.delta != null && pr.delta > 0 ? (
                        <div className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-accent-text)' }}>
                          +{pr.delta}
                        </div>
                      ) : pr.delta == null ? (
                        <div className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                          first
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- disciplines ---------- */}
          <Card>
            <CardHeader kicker="THIS WEEK" title="By discipline" />
            {data.disciplines.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0 }}>
                Nothing logged this week yet.
              </p>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {data.disciplines.map((d) => (
                  <div className="row" key={d.name} style={{ gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flex: 'none' }}
                    />
                    <span className="grow" style={{ fontSize: 'var(--fs-md)' }}>
                      {d.name}
                    </span>
                    <span className="mono" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)' }}>
                      {d.count}×
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <WorkoutModal open={logging} onClose={() => setLogging(false)} />
    </>
  );
}

/* ================================================================== *
 * Log a session
 * ================================================================== */

interface ExerciseRow {
  exerciseName: string;
  sets: string;
  reps: string;
  weight: string;
}

function WorkoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();

  const [form, setForm] = useState(() => blank());
  const [exercises, setExercises] = useState<ExerciseRow[]>([blankExercise()]);

  const key = String(open);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank());
    setExercises([blankExercise()]);
  }

  /** Names already logged, offered as suggestions so records group correctly. */
  const known = useSelector(() =>
    Array.from(new Set(store.live('workoutExercises').map((e) => e.exerciseName))).sort(),
  );

  const submit = useAction(() =>
    logWorkout({
      title: form.title,
      discipline: form.discipline,
      date: form.date ? new Date(form.date).getTime() : Date.now(),
      durationMinutes: Number(form.duration) || 0,
      notes: form.notes,
      intensity: form.intensity ? Number(form.intensity) : null,
      exercises: exercises
        .filter((e) => e.exerciseName.trim())
        .map((e) => ({
          exerciseName: e.exerciseName,
          sets: Number(e.sets) || 0,
          reps: Number(e.reps) || 0,
          weight: e.weight ? Number(e.weight) : null,
        })),
    }),
  );

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Log a session"
      description="Exercises are optional — a duration alone is enough to keep the streak and the XP honest."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const result = await submit.run();
              if (!result) return;
              toast.show(`Session logged · +${result.xpAwarded} XP`, { tone: 'xp' });
              if (achievementAlertsEnabled()) for (const id of result.unlockedAchievements) {
                toast.show(`Achievement unlocked · ${achievementName(id)}`, { tone: 'xp' });
              }
              onClose();
            }}
            loading={submit.pending}
            disabled={form.title.trim().length === 0}
          >
            Log session
          </Button>
        </>
      }
    >
      {submit.error && Object.keys(fieldErrors).length === 0 ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={15} style={{ marginTop: 1 }} />
          <div className="grow">{submit.error.message}</div>
        </div>
      ) : null}

      <TextField
        label="Session"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Push day — chest & shoulders"
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 150px' }}>
          <SelectField
            label="Discipline"
            value={form.discipline}
            onChange={(e) => setForm({ ...form, discipline: e.target.value })}
            options={WORKOUT_DISCIPLINES.map((d) => ({ value: d, label: d }))}
          />
        </div>
        <div style={{ flex: '1 1 170px' }}>
          <TextField
            label="When"
            type="datetime-local"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            error={fieldErrors.date}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <TextField
            label="Duration (min)"
            type="number"
            min={0}
            value={form.duration}
            onChange={(e) => setForm({ ...form, duration: e.target.value })}
            error={fieldErrors.durationMinutes}
          />
        </div>
        <div style={{ flex: '1 1 110px' }}>
          <TextField
            label="RPE (1-10)"
            type="number"
            min={1}
            max={10}
            value={form.intensity}
            onChange={(e) => setForm({ ...form, intensity: e.target.value })}
            error={fieldErrors.intensity}
          />
        </div>
      </div>

      {/* ---------- exercises ---------- */}
      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            EXERCISES
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={() => setExercises([...exercises, blankExercise()])}
          >
            Add exercise
          </Button>
        </div>

        {known.length > 0 ? (
          <datalist id="known-exercises">
            {known.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}

        <div className="stack" style={{ gap: 8 }}>
          {exercises.map((row, i) => (
            <div className="row" key={i} style={{ gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: '2 1 160px' }}>
                <label className="los-sr" htmlFor={`ex-name-${i}`}>
                  Exercise {i + 1} name
                </label>
                <input
                  id={`ex-name-${i}`}
                  className="input"
                  list="known-exercises"
                  value={row.exerciseName}
                  onChange={(e) => update(i, { exerciseName: e.target.value })}
                  placeholder="Bench press"
                />
              </div>
              <div style={{ flex: '0 1 68px' }}>
                <label className="los-sr" htmlFor={`ex-sets-${i}`}>
                  Sets
                </label>
                <input
                  id={`ex-sets-${i}`}
                  className="input"
                  type="number"
                  min={0}
                  value={row.sets}
                  onChange={(e) => update(i, { sets: e.target.value })}
                  placeholder="Sets"
                />
              </div>
              <div style={{ flex: '0 1 68px' }}>
                <label className="los-sr" htmlFor={`ex-reps-${i}`}>
                  Reps
                </label>
                <input
                  id={`ex-reps-${i}`}
                  className="input"
                  type="number"
                  min={0}
                  value={row.reps}
                  onChange={(e) => update(i, { reps: e.target.value })}
                  placeholder="Reps"
                />
              </div>
              <div style={{ flex: '0 1 82px' }}>
                <label className="los-sr" htmlFor={`ex-weight-${i}`}>
                  Weight in kg
                </label>
                <input
                  id={`ex-weight-${i}`}
                  className="input"
                  type="number"
                  min={0}
                  step="0.5"
                  value={row.weight}
                  onChange={(e) => update(i, { weight: e.target.value })}
                  placeholder="kg"
                />
              </div>
              <IconButton
                icon="close"
                label={`Remove exercise ${i + 1}`}
                onClick={() => setExercises(exercises.filter((_, j) => j !== i))}
                disabled={exercises.length === 1}
              />
            </div>
          ))}
        </div>

        <p className="field-hint" style={{ marginTop: 8 }}>
          Weight is what drives volume and personal records. Leave it blank for bodyweight or timed
          work — that is recorded, just not counted as tonnage.
        </p>
      </div>

      <TextAreaField
        label="Notes"
        rows={2}
        value={form.notes}
        onChange={(e) => setForm({ ...form, notes: e.target.value })}
        error={fieldErrors.notes}
      />
    </Modal>
  );

  function update(index: number, patch: Partial<ExerciseRow>) {
    setExercises(exercises.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
}

function blank() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    title: '',
    discipline: 'Gym',
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`,
    duration: '60',
    intensity: '',
    notes: '',
  };
}

function blankExercise(): ExerciseRow {
  return { exerciseName: '', sets: '3', reps: '8', weight: '' };
}
