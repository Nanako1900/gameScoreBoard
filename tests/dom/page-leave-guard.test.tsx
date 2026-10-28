import { StrictMode, useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmInline } from '../../src/components/ConfirmInline';
import { Modal } from '../../src/components/Modal';
import {
  bootRouter, currentPath, goBack, navigate, registerNavigationGuard,
  requestNavigation, useLocation,
} from '../../src/lib/router';
import { usePageLeaveGuard } from '../../src/lib/usePageLeaveGuard';
import { drainHistoryTraversals, entryIdx } from './history';

const QUESTION = '还有未保存的修改';
let unmounts = 0;
const departed = vi.fn();

function Editor(): JSX.Element {
  const [text, setText] = useState('');
  const [overlay, setOverlay] = useState(false);
  const guard = usePageLeaveGuard(text.length > 0);
  useEffect(() => () => { unmounts += 1; }, []);
  return <section>
    <label>编辑内容<input value={text} onChange={(event) => setText(event.target.value)} /></label>
    <button onClick={() => navigate('/board')}>离开到榜单</button>
    <button onClick={() => navigate('/settings/profile')}>当前页面</button>
    <button onClick={() => goBack()}>页面返回</button>
    <button onClick={() => requestNavigation(departed)}>退出</button>
    <button onClick={() => setText('')}>保存</button>
    <button onClick={() => setOverlay(true)}>打开真实弹窗</button>
    {guard.confirming && <ConfirmInline question={QUESTION} cancelLabel="继续编辑" confirmLabel="放弃修改并离开"
      onCancel={guard.stay} onConfirm={guard.leave} />}
    <Modal open={overlay} onClose={() => setOverlay(false)} labelledBy="nested-guard-title" historyKey="guard-nested">
      <h2 id="nested-guard-title">嵌套浮层</h2>
    </Modal>
  </section>;
}
function Frame(): JSX.Element {
  const location = useLocation();
  const [tick, setTick] = useState(0);
  return <><p data-testid="path">{location.pathname}{location.search}</p><span>{tick}</span>
    <button onClick={() => setTick((value) => value + 1)}>重渲染外壳</button>
    {location.route.name === 'settings' ? <Editor /> : <p>其他页面</p>}
  </>;
}
function start(strict = false): void {
  bootRouter();
  act(() => navigate('/board'));
  act(() => navigate('/settings/profile'));
  render(strict ? <StrictMode><Frame /></StrictMode> : <Frame />);
  unmounts = 0;
}
async function edit(): Promise<void> {
  await userEvent.setup().type(screen.getByRole('textbox', { name: '编辑内容' }), '正在编辑的内容');
}
async function traverse(delta: number): Promise<void> {
  await act(async () => { window.history.go(delta); await drainHistoryTraversals(); });
}
async function expectConfirmation(): Promise<void> {
  await screen.findByRole('group', { name: QUESTION });
  await waitFor(() => expect(window.location.pathname).toBe('/settings/profile'));
  expect(screen.getByRole('textbox', { name: '编辑内容' })).toHaveValue('正在编辑的内容');
}
afterEach(() => { vi.restoreAllMocks(); departed.mockReset(); });

