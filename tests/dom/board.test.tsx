import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import type { CaseStatus, PublicUser, RecordItem, ViolationType } from '../../src/types';

// P0-4 (spec §9): the board without shaming — tied ranks, no medals, scores on
// every width, 段位 only on the viewer's own row, 本周之星 instead of 红黑榜,
// a shorter feed, a compact report with no awards, and a welcome card.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function player(id: string, username: string, score: number): PublicUser {
  return { id, username, avatar_url: null, is_participant: true, is_judge: false, score, created_at: 'x' };
}

function rec(
  id: number,
  subjectId: string,
  type: ViolationType,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId === 'a' ? '阿杰' : subjectId === 'b' ? '小红' : '老王', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

const onTime = (id: number, who: string): RecordItem => rec(id, who, 'on_time_bonus', 2);
const OLD = rec(1, 'c', 'organizer_bonus', 2, 'decided', LAST_WEEK);
/** 阿杰 ×3, 小红 ×2 this week, and the feed reaches back into last week. */
const STAR_FEED = [onTime(6, 'a'), onTime(5, 'b'), onTime(4, 'a'), onTime(3, 'b'), onTime(2, 'a'), OLD];

const TIED = [player('a', '阿杰', 100), player('b', '小红', 100), player('c', '老王', 96)];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Leaderboard', () => {
  const renderBoard = (meId: string | null = null) =>
    render(<Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} meId={meId} />);

  it('gives tied scores the same rank', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: '第 1 名 阿杰，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 1 名 小红，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 3 名 老王，96 分' })).toBeInTheDocument();
  });

  it('hands out no medals', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/🥇|🥈|🥉/);
    expect(container.querySelector('[class*="lb-row--rank"]')).toBeNull();
  });

  it('shows every score as a number outside the gauge, and every gauge is neutral', () => {
    const { container } = renderBoard();
    const scores = [...container.querySelectorAll('.lb-row__score')].map((el) => el.textContent);
    expect(scores).toEqual(['100', '100', '96']);
    for (const gauge of screen.getAllByRole('img', { hidden: true })) {
      expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    }
  });

  it('shows a 段位 only on the viewer’s own row', () => {
    const { container } = renderBoard('c');
    expect(container.querySelectorAll('.tier-badge')).toHaveLength(1);
    const mine = screen.getByRole('button', { name: '第 3 名 老王，96 分' });
    expect(mine).toHaveClass('lb-row--me');
    expect(within(mine).getByText('誓约之光')).toBeInTheDocument();
  });

  it('shows no 段位 at all to a visitor', () => {
    const { container } = renderBoard(null);
    expect(container.querySelector('.tier-badge')).toBeNull();
    expect(container.querySelector('.lb-row--me')).toBeNull();
  });

  it('renders the highlights slot between the head and the list', () => {
    const { container } = render(
      <Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} highlights={<p className="wh">x</p>} />,
    );
    expect(container.querySelector('.lb__head + .wh + .lb__list')).not.toBeNull();
  });
});

describe('WeekHighlights', () => {
  it('names this week’s stars, most bonuses first, and links to them', async () => {
    const onSelectUser = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} onSelectUser={onSelectUser} />,
    );
    expect(container.textContent).toBe('⭐ 本周之星：阿杰（准时 3 次）、小红（准时 2 次）');
    await user.click(screen.getByRole('button', { name: '小红' }));
    expect(onSelectUser).toHaveBeenCalledWith('b');
  });

  it('renders nothing when the feed does not cover the whole week', () => {
    const { container } = render(<WeekHighlights records={STAR_FEED.slice(0, -1)} nextResetAt={NEXT_RESET} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('celebrates a clean week and nudges when nobody made it', () => {
    const { rerender } = render(<WeekHighlights records={[onTime(2, 'a'), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周全员守约 🎉')).toBeInTheDocument();
    rerender(<WeekHighlights records={[rec(2, 'a', 'no_show', -12), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周还没人摘星，今晚去约一局？')).toBeInTheDocument();
  });

  it('is never a heading', () => {
    render(<WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} />);
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('a low score can still be the star, and the board names no 鸽王', () => {
    const low = [player('a', '阿杰', 100), player('b', '小红', 30)];
    const { container } = render(
      <Leaderboard
        participants={low}
        trends={{}}
        counts={{}}
        onSelect={() => {}}
        highlights={<WeekHighlights records={[onTime(3, 'b'), onTime(2, 'b'), OLD]} nextResetAt={NEXT_RESET} />}
      />,
    );
    expect(container.querySelector('.wh')?.textContent).toBe('⭐ 本周之星：小红（准时 2 次）');
    expect(container.textContent).not.toContain('鸽王');
  });
});
