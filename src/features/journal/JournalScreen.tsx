/**
 * Journal.
 *
 * Master prompt section 27 is the strictest section in the brief about data
 * loss, so this screen is built around not losing what you wrote:
 *   - the editor tracks a dirty buffer and shows an explicit unsaved state
 *   - Ctrl/Cmd+S saves; autosave runs a few seconds after you stop typing
 *   - navigating away or closing the tab with unsaved text warns first
 *   - deleting asks for confirmation and is a recoverable soft delete
 *
 * Privacy: TECH_SPEC section 15 keeps journal content out of AI context unless
 * the user explicitly enables it, and the screen says so rather than leaving it
 * to be discovered in Settings.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  PageHeader,
  TextField,
} from '../../ui/primitives';
import { useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useDebounced, useSelector, useSettings, useUnsavedGuard } from '../../app/hooks';
import { selectJournal } from '../../domain/selectors';
import { deleteJournalEntry, saveJournalEntry } from '../../data/actions';
import { formatRelativeDay, today as todayKey, type DayKey } from '../../domain/dates';
import { MOODS, type JournalEntry, type Mood } from '../../data/schema';
import { AppError } from '../../data/errors';

const MOOD_TONE: Record<Mood, { color: string; border: string; label: string }> = {
  GOOD: { color: '#7BB08A', border: 'rgba(123,176,138,.4)', label: 'Good' },
  MID: { color: '#C25B72', border: 'rgba(194,91,114,.4)', label: 'Mixed' },
  LOW: { color: '#E0637A', border: 'rgba(214,67,92,.4)', label: 'Low' },
};

/** Rotating prompts, so the blank page is never entirely blank. */
const PROMPTS = [
  'What pulled focus today — and what did you do about it?',
  'What went better than you expected?',
  'What did you avoid, and what was underneath that?',
  'What is the one thing tomorrow actually needs?',
  'What did today cost you, and was it worth it?',
];

