import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';
import { isAppPath } from '../lib/routes';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** An in-app path, optionally with a search; never a hash. */
  to: string;
  replace?: boolean;
  keepScroll?: boolean;
}

const MAIN_BUTTON = 0;

const pathnameOf = (to: string): string => to.split(/[?#]/, 1)[0];

/** New tab, download, a caller that handled it, or a path the SPA does not own: the browser's job. */
function leftToBrowser(event: MouseEvent<HTMLAnchorElement>, to: string, target: string | undefined): boolean {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const elsewhere = target !== undefined && target !== '' && target !== '_self';
  return event.defaultPrevented || event.button !== MAIN_BUTTON || modified || elsewhere || !isAppPath(pathnameOf(to));
}

/** A real <a href>: middle-click, ⌘-click and "copy link" keep working; a plain click navigates in place. */
export function Link({ to, replace, keepScroll, onClick, target, children, ...rest }: LinkProps): JSX.Element {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (leftToBrowser(event, to, target)) return;
    event.preventDefault();
    navigate(to, { replace, keepScroll });
  };
  return (
    <a {...rest} href={to} target={target} onClick={handleClick}>
      {children}
    </a>
  );
}
