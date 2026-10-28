import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tierFor } from '@shared/scoring';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { CaseActions } from '../../src/components/CaseActions';
import type { PublicUser, RecordItem, User } from '../../src/types';

const PERSON: PublicUser = { id: 'p', username: '选手', avatar_url: null, is_participant: true,
  is_judge: false, score: 88, created_at: '2026-10-01 00:00:00' };
const SELF: User = { ...PERSON, oauth_username: '选手', is_admin: false };
const JUDGE: User = { ...SELF, id: 'judge', username: '裁判', is_judge: true };
const ADMIN: User = { ...JUDGE, is_admin: true };
const NOW = Date.parse('2026-10-28T09:10:00Z');
const RECORD: RecordItem = {
  id: 7, subject: { id: 'p', username: '选手', avatar_url: null },
  reporter: { id: 'judge', username: '裁判', avatar_url: null }, type: 'no_show', delta: -12,
  note: null, claim: null, claim_summary: null, classified_by: 'ai', escalation_suggested: false,
  session_id: null, statement: null, statement_at: null, appeal_reason: null, deadline_at: null,
  status: 'decided', verdict: null, range: { min: -20, max: -10, base: -15 },
  created_at: '2026-10-28 09:00:00', redacted: true,
};
const detail = (user = PERSON, records = [RECORD]) => ({ user, records,
  history: [{ at: '2026-10-27 00:00:00', score: user.score }] });
const json = (data: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(data) }) as Response;
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function backend() {
  const fetch = vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/voice?')
    ? json({ user: PERSON, retention_days: 90, gaps: [], days: [] }) : json(detail()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('PlayerDetail — focused layouts and privacy', () => {
  it('keeps public scores and history neutral without a tier name, description or avatar ring', async () => {
    backend();
    render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByText(tierFor(88).name)).not.toBeInTheDocument();
    expect(screen.queryByText(tierFor(88).blurb)).not.toBeInTheDocument();
    expect(document.querySelector('.pd__header')).not.toHaveAttribute('style');
    expect(document.querySelector('.pd__header .avatar')).not.toHaveClass('avatar--ring');
    expect(document.querySelector('.pd__header .avatar')).not.toHaveAttribute('style');
    expect(document.querySelector('.chart')).not.toHaveAttribute('style');
    expect(document.querySelector('.chart__line')).toHaveAttribute('stroke', 'var(--score-chip-fg)');
    expect(screen.getByRole('img', { name: /^信誉分 88 分/ })).toHaveClass('gauge--neutral');
  });

  it('keeps the own tier and embeds only the caller’s personal voice history', async () => {
    const fetch = backend();
    render(<PlayerDetail userId="p" me={SELF} onClose={() => {}} />);
    expect(await screen.findByText(tierFor(88).blurb)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '选手的语音记录' })).toBeInTheDocument();
    expect(fetch.mock.calls.map(([path]) => String(path)).some((path) => path.startsWith('/api/voice?user=p&'))).toBe(true);
    expect(screen.queryByRole('link', { name: '查看语音记录' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '分数走势' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '案件' })).toBeInTheDocument();
    expect(document.querySelector('.pd__header .avatar')).not.toHaveClass('avatar--ring');
    expect(document.querySelector('.chart')).not.toHaveAttribute('style');
    expect(document.querySelector('.chart__line')).toHaveAttribute('stroke', 'var(--score-chip-fg)');
  });

  it('keeps an unavailable personal voice module local and distinct from empty evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/voice?')
      ? ({ ok: false, status: 404, text: async () => JSON.stringify({ error: 'Not found' }) } as Response) : json(detail())));
    render(<PlayerDetail userId="p" me={SELF} onClose={() => {}} />);
    expect(await screen.findByText('语音记录暂不可用。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '这页不存在' })).not.toBeInTheDocument();
    expect(screen.queryByText('没有保存的语音记录，不代表没来')).not.toBeInTheDocument();
    expect(screen.queryByText('已覆盖')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '查询范围' })).not.toBeInTheDocument();
  });

  it.each([JUDGE, ADMIN])('offers staff a scoped voice tool link without reading another person’s voice inline: %o', async (me) => {
    const fetch = backend();
    render(<PlayerDetail userId="p" me={me} onClose={() => {}} />);
    expect(await screen.findByRole('link', { name: '查看语音记录' })).toHaveAttribute('href', '/tools/voice?user=p');
    expect(fetch.mock.calls.some(([path]) => String(path).startsWith('/api/voice'))).toBe(false);
  });

  it.each([null, { ...SELF, id: 'other' }])('offers no private voice entry to a visitor or another member: %o', async (me) => {
    const fetch = backend();
    render(<PlayerDetail userId="p" me={me} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('link', { name: '查看语音记录' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => String(path).startsWith('/api/voice'))).toBe(false);
  });

  it('shows the case and subject context without the profile score, history or voice', async () => {
    const fetch = backend();
    render(<PlayerDetail userId="p" me={SELF} onClose={() => {}} focusRecordId={7} />);
    expect(await screen.findByRole('heading', { level: 2, name: '案件 #7' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '选手' })).toHaveAttribute('href', '/players/p');
    expect(document.querySelectorAll('#case-7')).toHaveLength(1);
    expect(screen.queryByRole('img', { name: /^信誉分/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '分数走势' })).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([path]) => String(path).startsWith('/api/voice'))).toBe(false);
  });
});

