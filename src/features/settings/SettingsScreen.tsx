/**
 * Settings.
 *
 * The design's settings sections, reproduced with two deliberate changes,
 * documented in docs/DECISIONS.md:
 *
 *  - The Account section's "Sign out" is removed. Life OS has no auth by
 *    design (Development Master section 12), so a sign-out button would be a
 *    dead control, which master prompt section 14 forbids.
 *  - "Member since" comes from the real settings row creation date rather than
 *    a fixed string.
 *
 * Every toggle here changes real application behaviour and persists — none is
 * decorative. The ones that do nothing yet are simply not shown.
 */

import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Badge,
  Button,
  Card,
  PageHeader,
  SelectField,
  TextField,
  Toggle,
} from '../../ui/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { useConfirm, useToast } from '../../ui/overlays';
import { useCharacter, useSelector, useSettings } from '../../app/hooks';
import { rebuildCharacterState, updateSettings } from '../../data/actions';
import { store } from '../../data/store';
import {
  applyImport,
  downloadCsv,
  downloadExport,
  exportSizeLabel,
  parseImport,
  type ImportPreview,
} from '../../data/portability';
import { AI_MODELS, clearApiKey, getKeyScope, maskedKey, setApiKey, type KeyScope } from '../../ai/provider';
import { callsToday } from '../../ai/coach';
import { levelForXp } from '../../domain/xp';
import { formatMonthDay, toDayKey } from '../../domain/dates';
import { AppError } from '../../data/errors';
import type { Settings } from '../../data/schema';

type SectionId =
  | 'account'
  | 'appearance'
  | 'navigation'
  | 'notifications'
  | 'ai'
  | 'data'
  | 'shortcuts'
  | 'accessibility'
  | 'about';

const SECTIONS: Array<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'account', label: 'Account', icon: 'dashboard' },
  { id: 'appearance', label: 'Appearance', icon: 'sparkle' },
  { id: 'navigation', label: 'Navigation', icon: 'chevronRight' },
  { id: 'notifications', label: 'Notifications', icon: 'alert' },
  { id: 'ai', label: 'AI & Privacy', icon: 'shield' },
  { id: 'data', label: 'Data', icon: 'download' },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'filter' },
  { id: 'accessibility', label: 'Accessibility', icon: 'info' },
  { id: 'about', label: 'About', icon: 'info' },
];

/** Accent choices, from the design's accent prop. */
const ACCENTS = ['#9E304A', '#4C6FAE', '#B5566B', '#7B9AD0'];

export default function SettingsScreen() {
  const { section = 'account' } = useParams<{ section: SectionId }>();
  const navigate = useNavigate();
  const active = (SECTIONS.some((s) => s.id === section) ? section : 'account') as SectionId;

  return (
    <>
      <PageHeader title="Settings" subtitle="Everything here changes how Life OS actually behaves." />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,210px) minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
        <nav aria-label="Settings sections" className="card" style={{ padding: 8 }}>
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => navigate(`/settings/${entry.id}`)}
              aria-current={entry.id === active ? 'page' : undefined}
              className="los-press"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--r-xl)',
                marginBottom: 2,
                fontSize: 'var(--fs-md)',
                cursor: 'pointer',
                textAlign: 'left',
                border: 'none',
                borderLeft: `2px solid ${entry.id === active ? 'var(--c-accent)' : 'transparent'}`,
                background: entry.id === active ? 'var(--c-accent-wash)' : 'transparent',
                color: entry.id === active ? 'var(--c-text)' : 'var(--c-text-muted)',
              }}
            >
              <Icon name={entry.icon} size={14} />
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="stack" style={{ gap: 16 }}>
          <SectionBody section={active} />
        </div>
      </div>
    </>
  );
}

function SectionBody({ section }: { section: SectionId }) {
  switch (section) {
    case 'appearance':
      return <AppearanceSection />;
    case 'navigation':
      return <NavigationSection />;
    case 'notifications':
      return <NotificationsSection />;
    case 'ai':
      return <AiSection />;
    case 'data':
      return <DataSection />;
    case 'shortcuts':
      return <ShortcutsSection />;
    case 'accessibility':
      return <AccessibilitySection />;
    case 'about':
      return <AboutSection />;
    default:
      return <AccountSection />;
  }
}

