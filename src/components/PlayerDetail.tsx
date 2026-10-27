import { useCallback, useEffect, useRef, useState } from 'react';
import { tierFor } from '@shared/scoring';
import type { Config, HistoryPoint, RecordItem, User, UserDetailResponse } from '../types';
import {
  ApiError,
  confirmEscalation,
  dismissEscalation,
  getUserDetail,
  overrideCase,
  revokeRecord,
  setJudge,
  setScore,
  withdrawCase,
} from '../api';
import { REVOKE_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { BACK_HOME, PAGE_BACK_LABEL, PINNED_CASE_LABEL, PLAYER_NOT_FOUND, SEE_BOARD, pinnedCaseEyebrow } from '../lib/routeCopy';
import { HOME_PATH, boardPath } from '../lib/routes';
import { useNow } from '../lib/useNow';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import { VerdictCard } from './VerdictCard';
import { HistoryChart } from './HistoryChart';
import { AdminScoreForm } from './AdminScoreForm';
import { CaseActions } from './CaseActions';
import { AppealSheet } from './AppealSheet';
import { ForgivenessNote } from './ForgivenessNote';
import './player-detail.css';

interface PlayerDetailProps {
  userId: string;
  me: User | null;
  onClose: () => void;
  /** Open the statement dialog for a case the viewer has to answer. */
  onOpenStatement?: (record: RecordItem) => void;
  /** Called after a mutation so parent lists can refresh. */
  onChanged?: () => void;
  /** A case to bring into view and focus once loaded (a link from Discord). */
  focusRecordId?: number | null;
  /** The board's config: with it, the player's own page previews the weekly heal (P0-5). */
  config?: Config;
  /** Default 'center' — today's dialog. 'page' / 'drawer': the /players/:id route (P1-1). */
  variant?: 'center' | 'page' | 'drawer';
  /** The focused case as the route already read it: pinned even before (or without) the list's own copy. */
  pinnedRecord?: RecordItem | null;
  /** Bumped by the app when the cases changed elsewhere (a statement was judged): load again. */
  refreshKey?: number;
}

interface DetailState {
  /** 'missing': a 404 on the page / drawer forms — NotFound instead of the error line. */
  status: 'loading' | 'ready' | 'error' | 'missing';
  data: UserDetailResponse | null;
  error: string | null;
}

/** busyId while the judge role is being changed (record ids are positive). */
const JUDGE_BUSY = -1;
/** busyId while the score is being set by hand. */
const SCORE_BUSY = -2;
const TITLE_ID = 'player-detail-title';
const NOT_FOUND_STATUS = 404;

/** The focused case: the list's own copy when it has one (it is the fresher), else the route's. */
function pickPinned(
  records: readonly RecordItem[] | undefined,
  focusRecordId: number | null,
  fallback: RecordItem | null,
): RecordItem | null {
  if (focusRecordId === null) return null;
  const own = records?.find((r) => r.id === focusRecordId);
  if (own) return own;
  return fallback !== null && fallback.id === focusRecordId ? fallback : null;
}

function focusCase(id: number): void {
  const card = document.getElementById(`case-${id}`);
  if (!card) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  card.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
}

interface EscalationButtonsProps {
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** 确认是团灭级 / 维持原案由 — the filing judge's co-sign of an AI escalation hint. */
function EscalationButtons({ busy, onConfirm, onDismiss }: EscalationButtonsProps): JSX.Element {
  return (
    <>
      <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={onConfirm}>
        确认是团灭级
      </button>
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onDismiss}>
        维持原案由
      </button>
    </>
  );
}

/**
 * Once, when the page first has its data: the linked case is brought into view
 * and focused (else the page opens unscrolled — CONTRACT); a page-form view
 * without one focuses its heading (spec §6.4). Reloads never move focus again.
 */
function useFirstFocus(
  ready: boolean,
  focusRecordId: number | null,
  pinnedShown: boolean,
  variant: NonNullable<PlayerDetailProps['variant']>,
): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    if (focusRecordId !== null) {
      if (pinnedShown) focusCase(focusRecordId);
      return;
    }
    if (variant === 'page') document.getElementById(TITLE_ID)?.focus();
  }, [ready, focusRecordId, pinnedShown, variant]);
}

