/**
 * Analytics.
 *
 * UI/UX sections 28-29. Every metric here has a defined source in
 * domain/selectors.ts, and the screen states that source rather than presenting
 * numbers as self-evident.
 *
 * The Life OS Score keeps the spec's own caveat: it is optional and
 * non-reductive, and it reads as "not enough data" rather than as a low score
 * when there is nothing to measure. Master prompt section 34 forbids
 * fabricating values to fill a chart, so charts with no data say so.
 */

import { Link } from 'react-router-dom';

import { Card, CardHeader, EmptyState, PageHeader, StatTile, Badge } from '../../ui/primitives';
import { BarChart, BarList, Ring, Sparkline } from '../../ui/charts';
import { useSelector } from '../../app/hooks';
import { selectAnalytics, selectXpLedger, selectXpSeries } from '../../domain/selectors';
import { formatRelativeDay } from '../../domain/dates';
import { levelForXp } from '../../domain/xp';
import { store } from '../../data/store';

export default function AnalyticsScreen() {
  const data = useSelector(selectAnalytics);
  const xpSeries = useSelector(() => selectXpSeries(30));
  const ledger = useSelector(() => selectXpLedger(12));
  const progression = useSelector(() => levelForXp(store.character.totalXp));

  const anyData =
    data.totals.tasksCompleted > 0 ||
    data.totals.habitsLogged > 0 ||
    data.totals.workouts > 0 ||
    data.totals.journalEntries > 0;

  if (!anyData) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="What the data actually says about how you spend your life." />
        <Card>
          <EmptyState
            icon="analytics"
            title="Nothing measured yet"
            body="Analytics reads your completed tasks, habit logs, training sessions and journal entries. It will not invent a trend from nothing — complete a few things and this fills in on its own."
            action={
              <Link to="/tasks">
                <span className="btn btn-primary los-press">Go to tasks</span>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Every number here is computed from what you logged. Nothing is estimated."
      />

      <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
        <StatTile label="TOTAL XP" value={String(data.totals.totalXp)} delta={`level ${progression.level}`} tone="accent" />
        <StatTile label="TASKS DONE" value={String(data.totals.tasksCompleted)} delta="all time" />
        <StatTile label="HABITS LOGGED" value={String(data.totals.habitsLogged)} delta="completions" />
        <StatTile label="SESSIONS" value={String(data.totals.workouts)} delta="training" />
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- weekly activity ---------- */}
          <Card>
            <CardHeader kicker="THIS WEEK" title="Daily activity" />
            <BarChart
              label="Activity score by day this week"
              data={data.weekBars.map((bar) => ({
                label: bar.label,
                value: bar.score,
                color:
                  bar.score >= 85
                    ? 'var(--c-accent)'
                    : bar.score >= 40
                      ? 'var(--c-warn-bright)'
                      : 'var(--c-fill-track)',
                title: `${formatRelativeDay(bar.day)}: ${bar.score}`,
              }))}
            />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '10px 0 0', lineHeight: 1.6 }}>
              A weighted count of what you actually finished each day: tasks completed, habits
              logged, and whether you trained. It is deliberately not a productivity score — a quiet
              day is information, not a failure.
            </p>
          </Card>

          {/* ---------- XP trend ---------- */}
          <Card>
            <CardHeader
              kicker="LAST 30 DAYS"
              title="XP earned"
              action={
                <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)' }}>
                  peak {Math.max(...xpSeries.map((d) => d.xp), 0)}
                </span>
              }
            />
            {data.hasEnoughData ? (
              <Sparkline label="XP earned per day over the last 30 days" data={xpSeries.map((d) => d.xp)} />
            ) : (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-ghost)', margin: 0, lineHeight: 1.6 }}>
                A trend needs at least three days of history to mean anything. Keep logging and this
                chart appears on its own rather than showing a line drawn through one point.
              </p>
            )}
          </Card>

          {/* ---------- XP ledger ---------- */}
          <Card flush>
            <div style={{ padding: '16px 16px 6px' }}>
              <CardHeader kicker="LEDGER" title="Where the XP came from" />
            </div>
            {ledger.length === 0 ? (
              <EmptyState
                icon="analytics"
                title="No XP events yet"
                body="Every point of XP is recorded as its own entry, so this list can always answer why a total is what it is."
              />
            ) : (
              <div className="list">
                {ledger.map((event) => (
                  <div className="list-row" key={event.id}>
                    <Badge
                      color={event.amount >= 0 ? 'var(--c-accent-text)' : 'var(--c-text-dim)'}
                      border={event.amount >= 0 ? 'var(--c-accent-border-soft)' : 'var(--c-border-faint)'}
                    >
                      {event.sourceType}
                    </Badge>
                    <span className="grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
                      {event.reason}
                    </span>
                    <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}>
                      {formatRelativeDay(event.date)}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 'var(--fs-md)',
                        color: event.amount >= 0 ? 'var(--c-accent-text)' : 'var(--c-danger-bright)',
                        width: 52,
                        textAlign: 'right',
                        flex: 'none',
                      }}
                    >
                      {event.amount >= 0 ? '+' : ''}
                      {event.amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- life score ---------- */}
          <Card>
            <CardHeader kicker="LIFE OS SCORE" title="Across your tracked areas" />
            <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 14px' }}>
              <Ring
                value={data.lifeScore}
                label="Life OS score"
                caption={data.lifeScore == null ? 'NOT ENOUGH DATA' : 'OF 100'}
              />
            </div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
              {data.lifeScore == null
                ? 'Nothing is tracked in enough areas to average yet. This stays blank rather than showing a number that would not mean anything.'
                : 'The mean of the areas you actually track. Untracked areas are excluded rather than counted as zero — this is an indicator, not a verdict.'}
            </p>
          </Card>

          {/* ---------- domain scores ---------- */}
          <Card>
            <CardHeader kicker="BY AREA" title="Where your life is" />
            <BarList
              data={data.domainScores.map((d) => ({
                label: d.name,
                value: d.score,
                color: d.color,
              }))}
              emptyMessage="No life areas have goals, habits or projects yet."
            />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '14px 0 0', lineHeight: 1.6 }}>
              Each area blends its goal progress, habit consistency and project health. An area with
              nothing in it reads as "not tracked", never as 0%.
            </p>
          </Card>

          {/* ---------- totals ---------- */}
          <Card>
            <CardHeader kicker="TOTALS" title="Everything logged" />
            <div className="stack" style={{ gap: 0 }}>
              <TotalRow label="Tasks completed" value={data.totals.tasksCompleted} />
              <TotalRow label="Habit completions" value={data.totals.habitsLogged} />
              <TotalRow label="Training sessions" value={data.totals.workouts} />
              <TotalRow label="Journal entries" value={data.totals.journalEntries} />
              <TotalRow label="Notes" value={data.totals.notes} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="spread"
      style={{ padding: '10px 0', borderBottom: '1px solid var(--c-border-ghost)', gap: 12 }}
    >
      <span style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
        {value}
      </span>
    </div>
  );
}
