import { useMemo, useState } from 'react';
import { ATTENDANCE_DEFS } from '@shared/attendance';
import type { Attendance } from '@shared/attendance';
import { VIOLATION_MAP } from '@shared/scoring';
import type { CaseDraft, RollCallEntry, SessionDetail, SettleEntry } from '../types';
import { ApiError, rollCall, settleSession } from '../api';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { SentencingScale } from './SentencingScale';
import './roll-call.css';

interface RollCallDialogProps {
  open: boolean;
  session: SessionDetail;
  onClose: () => void;
  onSettled: (session: SessionDetail, created: number) => void;
}

interface Draftable {
  attendance: Attendance | null;
  lateMinutes: string;
}

/**
 * 点名 → 草稿 → 结算.
 *
 * Step 1 writes attendance only — not a single point moves. Step 2 shows what
 * COULD be filed and files exactly what the organizer ticks. "跳过全部" is a
 * first-class action, not a hidden escape hatch: recording who showed up is
 * useful on its own.
 */
export function RollCallDialog({
  open,
  session,
  onClose,
  onSettled,
}: RollCallDialogProps): JSX.Element {
  const roster = useMemo(
    () => session.players.filter((p) => p.rsvp !== 'out'),
    [session.players],
  );

  const [marks, setMarks] = useState<Record<string, Draftable>>(() =>
    Object.fromEntries(
      roster.map((p) => [
        p.user.id,
        { attendance: p.attendance, lateMinutes: p.late_minutes?.toString() ?? '' },
      ]),
    ),
  );
  const [drafts, setDrafts] = useState<CaseDraft[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [claims, setClaims] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markedCount = Object.values(marks).filter((m) => m.attendance !== null).length;

  const setMark = (userId: string, patch: Partial<Draftable>): void => {
    setMarks((prev) => {
      // The fallback matters: without it, marking someone who is not yet in the
      // map would leave lateMinutes undefined and flip the minutes field from
      // controlled to uncontrolled.
      const current: Draftable = prev[userId] ?? { attendance: null, lateMinutes: '' };
      return { ...prev, [userId]: { ...current, ...patch } };
    });
  };

  const handleRollCall = async (): Promise<void> => {
    const entries: RollCallEntry[] = [];
    for (const p of roster) {
      const mark = marks[p.user.id];
      if (!mark?.attendance) continue;
      entries.push({
        user_id: p.user.id,
        attendance: mark.attendance,
        late_minutes:
          mark.attendance === 'late' && mark.lateMinutes ? Number(mark.lateMinutes) : undefined,
      });
    }
    if (entries.length === 0) {
      setError('至少给一个人点名');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await rollCall(session.id, entries);
      setDrafts(res.drafts);
      // Bonuses are pre-ticked (harmless and capped weekly); penalties require a
      // deliberate click, because they take points off a friend.
      setPicked(new Set(res.drafts.filter((d) => d.kind === 'bonus').map((d) => d.user_id)));
      setClaims(Object.fromEntries(res.drafts.map((d) => [d.user_id, d.suggested_claim])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '点名失败');
    } finally {
      setBusy(false);
    }
  };

  const handleSettle = async (skipAll: boolean): Promise<void> => {
    const file: SettleEntry[] = skipAll
      ? []
      : (drafts ?? [])
          .filter((d) => picked.has(d.user_id))
          .map((d) => ({
            user_id: d.user_id,
            type: d.type,
            claim: claims[d.user_id] ?? d.suggested_claim,
          }));
    setError(null);
    setBusy(true);
    try {
      const res = await settleSession(session.id, file, skipAll);
      onSettled(res.session, res.created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '结算失败');
      setBusy(false);
    }
  };

  const toggle = (userId: string): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <Modal open={open} onClose={onClose} labelledBy="rollcall-title" size="lg">
      <h2 id="rollcall-title" className="rc__title">
        {drafts ? '结算' : '点名'}
      </h2>
      <p className="rc__subtitle">
        {drafts
          ? '下面是可以立案的条目。勾谁扣谁，不勾就只是记录。'
          : `「${session.title}」实际到场情况。点名本身不影响任何人的分数。`}
      </p>

      {error && (
        <p className="rc__error" role="alert">
          {error}
        </p>
      )}

      {!drafts ? (
        <>
          <ul className="rc__roster">
            {roster.map((p) => {
              const mark = marks[p.user.id];
              return (
                <li key={p.user.id} className="rc-row">
                  <span className="rc-row__who">
                    <Avatar name={p.user.username} src={p.user.avatar_url} size={26} />
                    <span className="rc-row__name">{p.user.username}</span>
                    {p.rsvp === 'maybe' && <span className="rc-row__tag">待定</span>}
                    {!p.is_participant && <span className="rc-row__tag">未上榜</span>}
                  </span>

                  <span className="rc-row__marks" role="group" aria-label={`${p.user.username} 出勤`}>
                    {ATTENDANCE_DEFS.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        className={`rc-mark${
                          mark?.attendance === d.value ? ' rc-mark--on' : ''
                        } rc-mark--${d.value}`}
                        aria-pressed={mark?.attendance === d.value}
                        onClick={() => setMark(p.user.id, { attendance: d.value })}
                      >
                        <span aria-hidden="true">{d.emoji}</span> {d.label}
                      </button>
                    ))}
                  </span>

                  {mark?.attendance === 'late' && (
                    <label className="rc-row__late">
                      <span className="visually-hidden">{p.user.username} 迟到分钟数</span>
                      <input
                        className="rc-row__late-input tabular"
                        type="number"
                        min={0}
                        max={1440}
                        value={mark.lateMinutes}
                        onChange={(e) => setMark(p.user.id, { lateMinutes: e.target.value })}
                        placeholder="0"
                      />
                      <span className="rc-row__late-unit">分钟</span>
                    </label>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="rc__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => void handleRollCall()}
              disabled={busy || markedCount === 0}
            >
              {busy ? '保存中…' : `保存点名（${markedCount} 人）`}
            </button>
          </div>
        </>
      ) : (
        <>
          {drafts.length === 0 ? (
            <p className="rc__empty">没有需要立案的条目 —— 这一局大家都挺靠谱。</p>
          ) : (
            <ul className="rc__drafts">
              {drafts.map((d) => {
                const def = VIOLATION_MAP[d.type];
                const on = picked.has(d.user_id);
                return (
                  <li
                    key={d.user_id}
                    className={`rc-draft${on ? ' rc-draft--on' : ''}${
                      d.already_filed ? ' rc-draft--filed' : ''
                    }`}
                  >
                    <label className="rc-draft__head">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={d.already_filed}
                        onChange={() => toggle(d.user_id)}
                      />
                      <span className="rc-draft__emoji" aria-hidden="true">
                        {def?.emoji ?? '📝'}
                      </span>
                      <span className="rc-draft__text">
                        <strong>{d.username}</strong> · {def?.label ?? d.type}
                      </span>
                      <span
                        className={`rc-draft__range tabular ${
                          d.kind === 'bonus' ? 'rc-draft__range--up' : 'rc-draft__range--down'
                        }`}
                      >
                        {d.kind === 'bonus'
                          ? `+${d.range.base}`
                          : `${d.range.min} ~ ${d.range.max}`}
                      </span>
                    </label>

                    {d.already_filed && <p className="rc-draft__filed">已经立过案了，跳过。</p>}

                    {on && !d.already_filed && (
                      <div className="rc-draft__body">
                        {d.kind === 'penalty' && <SentencingScale range={d.range} compact />}
                        <textarea
                          className="rc-draft__claim"
                          rows={2}
                          value={claims[d.user_id] ?? ''}
                          onChange={(e) =>
                            setClaims((prev) => ({ ...prev, [d.user_id]: e.target.value }))
                          }
                          aria-label={`${d.username} 的事实描述`}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="rc__actions rc__actions--settle">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void handleSettle(true)}
              disabled={busy}
            >
              跳过全部，仅记录出勤
            </button>
            <button
              type="button"
              className="btn btn--gold"
              onClick={() => void handleSettle(false)}
              disabled={busy || picked.size === 0}
            >
              {busy ? '结算中…' : `确认立案（${picked.size}）`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
