import { useState } from 'react';
import { quickSlots, boardSlots, boardTzLabel } from '@shared/quickTime';
import type { QuickSlot } from '@shared/quickTime';
import type { SessionDetail } from '../types';
import { ApiError, updateSession } from '../api';
import { CUSTOM_TIME_LEAD_MS } from '../lib/constants';
import { formatDateTime, formatWhen, toDateTimeLocalValue, formatBoardDateTime, toBoardInputValue, parseBoardInputValue } from '../lib/time';
import { parseCustomTime, rescheduleConsequences, rescheduleSlots } from '../lib/sessionActions';
import { Modal } from './Modal';
import './reschedule-sheet.css';

interface RescheduleSheetProps {
  session: SessionDetail;
  onClose: () => void;
  onRescheduled: (session: SessionDetail) => void;
  boardTzOffsetHours?: number;
}

interface Target {
  iso: string;
  label: string;
}

function boardCustomTime(value: string, offset: number): ReturnType<typeof parseCustomTime> {
  if (!value.trim()) return { ok: false, error: '选一个时间' };
  const ms = parseBoardInputValue(value, offset);
  return ms === null ? { ok: false, error: '时间格式不对' } : { ok: true, iso: new Date(ms).toISOString() };
}

/** The time the confirm button moves to; null when 其他时间 holds nothing usable. */
function currentTarget(
  slots: readonly QuickSlot[],
  chosen: string | null,
  customOpen: boolean,
  custom: string,
  offset?: number,
): Target | null {
  if (customOpen) {
    const parsed = offset === undefined ? parseCustomTime(custom) : boardCustomTime(custom, offset);
    return parsed.ok ? { iso: parsed.iso, label: formatWhen(parsed.iso, Date.now(), offset) } : null;
  }
  const slot = slots.find((s) => s.iso === chosen);
  return slot ? { iso: slot.iso, label: slot.label } : null;
}

/** Why there is nothing to move to: 其他时间 is empty or unreadable. */
function missingTargetError(custom: string, offset?: number): string {
  const parsed = offset === undefined ? parseCustomTime(custom) : boardCustomTime(custom, offset);
  return parsed.ok ? '选一个时间' : parsed.error;
}

interface MoveSession {
  error: string | null;
  busy: boolean;
  /** PATCH starts_at only; on failure the sheet stays open with the reason. */
  move: (iso: string) => Promise<void>;
  /** Show a reason without asking the server (nothing usable was picked). */
  fail: (message: string) => void;
}

function useMoveSession(sessionId: number, onMoved: (session: SessionDetail) => void): MoveSession {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const move = async (iso: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateSession(sessionId, { starts_at: iso });
      onMoved(res.session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
      setBusy(false);
    }
  };
  return { error, busy, move, fail: setError };
}

/**
 * 改时间 — a sheet over the session detail (two layers, the most a phone gets).
 * It says what a move does before doing it: answers reset to invited
 * (worker/sessions.ts:463-467), one merged DM, the reminders follow. Focus
 * starts on 先不改.
 *
 * Until P2 there is no board timezone, so the slots are the browser's
 * (quickSlots) and the sheet says 本地时间.
 */
