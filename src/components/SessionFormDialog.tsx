import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_INVITES, MAX_SESSION_ROSTER, SESSION_GAME_MAX, SESSION_NOTE_MAX } from '@shared/attendance';
import { boardSlots, boardTzLabel, quickSlots, type QuickSlot } from '@shared/quickTime';
import type { NewSessionInput, PublicUser, SessionDetail, SessionItem } from '../types';
import { ApiError, createSession } from '../api';
import { CUSTOM_TIME_LEAD_MS, SESSION_CAPACITY_MIN } from '../lib/constants';
import { isSessionDraftEmpty, validateSessionDraft, type SessionDraftValue } from '../lib/draftShapes';
import { lastLineup, pickerGroups, pickLineup, toggleInvite } from '../lib/invitePicker';
import type { AgainPrefill } from '../lib/sessionAgain';
import { quotaHint, sessionQuota } from '../lib/sessionConsole';
import { parseBoardInputValue, toBoardInputValue, toDateTimeLocalValue } from '../lib/time';
import type { Invitable } from '../lib/useInvitable';
import { useDraft } from '../lib/useDraft';
import { useLeaveGuard } from '../lib/useLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { DraftNote } from './DraftNote';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { PageBar } from './PageBar';
import { PeoplePicker } from './PeoplePicker';
import './session-form.css';

