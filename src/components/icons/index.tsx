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

export function IconMoved(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M4 7h14l-4-4 M20 17H6l4 4 M18 7l-4 4 M6 17l4-4" /></Icon>;
}

export function IconLive(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m8 5 11 7-11 7Z" /></Icon>;
}

export function IconRollcall(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M9 5h11v16H4V5h2 M9 3h6v4H9Z M8 12l2 2 5-5" /></Icon>;
}

export function IconFull(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M3 21v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3 M19 10v6 M16 13h6 M12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></Icon>;
}

export function IconShare(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 16V3m-4 4 4-4 4 4 M6 11H4v10h16V11h-2" /></Icon>;
}

export function IconCalendar(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16" /></Icon>;
}

export function IconDiscord(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M8 6c3-1 5-1 8 0l3 12-4 2-1-2h-4l-1 2-4-2Z M9 11v2 M15 11v2" /></Icon>;
}

export function IconWarning(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m12 3 10 18H2Z M12 9v5 M12 17v1" /></Icon>;
}

export function IconHeal(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 20S2 14 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 6-10 12-10 12 M9 11h6 M12 8v6" /></Icon>;
}

export function IconReview(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M4 3h12v18H4Z M8 7h4 M8 11h4 M15 14l3 3 4-6" /></Icon>;
}

export function IconPlus(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M12 4v16 M4 12h16" /></Icon>;
}

export function IconClose(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m5 5 14 14 M19 5 5 19" /></Icon>;
}

export function IconWithdraw(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="M9 6 3 12l6 6 M3 12h12a6 6 0 0 1 6 6" /></Icon>;
}

export function IconCheck(props: IconProps): JSX.Element {
  return <Icon {...props}><path d="m4 12 5 5L20 6" /></Icon>;
}
