import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { StatementDialog } from '../../src/components/StatementDialog';
import { AppealSheet } from '../../src/components/AppealSheet';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { RouteView } from '../../src/components/RouteView';
import { ToastProvider } from '../../src/components/Toast';
import { readDraft, writeDraft } from '../../src/lib/drafts';
import { DRAFT_SAVE_DEBOUNCE_MS } from '../../src/lib/constants';
import type { Config, RecordItem, User } from '../../src/types';

const A: User = { id: 'a', username: '账号甲', oauth_username: '账号甲', avatar_url: null, is_admin: false,
  is_judge: false, is_participant: true, score: 80, created_at: '2026-10-01 00:00:00' };
const B = { ...A, id: 'b', username: '账号乙', oauth_username: '账号乙' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' };
const RECORD: RecordItem = { id: 7, subject: A, reporter: { id: 'judge', username: '裁判', avatar_url: null },
  type: 'no_show', delta: -10, note: null, claim: '仅甲及裁判可读的判决前经过。', claim_summary: null,
  classified_by: 'ai', escalation_suggested: false, session_id: null, statement: null, statement_at: null,
  appeal_reason: null, deadline_at: '2099-10-28 12:00:00', status: 'awaiting_statement', verdict: null,
  range: { min: -20, max: -10, base: -15 }, created_at: '2026-10-28 09:00:00', redacted: false };
const DECIDED = { ...RECORD, status: 'decided' as const, deadline_at: null, statement: '甲的说明' };
const config = CONFIG;
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function deferred<T>() { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });return { promise, resolve }; }
function value(kind: 'statement' | 'appeal'): unknown { return readDraft(kind, 7, raw => raw)?.value; }
function appBackend(pending?: Promise<Response>) {
  let me = A;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/api/records/7/statement') return pending ?? json(200, { record: DECIDED });
    const data = path === '/api/config' ? CONFIG
      : path === '/api/me' ? { user: me, pending: { statements: me.id === A.id ? 1 : 0, appeals: 0 } }
      : path === '/api/leaderboard' ? { participants: [me] }
      : path === '/api/records?limit=20&mine=pending' ? { records: [RECORD] }
      : path === '/api/records?limit=50' ? { records: [] }
      : path === '/api/report/latest' ? { report: null }
      : path === '/api/me/discord' ? { link: { discord_username: '本人', linked_at: 'x', notify_dm: true, dm_ok: true } }
      : null;
    return json(data === null ? 404 : 200, data ?? {});
  }));
  return { calls, switchTo(next: User) { me = next; } };
}
async function refreshAs(backend: ReturnType<typeof appBackend>, me: User): Promise<void> {
  backend.switchTo(me);vi.setSystemTime(Date.now() + 61_000);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('button', { name: me.username });
}
afterEach(() => { vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(document, 'visibilityState'); });