export function PlayerDetail({
  userId,
  me,
  onClose,
  onOpenStatement,
  onChanged,
  focusRecordId = null,
  config,
  variant = 'center',
  pinnedRecord = null,
  refreshKey = 0,
}: PlayerDetailProps): JSX.Element {
  const [state, setState] = useState<DetailState>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [overriding, setOverriding] = useState<number | null>(null);
  const [appealing, setAppealing] = useState<RecordItem | null>(null);
  // One clock for the page: the reporter's revoke countdown and the heal line.
  const now = useNow(REVOKE_TICK_MS);

  const load = useCallback(async (): Promise<void> => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await getUserDetail(userId);
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      const gone = variant !== 'center' && err instanceof ApiError && err.status === NOT_FOUND_STATUS;
      setState({
        status: gone ? 'missing' : 'error',
        data: null,
        error: err instanceof ApiError ? err.message : '加载失败',
      });
    }
  }, [userId, variant]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const isSelf = me !== null && me.id === userId;

  const run = async (id: number, fn: () => Promise<unknown>): Promise<void> => {
    setBusyId(id);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof ApiError ? err.message : '操作失败',
      }));
    } finally {
      setBusyId(null);
    }
  };

  const data = state.data;
  const score = data?.user.score ?? 0;
  const tier = tierFor(score);
  const pinned = pickPinned(data?.records, focusRecordId, pinnedRecord);
  useFirstFocus(state.status === 'ready', focusRecordId, pinned !== null, variant);

  // Only the filing judge (or an admin) may co-sign the -25 charge, so only they
  // get the buttons — a reporter who is no judge (any more) does not.
  const canCoSign = (r: RecordItem): boolean =>
    me !== null && (me.is_admin || (me.is_judge && r.reporter.id === me.id));

  // One card, wherever it sits: pinned at the top (focused) or in the list below.
  const renderCase = (r: RecordItem, focusedCard: boolean): JSX.Element => (
    <VerdictCard
      key={r.id}
      record={r}
      focused={focusedCard}
      escalation={
        canCoSign(r) ? (
          <EscalationButtons
            busy={busyId === r.id}
            onConfirm={() => void run(r.id, () => confirmEscalation(r.id))}
            onDismiss={() => void run(r.id, () => dismissEscalation(r.id))}
          />
        ) : undefined
      }
      actions={
        <CaseActions
          record={r}
          me={me}
          isSelf={isSelf}
          busy={busyId === r.id}
          overriding={overriding === r.id}
          onStartOverride={() => setOverriding(r.id)}
          onCancelOverride={() => setOverriding(null)}
          now={now}
          note={
            isSelf && config && data && r.status === 'decided' && r.delta < 0 ? (
              <ForgivenessNote delta={r.delta} scoreAfter={data.user.score} weeklyHeal={config.weeklyHeal} />
            ) : undefined
          }
          onStatement={() => onOpenStatement?.(r)}
          onAppeal={() => setAppealing(r)}
          onWithdraw={() => void run(r.id, () => withdrawCase(r.id))}
          onRevoke={() => void run(r.id, () => revokeRecord(r.id))}
          onOverride={(delta, reason) => {
            setOverriding(null);
            void run(r.id, () => overrideCase(r.id, delta, reason));
          }}
        />
      }
    />
  );

  return (
    <>
      <Modal open onClose={onClose} labelledBy={TITLE_ID} size="lg" variant={variant}>
        {variant === 'page' && <PageBar backLabel={PAGE_BACK_LABEL} onBack={onClose} />}

        {state.status === 'missing' && <NotFound title={PLAYER_NOT_FOUND} headingId={TITLE_ID} actions={[{ label: BACK_HOME, to: HOME_PATH }, { label: SEE_BOARD, to: boardPath('list') }]} />}

        {state.status === 'loading' && (
          <div className="pd__status" aria-live="polite">
            加载中…
          </div>
        )}

        {state.status === 'error' && (
          <div className="pd__status pd__status--error" role="alert">
            <p>{state.error}</p>
            <button type="button" className="btn btn--ghost" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}

        {data && (
          <div className="pd">
            <header className="pd__header" style={{ ['--accent' as string]: tier.color }}>
              {/* Everyone's score is public; the 段位 colour and name are the viewer's own only (spec §3.8). */}
              <ScoreGauge score={score} size={128} strokeWidth={11} tone={isSelf ? 'tier' : 'neutral'} />
              <div className="pd__id">
                <div className="pd__name-row">
                  <Avatar
                    name={data.user.username}
                    src={data.user.avatar_url}
                    size={48}
                    ring
                    ringColor={tier.color}
                  />
                  <h2 id={TITLE_ID} className="pd__name" tabIndex={-1}>
                    {data.user.username}
                  </h2>
                </div>
                <div className="pd__badges">
                  <TierBadge tier={tier} />
                  {data.user.is_judge && <span className="pd__role">裁判</span>}
                  {isSelf && <span className="pd__role pd__role--self">这是你</span>}
                  {/* Judges are appointed by an admin (self-service cannot grant it). */}
                  {me?.is_admin === true && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm pd__judge-toggle"
                      disabled={busyId === JUDGE_BUSY}
                      onClick={() => void run(JUDGE_BUSY, () => setJudge(userId, !data.user.is_judge))}
                    >
                      {data.user.is_judge ? '取消裁判资格' : '设为裁判'}
                    </button>
                  )}
                </div>
                <p className="pd__blurb">{tier.blurb}</p>
                {isSelf && config && data.user.is_participant && (
                  <p className="pd__heal">{healPreviewText(healPreview(data.user.score, config, now))}</p>
                )}
                {me?.is_admin === true && (
                  <AdminScoreForm
                    key={data.user.score}
                    username={data.user.username}
                    score={data.user.score}
                    busy={busyId === SCORE_BUSY}
                    onSubmit={(next) => void run(SCORE_BUSY, () => setScore(userId, next))}
                  />
                )}
              </div>
            </header>

            {/* Moved here, not copied: the list below skips it, so the page has one #case-N (spec §3.8). */}
            {pinned && (
              <section className="pd__section pd__pinned" aria-label={PINNED_CASE_LABEL}>
                <p className="pd__pinned-eyebrow">{pinnedCaseEyebrow(pinned)}</p>
                {renderCase(pinned, true)}
              </section>
            )}

            <section className="pd__section" aria-label="分数走势">
              <h3 className="pd__section-title">分数走势</h3>
              <HistoryChart history={data.history} color={tier.color} />
            </section>

            {state.error && (
              <p className="pd__inline-error" role="alert">
                {state.error}
              </p>
            )}

            <section className="pd__section" aria-label="案件">
              <h3 className="pd__section-title">
                案件 <span className="pd__count">{data.records.length}</span>
              </h3>
              {data.records.length === 0 ? (
                <p className="pd__empty">还没有任何记录，保持靠谱！</p>
              ) : (
                <div className="pd__cases">
                  {data.records.filter((r) => r.id !== pinned?.id).map((r) => renderCase(r, false))}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>

      {/* A sibling, like SessionDetailDialog's RollCallDialog: its own layer in the modal stack. */}
      {appealing && (
        <AppealSheet
          key={appealing.id}
          record={appealing}
          onClose={() => setAppealing(null)}
          onAppealed={() => {
            setAppealing(null);
            void load();
            onChanged?.();
          }}
        />
      )}
    </>
  );
}

export type { HistoryPoint };
