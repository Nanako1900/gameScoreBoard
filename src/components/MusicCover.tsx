interface MusicCoverProps {
  url: string | null;
  size: 'large' | 'small';
}

/** Cover art, or a quiet block when there is none. Decorative: the title is always beside it. */
export function MusicCover({ url, size }: MusicCoverProps): JSX.Element {
  const className = `music-cover music-cover--${size}`;
  if (!url) return <div className={`${className} music-cover--empty`} aria-hidden="true" />;
  return <img className={className} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />;
}
