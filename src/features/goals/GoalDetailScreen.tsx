/**
 * Goal detail.
 *
 * Shows the goal and everything that rolls up into it - projects, direct tasks,
 * quests, and the XP the goal has generated. The relationships are the point:
 * this is where "is this goal actually being worked on" is answered by the data
 * rather than by memory.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  StatTile,
} from '../../ui/primitives';
import { useConfirm, useToast } from '../../ui/overlays';
import { TaskRow } from '../shared/TaskRow';
import { GoalEditor } from './GoalsScreen';
import { TaskEditor } from '../tasks/TasksScreen';
import { ProjectEditor } from '../projects/ProjectsScreen';
import { useSelector } from '../../app/hooks';
import {
  areaHex,
  selectGoal,
  selectProjects,
  selectQuests,
  selectTaskViews,
} from '../../domain/selectors';
import { archiveGoal, completeGoal, deleteGoal, reopenGoal } from '../../data/actions';
import { describeGoalProgress, describeProjectProgress, healthLabel } from '../../domain/progress';
import { formatMonthDay, toDayKey } from '../../domain/dates';
import { store } from '../../data/store';

export default function GoalDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const view = useSelector(() => selectGoal(id), [id]);
  const projects = useSelector(() => selectProjects().filter((p) => p.project.goalId === id), [id]);
  const tasks = useSelector(() =>
    selectTaskViews().filter(
      (t) => t.task.goalId === id && t.task.projectId == null && t.task.parentTaskId == null,
    ),
    [id],
  );
  const quests = useSelector(() => selectQuests().filter((q) => q.quest.goalId === id), [id]);
  const xp = useSelector(() =>
    store
      .live('xpEvents')
      .filter((e) => e.sourceType === 'GOAL' && e.sourceId === id)
      .reduce((sum, e) => sum + e.amount, 0),
    [id],
  );

  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [addingProject, setAddingProject] = useState(false);

  if (!view) {
    return (
      <ErrorState
        title="Goal not found"
        message="This goal no longer exists — it may have been deleted."
        onRetry={() => navigate('/goals')}
        retryLabel="Back to goals"
      />
    );
  }

  const { goal, progress } = view;
  const color = areaHex(goal.area);
  const done = goal.status === 'COMPLETED';

  return (
    <>
      <PageHeader
        title={goal.title}
        subtitle={describeGoalProgress(progress)}
        actions={
          <>
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant={done ? 'secondary' : 'primary'}
              icon={done ? 'undo' : 'check'}
              onClick={async () => {
                if (done) {
                  await reopenGoal(goal.id);
                  toast.show('Goal reopened', { tone: 'muted' });
                } else {
                  const result = await completeGoal(goal.id);
                  toast.show(`Goal reached · +${result.xpAwarded} XP`, { tone: 'xp' });
                }
              }}
            >
              {done ? 'Reopen' : 'Mark reached'}
            </Button>
          </>
        }
      />

      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge color={color} border={`${color}59`}>
          {goal.area}
        </Badge>
        <Badge
          color={
            view.health === 'AT_RISK' || view.health === 'OVERDUE'
              ? 'var(--c-danger-bright)'
              : 'var(--c-text-muted)'
          }
          border={
            view.health === 'AT_RISK' || view.health === 'OVERDUE'
              ? 'rgba(194,58,84,.4)'
              : 'var(--c-border-faint)'
          }
        >
          {healthLabel(view.health)}
        </Badge>
        <Badge color="var(--c-text-muted)">{goal.priority}</Badge>
        {goal.targetDate ? (
          <Badge color="var(--c-text-muted)">Due {formatMonthDay(toDayKey(goal.targetDate))}</Badge>
        ) : null}
      </div>

      {/* ---------- progress ---------- */}
      <Card style={{ marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 10, gap: 12 }}>
          <span className="card-kicker" style={{ margin: 0 }}>
            PROGRESS
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-6xl)', fontWeight: 700, lineHeight: 1, color }}
          >
            {progress.percent}%
          </span>
        </div>
        <ProgressBar
          percent={progress.percent}
          color={color}
          large
          label={`${goal.title}: ${progress.percent}% complete`}
        />
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', margin: '10px 0 0' }}>
          {progress.source === 'rollup'
            ? 'Derived from the projects and tasks below. Complete work and this moves on its own.'
            : progress.source === 'numeric'
              ? `Measured value: ${describeGoalProgress(progress)}. Edit the goal to update it.`
              : progress.source === 'manual'
                ? 'Set manually — nothing recalculates this for you.'
                : 'Nothing is linked to this goal yet, so there is nothing to measure.'}
        </p>
      </Card>

      {goal.description ? (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader kicker="WHY" title="What this is for" />
          <p style={{ margin: 0, fontSize: 'var(--fs-lg)', lineHeight: 1.7, color: 'var(--c-text-body)' }}>
            {goal.description}
          </p>
        </Card>
      ) : null}

      <div className="grid-stats" style={{ marginBottom: 16 }}>
        <StatTile label="PROJECTS" value={String(projects.length)} delta="linked" />
        <StatTile label="TASKS" value={String(view.taskCount)} delta="total" />
        <StatTile label="QUESTS" value={String(quests.length)} delta="linked" />
        <StatTile label="XP EARNED" value={String(xp)} delta="from this goal" tone={xp > 0 ? 'accent' : 'muted'} />
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- projects ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader
                kicker="PROJECTS"
                title="The work"
                action={
                  <Button size="sm" variant="secondary" icon="plus" onClick={() => setAddingProject(true)}>
                    Add
                  </Button>
                }
              />
            </div>
            {projects.length === 0 ? (
              <EmptyState
                icon="projects"
                title="No projects yet"
                body="Projects break a goal into things with their own milestones and tasks. Most goals need at least one to become actionable."
                action={
                  <Button variant="secondary" icon="plus" onClick={() => setAddingProject(true)}>
                    Add a project
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {projects.map((p) => (
                  <Link key={p.project.id} to={`/projects/${p.project.id}`} className="list-row los-row">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-title truncate">{p.project.title}</div>
                      <div className="row-meta">{describeProjectProgress(p.progress)}</div>
                      <div style={{ marginTop: 7 }}>
                        <ProgressBar
                          percent={p.progress.percent}
                          color={p.health === 'AT_RISK' ? 'var(--c-danger-deep)' : color}
                          label={`${p.project.title}: ${p.progress.percent}%`}
                          animate={false}
                        />
                      </div>
                    </div>
                    <span
                      className="mono"
                      style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', flex: 'none', width: 38, textAlign: 'right' }}
                    >
                      {p.progress.percent}%
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- direct tasks ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader
                kicker="DIRECT TASKS"
                title="Not under a project"
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
                title="No loose tasks"
                body="Tasks attached straight to the goal appear here — useful for one-off work that does not belong to a project."
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
          {/* ---------- quests ---------- */}
          {quests.length > 0 ? (
            <Card>
              <CardHeader kicker="QUESTS" title="Tied to this goal" />
              <div className="stack" style={{ gap: 12 }}>
                {quests.map((q) => (
                  <div key={q.quest.id}>
                    <div className="spread" style={{ gap: 8, marginBottom: 6 }}>
                      <span className="truncate" style={{ fontSize: 'var(--fs-md)' }}>
                        {q.quest.title}
                      </span>
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', flex: 'none' }}>
                        {q.met}/{q.total}
                      </span>
                    </div>
                    <ProgressBar percent={q.percent} label={`${q.quest.title} progress`} animate={false} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* ---------- danger zone ---------- */}
          <Card>
            <CardHeader kicker="MANAGE" title="Archive or delete" />
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 14px', lineHeight: 1.6 }}>
              Archiving keeps the goal and its history but takes it off your active list. Deleting
              removes the goal and unlinks its projects and tasks — the work itself survives.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                icon="archive"
                onClick={() =>
                  confirm({
                    title: 'Archive this goal?',
                    body: `"${goal.title}" moves to your archive. Its projects, tasks and XP history are untouched.`,
                    actionLabel: 'Archive goal',
                    onConfirm: async () => {
                      await archiveGoal(goal.id);
                      toast.show('Goal archived', { tone: 'muted' });
                      navigate('/goals');
                    },
                  })
                }
              >
                Archive
              </Button>
              <Button
                variant="danger"
                icon="trash"
                onClick={() =>
                  confirm({
                    title: 'Delete this goal?',
                    body: `"${goal.title}" will be removed from your goals.`,
                    note: `Its ${projects.length} project(s) and ${view.taskCount} task(s) are NOT deleted — they are unlinked and stay in your lists.`,
                    actionLabel: 'Delete goal',
                    danger: true,
                    onConfirm: async () => {
                      await deleteGoal(goal.id);
                      toast.show('Goal deleted', { tone: 'muted' });
                      navigate('/goals');
                    },
                  })
                }
              >
                Delete
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <GoalEditor open={editing} goal={goal} onClose={() => setEditing(false)} />
      <TaskEditor
        open={addingTask}
        task={null}
        defaults={{ goalId: goal.id }}
        onClose={() => setAddingTask(false)}
      />
      <ProjectEditor
        open={addingProject}
        project={null}
        defaults={{ goalId: goal.id, area: goal.area }}
        onClose={() => setAddingProject(false)}
      />
    </>
  );
}
