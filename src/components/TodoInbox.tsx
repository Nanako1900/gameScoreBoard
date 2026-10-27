import { useEffect, useRef } from 'react';
import { todoBadgeCount, type TodoItem } from '../lib/todo';
import { TodoCard, type TodoCardProps } from './TodoCard';
import { Skeleton } from './Skeleton';
import './todo-inbox.css';
interface TodoInboxProps extends Omit<TodoCardProps, 'item'> { items: readonly TodoItem[] | null }
export function TodoInbox({ items, ...props }: TodoInboxProps): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<readonly string[]>([]);
  const visible = items ?? [];
  const keys = visible.map((item) => item.key);
  useEffect(() => {
    if (items === null) return;
    // The lobby stays mounted under a page or modal; its refresh must not
    // move focus away from the view the person is using.
    if (!heading.current?.closest('[hidden], [inert]') && previous.current.some((key) => !keys.includes(key))) heading.current?.focus();
    previous.current = keys;
  });
  const count = todoBadgeCount(visible);
  return <section className="todo panel" aria-labelledby="todo-title"><h2 id="todo-title" ref={heading} tabIndex={-1}>要你处理{count > 0 && ` · ${count}`}</h2>
    {items === null ? <Skeleton label="要你处理加载中" lines={2} /> : visible.length
      ? <ul className="todo__list">{visible.map((item) => <TodoCard key={item.key} {...props} item={item} />)}</ul>
      : <p className="todo__empty">没有待办，清清爽爽 ✨</p>}
  </section>;
}
