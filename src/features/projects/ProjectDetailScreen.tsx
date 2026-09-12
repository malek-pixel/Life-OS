/**
 * Project detail.
 *
 * Milestones, tasks, and an activity log assembled from the project's real
 * completion timestamps. UI/UX section 19 asks for health and progress per
 * project; both are derived here, never stored.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  ProgressBar,
  StatTile,
  TextField,
} from '../../ui/primitives';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { TaskRow } from '../shared/TaskRow';
import { ProjectEditor } from './ProjectsScreen';
import { TaskEditor } from '../tasks/TasksScreen';
import { useAction, useSelector } from '../../app/hooks';
import { areaHex, selectProject, selectTaskViews } from '../../domain/selectors';
import {
  completeProject,
  createMilestone,
  deleteMilestone,
  deleteProject,
  toggleMilestone,
} from '../../data/actions';
import { describeProjectProgress, healthLabel } from '../../domain/progress';
import { formatMonthDay, formatRelativeDay, toDayKey } from '../../domain/dates';
import { store } from '../../data/store';
import { AppError } from '../../data/errors';

export default function ProjectDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const view = useSelector(() => selectProject(id), [id]);
  const tasks = useSelector(() =>
    selectTaskViews().filter((t) => t.task.projectId === id && t.task.parentTaskId == null),
    [id],
  );
  const milestones = useSelector(() =>
    store
      .live('milestones')
      .filter((m) => m.projectId === id)
      .sort((a, b) => a.orderIndex - b.orderIndex),
    [id],
  );

  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);

  if (!view) {
    return (
      <ErrorState
        title="Project not found"
        message="This project no longer exists — it may have been deleted."
        onRetry={() => navigate('/projects')}
        retryLabel="Back to projects"
      />
    );
  }

  const { project, progress } = view;
  const color = areaHex(project.area);
  const done = project.status === 'COMPLETED';

  /* --- activity, from real completion timestamps on this project's rows --- */
  const activity = [
    ...milestones
      .filter((m) => m.completedAt != null)
      .map((m) => ({ at: m.completedAt!, label: `Milestone: ${m.title}` })),
    ...tasks
      .filter((t) => t.task.completedAt != null)
      .map((t) => ({ at: t.task.completedAt!, label: `Task: ${t.task.title}` })),
    ...(project.completedAt != null
      ? [{ at: project.completedAt, label: 'Project shipped' }]
      : []),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={describeProjectProgress(progress)}
        actions={
          <>
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {!done ? (
              <Button
                variant="primary"
                icon="check"
                onClick={() =>
                  confirm({
                    title: 'Ship this project?',
                    body:
                      progress.tasksTotal > progress.tasksDone
                        ? `${progress.tasksTotal - progress.tasksDone} task(s) are still open. Marking the project shipped sets it to 100% regardless.`
                        : 'This marks the project complete and awards its XP.',
                    actionLabel: 'Mark shipped',
                    onConfirm: async () => {
                      const result = await completeProject(project.id);
                      toast.show(`Shipped · +${result.xpAwarded} XP`, { tone: 'xp' });
                    },
                  })
                }
              >
                Mark shipped
              </Button>
            ) : null}
          </>
        }
      />

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge color={color} border={`${color}59`}>
          {project.area}
        </Badge>
        <Badge
          color={view.health === 'AT_RISK' || view.health === 'OVERDUE' ? 'var(--c-danger-bright)' : 'var(--c-text-muted)'}
          border={view.health === 'AT_RISK' || view.health === 'OVERDUE' ? 'rgba(194,58,84,.4)' : 'var(--c-border-faint)'}
        >
          {healthLabel(view.health)}
        </Badge>
        {view.goal ? (
          <Link to={`/goals/${view.goal.id}`}>
            <Badge color="var(--c-accent-text)" border="var(--c-accent-border-soft)">
              Goal · {view.goal.title}
            </Badge>
          </Link>
        ) : null}
        {project.deadline ? (
          <Badge color="var(--c-text-muted)">Due {formatMonthDay(toDayKey(project.deadline))}</Badge>
        ) : null}
      </div>

      <Card style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 10, gap: 12 }}>
          <span className="card-kicker" style={{ margin: 0 }}>
            PROGRESS
          </span>
          <span className="mono" style={{ fontSize: 'var(--fs-6xl)', fontWeight: 700, lineHeight: 1, color }}>
            {progress.percent}%
          </span>
        </div>
        <ProgressBar
          percent={progress.percent}
          color={view.health === 'AT_RISK' ? 'var(--c-danger-deep)' : color}
          large
          label={`${project.title}: ${progress.percent}% complete`}
        />
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', margin: '10px 0 0' }}>
          {progress.source === 'blended'
            ? 'Milestones count for 60% and tasks for 40% — a milestone is a bigger unit of real progress than a single task.'
            : progress.source === 'override'
              ? 'Set manually in the project settings.'
              : progress.source === 'empty'
                ? 'Add milestones or tasks to start measuring progress.'
                : `Derived from ${progress.source}.`}
        </p>
      </Card>

      {project.description ? (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-lg)', lineHeight: 1.7, color: 'var(--c-text-body)' }}>
            {project.description}
          </p>
        </Card>
      ) : null}

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatTile label="TASKS" value={`${progress.tasksDone}/${progress.tasksTotal}`} delta="done" />
        <StatTile
          label="MILESTONES"
          value={`${progress.milestonesDone}/${progress.milestonesTotal}`}
          delta="done"
        />
        <StatTile label="OPEN" value={String(view.openTasks)} delta="remaining" />
        <StatTile
          label="XP"
          value={String(view.xp)}
          delta="earned here"
          tone={view.xp > 0 ? 'accent' : 'muted'}
        />
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- milestones ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader
                kicker="MILESTONES"
                title="The checkpoints"
                action={
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => setAddingMilestone(true)}>
                    Add
                  </Button>
                }
              />
            </div>
            {milestones.length === 0 ? (
              <EmptyState
                icon="flag"
                title="No milestones"
                body="Milestones are the few moments that actually mark progress. Three or four per project is usually enough to tell whether it is moving."
                action={
                  <Button variant="secondary" icon="plus" onClick={() => setAddingMilestone(true)}>
                    Add a milestone
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {milestones.map((m) => (
                  <div className="list-row los-row" key={m.id}>
                    <Checkbox
                      checked={m.status === 'COMPLETED'}
                      label={
                        m.status === 'COMPLETED'
                          ? `Reopen milestone "${m.title}"`
                          : `Complete milestone "${m.title}"`
                      }
                      onChange={async () => {
                        const result = await toggleMilestone(m.id);
                        if (m.status !== 'COMPLETED') {
                          toast.show(`Milestone reached · +${result.xpAwarded} XP`, { tone: 'xp' });
                        }
                      }}
                    />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div
                        className={`row-title truncate${m.status === 'COMPLETED' ? ' row-title-done' : ''}`}
                      >
                        {m.title}
                      </div>
                      {m.targetDate ? (
                        <div className="row-meta">Target {formatMonthDay(toDayKey(m.targetDate))}</div>
                      ) : null}
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-3xs)',
                        color: m.status === 'COMPLETED' ? 'var(--c-text-ghost)' : 'var(--c-accent-text)',
                        flex: 'none',
                      }}
                    >
                      {m.status === 'COMPLETED' ? '—' : '+100'}
                    </span>
                    <IconButton
                      icon="trash"
                      label={`Delete milestone "${m.title}"`}
                      size="sm"
                      onClick={() =>
                        confirm({
                          title: 'Delete this milestone?',
                          body: `"${m.title}" will be removed and project progress will recalculate.`,
                          actionLabel: 'Delete milestone',
                          danger: true,
                          onConfirm: async () => {
                            await deleteMilestone(m.id);
                            toast.show('Milestone deleted', { tone: 'muted' });
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- tasks ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader
                kicker="TASKS"
                title={`${view.openTasks} open`}
                action={
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => setAddingTask(true)}>
                    Add
                  </Button>
                }
              />
            </div>
            {tasks.length === 0 ? (
              <EmptyState
                icon="tasks"
                title="No tasks yet"
                body="Tasks are what you actually do. Until there is at least one, this project has no way to report progress."
                action={
                  <Button variant="secondary" icon="plus" onClick={() => setAddingTask(true)}>
                    Add a task
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {tasks.map((t) => (
                  <TaskRow key={t.task.id} view={t} showContext={false} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- activity ---------- */}
          <Card>
            <CardHeader kicker="ACTIVITY" title="What has actually happened" />
            {activity.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
                No completions logged yet. This list is built from real timestamps, so it fills in as
                you finish things rather than being written up afterwards.
              </p>
            ) : (
              <div className="stack" style={{ gap: 11 }}>
                {activity.map((item, i) => (
                  <div className="row" key={i} style={{ gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: 'none' }}
                    />
                    <span
                      className="mono"
                      style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', width: 66, flex: 'none' }}
                    >
                      {formatRelativeDay(toDayKey(item.at))}
                    </span>
                    <span className="grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader kicker="MANAGE" title="Delete project" />
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 14px', lineHeight: 1.6 }}>
              Deleting removes the project and its milestones. Its tasks are unlinked rather than
              deleted, so work in flight is never lost by accident.
            </p>
            <Button
              variant="danger"
              icon="trash"
              onClick={() =>
                confirm({
                  title: 'Delete this project?',
                  body: `"${project.title}" and its ${milestones.length} milestone(s) will be removed.`,
                  note: `Its ${tasks.length} task(s) will be unlinked, not deleted.`,
                  actionLabel: 'Delete project',
                  danger: true,
                  onConfirm: async () => {
                    await deleteProject(project.id);
                    toast.show('Project deleted', { tone: 'muted' });
                    navigate('/projects');
                  },
                })
              }
            >
              Delete project
            </Button>
          </Card>
        </div>
      </div>

      <ProjectEditor open={editing} project={project} onClose={() => setEditing(false)} />
      <TaskEditor
        open={addingTask}
        task={null}
        defaults={{ projectId: project.id, goalId: project.goalId ?? undefined }}
        onClose={() => setAddingTask(false)}
      />
      <MilestoneModal
        open={addingMilestone}
        projectId={project.id}
        onClose={() => setAddingMilestone(false)}
      />
    </>
  );
}

function MilestoneModal({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const key = String(open);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setTitle('');
    setTargetDate('');
  }

  const submit = useAction(() =>
    createMilestone(projectId, {
      title,
      targetDate: targetDate ? new Date(targetDate).getTime() : null,
    }),
  );

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New milestone"
      description="Worth 100 XP when reached, and weighted more heavily than a task in project progress."
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
              toast.show('Milestone added', { tone: 'ok' });
              onClose();
            }}
            loading={submit.pending}
            disabled={title.trim().length === 0}
          >
            Add milestone
          </Button>
        </>
      }
    >
      <TextField
        label="Milestone"
        required
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={fieldErrors.title}
        placeholder="Auth shipped"
      />
      <TextField
        label="Target date"
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.target.value)}
        error={fieldErrors.targetDate}
      />
    </Modal>
  );
}
