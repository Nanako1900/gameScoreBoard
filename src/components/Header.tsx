import { useEffect, useRef, useState } from 'react';
import type { Config, User } from '../types';
import { AUTH_LOGIN_URL } from '../api';
import { formatCountdown } from '../lib/time';
import { Avatar } from './Avatar';
import './header.css';

interface HeaderProps {
  config: Config | null;
  me: User | null;
  onLogout: () => void;
  onOpenOnboarding: () => void;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function Header({
  config,
  me,
  onLogout,
  onOpenOnboarding,
}: HeaderProps): JSX.Element {
  const now = useNow(1000);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDoc = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const countdown = config ? formatCountdown(config.nextResetAt, now) : '—';

  return (
    <header className="hdr">
      <div className="hdr__inner">
        <a className="hdr__brand" href="/" aria-label="EDG 信誉分 首页">
          <span className="hdr__logo" aria-hidden="true">
            <span className="hdr__logo-mark">EDG</span>
          </span>
          <span className="hdr__wordmark">
            <span className="hdr__title">信誉分</span>
            <span className="hdr__subtitle">开黑守约计分板</span>
          </span>
        </a>

        <div className="hdr__reset" aria-label="距离每周恢复">
          <span className="hdr__reset-label eyebrow">每周恢复</span>
          <span className="hdr__reset-time tabular">{countdown}</span>
        </div>

        <div className="hdr__actions">
          {me ? (
            <div className="hdr__menu" ref={menuRef}>
              <button
                ref={toggleRef}
                type="button"
                className="hdr__avatar-btn"
                aria-expanded={menuOpen}
                aria-controls={menuOpen ? 'hdr-account-menu' : undefined}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Avatar name={me.username} src={me.avatar_url} size={36} />
                <span className="hdr__username">{me.username}</span>
                <span className="hdr__caret" aria-hidden="true">
                  ▾
                </span>
              </button>
              {menuOpen && (
                <div
                  className="hdr__dropdown panel"
                  id="hdr-account-menu"
                  role="group"
                  aria-label="账户菜单"
                >
                  <div className="hdr__dropdown-head">
                    <span className="hdr__dropdown-name">{me.username}</span>
                    <span className="hdr__dropdown-roles">
                      {me.is_participant ? '上榜选手' : null}
                      {me.is_participant && me.is_judge ? ' · ' : null}
                      {me.is_judge ? '裁判' : null}
                      {!me.is_participant && !me.is_judge ? '游客身份' : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="hdr__dropdown-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenOnboarding();
                    }}
                  >
                    编辑我的身份
                  </button>
                  <button
                    type="button"
                    className="hdr__dropdown-item hdr__dropdown-item--danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onLogout();
                    }}
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <a className="btn btn--gold" href={AUTH_LOGIN_URL}>
              登录
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
