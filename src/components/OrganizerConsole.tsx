import { useState } from 'react';
import { SESSION_CANCEL_REASON_MAX } from '@shared/attendance';
import type { InviteResponse, RecordItem, SessionDetail, SessionItem } from '../types';
import { inviteToast } from '../lib/invitePicker';
import { consoleState, gapLine, quotaHint, sessionQuota } from '../lib/sessionConsole';
import { settledSummary } from '../lib/sessionSummary';
import { rollcallPath, sessionNewPath } from '../lib/routes';
import { clockOn, formatWhen, parseTimestamp } from '../lib/time';
import { sessionEndsAt } from '../lib/lobbySessions';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useInvitable } from '../lib/useInvitable';
import { ConfirmInline } from './ConfirmInline';
import { InviteSheet } from './InviteSheet';
import { Link } from './Link';
import { RescheduleSheet } from './RescheduleSheet';
import { useCopySessionLink } from './ShareActions';
import { useToast } from './Toast';
import { IconLive } from './icons';
import './organizer-console.css';

interface OrganizerConsoleProps {
  session: SessionDetail; records: RecordItem[]; now: number; busy: boolean; boardTzOffsetHours?: number;
  mySessions?: readonly SessionItem[] | null; meId: string; onSessionChanged: (session: SessionDetail) => void;
  onCancel: (reason?: string) => Promise<boolean>; onChanged: () => void;
}
function CancelSessionControl({ session, busy, onConfirm }: {
  session: SessionDetail; busy: boolean; onConfirm: (reason?: string) => Promise<boolean>;
}): JSX.Element {
  const { confirming, ask, dismiss, close, triggerRef } = useInlineConfirm();
  const [reason, setReason] = useState('');
  const confirm = async (): Promise<void> => { if (await onConfirm(reason.trim() || undefined)) close(); };
  if (!confirming) return <button ref={triggerRef} type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={ask}>取消这局</button>;
  return <div className="oc__cancel-confirm"><ConfirmInline question="取消这局？" confirmLabel="确认取消" cancelLabel="不取消了"
    tone="danger" focus="cancel" busy={busy} busyLabel="取消中…" onCancel={dismiss} onConfirm={() => void confirm()}>
    <p>会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。</p>
    {session.cancel_reason !== undefined && <label className="oc__reason">理由（选填，会写进私信，也会显示在这局的页面上）
      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={SESSION_CANCEL_REASON_MAX} disabled={busy} /></label>}
  </ConfirmInline></div>;
}
function useConsoleSheets(props: OrganizerConsoleProps, before: boolean) {
  const invitable = useInvitable(before);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const toast = useToast();
  const copy = useCopySessionLink(props.session);
  const changed = (session: SessionDetail): void => { props.onSessionChanged(session); props.onChanged(); };
  const invited = (result: InviteResponse): void => {
    setInviteOpen(false); changed(result.session);
    toast.show({ message: inviteToast(result.added), tone: 'ok', action: { label: '复制邀请链接', onAction: () => void copy() } });
  };
  const rescheduled = (session: SessionDetail): void => {
    setRescheduleOpen(false); changed(session);
    toast.show({ message: `已改到 ${formatWhen(session.starts_at)}。`, tone: 'ok' });
  };
  return { invitable, inviteOpen, setInviteOpen, rescheduleOpen, setRescheduleOpen, invited, rescheduled };
}
function BeforeConsole({ props, sheets }: { props: OrganizerConsoleProps; sheets: ReturnType<typeof useConsoleSheets> }): JSX.Element {
  const line = gapLine(props.session);
  const quota = props.mySessions ? quotaHint(sessionQuota(props.mySessions, props.meId, props.now)) : null;
  const showInvite = ['ready', 'error'].includes(sheets.invitable.state.kind);
  return <>{line && <p className="oc__gap">{line}</p>}<div className="oc__controls">
    {showInvite && <button type="button" className="btn btn--ghost btn--sm" disabled={props.busy}
      onClick={() => sheets.setInviteOpen(true)}><span aria-hidden="true">＋ </span>再叫几个人</button>}
    <button type="button" className="btn btn--ghost btn--sm" disabled={props.busy} onClick={() => sheets.setRescheduleOpen(true)}>改时间</button>
  </div>{quota && <p className="oc__quota">{quota}</p>}
    <p className="oc__hint">约局开始后可以点名，点名不等于扣分。</p>
    <CancelSessionControl session={props.session} busy={props.busy} onConfirm={props.onCancel} /></>;
}
function ActiveConsole({ props, state }: { props: OrganizerConsoleProps; state: 'live' | 'due' | 'settled' }): JSX.Element {
  if (state === 'settled') return <><p>{settledSummary(props.session.players, props.records)}</p>
    <Link to={sessionNewPath(props.session.id)} className="btn btn--gold">再约一次</Link><p className="oc__hint">同一批人，默认下周同一时间</p></>;
  if (state === 'due') return <><p>局结束了，点个名？</p><p>点名只记出勤；扣不扣分，下一步你说了算。</p>
    <Link to={rollcallPath(props.session.id)} className="btn btn--gold">去点名</Link></>;
  return <><p className="oc__live"><IconLive />进行中 · {clockOn(parseTimestamp(props.session.starts_at), props.boardTzOffsetHours)} 开的，预计 {clockOn(sessionEndsAt(props.session), props.boardTzOffsetHours)} 结束</p>
    <Link to={rollcallPath(props.session.id)} className="btn btn--ghost">现在点名</Link>
    <p className="oc__hint">绑了 Discord 的话，结束后 Bot 也会私信提醒你。</p></>;
}
export function OrganizerConsole(props: OrganizerConsoleProps): JSX.Element | null {
  const state = consoleState(props.session, props.now);
  const sheets = useConsoleSheets(props, state === 'before');
  if (state === 'cancelled') return null;
  return <><section className="oc" aria-labelledby="oc-title"><h2 id="oc-title">组织者</h2>
    {state === 'before' ? <BeforeConsole props={props} sheets={sheets} /> : <ActiveConsole props={props} state={state} />}
  </section>
    {sheets.inviteOpen && <InviteSheet session={props.session} invitable={sheets.invitable} onClose={() => sheets.setInviteOpen(false)} onInvited={sheets.invited} />}
    {sheets.rescheduleOpen && <RescheduleSheet session={props.session} boardTzOffsetHours={props.boardTzOffsetHours}
      onClose={() => sheets.setRescheduleOpen(false)} onRescheduled={sheets.rescheduled} />}
  </>;
}
