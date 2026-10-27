# P0-6 约局详情里补上改时间、取消确认与 RSVP 反馈 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `SessionDetailDialog` 里给组织者接上「改时间」（嵌套 `RescheduleSheet`，PATCH 前写明影响面）和「取消这局」的原地确认（确认后立即提交），给报名的人加上 RSVP toast / 撤销、两句固定说明和满员提示，`canManage` 判断和两个组件的签名都不变。

**Architecture:** 纯逻辑（改期影响人数、改期后果文案、时段过滤、自定义时间解析、满员判断、RSVP 反馈文案）放进新的纯模块 `src/lib/sessionActions.ts`，用 `tests/unit` 测；改时间是新组件 `RescheduleSheet`（`<Modal variant="sheet" title=…>`，作为 `SessionDetailDialog` 的兄弟节点渲染，靠 P0-2 的 Modal 栈做两层嵌套）；取消确认用 P0-2 的 `ConfirmInline` + `useInlineConfirm`，RSVP 反馈用 P0-3 的 `useToast` + `useUndo`。`SessionDetailDialog.tsx` 内部拆出三个不导出的小组件（`RsvpControls`、`OrganizerActions`、`CancelSessionControl`），不新增文件、不改 `src/api.ts`。

**Tech Stack:** React 18 + TypeScript 5.9、Vitest 3（unit：node；dom：jsdom + Testing Library + user-event）、普通 CSS（P0-1 的 token）、`shared/attendance.ts` / `shared/quickTime.ts`。

**依赖:** 硬依赖 **P0-1、P0-2、P0-3 已合进 main**（契约 §2.2）。消费：P0-1 的 `.btn--danger-outline`、`--fs-*`、`--tap-min`、`--border-input`、`--action`、`--ok`、`--focus`、`--danger-text`、`--muted`（契约 §3.1）；P0-2 的 `Modal` `variant="sheet"` / `title` + 嵌套栈（Esc 只关栈顶、关闭后焦点还原）、`ConfirmInline`、`useInlineConfirm`（契约 §3.2）；P0-3 的 `useToast`（无 provider 时 no-op）、`useUndo`、`src/lib/constants.ts`（契约 §3.3）。提供：契约 §3.6 的 `rescheduleImpact`、`isFull`、`rsvpFeedback`、`RescheduleSheet`（签名照契约），外加 §「对契约的补充」里列的几项。

**分支:** `claude/p0-6-organizer-actions`（P0-1/P0-2/P0-3 都合进 main 之后，从最新 `origin/main` 开）。

---

## 文件结构

| 文件 | 动作 | 唯一职责 |
|---|---|---|
| `src/lib/constants.ts` | 修改（文件末尾追加 `// --- P0-6 ---` 小节） | `RESCHEDULE_DM_DELAY_MIN = 3`（改期私信延迟分钟数，文案用，和 SQL 对齐）、`CUSTOM_TIME_LEAD_MS`（「其他时间」初值提前量，P0-5 的发起约局也用） |
| `src/lib/sessionActions.ts` | 新建 | 纯函数：改期影响人数与后果文案、时段过滤、自定义时间解析、满员判断与提示、RSVP 反馈文案 |
| `src/components/RescheduleSheet.tsx` | 新建 | 改时间底部抽屉：现在的时间（本地时间）、时段单选 + 其他时间、影响面、「先不改 / 改到 X」、PATCH |
| `src/components/reschedule-sheet.css` | 新建 | `.rss` 块样式 |
| `src/components/SessionDetailDialog.tsx` | 修改 | 接上改时间入口、取消原地确认、RSVP toast/撤销、固定说明、满员提示；签名不变 |
| `src/components/session-detail.css` | 修改（只在文件末尾追加） | `.sdt__rsvp-block / -note / -full`、`.sdt__cancel-confirm / -detail` |
| `tests/unit/session-actions.test.ts` | 新建 | `sessionActions.ts` 全部导出 + 常量与 `0005_sessions.sql` 一致 |
| `tests/dom/organizer-actions.test.tsx` | 新建 | RescheduleSheet 单测、对话框里的改时间 / 权限 / 取消确认 / 报名反馈 |
| `tests/dom/session-rsvp-moved.test.tsx` | 只跑，不改 | 签名不变、面板里唯一的「来」、409 alert 原文 |
| `tests/dom/modal-focus.test.tsx` | 只跑，不改 | Modal 行为未被本 PR 影响 |

不碰：`src/api.ts`、`src/App.tsx`、`src/components/SessionsPanel.tsx`、`src/components/Modal.tsx`、`src/theme.css`、`worker/`、`server/`。

---

### Task 0: 开分支并确认依赖已就位

**Files:** 无改动（只读检查）

- [ ] **Step 1: 从最新 origin/main 开分支**

```bash
# 在仓库根目录（package.json 所在的那一层）执行
git fetch origin
git switch -c claude/p0-6-organizer-actions origin/main
```

- [ ] **Step 2: 确认 P0-1/P0-2/P0-3 提供的东西都在**

```bash
test -f src/lib/modalStack.ts && test -f src/components/ConfirmInline.tsx \
  && test -f src/lib/useInlineConfirm.ts && test -f src/components/Toast.tsx \
  && test -f src/lib/useUndo.ts && test -f src/lib/constants.ts && echo deps-ok
grep -n "variant?: ModalVariant" src/components/Modal.tsx
grep -n "title?: React.ReactNode" src/components/Modal.tsx
grep -n "btn--danger-outline" src/theme.css
grep -n "export function useToast" src/components/Toast.tsx
grep -n "export function useUndo" src/lib/useUndo.ts
grep -n "export function useInlineConfirm" src/lib/useInlineConfirm.ts
grep -n "^// --- P0-" src/lib/constants.ts
```

Expected：打印 `deps-ok`，每条 grep 都有命中。任何一条没有 → 依赖还没合，停下，不开工。

- [ ] **Step 3: 确认要改的组件仍是快照里的样子**

```bash
git diff d72e11b -- src/components/SessionDetailDialog.tsx
```

Expected：无输出（契约 §2.4：这个文件只有 P0-6 碰）。下文所有 `SessionDetailDialog.tsx:行号` 都指快照 d72e11b。`session-detail.css` 已被 P0-1 改过（红字换 `--danger-text` 等），本 PR **只在它末尾追加**，不引用它的行号。

- [ ] **Step 4: 跑基线**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
```

Expected：全部通过（数量以 P0-1/2/3 合并后的为准；按推荐顺序应为 unit 18 个文件 / 249 个用例、dom 12 个文件 / 109 个用例）；记下用例数，收尾时对比。

---

### Task 1: 纯模块 `sessionActions.ts` 与改期私信常量

**Files:**
- Modify: `src/lib/constants.ts`（文件末尾追加；如果 P0-3 已经留了 `// --- P0-6 ---` 标题，就写在标题下面、替换掉占位注释）
- Create: `src/lib/sessionActions.ts`
- Test: `tests/unit/session-actions.test.ts`

- [ ] **Step 1: 写失败的测试**

新建 `tests/unit/session-actions.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import { quickSlots } from '@shared/quickTime';
import { RESCHEDULE_DM_DELAY_MIN } from '../../src/lib/constants';
import {
  fullNotice,
  goingClosed,
  isFull,
  parseCustomTime,
  rescheduleConsequences,
  rescheduleImpact,
  rescheduleSlots,
  rsvpFeedback,
} from '../../src/lib/sessionActions';
import { toDateTimeLocalValue } from '../../src/lib/time';
import type { SessionDetail, SessionPlayer } from '../../src/types';

// P0-6: the numbers and copy behind 改时间 / 满员 / RSVP toasts.

const ROOT = path.resolve(__dirname, '../..');

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: id, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: '2026-10-28T13:00:00.000Z',
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 1, going: 2, maybe: 1, out: 1 },
    my_rsvp: null,
    players: [
      player('org', 'going'),
      player('a', 'going'),
      player('b', 'maybe'),
      player('c', 'out'),
      player('d', 'invited'),
    ],
    ...overrides,
  };
}

const FULL = { capacity: 2, counts: { invited: 0, going: 2, maybe: 0, out: 0 } };

describe('rescheduleImpact', () => {
  it('counts going, maybe and out — not the organizer, not the invited', () => {
    expect(rescheduleImpact(session())).toBe(3);
  });

  it('is 0 when only the organizer has answered', () => {
    expect(rescheduleImpact(session({ players: [player('org', 'going'), player('d', 'invited')] }))).toBe(0);
  });
});

describe('rescheduleConsequences', () => {
  it('lists what a move does (spec §3.5)', () => {
    expect(rescheduleConsequences(session())).toEqual([
      '已回复的 3 人要重新确认（说过不来的也要重新回答）',
      '局里每个人约 3 分钟后收到一条「约局改时间了」私信，连改几次也只发一条',
      '开局提醒和点名提醒会跟着改',
    ]);
  });

  it('drops the re-answer line when nobody has answered yet', () => {
    const lines = rescheduleConsequences(session({ players: [player('org', 'going'), player('d', 'invited')] }));
    expect(lines).toHaveLength(2);
    expect(lines.join()).not.toMatch(/重新确认/);
  });

  it('drops the DM line when the organizer is alone in it', () => {
    expect(rescheduleConsequences(session({ players: [player('org', 'going')] }))).toEqual([
      '开局提醒和点名提醒会跟着改',
    ]);
  });
});

describe('rescheduleSlots', () => {
  const slots = quickSlots(new Date(2026, 9, 28, 10, 0));

  it('never offers the time the session already has', () => {
    const current = slots[1];
    const left = rescheduleSlots(slots, current.iso);
    expect(left).toHaveLength(slots.length - 1);
    expect(left.map((s) => s.iso)).not.toContain(current.iso);
  });

  it('keeps every slot for a session at another time', () => {
    expect(rescheduleSlots(slots, new Date(2026, 10, 20, 9, 0).toISOString())).toEqual(slots);
  });
});

describe('parseCustomTime', () => {
  it('reads datetime-local as local wall-clock time and sends UTC', () => {
    const ms = new Date(2026, 9, 30, 20, 30).getTime();
    expect(parseCustomTime(toDateTimeLocalValue(ms))).toEqual({ ok: true, iso: new Date(ms).toISOString() });
  });

  it('asks for a time when it is empty, and refuses garbage', () => {
    expect(parseCustomTime('  ')).toEqual({ ok: false, error: '选一个时间' });
    expect(parseCustomTime('明晚八点')).toEqual({ ok: false, error: '时间格式不对' });
  });
});

describe('isFull / goingClosed / fullNotice', () => {
  it('is never full without a capacity', () => {
    expect(isFull(session({ capacity: null, counts: { invited: 0, going: 9, maybe: 0, out: 0 } }))).toBe(false);
  });

  it('is full once going reaches capacity', () => {
    expect(isFull(session(FULL))).toBe(true);
    expect(isFull(session({ ...FULL, capacity: 3 }))).toBe(false);
  });

  it('closes 来 only for someone not already going', () => {
    expect(goingClosed(session({ ...FULL, my_rsvp: 'maybe' }))).toBe(true);
    expect(goingClosed(session({ ...FULL, my_rsvp: null }))).toBe(true);
    expect(goingClosed(session({ ...FULL, my_rsvp: 'going' }))).toBe(false);
  });

  it('says what to do instead while 来 is closed', () => {
    expect(fullNotice(session({ ...FULL, my_rsvp: 'invited' }))).toBe('来 2/2 满了，可以先报待定。');
    expect(fullNotice(session({ ...FULL, my_rsvp: 'going' }))).toBeNull();
    expect(fullNotice(session())).toBeNull();
  });
});

describe('rsvpFeedback', () => {
  const cases: [Rsvp | null, SelfRsvp, string, boolean][] = [
    [null, 'going', '已回复：来。开局前想改随时改。', false],
    ['invited', 'maybe', '已回复：待定。开局前想改随时改。', false],
    ['invited', 'out', '收到，提前说了点名就不会记你 👍', false],
    ['going', 'out', '收到，提前说了点名就不会记你 👍', true],
    ['maybe', 'going', '已改成：来', true],
    ['out', 'maybe', '已改成：待定', true],
  ];

  it.each(cases)('%s → %s', (prev, next, message, undoable) => {
    expect(rsvpFeedback(prev, next)).toEqual({ message, undoable });
  });

  it('says nothing when the answer did not change', () => {
    expect(rsvpFeedback('going', 'going')).toBeNull();
  });
});

describe('RESCHEDULE_DM_DELAY_MIN', () => {
  it('matches the dm.session.changed schedule in the PG trigger', () => {
    const sql = readFileSync(path.join(ROOT, 'server/migrations/0005_sessions.sql'), 'utf8');
    const branch = sql.slice(sql.indexOf("'dm.session.changed'"));
    const minutes = /interval '(\d+) minutes'/.exec(branch);
    expect(minutes).not.toBeNull();
    expect(Number(minutes?.[1])).toBe(RESCHEDULE_DM_DELAY_MIN);
  });
});
```

