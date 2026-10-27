import { RSVP_LABEL, type SelfRsvp } from '@shared/attendance';
import type { RecordItem, SessionItem } from '../types';
import type { TodoItem } from '../lib/todo';
import { formatRemaining, formatTimeLeft, formatWhen, clockOn, parseTimestamp, relativeTime } from '../lib/time';
import { fullNotice, goingClosed } from '../lib/sessionActions';
import { violationLabel } from '../lib/recordView';
import { playerCasePath, rollcallPath } from '../lib/routes';
import { sessionEndsAt } from '../lib/lobbySessions';
import { readDraft } from '../lib/drafts';
import { validateStatementDraft } from '../lib/draftShapes';
import { RsvpControl } from './RsvpControl';
import { Link } from './Link';
import { IconAwaiting, IconDiscord, IconLive, IconMoved, IconRollcall, IconWarning } from './icons';
export interface TodoCardProps {
  item: TodoItem; now: number; boardTzOffsetHours?: number; busyId: number | null;
  onAnswer: (session: SessionItem, rsvp: SelfRsvp) => void; onOpenSession: (id: number) => void;
  onOpenStatement: (record: RecordItem) => void; onOpenNotify: () => void;
  onSeenCancelled: (id: number) => void; onDismissUnbound: () => void;
}
function StatementCard({ item, ...props }: TodoCardProps & { item: Extract<TodoItem, { kind: 'statement' }> }): JSX.Element {
  const r = item.record;
  const draft = readDraft('statement', r.id, validateStatementDraft);
  return <><p className="tcard__title"><IconAwaiting />{r.reporter.username}记了你一笔 · {violationLabel(r.type)}</p>
    {r.deadline_at && <p>{formatWhen(r.deadline_at, props.now, props.boardTzOffsetHours)} 截止（{formatRemaining(r.deadline_at, props.now)}）</p>}
    <p>先说说发生了什么，AI 裁决会参考你的说明。</p>{draft?.value && <p className="tcard__hint">草稿已存 · 写了 {draft.value.length} 字</p>}
    <button type="button" className="btn btn--gold" onClick={() => props.onOpenStatement(r)}>写说明 ›</button></>;
}
function InvitationCard({ item, ...props }: TodoCardProps & { item: Extract<TodoItem, { session: unknown }> }): JSX.Element {
  const s = item.session; const moved = item.kind === 'moved';
  const full = fullNotice(s); const fullId = `todo-full-${s.id}`;
  return <><p id={`todo-${s.id}`} className="tcard__title">{moved ? <IconMoved /> : <IconLive />}{moved ? `改时间了 · ${s.organizer.username}的局` : `${s.organizer.username}约你 · ${s.game || s.title}`}</p>
    {moved ? <><p><span className="visually-hidden">原定</span><del>{formatWhen(s.prev_starts_at ?? '', props.now, props.boardTzOffsetHours)}</del> → {formatWhen(s.starts_at, props.now, props.boardTzOffsetHours)}</p>
      <p>你之前说「{RSVP_LABEL[s.prev_rsvp ?? 'invited']}」，新时间还来吗？</p></>
      : <p>{formatWhen(s.starts_at, props.now, props.boardTzOffsetHours)} · {formatTimeLeft(s.starts_at, props.now)} · 来 {s.counts.going}</p>}
    <RsvpControl label={`报名 ${s.title}`} contextId={`todo-${s.id}`} value={s.my_rsvp} busy={props.busyId === s.id} goingClosed={goingClosed(s)} goingClosedNoteId={fullId}
      onAnswer={(rsvp) => props.onAnswer(s, rsvp)} />
    {full && <p id={fullId} className="tcard__hint">{full}</p>}
    <button type="button" className="btn btn--ghost" onClick={() => props.onOpenSession(s.id)}>看详情 ›</button>
    <p className="tcard__hint">开局前说不来，点名结算不会记你。</p></>;
}
function SessionTodo({ item, ...props }: TodoCardProps & { item: Extract<TodoItem, { session: unknown }> }): JSX.Element {
  const s = item.session; const when = formatWhen(s.starts_at, props.now, props.boardTzOffsetHours);
  if (item.kind === 'soon') return <><p className="tcard__title"><IconLive />你答应了：{when} · {formatTimeLeft(s.starts_at, props.now)}</p>
    <p>来不了？现在说一声</p><button type="button" className="btn btn--ghost" disabled={props.busyId === s.id} onClick={() => props.onAnswer(s, 'out')}>改成不来</button></>;
  if (item.kind === 'cancelled') return <><p className="tcard__title">通知 · {s.organizer.username}取消了{when}的局</p>
    {s.cancel_reason && <p>理由：{s.cancel_reason}</p>}<button type="button" className="btn btn--ghost" onClick={() => props.onSeenCancelled(s.id)}>知道了</button></>;
  return <><p className="tcard__title"><IconRollcall />该点名了 · {s.title}</p><p>{clockOn(parseTimestamp(s.starts_at), props.boardTzOffsetHours)} 开局 · {relativeTime(new Date(sessionEndsAt(s)).toISOString(), props.now)}结束 · 来 {s.counts.going}</p>
    <p>点名只记出勤；扣不扣分，下一步你说了算。</p><Link className="btn btn--gold" to={rollcallPath(s.id)}>去点名 ›</Link></>;
}
function AccountTodo({ item, ...props }: TodoCardProps): JSX.Element {
  if (item.kind === 'appeals') return <><p className="tcard__title"><IconAwaiting />{item.count} 个申诉待复核</p>
    {item.earliest && <Link className="btn btn--gold" to={playerCasePath(item.earliest.subject.id, item.earliest.id)}>去审理 ›</Link>}</>;
  if (item.kind === 'escalation') return <><p className="tcard__title"><IconAwaiting />待你确认 · AI 建议升级</p>
    <p>{item.record.subject.username} · {violationLabel(item.record.type)} → 是团灭级吗？</p><p>需要在判决前确认。</p>
    <Link className="btn btn--gold" to={playerCasePath(item.record.subject.id, item.record.id)}>去看看 ›</Link></>;
  if (item.kind === 'dm-broken') return <><p className="tcard__title"><IconWarning />Bot 上次给你的私信没发出去</p>
    <p>确认你还在服务器里，并打开「允许服务器成员私信」。</p><button type="button" className="btn btn--gold" onClick={props.onOpenNotify}>去设置 ›</button></>;
  return <><p className="tcard__title"><IconDiscord />还没绑定 Discord</p><p>绑定后：被约、改时间、该写说明都会私信你，在私信里能一键报名。</p>
    <button type="button" className="btn btn--gold" onClick={props.onOpenNotify}>去绑定 ›</button>
    <button type="button" className="btn btn--ghost" onClick={props.onDismissUnbound}>不再提示</button></>;
}
export function TodoCard(props: TodoCardProps): JSX.Element {
  const item = props.item;
  const attention = item.kind === 'dm-broken' || item.kind === 'moved' || (item.kind === 'statement' && item.urgent);
  return <li className={`tcard tcard--${item.kind}${attention ? ' tcard--attention' : ''}`}>
    {item.kind === 'statement' ? <StatementCard {...props} item={item} /> : item.kind === 'invite' || item.kind === 'moved'
      ? <InvitationCard {...props} item={item} /> : item.kind === 'soon' || item.kind === 'rollcall' || item.kind === 'cancelled'
        ? <SessionTodo {...props} item={item} /> : <AccountTodo {...props} item={item} />}
  </li>;
}
