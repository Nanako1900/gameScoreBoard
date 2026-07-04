import { useCallback, useEffect, useState } from 'react';
import { tierFor } from '@shared/scoring';
import type { HistoryPoint, RecordItem, UserDetailResponse, User } from '../types';
import { ApiError, disputeRecord, getUserDetail, revokeRecord } from '../api';
import { parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import { RecordsFeed } from './RecordsFeed';
import { HistoryChart } from './HistoryChart';
import './player-detail.css';

interface PlayerDetailProps {
  userId: string;
  me: User | null;
  onClose: () => void;
  /** Called after a mutation (dispute) so parent lists can refresh. */
  onChanged?: () => void;
}

interface DetailState {
  status: 'loading' | 'ready' | 'error';
  data: UserDetailResponse | null;
  error: string | null;
}

const REVOKE_WINDOW_MS = 15 * 60 * 1000;

/** Revocable by its own reporter within 15 minutes, or by any admin — never once revoked. */
function canRevokeRecord(record: RecordItem, me: User | null): boolean {
  if (!me || record.status === 'revoked') {
    return false;
  }
  if (me.is_admin) {
    return true;
  }
  if (record.reporter.id !== me.id) {
    return false;
  }
  const created = parseTimestamp(record.created_at);
  return !Number.isNaN(created) && Date.now() - created <= REVOKE_WINDOW_MS;
}

export function PlayerDetail({
  userId,
  me,
  onClose,
  onChanged,
}: PlayerDetailProps): JSX.Element {
  const [state, setState] = useState<DetailState>({
    status: 'loading',
    data: null,
    error: null,
  });
  const [disputingId, setDisputingId] = useState<number | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);

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

  const handleDispute = async (id: number): Promise<void> => {
    setDisputingId(id);
    try {
      await disputeRecord(id);
      await load();
      onChanged?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof ApiError ? err.message : '申诉失败',
      }));
    } finally {
      setDisputingId(null);
    }
  };

  const handleRevoke = async (id: number): Promise<void> => {
    setRevokingId(id);
    try {
      await revokeRecord(id);
      await load();
      onChanged?.();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof ApiError ? err.message : '撤销失败',
      }));
    } finally {
      setRevokingId(null);
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
              </div>
              <p className="pd__blurb">{tier.blurb}</p>
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

          <section className="pd__section" aria-label="记录">
            <h3 className="pd__section-title">
              记录 <span className="pd__count">{data.records.length}</span>
            </h3>
            <RecordList
              records={data.records}
              me={me}
              isSelf={isSelf}
              disputingId={disputingId}
              revokingId={revokingId}
              onDispute={handleDispute}
              onRevoke={handleRevoke}
            />
          </section>
        </div>
      )}
    </Modal>
  );
}

interface RecordListProps {
  records: RecordItem[];
  me: User | null;
  isSelf: boolean;
  disputingId: number | null;
  revokingId: number | null;
  onDispute: (id: number) => void;
  onRevoke: (id: number) => void;
}

function RecordList({
  records,
  me,
  isSelf,
  disputingId,
  revokingId,
  onDispute,
  onRevoke,
}: RecordListProps): JSX.Element {
  if (records.length === 0) {
    return <p className="pd__empty">还没有任何记录，保持靠谱！</p>;
  }
  const actionable = records.filter(
    (r) => (isSelf && r.status === 'active') || canRevokeRecord(r, me),
  );
  return (
    <div className="pd__records">
      <RecordsFeed records={records} title="" compact />
      {actionable.length > 0 && (
        <ul className="pd__action-list">
          {actionable.map((r) => {
            const showDispute = isSelf && r.status === 'active';
            const showRevoke = canRevokeRecord(r, me);
            return (
              <li key={r.id} className="pd__action-row">
                <span className="pd__action-label">
                  「{r.reporter.username}」记录的这一笔
                </span>
                <span className="pd__action-btns">
                  {showDispute && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => onDispute(r.id)}
                      disabled={disputingId === r.id}
                    >
                      {disputingId === r.id ? '提交中…' : '申诉'}
                    </button>
                  )}
                  {showRevoke && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm pd__revoke-btn"
                      onClick={() => onRevoke(r.id)}
                      disabled={revokingId === r.id}
                    >
                      {revokingId === r.id ? '撤销中…' : '撤销'}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export type { HistoryPoint };
