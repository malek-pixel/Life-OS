/**
 * Full search results page.
 *
 * The command palette is the fast path; this is where a query goes when you
 * want to see everything rather than the top few. Both call the same `search`
 * selector, so they can never disagree about what exists.
 *
 * Handles every state master prompt section 37 lists: query, loading (debounce),
 * no results, results, keyboard navigation and selection.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Badge, Card, EmptyState, PageHeader, Tabs } from '../../ui/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { useDebounced, useSelector } from '../../app/hooks';
import { search, type SearchHit } from '../../domain/selectors';

const KIND_ICON: Record<SearchHit['kind'], IconName> = {
  task: 'tasks',
  goal: 'goals',
  project: 'projects',
  note: 'notes',
  journal: 'journal',
  habit: 'habits',
  quest: 'quests',
  workout: 'fitness',
};

type Filter = 'all' | SearchHit['kind'];

export default function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState(0);

  const debounced = useDebounced(query, 160);
  const searching = query.trim() !== debounced.trim();

  const hits = useSelector(() => (debounced.trim() ? search(debounced, 100) : []), [debounced]);

  const visible = useMemo(
    () => (filter === 'all' ? hits : hits.filter((h) => h.kind === filter)),
    [hits, filter],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setActive(0);
    setParams(query.trim() ? { q: query.trim() } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  /** Counts per kind, so the filter tabs are honest about what is there. */
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const hit of hits) map.set(hit.kind, (map.get(hit.kind) ?? 0) + 1);
    return map;
  }, [hits]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (visible.length === 0 ? 0 : (i + 1) % visible.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (visible.length === 0 ? 0 : (i - 1 + visible.length) % visible.length));
    } else if (event.key === 'Enter') {
      const hit = visible[active];
      if (hit) navigate(hit.route);
    }
  };

  return (
    <>
      <PageHeader title="Search" subtitle="Across tasks, goals, projects, notes, journal and more." />

      <Card style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 11 }}>
          <Icon name="search" size={18} color="var(--c-text-dim)" />
          <input
            ref={inputRef}
            className="grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search everything…"
            aria-label="Search everything"
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 'var(--fs-4xl)',
              color: 'var(--c-text)',
            }}
          />
          {searching ? <span className="btn-spinner" aria-label="Searching" /> : null}
        </div>
      </Card>

      {hits.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <Tabs
            label="Filter results by type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all' as Filter, label: `All ${hits.length}` },
              ...Array.from(counts.entries()).map(([kind, count]) => ({
                value: kind as Filter,
                label: `${kind} ${count}`,
              })),
            ]}
          />
        </div>
      ) : null}

      <Card flush>
        {!debounced.trim() ? (
          <EmptyState
            icon="search"
            title="Search your whole system"
            body="Titles and bodies across tasks, goals, projects, notes, journal entries, habits, quests and training sessions. Ctrl+K opens the same search from anywhere, with commands attached."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="search"
            title={`Nothing matches “${debounced.trim()}”`}
            body="Try a shorter word, or a different one. Search matches anywhere in a title or body, so a partial word usually works better than a full phrase."
          />
        ) : (
          <div
            className="list"
            role="listbox"
            aria-label={`${visible.length} result${visible.length === 1 ? '' : 's'}`}
          >
            {visible.map((hit, i) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                role="option"
                aria-selected={i === active}
                className="list-row list-row-button los-row"
                onMouseEnter={() => setActive(i)}
                onClick={() => navigate(hit.route)}
                style={{
                  background: i === active ? 'var(--c-fill-hover)' : undefined,
                  alignItems: 'flex-start',
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
                    background: 'var(--c-fill-ghost)',
                    border: '1px solid var(--c-border-faint)',
                    color: 'var(--c-text-dim)',
                  }}
                >
                  <Icon name={KIND_ICON[hit.kind]} size={13} />
                </span>

                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-title truncate">{hit.title}</div>
                  <div
                    className="row-meta"
                    style={{
                      whiteSpace: 'normal',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {hit.snippet}
                  </div>
                </div>

                <Badge color="var(--c-text-dim)">{hit.kind}</Badge>
              </button>
            ))}
          </div>
        )}
      </Card>

      {visible.length > 0 ? (
        <p
          className="mono"
          style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', marginTop: 12, textAlign: 'center' }}
        >
          ↑↓ navigate · ↵ open
        </p>
      ) : null}
    </>
  );
}