describe('page leave guard', () => {
  it('does not add history entries when editing, and leaves clean navigation unchanged', async () => {
    start(); const before = window.history.length;
    await edit(); expect(window.history.length).toBe(before);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '离开到榜单' }));
    expect(window.location.pathname).toBe('/board');
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
  });
  it('stops navigation until confirmed, keeps the first target, and executes it once', async () => {
    start(); await edit(); const index = entryIdx(), length = window.history.length;
    act(() => { navigate('/board'); navigate('/guide'); });
    await expectConfirmation(); expect(entryIdx()).toBe(index); expect(window.history.length).toBe(length);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(window.location.pathname).toBe('/board'); expect(entryIdx()).toBe(index + 1);
    expect(window.history.length).toBe(length + 1);
    await traverse(-1); expect(window.location.pathname).toBe('/settings/profile');
  });
  it('continuing to edit keeps fields, address and index; a later attempt asks again', async () => {
    start(); await edit(); const index = entryIdx();
    await userEvent.setup().click(screen.getByRole('button', { name: '离开到榜单' }));
    await expectConfirmation(); await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    expect(entryIdx()).toBe(index); expect(screen.getByRole('textbox', { name: '编辑内容' })).toHaveValue('正在编辑的内容');
    await userEvent.setup().click(screen.getByRole('button', { name: '离开到榜单' }));
    await expectConfirmation();
  });
  it('does not ask for a navigation to the address already shown', async () => {
    start(); await edit(); await userEvent.setup().click(screen.getByRole('button', { name: '当前页面' }));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
  });
  it('retains an explicit same-address replacement without treating it as a departure', async () => {
    start(); await edit();const index = entryIdx(), length = window.history.length;
    window.history.replaceState({ edg: 1, idx: index, sheet: 'stale', layer: 99 }, '', '/settings/profile');
    act(() => navigate('/settings/profile', { replace: true }));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(window.history.state).toEqual({ edg: 1, idx: index });expect(window.history.length).toBe(length);
  });
  it('page goBack waits for confirmation and returns to the actual preceding entry', async () => {
    start(); await edit(); const index = entryIdx();
    await userEvent.setup().click(screen.getByRole('button', { name: '页面返回' }));
    await expectConfirmation(); expect(entryIdx()).toBe(index);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/board')); expect(entryIdx()).toBe(index - 1);
  });
  it('restores a browser Back before asking, without unmounting the editor', async () => {
    start(); await edit(); const index = entryIdx(), length = window.history.length;
    await traverse(-1); await expectConfirmation(); expect(entryIdx()).toBe(index); expect(unmounts).toBe(0);
    await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    expect(window.history.length).toBe(length);
    await traverse(-1); await expectConfirmation();
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/board')); expect(entryIdx()).toBe(index - 1);
  });
  it('restores multi-entry browser traversal and replays the exact original target once', async () => {
    start(); await edit(); const index = entryIdx(), length = window.history.length;
    await traverse(-2); await expectConfirmation(); expect(entryIdx()).toBe(index); expect(unmounts).toBe(0);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/')); expect(entryIdx()).toBe(index - 2); expect(window.history.length).toBe(length);
  });
  it('preserves forward history when Forward is cancelled', async () => {
    start(); act(() => navigate('/guide')); await traverse(-1); await edit();
    const index = entryIdx(), length = window.history.length;
    await traverse(1); await expectConfirmation();
    await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    expect(entryIdx()).toBe(index); expect(window.history.length).toBe(length);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    await traverse(1); expect(window.location.pathname).toBe('/guide'); expect(entryIdx()).toBe(index + 1);
  });
  it('keeps the first browser target when another traversal happens during confirmation', async () => {
    start(); await edit(); const index = entryIdx(), length = window.history.length;
    await traverse(-1); await expectConfirmation();
    await traverse(-2); await expectConfirmation();
    expect(entryIdx()).toBe(index); expect(window.history.length).toBe(length); expect(unmounts).toBe(0);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/board')); expect(entryIdx()).toBe(index - 1);
  });
  it('restores focus to the navigation trigger after continuing to edit', async () => {
    start(); await edit(); const trigger = screen.getByRole('button', { name: '离开到榜单' });
    await userEvent.setup().click(trigger); await expectConfirmation();
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();
    await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    expect(trigger).toHaveFocus();
  });
  it('freezes the logical snapshot during restoration even if another render happens', async () => {
    start(); await edit(); const restore = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    const origin = window.history.state;
    // Browser is between the target pop and the restoring pop. The route store must stay at the editor.
    window.history.replaceState({ edg: 1, idx: origin.idx - 1 }, '', '/board');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    expect(restore).toHaveBeenCalledWith(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '重渲染外壳' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/settings/profile'); expect(unmounts).toBe(0);
    expect(currentPath()).toBe('/settings/profile');
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    window.history.replaceState(origin, '', '/settings/profile');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: origin })));
    await expectConfirmation();
  });
  it('closes a real top overlay first, then asks before leaving the dirty page', async () => {
    start(); await edit(); await userEvent.setup().click(screen.getByRole('button', { name: '打开真实弹窗' }));
    expect(screen.getByRole('dialog', { name: '嵌套浮层' })).toBeInTheDocument();
    await traverse(-1); expect(screen.queryByRole('dialog', { name: '嵌套浮层' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    await traverse(-1); await expectConfirmation();
  });
  it('closes skipped overlays before asking about a multi-entry traversal out of the page', async () => {
    start();await edit();const pageIndex = entryIdx(), length = window.history.length;
    await userEvent.setup().click(screen.getByRole('button', { name: '打开真实弹窗' }));
    await traverse(-2);await expectConfirmation();
    expect(screen.queryByRole('dialog', { name: '嵌套浮层' })).not.toBeInTheDocument();
    expect(entryIdx()).toBe(pageIndex);expect(window.history.length).toBe(length + 1);
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/board'));
  });
  it('uses the restored page index when a departure was queued behind a closing overlay', async () => {
    start();await edit();const original = window.history.state;
    await userEvent.setup().click(screen.getByRole('button', { name: '打开真实弹窗' }));
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '关闭' }));await Promise.resolve(); });
    expect(go).toHaveBeenCalledWith(-1);
    act(() => navigate('/guide'));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    window.history.replaceState(original, '', '/settings/profile');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: original })));
    await expectConfirmation();await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    go.mockClear();
    window.history.replaceState({ edg: 1, idx: original.idx - 1 }, '', '/board');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    expect(go).toHaveBeenCalledWith(1);
  });
  it('guards external departure actions and ignores repeated confirmations', async () => {
    start(); await edit(); await userEvent.setup().click(screen.getByRole('button', { name: '退出' }));
    await expectConfirmation(); act(() => requestNavigation(() => departed('later')));
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(departed).toHaveBeenCalledTimes(1); expect(departed).toHaveBeenCalledWith();
  });
  it('beforeunload protects only dirty edits and is removed after a successful save', async () => {
    start();
    const clean = new Event('beforeunload', { cancelable: true });window.dispatchEvent(clean);expect(clean.defaultPrevented).toBe(false);
    await edit();const dirty = new Event('beforeunload', { cancelable: true });window.dispatchEvent(dirty);expect(dirty.defaultPrevented).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    const saved = new Event('beforeunload', { cancelable: true });window.dispatchEvent(saved);expect(saved.defaultPrevented).toBe(false);
  });
  it('StrictMode leaves no duplicate guards, and unmount cancels an outstanding continuation', async () => {
    start(true); await edit(); const length = window.history.length;
    await userEvent.setup().click(screen.getByRole('button', { name: '离开到榜单' }));await expectConfirmation();
    expect(window.history.length).toBe(length);
    // A role/account boundary can remove the guard while the confirmation is open.
    act(() => requestNavigation(() => departed()));
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }));
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(departed).not.toHaveBeenCalled(); expect(window.location.pathname).toBe('/settings/profile');
  });
  it('disposing a registered guard invalidates an already captured continuation', () => {
    bootRouter(); let attempt: { proceed(): void; cancel(): void } | undefined;
    const dispose = registerNavigationGuard((next) => { attempt = next; });
    requestNavigation(departed); expect(attempt).toBeDefined();dispose();attempt!.proceed();expect(departed).not.toHaveBeenCalled();
  });
  it('runs the discard callback before the confirmed action and bypasses its beforeunload', async () => {
    const calls: string[] = [];
    function WithDiscard(): JSX.Element {
      const guard = usePageLeaveGuard(true, { onLeave: () => calls.push('discard') });
      return <><button onClick={() => requestNavigation(() => {
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false); calls.push('depart');
      })}>离开</button>{guard.confirming && <button onClick={guard.leave}>确认离开</button>}</>;
    }
    bootRouter();render(<WithDiscard />);
    await userEvent.setup().click(screen.getByRole('button', { name: '离开' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '确认离开' }));
    expect(calls).toEqual(['discard', 'depart']);
  });
  it('unmounting during restoration cancels the pending departure without reviving the old editor', async () => {
    bootRouter();act(() => navigate('/settings/profile'));
    const view = render(<Frame />);await edit();
    const origin = window.history.state;
    vi.spyOn(window.history, 'go').mockImplementation(() => {});
    window.history.replaceState({ edg: 1, idx: origin.idx - 1 }, '', '/');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    view.unmount();
    window.history.replaceState(origin, '', '/settings/profile');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: origin })));
    expect(screen.queryByRole('textbox', { name: '编辑内容' })).not.toBeInTheDocument();
    act(() => requestNavigation(departed));expect(departed).toHaveBeenCalledOnce();
  });
});
