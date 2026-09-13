/**
 * Calendar.
 *
 * UI/UX section 17: day, week and month views, local events only (external
 * calendar integration is explicitly cut from V1 because it needs OAuth and a
 * network call this architecture does not make).
 *
 * The grid shows three kinds of item, and is honest about which is which:
 *   - events, which you own and can drag, resize and edit here
 *   - tasks with a due date, drawn as a marker
 *   - logged workouts
 * Tasks and workouts are read-only overlays: they are edited on their own
 * screens, so dragging them here is disabled rather than silently doing nothing.
 */

import { useMemo, useRef, useState } from 'react';

import {
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useSelector, useSettings } from '../../app/hooks';
import { selectCalendarItems, type CalendarItem } from '../../domain/selectors';
import { createEvent, deleteEvent, moveEvent, resizeEvent, updateEvent } from '../../data/actions';
import {
  addDays,
  atMinute,
  dayKeyToMs,
  endOfDay,
  formatDayShort,
  formatMonthYear,
  formatTime,
  minutesIntoDay,
  monthGrid,
  startOfMonth,
  toDayKey,
  today as todayKey,
  weekDays,
  weekdayInitials,
  type DayKey,
} from '../../domain/dates';
import { LIFE_AREAS, type CalendarEvent } from '../../data/schema';
import { store } from '../../data/store';
import { AppError } from '../../data/errors';

type ViewMode = 'day' | 'week' | 'month';

/** Pixels per hour in the time grid. 48 fits a working day without scrolling. */
const HOUR_HEIGHT = 48;
const START_HOUR = 6;
const END_HOUR = 23;
const GUTTER = 52;

