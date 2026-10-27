import { useEffect, useRef, useState } from 'react';
import type { SessionDetail, SessionItem } from '../types';
import { onSession } from '../lib/sessionEvents';
import { todoBadgeCount, type TodoItem } from '../lib/todo';
import { TodoCard, type TodoCardProps } from './TodoCard';
import { Skeleton } from './Skeleton';
import './todo-inbox.css';
interface TodoInboxProps extends Omit<TodoCardProps, 'item'> { items: readonly TodoItem[] | null; error: string | null }
interface SessionUpdate { session: SessionDetail; source?: SessionItem }
function liveItems(items: readonly TodoItem[] | null, updates: Readonly<Record<number, SessionUpdate>>): TodoItem[] {
  return (items ?? []).filter((item) => {
    if (!('session' in item) || !['invite', 'moved', 'soon'].includes(item.kind)) return true;
    const update = updates[item.session.id];
    if (!update || update.source !== item.session) return true;
    return update.session.status === 'open' && update.session.my_rsvp === (item.kind === 'soon' ? 'going' : 'invited');
  });
}
export function TodoInbox({ items, error, ...props }: TodoInboxProps): JSX.Element {
  const [updates, setUpdates] = useState<Readonly<Record<number, SessionUpdate>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<readonly string[]>([]);
  const latestItems = useRef(items); if (items !== null) latestItems.current = items;
  useEffect(() => onSession((s) => {
    const item = latestItems.current?.find((i) => 'session' in i && i.session.id === s.id);
    const source = item && 'session' in item ? item.session : undefined;
    setUpdates((old) => ({ ...old, [s.id]: { session: s, source } }));
  }), []);
  const visible = liveItems(items, updates);
  const keys = visible.map((item) => item.key);
  useEffect(() => {
    if (items === null) return;
    if (previous.current.some((key) => !keys.includes(key))) heading.current?.focus();
    previous.current = keys;
  });
  const count = todoBadgeCount(visible);
  return <section className="todo panel" aria-labelledby="todo-title"><h2 id="todo-title" ref={heading} tabIndex={-1}>要你处理{visible.length > 0 && ` · ${count}`}</h2>
    {error && <p className="todo__error" role="alert">{error}</p>}
    {items === null ? <Skeleton label="要你处理加载中" lines={2} /> : visible.length
      ? <ul className="todo__list">{visible.map((item) => <TodoCard key={item.key} {...props} item={item} />)}</ul>
      : <p className="todo__empty">没有待办，清清爽爽 ✨</p>}
  </section>;
}
