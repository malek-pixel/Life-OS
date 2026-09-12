/**
 * Global quick capture (Ctrl/Cmd+N).
 *
 * Master prompt section 39: this creates real persisted entities, and the user
 * must understand what kind of thing is being created. So the type selector is
 * always visible and the form changes with it - it is never an ambiguous "add
 * something" box that guesses.
 *
 * Fields are kept to the minimum needed to create a valid row (section 49:
 * avoid excessive form fields). Everything else is edited on the entity's own
 * screen afterwards.
 */

import { useEffect, useState } from 'react';

import { Modal, useToast } from '../ui/overlays';
import { Button, SelectField, TextAreaField, TextField, cx } from '../ui/primitives';
import { Icon, type IconName } from '../ui/Icon';
import { useAction, useCollection } from './hooks';
import {
  createGoal,
  createHabit,
  createProject,
  createTask,
  logWorkout,
  saveJournalEntry,
  saveNote,
} from '../data/actions';
import { LIFE_AREAS, PRIORITIES, WORKOUT_DISCIPLINES } from '../data/schema';
import { AppError } from '../data/errors';

type CaptureType = 'Task' | 'Goal' | 'Project' | 'Habit' | 'Note' | 'Journal' | 'Workout';

const TYPES: Array<{ type: CaptureType; icon: IconName }> = [
  { type: 'Task', icon: 'tasks' },
  { type: 'Goal', icon: 'goals' },
  { type: 'Project', icon: 'projects' },
  { type: 'Habit', icon: 'habits' },
  { type: 'Note', icon: 'notes' },
  { type: 'Journal', icon: 'journal' },
  { type: 'Workout', icon: 'fitness' },
];

