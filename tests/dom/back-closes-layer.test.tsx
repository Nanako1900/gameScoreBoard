import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import { drainHistoryTraversals } from './history';

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
