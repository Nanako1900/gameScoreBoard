import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftNote } from '../../src/components/DraftNote';
import { clearAllDrafts, draftKey, readDraft, writeDraft } from '../../src/lib/drafts';
import { isBlankText, validateStatementDraft } from '../../src/lib/draftShapes';
import { useDraft } from '../../src/lib/useDraft';

// Six local drafts (spec §5 #4): what is typed survives a closed dialog, a
// reload and the Discord round trip, and is gone after a successful submit or
// a logout. tests/dom/setup.ts empties both storages after every test.

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

/** The value a draft holds in storage, or null. */
function stored(storage: Storage, key: string): unknown {
  const raw = storage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as { value: unknown }).value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('draft storage', () => {
  it('keys drafts edg.draft.<kind>[.<id>]', () => {
    expect(draftKey('statement', 12)).toBe('edg.draft.statement.12');
    expect(draftKey('case')).toBe('edg.draft.case');
  });

  it('keeps the first-run choice in sessionStorage and the rest in localStorage', () => {
    expect(writeDraft('onboarding', undefined, { choice: 'participant' })).toBe(true);
    expect(writeDraft('appeal', 3, '我在医院')).toBe(true);
    expect(sessionStorage.getItem('edg.draft.onboarding')).not.toBeNull();
    expect(localStorage.getItem('edg.draft.onboarding')).toBeNull();
    expect(stored(localStorage, 'edg.draft.appeal.3')).toBe('我在医院');
  });

  it('drops an entry that does not parse or no longer fits, instead of trusting it', () => {
    localStorage.setItem('edg.draft.statement.1', '{not json');
    localStorage.setItem('edg.draft.statement.2', JSON.stringify({ v: 1, savedAt: 1, value: 42 }));
    expect(readDraft('statement', 1, validateStatementDraft)).toBeNull();
    expect(readDraft('statement', 2, validateStatementDraft)).toBeNull();
    expect(localStorage.getItem('edg.draft.statement.1')).toBeNull();
    expect(localStorage.getItem('edg.draft.statement.2')).toBeNull();
  });

  it('clears every draft from both storages, and nothing else', () => {
    writeDraft('statement', 1, '说明');
    writeDraft('onboarding', undefined, { choice: 'judge' });
    localStorage.setItem('edg.welcome.dismissed', '1');
    clearAllDrafts();
    expect(localStorage.getItem('edg.draft.statement.1')).toBeNull();
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
    expect(localStorage.getItem('edg.welcome.dismissed')).toBe('1');
  });

  it('reports a write that storage refused', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      expect(writeDraft('statement', 1, '说明')).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });
});

function Harness({ id }: { id: number }): JSX.Element {
  const draft = useDraft<string>('statement', id, '', { validate: validateStatementDraft, isEmpty: isBlankText });
  return (
    <>
      <textarea aria-label="说明" value={draft.value} onChange={(e) => draft.setValue(e.target.value)} />
      <DraftNote savedAt={draft.savedAt} length={draft.value.trim().length} onClear={draft.clear} />
      <span data-testid="flags">{`${draft.restored ? 'restored' : 'fresh'} ${draft.dirty ? 'dirty' : 'clean'}`}</span>
    </>
  );
}

describe('useDraft', () => {
  it('saves after a pause and brings it back next time', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness id={1} />);
    await user.type(screen.getByRole('textbox', { name: '说明' }), '家里有事');
    await waitFor(() => expect(stored(localStorage, 'edg.draft.statement.1')).toBe('家里有事'));
    expect(screen.getByText('草稿已存在这台设备 · 写了 4 字')).toBeInTheDocument();
    unmount();

    render(<Harness id={1} />);
    expect(screen.getByRole('textbox', { name: '说明' })).toHaveValue('家里有事');
    expect(screen.getByTestId('flags')).toHaveTextContent('restored dirty');
  });

  it('keeps the last keystrokes when the form goes away before the pause is over', () => {
    // Frozen clock and a synchronous change event: the debounce can never fire
    // here, so only the unmount flush can have written the draft. (Not
    // user-event: under plain fake timers RTL's asyncWrapper waits on a
    // setTimeout(0) nobody advances — it only knows Jest's fake timers.)
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Harness id={2} />);
      fireEvent.change(screen.getByRole('textbox', { name: '说明' }), { target: { value: '网络断了' } });
      expect(localStorage.getItem('edg.draft.statement.2')).toBeNull(); // still inside the debounce
      unmount();
      expect(stored(localStorage, 'edg.draft.statement.2')).toBe('网络断了');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the key when the text is emptied, and 清空 resets the field', async () => {
    const user = userEvent.setup();
    render(<Harness id={3} />);
    const box = screen.getByRole('textbox', { name: '说明' });
    await user.type(box, '有');
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).not.toBeNull());
    await user.clear(box);
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).toBeNull());

    await user.type(box, '再写');
    await waitFor(() => expect(localStorage.getItem('edg.draft.statement.3')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: '清空' }));
    expect(box).toHaveValue('');
    expect(localStorage.getItem('edg.draft.statement.3')).toBeNull();
    expect(screen.queryByText(/草稿已存在这台设备/)).not.toBeInTheDocument();
  });
});