（`'dm.session.changed'` 在 `server/migrations/0005_sessions.sql` 里只出现一次，在 `:149`；它后面第一个 `interval 'N minutes'` 就是 `:151` 的 `now() + interval '3 minutes'`。）

- [ ] **Step 2: 跑测试，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/session-actions.test.ts
```

Expected：FAIL —— `Failed to resolve import "../../src/lib/sessionActions"`（`constants.ts` 里也还没有 `RESCHEDULE_DM_DELAY_MIN`）。

- [ ] **Step 3: 在 `src/lib/constants.ts` 末尾追加 P0-6 小节**

```ts
// --- P0-6 ---
/**
 * A move DMs everyone in the session this many minutes later, and a burst of
 * moves is one DM. MUST equal `interval '3 minutes'` in the dm.session.changed
 * branch of server/migrations/0005_sessions.sql (asserted in session-actions.test.ts).
 */
export const RESCHEDULE_DM_DELAY_MIN = 3;
/** 其他时间 first shows an hour from now — shared by 改时间 (RescheduleSheet) and 发起约局 (SessionFormDialog). */
export const CUSTOM_TIME_LEAD_MS = 60 * 60 * 1000;
```

- [ ] **Step 4: 新建 `src/lib/sessionActions.ts`**

```ts
// Pure helpers behind 约局详情's organizer actions and RSVP feedback (P0-6).
// No DOM, React or api.ts: tests/unit imports this under tsconfig.worker.json.
import { RSVP_LABEL, isSelfRsvp } from '@shared/attendance';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import type { QuickSlot } from '@shared/quickTime';
import type { SessionDetail, SessionItem } from '../types';
import { RESCHEDULE_DM_DELAY_MIN } from './constants';
import { parseTimestamp } from './time';

/** The answers a move puts back to 'invited' (worker/sessions.ts:463-467). */
const RESET_BY_MOVE: readonly Rsvp[] = ['going', 'maybe', 'out'];

/** People who must answer again after a move: rsvp going/maybe/out, organizer excluded. */
export function rescheduleImpact(session: SessionDetail): number {
  return session.players.filter(
    (p) => p.user.id !== session.organizer.id && RESET_BY_MOVE.includes(p.rsvp),
  ).length;
}

/**
 * What a move does, in spec §3.5's words. Only facts: the re-answer line needs
 * someone who answered, the DM line needs someone besides the organizer.
 */
export function rescheduleConsequences(session: SessionDetail): string[] {
  const impact = rescheduleImpact(session);
  const others = session.players.filter((p) => p.user.id !== session.organizer.id).length;
  return [
    ...(impact > 0 ? [`已回复的 ${impact} 人要重新确认（说过不来的也要重新回答）`] : []),
    ...(others > 0
      ? [
          `局里每个人约 ${RESCHEDULE_DM_DELAY_MIN} 分钟后收到一条「约局改时间了」私信，连改几次也只发一条`,
        ]
      : []),
    '开局提醒和点名提醒会跟着改',
  ];
}

/** The quick slots minus the session's own time: moving to the same moment is no move. */
export function rescheduleSlots(slots: readonly QuickSlot[], startsAt: string): QuickSlot[] {
  const current = parseTimestamp(startsAt);
  return slots.filter((s) => s.at !== current);
}

export type CustomTime = { ok: true; iso: string } | { ok: false; error: string };

/**
 * A `datetime-local` value carries no zone; Date.parse reads it as local, which
 * is what the organizer meant. Sent as UTC, as SessionFormDialog does.
 */
export function parseCustomTime(value: string): CustomTime {
  if (value.trim() === '') return { ok: false, error: '选一个时间' };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false, error: '时间格式不对' };
  return { ok: true, iso: new Date(ms).toISOString() };
}

/** Every seat is taken: only `going` counts (worker/sessions.ts:530-540). */
export function isFull(session: SessionItem): boolean {
  return session.capacity !== null && session.counts.going >= session.capacity;
}

/** 来 is closed to this viewer: full, and they do not already hold a seat. */
export function goingClosed(session: SessionItem): boolean {
  return isFull(session) && session.my_rsvp !== 'going';
}

/** 「来 5/5 满了，可以先报待定。」 while 来 is closed to the viewer, else null. */
export function fullNotice(session: SessionItem): string | null {
  if (!goingClosed(session) || session.capacity === null) return null;
  return `来 ${session.counts.going}/${session.capacity} 满了，可以先报待定。`;
}

export interface RsvpFeedback {
  message: string;
  /** Only a change between two of the viewer's own answers: nobody can set themself back to invited. */
  undoable: boolean;
}

/** Toast copy after an answer (spec §4.1 ④); null when nothing changed. */
export function rsvpFeedback(prev: Rsvp | null, next: SelfRsvp): RsvpFeedback | null {
  if (prev === next) return null;
  const undoable = prev !== null && isSelfRsvp(prev);
  if (next === 'out') return { message: '收到，提前说了点名就不会记你 👍', undoable };
  if (!undoable) return { message: `已回复：${RSVP_LABEL[next]}。开局前想改随时改。`, undoable };
  return { message: `已改成：${RSVP_LABEL[next]}`, undoable };
}
```

引用核对：`isSelfRsvp`、`RSVP_LABEL`、`Rsvp`、`SelfRsvp` 在 `shared/attendance.ts:21,30,34,38`；`QuickSlot` 在 `shared/quickTime.ts:19`；`parseTimestamp` 在 `src/lib/time.ts:15`；`SessionDetail`/`SessionItem` 在 `src/types.ts:114,130`。全部纯模块。

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/session-actions.test.ts
npm run typecheck
```

