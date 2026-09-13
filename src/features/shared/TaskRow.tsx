/**
 * The task row.
 *
 * One implementation, used by the dashboard, the task list, project pages and
 * goal pages - so a task looks and behaves identically everywhere, per master
 * prompt section 13.
 *
 * The checkbox is optimistic (section 19): completion is a lightweight, easily
 * reversible state change, so the tick lands immediately and reverts with a
 * toast if the write fails. Anything with wider consequences is not optimistic.
 */

import { useRef, useState } from 'react';

import { Checkbox, IconButton, PriorityDot, cx } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/overlays';
import { completeTask, uncompleteTask } from '../../data/actions';
import { formatDue } from '../../domain/dates';
import { achievementName } from '../../domain/achievements';
import { achievementAlertsEnabled } from '../../domain/nudges';
import type { TaskView } from '../../domain/selectors';

export function TaskRow({
  view,
  onOpen,
  showContext = true,
}: {
  view: TaskView;
  onOpen?: (view: TaskView) => void;
  showContext?: boolean;
}) {
  const toast = useToast();
  const { task } = view;

  // Optimistic local override; null means "use the stored value".
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const done = optimistic ?? task.status === 'COMPLETED';

  // A ref, not the busy state: several clicks in one tick all run before React
  // re-renders, so a state flag cannot stop the second one. The data layer is
  // already safe (actions are serialized); this stops one completion producing
  // a stack of duplicate toasts.
  const inFlight = useRef(false);

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const next = !done;
    setOptimistic(next);
    setBusy(true);
    try {
      const result = next ? await completeTask(task.id) : await uncompleteTask(task.id);
      if (next) {
        toast.show(
          result.xpAwarded > 0 ? `${task.title} · +${result.xpAwarded} XP` : `${task.title} completed`,
          {
            tone: result.xpAwarded > 0 ? 'xp' : 'ok',
            action: { label: 'Undo', run: () => void uncompleteTask(task.id) },
          },
        );
        if (result.leveledUp) {
          toast.show(`Level ${result.newLevel}${result.rankedUp ? ` · ${result.newRank}` : ''}`, {
            tone: 'xp',
          });
        }
        if (achievementAlertsEnabled()) for (const id of result.unlockedAchievements) {
          toast.show(`Achievement unlocked · ${achievementName(id)}`, { tone: 'xp' });
        }
      }
    } catch (err) {
      // Revert, and say so - a silent revert looks like the click was ignored.
      setOptimistic(null);
      toast.showError(
        err instanceof Error ? err.message : 'That could not be saved, so nothing changed.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      // Let the store's real value take over once it has caught up.
      setOptimistic(null);
    }
  };

  const due = formatDue(task.dueAt);

  return (
    <div className={cx('list-row los-row', onOpen && 'list-row-button')}>
      <PriorityDot priority={task.priority} />

      <Checkbox
        checked={done}
        onChange={toggle}
        busy={busy}
        label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
      />

      <button
        type="button"
        className="grow"
        onClick={() => onOpen?.(view)}
        disabled={!onOpen}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          textAlign: 'left',
          cursor: onOpen ? 'pointer' : 'default',
          minWidth: 0,
        }}
      >
        <div className={cx('row-title', 'truncate', done && 'row-title-done')}>{task.title}</div>
        {showContext && (view.contextLabel || due) ? (
          <div className="row-meta truncate">
            {view.contextLabel}
            {view.contextLabel && due ? ' · ' : ''}
            {due ? (
              <span style={{ color: view.overdue ? 'var(--c-danger-bright)' : undefined }}>
                {view.overdue ? `overdue · ${due}` : due}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>

      {view.subtasks.length > 0 ? (
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}
          title={`${view.subtasks.filter((s) => s.status === 'COMPLETED').length} of ${view.subtasks.length} subtasks done`}
        >
          {view.subtasks.filter((s) => s.status === 'COMPLETED').length}/{view.subtasks.length}
        </span>
      ) : null}

      <span
        className="mono"
        style={{
          fontSize: 'var(--fs-3xs)',
          color: done ? 'var(--c-text-ghost)' : 'var(--c-accent-text)',
          flex: 'none',
          minWidth: 34,
          textAlign: 'right',
        }}
      >
        {done ? '—' : `+${view.xpValue}`}
      </span>

      {onOpen ? (
        <IconButton
          icon="chevronRight"
          label={`Open "${task.title}"`}
          size="sm"
          onClick={() => onOpen(view)}
        />
      ) : null}
    </div>
  );
}

/** Group heading above a run of task rows. */
export function TaskGroupLabel({ label, count }: { label: string; count: number }) {
  const isOverdue = label === 'OVERDUE';
  return (
    <div className="group-label">
      {isOverdue ? <Icon name="alert" size={12} color="var(--c-danger-bright)" /> : null}
      <span style={{ color: isOverdue ? 'var(--c-danger-bright)' : undefined }}>{label}</span>
      <span style={{ color: 'var(--c-text-ghost)' }}>{count}</span>
    </div>
  );
}
