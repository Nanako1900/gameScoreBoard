import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quickSlots } from '@shared/quickTime';
import { CaseDialog } from '../../src/components/CaseDialog';
import { DraftNote } from '../../src/components/DraftNote';
import { SessionFormDialog } from '../../src/components/SessionFormDialog';
import { StatementDialog } from '../../src/components/StatementDialog';
import { clearAllDrafts, draftKey, readDraft, writeDraft } from '../../src/lib/drafts';
import { isBlankText, validateStatementDraft } from '../../src/lib/draftShapes';
import { useDraft } from '../../src/lib/useDraft';
import type { Config, PublicUser, RecordItem, SessionDetail } from '../../src/types';

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

const HOUR = 3_600_000;
const sqlTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: '2030-01-06T16:00:00.000Z',
};

function openCase(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 12,
    subject: { id: 'me', username: '我', avatar_url: null },
    reporter: { id: 'j', username: '阿飞', avatar_url: null },
    type: 'late_major',
    delta: 0,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: sqlTime(Date.now() + 5 * HOUR),
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -9, max: -3, base: -6 },
    created_at: sqlTime(Date.now() - HOUR),
    redacted: false,
    ...over,
  };
}

const decided = (over: Partial<RecordItem> = {}): RecordItem =>
  openCase({
    status: 'decided',
    delta: -6,
    statement: '家里临时有事',
    statement_at: sqlTime(Date.now()),
    deadline_at: null,
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    ...over,
  });

describe('StatementDialog — draft, confirm, verdict', () => {
  function renderStatement(onClose = vi.fn(), onDecided = vi.fn()) {
    render(<StatementDialog open record={openCase()} config={CONFIG} onClose={onClose} onDecided={onDecided} score={88} />);
    return { onClose, onDecided };
  }

  it('restores a draft and asks before leaving with it', async () => {
    writeDraft('statement', 12, '家里临时有事');
    const user = userEvent.setup();
    const { onClose } = renderStatement();
    expect(screen.getByRole('textbox', { name: /你的说明/ })).toHaveValue('家里临时有事');
    expect(screen.getByText('草稿已存在这台设备 · 写了 6 字')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '还没提交的说明会留在这台设备上，下次回来接着写。' });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(within(leave).getByRole('button', { name: '继续写' }));
    expect(screen.getByRole('button', { name: '稍后再说' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '稍后再说' }));
    await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stored(localStorage, 'edg.draft.statement.12')).toBe('家里临时有事');
  });

  it('refuses an empty statement without asking anything', async () => {
    const user = userEvent.setup();
    renderStatement();
    await user.click(screen.getByRole('button', { name: '提交说明' }));
    expect(screen.getByRole('alert')).toHaveTextContent('说点什么吧，哪怕一句');
    expect(screen.queryByRole('group', { name: '确认提交？交了就不能改。' })).not.toBeInTheDocument();
  });

  it('confirms before submitting, then shows the verdict with the way back', async () => {
    const calls = mockFetch({ 'POST /api/records/12/statement': () => json(200, { record: decided() }) });
    writeDraft('statement', 12, '家里临时有事');
    const user = userEvent.setup();
    const { onDecided } = renderStatement();

    await user.click(screen.getByRole('button', { name: '提交说明' }));
    const confirm = screen.getByRole('group', { name: '确认提交？交了就不能改。' });
    expect(within(confirm).getByRole('button', { name: '再看看' })).toHaveFocus();
    expect(calls).toEqual([]);

    await user.click(within(confirm).getByRole('button', { name: '确认提交' }));
    expect(await screen.findByRole('heading', { name: '裁决结果' })).toBeInTheDocument();
    expect(calls).toEqual([{ method: 'POST', path: '/api/records/12/statement', body: { statement: '家里临时有事' } }]);
    // 88 − 6 = 82, then + weeklyHeal (5 in this config, not 15) = 87.
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    expect(localStorage.getItem('edg.draft.statement.12')).toBeNull();
    expect(onDecided).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '觉得不公平？可以申诉' }));
    expect(await screen.findByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
  });
});

const JUDGE: PublicUser = { id: 'j', username: '裁判', avatar_url: null, is_participant: true, is_judge: true, score: 100, created_at: 'x' };
const PEOPLE: PublicUser[] = [
  JUDGE,
  { ...JUDGE, id: 'a', username: '甲', is_judge: false, score: 90 },
  { ...JUDGE, id: 'b', username: '乙', is_judge: false, score: 80 },
];
const CLAIM = '说好八点五排，等到八点四十还没上线，最后四缺一散了。';

