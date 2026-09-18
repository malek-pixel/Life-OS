/**
 * TODAY - the daily plan.
 *
 * At most four tasks, chosen each morning from the user's real goals and quests
 * (domain/dailyPlan.ts, ai/planner.ts). The plan is generated once per local
 * day and stored, so reopening the dashboard shows the same plan; Regenerate
 * recomputes it on request and the swap control replaces a single task.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge, Button, Card, CardHeader, EmptyState, IconButton, ProgressBar } from '../../ui/primitives';
import { useToast } from '../../ui/overlays';
import { TaskRow } from '../shared/TaskRow';
import { useSelector, useStoreStatus } from '../../app/hooks';
import { today as todayKey, formatDuration } from '../../domain/dates';
import { MAX_DAILY_TASKS, selectDailyPlan, type DailyPlanItem } from '../../domain/dailyPlan';
import {
  ensureDailyPlan,
  planNeedsRepair,
  regenerateDailyPlan,
  repairDailyPlan,
  replacePlanTask,
  type PlannerOutcome,
} from '../../ai/planner';

/** The local calendar day, re-read at midnight and whenever the tab comes back. */
function useToday(): string {
  const [day, setDay] = useState(todayKey);
  useEffect(() => {
    const check = () => setDay(todayKey());
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, []);
  return day;
}

export function DailyPlanCard() {
  const day = useToday();
  const { status } = useStoreStatus();
  const plan = useSelector(() => selectDailyPlan(day), [day]);
  const needsRepair = useSelector(() => planNeedsRepair(day), [day]);
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<'generate' | 'regenerate' | string | null>(null);

  // New day: plan once. `ensureDailyPlan` is a no-op once the day is planned.
  useEffect(() => {
    if (status !== 'ready' || plan.planned) return;
    let alive = true;
    setBusy('generate');
    ensureDailyPlan()
      .catch((err) => console.error('[plan] daily plan failed', err))
      .finally(() => {
        if (alive) setBusy(null);
      });
    return () => {
      alive = false;
    };
  }, [status, day, plan.planned]);

  // A goal or quest behind a planned task was deleted or finished: swap it out.
  useEffect(() => {
    if (needsRepair) void repairDailyPlan().catch((err) => console.error('[plan] repair failed', err));
  }, [needsRepair]);

  const report = (outcome: PlannerOutcome, kind: 'regenerate' | 'replace') => {
    if (outcome.aiError) toast.show(`AI planning unavailable — used your priorities instead.`, { tone: 'muted' });
    if (kind === 'regenerate' && outcome.created + outcome.carried + outcome.dropped === 0) {
      toast.show('Your plan is still the best fit. Use the swap button to replace a single task.', { tone: 'muted' });
    } else if (kind === 'replace' && outcome.created + outcome.carried === 0) {
      toast.show('Nothing else meaningful to swap in — the slot stays free.', { tone: 'muted' });
    } else {
      toast.show(kind === 'regenerate' ? 'Plan updated' : 'Task swapped');
    }
  };

  const run = async (key: string, fn: () => Promise<PlannerOutcome>, kind: 'regenerate' | 'replace') => {
    if (busy) return;
    setBusy(key);
    try {
      report(await fn(), kind);
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : 'The plan could not be updated.');
    } finally {
      setBusy(null);
    }
  };

  const total = plan.items.length;
  const generating = busy === 'generate' || busy === 'regenerate';

  return (
    <Card flush>
      <div style={{ padding: '16px 16px 0' }}>
        <CardHeader
          kicker="TODAY"
          title={total === 0 ? "Today's tasks" : `Today's tasks · ${plan.done} of ${total} done`}
          action={
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              loading={busy === 'regenerate'}
              disabled={busy != null}
              onClick={() => run('regenerate', () => regenerateDailyPlan(), 'regenerate')}
            >
              Regenerate
            </Button>
          }
        />
        {total > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <ProgressBar percent={(plan.done / total) * 100} label={`${plan.done} of ${total} planned tasks done`} />
          </div>
        ) : null}
      </div>

      {total === 0 ? (
        generating || !plan.planned ? (
          <p style={{ padding: '4px 16px 18px', margin: 0, fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
            Planning your day from your goals and quests…
          </p>
        ) : (
          <EmptyState
            icon="tasks"
            title="Nothing needs you today"
            body="There is no active goal or quest with meaningful work left, so no tasks were invented to fill the day."
            action={
              <Button variant="secondary" icon="goals" onClick={() => navigate('/goals')}>
                Review goals
              </Button>
            }
          />
        )
      ) : (
        <div className="list">
          {plan.items.map((item) => (
            <PlanRow
              key={item.view.task.id}
              item={item}
              swapping={busy === item.view.task.id}
              disabled={busy != null}
              onSwap={() => run(item.view.task.id, () => replacePlanTask(item.view.task.id), 'replace')}
            />
          ))}
        </div>
      )}

      <div
        className="spread"
        style={{ padding: '10px 16px 14px', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)' }}
      >
        <span>Max {MAX_DAILY_TASKS} a day · from your goals and quests</span>
        <Link to="/tasks" style={{ color: 'var(--c-text-dim)' }}>
          {plan.otherOpen > 0 ? `${plan.otherOpen} more open →` : 'All tasks →'}
        </Link>
      </div>
    </Card>
  );
}

function PlanRow({
  item,
  swapping,
  disabled,
  onSwap,
}: {
  item: DailyPlanItem;
  swapping: boolean;
  disabled: boolean;
  onSwap: () => void;
}) {
  const { task } = item.view;
  const done = task.status === 'COMPLETED';
  const priorityColor =
    task.priority === 'HIGH' ? 'var(--c-danger-bright)' : task.priority === 'MEDIUM' ? 'var(--c-warn)' : 'var(--c-text-dim)';

  return (
    <TaskRow
      view={item.view}
      subtitle={
        <>
          {task.description ? <div className="row-meta truncate">{task.description}</div> : null}
          <div className="row-meta truncate" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge color={priorityColor}>{task.priority}</Badge>
            {task.estimatedMinutes ? <span className="mono">{formatDuration(task.estimatedMinutes)}</span> : null}
            {item.linkLabel && item.linkTo ? (
              <Link to={item.linkTo} className="truncate" style={{ color: 'var(--c-text-dim)' }} onClick={(e) => e.stopPropagation()}>
                → {item.linkLabel}
              </Link>
            ) : null}
            {item.view.overdue && !task.generated ? (
              <span style={{ color: 'var(--c-danger-bright)' }}>overdue</span>
            ) : null}
          </div>
        </>
      }
      actions={
        done ? null : (
          <IconButton
            icon="refresh"
            size="sm"
            label={`Swap "${task.title}" for another task`}
            disabled={disabled}
            aria-busy={swapping}
            onClick={onSwap}
          />
        )
      }
    />
  );
}
