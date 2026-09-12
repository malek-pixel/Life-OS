# Implementation decisions

Every point where this build departs from the source documents, with the reason
and the authority. The source-of-truth hierarchy used throughout is the one in
the master development prompt: SOURCE_OF_TRUTH → approved design → PRD →
BUSINESS_RULES → TECH_SPEC → … → DEV_PROMPT → implementation judgment.

Source documents:

- `LIFE_OS_Dev_File_v2.docx` — Development Master v2.0
- `tech_specification_LIFE_OS_v2.docx` — Technical Specification v2.0
- `UI_UX_Life_OS_v2.docx` — UI/UX Master v2.0
- `Life OS.dc.html` — the approved design (20 screens)

---

## 1. Platform: web instead of Flutter/Windows

**Decided by the user, explicitly.**

Tech Spec §3 and Development Master §4 and §7 specify Flutter targeting Windows
desktop, with SQLite via Drift. The design confirms it — the mockup draws a
Windows title bar reading `Life OS — local · Windows`.

This was raised before any code was written, along with the fact that the
Flutter SDK and the Visual Studio C++ desktop toolchain are not installed on
this machine. The user chose a web app.

Everything downstream follows that choice:

| Spec calls for | Built as | Why it is equivalent |
| --- | --- | --- |
| SQLite via Drift | IndexedDB | The authoritative local datastore. Same role: no cloud copy, everything lives on the user's machine. |
| Drift reactive streams | `LifeOsStore` + `useSyncExternalStore` | Same guarantee — writes re-render readers automatically, no manual cache invalidation (Tech Spec §11). |
| Riverpod | React hooks + the store | UI state, data state and AI conversation state stay separate, per §27. |
| GoRouter | React Router, hash mode | Deep-linkable routes. Hash mode because there is no server to configure a history fallback on. |
| `flutter_secure_storage` | `localStorage` | **Not equivalent.** See §6 below. |
| Windows toast notifications | Browser notifications | Scheduled by the app while open; no push server either way. |
| Drift migrations | Numbered migrations in `db.ts` | Same rule: never edit a migration that has already run. |

Everything the spec says about *behaviour* — schema, UUIDs, UTC timestamps, soft
deletes, no `user_id`, XP as an append-only ledger, AI tool permissions, privacy
defaults — is implemented exactly as written.

## 2. No authentication, no backend

**Decided by the user, and required by the spec.**

The master development prompt asks for signup/login, session handling, protected
routes, and database row-level security (its Phases 2 and 3). The authoritative
documents forbid this:

- Development Master §34: never add a hosted backend or cloud database without
  surfacing it as a decision first; never add a workspace/role/permission system.
- Development Master §12: the User → Workspace → Role → Permission hierarchy is
  "Confirmed cut, not stubbed."
- Development Master §13: HTTPS, CSRF, SQL injection, rate limiting and secure
  session handling are cut because they defend a network-facing server that does
  not exist.

