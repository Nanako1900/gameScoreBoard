import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordItem, User } from './types';
import { ApiError, AUTH_LOGIN_URL, getRecord, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './lib/deepLink';
import { computeCounts, computeTrends } from './lib/feedStats';
import { FEED_PREVIEW_COUNT } from './lib/constants';
import { DISCORD_INVITE_URL } from './lib/env';
import { revealSection } from './lib/revealSection';
import { CHANGE_KEYS } from './lib/coreData';
import { useCoreData } from './lib/useCoreData';
import { visibleRefreshKeys } from './lib/refreshPolicy';
import { useVisibleRefresh } from './lib/useVisibleRefresh';
import { useResetWatch } from './lib/useResetWatch';
import { todoCount } from './lib/tabTitle';
import { useTabTitle } from './lib/useTabTitle';
import { clearAllDrafts } from './lib/drafts';
import { competitionRanks } from './lib/rank';
import { ToastProvider, useToast } from './components/Toast';
import { StaleNotice } from './components/StaleNotice';
import { Header } from './components/Header';
import { Leaderboard } from './components/Leaderboard';
import { WeekHighlights } from './components/WeekHighlights';
import { WelcomeCard } from './components/WelcomeCard';
import { RecordsFeed } from './components/RecordsFeed';
import { RulesPanel } from './components/RulesPanel';
import { CaseDialog } from './components/CaseDialog';
import { StatementDialog } from './components/StatementDialog';
import { PendingBanner } from './components/PendingBanner';
import { MyScoreLine } from './components/MyScoreLine';
import { OnboardingDialog } from './components/OnboardingDialog';
import { PlayerDetail } from './components/PlayerDetail';
import { SessionsPanel } from './components/SessionsPanel';
import { SessionFormDialog } from './components/SessionFormDialog';
import { SessionDetailDialog } from './components/SessionDetailDialog';
import { AdminAiPanel } from './components/AdminAiPanel';
import { InviteBanner } from './components/InviteBanner';
import { WeeklyReportCard } from './components/WeeklyReportCard';
import { DiscordLinkedNotice } from './components/DiscordLinkCard';
import { LinkMissingNotice } from './components/LinkMissingNotice';
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
  const { state, refresh, setMe } = useCoreData();
  const toast = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [statementCase, setStatementCase] = useState<RecordItem | null>(null);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  // Controlled so the welcome card's 30 秒看懂 can open it.
  const [rulesOpen, setRulesOpen] = useState(false);
  // ?linked=discord is where the API lands the browser after a successful bind.
  // Read once at mount; the effect below strips it so a reload doesn't repeat it.
  const [discordLinked, setDiscordLinked] = useState(
    () => new URLSearchParams(window.location.search).get('linked') === 'discord',
  );
  // ?case= / ?session= (links from Discord): read once, opened once data is in.
  const [deepLink] = useState(() => readDeepLink(window.location.search));
  const deepLinkDone = useRef(false);
  // Set by the effects that open the first-run dialog (state they set is not
  // visible to an effect in the same commit): the link waits for it to close.
  const onboardingAsked = useRef(false);
  const [focusCaseId, setFocusCaseId] = useState<number | null>(null);
  const [linkMissing, setLinkMissing] = useState<string | null>(null);

  useEffect(() => {
    // One-off parameters: stripped at once, so a reload does not repeat them.
    const params = new URLSearchParams(window.location.search);
    const oneOff = [...(params.get('linked') === 'discord' ? ['linked'] : []), ...DEEP_LINK_PARAMS];
    if (!oneOff.some((name) => params.has(name))) {
      return;
    }
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutParams(window.location.search, oneOff)}`,
    );
  }, []);

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
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}`,
      );
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

  // Open what the link points at, once: a case in its subject's page, or a
  // session. Through the same reads as clicking there — so the same rules.
  useEffect(() => {
    if (!ready || !deepLink || deepLinkDone.current || onboardingOpen || onboardingAsked.current) return;
    deepLinkDone.current = true;
    if (deepLink.kind === 'session') {
      setSessionId(deepLink.id);
      return;
    }
    getRecord(deepLink.id)
      .then(({ record }) => {
        setFocusCaseId(record.id);
        setSelectedUserId(record.subject.id);
      })
      .catch((err: unknown) => {
        setLinkMissing(
          err instanceof ApiError && err.status === 404 ? '链接里的案件不存在了。' : '打不开链接里的案件，稍后再试。',
        );
      });
  }, [ready, deepLink, onboardingOpen]);

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
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

  useTabTitle(ready ? todoCount(ready) : 0);

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

  if (state.status === 'loading') {
    return (
      <div className="app app--center">
        <div className="app__loader" role="status" aria-live="polite">
          <span className="app__loader-mark">EDG</span>
          <span className="app__loader-text">信誉分加载中…</span>
        </div>
      </div>
    );
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

  const { config, participants, records, me, myPending, invites, report } = state.data;
  const canRecord = me?.is_judge === true;
  const showRules = (): void => {
    setRulesOpen(true);
    revealSection('rules');
  };

  // MyScoreLine's 第 N 名: the board's own competition ranking (P0-4's rank.ts).
  const myIndex = me ? participants.findIndex((p) => p.id === me.id) : -1;
  const myRank = myIndex >= 0 ? competitionRanks(participants.map((p) => p.score))[myIndex] : null;

  return (
    <div className="app">
      <Header
        config={config}
        me={me}
        onLogout={() => void handleLogout()}
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onOpenAiPanel={me?.is_admin === true ? () => setAiPanelOpen(true) : undefined}
      />

      {/* Stack order = 待办 → 我的分数 → 约局 → 榜单 → 周报 → 详表.
       *
       * Ordered by what the visitor can ACT on, most actionable first. It is set
       * in the DOM rather than with CSS `order` on purpose: `order` would leave
       * tab and screen-reader order following the source, so keyboard users would
       * traverse the page in a different sequence than they see it. One order,
       * three consumers.
       *
       * The two banners self-hide when empty, so a quiet day collapses straight
       * to 约局 without leaving gaps. */}
      <main className="app__main">
        {state.stale && (
          <StaleNotice
            message={state.stale.message}
            onRetry={() => void refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))}
          />
        )}

        {discordLinked && <DiscordLinkedNotice onDismiss={() => setDiscordLinked(false)} />}

        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={() => setLinkMissing(null)} />}

        {!me && (
          <WelcomeCard
            loginUrl={AUTH_LOGIN_URL}
            discordInviteUrl={DISCORD_INVITE_URL}
            onShowRules={showRules}
            weeklyHeal={config.weeklyHeal}
          />
        )}

        <InviteBanner invites={invites} onAnswered={handleChanged} onOpen={setSessionId} />

        <PendingBanner cases={myPending} onOpen={setStatementCase} />

        {/* Your score and Monday's heal, right after what you have to do (spec §2.4). */}
        {me && <MyScoreLine me={me} rank={myRank} config={config} onOpen={() => setSelectedUserId(me.id)} />}

        {/* Above the board: this is the only block on the page that leads to a new
            game happening, and it used to sit under a 520px leaderboard where
            nobody scrolled to it. */}
        <SessionsPanel
          me={me}
          refreshKey={sessionsKey}
          onOpenSession={setSessionId}
          onCreate={() => setSessionFormOpen(true)}
        />

        {report && (
          <WeeklyReportCard
            report={report}
            compact
            stale={(() => {
              const lastWeek = lastWeekStartOf(config.nextResetAt);
              return lastWeek !== null && report.week_start < lastWeek;
            })()}
            regenerating={regenerating}
            onRegenerate={
              me?.is_admin === true
                ? () => handleRegenerate(report.week_start)
                : undefined
            }
          />
        )}

        <div className="app__grid">
          <div className="app__col app__col--main">
            <Leaderboard
              participants={participants}
              trends={trends}
              counts={counts}
              onSelect={setSelectedUserId}
              meId={me?.id ?? null}
              highlights={
                <WeekHighlights
                  records={records}
                  nextResetAt={config.nextResetAt}
                  onSelectUser={setSelectedUserId}
                />
              }
            />
            <RulesPanel config={config} open={rulesOpen} onOpenChange={setRulesOpen} />
          </div>

          <aside className="app__col app__col--side">
            <RecordsFeed
              records={records}
              title="最新动态"
              onSelectUser={setSelectedUserId}
              emptyHint="还没有任何记录，等待第一笔。"
              previewCount={FEED_PREVIEW_COUNT}
            />
          </aside>
        </div>
      </main>

      <footer className="app__footer">
        <p>EDG 信誉分 · 开黑守约，从不放鸽开始</p>
      </footer>

      {canRecord && (
        <button
          type="button"
          className="app__fab"
          onClick={() => setCaseOpen(true)}
          aria-label="记一笔"
        >
          <span className="app__fab-plus" aria-hidden="true">
            ✎
          </span>
          <span className="app__fab-label">记一笔</span>
        </button>
      )}

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
          onDecided={handleChanged}
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

      {sessionFormOpen && (
        <SessionFormDialog
          open
          participants={participants}
          selfId={me?.id ?? null}
          onClose={() => setSessionFormOpen(false)}
          onCreated={(session) => {
            handleChanged();
            setSessionId(session.id);
          }}
        />
      )}

      {sessionId !== null && (
        <SessionDetailDialog
          sessionId={sessionId}
          me={me}
          onClose={() => setSessionId(null)}
          onChanged={handleChanged}
        />
      )}

      {aiPanelOpen && <AdminAiPanel open onClose={() => setAiPanelOpen(false)} />}

      {selectedUserId && (
        <PlayerDetail
          userId={selectedUserId}
          me={me}
          config={config}
          focusRecordId={focusCaseId}
          onClose={() => {
            setSelectedUserId(null);
            setFocusCaseId(null);
          }}
          onOpenStatement={(record) => {
            setSelectedUserId(null);
            setFocusCaseId(null);
            setStatementCase(record);
          }}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
