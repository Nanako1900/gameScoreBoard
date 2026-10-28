import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordItem, User } from './types';
import { ApiError, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { bootRouter, currentPath, goBack, navigate, requestNavigation, useLocation } from './lib/router';
import { HOME_PATH, WELCOME_PATH, parseRoute, playerPath, routeCoversHome } from './lib/routes';
import { useRouteLayout } from './lib/useRouteLayout';
import { useEntryTarget } from './lib/useEntryTarget';
import { withoutParams } from './lib/deepLink';
import { caseViewerScope, type PinnedCase } from './lib/useCaseLookup';
import { recordForViewer } from './lib/recordViewer';
import { computeCounts, computeTrends } from './lib/feedStats';
import { CHANGE_KEYS } from './lib/coreData';
import { useCoreData } from './lib/useCoreData';
import { visibleRefreshKeys } from './lib/refreshPolicy';
import { useVisibleRefresh } from './lib/useVisibleRefresh';
import { useResetWatch } from './lib/useResetWatch';
import { useTabTitle } from './lib/useTabTitle';
import { clearAllDrafts } from './lib/drafts';
import { clearLoginReturn } from './lib/loginReturn';
import { hasLegacyTarget } from './lib/loginReturnShape';
import { clearWelcomeReturn, readWelcomeReturn, saveWelcomeReturn } from './lib/welcomeReturn';
import { competitionRanks } from './lib/rank';
import { ToastProvider, useToast } from './components/Toast';
import { StaleNotice } from './components/StaleNotice';
import { Header } from './components/Header';
import { HomeOverview } from './components/HomeOverview';
import { CaseDialog } from './components/CaseDialog';
import { StatementDialog } from './components/StatementDialog';
import { DiscordLinkedNotice } from './components/DiscordLinkCard';
import { LinkMissingNotice } from './components/LinkMissingNotice';
import { RouteView } from './components/RouteView';
import type { BoardData } from './components/BoardPage';
import { boardPath } from './lib/routes';
import { COUNTDOWN_TICK_MS } from './lib/constants';
import { buildTodo, meNeedsAttention, todoBadgeCount } from './lib/todo';
import { readOnboardingDismissed, dismissOnboarding, clearTodoMarks } from './lib/todoMarks';
import { useTodoSources } from './lib/useTodoSources';
import { useNow } from './lib/useNow';
import { Skeleton } from './components/Skeleton';
import { Link } from './components/Link';
import './app.css';

/** Toasts sit outside AppMain so every child — and every dialog — can raise one. */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppMain />
    </ToastProvider>
  );
}

