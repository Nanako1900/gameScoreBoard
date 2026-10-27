import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from '../../src/components/Modal';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import { drainHistoryTraversals, entryIdx, overlayMarks } from './history';

// P1-2 (spec §2.2): overlays live in the session history. The back button
// closes only the top layer; a UI close walks back over the entry; a fresh tab
// on a deep address gets one `/` underneath, once; a reload never reopens an
// overlay and never grows the history.

/** The browser's back button. The popstate's re-render happens inside act. */
async function pressBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await drainHistoryTraversals();
  });
}

/** Let a UI close's silent back land (no React work comes of it, but keep it in act). */
async function settleHistory(): Promise<void> {
  await act(async () => {
    await drainHistoryTraversals();
  });
}

/** Subscribes to the router like App does, and shows where it is. */
function Where(): JSX.Element {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entering and reloading', () => {
  it('a fresh tab on a deep address gets one `/` underneath, and a reload adds nothing', async () => {
    // Arriving from an outside link: an entry the router did not write, last in the list.
    window.history.pushState(null, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    simulateReloadForTests();
    bootRouter();
    simulateReloadForTests();
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    render(<Where />);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('`/` itself is only stamped, never padded', () => {
    window.history.pushState(null, '', '/?utm=dc');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.search).toBe('?utm=dc');
    expect(window.history.state).toMatchObject({ edg: 1 });
  });

  it('a reload with a sheet open drops its marks and keeps the rest', () => {
    window.history.pushState({ edg: 1, idx: 2, sheet: 'reschedule', layer: 4, y: 120 }, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/sessions/5');
    expect(window.history.state).toEqual({ edg: 1, idx: 2, y: 120 });
  });
});

describe('scroll restoration', () => {
  it('going back to an address scrolls to where the user left it', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    window.history.replaceState(null, '', '/');
    bootRouter();
    render(<Where />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });
});

// ---------------------------------------------------------------- overlays (P1-2 Modal historyKey)

/** A dialog with a sheet on top of it, both in history. */
function TwoLayers(): JSX.Element {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <Where />
      <button type="button" onClick={() => setOuter(true)}>
        打开外层
      </button>
      <Modal open={outer} onClose={() => setOuter(false)} labelledBy="outer-title" historyKey="outer">
        <h2 id="outer-title">外层</h2>
        <button type="button" onClick={() => setInner(true)}>
          打开内层
        </button>
        <Modal
          open={inner}
          onClose={() => setInner(false)}
          labelledBy="inner-title"
          variant="sheet"
          title="内层"
          historyKey="inner"
        >
          <p>内层内容</p>
        </Modal>
      </Modal>
    </>
  );
}

/** `/` as a fresh tab: stamped, nothing behind it. Returns its idx to compare with later. */
function stampHome(): number {
  window.history.replaceState(null, '', '/');
  bootRouter();
  return entryIdx();
}

describe('the back button and overlays', () => {
  it('closes only the top layer, then the next one', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(overlayMarks().sheet).toBe('inner');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '内层' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
    expect(overlayMarks().sheet).toBe('outer');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    expect(entryIdx()).toBe(before);
    expect(window.location.pathname).toBe('/');
  });

  it('a UI close is synchronous and leaves the history where it was before the open', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    expect(entryIdx()).toBe(before + 1);

    await user.keyboard('{Escape}');
    // Closed at once — not after a popstate (organizer-actions, appeal-sheet, modal-focus rely on it).
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    await settleHistory();
    expect(entryIdx()).toBe(before);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });

    // ✕ works the same way, and nothing is left behind for a later back press.
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('closing both layers from the UI walks back over both entries', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(entryIdx()).toBe(before + 2);
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('StrictMode: one open is one entry', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(
      <StrictMode>
        <TwoLayers />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(entryIdx()).toBe(before);
  });

  it('a navigation right after a UI close waits for the silent back, so the overlay entry is gone', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.keyboard('{Escape}');
    act(() => navigate('/sessions/5'));
    await settleHistory();
    expect(window.location.pathname).toBe('/sessions/5');
    expect(entryIdx()).toBe(before + 1);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('a navigation from inside an overlay uses its entry up instead of stacking on it', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    await user.keyboard('{Escape}');
    await settleHistory();
    // No silent back: it would have undone the navigation.
    expect(window.location.pathname).toBe('/sessions/5');
    await pressBack();
    expect(window.location.pathname).toBe('/');
  });

  it('the scroll under an overlay survives a navigation from inside it', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, 'scrollTo');
    stampHome();
    render(<TwoLayers />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await user.keyboard('{Escape}');
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });

  it('a hash-only change closes nothing', async () => {
    const user = userEvent.setup();
    stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await act(async () => {
      window.location.hash = '#x';
      await drainHistoryTraversals();
    });
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
  });

  it('a reload with an overlay open does not reopen it', () => {
    window.history.pushState({ edg: 1, idx: 1, sheet: 'outer', layer: 1 }, '', '/');
    bootRouter();
    render(<TwoLayers />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
  });
});
