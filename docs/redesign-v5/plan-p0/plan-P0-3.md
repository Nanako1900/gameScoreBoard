# P0-3 数据不崩、Toast 与撤销原语、倒计时 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页刷新失败时保留旧数据并用 `role=status` 局部提示（M11），页面重新可见 / 跨过 `nextResetAt` 时按 key 精确刷新，标签页标题显示待办数，Header 倒计时改为分钟级，并提供 `Toast` 与 `useUndo` 两个原语给 P0-5 / P0-6 用。

**Architecture:** 把 `App.tsx:47-94` 的 `CoreData`/`loadCore` 挪到 `src/lib/coreData.ts`，改成「首次 `Promise.all`、之后按 key `Promise.allSettled` 合并成新对象」；`src/lib/useCoreData.ts` 持有 `loading | error | ready(+stale)` 状态并把刷新串行排队。可见性、跨重置点、标题三件事各是一个小 hook，判断逻辑全部放在纯模块（`refreshPolicy.ts`、`tabTitle.ts`、`time.ts` 追加函数）里单测。`ToastProvider` 包在 `App` 外层，视口 portal 到 `<body>`（不在会被 Modal 设 inert 的 `#root` 里）。

**Tech Stack:** React 18.3、TypeScript 5.9、Vite 6、Vitest 3.2（unit = node，dom = jsdom + RTL 16 + user-event 14）、纯 CSS（P0-1 的 token 与约定）。

**依赖:** 硬依赖 **P0-1**（`claude/p0-1-foundation`）已合进 main：`toast.css`/`stale-notice.css` 用到 P0-1 新增的 `--z-toast`、`--safe-bottom`、`--tap-min`、`--fs-sm`、`--ok`、`--danger`、`--info`、`--attn`，并受 P0-1 的 `tests/unit/css-conventions.test.ts` 约束（断点只用四种写法、`:hover` 包进 `@media (hover: hover)`、不写 `outline: none`）。不依赖 P0-2（不碰 `Modal.tsx`、`tests/dom/setup.ts`；toast 状态在 Provider 内，不是模块级，不需要测试重置函数）。**提供**（契约 §3.3）：`src/lib/constants.ts`（P0-3 小节）、`coreData.ts`（`CoreKey`/`CoreData`/`ALL_CORE_KEYS`/`CHANGE_KEYS`/`VISIBLE_KEYS`/`loadInitialCore`/`reloadCore`/`ReloadResult`）、`useCoreData`（及 `CoreState`/`StaleInfo`/`CoreDataApi` 类型）、`useNow`、`formatResetCountdown`、`formatTimeLeft`、`refreshPolicy`（`shouldRefreshOnVisible`/`visibleRefreshKeys`/`resetCrossed`）、`useVisibleRefresh`、`tabTitle`（`BASE_TITLE`/`tabTitle`/`todoCount`）、`useTabTitle`、`Toast`（`ToastProvider`/`useToast` 及类型）、`useUndo`、`StaleNotice`；App 外层 `<ToastProvider><AppMain /></ToastProvider>`。P0-4、P0-5、P0-6 消费这些。

**分支:** `claude/p0-3-data-resilience`（P0-1 合并后：`git fetch origin && git switch -c claude/p0-3-data-resilience origin/main`）

---

## 对契约的补充

以下各项是契约没写到、实施时必须定下来的地方。契约里已有的名字一律不改。

1. **新增纯模块 `src/lib/coreKeys.ts`**，放 `CoreKey`、`ALL_CORE_KEYS`、`CHANGE_KEYS`、`VISIBLE_KEYS`；`coreData.ts` 原样 re-export，所以从 `./lib/coreData` 导入这些名字照样能用。原因：`refreshPolicy.ts` 要用 `VISIBLE_KEYS` 和 `CoreKey`，而它要被 `tests/unit` 导入；`tests/unit` 由 `tsconfig.worker.json` 做类型检查（没有 `vite/client` 类型），`coreData.ts` 导入 `src/api.ts`（读 `import.meta.env`），哪怕只是 `import type` 也会把 `api.ts` 拉进 worker 那次 tsc（契约 §4「会被 tests/unit 导入的模块必须是纯模块」）。
2. **`tabTitle.ts` 的 `todoCount` 参数类型写成结构等价的 `TodoSource`**（`{ me: User | null; invites: readonly unknown[]; pending: PendingCounts }`），不写 `Pick<CoreData, …>`，原因同上。`CoreData` 照样能直接传进去。
3. **`refreshPolicy.ts` 追加纯函数 `staleMessage(sinceMs, now, maintenance)`**，产出契约 §3.3 定的两句文案（单测锁住）。`useCoreData` 在刷新失败的那一刻算好写进 `stale.message`；再次失败（重试、可见性刷新）时重新算；之后只刷新了别的部分（比如周报）时沿用原文案。
4. **`time.ts` 额外导出 `RESET_PENDING_LABEL = '回血中…'`**，`formatResetCountdown` 用它；P0-5 的 `healPreview` 的 `healing` 文案可以直接引用，避免两处各写一遍。`formatResetCountdown` 的细节：分钟**向上取整**（还剩 30 秒显示 `00:01`，不出现 `00:00` 或负数）；目标时间无法解析时返回 `'—'`（和 Header 没有 config 时一致）。
5. **新增 hook `src/lib/useResetWatch.ts`**：契约说「跨过 `nextResetAt` 时（由分钟 tick 检测）」但没给文件。它用一个 `COUNTDOWN_TICK_MS` 的 interval 调 `resetCrossed`，**不触发重渲染**（不在 AppMain 里放 `useNow`，免得整页每分钟重渲染一次）；每个 `nextResetAt` 值只触发一次。
6. **跨重置点的刷新拆成两次**：契约写 `refresh(['config', 'leaderboard', 'me'])`；本计划写 `refresh(['config'])` 再 `refresh(['leaderboard', 'me'])`。`useCoreData` 的刷新是串行排队的，所以榜单和本人会在 `GET /api/config` 返回之后才去读——回血正是挂在 `GET /api/config` 上触发的（`worker/routes.ts:210-229`）。回血在 `waitUntil` 里异步跑，紧接着读榜单仍可能早于回血落库，这是尽力而为；下一次可见性刷新会补上。
7. **`useCoreData` 的刷新串行执行**（文件内的小 hook `useSerialQueue`）：每次刷新都从上一次留下的数据开始合并，两次重叠的刷新不会把对方刚拿到的新数据覆盖回旧的。`setMe` 是立即生效的乐观更新；如果它发生在一次进行中的刷新期间，会被那次刷新的结果覆盖，所以 `handleMeUpdated` 紧接着 `refresh(CHANGE_KEYS)`（含 `'me'`）。另外用一个 `started` ref 保证 StrictMode 开发环境下首屏只加载一次。
8. **刷新时失败的后续请求保留旧值**：`'me'` 键的 `/api/me/invites` 失败时，首次加载照旧退回 `[]`，刷新时保留上一次的 `invites`；`'report'` 键同理（首次退回 `null`，刷新时保留上一次的 report）。`reloadCore` 在一个部分都没拿到时返回 `prev` 本身（引用不变，`trends`/`counts` 的 memo 不重算）。新增导出 `interface ReloadResult`（就是契约里 `reloadCore` 返回值的那个内联类型）。
9. **StaleNotice 的「重试」= `refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))`**：重置点之前它就等于契约写的 `VISIBLE_KEYS`；已经过了重置点（例如重拉 config 失败）时会带上 `'config'`，否则重试永远补不回 config。
10. **`shouldRefreshOnVisible` 用严格大于**（spec §5 第 10 条「距上次超过 60 秒」）；`lastRefreshAt` 不是有限数时返回 `true`。`useVisibleRefresh` 自己记「上次触发时间」（挂载时初始化），隐藏事件本身从不触发。
11. **`useNow` 在页面重新可见时也 tick 一次**：后台标签页的定时器会被节流，电脑睡醒后倒计时不能停在旧的那一分钟。
12. **管理员重写周报**（`App.tsx:337-346`，按钮名「换个说法」/「重写中…」，`WeeklyReportCard.tsx:84`）：逻辑从 JSX 里的内联箭头挪成 `AppMain` 里的 `handleRegenerate(week)`（JSX 只剩 `() => handleRegenerate(report.week_start)`，不再在 JSX 深处嵌套 then/finally）；成功后改为 `refresh(['report'])`（契约 §3.3）；失败时原来是未处理的 rejection，现在弹一条 `tone: 'error'` 的 toast：`战报没换成新说法：${ApiError.message}`，非 ApiError 时「战报没换成新说法，请稍后重试」（页面上这张卡叫「战报」，spec 没给这句文案，按 §5「报错先说影响」新写）。这是 `useToast` 在 App 里的第一个调用点；周报卡不在弹窗里，toast 一定读得到。
13. **`Toast.show` 的输入校验**：`message` trim 后为空时不显示、返回 `-1`；`durationMs` 不是正的有限数时用默认值。
14. **`CoreState` 的 `stale` 比契约多一个字段 `keys`**（还没成功重拉的部分；`StaleInfo` 导出）。规则：一次刷新之后，「这次失败的 key」∪「以前失败、这次没重拉的 key」为空才清掉提示；否则提示留着（这次没有新失败时沿用原文案）。`loadedAt` 只在这次刷新覆盖了全部 `VISIBLE_KEYS` 时前移。原因：周报重写成功后的 `refresh(['report'])`、跨重置点的 `refresh(['config'])` 如果顺手清掉提示、把 `loadedAt` 改成现在，榜单明明还是旧的，页面却不再提示、「N 分钟前」也算错了。契约里的 `since`/`message` 照旧，只读这两个字段的地方不受影响。
15. **已知限制（不在本 PR 修）**：可见性刷新会 `setSessionsKey(n => n + 1)`，而 `SessionsPanel` 每次重载都会先显示「加载中…」、失败时用它自己的 `role="alert"`（`SessionsPanel.tsx:41-52,105-108`）。契约 §5 规定 P0 不改 SessionsPanel（`session-rsvp-moved` 锁定），这两点留给 P3-2 的大厅时间线。另外：客户端时钟比服务器快、且恰好跨过重置点时，重拉回来的 `nextResetAt` 不变，倒计时会停在「回血中…」直到下一次可见性刷新（契约要求每个值只触发一次）。再有：点 StaleNotice 的「重试」成功、或点 toast 的按钮之后，按钮随提示一起消失，焦点落回 `<body>`；弹窗打开时 toast 在焦点陷阱之外，`aria-modal="true"`（`Modal.tsx:140`）还可能让读屏软件不读弹窗外的 toast——所以 toast 只做补充反馈，弹窗里的错误继续用组件内联的 `role="alert"`（契约 §3.3），这两点写进 `Toast.tsx` 的注释。
16. `src/components/header.css` 不需要改（「2天 06:14」比原来的秒级更短）。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/constants.ts` | 新建 | 前端专用常量，P0-3 小节（toast 时长、可见性刷新间隔、倒计时 tick、feed/待说明条数） |
| `src/lib/time.ts` | 修改（末尾追加） | `RESET_PENDING_LABEL`、`formatResetCountdown`、`formatTimeLeft`；已有函数一个不动 |
| `src/lib/tabTitle.ts` | 新建（纯） | `BASE_TITLE`、`tabTitle`、`todoCount` |
| `src/lib/coreKeys.ts` | 新建（纯） | `CoreKey` 与三组 key |
| `src/lib/refreshPolicy.ts` | 新建（纯） | `shouldRefreshOnVisible`、`visibleRefreshKeys`、`resetCrossed`、`staleMessage` |
| `src/lib/useNow.ts` | 新建 | 对齐到整 interval 的时钟 hook（取代 `Header.tsx:17-24` 的局部 `useNow`） |
| `src/components/Header.tsx` | 修改 | 倒计时改 `useNow(COUNTDOWN_TICK_MS)` + `formatResetCountdown`；props 不变 |
| `src/components/Toast.tsx` | 新建 | `ToastProvider`、`useToast`、toast 视口与单条 toast；文件内 `usePausableTimeout`（悬停/焦点暂停的计时） |
| `src/components/toast.css` | 新建 | `.toasts` / `.toast` 样式 |
| `src/lib/useUndo.ts` | 新建 | 带「撤销」的 toast，撤销结果再报一条 |
| `src/lib/coreData.ts` | 新建 | `CoreData`、`loadInitialCore`、`reloadCore`（按 key、allSettled、不可变合并） |
| `src/lib/useCoreData.ts` | 新建 | 首页数据状态机（loading / error / ready + stale，`StaleInfo` 带 `keys`），`useSerialQueue` 串行刷新，`setMe` |
| `src/lib/useVisibleRefresh.ts` | 新建 | `visibilitychange` → 距上次超过 60 秒才回调 |
| `src/components/StaleNotice.tsx` | 新建 | 「没刷新出来…」提示 + 「重试」，`role="status"` |
| `src/components/stale-notice.css` | 新建 | `.stale` 样式 |
| `src/lib/useResetWatch.ts` | 新建 | 分钟 tick 检测跨过 `nextResetAt`，每个值只回调一次 |
| `src/lib/useTabTitle.ts` | 新建 | 写 `document.title`，卸载时还原 |
| `src/App.tsx` | 修改 | 外层 `ToastProvider`；数据层换成 `useCoreData`；`handleChanged` 只失效 `CHANGE_KEYS`；可见性、跨重置点、标题三个 hook；main 顶部 StaleNotice；周报重写抽成 `handleRegenerate`（只刷新 report，失败弹 toast） |
| `tests/unit/countdown.test.ts` | 新建 | `formatResetCountdown`、`formatTimeLeft`、`tabTitle`、`todoCount` |
| `tests/unit/refresh-policy.test.ts` | 新建 | key 集合、刷新策略、stale 文案 |
| `tests/dom/toast.test.tsx` | 新建 | Toast 与 useUndo |
| `tests/dom/app-refresh.test.tsx` | 新建 | App 级：分钟倒计时、首屏 URL 集合、管理员写后失效、周报重写（只刷新 report / 失败 toast）、可见性刷新、刷新失败保留旧数据（含 503、别的部分刷新成功时提示不消失）、跨重置点、标签页标题 |

不改：`src/api.ts`、`src/types.ts`、`Modal.tsx`、`SessionsPanel.tsx`、`tests/dom/setup.ts`、任何已有测试。

---

### Task 1: 前端常量与分钟级倒计时格式化

**Files:**
- Create: `src/lib/constants.ts`
- Modify: `src/lib/time.ts`（在文件末尾 `:153` 之后追加；`:1-153` 不动）
- Test: `tests/unit/countdown.test.ts`（新建）

- [ ] **Step 1: 写失败的测试** —— 新建 `tests/unit/countdown.test.ts`：

```ts
// P0-3: the minute-level reset countdown, prose time-left, and the tab title.
import { describe, expect, it } from 'vitest';
import { formatResetCountdown, formatTimeLeft, RESET_PENDING_LABEL } from '../../src/lib/time';

