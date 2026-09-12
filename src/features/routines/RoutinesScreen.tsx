/**
 * Routines.
 *
 * UI/UX section 16, and master prompt section 24's constraint: a routine is an
 * *ordered sequence of steps that gets executed*, not a second habit system.
 *
 * The distinction is enforced by the model. A habit is one repeated act with a
 * streak; a routine is a run with per-step completion and skipping, and its
 * reward is prorated by how much of it you actually did — finishing three of
 * five steps pays three fifths, rather than all or nothing.
 */

import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  ProgressBar,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useSelector } from '../../app/hooks';
import {
  createRoutine,
  deleteRoutine,
  finishRoutineRun,
  startRoutineRun,
  toggleRoutineStep,
} from '../../data/actions';
import { areaHex } from '../../domain/selectors';
import { formatRelativeDay, today as todayKey, weekdayOf } from '../../domain/dates';
import { LIFE_AREAS, type Routine, type RoutineRun, type RoutineStep } from '../../data/schema';
import { store } from '../../data/store';
import { AppError } from '../../data/errors';

interface RoutineView {
  routine: Routine;
  steps: RoutineStep[];
  run: RoutineRun | null;
  dueToday: boolean;
  completedToday: boolean;
  runsThisWeek: number;
}

export default function RoutinesScreen() {
  const [creating, setCreating] = useState(false);

  const views = useSelector<RoutineView[]>(() => {
    const today = todayKey();
    const dow = weekdayOf(today);
    const allSteps = store.live('routineSteps');
    const runs = store.live('routineRuns');

    return store
      .live('routines')
      .filter((r) => r.status !== 'ARCHIVED')
      .map((routine) => {
        const todayRuns = runs.filter((r) => r.routineId === routine.id && r.date === today);
        const open = todayRuns.find((r) => r.completedAt == null);
        const finished = todayRuns.find((r) => r.completedAt != null);
        return {
          routine,
          steps: allSteps
            .filter((s) => s.routineId === routine.id)
            .sort((a, b) => a.orderIndex - b.orderIndex),
          run: open ?? finished ?? null,
          dueToday: routine.weekdays.length === 0 || routine.weekdays.includes(dow),
          completedToday: !!finished,
          runsThisWeek: runs.filter(
            (r) => r.routineId === routine.id && r.completedAt != null && r.date >= addWeekStart(today),
          ).length,
        };
      });
  });

  return (
    <>
      <PageHeader
        title="Routines"
        subtitle="Ordered sequences you run, not habits you tick."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New routine
          </Button>
        }
      />

      {views.length === 0 ? (
        <Card>
          <EmptyState
            icon="routines"
            title="No routines yet"
            body="A routine is a sequence you execute in order — a morning block, a training warm-up, a study setup. Unlike a habit, each step is tracked separately, and finishing part of it still counts for part of the reward."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Create a routine
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid-cards los-stagger">
          {views.map((view) => (
            <RoutineCard key={view.routine.id} view={view} />
          ))}
        </div>
      )}

      <RoutineEditor open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function addWeekStart(today: string): string {
  // Monday of the current week, as a plain string comparison bound.
  const d = new Date(today + 'T00:00');
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function RoutineCard({ view }: { view: RoutineView }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { routine, steps, run } = view;
  const color = areaHex(routine.area);

  const completed = new Set(run?.completedStepIds ?? []);
  const skipped = new Set(run?.skippedStepIds ?? []);
  const required = steps.filter((s) => !s.optional);
  const doneRequired = required.filter((s) => completed.has(s.id)).length;
  const percent = required.length === 0 ? 0 : Math.round((doneRequired / required.length) * 100);
  const running = run != null && run.completedAt == null;

  return (
    <Card>
      <div className="spread" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge color={color} border={`${color}59`}>
            {routine.area}
          </Badge>
          {view.completedToday ? (
            <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
              Done today
            </Badge>
          ) : view.dueToday ? (
            <Badge color="var(--c-accent-text)" border="var(--c-accent-border-soft)">
              Due today
            </Badge>
          ) : (
            <Badge color="var(--c-text-ghost)">Not today</Badge>
          )}
        </div>
        <IconButton
          icon="trash"
          label={`Delete routine "${routine.title}"`}
          size="sm"
          onClick={() =>
            confirm({
              title: 'Delete this routine?',
              body: `"${routine.title}" and its ${steps.length} step(s) will be removed. Past runs stay in your history.`,
              actionLabel: 'Delete routine',
              danger: true,
              onConfirm: async () => {
                await deleteRoutine(routine.id);
                toast.show('Routine deleted', { tone: 'muted' });
              },
            })
          }
        />
      </div>

      <h3 style={{ fontSize: 'var(--fs-4xl)', fontWeight: 600, margin: '0 0 4px', lineHeight: 1.3 }}>
        {routine.title}
      </h3>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', margin: '0 0 14px' }}>
        {steps.length} step{steps.length === 1 ? '' : 's'}
        {routine.scheduledMinute != null
          ? ` · ${String(Math.floor(routine.scheduledMinute / 60)).padStart(2, '0')}:${String(routine.scheduledMinute % 60).padStart(2, '0')}`
          : ''}
        {view.runsThisWeek > 0 ? ` · ${view.runsThisWeek}× this week` : ''}
      </p>

      {running || view.completedToday ? (
        <div style={{ marginBottom: 14 }}>
          <div className="spread" style={{ marginBottom: 6, gap: 8 }}>
            <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}>
              {doneRequired} / {required.length} STEPS
            </span>
            <span className="mono" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, flex: 'none' }}>
              {percent}%
            </span>
          </div>
          <ProgressBar percent={percent} color={color} label={`${routine.title}: ${percent}% complete`} />
        </div>
      ) : null}

      {/* --- steps --- */}
      <div className="stack" style={{ gap: 0, marginBottom: 14 }}>
        {steps.map((step, i) => {
          const isDone = completed.has(step.id);
          const isSkipped = skipped.has(step.id);
          return (
            <div
              key={step.id}
              className="row"
              style={{ gap: 9, padding: '7px 0', borderBottom: '1px solid var(--c-border-ghost)' }}
            >
              <span
                className="mono"
                style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', width: 15, flex: 'none' }}
              >
                {i + 1}
              </span>

              {running ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isDone}
                  aria-label={`${isDone ? 'Unmark' : 'Complete'} step "${step.title}"`}
                  className={`checkbox${isDone ? ' checkbox-on' : ''}`}
                  style={{ width: 16, height: 16 }}
                  onClick={() => void toggleRoutineStep(run!.id, step.id, 'complete')}
                >
                  {isDone ? <Icon name="check" size={10} strokeWidth={3} /> : null}
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    flex: 'none',
                    background: isDone ? color : 'var(--c-fill)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isDone ? <Icon name="check" size={10} strokeWidth={3} /> : null}
                </span>
              )}

              <span
                className="grow truncate"
                style={{
                  fontSize: 'var(--fs-md)',
                  color: isDone || isSkipped ? 'var(--c-text-faint)' : 'var(--c-text-strong)',
                  textDecoration: isSkipped ? 'line-through' : undefined,
                }}
              >
                {step.title}
              </span>

              {step.optional ? <Badge color="var(--c-text-ghost)">optional</Badge> : null}
              {step.durationMinutes ? (
                <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}>
                  {step.durationMinutes}m
                </span>
              ) : null}

              {running ? (
                <IconButton
                  icon="close"
                  label={`Skip step "${step.title}"`}
                  size="sm"
                  iconSize={11}
                  active={isSkipped}
                  onClick={() => void toggleRoutineStep(run!.id, step.id, 'skip')}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="spread" style={{ gap: 10 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-accent-text)' }}>
          +{routine.xpReward} XP
        </span>
        {view.completedToday ? (
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)' }}>
            finished {formatRelativeDay(todayKey())}
          </span>
        ) : running ? (
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const result = await finishRoutineRun(run!.id);
              toast.show(
                result.xpAwarded > 0
                  ? `Routine finished · +${result.xpAwarded} XP`
                  : 'Routine closed — nothing completed, so no XP.',
                { tone: result.xpAwarded > 0 ? 'xp' : 'muted' },
              );
            }}
          >
            Finish run
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon="chevronRight"
            onClick={async () => {
              await startRoutineRun(routine.id);
              toast.show(`${routine.title} started`, { tone: 'ok' });
            }}
          >
            Start
          </Button>
        )}
      </div>
    </Card>
  );
}

