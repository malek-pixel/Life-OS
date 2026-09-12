/**
 * Quests.
 *
 * Master prompt section 30: each quest must have real requirements, progress,
 * state, reward and completion - no meaningless gamification. So:
 *   - a quest cannot be created without at least one requirement (enforced in
 *     the action layer, not just here)
 *   - progress is the fraction of requirements actually met, and each one shows
 *     its own measured value
 *   - requirements can be tied to live data (task counts, habit streaks,
 *     milestones, sessions) so they tick over on their own
 *   - the reward is only paid once every requirement is genuinely met
 */

import { useState } from 'react';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  PageHeader,
  ProgressBar,
  SelectField,
  Tabs,
  TextAreaField,
  TextField,
} from '../../ui/primitives';
import { Modal, useConfirm, useToast } from '../../ui/overlays';
import { Icon } from '../../ui/Icon';
import { useAction, useCollection, useSelector } from '../../app/hooks';
import { areaHex, selectQuests, type QuestView } from '../../domain/selectors';
import { completeQuest, createQuest, deleteQuest, toggleQuestRequirement } from '../../data/actions';
import { LIFE_AREAS, QUEST_TYPES } from '../../data/schema';
import { AppError } from '../../data/errors';

type Filter = 'active' | 'completed';

export default function QuestsScreen() {
  const quests = useSelector(selectQuests);
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);

  const visible = quests.filter((q) =>
    filter === 'completed' ? q.quest.status === 'COMPLETED' : q.quest.status !== 'COMPLETED',
  );

  return (
    <>
      <PageHeader
        title="Quests"
        subtitle="Bigger than a task, more concrete than a goal."
        actions={
          <>
            <Tabs
              label="Quest filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'completed', label: 'Complete' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New quest
            </Button>
          </>
        }
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon="quests"
            title={filter === 'active' ? 'No active quests' : 'None completed yet'}
            body={
              filter === 'active'
                ? 'A quest is a named challenge with requirements you can actually check off — "1550+ across three practice tests", not "get better at the SAT". Requirements can track your real data, so most of a quest fills itself in as you work.'
                : 'Completed quests and the XP they paid out will be listed here.'
            }
            action={
              filter === 'active' ? (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  Create a quest
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid-cards los-stagger">
          {visible.map((view) => (
            <QuestCard key={view.quest.id} view={view} />
          ))}
        </div>
      )}

      <QuestEditor open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function QuestCard({ view }: { view: QuestView }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { quest } = view;
  const color = areaHex(quest.area);
  const complete = quest.status === 'COMPLETED';
  const allMet = view.total > 0 && view.met === view.total;

  return (
    <Card>
      <div className="spread" style={{ marginBottom: 10, alignItems: 'flex-start', gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <Badge color="var(--c-accent-text)" border="var(--c-accent-border)">
            {quest.type}
          </Badge>
          <Badge color={color} border={`${color}59`}>
            {quest.area}
          </Badge>
          {complete ? (
            <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
              Complete
            </Badge>
          ) : null}
        </div>
        <IconButton
          icon="trash"
          label={`Delete quest "${quest.title}"`}
          size="sm"
          onClick={() =>
            confirm({
              title: 'Delete this quest?',
              body: `"${quest.title}" and its requirements will be removed.`,
              actionLabel: 'Delete quest',
              danger: true,
              onConfirm: async () => {
                await deleteQuest(quest.id);
                toast.show('Quest deleted', { tone: 'muted' });
              },
            })
          }
        />
      </div>

      <h3 style={{ fontSize: 'var(--fs-4xl)', fontWeight: 600, margin: '0 0 5px', lineHeight: 1.3 }}>
        {quest.title}
      </h3>
      {quest.objective ? (
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 14px', lineHeight: 1.55 }}>
          {quest.objective}
        </p>
      ) : (
        <div style={{ height: 10 }} />
      )}

      <div className="spread" style={{ marginBottom: 6, gap: 8 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)', letterSpacing: '.08em' }}>
          {view.met} / {view.total} REQUIREMENTS
        </span>
        <span className="mono" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, flex: 'none' }}>
          {view.percent}%
        </span>
      </div>
      <ProgressBar
        percent={view.percent}
        color={color}
        label={`${quest.title}: ${view.met} of ${view.total} requirements met`}
      />

      {/* --- the requirements themselves, each with its measured value --- */}
      <div className="stack" style={{ gap: 0, marginTop: 14 }}>
        {view.requirements.map(({ requirement, met, label }) => (
          <div
            key={requirement.id}
            className="row"
            style={{ gap: 9, padding: '7px 0', borderBottom: '1px solid var(--c-border-ghost)' }}
          >
            {requirement.kind === 'MANUAL' && !complete ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={met}
                aria-label={`${met ? 'Unmark' : 'Mark'} "${requirement.label}"`}
                className={`checkbox${met ? ' checkbox-on' : ''}`}
                style={{ width: 16, height: 16 }}
                onClick={() => void toggleQuestRequirement(requirement.id)}
              >
                {met ? <Icon name="check" size={10} strokeWidth={3} /> : null}
              </button>
            ) : (
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: met ? color : 'var(--c-fill)',
                  color: 'var(--c-text)',
                }}
              >
                {met ? <Icon name="check" size={10} strokeWidth={3} /> : null}
              </span>
            )}
            <span
              className="grow truncate"
              style={{
                fontSize: 'var(--fs-md)',
                color: met ? 'var(--c-text-faint)' : 'var(--c-text-strong)',
              }}
            >
              {requirement.label}
            </span>
            <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)', flex: 'none' }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="spread" style={{ marginTop: 14, gap: 10 }}>
        <span className="mono" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-accent-text)' }}>
          +{quest.xpReward} XP
        </span>
        {!complete ? (
          <Button
            size="sm"
            variant={allMet ? 'primary' : 'secondary'}
            disabled={!allMet}
            title={allMet ? undefined : 'Every requirement has to be met first'}
            onClick={async () => {
              const result = await completeQuest(quest.id);
              toast.show(`Quest complete · +${result.xpAwarded} XP`, { tone: 'xp' });
            }}
          >
            {allMet ? 'Claim reward' : `${view.total - view.met} left`}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/* ================================================================== *
 * Editor
 * ================================================================== */

interface RequirementRow {
  label: string;
  kind: string;
  target: string;
  refId: string;
}

function QuestEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const goals = useCollection('goals');
  const habits = useCollection('habits');
  const projects = useCollection('projects');

  const [form, setForm] = useState(blank);
  const [requirements, setRequirements] = useState<RequirementRow[]>([blankRequirement()]);

  const key = String(open);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(blank());
    setRequirements([blankRequirement()]);
  }

  const submit = useAction(() =>
    createQuest({
      title: form.title,
      objective: form.objective,
      type: form.type,
      area: form.area,
      goalId: form.goalId || null,
      xpReward: Number(form.xpReward) || 0,
      requirements: requirements
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label,
          kind: r.kind,
          target: Number(r.target) || 1,
          refId: r.refId || null,
        })),
    }),
  );

  const fieldErrors = submit.error instanceof AppError ? (submit.error.fields ?? {}) : {};

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="New quest"
      description="Requirements are what make a quest real. Tie them to your data and they track themselves."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              const result = await submit.run();
              if (!result) return;
              toast.show('Quest created', { tone: 'ok' });
              onClose();
            }}
            loading={submit.pending}
            disabled={form.title.trim().length === 0 || requirements.every((r) => !r.label.trim())}
          >
            Create quest
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
        label="Quest"
        required
        autoFocus
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        error={fieldErrors.title}
        placeholder="SAT Summit"
      />

      <TextAreaField
        label="Objective"
        rows={2}
        value={form.objective}
        onChange={(e) => setForm({ ...form, objective: e.target.value })}
        error={fieldErrors.objective}
        placeholder="Hit 1550+ across three full practice tests"
      />

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 140px' }}>
          <SelectField
            label="Type"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            options={QUEST_TYPES.map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() }))}
          />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <SelectField
            label="Life area"
            value={form.area}
            onChange={(e) => setForm({ ...form, area: e.target.value })}
            options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
          />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <TextField
            label="XP reward"
            type="number"
            min={0}
            value={form.xpReward}
            onChange={(e) => setForm({ ...form, xpReward: e.target.value })}
            error={fieldErrors.xpReward}
          />
        </div>
      </div>

      {goals.length > 0 ? (
        <SelectField
          label="Goal"
          value={form.goalId}
          onChange={(e) => setForm({ ...form, goalId: e.target.value })}
          options={[{ value: '', label: 'Not linked' }, ...goals.map((g) => ({ value: g.id, label: g.title }))]}
          error={fieldErrors.goalId}
        />
      ) : null}

      {/* ---------- requirements ---------- */}
      <div>
        <div className="spread" style={{ marginBottom: 8 }}>
          <p className="card-kicker" style={{ margin: 0 }}>
            REQUIREMENTS
          </p>
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            onClick={() => setRequirements([...requirements, blankRequirement()])}
          >
            Add
          </Button>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {requirements.map((row, i) => (
            <div className="stack" key={i} style={{ gap: 7 }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div className="grow">
                  <label className="los-sr" htmlFor={`req-label-${i}`}>
                    Requirement {i + 1}
                  </label>
                  <input
                    id={`req-label-${i}`}
                    className="input"
                    value={row.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder="Three practice tests above 1500"
                  />
                </div>
                <IconButton
                  icon="close"
                  label={`Remove requirement ${i + 1}`}
                  onClick={() => setRequirements(requirements.filter((_, j) => j !== i))}
                  disabled={requirements.length === 1}
                />
              </div>

              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <select
                  className="select"
                  aria-label={`How requirement ${i + 1} is measured`}
                  value={row.kind}
                  onChange={(e) => update(i, { kind: e.target.value, refId: '' })}
                  style={{ flex: '1 1 190px' }}
                >
                  <option value="MANUAL">I tick it off myself</option>
                  <option value="TASK_COUNT">Count completed tasks</option>
                  <option value="MILESTONE">Count completed milestones</option>
                  <option value="WORKOUT_COUNT">Count training sessions</option>
                  <option value="HABIT_STREAK">Reach a habit streak</option>
                </select>

                {row.kind !== 'MANUAL' ? (
                  <input
                    className="input"
                    type="number"
                    min={1}
                    aria-label={`Target for requirement ${i + 1}`}
                    value={row.target}
                    onChange={(e) => update(i, { target: e.target.value })}
                    style={{ flex: '0 1 90px' }}
                    placeholder="Target"
                  />
                ) : null}

                {row.kind === 'HABIT_STREAK' && habits.length > 0 ? (
                  <select
                    className="select"
                    aria-label={`Habit for requirement ${i + 1}`}
                    value={row.refId}
                    onChange={(e) => update(i, { refId: e.target.value })}
                    style={{ flex: '1 1 170px' }}
                  >
                    <option value="">Pick a habit…</option>
                    {habits.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.title}
                      </option>
                    ))}
                  </select>
                ) : null}

                {(row.kind === 'TASK_COUNT' || row.kind === 'MILESTONE') && projects.length > 0 ? (
                  <select
                    className="select"
                    aria-label={`Project scope for requirement ${i + 1}`}
                    value={row.refId}
                    onChange={(e) => update(i, { refId: e.target.value })}
                    style={{ flex: '1 1 170px' }}
                  >
                    <option value="">Any project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {fieldErrors.requirements ? (
          <p className="field-error" role="alert" style={{ marginTop: 8 }}>
            <Icon name="alert" size={12} />
            {fieldErrors.requirements}
          </p>
        ) : (
          <p className="field-hint" style={{ marginTop: 8 }}>
            Tracked requirements read your real data and update on their own. Manual ones are for the
            things Life OS cannot see.
          </p>
        )}
      </div>
    </Modal>
  );

  function update(index: number, patch: Partial<RequirementRow>) {
    setRequirements(requirements.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
}

function blank() {
  return {
    title: '',
    objective: '',
    type: 'SIDE',
    area: 'Other',
    goalId: '',
    xpReward: '250',
  };
}

function blankRequirement(): RequirementRow {
  return { label: '', kind: 'MANUAL', target: '1', refId: '' };
}
