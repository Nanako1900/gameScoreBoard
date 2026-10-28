import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { CaseDialog } from '../../src/components/CaseDialog';
import { bootRouter, goBack, navigate, useLocation } from '../../src/lib/router';
import { readDraft, writeDraft } from '../../src/lib/drafts';
import type { Config, PublicUser, RecordItem } from '../../src/types';
import { drainHistoryTraversals } from './history';

const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
  aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' };
const PEOPLE: PublicUser[] = [
  { id: 'judge', username: '裁判', avatar_url: null, is_participant: false, is_judge: true, score: 100, created_at: 'x' },
  { id: 'a', username: '甲', avatar_url: null, is_participant: true, is_judge: false, score: 90, created_at: 'x' },
  { id: 'b', username: '乙', avatar_url: null, is_participant: true, is_judge: false, score: 80, created_at: 'x' },
];
const CLAIM = '说好八点一起开黑，等了四十分钟还没有出现。';
const RECORD = { id: 30 } as RecordItem;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; });return { promise, resolve }; }
function Controller({ actor = 'judge', changed = vi.fn() }: { actor?: string; changed?: (records: RecordItem[]) => void }): JSX.Element {
  const location = useLocation();
  const open = location.route.name === 'tools' && location.route.tab === 'filing';
  return <><button onClick={() => navigate('/board')}>去榜单</button><span data-testid="current-path">{location.pathname}</span>
    <CaseDialog key={actor} variant="page" open={open} onClose={() => { if (location.pathname === '/tools/filing') goBack(); }}
      participants={PEOPLE} selfId={actor} config={CONFIG} onCreated={changed} /></>;
}
function start(changed = vi.fn()) {
  bootRouter();act(() => navigate('/tools'));act(() => navigate('/tools/filing'));
  const view = render(<Controller changed={changed} />);return { view, changed };
}
async function fill(two = false): Promise<void> {
  const user = userEvent.setup();await user.click(screen.getByRole('checkbox', { name: /甲/ }));
  if (two) await user.click(screen.getByRole('checkbox', { name: /乙/ }));
  await user.type(screen.getByRole('textbox', { name: /发生了什么/ }), CLAIM);
}
function stored(): unknown { return readDraft('case', undefined, value => value)?.value; }
beforeEach(() => { vi.spyOn(api, 'createCases').mockResolvedValue({ records: [RECORD], failed: [] }); });
afterEach(() => { vi.restoreAllMocks(); });

