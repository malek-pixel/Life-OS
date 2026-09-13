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

## 11. Motion system

The app had a motion vocabulary from the design — an entrance, a stagger, a press
curve — but durations and easings were written inline at roughly forty call
sites, and `tokens.ts` exported a `motion` object that was almost entirely
unused: only the two easing curves reached CSS. Timing could therefore drift per
component, which is what makes an interface feel assembled rather than designed.

**One scale, emitted as variables.** `motion` in `tokens.ts` is now the single
source of rhythm and is emitted wholesale as `--m-*`. The bands are chosen by how
much of the screen a change occupies — `micro` for a colour or icon, `fast` for
one control, `standard` for a region, `emphasis` for a whole view — which is what
keeps unrelated components feeling related. Exits run shorter than their
entrances and accelerate, so a departing element never delays the user. No
stylesheet writes a bare duration any more, including the two ambient loop
periods and the tooltip delay.

**Only transform and opacity are animated.** A live audit of every shipped CSS
rule confirms it, with one deliberate exception: the sidebar animates `width` on
collapse, because the content region genuinely has to reclaim the space. Two
layout-animating transitions were removed — the row hover indent (`padding-left`,
which reflowed the row and everything below it on every frame) and the toggle
knob (`left`, now `translateX`). Progress bars express their value as `scaleX`
rather than a width percentage, so one transition covers both the entrance and
every later change.

### Bugs found and fixed

- **Skeletons were invisible.** `.los-skel` was referenced by the Skeleton
  component and by the ambient-motion override, but no rule ever gave it a fill.
  Every skeleton in the app — the boot screen, each route transition, the card
  lists — rendered as an empty div, so loading looked like a blank page rather
  than a pending one. This included the `ScreenSkeleton` added in §9.
- **The mobile navigation drawer could never open.** The overlay sidebar is
  mounted *by* the drawer opening, and its close-on-navigate effect fired on
  mount, calling `onNavigate` and closing the drawer on the same tick. The
  hamburger did nothing at any width below 820px. Only a real route change
  dismisses it now.
- **Statistics could display a number that was not the value.** The count-up
  read its starting point out of an effect-cleanup closure, which holds whatever
  the value was when that effect was created rather than what is on screen. A
  retarget could then compute `from === target`, skip the animation, and leave
  the tile stranded. The live value is held in a ref instead.
- **Statistics depended on `requestAnimationFrame` to be correct.** rAF does not
  run in a background tab, so a dashboard rendered while hidden kept its starting
  zero — reporting 0 XP against a ledger that said 170. Both the count-up and the
  progress bars now have a timeout that converges on the true value whether or
  not a frame ever runs. The animation is the enhancement; arriving is not.
- **A negative statistic counted the wrong way.** XP for a day goes negative once
  an undo has appended its compensating event. The sign was treated as a fixed
  prefix and the magnitude rolled up from zero, rendering "-0" on the first frame.
- The scrim used the *fade-up* keyframe, translating the entire fixed overlay —
  backdrop and dialog together — instead of simply darkening the page. The
  detail drawer reused the *toast* keyframe, a 16px nudge, for a 480px panel
  anchored to the window edge. Toasts had no exit at all and were torn out of the
  DOM mid-life. The navigation drawer and its backdrop had no motion whatsoever.

### Added

Only where something was missing or dishonest, per master prompt §14:

- **A sliding tab indicator.** The selected pill teleported between tabs; it now
  travels, measured in a layout effect so it is correct on first paint.
- **Navigation hover.** The sidebar rail had no hover response at all.
- **A real tooltip for the collapsed rail,** replacing the native `title` — which
  cannot be styled and waits about a second. It is positioned fixed and portalled
  to the body because the rail scrolls: a CSS-only tooltip is clipped by that
  `overflow: auto` and never appears, which would have been a decorative control
  that does nothing. The accessible name is a visually-hidden label, not the
  tooltip, because hover text names nothing to a screen reader.

### Removed

Four dead keyframes (`losBlink`, `losAmbient`, `losRing`, and `losBarGrow` once
bars became transform-driven), and the `.los-bar-fill` class. The stagger was
capped at six steps: beyond that the delays compounded far enough that the last
card visibly lagged.

### Reduced motion

