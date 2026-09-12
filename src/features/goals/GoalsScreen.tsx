/**
 * Goals.
 *
 * The progress bar on each card is whatever `goalProgress` derives from the
 * goal's projects and tasks - master prompt section 21 forbids a displayed
 * percentage that is not real, so the card also states where its number came
 * from ("3 projects · 8/14 tasks") rather than asking the user to trust it.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { Modal, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useSelector } from '../../app/hooks';
import { areaHex, selectGoals, type GoalView } from '../../domain/selectors';
import { createGoal, updateGoal } from '../../data/actions';
import { describeGoalProgress, healthLabel } from '../../domain/progress';
import { GOAL_STATUSES, LIFE_AREAS, PRIORITIES, PROGRESS_TYPES, type Goal } from '../../data/schema';
import { AppError } from '../../data/errors';

type Filter = 'active' | 'completed' | 'archived';

export default function GoalsScreen() {
  const goals = useSelector(selectGoals);
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = goals.filter((v) => {
    if (filter === 'completed') return v.goal.status === 'COMPLETED';
    if (filter === 'archived') return v.goal.status === 'ARCHIVED';
    return v.goal.status !== 'COMPLETED' && v.goal.status !== 'ARCHIVED';
  });

  return (
    <>
      <PageHeader
        title="Goals"
        subtitle="The things everything else is in service of."
        actions={
          <>
            <Tabs
              label="Goal filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'completed', label: 'Done' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New goal
            </Button>
          </>
        }
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="goals"
            title={filter === 'active' ? 'No active goals' : `Nothing ${filter}`}
            body={
              filter === 'active'
                ? 'A goal is what gives projects and tasks a reason to exist — and what the dashboard, analytics and Life Map organise themselves around. Start with one you actually care about this year.'
                : `No goals are ${filter} yet. They will appear here once they are.`
            }
            action={
              filter === 'active' ? (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Create a goal
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid-cards los-stagger">
          {visible.map((view) => (
            <GoalCard key={view.goal.id} view={view} onEdit={() => setEditing(view.goal)} />
          ))}
        </div>
      )}

      <GoalEditor
        open={creating || editing != null}
        goal={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

function GoalCard({ view, onEdit }: { view: GoalView; onEdit: () => void }) {
  const { goal, progress } = view;
  const color = areaHex(goal.area);
  const atRisk = view.health === 'AT_RISK' || view.health === 'OVERDUE';

  return (
    <Card hoverable>
      <div className="spread" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 10 }}>
        <Badge color={color} border={`${color}59`}>
          {goal.area}
        </Badge>
        <div className="row" style={{ gap: 4, flex: 'none' }}>
          {atRisk ? (
            <Badge color="var(--c-danger-bright)" border="rgba(194,58,84,.4)">
              {healthLabel(view.health)}
            </Badge>
          ) : null}
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit "${goal.title}"`}
            className="icon-btn icon-btn-sm los-press"
          >
            <Icon name="edit" size={13} />
          </button>
        </div>
      </div>

      <Link to={`/goals/${goal.id}`}>
        <h3 style={{ fontSize: 'var(--fs-4xl)', fontWeight: 600, margin: '0 0 6px', lineHeight: 1.3 }}>
          {goal.title}
        </h3>
      </Link>

      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', margin: '0 0 16px' }}>
        {describeGoalProgress(progress)}
        {view.dueLabel ? ` · due ${view.dueLabel}` : ''}
      </p>

      <div className="spread" style={{ marginBottom: 6, gap: 8 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}>
          PROGRESS
        </span>
        <span
          className="mono"
          style={{
            fontSize: 'var(--fs-lg)',
            fontWeight: 700,
            color: progress.percent >= 70 ? 'var(--c-accent-text)' : 'var(--c-text)',
          }}
        >
          {progress.percent}%
        </span>
      </div>
      <ProgressBar
        percent={progress.percent}
        color={color}
        label={`${goal.title}: ${progress.percent}% complete`}
      />

      <div
        className="row"
        style={{ gap: 14, marginTop: 14, fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)' }}
      >
        <span>{view.projectCount} projects</span>
        <span>{view.taskCount} tasks</span>
        {view.questCount > 0 ? <span>{view.questCount} quests</span> : null}
      </div>
    </Card>
  );
}

/* ================================================================== *
 * Editor
 * ================================================================== */