The hierarchy puts TECH_SPEC (#5) above DEV_PROMPT (#18), so the spec wins. This
was raised as an explicit question and the user confirmed: follow the spec.

Security effort therefore goes where the real risk is (§13): the API key is
never in source or logs, input is validated at the data boundary, and no error
message leaks internals. The Settings → Account section states there is no
session rather than showing a sign-out button that would do nothing.

## 3. The Windows title bar is dropped

The design's top strip has minimise, maximise and close buttons. In a browser
those would be three controls that do nothing, and master prompt §14 forbids
dead controls outright. The OS chrome is removed; everything below it — sidebar,
identity block, XP bar, LIFE divider, content region — is reproduced.

## 4. Responsive behaviour beyond desktop

UI/UX §40 designs only for Windows window-resizing and cuts tablet and mobile
breakpoints. A browser window can genuinely be narrow, so:

- below 1100px the sidebar collapses to icons
- below 820px it becomes an overlay drawer
- stat grids and two-column layouts reflow

This is an addition, not a redesign. No new navigation pattern was invented — it
is the same sidebar in a different state, which is what §07's collapsed mode
already specifies.

## 5. Screens added beyond the design

The design has 16 built screens. Three more exist because the UI/UX spec defines
them as real modules and the master prompt requires them:

- **Routines** (UI/UX §16, prompt §24) — built as ordered, executable step
  sequences with per-step completion and skipping, explicitly *not* a second
  habit system. Reward is prorated by steps actually completed.
- **Timeline** (UI/UX §37, prompt §36) — assembled only from stored rows with
  real timestamps.
- **Search results page** (prompt §37) — the command palette is the fast path;
  this is the full-results view. Both call the same selector.

All three use the established design language rather than inventing new patterns.

**Education (UI/UX §18) is not built.** It has no artboard in the approved
design, and building a whole module for school/subjects/GPA/SAT/applications
from a one-line description would mean inventing significant product behaviour,
which the master prompt's §0 and §71 rule out. The data model supports it via
the `Education` life area, which is already wired through goals, tasks,
analytics and the Life Map. This is the largest known gap — see §8.

## 6. API key storage is weaker than the spec assumes

Tech Spec §9 stores the Groq key in `flutter_secure_storage`, backed by the OS
credential store. **A web page has no equivalent, and nothing in this codebase
describes browser storage as secure.**

What web storage actually means here:

- any script running on this origin can read the key, including anything a
  future dependency pulls in
- a browser extension with host access can read it
- anyone who can read this browser profile on disk can read it
- it is **not encrypted at rest**

Given those constraints, the safest architecture the platform permits is used:

1. **Session scope by default.** The key lives in `sessionStorage`, wiped when
   the tab closes and not shared with other tabs. This is the shortest exposure
   a browser allows.
2. **Persistence is opt-in.** Storing it across restarts uses `localStorage` and
   requires ticking "Remember on this device", with the tradeoff stated at the
   point of choice.
3. **Never logged.** `redact()` in `errors.ts` strips key-shaped tokens from
   every log line.
4. **Never exported.** `portability.ts` omits it, so a backup file synced to a
   cloud drive cannot leak the credential. A test asserts this.
5. **Never in the bundle.** Entered at runtime, never an env var — a `VITE_`
   value would be inlined into the build and be public.

The only genuinely secure option is a server holding the key, which this
architecture deliberately does not have. That is the tradeoff, stated rather
than papered over, and Settings → AI leads with the warning rather than burying
it.

## 7. Business rules defined here

No `BUSINESS_RULES.md` exists, and Tech Spec §6 only says progress is "computed
automatically from linked projects/tasks where possible, manual override
allowed". The following were defined and documented at the point of use:

- **Project progress** — milestones 60%, tasks 40% when both exist; whichever
  exists alone carries full weight; an explicit override always wins. A
  milestone is a coarser, more meaningful unit than a single task.
- **Goal progress** — projects and direct tasks weighted by how many of each
  exist, so a goal with one project and twelve loose tasks is not half-decided
  by that one project.
- **Health** — progress compared against elapsed time proportionally, with a
  15-point tolerance, rather than a fixed threshold.
- **XP curve** — quadratic; `300 + 45(n-1)² + 200(n-1)` to advance from level n.
  Tuning constants are gathered in `domain/xp.ts`.
- **Rank bands** — the nine ranks from UI/UX §21-25, banded so level 14 is
  Contender, matching the design's sample state.
- **Streaks** — an unlogged *today* is pending, not a miss. Unscheduled days are
  skipped, not broken. Protected days hold the streak but pay no XP and are
  excluded from the completion rate.
- **Recurrence** — a deliberately small RRULE subset (DAILY/WEEKLY/MONTHLY/
  YEARLY with INTERVAL, BYDAY, COUNT, UNTIL). Anything outside it is *rejected*
  at validation rather than silently stored as a rule that will never run.

All are unit-tested.

## 8. What is not built

Stated plainly rather than left to be discovered:

- **Education module** — see §5.
- **Finance and Health domains** — Development Master §16 puts them lowest
  priority deliberately, and §22 sequences them to Phase 5. No design exists.
- **Automation engine** — Development Master §21 explicitly moves trigger →
  condition → action to Phase 5+, after the core loop is proven in daily use.
- **Kanban and Timeline task views** — UI/UX §12-14 ships List and Today first
  and sequences the others later. Both are built; Kanban is not.
- **Scheduled notifications** — the permission flow and settings exist and
  persist, but nothing is scheduled yet. Nothing claims otherwise in the UI.
- **AI conversation persistence** — the schema (`aiConversations`,
  `aiMessages`, `aiMemories`) exists and usage logging is live, but the coach
  currently holds a conversation in component state only. It does not survive a
  reload.
- **End-to-end browser test suite** — Tech Spec §16 cuts it explicitly for a
  solo single-device build, in favour of unit tests on the logic that corrupts
  data plus manual verification. The critical flows were verified by hand in the
  browser (see the session notes): onboarding → goal → task → complete → XP,
  achievement and goal rollup propagating, and persistence across a hard reload.

## 9. Implementation audit

A full audit was run against the design, the Dev Master, the Tech Spec and this
document. Everything below was found and fixed; nothing was added to the product
surface and no approved functionality was removed.

**Data integrity**

- `hydrate()` awaited 25 reads sequentially inside one IndexedDB transaction. A
  transaction auto-commits once its request queue drains, so it could close
  mid-loop and the remaining reads would never resolve — presenting as the app
  hanging on the boot skeleton, which was observed once. All requests are now
  issued synchronously before the first await. `persist()` had the same shape
  and got the same fix.
- **Import could destroy data.** `replaceAll` cleared in one transaction and
  wrote in another, so a failure between them wiped the database and restored
  nothing. Clear and write now share a single transaction: an import either
  fully replaces the database or leaves it untouched. Covered by tests.

**Decorative controls (master prompt §14)**

Six approved settings had *zero* consumers — `toastReminders`,
`deadlineWarnings`, `habitNudges`, `achievementAlerts`, `quietHours` and
`ambientMotion`. They persisted but changed nothing.

Rather than delete approved settings or fake the deferred scheduler, the
in-app half of the reminder system was implemented in `domain/nudges.ts`:
at-risk habit streaks, overdue tasks, and goals or projects due within a week,
surfaced as a dashboard banner and optionally a toast, suppressed during quiet
hours. Every one of the six now changes observable behaviour, and the
Notifications screen states plainly that background delivery is not built.
`atRiskHabits`, which was written and tested but never wired up, now drives the
habit nudge.

**Functional bugs**

- The palette's "New goal" and "New project" commands discarded the chosen type
  and opened Quick Capture on Task. The type is now threaded through.
- Calendar resize wrote to IndexedDB on **every pointermove** — dozens of
  transactions per gesture. It now previews locally and commits once on release.
- Achievement toasts printed the raw id ("first blood"). They use the real name.
- A reminder toast added during this audit used the `error` tone, which is
  deliberately persistent so failed writes are never missed; reminders stacked
  up and never dismissed. Caught in the browser, not by tests.

**Design fidelity**

The approved design has a SKELETON LOADING artboard — title bar, four-up stat
grid, then the 1.55fr/1fr split — that was never implemented. `ScreenSkeleton`
reproduces that geometry and is now the boot and route-transition fallback.

**Accessibility**

- `--c-text-ghost` (#6A6B74) measured **3.5:1** on the card background and is
  used for roughly fifty hint and meta strings — below the 4.5:1 AA threshold.
  Lightened to #7E7F88 (4.7:1), the closest passing value to the original.
- Link colour used `--c-accent` at **2.6:1**. Links now use the accent tint at
  5.8:1.
- A live DOM sweep found no unnamed controls, no unlabelled inputs, one `h1`,
  three labelled landmarks and a working skip link.

**Dead code** removed: `usePrefersReducedMotion`, `AsyncState`, `SkeletonList`,
`Alert`, `Chip`, `ChartFrame`, `formatRecurrence`, `Tx.hardDelete`, the
`SINGLETON` set, and three pointless re-exports.

## 10. Dependencies

Runtime dependencies are `react`, `react-dom` and `react-router-dom`. Nothing
else. Per master prompt §60 the following were considered and deliberately
written by hand instead:

- an IndexedDB wrapper (`idb`) — ~120 lines of promise wrapping, and the
  transaction semantics matter enough to own
- a charting library — the design specifies four simple SVG forms
- a colour library — three functions, used only for accent tints
- a date library — the timezone strategy is the interesting part, and it is one
  documented module (`domain/dates.ts`)
