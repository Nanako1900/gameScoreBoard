import { useState } from 'react';
import { avatarSrc } from '../api';
import './avatar.css';

interface AvatarProps {
  name: string;
  src: string | null;
  size?: number;
  ring?: boolean;
  ringColor?: string;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return '?';
  }
  // Use the first whole Unicode character; uppercase Latin initials.
  const first = Array.from(trimmed)[0];
  return first.toUpperCase();
}

/** Circular avatar with graceful fallback to an initial monogram. External
 *  avatar URLs are routed through the same-origin proxy (see avatarSrc). */
export function Avatar({
  name,
  src,
  size = 40,
  ring = false,
  ringColor,
}: AvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  const className = `avatar${ring ? ' avatar--ring' : ''}`;
  const resolved = failed ? null : avatarSrc(src);

  return (
    <span className={className} aria-hidden="true">
      {resolved ? <img
        className="avatar__image"
        src={resolved}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        onError={() => setFailed(true)}
      /> : <svg className="avatar__fallback" width={size} height={size} viewBox={`0 0 ${size} ${size}`} focusable="false">
        <text x={size / 2} y={size / 2} fontSize={Math.round(size * 0.42)} textAnchor="middle" dominantBaseline="central">{initials(name)}</text>
      </svg>}
      {ring && <svg className="avatar__ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} focusable="false">
        <circle cx={size / 2} cy={size / 2} r={Math.max(0, size / 2 - 1)} fill="none" stroke={ringColor ?? 'var(--border-strong)'} strokeWidth={2} />
      </svg>}
    </span>
  );
}
