import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ATTENDANCE_DEFS } from '@shared/attendance';
import { VIOLATION_MAP } from '@shared/scoring';
import type { CaseDraft, SessionDetail, SessionPlayer, SettleEntry } from '../types';
import { ApiError, rollCall, settleSession } from '../api';
import { LATE_MINUTES_MAX, isRollCallDraftEmpty, mergeMarks, toStoredMark, validateRollCallDraft,
  type MarkInput, type RollCallDraftValue } from '../lib/draftShapes';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Avatar } from './Avatar';
import { SentencingScale } from './SentencingScale';
import './roll-call.css';

const NO_MARK: Readonly<MarkInput> = Object.freeze({ attendance: null, lateMinutes: '' });
export interface RollCallFlowState { dirty: boolean; step: 1 | 2; requestClose: () => void }
interface FlowProps {
  session: SessionDetail; titleId: string; onClose: () => void;
  onSettled: (session: SessionDetail, created: number) => void; variant: 'dialog' | 'page';
  /** Lets the outer Modal / PageBar reuse this flow's one draft and leave guard. */
  onStateChange?: (state: RollCallFlowState) => void;
}
interface WriteState {
  drafts: CaseDraft[] | null; picked: Set<string>; claims: Record<string, string>; busy: boolean; error: string | null;
}
interface WriteContext {
  session: SessionDetail; roster: SessionPlayer[]; marks: Record<string, MarkInput>; state: WriteState;
  setState: Dispatch<SetStateAction<WriteState>>; clearDraft: () => void; onSettled: FlowProps['onSettled'];
}
function useMarks(session: SessionDetail) {
  const roster = useMemo(() => session.players.filter((p) => p.rsvp !== 'out'), [session.players]);
  const ids = useMemo(() => roster.map((p) => p.user.id), [roster]);
  const draft = useDraft<RollCallDraftValue>('rollcall', session.id, {}, {
    validate: (raw) => validateRollCallDraft(raw, ids), isEmpty: isRollCallDraftEmpty,
  });
  const [marks, setMarks] = useState<Record<string, MarkInput>>(() => mergeMarks(roster, draft.value));
  const setMark = (userId: string, patch: Partial<MarkInput>): void => {
    const next = { ...(marks[userId] ?? NO_MARK), ...patch };
    setMarks((old) => ({ ...old, [userId]: { ...(old[userId] ?? NO_MARK), ...patch } }));
    const stored = toStoredMark(next);
    if (stored) draft.setValue((old) => ({ ...old, [userId]: stored }));
  };
  return { roster, draft, marks, setMark, markedCount: Object.values(marks).filter((m) => m.attendance !== null).length };
}
async function submitRollCall(ctx: WriteContext): Promise<void> {
  const entries = ctx.roster.flatMap((p) => {
    const mark = ctx.marks[p.user.id];
    return mark?.attendance ? [{ user_id: p.user.id, attendance: mark.attendance,
      late_minutes: mark.attendance === 'late' && mark.lateMinutes ? Number(mark.lateMinutes) : undefined }] : [];
  });
  if (!entries.length) { ctx.setState((old) => ({ ...old, error: '至少给一个人点名' })); return; }
  ctx.setState((old) => ({ ...old, busy: true, error: null }));
  try {
    const res = await rollCall(ctx.session.id, entries);
    ctx.setState((old) => ({ ...old, drafts: res.drafts,
      picked: new Set(res.drafts.filter((d) => d.kind === 'bonus').map((d) => d.user_id)),
      claims: Object.fromEntries(res.drafts.map((d) => [d.user_id, d.suggested_claim])), busy: false }));
  } catch (err) { ctx.setState((old) => ({ ...old, error: err instanceof ApiError ? err.message : '点名失败', busy: false })); }
}
async function submitSettle(ctx: WriteContext, skipAll: boolean): Promise<void> {
  const file: SettleEntry[] = skipAll ? [] : (ctx.state.drafts ?? []).filter((d) => ctx.state.picked.has(d.user_id))
    .map((d) => ({ user_id: d.user_id, type: d.type, claim: ctx.state.claims[d.user_id] ?? d.suggested_claim }));
  ctx.setState((old) => ({ ...old, busy: true, error: null }));
  try {
    const res = await settleSession(ctx.session.id, file, skipAll);
    ctx.clearDraft(); ctx.onSettled(res.session, res.created);
  } catch (err) { ctx.setState((old) => ({ ...old, error: err instanceof ApiError ? err.message : '结算失败', busy: false })); }
}
function useFlowModel(props: FlowProps) {
  const marks = useMarks(props.session);
  const [state, setState] = useState<WriteState>({ drafts: null, picked: new Set(), claims: {}, busy: false, error: null });
  const context = { ...marks, state, setState, session: props.session, clearDraft: marks.draft.clear, onSettled: props.onSettled };
  const toggle = (userId: string): void => setState((old) => {
    const picked = new Set(old.picked);
    if (picked.has(userId)) picked.delete(userId); else picked.add(userId);
    return { ...old, picked };
  });
  const setClaim = (id: string, text: string): void => setState((old) => ({ ...old, claims: { ...old.claims, [id]: text } }));
  return { ...marks, state, toggle, setClaim, save: () => submitRollCall(context), settle: (skip: boolean) => submitSettle(context, skip) };
}
type FlowModel = ReturnType<typeof useFlowModel>;
function useFlowLeave(dirty: boolean, busy: boolean, onClose: () => void) {
  const leave = useLeaveGuard(dirty, onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  const requestClose = (): void => {
    if (busy) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leave.requestClose();
  };
  const stay = (): void => { refocus.current = true; leave.stay(); };
  useEffect(() => {
    if (!leave.confirmingLeave && refocus.current) {
      refocus.current = false;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    }
  }, [leave.confirmingLeave]);
  return { ...leave, requestClose, stay };
}
type FlowLeave = ReturnType<typeof useFlowLeave>;
function useFlowBridge(props: FlowProps, dirty: boolean, step: 1 | 2, requestClose: () => void): void {
  const close = useRef(requestClose); close.current = requestClose;
  const stableClose = useCallback(() => close.current(), []);
  useEffect(() => { props.onStateChange?.({ dirty, step, requestClose: stableClose }); }, [props.onStateChange, dirty, step, stableClose]);
}
function LateMinutes({ player, model }: { player: SessionPlayer; model: FlowModel }): JSX.Element | null {
  const mark = model.marks[player.user.id];
  if (mark?.attendance !== 'late') return null;
  return <label className="rc-row__late"><span className="visually-hidden">{player.user.username} 迟到分钟数</span>
    <input className="rc-row__late-input tabular" type="number" min={0} max={LATE_MINUTES_MAX} value={mark.lateMinutes}
      onChange={(e) => model.setMark(player.user.id, { lateMinutes: e.target.value })} placeholder="0" />
    <span className="rc-row__late-unit">分钟</span></label>;
}
function RosterPerson({ player: p, model }: { player: SessionPlayer; model: FlowModel }): JSX.Element {
  return <li className="rc-row"><span className="rc-row__who">
    <Avatar name={p.user.username} src={p.user.avatar_url} size={26} /><span className="rc-row__name">{p.user.username}</span>
    {p.rsvp === 'maybe' && <span className="rc-row__tag">待定</span>}{!p.is_participant && <span className="rc-row__tag">未上榜</span>}
  </span><span className="rc-row__marks" role="group" aria-label={`${p.user.username} 出勤`}>
    {ATTENDANCE_DEFS.map((d) => <button key={d.value} type="button"
      className={`rc-mark${model.marks[p.user.id]?.attendance === d.value ? ' rc-mark--on' : ''} rc-mark--${d.value}`}
      aria-pressed={model.marks[p.user.id]?.attendance === d.value} onClick={() => model.setMark(p.user.id, { attendance: d.value })}>
      <span aria-hidden="true">{d.emoji}</span> {d.label}</button>)}
  </span><LateMinutes player={p} model={model} /></li>;
}
function DraftHead({ draft: d, model }: { draft: CaseDraft; model: FlowModel }): JSX.Element {
  const def = VIOLATION_MAP[d.type];
  return <label className="rc-draft__head"><input type="checkbox" checked={model.state.picked.has(d.user_id)} disabled={d.already_filed}
    onChange={() => model.toggle(d.user_id)} /><span className="rc-draft__emoji" aria-hidden="true">{def?.emoji ?? '📝'}</span>
    <span className="rc-draft__text"><strong>{d.username}</strong> · {def?.label ?? d.type}</span>
    <span className={`rc-draft__range tabular ${d.kind === 'bonus' ? 'rc-draft__range--up' : 'rc-draft__range--down'}`}>
      {d.kind === 'bonus' ? `+${d.range.base}` : `${d.range.min} ~ ${d.range.max}`}</span></label>;
}
function DraftItem({ draft: d, model }: { draft: CaseDraft; model: FlowModel }): JSX.Element {
  const on = model.state.picked.has(d.user_id);
  return <li className={`rc-draft${on ? ' rc-draft--on' : ''}${d.already_filed ? ' rc-draft--filed' : ''}`}>
    <DraftHead draft={d} model={model} />{d.already_filed && <p className="rc-draft__filed">已经立过案了，跳过。</p>}
    {on && !d.already_filed && <div className="rc-draft__body">{d.kind === 'penalty' && <SentencingScale range={d.range} compact />}
      <textarea className="rc-draft__claim" rows={2} value={model.state.claims[d.user_id] ?? ''}
        onChange={(e) => model.setClaim(d.user_id, e.target.value)} aria-label={`${d.username} 的事实描述`} /></div>}
  </li>;
}
function FlowActions({ model, leave }: { model: FlowModel; leave: FlowLeave }): JSX.Element {
  const { state } = model;
  if (leave.confirmingLeave) return <ConfirmInline question="点名还没提交，标记会留在这台设备上。" cancelLabel="继续点名"
    confirmLabel="先离开" onCancel={leave.stay} onConfirm={leave.confirmLeave} tone="primary" focus="cancel" />;
  return state.drafts === null ? <div className="rc__actions">
    <button ref={leave.triggerRef} type="button" className="btn btn--ghost" onClick={leave.requestClose} disabled={state.busy}>取消</button>
    <button type="button" className="btn btn--gold" onClick={() => void model.save()} disabled={state.busy || model.markedCount === 0}>
      {state.busy ? '保存中…' : `保存点名（${model.markedCount} 人）`}</button></div>
    : <div className="rc__actions rc__actions--settle">
      <button type="button" className="btn btn--ghost" onClick={() => void model.settle(true)} disabled={state.busy}>跳过全部，仅记录出勤</button>
      <button type="button" className="btn btn--gold" onClick={() => void model.settle(false)} disabled={state.busy || state.picked.size === 0}>
        {state.busy ? '结算中…' : `确认立案（${state.picked.size}）`}</button></div>;
}
/** The same two-step draft workflow, embedded in either an old dialog or a route page. */
export function RollCallFlow(props: FlowProps): JSX.Element {
  const model = useFlowModel(props);
  const leave = useFlowLeave(model.draft.dirty, model.state.busy, props.onClose);
  const { drafts, error } = model.state;
  useFlowBridge(props, model.draft.dirty, drafts === null ? 1 : 2, leave.requestClose);
  return <div className={`rc rc--${props.variant}`}>
    {props.variant === 'dialog' && <h2 id={props.titleId} className="rc__title">{drafts ? '结算' : '点名'}</h2>}
    <p className="rc__subtitle">{drafts ? '下面是可以立案的条目。勾谁扣谁，不勾就只是记录。'
      : `「${props.session.title}」实际到场情况。点名本身不影响任何人的分数。`}</p>
    {error && <p className="rc__error" role="alert">{error}</p>}
    {drafts === null ? <><ul className="rc__roster">{model.roster.map((p) => <RosterPerson key={p.user.id} player={p} model={model} />)}</ul>
      <DraftNote savedAt={model.draft.savedAt} /></> : drafts.length === 0
      ? <p className="rc__empty">没有需要立案的条目 —— 这一局大家都挺靠谱。</p>
      : <ul className="rc__drafts">{drafts.map((d) => <DraftItem key={d.user_id} draft={d} model={model} />)}</ul>}
    <FlowActions model={model} leave={leave} />
  </div>;
}
