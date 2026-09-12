/**
 * AI coach.
 *
 * UI/UX section 26 frames the coach as a persona on top of the one AI layer,
 * not a second AI system — so this screen is purely presentation over
 * `ai/coach.ts`.
 *
 * The confirmation flow from master prompt section 40 is implemented literally:
 *   user -> AI interprets -> proposes -> user confirms -> system executes ->
 *   database updates -> UI updates -> result shown
 *
 * A proposed write is rendered as a card with an explicit Confirm button. Until
 * that is pressed nothing has touched the data layer, and if execution fails the
 * card says so rather than the message implying success.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge, Button, Card, EmptyState, IconButton, PageHeader } from '../../ui/primitives';
import { Icon } from '../../ui/Icon';
import { useToast } from '../../ui/overlays';
import { useSettings } from '../../app/hooks';
import { runCoachTurn, callsToday } from '../../ai/coach';
import { executeConfirmedTool, TOOLS_BY_NAME } from '../../ai/tools';
import { groqProvider, type AiMessageInput } from '../../ai/provider';
import { AppError, messageForCode } from '../../data/errors';
import type { AiToolCallRecord } from '../../data/schema';

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: AiToolCallRecord[];
  reads?: Array<{ name: string; summary: string }>;
  error?: string;
}

const SUGGESTIONS = [
  'What should I do right now?',
  'Plan my afternoon around what is already due',
  'Which goal is slipping, and why?',
  'Am I avoiding something this week?',
  'Break my hardest goal into three tasks',
];

export default function AiCoachScreen() {
  const settings = useSettings();
  const toast = useToast();
  const [params] = useSearchParams();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareJournal, setShareJournal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const configured = groqProvider.isConfigured();
  const usage = callsToday();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  // The palette can deep-link a question straight into the coach.
  useEffect(() => {
    if (params.get('ask') === 'what-now' && configured && turns.length === 0) {
      void send('What should I do right now?');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    const userTurn: Turn = { id: `u-${Date.now()}`, role: 'user', content: message };
    setTurns((current) => [...current, userTurn]);
    setInput('');
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Only prose turns go back as history; proposals are UI state, not context.
    const history: AiMessageInput[] = [...turns, userTurn]
      .filter((t) => t.content)
      .map((t) => ({ role: t.role, content: t.content }));

    try {
      const result = await runCoachTurn(history, {
        signal: controller.signal,
        includeJournal: shareJournal,
      });
      setTurns((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          pending: result.pending.length > 0 ? result.pending : undefined,
          reads: result.reads.length > 0 ? result.reads : undefined,
        },
      ]);
    } catch (err) {
      const appError = err instanceof AppError ? err : null;
      setTurns((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: '',
          error: appError ? appError.message : 'The coach could not be reached.',
        },
      ]);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  /** Executes a proposal after the user confirms it. */
  async function confirmCall(turnId: string, call: AiToolCallRecord) {
    updateCall(turnId, call.id, { status: 'CONFIRMED' });
    try {
      const result = await executeConfirmedTool(call.name, call.args);
      updateCall(turnId, call.id, { status: 'EXECUTED', result });
      toast.show(result, { tone: 'xp' });
    } catch (err) {
      const message =
        err instanceof AppError ? err.message : 'That action could not be completed.';
      // Never let the transcript imply a write succeeded when it did not.
      updateCall(turnId, call.id, { status: 'FAILED', error: message });
      toast.showError(message);
    }
  }

  function updateCall(turnId: string, callId: string, patch: Partial<AiToolCallRecord>) {
    setTurns((current) =>
      current.map((turn) =>
        turn.id !== turnId
          ? turn
          : {
              ...turn,
              pending: turn.pending?.map((c) => (c.id === callId ? { ...c, ...patch } : c)),
            },
      ),
    );
  }

  return (
    <>
      <PageHeader
        title="AI coach"
        subtitle="Reads what you have logged. Asks before it changes anything."
        actions={
          turns.length > 0 ? (
            <Button variant="ghost" icon="refresh" onClick={() => setTurns([])}>
              New conversation
            </Button>
          ) : undefined
        }
      />

      {!configured ? (
        <Card style={{ marginBottom: 16 }}>
          <EmptyState
            icon="ai"
            title="The coach needs a Groq API key"
            body="Life OS calls Groq directly from this device — there is no server in between, and the key never leaves your machine except to Groq. Groq's free tier needs no card."
            action={
              <Link to="/settings/ai">
                <span className="btn btn-primary los-press">Add a key in Settings</span>
              </Link>
            }
          />
        </Card>
      ) : null}

      <Card flush style={{ display: 'flex', flexDirection: 'column', minHeight: 520 }}>
        {/* ---------- transcript ---------- */}
        <div
          className="los-scroll grow"
          style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, maxHeight: 560 }}
          aria-live="polite"
        >
          {turns.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 460 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  margin: '0 auto 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--c-ai-wash)',
                  border: '1px solid var(--c-ai-border)',
                  color: 'var(--c-ai-bright)',
                }}
              >
                <Icon name="ai" size={21} />
              </div>
              <h2 style={{ fontSize: 'var(--fs-4xl)', fontWeight: 600, margin: '0 0 8px' }}>
                Ask about what you have actually logged
              </h2>
              <p style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-dim)', margin: '0 0 18px', lineHeight: 1.65 }}>
                The coach can see your tasks, goals and habits
                {settings.aiContextFitness ? ' and training' : ''}. It cannot see your journal unless
                you turn that on. It can propose changes, but you confirm every one.
              </p>
              <div className="row" style={{ gap: 7, flexWrap: 'wrap', justifyContent: 'center' }}>
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chip los-press"
                    disabled={!configured}
                    onClick={() => void send(suggestion)}
                    style={{ cursor: configured ? 'pointer' : 'not-allowed' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <TurnBubble
                key={turn.id}
                turn={turn}
                onConfirm={confirmCall}
                onDecline={(turnId, call) => updateCall(turnId, call.id, { status: 'REJECTED' })}
              />
            ))
          )}

          {busy ? (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div
                style={{
                  padding: '13px 16px',
                  borderRadius: 13,
                  borderTopLeftRadius: 4,
                  background: 'var(--c-ai-wash)',
                  border: '1px solid var(--c-ai-border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                }}
              >
                <span className="btn-spinner" style={{ color: 'var(--c-ai-bright)' }} />
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-body)' }}>Thinking…</span>
                <IconButton
                  icon="stop"
                  label="Stop generating"
                  size="sm"
                  onClick={() => abortRef.current?.abort()}
                />
              </div>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        {/* ---------- composer ---------- */}
        <div style={{ borderTop: '1px solid var(--c-border-faint)', padding: '14px 20px' }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="grow">
              <label className="los-sr" htmlFor="coach-input">
                Message the coach
              </label>
              <textarea
                id="coach-input"
                className="textarea"
                rows={2}
                value={input}
                disabled={!configured || busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={configured ? 'Ask the coach…' : 'Add an API key in Settings first'}
                style={{ minHeight: 54 }}
              />
            </div>
            <Button
              variant="primary"
              icon="send"
              disabled={!configured || busy || !input.trim()}
              onClick={() => void send(input)}
            >
              Send
            </Button>
          </div>

          <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
            {/* Per-request journal grant, per TECH_SPEC section 15. */}
            <label
              className="row"
              style={{ gap: 7, fontSize: 'var(--fs-xs)', color: 'var(--c-text-dim)', cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={shareJournal}
                disabled={!settings.aiContextJournal}
                onChange={(e) => setShareJournal(e.target.checked)}
              />
              <Icon name="shield" size={12} />
              Share my journal with this request
              {!settings.aiContextJournal ? ' (disabled in Settings)' : ''}
            </label>

            <span className="grow" />

            <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
              {usage.calls} call{usage.calls === 1 ? '' : 's'} today · {usage.tokens} tokens
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}

/* ================================================================== *
 * A single turn
 * ================================================================== */

function TurnBubble({
  turn,
  onConfirm,
  onDecline,
}: {
  turn: Turn;
  onConfirm: (turnId: string, call: AiToolCallRecord) => void;
  onDecline: (turnId: string, call: AiToolCallRecord) => void;
}) {
  const isUser = turn.role === 'user';

  if (turn.error) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
        <div className="alert alert-error" style={{ maxWidth: '80%' }} role="alert">
          <Icon name="alert" size={15} style={{ marginTop: 1 }} />
          <div className="grow">
            {turn.error}
            <div style={{ fontSize: 'var(--fs-xs)', marginTop: 5, opacity: 0.85 }}>
              Nothing in your data was changed.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '80%' }}>
        {turn.content ? (
          <div
            style={{
              padding: '13px 16px',
              fontSize: 'var(--fs-xl)',
              lineHeight: 1.6,
              borderRadius: 13,
              whiteSpace: 'pre-wrap',
              ...(isUser
                ? {
                    background: 'var(--c-accent)',
                    color: 'var(--c-text)',
                    borderTopRightRadius: 4,
                  }
                : {
                    background: 'var(--c-ai-wash)',
                    border: '1px solid var(--c-ai-border)',
                    color: 'var(--c-text-body)',
                    borderTopLeftRadius: 4,
                  }),
            }}
          >
            {turn.content}
          </div>
        ) : null}

        {/* --- what it read, for transparency --- */}
        {turn.reads && turn.reads.length > 0 ? (
          <div className="row" style={{ gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            {turn.reads.map((read, i) => (
              <Badge key={i} color="var(--c-text-ghost)">
                read · {read.name}
              </Badge>
            ))}
          </div>
        ) : null}

        {/* --- proposed writes, awaiting confirmation --- */}
        {turn.pending?.map((call) => {
          const tool = TOOLS_BY_NAME.get(call.name);
          const description = tool ? tool.describe(call.args) : call.name;

          return (
            <div
              key={call.id}
              style={{
                marginTop: 9,
                padding: 14,
                borderRadius: 'var(--r-2xl)',
                background: 'var(--c-bg-raised)',
                border: `1px solid ${
                  call.status === 'EXECUTED'
                    ? 'rgba(123,176,138,.45)'
                    : call.status === 'FAILED'
                      ? 'rgba(194,58,84,.45)'
                      : 'var(--c-accent-border)'
                }`,
              }}
            >
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <Badge color="var(--c-accent-text)" border="var(--c-accent-border)">
                  {call.permission}
                </Badge>
                <span className="mono" style={{ fontSize: 'var(--fs-3xs)', color: 'var(--c-text-ghost)' }}>
                  {call.name}
                </span>
              </div>

              <p style={{ fontSize: 'var(--fs-lg)', margin: '0 0 12px', lineHeight: 1.5 }}>
                {description}
              </p>

              {call.status === 'EXECUTED' ? (
                <div className="row" style={{ gap: 7, color: 'var(--c-success)', fontSize: 'var(--fs-md)' }}>
                  <Icon name="check" size={14} />
                  {call.result}
                </div>
              ) : call.status === 'FAILED' ? (
                <div className="row" style={{ gap: 7, color: 'var(--c-danger-bright)', fontSize: 'var(--fs-md)' }}>
                  <Icon name="alert" size={14} />
                  {call.error} Nothing was changed.
                </div>
              ) : call.status === 'REJECTED' ? (
                <span style={{ fontSize: 'var(--fs-md)', color: 'var(--c-text-ghost)' }}>
                  Declined — nothing was changed.
                </span>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={call.status === 'CONFIRMED'}
                    onClick={() => onConfirm(turn.id, call)}
                  >
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDecline(turn.id, call)}
                    disabled={call.status === 'CONFIRMED'}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { messageForCode };
