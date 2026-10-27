import type { ReactNode } from 'react';
import { AUTH_LOGIN_URL } from '../api';
import { saveLoginReturn } from '../lib/loginReturn';
import type { LoginIntent } from '../lib/loginReturnShape';

interface LoginLinkProps {
  className?: string;
  /** Default AUTH_LOGIN_URL. */
  href?: string;
  /** What the visitor clicked — shown back to them after login, never sent. */
  intent?: LoginIntent;
  /** Where to come back to; default the current page (router's currentPath()). */
  returnTo?: string;
  /** Accessible name when the visible text alone is ambiguous (one per list row). */
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Every way into the login page. Still a plain top-level <a> (analysis §6):
 * the click only writes edg.return first, it never prevents the navigation.
 */
export function LoginLink({
  className,
  href = AUTH_LOGIN_URL,
  intent,
  returnTo,
  ariaLabel,
  children,
}: LoginLinkProps): JSX.Element {
  const remember = (): void => {
    saveLoginReturn(intent, returnTo);
  };
  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={remember}>
      {children}
    </a>
  );
}