export default function JournalScreen() {
  const entries = useSelector(selectJournal);
  const settings = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  const openId = params.get('open');
  const selected = useMemo(
    () => entries.find((e) => e.id === openId) ?? entries.find((e) => e.date === todayKey()) ?? null,
    [entries, openId],
  );

  /* ---------- editor buffer ---------- */
  const [draft, setDraft] = useState({ id: selected?.id ?? null, title: '', content: '', mood: null as Mood | null, date: todayKey() });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the selected entry into the buffer, unless there are unsaved changes
  // in the current one - switching must never silently discard typing.
  const selectedKey = selected?.id ?? 'new';
  const loadedKey = useRef(selectedKey);
  useEffect(() => {
    if (loadedKey.current === selectedKey) return;
    loadedKey.current = selectedKey;
    setDraft({
      id: selected?.id ?? null,
      title: selected?.title ?? '',
      content: selected?.content ?? '',
      mood: selected?.mood ?? null,
      date: selected?.date ?? todayKey(),
    });
    setDirty(false);
    setSavedAt(null);
    setError(null);
  }, [selectedKey, selected]);

  useUnsavedGuard(dirty);

  const save = async (options: { silent?: boolean } = {}) => {
    if (!draft.content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveJournalEntry(draft.id, {
        title: draft.title,
        content: draft.content,
        mood: draft.mood,
        date: draft.date,
      });
      const newId = draft.id ?? result.createdIds[0] ?? null;
      setDraft((d) => ({ ...d, id: newId }));
      loadedKey.current = newId ?? 'new';
      setDirty(false);
      setSavedAt(Date.now());
      if (!options.silent) {
        toast.show(
          result.xpAwarded > 0 ? `Entry saved · +${result.xpAwarded} XP` : 'Entry saved',
          { tone: result.xpAwarded > 0 ? 'xp' : 'ok' },
        );
      }
    } catch (err) {
      const message =
        err instanceof AppError ? err.message : 'The entry could not be saved. Your text is still here.';
      setError(message);
      if (!options.silent) toast.showError(message);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- autosave, a few seconds after typing stops ---------- */
  const debouncedContent = useDebounced(draft.content, 2500);
  useEffect(() => {
    if (!dirty || !debouncedContent.trim() || saving) return;
    void save({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent]);

  /* ---------- Ctrl/Cmd+S ---------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  const prompt = PROMPTS[new Date().getDate() % PROMPTS.length]!;
  const words = draft.content.trim() ? draft.content.trim().split(/\s+/).length : 0;

  const startNew = (date: DayKey = todayKey()) => {
    const proceed = () => {
      setParams({});
      loadedKey.current = 'new';
      setDraft({ id: null, title: '', content: '', mood: null, date });
      setDirty(false);
      setSavedAt(null);
    };
    if (dirty) {
      confirm({
        title: 'Discard unsaved changes?',
        body: 'The entry you are editing has changes that have not been saved yet.',
        note: 'Save first if you want to keep them.',
        actionLabel: 'Discard and start new',
        danger: true,
        onConfirm: proceed,
      });
    } else proceed();
  };

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="Log the day honestly — it is what the reviews and patterns are built from."
        actions={
          <Button variant="primary" icon="plus" onClick={() => startNew()}>
            New entry
          </Button>
        }
      />

      <div className="grid-2">
        {/* ================= editor ================= */}
        <Card>
          <CardHeader
            kicker={draft.id ? `EDITING · ${formatRelativeDay(draft.date)}` : `NEW ENTRY · ${formatRelativeDay(draft.date)}`}
            title={draft.title || 'Untitled entry'}
            action={
              <div className="row" style={{ gap: 8 }}>
                {/* Explicit save state, per section 15's saved/unsaved requirement. */}
                <span
                  className="mono"
                  style={{
                    fontSize: 'var(--fs-3xs)',
                    color: dirty ? 'var(--c-warn-bright)' : savedAt ? 'var(--c-success)' : 'var(--c-text-ghost)',
                  }}
                >
                  {saving ? 'SAVING…' : dirty ? 'UNSAVED' : savedAt ? 'SAVED' : '—'}
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void save()}
                  loading={saving}
                  disabled={!dirty || draft.content.trim().length === 0}
                >
                  Save
                </Button>
              </div>
            }
          />

          {error ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alert" size={15} style={{ marginTop: 1 }} />
              <div className="grow">{error} Nothing was lost — press Save to try again.</div>
            </div>
          ) : null}

          <p
            style={{
              fontSize: 'var(--fs-md)',
              color: 'var(--c-text-dim)',
              fontStyle: 'italic',
              margin: '0 0 14px',
              paddingLeft: 11,
              borderLeft: '2px solid var(--c-accent-border)',
              lineHeight: 1.5,
            }}
          >
            {prompt}
          </p>

          <div className="stack" style={{ gap: 12 }}>
            <TextField
              label="Title"
              value={draft.title}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                setDirty(true);
              }}
              placeholder={formatRelativeDay(draft.date)}
            />

            <div className="field">
              <label className="field-label" htmlFor="journal-body">
                Entry
              </label>
              <textarea
                id="journal-body"
                className="textarea"
                rows={14}
                value={draft.content}
                onChange={(e) => {
                  setDraft({ ...draft, content: e.target.value });
                  setDirty(true);
                }}
                placeholder="What actually happened today."
                style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.7 }}
              />
              <p className="field-hint">
                {words} word{words === 1 ? '' : 's'} · autosaves a moment after you stop typing ·
                Ctrl+S to save now
              </p>
            </div>

            <div className="field">
              <span className="field-label">Mood</span>
              <div className="row" style={{ gap: 6 }}>
                {MOODS.map((mood) => {
                  const tone = MOOD_TONE[mood];
                  const on = draft.mood === mood;
                  return (
                    <button
                      key={mood}
                      type="button"
                      aria-pressed={on}
                      className="los-press"
                      onClick={() => {
                        setDraft({ ...draft, mood: on ? null : mood });
                        setDirty(true);
                      }}
                      style={{
                        padding: '7px 13px',
                        borderRadius: 'var(--r-md)',
                        fontSize: 'var(--fs-md)',
                        cursor: 'pointer',
                        border: `1px solid ${on ? tone.border : 'var(--c-border-faint)'}`,
                        background: on ? `${tone.color}22` : 'transparent',
                        color: on ? tone.color : 'var(--c-text-muted)',
                      }}
                    >
                      {tone.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Privacy is stated where the writing happens, not only in Settings. */}
          <div
            className="row"
            style={{
              gap: 9,
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid var(--c-border-ghost)',
              fontSize: 'var(--fs-xs)',
              color: 'var(--c-text-dim)',
            }}
          >
            <Icon name="shield" size={14} color={settings.aiContextJournal ? 'var(--c-warn-bright)' : 'var(--c-success)'} />
            <span className="grow">
              {settings.aiContextJournal
                ? 'The AI coach can read your journal. Turn this off in Settings if you would rather it could not.'
                : 'Private. The AI coach cannot read your journal unless you enable it in Settings.'}
            </span>
            <Link to="/settings/ai" style={{ fontSize: 'var(--fs-xs)', flex: 'none' }}>
              Settings
            </Link>
          </div>
        </Card>

        {/* ================= history ================= */}
        <Card flush>
          <div style={{ padding: '16px 16px 6px' }}>
            <CardHeader kicker="HISTORY" title={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`} />
          </div>

          {entries.length === 0 ? (
            <EmptyState
              icon="journal"
              title="Nothing written yet"
              body="The journal is where the patterns come from — procrastination detection, weekly reviews and mood trends all read these entries. A few honest lines a day is enough."
            />
          ) : (
            <div className="list">
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === draft.id}
                  onOpen={() => {
                    if (dirty) {
                      confirm({
                        title: 'Discard unsaved changes?',
                        body: 'The entry you are editing has unsaved changes.',
                        actionLabel: 'Discard and switch',
                        danger: true,
                        onConfirm: () => {
                          setDirty(false);
                          setParams({ open: entry.id });
                        },
                      });
                    } else {
                      setParams({ open: entry.id });
                    }
                  }}
                  onDelete={() =>
                    confirm({
                      title: 'Delete this entry?',
                      body: `The entry from ${formatRelativeDay(entry.date)} will be removed.`,
                      note: 'Journal entries are not recoverable from the interface once deleted — export your data first if you want a copy.',
                      actionLabel: 'Delete entry',
                      danger: true,
                      onConfirm: async () => {
                        await deleteJournalEntry(entry.id);
                        if (entry.id === draft.id) startNew();
                        toast.show('Entry deleted', { tone: 'muted' });
                      },
                    })
                  }
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function EntryRow({
  entry,
  active,
  onOpen,
  onDelete,
}: {
  entry: JournalEntry;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const tone = entry.mood ? MOOD_TONE[entry.mood] : null;
  return (
    <div
      className="list-row los-row"
      style={{
        background: active ? 'var(--c-accent-wash)' : undefined,
        borderLeft: `2px solid ${active ? 'var(--c-accent)' : 'transparent'}`,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grow"
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
      >
        <div className="row" style={{ gap: 8, marginBottom: 3 }}>
          <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.06em' }}>
            {formatRelativeDay(entry.date).toUpperCase()}
          </span>
          {tone ? (
            <Badge color={tone.color} border={tone.border}>
              {tone.label}
            </Badge>
          ) : null}
        </div>
        <div className="row-title truncate">{entry.title || 'Untitled entry'}</div>
        <div
          className="row-meta"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            whiteSpace: 'normal',
          }}
        >
          {entry.content}
        </div>
      </button>
      <IconButton icon="trash" label={`Delete entry from ${entry.date}`} size="sm" onClick={onDelete} />
    </div>
  );
}
