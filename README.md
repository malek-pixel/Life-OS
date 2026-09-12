# Life OS

A personal operating system for one person. Goals, projects, tasks, habits,
routines, calendar, fitness, journal, notes, quests, achievements, reviews,
analytics and an AI coach — as one connected system rather than twelve separate
tools.

**Single user. Local-first. No account, no backend, no recurring cost.**
Your data lives in this browser on your machine and never leaves it, except when
you export it or ask the AI coach a question.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. There is no login — the app opens straight into a
short setup and then into the dashboard.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Run the unit and integration suites once |
| `npm run test:watch` | Watch mode |

`dist/` is a static bundle. It uses hash routing, so it works from any static
host or straight off the filesystem with no server-side route configuration.

---

## Architecture

```
UI (React screens)
  └── selectors (derived views — progress, streaks, analytics)
        └── domain (pure business logic — XP, streaks, progress, achievements)
        └── actions (mutations + propagation, one transaction each)
              └── store (reactive in-memory mirror)
                    └── IndexedDB (authoritative storage)

  ai/ ── Groq, called directly from the browser. The only network dependency.
```

### The rules that shape it

**One source of truth per calculation.** XP, level, rank, streaks, goal and
project progress, and achievement evaluation each live in exactly one module
under `src/domain/`. No screen computes its own. This is why the dashboard,
analytics page and entity pages can never disagree about the same number.

**Derived, not stored.** Project and goal progress are computed on read from
their tasks and milestones. There is no stored percentage to drift out of sync,
and no code path that can write a wrong one.

**XP is an append-only ledger.** Every point is an `XpEvent` row with a source,
a reason and a date. `CharacterState` is a cached rollup that can always be
rebuilt from the ledger (Settings → Data → Rebuild). Undoing an action appends a
compensating negative event rather than deleting history, so "why do I have this
much XP" is always answerable — see the ledger on the Analytics screen.

**Related writes are atomic.** Completing a task updates the task, writes its XP
event, updates the cached rollup, evaluates achievements, and schedules the next
recurrence — all in one IndexedDB transaction. It lands completely or not at all.

**Soft deletes.** Deleting sets `deletedAt` rather than removing the row, so
delete is recoverable and the undo in the toast actually works.

**Validation at the boundary.** `src/data/validation.ts` runs on every write,
whatever the source — a form, the command palette, the AI tool layer, or an
import file. A bad row cannot reach storage by going around the UI.

### Layout

```
src/
├── data/          schema, IndexedDB, store, actions, validation, errors, export
├── domain/        pure logic: xp, streaks, progress, achievements, recurrence,
│                  dates, selectors
├── ui/            component library, icons, charts, overlays
├── app/           shell, routing, sidebar, command palette, quick capture, hooks
├── ai/            provider (Groq), tool registry, coach loop
├── design/        tokens + global stylesheet
└── features/      one folder per screen
```

---

## Data and privacy

There is no server. Nothing is transmitted anywhere except the AI request, and
only when you use the coach.

- **Export** (Settings → Data) writes every table to JSON, including AI memory
  and usage logs, so "what does this app know about me" is always answerable.
  The API key is deliberately excluded.
- **Import** replaces everything, after showing you exactly what is in the file.
- **There is no cloud backup.** One browser profile holds the only copy. Export
  regularly — this is the single biggest risk in the whole design.

### AI

The coach is optional and off until you add a free [Groq](https://console.groq.com)
key in Settings → AI.

- **Permissions are enforced in code, not in the prompt.** Read tools run
  automatically; anything that writes comes back as a proposal you confirm. The
  model never invokes the execute path — the confirm button does.
- **Context is minimum-necessary.** The context builder simply does not read a
  domain you have switched off, so there is nothing to leak.
- **Journal is excluded by default,** and even when enabled it requires a
  per-request opt-in checkbox rather than a standing permission.
- **Usage is logged locally** as a guardrail, so a runaway loop is visible in
  Settings immediately rather than discovered as a broken assistant.

**Key storage caveat, stated plainly:** a browser has no OS keychain. The key is
in `localStorage` on your device. Anyone with access to this browser profile can
read it. Use a key scoped to this purpose and revoke it if the machine is shared.

---

## Testing

```bash
npm test
```

Two suites, 90 tests, covering what silently corrupts data if wrong:

- **`test/domain.test.ts`** — the pure logic. Streak calculation including
  protections, custom schedules, weekly targets and the rule that an unlogged
  today is pending rather than a miss; the XP curve and rank ladder; goal and
  project progress including the blend, overrides and division-by-zero; date
  handling across DST, leap years and month boundaries; task-cycle detection.
- **`test/actions.test.ts`** — the action layer against a real IndexedDB
  (`fake-indexeddb`), covering the end-to-end flows: goal → project → task →
  complete → progress and XP propagate; habit → streak → XP; recurrence spawning
  the next instance; soft delete and restore; validation rejection; and
  persistence across a simulated reload.

---

## Environment

`.env.example` documents the one variable, and it is optional. The app runs with
no environment configuration at all. The Groq key is entered in Settings, not
baked into the build — anything prefixed `VITE_` is inlined into the bundle and
is therefore public, so a credential must never go there.

---

## Accessibility

Built in rather than retrofitted: full keyboard navigation, a skip link, focus
trapping and restoration in every overlay, accessible names on every icon-only
control (the type system requires them), `aria-invalid` and linked error
messages on form fields, live regions for toasts, and honoured reduced-motion
from both the OS and the in-app setting. High-contrast and larger-text modes are
in Settings → Accessibility.

---

## Documentation

- [`docs/DECISIONS.md`](docs/DECISIONS.md) — where the implementation departs
  from the source documents, and why. Read this first if something looks
  different from the spec or the design.