export function QuickCapture({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const projects = useCollection('projects');
  const goals = useCollection('goals');

  const [type, setType] = useState<CaptureType>('Task');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [area, setArea] = useState<string>('Other');
  const [priority, setPriority] = useState<string>('MEDIUM');
  const [dueAt, setDueAt] = useState('');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [discipline, setDiscipline] = useState<string>('Gym');
  const [duration, setDuration] = useState('45');

  // A fresh form each time it opens; a stale half-typed capture is confusing.
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setDueAt('');
    setProjectId('');
    setGoalId('');
    setPriority('MEDIUM');
    setArea('Other');
    setDiscipline('Gym');
    setDuration('45');
  }, [open]);

  const submit = useAction(async () => {
    const trimmed = title.trim();
    switch (type) {
      case 'Task':
        return createTask({
          title: trimmed,
          description: body,
          priority,
          dueAt: dueAt ? new Date(dueAt).getTime() : null,
          projectId: projectId || null,
          goalId: goalId || null,
        });
      case 'Goal':
        return createGoal({ title: trimmed, description: body, area, targetDate: dueAt ? new Date(dueAt).getTime() : null });
      case 'Project':
        return createProject({ title: trimmed, description: body, area, goalId: goalId || null, deadline: dueAt ? new Date(dueAt).getTime() : null });
      case 'Habit':
        return createHabit({ title: trimmed, description: body, area, identity: '' });
      case 'Note':
        return saveNote(null, { title: trimmed, content: body });
      case 'Journal':
        return saveJournalEntry(null, { title: trimmed, content: body || trimmed });
      case 'Workout':
        return logWorkout({
          title: trimmed,
          discipline,
          durationMinutes: Number(duration) || 0,
          notes: body,
        });
      default:
        return undefined;
    }
  });

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  const run = async () => {
    const result = await submit.run();
    if (!result) return;
    const xp = 'xpAwarded' in result ? result.xpAwarded : 0;
    toast.show(
      xp > 0 ? `${type} captured · +${xp} XP` : `${type} captured`,
      { tone: xp > 0 ? 'xp' : 'ok' },
    );
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick capture"
      description="Get it out of your head and into the system. You can fill in the rest later."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={run}
            loading={submit.pending}
            disabled={title.trim().length === 0}
          >
            Create {type.toLowerCase()}
          </Button>
        </>
      }
    >
      {/* --- what kind of thing --- */}
      <div>
        <p className="card-kicker">Type</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {TYPES.map((entry) => (
            <button
              key={entry.type}
              type="button"
              onClick={() => setType(entry.type)}
              className="los-press"
              aria-pressed={type === entry.type}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 11px',
                borderRadius: 'var(--r-md)',
                fontSize: 'var(--fs-md)',
                cursor: 'pointer',
                border: `1px solid ${type === entry.type ? 'var(--c-accent-border-strong)' : 'var(--c-border-faint)'}`,
                background: type === entry.type ? 'var(--c-accent-wash-strong)' : 'transparent',
                color: type === entry.type ? 'var(--c-text)' : 'var(--c-text-muted)',
              }}
            >
              <Icon name={entry.icon} size={14} />
              {entry.type}
            </button>
          ))}
        </div>
      </div>

      {submit.error && Object.keys(fieldErrors).length === 0 ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={15} style={{ marginTop: 1 }} />
          <div className="grow">{submit.error.message}</div>
        </div>
      ) : null}

      <TextField
        label={type === 'Journal' ? 'Entry title' : 'Title'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholderFor(type)}
        required
        error={fieldErrors.title}
        autoFocus
        onKeyDown={(e) => {
          // Enter submits from the title field - capture should be one keystroke away.
          if (e.key === 'Enter' && title.trim() && !submit.pending) {
            e.preventDefault();
            void run();
          }
        }}
      />

      <TextAreaField
        label={type === 'Journal' ? 'What happened' : 'Details'}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Optional"
        rows={type === 'Journal' ? 6 : 3}
        error={fieldErrors.content ?? fieldErrors.description}
      />

      {/* --- type-specific fields --- */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {type === 'Task' ? (
          <>
            <div style={{ flex: '1 1 150px' }}>
              <SelectField
                label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                options={PRIORITIES.map((p) => ({ value: p, label: titleCase(p) }))}
              />
            </div>
            <div style={{ flex: '1 1 170px' }}>
              <TextField
                label="Due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                error={fieldErrors.dueAt}
              />
            </div>
            {projects.length > 0 ? (
              <div style={{ flex: '1 1 180px' }}>
                <SelectField
                  label="Project"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  options={[
                    { value: '', label: 'None' },
                    ...projects.map((p) => ({ value: p.id, label: p.title })),
                  ]}
                />
              </div>
            ) : null}
          </>
        ) : null}

        {type === 'Goal' || type === 'Project' || type === 'Habit' ? (
          <div style={{ flex: '1 1 170px' }}>
            <SelectField
              label="Life area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
            />
          </div>
        ) : null}

        {type === 'Goal' ? (
          <div style={{ flex: '1 1 170px' }}>
            <TextField
              label="Target date"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              error={fieldErrors.targetDate}
            />
          </div>
        ) : null}

        {type === 'Project' && goals.length > 0 ? (
          <div style={{ flex: '1 1 180px' }}>
            <SelectField
              label="Goal"
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              options={[
                { value: '', label: 'None' },
                ...goals.map((g) => ({ value: g.id, label: g.title })),
              ]}
            />
          </div>
        ) : null}

        {type === 'Workout' ? (
          <>
            <div style={{ flex: '1 1 170px' }}>
              <SelectField
                label="Discipline"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
                options={WORKOUT_DISCIPLINES.map((d) => ({ value: d, label: d }))}
              />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <TextField
                label="Duration (min)"
                type="number"
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                error={fieldErrors.durationMinutes}
              />
            </div>
          </>
        ) : null}
      </div>

      <p className={cx('field-hint')} style={{ marginTop: -4 }}>
        {hintFor(type)}
      </p>
    </Modal>
  );
}

function placeholderFor(type: CaptureType): string {
  switch (type) {
    case 'Task':
      return 'Draft the Michigan essay opening';
    case 'Goal':
      return 'Score 1550+ on the SAT';
    case 'Project':
      return 'F1 data project';
    case 'Habit':
      return 'Read 20 minutes';
    case 'Note':
      return 'F1 aero — ground effect notes';
    case 'Journal':
      return 'Today';
    default:
      return 'Push day — chest & shoulders';
  }
}

function hintFor(type: CaptureType): string {
  switch (type) {
    case 'Task':
      return 'Completing this later awards XP based on its priority and estimate.';
    case 'Goal':
      return 'Progress rolls up automatically from the projects and tasks you link to it.';
    case 'Project':
      return 'Add milestones and tasks on the project page to start tracking progress.';
    case 'Habit':
      return 'Daily by default. Change the schedule and identity on the habits page.';
    case 'Journal':
      return 'Journal entries stay private from the AI unless you turn that on in Settings.';
    case 'Workout':
      return 'Add exercises and sets on the fitness page to track volume and records.';
    default:
      return 'Notes are searchable from the command palette straight away.';
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
