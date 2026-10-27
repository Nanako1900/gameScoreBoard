import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordItem, SessionDetail, User } from './types';
import { ApiError, AUTH_LOGIN_URL, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { bootRouter, navigate, useLocation } from './lib/router';
import { playerPath, routeCoversHome, sessionNewPath, sessionPath } from './lib/routes';
import { useRouteLayout } from './lib/useRouteLayout';
import { useEntryTarget } from './lib/useEntryTarget';
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
import { competitionRanks } from './lib/rank';
import { ToastProvider, useToast } from './components/Toast';
import { StaleNotice } from './components/StaleNotice';
import { Header } from './components/Header';
import { WelcomeCard } from './components/WelcomeCard';
import { CaseDialog } from './components/CaseDialog';
import { StatementDialog } from './components/StatementDialog';
import { MyScoreLine } from './components/MyScoreLine';
import { OnboardingDialog } from './components/OnboardingDialog';
import { SessionsPanel } from './components/SessionsPanel';
import { RecentSessions } from './components/RecentSessions';
import { useLobbySessions } from './lib/useLobbySessions';
import { AdminAiPanel } from './components/AdminAiPanel';
import { WeeklyReportCard } from './components/WeeklyReportCard';
import { DiscordLinkedNotice } from './components/DiscordLinkCard';
import { LinkMissingNotice } from './components/LinkMissingNotice';
import { RouteView } from './components/RouteView';
import type { BoardData } from './components/BoardPage';
import { boardPath } from './lib/routes';
import { COUNTDOWN_TICK_MS, BOARD_MINI_ROWS_PHONE, BOARD_MINI_ROWS_DESKTOP } from './lib/constants';
import { buildTodo, handledSessionIds, meNeedsAttention, todoBadgeCount } from './lib/todo';
import { readSeenCancelled, readUnboundDismissed, markCancelledSeen, dismissUnbound, clearTodoMarks } from './lib/todoMarks';
import { useTodoSources } from './lib/useTodoSources';
import { useRsvpAnswer } from './lib/useRsvpAnswer';
import { useNow } from './lib/useNow';
import { TodoInbox } from './components/TodoInbox';
import { BoardMini } from './components/BoardMini';
import { BottomTabs, showsBottomTabs } from './components/BottomTabs';
import { Skeleton } from './components/Skeleton';
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
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [statementCase, setStatementCase] = useState<RecordItem | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  useEffect(() => {
    if (created !== null && (location.route.name !== 'session' || location.route.sessionId !== created)) setCreated(null);
  }, [created, location.route]);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [seenCancelled, setSeenCancelled] = useState(readSeenCancelled);
  const [unboundDismissed, setUnboundDismissed] = useState(readUnboundDismissed);
  // ?linked=discord is where the API lands the browser after a successful bind.
  // Read once at mount; the effect below strips it so a reload doesn't repeat it.
  const [discordLinked, setDiscordLinked] = useState(
    () => new URLSearchParams(window.location.search).get('linked') === 'discord',
  );
  // Set by the effects that open the first-run dialog (state they set is not
  // visible to an effect in the same commit): the link waits for it to close.
  const onboardingAsked = useRef(false);
  // The case an old ?case= link or /cases/:id resolved: its page shows it without a second GET.
  const [pinned, setPinned] = useState<PinnedCase | null>(null);
  // Bumped when a statement is judged: the player page behind the dialog reloads its cases.
  const [playerRefreshKey, setPlayerRefreshKey] = useState(0);

  // Handle ?onboarding=1 once data is ready and the user is logged in.
  const ready = state.status === 'ready' ? state.data : null;
  useEffect(() => {
    if (!ready?.me) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('onboarding') === '1') {
      onboardingAsked.current = true;
      setOnboardingOpen(true);
      params.delete('onboarding');
      const qs = params.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [ready?.me]);

  // Back from binding Discord with no role chosen yet: the bind was started
  // from the first-run dialog (or a first login lost its flag on the way), so
  // the first-run question is still open — ask it once more.
  const askedAfterLink = useRef(false);
  useEffect(() => {
    const me = ready?.me;
    if (!discordLinked || !me || askedAfterLink.current) return;
    askedAfterLink.current = true;
    if (!me.is_participant && !me.is_judge) {
      onboardingAsked.current = true;
      setOnboardingOpen(true);
    }
  }, [discordLinked, ready?.me]);

  // Old ?case= / ?session= links, once the data is in and the first-run dialog is done
  // (declared after the onboarding effects: it reads onboardingAsked after they ran).
  const entryBlocked = useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen]);
  const { linkMissing, dismissLinkMissing, resume, clearResume } = useEntryTarget({
    ready: ready !== null,
    me: ready?.me ?? null,
    blocked: entryBlocked,
    onPinned: setPinned,
  });

  // Opening a view is navigating to its address; a desktop drawer keeps the lobby's scroll.
  const openRoute = useCallback(
    (path: string): void => navigate(path, { keepScroll: layout === 'drawer' }),
    [layout],
  );
  const openPlayer = useCallback((id: string): void => openRoute(playerPath(id)), [openRoute]);
  const openSession = useCallback((id: number): void => openRoute(sessionPath(id)), [openRoute]);

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
    clearLoginReturn();
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
    setSessionsKey((n) => n + 1);
  }, [refresh]);

  const handleVisible = useCallback((): void => {
    if (!ready) return;
    void refresh(visibleRefreshKeys(ready.config.nextResetAt, Date.now()));
    setSessionsKey((n) => n + 1);
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
  const lobby = useLobbySessions({ enabled: ready !== null, me: ready?.me ?? null, refreshKey: sessionsKey });

  const now = useNow(COUNTDOWN_TICK_MS);
  const extra = useTodoSources({ me: ready?.me ?? null, pendingAppeals: ready?.pending.appeals ?? 0, refreshKey: sessionsKey });
  const items = useMemo(() => ready?.me ? buildTodo({ me: ready.me, now, pending: ready.pending, myPending: ready.myPending,
    invites: ready.invites, feed: ready.records, mine: lobby.mine, appealed: extra.appealed, discord: extra.discord,
    seenCancelled, unboundDismissed }) : [], [ready, now, lobby.mine, extra.appealed, extra.discord, seenCancelled, unboundDismissed]);
  const rsvp = useRsvpAnswer({ reload: lobby.reload, onAnswered: handleChanged });
  useTabTitle(todoBadgeCount(items));
  if (state.status === 'loading') {
    return <div className="app"><Header pending config={null} me={null} onLogout={() => {}} onOpenOnboarding={() => {}} />
      <main className="app__main" aria-busy="true"><span className="visually-hidden" role="status">信誉分加载中…</span>
        <Skeleton label="要你处理加载中" /><Skeleton label="约局加载中" /><Skeleton label="信誉榜加载中" />
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

  const tabs = layout === 'page' && showsBottomTabs(location.route);
  const myPath = me ? playerPath(me.id) : '/';
  const primary = me ? <TodoInbox items={lobby.loading || !extra.settled ? null : items} now={now} boardTzOffsetHours={config.boardTzOffsetHours}
    busyId={rsvp.busyId} error={rsvp.error} onAnswer={(session, answer) => void rsvp.answer(session, answer)} onOpenSession={openSession}
    onOpenStatement={setStatementCase} onOpenNotify={() => setOnboardingOpen(true)}
    onSeenCancelled={(id) => { markCancelledSeen(id); setSeenCancelled((old) => [...new Set([...old, id])]); }}
    onDismissUnbound={() => { dismissUnbound(); setUnboundDismissed(true); }} />
    : <WelcomeCard loginUrl={AUTH_LOGIN_URL} discordInviteUrl={DISCORD_INVITE_URL} onShowRules={() => navigate(boardPath('rules'))}
      rulesTo={boardPath('rules')} weeklyHeal={config.weeklyHeal} />;
  const score = me && <MyScoreLine me={me} rank={myRank} config={config} variant={layout === 'drawer' ? 'card' : 'line'} onOpen={() => openPlayer(me.id)} />;
  const sessions = <SessionsPanel lobby={lobby} hideCreate handledElsewhere={handledSessionIds(items)} boardTzOffsetHours={config.boardTzOffsetHours}
    me={me} refreshKey={sessionsKey} onOpenSession={openSession} onCreate={() => navigate(sessionNewPath())} />;
  const mini = <BoardMini participants={participants} trends={trends} counts={counts} records={records} nextResetAt={config.nextResetAt}
    meId={me?.id} rows={layout === 'page' ? BOARD_MINI_ROWS_PHONE : BOARD_MINI_ROWS_DESKTOP} onSelect={openPlayer} />;
  const weekly = report && <WeeklyReportCard report={report} compact moreTo={boardPath('report')} stale={board?.reportStale}
    regenerating={regenerating} onRegenerate={board?.onRegenerate} />;
  const recent = <RecentSessions refreshKey={sessionsKey} boardTzOffsetHours={config.boardTzOffsetHours} onOpenSession={openSession} />;
  return (
    <div className={`app${tabs ? ' app--tabs' : ''}`}>

      <Header
        layout={layout} route={location.route} myPath={myPath} meDot={meNeedsAttention(items)}
        onRecord={canRecord ? () => setCaseOpen(true) : undefined}
        config={config}
        me={me}
        onLogout={() => void handleLogout()}
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onOpenAiPanel={me?.is_admin === true ? () => setAiPanelOpen(true) : undefined}
      />

      <main className="app__main" hidden={covered}>
        <h1 className="visually-hidden">EDG 信誉分</h1>
        {state.stale && <StaleNotice message={state.stale.message} onRetry={() => void refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))} />}
        {discordLinked && <DiscordLinkedNotice onDismiss={() => setDiscordLinked(false)} />}
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={dismissLinkMissing} />}
        {layout === 'page' ? <>{primary}{score}{sessions}{mini}{weekly}{recent}</>
          : <div className="app__lobby"><div className="app__lobby-main">{primary}{sessions}{recent}</div>
            <aside className="app__lobby-side">{score}{mini}{weekly}</aside></div>}
      </main>

      <RouteView
        participants={participants}
        created={created}
        onCreated={(session: SessionDetail) => { setCreated(session.id); handleChanged(); navigate(sessionPath(session.id), { replace: true }); }}
        mySessions={lobby.mine}
        board={board}
        location={location}
        layout={layout}
        me={me}
        config={config}
        pinned={pinned}
        playerRefreshKey={playerRefreshKey}
        onPinned={setPinned}
        onChanged={handleChanged}
        onOpenStatement={setStatementCase}
        resume={resume}
        onResumeDone={clearResume}
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

      {me && (
        <OnboardingDialog
          open={onboardingOpen}
          onClose={() => {
            onboardingAsked.current = false;
            setOnboardingOpen(false);
          }}
          me={me}
          onSaved={handleMeUpdated}
        />
      )}

      {aiPanelOpen && <AdminAiPanel open onClose={() => setAiPanelOpen(false)} />}
      {tabs && <BottomTabs me={me} route={location.route} todoCount={todoBadgeCount(items)} meDot={meNeedsAttention(items)} myPath={myPath} />}
    </div>
  );
}
