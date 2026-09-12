/**
 * Life timeline.
 *
 * UI/UX section 37. Master prompt section 36 is the constraint that shapes it:
 * every entry originates from a stored row with a real timestamp — a completed
 * task, a reached goal, a shipped project, a logged session, a journal entry,
 * an achievement unlock. Nothing is synthesised to make the story look fuller.
 */

import { useMemo, useState } from 'react';

import { Badge, Card, EmptyState, PageHeader, Tabs } from '../../ui/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { useSelector } from '../../app/hooks';
import { selectTimeline, type TimelineEvent } from '../../domain/selectors';
import { formatDayShort, formatTime, toDayKey } from '../../domain/dates';

type Filter = 'all' | 'wins' | 'work' | 'body' | 'mind';

const KIND_ICON: Record<TimelineEvent['kind'], IconName> = {
  task: 'tasks',
  goal: 'goals',
  project: 'projects',
  milestone: 'flag',
  workout: 'fitness',
  journal: 'journal',
  achievement: 'achievements',
  quest: 'quests',
  levelup: 'sparkle',
};

const FILTERS: Record<Filter, TimelineEvent['kind'][]> = {
  all: [],
  wins: ['goal', 'project', 'achievement', 'quest', 'milestone'],
  work: ['task', 'project', 'milestone'],
  body: ['workout'],
  mind: ['journal'],
};

export default function TimelineScreen() {
  const events = useSelector(() => selectTimeline(200));
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const kinds = FILTERS[filter];
    return kinds.length === 0 ? events : events.filter((e) => kinds.includes(e.kind));
  }, [events, filter]);

  /** Grouped by day, so the timeline reads as a sequence of days. */
  const groups = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of visible) {
      const key = toDayKey(event.at);
      const list = map.get(key);
      if (list) list.push(event);
      else map.set(key, [event]);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <>
      <PageHeader
        title="Timeline"
        subtitle="Your life as the system actually recorded it."
        actions={
          <Tabs
            label="Timeline filter"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'wins', label: 'Wins' },
              { value: 'work', label: 'Work' },
              { value: 'body', label: 'Body' },
              { value: 'mind', label: 'Mind' },
            ]}
          />
        }
      />

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="timeline"
            title={events.length === 0 ? 'Nothing recorded yet' : 'Nothing in this filter'}
            body={
              events.length === 0
                ? 'The timeline is assembled from real completion timestamps — finished tasks, reached goals, logged sessions, journal entries, unlocked achievements. It fills in as you use the system rather than being written up afterwards.'
                : 'Nothing of this kind has been logged yet. Try another filter.'
            }
          />
        </Card>
      ) : (
        <Card>
          <div className="stack" style={{ gap: 0 }}>
            {groups.map(([day, dayEvents]) => (
              <section key={day} style={{ display: 'flex', gap: 16, paddingBottom: 6 }}>
                {/* --- day rail --- */}
                <div style={{ width: 96, flex: 'none', paddingTop: 12 }}>
                  <div
                    className="mono"
                    style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}
                  >
                    {formatDayShort(day).toUpperCase()}
                  </div>
                  <div className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', marginTop: 2 }}>
                    {dayEvents.length} event{dayEvents.length === 1 ? '' : 's'}
                  </div>
                </div>

                {/* --- spine --- */}
                <div
                  aria-hidden="true"
                  style={{
                    width: 1,
                    background: 'var(--c-border-faint)',
                    flex: 'none',
                    position: 'relative',
                  }}
                />

                {/* --- events --- */}
                <div className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                  {dayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="row los-row"
                      style={{
                        gap: 11,
                        padding: '11px 4px',
                        borderBottom: '1px solid var(--c-border-ghost)',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 7,
                          flex: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `${event.color}1f`,
                          border: `1px solid ${event.color}44`,
                          color: event.color,
                        }}
                      >
                        <Icon name={KIND_ICON[event.kind]} size={13} />
                      </span>

                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row-title truncate">{event.title}</div>
                        <div className="row-meta">{event.detail}</div>
                      </div>

                      {event.kind === 'achievement' || event.kind === 'goal' ? (
                        <Badge color={event.color} border={`${event.color}66`}>
                          {event.kind === 'goal' ? 'Goal' : 'Unlocked'}
                        </Badge>
                      ) : null}

                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}
                      >
                        {formatTime(event.at)}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {events.length >= 200 ? (
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '16px 0 0', textAlign: 'center' }}>
              Showing the 200 most recent events.
            </p>
          ) : null}
        </Card>
      )}
    </>
  );
}
