/**
 * Habits.
 *
 * UI/UX section 15: streaks, difficulty, streak protection, missed-habit
 * recovery, and the Habit -> Identity framing ("Read 20 minutes" becomes
 * "Reader"), which is why identity is a first-class field rather than a tag.
 *
 * Every streak number on this screen is computed from HabitLog rows by
 * domain/streaks.ts. None is stored, so none can be wrong in a way that
 * survives a reload.
 */

import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  StatTile,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useSelector, useSettings } from '../../app/hooks';
import { selectHabitRate, selectHabits, type HabitView } from '../../domain/selectors';
import {
  createHabit,
  deleteHabit,
  protectHabitDay,
  setHabitStatus,
  toggleHabitLog,
  updateHabit,
} from '../../data/actions';
import { HABIT_FREQUENCIES, LIFE_AREAS, type Habit } from '../../data/schema';
import { formatRelativeDay, weekdayInitials, type DayKey } from '../../domain/dates';
import { achievementName } from '../../domain/achievements';
import { achievementAlertsEnabled } from '../../domain/nudges';
import { AppError } from '../../data/errors';

export default function HabitsScreen() {
  const habits = useSelector(selectHabits);
  const rate = useSelector(selectHabitRate);
  const settings = useSettings();
  const [editing, setEditing] = useState<Habit | null>(null);
  const [creating, setCreating] = useState(false);

  const active = habits.filter((h) => h.habit.status === 'ACTIVE');
  const paused = habits.filter((h) => h.habit.status !== 'ACTIVE');
  const best = habits.reduce((max, h) => Math.max(max, h.streak), 0);
  const doneToday = active.filter((h) => h.doneToday).length;
  const dueToday = active.filter((h) => h.dueToday).length;

  return (
    <>
      <PageHeader
        title="Habits"
        subtitle="Every completion is a vote for the person you are becoming."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New habit
          </Button>
        }
      />

      {habits.length === 0 ? (
        <Card>
          <EmptyState
            icon="habits"
            title="No habits yet"
            body="Habits are the compounding part of Life OS — streaks, identity and most of your steady XP come from here. Start with one that takes under twenty minutes, so keeping it is never the hard part."
            action={
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                Add your first habit
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid-stats los-stagger" style={{ marginBottom: 16 }}>
            <StatTile
              label="BEST STREAK"
              value={String(best)}
              delta={best > 0 ? 'days' : 'none yet'}
              tone={best > 0 ? 'accent' : 'muted'}
            />
            <StatTile label="DUE TODAY" value={`${doneToday}/${dueToday}`} delta="logged" />
            <StatTile
              label="30-DAY RATE"
              value={`${rate}%`}
              delta="across active habits"
              tone={rate >= 70 ? 'accent' : 'muted'}
            />
            <StatTile label="ACTIVE" value={String(active.length)} delta="habits" />
          </div>

          <Card flush>
            <div
              className="row"
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--c-border-faint)',
                gap: 12,
              }}
            >
              <span className="card-kicker grow" style={{ margin: 0 }}>
                ACTIVE HABITS
              </span>
              <div className="row mono" style={{ gap: 5, flex: 'none' }}>
                {weekdayInitials(settings.weekStartsMonday).map((letter, i) => (
                  <span
                    key={i}
                    style={{
                      width: 15,
                      textAlign: 'center',
                      fontSize: 'var(--fs-3xs)',
                      color: 'var(--c-text-ghost)',
                    }}
                  >
                    {letter}
                  </span>
                ))}
              </div>
              <span style={{ width: 48, flex: 'none' }} />
            </div>

            {active.length === 0 ? (
              <EmptyState
                icon="habits"
                title="Every habit is paused"
                body="Paused habits keep their history but stop counting against your streaks. Resume one when you are ready for it again."
              />
            ) : (
              <div className="list">
                {active.map((view) => (
                  <HabitRow key={view.habit.id} view={view} onEdit={() => setEditing(view.habit)} />
                ))}
              </div>
            )}
          </Card>

          {paused.length > 0 ? (
            <Card flush style={{ marginTop: 16 }}>
              <div className="group-label">PAUSED · {paused.length}</div>
              <div className="list">
                {paused.map((view) => (
                  <div className="list-row los-row" key={view.habit.id}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row-title truncate">{view.habit.title}</div>
                      <div className="row-meta">
                        Longest streak {view.longest} · {view.habit.status.toLowerCase()}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void setHabitStatus(view.habit.id, 'ACTIVE')}
                    >
                      Resume
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}

      <HabitEditor
        open={creating || editing != null}
        habit={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

/* ================================================================== *
 * Row
 * ================================================================== */

function HabitRow({ view, onEdit }: { view: HabitView; onEdit: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const streakColor =
    view.streak >= 20
      ? 'var(--c-accent)'
      : view.streak >= 7
        ? 'var(--c-warn)'
        : view.streak > 0
          ? 'var(--c-danger)'
          : 'var(--c-text-ghost)';

  const toggleToday = async () => {
    setBusy(true);
    try {
      const result = await toggleHabitLog(view.habit.id);
      if (!view.doneToday) {
        toast.show(`${view.habit.title} · +${result.xpAwarded} XP`, {
          tone: 'xp',
          action: { label: 'Undo', run: () => void toggleHabitLog(view.habit.id) },
        });
        if (achievementAlertsEnabled()) for (const id of result.unlockedAchievements) {
          toast.show(`Achievement unlocked · ${achievementName(id)}`, { tone: 'xp' });
        }
      }
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  /** Spending a protection on a specific missed day, from the week strip. */
  const protectDay = (day: DayKey) => {
    if (view.protectionsLeft <= 0) {
      toast.show('No streak protections left for this habit.', { tone: 'muted' });
      return;
    }
    confirm({
      title: 'Use a streak protection?',
      body: `This marks ${formatRelativeDay(day)} as protected so your ${view.habit.title} streak survives. It does not count as a completion and earns no XP.`,
      note: `${view.protectionsLeft} protection${view.protectionsLeft === 1 ? '' : 's'} left.`,
      actionLabel: 'Protect that day',
      onConfirm: async () => {
        await protectHabitDay(view.habit.id, day);
        toast.show('Streak protected', { tone: 'ok' });
      },
    });
  };

  return (
    <div className="list-row los-row">
      <button
        type="button"
        role="checkbox"
        aria-checked={view.doneToday}
        aria-busy={busy || undefined}
        disabled={!view.dueToday || busy}
        aria-label={
          view.doneToday
            ? `Unlog "${view.habit.title}" for today`
            : `Log "${view.habit.title}" for today`
        }
        className={`checkbox${view.doneToday ? ' checkbox-on' : ''}`}
        onClick={toggleToday}
        title={view.dueToday ? undefined : 'Not scheduled today'}
      >
        {view.doneToday ? <Icon name="check" size={12} strokeWidth={3} /> : null}
      </button>

      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={`row-title truncate${view.doneToday ? ' row-title-done' : ''}`}>
            {view.habit.title}
          </span>
          {view.habit.identity ? (
            <Badge color="var(--c-accent-text)" border="var(--c-accent-border-soft)">
              {view.habit.identity}
            </Badge>
          ) : null}
        </div>
        <div className="row-meta">
          {view.streak > 0 ? `${view.streak}-day streak` : 'No streak yet'} · longest {view.longest}{' '}
          · {view.rate30}% over 30 days
        </div>
      </div>

      {/* --- week strip: real per-day state, clickable to recover a miss --- */}
      <div className="row" style={{ gap: 5, flex: 'none' }} role="group" aria-label="This week">
        {view.week.map(({ day, state }) => {
          const background =
            state === 'done'
              ? 'var(--c-accent)'
              : state === 'protected'
                ? 'var(--c-warn)'
                : state === 'missed'
                  ? 'var(--c-fill-miss)'
                  : state === 'off'
                    ? 'transparent'
                    : 'var(--c-fill)';
          const canProtect = state === 'missed' && view.protectionsLeft > 0;
          return (
            <button
              key={day}
              type="button"
              className="habit-day"
              disabled={!canProtect}
              onClick={() => protectDay(day)}
              aria-label={`${formatRelativeDay(day)}: ${state}${canProtect ? '. Use a streak protection' : ''}`}
              title={`${formatRelativeDay(day)} · ${state}`}
              style={{
                width: 15,
                height: 15,
                borderRadius: 4,
                background,
                border: state === 'off' ? '1px dashed var(--c-border-faint)' : 'none',
                padding: 0,
                cursor: canProtect ? 'pointer' : 'default',
              }}
            />
          );
        })}
      </div>

      <span
        className="mono"
        style={{ fontSize: 'var(--fs-md)', color: streakColor, width: 34, textAlign: 'right', flex: 'none' }}
      >
        {view.streak}
      </span>

      <IconButton icon="edit" label={`Edit "${view.habit.title}"`} size="sm" onClick={onEdit} />
    </div>
  );
}

/* ================================================================== *
 * Editor
 * ================================================================== */

function HabitEditor({
  open,
  habit,
  onClose,
}: {
  open: boolean;
  habit: Habit | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [form, setForm] = useState(() => blank(habit));
  const key = `${open}-${habit?.id ?? 'new'}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank(habit));
  }

  const submit = useAction(async () => {
    const payload = {
      title: form.title,
      description: form.description,
      identity: form.identity,
      area: form.area,
      frequency: form.frequency,
      target: Number(form.target) || 1,
      weekdays: form.weekdays,
      xpPerCompletion: Number(form.xp) || 0,
      protectionAllowance: Number(form.protections) || 0,
      startDate: habit?.startDate ?? Date.now(),
    };
    return habit ? updateHabit(habit.id, payload) : createHabit(payload);
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  const save = async () => {
    const result = await submit.run();
    if (!result) return;
    toast.show(habit ? 'Habit updated' : 'Habit created', { tone: 'ok' });
    onClose();
  };

  const toggleWeekday = (day: number) => {
    setForm({
      ...form,
      weekdays: form.weekdays.includes(day)
        ? form.weekdays.filter((d) => d !== day)
        : [...form.weekdays, day].sort(),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={habit ? 'Edit habit' : 'New habit'}
      description="Small and repeatable beats ambitious and abandoned."
      footer={
        <>
          {habit ? (
            <>
              <Button
                variant="danger"
                icon="trash"
                onClick={() =>
                  confirm({
                    title: 'Delete this habit?',
                    body: `"${habit.title}" and its entire completion history will be removed.`,
                    note: 'Your streak history goes with it. Pausing the habit instead keeps the record.',
                    actionLabel: 'Delete habit',
                    danger: true,
                    onConfirm: async () => {
                      await deleteHabit(habit.id);
                      onClose();
                      toast.show('Habit deleted', { tone: 'muted' });
                    },
                  })
                }
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await setHabitStatus(habit.id, habit.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
                  onClose();
                }}
              >
                {habit.status === 'ACTIVE' ? 'Pause' : 'Resume'}
              </Button>
            </>
          ) : null}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            loading={submit.pending}
            disabled={form.title.trim().length === 0}
          >
            {habit ? 'Save changes' : 'Create habit'}
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
        label="Habit"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Read 20 minutes"
      />

      <TextField
        label="Identity"
        value={form.identity}
        onChange={(e) => setForm({ ...form, identity: e.target.value })}
        error={fieldErrors.identity}
        placeholder="Reader"
        hint="Who this habit makes you. Shown beside the habit as a reminder of the point."
      />

      <TextAreaField
        label="Notes"
        rows={2}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        error={fieldErrors.description}
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 160px' }}>
          <SelectField
            label="Life area"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
          />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <SelectField
            label="Frequency"
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            options={HABIT_FREQUENCIES.map((f) => ({
              value: f,
              label: f.charAt(0) + f.slice(1).toLowerCase(),
            }))}
          />
        </div>
        {form.frequency === 'WEEKLY' ? (
          <div style={{ flex: '1 1 140px' }}>
            <TextField
              label="Times per week"
              type="number"
              min={1}
              max={7}
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              error={fieldErrors.target}
            />
          </div>
        ) : null}
      </div>

      {form.frequency === 'CUSTOM' ? (
        <div className="field">
          <span className="field-label">
            Days <span className="field-required">*</span>
          </span>
          <div className="row" style={{ gap: 6 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleWeekday(day)}
                aria-pressed={form.weekdays.includes(day)}
                className="los-press"
                style={{
                  padding: '7px 10px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 'var(--fs-xs)',
                  cursor: 'pointer',
                  border: `1px solid ${form.weekdays.includes(day) ? 'var(--c-accent-border-strong)' : 'var(--c-border-faint)'}`,
                  background: form.weekdays.includes(day) ? 'var(--c-accent-wash-strong)' : 'transparent',
                  color: form.weekdays.includes(day) ? 'var(--c-text)' : 'var(--c-text-muted)',
                }}
              >
                {name}
              </button>
            ))}
          </div>
          {fieldErrors.weekdays ? (
            <p className="field-error" role="alert">
              <Icon name="alert" size={12} />
              {fieldErrors.weekdays}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 150px' }}>
          <TextField
            label="XP per completion"
            type="number"
            min={0}
            value={form.xp}
            onChange={(e) => setForm({ ...form, xp: e.target.value })}
            error={fieldErrors.xpPerCompletion}
            hint="Grows with your streak"
          />
        </div>
        <div style={{ flex: '1 1 150px' }}>
          <TextField
            label="Streak protections"
            type="number"
            min={0}
            max={10}
            value={form.protections}
            onChange={(e) => setForm({ ...form, protections: e.target.value })}
            error={fieldErrors.protectionAllowance}
            hint="Missed days you can cover"
          />
        </div>
      </div>
    </Modal>
  );
}

function blank(habit: Habit | null) {
  return {
    title: habit?.title ?? '',
    description: habit?.description ?? '',
    identity: habit?.identity ?? '',
    area: (habit?.area ?? 'Other') as string,
    frequency: (habit?.frequency ?? 'DAILY') as string,
    target: String(habit?.target ?? 1),
    weekdays: habit?.weekdays ?? [],
    xp: String(habit?.xpPerCompletion ?? 20),
    protections: String(habit?.protectionAllowance ?? 1),
  };
}