describe('the app’s private statement lifetime', () => {
  it('withdraws the old actor’s open statement immediately and skips its pending draft flush', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime('2026-10-28T10:00:00Z');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const backend = appBackend();window.history.replaceState(null, '', '/cases');render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '写说明 ›' }));
    const dialog = screen.getByRole('dialog', { name: '说明情况' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /你的说明/ }), { target: { value: '甲尚未保存的私密说明' } });
    await refreshAs(backend, B);
    expect(screen.queryByRole('dialog', { name: '说明情况' })).not.toBeInTheDocument();
    expect(screen.queryByText(RECORD.claim!)).not.toBeInTheDocument();expect(value('statement')).toBeUndefined();
  });
  it('cannot let the previous actor’s late verdict clear a new draft or refresh the current actor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });vi.setSystemTime('2026-10-28T10:00:00Z');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    const pending = deferred<Response>();const backend = appBackend(pending.promise);
    window.history.replaceState(null, '', '/cases');render(<App />);const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '写说明 ›' }));
    await user.type(screen.getByRole('textbox', { name: /你的说明/ }), '甲已经发送的说明');
    await user.click(screen.getByRole('button', { name: '提交说明' }));await user.click(screen.getByRole('button', { name: '确认提交' }));
    await refreshAs(backend, B);writeDraft('statement', 7, '当前会话的新草稿');
    const reads = backend.calls.filter(path => path === 'GET /api/me').length;
    await act(async () => pending.resolve(json(200, { record: DECIDED })));
    expect(value('statement')).toBe('当前会话的新草稿');
    expect(backend.calls.filter(path => path === 'GET /api/me')).toHaveLength(reads);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('private dialog request and draft leases', () => {
  it('revokes a statement timer and its unmount flush after an actor boundary', async () => {
    let current = true;
    const view = render(<StatementDialog open record={RECORD} config={config} onClose={() => {}} onDecided={() => {}} isCurrentActor={() => current} />);
    fireEvent.change(screen.getByRole('textbox', { name: /你的说明/ }), { target: { value: '旧说明' } });
    current = false;writeDraft('statement', 7, '新会话的说明');
    await act(async () => { await new Promise(done => setTimeout(done, DRAFT_SAVE_DEBOUNCE_MS + 20)); });
    expect(value('statement')).toBe('新会话的说明');view.unmount();expect(value('statement')).toBe('新会话的说明');
  });
  it('ignores an unmounted appeal’s late success without clearing a new draft or showing a toast', async () => {
    const pending = deferred<Response>();vi.stubGlobal('fetch', vi.fn(() => pending.promise));const changed = vi.fn();
    const view = render(<ToastProvider><AppealSheet record={DECIDED} onClose={() => {}} onAppealed={changed} /></ToastProvider>);
    const user = userEvent.setup();await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '旧申诉');
    await user.click(screen.getByRole('button', { name: '提交申诉' }));await user.click(screen.getByRole('button', { name: '确认申诉' }));
    view.unmount();writeDraft('appeal', 7, '新会话的申诉');
    await act(async () => pending.resolve(json(200, { record: { ...DECIDED, status: 'appealed' } })));
    expect(changed).not.toHaveBeenCalled();expect(value('appeal')).toBe('新会话的申诉');
    expect(screen.queryByText('申诉已提交，等管理员复核。')).not.toBeInTheDocument();
  });
  it('revokes an appeal timer and unmount flush after an actor boundary', async () => {
    let current = true;const view = render(<AppealSheet record={DECIDED} onClose={() => {}} onAppealed={() => {}} isCurrentActor={() => current} />);
    fireEvent.change(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), { target: { value: '旧申诉' } });
    current = false;writeDraft('appeal', 7, '新会话的申诉');
    await act(async () => { await new Promise(done => setTimeout(done, DRAFT_SAVE_DEBOUNCE_MS + 20)); });
    expect(value('appeal')).toBe('新会话的申诉');view.unmount();expect(value('appeal')).toBe('新会话的申诉');
  });
  it.each(['statement', 'appeal'] as const)('still flushes the latest %s edit on an ordinary close for the same actor', kind => {
    const view = render(kind === 'statement'
      ? <StatementDialog open record={RECORD} config={config} onClose={() => {}} onDecided={() => {}} />
      : <AppealSheet record={DECIDED} onClose={() => {}} onAppealed={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '普通离开前的最后一笔' } });view.unmount();
    expect(value(kind)).toBe('普通离开前的最后一笔');
  });
  it('revokes a personal appeal’s pending flush when PlayerDetail changes viewers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/voice')
      ? json(404, {}) : json(200, { user: A, records: [DECIDED], history: [] })));
    const view = render(<PlayerDetail userId="a" me={A} onClose={() => {}} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '申诉' }));
    fireEvent.change(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), { target: { value: '甲最后一笔私密申诉' } });
    view.rerender(<PlayerDetail userId="a" me={B} onClose={() => {}} />);
    expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument();
    expect(value('appeal')).toBeUndefined();
    await screen.findByRole('heading', { name: A.username });
  });
  it('revokes the lease across the whole case-route subtree when the viewer key changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).startsWith('/api/voice')
      ? json(404, {}) : String(input) === '/api/records/7' ? json(200, { record: DECIDED })
        : json(200, { user: A, records: [DECIDED], history: [] })));
    let generation = 0;
    const props = (me: User, own: number) => ({ me, config, layout: 'page' as const,
      location: { pathname: '/players/a/cases/7', search: '', route: { name: 'playerCase' as const, userId: 'a', caseId: 7 } },
      pinned: null, playerRefreshKey: 0, onPinned: vi.fn(), onChanged: vi.fn(), onOpenStatement: vi.fn(),
      isCurrentActor: () => generation === own });
    const view = render(<RouteView {...props(A, 0)} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '申诉' }));
    fireEvent.change(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), { target: { value: '旧整棵路由的申诉' } });
    generation = 1;view.rerender(<RouteView {...props(B, 1)} />);
    expect(value('appeal')).toBeUndefined();expect(screen.queryByRole('dialog', { name: '申诉这一起' })).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: '案件 #7' });
  });
});
