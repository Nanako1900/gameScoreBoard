import { useCallback, useEffect, useRef, useState } from 'react';
import { REVOKE_WINDOW_MS, tierFor } from '@shared/scoring';
import type { HistoryPoint, RecordItem, User, UserDetailResponse } from '../types';
import {
  ApiError,
  appealCase,
  confirmEscalation,
  dismissEscalation,
  getUserDetail,
  overrideCase,
  revokeRecord,
  setJudge,
  setScore,
  withdrawCase,
} from '../api';
import { parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import { VerdictCard } from './VerdictCard';
import { HistoryChart } from './HistoryChart';
import { AdminScoreForm } from './AdminScoreForm';
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
}

interface DetailState {
  status: 'loading' | 'ready' | 'error';
  data: UserDetailResponse | null;
  error: string | null;
}

/** busyId while the judge role is being changed (record ids are positive). */
const JUDGE_BUSY = -1;
/** busyId while the score is being set by hand. */
const SCORE_BUSY = -2;

/** Post-verdict reversal: any admin, or the reporter within 15 minutes. */
function canRevoke(record: RecordItem, me: User | null): boolean {
  if (!me) return false;
  if (record.status !== 'decided' && record.status !== 'appealed') return false;
  if (me.is_admin) return true;
  if (record.reporter.id !== me.id) return false;
  const created = parseTimestamp(record.created_at);
  return !Number.isNaN(created) && Date.now() - created <= REVOKE_WINDOW_MS;
}

/** Pre-verdict withdrawal: no score has moved, so the reporter may just drop it. */
function canWithdraw(record: RecordItem, me: User | null): boolean {
  if (!me) return false;
  if (record.status !== 'awaiting_statement') return false;
  return me.is_admin || record.reporter.id === me.id;
}

export function PlayerDetail({
  userId,
  me,
  onClose,
  onOpenStatement,
  onChanged,
  focusRecordId = null,
}: PlayerDetailProps): JSX.Element {
  const [state, setState] = useState<DetailState>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [busyId, setBusyId] = useState<number | null>(null);
  const [overriding, setOverriding] = useState<number | null>(null);
  const focused = useRef(false);

  // Once the cases are in: bring the linked one into view, and focus it.
  useEffect(() => {
    if (focused.current || focusRecordId === null || state.status !== 'ready') return;
    focused.current = true;
    const card = document.getElementById(`case-${focusRecordId}`);
    if (!card) return; // not among the cases shown here
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    card.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
  }, [focusRecordId, state.status]);

  const load = useCallback(async (): Promise<void> => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await getUserDetail(userId);
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      setState({
        status: 'error',
        data: null,
        error: err instanceof ApiError ? err.message : '加载失败',
      });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <Modal open onClose={onClose} labelledBy="player-detail-title" size="lg">
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
            <ScoreGauge score={score} size={128} strokeWidth={11} />
            <div className="pd__id">
              <div className="pd__name-row">
                <Avatar
                  name={data.user.username}
                  src={data.user.avatar_url}
                  size={48}
                  ring
                  ringColor={tier.color}
                />
                <h2 id="player-detail-title" className="pd__name">
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
                {data.records.map((r) => (
                  <VerdictCard
                    key={r.id}
                    record={r}
                    focused={r.id === focusRecordId}
                    escalation={
                      // Only the filing judge (or an admin) may co-sign the -25
                      // charge, so only they get the buttons — a reporter who is
                      // no judge (any more) does not.
                      me !== null && (me.is_admin || (me.is_judge && r.reporter.id === me.id)) ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => void run(r.id, () => confirmEscalation(r.id))}
                          >
                            确认是团灭级
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => void run(r.id, () => dismissEscalation(r.id))}
                          >
                            维持原案由
                          </button>
                        </>
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
                        onStatement={() => onOpenStatement?.(r)}
                        onAppeal={() => void run(r.id, () => appealCase(r.id))}
                        onWithdraw={() => void run(r.id, () => withdrawCase(r.id))}
                        onRevoke={() => void run(r.id, () => revokeRecord(r.id))}
                        onOverride={(delta, reason) => {
                          setOverriding(null);
                          void run(r.id, () => overrideCase(r.id, delta, reason));
                        }}
                      />
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

interface CaseActionsProps {
  record: RecordItem;
  me: User | null;
  isSelf: boolean;
  busy: boolean;
  overriding: boolean;
  onStartOverride: () => void;
  onCancelOverride: () => void;
  onStatement: () => void;
  onAppeal: () => void;
  onWithdraw: () => void;
  onRevoke: () => void;
  onOverride: (delta: number, reason: string) => void;
}

function CaseActions({
  record,
  me,
  isSelf,
  busy,
  overriding,
  onStartOverride,
  onCancelOverride,
  onStatement,
  onAppeal,
  onWithdraw,
  onRevoke,
  onOverride,
}: CaseActionsProps): JSX.Element | null {
  const showStatement = isSelf && record.status === 'awaiting_statement';
  const showAppeal = isSelf && record.status === 'decided';
  const showWithdraw = canWithdraw(record, me);
  const showRevoke = canRevoke(record, me);
  const showOverride =
    me?.is_admin === true && (record.status === 'appealed' || record.status === 'decided');

  if (overriding) {
    return <OverrideForm record={record} onCancel={onCancelOverride} onSubmit={onOverride} />;
  }

  if (!showStatement && !showAppeal && !showWithdraw && !showRevoke && !showOverride) {
    return null;
  }

  return (
    <>
      {showStatement && (
        <button type="button" className="btn btn--gold btn--sm" onClick={onStatement}>
          说明情况
        </button>
      )}
      {showAppeal && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onAppeal}
          disabled={busy}
        >
          {busy ? '提交中…' : '申诉'}
        </button>
      )}
      {showWithdraw && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onWithdraw}
          disabled={busy}
        >
          {busy ? '撤案中…' : '撤案'}
        </button>
      )}
      {showRevoke && (
        <button
          type="button"
          className="btn btn--ghost btn--sm pd__revoke-btn"
          onClick={onRevoke}
          disabled={busy}
        >
          {busy ? '撤销中…' : '撤销'}
        </button>
      )}
      {showOverride && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onStartOverride}
          disabled={busy}
        >
          改判
        </button>
      )}
    </>
  );
}

interface OverrideFormProps {
  record: RecordItem;
  onCancel: () => void;
  onSubmit: (delta: number, reason: string) => void;
}

/** Admin re-sentencing. The delta is bounded server-side by the same clamp. */
function OverrideForm({ record, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
  const [delta, setDelta] = useState(String(record.delta));
  const [reason, setReason] = useState('');
  const value = Number(delta);
  const valid = Number.isFinite(value) && reason.trim().length > 0;

  return (
    <form
      className="pd__override"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(Math.round(value), reason.trim());
      }}
    >
      <label className="pd__override-field">
        <span className="pd__override-label">
          改判为（{record.range.min} ~ {record.range.max}）
        </span>
        <input
          className="pd__override-input tabular"
          type="number"
          min={record.range.min}
          max={record.range.max}
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
        />
      </label>
      <label className="pd__override-field pd__override-field--grow">
        <span className="pd__override-label">理由（必填）</span>
        <input
          className="pd__override-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="申诉属实，当事人确有不可抗力"
        />
      </label>
      <span className="pd__override-btns">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
          取消
        </button>
        <button type="submit" className="btn btn--gold btn--sm" disabled={!valid}>
          确认改判
        </button>
      </span>
    </form>
  );
}

export type { HistoryPoint };
