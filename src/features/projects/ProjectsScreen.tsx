/**
 * Projects.
 *
 * UI/UX section 19 frames this as the screen that answers "which one are you
 * actually doing right now" from the data instead of from memory - so each card
 * leads with real progress, its health, and the single next open task.
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
import { useAction, useCollection, useSelector } from '../../app/hooks';
import { areaHex, selectProjects, type ProjectView } from '../../domain/selectors';
import { createProject, updateProject } from '../../data/actions';
import { describeProjectProgress, healthLabel, type Health } from '../../domain/progress';
import { LIFE_AREAS, PRIORITIES, PROJECT_STATUSES, type LifeArea, type Project } from '../../data/schema';
import { AppError } from '../../data/errors';

type Filter = 'active' | 'completed' | 'archived';

export default function ProjectsScreen() {
  const projects = useSelector(selectProjects);
  const [filter, setFilter] = useState<Filter>('active');
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = projects.filter((v) => {
    if (filter === 'completed') return v.project.status === 'COMPLETED';
    if (filter === 'archived') return v.project.status === 'ARCHIVED';
    return v.project.status !== 'COMPLETED' && v.project.status !== 'ARCHIVED';
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Where the goals turn into something you can actually pick up."
        actions={
          <>
            <Tabs
              label="Project filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'completed', label: 'Shipped' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New project
            </Button>
          </>
        }
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="projects"
            title={filter === 'active' ? 'No active projects' : `Nothing ${filter}`}
            body={
              filter === 'active'
                ? 'A project holds milestones and tasks, and reports honest progress from them. If a goal feels too big to start, a project is how you make it small enough.'
                : `No projects are ${filter} yet.`
            }
            action={
              filter === 'active' ? (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Create a project
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid-cards los-stagger">
          {visible.map((view) => (
            <ProjectCard key={view.project.id} view={view} onEdit={() => setEditing(view.project)} />
          ))}
        </div>
      )}

      <ProjectEditor
        open={creating || editing != null}
        project={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

const HEALTH_TONE: Record<Health, { color: string; border: string }> = {
  ON_TRACK: { color: '#7BB08A', border: 'rgba(123,176,138,.4)' },
  AT_RISK: { color: '#E0637A', border: 'rgba(214,67,92,.4)' },
  OVERDUE: { color: '#E0637A', border: 'rgba(214,67,92,.4)' },
  COMPLETED: { color: '#7BB08A', border: 'rgba(123,176,138,.4)' },
  NO_DEADLINE: { color: '#7B9AD0', border: 'rgba(76,111,174,.4)' },
};

function ProjectCard({ view, onEdit }: { view: ProjectView; onEdit: () => void }) {
  const { project, progress } = view;
  const tone = HEALTH_TONE[view.health];
  const barColor = view.health === 'AT_RISK' || view.health === 'OVERDUE' ? 'var(--c-danger-deep)' : areaHex(project.area);

  return (
    <Card hoverable>
      <div className="spread" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 10 }}>
        <Badge color={tone.color} border={tone.border}>
          {healthLabel(view.health)}
        </Badge>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit "${project.title}"`}
          className="icon-btn icon-btn-sm los-press"
        >
          <Icon name="edit" size={13} />
        </button>
      </div>

      <Link to={`/projects/${project.id}`}>
        <h3 style={{ fontSize: 'var(--fs-4xl)', fontWeight: 600, margin: '0 0 5px', lineHeight: 1.3 }}>
          {project.title}
        </h3>
      </Link>
      {project.description ? (
        <p
          style={{
            fontSize: 'var(--fs-md)',
            color: 'var(--c-text-dim)',
            margin: '0 0 14px',
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {project.description}
        </p>
      ) : (
        <div style={{ height: 10 }} />
      )}

      <div className="spread" style={{ marginBottom: 6, gap: 8 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)' }}>
          {describeProjectProgress(progress)}
        </span>
        <span className="mono" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, flex: 'none' }}>
          {progress.percent}%
        </span>
      </div>
      <ProgressBar
        percent={progress.percent}
        color={barColor}
        label={`${project.title}: ${progress.percent}% complete`}
      />

      {view.nextTask ? (
        <div
          className="row"
          style={{
            gap: 8,
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--c-border-ghost)',
          }}
        >
          <Icon name="chevronRight" size={13} color="var(--c-accent-text)" />
          <span className="truncate" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)' }}>
            {view.nextTask.title}
          </span>
        </div>
      ) : progress.tasksTotal > 0 ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '14px 0 0' }}>
          No open tasks left.
        </p>
      ) : null}

      <div
        className="row"
        style={{ gap: 14, marginTop: 12, fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)' }}
      >
        <span>{view.openTasks} open</span>
        {view.goal ? <span className="truncate">Goal · {view.goal.title}</span> : null}
        {view.xp > 0 ? <span className="mono">{view.xp} XP</span> : null}
      </div>
    </Card>
  );
}

/* ================================================================== *
 * Editor
 * ================================================================== */