Expected：`tests/unit/session-actions.test.ts` 21 个用例全部 PASS；typecheck 通过（`tests/unit` 由 `tsconfig.worker.json` 检查，`sessionActions.ts` 不碰 DOM，所以能过）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/constants.ts src/lib/sessionActions.ts tests/unit/session-actions.test.ts
git commit -m "feat: 新增约局操作纯函数（改期影响面、满员提示、报名反馈文案）"
```

---

### Task 2: `RescheduleSheet` 组件

**Files:**
- Create: `src/components/RescheduleSheet.tsx`
- Create: `src/components/reschedule-sheet.css`
- Test: `tests/dom/organizer-actions.test.tsx`（新建，本 Task 写文件头和第一个 `describe`）

- [ ] **Step 1: 写失败的测试**

新建 `tests/dom/organizer-actions.test.tsx`（文件头里的 `SessionDetailDialog`、`ToastProvider`、`renderDialog`、`detail`、`ORGANIZER` 等到 Task 3–5 才用到，先写好，`tsconfig.json` 的 `noUnusedLocals` 为 false）：

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Rsvp } from '@shared/attendance';
import { RescheduleSheet } from '../../src/components/RescheduleSheet';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { ToastProvider } from '../../src/components/Toast';
import type { SessionDetail, SessionPlayer, User } from '../../src/types';

// P0-6: 改时间 and 取消这局 inside the existing session dialog, and what an
// answer says back. Only Date is faked — pinned to a local Wednesday morning so
// quickSlots() is the same list on every machine; timers stay real.

const NOW = new Date(2026, 9, 28, 10, 0);
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 9, day, hour, minute).toISOString();
const START = at(28, 21); // 今晚 21:00

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Unrouted requests get a 500, so an extra request shows up as a failure. */
function mockFetch(routes: Record<string, (call: Call) => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      const call: Call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route(call) : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

function makeUser(id: string, username: string, isAdmin = false): User {
  return {
    id,
    username,
    oauth_username: username,
    avatar_url: null,
    is_participant: true,
    is_judge: false,
    is_admin: isAdmin,
    score: 100,
    created_at: '2026-10-01 00:00:00',
  };
}

const ORGANIZER = makeUser('org', '组织者');
const PLAYER = makeUser('p', '选手');
const ADMIN = makeUser('admin', '管理员', true);

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: `玩家${id}`, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

function makeSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: START,
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 1, going: 2, maybe: 1, out: 1 },
    my_rsvp: null,
    players: [
      player('org', 'going'),
      player('a', 'going'),
      player('b', 'maybe'),
      player('c', 'out'),
      player('d', 'invited'),
    ],
    ...overrides,
  };
}

const detail = (s: SessionDetail): Response => json(200, { session: s, records: [] });

/** The dialog inside a ToastProvider, as App renders it. */
function renderDialog(me: User): Mock {
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <SessionDetailDialog sessionId={1} me={me} onClose={() => {}} onChanged={onChanged} />
    </ToastProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RescheduleSheet', () => {
  function renderSheet(): { onClose: Mock; onRescheduled: Mock; sheet: HTMLElement } {
    const onClose = vi.fn();
    const onRescheduled = vi.fn();
    render(<RescheduleSheet session={makeSession()} onClose={onClose} onRescheduled={onRescheduled} />);
    return { onClose, onRescheduled, sheet: screen.getByRole('dialog', { name: '改到什么时候？' }) };
  }

  it('starts on 先不改, shows the current time as local, and never offers it again', () => {
    mockFetch({});
    const { sheet } = renderSheet();
    expect(within(sheet).getByRole('button', { name: '先不改' })).toHaveFocus();
    expect(within(sheet).getByText(/^现在：/)).toHaveTextContent('现在：10月28日 21:00 周三（本地时间）');
    expect(within(sheet).queryByRole('radio', { name: '今晚 21:00' })).toBeNull();
    expect(within(sheet).getByRole('radio', { name: '今晚 20:00' })).toBeChecked();
    expect(within(sheet).getByRole('button', { name: '改到 今晚 20:00' })).toBeInTheDocument();
  });

  it('says what the move does before doing it', () => {
    mockFetch({});
    const { sheet } = renderSheet();
    expect(within(sheet).getByText('改到 今晚 20:00 之后：')).toBeInTheDocument();
    expect(within(sheet).getByText('已回复的 3 人要重新确认（说过不来的也要重新回答）')).toBeInTheDocument();
    expect(
      within(sheet).getByText('局里每个人约 3 分钟后收到一条「约局改时间了」私信，连改几次也只发一条'),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('开局提醒和点名提醒会跟着改')).toBeInTheDocument();
  });

  it('moves it with one PATCH of starts_at only', async () => {
    const moved = makeSession({ starts_at: at(28, 22) });
    const calls = mockFetch({ 'PATCH /api/sessions/1': () => json(200, { session: moved }) });
    const user = userEvent.setup();
    const { sheet, onRescheduled } = renderSheet();
    await user.click(within(sheet).getByRole('radio', { name: '今晚 22:00' }));
    expect(within(sheet).getByText('改到 今晚 22:00 之后：')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 22:00' }));
    await waitFor(() => expect(onRescheduled).toHaveBeenCalledWith(moved));
    expect(writes(calls)).toEqual([
      { method: 'PATCH', path: '/api/sessions/1', body: { starts_at: at(28, 22) } },
    ]);
  });

  it('先不改 closes without a request', async () => {
    const calls = mockFetch({});
    const user = userEvent.setup();
    const { sheet, onClose } = renderSheet();
    await user.click(within(sheet).getByRole('button', { name: '先不改' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('takes 其他时间 as local wall-clock time and refuses an empty one', async () => {
    const calls = mockFetch({
      'PATCH /api/sessions/1': () => json(200, { session: makeSession({ starts_at: at(30, 20, 30) }) }),
    });
    const user = userEvent.setup();
    const { sheet } = renderSheet();
    await user.click(within(sheet).getByRole('button', { name: /其他时间/ }));
    const input = within(sheet).getByLabelText('自定义开始时间');
    expect(input).toHaveValue('2026-10-28T11:00');
    fireEvent.change(input, { target: { value: '' } });
    await user.click(within(sheet).getByRole('button', { name: '改时间' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('选一个时间');
    fireEvent.change(input, { target: { value: '2026-10-30T20:30' } });
    await user.click(within(sheet).getByRole('button', { name: '改到 周五 20:30' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toEqual({ starts_at: at(30, 20, 30) });
  });

  it("shows the server's reason in the sheet and stays open", async () => {
    mockFetch({ 'PATCH /api/sessions/1': () => json(400, { error: '约局已开始，不能再修改' }) });
    const user = userEvent.setup();
    const { sheet, onRescheduled } = renderSheet();
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 20:00' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('约局已开始，不能再修改');
    expect(within(sheet).getByRole('button', { name: '改到 今晚 20:00' })).toBeEnabled();
    expect(onRescheduled).not.toHaveBeenCalled();
  });
});
```

说明：
- 只假 `Date`（`toFake: ['Date']`），`setTimeout` 等保持真实，所以 user-event、`waitFor` 和 toast 计时都不用 `advanceTimers`。契约 §4 的假时钟写法针对的是要快进计时器的测试，这里不需要（见「对契约的补充」第 8 条）。
- 2026-10-28 是周三，本地 10:00 时 `quickSlots()` 恒为 `今晚 20:00 / 今晚 21:00 / 今晚 22:00 / 明晚 20:00 / 周五 20:00 / 周六 20:00`（与时区无关，已在 scratch 里验证）；`START` 是「今晚 21:00」，所以它不应该出现在可选项里。
- `formatDateTime(START)` = `10月28日 21:00 周三`；`formatWhen(at(30,20,30))` = `周五 20:30`；`toDateTimeLocalValue(NOW + 1h)` = `2026-10-28T11:00`。

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx
```

Expected：FAIL —— `Failed to resolve import "../../src/components/RescheduleSheet"`。

- [ ] **Step 3: 新建 `src/components/RescheduleSheet.tsx`**

```tsx
import { useState } from 'react';
import { quickSlots } from '@shared/quickTime';
import type { QuickSlot } from '@shared/quickTime';
import type { SessionDetail } from '../types';
import { ApiError, updateSession } from '../api';
import { CUSTOM_TIME_LEAD_MS } from '../lib/constants';
import { formatDateTime, formatWhen, toDateTimeLocalValue } from '../lib/time';
import { parseCustomTime, rescheduleConsequences, rescheduleSlots } from '../lib/sessionActions';
import { Modal } from './Modal';
import './reschedule-sheet.css';

interface RescheduleSheetProps {
  session: SessionDetail;
  onClose: () => void;
  onRescheduled: (session: SessionDetail) => void;
}

interface Target {
  iso: string;
  label: string;
}

/** The time the confirm button moves to; null when 其他时间 holds nothing usable. */
function currentTarget(
  slots: readonly QuickSlot[],
  chosen: string | null,
  customOpen: boolean,
  custom: string,
): Target | null {
  if (customOpen) {
    const parsed = parseCustomTime(custom);
    return parsed.ok ? { iso: parsed.iso, label: formatWhen(parsed.iso) } : null;
  }
  const slot = slots.find((s) => s.iso === chosen);
  return slot ? { iso: slot.iso, label: slot.label } : null;
}

/** Why there is nothing to move to: 其他时间 is empty or unreadable. */
function missingTargetError(custom: string): string {
  const parsed = parseCustomTime(custom);
  return parsed.ok ? '选一个时间' : parsed.error;
}

interface MoveSession {
  error: string | null;
  busy: boolean;
  /** PATCH starts_at only; on failure the sheet stays open with the reason. */
  move: (iso: string) => Promise<void>;
  /** Show a reason without asking the server (nothing usable was picked). */
  fail: (message: string) => void;
}

function useMoveSession(sessionId: number, onMoved: (session: SessionDetail) => void): MoveSession {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const move = async (iso: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await updateSession(sessionId, { starts_at: iso });
      onMoved(res.session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
      setBusy(false);
    }
  };
  return { error, busy, move, fail: setError };
}

/**
 * 改时间 — a sheet over the session detail (two layers, the most a phone gets).
 * It says what a move does before doing it: answers reset to invited
 * (worker/sessions.ts:463-467), one merged DM, the reminders follow. Focus
 * starts on 先不改.
 *
 * Until P2 there is no board timezone, so the slots are the browser's
 * (quickSlots) and the sheet says 本地时间.
 */
export function RescheduleSheet({ session, onClose, onRescheduled }: RescheduleSheetProps): JSX.Element {
  // Computed once per open: the chips must not shift under the organizer's finger.
  const [slots] = useState(() => rescheduleSlots(quickSlots(), session.starts_at));
  const [chosen, setChosen] = useState<string | null>(() => slots[0]?.iso ?? null);
  const [customOpen, setCustomOpen] = useState(() => slots.length === 0);
  const [custom, setCustom] = useState(() => toDateTimeLocalValue(Date.now() + CUSTOM_TIME_LEAD_MS));
  const { error, busy, move, fail } = useMoveSession(session.id, onRescheduled);

  const target = currentTarget(slots, chosen, customOpen, custom);
  const submit = (): void => {
    if (target) {
      void move(target.iso);
    } else {
      fail(missingTargetError(custom));
    }
  };

  return (
    <Modal open onClose={onClose} labelledBy="reschedule-title" variant="sheet" title="改到什么时候？">
      <div className="rss">
        <p className="rss__now">
          现在：<span className="tabular">{formatDateTime(session.starts_at)}</span>（本地时间）
        </p>
        <SlotPicker
          slots={slots}
          chosen={chosen}
          customOpen={customOpen}
          custom={custom}
          onChoose={(iso) => {
            setChosen(iso);
            setCustomOpen(false);
          }}
          onToggleCustom={() => setCustomOpen((open) => !open)}
          onCustomChange={setCustom}
        />
        <Consequences session={session} target={target} />
        <SheetActions
          error={error}
          busy={busy}
          target={target}
          onClose={onClose}
          onSubmit={submit}
        />
      </div>
    </Modal>
  );
}

