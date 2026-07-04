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
  // For CJK names take the last character; for latin take first letter.
  const first = Array.from(trimmed)[0];
  return first.toUpperCase();
}

/** Circular avatar with graceful fallback to an initial monogram. */
export function Avatar({
  name,
  src,
  size = 40,
  ring = false,
  ringColor,
}: AvatarProps): JSX.Element {
  const style: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.42),
    ...(ringColor ? { ['--ring' as string]: ringColor } : {}),
  };
  const className = `avatar${ring ? ' avatar--ring' : ''}`;

  if (src) {
    return (
      <img
        className={className}
        style={style}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
      />
    );
  }

  return (
    <span className={`${className} avatar--fallback`} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
