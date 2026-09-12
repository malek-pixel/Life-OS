/**
 * Notes.
 *
 * UI/UX section 28's scope: create, edit, delete, archive, pin, tag, search and
 * link. Links are real references to goals, projects and tasks, so a note about
 * the SAT can be reached from the goal it belongs to rather than floating free.
 *
 * Autosave honours the `autosaveNotes` setting, and when it is off the unsaved
 * state is explicit and the tab warns before closing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconButton,
  PageHeader,
  SelectField,
  TextField,
} from '../../ui/primitives';
import { useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useCollection, useDebounced, useSelector, useSettings, useUnsavedGuard } from '../../app/hooks';
import { selectNotes } from '../../domain/selectors';
import { deleteNote, saveNote, toggleNoteArchived, toggleNotePinned } from '../../data/actions';
import { escapeRegExp } from '../../data/validation';
import type { Note } from '../../data/schema';
import { AppError } from '../../data/errors';

export default function NotesScreen() {
  const notes = useSelector(selectNotes);
  const goals = useCollection('goals');
  const projects = useCollection('projects');
  const settings = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const debouncedQuery = useDebounced(query, 150);

  const visible = useMemo(() => {
    const pool = notes.filter((n) => n.archived === showArchived);
    const q = debouncedQuery.trim();
    if (!q) return pool;
    const re = new RegExp(escapeRegExp(q), 'i');
    return pool.filter(
      (n) => re.test(n.title) || re.test(n.content) || n.tags.some((t) => re.test(t)),
    );
  }, [notes, debouncedQuery, showArchived]);

  const openId = params.get('open');
  const selected = useMemo(() => notes.find((n) => n.id === openId) ?? null, [notes, openId]);

  /* ---------- editor buffer ---------- */
  const [draft, setDraft] = useState(() => blank(null));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedKey = selected?.id ?? 'none';
  const loadedKey = useRef(selectedKey);
  useEffect(() => {
    if (loadedKey.current === selectedKey) return;
    loadedKey.current = selectedKey;
    setDraft(blank(selected));
    setDirty(false);
    setSavedAt(null);
    setError(null);
  }, [selectedKey, selected]);

  useUnsavedGuard(dirty);

  const save = async (options: { silent?: boolean } = {}) => {
    if (!draft.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveNote(draft.id, {
        title: draft.title,
        content: draft.content,
        folder: draft.folder,
        tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
        links: draft.links,
      });
      const newId = draft.id ?? result.createdIds[0] ?? null;
      setDraft((d) => ({ ...d, id: newId }));
      loadedKey.current = newId ?? 'none';
      if (newId && !openId) setParams({ open: newId });
      setDirty(false);
      setSavedAt(Date.now());
      if (!options.silent) toast.show('Note saved', { tone: 'ok' });
    } catch (err) {
      const message =
        err instanceof AppError ? err.message : 'The note could not be saved. Your text is still here.';
      setError(message);
      if (!options.silent) toast.showError(message);
    } finally {
      setSaving(false);
    }
  };

  const debouncedContent = useDebounced(draft.content + draft.title, 2000);
  useEffect(() => {
    if (!settings.autosaveNotes || !dirty || !draft.title.trim() || saving) return;
    void save({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedContent]);

  const startNew = () => {
    const proceed = () => {
      setParams({});
      loadedKey.current = 'none';
      setDraft(blank(null));
      setDirty(false);
      setSavedAt(null);
    };
    if (dirty) {
      confirm({
        title: 'Discard unsaved changes?',
        body: 'The note you are editing has changes that have not been saved.',
        actionLabel: 'Discard and start new',
        danger: true,
        onConfirm: proceed,
      });
    } else proceed();
  };

  const linkOptions = [
    ...goals.map((g) => ({ value: `goal:${g.id}`, label: `Goal · ${g.title}` })),
    ...projects.map((p) => ({ value: `project:${p.id}`, label: `Project · ${p.title}` })),
  ];

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle="The thinking that sits behind the work."
        actions={
          <Button variant="primary" icon="plus" onClick={startNew}>
            New note
          </Button>
        }
      />

      <div className="grid-2">
        {/* ================= list ================= */}
        <Card flush>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--c-border-faint)' }}>
            <div className="row" style={{ gap: 9 }}>
              <div className="grow">
                <label className="los-sr" htmlFor="note-search">
                  Search notes
                </label>
                <input
                  id="note-search"
                  className="input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notes…"
                />
              </div>
              <IconButton
                icon="archive"
                label={showArchived ? 'Show active notes' : 'Show archived notes'}
                active={showArchived}
                onClick={() => setShowArchived(!showArchived)}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon="notes"
              title={
                debouncedQuery.trim()
                  ? `Nothing matches “${debouncedQuery.trim()}”`
                  : showArchived
                    ? 'No archived notes'
                    : 'No notes yet'
              }
              body={
                debouncedQuery.trim()
                  ? 'Try a shorter or different word. Search covers titles, bodies and tags.'
                  : showArchived
                    ? 'Archived notes stay searchable but out of your main list.'
                    : 'Notes are where the reasoning lives — the distilled version of a book, the three angles for an essay, the thing you worked out once and do not want to work out again.'
              }
              action={
                !debouncedQuery.trim() && !showArchived ? (
                  <Button variant="primary" icon="plus" onClick={startNew}>
                    Write a note
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="list">
              {visible.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  active={note.id === draft.id}
                  onOpen={() => {
                    if (dirty) {
                      confirm({
                        title: 'Discard unsaved changes?',
                        body: 'The note you are editing has unsaved changes.',
                        actionLabel: 'Discard and switch',
                        danger: true,
                        onConfirm: () => {
                          setDirty(false);
                          setParams({ open: note.id });
                        },
                      });
                    } else setParams({ open: note.id });
                  }}
                  onPin={() => void toggleNotePinned(note.id)}
                  onArchive={async () => {
                    await toggleNoteArchived(note.id);
                    toast.show(note.archived ? 'Note restored' : 'Note archived', { tone: 'muted' });
                  }}
                  onDelete={() =>
                    confirm({
                      title: 'Delete this note?',
                      body: `"${note.title}" will be removed.`,
                      note: 'Archiving keeps it searchable instead, if you are not sure.',
                      actionLabel: 'Delete note',
                      danger: true,
                      onConfirm: async () => {
                        await deleteNote(note.id);
                        if (note.id === draft.id) startNew();
                        toast.show('Note deleted', { tone: 'muted' });
                      },
                    })
                  }
                />
              ))}
            </div>
          )}
        </Card>

        {/* ================= editor ================= */}
        <Card>
          <CardHeader
            kicker={draft.id ? 'EDITING' : 'NEW NOTE'}
            title={draft.title || 'Untitled note'}
            action={
              <div className="row" style={{ gap: 8 }}>
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
                  disabled={!dirty || draft.title.trim().length === 0}
                >
                  Save
                </Button>
              </div>
            }
          />

          {error ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 14 }}>
              <Icon name="alert" size={15} style={{ marginTop: 1 }} />
              <div className="grow">{error}</div>
            </div>
          ) : null}

          <div className="stack" style={{ gap: 12 }}>
            <TextField
              label="Title"
              required
              value={draft.title}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                setDirty(true);
              }}
              placeholder="F1 aero — ground effect notes"
            />

            <div className="field">
              <label className="field-label" htmlFor="note-body">
                Content
              </label>
              <textarea
                id="note-body"
                className="textarea"
                rows={13}
                value={draft.content}
                onChange={(e) => {
                  setDraft({ ...draft, content: e.target.value });
                  setDirty(true);
                }}
                style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.7 }}
              />
              <p className="field-hint">
                {settings.autosaveNotes
                  ? 'Autosaves shortly after you stop typing.'
                  : 'Autosave is off in Settings — save manually.'}
              </p>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 160px' }}>
                <TextField
                  label="Folder"
                  value={draft.folder}
                  onChange={(e) => {
                    setDraft({ ...draft, folder: e.target.value });
                    setDirty(true);
                  }}
                  placeholder="Education"
                />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <TextField
                  label="Tags"
                  value={draft.tags}
                  onChange={(e) => {
                    setDraft({ ...draft, tags: e.target.value });
                    setDirty(true);
                  }}
                  placeholder="f1, aero"
                  hint="Comma separated"
                />
              </div>
            </div>

            {linkOptions.length > 0 ? (
              <SelectField
                label="Link to"
                value=""
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value || draft.links.includes(value)) return;
                  setDraft({ ...draft, links: [...draft.links, value] });
                  setDirty(true);
                }}
                options={[{ value: '', label: 'Add a link…' }, ...linkOptions]}
                hint="Connects this note to a goal or project."
              />
            ) : null}

            {draft.links.length > 0 ? (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {draft.links.map((link) => {
                  const [kind, id] = link.split(':');
                  const label =
                    kind === 'goal'
                      ? goals.find((g) => g.id === id)?.title
                      : projects.find((p) => p.id === id)?.title;
                  return (
                    <span key={link} className="chip">
                      <Icon name={kind === 'goal' ? 'goals' : 'projects'} size={12} />
                      {label ?? 'Deleted item'}
                      <button
                        type="button"
                        aria-label={`Remove link to ${label ?? 'item'}`}
                        onClick={() => {
                          setDraft({ ...draft, links: draft.links.filter((l) => l !== link) });
                          setDirty(true);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

function NoteRow({
  note,
  active,
  onOpen,
  onPin,
  onArchive,
  onDelete,
}: {
  note: Note;
  active: boolean;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="list-row los-row"
      style={{
        background: active ? 'var(--c-accent-wash)' : undefined,
        borderLeft: `2px solid ${active ? 'var(--c-accent)' : 'transparent'}`,
        alignItems: 'flex-start',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grow"
        style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0 }}
      >
        <div className="row" style={{ gap: 7, marginBottom: 2 }}>
          {note.pinned ? <Icon name="pin" size={12} color="var(--c-accent-text)" /> : null}
          <span className="row-title truncate">{note.title}</span>
        </div>
        {note.content ? (
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
            {note.content}
          </div>
        ) : null}
        {note.tags.length > 0 || note.folder ? (
          <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
            {note.folder ? <Badge color="var(--c-text-dim)">{note.folder}</Badge> : null}
            {note.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} color="var(--c-ai-bright)" border="rgba(123,154,208,.35)">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </button>

      <div className="row" style={{ gap: 2, flex: 'none' }}>
        <IconButton
          icon="pin"
          label={note.pinned ? `Unpin "${note.title}"` : `Pin "${note.title}"`}
          size="sm"
          active={note.pinned}
          onClick={onPin}
        />
        <IconButton
          icon="archive"
          label={note.archived ? `Restore "${note.title}"` : `Archive "${note.title}"`}
          size="sm"
          onClick={onArchive}
        />
        <IconButton icon="trash" label={`Delete "${note.title}"`} size="sm" onClick={onDelete} />
      </div>
    </div>
  );
}

function blank(note: Note | null) {
  return {
    id: note?.id ?? null,
    title: note?.title ?? '',
    content: note?.content ?? '',
    folder: note?.folder ?? '',
    tags: note?.tags.join(', ') ?? '',
    links: note?.links ?? ([] as string[]),
  };
}
