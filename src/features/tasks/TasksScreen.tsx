/**
 * Tasks.
 *
 * UI/UX section 14 sequences List and Today views first, with Kanban and
 * Timeline as later additions - so those two views plus a Completed history are
 * what this ships, and no empty tab pretends the others exist.
 *
 * Every control here performs a real operation: filters filter stored rows, the
 * checkbox writes, the editor validates through the same boundary the AI tool
 * layer uses, and delete is a recoverable soft delete with an undo.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
  Badge,
  Checkbox,
} from '../../ui/primitives';
import { Drawer, Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { TaskGroupLabel, TaskRow } from '../shared/TaskRow';
import { useAction, useCollection, useSelector } from '../../app/hooks';
import {
  selectCompletedTasks,
  selectListGroups,
  selectTaskViews,
  selectTodayGroups,
  type TaskView,
} from '../../domain/selectors';
import {
  completeTask,
  createTask,
  deleteTask,
  restoreTask,
  updateTask,
  uncompleteTask,
} from '../../data/actions';
import { PRIORITIES, TASK_STATUSES, type Task } from '../../data/schema';
import { formatDue } from '../../domain/dates';
import { describeRecurrence, parseRecurrence, RECURRENCE_PRESETS } from '../../domain/recurrence';
import { AppError } from '../../data/errors';

type View = 'today' | 'list' | 'done';

export default function TasksScreen() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>('today');
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);

  const todayGroups = useSelector(selectTodayGroups);
  const listGroups = useSelector(selectListGroups);
  const completed = useSelector(() => selectCompletedTasks(60));
  const allViews = useSelector(() => selectTaskViews());

  // A `?open=` parameter (from search or the palette) opens that task's panel.
  const openId = params.get('open');
  const openView = useMemo(
    () => (openId ? allViews.find((v) => v.task.id === openId) : undefined),
    [openId, allViews],
  );

  const groups =
    view === 'today' ? todayGroups : view === 'list' ? listGroups : [{ label: 'COMPLETED', items: completed }];

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <>
      <PageHeader
        title="Tasks"
        subtitle="What actually moves the goals forward."
        actions={
          <>
            <Tabs
              label="Task view"
              value={view}
              onChange={setView}
              options={[
                { value: 'today', label: 'Today' },
                { value: 'list', label: 'List' },
                { value: 'done', label: 'Done' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New task
            </Button>
          </>
        }
      />

      <Card flush>
        {total === 0 ? (
          <EmptyState
            icon="tasks"
            title={emptyTitle(view)}
            body={emptyBody(view)}
            action={
              view !== 'done' ? (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Create a task
                </Button>
              ) : undefined
            }
          />
        ) : (
          groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.label}>
                <TaskGroupLabel label={group.label} count={group.items.length} />
                <div className="list">
                  {group.items.map((item) => (
                    <TaskRow
                      key={item.task.id}
                      view={item}
                      onOpen={(v) => setParams({ open: v.task.id })}
                    />
                  ))}
                </div>
              </div>
            ),
          )
        )}
      </Card>

      <TaskDetail
        view={openView}
        onClose={() => setParams({})}
        onEdit={(task) => {
          setParams({});
          setEditing(task);
        }}
      />

      <TaskEditor
        open={creating || editing != null}
        task={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

function emptyTitle(view: View): string {
  if (view === 'done') return 'Nothing completed yet';
  if (view === 'today') return 'Nothing due today';
  return 'No open tasks';
}

function emptyBody(view: View): string {
  if (view === 'done') {
    return 'Completed tasks land here with the XP they earned, so you can see what a week actually contained rather than guessing.';
  }
  if (view === 'today') {
    return 'Nothing is scheduled for today. Either the day is genuinely clear, or something in the list needs a due date to become real.';
  }
  return 'Tasks are the smallest unit the whole system runs on — progress, XP and analytics all start here. Add the next concrete thing you have to do.';
}

/* ================================================================== *
 * Detail panel
 * ================================================================== */

