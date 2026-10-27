// The buttons under a case on a player's page: 说明情况 / 申诉 / 撤案 / 撤销 /
// 改判, each shown only to whoever the API would let do it (worker/cases.ts).
// Moved out of PlayerDetail.tsx; class names stay in player-detail.css.

import { useState } from 'react';
import type { RecordItem, SentencingRange, User } from '../types';
import { formatRevokeLeft, revokeMsLeft } from '../lib/revoke';

interface RevokeState {
  allowed: boolean;
  /** Time left for the reporter; null for an admin, who has no clock. */
  msLeft: number | null;
}

/** Post-verdict reversal: any admin at any time, or the reporter while REVOKE_WINDOW_MS lasts. */
function revokeState(record: RecordItem, me: User | null, now: number): RevokeState {
  if (!me || (record.status !== 'decided' && record.status !== 'appealed')) return { allowed: false, msLeft: null };
  if (me.is_admin) return { allowed: true, msLeft: null };
  if (record.reporter.id !== me.id) return { allowed: false, msLeft: null };
  const msLeft = revokeMsLeft(record.created_at, now);
  return { allowed: msLeft > 0, msLeft };
}

/** 「撤销 · 还剩 12 分钟」 for the reporter (spec §5 #6); a plain 「撤销」 for an admin. */
function revokeLabel(msLeft: number | null): string {
  return msLeft === null ? '撤销' : `撤销 · ${formatRevokeLeft(msLeft)}`;
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
  /** The page's clock (useNow(REVOKE_TICK_MS)): the revoke countdown reads it. */
  now: number;
  /** Rendered first, full width: the self view's ForgivenessNote. */
  note?: React.ReactNode;
  onStartOverride: () => void;
  onCancelOverride: () => void;
  onStatement: () => void;
  onAppeal: () => void;
  onWithdraw: () => void;
  onRevoke: () => void;
  onOverride: (delta: number, reason: string) => void;
}

export function CaseActions(props: CaseActionsProps): JSX.Element | null {
  const { record, me, isSelf, busy, overriding, now, note } = props;
  // Only an admin re-sentences, and an admin always gets the full case: range is null only for a hidden one.
  if (overriding && record.range) {
    return (
      <OverrideForm
        record={record}
        range={record.range}
        onCancel={props.onCancelOverride}
        onSubmit={props.onOverride}
      />
    );
  }
  const revoke = revokeState(record, me, now);
  const shown = {
    statement: isSelf && record.status === 'awaiting_statement',
    appeal: isSelf && record.status === 'decided',
    withdraw: canWithdraw(record, me),
    revoke: revoke.allowed,
    override: me?.is_admin === true && (record.status === 'appealed' || record.status === 'decided'),
  };
  if (!note && !Object.values(shown).some(Boolean)) return null;

  return (
    <>
      {note}
      {shown.statement && (
        <button type="button" className="btn btn--gold btn--sm" onClick={props.onStatement}>
          说明情况
        </button>
      )}
      {shown.appeal && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onAppeal} disabled={busy}>
          申诉
        </button>
      )}
      {shown.withdraw && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onWithdraw} disabled={busy}>
          {busy ? '撤案中…' : '撤案'}
        </button>
      )}
      {shown.revoke && (
        <button type="button" className="btn btn--ghost btn--sm pd__revoke-btn" onClick={props.onRevoke} disabled={busy}>
          {busy ? '撤销中…' : revokeLabel(revoke.msLeft)}
        </button>
      )}
      {shown.override && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={props.onStartOverride} disabled={busy}>
          改判
        </button>
      )}
    </>
  );
}

interface OverrideFormProps {
  record: RecordItem;
  range: SentencingRange;
  onCancel: () => void;
  onSubmit: (delta: number, reason: string) => void;
}

/** Admin re-sentencing. The delta is bounded server-side by the same clamp. */
function OverrideForm({ record, range, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
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
          改判为（{range.min} ~ {range.max}）
        </span>
        <input
          className="pd__override-input tabular"
          type="number"
          min={range.min}
          max={range.max}
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
