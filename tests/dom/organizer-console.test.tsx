import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INVITES, MAX_OPEN_SESSIONS } from '@shared/attendance';
import { OrganizerConsole } from '../../src/components/OrganizerConsole';
import { ShareActions } from '../../src/components/ShareActions';
import { InviteSheet } from '../../src/components/InviteSheet';
import { RescheduleSheet } from '../../src/components/RescheduleSheet';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { ToastProvider } from '../../src/components/Toast';
import type { InvitableUser, SessionDetail, User } from '../../src/types';

const NOW = Date.parse('2026-10-28T10:00:00Z');
const HOUR = 3_600_000;
const BROWSER_APIS = [
  [navigator, 'clipboard', Object.getOwnPropertyDescriptor(navigator, 'clipboard')],
  [navigator, 'share', Object.getOwnPropertyDescriptor(navigator, 'share')],
  [URL, 'createObjectURL', Object.getOwnPropertyDescriptor(URL, 'createObjectURL')],
  [URL, 'revokeObjectURL', Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')],
] as const;
function restoreBrowserAPIs(): void {
  for (const [target, key, descriptor] of BROWSER_APIS) {
    if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
  }
}
const ME: User = { id: 'org', username: '组织者', oauth_username: '组织者', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
function session(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 1, organizer: { id: 'org', username: '组织者', avatar_url: null }, title: '五排', game: '瓦',
    starts_at: new Date(NOW + 3 * HOUR).toISOString(), duration_min: 60, capacity: 5, note: '一起玩', status: 'open',
    settled_at: null, created_at: new Date(NOW).toISOString(), counts: { going: 4, invited: 2, maybe: 0, out: 0 },
    my_rsvp: 'going', players: [], cancel_reason: null, ...patch };
}
function friend(id: string, recent: string | null = null, board = true): InvitableUser {
  return { id, username: `玩家${id}`, avatar_url: null, is_participant: board, last_played_with_me_at: recent };
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function mock(reply: (path: string, init?: RequestInit) => Response = () => json(200, { users: [] })) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(reply(String(input), init)));
  vi.stubGlobal('fetch', fetch); return fetch;
}
function showConsole(s = session(), mine: SessionDetail[] | null = null) {
  const changed = vi.fn(); const cancel = vi.fn(async () => true);
  render(<ToastProvider><OrganizerConsole session={s} records={[]} now={NOW} busy={false} meId="org"
    mySessions={mine} onSessionChanged={vi.fn()} onCancel={cancel} onChanged={changed} boardTzOffsetHours={8} /></ToastProvider>);
  return { changed, cancel };
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restoreBrowserAPIs(); });

