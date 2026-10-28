import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordItem, User } from './types';
import { ApiError, AUTH_LOGIN_URL, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { bootRouter, navigate, requestNavigation, useLocation } from './lib/router';
import { HOME_PATH, WELCOME_PATH, parseRoute, playerPath, routeCoversHome } from './lib/routes';
import { useRouteLayout } from './lib/useRouteLayout';
import { useEntryTarget } from './lib/useEntryTarget';
import { withoutParams } from './lib/deepLink';
import type { PinnedCase } from './lib/useCaseLookup';
import { computeCounts, computeTrends } from './lib/feedStats';
import { DISCORD_INVITE_URL } from './lib/env';
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
import { WelcomeCard } from './components/WelcomeCard';
import { CaseDialog } from './components/CaseDialog';
import { StatementDialog } from './components/StatementDialog';
import { MyScoreLine } from './components/MyScoreLine';
import { WeeklyReportCard } from './components/WeeklyReportCard';
import { DiscordLinkedNotice } from './components/DiscordLinkCard';
import { LinkMissingNotice } from './components/LinkMissingNotice';
import { RouteView } from './components/RouteView';
import type { BoardData } from './components/BoardPage';
import { boardPath } from './lib/routes';
import { COUNTDOWN_TICK_MS, BOARD_MINI_ROWS_PHONE, BOARD_MINI_ROWS_DESKTOP } from './lib/constants';
import { buildTodo, meNeedsAttention, todoBadgeCount } from './lib/todo';
import { readOnboardingDismissed, dismissOnboarding, clearTodoMarks } from './lib/todoMarks';
import { useTodoSources } from './lib/useTodoSources';
import { useNow } from './lib/useNow';
import { TodoInbox } from './components/TodoInbox';
import { BoardMini } from './components/BoardMini';
import { Skeleton } from './components/Skeleton';
import { RecordsFeed } from './components/RecordsFeed';
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
  const [caseOpen, setCaseOpen] = useState(false);
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
  const [pinned, setPinned] = useState<PinnedCase | null>(null);
  // Bumped when a statement is judged: the player page behind the dialog reloads its cases.
  const [playerRefreshKey, setPlayerRefreshKey] = useState(0);

  const ready = state.status === 'ready' ? state.data : null;
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

  // Opening a view is navigating to its address; a desktop drawer keeps the lobby's scroll.
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
    return { participants: ready.participants, records: ready.records, report: ready.report, trends, counts,
      reportStale: lastWeek !== null && ready.report !== null && ready.report.week_start < lastWeek,
      regenerating, onSelectUser: openPlayer,
      onRegenerate: ready.me?.is_admin && ready.report ? () => handleRegenerate(ready.report!.week_start) : undefined };
  }, [ready, trends, counts, regenerating, openPlayer, handleRegenerate]);

  const now = useNow(COUNTDOWN_TICK_MS);
  const extra = useTodoSources({ me: ready?.me ?? null, pendingAppeals: ready?.pending.appeals ?? 0, refreshKey: todoRefreshKey });
  const items = useMemo(() => ready?.me ? buildTodo({ me: ready.me, now, pending: ready.pending, myPending: ready.myPending,
    feed: ready.records, appealed: extra.appealed, discord: extra.discord,
    onboardingDismissed }) : [], [ready, now, extra.appealed, extra.discord, onboardingDismissed]);
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

  const { config, participants, records, me, report } = state.data;
  // A page (phone) or NotFound replaces the lobby; it stays mounted, only hidden (contract §8 #6).
  const covered = routeCoversHome(location.route, layout);
  const canRecord = me?.is_judge === true || me?.is_admin === true;
  // MyScoreLine's 第 N 名: the board's own competition ranking (P0-4's rank.ts).
  const myIndex = me ? participants.findIndex((p) => p.id === me.id) : -1;
  const myRank = myIndex >= 0 ? competitionRanks(participants.map((p) => p.score))[myIndex] : null;

  const myPath = me ? playerPath(me.id) : '/';
  const primary = me ? <TodoInbox items={!extra.settled ? null : items} now={now} boardTzOffsetHours={config.boardTzOffsetHours}
    onOpenStatement={setStatementCase} onOpenNotify={() => navigate(WELCOME_PATH)}
    onDismissUnbound={() => {}} onDismissOnboarding={() => {
      const item = items.find((item) => item.kind === 'onboarding');
      if (item?.kind === 'onboarding') setOnboardingDismissed(dismissOnboarding(me.id, item.missing, now));
    }} />
    : <WelcomeCard loginUrl={AUTH_LOGIN_URL} discordInviteUrl={DISCORD_INVITE_URL} onShowRules={() => navigate(boardPath('rules'))}
      rulesTo={boardPath('rules')} weeklyHeal={config.weeklyHeal} />;
  const score = me?.is_participant ? <MyScoreLine me={me} rank={myRank} config={config} variant={layout === 'drawer' ? 'card' : 'line'} onOpen={() => openPlayer(me.id)} /> : null;
  const mini = <BoardMini participants={participants} trends={trends} counts={counts} records={records} nextResetAt={config.nextResetAt}
    meId={me?.id} rows={layout === 'page' ? BOARD_MINI_ROWS_PHONE : BOARD_MINI_ROWS_DESKTOP} onSelect={openPlayer} />;
  const weekly = report && <WeeklyReportCard report={report} compact moreTo={boardPath('report')} stale={board?.reportStale}
    regenerating={regenerating} onRegenerate={board?.onRegenerate} />;
  const recent = <div className="app__recent"><RecordsFeed records={records} title="最近案件" previewCount={5} onSelectUser={openPlayer} />
    <Link to={boardPath('feed')} className="app__all-activity">全部动态</Link></div>;
  return (
    <div className="app">

      <Header
        layout={layout} route={location.route} myPath={myPath} meDot={meNeedsAttention(items)} todoCount={todoBadgeCount(items)}
        onRecord={canRecord ? () => setCaseOpen(true) : undefined}
        config={config}
        me={me}
        onLogout={() => requestNavigation(() => { void handleLogout(); })}
        onOpenOnboarding={() => navigate(WELCOME_PATH)}
      />

      <main className="app__main" hidden={covered}>
        <h1 className="visually-hidden">EDG 信誉分</h1>
        {state.stale && <StaleNotice message={state.stale.message} onRetry={() => void refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))} />}
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={dismissLinkMissing} />}
        <div className={`app__home${layout === 'drawer' ? ' app__home--desktop' : ''}${score === null ? ' app__home--without-score' : ''}`}>
          <div className="app__primary">{primary}</div>
          {score && <div className="app__score">{score}</div>}
          <div className="app__board">{mini}</div>
          {recent}
          {weekly}
        </div>
      </main>

      <RouteView
        board={board}
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

      <footer className="app__footer" hidden={covered}>
        <p>EDG 信誉分 · 开黑守约，从不放鸽开始</p>
      </footer>

      {canRecord && me && (
        <CaseDialog
          open={caseOpen}
          onClose={() => setCaseOpen(false)}
          participants={participants}
          selfId={me.id}
          config={config}
          onCreated={handleChanged}
        />
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
