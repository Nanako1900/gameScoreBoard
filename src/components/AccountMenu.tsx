import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { Avatar } from './Avatar';
import { Link } from './Link';
import './header.css';

interface AccountMenuProps {
  me: User; myPath: string; onOpenOnboarding: () => void; onLogout: () => void;
  onRecord?: () => void; onOpenAdmin?: () => void; dot?: boolean;
}

function useAccountMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus(); }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return { open, setOpen, menuRef, toggleRef };
}

function MenuActions({ props, close }: { props: AccountMenuProps; close: () => void }): JSX.Element {
  const run = (action: () => void): void => { close(); action(); };
  return <>
    <Link className="hdr__dropdown-item" to={props.myPath} onClick={close}>我的</Link>
    <button type="button" className="hdr__dropdown-item" onClick={() => run(props.onOpenOnboarding)}>编辑身份</button>
    <button type="button" className="hdr__dropdown-item" onClick={() => run(props.onOpenOnboarding)}>通知与 Discord</button>
    {(props.me.is_judge || props.me.is_admin) && props.onRecord && <button type="button" className="hdr__dropdown-item"
      onClick={() => run(props.onRecord!)}>记一笔</button>}
    {props.me.is_admin && props.onOpenAdmin && <button type="button" className="hdr__dropdown-item"
      onClick={() => run(props.onOpenAdmin!)}>管理</button>}
    <button type="button" className="hdr__dropdown-item hdr__dropdown-item--danger" onClick={() => run(props.onLogout)}>退出登录</button>
  </>;
}

export function AccountMenu(props: AccountMenuProps): JSX.Element {
  const menu = useAccountMenu();
  const { me } = props;
  return <div className="hdr__menu" ref={menu.menuRef}>
    <button ref={menu.toggleRef} type="button" className="hdr__avatar-btn" aria-expanded={menu.open}
      aria-controls={menu.open ? 'hdr-account-menu' : undefined} aria-label={`${me.username}${props.dot ? '，有待办' : ''}`}
      onClick={() => menu.setOpen((open) => !open)}>
      <Avatar name={me.username} src={me.avatar_url} size={36} /><span className="hdr__username">{me.username}</span>
      {props.dot && <span className="hdr__attention" aria-hidden="true" />}<span className="hdr__caret" aria-hidden="true">▾</span>
    </button>
    {menu.open && <div className="hdr__dropdown panel" id="hdr-account-menu" role="group" aria-label="账户菜单">
      <div className="hdr__dropdown-head"><span className="hdr__dropdown-name">{me.username}</span>
        <span className="hdr__dropdown-roles">{me.is_participant ? '上榜选手' : null}{me.is_participant && me.is_judge ? ' · ' : null}
          {me.is_judge ? '裁判' : null}{!me.is_participant && !me.is_judge ? '游客身份' : null}</span></div>
      <MenuActions props={props} close={() => menu.setOpen(false)} />
    </div>}
  </div>;
}
