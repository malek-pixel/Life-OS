/**
 * Achievements.
 *
 * Unlocks are evaluated deterministically against stored data in the action
 * layer, so this screen only reports. What it adds is honesty about locked
 * ones: each shows its real progress toward its real rule, rather than being a
 * blank silhouette that gives no reason to care.
 *
 * Opening the screen marks new unlocks as seen, which clears the badge.
 */

import { useEffect } from 'react';

import { Badge, Card, CardHeader, EmptyState, PageHeader, ProgressBar, StatTile } from '../../ui/primitives';
import { useSelector } from '../../app/hooks';
import { selectAchievementStats } from '../../domain/selectors';
import {
  ACHIEVEMENTS,
  isSatisfied,
  ruleProgress,
  ruleProgressLabel,
  TIER_ORDER,
} from '../../domain/achievements';
import { markAchievementsSeen } from '../../data/actions';
import { formatRelativeDay, toDayKey } from '../../domain/dates';
import { store } from '../../data/store';

export default function AchievementsScreen() {
  const stats = useSelector(selectAchievementStats);
  const unlocks = useSelector(() => store.live('achievementUnlocks'));

  const byId = new Map(unlocks.map((u) => [u.achievementId, u]));
  const newIds = unlocks.filter((u) => !u.seen).map((u) => u.achievementId);

  // Seeing the screen is what clears the "NEW" state - not a separate dismiss.
  useEffect(() => {
    if (newIds.length > 0) void markAchievementsSeen(newIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIds.join(',')]);

  const views = ACHIEVEMENTS.map((def) => {
    const unlock = byId.get(def.id);
    return {
      def,
      unlocked: !!unlock,
      unlockedAt: unlock?.unlockedAt ?? null,
      isNew: !!unlock && !unlock.seen,
      progress: ruleProgress(def.rule, stats),
      progressLabel: ruleProgressLabel(def.rule, stats),
      eligible: isSatisfied(def.rule, stats),
    };
  }).sort((a, b) => {
    // Unlocked first, then closest to unlocking, then by tier.
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked && b.unlocked) return (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0);
    if (a.progress !== b.progress) return b.progress - a.progress;
    return TIER_ORDER[a.def.tier] - TIER_ORDER[b.def.tier];
  });

  const unlockedCount = views.filter((v) => v.unlocked).length;
  const xpFromAchievements = views
    .filter((v) => v.unlocked)
    .reduce((sum, v) => sum + v.def.xpReward, 0);

  return (
    <>
      <PageHeader
        title="Achievements"
        subtitle="Earned from what you actually did, never from opening a screen."
      />

      <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
        <StatTile
          label="UNLOCKED"
          value={`${unlockedCount}/${ACHIEVEMENTS.length}`}
          delta="earned"
          tone={unlockedCount > 0 ? 'accent' : 'muted'}
        />
        <StatTile label="XP FROM THESE" value={String(xpFromAchievements)} delta="awarded" />
        <StatTile label="BEST STREAK" value={String(stats.bestHabitStreak)} delta="days" />
        <StatTile label="TASKS DONE" value={String(stats.tasksCompleted)} delta="all time" />
      </div>

      {unlockedCount === 0 ? (
        <Card style={{ marginBottom: 16 }}>
          <EmptyState
            icon="achievements"
            title="Nothing unlocked yet"
            body="Achievements fire the moment their condition is genuinely met — completing your first task unlocks one immediately. Everything below shows exactly how close you are."
          />
        </Card>
      ) : null}

      <Card>
        <CardHeader kicker="ALL ACHIEVEMENTS" title={`${unlockedCount} of ${ACHIEVEMENTS.length}`} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))',
            gap: 14,
          }}
        >
          {views.map((view) => {
            const locked = !view.unlocked;
            const color = locked ? 'var(--c-text-faint)' : view.def.color;
            return (
              <div
                key={view.def.id}
                style={{
                  background: 'var(--c-bg-card)',
                  border: `1px solid ${
                    view.isNew
                      ? 'var(--c-accent-border)'
                      : locked
                        ? 'var(--c-border-ghost)'
                        : 'var(--c-border)'
                  }`,
                  borderRadius: 'var(--r-3xl)',
                  padding: 18,
                  textAlign: 'center',
                  opacity: locked ? 0.72 : 1,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 52,
                    height: 52,
                    margin: '0 auto 12px',
                    borderRadius: 'var(--r-5xl)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    color,
                    background: locked ? 'var(--c-fill-ghost)' : `${view.def.color}22`,
                    border: `1px solid ${locked ? 'var(--c-border-faint)' : `${view.def.color}55`}`,
                  }}
                >
                  {view.def.glyph}
                </div>

                <h3 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: '0 0 4px' }}>
                  {view.def.name}
                </h3>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', margin: '0 0 12px', lineHeight: 1.5 }}>
                  {view.def.description}
                </p>

                {view.unlocked ? (
                  <div className="row" style={{ justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {view.isNew ? (
                      <Badge color="var(--c-accent-text)" border="var(--c-accent-border)">
                        New
                      </Badge>
                    ) : null}
                    <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                      {view.unlockedAt ? formatRelativeDay(toDayKey(view.unlockedAt)) : ''}
                    </span>
                  </div>
                ) : (
                  <>
                    <ProgressBar
                      percent={view.progress}
                      color={view.def.color}
                      animate={false}
                      label={`${view.def.name}: ${view.progressLabel}`}
                    />
                    <p
                      className="mono"
                      style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', margin: '7px 0 0' }}
                    >
                      {view.progressLabel}
                    </p>
                  </>
                )}

                <p
                  className="mono"
                  style={{
                    fontSize: 'var(--fs-3xs)',
                    color: locked ? 'var(--c-text-ghost)' : 'var(--c-accent-text)',
                    margin: '10px 0 0',
                  }}
                >
                  {view.def.tier} · +{view.def.xpReward} XP
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
