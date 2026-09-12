/**
 * Onboarding.
 *
 * UI/UX section 46 is specific: this is a single-user app for someone who
 * already knows what they want, so onboarding confirms and structures rather
 * than interviewing a stranger — and explicitly warns against over-building a
 * generic multi-screen wizard. Four short steps, all skippable.
 *
 * Master prompt section 43 requires it to create real state: every step writes
 * actual rows through the same action layer the rest of the app uses. The step
 * index is persisted, so closing the tab halfway resumes where you left off
 * rather than starting over.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, Card, TextField, SelectField, ProgressBar } from '../../ui/primitives';
import { Icon, type IconName } from '../../ui/Icon';
import { useToast } from '../../ui/overlays';
import { useSettings } from '../../app/hooks';
import { createGoal, createHabit, createTask, updateSettings } from '../../data/actions';
import { LIFE_AREAS } from '../../data/schema';
import { AppError } from '../../data/errors';

const STEPS = ['You', 'A goal', 'A habit', 'Ready'] as const;

export default function OnboardingScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState(settings.onboardingStep);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(settings.displayName);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalArea, setGoalArea] = useState('Education');
  const [firstTask, setFirstTask] = useState('');
  const [habitTitle, setHabitTitle] = useState('');
  const [habitIdentity, setHabitIdentity] = useState('');

  /** Records progress so a half-finished setup resumes rather than restarts. */
  const goTo = async (next: number) => {
    setStep(next);
    setError(null);
    await updateSettings({ onboardingStep: next });
  };

  const finish = async () => {
    await updateSettings({
      onboardingStep: STEPS.length,
      onboardingCompletedAt: Date.now(),
      displayName: name.trim(),
    });
    navigate('/dashboard', { replace: true });
  };

  const run = async (work: () => Promise<void>, next: number) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await goTo(next);
    } catch (err) {
      setError(err instanceof AppError ? err.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'radial-gradient(1200px 700px at 30% -10%, #141620 0%, #09090C 60%)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* ---------- header ---------- */}
        <div className="row" style={{ gap: 11, marginBottom: 22 }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: 'var(--c-accent)',
              boxShadow: '0 0 16px -2px var(--c-accent)',
            }}
          />
          <div>
            <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600 }}>Life OS</div>
            <div className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
              local · no account · your data stays here
            </div>
          </div>
        </div>

        {/* ---------- progress ---------- */}
        <div style={{ marginBottom: 18 }}>
          <div className="spread mono" style={{ marginBottom: 7, fontSize: 'var(--fs-3xs)', color: 'var(--c-text-dim)' }}>
            <span>
              STEP {Math.min(step + 1, STEPS.length)} OF {STEPS.length}
            </span>
            <span>{STEPS[Math.min(step, STEPS.length - 1)]}</span>
          </div>
          <ProgressBar
            percent={(step / STEPS.length) * 100}
            label={`Setup step ${step + 1} of ${STEPS.length}`}
          />
        </div>

        <Card>
          {error ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>
              <Icon name="alert" size={15} style={{ marginTop: 1 }} />
              <div className="grow">{error}</div>
            </div>
          ) : null}

          {/* ================= step 0: identity ================= */}
          {step === 0 ? (
            <StepShell
              icon="dashboard"
              title="What should Life OS call you?"
              body="There is no account and no sign-in — this is only used in the greeting and the sidebar. Everything you create stays in this browser on this device."
            >
              <TextField
                label="Name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="Malek"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) void run(async () => {
                    await updateSettings({ displayName: name.trim() });
                  }, 1);
                }}
              />
              <Footer
                onSkip={() => void goTo(1)}
                primary={
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!name.trim()}
                    onClick={() =>
                      run(async () => {
                        await updateSettings({ displayName: name.trim() });
                      }, 1)
                    }
                  >
                    Continue
                  </Button>
                }
              />
            </StepShell>
          ) : null}

          {/* ================= step 1: first goal ================= */}
          {step === 1 ? (
            <StepShell
              icon="goals"
              title="What is the one goal that matters most right now?"
              body="Goals are what projects and tasks roll up into — the dashboard, analytics and Life Map all organise themselves around them. One real goal is worth more here than five aspirational ones."
            >
              <TextField
                label="Goal"
                value={goalTitle}
                autoFocus
                onChange={(e) => setGoalTitle(e.target.value)}
                placeholder="Score 1550+ on the SAT"
              />
              <SelectField
                label="Life area"
                value={goalArea}
                onChange={(e) => setGoalArea(e.target.value)}
                options={LIFE_AREAS.map((a) => ({ value: a, label: a }))}
              />
              <TextField
                label="The first concrete task toward it"
                value={firstTask}
                onChange={(e) => setFirstTask(e.target.value)}
                placeholder="Book a practice test"
                hint="Optional, but a goal with no first step tends to stay a goal."
              />
              <Footer
                onBack={() => void goTo(0)}
                onSkip={() => void goTo(2)}
                primary={
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!goalTitle.trim()}
                    onClick={() =>
                      run(async () => {
                        const goal = await createGoal({ title: goalTitle, area: goalArea });
                        const goalId = goal.createdIds[0];
                        if (firstTask.trim() && goalId) {
                          await createTask({ title: firstTask, goalId, priority: 'HIGH' });
                        }
                        toast.show('Goal created', { tone: 'ok' });
                      }, 2)
                    }
                  >
                    Create goal
                  </Button>
                }
              />
            </StepShell>
          ) : null}

          {/* ================= step 2: first habit ================= */}
          {step === 2 ? (
            <StepShell
              icon="habits"
              title="Pick one habit to start a streak with"
              body="Habits are the compounding part of the system. Make it small enough that keeping it is never the hard part — the streak does the work, not the effort."
            >
              <TextField
                label="Habit"
                value={habitTitle}
                autoFocus
                onChange={(e) => setHabitTitle(e.target.value)}
                placeholder="Read 20 minutes"
              />
              <TextField
                label="Who it makes you"
                value={habitIdentity}
                onChange={(e) => setHabitIdentity(e.target.value)}
                placeholder="Reader"
                hint="Every completion is a vote for this identity. It shows beside the habit as a reminder of the point."
              />
              <Footer
                onBack={() => void goTo(1)}
                onSkip={() => void goTo(3)}
                primary={
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={!habitTitle.trim()}
                    onClick={() =>
                      run(async () => {
                        await createHabit({
                          title: habitTitle,
                          identity: habitIdentity,
                          area: 'Mind',
                          frequency: 'DAILY',
                        });
                        toast.show('Habit created', { tone: 'ok' });
                      }, 3)
                    }
                  >
                    Create habit
                  </Button>
                }
              />
            </StepShell>
          ) : null}

          {/* ================= step 3: done ================= */}
          {step >= 3 ? (
            <StepShell
              icon="sparkle"
              title={name.trim() ? `You are set up, ${name.trim()}.` : 'You are set up.'}
              body="Everything from here is real: completing a task writes XP to a ledger, progress rolls up from actual work, and nothing on any screen is a placeholder. Two things worth knowing before you start."
            >
              <div className="stack" style={{ gap: 12 }}>
                <Hint icon="search" title="Ctrl + K opens everything">
                  Search, navigate, create, complete a task or log a habit — all from the keyboard.
                  Ctrl + N captures anything straight into the system.
                </Hint>
                <Hint icon="download" title="Export regularly">
                  There is no cloud backup. Your data lives in this browser, so a periodic export
                  from Settings is the only thing standing between you and losing it.
                </Hint>
                <Hint icon="shield" title="The AI is optional and asks first">
                  The coach needs a free Groq key, reads only what you allow, and proposes every
                  change for you to confirm. Your journal is excluded by default.
                </Hint>
              </div>

              <Footer
                onBack={() => void goTo(2)}
                primary={
                  <Button variant="primary" onClick={finish}>
                    Open Life OS
                  </Button>
                }
              />
            </StepShell>
          ) : null}
        </Card>

        <p
          style={{
            textAlign: 'center',
            fontSize: 'var(--fs-xs)',
            color: 'var(--c-text-ghost)',
            marginTop: 16,
          }}
        >
          You can change any of this later in Settings.
        </p>
      </div>
    </main>
  );
}

function StepShell({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <div
          aria-hidden="true"
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--c-accent-wash-strong)',
            border: '1px solid var(--c-accent-border)',
            color: 'var(--c-accent-text)',
            marginBottom: 14,
          }}
        >
          <Icon name={icon} size={19} />
        </div>
        <h1 style={{ fontSize: 'var(--fs-5xl)', fontWeight: 600, margin: '0 0 8px', lineHeight: 1.25 }}>
          {title}
        </h1>
        <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--c-text-dim)', margin: 0, lineHeight: 1.65 }}>
          {body}
        </p>
      </div>
      {children}
    </div>
  );
}

function Hint({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
      <Icon name={icon} size={16} color="var(--c-accent-text)" style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', lineHeight: 1.55, marginTop: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Footer({
  onBack,
  onSkip,
  primary,
}: {
  onBack?: () => void;
  onSkip?: () => void;
  primary: React.ReactNode;
}) {
  return (
    <div className="row" style={{ gap: 9, marginTop: 4 }}>
      {onBack ? (
        <Button variant="ghost" icon="chevronLeft" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <span className="grow" />
      {onSkip ? (
        <Button variant="ghost" onClick={onSkip}>
          Skip
        </Button>
      ) : null}
      {primary}
    </div>
  );
}
