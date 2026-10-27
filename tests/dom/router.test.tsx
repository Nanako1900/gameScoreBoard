import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link } from '../../src/components/Link';
import { bootRouter, currentPath, goBack, navigate, useLocation, useRoute } from '../../src/lib/router';

// P1-1: src/lib/router.ts and <Link>. tests/dom/setup.ts resets the router
// (and the address) after every test.

function RouteName(): JSX.Element {
  const route = useRoute();
  const { search } = useLocation();
  return (
    <p data-testid="route">
      {route.name}
      {search}
    </p>
  );
}

const routeText = (): string | null => screen.getByTestId('route').textContent;

/** A link's default action must never reach jsdom (it cannot navigate). Records whether anyone stopped it first. */
function stopDocumentNavigation(): { prevented: () => boolean; restore: () => void } {
  let prevented = false;
  const onClick = (event: MouseEvent): void => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', onClick);
  return { prevented: () => prevented, restore: () => document.removeEventListener('click', onClick) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('navigate', () => {
  it('pushes a marked entry and tells the subscribers', () => {
    bootRouter();
    render(<RouteName />);
    const before = window.history.length;
    act(() => navigate('/players/p?x=1'));
    expect(window.location.pathname).toBe('/players/p');
    expect(window.location.search).toBe('?x=1');
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toEqual({ edg: 1, idx: 1 });
    expect(routeText()).toBe('player?x=1');
  });

  it('replaces in place, keeping the index', () => {
    bootRouter();
    render(<RouteName />);
    act(() => navigate('/players/p'));
    const before = window.history.length;
    act(() => navigate('/players/q', { replace: true }));
    expect(window.location.pathname).toBe('/players/q');
    expect(window.history.length).toBe(before);
    expect(window.history.state).toEqual({ edg: 1, idx: 1 });
  });

  it('does not push the address it is already on', () => {
    bootRouter();
    act(() => navigate('/players/p'));
    const before = window.history.length;
    act(() => navigate('/players/p'));
    expect(window.history.length).toBe(before);
  });

  it('scrolls to the top on a push, unless asked to keep the scroll', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    act(() => navigate('/players/p'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    act(() => navigate('/players/q', { keepScroll: true }));
    expect(window.location.pathname).toBe('/players/q');
    act(() => navigate('/players/r', { replace: true }));
    expect(window.location.pathname).toBe('/players/r');
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('refuses anything but an in-app path', () => {
    expect(() => navigate('sessions/5')).toThrow('navigate 只接受站内路径');
    expect(() => navigate('//evil.example/x')).toThrow('navigate 只接受站内路径');
    expect(() => navigate('https://evil.example/')).toThrow('navigate 只接受站内路径');
  });

  it('currentPath is pathname + search', () => {
    act(() => navigate('/players/p?utm=dc'));
    expect(currentPath()).toBe('/players/p?utm=dc');
  });
});

describe('bootRouter', () => {
  it('marks the entry the tab landed on, once', () => {
    // P1-2: `/` is only stamped; a deep address also gets `/` padded under it (back-closes-layer.test.tsx).
    window.history.replaceState(null, '', '/?x=1');
    const before = window.history.length;
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 0 });
    expect(window.location.pathname + window.location.search).toBe('/?x=1');
    window.history.replaceState({ edg: 1, idx: 4 }, '');
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 4 });
    expect(window.history.length).toBe(before);
  });
});

describe('popstate', () => {
  it('re-reads the address on back', async () => {
    bootRouter();
    render(<RouteName />);
    act(() => navigate('/players/p'));
    expect(routeText()).toBe('player');
    window.history.back();
    await waitFor(() => expect(routeText()).toBe('home'));
  });

  it('ignores a popstate that only moved the hash', () => {
    let renders = 0;
    function Counter(): JSX.Element {
      renders += 1;
      return <RouteName />;
    }
    render(<Counter />);
    const before = renders;
    window.history.replaceState(window.history.state, '', '/#x');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    expect(renders).toBe(before);
    expect(routeText()).toBe('home');
  });
});

describe('goBack', () => {
  it('steps back through our own entries', async () => {
    bootRouter();
    act(() => navigate('/players/p'));
    goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('from the entry the tab landed on, replaces with the fallback instead of leaving the site', () => {
    // P1-2: bootRouter pads `/` under a fresh deep entry, so idx 0 on a deep address is set by hand here.
    window.history.replaceState({ edg: 1, idx: 0 }, '', '/players/p');
    const before = window.history.length;
    render(<RouteName />);
    act(() => goBack());
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
    expect(routeText()).toBe('home');
  });
});

describe('<Link>', () => {
  it('is a real link that navigates in place on a plain click', () => {
    bootRouter();
    render(
      <>
        <Link to="/players/p">选手详情</Link>
        <RouteName />
      </>,
    );
    const link = screen.getByRole('link', { name: '选手详情' });
    expect(link).toHaveAttribute('href', '/players/p');
    const guard = stopDocumentNavigation();
    try {
      fireEvent.click(link);
      expect(guard.prevented()).toBe(true);
    } finally {
      guard.restore();
    }
    expect(window.location.pathname).toBe('/players/p');
    expect(routeText()).toBe('player');
  });

  it('leaves modified clicks, other buttons, other targets and API paths to the browser', () => {
    render(
      <>
        <Link to="/players/p">本页</Link>
        <Link to="/sessions/6" target="_blank">
          新标签
        </Link>
        <Link to="/auth/login">登录</Link>
      </>,
    );
    const guard = stopDocumentNavigation();
    try {
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        fireEvent.click(screen.getByRole('link', { name: '本页' }), init);
        expect(guard.prevented(), JSON.stringify(init)).toBe(false);
      }
      fireEvent.click(screen.getByRole('link', { name: '新标签' }));
      expect(guard.prevented()).toBe(false);
      fireEvent.click(screen.getByRole('link', { name: '登录' }));
      expect(guard.prevented()).toBe(false);
    } finally {
      guard.restore();
    }
    expect(window.location.pathname).toBe('/');
  });

  it('runs the caller’s onClick first, and respects its preventDefault', () => {
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(
      <Link to="/players/p" onClick={onClick}>
        选手详情
      </Link>,
    );
    fireEvent.click(screen.getByRole('link', { name: '选手详情' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
  });
});