CSS collapses every duration from both the OS setting and the in-app one. That
reaches nothing JS-driven, so `usePrefersReducedMotion` watches the media query
*and* the `data-reduce-motion` attribute, and the count-up returns its target
immediately rather than animating. Verified in the browser both ways.

## 12. Production-completion audit

A twelve-phase audit of the running product - not just the code - against the
design, the Dev Master, the Tech Spec and this document. Nothing below adds
product surface; each item was either broken, silently wrong, or missing from
an approved requirement.

### Data integrity

- **Concurrent actions corrupted the XP ledger.** Every action reads current
  state from memory, decides what to write, then awaits its IndexedDB commit.
  Nothing ordered actions against each other, so five rapid clicks on one
  checkbox all read an open task and all awarded XP. Five ledger events, one
  cached increment, and the cache no longer matched the ledger. The same race
  lost XP when two *different* tasks completed close together. Every exported
  action now runs through a single serial write queue in `actions.ts`, so an
  action reads state only after the previous one has committed. A single
  transaction was always atomic; now transactions are also ordered. Covered by
  tests that fail without the queue.
- **"Clear all data" could leave data behind.** `clearAllData` awaited each
  store's clear inside one transaction - the same auto-commit defect fixed in §9
  for `hydrate` and `persist`, missed here. It now issues every clear before the
  first await.
- **Search crashed on a malformed row.** Import only checks rows for an `id`, so
  an older or hand-edited export with a note missing its `content` crashed
  search, and the command palette with it. Search now coerces text fields.
- A reminder test mixed `Date.now()` with a fixed clock and passed or failed
  depending on the day it ran. All its dates are now relative to the fixed clock.

### Clean install

There is no seed, demo or fixture path anywhere in `src/`. A fresh browser
profile holds exactly two rows - the settings and character singletons - and
opens at setup. Verified in a new profile, through onboarding, the first task,
habit and goal, and a hard reload.

The development data from earlier sessions only ever lived in one local browser
profile and cannot ship: the build contains no data, and IndexedDB is per-origin
and per-profile. For anyone with such a profile, **Settings → Data → Clear all
data** is the clean reset. It now also forgets the API key: the key lives in
browser storage rather than IndexedDB, so the wipe did not reach it, leaving a
credential behind after "clear everything".

### Error recovery

- A write that failed inside a click handler with no `try/catch` became an
  unhandled rejection and the user saw nothing - which reads as success. Eight
  handlers were like this. `ToastProvider` now turns any unhandled rejection into
  a persistent error toast, with the user-facing message from `toAppError`, never
  the raw exception. Verified that internal error text does not leak.
- Rapid repeated clicks on a task checkbox or the task panel's Complete button
  produced a stack of duplicate toasts. Both are guarded now. The data was already
  protected by the write queue.
- The AI coach had no timeout: a hung connection spun until someone noticed Stop.
  Turns are now abandoned after 60 seconds, with a message that distinguishes a
  timeout from a cancellation. Leaving the screen mid-request also aborts it;
  previously the request and its tool loop kept spending API quota.

### Performance at realistic scale