export function ProjectEditor({
  open,
  project,
  onClose,
  defaults,
}: {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  defaults?: { goalId?: string; area?: LifeArea };
}) {
  const toast = useToast();
  const goals = useCollection('goals');
  const [form, setForm] = useState(() => blank(project, defaults));

  const key = `${open}-${project?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank(project, defaults));
  }

  const submit = useAction(async () => {
    const payload = {
      title: form.title,
      description: form.description,
      area: form.area,
      status: form.status,
      priority: form.priority,
      goalId: form.goalId || null,
      startDate: form.startDate ? new Date(form.startDate).getTime() : null,
      deadline: form.deadline ? new Date(form.deadline).getTime() : null,
      progressOverride: form.useOverride ? Number(form.progressOverride) : null,
    };
    return project ? updateProject(project.id, payload) : createProject(payload);
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  const save = async () => {
    const result = await submit.run();
    if (!result) return;
    toast.show(project ? 'Project updated' : 'Project created', { tone: 'ok' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'New project'}
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
            {project ? 'Save changes' : 'Create project'}
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
        label="Project"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="F1 data project"
      />

      <TextAreaField
        label="Description"
        rows={3}
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
        <div style={{ flex: '1 1 150px' }}>
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))}
          />
        </div>
        {project ? (
          <div style={{ flex: '1 1 150px' }}>
            <SelectField
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={PROJECT_STATUSES.map((s) => ({
                value: s,
                label: s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
              }))}
            />
          </div>
        ) : null}
      </div>

      <SelectField
        label="Goal"
        value={form.goalId}
        onChange={(e) => setForm({ ...form, goalId: e.target.value })}
        options={[{ value: '', label: 'Not linked to a goal' }, ...goals.map((g) => ({ value: g.id, label: g.title }))]}
        error={fieldErrors.goalId}
        hint="Linking it makes this project count toward that goal's progress."
      />

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
            label="Deadline"
            type="date"
            value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            error={fieldErrors.deadline}
          />
        </div>
      </div>

      {/* Manual override, opt-in - normally progress is derived and should stay that way. */}
      <div className="field">
        <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 'var(--fs-md)' }}>
          <input
            type="checkbox"
            checked={form.useOverride}
            onChange={(e) => setForm({ ...form, useOverride: e.target.checked })}
          />
          Set progress manually
        </label>
        <p className="field-hint">
          Off by default. Progress normally comes from milestones and tasks, which keeps it honest.
        </p>
      </div>

      {form.useOverride ? (
        <TextField
          label="Progress (%)"
          type="number"
          min={0}
          max={100}
          value={form.progressOverride}
          onChange={(e) => setForm({ ...form, progressOverride: e.target.value })}
          error={fieldErrors.progressOverride}
        />
      ) : null}
    </Modal>
  );
}

function blank(project: Project | null, defaults?: { goalId?: string; area?: LifeArea }) {
  return {
    title: project?.title ?? '',
    description: project?.description ?? '',
    area: (project?.area ?? defaults?.area ?? 'Projects') as string,
    status: (project?.status ?? 'ACTIVE') as string,
    priority: (project?.priority ?? 'MEDIUM') as string,
    goalId: project?.goalId ?? defaults?.goalId ?? '',
    startDate: project?.startDate ? toDateInput(project.startDate) : '',
    deadline: project?.deadline ? toDateInput(project.deadline) : '',
    useOverride: project?.progressOverride != null,
    progressOverride: String(project?.progressOverride ?? 0),
  };
}

function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