function TaskDetail({
  view,
  onClose,
  onEdit,
}: {
  view: TaskView | undefined;
  onClose: () => void;
  onEdit: (task: Task) => void;
}) {
  const toast = useToast();
  const [statusPending, setStatusPending] = useState(false);
  const confirm = useConfirm();

  if (!view) return null;
  const { task } = view;
  const recurrence = parseRecurrence(task.recurrenceRule);
  const done = task.status === 'COMPLETED';

  return (
    <Drawer
      open
      onClose={onClose}
      title={task.title}
      eyebrow={
        <div className="row" style={{ gap: 7, flexWrap: 'wrap' }}>
          <Badge
            color={task.priority === 'HIGH' ? 'var(--c-danger-bright)' : 'var(--c-text-muted)'}
            border={
              task.priority === 'HIGH' ? 'rgba(194,58,84,.4)' : 'var(--c-border-faint)'
            }
          >
            {task.priority}
          </Badge>
          <Badge color="var(--c-text-muted)">{task.status.replace('_', ' ')}</Badge>
          {view.overdue ? (
            <Badge color="var(--c-danger-bright)" border="rgba(194,58,84,.4)">
              Overdue
            </Badge>
          ) : null}
        </div>
      }
      footer={
        <>
          <Button
            variant="danger"
            icon="trash"
            onClick={() =>
              confirm({
                title: 'Delete this task?',
                body: `"${task.title}" and any subtasks will be removed from your lists.`,
                note: 'This is a soft delete — it can be undone from the toast that appears.',
                actionLabel: 'Delete task',
                danger: true,
                onConfirm: async () => {
                  await deleteTask(task.id);
                  onClose();
                  toast.show('Task deleted', {
                    tone: 'muted',
                    action: { label: 'Undo', run: () => void restoreTask(task.id) },
                  });
                },
              })
            }
          >
            Delete
          </Button>
          <span className="grow" />
          <Button variant="secondary" icon="edit" onClick={() => onEdit(task)}>
            Edit
          </Button>
          <Button
            variant={done ? 'secondary' : 'primary'}
            icon={done ? 'undo' : 'check'}
            loading={statusPending}
            onClick={async () => {
              // Guarded and caught: a double click used to toast twice, and a
              // failed write surfaced as nothing at all.
              if (statusPending) return;
              setStatusPending(true);
              try {
                if (done) {
                  await uncompleteTask(task.id);
                  toast.show('Task reopened', { tone: 'muted' });
                } else {
                  const result = await completeTask(task.id);
                  toast.show(
                    result.xpAwarded > 0 ? `Completed · +${result.xpAwarded} XP` : 'Completed',
                    { tone: result.xpAwarded > 0 ? 'xp' : 'ok' },
                  );
                }
              } catch (err) {
                toast.showError(err instanceof Error ? err.message : 'That could not be saved, so nothing changed.');
              } finally {
                setStatusPending(false);
              }
            }}
          >
            {done ? 'Reopen' : 'Complete'}
          </Button>
        </>
      }
    >
      {task.description ? (
        <p style={{ margin: 0, fontSize: 'var(--fs-lg)', lineHeight: 1.65, color: 'var(--c-text-body)' }}>
          {task.description}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--c-text-ghost)' }}>
          No description.
        </p>
      )}

      <dl className="stack" style={{ gap: 0, margin: 0 }}>
        <DetailRow label="Due" value={task.dueAt ? formatDue(task.dueAt) : 'No due date'} />
        <DetailRow
          label="Estimate"
          value={task.estimatedMinutes ? `${task.estimatedMinutes} min` : 'Not estimated'}
        />
        <DetailRow label="XP on completion" value={done ? 'Already awarded' : `+${view.xpValue}`} />
        <DetailRow label="Repeats" value={describeRecurrence(recurrence)} />
        <DetailRow label="Project" value={view.project?.title ?? 'None'} />
        <DetailRow label="Goal" value={view.goal?.title ?? 'None'} />
        {done && task.completedAt ? (
          <DetailRow label="Completed" value={new Date(task.completedAt).toLocaleString()} />
        ) : null}
      </dl>

      {view.subtasks.length > 0 ? (
        <div>
          <p className="card-kicker">
            Subtasks · {view.subtasks.filter((s) => s.status === 'COMPLETED').length}/
            {view.subtasks.length}
          </p>
          <div className="list">
            {view.subtasks.map((sub) => (
              <div className="list-row" key={sub.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <Checkbox
                  checked={sub.status === 'COMPLETED'}
                  label={`Complete "${sub.title}"`}
                  onChange={async () => {
                    if (sub.status === 'COMPLETED') await uncompleteTask(sub.id);
                    else await completeTask(sub.id);
                  }}
                />
                <span
                  className={`grow truncate row-title${sub.status === 'COMPLETED' ? ' row-title-done' : ''}`}
                >
                  {sub.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="spread"
      style={{ padding: '9px 0', borderBottom: '1px solid var(--c-border-ghost)', gap: 12 }}
    >
      <dt style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>{label}</dt>
      <dd
        style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--c-text-strong)', textAlign: 'right' }}
      >
        {value}
      </dd>
    </div>
  );
}

/* ================================================================== *
 * Create / edit
 * ================================================================== */

export function TaskEditor({
  open,
  task,
  onClose,
  defaults,
}: {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  defaults?: { projectId?: string; goalId?: string; parentTaskId?: string };
}) {
  const toast = useToast();
  const projects = useCollection('projects');
  const goals = useCollection('goals');

  const [form, setForm] = useState(() => blankForm(task, defaults));

  // Reset whenever the editor opens for a different task.
  const key = `${open}-${task?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blankForm(task, defaults));
  }

  const submit = useAction(async () => {
    const payload = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      dueAt: form.dueAt ? new Date(form.dueAt).getTime() : null,
      estimatedMinutes: form.estimatedMinutes ? Number(form.estimatedMinutes) : null,
      projectId: form.projectId || null,
      goalId: form.goalId || null,
      parentTaskId: form.parentTaskId || null,
      recurrenceRule: form.recurrenceRule || null,
    };
    return task ? updateTask(task.id, payload) : createTask(payload);
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  const save = async () => {
    const result = await submit.run();
    if (!result) return;
    toast.show(task ? 'Task updated' : 'Task created', { tone: 'ok' });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      description={
        task ? undefined : 'Only a title is required — everything else can be filled in later.'
      }
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
            {task ? 'Save changes' : 'Create task'}
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
        label="Title"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Draft the Michigan essay opening"
      />

      <TextAreaField
        label="Description"
        rows={3}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        error={fieldErrors.description}
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 140px' }}>
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))}
            hint="Sets the XP value"
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <SelectField
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={TASK_STATUSES.filter((s) => s !== 'COMPLETED').map((s) => ({
              value: s,
              label: s.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
        </div>
        <div style={{ flex: '1 1 170px' }}>
          <TextField
            label="Due"
            type="datetime-local"
            value={form.dueAt}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            error={fieldErrors.dueAt}
          />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <TextField
            label="Estimate (min)"
            type="number"
            min={0}
            value={form.estimatedMinutes}
            onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value })}
            error={fieldErrors.estimatedMinutes}
            hint="Adds effort XP"
          />
        </div>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 180px' }}>
          <SelectField
            label="Project"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            options={[{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: p.title }))]}
            error={fieldErrors.projectId}
          />
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <SelectField
            label="Goal"
            value={form.goalId}
            onChange={(e) => setForm({ ...form, goalId: e.target.value })}
            options={[{ value: '', label: 'None' }, ...goals.map((g) => ({ value: g.id, label: g.title }))]}
            error={fieldErrors.goalId}
          />
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <SelectField
            label="Repeats"
            value={form.recurrenceRule}
            onChange={(e) => setForm({ ...form, recurrenceRule: e.target.value })}
            options={RECURRENCE_PRESETS.map((p) => ({ value: p.rule ?? '', label: p.label }))}
            error={fieldErrors.recurrenceRule}
            hint="Completing it schedules the next one"
          />
        </div>
      </div>
    </Modal>
  );
}

function blankForm(
  task: Task | null,
  defaults?: { projectId?: string; goalId?: string; parentTaskId?: string },
) {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: (task?.status === 'COMPLETED' ? 'TODO' : (task?.status ?? 'TODO')) as string,
    priority: (task?.priority ?? 'MEDIUM') as string,
    dueAt: task?.dueAt ? toLocalInput(task.dueAt) : '',
    estimatedMinutes: task?.estimatedMinutes != null ? String(task.estimatedMinutes) : '',
    projectId: task?.projectId ?? defaults?.projectId ?? '',
    goalId: task?.goalId ?? defaults?.goalId ?? '',
    parentTaskId: task?.parentTaskId ?? defaults?.parentTaskId ?? '',
    recurrenceRule: task?.recurrenceRule ?? '',
  };
}

/** `datetime-local` needs a local-time string, not an ISO UTC one. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export { toLocalInput };