/* ================================================================== *
 * Editor
 * ================================================================== */

interface StepRow {
  title: string;
  duration: string;
  optional: boolean;
}

function RoutineEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(blank);
  const [steps, setSteps] = useState<StepRow[]>([blankStep(), blankStep()]);

  const key = String(open);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank());
    setSteps([blankStep(), blankStep()]);
  }

  const submit = useAction(() =>
    createRoutine({
      title: form.title,
      description: form.description,
      area: form.area,
      weekdays: form.weekdays,
      xpReward: Number(form.xpReward) || 0,
      scheduledMinute: form.time ? timeToMinute(form.time) : null,
      steps: steps
        .filter((s) => s.title.trim())
        .map((s) => ({
          title: s.title,
          durationMinutes: s.duration ? Number(s.duration) : null,
          optional: s.optional,
        })),
    }),
  );

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="New routine"
      description="Steps run in order. Optional steps do not count against the reward if you skip them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={submit.pending}
            disabled={form.title.trim().length === 0 || steps.every((s) => !s.title.trim())}
            onClick={async () => {
              const result = await submit.run();
              if (!result) return;
              toast.show('Routine created', { tone: 'ok' });
              onClose();
            }}
          >
            Create routine
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
        label="Routine"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Morning block"
      />

      <TextAreaField
        label="Notes"
        rows={2}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        error={fieldErrors.description}
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 150px' }}>
          <SelectField
            label="Life area"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
          />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <TextField
            label="Usual time"
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <TextField
            label="XP reward"
            type="number"
            min={0}
            value={form.xpReward}
            onChange={(e) => setForm({ ...form, xpReward: e.target.value })}
            error={fieldErrors.xpReward}
            hint="Prorated by steps done"
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Days</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, day) => {
            const on = form.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className="los-press"
                onClick={() =>
                  setForm({
                    ...form,
                    weekdays: on ? form.weekdays.filter((d) => d !== day) : [...form.weekdays, day].sort(),
                  })
                }
                style={{
                  padding: '7px 10px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 'var(--fs-xs)',
                  cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--c-accent-border-strong)' : 'var(--c-border-faint)'}`,
                  background: on ? 'var(--c-accent-wash-strong)' : 'transparent',
                  color: on ? 'var(--c-text)' : 'var(--c-text-muted)',
                }}
              >
                {name}
              </button>
            );
          })}
        </div>
        <p className="field-hint">Leave all unselected for a routine you run whenever you want.</p>
      </div>

      {/* ---------- steps ---------- */}
      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            STEPS, IN ORDER
          </p>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setSteps([...steps, blankStep()])}>
            Add step
          </Button>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          {steps.map((step, i) => (
            <div className="row" key={i} style={{ gap: 8, alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', width: 15, flex: 'none' }}>
                {i + 1}
              </span>
              <div className="grow">
                <label className="los-sr" htmlFor={`step-${i}`}>
                  Step {i + 1}
                </label>
                <input
                  id={`step-${i}`}
                  className="input"
                  value={step.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder={i === 0 ? 'Make the bed' : 'Next step'}
                />
              </div>
              <div style={{ flex: '0 1 78px' }}>
                <label className="los-sr" htmlFor={`step-dur-${i}`}>
                  Step {i + 1} minutes
                </label>
                <input
                  id={`step-dur-${i}`}
                  className="input"
                  type="number"
                  min={0}
                  value={step.duration}
                  onChange={(e) => update(i, { duration: e.target.value })}
                  placeholder="min"
                />
              </div>
              <label
                className="row"
                style={{ gap: 5, fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', cursor: 'pointer', flex: 'none' }}
              >
                <input
                  type="checkbox"
                  checked={step.optional}
                  onChange={(e) => update(i, { optional: e.target.checked })}
                />
                optional
              </label>
              <IconButton
                icon="close"
                label={`Remove step ${i + 1}`}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                disabled={steps.length === 1}
              />
            </div>
          ))}
        </div>

        {fieldErrors.steps ? (
          <p className="field-error" role="alert" style={{ marginTop: 8 }}>
            <Icon name="alert" size={12} />
            {fieldErrors.steps}
          </p>
        ) : null}
      </div>
    </Modal>
  );

  function update(index: number, patch: Partial<StepRow>) {
    setSteps(steps.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
}

function blank() {
  return { title: '', description: '', area: 'Other', weekdays: [] as number[], xpReward: '50', time: '' };
}

function blankStep(): StepRow {
  return { title: '', duration: '', optional: false };
}

function timeToMinute(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