describe('persistent page filing controller', () => {
  it('renders a page and keeps ordinary route departure inline, with the draft preserved', async () => {
    start();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('heading', { name: '记一笔' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /裁判/ })).not.toBeInTheDocument();
    await fill();const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '去榜单' }));
    await user.click(screen.getByRole('button', { name: '继续写' }));expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
    await user.click(screen.getByRole('button', { name: '去榜单' }));await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(window.location.pathname).toBe('/board');expect(stored()).toMatchObject({ picked: ['a'], claim: CLAIM });expect(api.createCases).not.toHaveBeenCalled();
    act(() => navigate('/tools/filing'));expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
  });
  it('links selected people to the new voice tool', async () => {
    start();await fill();expect(screen.getByRole('link', { name: '看 TA 的语音记录' })).toHaveAttribute('href', '/tools/voice?user=a');
  });
  it('asks on browser Back without adding a fake overlay history entry', async () => {
    start();const before = window.history.length;await fill();expect(window.history.length).toBe(before);
    await act(async () => { window.history.back();await drainHistoryTraversals(); });
    await screen.findByRole('button', { name: '继续写' });expect(window.location.pathname).toBe('/tools/filing');
    await userEvent.setup().click(screen.getByRole('button', { name: '先离开' }));await waitFor(() => expect(window.location.pathname).toBe('/tools'));
  });
  it('clears the successful draft before returning, without a second leave question', async () => {
    const { changed } = start();await fill();await userEvent.setup().click(screen.getByRole('button', { name: '记下' }));
    await waitFor(() => expect(window.location.pathname).toBe('/tools'));expect(changed).toHaveBeenCalledOnce();expect(stored()).toBeUndefined();
    expect(screen.queryByRole('button', { name: '先离开' })).not.toBeInTheDocument();
  });
  it('finishes an in-flight request after ordinary navigation and cannot file the same people twice on return', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.createCases>>>();vi.mocked(api.createCases).mockReturnValue(pending.promise);
    const { changed } = start();await fill();const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '记下' }));
    await user.click(screen.getByRole('button', { name: '去榜单' }));await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(window.location.pathname).toBe('/board');await act(async () => pending.resolve({ records: [RECORD], failed: [] }));
    expect(window.location.pathname).toBe('/board');expect(changed).toHaveBeenCalledOnce();expect(stored()).toBeUndefined();
    act(() => navigate('/tools/filing'));expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue('');expect(api.createCases).toHaveBeenCalledOnce();
  });
  it('shrinks a background partial-success draft to only failed people', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.createCases>>>();vi.mocked(api.createCases).mockReturnValue(pending.promise);
    start();await fill(true);const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '记下（2 人）' }));
    await user.click(screen.getByRole('button', { name: '去榜单' }));await user.click(screen.getByRole('button', { name: '先离开' }));
    await act(async () => pending.resolve({ records: [RECORD], failed: [{ subject_id: 'b', error: '稍后再试' }] }));
    await waitFor(() => expect(stored()).toMatchObject({ picked: ['b'], claim: CLAIM }));
    act(() => navigate('/tools/filing'));expect(screen.getByRole('checkbox', { name: /甲/ })).not.toBeChecked();expect(screen.getByRole('checkbox', { name: /乙/ })).toBeChecked();
  });
  it('locks all request fields against changes while the request is in flight', async () => {
    vi.mocked(api.createCases).mockReturnValue(new Promise(() => {}));start();await fill(true);
    await userEvent.setup().click(screen.getByRole('button', { name: '记下（2 人）' }));
    expect(screen.getByRole('textbox', { name: /发生了什么/ })).toBeDisabled();expect(screen.getByRole('checkbox', { name: /甲/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /甲 单独补一句/ })).toBeDisabled();
  });
  it('does not let a late old actor result clear a new actor draft or refresh their page', async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.createCases>>>();vi.mocked(api.createCases).mockReturnValue(pending.promise);
    const { view, changed } = start();await fill();await userEvent.setup().click(screen.getByRole('button', { name: '记下' }));
    view.rerender(<Controller actor="another-judge" changed={changed} />);expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue('');
    await fill();await act(async () => pending.resolve({ records: [RECORD], failed: [] }));
    expect(changed).not.toHaveBeenCalled();expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
    await waitFor(() => expect(stored()).toMatchObject({ picked: ['a'], claim: CLAIM }));
  });
  it('does not flush an old actor draft on unmount after storage was cleared for logout', async () => {
    const { view } = start();await fill();localStorage.clear();view.unmount();expect(localStorage.getItem('edg.draft.case')).toBeNull();
  });
  it('adopts a legacy current-user draft but excludes a known different actor draft', () => {
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });const { view } = start();
    expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
    view.unmount();writeDraft('case', 'owner', 'another-actor');
    render(<Controller />);expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue('');
  });
  it('does not restore or persist an unowned draft when the actor marker cannot be stored', async () => {
    writeDraft('case', undefined, { picked: ['a'], claim: '另一个会话留下的私密内容。', extras: {} });
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'edg.draft.case.owner') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    const { view } = start();expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue('');
    await fill();view.unmount();expect(stored()).toBeUndefined();
  });
  it('can restore a draft whose existing actor marker is valid when storage writes become unavailable', () => {
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });writeDraft('case', 'owner', 'judge');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    start();expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
  });
});
