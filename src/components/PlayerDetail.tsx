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
  withdrawCase,
} from '../api';
import { REVOKE_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { BACK_HOME, CASE_GONE, PAGE_BACK_LABEL, PINNED_CASE_LABEL, PLAYER_NOT_FOUND, SEE_BOARD, pinnedCaseEyebrow } from '../lib/routeCopy';
import { HOME_PATH, boardPath, playerPath, settingsPath, toolsPath } from '../lib/routes';
import { useNow } from '../lib/useNow';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import { VerdictCard } from './VerdictCard';
import { HistoryChart } from './HistoryChart';
import { Link } from './Link';
import { VoiceLog } from './VoiceLog';
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
  /** Show only this case and focus it once loaded (a link from Discord). */
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

/** A new subject or viewer gets a fresh state before effects, never the old person's data. */
export function PlayerDetail(props: PlayerDetailProps): JSX.Element {
  const scope = JSON.stringify([props.userId, props.me?.id ?? null, props.me?.is_admin === true,
    props.me?.is_judge === true, props.focusRecordId ?? null]);
  const source = useRef({ record: props.pinnedRecord, scope: scope as string | null });
  if (source.current.record !== props.pinnedRecord) {
    source.current = { record: props.pinnedRecord, scope };
  } else if (source.current.scope !== scope) {
    // A route seed is viewer-specific too. A refreshed object can establish a new scope.
    source.current.scope = null;
  }
  const safePinned = source.current.scope === scope && props.pinnedRecord?.subject.id === props.userId
    ? props.pinnedRecord : null;
  return <PlayerDetailContent key={scope} {...props} pinnedRecord={safePinned} />;
}

function PlayerDetailContent({
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

  const alive = useRef(true);
  const request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; request.current += 1; };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const version = ++request.current;
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await getUserDetail(userId);
      if (!alive.current || version !== request.current) return;
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (!alive.current || version !== request.current) return;
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
      if (!alive.current) return;
      await load();
      if (alive.current) onChanged?.();
    } catch (err) {
      if (!alive.current) return;
      setState((prev) => ({
        ...prev,
        error: err instanceof ApiError ? err.message : '操作失败',
      }));
    } finally {
      if (alive.current) setBusyId(null);
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

  // The same case actions and permissions in both the single-case and personal views.
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

        {data && focusRecordId !== null && pinned === null && (
          <NotFound title={CASE_GONE} headingId={TITLE_ID} actions={[{ label: BACK_HOME, to: HOME_PATH }, { label: SEE_BOARD, to: boardPath('list') }]} />
        )}

        {data && (focusRecordId === null || pinned !== null) && (
          <div className={`pd${focusRecordId !== null ? ' pd--case' : ''}`}>
            {pinned ? (
              <>
                <header className="pd__case-header">
                  <h2 id={TITLE_ID} className="pd__name" tabIndex={-1}>案件 #{pinned.id}</h2>
                  <p className="pd__context">当事人 <Link to={playerPath(userId)}>{data.user.username}</Link></p>
                </header>
                <section className="pd__section pd__pinned" aria-label={PINNED_CASE_LABEL}>
                  <p className="pd__pinned-eyebrow">{pinnedCaseEyebrow(pinned)}</p>
                  {renderCase(pinned, true)}
                </section>
              </>
            ) : (
              <>
                <header className="pd__header">
                  <ScoreGauge score={score} size={128} strokeWidth={11} tone={isSelf ? 'tier' : 'neutral'} />
                  <div className="pd__id">
                    <div className="pd__name-row">
                      <Avatar name={data.user.username} src={data.user.avatar_url} size={48}
                        ring={isSelf} ringColor={isSelf ? tier.color : undefined} />
                      <h2 id={TITLE_ID} className="pd__name" tabIndex={-1}>{data.user.username}</h2>
                    </div>
                    <div className="pd__badges">
                      {isSelf && <TierBadge tier={tier} />}
                      {data.user.is_judge && <span className="pd__role">裁判</span>}
                      {isSelf && <span className="pd__role pd__role--self">这是你</span>}
                    </div>
                    {isSelf && <p className="pd__blurb">{tier.blurb}</p>}
                    {isSelf && config && data.user.is_participant && (
                      <p className="pd__heal">{healPreviewText(healPreview(data.user.score, config, now))}</p>
                    )}
                    <div className="pd__links">
                      {!isSelf && me !== null && (me.is_admin || me.is_judge) && (
                        <Link to={toolsPath('voice', userId)}>查看语音记录</Link>
                      )}
                      {me?.is_admin === true && <>
                        <Link to={settingsPath('members')}>管理成员身份</Link>
                        <Link to={toolsPath('score', userId)}>调整分数</Link>
                      </>}
                    </div>
                  </div>
                </header>

                <section className="pd__section" aria-label="分数走势">
                  <h3 className="pd__section-title">分数走势</h3>
                  <HistoryChart history={data.history} color={isSelf ? tier.color : 'var(--score-chip-fg)'} />
                </section>

                <section className="pd__section" aria-label="案件">
                  <h3 className="pd__section-title">案件 <span className="pd__count">{data.records.length}</span></h3>
                  {data.records.length === 0 ? <p className="pd__empty">还没有任何记录，保持靠谱！</p> : (
                    <div className="pd__cases">{data.records.map((r) => renderCase(r, false))}</div>
                  )}
                </section>

                {isSelf && me && (
                  <section className="pd__section" aria-label="个人语音记录">
                    <VoiceLog ownerId={me.id} userId={me.id} offsetHours={config?.boardTzOffsetHours ?? 8} />
                  </section>
                )}
              </>
            )}

            {state.error && <p className="pd__inline-error" role="alert">{state.error}</p>}
          </div>
        )}
      </Modal>

      {/* A sibling with its own layer in the modal stack. */}
      {appealing && (
        <AppealSheet
          key={appealing.id}
          record={appealing}
          onClose={() => setAppealing(null)}
          onAppealed={() => {
            if (!alive.current) return;
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