const TARGET = '2026-11-01T16:00:00.000Z';
const T = Date.parse(TARGET);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatResetCountdown', () => {
  it('days, then hours:minutes', () => {
    expect(formatResetCountdown(TARGET, T - (2 * DAY + 6 * HOUR + 14 * MIN))).toBe('2天 06:14');
    expect(formatResetCountdown(TARGET, T - (6 * HOUR + 14 * MIN))).toBe('06:14');
  });

  it('rounds up to the minute, so the last seconds read 00:01', () => {
    expect(formatResetCountdown(TARGET, T - (6 * HOUR + 13 * MIN + 20_000))).toBe('06:14');
    expect(formatResetCountdown(TARGET, T - 30_000)).toBe('00:01');
    expect(formatResetCountdown(TARGET, T - 1)).toBe('00:01');
  });

  it('carries a full day', () => {
    expect(formatResetCountdown(TARGET, T - (7 * DAY - 31_000))).toBe('7天 00:00');
  });

  it('at and after the reset: 回血中…, never a negative number', () => {
    expect(RESET_PENDING_LABEL).toBe('回血中…');
    expect(formatResetCountdown(TARGET, T)).toBe('回血中…');
    expect(formatResetCountdown(TARGET, T + 5 * HOUR)).toBe('回血中…');
  });

  it('an unparsable target reads —', () => {
    expect(formatResetCountdown('soon', T)).toBe('—');
  });

  it('reads SQLite timestamps as UTC', () => {
    expect(formatResetCountdown('2026-11-01 16:00:00', T - 5 * MIN)).toBe('00:05');
  });
});

