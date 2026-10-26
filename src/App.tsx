import { useCallback, useEffect, useMemo, useState } from 'react';
import { affectsScore } from '@shared/scoring';
import type {
  Config,
  PublicUser,
  RecordItem,
  SessionItem,
  User,
  WeeklyReport,
} from './types';
import {
  ApiError,
  getConfig,
  getLatestReport,
  getLeaderboard,
  getMe,
  getMyInvites,
  getRecords,
  logout as apiLogout,
  regenerateReport,
} from './api';
import { parseTimestamp } from './lib/time';
import { Header } from './components/Header';
import { RedBlackBoard } from './components/RedBlackBoard';
import { Leaderboard } from './components/Leaderboard';
import { RecordsFeed } from './components/RecordsFeed';
import { RulesPanel } from './components/RulesPanel';
import { CaseDialog } from './components/CaseDialog';
import { StatementDialog } from './components/StatementDialog';
import { PendingBanner } from './components/PendingBanner';
import { OnboardingDialog } from './components/OnboardingDialog';
import { PlayerDetail } from './components/PlayerDetail';
import { SessionsPanel } from './components/SessionsPanel';
import { SessionFormDialog } from './components/SessionFormDialog';
import { SessionDetailDialog } from './components/SessionDetailDialog';
import { AdminAiPanel } from './components/AdminAiPanel';
import { InviteBanner } from './components/InviteBanner';
import { WeeklyReportCard } from './components/WeeklyReportCard';
import { DiscordLinkedNotice } from './components/DiscordLinkCard';
import './app.css';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CoreData {
  config: Config;
  participants: PublicUser[];
  records: RecordItem[];
  me: User | null;
  /** Cases where the signed-in user still owes a statement. */
  myPending: RecordItem[];
  /** Sessions the user was invited to and has not answered. */
  invites: SessionItem[];
  report: WeeklyReport | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CoreData };

async function loadCore(): Promise<CoreData> {
  const [config, leaderboard, records, me, report] = await Promise.all([
    getConfig(),
    getLeaderboard(),
    getRecords({ limit: 50 }),
    getMe(),
    // A missing report is normal (first week, or nothing happened) — never fatal.
    getLatestReport().catch(() => ({ report: null })),
  ]);
  // Only fetch the follow-ups that can possibly be non-empty: /api/me already
  // tells us whether anything is pending, and invites need a session at all.
  const [myPending, invites] = await Promise.all([
    me.user && me.pending.statements > 0
      ? getRecords({ mine: 'pending', limit: 20 }).then((r) => r.records)
      : Promise.resolve<RecordItem[]>([]),
    me.user
      ? getMyInvites()
          .then((r) => r.sessions)
          .catch(() => [])
      : Promise.resolve<SessionItem[]>([]),
  ]);
  return {
    config,
    participants: leaderboard.participants,
    records: records.records,
    me: me.user,
    myPending,
    invites,
    report: report.report,
  };
}

/** Sum of scored deltas per subject within the current heal week. */
function computeTrends(records: RecordItem[], nextResetAt: string): Record<string, number> {
  const weekStart = parseTimestamp(nextResetAt) - WEEK_MS;
  const trends: Record<string, number> = {};
  for (const r of records) {
    if (!affectsScore(r.status)) {
      continue;
    }
    const at = parseTimestamp(r.created_at);
    if (!Number.isNaN(at) && at >= weekStart) {
      trends[r.subject.id] = (trends[r.subject.id] ?? 0) + r.delta;
    }
  }
  return trends;
}

/** Count of records involving each subject (from the loaded feed). */
function computeCounts(records: RecordItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    counts[r.subject.id] = (counts[r.subject.id] ?? 0) + 1;
  }
  return counts;
}

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [caseOpen, setCaseOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [statementCase, setStatementCase] = useState<RecordItem | null>(null);
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  // ?linked=discord is where the API lands the browser after a successful bind.
  // Read once at mount; the effect below strips it so a reload doesn't repeat it.
  const [discordLinked, setDiscordLinked] = useState(
    () => new URLSearchParams(window.location.search).get('linked') === 'discord',
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await loadCore();
      setState({ status: 'ready', data });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof ApiError ? err.message : '加载失败，请稍后重试',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') !== 'discord') {
      return;
    }
    params.delete('linked');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}`,
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

  const handleLogout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } catch {
      // Even if the request fails, reloading clears client state.
    }
    window.location.reload();
  }, []);

  const handleMeUpdated = useCallback((user: User): void => {
    setState((prev) =>
      prev.status === 'ready' ? { status: 'ready', data: { ...prev.data, me: user } } : prev,
    );
    void refresh();
  }, [refresh]);

  const handleChanged = useCallback((): void => {
    void refresh();
    setSessionsKey((n) => n + 1);
  }, [refresh]);

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
  const top = participants.length > 0 ? participants[0] : null;
  const bottom = participants.length > 1 ? participants[participants.length - 1] : null;
  const canRecord = me?.is_judge === true;

  return (
    <div className="app">
      <Header
        config={config}
        me={me}
        onLogout={() => void handleLogout()}
        onOpenOnboarding={() => setOnboardingOpen(true)}
        onOpenAiPanel={me?.is_admin === true ? () => setAiPanelOpen(true) : undefined}
      />

      {/* Stack order = 待办 → 约局 → 榜单 → 周报 → 详表.
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
        {discordLinked && <DiscordLinkedNotice onDismiss={() => setDiscordLinked(false)} />}

        <InviteBanner invites={invites} onAnswered={handleChanged} onOpen={setSessionId} />

        <PendingBanner cases={myPending} onOpen={setStatementCase} />

        {/* Above the board: this is the only block on the page that leads to a new
            game happening, and it used to sit under a 520px leaderboard where
            nobody scrolled to it. */}
        <SessionsPanel
          me={me}
          refreshKey={sessionsKey}
          onOpenSession={setSessionId}
          onCreate={() => setSessionFormOpen(true)}
        />

        <RedBlackBoard top={top} bottom={bottom} onSelect={setSelectedUserId} />

        {report && (
          <WeeklyReportCard
            report={report}
            regenerating={regenerating}
            onRegenerate={
              me?.is_admin === true
                ? () => {
                    setRegenerating(true);
                    void regenerateReport(report.week_start)
                      .then(handleChanged)
                      .finally(() => setRegenerating(false));
                  }
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
            />
            <RulesPanel config={config} />
          </div>

          <aside className="app__col app__col--side">
            <RecordsFeed
              records={records}
              title="最新动态"
              onSelectUser={setSelectedUserId}
              emptyHint="还没有任何记录，等待第一笔。"
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
          open
          record={statementCase}
          config={config}
          onClose={() => setStatementCase(null)}
          onDecided={handleChanged}
        />
      )}

      {me && (
        <OnboardingDialog
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
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
          onClose={() => setSelectedUserId(null)}
          onOpenStatement={(record) => {
            setSelectedUserId(null);
            setStatementCase(record);
          }}
          onChanged={handleChanged}
        />
      )}
    </div>
  );
}