export function GoalEditor({
  open,
  goal,
  onClose,
}: {
  open: boolean;
  goal: Goal | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(() => blank(goal));

  const key = `${open}-${goal?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank(goal));
  }

  const submit = useAction(async () => {
    const payload = {
      title: form.title,
      description: form.description,
      area: form.area,
      status: form.status,
      priority: form.priority,
      progressType: form.progressType,
      progressValue: Number(form.progressValue) || 0,
      targetValue: form.targetValue ? Number(form.targetValue) : null,
      unit: form.unit || null,
      startDate: form.startDate ? new Date(form.startDate).getTime() : null,
      targetDate: form.targetDate ? new Date(form.targetDate).getTime() : null,
    };
    return goal ? updateGoal(goal.id, payload) : createGoal(payload);
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  const save = async () => {
    const result = await submit.run();
    if (!result) return;
    toast.show(goal ? 'Goal updated' : 'Goal created', { tone: 'ok' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={goal ? 'Edit goal' : 'New goal'}
      description="Progress can roll up from the work you link to it, or be a number you measure directly."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            loading={submit.pending}
            disabled={form.title.trim().length === 0}
          >
            {goal ? 'Save changes' : 'Create goal'}
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
        label="Goal"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Score 1550+ on the SAT"
      />

      <TextAreaField
        label="Why it matters"
        rows={3}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        error={fieldErrors.description}
        hint="Worth writing. This is what you will read on the days you do not feel like it."
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
        <div style={{ flex: '1 1 150px' }}>
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))}
          />
        </div>
        {goal ? (
          <div style={{ flex: '1 1 150px' }}>
            <SelectField
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={GOAL_STATUSES.map((s) => ({
                value: s,
                label: s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
              }))}
            />
          </div>
        ) : null}
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 160px' }}>
          <TextField
            label="Start"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            error={fieldErrors.startDate}
          />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <TextField
            label="Target date"
            type="date"
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
            error={fieldErrors.targetDate}
            hint="Used to judge on-track vs at-risk"
          />
        </div>
      </div>

      <SelectField
        label="How progress is measured"
        value={form.progressType}
        onChange={(e) => setForm({ ...form, progressType: e.target.value })}
        options={[
          { value: 'ROLLUP', label: 'Roll up from projects and tasks' },
          { value: 'NUMERIC', label: 'A number I measure (e.g. 100 kg)' },
          { value: 'MANUAL', label: 'A percentage I set myself' },
        ].filter((o) => PROGRESS_TYPES.includes(o.value as never))}
      />

      {form.progressType === 'NUMERIC' ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 120px' }}>
            <TextField
              label="Current"
              type="number"
              value={form.progressValue}
              onChange={(e) => setForm({ ...form, progressValue: e.target.value })}
              error={fieldErrors.progressValue}
            />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <TextField
              label="Target"
              type="number"
              required
              value={form.targetValue}
              onChange={(e) => setForm({ ...form, targetValue: e.target.value })}
              error={fieldErrors.targetValue}
            />
          </div>
          <div style={{ flex: '1 1 100px' }}>
            <TextField
              label="Unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="kg"
            />
          </div>
        </div>
      ) : null}

      {form.progressType === 'MANUAL' ? (
        <TextField
          label="Progress (%)"
          type="number"
          min={0}
          max={100}
          value={form.progressValue}
          onChange={(e) => setForm({ ...form, progressValue: e.target.value })}
          error={fieldErrors.progressValue}
          hint="You own this number — nothing recalculates it for you."
        />
      ) : null}
    </Modal>
  );
}

function blank(goal: Goal | null) {
  return {
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    area: (goal?.area ?? 'Other') as string,
    status: (goal?.status ?? 'ACTIVE') as string,
    priority: (goal?.priority ?? 'MEDIUM') as string,
    progressType: (goal?.progressType ?? 'ROLLUP') as string,
    progressValue: String(goal?.progressValue ?? 0),
    targetValue: goal?.targetValue != null ? String(goal.targetValue) : '',
    unit: goal?.unit ?? '',
    startDate: goal?.startDate ? toDateInput(goal.startDate) : '',
    targetDate: goal?.targetDate ? toDateInput(goal.targetDate) : '',
  };
}

export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