interface SessionFormDialogProps {
  open: boolean; participants: PublicUser[]; selfId: string | null; onClose: () => void; onCreated: (session: SessionDetail) => void;
  variant?: 'center' | 'page'; routed?: boolean; boardTzOffsetHours?: number; invitable?: Invitable;
  again?: AgainPrefill; mySessions?: readonly SessionItem[] | null;
}
type More = NonNullable<SessionDraftValue['more']>;
const EMPTY_SESSION: SessionDraftValue = { invite: [], custom: '', chosen: null };
const EMPTY_MORE: More = { game: '', capacity: '', durationMin: '', note: '' };
function inputTime(ms: number, offset?: number): string {
  return offset === undefined ? toDateTimeLocalValue(ms) : toBoardInputValue(ms, offset);
}
function initialSession(again?: AgainPrefill, offset?: number): SessionDraftValue {
  return again ? { invite: again.invite, custom: inputTime(Date.parse(again.startsAt), offset), chosen: null,
    more: { game: again.game ?? '', capacity: again.capacity?.toString() ?? '', durationMin: again.durationMin?.toString() ?? '', note: '' } } : EMPTY_SESSION;
}
function extendedEmpty(value: SessionDraftValue, enhanced: boolean): boolean {
  return isSessionDraftEmpty(value) && (!enhanced || Object.values(value.more ?? EMPTY_MORE).every((v) => !v.trim()));
}
function useSessionForm(props: SessionFormDialogProps) {
  const enhanced = !!(props.routed || props.variant || props.invitable || props.again || props.boardTzOffsetHours !== undefined || props.mySessions);
  const offset = props.boardTzOffsetHours;
  const slots = useMemo(() => offset === undefined ? quickSlots() : boardSlots(Date.now(), offset), [props.open, offset]);
  const participants = props.participants.filter((p) => p.id !== props.selfId);
  const state = props.invitable?.state;
  const users = state?.kind === 'ready' ? state.users : null;
  const ids = (users ?? participants).map((p) => p.id);
  const draft = useDraft<SessionDraftValue>('session', undefined, initialSession(props.again, offset), {
    validate: (raw) => {
      const value = validateSessionDraft(raw, ids, slots.map((s) => s.iso));
      return value && enhanced ? { ...value, invite: value.invite.slice(0, MAX_INVITES) } : value;
    }, isEmpty: (value) => extendedEmpty(value, enhanced),
  });
  const [customOpen, setCustomOpen] = useState(() => draft.value.chosen === null && draft.value.custom !== '');
  const [moreOpen, setMoreOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = draft.value.chosen ?? slots[0]?.iso ?? '';
  const set = (patch: Partial<SessionDraftValue>): void => draft.setValue((old) => ({ ...old, ...patch }));
  const toggleCustom = (): void => {
    setCustomOpen(!customOpen); set({ chosen: customOpen ? chosen || null : null,
      custom: !customOpen && !draft.value.custom ? inputTime(Date.now() + CUSTOM_TIME_LEAD_MS, offset) : draft.value.custom });
  };
  const choose = (iso: string): void => { set({ chosen: iso }); setCustomOpen(false); };
  const pick = (id: string): void => draft.setValue((old) => ({ ...old, invite: enhanced ? toggleInvite(old.invite, id)
    : old.invite.includes(id) ? old.invite.filter((picked) => picked !== id) : [...old.invite, id] }));
  const pickLast = (): void => draft.setValue((old) => ({ ...old, invite: pickLineup(old.invite, lastLineup(users ?? []), ids) }));
  const setMore = (key: keyof More, value: string): void => draft.setValue((old) => ({ ...old, more: { ...EMPTY_MORE, ...old.more, [key]: value } }));
  return { enhanced, slots, participants, users, draft, chosen, customOpen, moreOpen, setMoreOpen, query, setQuery,
    set, toggleCustom, choose, pick, pickLast, setMore };
}
type FormModel = ReturnType<typeof useSessionForm>;
function useFormGuard(dirty: boolean, onClose: () => void) {
  const guard = useLeaveGuard(dirty, onClose);
  const target = useRef<HTMLElement | null>(null); const restore = useRef(false);
  const requestClose = (): void => {
    if (guard.confirmingLeave) return;
    target.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; guard.requestClose();
  };
  const stay = (): void => { restore.current = true; guard.stay(); };
  useEffect(() => { if (!guard.confirmingLeave && restore.current) { restore.current = false; if (target.current?.isConnected) target.current.focus(); } }, [guard.confirmingLeave]);
  return { ...guard, requestClose, stay };
}
function sessionInput(model: FormModel, props: SessionFormDialogProps): NewSessionInput | string {
  let startsAt = model.chosen;
  if (model.customOpen && model.draft.value.custom) {
    const ms = props.boardTzOffsetHours === undefined ? Date.parse(model.draft.value.custom) : parseBoardInputValue(model.draft.value.custom, props.boardTzOffsetHours);
    if (ms === null || !Number.isFinite(ms)) return '时间格式不对';
    startsAt = new Date(ms).toISOString();
  }
  if (!startsAt) return '选一个时间';
  const more = model.enhanced ? model.draft.value.more ?? EMPTY_MORE : EMPTY_MORE;
  return { starts_at: startsAt, invite: model.draft.value.invite, ...(props.again?.title ? { title: props.again.title } : {}),
    ...(more.game.trim() ? { game: more.game.trim() } : {}), ...(more.capacity ? { capacity: Number(more.capacity) } : {}),
    ...(more.durationMin ? { duration_min: Number(more.durationMin) } : {}), ...(more.note.trim() ? { note: more.note.trim() } : {}) };
}
function useSessionSubmit(model: FormModel, props: SessionFormDialogProps) {
  const [error, setError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault(); setError(null);
    const input = sessionInput(model, props);
    if (typeof input === 'string') { setError(input); return; }
    setSubmitting(true);
    try { const { session } = await createSession(input); model.draft.clear(); props.onCreated(session); if (!props.routed) props.onClose(); }
    catch (err) { setError(err instanceof ApiError ? err.message : '创建失败，请稍后重试'); setSubmitting(false); }
  };
  return { error, submitting, submit };
}
function SlotChoice({ slot, model }: { slot: QuickSlot; model: FormModel }): JSX.Element {
  const checked = !model.customOpen && model.chosen === slot.iso;
  return <label className={`sf-slot${checked ? ' sf-slot--on' : ''}`}><input type="radio" name="quick-slot" className="visually-hidden"
    checked={checked} onChange={() => model.choose(slot.iso)} />{slot.label}</label>;
}
function TimeField({ model, offset }: { model: FormModel; offset?: number }): JSX.Element {
  return <fieldset className="sf__field"><legend className="sf__label">什么时候？{offset !== undefined && `（${boardTzLabel(offset)}）`}</legend>
    <div className="sf__slots">{model.slots.map((s) => <SlotChoice key={s.iso} slot={s} model={model} />)}
      <button type="button" className={`sf-slot sf-slot--custom${model.customOpen ? ' sf-slot--on' : ''}`} aria-expanded={model.customOpen}
        onClick={model.toggleCustom}>其他时间 {model.customOpen ? '▾' : '▸'}</button></div>
    {model.customOpen && <input className="sf__input sf__input--custom" type="datetime-local" value={model.draft.value.custom}
      onChange={(e) => model.set({ custom: e.target.value })} aria-label="自定义开始时间" />}</fieldset>;
}
function LegacyPeople({ model }: { model: FormModel }): JSX.Element {
  if (!model.participants.length) return <span className="sf__hint">还没有其他选手可以邀请。</span>;
  return <div className="sf__people">{model.participants.map((p) => {
    const on = model.draft.value.invite.includes(p.id);
    return <label key={p.id} className={`sf-person${on ? ' sf-person--on' : ''}`}><input type="checkbox" className="visually-hidden"
      checked={on} onChange={() => model.pick(p.id)} /><Avatar name={p.username} src={p.avatar_url} size={24} /><span className="sf-person__name">{p.username}</span></label>;
  })}</div>;
}
function PeopleField({ model, busy }: { model: FormModel; busy: boolean }): JSX.Element {
  const count = model.draft.value.invite.length;
  return <fieldset className="sf__field"><legend className="sf__label">叫谁？{count > 0 && <span className="sf__count tabular">已选 {count}</span>}</legend>
    {model.users ? <PeoplePicker groups={pickerGroups(model.users, [], model.query)} selected={model.draft.value.invite}
      max={MAX_INVITES} busy={busy} onToggle={model.pick} search={model.users.length ? { value: model.query, onChange: model.setQuery } : undefined}
      lineup={{ ids: lastLineup(model.users), onPick: model.pickLast }} /> : <LegacyPeople model={model} />}
    <span className="sf__hint">{model.enhanced ? '被叫的人：绑了 Discord 的会收到私信，能一键报名；其他人打开网页会在「要你处理」里看到。不叫人也行，大家可以自己报名。'
      : '被叫的人会在首页看到邀请，一键回「来 / 不来」。不勾也行，别人自己也能报名。'}</span></fieldset>;
}
function MoreFields({ model }: { model: FormModel }): JSX.Element | null {
  if (!model.enhanced) return null;
  const more = model.draft.value.more ?? EMPTY_MORE;
  return <div className="sf__more"><button type="button" className="btn btn--ghost" aria-expanded={model.moreOpen}
    onClick={() => model.setMoreOpen(!model.moreOpen)}>更多：游戏 / 人数上限 / 时长 / 备注 {model.moreOpen ? '▾' : '▸'}</button>
    {model.moreOpen && <div className="sf__more-fields">
      <label>游戏<input className="sf__input" value={more.game} onChange={(e) => model.setMore('game', e.target.value)} maxLength={SESSION_GAME_MAX} /></label>
      <label>人数上限<input className="sf__input" type="number" min={SESSION_CAPACITY_MIN} max={MAX_SESSION_ROSTER} value={more.capacity} onChange={(e) => model.setMore('capacity', e.target.value)} /></label>
      <label>时长（分钟）<input className="sf__input" type="number" value={more.durationMin} onChange={(e) => model.setMore('durationMin', e.target.value)} /></label>
      <label>备注<textarea className="sf__textarea" value={more.note} maxLength={SESSION_NOTE_MAX} onChange={(e) => model.setMore('note', e.target.value)} /></label>
    </div>}</div>;
}
function FormActions({ guard, model, busy }: { guard: ReturnType<typeof useFormGuard>; model: FormModel; busy: boolean }): JSX.Element {
  const count = model.draft.value.invite.length;
  if (guard.confirmingLeave) return <ConfirmInline question={`这局还没约，已选的 ${count} 个人会留在这台设备上。`} cancelLabel="继续编辑"
    confirmLabel="先离开" onCancel={guard.stay} onConfirm={guard.confirmLeave} tone="primary" focus="cancel" />;
  return <div className="sf__actions"><button ref={guard.triggerRef} type="button" className="btn btn--ghost" onClick={guard.requestClose}>取消</button>
    <button type="submit" className="btn btn--gold" disabled={busy}>{busy ? '创建中…' : count > 0 ? `约！（叫 ${count} 人）` : '约！'}</button></div>;
}
export function SessionFormDialog(props: SessionFormDialogProps): JSX.Element {
  const model = useSessionForm(props);
  const guard = useFormGuard(model.draft.dirty, props.onClose);
  const { error, submitting, submit } = useSessionSubmit(model, props);
  const hint = props.mySessions && props.selfId ? quotaHint(sessionQuota(props.mySessions, props.selfId, Date.now())) : null;
  return <Modal open={props.open} variant={props.variant ?? 'center'} onClose={guard.requestClose} labelledBy="session-form-title" size="md"
    dismissible={!model.draft.dirty} historyKey={props.routed ? undefined : 'session-form'}>
    {props.variant === 'page' && <PageBar backLabel="返回" title="约一局" onBack={guard.requestClose} />}
    <div className={`sf${model.enhanced ? ' sf--enhanced' : ''}${props.variant === 'page' ? ' sf--page' : ''}`}><h2 id="session-form-title" className="sf__title" tabIndex={-1}>约一局</h2>
      <p className="sf__subtitle">选个时间、勾几个人，就完事了。</p>
      <form className="sf__form" onSubmit={(e) => void submit(e)}><TimeField model={model} offset={props.boardTzOffsetHours} />
        <PeopleField model={model} busy={submitting} /><MoreFields model={model} /><DraftNote savedAt={model.draft.savedAt} />
        {hint && <p className="sf__hint">{hint}</p>}{error && <p className="sf__error" role="alert">{error}</p>}
        <FormActions guard={guard} model={model} busy={submitting} />
      </form></div>
  </Modal>;
}