function useScheduleTarget(session: SessionDetail, offset?: number) {
  // Once per open: chips must not move under the organizer's finger.
  const [slots] = useState(() => rescheduleSlots(offset === undefined ? quickSlots() : boardSlots(Date.now(), offset), session.starts_at));
  const [chosen, setChosen] = useState<string | null>(() => slots[0]?.iso ?? null);
  const [customOpen, setCustomOpen] = useState(() => slots.length === 0);
  const [custom, setCustom] = useState(() => offset === undefined ? toDateTimeLocalValue(Date.now() + CUSTOM_TIME_LEAD_MS)
    : toBoardInputValue(Date.now() + CUSTOM_TIME_LEAD_MS, offset));
  return { slots, chosen, customOpen, custom, onChoose: (iso: string) => { setChosen(iso); setCustomOpen(false); },
    onToggleCustom: () => setCustomOpen((open) => !open), onCustomChange: setCustom,
    target: currentTarget(slots, chosen, customOpen, custom, offset) };
}
export function RescheduleSheet({ session, onClose, onRescheduled, boardTzOffsetHours: offset }: RescheduleSheetProps): JSX.Element {
  const picker = useScheduleTarget(session, offset);
  const { error, busy, move, fail } = useMoveSession(session.id, onRescheduled);
  const submit = (): void => {
    if (picker.target) void move(picker.target.iso);
    else fail(missingTargetError(picker.custom, offset));
  };
  return <Modal open onClose={onClose} labelledBy="reschedule-title" variant="sheet" title="改到什么时候？" historyKey="reschedule">
    <div className="rss"><p className="rss__now">现在：<span className="tabular">
      {offset === undefined ? formatDateTime(session.starts_at) : formatBoardDateTime(session.starts_at, offset)}</span>
      {offset === undefined && '（本地时间）'}</p>
      <SlotPicker {...picker} zone={offset === undefined ? '本地时间' : boardTzLabel(offset)} />
      <Consequences session={session} target={picker.target} />
      <SheetActions error={error} busy={busy} target={picker.target} onClose={onClose} onSubmit={submit} />
    </div></Modal>;
}

interface SlotPickerProps {
  zone: string;
  slots: readonly QuickSlot[];
  chosen: string | null;
  customOpen: boolean;
  custom: string;
  onChoose: (iso: string) => void;
  onToggleCustom: () => void;
  onCustomChange: (value: string) => void;
}

/** Quick slots as radios plus 其他时间 — the same chips as 约一局 (SessionFormDialog). */
function SlotPicker({
  zone,
  slots,
  chosen,
  customOpen,
  custom,
  onChoose,
  onToggleCustom,
  onCustomChange,
}: SlotPickerProps): JSX.Element {
  return (
    <fieldset className="rss__field">
      <legend className="visually-hidden">新的时间（{zone}）</legend>
      <div className="rss__slots">
        {slots.map((s) => {
          const on = !customOpen && chosen === s.iso;
          return (
            <label key={s.iso} className={`rss__slot${on ? ' rss__slot--on' : ''}`}>
              <input
                type="radio"
                name="reschedule-slot"
                className="visually-hidden"
                checked={on}
                onChange={() => onChoose(s.iso)}
              />
              {s.label}
            </label>
          );
        })}
        <button
          type="button"
          className={`rss__slot rss__slot--custom${customOpen ? ' rss__slot--on' : ''}`}
          aria-expanded={customOpen}
          onClick={onToggleCustom}
        >
          其他时间 <span aria-hidden="true">{customOpen ? '▾' : '▸'}</span>
        </button>
      </div>
      {customOpen && (
        <input
          className="rss__input"
          type="datetime-local"
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
          aria-label="自定义开始时间"
        />
      )}
    </fieldset>
  );
}

interface SheetActionsProps {
  error: string | null;
  busy: boolean;
  target: Target | null;
  onClose: () => void;
  onSubmit: () => void;
}

/** Why a move failed, then 先不改 (focused on open) before 改到 X — DOM order is visual order. */
function SheetActions({ error, busy, target, onClose, onSubmit }: SheetActionsProps): JSX.Element {
  return (
    <>
      {error && (
        <p className="rss__error" role="alert">
          {error}
        </p>
      )}
      <div className="rss__actions">
        <button type="button" className="btn btn--ghost" data-autofocus disabled={busy} onClick={onClose}>
          先不改
        </button>
        <button type="button" className="btn btn--gold" disabled={busy} onClick={onSubmit}>
          {busy ? '提交中…' : target ? `改到 ${target.label}` : '改时间'}
        </button>
      </div>
    </>
  );
}

/** 「改到 22:00 之后：」 and the facts of a move (spec §3.5). */
function Consequences({ session, target }: { session: SessionDetail; target: Target | null }): JSX.Element {
  return (
    <div className="rss__impact">
      <p className="rss__impact-title">{target ? `改到 ${target.label} 之后：` : '改了之后：'}</p>
      <ul className="rss__impact-list">
        {rescheduleConsequences(session).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
