import type { ReactNode } from 'react';
import { AUTH_LOGIN_URL } from '../api';
import { saveLoginReturn } from '../lib/loginReturn';

interface LoginLinkProps {
  className?: string;
  /** Default AUTH_LOGIN_URL. */
  href?: string;
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
  returnTo,
  ariaLabel,
  children,
}: LoginLinkProps): JSX.Element {
  const remember = (): void => {
    saveLoginReturn(returnTo);
  };
  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={remember}>
      {children}
    </a>
  );
}
