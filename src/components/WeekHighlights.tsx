import { Fragment } from 'react';
import type { RecordItem } from '../types';
import { computeWeekHighlights } from '../lib/weekStars';
import type { WeekStar } from '../lib/weekStars';
import './week-highlights.css';

interface WeekHighlightsProps {
  records: readonly RecordItem[];
  nextResetAt: string;
  onSelectUser?: (id: string) => void;
}

function StarName({ star, onSelectUser }: { star: WeekStar; onSelectUser?: (id: string) => void }): JSX.Element {
  const name = <strong className="wh__name">{star.user.username}</strong>;
  return (
    <>
      {onSelectUser ? (
        <button type="button" className="wh__link" onClick={() => onSelectUser(star.user.id)}>
          {name}
        </button>
      ) : (
        name
      )}
      （准时 {star.onTime} 次）
    </>
  );
}

/**
 * One line in the board's head that replaced the old top/bottom board (spec §5 #1): it only ever
 * praises, with a threshold, and names nobody when the feed cannot vouch for
 * the whole week. Deliberately not a heading.
 */
export function WeekHighlights({
  records,
  nextResetAt,
  onSelectUser,
}: WeekHighlightsProps): JSX.Element | null {
  const result = computeWeekHighlights(records, nextResetAt);
  switch (result.kind) {
    case 'hidden':
      return null;
    case 'all-clean':
      return <p className="wh">本周全员守约 🎉</p>;
    case 'none':
      return <p className="wh wh--quiet">本周还没人摘星。</p>;
    case 'stars':
      return (
        <p className="wh">
          <span aria-hidden="true">⭐</span> 本周之星：
          {result.stars.map((star, i) => (
            <Fragment key={star.user.id}>
              {i > 0 && '、'}
              <StarName star={star} onSelectUser={onSelectUser} />
            </Fragment>
          ))}
        </p>
      );
  }
}
