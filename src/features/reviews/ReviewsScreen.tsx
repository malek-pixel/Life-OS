/**
 * Reviews.
 *
 * UI/UX sections 33-36. Master prompt section 33 requires reviews to aggregate
 * actual Life OS data and forbids generated insights, so the numbers beside each
 * cadence are counted from the real period, and the writing is entirely the
 * user's. A completed review stores a snapshot of those metrics, so looking back
 * at last month shows what was true then rather than what is true now.
 */

import { useMemo, useState } from 'react';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatTile,
  TextAreaField,
} from '../../ui/primitives';
import { Modal, useToast } from '../../ui/overlays';
import { useAction, useSelector, useSettings } from '../../app/hooks';
import { saveReview } from '../../data/actions';
import {
  addDays,
  dayKeyToMs,
  endOfDay,
  endOfMonth,
  formatMonthDay,
  formatRelativeDay,
  startOfMonth,
  startOfWeek,
  toDayKey,
  today as todayKey,
  type DayKey,
} from '../../domain/dates';
import { store } from '../../data/store';
import type { Review, ReviewCadence } from '../../data/schema';
import { xpForReview } from '../../domain/xp';

interface Period {
  cadence: ReviewCadence;
  label: string;
  window: string;
  blurb: string;
  color: string;
  start: DayKey;
  end: DayKey;
}