`test/scale.test.ts` loads a heavy year of data - 3,000 tasks, 40 habits logged
daily for a year, 500 notes, a ledger of over 10,000 events - and times every
screen's selector *after a write*, which is the moment that matters.
`selectHabits` (streaks walk each habit's history) was about 150ms and the
dashboard called it twice, so each checkbox click cost about 300ms. It is now
memoized on the store version and called once. For that cache key to be safe,
the store version is never reset, not even by the test seam. Every other
selector is well under budget.

### Responsive

The design is desktop-only (UI/UX §40), but at phone width several screens
clipped content past the right edge. **Settings** kept its menu and panel side
by side and crushed each row to one word per line. **Projects'** and
**Calendar's** headers overflowed, and the top bar pushed Capture off-screen.
Each fix is a media query scoped to where it broke, so the desktop layout is
unchanged. A sweep of every route at 375, 430 and 768px now finds no clipped
content and no horizontal overflow. The task checkbox, drawn at 19px, has an
invisible halo taking its target to 31px (WCAG 2.2, 2.5.8).

### Accessibility

A sweep of all 23 routes found one unnamed control: the hidden file input behind
**Import**, which was still in the tab order. It is removed from the tab order
and named.

### Production

- Favicon (inline SVG, so no request and no `/favicon.ico` 404), description,
  `theme-color`, `robots: noindex` (a single-user local app has nothing to index),
  and a `<noscript>` explanation.
- Page titles follow the route ("Tasks · Life OS"), from the same source as the
  breadcrumb, so history entries and bookmarks identify the screen.
- Verified: no source maps in `dist/`, no key-shaped strings in the bundle, no
  `.env` ever committed, and the only `VITE_` variable is a non-secret endpoint
  override. `.env.example` described the key as stored in localStorage; corrected.
- Deep-link refresh works on any static host because routing is hash-based (§1).

### Known limitations, not fixable within this architecture

- **The API key is readable by any script on the page.** See §6. Only a server
  holding the key would fix this.
- **Google Fonts is a third-party request.** No user data is sent, but it tells
  Google the app was opened, and offline the fonts fall back to the system stack.
  Self-hosting the two families would remove the request. That is a
  dependency/asset change rather than a defect, so it is listed as future work.
- **One browser profile holds the only copy of the data.** No sync and no backup
  by design; Export is the mitigation.
- **Duplicate XP events already written by the concurrency bug stay in the
  ledger.** It is append-only by design. Settings → Data → Rebuild realigns the
  cached total with the ledger, and was verified doing exactly that.

## 13. Private deployment: authentication, AI proxy, iPhone

**Supersedes §2 and §6 for deployed builds, at the owner's explicit request.**
The app is now deployed publicly and used from an iPhone Home Screen, so it needs
real, server-enforced access control and a server-held AI key.

### What stays the same

All application data stays in IndexedDB on the device. There is no database, no
sync and no user table. Nothing about the data model, the XP ledger or the action
layer changed. The server holds no user data, so there is nothing on it for an
attacker to read or modify.

### Authentication (server/auth.js, server/gate.js, middleware.js)

- **One owner, no registration.** The only credential is `LIFEOS_PASSWORD_HASH`,
  set in the host environment. There is no sign-up route, no user table, no
  default account and no way to create one from the web.
- **The password is never stored.** PBKDF2-SHA256, 600,000 iterations, random
  salt, generated locally by `npm run auth:setup`.
- **Sessions** are HMAC-SHA256-signed tokens in an `HttpOnly; Secure;
  SameSite=Strict` cookie: 30 days, renewed daily on use. Page script cannot read
  the cookie, other sites cannot send it, and it cannot be forged without
  `LIFEOS_SESSION_SECRET`. Each token carries a fingerprint of the password hash,
  so changing the password - or rotating the secret - signs out every device.
- **Enforced before anything is served.** Vercel Routing Middleware runs the gate
  on every request. Signed-out visitors get only the sign-in page, its CSS and JS,
  the logo, the manifest and the icons. The app HTML, **every JS/CSS bundle** and
  every API route are refused. Gating the bundle as well as the page matters: a
  client-side check inside downloadable JavaScript could simply be skipped.
- **Fails closed.** A missing or malformed hash or secret means nobody can sign in.
- **Brute force** is slowed by the PBKDF2 cost, a minimum 750ms failure time, and
  a rate limit of 5 attempts per address and 20 overall per 15 minutes.
- **CSRF.** SameSite=Strict, plus an independent Origin/Sec-Fetch-Site check on
  every state-changing endpoint. Redirects always go to fixed same-origin paths,
  so there is no open redirect.
- **Client side (src/app/session.ts).** The session is confirmed before React
  mounts, so no private screen flashes. It is re-checked whenever the app may have
  resumed without a reload - Home Screen resume, Back after signing out (bfcache),
  and every 10 minutes while visible. A network failure is not treated as signed
  out, so losing signal does not lock you out of your own local data.

### AI (server/handlers.js `aiChat`)

`GROQ_API_KEY` lives only in the server environment. Production builds send coach
requests to `/api/ai/chat`, which checks the session itself (in addition to the
gate), allow-lists the model, caps output tokens and body size, rate-limits, and
adds the key upstream. The browser never receives the key, and the direct
browser-to-Groq path is compiled out of the production bundle (verified: no
`api.groq.com` in `dist/`). The browser-held key remains only for `npm run dev`.

### Security headers (vercel.json)

A strict CSP (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors
'none'`), HSTS, nosniff, no-referrer, COOP, Permissions-Policy and noindex. HTML
is `no-store`, so Back after sign-out cannot show a cached app. Hashed assets are
cacheable only privately. Google Fonts is gone: both families are self-hosted, so
the app makes no third-party requests. `font-src` allows `data:` because Vite
inlines the smallest font subsets - found by testing the real bundle under the
CSP, where the fonts were otherwise blocked.

### iPhone / Home Screen

Manifest and Apple web-app metadata, standalone display, `viewport-fit=cover` with
safe-area padding on the top bar, content, drawers and toasts, `100dvh` instead of
`100vh`, 16px inputs on touch devices (iOS zooms the page on anything smaller),
and 44px touch targets on coarse pointers. A sweep of 30 routes at 375, 390, 393,
430 and 768px found no horizontal scrolling or clipped content, and reduced
controls under 40px from 188 to a handful that still clear WCAG 2.2's 24px
minimum. Every rule is conditional, so the desktop layout is unchanged (verified:
main padding and compact button sizes identical to before).

Destructive confirmations now open with **Cancel** focused, so a reflexive Enter
cannot clear data. Focus returns to the control that opened a dialog; it
previously did not, because the trigger was recorded after `autoFocus` had
already moved focus into the dialog.

The mark and wordmark follow the owner-supplied logo: a folded crimson L and
"LIFE OS". All icon sizes, the favicon and the in-app mark are generated from one
vector definition in `scripts/make-icons.js`.

### Limitations that remain

- **Per-instance rate limiting.** Serverless instances do not share memory, so the
  login limit applies per warm instance, not globally, and a distributed attacker
  gets more attempts. Mitigations: the PBKDF2 cost and a long random passphrase. A
  shared limiter would need a store such as Upstash/Vercel KV.
- **No second factor.** A single strong passphrase is the credential. Passkeys or
  TOTP would be the next hardening step.
- **Home Screen and Safari are separate storage on iOS.** Data created in Safari
  does not appear in the Home Screen app and vice versa, and each needs its own
  sign-in. Use the Home Screen app, or move data with Export/Import.
- **Data is per device.** The iPhone and a desktop browser hold separate
  databases. Sign-in protects access; it does not sync.
- **A signed-out device still holds its data.** Signing out gates the app, but
  IndexedDB stays on the device. Settings → Data → Clear all data removes it.
- **No offline launch.** There is deliberately no service worker: a cached app
  shell would open without the server confirming the session. The app needs a
  connection to open; once open, it keeps working offline.
- **Physical iPhone not tested.** Verified in browser emulation at iPhone widths
  with touch pointers. Standalone launch, the on-screen keyboard and Keychain
  autofill need a check on the device itself.

## 14. Cross-device sync

**Amends §13 ("no database, no sync") at the owner's request**, after using the
app on a laptop and an iPhone and finding two separate copies of their data.

- **Local-first stays.** IndexedDB is still the working copy on every device and
  the app still works offline. Sync is a background reconciliation, not a
  server round trip per action.
- **Storage:** Upstash Redis (Vercel Storage), read through `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
  Without them `/api/sync` answers `sync_not_configured` and every device keeps
  working alone, exactly as before.
- **Unit of sync is the row.** Each device records changed rows in an outbox
  in the same IndexedDB transaction as the change, pushes them, and pulls rows
  changed since a server sequence cursor. Conflicts: newest change time wins per
  row. Hard deletes travel as tombstones; soft deletes are ordinary updates.
- **Joining.** A device's first sync pulls everything first, and the server copy
  wins for any row both have (settings, the character rollup), so a new phone's
  defaults cannot overwrite the laptop's real settings. Its other rows upload.
- **XP.** The ledger rows sync; the cached rollup is rebuilt from the ledger
  whenever XP events arrive from another device.
- **Clear all / import** now apply to every synced device.
- **Security.** `/api/sync` checks the session itself as well as the gate, and
  refuses cross-site writes. The data is now stored on the server (Upstash,
  encrypted at rest by the provider, behind the Redis token that only the
  server holds) — a deliberate change from "the server holds no user data".

**Limits.** Last-writer-wins is per row, not per field: editing the same note on
two offline devices keeps the later edit only. Achievement unlocks earned on two
devices at once can both arrive. Device clocks decide order, so a badly wrong
clock can lose an edit.
