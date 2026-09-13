/**
 * Application shell and routing.
 *
 * Holds the frame the design defines - sidebar, top bar with breadcrumb and
 * search, scrolling content region - plus the global overlays (command palette,
 * quick capture) and the boot sequence.
 *
 * One deliberate deviation from the design, documented in docs/DECISIONS.md:
 * the mockup draws a Windows title bar with minimise/maximise/close buttons.
 * In a browser those would be three controls that do nothing, which master
 * prompt section 14 forbids outright. The OS chrome is dropped; everything
 * below it is reproduced.
 *
 * Screens are lazily loaded so the initial bundle carries only the shell and
 * the dashboard rather than all twenty routes.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import { TopBar, breadcrumbFor } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from './QuickCapture';
import { ThemeProvider } from './ThemeProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { useHotkey, useSettings, useStoreStatus, useViewport } from './hooks';
import { store } from '../data/store';
import { updateSettings } from '../data/actions';
import { SYNC_AVAILABLE, startSync, syncNow } from '../data/sync';
import { ensurePlan2026 } from '../data/seeds/plan2026';
import { goToLogin } from './session';
import { ConfirmProvider, ToastProvider } from '../ui/overlays';
import { ErrorState, ScreenSkeleton } from '../ui/primitives';
import { messageForCode, type AppError } from '../data/errors';

/* --- lazily loaded screens --- */
const Dashboard = lazy(() => import('../features/dashboard/DashboardScreen'));
const Goals = lazy(() => import('../features/goals/GoalsScreen'));
const GoalDetail = lazy(() => import('../features/goals/GoalDetailScreen'));
const Projects = lazy(() => import('../features/projects/ProjectsScreen'));
const ProjectDetail = lazy(() => import('../features/projects/ProjectDetailScreen'));
const Tasks = lazy(() => import('../features/tasks/TasksScreen'));
const Habits = lazy(() => import('../features/habits/HabitsScreen'));
const Routines = lazy(() => import('../features/routines/RoutinesScreen'));
const Calendar = lazy(() => import('../features/calendar/CalendarScreen'));
const Fitness = lazy(() => import('../features/fitness/FitnessScreen'));
const Journal = lazy(() => import('../features/journal/JournalScreen'));
const Notes = lazy(() => import('../features/notes/NotesScreen'));
const Analytics = lazy(() => import('../features/analytics/AnalyticsScreen'));
const AiCoach = lazy(() => import('../features/ai/AiCoachScreen'));
const LifeMap = lazy(() => import('../features/lifemap/LifeMapScreen'));
const Quests = lazy(() => import('../features/quests/QuestsScreen'));
const Achievements = lazy(() => import('../features/achievements/AchievementsScreen'));
const Reviews = lazy(() => import('../features/reviews/ReviewsScreen'));
const Timeline = lazy(() => import('../features/timeline/TimelineScreen'));
const Settings = lazy(() => import('../features/settings/SettingsScreen'));
const Search = lazy(() => import('../features/search/SearchScreen'));
const Onboarding = lazy(() => import('../features/onboarding/OnboardingScreen'));

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Boot />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

/**
 * Boot gate.
 *
 * Nothing renders against an unhydrated store: the app either shows the boot
 * skeleton, a storage error, or the real shell. This is why no screen has to
 * defend against half-loaded data.
 */
function Boot() {
  const { status, error } = useStoreStatus();
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    void store.hydrate();
  }, [retryKey]);

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const stop = startSync({ onUnauthenticated: goToLogin });
    // Pull what other devices already have before seeding the plan, so nothing
    // made there is duplicated here.
    void ensurePlan2026(() => (SYNC_AVAILABLE ? syncNow({ onUnauthenticated: goToLogin }) : Promise.resolve())).catch(
      (err) => console.error('[seed] plan 2026-27 could not be created', err),
    );
    return stop;
  }, [status]);

  if (status === 'error') {
    return (
      <main style={{ maxWidth: 560, margin: '18vh auto', padding: 24 }}>
        <ErrorState
          title="Life OS could not open its database"
          message={
            error && 'code' in error
              ? messageForCode((error as AppError).code)
              : 'Local storage is unavailable, so your data cannot be read. Private browsing or blocked site data is the usual cause.'
          }
          onRetry={() => setRetryKey((k) => k + 1)}
        />
      </main>
    );
  }

  if (status !== 'ready') return <BootSkeleton />;

  return <Shell />;
}