describe('CaseDialog — draft', () => {
  function renderCase(onClose = vi.fn(), onCreated = vi.fn()) {
    render(<CaseDialog open onClose={onClose} participants={PEOPLE} selfId="j" config={CONFIG} onCreated={onCreated} />);
    return { onClose, onCreated };
  }

  it('restores only people who can still be picked', () => {
    writeDraft('case', undefined, { picked: ['a', 'gone'], claim: CLAIM, extras: { gone: '早走了' } });
    renderCase();
    expect(screen.getByRole('checkbox', { name: /甲/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /乙/ })).not.toBeChecked();
    expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue(CLAIM);
    expect(screen.getByText('草稿已存在这台设备')).toBeInTheDocument();
  });

  it('asks before leaving, and leaving submits nothing', async () => {
    const calls = mockFetch({});
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });
    const user = userEvent.setup();
    const { onClose } = renderCase();

    await user.click(screen.getByRole('button', { name: '取消' }));
    const leave = screen.getByRole('group', { name: '这笔还没提交，写的内容会留在这台设备上。' });
    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
    expect(stored(localStorage, 'edg.draft.case')).toMatchObject({ picked: ['a'] });
  });

  it('keeps only the people who were not filed after a partial success', async () => {
    mockFetch({
      'POST /api/records': () =>
        json(200, {
          records: [decided({ id: 30, subject: { id: 'a', username: '甲', avatar_url: null } })],
          failed: [{ subject_id: 'b', error: '今天已经记过了' }],
        }),
    });
    writeDraft('case', undefined, { picked: ['a', 'b'], claim: CLAIM, extras: { a: '甲的补充', b: '乙的补充' } });
    const user = userEvent.setup();
    renderCase();

    await user.click(screen.getByRole('button', { name: '记下（2 人）' }));
    expect(await screen.findByText(/其中 1 人没记上/)).toBeInTheDocument();
    await waitFor(() =>
      expect(stored(localStorage, 'edg.draft.case')).toEqual({ picked: ['b'], claim: CLAIM, extras: { b: '乙的补充' } }),
    );
  });

  it('forgets the draft once every case is filed', async () => {
    mockFetch({ 'POST /api/records': () => json(200, { records: [decided({ id: 30 })], failed: [] }) });
    writeDraft('case', undefined, { picked: ['a'], claim: CLAIM, extras: {} });
    const user = userEvent.setup();
    const { onClose, onCreated } = renderCase();

    await user.click(screen.getByRole('button', { name: '记下' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('edg.draft.case')).toBeNull();
  });
});

function aSession(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'me', username: '我', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: '2030-01-04T12:00:00.000Z',
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-01 00:00:00',
    counts: { invited: 1, going: 1, maybe: 0, out: 0 },
    my_rsvp: 'going',
    players: [],
    ...over,
  };
}

describe('SessionFormDialog — draft', () => {
  const FRIENDS: PublicUser[] = [{ ...JUDGE, id: 'me', username: '我' }, { ...JUDGE, id: 'b', username: '乙' }];

  it('restores the people picked, and says how many stay when leaving', async () => {
    writeDraft('session', undefined, { invite: ['b', 'gone'], custom: '', chosen: null });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={onClose} onCreated={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /乙/ })).toBeChecked();

    await user.keyboard('{Escape}');
    const leave = screen.getByRole('group', { name: '这局还没约，已选的 1 个人会留在这台设备上。' });
    expect(within(leave).getByRole('button', { name: '继续编辑' })).toHaveFocus();
    await user.click(within(leave).getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('edg.draft.session')).not.toBeNull();
  });

  it('comes back on the quick slot that was picked, not on 其他时间 looked at before', () => {
    // A Monday noon (local): several quick slots are on offer, so the second one is not the default.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2030, 0, 7, 12, 0));
    try {
      const slot = quickSlots()[1];
      writeDraft('session', undefined, { invite: ['b'], custom: '2030-01-09T20:00', chosen: slot.iso });
      render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={() => {}} onCreated={() => {}} />);
      expect(screen.getByRole('radio', { name: slot.label })).toBeChecked();
      expect(screen.queryByLabelText('自定义开始时间')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets the draft once the session exists', async () => {
    const calls = mockFetch({ 'POST /api/sessions': () => json(200, { session: aSession() }) });
    writeDraft('session', undefined, { invite: ['b'], custom: '2030-01-04T20:00', chosen: null });
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<SessionFormDialog open participants={FRIENDS} selfId="me" onClose={() => {}} onCreated={onCreated} />);

    await user.click(screen.getByRole('button', { name: '约！（叫 1 人）' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/sessions', body: { invite: ['b'] } });
    expect(localStorage.getItem('edg.draft.session')).toBeNull();
  });
});
