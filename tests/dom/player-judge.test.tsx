import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { AdminScoreForm } from '../../src/components/AdminScoreForm';
import { setScore } from '../../src/api';
import type { RecordItem, User } from '../../src/types';

const ME: User = {
  id: 'admin',
  username: '管理员',
  oauth_username: '管理员',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: true,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GET /api/users/p answers with the player's current judge flag; POSTs are recorded. */
function stubBackend(initiallyJudge: boolean) {
  let isJudge = initiallyJudge;
  const posts: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { is_judge?: boolean };
        posts.push({ path, body });
        if (typeof body.is_judge === 'boolean') isJudge = body.is_judge;
        return { ok: true, status: 200, text: async () => '{"ok":true}' };
      }
      const user = { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: isJudge, score: 90, created_at: 'x' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ user, records: [], history: [] }) };
    }),
  );
  return posts;
}

describe('PlayerDetail — unified management entries', () => {
  it('sends an admin to member settings and score tools instead of inline forms', async () => {
    const posts = stubBackend(false);
    render(<PlayerDetail userId="p" me={ME} onClose={() => {}} />);
    expect(await screen.findByRole('link', { name: '管理成员身份' })).toHaveAttribute('href', '/settings/members');
    expect(screen.getByRole('link', { name: '调整分数' })).toHaveAttribute('href', '/tools/score?user=p');
    expect(screen.queryByRole('button', { name: '设为裁判' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消裁判资格' })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: '调整分数' })).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('shows no management entry to anyone else', async () => {
    stubBackend(false);
    render(<PlayerDetail userId="p" me={{ ...ME, is_admin: false }} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('link', { name: '管理成员身份' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '调整分数' })).not.toBeInTheDocument();
  });
});

describe('PlayerDetail — the escalation buttons', () => {
  const REPORTER: User = { ...ME, id: 'j', username: '裁判', is_admin: false, is_judge: true };
  const record: RecordItem = {
    id: 7,
    subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'no_show',
    delta: 0,
    note: null,
    claim: '说好八点五排结果没来',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: true,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: '2026-10-27 12:00:00',
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -20, max: -10, base: -15 },
    created_at: '2026-10-26 12:00:00',
    redacted: false,
  };

  function stubCase(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const user = { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 90, created_at: 'x' };
        return { ok: true, status: 200, text: async () => JSON.stringify({ user, records: [record], history: [] }) };
      }),
    );
  }

  it('are for the judge who filed it', async () => {
    stubCase();
    render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: '确认是团灭级' })).toBeInTheDocument();
  });

  it('are gone once the case went to judgment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const user = { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 90, created_at: 'x' };
        const decided = { ...record, status: 'decided', delta: -15, verdict: { source: 'ai', headline: '判了', reasoning: '', factors: [] } };
        return { ok: true, status: 200, text: async () => JSON.stringify({ user, records: [decided], history: [] }) };
      }),
    );
    render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('button', { name: '确认是团灭级' })).not.toBeInTheDocument();
    expect(screen.queryByText(/够得上「团灭级放鸽」/)).not.toBeInTheDocument();
  });

  it('are not for a reporter who is no judge (any more): the server would refuse', async () => {
    stubCase();
    render(<PlayerDetail userId="p" me={{ ...REPORTER, is_judge: false }} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('button', { name: '确认是团灭级' })).not.toBeInTheDocument();
  });
});

describe('AdminScoreForm — setting a score by hand', () => {
  it('lets an admin set it in two steps, and posts only the score', async () => {
    const posts = stubBackend(false);
    const user = userEvent.setup();
    render(<AdminScoreForm username="选手" score={90} busy={false} onSubmit={(score) => void setScore('p', score)} />);
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });
    expect(screen.getByRole('button', { name: '改分' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '75');
    await user.click(screen.getByRole('button', { name: '改分' }));
    expect(screen.getByText(/私信通知本人/)).toBeInTheDocument();
    expect(posts).toEqual([]);
    await user.click(screen.getByRole('button', { name: '确认改分' }));
    await waitFor(() => expect(posts).toEqual([{ path: '/api/admin/users/p', body: { score: 75 } }]));
  });

  it('refuses a score off the scale, and shows no such form to anyone else', async () => {
    stubBackend(false);
    const user = userEvent.setup();
    const { unmount } = render(<AdminScoreForm username="选手" score={90} busy={false} onSubmit={(score) => void setScore('p', score)} />);
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });
    await user.clear(input);
    await user.type(input, '101');
    expect(screen.getByRole('button', { name: '改分' })).toBeDisabled();
    unmount();
    render(<PlayerDetail userId="p" me={{ ...ME, is_admin: false }} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('spinbutton', { name: '调整分数' })).not.toBeInTheDocument();
  });
});

describe('AdminScoreForm — the score form, at its edges', () => {
  for (const [what, typed] of [
    ['an empty box (it would read as 0)', ''],
    ['a score below 0', '-1'],
    ['a fractional score', '75.5'],
  ] as const) {
    it(`refuses ${what}`, async () => {
      stubBackend(false);
      const user = userEvent.setup();
      render(<AdminScoreForm username="选手" score={90} busy={false} onSubmit={(score) => void setScore('p', score)} />);
      const input = await screen.findByRole('spinbutton', { name: '调整分数' });
      await user.clear(input);
      if (typed) await user.type(input, typed);
      expect(screen.getByRole('button', { name: '改分' })).toBeDisabled();
    });
  }

  it('is not for a judge who is not an admin', async () => {
    stubBackend(false);
    render(<PlayerDetail userId="p" me={{ ...ME, is_admin: false, is_judge: true }} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('spinbutton', { name: '调整分数' })).not.toBeInTheDocument();
  });

  it('keeps the keyboard where it was: on 确认改分, back on the number after 取消', async () => {
    stubBackend(false);
    const user = userEvent.setup();
    render(<AdminScoreForm username="选手" score={90} busy={false} onSubmit={(score) => void setScore('p', score)} />);
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });
    await user.clear(input);
    await user.type(input, '75');
    await user.click(screen.getByRole('button', { name: '改分' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '确认改分' }));
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: '调整分数' }));
  });
});