interface SlotPickerProps {
  slots: readonly QuickSlot[];
  chosen: string | null;
  customOpen: boolean;
  custom: string;
  onChoose: (iso: string) => void;
  onToggleCustom: () => void;
  onCustomChange: (value: string) => void;
}

/** Quick slots as radios plus 其他时间 — the same chips as 约一局 (SessionFormDialog). */
function SlotPicker({
  slots,
  chosen,
  customOpen,
  custom,
  onChoose,
  onToggleCustom,
  onCustomChange,
}: SlotPickerProps): JSX.Element {
  return (
    <fieldset className="rss__field">
      <legend className="visually-hidden">新的时间（本地时间）</legend>
      <div className="rss__slots">
        {slots.map((s) => {
          const on = !customOpen && chosen === s.iso;
          return (
            <label key={s.iso} className={`rss__slot${on ? ' rss__slot--on' : ''}`}>
              <input
                type="radio"
                name="reschedule-slot"
                className="visually-hidden"
                checked={on}
                onChange={() => onChoose(s.iso)}
              />
              {s.label}
            </label>
          );
        })}
        <button
          type="button"
          className={`rss__slot rss__slot--custom${customOpen ? ' rss__slot--on' : ''}`}
          aria-expanded={customOpen}
          onClick={onToggleCustom}
        >
          其他时间 {customOpen ? '▾' : '▸'}
        </button>
      </div>
      {customOpen && (
        <input
          className="rss__input"
          type="datetime-local"
          value={custom}
          onChange={(e) => onCustomChange(e.target.value)}
          aria-label="自定义开始时间"
        />
      )}
    </fieldset>
  );
}

interface SheetActionsProps {
  error: string | null;
  busy: boolean;
  target: Target | null;
  onClose: () => void;
  onSubmit: () => void;
}

/** Why a move failed, then 先不改 (focused on open) before 改到 X — DOM order is visual order. */
function SheetActions({ error, busy, target, onClose, onSubmit }: SheetActionsProps): JSX.Element {
  return (
    <>
      {error && (
        <p className="rss__error" role="alert">
          {error}
        </p>
      )}
      <div className="rss__actions">
        <button type="button" className="btn btn--ghost" data-autofocus disabled={busy} onClick={onClose}>
          先不改
        </button>
        <button type="button" className="btn btn--gold" disabled={busy} onClick={onSubmit}>
          {busy ? '提交中…' : target ? `改到 ${target.label}` : '改时间'}
        </button>
      </div>
    </>
  );
}

/** 「改到 22:00 之后：」 and the facts of a move (spec §3.5). */
function Consequences({ session, target }: { session: SessionDetail; target: Target | null }): JSX.Element {
  return (
    <div className="rss__impact">
      <p className="rss__impact-title">{target ? `改到 ${target.label} 之后：` : '改了之后：'}</p>
      <ul className="rss__impact-list">
        {rescheduleConsequences(session).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
```

要点：
- `title` 交给 P0-2 的 Modal 渲染成 `<h2 id="reschedule-title" class="modal__title">`，本组件**不再**自己渲染这个 id（契约 §3.2）。
- 「先不改」带 `data-autofocus`，Modal 打开时焦点落在它上面（`Modal.tsx` 的 `[data-autofocus]` 优先规则，P0-2 保留）。DOM 顺序 = 先「先不改」后「改到 X」，和 ConfirmInline 一致。
- `.visually-hidden` 已存在（`src/theme.css:176`）；时段 chips 照抄 `SessionFormDialog.tsx:103-142` 的写法（label 包 radio + 「其他时间」按钮 + `datetime-local`），`aria-label="自定义开始时间"` 也沿用。
- 「其他时间」初值的提前量用 `CUSTOM_TIME_LEAD_MS`（Task 1 放进 `src/lib/constants.ts` 的 P0-6 小节，契约 §3.0：前端专用常量都放那里），数值等于 `SessionFormDialog.tsx:128` 的 `3_600_000`。名字不带 `RESCHEDULE_`：发起约局用的是同一个提前量，P0-5 改 `SessionFormDialog` 时会把它的字面量换成这个常量（跨 PR 一致性检查定下的，见 README）；本 PR 不碰 `SessionFormDialog`。
- 机主规则「函数 < 50 行」：错误提示和两个按钮拆成不导出的 `SheetActions`，「没选出时间时报什么错」拆成 `missingTargetError`，PATCH 与 `error`/`busy` 状态拆成文件内的 hook `useMoveSession`（16 行），`RescheduleSheet` 主函数 47 行。渲染出的 DOM 与拆分前完全相同（`.rss` 下依次是 now → fieldset → impact → error → actions），Task 2 的 6 个用例与 Task 3–5 的用例原样通过（已在合并了 P0-1…P0-5 的沙盒里实测：organizer-actions 20/20）。

- [ ] **Step 4: 新建 `src/components/reschedule-sheet.css`**

```css
/* 改时间 — RescheduleSheet, nested over 约局详情 (P0-6) */

.rss {
  display: grid;
  gap: 1rem;
}

.rss__now {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.rss__field {
  display: grid;
  gap: 0.6rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.rss__slots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.rss__slot {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-min);
  padding: 0 0.9rem;
  border: 1px solid var(--border-input);
  border-radius: var(--r-pill);
  font: inherit;
  font-size: var(--fs-sm);
  color: var(--text);
  background: var(--panel-2);
  cursor: pointer;
}

/* Selected is more than a colour: the weight changes too. */
.rss__slot--on {
  border-color: var(--action);
  color: var(--action);
  font-weight: 700;
}

.rss__slot:has(:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.rss__input {
  min-height: var(--tap-min);
  padding: 0 0.75rem;
  border: 1px solid var(--border-input);
  border-radius: var(--r-sm);
  font: inherit;
  font-size: var(--fs-md);
  color: var(--text);
  background: var(--bg-elevated);
}

.rss__impact {
  padding: 0.75rem 0.9rem;
  border-radius: var(--r-sm);
  background: var(--panel-2);
}

.rss__impact-title {
  font-size: var(--fs-sm);
  font-weight: 600;
}

.rss__impact-list {
  display: grid;
  gap: 0.3rem;
  margin: 0.4rem 0 0;
  padding-left: 1.1rem;
  font-size: var(--fs-sm);
  color: var(--muted);
}

.rss__error {
  font-size: var(--fs-sm);
  color: var(--danger-text);
}

.rss__actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
```

（不写 `@media` 断点、不写 `:hover`、不写 `outline: none`，所以 P0-1 的 `css-conventions.test.ts` 不会拦。sheet 的贴底、92dvh、safe-area、sticky 标题栏全由 P0-2 的 `modal.css` 负责。输入框 16px 防 iOS 缩放。）

- [ ] **Step 5: 跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx
npm run typecheck
```

Expected：`RescheduleSheet` 下 6 个用例全部 PASS；typecheck 通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/RescheduleSheet.tsx src/components/reschedule-sheet.css tests/dom/organizer-actions.test.tsx
git commit -m "feat: 新增改时间底部抽屉 RescheduleSheet，改前写明影响面"
```

---

### Task 3: 约局详情里接上「改时间」

**Files:**
- Modify: `src/components/SessionDetailDialog.tsx:11-16`（imports）、`:38-39`（state）、`:77` 之前（新 handler）、`:185-196`（操作区，加按钮）、`:231-235`（文件尾，渲染 sheet）
- Test: `tests/dom/organizer-actions.test.tsx`（末尾追加）

- [ ] **Step 1: 写失败的测试**

在 `tests/dom/organizer-actions.test.tsx` 末尾追加：

```tsx
describe('改时间 in the session dialog', () => {
  it('opens over the dialog; Escape closes only the sheet', async () => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()) });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    expect(screen.getByRole('dialog', { name: '改到什么时候？' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '周五五排' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改时间' })).toHaveFocus();
    expect(writes(calls)).toEqual([]);
  });

  it('after a move the dialog shows the new time, tells the lists, and says so', async () => {
    const moved = makeSession({
      starts_at: at(28, 22),
      counts: { invited: 4, going: 1, maybe: 0, out: 0 },
      players: [
        player('org', 'going'),
        player('a', 'invited'),
        player('b', 'invited'),
        player('c', 'invited'),
        player('d', 'invited'),
      ],
    });
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'PATCH /api/sessions/1': () => json(200, { session: moved }),
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    const sheet = screen.getByRole('dialog', { name: '改到什么时候？' });
    await user.click(within(sheet).getByRole('radio', { name: '今晚 22:00' }));
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 22:00' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull());
    expect(screen.getByText('10月28日 22:00 周三')).toBeInTheDocument();
    expect(await screen.findByText('已改到 今天 22:00。')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '改时间' })).toHaveFocus();
    expect(writes(calls)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx
```

Expected：新增的 2 个用例 FAIL —— `Unable to find an accessible element with the role "button" and name "改时间"`；Task 2 的 6 个仍 PASS。

- [ ] **Step 3: 改 imports（`SessionDetailDialog.tsx:11-16`）**

Before:
```tsx
import { formatDateTime, parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { VerdictCard } from './VerdictCard';
import { RollCallDialog } from './RollCallDialog';
import './session-detail.css';
```
After:
```tsx
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { VerdictCard } from './VerdictCard';
import { RollCallDialog } from './RollCallDialog';
import { RescheduleSheet } from './RescheduleSheet';
import { useToast } from './Toast';
import './session-detail.css';
```

- [ ] **Step 4: 加 state（`SessionDetailDialog.tsx:38-39`）**

Before:
```tsx
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
```
After:
```tsx
  const [rollCallOpen, setRollCallOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const toast = useToast();
```

- [ ] **Step 5: 加改期成功的 handler（插在 `SessionDetailDialog.tsx:77` 之前）**

Before:
```tsx
  const started = session !== null && parseTimestamp(session.starts_at) <= Date.now();
```
After:
```tsx
  const handleRescheduled = (updated: SessionDetail): void => {
    setRescheduleOpen(false);
    setSession(updated);
    setError(null);
    toast.show({ message: `已改到 ${formatWhen(updated.starts_at)}。`, tone: 'ok' });
    onChanged();
  };

  const started = session !== null && parseTimestamp(session.starts_at) <= Date.now();
```

（PATCH 返回的就是完整的 `SessionDetail`（`worker/sessions.ts:471`），直接 `setSession`，不再多发一次 GET；`records` 改期不会变。）

- [ ] **Step 6: 操作区加「改时间」按钮（`SessionDetailDialog.tsx:185-196`）**

Before:
```tsx
            {canManage && session.status === 'open' && (
              <div className="sdt__actions">
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void mutate(() => cancelSession(session.id))}
                  >
```
After:
```tsx
            {canManage && session.status === 'open' && (
              <div className="sdt__actions">
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => setRescheduleOpen(true)}
                  >
                    改时间
                  </button>
                )}
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void mutate(() => cancelSession(session.id))}
                  >
```

（「取消约局」按钮在本 Task 原样保留，Task 4 再替换。`canManage` 判断 `:79` 不动；后端 `updateSession` 也只允许开局前改（`worker/sessions.ts:420`），所以只在 `!started` 时显示。）

- [ ] **Step 7: 渲染嵌套的 sheet（`SessionDetailDialog.tsx:231-235`）**

Before:
```tsx
        />
      )}
    </>
  );
}
```
After:
```tsx
        />
      )}

      {session && rescheduleOpen && (
        <RescheduleSheet
          session={session}
          onClose={() => setRescheduleOpen(false)}
          onRescheduled={handleRescheduled}
        />
      )}
    </>
  );
}
```

（和 `RollCallDialog` 一样作为兄弟节点渲染；两者互斥：改时间只在开局前，点名只在开局后，所以永远最多两层。Esc 只关栈顶、关闭后焦点回「改时间」按钮，都由 P0-2 的 Modal 栈保证。）

- [ ] **Step 8: 跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx
npm run typecheck
```

