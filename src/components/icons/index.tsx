import type { ReactNode } from 'react';
import './icons.css';

interface IconProps { className?: string }
function Icon({ className, children }: IconProps & { children: ReactNode }): JSX.Element {
  return <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" width="1em" height="1em"
    fill="none" stroke="currentColor" aria-hidden="true" focusable="false">{children}</svg>;
}

export function IconAwaiting(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 8v4l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0" /></Icon>;
}

export function IconDiscord(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M8 6c3-1 5-1 8 0l3 12-4 2-1-2h-4l-1 2-4-2Z M9 11v2 M15 11v2" /></Icon>;
}

export function IconWarning(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m12 3 10 18H2Z M12 9v5 M12 17v1" /></Icon>;
}