function AppMain(): JSX.Element {
  // Before anything reads the address: mark the entry this tab landed on (router.ts).
  useState(bootRouter);
  const location = useLocation();
  const layout = useRouteLayout();
  const { state, refresh, setMe } = useCoreData();
  const toast = useToast();
  const [welcomeEntry] = useState(() => {
    const { pathname, search } = window.location;
    const params = new URLSearchParams(search);
    // OAuth is a full navigation; retain only the ordinary destination in this tab.
    const explicitTarget = hasLegacyTarget(pathname, search)
      || !['home', 'welcome', 'notFound'].includes(location.route.name);
    const resumed = !explicitTarget && (params.get('linked') === 'discord' || location.route.name === 'welcome')
      ? readWelcomeReturn() : null;
    const entryPath = resumed ?? pathname + search;
    const queryAt = entryPath.indexOf('?');
    const entryLocation = { pathname: queryAt < 0 ? entryPath : entryPath.slice(0, queryAt),
      search: queryAt < 0 ? '' : entryPath.slice(queryAt) };
    const route = parseRoute(entryLocation.pathname);
    const rest = withoutParams(entryLocation.search, ['onboarding', 'linked', 'case', 'session']);
    return { requested: params.get('onboarding') === '1' || params.get('linked') === 'discord' || resumed !== null,
      rest, entryPath, entryLocation,
      returnTo: !['home', 'welcome', 'notFound'].includes(route.name) ? entryLocation.pathname + rest : undefined };
  });
  const [welcomePending, setWelcomePending] = useState(welcomeEntry.requested);
  const welcomeRedirected = useRef(false);
  const [statementCase, setStatementCase] = useState<RecordItem | null>(null);
  const [todoRefreshKey, setTodoRefreshKey] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(readOnboardingDismissed);
  // ?linked=discord is where the API lands the browser after a successful bind.
  // Read once at mount; the effect below strips it so a reload doesn't repeat it.
  const [discordLinked, setDiscordLinked] = useState(
    () => new URLSearchParams(window.location.search).get('linked') === 'discord',
  );
  // The case an old ?case= link or /cases/:id resolved: its page shows it without a second GET.
  const [pinnedState, setPinnedState] = useState<{ scope: string; value: PinnedCase } | null>(null);
  // Bumped when a statement is judged: the player page behind the dialog reloads its cases.
  const [playerRefreshKey, setPlayerRefreshKey] = useState(0);

  const ready = state.status === 'ready' ? state.data : null;
  const visibleRecords = useMemo(() => ready?.records.map(record => recordForViewer(record, ready.me)) ?? [], [ready?.records, ready?.me]);
  const viewerScope = caseViewerScope(ready?.me ?? null);
  const viewerLease = useRef({ scope: viewerScope, generation: 0 });
  if (viewerLease.current.scope !== viewerScope) viewerLease.current = { scope: viewerScope, generation: viewerLease.current.generation + 1 };
  // A role returning to its old value does not revive a formerly privileged seed.
  const seedScope = JSON.stringify([viewerScope, viewerLease.current.generation]);
  const liveSeedScope = useRef(seedScope); liveSeedScope.current = seedScope;
  const pinned = pinnedState?.scope === seedScope ? pinnedState.value : null;
  const setPinned = useCallback((value: PinnedCase): void => {
    if (liveSeedScope.current === seedScope) setPinnedState({ scope: seedScope, value });
  }, [seedScope]);
  useEffect(() => {
    if (ready === null || !welcomeEntry.requested || welcomeRedirected.current) return;
    welcomeRedirected.current = true;
    saveWelcomeReturn(welcomeEntry.entryPath);
    navigate(WELCOME_PATH + welcomeEntry.rest, { replace: true });
  }, [ready, welcomeEntry]);

  // Entry requests remain in memory until the wizard explicitly finishes.
  const entryBlocked = useCallback(() => welcomePending, [welcomePending]);
  const { linkMissing, dismissLinkMissing } = useEntryTarget({
    ready: ready !== null, me: ready?.me ?? null, blocked: entryBlocked,
    onPinned: setPinned, welcomeEntry: welcomeEntry.requested, entryLocation: welcomeEntry.entryLocation,
    welcomeReturnTo: welcomeEntry.requested ? welcomeEntry.returnTo : undefined,
  });
  const rememberWelcomeReturn = useCallback((): void => {
    saveWelcomeReturn(welcomePending ? welcomeEntry.entryPath
      : location.route.name === 'settings' ? location.pathname + location.search : null);
  }, [welcomePending, welcomeEntry, location]);
  const finishWelcome = useCallback((): void => {
    clearWelcomeReturn();
    navigate(HOME_PATH);
    setWelcomePending(false);
  }, []);

  // Every destination uses its own address and an ordinary full page.
  const openRoute = useCallback(
    (path: string): void => navigate(path),
    [],
  );
  const openPlayer = useCallback((id: string): void => openRoute(playerPath(id)), [openRoute]);

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
    clearLoginReturn();
    clearWelcomeReturn();
    clearTodoMarks();
    window.location.reload();
  }, []);

  const handleMeUpdated = useCallback((user: User): void => {
    setMe(user);
    void refresh(CHANGE_KEYS);
  }, [setMe, refresh]);

  // Every write a child reports — incl. the admin's 改分/设裁判/改判/撤销 —
  // invalidates the board, the feed and me; config and the report stay.
  const handleChanged = useCallback((): void => {
    void refresh(CHANGE_KEYS);
    setTodoRefreshKey((n) => n + 1);
  }, [refresh]);

  const handleVisible = useCallback((): void => {
    if (!ready) return;
    void refresh(visibleRefreshKeys(ready.config.nextResetAt, Date.now()));
    setTodoRefreshKey((n) => n + 1);
  }, [ready, refresh]);
  useVisibleRefresh(handleVisible);

  // Past nextResetAt: GET /api/config runs the weekly heal and returns next
  // week's reset, so it goes first; refresh runs one at a time, so the board
  // and my score are read after it.
  const handleResetCrossed = useCallback((): void => {
    void refresh(['config']);
    void refresh(['leaderboard', 'me']);
  }, [refresh]);
  useResetWatch(ready?.config.nextResetAt ?? null, handleResetCrossed);


  // The admin re-rolls the weekly report's prose: nothing but the report changes.
  // It used to reject unhandled on failure; now the admin is told.
  const handleRegenerate = useCallback(
    (week: string): void => {
      setRegenerating(true);
      void regenerateReport(week)
        .then(
          () => refresh(['report']),
          (err: unknown) => {
            toast.show({
              tone: 'error',
              message: err instanceof ApiError ? `战报没换成新说法：${err.message}` : '战报没换成新说法，请稍后重试',
            });
          },
        )
        .finally(() => setRegenerating(false));
    },
    [refresh, toast],
  );

  const trends = useMemo(
    () => (ready ? computeTrends(ready.records, ready.config.nextResetAt) : {}),
    [ready],
  );
  const counts = useMemo(() => (ready ? computeCounts(ready.records) : {}), [ready]);
  const board = useMemo<BoardData | undefined>(() => {
    if (!ready) return undefined;
    const lastWeek = lastWeekStartOf(ready.config.nextResetAt);
    return { participants: ready.participants, records: visibleRecords, report: ready.report, trends, counts,
      reportStale: lastWeek !== null && ready.report !== null && ready.report.week_start < lastWeek,
      regenerating, onSelectUser: openPlayer,
      onRegenerate: ready.me?.is_admin && ready.report ? () => handleRegenerate(ready.report!.week_start) : undefined };
  }, [ready, visibleRecords, trends, counts, regenerating, openPlayer, handleRegenerate]);

  const now = useNow(COUNTDOWN_TICK_MS);
  const extra = useTodoSources({ me: ready?.me ?? null, pendingAppeals: ready?.pending.appeals ?? 0, refreshKey: todoRefreshKey });
  const items = useMemo(() => ready?.me ? buildTodo({ me: ready.me, now, pending: ready.pending, myPending: ready.myPending,
    feed: visibleRecords, appealed: extra.appealed, discord: extra.discord,
    onboardingDismissed }) : [], [ready, visibleRecords, now, extra.appealed, extra.discord, onboardingDismissed]);
  useTabTitle(todoBadgeCount(items));
  if (state.status === 'loading') {
    return <div className="app"><Header pending config={null} me={null} onLogout={() => {}} onOpenOnboarding={() => {}} />
      <main className="app__main" aria-busy="true"><span className="visually-hidden" role="status">信誉分加载中…</span>
        <Skeleton label="要你处理加载中" /><Skeleton label="最近案件加载中" /><Skeleton label="信誉榜加载中" />
      </main></div>;
  }

  if (state.status === 'error') {
    return (
      <div className="app app--center">
        <div className="app__error panel" role="alert">
          <h1 className="app__error-title">出错了</h1>
          <p className="app__error-msg">{state.message}</p>
          <button type="button" className="btn btn--gold" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const { config, participants, me, report } = state.data;
  // A page (phone) or NotFound replaces the lobby; it stays mounted, only hidden (contract §8 #6).
  const covered = routeCoversHome(location.route, layout);
  const canRecord = me?.is_judge === true || me?.is_admin === true;
  const filing = location.route.name === 'tools' && location.route.tab === 'filing';
  // MyScoreLine's 第 N 名: the board's own competition ranking (P0-4's rank.ts).
  const myIndex = me ? participants.findIndex((p) => p.id === me.id) : -1;
  const myRank = myIndex >= 0 ? competitionRanks(participants.map((p) => p.score))[myIndex] : null;

  const myPath = me ? playerPath(me.id) : '/';
  const dismissHomeOnboarding = (): void => {
    const item = items.find((item) => item.kind === 'onboarding');
    if (me && item?.kind === 'onboarding') setOnboardingDismissed(dismissOnboarding(me.id, item.missing, now));
  };
  return (
    <div className="app">

      <Header
        layout={layout} route={location.route} myPath={myPath} meDot={meNeedsAttention(items)} todoCount={todoBadgeCount(items)}
        config={config}
        me={me}
        onLogout={() => requestNavigation(() => { void handleLogout(); })}
        onOpenOnboarding={() => navigate(WELCOME_PATH)}
      />

      <div className="app__notices">
        {state.stale && <StaleNotice message={state.stale.message} onRetry={() => void refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))} />}
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={dismissLinkMissing} />}
      </div>
      <main className="app__main" hidden={covered}>
        <HomeOverview me={me} config={config} rank={myRank} items={extra.settled ? items : null}
          records={visibleRecords} report={report} onOpenPlayer={openPlayer} now={now}
          reportStale={board?.reportStale} onDismissOnboarding={dismissHomeOnboarding} />
      </main>

      <RouteView
        board={board}
        todoItems={extra.settled ? items : null}
        now={now}
        discordRead={extra.discordRead}
        onDiscordChanged={extra.setDiscord}
        onMeUpdated={handleMeUpdated}
        onWelcomeDone={finishWelcome}
        onBeforeWelcomeBind={rememberWelcomeReturn}
        onRetryDiscord={() => setTodoRefreshKey((n) => n + 1)}
        welcomeNotice={discordLinked ? <DiscordLinkedNotice onDismiss={() => setDiscordLinked(false)} /> : null}
        location={location}
        layout={layout}
        me={me}
        config={config}
        pinned={pinned}
        playerRefreshKey={playerRefreshKey}
        onPinned={setPinned}
        onChanged={handleChanged}
        onOpenStatement={setStatementCase}
      />

      <footer className="app__footer">
        <nav aria-label="帮助"><Link to={boardPath('rules')}>计分规则</Link><Link to="/guide">机器人指南</Link><Link to={WELCOME_PATH}>入户向导</Link></nav>
        <p>EDG 信誉分 · 守约，让开黑更简单。</p>
      </footer>

      {canRecord && me && (
        <main className="app__page app__filing" hidden={!filing}>
        <CaseDialog
          key={me.id}
          open={filing}
          variant="page"
          onClose={() => { if (currentPath().split('?')[0] === '/tools/filing') goBack(); }}
          participants={participants}
          selfId={me.id}
          config={config}
          onCreated={handleChanged}
        />
        </main>
      )}

      {statementCase && (
        <StatementDialog
          key={statementCase.id}
          open
          record={statementCase}
          config={config}
          score={me?.score}
          onClose={() => setStatementCase(null)}
          onDecided={() => {
            handleChanged();
            setPlayerRefreshKey((n) => n + 1);
          }}
        />
      )}

    </div>
  );
}