describe('organizer console', () => {
  it('before start shows the gap and the controls in order, with cancel last and no RSVP controls', async () => {
    mock(); showConsole();
    expect(screen.getByText('还差 1 人满员 · 2 人还没回')).toBeInTheDocument();
    const invite = await screen.findByRole('button', { name: '再叫几个人' });
    const move = screen.getByRole('button', { name: '改时间' }); const cancel = screen.getByRole('button', { name: '取消这局' });
    expect(invite.compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(move.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
  });
  it('celebrates a full roster and hides quota until the mine list is available', async () => {
    mock(); showConsole(session({ capacity: 4 }));
    await screen.findByRole('button', { name: '再叫几个人' });
    expect(screen.getByText('4/4 到齐，就等开打 🎉')).toBeInTheDocument();
    expect(screen.queryByText(/你还能再开|你已经满了/)).not.toBeInTheDocument();
  });
  it.each([1, 0])('shows the low open quota %s', async (left) => {
    mock(); showConsole(session(), Array.from({ length: MAX_OPEN_SESSIONS - left }, () => session()));
    await screen.findByRole('button', { name: '再叫几个人' });
    expect(screen.getByText(left ? /你还能再开 1 个局/ : /同时最多 5 个还没开的局，你已经满了/)).toBeInTheDocument();
  });
  it.each([
    ['live', { starts_at: new Date(NOW - HOUR / 2).toISOString() }, '现在点名', '进行中'],
    ['due', { starts_at: new Date(NOW - 2 * HOUR).toISOString() }, '去点名', '局结束了，点个名？'],
  ] as const)('renders %s without invite, reschedule or cancel', (_kind, patch, label, copy) => {
    const fetch = mock(); showConsole(session(patch));
    expect(screen.getByText(new RegExp(copy))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', '/sessions/1/rollcall');
    expect(screen.queryByRole('button', { name: '改时间' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消这局' })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
  it('settled shows attendance and cancelled renders nothing', () => {
    mock(); const view = render(<OrganizerConsole session={session({ status: 'settled' })} records={[]} now={NOW} busy={false}
      meId="org" onSessionChanged={vi.fn()} onCancel={vi.fn(async () => true)} onChanged={vi.fn()} />);
    expect(screen.getByText('已结算')).toBeInTheDocument();
    view.rerender(<OrganizerConsole session={session({ status: 'cancelled' })} records={[]} now={NOW} busy={false}
      meId="org" onSessionChanged={vi.fn()} onCancel={vi.fn(async () => true)} onChanged={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: '组织者' })).not.toBeInTheDocument();
  });
  it('silently hides the invitation entry on an unsupported API', async () => {
    const fetch = mock(() => json(404, { error: '旧接口' })); showConsole();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: '再叫几个人' })).not.toBeInTheDocument();
  });
  it('adds an optional public reason, trims it, and keeps confirmation focus and wording', async () => {
    mock(); const { cancel } = showConsole(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '取消这局' }));
    expect(screen.getByRole('button', { name: '不取消了' })).toHaveFocus();
    const input = screen.getByRole('textbox', { name: '理由（选填，会写进私信，也会显示在这局的页面上）' });
    expect(input).toHaveAttribute('maxlength', '80'); await user.type(input, '  临时有事  ');
    await user.click(screen.getByRole('button', { name: '确认取消' })); expect(cancel).toHaveBeenCalledWith('临时有事');
  });
  it('sends blank reason as undefined and omits the field for an older API', async () => {
    mock(); const cancel = vi.fn(async () => true); const user = userEvent.setup();
    const view = render(<OrganizerConsole session={session()} records={[]} now={NOW} busy={false} meId="org"
      onSessionChanged={vi.fn()} onCancel={cancel} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '取消这局' }));
    await user.type(screen.getByRole('textbox'), '   '); await user.click(screen.getByRole('button', { name: '确认取消' }));
    expect(cancel).toHaveBeenCalledWith(undefined);
    view.rerender(<OrganizerConsole session={session({ cancel_reason: undefined })} records={[]} now={NOW} busy={false} meId="org"
      onSessionChanged={vi.fn()} onCancel={cancel} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '取消这局' })); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('successful invitations keep the existing toast and offer copying the invite link', async () => {
    const s = session(); const user = userEvent.setup(); const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mock((path) => path.endsWith('/invite') ? json(200, { session: s, added: 1, skipped: 0 }) : json(200, { users: [friend('a')] }));
    showConsole(); await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    await user.click(screen.getByRole('checkbox', { name: '玩家a' })); await user.click(screen.getByRole('button', { name: '叫 1 人' }));
    expect(await screen.findByText('已叫 1 人。没绑 Discord 的朋友，记得在群里喊一声。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制邀请链接' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/sessions/1`); Reflect.deleteProperty(navigator, 'clipboard');
  });
  it('detail gives every record a canonical case link', async () => {
    const ref = { id: 'a', username: '阿飞', avatar_url: null };
    const record = { id: 9, subject: ref, reporter: ref, type: null, delta: 0, note: null, claim: null, claim_summary: null,
      classified_by: 'human', escalation_suggested: false, session_id: 1, statement: null, statement_at: null, appeal_reason: null,
      deadline_at: null, status: 'awaiting_statement', verdict: null, range: null, created_at: '2026-10-28 09:00:00', pending_hidden: true };
    mock((path) => path === '/api/me/invitable' ? json(200, { users: [] }) : json(200, { session: session(), records: [record] }));
    render(<SessionDetailDialog sessionId={1} me={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole('link', { name: '看案件 #9' })).toHaveAttribute('href', '/players/a/cases/9');
    expect(screen.getByRole('heading', { name: '这局的记录 1' })).toBeInTheDocument();
  });
  it('detail sends a blank reason with no body', async () => {
    const s = session(); const fetch = mock((path, init) => path.endsWith('/cancel')
      ? json(200, { session: { ...s, status: 'cancelled' } }) : path === '/api/me/invitable' ? json(200, { users: [] })
      : json(200, { session: s, records: [] }));
    render(<SessionDetailDialog sessionId={1} me={ME} onClose={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '取消这局' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '确认取消' }));
    await waitFor(() => expect(fetch.mock.calls.some(([path]) => String(path).endsWith('/cancel'))).toBe(true));
    const [, init] = fetch.mock.calls.find(([path]) => String(path).endsWith('/cancel'))!; expect(init?.body).toBeUndefined();
  });
});

describe('full invitation picker', () => {
  it('shows three groups, searches names and selects only free people from the last lineup', async () => {
    const users = [friend('a', '2026-10-27'), friend('b', '2026-10-27'), friend('c', '2026-10-27'), friend('d'), friend('e', null, false)];
    const players = ['a', 'b'].map((id, i) => ({ user: { id, username: `玩家${id}`, avatar_url: null }, rsvp: i ? 'out' : 'going',
      rsvp_at: '', attendance: null, late_minutes: null, attendance_note: null, record_id: null, is_participant: true })) as SessionDetail['players'];
    render(<InviteSheet session={session({ players })} invitable={{ state: { kind: 'ready', users }, reload: vi.fn() }} onClose={vi.fn()} onInvited={vi.fn()} />);
    expect(screen.getByRole('group', { name: '上次一起玩的' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '在榜的' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '其他朋友（未上榜，不参与计分）' })).toBeInTheDocument();
    const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: '和上次一样' }));
    expect(screen.getByRole('checkbox', { name: '玩家a · 已在局里' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '玩家b · 说了不来' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '玩家c' })).toBeChecked();
    await user.type(screen.getByRole('searchbox', { name: '搜名字' }), '玩家e');
    expect(screen.queryByRole('checkbox', { name: '玩家c' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '玩家e' })).toBeInTheDocument();
  });
  it('caps the last lineup and disables other unchecked people at twenty', async () => {
    const users = Array.from({ length: MAX_INVITES + 1 }, (_, i) => friend(String(i), '2026-10-27'));
    render(<InviteSheet session={session()} invitable={{ state: { kind: 'ready', users }, reload: vi.fn() }} onClose={vi.fn()} onInvited={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '和上次一样' }));
    expect(screen.getAllByRole('checkbox').filter((box) => (box as HTMLInputElement).checked)).toHaveLength(MAX_INVITES);
    expect(screen.getByRole('checkbox', { name: '玩家20' })).toBeDisabled(); expect(screen.getByText('一次最多叫 20 人')).toBeInTheDocument();
  });
});

describe('sharing', () => {
  function copyMock(ok = true) { const writeText = vi.fn(() => ok ? Promise.resolve() : Promise.reject(new Error('denied')));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); return writeText; }
  it('copies a canonical session link and shows a status toast', async () => {
    const user = userEvent.setup(); const write = copyMock(); render(<ToastProvider><ShareActions session={session()} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: '复制链接' }));
    expect(write).toHaveBeenCalledWith(`${window.location.origin}/sessions/1`);
    expect(screen.getByRole('status')).toHaveTextContent('链接已复制。朋友打开后登录就能报名。'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('falls back to manual copy with an error toast', async () => {
    const user = userEvent.setup(); copyMock(false); render(<ToastProvider><ShareActions session={session()} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: '复制链接' }));
    expect(screen.getByRole('status')).toHaveTextContent(`没复制成功，请手动复制：${window.location.origin}/sessions/1`);
    expect(document.querySelector('.toast--error')).toBeInTheDocument();
  });
  it('ignores share abort and falls back to copy for other share failures', async () => {
    const user = userEvent.setup(); const write = copyMock(); const share = vi.fn().mockRejectedValueOnce(new DOMException('cancel', 'AbortError')).mockRejectedValueOnce(new Error('fail'));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<ToastProvider><ShareActions session={session()} /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: '分享邀请' })); expect(write).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '分享邀请' })); expect(write).toHaveBeenCalledTimes(1);
  });
  it.each([{ starts_at: new Date(NOW - HOUR).toISOString() }, { status: 'settled' }, { status: 'cancelled' }] as const)('hides sharing after start or closure', (patch) => {
    render(<ShareActions session={session(patch)} />); expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('downloads an .ics file and revokes its object URL', async () => {
    const create = vi.fn((_blob: Blob) => 'blob:calendar'); const revoke = vi.fn(); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    render(<ShareActions session={session()} boardTzOffsetHours={8} />); await userEvent.setup().click(screen.getByRole('button', { name: '加到日历' }));
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob); expect(click).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:calendar'));
    Reflect.deleteProperty(URL, 'createObjectURL'); Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});

describe('rescheduling on the board clock', () => {
  it('uses board slots and interprets the custom input in the board timezone', async () => {
    const s = session(); const fetch = mock((_path, init) => json(200, { session: { ...s, starts_at: JSON.parse(String(init?.body)).starts_at } }));
    render(<RescheduleSheet session={s} boardTzOffsetHours={8} onClose={vi.fn()} onRescheduled={vi.fn()} />);
    expect(screen.getByText('周三 10/28 21:00（北京时间）')).toBeInTheDocument(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /其他时间/ }));
    fireEvent.change(screen.getByLabelText('自定义开始时间'), { target: { value: '2026-10-29T21:30' } });
    await user.click(screen.getByRole('button', { name: '改到 明天 21:30' }));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ starts_at: '2026-10-29T13:30:00.000Z' });
  });
});