Expected：organizer-actions 8 个 PASS，session-rsvp-moved 2 个 PASS；typecheck 通过。

- [ ] **Step 9: Commit**

```bash
git add src/components/SessionDetailDialog.tsx tests/dom/organizer-actions.test.tsx
git commit -m "feat: 约局详情接上改时间入口（嵌套抽屉，改完刷新列表）"
```

---

### Task 4: 「取消这局」改成原地确认，确认后立即提交

**Files:**
- Modify: `src/components/SessionDetailDialog.tsx`：`:1`（react import）、Task 3 改过的 imports 段、state 段、`:56-75`（`mutate` 改为返回 boolean）、`handleRescheduled` 之前（新 `handleCancel`）、`:95`（h2）、Task 3 之后的整个操作区块（原 `:185-210`）、文件末尾（新增两个子组件）
- Modify: `src/components/session-detail.css`（末尾追加）
- Test: `tests/dom/organizer-actions.test.tsx`（末尾追加）

- [ ] **Step 1: 写失败的测试**

在 `tests/dom/organizer-actions.test.tsx` 末尾追加：

```tsx
describe('who manages it', () => {
  it('a player gets neither 改时间 nor 取消这局', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })) });
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改时间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });

  it('an admin who is not the organizer gets both, and can still answer', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })) });
    renderDialog(ADMIN);
    const reschedule = await screen.findByRole('button', { name: '改时间' });
    const cancel = screen.getByRole('button', { name: '取消这局' });
    // 取消这局 comes last (spec §3.5): after 改时间 in DOM order, which is the visual order.
    expect(reschedule.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: '来' })).toBeInTheDocument();
  });

  it('once it has started there is only 点名结算', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ starts_at: at(28, 9) })) });
    renderDialog(ORGANIZER);
    expect(await screen.findByRole('button', { name: '点名结算' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改时间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });
});

describe('取消这局', () => {
  it('asks in place with focus on 不取消了, and backing out sends nothing', async () => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()) });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    const confirm = screen.getByRole('group', { name: '取消这局？' });
    expect(
      within(confirm).getByText('会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。'),
    ).toBeInTheDocument();
    expect(within(confirm).getAllByRole('button').map((b) => b.textContent)).toEqual(['不取消了', '确认取消']);
    expect(within(confirm).getByRole('button', { name: '不取消了' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: '不取消了' }));
    expect(screen.queryByRole('group', { name: '取消这局？' })).toBeNull();
    expect(screen.getByRole('button', { name: '取消这局' })).toHaveFocus();
    expect(writes(calls)).toEqual([]);
  });

  it('confirming cancels at once: one POST, a toast, focus on the title', async () => {
    let cancelled = false;
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession({ status: cancelled ? 'cancelled' : 'open' })),
      'POST /api/sessions/1/cancel': () => {
        cancelled = true;
        return json(200, { session: makeSession({ status: 'cancelled' }) });
      },
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    await user.click(screen.getByRole('button', { name: '确认取消' }));
    expect(await screen.findByText('这局已取消。')).toBeInTheDocument();
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/api/sessions/1/cancel', body: null }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('heading', { name: '周五五排' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });

  it('a refused cancel keeps the confirm and shows why', async () => {
    mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'POST /api/sessions/1/cancel': () => json(400, { error: '已结算的约局不能取消' }),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    await user.click(screen.getByRole('button', { name: '确认取消' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已结算的约局不能取消');
    expect(screen.getByRole('group', { name: '取消这局？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认取消' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx
```

Expected：4 个 FAIL（admin 用例与「取消这局」的 3 个：`Unable to find an accessible element with the role "button" and name "取消这局"`）；「a player gets neither」「once it has started」和此前 8 个 PASS。

- [ ] **Step 3: 改 imports**

`SessionDetailDialog.tsx:1` Before:
```tsx
import { useCallback, useEffect, useState } from 'react';
```
After:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
```

Task 3 之后的这两行 Before:
```tsx
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
```
After:
```tsx
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { ConfirmInline } from './ConfirmInline';
```

- [ ] **Step 4: 加标题 ref**

Before（Task 3 加的那行）:
```tsx
  const toast = useToast();
```
After:
```tsx
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
```

- [ ] **Step 5: `mutate` 返回成败（`SessionDetailDialog.tsx:56-75` 整段替换）**

Before:
```tsx
  const mutate = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '操作失败';
      // Moved since it loaded: show the new time to answer to (and tell the
      // lists behind), then say why — a successful reload clears the error.
      if (err instanceof ApiError && err.status === 409) {
        await load();
        onChanged();
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  };
```
After:
```tsx
  /** Runs a write, then reloads. Resolves false — with the reason on screen — when it failed. */
  const mutate = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged();
      setError(null);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '操作失败';
      // Moved since it loaded: show the new time to answer to (and tell the
      // lists behind), then say why — a successful reload clears the error.
      if (err instanceof ApiError && err.status === 409) {
        await load();
        onChanged();
      }
      setError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };
```

（409 分支与原来逐字一致——`session-rsvp-moved` 锁的就是它。现有调用点都是 `void mutate(...)`，返回值变化不影响它们。）

- [ ] **Step 6: 加 `handleCancel`（插在 Task 3 的 `handleRescheduled` 之前）**

Before:
```tsx
  const handleRescheduled = (updated: SessionDetail): void => {
```
After:
```tsx
  const handleCancel = async (): Promise<boolean> => {
    if (!session) return false;
    const ok = await mutate(() => cancelSession(session.id));
    if (ok) {
      toast.show({ message: '这局已取消。', tone: 'ok' });
      // The confirm and the button that opened it leave with the open state.
      titleRef.current?.focus();
    }
    return ok;
  };

  const handleRescheduled = (updated: SessionDetail): void => {
```

- [ ] **Step 7: 标题可被程序聚焦（`SessionDetailDialog.tsx:95`）**

Before:
```tsx
              <h2 id="session-detail-title" className="sdt__title">
```
After:
```tsx
              <h2 id="session-detail-title" className="sdt__title" ref={titleRef} tabIndex={-1}>
```

（`tabIndex={-1}` 不进 Tab 序列，Modal 的 `FOCUSABLE_SELECTOR` 也排除 `[tabindex="-1"]`，打开时的初始焦点不变。）

- [ ] **Step 8: 操作区整块换成 `OrganizerActions`**

Before（Task 3 之后的整块，原 `:185-210`）:
```tsx
            {canManage && session.status === 'open' && (
              <div className="sdt__actions">
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => setRescheduleOpen(true)}
                  >
                    改时间
                  </button>
                )}
                {!started && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => void mutate(() => cancelSession(session.id))}
                  >
                    取消约局
                  </button>
                )}
                {canRollCall && (
                  <button
                    type="button"
                    className="btn btn--gold"
                    onClick={() => setRollCallOpen(true)}
                  >
                    点名结算
                  </button>
                )}
                {!started && (
                  <p className="sdt__hint">约局开始后可以点名，点名不等于扣分。</p>
                )}
              </div>
            )}
```
After:
```tsx
            {canManage && session.status === 'open' && (
              <OrganizerActions
                started={started}
                canRollCall={canRollCall}
                busy={busy}
                onReschedule={() => setRescheduleOpen(true)}
                onRollCall={() => setRollCallOpen(true)}
                onCancel={handleCancel}
              />
            )}
```

- [ ] **Step 9: 文件末尾（`SessionDetailDialog` 函数的 `}` 之后）追加两个子组件**

```tsx

interface OrganizerActionsProps {
  started: boolean;
  canRollCall: boolean;
  busy: boolean;
  onReschedule: () => void;
  onRollCall: () => void;
  onCancel: () => Promise<boolean>;
}

