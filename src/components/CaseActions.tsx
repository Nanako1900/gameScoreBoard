// The buttons under a case on a player's page: 说明情况 / 申诉 / 撤案 / 撤销 /
// 改判, each shown only to whoever the API would let do it (worker/cases.ts).
// Moved out of PlayerDetail.tsx; class names stay in player-detail.css.

import { useState } from 'react';
import { REVOKE_WINDOW_MS } from '@shared/scoring';
import type { RecordItem, User } from '../types';
import { parseTimestamp } from '../lib/time';

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

export function CaseActions({
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
