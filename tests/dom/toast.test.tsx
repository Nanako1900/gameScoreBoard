import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast, type ToastApi, type ToastOptions } from '../../src/components/Toast';

// P0-3: the Toast and useUndo primitives (spec §6.4).

let api: ToastApi | null = null;

function Probe(): null {
  api = useToast();
  return null;
}

function show(options: ToastOptions): number {
  let id = 0;
  act(() => {
    id = api?.show(options) ?? 0;
  });
  return id;
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  api = null;
});

describe('Toast', () => {
  it('without a provider: a no-op that returns -1 and renders nothing', () => {
    render(<Probe />);
    expect(api?.show({ message: '已改成：不来' })).toBe(-1);
    expect(document.querySelector('.toasts')).toBeNull();
  });

  it('lives in <body>, outside #root, as one polite status region — never an alert', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
      { container: root },
    );
    show({ message: '没成功', tone: 'error' });
    const region = document.querySelector('.toasts');
    expect(region?.parentElement).toBe(document.body);
    expect(root.contains(region)).toBe(false);
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    root.remove();
  });

  it('a plain toast goes after 5 s', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    show({ message: '这局已取消。' });
    advance(4_999);
    expect(screen.getByText('这局已取消。')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('这局已取消。')).not.toBeInTheDocument();
  });

  it('a toast with an action stays at least 8 s, even when asked for less', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    show({ message: '已改成：不来', durationMs: 1_000, action: { label: '撤销', onAction: () => undefined } });
    advance(7_999);
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('已改成：不来')).not.toBeInTheDocument();
  });

  it('pauses while hovered and resumes with the time that was left', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    show({ message: '已回复：来。开局前想改随时改。' });
    advance(3_000);
    const card = screen.getByText('已回复：来。开局前想改随时改。').closest('.toast') as HTMLElement;
    fireEvent.mouseEnter(card);
    advance(10_000);
    expect(card).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    advance(1_999);
    expect(card).toBeInTheDocument();
    advance(1);
    expect(card).not.toBeInTheDocument();
  });

  it('pauses while focus is inside it', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    show({ message: '已改成：待定', action: { label: '撤销', onAction: () => undefined } });
    act(() => screen.getByRole('button', { name: '撤销' }).focus());
    advance(20_000);
    expect(screen.getByText('已改成：待定')).toBeInTheDocument();
  });

  it('the action runs once and closes the toast; 关闭通知 closes it too', () => {
    const onAction = vi.fn();
    render(<ToastProvider><Probe /></ToastProvider>);
    show({ message: '已改成：不来', action: { label: '撤销', onAction } });
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已改成：不来')).not.toBeInTheDocument();
    show({ message: '这局已取消。' });
    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByText('这局已取消。')).not.toBeInTheDocument();
  });

  it('shows at most three, newest last', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    ['一', '二', '三', '四'].forEach((message) => show({ message }));
    const texts = [...document.querySelectorAll('.toast__msg')].map((el) => el.textContent);
    expect(texts).toEqual(['二', '三', '四']);
  });

  it('an empty message shows nothing', () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    expect(show({ message: '   ' })).toBe(-1);
    expect(document.querySelectorAll('.toast')).toHaveLength(0);
  });
});