/** The organizer's (or an admin's) controls on an open session; 取消这局 comes last. */
function OrganizerActions({
  started,
  canRollCall,
  busy,
  onReschedule,
  onRollCall,
  onCancel,
}: OrganizerActionsProps): JSX.Element {
  return (
    <div className="sdt__actions">
      {!started && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onReschedule}>
          改时间
        </button>
      )}
      {canRollCall && (
        <button type="button" className="btn btn--gold" onClick={onRollCall}>
          点名结算
        </button>
      )}
      {!started && <p className="sdt__hint">约局开始后可以点名，点名不等于扣分。</p>}
      {!started && <CancelSessionControl busy={busy} onConfirm={onCancel} />}
    </div>
  );
}

interface CancelSessionControlProps {
  busy: boolean;
  onConfirm: () => Promise<boolean>;
}

/**
 * 取消这局 → an in-place confirm with focus on 不取消了 (DiscordLinkCard's way).
 * Confirming submits at once: nothing reopens a cancelled session, so a delayed
 * submit lost to a closed tab would look done and not be (spec §3.5).
 */
function CancelSessionControl({ busy, onConfirm }: CancelSessionControlProps): JSX.Element {
  const { confirming, ask, dismiss, close, triggerRef } = useInlineConfirm();
  const confirm = async (): Promise<void> => {
    if (await onConfirm()) close();
  };
  if (!confirming) {
    return (
      <button ref={triggerRef} type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={ask}>
        取消这局
      </button>
    );
  }
  return (
    <div className="sdt__cancel-confirm">
      <ConfirmInline
        question="取消这局？"
        confirmLabel="确认取消"
        cancelLabel="不取消了"
        tone="danger"
        focus="cancel"
        busy={busy}
        busyLabel="取消中…"
        onCancel={dismiss}
        onConfirm={() => void confirm()}
      >
        <p className="sdt__cancel-detail">
          会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。
        </p>
      </ConfirmInline>
    </div>
  );
}
```

（DOM 顺序 = 视觉顺序：改时间 → 点名结算 → 提示 → 取消这局（最后、次要样式）。确认成功后局变成 cancelled，整个 `OrganizerActions` 卸载，`close()` 只是收尾。新按钮名都不是裸的「取消」「确认」（契约 §3.2）。）

- [ ] **Step 10: `session-detail.css` 末尾追加**

```css

/* P0-6 — 取消这局's in-place confirm takes a row of its own, under the buttons. */
.sdt__cancel-confirm {
  flex-basis: 100%;
}