function BootSkeleton() {
  return (
    <div style={{ padding: 28 }}>
      <ScreenSkeleton />
    </div>
  );
}

function Shell() {
  const settings = useSettings();
  const { compact, narrow } = useViewport();
  const location = useLocation();

  // Tab title follows the route, from the same source as the breadcrumb, so
  // history entries and bookmarks say which screen they are.
  useEffect(() => {
    const crumbs = breadcrumbFor(location.pathname);
    const name = crumbs[crumbs.length - 1]?.label;
    document.title = name ? `${name} · Life OS` : 'Life OS';
  }, [location.pathname]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureType, setCaptureType] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Below the compact breakpoint the sidebar collapses regardless of the saved
  // preference - there simply is not room for it at full width.
  const collapsed = narrow ? false : compact || settings.sidebarCollapsed;

  useHotkey({ key: 'k', ctrl: true }, (event) => {
    event.preventDefault();
    setPaletteOpen((open) => !open);
  }, { allowInInput: true });

  useHotkey({ key: 'n', ctrl: true }, (event) => {
    event.preventDefault();
    setCaptureOpen(true);
  });

  // Onboarding owns the whole viewport until it is finished or skipped.
  if (settings.onboardingCompletedAt == null && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  if (location.pathname === '/onboarding') {
    return (
      <Suspense fallback={<BootSkeleton />}>
        <ErrorBoundary>
          <Onboarding />
        </ErrorBoundary>
      </Suspense>
    );
  }

  return (
    <div className="app-shell" style={{ display: 'flex', overflow: 'hidden' }}>
      <a className="los-skip" href="#main">
        Skip to content
      </a>

      {narrow ? (
        drawerOpen ? (
          <>
            {/*
              * Shares the overlay scrim class so the navigation drawer dims the
              * page exactly the way every modal and detail panel does, instead
              * of appearing instantly with no backdrop transition.
              */}
            <div
              onClick={() => setDrawerOpen(false)}
              className="scrim"
              style={{ zIndex: 39 }}
            />
            <Sidebar
              collapsed={false}
              onToggle={() => setDrawerOpen(false)}
              overlay
              onNavigate={() => setDrawerOpen(false)}
            />
          </>
        ) : null
      ) : (
        <Sidebar
          collapsed={collapsed}
          onToggle={() => void updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })}
        />
      )}

      <div className="grow stack" style={{ minWidth: 0, height: '100%' }}>
        <TopBar
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenCapture={() => setCaptureOpen(true)}
          onOpenNav={narrow ? () => setDrawerOpen(true) : undefined}
        />

        <main
          id="main"
          className="los-scroll grow"
          style={{ padding: '22px 26px 40px', minHeight: 0 }}
          // Re-running the entrance animation on navigation, as the design does.
          key={location.pathname}
        >
          <div style={{ maxWidth: 1180, margin: '0 auto' }} className="los-screen">
            <ErrorBoundary key={location.pathname}>
              <Suspense fallback={<ScreenSkeleton />}>
                <Routes>
                  <Route path="/" element={<Navigate to={settings.defaultScreen} replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/goals" element={<Goals />} />
                  <Route path="/goals/:id" element={<GoalDetail />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/projects/:id" element={<ProjectDetail />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/habits" element={<Habits />} />
                  <Route path="/routines" element={<Routines />} />
                  <Route path="/calendar" element={<Calendar />} />
                  <Route path="/fitness" element={<Fitness />} />
                  <Route path="/journal" element={<Journal />} />
                  <Route path="/notes" element={<Notes />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/ai" element={<AiCoach />} />
                  <Route path="/life-map" element={<LifeMap />} />
                  <Route path="/quests" element={<Quests />} />
                  <Route path="/achievements" element={<Achievements />} />
                  <Route path="/reviews" element={<Reviews />} />
                  <Route path="/timeline" element={<Timeline />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/:section" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onCapture={(type) => {
          setPaletteOpen(false);
          // Carry the chosen type through, so "New goal" in the palette opens
          // capture on Goal rather than silently defaulting to Task.
          setCaptureType(type);
          setCaptureOpen(true);
        }}
      />
      <QuickCapture
        open={captureOpen}
        initialType={captureType}
        onClose={() => {
          setCaptureOpen(false);
          setCaptureType(null);
        }}
      />
    </div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (
    <ErrorState
      title="No such screen"
      message="That route does not exist in Life OS. The dashboard is a good place to restart from."
      onRetry={() => navigate('/dashboard')}
      retryLabel="Go to dashboard"
    />
  );
}