describe('formatTimeLeft', () => {
  it('the largest whole unit', () => {
    expect(formatTimeLeft(TARGET, T - (2 * DAY + 6 * HOUR))).toBe('还有 2 天');
    expect(formatTimeLeft(TARGET, T - (5 * HOUR + 59 * MIN))).toBe('还有 5 小时');
    expect(formatTimeLeft(TARGET, T - (12 * MIN + 30_000))).toBe('还有 12 分钟');
    expect(formatTimeLeft(TARGET, T - 59_000)).toBe('还有不到 1 分钟');
  });

  it('passed or unparsable: empty', () => {
    expect(formatTimeLeft(TARGET, T)).toBe('');
    expect(formatTimeLeft(TARGET, T + MIN)).toBe('');
    expect(formatTimeLeft('soon', T)).toBe('');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/countdown.test.ts
```
预期：FAIL，8 个用例全红：`TypeError: (0 , formatResetCountdown) is not a function`、`(0 , formatTimeLeft) is not a function`，以及 `expected undefined to be '回血中…'`（这三个导出还不存在）。

- [ ] **Step 3: 新建 `src/lib/constants.ts`**（契约 §3.0 的 P0-3 小节原文；P0-4/5/6 以后各自在末尾追加带标题的小节）：

```ts
// src/lib/constants.ts — frontend-only timings and thresholds. Domain numbers live in shared/.

// --- P0-3 ---
/** A toast without an action disappears after this long. */
export const TOAST_DURATION_MS = 5_000;
/** A toast with an action (撤销) stays at least this long (spec §6.4). */
export const TOAST_ACTION_MIN_MS = 8_000;
export const TOAST_MAX_VISIBLE = 3;
/** Coming back to the tab refetches only when the last refresh is older than this. */
export const VISIBLE_REFRESH_MIN_MS = 60_000;
/** Header / MyScoreLine countdowns tick once a minute (spec §2.1). */
export const COUNTDOWN_TICK_MS = 60_000;
/** Feed size the home page loads — must stay 50: tests pin GET /api/records?limit=50. */
export const CORE_FEED_LIMIT = 50;
export const PENDING_STATEMENTS_LIMIT = 20;
```

- [ ] **Step 4: 在 `src/lib/time.ts` 末尾（`lastWeekStartOf` 之后）追加**（复用文件里已有的 `MINUTE`/`HOUR`/`DAY`/`pad2`/`parseTimestamp`）：

```ts
/** Shown in place of the reset countdown once nextResetAt has passed and config is being refetched. */
export const RESET_PENDING_LABEL = '回血中…';

/**
 * Header countdown to the weekly reset: '2天 06:14' | '06:14' | '回血中…' (passed).
 * Minute precision, rounded UP so the last minute reads '00:01', never '00:00'
 * or a negative number. An unparsable target reads '—', like a missing config.
 */
export function formatResetCountdown(targetIso: string, now: number = Date.now()): string {
  const target = parseTimestamp(targetIso);
  if (Number.isNaN(target)) return '—';
  const remaining = target - now;
  if (remaining <= 0) return RESET_PENDING_LABEL;
  const totalMinutes = Math.ceil(remaining / MINUTE);
  const days = Math.floor(totalMinutes / (DAY / MINUTE));
  const hours = Math.floor((totalMinutes % (DAY / MINUTE)) / (HOUR / MINUTE));
  const clock = `${pad2(hours)}:${pad2(totalMinutes % (HOUR / MINUTE))}`;
  return days > 0 ? `${days}天 ${clock}` : clock;
}

/** Prose time left: '还有 2 天' | '还有 5 小时' | '还有 12 分钟' | '还有不到 1 分钟' | '' (passed). */
export function formatTimeLeft(targetIso: string, now: number = Date.now()): string {
  const target = parseTimestamp(targetIso);
  const remaining = Number.isNaN(target) ? 0 : target - now;
  if (remaining <= 0) return '';
  if (remaining < MINUTE) return '还有不到 1 分钟';
  if (remaining < HOUR) return `还有 ${Math.floor(remaining / MINUTE)} 分钟`;
  if (remaining < DAY) return `还有 ${Math.floor(remaining / HOUR)} 小时`;
  return `还有 ${Math.floor(remaining / DAY)} 天`;
}
```

- [ ] **Step 5: 运行，确认通过，且已有时间测试不受影响**

```bash
npx vitest run --config vitest.config.ts tests/unit/countdown.test.ts tests/unit/client-time.test.ts tests/unit/time.test.ts
```
预期：PASS（3 个文件全部通过；`client-time.test.ts:54` 的「还剩 12 小时 0 分」照旧）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/constants.ts src/lib/time.ts tests/unit/countdown.test.ts
git commit -m "feat: 新增前端常量与分钟级回血倒计时格式化"
```

---

### Task 2: 标签页标题与待办计数（纯函数）

**Files:**
- Create: `src/lib/tabTitle.ts`
- Test: `tests/unit/countdown.test.ts`（追加）

- [ ] **Step 1: 写失败的测试** —— 在 `tests/unit/countdown.test.ts` 第 3 行（`import { formatResetCountdown, … } from '../../src/lib/time';`）之后插入两行：

```ts
import { BASE_TITLE, tabTitle, todoCount } from '../../src/lib/tabTitle';
import type { User } from '../../src/types';
```

并在文件末尾追加：

```ts
const ME: User = {
  id: 'm',
  username: '我',
  oauth_username: 'm',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 90,
  created_at: '2026-10-01 00:00:00',
};

describe('tabTitle', () => {
  it('no count: the bare title', () => {
    expect(BASE_TITLE).toBe('EDG 信誉分');
    expect(tabTitle(0)).toBe('EDG 信誉分');
    expect(tabTitle(-1)).toBe('EDG 信誉分');
    expect(tabTitle(Number.NaN)).toBe('EDG 信誉分');
  });

  it('a count in front', () => {
    expect(tabTitle(4)).toBe('(4) EDG 信誉分');
  });
});

describe('todoCount', () => {
  const pending = { statements: 2, appeals: 1 };

  it('signed out: 0', () => {
    expect(todoCount({ me: null, invites: [1, 2], pending })).toBe(0);
  });

  it('invites + statements for a player', () => {
    expect(todoCount({ me: ME, invites: [1], pending })).toBe(3);
  });

  it('admins also count appeals to review', () => {
    expect(todoCount({ me: { ...ME, is_admin: true }, invites: [1], pending })).toBe(4);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/countdown.test.ts
```
预期：FAIL，整个文件加载失败（`Tests  no tests`）：`Error: Cannot find module '../../src/lib/tabTitle' imported from …/tests/unit/countdown.test.ts`。

- [ ] **Step 3: 新建 `src/lib/tabTitle.ts`**（纯模块：只 `import type` 自 `src/types.ts`，不碰 `document`）：

```ts
// The browser tab's title: '(N) EDG 信誉分' while something waits on you. Pure.
import type { PendingCounts, User } from '../types';

export const BASE_TITLE = 'EDG 信誉分';

/** 0 → 'EDG 信誉分'; 4 → '(4) EDG 信誉分'. */
export function tabTitle(count: number): string {
  return Number.isFinite(count) && count > 0 ? `(${Math.floor(count)}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Structurally Pick<CoreData, 'me' | 'invites' | 'pending'>, without importing the fetch client. */
export interface TodoSource {
  me: User | null;
  invites: readonly unknown[];
  pending: PendingCounts;
}

/** Unanswered invites + statements owed (+ appeals to review, admins only). Signed out: 0. */
export function todoCount({ me, invites, pending }: TodoSource): number {
  if (!me) return 0;
  return invites.length + pending.statements + (me.is_admin ? pending.appeals : 0);
}
```

（`/api/me` 的 `pending.appeals` 只对管理员非零——`worker/case-reads.ts:211-217`——这里仍按契约显式判断 `is_admin`。）

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/countdown.test.ts
```
预期：PASS（13 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/tabTitle.ts tests/unit/countdown.test.ts
git commit -m "feat: 新增标签页标题与待办计数纯函数"
```

---

### Task 3: 核心数据 key 与刷新策略（纯函数）

**Files:**
- Create: `src/lib/coreKeys.ts`、`src/lib/refreshPolicy.ts`
- Test: `tests/unit/refresh-policy.test.ts`（新建）

- [ ] **Step 1: 写失败的测试** —— 新建 `tests/unit/refresh-policy.test.ts`：

```ts
// P0-3: when the home page refetches (spec §5 #10) and what the stale notice says.
import { describe, expect, it } from 'vitest';
import { ALL_CORE_KEYS, CHANGE_KEYS, VISIBLE_KEYS } from '../../src/lib/coreKeys';
import {
  resetCrossed,
  shouldRefreshOnVisible,
  staleMessage,
  visibleRefreshKeys,
} from '../../src/lib/refreshPolicy';

const RESET = '2026-11-01T16:00:00.000Z';
const RESET_MS = Date.parse(RESET);
const MIN = 60_000;

describe('key sets', () => {
  it('a write invalidates the board, the feed and me — not config or the report', () => {
    expect([...CHANGE_KEYS].sort()).toEqual(['leaderboard', 'me', 'records']);
  });

  it('coming back never includes config by itself', () => {
    expect(VISIBLE_KEYS).not.toContain('config');
  });

  it('the first load covers every key, in the order today’s requests go out', () => {
    expect(ALL_CORE_KEYS).toEqual(['config', 'leaderboard', 'records', 'me', 'report']);
  });
});

describe('shouldRefreshOnVisible', () => {
  it('waits until the last refresh is more than the interval old', () => {
    expect(shouldRefreshOnVisible(0, 30_000, MIN)).toBe(false);
    expect(shouldRefreshOnVisible(0, MIN, MIN)).toBe(false);
    expect(shouldRefreshOnVisible(0, MIN + 1, MIN)).toBe(true);
  });

  it('refreshes when the last refresh time is unknown', () => {
    expect(shouldRefreshOnVisible(Number.NaN, 0, MIN)).toBe(true);
  });
});

describe('visibleRefreshKeys', () => {
  it('before the reset: the visible keys only', () => {
    expect(visibleRefreshKeys(RESET, RESET_MS - 1)).toEqual(VISIBLE_KEYS);
  });

  it('at or after the reset: config as well', () => {
    expect(visibleRefreshKeys(RESET, RESET_MS)).toEqual([...VISIBLE_KEYS, 'config']);
  });

  it('an unparsable reset time never adds config', () => {
    expect(visibleRefreshKeys('soon', RESET_MS)).toEqual(VISIBLE_KEYS);
  });
});

describe('resetCrossed', () => {
  it('fires once the clock has passed, once per value', () => {
    expect(resetCrossed(RESET, RESET_MS - 1, null)).toBe(false);
    expect(resetCrossed(RESET, RESET_MS, null)).toBe(true);
    expect(resetCrossed(RESET, RESET_MS + MIN, RESET)).toBe(false);
  });

  it('a new reset time can fire again', () => {
    const next = '2026-11-08T16:00:00.000Z';
    expect(resetCrossed(next, Date.parse(next), RESET)).toBe(true);
  });
});

describe('staleMessage', () => {
  it('says how many minutes old the data is', () => {
    expect(staleMessage(0, 2 * MIN + 5_000, false)).toBe('没刷新出来，显示的是 2 分钟前的数据。');
  });

  it('under a minute: 刚才的数据', () => {
    expect(staleMessage(0, 59_000, false)).toBe('没刷新出来，显示的是刚才的数据。');
  });

  it('503: maintenance wording', () => {
    expect(staleMessage(0, 3 * MIN, true)).toBe('系统维护中，暂时只能看，显示的是 3 分钟前的数据。');
    expect(staleMessage(0, 0, true)).toBe('系统维护中，暂时只能看，显示的是刚才的数据。');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/refresh-policy.test.ts
```
预期：FAIL，整个文件加载失败（`Tests  no tests`）：`Error: Cannot find module '../../src/lib/coreKeys' imported from …/tests/unit/refresh-policy.test.ts`。

- [ ] **Step 3: 新建 `src/lib/coreKeys.ts`**（见「对契约的补充」第 1 条）：

```ts
// Keys of the home-page data loaded by src/lib/coreData.ts. Kept in their own
// pure module so the refresh policy can be unit-tested without the fetch client
// (src/api.ts reads import.meta.env, which tests/unit cannot type-check).

export type CoreKey = 'config' | 'leaderboard' | 'records' | 'me' | 'report';

/** First load and the error page's 重新加载: everything. */
export const ALL_CORE_KEYS: readonly CoreKey[] = Object.freeze([
  'config',
  'leaderboard',
  'records',
  'me',
  'report',
]);

/** After any write a child reports via onChanged (incl. admin 改分/设裁判/改判/撤销). */
export const CHANGE_KEYS: readonly CoreKey[] = Object.freeze(['leaderboard', 'records', 'me']);

/** Tab became visible again: no config (spec §5 #10) unless the weekly reset has passed. */
export const VISIBLE_KEYS: readonly CoreKey[] = Object.freeze(['leaderboard', 'records', 'me']);
```

- [ ] **Step 4: 新建 `src/lib/refreshPolicy.ts`**：

```ts
// When the home page refetches, and what it says when a refetch fails. Pure.
import { VISIBLE_KEYS, type CoreKey } from './coreKeys';
import { parseTimestamp } from './time';

const MINUTE_MS = 60_000;

/** True when the last refresh is more than `minIntervalMs` old (or unknown). */
export function shouldRefreshOnVisible(
  lastRefreshAt: number,
  now: number,
  minIntervalMs: number,
): boolean {
  if (!Number.isFinite(lastRefreshAt)) return true;
  return now - lastRefreshAt > minIntervalMs;
}

/** True once `now` has reached `nextResetAt`; an unparsable value never counts as passed. */
function resetPassed(nextResetAt: string, now: number): boolean {
  const at = parseTimestamp(nextResetAt);
  return !Number.isNaN(at) && now >= at;
}

/** VISIBLE_KEYS, plus 'config' once now has passed config.nextResetAt (the weekly heal is due). */
export function visibleRefreshKeys(nextResetAt: string, now: number): readonly CoreKey[] {
  return resetPassed(nextResetAt, now) ? [...VISIBLE_KEYS, 'config'] : VISIBLE_KEYS;
}

/** True once per nextResetAt value that `now` has passed (caller remembers the last value it acted on). */
export function resetCrossed(nextResetAt: string, now: number, lastHandled: string | null): boolean {
  return nextResetAt !== lastHandled && resetPassed(nextResetAt, now);
}

/** The stale-data notice (contract §3.3): how old the data on screen is, and whether it is maintenance. */
export function staleMessage(sinceMs: number, now: number, maintenance: boolean): string {
  const minutes = Math.floor((now - sinceMs) / MINUTE_MS);
  const age = minutes >= 1 ? ` ${minutes} 分钟前的数据` : '刚才的数据';
  return maintenance ? `系统维护中，暂时只能看，显示的是${age}。` : `没刷新出来，显示的是${age}。`;
}
```

- [ ] **Step 5: 运行单测与类型检查，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/refresh-policy.test.ts
npm run typecheck
```
预期：PASS（13 个用例）；typecheck 三个 tsconfig 都通过（证明 `tests/unit` 导入的模块在 `tsconfig.worker.json` 下也是干净的）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/coreKeys.ts src/lib/refreshPolicy.ts tests/unit/refresh-policy.test.ts
git commit -m "feat: 新增刷新策略纯函数与核心数据 key"
```

---

### Task 4: `useNow` 与 Header 分钟级倒计时

**Files:**
- Create: `src/lib/useNow.ts`
- Modify: `src/components/Header.tsx:4`（导入）、`:17-25`（删除局部 `useNow` 及其后空行）、`:33`、`:61`
- Test: `tests/dom/app-refresh.test.tsx`（新建；本任务先放共用的桩和前两个 describe，后续任务往末尾追加）

- [ ] **Step 1: 写失败的测试** —— 新建 `tests/dom/app-refresh.test.tsx`。fetch 桩照抄 `tests/dom/deep-link.test.tsx:13-31`（未命中路由回 **500**，能暴露多余请求），只把路由的返回类型放宽到 `Response | Promise<Response>`，好让跨重置点的用例（Task 10）挂起第二次 config。可见性用 `Object.defineProperty(document, 'visibilityState', { configurable: true, get })` 控制。

```tsx
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { PublicUser, User } from '../../src/types';

// P0-3: a failed refresh keeps the page, coming back to the tab refetches (but
// not /api/config), passing nextResetAt refetches config, and the tab title
// carries the to-do count.

interface Call {
  method: string;
  path: string;
}

type Route = () => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gets = (calls: Call[], path: string): number =>
  calls.filter((c) => c.method === 'GET' && c.path === path).length;

const START = Date.parse('2026-10-26T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const RESET = '2026-11-01T16:00:00.000Z';

const PLAYER: PublicUser = {
  id: 'p',
  username: '阿杰',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  score: 90,
  created_at: '2026-10-01 00:00:00',
};
const ROW = '第 1 名 阿杰，90 分';
const ADMIN: User = {
  id: 'a',
  username: '管理',
  oauth_username: 'a',
  avatar_url: null,
  is_participant: true,
  is_judge: true,
  is_admin: true,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

function config(nextResetAt: string): unknown {
  return {
    violations: [],
    tiers: [],
    weeklyHeal: 5,
    weeklyBonusCap: 5,
    statementWindowHours: 12,
    aiEnabled: false,
    maxBatchSubjects: 5,
    nextResetAt,
  };
}

function routes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    'GET /api/config': () => json(200, config(RESET)),
    'GET /api/leaderboard': () => json(200, { participants: [PLAYER] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    ...overrides,
  };
}

const clock = (): string => document.querySelector('.hdr__reset-time')?.textContent ?? '';

let visibility: DocumentVisibilityState = 'visible';

/** Leave the tab and come back (the hidden event alone never refetches). */
function leaveAndReturn(): void {
  for (const next of ['hidden', 'visible'] as const) {
    visibility = next;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
}

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
  window.history.replaceState(null, '', '/');
});

describe('App — the header countdown', () => {
  it('ticks by the minute and reads 回血中… once the reset has passed', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      shouldAdvanceTime: true,
    });
    vi.setSystemTime(START);
    mockFetch(routes({ 'GET /api/config': () => json(200, config(new Date(START + 30_000).toISOString())) }));
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    expect(clock()).toBe('00:01');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 1_000);
    });
    expect(clock()).toBe('回血中…');
    await settle();
  });
});

describe('App — first load', () => {
  it('signed out: requests exactly the URLs it always did', async () => {
    const calls = mockFetch(routes());
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    await settle();
    expect(new Set(calls.map((c) => `${c.method} ${c.path}`))).toEqual(
      new Set([
        'GET /api/config',
        'GET /api/leaderboard',
        'GET /api/records?limit=50',
        'GET /api/me',
        'GET /api/report/latest',
        'GET /api/sessions?scope=upcoming',
      ]),
    );
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：「the header countdown」FAIL：`expected '00:00:30' to be '00:01'`（现在是秒级 `formatCountdown`；`shouldAdvanceTime` 下秒数可能是 29）。「first load › signed out」PASS——它是回归护栏，锁住首屏 URL 集合（spec §6.5「请求」）。

- [ ] **Step 3: 新建 `src/lib/useNow.ts`**：

```ts
import { useEffect, useState } from 'react';

/**
 * Re-renders every `intervalMs`, the first tick aligned to the next multiple of
 * intervalMs, so every minute clock on the page flips together. Also ticks when
 * the tab becomes visible again: timers in a background tab are throttled, and
 * a countdown must not show a stale minute after the laptop wakes up.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(intervalMs > 0)) return undefined;
    const tick = (): void => setNow(Date.now());
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, intervalMs);
    }, intervalMs - (Date.now() % intervalMs));
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}
```

- [ ] **Step 4: 修改 `src/components/Header.tsx`**

`:4` 之前：
```ts
import { formatCountdown } from '../lib/time';
```
之后：
```ts
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { formatResetCountdown } from '../lib/time';
import { useNow } from '../lib/useNow';
```

删除 `:17-25`（局部 `useNow` 和它后面的空行）：
```ts
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

```

`:33` 之前 `  const now = useNow(1000);` → 之后：
```ts
  const now = useNow(COUNTDOWN_TICK_MS);
```

`:61` 之前 `  const countdown = config ? formatCountdown(config.nextResetAt, now) : '—';` → 之后：
```ts
  const countdown = config ? formatResetCountdown(config.nextResetAt, now) : '—';
```

`:1` 的 `useEffect, useRef, useState` 仍然都在用（菜单的 effect 和 state），不动。`aria-label="距离每周恢复"`、「每周恢复」、`.hdr__reset-time` 不动。`formatCountdown` 留在 `time.ts` 里不删（契约 §3.3）。

- [ ] **Step 5: 运行，确认通过，且 dom 全量不回退**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
npx vitest run --config vitest.dom.config.ts
```
预期：新文件 2 个用例 PASS；dom 全量 PASS（基线全部 + 新增 2），stderr 只有 `onboarding-roles` 原有的三条 `act(...)` 警告。

- [ ] **Step 6: 提交**

```bash
git add src/lib/useNow.ts src/components/Header.tsx tests/dom/app-refresh.test.tsx
git commit -m "feat: Header 回血倒计时改为每分钟刷新"
```

---

### Task 5: Toast 原语

**Files:**
- Create: `src/components/Toast.tsx`、`src/components/toast.css`
- Test: `tests/dom/toast.test.tsx`（新建）

- [ ] **Step 1: 写失败的测试** —— 新建 `tests/dom/toast.test.tsx`（全假时钟，用 `fireEvent` 而不是 user-event，避免和假定时器打架）：

```tsx
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
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/toast.test.tsx
```
预期：FAIL，`Failed to resolve import "../../src/components/Toast"`。

- [ ] **Step 3: 新建 `src/components/Toast.tsx`**（契约 §3.3 的类型与语义；视口 portal 到 `document.body`；任何 tone 都不用 `role="alert"`；关闭按钮名「关闭通知」；最多 `TOAST_MAX_VISIBLE` 条、新的在下；悬停或焦点在内时暂停，离开后按剩余时间继续——计时抽成文件内的 `usePausableTimeout`，`ToastCard` 保持在 50 行以内；组件注释写明焦点陷阱够不到 toast、`aria-modal` 可能让读屏不读 toast 的已知限制）：

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOAST_ACTION_MIN_MS, TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from '../lib/constants';
import './toast.css';

export type ToastTone = 'info' | 'ok' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  /** Default 'info'. */
  tone?: ToastTone;
  /** e.g. { label: '撤销', … } */
  action?: ToastAction;
  /** Default TOAST_DURATION_MS; with an action at least TOAST_ACTION_MIN_MS. */
  durationMs?: number;
}

export interface ToastApi {
  /** Returns the toast id (-1 when nothing was shown). */
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

const NOOP_API: ToastApi = { show: () => -1, dismiss: () => undefined };
const ToastContext = createContext<ToastApi>(NOOP_API);

function durationOf({ durationMs, action }: ToastOptions): number {
  const requested =
    durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : TOAST_DURATION_MS;
  return action ? Math.max(requested, TOAST_ACTION_MIN_MS) : requested;
}

/**
 * Short feedback after an action, with an optional action button (撤销).
 *
 * The viewport is portaled to <body>, outside #root: an open Modal makes #root
 * inert + aria-hidden, and a toast raised from inside a dialog must still be
 * seen. It is a single, always-present role="status" region (never
 * role="alert" — errors stay inline next to what failed, and several tests rely
 * on there being exactly one alert).
 *
 * Known limits: while a center/sheet Modal is open its focus trap does not
 * include the toasts, so keyboard users cannot reach a toast's button, and a
 * screen reader that honours the dialog's aria-modal may not read the toast
 * either. Every toast action must therefore also be reachable elsewhere on the
 * page (spec §6.4, WCAG 2.2.1) — e.g. an RSVP can always be changed again — and
 * no toast may be the only place an error is reported inside a dialog.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number): void => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions): number => {
    const message = options.message.trim();
    if (message.length === 0) return -1;
    const id = nextId.current;
    nextId.current = id + 1;
    const item: ToastItem = {
      id,
      message,
      tone: options.tone ?? 'info',
      action: options.action,
      durationMs: durationOf(options),
    };
    // Newest last (at the bottom); the oldest drops off past the limit.
    setItems((prev) => [...prev, item].slice(-TOAST_MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** Outside a provider (components rendered alone in tests) this is a no-op: show() returns -1. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** A setTimeout that stops while `paused` and resumes with the time that was left. */
function usePausableTimeout(paused: boolean, durationMs: number, onExpire: () => void): void {
  const remaining = useRef(durationMs);
  useEffect(() => {
    if (paused) return undefined;
    const startedAt = Date.now();
    const id = window.setTimeout(onExpire, remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onExpire]);
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const close = useCallback((): void => onDismiss(item.id), [onDismiss, item.id]);
  // Nobody pointing at it or focused in it: only then does the clock run.
  usePausableTimeout(hovered || focused, item.durationMs, close);

  const action = item.action;
  return (
    <div
      className={`toast toast--${item.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <p className="toast__msg">{item.message}</p>
      {action && (
        <button
          type="button"
          className="btn btn--ghost btn--sm toast__action"
          onClick={() => {
            close();
            action.onAction();
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="关闭通知" onClick={close}>
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 新建 `src/components/toast.css`**（P0-1 约定：断点只用 `min-width: 601px`；`:hover` 在 `@media (hover: hover)` 里；不写 `outline`，焦点环用 P0-1 的全局 `:focus-visible`；DOM 顺序 = 视觉顺序，`flex-direction: column` 不反转；无内联 style，CSP 安全）：

```css
/* Toasts — short feedback after an action (P0-3). Portaled to <body>, so they
   sit above every Modal (--z-toast > --z-modal). */

.toasts {
  position: fixed;
  z-index: var(--z-toast);
  inset-inline: 0.75rem;
  bottom: calc(0.75rem + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* The empty region must not swallow taps on the page under it. */
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--tap-min);
  padding: 0.5rem 0.5rem 0.5rem 0.9rem;
  border: 1px solid var(--border-strong);
  border-inline-start: 3px solid var(--info);
  border-radius: var(--r-md);
  background: var(--panel-2);
  box-shadow: var(--shadow-pop);
  color: var(--text);
  pointer-events: auto;
  animation: toast-in var(--dur) var(--ease);
}

.toast--ok {
  border-inline-start-color: var(--ok);
}

.toast--error {
  border-inline-start-color: var(--danger);
}

.toast__msg {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.toast__action {
  flex: none;
  min-height: var(--tap-min);
}

.toast__close {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--tap-min);
  height: var(--tap-min);
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}

@media (hover: hover) {
  .toast__close:hover {
    color: var(--text);
    background: var(--panel);
  }
}

@media (min-width: 601px) {
  .toasts {
    inset-inline: auto 1.25rem;
    bottom: calc(1.25rem + var(--safe-bottom));
    width: min(400px, calc(100vw - 2.5rem));
  }
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
  }
}

@media (forced-colors: active) {
  .toast {
    border: 1px solid CanvasText;
  }
}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/toast.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```
预期：toast 9 个用例 PASS；P0-1 的 `css-conventions` PASS（新 CSS 合规）。

- [ ] **Step 6: 提交**

```bash
git add src/components/Toast.tsx src/components/toast.css tests/dom/toast.test.tsx
git commit -m "feat: 新增 Toast 原语"
```

---

### Task 6: useUndo 原语

**Files:**
- Create: `src/lib/useUndo.ts`
- Test: `tests/dom/toast.test.tsx`（修改 `:2-3` 导入区、`:7` 变量、`:9-12` Probe、`:32-35` afterEach；末尾追加）

- [ ] **Step 1: 写失败的测试** —— 改 `tests/dom/toast.test.tsx`：

在 `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';` 之后插入：
```ts
import { ApiError } from '../../src/api';
```
在 `import { ToastProvider, useToast, type ToastApi, type ToastOptions } from '../../src/components/Toast';` 之后插入：
```ts
import { useUndo, type UndoRequest } from '../../src/lib/useUndo';
```
在 `let api: ToastApi | null = null;` 之后插入：
```ts
let undo: ((request: UndoRequest) => void) | null = null;
```
在 `Probe` 里 `  api = useToast();` 之后插入：
```ts
  undo = useUndo();
```
在 `afterEach` 里 `  api = null;` 之后插入：
```ts
  undo = null;
```
文件末尾追加：
```tsx
describe('useUndo', () => {
  async function clickUndo(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    });
  }

  it('undoes, says so, then calls onUndone', async () => {
    const onUndone = vi.fn();
    const reverse = vi.fn(() => Promise.resolve());
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => undo?.({ message: '已改成：不来', undo: reverse, onUndone }));
    await clickUndo();
    expect(reverse).toHaveBeenCalledTimes(1);
    expect(screen.getByText('已撤销')).toBeInTheDocument();
    expect(onUndone).toHaveBeenCalledTimes(1);
  });

  it('a failed undo shows the server’s reason, and onUndone is not called', async () => {
    const onUndone = vi.fn();
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() =>
      undo?.({ message: '已改成：不来', undo: () => Promise.reject(new ApiError('约局已开始', 409)), onUndone }),
    );
    await clickUndo();
    expect(screen.getByText('撤销没成功：约局已开始')).toBeInTheDocument();
    expect(onUndone).not.toHaveBeenCalled();
  });

  it('any other failure: a generic retry message', async () => {
    render(<ToastProvider><Probe /></ToastProvider>);
    act(() => undo?.({ message: '已改成：不来', undo: () => Promise.reject(new Error('offline')) }));
    await clickUndo();
    expect(screen.getByText('撤销没成功，请稍后重试')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/toast.test.tsx
```
预期：FAIL，`Failed to resolve import "../../src/lib/useUndo"`。

- [ ] **Step 3: 新建 `src/lib/useUndo.ts`**（文案取契约 §3.3：默认按钮「撤销」、成功「已撤销」、失败 `撤销没成功：${ApiError.message}` / 「撤销没成功，请稍后重试」）：

```ts
import { useCallback } from 'react';
import { ApiError } from '../api';
import { useToast, type ToastApi } from '../components/Toast';

export interface UndoRequest {
  /** 「已改成：不来」 */
  message: string;
  /** The reverse write. */
  undo: () => Promise<unknown>;
  /** Default '撤销'. */
  undoLabel?: string;
  /** Default '已撤销'. */
  undoneMessage?: string;
  /** e.g. reload + onChanged. */
  onUndone?: () => void;
}

const UNDO_LABEL = '撤销';
const UNDONE_MESSAGE = '已撤销';
const UNDO_FAILED = '撤销没成功，请稍后重试';

async function runUndo(toast: ToastApi, request: UndoRequest): Promise<void> {
  try {
    await request.undo();
  } catch (err) {
    toast.show({
      tone: 'error',
      message: err instanceof ApiError ? `撤销没成功：${err.message}` : UNDO_FAILED,
    });
    return;
  }
  toast.show({ tone: 'ok', message: request.undoneMessage ?? UNDONE_MESSAGE });
  request.onUndone?.();
}

/**
 * Shows a toast with an undo action. The action is one click, then the toast
 * goes away (no double undo); the outcome is reported in a toast of its own.
 */
export function useUndo(): (request: UndoRequest) => void {
  const toast = useToast();
  return useCallback(
    (request: UndoRequest): void => {
      toast.show({
        message: request.message,
        action: { label: request.undoLabel ?? UNDO_LABEL, onAction: () => void runUndo(toast, request) },
      });
    },
    [toast],
  );
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/toast.test.tsx
npm run typecheck
```
预期：12 个用例 PASS；typecheck 通过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/useUndo.ts tests/dom/toast.test.tsx
git commit -m "feat: 新增 useUndo 撤销原语"
```

---

### Task 7: 数据层按 key 加载，App 接上 `useCoreData` 与 `ToastProvider`

**Files:**
- Create: `src/lib/coreData.ts`、`src/lib/useCoreData.ts`
- Modify: `src/App.tsx`（行号指改动前的文件）：`:3-22`（导入）、`:24` 之后（新导入）、`:47-95`（删除 `CoreData`/`LoadState`/`loadCore`）、`:121-122`（App 外壳 + `AppMain`）、`:146-161`（删除旧 `refresh` 和它的 effect）、`:240-250`（`handleMeUpdated`/`handleChanged`，并在其后新增 `handleRegenerate`）、`:339-344`（`onRegenerate` 改为调用 `handleRegenerate`）
- Test: `tests/dom/app-refresh.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试** —— 在 `tests/dom/app-refresh.test.tsx` 末尾追加。`REPORT`/`REGENERATE`/`adminRoutes` 放在模块级，Task 9 还要用。admin 在选手页点「设为裁判」→ `PlayerDetail.run` → `onChanged` → `handleChanged`（`PlayerDetail.tsx:115-121`）；周报卡的按钮是「换个说法」，进行中变成「重写中…」（`WeeklyReportCard.tsx:84`），所以「按钮回来了」= 能再按名字找到它且可用：

```tsx
const REPORT = {
  week_start: '2026-10-19',
  stats: {
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25',
    sessionsPlayed: 1,
    sessionsCollapsed: 0,
    casesFiled: 0,
    totalPenalty: 0,
    absentVerdicts: 0,
    attendanceRate: null,
    upcomingNextWeek: 0,
    star: null,
    pigeon: null,
    bestTalker: null,
    harshest: null,
    topOrganizer: null,
  },
  narrative: '平平无奇的一周。',
  source: 'fallback',
  created_at: '2026-10-26 02:31:00',
};
const REGENERATE = 'POST /api/admin/report/2026-10-19/regenerate';

/** Signed in as the admin, with last week's report on the page. */
function adminRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return routes({
    'GET /api/me': () => json(200, { user: ADMIN, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: REPORT }),
    ...overrides,
  });
}

describe('App — after an admin write', () => {
  it('设为裁判 invalidates the board, the feed and me — not config or the report', async () => {
    const calls = mockFetch(
      adminRoutes({
        'GET /api/users/p': () => json(200, { user: PLAYER, records: [], history: [] }),
        'POST /api/admin/users/p': () => json(200, { ok: true }),
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: ROW }));
    await user.click(await screen.findByRole('button', { name: '设为裁判' }));
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/records?limit=50')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/me')).toBe(2));
    await settle();
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/report/latest')).toBe(1);
  });
});

describe('App — the admin re-rolls the weekly report', () => {
  it('换个说法 refetches the report only', async () => {
    const calls = mockFetch(adminRoutes({ [REGENERATE]: () => json(200, { report: REPORT }) }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '换个说法' }));
    await waitFor(() => expect(gets(calls, '/api/report/latest')).toBe(2));
    // While it runs the button reads 重写中…; it is back once the report is in.
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
    expect(gets(calls, '/api/leaderboard')).toBe(1);
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/sessions?scope=upcoming')).toBe(1);
  });

  it('a failed re-roll says so in a toast — never an alert — and the button comes back', async () => {
    mockFetch(adminRoutes({ [REGENERATE]: () => json(500, { error: 'AI 超时了' }) }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '换个说法' }));
    const message = await screen.findByText('战报没换成新说法：AI 超时了');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：3 个新用例 FAIL——「after an admin write」`expected 2 to be 1`（现在 `handleChanged` 调的是全量 `loadCore`，config 和 report 都被重拉）；「换个说法 refetches the report only」`expected 2 to be 1`（重写成功后走 `handleChanged`，榜单也被重拉）；「a failed re-roll」`Unable to find an element with the text: 战报没换成新说法：AI 超时了`，并且 Vitest 另报一条未处理的 `ApiError: AI 超时了`（今天失败时是未处理的 rejection）。前两个 describe 照旧 PASS。

- [ ] **Step 3: 新建 `src/lib/coreData.ts`**（`App.tsx:47-94` 挪过来；首屏的 URL 集合与今天一致，五个主请求仍按 config、leaderboard、records?limit=50、me、report/latest 的顺序发出；唯一的时序差别是 me 的两个后续请求在 `/api/me` 一返回就发，不再等另外四个——URL 不变，没有测试依赖这个先后；`limit` 改读常量）：

```ts
// The home page's data: loaded all at once on the first visit, then refreshed
// by key (P0-3). Moved out of App.tsx; the first-load request URLs are unchanged.
import {
  getConfig,
  getLatestReport,
  getLeaderboard,
  getMe,
  getMyInvites,
  getRecords,
} from '../api';
import type {
  Config,
  PendingCounts,
  PublicUser,
  RecordItem,
  SessionItem,
  User,
  WeeklyReport,
} from '../types';
import { CORE_FEED_LIMIT, PENDING_STATEMENTS_LIMIT } from './constants';
import type { CoreKey } from './coreKeys';

export type { CoreKey } from './coreKeys';
export { ALL_CORE_KEYS, CHANGE_KEYS, VISIBLE_KEYS } from './coreKeys';

export interface CoreData {
  config: Config;
  participants: PublicUser[];
  /** GET /api/records?limit=50 (CORE_FEED_LIMIT). */
  records: RecordItem[];
  me: User | null;
  /** /api/me's counts, kept for the tab title. */
  pending: PendingCounts;
  /** Cases where the signed-in user still owes a statement. */
  myPending: RecordItem[];
  /** Sessions the user was invited to and has not answered. */
  invites: SessionItem[];
  report: WeeklyReport | null;
}

export interface ReloadResult {
  data: CoreData;
  failed: readonly { key: CoreKey; error: unknown }[];
}

type MePart = Pick<CoreData, 'me' | 'pending' | 'myPending' | 'invites'>;

const NO_PENDING: PendingCounts = { statements: 0, appeals: 0 };

/** 'me' and its two follow-ups; a failed invites read falls back to `fallbackInvites`. */
async function loadMe(fallbackInvites: SessionItem[]): Promise<MePart> {
  const { user, pending = NO_PENDING } = await getMe();
  // Only fetch the follow-ups that can possibly be non-empty: /api/me already
  // tells us whether anything is pending, and invites need a session at all.
  const [myPending, invites] = await Promise.all([
    user && pending.statements > 0
      ? getRecords({ mine: 'pending', limit: PENDING_STATEMENTS_LIMIT }).then((r) => r.records)
      : Promise.resolve<RecordItem[]>([]),
    user
      ? getMyInvites()
          .then((r) => r.sessions)
          .catch(() => fallbackInvites)
      : Promise.resolve<SessionItem[]>([]),
  ]);
  return { me: user, pending, myPending, invites };
}

/** A missing report is normal (first week, or nothing happened) — never fatal. */
function loadReport(fallback: WeeklyReport | null): Promise<WeeklyReport | null> {
  return getLatestReport()
    .then((r) => r.report)
    .catch(() => fallback);
}

const LOADERS: Record<CoreKey, (prev: CoreData) => Promise<Partial<CoreData>>> = {
  config: async () => ({ config: await getConfig() }),
  leaderboard: async () => ({ participants: (await getLeaderboard()).participants }),
  records: async () => ({ records: (await getRecords({ limit: CORE_FEED_LIMIT })).records }),
  me: (prev) => loadMe(prev.invites),
  report: async (prev) => ({ report: await loadReport(prev.report) }),
};

/** First load: every key, Promise.all — any failure is fatal (the error page), as before. */
export async function loadInitialCore(): Promise<CoreData> {
  const [config, leaderboard, records, me, report] = await Promise.all([
    getConfig(),
    getLeaderboard(),
    getRecords({ limit: CORE_FEED_LIMIT }),
    loadMe([]),
    loadReport(null),
  ]);
  return { config, participants: leaderboard.participants, records: records.records, ...me, report };
}

/**
 * Refresh: fetch only `keys` with Promise.allSettled and merge the parts that
 * arrived into a NEW object (untouched parts keep their identity; nothing
 * arrived → `prev` itself). Never throws: failures come back in `failed`.
 */
export async function reloadCore(prev: CoreData, keys: readonly CoreKey[]): Promise<ReloadResult> {
  const unique = [...new Set(keys)];
  const settled = await Promise.allSettled(unique.map((key) => LOADERS[key](prev)));
  const failed = settled.flatMap((result, i) =>
    result.status === 'rejected' ? [{ key: unique[i], error: result.reason as unknown }] : [],
  );
  const patches = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const data =
    patches.length === 0 ? prev : patches.reduce<CoreData>((acc, patch) => ({ ...acc, ...patch }), prev);
  return { data, failed };
}
```

- [ ] **Step 4: 新建 `src/lib/useCoreData.ts`**（`stale.keys` 与 `loadedAt` 规则见「对契约的补充」第 14 条；串行队列抽成文件内的 `useSerialQueue`，`useCoreData` 本体保持在 50 行以内；503 的注释照实写：worker 的 READ_ONLY 只拒绝写请求，`worker/routes.ts:180-191`，GET 的 503 来自托管网关）：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import type { User } from '../types';
import { ALL_CORE_KEYS, loadInitialCore, reloadCore, type CoreData, type ReloadResult } from './coreData';
import { VISIBLE_KEYS, type CoreKey } from './coreKeys';
import { staleMessage } from './refreshPolicy';

export interface StaleInfo {
  /** loadedAt of the data still on screen. */
  since: number;
  message: string;
  /** Parts whose last fetch failed and that have not been fetched successfully since. */
  keys: readonly CoreKey[];
}

export type CoreState =
  | { status: 'loading' }
  /** Only when nothing was ever loaded. */
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      data: CoreData;
      /** Last successful refresh of everything the page shows (VISIBLE_KEYS), in ms. */
      loadedAt: number;
      /** A refresh failed: the old data stays on screen. */
      stale: StaleInfo | null;
    };

type ReadyState = Extract<CoreState, { status: 'ready' }>;

const LOAD_FAILED = '加载失败，请稍后重试';
/**
 * A GET that answers 503 means the site is down for maintenance (the hosting
 * gateway during a cutover). The worker's own READ_ONLY switch only refuses
 * writes (worker/routes.ts:180-191), so the page can still be read.
 */
const MAINTENANCE_STATUS = 503;

async function firstLoad(): Promise<CoreState> {
  try {
    const data = await loadInitialCore();
    return { status: 'ready', data, loadedAt: Date.now(), stale: null };
  } catch (err) {
    return { status: 'error', message: err instanceof ApiError ? err.message : LOAD_FAILED };
  }
}

/** Still stale after this refresh: what failed now, plus earlier failures it did not fetch again. */
function staleKeysAfter(prev: ReadyState, keys: readonly CoreKey[], failed: ReloadResult['failed']): CoreKey[] {
  const carried = (prev.stale?.keys ?? []).filter((key) => !keys.includes(key));
  return [...new Set([...carried, ...failed.map(({ key }) => key)])];
}

function afterReload(prev: ReadyState, keys: readonly CoreKey[], result: ReloadResult, now: number): ReadyState {
  const { data, failed } = result;
  const staleKeys = staleKeysAfter(prev, keys, failed);
  if (staleKeys.length === 0) {
    // Refreshing only the report or config says nothing about how old the board is.
    const loadedAt = VISIBLE_KEYS.every((key) => keys.includes(key)) ? now : prev.loadedAt;
    return { status: 'ready', data, loadedAt, stale: null };
  }
  if (failed.length === 0 && prev.stale) {
    // Other parts came in fine; what failed before is still old, so the notice stays.
    return { ...prev, data, stale: { ...prev.stale, keys: staleKeys } };
  }
  const maintenance = failed.some(({ error }) => error instanceof ApiError && error.status === MAINTENANCE_STATUS);
  const message = staleMessage(prev.loadedAt, now, maintenance);
  return { ...prev, data, stale: { since: prev.loadedAt, message, keys: staleKeys } };
}

/** Runs tasks one at a time, in call order; a failed task does not block the next one. */
function useSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  const tail = useRef<Promise<void>>(Promise.resolve());
  return useCallback((task: () => Promise<void>): Promise<void> => {
    const run = tail.current.then(task);
    tail.current = run.catch(() => undefined);
    return run;
  }, []);
}

export interface CoreDataApi {
  state: CoreState;
  /** No keys = ALL_CORE_KEYS. With data on screen a failure only sets `stale`. */
  refresh: (keys?: readonly CoreKey[]) => Promise<void>;
  /** Optimistic local update after OnboardingDialog saves. */
  setMe: (user: User) => void;
}

/** The home page's data, refreshed by key; a failed refresh keeps what is on screen. */
export function useCoreData(): CoreDataApi {
  const [state, setState] = useState<CoreState>({ status: 'loading' });
  // What the next refresh starts from — set together with setState, so a queued
  // refresh never reads a value React has not rendered yet.
  const latest = useRef<CoreState>(state);
  const started = useRef(false);
  const enqueue = useSerialQueue();

  const commit = useCallback((next: CoreState): void => {
    latest.current = next;
    setState(next);
  }, []);

  // One at a time: each refresh starts from what the previous one left, so two
  // overlapping refreshes cannot put back each other's older parts. (A setMe
  // during a refresh is overwritten by it; callers refresh 'me' after setMe.)
  const refresh = useCallback(
    (keys: readonly CoreKey[] = ALL_CORE_KEYS): Promise<void> =>
      enqueue(async () => {
        const current = latest.current;
        if (current.status !== 'ready') {
          commit(await firstLoad());
          return;
        }
        const result = await reloadCore(current.data, keys);
        commit(afterReload(current, keys, result, Date.now()));
      }),
    [enqueue, commit],
  );

  const setMe = useCallback(
    (user: User): void => {
      const current = latest.current;
      if (current.status !== 'ready') return;
      commit({ ...current, data: { ...current.data, me: user } });
    },
    [commit],
  );

  useEffect(() => {
    // StrictMode runs mount effects twice in development; load once.
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);

  return { state, refresh, setMe };
}
```

- [ ] **Step 5: 修改 `src/App.tsx`**

`:3-22` 之前：
```ts
import type {
  Config,
  PublicUser,
  RecordItem,
  SessionItem,
  User,
  WeeklyReport,
} from './types';
import {
  ApiError,
  getConfig,
  getLatestReport,
  getLeaderboard,
  getMe,
  getMyInvites,
  getRecord,
  getRecords,
  logout as apiLogout,
  regenerateReport,
} from './api';
```
之后：
```ts
import type { RecordItem, User } from './types';
import { ApiError, getRecord, logout as apiLogout, regenerateReport } from './api';
```

`:24`（`deepLink` 导入）之后插入三行，整段变成：
```ts
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './lib/deepLink';
import { CHANGE_KEYS } from './lib/coreData';
import { useCoreData } from './lib/useCoreData';
import { ToastProvider, useToast } from './components/Toast';
```

删除 `:47-95`（下面整段连同其后的空行；`:45` 的 `WEEK_MS` 留着，`computeTrends` 还在用）：
```ts
interface CoreData {
  config: Config;
  participants: PublicUser[];
  records: RecordItem[];
  me: User | null;
  /** Cases where the signed-in user still owes a statement. */
  myPending: RecordItem[];
  /** Sessions the user was invited to and has not answered. */
  invites: SessionItem[];
  report: WeeklyReport | null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CoreData };

async function loadCore(): Promise<CoreData> {
  const [config, leaderboard, records, me, report] = await Promise.all([
    getConfig(),
    getLeaderboard(),
    getRecords({ limit: 50 }),
    getMe(),
    // A missing report is normal (first week, or nothing happened) — never fatal.
    getLatestReport().catch(() => ({ report: null })),
  ]);
  // Only fetch the follow-ups that can possibly be non-empty: /api/me already
  // tells us whether anything is pending, and invites need a session at all.
  const [myPending, invites] = await Promise.all([
    me.user && me.pending.statements > 0
      ? getRecords({ mine: 'pending', limit: 20 }).then((r) => r.records)
      : Promise.resolve<RecordItem[]>([]),
    me.user
      ? getMyInvites()
          .then((r) => r.sessions)
          .catch(() => [])
      : Promise.resolve<SessionItem[]>([]),
  ]);
  return {
    config,
    participants: leaderboard.participants,
    records: records.records,
    me: me.user,
    myPending,
    invites,
    report: report.report,
  };
}

```

`:121-122` 之前：
```tsx
export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
```
之后（`App` 签名不变，今天的函数体变成不导出的 `AppMain`）：
```tsx
/** Toasts sit outside AppMain so every child — and every dialog — can raise one. */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppMain />
    </ToastProvider>
  );
}

function AppMain(): JSX.Element {
  const { state, refresh, setMe } = useCoreData();
  const toast = useToast();
```

删除 `:146-161`（`useCoreData` 已经负责首屏加载）：
```tsx
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await loadCore();
      setState({ status: 'ready', data });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof ApiError ? err.message : '加载失败，请稍后重试',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

```

`:240-250` 之前（之后的版本在 `handleChanged` 后面新增 `handleRegenerate`；hooks 都在 `:258` 的 early return 之前）：
```tsx
  const handleMeUpdated = useCallback((user: User): void => {
    setState((prev) =>
      prev.status === 'ready' ? { status: 'ready', data: { ...prev.data, me: user } } : prev,
    );
    void refresh();
  }, [refresh]);

  const handleChanged = useCallback((): void => {
    void refresh();
    setSessionsKey((n) => n + 1);
  }, [refresh]);
```
之后：
```tsx
  const handleMeUpdated = useCallback((user: User): void => {
    setMe(user);
    void refresh(CHANGE_KEYS);
  }, [setMe, refresh]);

  // Every write a child reports — incl. the admin's 改分/设裁判/改判/撤销 —
  // invalidates the board, the feed and me; config and the report stay.
  const handleChanged = useCallback((): void => {
    void refresh(CHANGE_KEYS);
    setSessionsKey((n) => n + 1);
  }, [refresh]);

  // The admin re-rolls the weekly report's prose: nothing but the report changes.
  // It used to reject unhandled on failure; now the admin is told.
  const handleRegenerate = useCallback(
    (week: string): void => {
      setRegenerating(true);
      void regenerateReport(week)
        .then(
          () => refresh(['report']),
          (err: unknown) => {
            toast.show({
              tone: 'error',
              message: err instanceof ApiError ? `战报没换成新说法：${err.message}` : '战报没换成新说法，请稍后重试',
            });
          },
        )
        .finally(() => setRegenerating(false));
    },
    [refresh, toast],
  );
```

`:339-344`（WeeklyReportCard 的 `onRegenerate` 里）之前：
```tsx
                ? () => {
                    setRegenerating(true);
                    void regenerateReport(report.week_start)
                      .then(handleChanged)
                      .finally(() => setRegenerating(false));
                  }
```
之后（见「对契约的补充」第 12 条；`handleRegenerate` 已在上面和 `handleChanged` 一起加好）：
```tsx
                ? () => handleRegenerate(report.week_start)
```

`:258-281` 的 loading / error 分支**一字不改**：错误页「重新加载」仍是 `onClick={() => void refresh()}`，现在等于 `refresh(ALL_CORE_KEYS)`，从 error 状态走首次加载；`role="alert"` 只在一次都没加载成功时出现。`:283` 的解构不变（`CoreData` 多了 `pending` 字段，App 暂不解构它）。深链 effect（`:162-229`）不动：`deepLinkDone` 保证刷新不会重跑深链。

- [ ] **Step 6: 运行，确认通过，且锁定测试照旧**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
npx vitest run --config vitest.dom.config.ts
npm run typecheck
```
预期：新文件 5 个用例 PASS；dom 全量 PASS（开工时的 dom 基线 + toast 12 + app-refresh 5；按推荐合并顺序 P0-1、P0-2 已在 main 上，即 86 + 17 = 103；若 P0-2 尚未合并则是 54 + 17 = 71）——重点看 `p8-app.test.tsx:118-131`（改分后 `/api/records?limit=50` > 1 次、`/api/records/7` 正好 1 次，靠 `CHANGE_KEYS` 含 `'records'`）、`deep-link.test.tsx`（非 GET 请求为 0、`/约局/` 标题唯一）、`discord-link`、`onboarding-roles`、`session-rsvp-moved`（单独渲染、无 Provider，`useToast` 默认 no-op）；typecheck 通过。

- [ ] **Step 7: 提交**

```bash
git add src/lib/coreData.ts src/lib/useCoreData.ts src/App.tsx tests/dom/app-refresh.test.tsx
git commit -m "refactor: 首页数据按 key 加载，写操作后只失效榜单、动态和本人"
```

---

### Task 8: 页面重新可见时刷新（不含 config）

**Files:**
- Create: `src/lib/useVisibleRefresh.ts`
- Modify: `src/App.tsx`（行号指 Task 7 之后的文件）：`:8` 之后（导入）、`:178-180`（`handleChanged` 的结尾）之后（`handleVisible`）
- Test: `tests/dom/app-refresh.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试** —— 末尾追加：

```tsx
describe('App — coming back to the tab', () => {
  it('refetches after more than 60 s — board, feed, me and sessions, never config', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    const calls = mockFetch(routes());
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    await settle();

    vi.setSystemTime(START + 30_000);
    leaveAndReturn();
    await settle();
    expect(gets(calls, '/api/leaderboard')).toBe(1);

    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/sessions?scope=upcoming')).toBe(2));
    expect(gets(calls, '/api/records?limit=50')).toBe(2);
    expect(gets(calls, '/api/me')).toBe(2);
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/report/latest')).toBe(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：「coming back to the tab」FAIL：`waitFor` 超时，`expected 1 to be 2`（还没有 visibilitychange 监听）。

- [ ] **Step 3: 新建 `src/lib/useVisibleRefresh.ts`**：

```ts
import { useEffect, useRef } from 'react';
import { VISIBLE_REFRESH_MIN_MS } from './constants';
import { shouldRefreshOnVisible } from './refreshPolicy';

/**
 * Calls `onVisible` when the tab becomes visible again and the last call (or
 * the mount) is more than `minIntervalMs` ago — a quick tab switch refetches nothing.
 */
export function useVisibleRefresh(
  onVisible: () => void,
  minIntervalMs: number = VISIBLE_REFRESH_MIN_MS,
): void {
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    let last = Date.now();
    const handle = (): void => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (!shouldRefreshOnVisible(last, now, minIntervalMs)) return;
      last = now;
      onVisibleRef.current();
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, [minIntervalMs]);
}
```

- [ ] **Step 4: 修改 `src/App.tsx`**

`:8`（`import { useCoreData } from './lib/useCoreData';`）之后插入：
```ts
import { visibleRefreshKeys } from './lib/refreshPolicy';
import { useVisibleRefresh } from './lib/useVisibleRefresh';
```

`handleChanged` 的结尾（`:178-180`，插入导入之前的行号）之后插入，整段变成：
```tsx
    void refresh(CHANGE_KEYS);
    setSessionsKey((n) => n + 1);
  }, [refresh]);

  const handleVisible = useCallback((): void => {
    if (!ready) return;
    void refresh(visibleRefreshKeys(ready.config.nextResetAt, Date.now()));
    setSessionsKey((n) => n + 1);
  }, [ready, refresh]);
  useVisibleRefresh(handleVisible);
```

（`ready` 是 `:107` 已有的 `const ready = state.status === 'ready' ? state.data : null;`。没有数据时不刷新；`setSessionsKey` 让 SessionsPanel 也重拉——契约 §3.3。）

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：6 个用例 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/useVisibleRefresh.ts src/App.tsx tests/dom/app-refresh.test.tsx
git commit -m "feat: 页面重新可见且超过 60 秒时刷新榜单、动态、本人和约局"
```

---

### Task 9: 刷新失败保留旧数据，StaleNotice（含 503）

**Files:**
- Create: `src/components/StaleNotice.tsx`、`src/components/stale-notice.css`
- Modify: `src/App.tsx`（行号指 Task 8 之后的文件）：`:11` 之后（导入）、`:267`（main 顶部插槽）
- Test: `tests/dom/app-refresh.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试** —— 末尾追加（第二次加载时 leaderboard、records、me 全部 500；503 用 worker 的原文 `系统维护中（只读），请稍后再试` 作为错误体；第三个用例锁住「对契约的补充」第 14 条：榜单刷新失败后，周报重写成功只重拉了 report，提示不能消失）：

```tsx
describe('App — a refresh that fails', () => {
  it('keeps the board on screen and says so with role=status, not an alert; 重试 clears it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let failing = false;
    const fail = (ok: () => Response): Route => () => (failing ? json(500, { error: 'boom' }) : ok());
    const calls = mockFetch(
      routes({
        'GET /api/leaderboard': fail(() => json(200, { participants: [PLAYER] })),
        'GET /api/records?limit=50': fail(() => json(200, { records: [] })),
        'GET /api/me': fail(() => json(200, { user: null, pending: { statements: 0, appeals: 0 } })),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });

    failing = true;
    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();

    const notice = await screen.findByText('没刷新出来，显示的是 1 分钟前的数据。');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: ROW })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('出错了')).not.toBeInTheDocument();

    failing = false;
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText(/没刷新出来/)).not.toBeInTheDocument());
    expect(gets(calls, '/api/leaderboard')).toBe(3);
  });

  it('503 (maintenance) says the page is read-only for now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let down = false;
    mockFetch(
      routes({
        'GET /api/leaderboard': () =>
          down ? json(503, { error: '系统维护中（只读），请稍后再试' }) : json(200, { participants: [PLAYER] }),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    down = true;
    vi.setSystemTime(START + 2 * MINUTE + 1_000);
    leaveAndReturn();
    expect(await screen.findByText('系统维护中，暂时只能看，显示的是 2 分钟前的数据。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROW })).toBeInTheDocument();
  });

  it('stays up while what failed is still old, even when another part refreshes fine', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let failing = false;
    const calls = mockFetch(
      adminRoutes({
        'GET /api/leaderboard': () =>
          failing ? json(500, { error: 'boom' }) : json(200, { participants: [PLAYER] }),
        [REGENERATE]: () => json(200, { report: REPORT }),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    failing = true;
    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();
    const stale = '没刷新出来，显示的是 1 分钟前的数据。';
    await screen.findByText(stale);

    // Only the report is refetched (and arrives); the board is still the old one.
    await userEvent.setup().click(screen.getByRole('button', { name: '换个说法' }));
    await waitFor(() => expect(gets(calls, '/api/report/latest')).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
    expect(screen.getByText(stale)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：三个新用例 FAIL：`Unable to find an element with the text: 没刷新出来，显示的是 1 分钟前的数据。`（503 那个是 `…系统维护中，暂时只能看，显示的是 2 分钟前的数据。`）——`useCoreData` 已经保留了旧数据，但页面上还没有提示。

- [ ] **Step 3: 新建 `src/components/StaleNotice.tsx`**（`role="status"`，**不用 alert**；按钮「重试」）：

```tsx
import './stale-notice.css';

interface StaleNoticeProps {
  message: string;
  onRetry: () => void;
}

/**
 * A refresh failed and the page still shows the older data. role="status", not
 * "alert": it is not an error the user caused, and tests expect at most one alert.
 */
export function StaleNotice({ message, onRetry }: StaleNoticeProps): JSX.Element {
  return (
    <section className="stale" role="status" aria-live="polite">
      <span className="stale__icon" aria-hidden="true">
        !
      </span>
      <p className="stale__msg">{message}</p>
      <button type="button" className="btn btn--ghost btn--sm stale__retry" onClick={onRetry}>
        重试
      </button>
    </section>
  );
}
```

- [ ] **Step 4: 新建 `src/components/stale-notice.css`**（块前缀 `.stale`，契约 §4 已分配）：

```css
/* A refresh failed; the page still shows the older data (P0-3). */

.stale {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.6rem 0.75rem 0.6rem 1.1rem;
  border: 1px solid color-mix(in oklab, var(--attn) 45%, transparent);
  border-radius: var(--r-lg);
  background: color-mix(in oklab, var(--attn) 8%, transparent);
}

.stale__icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: var(--r-pill);
  font-weight: 700;
  color: var(--bg);
  background: var(--attn);
}

.stale__msg {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text);
}

.stale__retry {
  flex: none;
  min-height: var(--tap-min);
}

@media (forced-colors: active) {
  .stale {
    border-color: CanvasText;
  }

  .stale__icon {
    border: 1px solid CanvasText;
  }
}
```

- [ ] **Step 5: 修改 `src/App.tsx`**

`:11`（`import { ToastProvider, useToast } from './components/Toast';`）之后插入：
```ts
import { StaleNotice } from './components/StaleNotice';
```

`:267`（插入导入之前的行号）之前：
```tsx
      <main className="app__main">
```
之后（放在 main 最顶、各 notice 之前；`state` 在这里已被前面的 early return 收窄为 ready）：
```tsx
      <main className="app__main">
        {state.stale && (
          <StaleNotice
            message={state.stale.message}
            onRetry={() => void refresh(visibleRefreshKeys(config.nextResetAt, Date.now()))}
          />
        )}

```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```
预期：9 个用例 PASS；css-conventions PASS。

- [ ] **Step 7: 提交**

```bash
git add src/components/StaleNotice.tsx src/components/stale-notice.css src/App.tsx tests/dom/app-refresh.test.tsx
git commit -m "fix: 刷新失败时保留旧数据并用 role=status 局部提示"
```

---

### Task 10: 跨过 `nextResetAt` 后重拉 config

**Files:**
- Create: `src/lib/useResetWatch.ts`
- Modify: `src/App.tsx`（行号指 Task 9 之后的文件）：`:10` 之后（导入）、`:190` 之后（`handleResetCrossed`）
- Test: `tests/dom/app-refresh.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试** —— 末尾追加（第一次 config 的 `nextResetAt` = 现在 + 30 秒；第二次 config 挂起，先断言等待期间显示「回血中…」，放行后断言倒计时变回 `N天 HH:MM`、没有负号，且榜单和本人在 config 之后重拉）：

```tsx
describe('App — the weekly reset passes with the page open', () => {
  it('refetches config, shows 回血中… meanwhile, and never a negative countdown', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      shouldAdvanceTime: true,
    });
    vi.setSystemTime(START);
    const firstReset = new Date(START + 30_000).toISOString();
    const nextReset = new Date(START + 30_000 + 7 * DAY).toISOString();
    let configCalls = 0;
    let release: (res: Response) => void = () => undefined;
    const calls = mockFetch(
      routes({
        'GET /api/config': () => {
          configCalls += 1;
          if (configCalls === 1) return json(200, config(firstReset));
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    expect(clock()).toBe('00:01');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 1_000);
    });
    expect(gets(calls, '/api/config')).toBe(2);
    expect(clock()).toBe('回血中…');

    await act(async () => {
      release(json(200, config(nextReset)));
    });
    await waitFor(() => expect(clock()).toMatch(/^\d+天 \d{2}:\d{2}$/));
    expect(clock()).not.toContain('-');
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    expect(gets(calls, '/api/me')).toBe(2);
    expect(gets(calls, '/api/config')).toBe(2);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：「the weekly reset passes」FAIL：`expected 1 to be 2`（`/api/config` 没有被重拉）。

- [ ] **Step 3: 新建 `src/lib/useResetWatch.ts`**：

```ts
import { useEffect, useRef } from 'react';
import { COUNTDOWN_TICK_MS } from './constants';
import { resetCrossed } from './refreshPolicy';

/**
 * Calls `onCrossed` once per `nextResetAt` value, on the first minute tick after
 * the clock passes it (checked without re-rendering). The page then refetches
 * /api/config — which runs the weekly heal and returns next week's reset time.
 */
export function useResetWatch(
  nextResetAt: string | null,
  onCrossed: () => void,
  intervalMs: number = COUNTDOWN_TICK_MS,
): void {
  const onCrossedRef = useRef(onCrossed);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    onCrossedRef.current = onCrossed;
  }, [onCrossed]);

  useEffect(() => {
    if (nextResetAt === null || !(intervalMs > 0)) return undefined;
    const check = (): void => {
      if (!resetCrossed(nextResetAt, Date.now(), handled.current)) return;
      handled.current = nextResetAt;
      onCrossedRef.current();
    };
    check();
    const id = window.setInterval(check, intervalMs);
    return () => window.clearInterval(id);
  }, [nextResetAt, intervalMs]);
}
```

- [ ] **Step 4: 修改 `src/App.tsx`**

`:10`（`import { useVisibleRefresh } from './lib/useVisibleRefresh';`）之后插入：
```ts
import { useResetWatch } from './lib/useResetWatch';
```

`:190`（`  useVisibleRefresh(handleVisible);`，插入导入之前的行号）之后插入，整段变成：
```tsx
  useVisibleRefresh(handleVisible);

  // Past nextResetAt: GET /api/config runs the weekly heal and returns next
  // week's reset, so it goes first; refresh runs one at a time, so the board
  // and my score are read after it.
  const handleResetCrossed = useCallback((): void => {
    void refresh(['config']);
    void refresh(['leaderboard', 'me']);
  }, [refresh]);
  useResetWatch(ready?.config.nextResetAt ?? null, handleResetCrossed);
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：10 个用例 PASS（Task 4 的 header 用例也仍然通过：那里第二次 config 返回同一个已过去的值，`resetCrossed` 不会再触发）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/useResetWatch.ts src/App.tsx tests/dom/app-refresh.test.tsx
git commit -m "feat: 页面开着跨过每周恢复时间时重拉 config，等待期间显示回血中"
```

---

### Task 11: 标签页标题显示待办数

**Files:**
- Create: `src/lib/useTabTitle.ts`
- Modify: `src/App.tsx`（行号指 Task 10 之后的文件）：`:11` 之后（导入）、`:200` 之后（`useTabTitle`）
- Test: `tests/dom/app-refresh.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试** —— 末尾追加（管理员、2 条待说明、1 条待复核申诉、0 个邀请 → `(3) EDG 信誉分`；同时锁住登录后首屏多出来的正好是 `/api/records?limit=20&mine=pending` 和 `/api/me/invites` 两个请求；卸载后还原）：

```tsx
describe('App — tab title', () => {
  it('signed in with things to do: the same URLs plus the two follow-ups, and (N) in the tab title', async () => {
    const calls = mockFetch(
      routes({
        'GET /api/me': () => json(200, { user: ADMIN, pending: { statements: 2, appeals: 1 } }),
        'GET /api/records?limit=20&mine=pending': () => json(200, { records: [] }),
        'GET /api/me/invites': () => json(200, { sessions: [] }),
      }),
    );
    const { unmount } = render(<App />);
    await waitFor(() => expect(document.title).toBe('(3) EDG 信誉分'));
    await settle();
    expect(new Set(calls.map((c) => c.path))).toEqual(
      new Set([
        '/api/config',
        '/api/leaderboard',
        '/api/records?limit=50',
        '/api/me',
        '/api/report/latest',
        '/api/sessions?scope=upcoming',
        '/api/records?limit=20&mine=pending',
        '/api/me/invites',
      ]),
    );
    unmount();
    expect(document.title).toBe('EDG 信誉分');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：「tab title」FAIL：`expected '' to be '(3) EDG 信誉分'`。

- [ ] **Step 3: 新建 `src/lib/useTabTitle.ts`**：

```ts
import { useEffect } from 'react';
import { BASE_TITLE, tabTitle } from './tabTitle';

/** Keeps document.title at '(N) EDG 信誉分'; puts the bare title back on unmount. */
export function useTabTitle(count: number): void {
  useEffect(() => {
    document.title = tabTitle(count);
  }, [count]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );
}
```

- [ ] **Step 4: 修改 `src/App.tsx`**

`:11`（`import { useResetWatch } from './lib/useResetWatch';`）之后插入：
```ts
import { todoCount } from './lib/tabTitle';
import { useTabTitle } from './lib/useTabTitle';
```

`:200`（`  useResetWatch(ready?.config.nextResetAt ?? null, handleResetCrossed);`，插入导入之前的行号）之后插入：
```tsx

  useTabTitle(ready ? todoCount(ready) : 0);
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/app-refresh.test.tsx
```
预期：11 个用例 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/lib/useTabTitle.ts src/App.tsx tests/dom/app-refresh.test.tsx
git commit -m "feat: 标签页标题显示待办数"
```

---

## 收尾

### 全量验证

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git fetch origin && git rebase origin/main
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npm run build
```

预期（按推荐合并顺序，开工时 main 上已有 P0-1、P0-2：unit 16 个文件 / 223 个用例，dom 10 个文件 / 86 个用例）：typecheck 三个 tsconfig 全过；unit = 开工基线 + 本 PR 的 2 个文件 / 26 个用例（`countdown` 13 + `refresh-policy` 13）= **18 个文件 / 249 个用例**，全部通过；dom = 开工基线 + 本 PR 的 2 个文件 / 23 个用例（`toast` 12 + `app-refresh` 11）= **12 个文件 / 109 个用例**（若 P0-2 还没合并则是 10 个文件 / 77 个用例），全部通过，stderr 里只有 `onboarding-roles` 原有的三条 `act(...)` 警告；`vite build` 成功。本 PR 不碰 `worker/`、`server/`、`shared/`，不需要跑 worker 测试；`npm run test:server` / `npm run test:pg` 交给 CI。

App 体量：`src/App.tsx` 从 466 行降到约 442 行（P0-4 挪走 `computeTrends`/`computeCounts` 后还会再少约 25 行，给 P0-4/P0-5 留出契约 §4 的「约 450 行」余量）；新文件都在 160 行以内，新函数都短于 50 行（`AppMain` 是今天的 `App` 函数体，本 PR 只让它变短）。

### 手动检查（`npm run dev:web` + 本地 API，或 `npm run preview`）

375px（手机）与 1280px（桌面）各看一遍：
- [ ] Header 右上「每周恢复」显示 `N天 HH:MM`（没有秒），整分钟时翻一位；不闪、不抖动宽度。
- [ ] DevTools → Network 设 Offline，切到别的标签页等 1 分钟以上再切回：榜单、动态、约局都还在；main 最顶出现「没刷新出来，显示的是 1 分钟前的数据。」+「重试」，不是红色报错页；恢复网络点「重试」后提示消失。375px 下提示文字换行、按钮不被挤出屏幕，按钮高度 ≥ 44px。
- [ ] 本地 `READ_ONLY=1` 起 worker 不会让 GET 返回 503；要看 503 文案，在 DevTools 用 Network request blocking / overrides 让 `/api/leaderboard` 返回 503，切走再切回：「系统维护中，暂时只能看，显示的是 N 分钟前的数据。」
- [ ] 切走不到 60 秒再切回：Network 里没有新请求；超过 60 秒：只有 leaderboard、records?limit=50、me（及 invites / pending）、sessions?scope=upcoming，**没有** `/api/config`。
- [ ] 以有待说明或有邀请的账号登录：浏览器标签显示 `(N) EDG 信誉分`；处理掉之后数字随刷新减少，归零时显示 `EDG 信誉分`。
- [ ] 管理员在选手页改分 / 设裁判 / 改判 / 撤销后：榜单分数、最新动态立即更新；Network 里没有重拉 `/api/config` 和 `/api/report/latest`。
- [ ] 管理员点战报卡上的「换个说法」：进行中显示「重写中…」，成功后战报卡更新，Network 里只多了 `/api/report/latest`（没有 leaderboard、config）；断网再点，右下（1280px）/ 底部通栏（375px）出现错误 toast「战报没换成新说法，请稍后重试」，5 秒后消失，悬停时不消失，点「关闭通知」立即消失；toast 容器的空白处可以点穿到下面的页面（`pointer-events: none`）；375px 下留意它和右下角「记一笔」FAB 的重叠只在 toast 显示期间，且 toast 不超出安全区。
- [ ] 跨重置点：DevTools → Sources → Overrides 覆盖 `/api/config` 的响应，把 `nextResetAt` 改成一分钟后，刷新页面，**页面加载完立即关掉这个 override**；到点后倒计时显示「回血中…」，随即重拉到真实 config、变回下周的倒计时，全程无负数；Network 里先是 `/api/config`，然后才是 `/api/leaderboard` 和 `/api/me`。
- [ ] 读屏：VoiceOver / NVDA 下触发上面的错误 toast，会被朗读一次（`role=status`），焦点不被抢走。弹窗打开时的 toast（浮在弹窗之上、`#root` inert 时仍可见、读屏是否被 `aria-modal` 屏蔽）本 PR 造不出来——弹窗开着时周报卡点不到，App 里也没有别的 toast 调用点；portal 在 `#root` 之外由 `toast.test.tsx` 锁住，真机验收留给 P0-6 的 RSVP toast（它在 SessionDetailDialog 里弹），结果记进 P0-6 的 PR 描述。
- [ ] 系统开启「减少动态效果」：toast 无入场动画。Windows 高对比度（forced-colors）：toast 和 StaleNotice 有可见边框。
- [ ] 深链回归：`/?case=7`、`/?session=3`、`/?linked=discord`、`/?onboarding=1` 行为与改动前一致，URL 参数照旧被剥掉。

## 自查

| spec 项（§9 P0-3 / §5 第 10 条 / §6.4 / 契约 §3.3） | 覆盖的任务 |
|---|---|
| 刷新失败保留旧数据（M11） | Task 7（`reloadCore` allSettled + 不可变合并、`useCoreData` 只设 `stale`，`stale.keys` 保证只刷新别的部分时提示不消失）、Task 9（StaleNotice、`app-refresh` 第二次加载 500 时榜单还在、周报重写成功后提示仍在） |
| visibilitychange 时刷新，不含 config；距上次超过 60 秒才刷新 | Task 3（`shouldRefreshOnVisible`、`VISIBLE_KEYS`）、Task 8（`useVisibleRefresh`、App 接线、测试断言 config 只请求 1 次） |
| 过了 `nextResetAt` 例外：重拉 config，等待期间「回血中…」，不出现负数 | Task 1（`formatResetCountdown`）、Task 3（`visibleRefreshKeys`、`resetCrossed`）、Task 10（`useResetWatch`、App 接线、`app-refresh` 跨重置点用例） |
| 503 局部提示 | Task 3（`staleMessage` 维护文案）、Task 7（`useCoreData` 识别 `ApiError.status === 503`）、Task 9（503 用例） |
| 标签页标题 `(N) EDG 信誉分` | Task 2（`tabTitle`、`todoCount`）、Task 11（`useTabTitle`、App 接线、用例） |
| Header 倒计时改为每分钟刷新 | Task 1（`COUNTDOWN_TICK_MS`）、Task 4（`useNow` 对齐整分钟、Header 改用分钟级格式） |
| `Toast` 原语：`role=status` + `aria-live=polite`、portal 在 `#root` 外、带操作至少 8 秒、悬停/焦点暂停、可键盘聚焦、「关闭通知」、最多 3 条、无 Provider 时 no-op | Task 5 |
| `useUndo` 原语：撤销 / 已撤销 / 撤销没成功 | Task 6 |
| 新增的请求一律 allSettled，失败时用 `role=status` | Task 7（`reloadCore`）、Task 9（StaleNotice `role="status"`，用例断言没有 `role=alert`） |
| 管理员写操作（改分、设裁判、改判、撤销）后榜单、用户、动态流 key 失效 | Task 7（`CHANGE_KEYS` = leaderboard/records/me；`app-refresh` 设裁判用例；`p8-app.test.tsx:128` 改分用例照常通过） |
| 首屏请求 URL 一个不改 | Task 4（未登录 URL 集合用例）、Task 11（登录 + 待办时的 URL 集合用例）、Task 7（`loadInitialCore` 保持原顺序与原 URL） |
| `p8-app.test.tsx:128` 照常通过 | Task 7 Step 6 |
| 周报重写成功后 `refresh(['report'])`（契约 §3.3），失败不再是未处理的 rejection | Task 7（`handleRegenerate`；`app-refresh` 两个用例：只多请求一次 `/api/report/latest`；失败时 `role=status` 的 toast、没有 alert、按钮恢复） |
| 新函数 < 50 行、嵌套 ≤ 4 层 | Task 5（`usePausableTimeout`）、Task 7（`useSerialQueue`、`CoreDataApi`、`handleRegenerate` 把 JSX 里深嵌套的内联处理挪出来） |
| `app-refresh.test.tsx`：第二次加载 500 时榜单还在；跨过 nextResetAt 后重拉 config，倒计时不出现负数 | Task 9、Task 10 |
| 前端常量放 `src/lib/constants.ts`，不写魔法数 | Task 1（P0-3 小节）；`CORE_FEED_LIMIT`/`PENDING_STATEMENTS_LIMIT` 在 Task 7 取代 `App.tsx:68,77` 的 50/20 |
| 深链语义不变、刷新不重跑深链、不在深链前发写请求 | Task 7（深链 effect 不动；`deep-link`、`p8-app` 全量回归） |
| 组件签名不变（`App`、`Header` 的 props 不变） | Task 4、Task 7 |
| CSP：无内联 style、无 `<style>`、无 `dangerouslySetInnerHTML` | Task 5、Task 9（纯 class；`pages-headers.test.ts` 不受影响） |
| 契约 §4：被 `tests/unit` 导入的模块是纯模块 | Task 2、Task 3（`coreKeys.ts` 拆分、`TodoSource`；Task 3 Step 5 跑 typecheck 验证） |
