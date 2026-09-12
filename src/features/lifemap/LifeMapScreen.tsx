/**
 * Life Map.
 *
 * UI/UX sections 09-11. Master prompt section 35 is emphatic that this must not
 * be a decorative diagram: every node here is a real row and every edge a real
 * foreign key, so clicking through lands on the actual goal or project.
 *
 * The spec also warns that an empty Life Map is a worse first impression than
 * no Life Map, which is why the screen leads with an explicit empty state
 * rather than drawing an empty graph.
 */

import { Link } from 'react-router-dom';

import { Badge, Card, CardHeader, EmptyState, PageHeader, ProgressBar, StatTile } from '../../ui/primitives';
import { BarList } from '../../ui/charts';
import { Icon } from '../../ui/Icon';
import { useSelector } from '../../app/hooks';
import { selectGoals, selectLifeAreas, selectProjects, selectHabits } from '../../domain/selectors';
import { levelForXp } from '../../domain/xp';
import { store } from '../../data/store';

export default function LifeMapScreen() {
  const areas = useSelector(selectLifeAreas);
  const goals = useSelector(selectGoals);
  const projects = useSelector(selectProjects);
  const habits = useSelector(selectHabits);
  const progression = useSelector(() => levelForXp(store.character.totalXp));

  const tracked = areas.filter((a) => a.goals + a.habits + a.projects > 0);
  const balance =
    tracked.length === 0
      ? null
      : Math.round(
          tracked.reduce((sum, a) => sum + (a.score ?? 0), 0) / tracked.filter((a) => a.score != null).length || 0,
        );

  if (tracked.length === 0) {
    return (
      <>
        <PageHeader title="Life Map" subtitle="How the parts of your life connect." />
        <Card>
          <EmptyState
            icon="lifemap"
            title="Nothing to map yet"
            body="The Life Map draws the real structure of your system — areas, the goals inside them, the projects under those, and the habits that feed them. It needs that structure to exist first. Create a goal and the map starts drawing itself."
            action={
              <Link to="/goals">
                <span className="btn btn-primary los-press">Create a goal</span>
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
        title="Life Map"
        subtitle="Areas, goals, projects and habits — as they are actually linked."
      />

      <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
        <StatTile
          label="AREAS TRACKED"
          value={`${tracked.length}/${areas.length}`}
          delta="in use"
          tone={tracked.length > 2 ? 'accent' : 'muted'}
        />
        <StatTile
          label="BALANCE"
          value={balance == null ? '—' : String(balance)}
          delta={balance == null ? 'not enough data' : 'mean score'}
          tone={balance != null && balance >= 70 ? 'accent' : 'muted'}
        />
        <StatTile label="LEVEL" value={String(progression.level)} delta={progression.rank.title} tone="accent" />
        <StatTile label="TOTAL XP" value={String(store.character.totalXp)} delta="lifetime" />
      </div>

      <div className="grid-2">
        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- the tree: area -> goal -> project ---------- */}
          <Card>
            <CardHeader kicker="THE STRUCTURE" title="Area → goal → project" />
            <div className="stack" style={{ gap: 18 }}>
              {tracked.map((area) => {
                const areaGoals = goals.filter(
                  (g) => g.goal.area === area.name && g.goal.status !== 'ARCHIVED',
                );
                const looseProjects = projects.filter(
                  (p) => p.project.area === area.name && p.project.goalId == null,
                );

                return (
                  <div key={area.name}>
                    <div className="row" style={{ gap: 9, marginBottom: 9 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: area.color,
                          flex: 'none',
                        }}
                      />
                      <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600 }}>{area.name}</span>
                      <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                        {area.goals} goals · {area.projects} projects · {area.habits} habits
                      </span>
                      <span className="grow" />
                      {area.xp > 0 ? (
                        <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-accent-text)' }}>
                          {area.xp} XP
                        </span>
                      ) : null}
                    </div>

                    {areaGoals.length === 0 && looseProjects.length === 0 ? (
                      <p
                        style={{
                          fontSize: 'var(--fs-md)',
                          color: 'var(--c-text-ghost)',
                          margin: 0,
                          paddingLeft: 19,
                        }}
                      >
                        Only habits in this area so far.
                      </p>
                    ) : (
                      <div
                        className="stack"
                        style={{ gap: 10, paddingLeft: 19, borderLeft: `1px solid ${area.color}33`, marginLeft: 4 }}
                      >
                        {areaGoals.map((goalView) => {
                          const goalProjects = projects.filter(
                            (p) => p.project.goalId === goalView.goal.id,
                          );
                          return (
                            <div key={goalView.goal.id}>
                              <Link to={`/goals/${goalView.goal.id}`} className="row" style={{ gap: 8 }}>
                                <Icon name="goals" size={13} color={area.color} />
                                <span className="grow truncate" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-strong)' }}>
                                  {goalView.goal.title}
                                </span>
                                <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', flex: 'none' }}>
                                  {goalView.progress.percent}%
                                </span>
                              </Link>
                              <div style={{ marginTop: 5, marginBottom: goalProjects.length ? 7 : 0 }}>
                                <ProgressBar
                                  percent={goalView.progress.percent}
                                  color={area.color}
                                  animate={false}
                                  label={`${goalView.goal.title}: ${goalView.progress.percent}%`}
                                />
                              </div>
                              {goalProjects.map((p) => (
                                <Link
                                  key={p.project.id}
                                  to={`/projects/${p.project.id}`}
                                  className="row"
                                  style={{ gap: 8, paddingLeft: 17, marginTop: 5 }}
                                >
                                  <Icon name="projects" size={12} color="var(--c-text-dim)" />
                                  <span className="grow truncate" style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-muted)' }}>
                                    {p.project.title}
                                  </span>
                                  <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}>
                                    {p.progress.percent}%
                                  </span>
                                </Link>
                              ))}
                            </div>
                          );
                        })}

                        {looseProjects.map((p) => (
                          <Link key={p.project.id} to={`/projects/${p.project.id}`} className="row" style={{ gap: 8 }}>
                            <Icon name="projects" size={13} color="var(--c-text-dim)" />
                            <span className="grow truncate" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)' }}>
                              {p.project.title}
                            </span>
                            <Badge color="var(--c-text-ghost)">no goal</Badge>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          {/* ---------- balance ---------- */}
          <Card>
            <CardHeader kicker="BALANCE" title="Where the attention goes" />
            <BarList
              data={areas.map((a) => ({
                label: a.name,
                value: a.score,
                color: a.color,
                meta:
                  a.goals + a.habits + a.projects === 0
                    ? 'nothing tracked here'
                    : `${a.goals} goals · ${a.habits} habits · ${a.projects} projects`,
              }))}
            />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '14px 0 0', lineHeight: 1.6 }}>
              An untracked area is not a low score — it is a part of your life the system has nothing
              to say about, which is worth noticing on its own.
            </p>
          </Card>

          {/* ---------- habits feeding areas ---------- */}
          <Card>
            <CardHeader kicker="HABITS" title="What feeds each area" />
            {habits.length === 0 ? (
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.6 }}>
                No habits yet. Habits are what keep an area alive between goals.
              </p>
            ) : (
              <div className="stack" style={{ gap: 9 }}>
                {habits
                  .filter((h) => h.habit.status === 'ACTIVE')
                  .map((h) => (
                    <div className="row" key={h.habit.id} style={{ gap: 9 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 2,
                          background: areas.find((a) => a.name === h.habit.area)?.color ?? 'var(--c-text-dim)',
                          flex: 'none',
                        }}
                      />
                      <span className="grow truncate" style={{ fontSize: 'var(--fs-md)' }}>
                        {h.habit.title}
                      </span>
                      {h.habit.identity ? (
                        <Badge color="var(--c-accent-text)" border="var(--c-accent-border-soft)">
                          {h.habit.identity}
                        </Badge>
                      ) : null}
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', flex: 'none', width: 30, textAlign: 'right' }}
                      >
                        {h.streak}d
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
