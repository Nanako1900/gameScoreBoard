import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppealSheet } from '../../src/components/AppealSheet';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import type { Config, RecordItem, User } from '../../src/types';

// 申诉（spec §3.10, H14）: the reason may be left out, is capped at
// APPEAL_MAX = 500 like the bot's, is kept as a draft, and nothing is posted
// until 确认申诉. Never promises "only once" (§11 #6: the limit is P4's).

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function penalty(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 9,
    subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'late_major',
    delta: -6,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: '家里临时有事',
    statement_at: sqlTime(Date.now() - 2 * DAY),
    appeal_reason: null,
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - 2 * DAY),
    redacted: false,
    ...over,
  };
}

/** The value a draft holds in localStorage, or null. */
function storedValue(key: string): unknown {
  const raw = localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as { value: unknown }).value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppealSheet', () => {
  it('appeals with no reason at all, after a confirm', async () => {
    const calls = mockFetch({ 'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(screen.getByText('大迟到 · -6 · AI 裁决')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /为什么觉得判得不对/ })).toHaveAttribute('maxlength', '500');
    expect(screen.getByText('申诉后分数先不动，管理员复核后可能维持，也可能改判。')).toBeInTheDocument();
    expect(screen.queryByText(/只能申诉一次/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    const confirm = screen.getByRole('group', { name: '提交后要等管理员复核，确定吗？' });
    expect(within(confirm).getByRole('button', { name: '再想想' })).toHaveFocus();
    expect(calls).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: '确认申诉' }));
    await waitFor(() => expect(onAppealed).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: 'POST', path: '/api/records/9/appeal', body: {} }]);
  });

  it('sends the reason trimmed, and forgets the draft once it is in', async () => {
    const calls = mockFetch({ 'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '  我提前两小时在群里说了  ');
    await waitFor(() => expect(localStorage.getItem('edg.draft.appeal.9')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));

    await waitFor(() => expect(onAppealed).toHaveBeenCalledTimes(1));
    expect(calls[0]?.body).toEqual({ reason: '我提前两小时在群里说了' });
    expect(localStorage.getItem('edg.draft.appeal.9')).toBeNull();
  });

  it('清空 empties the reason and puts the caret back in it', async () => {
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={() => {}} />);
    const box = screen.getByRole('textbox', { name: /为什么觉得判得不对/ });
    await user.type(box, '判重了');
    await user.click(await screen.findByRole('button', { name: '清空' }));
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(localStorage.getItem('edg.draft.appeal.9')).toBeNull();
  });

  it('keeps a written reason when closed, and asks first', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    // Like PlayerDetail: closing unmounts the sheet, which is what writes a
    // reason still inside the save debounce.
    function Host(): JSX.Element | null {
      const [open, setOpen] = useState(true);
      const close = (): void => {
        onClose();
        setOpen(false);
      };
      return open ? <AppealSheet record={penalty()} onClose={close} onAppealed={() => {}} /> : null;
    }
    render(<Host />);

    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '判重了');
    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '申诉理由会留在这台设备上，下次回来接着写。' });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument();
    expect(storedValue('edg.draft.appeal.9')).toBe('判重了');
  });

  it('backs out of the confirm on Escape instead of closing', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={onClose} onAppealed={() => {}} />);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: '提交后要等管理员复核，确定吗？' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交申诉' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and stays open', async () => {
    mockFetch({ 'POST /api/records/9/appeal': () => json(400, { error: '只有已判决的案件可以申诉' }) });
    const onAppealed = vi.fn();
    const user = userEvent.setup();
    render(<AppealSheet record={penalty()} onClose={() => {}} onAppealed={onAppealed} />);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('只有已判决的案件可以申诉');
    expect(screen.getByRole('button', { name: '提交申诉' })).toHaveFocus();
    expect(onAppealed).not.toHaveBeenCalled();
  });
});

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: new Date(Date.now() + 2 * DAY + 3_600_000).toISOString(),
};

const SUBJECT: User = {
  id: 'p',
  username: '选手',
  oauth_username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 82,
  created_at: '2026-10-01 00:00:00',
};
const REPORTER: User = { ...SUBJECT, id: 'j', username: '裁判', is_judge: true };

function stubPlayer(records: RecordItem[]): Call[] {
  return mockFetch({
    'GET /api/users/p': () =>
      json(200, {
        user: { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 82, created_at: 'x' },
        records,
        history: [],
      }),
    'POST /api/records/9/appeal': () => json(200, { record: penalty({ status: 'appealed' }) }),
  });
}

describe('PlayerDetail — the subject’s own page', () => {
  it('opens the appeal sheet instead of appealing at once', async () => {
    const calls = stubPlayer([penalty()]);
    const user = userEvent.setup();
    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} config={CONFIG} />);

    await user.click(await screen.findByRole('button', { name: '申诉' }));
    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    await user.click(screen.getByRole('button', { name: '提交申诉' }));
    await user.click(screen.getByRole('button', { name: '确认申诉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument());
    // The page reloads the player after the appeal.
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/users/p')).toHaveLength(2));
  });

  it('shows how far Monday’s heal takes you, from config', async () => {
    stubPlayer([penalty()]);
    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} config={CONFIG} />);
    expect(await screen.findByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    // One way to appeal per card: here the note brings no second button.
    expect(screen.queryByRole('button', { name: '觉得不公平？可以申诉' })).not.toBeInTheDocument();
  });

  it('shows none of it to anyone else, or without config', async () => {
    stubPlayer([penalty()]);
    const { unmount } = render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} config={CONFIG} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^这次 /)).not.toBeInTheDocument();
    unmount();

    render(<PlayerDetail userId="p" me={SUBJECT} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
  });
});

describe('PlayerDetail — 撤销 for the reporter', () => {
  it('counts the 15 minutes down from filing, and hides the button after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubPlayer([penalty({ created_at: sqlTime(Date.now() - 2.5 * MINUTE) })]);
      render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
      expect(await screen.findByRole('button', { name: '撤销 · 还剩 12 分钟' })).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(13 * MINUTE);
      });
      expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no button once the window is long gone', async () => {
    stubPlayer([penalty({ created_at: sqlTime(Date.now() - 20 * MINUTE) })]);
    render(<PlayerDetail userId="p" me={REPORTER} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
  });

  it('gives an admin a plain 撤销, with no clock', async () => {
    stubPlayer([penalty()]);
    render(<PlayerDetail userId="p" me={{ ...REPORTER, id: 'admin', is_admin: true }} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: '撤销' })).toBeInTheDocument();
  });
});