.sdt__cancel-detail {
  font-size: var(--fs-sm);
  color: var(--muted);
}
```

- [ ] **Step 11: 跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

Expected：organizer-actions 14 个 PASS；session-rsvp-moved 2 个 PASS；css-conventions PASS；typecheck 通过。

- [ ] **Step 12: Commit**

```bash
git add src/components/SessionDetailDialog.tsx src/components/session-detail.css tests/dom/organizer-actions.test.tsx
git commit -m "feat: 取消约局改为原地确认，焦点落在不取消了，确认后立即提交"
```

---

### Task 5: 报名后的 toast 与撤销、两句固定说明、满员提示

**Files:**
- Modify: `src/components/SessionDetailDialog.tsx`：`:2-8`（shared imports）、Task 4 之后的 imports 段、state 段、`handleCancel` 之前（新 `announceRsvp` / `answer`）、`:123-141`（RSVP 区块）、`OrganizerActionsProps` 之前（新子组件）
- Modify: `src/components/session-detail.css`（末尾追加）
- Test: `tests/dom/organizer-actions.test.tsx`（末尾追加）；`tests/dom/session-rsvp-moved.test.tsx`（只跑）

- [ ] **Step 1: 写失败的测试**

在 `tests/dom/organizer-actions.test.tsx` 末尾追加：

```tsx
describe('answering in the dialog', () => {
  /** GETs reflect the last answer POSTed. */
  function stubAnswers(first: Rsvp, extra: Partial<SessionDetail> = {}): Call[] {
    let mine: Rsvp = first;
    return mockFetch({
      'GET /api/sessions/1': () => detail(makeSession({ ...extra, my_rsvp: mine })),
      'POST /api/sessions/1/rsvp': (call) => {
        mine = (call.body as { rsvp: Rsvp }).rsvp;
        return json(200, { session: makeSession({ ...extra, my_rsvp: mine }) });
      },
    });
  }

  it('says what an answer means, without an alert', async () => {
    stubAnswers('invited');
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeEnabled();
    expect(screen.getByText('来 = 承诺，没来会被记一笔；待定不算承诺。')).toBeInTheDocument();
    expect(screen.getByText('开局前说不来，点名结算不会记你。')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('a first answer gets a note and no undo (invited cannot be restored)', async () => {
    const calls = stubAnswers('invited');
    const user = userEvent.setup();
    renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '来' }));
    expect(await screen.findByText('已回复：来。开局前想改随时改。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/rsvp', body: { rsvp: 'going', starts_at: START } },
    ]);
  });

  it('switching answers says 已改成 and offers 撤销', async () => {
    stubAnswers('maybe');
    const user = userEvent.setup();
    renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '来' }));
    expect(await screen.findByText('已改成：来')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
  });

  it('changing to 不来 can be undone back to the previous answer', async () => {
    const calls = stubAnswers('maybe');
    const user = userEvent.setup();
    const onChanged = renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '不来' }));
    expect(await screen.findByText('收到，提前说了点名就不会记你 👍')).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1); // offered, not sent
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(await screen.findByText('已撤销')).toBeInTheDocument();
    expect(writes(calls).map((c) => c.body)).toEqual([
      { rsvp: 'out', starts_at: START },
      { rsvp: 'maybe', starts_at: START },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: '待定' })).toHaveAttribute('aria-pressed', 'true'));
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a full session closes 来 and says what to do instead', async () => {
    stubAnswers('invited', { capacity: 2, counts: { invited: 1, going: 2, maybe: 0, out: 0 } });
    renderDialog(PLAYER);
    const going = await screen.findByRole('button', { name: '来' });
    expect(going).toBeDisabled();
    expect(going).toHaveAccessibleDescription('来 2/2 满了，可以先报待定。');
    expect(screen.getByRole('button', { name: '待定' })).toBeEnabled();
    expect(screen.getByText('来 2/2 满了，可以先报待定。')).toBeInTheDocument();
  });

  it('someone already going keeps 来 when it is full', async () => {
    stubAnswers('going', { capacity: 2, counts: { invited: 1, going: 2, maybe: 0, out: 0 } });
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeEnabled();
    expect(screen.queryByText(/满了/)).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx
```

Expected：5 个 FAIL（`Unable to find an element with the text: 来 = 承诺…`、找不到 toast 文案、满员时「来」仍可点）；「someone already going keeps 来」与此前 14 个 PASS。

- [ ] **Step 3: 改 shared imports（`SessionDetailDialog.tsx:2-8`）**

Before:
```tsx
import {
  ATTENDANCE_MAP,
  RSVP_LABEL,
  SELF_RSVPS,
  SESSION_STATUS_LABEL,
} from '@shared/attendance';
import type { SelfRsvp } from '@shared/attendance';
```
After:
```tsx
import {
  ATTENDANCE_MAP,
  RSVP_LABEL,
  SELF_RSVPS,
  SESSION_STATUS_LABEL,
  isSelfRsvp,
} from '@shared/attendance';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
```

Task 4 之后的这两行 Before:
```tsx
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { useInlineConfirm } from '../lib/useInlineConfirm';
```
After:
```tsx
import { fullNotice, goingClosed, rsvpFeedback } from '../lib/sessionActions';
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
import { useInlineConfirm } from '../lib/useInlineConfirm';
import { useUndo } from '../lib/useUndo';
```

- [ ] **Step 4: 加 `useUndo`**

Before:
```tsx
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
```
After:
```tsx
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toast = useToast();
  const offerUndo = useUndo();
```

- [ ] **Step 5: 加 `announceRsvp` 与 `answer`（插在 `handleCancel` 之前）**

Before:
```tsx
  const handleCancel = async (): Promise<boolean> => {
```
After:
```tsx
  /** Toast after an answer; a change between two own answers can be undone. */
  const announceRsvp = (id: number, startsAt: string, prev: Rsvp | null, next: SelfRsvp): void => {
    const feedback = rsvpFeedback(prev, next);
    if (!feedback) return;
    if (!feedback.undoable || prev === null || !isSelfRsvp(prev)) {
      toast.show({ message: feedback.message, tone: 'ok' });
      return;
    }
    const restore: SelfRsvp = prev;
    offerUndo({
      message: feedback.message,
      // The time this answer was given to, not whatever is on screen later: if
      // the session has moved since, the server says 409 and the toast says so —
      // an answer to the old time must not land on the new one.
      undo: () => setRsvp(id, restore, startsAt),
      onUndone: () => {
        void load();
        onChanged();
      },
    });
  };

  const answer = async (next: SelfRsvp): Promise<void> => {
    if (!session) return;
    const { id, starts_at: startsAt, my_rsvp: prev } = session;
    if (await mutate(() => setRsvp(id, next, startsAt))) {
      announceRsvp(id, startsAt, prev, next);
    }
  };

  const handleCancel = async (): Promise<boolean> => {
```

（409 时 `mutate` 返回 false，不弹 toast，alert 照旧是组件内联的那一条——`session-rsvp-moved:78` 要求 alert 唯一。撤销只在用户点「撤销」时才发 POST，不会自动发。没有 `ToastProvider` 时 `useToast`/`useUndo` 是 no-op，单独渲染的测试不受影响。）

- [ ] **Step 6: RSVP 区块换成 `RsvpControls`（`SessionDetailDialog.tsx:123-141`）**

Before:
```tsx
            {canRsvp && (
              <div className="sdt__rsvp" role="group" aria-label="我的报名">
                <span className="sdt__rsvp-label">我：</span>
                {RSVP_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`btn btn--sm${
                      session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'
                    }`}
                    disabled={busy}
                    aria-pressed={session.my_rsvp === r}
                    onClick={() => void mutate(() => setRsvp(session.id, r, session.starts_at))}
                  >
                    {RSVP_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
```
After:
```tsx
            {canRsvp && (
              <RsvpControls session={session} busy={busy} onAnswer={(r) => void answer(r)} />
            )}
```

- [ ] **Step 7: 新增 `RsvpControls` 子组件（插在 `interface OrganizerActionsProps {` 之前）**

Before:
```tsx
interface OrganizerActionsProps {
```
After:
```tsx
const FULL_NOTICE_ID = 'session-detail-full';

interface RsvpControlsProps {
  session: SessionDetail;
  busy: boolean;
  onAnswer: (rsvp: SelfRsvp) => void;
}

/**
 * The panel's one set of 来 / 待定 / 不来 (session-rsvp-moved pins a single 来)
 * and what an answer commits to. 来 closes once the seats are taken — the
 * server refuses it anyway — and the notice says what to do instead.
 */
function RsvpControls({ session, busy, onAnswer }: RsvpControlsProps): JSX.Element {
  const closed = goingClosed(session);
  const notice = fullNotice(session);
  return (
    <div className="sdt__rsvp-block">
      <div className="sdt__rsvp" role="group" aria-label="我的报名">
        <span className="sdt__rsvp-label">我：</span>
        {RSVP_ORDER.map((r) => {
          const shut = r === 'going' && closed;
          return (
            <button
              key={r}
              type="button"
              className={`btn btn--sm${session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'}`}
              disabled={busy || shut}
              aria-pressed={session.my_rsvp === r}
              aria-describedby={shut && notice ? FULL_NOTICE_ID : undefined}
              onClick={() => onAnswer(r)}
            >
              {RSVP_LABEL[r]}
            </button>
          );
        })}
      </div>
      <p className="sdt__rsvp-note">来 = 承诺，没来会被记一笔；待定不算承诺。</p>
      <p className="sdt__rsvp-note">开局前说不来，点名结算不会记你。</p>
      {notice && (
        <p id={FULL_NOTICE_ID} className="sdt__rsvp-full">
          {notice}
        </p>
      )}
    </div>
  );
}

interface OrganizerActionsProps {
```

（按钮名始终是「来 / 待定 / 不来」，满员只 `disabled`，名字不变；满员提示、两句说明都是普通 `<p>`，不是 alert。顺序按 spec §3.5 线框：按钮 → 两句说明 → 满员提示。）

- [ ] **Step 8: `session-detail.css` 末尾追加**

```css

/* P0-6 — what an answer commits to, and the full notice. */
.sdt__rsvp-block {
  display: grid;
  gap: 0.4rem;
}

.sdt__rsvp-note {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.sdt__rsvp-full {
  font-size: var(--fs-sm);
  color: var(--ok);
}
```

- [ ] **Step 9: 跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx tests/dom/modal-focus.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts tests/unit/session-actions.test.ts
npm run typecheck
```

Expected：organizer-actions **20** 个 PASS；session-rsvp-moved 2 个**原样** PASS（签名不变、唯一的「来」、409 alert 原文、POST 体只有一次 `{rsvp:'going', starts_at}`）；modal-focus 4 个 PASS；两份 unit PASS；typecheck 通过；输出里没有新的 `act(...)` 警告。

- [ ] **Step 10: Commit**

```bash
git add src/components/SessionDetailDialog.tsx src/components/session-detail.css tests/dom/organizer-actions.test.tsx
git commit -m "feat: 报名后弹 toast 并可撤销，补上开局前说不来的说明和满员提示"
```

---

## 对契约的补充

契约 §3.6 的名字、签名、文件、分支一律照用；下面是契约没写到、本 PR 需要定下来的部分。

1. **`src/lib/sessionActions.ts` 多导出几项**（契约的三个函数签名不变）：
   - `goingClosed(session: SessionItem): boolean` —— 契约 `isFull` 的注释写的是「对还没报来的人禁用『来』」，这其实是两件事：`isFull` 只判断容量，`goingClosed` = `isFull && my_rsvp !== 'going'`。已经报了「来」的人满员时不该被锁住（后端 `worker/sessions.ts:537` 也放行 alreadyIn）。
   - `fullNotice(session: SessionItem): string | null` —— 满员文案也放进纯模块里，方便单测。
   - `rescheduleConsequences(session: SessionDetail): string[]` —— spec §3.5 的三条影响面。没人回复过时去掉第一条（不写「已回复的 0 人」），局里只有组织者时去掉私信那条（只写事实，spec §1.2-5）。
   - `rescheduleSlots(slots, startsAt)` —— 从 `quickSlots()` 里去掉和当前时间相同的时段（改到同一时刻后端判为没改，`worker/sessions.ts:432`）。
   - `parseCustomTime(value): CustomTime` —— 「其他时间」的解析，报错文案沿用 `SessionFormDialog.tsx:69,78` 的「时间格式不对」「选一个时间」。
   - 类型 `RsvpFeedback`、`CustomTime`。`rsvpFeedback` 的返回值和契约写的 `{ message; undoable } | null` 结构完全一样。
2. **常量 `RESCHEDULE_DM_DELAY_MIN = 3` 和 `CUSTOM_TIME_LEAD_MS = 60 * 60 * 1000`** 写在 `src/lib/constants.ts` 的 `// --- P0-6 ---` 小节（契约 §3.0 留给 P0-6 的位置）。这条文案里的「约 3 分钟」以 `server/migrations/0005_sessions.sql:151` 为准，所以在 `tests/unit/session-actions.test.ts` 里断言两边一致。没有放进 `source-hygiene.test.ts`：契约 §2.4 规定那个文件只归 P0-1/P0-5 加用例，P0-6 的文件清单里没有它。它也不是 P0-5 的 `FILED_DM_GRACE_MS`（契约 §3.5 特别提醒过这两个 3 分钟不是一回事）。
3. **撤销用的是「这次回复时的 starts_at」**，契约写的是「最新 starts_at」。服务端在成功的那次 POST 里刚确认过这个时间是当前时间，所以它就是写入那一刻最新的值。撤销时**不**改用屏幕上之后才刷新出来的时间，因为局被改过时间后，大家的回复都会被重置成 invited（`worker/sessions.ts:463-467`）。这时如果用新时间去撤销，就会把对旧时间的回答写到新时间上。用旧时间撤销，服务端会返回 409，`useUndo` 再显示「撤销没成功：约局时间已经改了，请按新的时间重新确认」，这才是对的。
4. **spec 没给原文、本 PR 新写的文案**（PR 描述里要列出来请机主过目）：
   - 改期成功后的 toast：`已改到 ${formatWhen(starts_at)}。`（例：「已改到 今天 22:00。」）。spec §3.5 和 §4.1 ⑥ 都没写改期后的反馈；不给反馈的话，读屏用户不知道改成没改成。
   - RescheduleSheet：还没选出有效时间时，影响面的标题写「改了之后：」（取自 spec §5 语气表「改了之后，已回复的 4 人要重新确认」），确认按钮写「改时间」；提交中按钮显示「提交中…」（沿用 `PlayerDetail.tsx:335`）；单选组的隐藏 legend 是「新的时间（本地时间）」；网络错误的兜底文案是「操作失败」（沿用 `SessionDetailDialog.tsx:64`）。
   - ConfirmInline 的 `busyLabel`：「取消中…」（照 `撤案中…`/`解绑中…` 的格式）。
   - 触发按钮从「取消约局」改名为「取消这局」（契约 §3.6、spec §3.5）。旧名字没有被任何前端测试锁定；`tests/worker/sessions.test.ts:182` 的 /取消约局/ 匹配的是后端报错文案，不受影响。
5. **取消成功后焦点落到对话框标题**：给 `<h2 id="session-detail-title">` 加 `ref` 和 `tabIndex={-1}`。取消成功后，确认框和触发按钮会一起卸载（局的状态变成 cancelled），焦点如果不安排就会掉到 body 上。`useInlineConfirm.close()` 的约定是「不移动焦点」，所以由调用方负责。
6. **不新增组件文件**：`RsvpControls`、`OrganizerActions`、`CancelSessionControl` 是 `SessionDetailDialog.tsx` 内部不导出的函数，这样既没超出契约 §2.3 的文件清单，又把主函数拆小了。拆完后文件约 410 行（上限 800）。P1-1 加 `variant` 时，可以再把它们挪成独立文件。
7. **已知问题（不在本 PR 修，PR 描述里必须写明）**：约局标题是创建时由服务端按开局时间合成的（「周三 21:00 开黑」，`worker/sessions.ts:310-313`），而 `updateSession` 改时间时**不会重新合成标题**（`worker/sessions.ts:424-427` 只在传了 title 时才改）。所以从网页改期之后，详情页的 h2 还是旧时间，只有上面那行 `sdt__when` 显示新时间。前端补不了：前端不知道看板时区，自己合成的标题对别的时区不对。建议放进 P2-3（或单独开一个后端小 PR）：在 `updateSession` 里，如果 `moved && input.title === undefined && isSynthesizedTitle(row.title)`，就用 `synthesizeTitle(startsAt, offsetHours)` 重新生成（route 层要把 `RESET_TZ_OFFSET` 传进来，照 `createSession` 的做法）。这需要机主拍板，本计划不实施。
8. **测试只假 `Date`**：`vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })` + `vi.setSystemTime(new Date(2026, 9, 28, 10, 0))`。这样 `quickSlots()` 在任何机器、任何时区下都给出同一组时段，而 `setTimeout` 仍是真的，user-event、`waitFor` 和 toast 计时都不用 `advanceTimers`。契约 §4 的写法（假全部计时器 + `advanceTimers`）是给要快进计时器的测试用的，这里用不上。已在 scratch 里核实：本地 10:00 时时段恒为 `今晚 20:00 / 今晚 21:00 / 今晚 22:00 / 明晚 20:00 / 周五 20:00 / 周六 20:00`，`formatDateTime`、`formatWhen`、`toDateTimeLocalValue` 的输出与断言一致。
9. **验证情况**（v2 审查时重跑）：把本计划 Task 1–5 的代码逐字套进 d72e11b 的副本（`/tmp/claude-redesign/p0/p0-6-stage`），Modal 栈 / ConfirmInline / useInlineConfirm / `tests/dom/setup.ts` 取自 P0-2 计划的沙盒（`p0-2-sandbox`），Toast / useUndo / `constants.ts` 取自 P0-3 计划的沙盒（`p0-3-scratch`）。结果：`npm run typecheck` 三套 tsconfig 全过，Task 1–4 每一步提交后也各自过 `tsc`；unit 15 个文件 199 个用例全过（基线 178 + 21）；dom 9 个文件 74 个用例全过（基线 54 + 20），其中 `session-rsvp-moved` 2/2、`modal-focus` 4/4 原样通过；organizer-actions、session-rsvp-moved、modal-focus 三份的输出里没有 `act(...)` 警告；Task 3/4/5 的 red 步骤分别是 2/4/5 个失败，失败原因和下文写的一致；`TZ=UTC`、`America/Los_Angeles`、`Asia/Shanghai`、`Pacific/Kiritimati`（+14）、`Pacific/Pago_Pago`（−11）下 unit 21/21、dom 20/20。P0-1 的 `css-conventions.test.ts` 在这个沙盒里没有，CSS 当时按契约 §3.1 人工核过；之后跨 PR 一致性检查把 P0-1…P0-6 六份计划按推荐顺序合进同一个副本（`/tmp/claude-redesign/p0/final/compose/repo`），`css-conventions` 13/13、organizer-actions 20/20、session-actions 21/21 都在真实的 P0-2/P0-3 v2 实现上通过（见 README「跨 PR 一致性检查记录」）。真实的 P0-2/P0-3 合并后，如果语义和契约不一致（例如 `useUndo` 撤销成功后的文案不是「已撤销」），以契约为准去修上游，不改本计划的断言。

---

## 收尾

- [ ] **全量验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx tests/dom/modal-focus.test.tsx
# 本 PR 不改 worker，但它依赖的后端行为由这两份锁着，顺手确认：
npx vitest run --config vitest.workers.config.ts tests/worker/sessions.test.ts
npx vitest run --config vitest.workers.config.ts tests/worker/invites.test.ts
npm run build
```

Expected：typecheck 通过；unit 比 Task 0 基线多 1 个文件 / 21 个用例（按推荐顺序 19 / 270），全部通过；dom 比基线多 1 个文件 / 20 个用例（按推荐顺序 13 / 129），全部通过，`session-rsvp-moved` 原样通过；两份 worker 测试通过；`vite build` 成功。（`npm run test:pg` / `test:server` 不在本地跑；本 PR 不碰 server，CI 里照常要绿。）

- [ ] **浏览器手动检查（`npm run dev:web` 配本地 worker，用组织者、普通选手、管理员三个账号）**

375px（手机）：
- [ ] 组织者打开一局开局前的约局 → 操作区顺序是「改时间 → 提示 → 取消这局」，「取消这局」在最后，次要样式。
- [ ] 点「改时间」→ sheet 贴底；顶部 sticky 栏里有抓手、标题「改到什么时候？」和 44px 的 ✕；内容超出时内部滚动，底部不被 Home 指示条挡住；焦点在「先不改」上。
- [ ] 「现在：…（本地时间）」；时段 chip 能换行、点按区域 ≥44px；当前时间不在可选项里；选中的 chip 除了变色还加粗；用键盘 Tab 到 chip 时有 `--focus` 焦点环。
- [ ] 影响面三条文案和 spec §3.5 一致，人数 = 已回复的人数减去组织者。
- [ ] 「其他时间 ▸」展开后出现 datetime-local，字号 16px（iOS 不缩放）；清空后点确认，sheet 里出现「选一个时间」。
- [ ] Esc / ✕ / 「先不改」都只关 sheet，详情弹窗还在，焦点回到「改时间」。
- [ ] 改成功后：sheet 关闭，详情顶部时间更新，底部 toast「已改到 …。」在安全区上方；约局列表也刷新了。（已知问题：h2 标题还是旧时间，见补充第 7 条。）
- [ ] 点「取消这局」→ 原地出现「取消这局？」+ 说明 + 「不取消了 / 确认取消」，占整行，「确认取消」是红色描边；焦点在「不取消了」；点「不取消了」后焦点回到「取消这局」。
- [ ] 点「确认取消」→ 立即取消；toast「这局已取消。」；状态 chip 变成已取消；操作区消失；焦点在标题上。
- [ ] 普通选手打开同一局（容量未满）→ 「我：来 / 待定 / 不来」下面有两句固定说明，颜色是 `--muted`，不刺眼。
- [ ] 第一次点「来」→ toast「已回复：来。开局前想改随时改。」，没有撤销按钮；再点「不来」→ toast「收到，提前说了点名就不会记你 👍」+「撤销」，点撤销后回到「来」，并出现「已撤销」。
- [ ] 把容量设到刚好满（PATCH capacity 或建局时设）→ 没报名的人看到「来」置灰，下面一行绿色「来 N/N 满了，可以先报待定。」；已经报了「来」的人不受影响。

1280px（桌面）：
- [ ] RescheduleSheet 在桌面居中显示（sheet 在 ≥601px 时和 center 一样），宽度合适；两层弹窗的阴影和遮罩叠加正常。
- [ ] 鼠标悬停 chip 和按钮时没有只在 hover 才出现的信息。
- [ ] 管理员（不是组织者）打开别人的局：同时看到报名按钮和「改时间 / 取消这局」。
- [ ] 已开局的局：组织者只看到「点名结算」，没有「改时间」和「取消这局」。
- [ ] 打开 DevTools 的 forced-colors 模拟：chip 和按钮的边框、焦点环都看得见。
- [ ] 控制台没有 CSP 报错（本 PR 没有内联 style 字符串，没有 `<style>`）。

（可选，staging 上 Node + PG）：改期约 3 分钟后，绑了 Discord 的被邀请人收到一条「🔁 约局改时间了」，连改两次也只收到一条；取消后，说了来、待定的人收到取消私信，说了不来的人收不到。

---

## 自查

| spec / 契约条目 | 覆盖的 Task |
|---|---|
| 改时间：在现有 SessionDetailDialog 里接上 `PATCH /api/sessions/:id`（`updateSession`，不改 api.ts），只发 `starts_at` | Task 2（PATCH 体断言）、Task 3（入口） |
| 改时间是嵌套层（P0-2 sheet + 栈）：Esc 只关上层，关闭后焦点回到触发按钮 | Task 3（Esc 用例、焦点用例） |
| 写明影响面「已回复的 N 人要重新确认」，N = going + maybe + out − 组织者（`worker/sessions.ts:463-467`） | Task 1（`rescheduleImpact`、`rescheduleConsequences`）、Task 2（文案用例） |
| 私信合并的「约 3 分钟」和 SQL 一致 | Task 1（SQL 断言） |
| 「开局提醒和点名提醒会跟着改」 | Task 1、Task 2 |
| P2 之前时段按浏览器时区生成（`quickSlots`），标「本地时间」；「其他时间」用 `datetime-local` + `toDateTimeLocalValue` | Task 1（`rescheduleSlots`、`parseCustomTime`）、Task 2 |
| 焦点默认停在「先不改」；按钮「改到 {label}」 | Task 2 |
| 取消前原地确认（ConfirmInline），question「取消这局？」、说明原文、「不取消了 / 确认取消」、`tone="danger"`、焦点落在「不取消了」 | Task 4 |
| 取消确认后立即提交，不做延迟撤回；成功 toast「这局已取消。」 | Task 4 |
| 取消按钮在操作区最后、次要样式 | Task 4（`OrganizerActions` 顺序；「an admin who is not the organizer」用例断言「取消这局」在「改时间」之后）、手动检查 |
| RSVP toast：首次「已回复：X。开局前想改随时改。」/ 改成不来「收到，提前说了点名就不会记你 👍」/ 其余「已改成：X」 | Task 1（`rsvpFeedback` 表）、Task 5 |
| 撤销：只在两个自己的回答之间切换时给；第一次回复不给（`invites.test.ts:206`）；撤销 = 再调一次 `setRsvp(prev)`，不自动发 POST | Task 1、Task 5（撤销用例、POST 计数） |
| 固定两句「来 = 承诺，没来会被记一笔；待定不算承诺。」「开局前说不来，点名结算不会记你。」（M20） | Task 5 |
| 满员提示「来 N/N 满了，可以先报待定。」，「来」disabled 但按钮名不变 | Task 1（`isFull`/`goingClosed`/`fullNotice`）、Task 5 |
| `canManage` 保持现有判断（组织者或管理员） | Task 3/4（未改 `:79`）、Task 4「who manages it」三个用例 |
| `session-rsvp-moved`：两个组件签名不变、每个面板只有一个「来」、409 alert 原文不变、原样通过 | Task 3/4/5 每次都跑；Task 5 Step 9 |
| 409 由组件内联 `role="alert"` 显示，不进 toast；新增的提示都不是 alert | Task 5（「without an alert」用例）、`mutate` 409 分支逐字保留 |
| 单独渲染（无 ToastProvider）照常工作 | `session-rsvp-moved` 单独渲染通过 |
| 新增 `organizer-actions.test.tsx` | Task 2–5（共 20 个用例） |
| 新增 `session-actions.test.ts` | Task 1（21 个用例） |
| `modal-focus.test.tsx` 原样通过 | Task 5 Step 9、收尾 |
| CSP：无内联 style 字符串、无 `<style>`；DOM 顺序 = 视觉顺序；不用 CSS `order` | Task 2/4/5 的 CSS 与 JSX；手动检查 |
| P0-1 CSS 约定（断点、hover、焦点、不写 `outline: none`） | Task 2 Step 4、Task 4/5 CSS；Task 4 Step 11 跑 `css-conventions` |
| 深链 `?session=` 行为不变 | 未碰 `App.tsx`；收尾全量 dom（`deep-link.test.tsx`） |
| H12（入口）、M15（取消约局部分）、M20 | Task 2–3、Task 4、Task 5 |