/* ================================================================== *
 * Shared rows
 * ================================================================== */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <p className="card-kicker">{title}</p>
      <div className="stack" style={{ gap: 0 }}>
        {children}
      </div>
    </Card>
  );
}

function Row({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div
      className="spread"
      style={{ padding: '13px 0', borderBottom: '1px solid var(--c-border-ghost)', gap: 16, alignItems: 'flex-start' }}
    >
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-lg)', color: 'var(--c-text-strong)' }}>{label}</div>
        {description ? (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', marginTop: 3, lineHeight: 1.5 }}>
            {description}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 'none' }}>{control}</div>
    </div>
  );
}

/** A toggle bound straight to a settings field, with a saved flash. */
function SettingToggle({
  field,
  label,
  description,
}: {
  field: keyof Settings;
  label: string;
  description?: string;
}) {
  const settings = useSettings();
  const [flash, setFlash] = useState(false);
  const value = Boolean(settings[field]);

  return (
    <Row
      label={label}
      description={description}
      control={
        <div className="row" style={{ gap: 9 }}>
          {flash ? (
            <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-success)' }}>
              SAVED
            </span>
          ) : null}
          <Toggle
            checked={value}
            label={label}
            onChange={async () => {
              await updateSettings({ [field]: !value } as Partial<Settings>);
              setFlash(true);
              setTimeout(() => setFlash(false), 1400);
            }}
          />
        </div>
      }
    />
  );
}

/* ================================================================== *
 * Sections
 * ================================================================== */

function AccountSection() {
  const settings = useSettings();
  const character = useCharacter();
  const progression = levelForXp(character.totalXp);
  const [name, setName] = useState(settings.displayName);
  const toast = useToast();

  return (
    <>
      <Group title="PROFILE">
        <Row
          label="Display name"
          description="Used in the greeting and the sidebar."
          control={
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Display name"
                style={{ width: 180 }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={name === settings.displayName}
                onClick={async () => {
                  await updateSettings({ displayName: name.trim() });
                  toast.show('Name saved', { tone: 'ok' });
                }}
              >
                Save
              </Button>
            </div>
          }
        />
        <Row
          label="Rank"
          description="Earned from your XP history. Hidden if rank badges are off."
          control={
            <Badge color="var(--c-accent-text)" border="var(--c-accent-border)">
              {settings.showRankBadges
                ? character.totalXp > 0
                  ? `${progression.rank.title} · Lv ${progression.level}`
                  : 'No rank yet'
                : 'Hidden'}
            </Badge>
          }
        />
        <Row
          label="Using Life OS since"
          control={
            <span className="mono" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)' }}>
              {formatMonthDay(toDayKey(settings.createdAt))}
            </span>
          }
        />
      </Group>

      <Card>
        <p className="card-kicker">SESSION</p>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.65 }}>
          There is no sign-in. Life OS runs entirely on this device with no account and no server, so
          there is no session to end — closing the tab is all there is. Your data stays in this
          browser until you clear it.
        </p>
      </Card>
    </>
  );
}

