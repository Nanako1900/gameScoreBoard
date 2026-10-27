import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { SessionFormDialog } from '../../src/components/SessionFormDialog';
import { NewSessionRoute } from '../../src/components/NewSessionRoute';
import { RollCallPage } from '../../src/components/RollCallPage';
import { OrganizerConsole } from '../../src/components/OrganizerConsole';
import { writeDraft } from '../../src/lib/drafts';
import { useDesktopViewport } from './viewport';
import type { Config, PublicUser, SessionDetail, User } from '../../src/types';

const NOW = Date.parse('2026-10-28T10:00:00Z'); const HOUR = 3_600_000;
const ME: User = { id: 'org', username: '组织者', oauth_username: '组织者', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z', boardTzOffsetHours: 8 };
const FRIEND = { id: 'a', username: '阿飞', avatar_url: null, is_participant: false, last_played_with_me_at: '2026-10-27T13:00:00Z' };
const PARTICIPANT: PublicUser = { ...ME, id: 'b', username: '小白' };
function session(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 5, organizer: { id: ME.id, username: ME.username, avatar_url: null }, title: '周末冲分', game: '瓦',
    starts_at: '2026-10-29T13:00:00Z', duration_min: 180, capacity: 5, note: '不复制的备注', status: 'open', settled_at: null,
    created_at: new Date(NOW).toISOString(), counts: { going: 2, invited: 0, maybe: 0, out: 0 }, my_rsvp: 'going',
    players: [{ user: { id: 'a', username: '阿飞', avatar_url: null }, rsvp: 'going', rsvp_at: '', attendance: null,
      late_minutes: null, attendance_note: null, record_id: null, is_participant: false }], ...patch };
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function mock(reply: (path: string, init?: RequestInit) => Response = () => json(200, { users: [FRIEND] })) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(reply(String(input), init)));
  vi.stubGlobal('fetch', fetch); return fetch;
}
function showRoute(layout: 'page' | 'drawer' = 'page', me: User | null = ME) {
  render(<NewSessionRoute me={me} config={CONFIG} layout={layout} participants={[PARTICIPANT]} onCreated={vi.fn()} />);
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(NOW); window.history.replaceState(null, '', '/sessions/new'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('new session page', () => {
  it('visitors see login and no form or request, retaining again in the login return', () => {
    window.history.replaceState(null, '', '/sessions/new?again=5'); const fetch = mock(); showRoute('page', null);
    expect(screen.getByText('登录后就能组局。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '用 Nanako 账号登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('button', { name: '约！' })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a page with a back bar on phones', async () => {
    mock(); showRoute(); expect(await screen.findByRole('heading', { name: '约一局' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: '什么时候？（北京时间）' })).toBeInTheDocument();
  });
  it('uses a center dialog on desktop without adding an overlay history entry', async () => {
    mock(); showRoute('drawer'); const dialog = await screen.findByRole('dialog', { name: '约一局' });
    expect(dialog).toHaveClass('modal__panel'); expect(window.history.state?.sheet).toBeUndefined();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });
  it('prefills again once even under StrictMode, using next week, the people and settings, without note', async () => {
    window.history.replaceState(null, '', '/sessions/new?again=5');
    const fetch = mock((path) => path === '/api/sessions/5' ? json(200, { session: session(), records: [] }) : json(200, { users: [FRIEND] }));
    render(<StrictMode><NewSessionRoute me={ME} config={CONFIG} layout="page" participants={[]} onCreated={vi.fn()} /></StrictMode>);
    expect(await screen.findByRole('checkbox', { name: '阿飞' })).toBeChecked();
    expect(screen.getByLabelText('自定义开始时间')).toHaveValue('2026-11-05T21:00');
    await userEvent.setup().click(screen.getByRole('button', { name: /更多：游戏/ }));
    expect(screen.getByLabelText('游戏')).toHaveValue('瓦'); expect(screen.getByLabelText('人数上限')).toHaveValue(5);
    expect(screen.getByLabelText('时长（分钟）')).toHaveValue(180); expect(screen.getByLabelText('备注')).toHaveValue('');
    expect(fetch.mock.calls.filter(([path]) => path === '/api/sessions/5')).toHaveLength(1);
  });
  it.each(['07', 'bad'])('does not request an invalid again id %s', async (id) => {
    window.history.replaceState(null, '', `/sessions/new?again=${id}`); const fetch = mock(); showRoute();
    await screen.findByRole('button', { name: '约！' }); expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/me/invitable']);
  });
  it('ignores a failed again lookup and still permits a fresh session', async () => {
    window.history.replaceState(null, '', '/sessions/new?again=5');
    mock((path) => path === '/api/sessions/5' ? json(404, { error: 'gone' }) : json(200, { users: [FRIEND] })); showRoute();
    expect(await screen.findByRole('button', { name: '约！' })).toBeEnabled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('selects the last lineup and submits the board custom clock with expanded settings', async () => {
    const fetch = mock((path) => path === '/api/sessions' ? json(200, { session: session({ id: 9 }) }) : json(200, { users: [FRIEND] }));
    showRoute(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: '和上次一样' }));
    expect(screen.getByRole('checkbox', { name: '阿飞' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /其他时间/ }));
    fireEvent.change(screen.getByLabelText('自定义开始时间'), { target: { value: '2026-10-29T21:30' } });
    await user.click(screen.getByRole('button', { name: /更多：游戏/ }));
    await user.type(screen.getByLabelText('游戏'), '瓦'); await user.type(screen.getByLabelText('人数上限'), '5');
    await user.type(screen.getByLabelText('时长（分钟）'), '90'); await user.type(screen.getByLabelText('备注'), '开麦');
    await user.click(screen.getByRole('button', { name: '约！（叫 1 人）' }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body))).toEqual({
      starts_at: '2026-10-29T13:30:00.000Z', invite: ['a'], game: '瓦', capacity: 5, duration_min: 90, note: '开麦' });
  });
  it('PageBar return uses the shared draft guard and restores focus when continuing', async () => {
    mock(); showRoute(); const user = userEvent.setup(); await user.click(await screen.findByRole('checkbox', { name: '阿飞' }));
    const back = screen.getByRole('button', { name: '返回' }); await user.click(back);
    const confirm = screen.getByRole('group', { name: '这局还没约，已选的 1 个人会留在这台设备上。' });
    await user.click(within(confirm).getByRole('button', { name: '继续编辑' })); expect(back).toHaveFocus();
    expect(screen.getByRole('checkbox', { name: '阿飞' })).toBeChecked();
  });
  it('a note alone stays in the new routed draft and triggers the same leave confirmation', async () => {
    mock(() => json(200, { users: [] })); const user = userEvent.setup();
    const view = render(<NewSessionRoute me={ME} config={CONFIG} layout="page" participants={[]} onCreated={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /更多：游戏/ })); await user.type(screen.getByLabelText('备注'), '仅备注');
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('group', { name: '这局还没约，已选的 0 个人会留在这台设备上。' })).toBeInTheDocument(); view.unmount();
    expect(JSON.parse(localStorage.getItem('edg.draft.session')!).value.more.note).toBe('仅备注');
    showRoute(); await user.click(await screen.findByRole('button', { name: /更多：游戏/ })); expect(screen.getByLabelText('备注')).toHaveValue('仅备注');
  });
  it('legacy standalone callers retain their unrestricted selection behavior', async () => {
    const participants = Array.from({ length: 21 }, (_, i) => ({ ...PARTICIPANT, id: `p${i}`, username: `玩家${i}` }));
    const user = userEvent.setup();
    render(<SessionFormDialog open participants={participants} selfId="org" onClose={vi.fn()} onCreated={vi.fn()} />);
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox);
    expect(screen.getByRole('button', { name: '约！（叫 21 人）' })).toBeInTheDocument();
  });
  it('legacy callers never submit hidden more fields restored from a newer draft', async () => {
    const fetch = mock(() => json(200, { session: session() }));
    writeDraft('session', undefined, { invite: ['b'], custom: '2026-10-29T21:30', chosen: null,
      more: { game: '不应提交', capacity: '5', durationMin: '90', note: '隐藏备注' } });
    render(<SessionFormDialog open participants={[PARTICIPANT]} selfId="org" onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '约！（叫 1 人）' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ starts_at: new Date('2026-10-29T21:30').toISOString(), invite: ['b'] });
  });
  it('caps a restored legacy lineup to twenty only in the new routed form', async () => {
    const users = Array.from({ length: 21 }, (_, i) => ({ ...FRIEND, id: `p${i}`, username: `玩家${i}` }));
    writeDraft('session', undefined, { invite: users.map((p) => p.id), custom: '', chosen: null });
    mock(() => json(200, { users })); showRoute();
    expect(await screen.findByRole('button', { name: '约！（叫 20 人）' })).toBeInTheDocument();
  });
  it('restores extended draft settings', async () => {
    writeDraft('session', undefined, { invite: ['a'], custom: '', chosen: null, more: { game: '瓦', capacity: '4', durationMin: '60', note: '草稿备注' } });
    mock(); showRoute(); await screen.findByRole('checkbox', { name: '阿飞' });
    await userEvent.setup().click(screen.getByRole('button', { name: /更多：游戏/ }));
    expect(screen.getByLabelText('备注')).toHaveValue('草稿备注');
  });
  it('falls back to board participants when invitable returns 404', async () => {
    mock(() => json(404, { error: 'unsupported' })); showRoute();
    expect(await screen.findByRole('checkbox', { name: '小白' })).toBeInTheDocument(); expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
  it('shows the raw 429 error next to the form', async () => {
    mock((path) => path === '/api/sessions' ? json(429, { error: '同时还没开局的约局最多 5 个' }) : json(200, { users: [] })); showRoute();
    await userEvent.setup().click(await screen.findByRole('button', { name: '约！' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('同时还没开局的约局最多 5 个');
  });
});

describe('created and again navigation', () => {
  it.each(['phone', 'desktop'])('creates from the %s form, replaces it with the detail and shows the created card', async (layout) => {
    if (layout === 'desktop') useDesktopViewport(); let created = false;
    mock((path, init) => {
      if (path === '/api/config') return json(200, CONFIG);
      if (path === '/api/me') return json(200, { user: ME, pending: { statements: 0, appeals: 0 } });
      if (path === '/api/leaderboard') return json(200, { participants: [PARTICIPANT] });
      if (path === '/api/records?limit=50') return json(200, { records: [] });
      if (path === '/api/report/latest') return json(200, { report: null });
      if (path === '/api/me/invitable') return json(200, { users: [] });
      if (path === '/api/sessions' && init?.method === 'POST') { created = true; return json(200, { session: session({ id: 9 }) }); }
      if (path === '/api/sessions/9') return json(200, { session: session({ id: 9 }), records: [] });
      return json(200, { sessions: created ? [session({ id: 9 })] : [] });
    });
    render(<App />); const idx = window.history.state?.idx; await userEvent.setup().click(await screen.findByRole('button', { name: '约！' }));
    expect(await screen.findByRole('heading', { name: '周末冲分' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sessions/9'); expect(window.history.state?.idx).toBe(idx);
    expect(screen.getByText('约好了 🎮 把链接发到群里吧')).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: /约好了/ })).not.toBeInTheDocument();
  });
  it('the completed roll call page offers again with the same session id', async () => {
    const s = session({ starts_at: new Date(NOW - HOUR).toISOString() }); let settled = false;
    mock((path) => {
      if (path.endsWith('/rollcall')) return json(200, { session: s, drafts: [] });
      if (path.endsWith('/settle')) { settled = true; return json(200, { session: { ...s, status: 'settled' }, created: 0, skipped: 0 }); }
      return json(200, { session: settled ? { ...s, status: 'settled' } : s, records: [] });
    });
    render(<RollCallPage sessionId={5} me={ME} onChanged={vi.fn()} />); const user = userEvent.setup();
    await user.click(within(await screen.findByRole('group', { name: '阿飞 出勤' })).getByRole('button', { name: '准时' }));
    await user.click(screen.getByRole('button', { name: '保存点名（1 人）' }));
    await user.click(await screen.findByRole('button', { name: '跳过全部，仅记录出勤' }));
    expect(await screen.findByRole('link', { name: '再约一次' })).toHaveAttribute('href', '/sessions/new?again=5');
  });
  it('settled console links to the same people next week', () => {
    render(<OrganizerConsole session={session({ status: 'settled' })} records={[]} now={NOW} busy={false} meId="org"
      onSessionChanged={vi.fn()} onCancel={vi.fn(async () => true)} onChanged={vi.fn()} />);
    expect(screen.getByRole('link', { name: '再约一次' })).toHaveAttribute('href', '/sessions/new?again=5');
    expect(screen.getByText('同一批人，默认下周同一时间')).toBeInTheDocument();
  });
});