describe('PlayerDetail — request scopes', () => {
  it('hides the previous subject immediately and ignores their late response', async () => {
    const old = deferred(); const next = deferred();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input) === '/api/users/p' ? old.promise : next.promise));
    const view = render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} />);
    view.rerender(<PlayerDetail userId="q" me={ADMIN} onClose={() => {}} />);
    await act(async () => { next.resolve(json(detail({ ...PERSON, id: 'q', username: '新选手' }, []))); });
    expect(await screen.findByRole('heading', { name: '新选手' })).toBeInTheDocument();
    await act(async () => { old.resolve(json(detail())); });
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新选手' })).toBeInTheDocument();
  });

  it('removes already loaded data before requesting a different subject', async () => {
    const next = deferred();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input) === '/api/users/p'
      ? Promise.resolve(json(detail())) : next.promise));
    const view = render(<PlayerDetail userId="p" me={null} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    view.rerender(<PlayerDetail userId="q" me={null} onClose={() => {}} />);
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
    expect(document.getElementById('case-7')).not.toBeInTheDocument();
    await act(async () => { next.resolve(json(detail({ ...PERSON, id: 'q', username: '新选手' }, []))); });
    expect(await screen.findByRole('heading', { name: '新选手' })).toBeInTheDocument();
  });

  it('focuses the new single case when switching cases for the same subject', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(detail(PERSON, [RECORD, { ...RECORD, id: 8 }]))));
    const view = render(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={7} />);
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={8} />);
    expect(document.getElementById('case-7')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe('case-8'));
    expect(screen.getByRole('heading', { name: '案件 #8' })).toBeInTheDocument();
    expect(document.querySelectorAll('.vc')).toHaveLength(1);
  });

  it('hides saved private data during a viewer change and reads the same subject again', async () => {
    const next = deferred(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? Promise.resolve(json(detail(PERSON, [{ ...RECORD, claim: '旧管理员可见的经过', redacted: false }]))) : next.promise));
    const view = render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} />);
    expect(await screen.findByText('旧管理员可见的经过')).toBeInTheDocument();
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} />);
    expect(screen.queryByText('旧管理员可见的经过')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '管理成员身份' })).not.toBeInTheDocument();
    await act(async () => { next.resolve(json(detail())); });
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('reads again when the same viewer loses staff privileges', async () => {
    const fetch = backend();
    const view = render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    view.rerender(<PlayerDetail userId="p" me={{ ...ADMIN, is_admin: false, is_judge: false }} onClose={() => {}} />);
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it('does not let an older refresh replace newer data', async () => {
    const older = deferred(); const newer = deferred(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? older.promise : newer.promise));
    const view = render(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={0} />);
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={1} />);
    await act(async () => { newer.resolve(json(detail({ ...PERSON, username: '最新名字' }, []))); });
    expect(await screen.findByRole('heading', { name: '最新名字' })).toBeInTheDocument();
    await act(async () => { older.resolve(json(detail())); });
    expect(screen.getByRole('heading', { name: '最新名字' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
  });

  it('does not reuse the route’s privileged fallback record for a different viewer', async () => {
    const secret = { ...RECORD, claim: '仅旧账号可见的经过', redacted: false };
    vi.stubGlobal('fetch', vi.fn(async () => json(detail(PERSON, []))));
    const view = render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} focusRecordId={7} pinnedRecord={secret} />);
    expect(await screen.findByText('仅旧账号可见的经过')).toBeInTheDocument();
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={7} pinnedRecord={secret} />);
    expect(screen.queryByText('仅旧账号可见的经过')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '链接里的案件不存在了。' })).toBeInTheDocument();
  });

  it('does not refresh the old subject or notify the new scope when an old mutation finishes', async () => {
    const mutation = deferred(); const changed = vi.fn(); const paths: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input); paths.push(path);
      if (init?.method === 'POST') return mutation.promise;
      return json(detail(path === '/api/users/q' ? { ...PERSON, id: 'q', username: '新选手' } : PERSON));
    }));
    const view = render(<PlayerDetail userId="p" me={ADMIN} onClose={() => {}} onChanged={changed} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '确认撤销' }));
    view.rerender(<PlayerDetail userId="q" me={ADMIN} onClose={() => {}} onChanged={changed} />);
    await screen.findByRole('heading', { name: '新选手' });
    await act(async () => { mutation.resolve(json({ ok: true })); });
    expect(paths.filter((path) => path === '/api/users/p')).toHaveLength(1);
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: '新选手' })).toBeInTheDocument();
  });
});