function AppearanceSection() {
  const settings = useSettings();

  return (
    <>
      <Group title="THEME">
        <Row
          label="Accent colour"
          description="Burgundy is the Life OS identity colour. Blue is reserved for the AI."
          control={
            <div className="row" style={{ gap: 7 }}>
              {ACCENTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use accent ${color}`}
                  aria-pressed={settings.accent === color}
                  onClick={() => void updateSettings({ accent: color })}
                  className="los-press"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: color,
                    cursor: 'pointer',
                    border: `2px solid ${settings.accent === color ? 'var(--c-text)' : 'transparent'}`,
                  }}
                />
              ))}
            </div>
          }
        />
        <Row
          label="Colour theme"
          description="Life OS is dark-first by design. Light mode is deliberately out of scope for now."
          control={<Badge color="var(--c-text-muted)">Dark</Badge>}
        />
      </Group>

      <Group title="DENSITY">
        <SettingToggle
          field="compactRows"
          label="Compact rows"
          description="Tighter list spacing, so more fits on screen."
        />
        <Row
          label="Font size"
          control={
            <SelectField
              label=""
              value={settings.fontScale}
              onChange={(e) => void updateSettings({ fontScale: e.target.value as Settings['fontScale'] })}
              options={[
                { value: 'S', label: 'Small' },
                { value: 'Default', label: 'Default' },
                { value: 'L', label: 'Large' },
              ]}
            />
          }
        />
      </Group>
    </>
  );
}

function NavigationSection() {
  const settings = useSettings();

  return (
    <>
      <Group title="SIDEBAR">
        <SettingToggle
          field="showRankBadges"
          label="Show rank titles and badges"
          description="Your progression identity in the sidebar. Turning this off hides rank everywhere."
        />
        <SettingToggle
          field="sidebarCollapsed"
          label="Collapse the sidebar"
          description="Icons only. The sidebar collapses on its own on narrow windows regardless."
        />
        <Row
          label="Default landing screen"
          description="Where Life OS opens."
          control={
            <SelectField
              label=""
              value={settings.defaultScreen}
              onChange={(e) => void updateSettings({ defaultScreen: e.target.value })}
              options={[
                { value: '/dashboard', label: 'Dashboard' },
                { value: '/tasks', label: 'Tasks' },
                { value: '/habits', label: 'Habits' },
                { value: '/calendar', label: 'Calendar' },
                { value: '/goals', label: 'Goals' },
              ]}
            />
          }
        />
      </Group>

      <Group title="WEEK">
        <SettingToggle
          field="weekStartsMonday"
          label="Week starts on Monday"
          description="Affects the calendar, habit strips and every weekly rollup."
        />
      </Group>
    </>
  );
}

function NotificationsSection() {
  return (
    <>
      {/*
        Stated plainly rather than implying delivery that does not exist.
        Background scheduling is deferred (docs/DECISIONS.md section 8); what is
        implemented is the in-app half, and every toggle below drives it.
      */}
      <Card>
        <p className="card-kicker">HOW REMINDERS WORK TODAY</p>
        <div className="alert alert-info">
          <Icon name="info" size={15} style={{ marginTop: 1 }} />
          <div className="grow">
            Reminders appear <strong>inside Life OS while it is open</strong> — as a banner on the
            dashboard and, optionally, as toasts. Background delivery when the app is closed is not
            built: that needs a scheduler this local-only architecture does not have, and it is
            tracked as deferred rather than faked. The settings below all take effect immediately.
          </div>
        </div>
      </Card>

      <Group title="REMINDERS">
        <SettingToggle
          field="habitNudges"
          label="Habit nudges"
          description="Shows a reminder when a streak is scheduled today and still unlogged."
        />
        <SettingToggle
          field="deadlineWarnings"
          label="Deadline warnings"
          description="Surfaces overdue tasks, and goals or projects due within a week."
        />
        <SettingToggle
          field="toastReminders"
          label="Also show reminders as toasts"
          description="Off leaves them on the dashboard banner only, rather than interrupting."
        />
      </Group>

      <Group title="PROGRESSION">
        <SettingToggle
          field="achievementAlerts"
          label="Achievement alerts"
          description="Shows a toast the moment an achievement unlocks. The unlock still happens either way."
        />
        <SettingToggle
          field="quietHours"
          label="Quiet hours"
          description="Suppresses reminders and achievement toasts between 11pm and 8am."
        />
      </Group>
    </>
  );
}

function AiSection() {
  const settings = useSettings();
  const toast = useToast();
  const confirm = useConfirm();
  const [keyInput, setKeyInput] = useState('');
  const [savedKey, setSavedKey] = useState(maskedKey());
  const [scope, setScope] = useState<KeyScope | null>(getKeyScope());
  /** Persisting beyond the tab is an explicit opt-in, so this starts false. */
  const [remember, setRemember] = useState(false);
  const usage = useSelector(() => callsToday());

  return (
    <>
      <Card>
        <p className="card-kicker">GROQ API KEY</p>

        {/*
          Stated up front and without euphemism. Browser storage is not secure
          storage, and the UI must not imply otherwise.
        */}
        <div className="alert alert-warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} style={{ marginTop: 1 }} />
          <div className="grow">
            <strong>Browser storage is not secure storage.</strong> A web page has no access to an
            OS keychain, so the key is not encrypted at rest. Any script on this page, a browser
            extension with access to it, or anyone who can read this browser profile can read the
            key. Use a key created only for Life OS, and revoke it if this machine is shared.
          </div>
        </div>

        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 14px', lineHeight: 1.65 }}>
          Life OS calls Groq directly from this device — no server sits in between, which is why
          there is nowhere safer to put the key. It is sent only to Groq, never written to a log,
          and deliberately excluded from your data export.
        </p>

        {savedKey ? (
          <>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
                Key set
              </Badge>
              <Badge
                color={scope === 'session' ? 'var(--c-ai-bright)' : 'var(--c-warn-bright)'}
                border={scope === 'session' ? 'rgba(123,154,208,.4)' : 'rgba(194,91,114,.4)'}
              >
                {scope === 'session' ? 'This session only' : 'Stored on this device'}
              </Badge>
              <span className="mono" style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)' }}>
                {savedKey}
              </span>
              <span className="grow" />
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  confirm({
                    title: 'Remove the API key?',
                    body: 'The coach will stop working until you add a key again. Nothing else in Life OS is affected.',
                    actionLabel: 'Remove key',
                    danger: true,
                    onConfirm: () => {
                      clearApiKey();
                      setSavedKey(null);
                      setScope(null);
                      toast.show('API key removed', { tone: 'muted' });
                    },
                  })
                }
              >
                Remove
              </Button>
            </div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: 0, lineHeight: 1.6 }}>
              {scope === 'session'
                ? 'The key is cleared when you close this tab. You will re-enter it next time — that is the safer default.'
                : 'The key persists across restarts. It stays readable on disk until you remove it.'}
            </p>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 9, alignItems: 'flex-end', marginBottom: 12 }}>
              <div className="grow">
                <TextField
                  label="API key"
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="gsk_…"
                  hint="Free at console.groq.com — no card required."
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button
                variant="primary"
                disabled={!keyInput.trim()}
                onClick={() => {
                  try {
                    setApiKey(keyInput, remember ? 'device' : 'session');
                    setSavedKey(maskedKey());
                    setScope(getKeyScope());
                    setKeyInput('');
                    toast.show(
                      remember ? 'API key saved on this device' : 'API key saved for this session',
                      { tone: 'ok' },
                    );
                  } catch (err) {
                    toast.showError(err instanceof AppError ? err.message : 'Could not save the key.');
                  }
                }}
              >
                Save key
              </Button>
            </div>

            {/* Persistence is opt-in, with the tradeoff stated at the point of choice. */}
            <label
              className="row"
              style={{ gap: 8, fontSize: 'var(--fs-md)', color: 'var(--c-text-muted)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember on this device
            </label>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-ghost)', margin: '6px 0 0', lineHeight: 1.6 }}>
              Off by default. Left off, the key is held for this tab only and is gone when you close
              it — the shortest exposure a browser allows. Turning it on keeps the key on disk until
              you remove it.
            </p>
          </>
        )}
      </Card>

      <Group title="CONTEXT THE AI CAN READ">
        <SettingToggle
          field="aiContextTasks"
          label="Tasks, goals and habits"
          description="Lets the coach plan and prioritise against what you actually have on."
        />
        <SettingToggle
          field="aiContextFitness"
          label="Fitness and recovery"
          description="Factors training load into its suggestions."
        />
        <SettingToggle
          field="aiContextJournal"
          label="Journal entries"
          description="Off by default. Even with this on, each conversation must opt in per request — it is never sent automatically."
        />
      </Group>

      <Group title="AI BEHAVIOUR">
        <SettingToggle
          field="procrastinationDetection"
          label="Procrastination detection"
          description="Flags avoidance patterns it can see in your data, and names them directly."
        />
        <Row
          label="Confirm before the AI acts"
          description="Always on. The AI proposes; you confirm. This is enforced in code, not by the prompt, so it cannot be turned off."
          control={
            <Badge color="var(--c-success)" border="rgba(123,176,138,.4)">
              Enforced
            </Badge>
          }
        />
        <Row
          label="Model"
          control={
            <SelectField
              label=""
              value={settings.aiModel}
              onChange={(e) => void updateSettings({ aiModel: e.target.value })}
              options={AI_MODELS.map((m) => ({ value: m.value, label: m.label }))}
            />
          }
        />
      </Group>

      <Group title="USAGE TODAY">
        <Row
          label="AI calls"
          description="A guardrail, not billing — a runaway loop shows up here immediately."
          control={
            <span className="mono" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
              {usage.calls}
            </span>
          }
        />
        <Row
          label="Tokens"
          control={
            <span className="mono" style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>
              {usage.tokens}
            </span>
          }
        />
      </Group>
    </>
  );
}

function DataSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingBundle, setPendingBundle] = useState<ReturnType<typeof parseImport>['bundle'] | null>(null);
  const size = useSelector(() => exportSizeLabel());

  return (
    <>
      <Group title="PORTABILITY">
        <Row
          label="Export everything"
          description={`Every table as JSON — ${size}. Includes AI memory and usage logs, so you can always see what Life OS knows. The API key is deliberately excluded.`}
          control={
            <Button
              variant="secondary"
              icon="download"
              onClick={() => {
                downloadExport();
                toast.show('Export downloaded', { tone: 'ok' });
              }}
            >
              Export JSON
            </Button>
          }
        />
        <Row
          label="Export tasks as CSV"
          description="For spreadsheets. One table at a time."
          control={
            <Button
              variant="ghost"
              icon="download"
              onClick={() => {
                try {
                  downloadCsv('tasks');
                  toast.show('Tasks exported', { tone: 'ok' });
                } catch (err) {
                  toast.showError(err instanceof AppError ? err.message : 'Nothing to export.');
                }
              }}
            >
              Export CSV
            </Button>
          }
        />
        <Row
          label="Storage"
          description="Local to this browser on this device. There is no cloud copy — export regularly."
          control={<Badge color="var(--c-text-muted)">This device</Badge>}
        />
      </Group>

      <Group title="RESTORE">
        <Row
          label="Import a backup"
          description="Replaces everything currently in Life OS. You will see what is in the file before anything changes."
          control={
            <>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="los-sr"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const { preview: p, bundle } = parseImport(text);
                    setPreview(p);
                    setPendingBundle(bundle);
                  } catch (err) {
                    toast.showError(
                      err instanceof AppError ? err.message : 'That file could not be read.',
                    );
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
              <Button variant="secondary" icon="upload" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
            </>
          }
        />
      </Group>

      {preview && pendingBundle ? (
        <Card>
          <p className="card-kicker">READY TO IMPORT</p>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 12px' }}>
            Exported {new Date(preview.exportedAt).toLocaleString()} · {preview.total} rows
          </p>
          <div className="row" style={{ gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
            {Object.entries(preview.counts)
              .filter(([, count]) => count > 0)
              .map(([name, count]) => (
                <Badge key={name} color="var(--c-text-muted)">
                  {name} {count}
                </Badge>
              ))}
          </div>
          {preview.warnings.length > 0 ? (
            <div className="alert alert-warn" style={{ marginBottom: 14 }}>
              <Icon name="alert" size={15} style={{ marginTop: 1 }} />
              <div className="grow">
                {preview.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="primary"
              onClick={() =>
                confirm({
                  title: 'Replace all data with this backup?',
                  body: `Everything currently in Life OS will be removed and replaced with the ${preview.total} rows in this file.`,
                  note: 'Export your current data first if you have not already — this cannot be undone.',
                  actionLabel: 'Replace everything',
                  danger: true,
                  onConfirm: async () => {
                    await applyImport(pendingBundle);
                    setPreview(null);
                    setPendingBundle(null);
                    toast.show('Backup restored', { tone: 'ok' });
                  },
                })
              }
            >
              Import and replace
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null);
                setPendingBundle(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <Group title="MAINTENANCE">
        <Row
          label="Rebuild XP totals"
          description="Recomputes your level and rank from the XP ledger. The ledger is the source of truth; this only refreshes the cached rollup."
          control={
            <Button
              variant="ghost"
              icon="refresh"
              onClick={async () => {
                const character = await rebuildCharacterState();
                toast.show(`Rebuilt · ${character.totalXp} XP, level ${character.level}`, { tone: 'ok' });
              }}
            >
              Rebuild
            </Button>
          }
        />
      </Group>

      <Card style={{ borderColor: 'rgba(194,58,84,.35)' }}>
        <p className="card-kicker" style={{ color: 'var(--c-danger-bright)' }}>
          DANGER ZONE
        </p>
        <Row
          label="Clear all data"
          description="Permanently erases every goal, task, habit, note, journal entry and log in this browser."
          control={
            <Button
              variant="danger"
              icon="trash"
              onClick={() =>
                confirm({
                  title: 'Clear all data?',
                  body: 'This permanently erases everything in Life OS on this device.',
                  note: 'There is no cloud backup and no undo. Export first if you want a copy.',
                  actionLabel: 'Clear everything',
                  danger: true,
                  onConfirm: async () => {
                    await store.clearAll();
                    toast.show('All data cleared', { tone: 'muted' });
                  },
                })
              }
            >
              Clear data
            </Button>
          }
        />
      </Card>
    </>
  );
}

function ShortcutsSection() {
  const rows: Array<[string, string]> = [
    ['Command palette', 'Ctrl / ⌘ + K'],
    ['Quick capture', 'Ctrl / ⌘ + N'],
    ['Save (journal, notes)', 'Ctrl / ⌘ + S'],
    ['Close overlay', 'Esc'],
    ['Navigate results', '↑ ↓'],
    ['Confirm / open', '↵ Enter'],
    ['Move between tabs', '← →'],
  ];

  return (
    <Group title="KEYBOARD">
      {rows.map(([label, keys]) => (
        <Row
          key={label}
          label={label}
          control={
            <kbd
              className="mono"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--c-ai-bright)',
                border: '1px solid var(--c-border-faint)',
                borderRadius: 5,
                padding: '4px 8px',
              }}
            >
              {keys}
            </kbd>
          }
        />
      ))}
    </Group>
  );
}

function AccessibilitySection() {
  return (
    <>
      <Group title="MOTION">
        <SettingToggle
          field="reduceMotion"
          label="Reduce motion"
          description="Minimises animation and transitions. Your operating system setting is also honoured automatically."
        />
        <SettingToggle
          field="ambientMotion"
          label="Ambient background motion"
          description="Subtle drift on decorative surfaces, like the XP bar highlight."
        />
      </Group>

      <Group title="VISION">
        <SettingToggle
          field="highContrast"
          label="High contrast text"
          description="Lifts secondary text and borders toward full contrast."
        />
        <SettingToggle
          field="largeText"
          label="Larger text"
          description="Scales the whole type ramp, so layout stays proportional."
        />
      </Group>
    </>
  );
}

function AboutSection() {
  const settings = useSettings();
  const character = useCharacter();
  const counts = useSelector(() => ({
    tasks: store.live('tasks').length,
    goals: store.live('goals').length,
    habits: store.live('habits').length,
    xpEvents: store.live('xpEvents').length,
  }));

  return (
    <>
      <Group title="BUILD">
        <Row label="Version" control={<span className="mono">1.0.0</span>} />
        <Row
          label="Architecture"
          description="Single user, local-first, no backend and no account. Your data never leaves this device except when you export it."
          control={<Badge color="var(--c-text-muted)">Local only</Badge>}
        />
        <Row
          label="Design system"
          description="Burgundy is you. Blue is the AI."
          control={
            <div className="row" style={{ gap: 5 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: settings.accent }} />
              <span style={{ width: 16, height: 16, borderRadius: 4, background: 'var(--c-ai)' }} />
            </div>
          }
        />
      </Group>

      <Group title="YOUR DATABASE">
        <Row label="Tasks" control={<span className="mono">{counts.tasks}</span>} />
        <Row label="Goals" control={<span className="mono">{counts.goals}</span>} />
        <Row label="Habits" control={<span className="mono">{counts.habits}</span>} />
        <Row label="XP events" control={<span className="mono">{counts.xpEvents}</span>} />
        <Row label="Total XP" control={<span className="mono">{character.totalXp}</span>} />
      </Group>
    </>
  );
}