export default function ReviewsScreen() {
  const settings = useSettings();
  const reviews = useSelector(() =>
    [...store.live('reviews')].sort((a, b) => b.periodStart - a.periodStart),
  );
  const [active, setActive] = useState<Period | null>(null);

  const today = todayKey();

  const periods = useMemo<Period[]>(() => {
    const weekStart = startOfWeek(today, settings.weekStartsMonday);
    const year = today.slice(0, 4);
    return [
      {
        cadence: 'DAILY',
        label: 'Daily',
        window: 'Today',
        blurb: 'Close the day: what moved, what slipped, tomorrow’s one thing.',
        color: '#D4708A',
        start: today,
        end: today,
      },
      {
        cadence: 'WEEKLY',
        label: 'Weekly',
        window: `${formatMonthDay(weekStart)} — ${formatMonthDay(addDays(weekStart, 6))}`,
        blurb: 'The big one — execution against intention across every area.',
        color: '#4C6FAE',
        start: weekStart,
        end: addDays(weekStart, 6),
      },
      {
        cadence: 'MONTHLY',
        label: 'Monthly',
        window: formatMonthDay(startOfMonth(today)).split(' ')[0] ?? '',
        blurb: 'Zoom out: goal trajectory, habit consistency, direction check.',
        color: '#7B9AD0',
        start: startOfMonth(today),
        end: endOfMonth(today),
      },
      {
        cadence: 'YEARLY',
        label: 'Yearly',
        window: year,
        blurb: 'Life chapter review — what this year was actually about.',
        color: '#7BB08A',
        start: `${year}-01-01`,
        end: `${year}-12-31`,
      },
    ];
  }, [today, settings.weekStartsMonday]);

  const doneFor = (period: Period): Review | undefined =>
    reviews.find(
      (r) =>
        r.cadence === period.cadence &&
        toDayKey(r.periodStart) === period.start &&
        r.completedAt != null,
    );

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle="The part that turns logged data into something you actually learn from."
      />

      <div className="grid-cards los-stagger" style={{ marginBottom: 16 }}>
        {periods.map((period) => {
          const existing = doneFor(period);
          const metrics = collectMetrics(period.start, period.end);
          return (
            <Card key={period.cadence}>
              <div className="spread" style={{ marginBottom: 10, gap: 10 }}>
                <Badge color={period.color} border={`${period.color}66`}>
                  {period.label}
                </Badge>
                {existing ? (
                  <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
                    Done
                  </Badge>
                ) : null}
              </div>

              <h3 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: '0 0 4px' }}>
                {period.window}
              </h3>
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 14px', lineHeight: 1.55 }}>
                {period.blurb}
              </p>

              <div
                className="row mono"
                style={{ gap: 14, fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', marginBottom: 14, flexWrap: 'wrap' }}
              >
                <span>{metrics.tasks} tasks</span>
                <span>{metrics.habits} habits</span>
                <span>{metrics.workouts} sessions</span>
                <span style={{ color: 'var(--c-accent-text)' }}>{metrics.xp} XP</span>
              </div>

              <Button
                variant={existing ? 'secondary' : 'primary'}
                block
                icon={existing ? 'edit' : 'reviews'}
                onClick={() => setActive(period)}
              >
                {existing ? 'Review again' : `Start ${period.label.toLowerCase()} review`}
              </Button>
            </Card>
          );
        })}
      </div>

      {/* ---------- past reviews ---------- */}
      <Card flush>
        <div style={{ padding: '16px 16px 6px' }}>
          <CardHeader kicker="HISTORY" title={`${reviews.length} review${reviews.length === 1 ? '' : 's'}`} />
        </div>
        {reviews.length === 0 ? (
          <EmptyState
            icon="reviews"
            title="No reviews written yet"
            body="A review pairs what the data says with what you make of it. The counts above are already real — the reflection is the part only you can add."
          />
        ) : (
          <div className="list">
            {reviews.map((review) => (
              <div className="list-row" key={review.id} style={{ alignItems: 'flex-start' }}>
                <Badge color="var(--c-text-muted)">{review.cadence}</Badge>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-title">
                    {formatRelativeDay(toDayKey(review.periodStart))} —{' '}
                    {formatMonthDay(toDayKey(review.periodEnd))}
                  </div>
                  {review.wins ? (
                    <div
                      className="row-meta"
                      style={{ whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    >
                      {review.wins}
                    </div>
                  ) : null}
                  {Object.keys(review.snapshot).length > 0 ? (
                    <div
                      className="row mono"
                      style={{ gap: 12, marginTop: 6, fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}
                    >
                      <span>{review.snapshot.tasks ?? 0} tasks</span>
                      <span>{review.snapshot.habits ?? 0} habits</span>
                      <span>{review.snapshot.xp ?? 0} XP</span>
                    </div>
                  ) : null}
                </div>
                {review.completedAt ? (
                  <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
                    Complete
                  </Badge>
                ) : (
                  <Badge color="var(--c-warn-bright)" border="rgba(194,91,114,.4)">
                    Draft
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <ReviewModal period={active} onClose={() => setActive(null)} />
    </>
  );
}

/* ================================================================== *
 * Metrics for a period - counted from real rows
 * ================================================================== */

function collectMetrics(start: DayKey, end: DayKey) {
  const from = dayKeyToMs(start);
  const to = endOfDay(dayKeyToMs(end));

  const tasks = store
    .live('tasks')
    .filter((t) => t.completedAt != null && t.completedAt >= from && t.completedAt <= to).length;

  const habits = store
    .live('habitLogs')
    .filter((l) => l.completed && l.date >= start && l.date <= end).length;

  const workouts = store.live('workouts').filter((w) => w.date >= from && w.date <= to).length;

  const journal = store.live('journalEntries').filter((j) => j.date >= start && j.date <= end).length;

  const xp = store
    .live('xpEvents')
    .filter((e) => e.date >= start && e.date <= end)
    .reduce((sum, e) => sum + e.amount, 0);

  const goals = store
    .live('goals')
    .filter((g) => g.completedAt != null && g.completedAt >= from && g.completedAt <= to).length;

  return { tasks, habits, workouts, journal, xp, goals };
}

/* ================================================================== *
 * The review itself
 * ================================================================== */

function ReviewModal({ period, onClose }: { period: Period | null; onClose: () => void }) {
  const toast = useToast();
  const [wins, setWins] = useState('');
  const [misses, setMisses] = useState('');
  const [nextFocus, setNextFocus] = useState('');

  const key = period?.cadence ?? 'none';
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setWins('');
    setMisses('');
    setNextFocus('');
  }

  const metrics = period ? collectMetrics(period.start, period.end) : null;

  const submit = useAction(async (complete: boolean) => {
    if (!period || !metrics) return undefined;
    return saveReview(null, {
      cadence: period.cadence,
      periodStart: dayKeyToMs(period.start),
      periodEnd: endOfDay(dayKeyToMs(period.end)),
      wins,
      misses,
      nextFocus,
      snapshot: {
        tasks: metrics.tasks,
        habits: metrics.habits,
        workouts: metrics.workouts,
        journal: metrics.journal,
        xp: metrics.xp,
        goals: metrics.goals,
      },
      complete,
    });
  });

  if (!period || !metrics) return null;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`${period.label} review · ${period.window}`}
      description="The numbers below are counted from what you logged. The rest is yours to write."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await submit.run(false);
              if (!result) return;
              toast.show('Draft saved', { tone: 'muted' });
              onClose();
            }}
            disabled={submit.pending}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            loading={submit.pending}
            onClick={async () => {
              const result = await submit.run(true);
              if (!result) return;
              toast.show(`Review complete · +${result.xpAwarded} XP`, { tone: 'xp' });
              onClose();
            }}
            disabled={!wins.trim() && !misses.trim() && !nextFocus.trim()}
          >
            Complete · +{xpForReview(period.cadence)} XP
          </Button>
        </>
      }
    >
      {/* ---------- what the data says ---------- */}
      <div>
        <p className="card-kicker">WHAT THE DATA SAYS</p>
        <div className="grid-stats">
          <StatTile label="TASKS DONE" value={String(metrics.tasks)} delta="in period" />
          <StatTile label="HABITS LOGGED" value={String(metrics.habits)} delta="completions" />
          <StatTile label="SESSIONS" value={String(metrics.workouts)} delta="training" />
          <StatTile
            label="XP"
            value={String(metrics.xp)}
            delta="earned"
            tone={metrics.xp > 0 ? 'accent' : 'muted'}
          />
        </div>
        {metrics.goals > 0 ? (
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-accent-text)', margin: '12px 0 0' }}>
            {metrics.goals} goal{metrics.goals === 1 ? '' : 's'} reached in this period.
          </p>
        ) : null}
      </div>

      <TextAreaField
        label="What went well"
        rows={3}
        value={wins}
        onChange={(e) => setWins(e.target.value)}
        placeholder="What actually moved, and why it did."
      />
      <TextAreaField
        label="What slipped"
        rows={3}
        value={misses}
        onChange={(e) => setMisses(e.target.value)}
        placeholder="Be specific. A pattern you can name is a pattern you can fix."
        hint="The honest version is the useful one — nothing here is shared with anyone."
      />
      <TextAreaField
        label="The one thing next"
        rows={2}
        value={nextFocus}
        onChange={(e) => setNextFocus(e.target.value)}
        placeholder="If only one thing improves before the next review, what is it?"
      />
    </Modal>
  );
}