export default function CalendarScreen() {
  const settings = useSettings();
  const toast = useToast();
  const [mode, setMode] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<DayKey>(todayKey());
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState<{ day: DayKey; minute: number } | null>(null);

  const days = useMemo(() => {
    if (mode === 'day') return [anchor];
    if (mode === 'week') return weekDays(anchor, settings.weekStartsMonday);
    return monthGrid(anchor, settings.weekStartsMonday);
  }, [mode, anchor, settings.weekStartsMonday]);

  const from = dayKeyToMs(days[0]!);
  const to = endOfDay(dayKeyToMs(days[days.length - 1]!));
  const items = useSelector(() => selectCalendarItems(from, to), [from, to]);

  const step = (delta: number) => {
    if (mode === 'day') setAnchor(addDays(anchor, delta));
    else if (mode === 'week') setAnchor(addDays(anchor, delta * 7));
    else {
      const d = new Date(dayKeyToMs(startOfMonth(anchor)));
      d.setMonth(d.getMonth() + delta);
      setAnchor(toDayKey(d.getTime()));
    }
  };

  const heading =
    mode === 'month'
      ? formatMonthYear(anchor)
      : mode === 'day'
        ? formatDayShort(anchor)
        : `${formatDayShort(days[0]!)} — ${formatDayShort(days[days.length - 1]!)}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Events you own, plus everything else that has a time attached."
        actions={
          <>
            <Tabs
              label="Calendar view"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
            <Button
              variant="primary"
              icon="plus"
              onClick={() => setCreating({ day: todayKey(), minute: 9 * 60 })}
            >
              New event
            </Button>
          </>
        }
      />

      <Card flush>
        <div
          className="spread calendar-toolbar"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--c-border-faint)', gap: 12 }}
        >
          <div className="row" style={{ gap: 6 }}>
            <IconButton icon="chevronLeft" label="Previous period" onClick={() => step(-1)} />
            <IconButton icon="chevronRight" label="Next period" onClick={() => step(1)} />
            <Button size="sm" variant="ghost" onClick={() => setAnchor(todayKey())}>
              Today
            </Button>
          </div>
          <h2 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}>{heading}</h2>
          <div className="row mono" style={{ gap: 12, fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
            <LegendDot color="var(--c-accent)" label="EVENT" />
            <LegendDot color="var(--c-danger)" label="TASK" />
            <LegendDot color="var(--c-warn)" label="TRAINING" />
          </div>
        </div>

        {mode === 'month' ? (
          <MonthGrid
            days={days}
            anchor={anchor}
            items={items}
            onOpenDay={(day) => {
              setAnchor(day);
              setMode('day');
            }}
          />
        ) : (
          <TimeGrid
            days={days}
            items={items}
            onCreate={(day, minute) => setCreating({ day, minute })}
            onOpen={(item) => {
              if (item.kind !== 'event') {
                toast.show(
                  item.kind === 'task'
                    ? 'Tasks are edited on the Tasks screen.'
                    : 'Workouts are edited on the Fitness screen.',
                  { tone: 'muted' },
                );
                return;
              }
              const event = store.byId('calendarEvents', item.sourceId);
              if (event) setEditing(event);
            }}
            onMove={async (item, newStart) => {
              if (item.kind !== 'event') return;
              try {
                await moveEvent(item.sourceId, newStart);
              } catch (err) {
                toast.showError(err instanceof Error ? err.message : 'That move could not be saved.');
              }
            }}
            onResize={async (item, newEnd) => {
              if (item.kind !== 'event') return;
              try {
                await resizeEvent(item.sourceId, newEnd);
              } catch (err) {
                toast.showError(err instanceof Error ? err.message : 'That change could not be saved.');
              }
            }}
          />
        )}

        {items.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--c-border-faint)' }}>
            <EmptyState
              icon="calendar"
              title="Nothing scheduled in this period"
              body="Click any empty slot to create an event. Tasks with a due date and logged workouts show up here automatically, so the calendar reflects the whole system rather than a separate list."
            />
          </div>
        ) : null}
      </Card>

      <EventEditor
        open={creating != null || editing != null}
        event={editing}
        initial={creating}
        onClose={() => {
          setCreating(null);
          setEditing(null);
        }}
      />
    </>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="row" style={{ gap: 5 }}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: 2, background: color, flex: 'none' }}
      />
      {label}
    </span>
  );
}

/* ================================================================== *
 * Day / week time grid
 * ================================================================== */

function TimeGrid({
  days,
  items,
  onCreate,
  onOpen,
  onMove,
  onResize,
}: {
  days: DayKey[];
  items: CalendarItem[];
  onCreate: (day: DayKey, minute: number) => void;
  onOpen: (item: CalendarItem) => void;
  onMove: (item: CalendarItem, newStart: number) => void;
  onResize: (item: CalendarItem, newEnd: number) => void;
}) {
  const today = todayKey();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; offsetMinutes: number; previewStart: number } | null>(
    null,
  );
  /** Local preview while a resize handle is held; committed once on release. */
  const [resize, setResize] = useState<{ id: string; end: number } | null>(null);

  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);
  const gridHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;

  /** Converts a pointer position into a day + minute, snapped to 15 minutes. */
  const positionToSlot = (clientX: number, clientY: number): { day: DayKey; minute: number } | null => {
    const body = bodyRef.current;
    if (!body) return null;
    const rect = body.getBoundingClientRect();
    const x = clientX - rect.left - GUTTER;
    const y = clientY - rect.top + body.scrollTop;
    const columnWidth = (rect.width - GUTTER) / days.length;
    const index = Math.floor(x / columnWidth);
    const day = days[Math.max(0, Math.min(days.length - 1, index))];
    if (!day) return null;
    const rawMinute = START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
    const minute = Math.max(0, Math.min(24 * 60 - 15, Math.round(rawMinute / 15) * 15));
    return { day, minute };
  };

  return (
    <div ref={bodyRef} className="los-scroll" style={{ maxHeight: 620, position: 'relative' }}>
      {/* --- day headers --- */}
      <div
        className="row"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--c-bg-card)',
          borderBottom: '1px solid var(--c-border-faint)',
        }}
      >
        <div style={{ width: GUTTER, flex: 'none' }} />
        {days.map((day) => (
          <div
            key={day}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '9px 4px',
              borderLeft: '1px solid var(--c-border-ghost)',
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}
            >
              {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(dayKeyToMs(day)).getDay()]}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 'var(--fs-2xl)',
                fontWeight: 700,
                color: day === today ? 'var(--c-accent)' : 'var(--c-text-secondary)',
              }}
            >
              {new Date(dayKeyToMs(day)).getDate()}
            </div>
          </div>
        ))}
      </div>

      {/* --- grid --- */}
      <div
        style={{ position: 'relative', height: gridHeight }}
        onPointerMove={(e) => {
          if (!drag) return;
          const slot = positionToSlot(e.clientX, e.clientY);
          if (!slot) return;
          setDrag({
            ...drag,
            previewStart: atMinute(slot.day, Math.max(0, slot.minute - drag.offsetMinutes)),
          });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const item = items.find((i) => i.id === drag.id);
          if (item && drag.previewStart !== item.start) onMove(item, drag.previewStart);
          setDrag(null);
        }}
        onPointerLeave={() => setDrag(null)}
      >
        {/* hour lines + click targets */}
        {hours.map((hour) => (
          <div
            key={hour}
            style={{
              position: 'absolute',
              top: (hour - START_HOUR) * HOUR_HEIGHT,
              left: 0,
              right: 0,
              height: HOUR_HEIGHT,
              borderTop: '1px solid var(--c-border-ghost)',
              display: 'flex',
            }}
          >
            <span
              className="mono"
              style={{
                width: GUTTER,
                flex: 'none',
                fontSize: 'var(--fs-3xs)',
                color: 'var(--c-text-ghost)',
                padding: '3px 8px 0 0',
                textAlign: 'right',
              }}
            >
              {String(hour).padStart(2, '0')}
            </span>
            {days.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => onCreate(day, hour * 60)}
                aria-label={`Create an event on ${formatDayShort(day)} at ${String(hour).padStart(2, '0')}:00`}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  borderLeft: '1px solid var(--c-border-ghost)',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        ))}

        {/* now line */}
        {days.includes(today) ? <NowLine days={days} /> : null}

        {/* items */}
        {items.map((item) => {
          const day = toDayKey(drag?.id === item.id ? drag.previewStart : item.start);
          const index = days.indexOf(day);
          if (index < 0) return null;

          const start = drag?.id === item.id ? drag.previewStart : item.start;
          const previewEnd = resize?.id === item.id ? resize.end : item.end;
          const duration = previewEnd - item.start;
          const startMinute = minutesIntoDay(start);
          const top = ((startMinute - START_HOUR * 60) / 60) * HOUR_HEIGHT;
          const height = Math.max(20, (duration / 3_600_000) * HOUR_HEIGHT);
          if (top + height < 0 || top > gridHeight) return null;

          const draggable = item.kind === 'event';

          return (
            <div
              key={item.id}
              style={{
                position: 'absolute',
                top,
                left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${index} / ${days.length} + 3px)`,
                width: `calc((100% - ${GUTTER}px) / ${days.length} - 6px)`,
                height,
                background: `${item.color}26`,
                borderLeft: `2px solid ${item.color}`,
                borderRadius: 'var(--r-sm)',
                padding: '5px 7px',
                overflow: 'hidden',
                cursor: draggable ? 'grab' : 'pointer',
                opacity: drag?.id === item.id ? 0.75 : 1,
                zIndex: drag?.id === item.id ? 20 : 5,
              }}
              onPointerDown={(e) => {
                if (!draggable) return;
                // Left button only, and not from the resize handle.
                if (e.button !== 0) return;
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                const slot = positionToSlot(e.clientX, e.clientY);
                if (!slot) return;
                setDrag({
                  id: item.id,
                  offsetMinutes: slot.minute - minutesIntoDay(item.start),
                  previewStart: item.start,
                });
              }}
              onClick={() => {
                if (!drag) onOpen(item);
              }}
            >
              <div
                className="mono truncate"
                style={{ fontSize: 'var(--fs-3xs)', color: item.color }}
              >
                {formatTime(start)}
              </div>
              <div
                className="truncate"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-strong)', marginTop: 1 }}
              >
                {item.title}
              </div>

              {draggable ? (
                <div
                  role="separator"
                  aria-label={`Resize "${item.title}"`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    // Preview locally while dragging and commit ONCE on release.
                    // Writing on every pointermove would put dozens of
                    // transactions through the data layer for a single gesture.
                    let latest: number | null = null;
                    const move = (ev: PointerEvent) => {
                      const slot = positionToSlot(ev.clientX, ev.clientY);
                      if (!slot) return;
                      const newEnd = atMinute(toDayKey(item.start), slot.minute);
                      if (newEnd > item.start) {
                        latest = newEnd;
                        setResize({ id: item.id, end: newEnd });
                      }
                    };
                    const up = () => {
                      window.removeEventListener('pointermove', move);
                      window.removeEventListener('pointerup', up);
                      setResize(null);
                      if (latest != null && latest !== item.end) onResize(item, latest);
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                  }}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 6,
                    cursor: 'ns-resize',
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NowLine({ days }: { days: DayKey[] }) {
  const minute = minutesIntoDay(Date.now());
  const top = ((minute - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  if (top < 0) return null;
  const index = days.indexOf(todayKey());
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top,
        left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${index} / ${days.length})`,
        width: `calc((100% - ${GUTTER}px) / ${days.length})`,
        height: 1,
        background: 'var(--c-accent)',
        zIndex: 8,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: -3,
          top: -3,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--c-accent)',
        }}
      />
    </div>
  );
}

/* ================================================================== *
 * Month grid
 * ================================================================== */

function MonthGrid({
  days,
  anchor,
  items,
  onOpenDay,
}: {
  days: DayKey[];
  anchor: DayKey;
  items: CalendarItem[];
  onOpenDay: (day: DayKey) => void;
}) {
  const settings = useSettings();
  const today = todayKey();
  const month = new Date(dayKeyToMs(anchor)).getMonth();

  const byDay = new Map<DayKey, CalendarItem[]>();
  for (const item of items) {
    const key = toDayKey(item.start);
    const list = byDay.get(key);
    if (list) list.push(item);
    else byDay.set(key, [item]);
  }

  return (
    <div>
      <div className="row" style={{ borderBottom: '1px solid var(--c-border-faint)' }}>
        {weekdayInitials(settings.weekStartsMonday).map((letter, i) => (
          <div
            key={i}
            className="mono"
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '9px 0',
              fontSize: 'var(--fs-3xs)',
              color: 'var(--c-text-dim)',
              letterSpacing: '.08em',
            }}
          >
            {letter}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))' }}>
        {days.map((day) => {
          const dayItems = byDay.get(day) ?? [];
          const inMonth = new Date(dayKeyToMs(day)).getMonth() === month;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onOpenDay(day)}
              aria-label={`${formatDayShort(day)}, ${dayItems.length} item${dayItems.length === 1 ? '' : 's'}`}
              style={{
                minHeight: 92,
                textAlign: 'left',
                padding: '7px 8px',
                border: 'none',
                borderRight: '1px solid var(--c-border-ghost)',
                borderBottom: '1px solid var(--c-border-ghost)',
                background: day === today ? 'var(--c-accent-wash)' : 'transparent',
                opacity: inMonth ? 1 : 0.38,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 'var(--fs-xs)',
                  fontWeight: day === today ? 700 : 400,
                  color: day === today ? 'var(--c-accent-text)' : 'var(--c-text-dim)',
                }}
              >
                {new Date(dayKeyToMs(day)).getDate()}
              </span>
              {dayItems.slice(0, 3).map((item) => (
                <span
                  key={item.id}
                  className="truncate"
                  style={{
                    fontSize: 'var(--fs-3xs)',
                    color: 'var(--c-text-strong)',
                    background: `${item.color}26`,
                    borderLeft: `2px solid ${item.color}`,
                    borderRadius: 3,
                    padding: '2px 4px',
                    width: '100%',
                  }}
                >
                  {item.title}
                </span>
              ))}
              {dayItems.length > 3 ? (
                <span style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                  +{dayItems.length - 3} more
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== *
 * Event editor
 * ================================================================== */

function EventEditor({
  open,
  event,
  initial,
  onClose,
}: {
  open: boolean;
  event: CalendarEvent | null;
  initial: { day: DayKey; minute: number } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [form, setForm] = useState(() => blank(event, initial));
  const key = `${open}-${event?.id ?? initial?.day ?? 'new'}-${initial?.minute ?? ''}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank(event, initial));
  }

  const submit = useAction(async () => {
    const payload = {
      title: form.title,
      description: form.description,
      location: form.location,
      area: form.area,
      start: new Date(form.start).getTime(),
      end: new Date(form.end).getTime(),
      allDay: form.allDay,
    };
    return event ? updateEvent(event.id, payload) : createEvent(payload);
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? 'Edit event' : 'New event'}
      footer={
        <>
          {event ? (
            <Button
              variant="danger"
              icon="trash"
              onClick={() =>
                confirm({
                  title: 'Delete this event?',
                  body: `"${event.title}" will be removed from your calendar.`,
                  actionLabel: 'Delete event',
                  danger: true,
                  onConfirm: async () => {
                    await deleteEvent(event.id);
                    onClose();
                    toast.show('Event deleted', { tone: 'muted' });
                  },
                })
              }
            >
              Delete
            </Button>
          ) : null}
          <span className="grow" />
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const result = await submit.run();
              if (!result) return;
              toast.show(event ? 'Event updated' : 'Event created', { tone: 'ok' });
              onClose();
            }}
            loading={submit.pending}
            disabled={form.title.trim().length === 0}
          >
            {event ? 'Save changes' : 'Create event'}
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
        label="Event"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="Kickboxing session"
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 190px' }}>
          <TextField
            label="Starts"
            type="datetime-local"
            required
            value={form.start}
            onChange={(e) => setForm({ ...form, start: e.target.value })}
            error={fieldErrors.start}
          />
        </div>
        <div style={{ flex: '1 1 190px' }}>
          <TextField
            label="Ends"
            type="datetime-local"
            required
            value={form.end}
            onChange={(e) => setForm({ ...form, end: e.target.value })}
            error={fieldErrors.end}
          />
        </div>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 160px' }}>
          <SelectField
            label="Life area"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
            hint="Sets the colour"
          />
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <TextField
            label="Location"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            error={fieldErrors.location}
          />
        </div>
      </div>

      <TextAreaField
        label="Notes"
        rows={2}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        error={fieldErrors.description}
      />
    </Modal>
  );
}

function blank(event: CalendarEvent | null, initial: { day: DayKey; minute: number } | null) {
  const start = event ? event.start : initial ? atMinute(initial.day, initial.minute) : Date.now();
  const end = event ? event.end : start + 3_600_000;
  return {
    title: event?.title ?? '',
    description: event?.description ?? '',
    location: event?.location ?? '',
    area: (event?.area ?? 'Other') as string,
    start: toLocalInput(start),
    end: toLocalInput(end),
    allDay: event?.allDay ?? false,
  };
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
