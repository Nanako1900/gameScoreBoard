import { useState } from 'react';
import { quickSlots } from '@shared/quickTime';
import type { QuickSlot } from '@shared/quickTime';
import type { SessionDetail } from '../types';
import { ApiError, updateSession } from '../api';
import { CUSTOM_TIME_LEAD_MS } from '../lib/constants';
import { formatDateTime, formatWhen, toDateTimeLocalValue } from '../lib/time';
import { parseCustomTime, rescheduleConsequences, rescheduleSlots } from '../lib/sessionActions';
import { Modal } from './Modal';
import './reschedule-sheet.css';

interface RescheduleSheetProps {
  session: SessionDetail;
  onClose: () => void;
  onRescheduled: (session: SessionDetail) => void;
}

interface Target {
  iso: string;
  label: string;
}

/** The time the confirm button moves to; null when 其他时间 holds nothing usable. */
function currentTarget(
  slots: readonly QuickSlot[],
  chosen: string | null,
  customOpen: boolean,
  custom: string,
): Target | null {
  if (customOpen) {
    const parsed = parseCustomTime(custom);
    return parsed.ok ? { iso: parsed.iso, label: formatWhen(parsed.iso) } : null;
  }
  const slot = slots.find((s) => s.iso === chosen);
  return slot ? { iso: slot.iso, label: slot.label } : null;
}

/** Why there is nothing to move to: 其他时间 is empty or unreadable. */
function missingTargetError(custom: string): string {
  const parsed = parseCustomTime(custom);
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
export function RescheduleSheet({ session, onClose, onRescheduled }: RescheduleSheetProps): JSX.Element {
  // Computed once per open: the chips must not shift under the organizer's finger.
  const [slots] = useState(() => rescheduleSlots(quickSlots(), session.starts_at));
  const [chosen, setChosen] = useState<string | null>(() => slots[0]?.iso ?? null);
  const [customOpen, setCustomOpen] = useState(() => slots.length === 0);
  const [custom, setCustom] = useState(() => toDateTimeLocalValue(Date.now() + CUSTOM_TIME_LEAD_MS));
  const { error, busy, move, fail } = useMoveSession(session.id, onRescheduled);

  const target = currentTarget(slots, chosen, customOpen, custom);
  const submit = (): void => {
    if (target) {
      void move(target.iso);
    } else {
      fail(missingTargetError(custom));
    }
  };

  return (
    <Modal open onClose={onClose} labelledBy="reschedule-title" variant="sheet" title="改到什么时候？">
      <div className="rss">
        <p className="rss__now">
          现在：<span className="tabular">{formatDateTime(session.starts_at)}</span>（本地时间）
        </p>
        <SlotPicker
          slots={slots}
          chosen={chosen}
          customOpen={customOpen}
          custom={custom}
          onChoose={(iso) => {
            setChosen(iso);
            setCustomOpen(false);
          }}
          onToggleCustom={() => setCustomOpen((open) => !open)}
          onCustomChange={setCustom}
        />
        <Consequences session={session} target={target} />
        <SheetActions
          error={error}
          busy={busy}
          target={target}
          onClose={onClose}
          onSubmit={submit}
        />
      </div>
    </Modal>
  );
}

interface SlotPickerProps {
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
      <legend className="visually-hidden">新的时间（本地时间）</legend>
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
