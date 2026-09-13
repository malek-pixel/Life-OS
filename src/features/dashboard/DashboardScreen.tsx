/**
 * The dashboard.
 *
 * UI/UX section 08: greeting, rank/level/XP, today's priorities, goal progress,
 * active quests, streaks, upcoming events, quick actions.
 *
 * Every number is read from `selectDashboard`, which derives it from stored
 * rows. There is no sample data path: with an empty database the screen shows
 * an onboarding-style empty state rather than a dashboard of zeros pretending
 * to be a dashboard of data.
 *
 * The spec's "Phase 1 honest" note is implemented literally - the rank title is
 * hidden until XP exists to have earned it, rather than showing a starter badge
 * that has not been earned.
 */

import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Card, CardHeader, Button, EmptyState, ProgressBar, StatTile, Badge } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/overlays';
import { TaskRow } from '../shared/TaskRow';
import { useSelector, useSettings } from '../../app/hooks';
import { selectDashboard, areaHex } from '../../domain/selectors';
import { reminderToastsEnabled, selectNudges } from '../../domain/nudges';
import { greeting, greetingKicker } from '../../domain/dates';
import { toggleHabitLog } from '../../data/actions';

export default function DashboardScreen() {
  const data = useSelector(selectDashboard);
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();

  const name = settings.displayName?.trim();

  /* ---------- first run: nothing to summarise yet ---------- */
  if (!data.hasAnyData) {
    return (
      <>
        <Greeting name={name} />
        <Card>
          <EmptyState
            icon="sparkle"
            title="Your operating system is empty"
            body="Life OS summarises what you have actually logged, so there is nothing to show yet. Create one goal and a task under it — the dashboard, analytics and XP all start working from that first entry."
            action={
              <div className="row" style={{ gap: 8 }}>
                <Button variant="primary" icon="goals" onClick={() => navigate('/goals')}>
                  Create a goal
                </Button>
                <Button variant="secondary" icon="tasks" onClick={() => navigate('/tasks')}>
                  Add a task
                </Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Greeting name={name} />

      <NudgeBanner />

      {/* ---------- the four headline numbers ---------- */}
      <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
        {data.stats.map((stat) => (
          <StatTile
            key={stat.label}
            label={stat.label}
            value={stat.value}
            delta={stat.delta}
            tone={stat.tone}
          />
        ))}
      </div>

      <div className="grid-2">
        {/* ================= left column ================= */}
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- today ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 0' }}>
              <CardHeader
                kicker="TODAY"
                title={
                  data.todayTotal === 0
                    ? 'Nothing scheduled'
                    : `${data.todayDone} of ${data.todayTotal} done`
                }
                action={
                  <Link to="/tasks" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
                    All tasks →
                  </Link>
                }
              />
              {data.todayTotal > 0 ? (
                <div style={{ marginBottom: 14 }}>
                  <ProgressBar
                    percent={(data.todayDone / data.todayTotal) * 100}
                    label={`${data.todayDone} of ${data.todayTotal} tasks done today`}
                  />
                </div>
              ) : null}
            </div>

            {data.todayTasks.length === 0 ? (
              <EmptyState
                icon="tasks"
                title="No tasks due today"
                body="Nothing is scheduled for today. That is either a clear day or a sign something needs a due date."
                action={
                  <Button variant="secondary" icon="plus" onClick={() => navigate('/tasks')}>
                    Plan today
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {data.todayTasks.map((view) => (
                  <TaskRow key={view.task.id} view={view} />
                ))}
              </div>
            )}
          </Card>

          {/* ---------- habits due today ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader
                kicker="HABITS"
                title="Due today"
                action={
                  <Link to="/habits" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
                    All habits →
                  </Link>
                }
              />
            </div>
            {data.habitsToday.length === 0 ? (
              <EmptyState
                icon="habits"
                title="No habits scheduled"
                body="Habits are the part of the system that compounds. One small daily habit is worth more here than five you never log."
                action={
                  <Button variant="secondary" icon="plus" onClick={() => navigate('/habits')}>
                    Add a habit
                  </Button>
                }
              />
            ) : (
              <div className="list">
                {data.habitsToday.map((view) => (
                  <div key={view.habit.id} className="list-row los-row">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={view.doneToday}
                      aria-label={
                        view.doneToday
                          ? `Unlog "${view.habit.title}" for today`
                          : `Log "${view.habit.title}" for today`
                      }
                      className={`checkbox${view.doneToday ? ' checkbox-on' : ''}`}
                      onClick={async () => {
                        const result = await toggleHabitLog(view.habit.id);
                        if (!view.doneToday) {
                          toast.show(
                            `${view.habit.title} · +${result.xpAwarded} XP`,
                            { tone: 'xp' },
                          );
                        }
                      }}
                    >
                      {view.doneToday ? <Icon name="check" size={12} strokeWidth={3} /> : null}
                    </button>

                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className={`row-title truncate${view.doneToday ? ' row-title-done' : ''}`}>
                        {view.habit.title}
                      </div>
                      {view.habit.identity ? (
                        <div className="row-meta truncate">Identity · {view.habit.identity}</div>
                      ) : null}
                    </div>

                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: view.streak > 0 ? 'var(--c-accent-text)' : 'var(--c-text-ghost)',
                        flex: 'none',
                      }}
                      title={`Longest streak ${view.longest}`}
                    >
                      {view.streak > 0 ? `${view.streak}d` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ================= right column ================= */}
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- goal progress ---------- */}
          <Card>
            <CardHeader
              kicker="GOALS"
              title="Where you stand"
              action={
                <Link to="/goals" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
                  All →
                </Link>
              }
            />
            {data.goals.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
                No active goals. Goals are what projects and tasks roll up into — without one, the
                rest of the system has nothing to aim at.
              </p>
            ) : (
              <div className="stack" style={{ gap: 14 }}>
                {data.goals.map((view) => (
                  <Link key={view.goal.id} to={`/goals/${view.goal.id}`} style={{ display: 'block' }}>
                    <div className="spread" style={{ marginBottom: 6, gap: 8 }}>
                      <span
                        className="truncate"
                        style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-strong)' }}
                      >
                        {view.goal.title}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 'var(--fs-xs)',
                          color:
                            view.progress.percent >= 70
                              ? 'var(--c-accent-text)'
                              : 'var(--c-text-dim)',
                          flex: 'none',
                        }}
                      >
                        {view.progress.percent}%
                      </span>
                    </div>
                    <ProgressBar
                      percent={view.progress.percent}
                      color={areaHex(view.goal.area)}
                      label={`${view.goal.title}: ${view.progress.percent}% complete`}
                    />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* ---------- active quests ---------- */}
          {data.quests.length > 0 ? (
            <Card>
              <CardHeader
                kicker="QUESTS"
                title="Active"
                action={
                  <Link to="/quests" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
                    All →
                  </Link>
                }
              />
              <div className="stack" style={{ gap: 12 }}>
                {data.quests.map((view) => (
                  <div key={view.quest.id}>
                    <div className="spread" style={{ gap: 8, marginBottom: 6 }}>
                      <div className="row grow" style={{ gap: 8, minWidth: 0 }}>
                        <Badge color="var(--c-accent-text)" border="var(--c-accent-border)">
                          {view.quest.type}
                        </Badge>
                        <span className="truncate" style={{ fontSize: 'var(--fs-md)' }}>
                          {view.quest.title}
                        </span>
                      </div>
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', flex: 'none' }}
                      >
                        {view.met}/{view.total}
                      </span>
                    </div>
                    <ProgressBar
                      percent={view.percent}
                      label={`${view.quest.title}: ${view.met} of ${view.total} requirements met`}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* ---------- upcoming ---------- */}
          <Card>
            <CardHeader
              kicker="NEXT 7 DAYS"
              title="Upcoming"
              action={
                <Link to="/calendar" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>
                  Calendar →
                </Link>
              }
            />
            {data.upcoming.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
                Nothing scheduled in the next week. Add events or give tasks a due date and they
                will appear here.
              </p>
            ) : (
              <div className="stack" style={{ gap: 11 }}>
                {data.upcoming.map((item, i) => (
                  <div className="row" key={`${item.title}-${i}`} style={{ gap: 10 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: item.color,
                        flex: 'none',
                      }}
                    />
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--c-text-dim)',
                        width: 62,
                        flex: 'none',
                      }}
                    >
                      {item.label}
                    </span>
                    <span className="grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Greeting({ name }: { name?: string }) {
  return (
    <header className="greeting" style={{ marginBottom: 18 }}>
      <p className="card-kicker" style={{ marginBottom: 7 }}>
        {greetingKicker()}
      </p>
      <h1 style={{ fontSize: 'var(--fs-7xl)', fontWeight: 600, margin: 0, lineHeight: 1.15 }}>
        {greeting()}
        {name ? `, ${name}` : ''}.
      </h1>
    </header>
  );
}

/**
 * In-app reminders.
 *
 * Driven entirely by the Notifications settings: turning off habit nudges or
 * deadline warnings, or falling inside quiet hours, empties this list and the
 * banner disappears.
 *
 * Nothing here is scheduled. These are recomputed from real rows whenever the
 * dashboard renders, which is the honest half of the reminder system while
 * background delivery stays deferred - the Settings screen says so explicitly.
 */
function NudgeBanner() {
  const nudges = useSelector(() => selectNudges());
  const navigate = useNavigate();
  const toast = useToast();
  const announced = useRef(false);

  // With toasts enabled, the most urgent reminder is also surfaced once per
  // mount. Once, not per render - a reminder that re-fires on every keystroke
  // would be the notification spam master prompt section 51 rules out.
  useEffect(() => {
    if (announced.current || nudges.length === 0) return;
    if (!reminderToastsEnabled()) return;
    announced.current = true;
    const first = nudges[0]!;
    // Deliberately NOT the error tone: error toasts persist until dismissed,
    // because a failed write must not be missed. A reminder is not a failure,
    // and a persistent one stacks up every time the dashboard is opened.
    toast.show(first.text, {
      tone: 'muted',
      action: { label: 'Open', run: () => navigate(first.route) },
    });
  }, [nudges, toast, navigate]);

  if (nudges.length === 0) return null;
  const top = nudges.slice(0, 3);

  return (
    <div className="stack" style={{ gap: 8, marginBottom: 16 }} role="status">
      {top.map((nudge) => (
        <div
          key={nudge.id}
          className={nudge.kind === 'overdue' ? 'alert alert-error' : 'alert alert-warn'}
        >
          <Icon
            name={nudge.kind === 'habit' ? 'habits' : 'alert'}
            size={15}
            style={{ marginTop: 1 }}
          />
          <div className="grow">{nudge.text}</div>
          <Button size="sm" variant="ghost" onClick={() => navigate(nudge.route)}>
            Open
          </Button>
        </div>
      ))}
      {nudges.length > top.length ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: 0 }}>
          +{nudges.length - top.length} more reminder
          {nudges.length - top.length === 1 ? '' : 's'}.
        </p>
      ) : null}
    </div>
  );
}

