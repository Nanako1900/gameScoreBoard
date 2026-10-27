import type { RecordItem } from '../types';
import type { TodoItem } from '../lib/todo';
import { formatRemaining, formatWhen } from '../lib/time';
import { violationLabel } from '../lib/recordView';
import { playerCasePath } from '../lib/routes';
import { readDraft } from '../lib/drafts';
import { validateStatementDraft } from '../lib/draftShapes';
import { Link } from './Link';
import { IconAwaiting, IconDiscord } from './icons';
export interface TodoCardProps {
  item: TodoItem; now: number; boardTzOffsetHours?: number;
  onOpenStatement: (record: RecordItem) => void; onOpenNotify: () => void;
  /** Kept for hosts using the previous card signature. */
  onDismissUnbound: () => void;
  onDismissOnboarding?: () => void;
}
function StatementCard({ item, ...props }: TodoCardProps & { item: Extract<TodoItem, { kind: 'statement' }> }): JSX.Element {
  const r = item.record;
  const draft = readDraft('statement', r.id, validateStatementDraft);
  return <><p className="tcard__title"><IconAwaiting />{r.reporter.username}记了你一笔 · {violationLabel(r.type)}</p>
    {r.deadline_at && <p>{formatWhen(r.deadline_at, props.now, props.boardTzOffsetHours)} 截止（{formatRemaining(r.deadline_at, props.now)}）</p>}
    <p>先说说发生了什么，AI 裁决会参考你的说明。</p>{draft?.value && <p className="tcard__hint">草稿已存 · 写了 {draft.value.length} 字</p>}
    <button type="button" className="btn btn--gold" onClick={() => props.onOpenStatement(r)}>写说明 ›</button></>;
}
function AccountTodo({ item, ...props }: TodoCardProps): JSX.Element {
  if (item.kind === 'appeals') return <><p className="tcard__title"><IconAwaiting />{item.count} 个申诉待复核</p>
    {item.earliest && <Link className="btn btn--gold" to={playerCasePath(item.earliest.subject.id, item.earliest.id)}>去审理 ›</Link>}</>;
  if (item.kind === 'escalation') return <><p className="tcard__title"><IconAwaiting />待你确认 · AI 建议升级</p>
    <p>{item.record.subject.username} · {violationLabel(item.record.type)} → 是团灭级吗？</p><p>需要在判决前确认。</p>
    <Link className="btn btn--gold" to={playerCasePath(item.record.subject.id, item.record.id)}>去看看 ›</Link></>;
  if (item.kind !== 'onboarding') return <></>;
  return <><p className="tcard__title"><IconDiscord />还差 {item.missing.length} 步完成入户</p>
    <Link to="/welcome" className="btn btn--gold">继续</Link>
    <button type="button" className="btn btn--ghost" onClick={props.onDismissOnboarding ?? props.onDismissUnbound}>7 天内不再提示</button></>;
}
export function TodoCard(props: TodoCardProps): JSX.Element {
  const item = props.item;
  const attention = item.kind === 'statement' && item.urgent;
  return <li className={`tcard tcard--${item.kind}${attention ? ' tcard--attention' : ''}`}>
    {item.kind === 'statement' ? <StatementCard {...props} item={item} /> : <AccountTodo {...props} item={item} />}
  </li>;
}