function actions(overrides: Partial<React.ComponentProps<typeof CaseActions>> = {}) {
  return { record: RECORD, me: JUDGE, isSelf: false, busy: false, overriding: false, now: NOW,
    onStartOverride: vi.fn(), onCancelOverride: vi.fn(), onStatement: vi.fn(), onAppeal: vi.fn(),
    onWithdraw: vi.fn(), onRevoke: vi.fn(), onOverride: vi.fn(), ...overrides };
}
describe('CaseActions — destructive action confirmations', () => {
  it('confirms withdrawal, defaults to keeping the case, and restores trigger focus after cancellation', async () => {
    const props = actions({ record: { ...RECORD, status: 'awaiting_statement' } });
    render(<CaseActions {...props} />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤案' }));
    expect(props.onWithdraw).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '保留案件' }));
    await user.click(screen.getByRole('button', { name: '保留案件' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '撤案' }));
    await user.click(screen.getByRole('button', { name: '撤案' }));
    await user.click(screen.getByRole('button', { name: '确认撤案' }));
    expect(props.onWithdraw).toHaveBeenCalledTimes(1);
  });

  it('confirms revocation but removes a pending confirmation at the reporter’s 15 minute boundary', async () => {
    const props = actions(); const view = render(<CaseActions {...props} />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^撤销 ·/ }));
    expect(props.onRevoke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确认撤销' })).toBeInTheDocument();
    view.rerender(<CaseActions {...props} now={Date.parse('2026-10-28T09:15:00Z')} />);
    expect(screen.queryByRole('button', { name: '确认撤销' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
    expect(props.onRevoke).not.toHaveBeenCalled();
  });

  it('keeps an administrator’s revocation available after 15 minutes and confirms once', async () => {
    const props = actions({ me: ADMIN, now: NOW + 86_400_000 });
    render(<CaseActions {...props} />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '保留判决' }));
    await user.click(screen.getByRole('button', { name: '确认撤销' }));
    expect(props.onRevoke).toHaveBeenCalledTimes(1);
  });

  it('resets a confirmation when the viewer changes even if both viewers can revoke', async () => {
    const props = actions({ me: ADMIN }); const view = render(<CaseActions {...props} />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    view.rerender(<CaseActions {...props} me={{ ...ADMIN, id: 'new-admin' }} />);
    expect(screen.queryByRole('button', { name: '确认撤销' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
  });

  it('keeps withdrawal available to the original reporter after they lose judge status', async () => {
    const props = actions({ me: { ...JUDGE, is_judge: false }, record: { ...RECORD, status: 'awaiting_statement' } });
    render(<CaseActions {...props} />); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '撤案' }));
    await user.click(screen.getByRole('button', { name: '确认撤案' }));
    expect(props.onWithdraw).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '改判' })).not.toBeInTheDocument();
  });

  it.each(['judging', 'withdrawn', 'revoked'] as const)('offers no destructive action after the case reaches %s', (status) => {
    render(<CaseActions {...actions({ me: ADMIN, record: { ...RECORD, status } })} />);
    expect(screen.queryByRole('button', { name: /撤案|撤销|改判/ })).not.toBeInTheDocument();
  });

  it('offers neither withdrawal nor revocation to another judge', () => {
    const props = actions({ me: { ...JUDGE, id: 'other-judge' }, record: { ...RECORD, status: 'awaiting_statement' } });
    const view = render(<CaseActions {...props} />);
    expect(screen.queryByRole('button', { name: '撤案' })).not.toBeInTheDocument();
    view.rerender(<CaseActions {...props} record={RECORD} />);
    expect(screen.queryByRole('button', { name: /^撤销/ })).not.toBeInTheDocument();
  });

  it('disables both confirmation buttons while the mutation is pending', async () => {
    const props = actions({ me: ADMIN }); const view = render(<CaseActions {...props} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '撤销' }));
    view.rerender(<CaseActions {...props} busy />);
    expect(screen.getByRole('button', { name: '保留判决' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '撤销中…' })).toBeDisabled();
    expect(props.onRevoke).not.toHaveBeenCalled();
  });

  it('never keeps an override form after the caller loses admin privileges', () => {
    const props = actions({ me: ADMIN, overriding: true }); const view = render(<CaseActions {...props} />);
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    view.rerender(<CaseActions {...props} me={JUDGE} />);
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认改判' })).not.toBeInTheDocument();
  });
});
