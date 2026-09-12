/**
 * The command palette.
 *
 * Ctrl/Cmd+K, per UI/UX section 20 and 31-32. It is a real system, not a
 * search box: commands that modify data execute the same actions the UI does,
 * and results come from live search across every entity.
 *
 * Keyboard contract: arrows move, Enter runs, Escape closes, and the active
 * option is announced via aria-activedescendant so it works with a screen
 * reader rather than only visually.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon, type IconName } from '../ui/Icon';
import { useDebounced, useSelector } from './hooks';
import { NAV_ENTRIES } from './Sidebar';
import { search, selectHabits, selectTodayGroups, type SearchHit } from '../domain/selectors';
import { toggleHabitLog, completeTask } from '../data/actions';
import { useToast } from '../ui/overlays';
import { useFocusTrap } from './hooks';
import { createPortal } from 'react-dom';

type CommandKind = 'GO' | 'CREATE' | 'LOG' | 'DONE' | 'OPEN' | 'ASK AI';

interface Command {
  id: string;
  kind: CommandKind;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
}

const KIND_STYLE: Record<CommandKind, { color: string; border: string }> = {
  GO: { color: '#4C6FAE', border: 'rgba(76,111,174,.35)' },
  CREATE: { color: 'var(--c-accent-text)', border: 'var(--c-accent-border-soft)' },
  LOG: { color: '#B5566B', border: 'rgba(181,86,107,.35)' },
  DONE: { color: '#7BB08A', border: 'rgba(123,176,138,.35)' },
  OPEN: { color: '#7B9AD0', border: 'rgba(123,154,208,.35)' },
  'ASK AI': { color: '#6E8FD1', border: 'rgba(76,111,174,.4)' },
};

const HIT_ICON: Record<SearchHit['kind'], IconName> = {
  task: 'tasks',
  goal: 'goals',
  project: 'projects',
  note: 'notes',
  journal: 'journal',
  habit: 'habits',
  quest: 'quests',
  workout: 'fitness',
};

export function CommandPalette({
  open,
  onClose,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (type: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 120);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(open);

  // Live data the action commands operate on.
  const todayTasks = useSelector(() => selectTodayGroups().flatMap((g) => g.items));
  const habits = useSelector(() => selectHabits());
  const hits = useSelector(() => (debounced.trim() ? search(debounced, 12) : []), [debounced]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after the portal mounts, or the caret lands nowhere.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    /* --- create --- */
    for (const type of ['Task', 'Goal', 'Project', 'Habit', 'Note', 'Journal entry', 'Workout']) {
      list.push({
        id: `create-${type}`,
        kind: 'CREATE',
        label: `New ${type.toLowerCase()}`,
        hint: type.toLowerCase(),
        run: () => onCapture(type),
      });
    }

    /* --- complete a task that is actually open right now --- */
    for (const view of todayTasks.filter((v) => v.task.status !== 'COMPLETED').slice(0, 8)) {
      list.push({
        id: `done-${view.task.id}`,
        kind: 'DONE',
        label: `Complete “${view.task.title}”`,
        hint: 'task',
        run: async () => {
          const result = await completeTask(view.task.id);
          toast.show(`Completed · +${result.xpAwarded} XP`, { tone: 'xp' });
        },
      });
    }

    /* --- log a habit that is due and not yet done --- */
    for (const view of habits.filter((h) => h.dueToday && !h.doneToday).slice(0, 8)) {
      list.push({
        id: `log-${view.habit.id}`,
        kind: 'LOG',
        label: `Log “${view.habit.title}”`,
        hint: 'habit',
        run: async () => {
          const result = await toggleHabitLog(view.habit.id);
          toast.show(`${view.habit.title} logged · +${result.xpAwarded} XP`, { tone: 'xp' });
        },
      });
    }

    /* --- navigate --- */
    for (const entry of NAV_ENTRIES) {
      list.push({
        id: `go-${entry.to}`,
        kind: 'GO',
        label: entry.label,
        hint: entry.to.slice(1),
        run: () => navigate(entry.to),
      });
    }

    list.push({
      id: 'ask-ai',
      kind: 'ASK AI',
      label: 'What should I do right now?',
      hint: 'coach',
      run: () => navigate('/ai?ask=what-now'),
    });

    return list;
  }, [todayTasks, habits, navigate, onCapture, toast]);

  /* --- filter commands, then append entity hits --- */
  const results = useMemo<Command[]>(() => {
    const q = debounced.trim().toLowerCase();
    const matched = q
      ? commands.filter(
          (c) => c.label.toLowerCase().includes(q) || c.kind.toLowerCase().includes(q) || c.hint.includes(q),
        )
      : commands.filter((c) => c.kind === 'CREATE' || c.kind === 'DONE' || c.kind === 'LOG').slice(0, 8);

    const hitCommands: Command[] = hits.map((hit) => ({
      id: `hit-${hit.kind}-${hit.id}`,
      kind: 'OPEN' as const,
      label: hit.title,
      hint: hit.kind,
      run: () => navigate(hit.route),
    }));

    return [...matched.slice(0, 12), ...hitCommands];
  }, [commands, debounced, hits, navigate]);

  useEffect(() => {
    setActive(0);
  }, [debounced]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.querySelector(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runActive = async () => {
    const command = results[active];
    if (!command) return;
    onClose();
    try {
      await command.run();
    } catch {
      toast.showError('That command could not be completed.');
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void runActive();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="scrim scrim-top"
      style={{ zIndex: 60 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: '100%',
          maxWidth: 620,
          background: 'var(--c-bg-panel)',
          border: '1px solid var(--c-border)',
          borderRadius: 'var(--r-3xl)',
          boxShadow: 'var(--sh-overlay)',
          overflow: 'hidden',
          animation: 'losPop .18s var(--ease) both',
        }}
      >
        <div
          className="row"
          style={{ gap: 11, padding: '14px 16px', borderBottom: '1px solid var(--c-border-faint)' }}
        >
          <Icon name="search" size={17} color="var(--c-text-dim)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search, or type a command…"
            aria-label="Search or run a command"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-option-${active}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 'var(--fs-2xl)',
              color: 'var(--c-text)',
            }}
          />
          <kbd className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Results"
          className="los-scroll"
          style={{ maxHeight: 380, padding: 6 }}
        >
          {results.length === 0 ? (
            <p
              style={{
                padding: '28px 16px',
                textAlign: 'center',
                color: 'var(--c-text-dim)',
                fontSize: 'var(--fs-md)',
                margin: 0,
              }}
            >
              Nothing matches “{debounced.trim()}”. Try a different word, or press Escape.
            </p>
          ) : (
            results.map((command, i) => {
              const style = KIND_STYLE[command.kind];
              const isActive = i === active;
              return (
                <div
                  key={command.id}
                  id={`palette-option-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runActive()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '9px 11px',
                    borderRadius: 'var(--r-lg)',
                    cursor: 'pointer',
                    background: isActive ? 'var(--c-fill-hover)' : 'transparent',
                  }}
                >
                  <span
                    className="badge"
                    style={{ color: style.color, borderColor: style.border, flex: 'none' }}
                  >
                    {command.kind}
                  </span>
                  {command.kind === 'OPEN' ? (
                    <Icon name={HIT_ICON[command.hint as SearchHit['kind']] ?? 'notes'} size={14} />
                  ) : null}
                  <span className="grow truncate" style={{ fontSize: 'var(--fs-lg)' }}>
                    {command.label}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                    {command.hint}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div
          className="row mono"
          style={{
            gap: 14,
            padding: '9px 16px',
            borderTop: '1px solid var(--c-border-faint)',
            fontSize: 'var(--fs-3xs)',
            color: 'var(--c-text-ghost)',
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
          <span className="grow" />
          <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
