# P0-4 榜单与首页去羞辱化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删掉红黑榜、让信誉榜在任何宽度都显示分数且同分同名次、段位只给本人看，并给未登录访客一张欢迎卡，把首页里所有「点名鸽王」的地方去掉（H5、H6、H7 的 P0 部分、M23、M24 公开部分、M26 前半）。

**Architecture:** 新增四个纯模块（`rank.ts`、`feedStats.ts`、`weekStars.ts`、`inviteUrl.ts`）承载全部可单测的规则，组件只做渲染；现有组件（`Leaderboard`、`ScoreGauge`、`RecordsFeed`、`WeeklyReportCard`、`RulesPanel`）只加可选 props，默认行为与今天逐字一致；`App.tsx` 只改 P0-4 名下的渲染区，按片段定位修改（P0-3 合并后行号会移动）。新组件 `WeekHighlights`、`WelcomeCard` 各带一个 BEM 块（`.wh`、`.welcome`），只用 P0-1 的 token、断点（600/1024）和 hover 约定。

**Tech Stack:** React 18.3 + TypeScript 5.9 + Vite 6.4；Vitest 3.2（unit：node；dom：jsdom + Testing Library 16 + user-event 14）；纯 CSS + `src/theme.css` token。

**依赖:**
- 硬依赖（必须已合进 `origin/main`）：**P0-1**（token `--fs-*`、`--action`、`--ok`、`--info`、`--score-chip-fg`、`--tap-min`、`--danger-text`；断点与 hover 约定及其 `css-conventions.test.ts`）、**P0-3**（`src/lib/constants.ts`、`App.tsx` 数据层改造、`AppMain`/`ToastProvider` 外壳）。推荐合并顺序 P0-1 → P0-2 → P0-3 → P0-6 → **P0-4** → P0-5。
- 消费：契约 §3.0 的 `src/lib/constants.ts`（往末尾追加 `// --- P0-4 ---` 小节）、§3.1 的 token/断点/hover 约定、P0-3 改过的 `App.tsx`（`state.data.records`、`config`、`me` 字段名不变）。
- 提供（契约 §3.4，名字逐字一致）：`ScoreGauge.tone`、`competitionRanks`（P0-5 的 MyScoreLine 复用）、`Leaderboard.meId/highlights`、`computeWeekHighlights`/`WeekStar`/`WeekHighlightsResult`、`WeekHighlights`、`RecordsFeed.previewCount`、`WeeklyReportCard.compact`、`RulesPanel.open/onOpenChange` + `id="rules"`（P0-5 只改它 `:36` 的文案）、`WelcomeCard`、`parseInviteUrl`、`DISCORD_INVITE_URL`、`WEEK_STAR_MIN_ON_TIME`、`FEED_PREVIEW_COUNT`。
- 不碰：`PlayerDetail.tsx`（公开选手页的 `tone="neutral"` 属于 P1-1）、`Modal.tsx`、`api.ts`、`shared/`、任何 worker/server 文件。

**分支:** `claude/p0-4-board`（P0-1、P0-3 都合进 main 之后：`git fetch origin && git switch -c claude/p0-4-board origin/main`）

---

## 对契约的补充

契约里已有的名字一律照用；下面这些是契约没写、实施时又必须定下来的，理由逐条写明。

1. **新文件 `src/lib/feedStats.ts`（纯）+ `tests/unit/feed-stats.test.ts`。** 契约 §2.4 说 `computeTrends`/`computeCounts`「可挪去 `src/lib/`」但没给文件名。本计划把它们连同 `WEEK_MS`、`weekStartOf(nextResetAt)`、`inWeek(record, weekStart)` 放进 `feedStats.ts`：`weekStars.ts` 要和 `computeTrends` 用**同一个**周起点口径（契约 §3.4「与 `App.tsx:97-98` 同口径」），共用一个函数比复制一份更不容易走样；顺带让 `App.tsx` 回到约 450 行以内（契约 §4）。行为与今天逐字一致（同样只算 `affectsScore`、同样跳过无法解析的时间），实现改成不可变的 `reduce`。
2. **`WelcomeCardProps` 多一个必填 `weeklyHeal: number`。** spec §3.1 的文案写「每周一 0 点自动回血 +15」，但 spec §5 第 3 条和契约 §4 都要求回血数字读 `config.weeklyHeal`（测试桩是 5）。契约 §3.4 的 WelcomeCardProps 漏了这个入口；WelcomeCard 是新组件、没有旧调用方，加必填 prop 不破坏任何签名。
3. **新文件 `src/lib/revealSection.ts`（DOM 工具，不进 unit）。** 契约只说「App sets rulesOpen = true and scrolls #rules into view」。滚动要等 React 把 RulesPanel 展开后才有意义，还要把焦点交给规则面板的开关按钮（否则键盘用户还停在欢迎卡上）、并尊重 reduced-motion（照 `PlayerDetail.tsx:90-92` 的写法）。把这 10 行放进 App 会让 App 变长，所以单独成文件；由 `tests/dom/board.test.tsx` 覆盖。
4. **`src/app.css` 删两段 `.app__main > .rbb` 规则。** 契约 §2.3 的 P0-4 文件清单漏了它：RedBlackBoard 删除后这两段（基线 `app.css:79-82`、`:167-171`）是死代码。P0-1 会先把 `:160` 的 `@media (max-width: 900px)` 改成 `(max-width: 1023px)`，本计划只删 `.rbb` 那几行，不动媒体查询本身。
5. **`src/components/rules-panel.css` 给 `.rules` 加 `scroll-margin-top: 5.5rem`。** Header 是 sticky 的（`header.css:2`），不留边距「30 秒看懂」滚过去时标题会被 Header 盖住。`5.5rem` 与 `app.css:100` 的 `.app__col--side { top: 5.5rem }` 同值。
6. **新测试文件 `tests/dom/history-chart.test.tsx`。** 契约 §2.3 的 P0-4 测试清单里没有走势图，但 M26 前半是本 PR 的范围，不能不测。`board.test.tsx` 按契约只放 Leaderboard / WeekHighlights / WelcomeCard / compact 战报（本计划另加 RecordsFeed「看更多」、RulesPanel 受控与 App 级首页用例，都属于「榜单与首页」）。
7. **`docs/DEPLOY-PAGES.md` 第 2 步的环境变量里补一行 `VITE_DISCORD_INVITE_URL`。** 前端只在 Cloudflare Pages 构建（Dockerfile 不构建前端），不写进部署文档，这个开关就没人知道（spec §11 第 12 条推荐填 `https://discord.nanako.org`）。
8. **spec 没给文案、又必须有可访问名的两处**（只用于 `aria-label`，不在界面上显示）：欢迎卡关闭按钮 `aria-label="不再显示欢迎卡"`（不能叫「关闭」：会和 Modal 的 ✕ 重名；也不能叫「关闭提示」：被 DiscordLinkedNotice 锁定）；走势图的 range 输入 `aria-label="查看某次分数"`。
9. **compact 战报的「两三个数字」取「开局 · 立案 · 出勤率」。** spec §3.1 线框写「开局 3 · 判决 1」，但 `ReportStats`（`src/types.ts:283-298`）没有「判决数」字段；P0 不改后端，所以用卡片上已有的三个标签（`WeeklyReportCard.tsx:97-103`），出勤率为 `null` 时省掉。线框里的「读全文 ›」指向 P3 的 `/board/report`，P0 没有这个页面，**不加**这个链接。
10. **榜单行在手机（≤600px）隐藏「本周变化 / N 条记录」那一列。** spec §6.4：「榜单行在手机上是『名次 · 头像 · 名字 · 分数』，P4-5 有了 `week_delta` 后再加『本周变化』」。桌面和平板保持这一列。
11. **本周之星的「准时」只看记录类型 `on_time_bonus`，不看 delta。** 每周守约加分有上限（`config.weeklyBonusCap`），到顶后的守约记录 delta 可能是 0，但人确实准时了；spec §5 第 1 条说的是「至少 2 次『守约守时』加分」，按记录计次更符合本意。扣分仍按 `delta < 0`。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/rank.ts` | 新 | `competitionRanks`：同分同名次（纯） |
| `src/lib/feedStats.ts` | 新 | `WEEK_MS`、`weekStartOf`、`inWeek`、`computeTrends`、`computeCounts`（从 `App.tsx:45,96-119` 挪来，纯） |
| `src/lib/weekStars.ts` | 新 | `computeWeekHighlights`：本周之星 + 整周门槛（纯） |
| `src/lib/constants.ts` | 改（末尾追加） | `// --- P0-4 ---`：`WEEK_STAR_MIN_ON_TIME`、`FEED_PREVIEW_COUNT` |
| `src/lib/inviteUrl.ts` | 新 | `parseInviteUrl`：只收绝对 https、不带凭据的 URL（纯） |
| `src/lib/env.ts` | 新 | `DISCORD_INVITE_URL`：读 `import.meta.env`（只在 DOM 工程里导入） |
| `src/lib/revealSection.ts` | 新 | 下一帧滚到某个 section 并把焦点交给它的第一个按钮（DOM） |
| `src/vite-env.d.ts` | 改 | `ImportMetaEnv` 加 `VITE_DISCORD_INVITE_URL?` |
| `src/components/ScoreGauge.tsx` / `score-gauge.css` | 改 | 可选 `tone`；`gauge--neutral` 不设 `--tier`、不念段位、无辉光 |
| `src/components/Leaderboard.tsx` / `leaderboard.css` | 改 | 同分同名次、无奖牌、分数常显、62px 环只在 ≥1024px 且 neutral、段位只在 `meId` 那行、`highlights` 插槽 |
| `src/components/WeekHighlights.tsx` / `week-highlights.css` | 新 | 本周之星那一行（不是 heading） |
| `src/components/RedBlackBoard.tsx` / `red-black-board.css` | 删 | 红黑榜 |
| `src/app.css` | 改 | 删 `.app__main > .rbb` 两段 |
| `src/theme.css` | 改 | 只删 coarse 列表里的 `.hero-card__link`（基线 `:303`） |
| `src/components/OnboardingDialog.tsx` | 改 | 只改 `ROLE_CARDS[0].desc`（基线 `:29`）「红黑榜」→「信誉榜」 |
| `src/components/RecordsFeed.tsx` / `records-feed.css` | 改 | 可选 `previewCount` + 「看更多」，展开后焦点落到第一条新显示的记录；`RecordRow` 拆成小组件（markup 不变） |
| `src/components/WeeklyReportCard.tsx` / `weekly-report.css` | 改 | 可选 `compact`：标题、日期、三个数字、叙事第一句，不渲染任何 `.wr-award` |
| `src/components/RulesPanel.tsx` / `rules-panel.css` | 改 | 可选受控 `open`/`onOpenChange`；`<section id="rules">`；scroll-margin |
| `src/components/WelcomeCard.tsx` / `welcome-card.css` | 新 | 未登录欢迎卡（可关闭，localStorage `edg.welcome.dismissed`） |
| `src/components/HistoryChart.tsx` / `history-chart.css` | 改 | 坐标数字改成 SVG 外的 HTML（12px）、点按/键盘选点并显示读数 |
| `src/App.tsx` | 改 | 用 feedStats；删 RedBlackBoard；榜单传 `meId`/`highlights`；动态流 `previewCount`；战报 `compact`；`rulesOpen`；未登录插 WelcomeCard |
| `index.html` | 改 | description 改写，新增 `og:title`、`og:description` |
| `docs/DEPLOY-PAGES.md` | 改 | Pages 环境变量补 `VITE_DISCORD_INVITE_URL` |
| `tests/unit/rank.test.ts` | 新 | 同分同名次 |
| `tests/unit/feed-stats.test.ts` | 新 | 周起点、趋势、记录数 |
| `tests/unit/week-stars.test.ts` | 新 | 门槛、之星规则、并列顺序、无鸽王 |
| `tests/unit/invite-url.test.ts` | 新 | 入群链接校验 |
| `tests/dom/score-gauge.test.tsx` | 新 | 默认不变；neutral 的 aria-label 不含段位 |
| `tests/dom/board.test.tsx` | 新 | Leaderboard、WeekHighlights、看更多、compact 战报、RulesPanel、WelcomeCard、App 首页 |
| `tests/dom/history-chart.test.tsx` | 新 | 坐标数字是 HTML、range/点按选点 |

---

### Task 0: 开分支与前置检查

**Files:** 无改动

- [ ] **Step 1: 确认 P0-1、P0-3 已合进 origin/main，再开分支**

```bash
cd "$(git rev-parse --show-toplevel)"   # 本 PR 的 checkout（worktree 或主仓库）
git fetch origin
git switch -c claude/p0-4-board origin/main
test -f src/lib/constants.ts && echo "P0-3 constants OK"
grep -q -- '--score-chip-fg' src/theme.css && grep -q -- '--fs-xs' src/theme.css && echo "P0-1 tokens OK"
test -f tests/unit/css-conventions.test.ts && echo "P0-1 css-conventions OK"
```

预期：三行 OK 都打印。任何一行缺失就停下——依赖还没合，不能开工（契约 §2.2）。

- [ ] **Step 2: 跑基线**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
```

预期：全部通过。数字以实际 main 为准，记下来收尾时对照。按推荐合并顺序（P0-1 → P0-2 → P0-3 → P0-6 已合入）开工基线应为 **unit 19 个文件 / 270 个用例、dom 13 个文件 / 129 个用例**（d72e11b 178/54；P0-1 +45 unit；P0-2 +32 dom；P0-3 +26 unit / +23 dom；P0-6 +21 unit / +20 dom）。本 PR 结束时 unit +4 文件 +24 例、dom +3 文件 +36 例，即 23 / 294 与 16 / 165。

`src/lib/constants.ts` 此时末尾是 P0-6 的小节（P0-6 先合并）；Task 3 的 P0-4 小节照样追加在文件最末尾。若 P0-6 晚于本 PR 合并，rebase 时两个小节都保留、P0-6 的放后面即可。

- [ ] **Step 3: 在 App.tsx 里找到本 PR 要改的片段**（P0-3 改过 App，下文给的是基线 d72e11b 的行号，一律**按片段内容定位**）

```bash
grep -n "affectsScore\|parseTimestamp\|WEEK_MS\|function computeTrends\|function computeCounts\|RedBlackBoard\|const top =\|const bottom =\|<Leaderboard\|<RulesPanel\|<RecordsFeed\|<WeeklyReportCard\|LinkMissingNotice message\|setRegenerating\] = useState\|AUTH_LOGIN_URL" src/App.tsx
```

如果 P0-3 已经把 `WEEK_MS`、`computeTrends`、`computeCounts` 或 `affectsScore`/`parseTimestamp` 的 import 挪走/删掉了，Task 2 里对应的删除步骤跳过，只做「新增 import」那一步。

---

### Task 1: 同分同名次 `competitionRanks`

**Files:**
- Create: `src/lib/rank.ts`
- Test: `tests/unit/rank.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/rank.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { competitionRanks } from '../../src/lib/rank';

// The board ranks ties together (spec §9 P0-4): two players on 100 are both
// 第 1 名, and the next one is 第 3 名 — never "1, 2" by name.

describe('competitionRanks', () => {
  it('gives equal scores the same rank and skips after a tie', () => {
    expect(competitionRanks([100, 100, 96])).toEqual([1, 1, 3]);
    expect(competitionRanks([90, 80, 80, 80, 70])).toEqual([1, 2, 2, 2, 5]);
  });

  it('ranks everyone first when everyone is tied', () => {
    expect(competitionRanks([100, 100, 100])).toEqual([1, 1, 1]);
  });

  it('does not depend on the input order', () => {
    expect(competitionRanks([96, 100, 96])).toEqual([2, 1, 2]);
  });

  it('handles an empty board', () => {
    expect(competitionRanks([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/rank.test.ts
```

预期：FAIL，`Error: Cannot find module '../../src/lib/rank' imported from '…/tests/unit/rank.test.ts'`（unit 工程走 Node 解析，报的是 Cannot find module，不是 dom 工程里 Vite 的 Failed to resolve import）。

- [ ] **Step 3: 最小实现**

`src/lib/rank.ts`：

```ts
/**
 * Competition ranking ("1224"): equal scores share a rank and the next rank
 * skips, so [100, 100, 96] → [1, 1, 3]. A rank is 1 + the number of strictly
 * higher scores, so it never depends on the list's order — the API orders ties
 * by name only to keep the list stable, and the board must not turn that into
 * "阿杰 beats 小红".
 */
export function competitionRanks(scores: readonly number[]): number[] {
  return scores.map((score) => 1 + scores.filter((other) => other > score).length);
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/rank.test.ts
```

预期：PASS，4 个用例。

- [ ] **Step 5: 提交**

```bash
git add src/lib/rank.ts tests/unit/rank.test.ts
git commit -m "feat: 新增同分同名次的 competitionRanks"
```

---

### Task 2: 把趋势与记录数统计挪到 `src/lib/feedStats.ts`

**Files:**
- Create: `src/lib/feedStats.ts`
- Modify: `src/App.tsx:2`（删 `affectsScore` import）、`:23`（time import 去掉 `parseTimestamp`）、`:24` 之后（新增 import）、`:45`（删 `WEEK_MS`）、`:96-119`（删两个函数）；`:252-256` 的两个 `useMemo` **不改**（调用名不变）
- Test: `tests/unit/feed-stats.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/feed-stats.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { computeCounts, computeTrends, WEEK_MS, weekStartOf } from '../../src/lib/feedStats';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// Moved out of App.tsx unchanged in behaviour: trends count only scored
// records filed since the week's start; counts take every record in the feed.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function rec(
  id: number,
  subjectId: string,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
  type: ViolationType = 'no_show',
): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId, avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

describe('weekStartOf', () => {
  it('is one week before the next reset', () => {
    expect(weekStartOf(NEXT_RESET)).toBe(Date.parse(NEXT_RESET) - WEEK_MS);
  });

  it('is NaN for an unparseable reset', () => {
    expect(weekStartOf('soon')).toBeNaN();
  });
});

describe('computeTrends', () => {
  it('sums decided and appealed deltas filed this week', () => {
    const records = [
      rec(1, 'a', -10),
      rec(2, 'a', 2, 'appealed'),
      rec(3, 'b', 2, 'decided', IN_WEEK, 'on_time_bonus'),
    ];
    expect(computeTrends(records, NEXT_RESET)).toEqual({ a: -8, b: 2 });
  });

  it('ignores open, revoked and withdrawn cases and last week', () => {
    const records = [
      rec(1, 'a', 0, 'awaiting_statement'),
      rec(2, 'a', -10, 'revoked'),
      rec(3, 'a', -10, 'withdrawn'),
      rec(4, 'a', -10, 'decided', LAST_WEEK),
    ];
    expect(computeTrends(records, NEXT_RESET)).toEqual({});
  });
});

describe('computeCounts', () => {
  it('counts every record per subject', () => {
    const records = [rec(1, 'a', -10), rec(2, 'a', 0, 'withdrawn'), rec(3, 'b', 2, 'decided', LAST_WEEK)];
    expect(computeCounts(records)).toEqual({ a: 2, b: 1 });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/feed-stats.test.ts
```

预期：FAIL，`Error: Cannot find module '../../src/lib/feedStats' imported from …`。

- [ ] **Step 3: 实现 `src/lib/feedStats.ts`**

```ts
// Per-player numbers the home page derives from the loaded feed (the newest
// CORE_FEED_LIMIT records). Pure — unit-tested in tests/unit/feed-stats.test.ts.
import { affectsScore } from '@shared/scoring';
import type { RecordItem } from '../types';
import { parseTimestamp } from './time';

/** One heal week. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Start of the current heal week (ms): one week before the next reset. NaN if unparseable. */
export function weekStartOf(nextResetAt: string): number {
  return parseTimestamp(nextResetAt) - WEEK_MS;
}

/** Filed in the current heal week. An unparseable timestamp never counts. */
export function inWeek(record: RecordItem, weekStart: number): boolean {
  const at = parseTimestamp(record.created_at);
  return !Number.isNaN(at) && at >= weekStart;
}

/** Sum of scored deltas per subject within the current heal week. */
export function computeTrends(
  records: readonly RecordItem[],
  nextResetAt: string,
): Record<string, number> {
  const weekStart = weekStartOf(nextResetAt);
  return records
    .filter((r) => affectsScore(r.status) && inWeek(r, weekStart))
    .reduce<Record<string, number>>(
      (acc, r) => ({ ...acc, [r.subject.id]: (acc[r.subject.id] ?? 0) + r.delta }),
      {},
    );
}

/** Count of records involving each subject (from the loaded feed). */
export function computeCounts(records: readonly RecordItem[]): Record<string, number> {
  return records.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.subject.id]: (acc[r.subject.id] ?? 0) + 1 }),
    {},
  );
}
```

- [ ] **Step 4: App.tsx 改用它**（逐条按片段替换）

1. 删掉 `affectsScore` 的 import（基线 `:2`；只有 computeTrends 用它）：

```tsx
// 改前
import { affectsScore } from '@shared/scoring';
```

```tsx
// 改后：整段删除
```

2. time 的 import 去掉 `parseTimestamp`（基线 `:23`）：

```tsx
// 改前
import { lastWeekStartOf, parseTimestamp } from './lib/time';
```

```tsx
// 改后
import { lastWeekStartOf } from './lib/time';
```

3. 在 deepLink import 之后新增 feedStats 的 import（基线 `:24`）：

```tsx
// 改前
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './lib/deepLink';
```

```tsx
// 改后
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './lib/deepLink';
import { computeCounts, computeTrends } from './lib/feedStats';
```

4. 删掉 `WEEK_MS`（基线 `:45`；P0-3 已删则跳过）：

```tsx
// 改前
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
```

```tsx
// 改后：整段删除
```

5. 删掉两个本地函数（基线 `:96-119`，连同其后的空行）：

```tsx
// 改前
/** Sum of scored deltas per subject within the current heal week. */
function computeTrends(records: RecordItem[], nextResetAt: string): Record<string, number> {
  const weekStart = parseTimestamp(nextResetAt) - WEEK_MS;
  const trends: Record<string, number> = {};
  for (const r of records) {
    if (!affectsScore(r.status)) {
      continue;
    }
    const at = parseTimestamp(r.created_at);
    if (!Number.isNaN(at) && at >= weekStart) {
      trends[r.subject.id] = (trends[r.subject.id] ?? 0) + r.delta;
    }
  }
  return trends;
}

/** Count of records involving each subject (from the loaded feed). */
function computeCounts(records: RecordItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    counts[r.subject.id] = (counts[r.subject.id] ?? 0) + 1;
  }
  return counts;
}
```

```tsx
// 改后：整段删除
```

- [ ] **Step 5: 运行，确认通过且 App 行为不变**

```bash
npx vitest run --config vitest.config.ts tests/unit/feed-stats.test.ts
npm run typecheck
npx vitest run --config vitest.dom.config.ts
```

预期：feed-stats 5 例 PASS；typecheck 通过；dom 全部原样通过（`p8-app`、`deep-link` 不受影响）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/feedStats.ts tests/unit/feed-stats.test.ts src/App.tsx
git commit -m "refactor: 把榜单趋势与记录数统计挪到 src/lib/feedStats"
```

---

### Task 3: 本周之星的计算与整周门槛

**Files:**
- Modify: `src/lib/constants.ts`（文件末尾追加 P0-4 小节）
- Create: `src/lib/weekStars.ts`
- Test: `tests/unit/week-stars.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/week-stars.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { computeWeekHighlights } from '../../src/lib/weekStars';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// 本周之星 (spec §5 #1, §9 P0-4): only from decided records, only when the
// feed covers the whole week, never ranked by name, never a 鸽王.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function rec(
  id: number,
  subjectId: string,
  type: ViolationType,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId, avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

const onTime = (id: number, who: string, status: CaseStatus = 'decided'): RecordItem =>
  rec(id, who, 'on_time_bonus', 2, status);
/** The oldest row in the feed is from last week: the week is fully covered. */
const OLD = rec(1, '老王', 'organizer_bonus', 2, 'decided', LAST_WEEK);

describe('computeWeekHighlights — the whole-week threshold', () => {
  it('hides on an empty feed', () => {
    expect(computeWeekHighlights([], NEXT_RESET)).toEqual({ kind: 'hidden' });
  });

  it('hides when the feed does not reach back past the week start', () => {
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), onTime(2, '阿杰')];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'hidden' });
  });

  it('hides when nextResetAt cannot be read', () => {
    expect(computeWeekHighlights([onTime(3, '阿杰'), onTime(2, '阿杰'), OLD], 'soon')).toEqual({
      kind: 'hidden',
    });
  });
});

describe('computeWeekHighlights — stars', () => {
  it('needs at least two decided on-time bonuses this week', () => {
    const result = computeWeekHighlights(
      [onTime(5, '阿杰'), onTime(4, '小红'), onTime(3, '阿杰'), onTime(2, '阿杰'), OLD],
      NEXT_RESET,
    );
    expect(result).toEqual({
      kind: 'stars',
      stars: [{ user: { id: '阿杰', username: '阿杰', avatar_url: null }, onTime: 3 }],
    });
  });

  it('lists every tie, most bonuses first, then feed order — not by name', () => {
    // Feed is newest first: 阿杰 shows up before 小红. By code point 小红 sorts
    // first, so a name sort would flip them.
    const records = [onTime(6, '阿杰'), onTime(5, '小红'), onTime(4, '阿杰'), onTime(3, '小红'), onTime(2, '老王'), onTime(7, '老王'), onTime(8, '老王'), OLD];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind).toBe('stars');
    if (result.kind !== 'stars') return;
    expect(result.stars.map((s) => [s.user.id, s.onTime])).toEqual([
      ['老王', 3],
      ['阿杰', 2],
      ['小红', 2],
    ]);
  });

  it('a low score is no bar: last week’s heavy penalty does not count against this week', () => {
    // 阿杰 lost 25 last week (so he sits low on the board) and was on time twice since.
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), rec(2, '阿杰', 'no_show_group', -25, 'decided', LAST_WEEK), OLD];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind === 'stars' && result.stars.map((s) => s.user.id)).toEqual(['阿杰']);
  });

  it('a decided penalty this week rules a player out', () => {
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), rec(2, '阿杰', 'late_minor', -3), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'none' });
  });

  it('open, revoked or withdrawn cases, and last week, do not count either way', () => {
    const records = [
      onTime(7, '阿杰'),
      onTime(6, '阿杰'),
      onTime(5, '小红', 'revoked'),
      onTime(4, '小红'),
      rec(3, '阿杰', 'no_show', 0, 'awaiting_statement'),
      rec(2, '阿杰', 'no_show', -12, 'revoked'),
      rec(1, '阿杰', 'no_show', -12, 'decided', LAST_WEEK),
    ];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind).toBe('stars');
    if (result.kind !== 'stars') return;
    expect(result.stars.map((s) => s.user.id)).toEqual(['阿杰']);
  });
});

describe('computeWeekHighlights — nobody qualifies', () => {
  it('says all-clean when this week has no decided penalty', () => {
    expect(computeWeekHighlights([onTime(2, '阿杰'), OLD], NEXT_RESET)).toEqual({ kind: 'all-clean' });
  });

  it('says none when someone was penalized this week', () => {
    const records = [onTime(3, '阿杰'), rec(2, '小红', 'no_show', -12, 'appealed'), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'none' });
  });

  it('a board tied at full marks names nobody — there is no 鸽王 kind at all', () => {
    const result = computeWeekHighlights([onTime(3, '阿杰'), onTime(2, '小红'), OLD], NEXT_RESET);
    expect(result).toEqual({ kind: 'all-clean' });
    expect(JSON.stringify(result)).not.toContain('鸽王');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/week-stars.test.ts
```

预期：FAIL，`Error: Cannot find module '../../src/lib/weekStars' imported from …`。

- [ ] **Step 3: 在 `src/lib/constants.ts` 末尾追加 P0-4 小节**

如果 P0-3 已经写了 `// --- P0-4 ---` 小节（契约 §3.0 的清单里列了这两行），只核对两个值是 `2` 和 `10`，不要重复追加；否则在文件末尾追加：

```ts
// --- P0-4 ---
/** 本周之星: at least this many 守约守时 bonuses this week (spec §5 #1). */
export const WEEK_STAR_MIN_ON_TIME = 2;
/** The home feed shows this many rows before 看更多. */
export const FEED_PREVIEW_COUNT = 10;
```

- [ ] **Step 4: 实现 `src/lib/weekStars.ts`**

```ts
// 本周之星 from the loaded feed (spec §5 #1). Pure — tests/unit/week-stars.test.ts.
//
// The feed is only the newest CORE_FEED_LIMIT records, so a busy week can be
// cut off part-way. Naming anyone from a truncated week would be guessing; the
// row is hidden unless the feed reaches back past the week's start. P4 swaps
// this for the API's week_* fields and drops the threshold.
import { affectsScore } from '@shared/scoring';
import type { RecordItem, UserRef } from '../types';
import { WEEK_STAR_MIN_ON_TIME } from './constants';
import { inWeek, weekStartOf } from './feedStats';
import { parseTimestamp } from './time';

export interface WeekStar {
  user: UserRef;
  onTime: number;
}

export type WeekHighlightsResult =
  | { kind: 'hidden' }
  | { kind: 'stars'; stars: readonly WeekStar[] }
  | { kind: 'all-clean' }
  | { kind: 'none' };

/** The oldest record in the feed predates the week, so the whole week is in it. */
function coversWholeWeek(records: readonly RecordItem[], weekStart: number): boolean {
  const times = records
    .map((r) => parseTimestamp(r.created_at))
    .filter((at) => !Number.isNaN(at));
  return times.length > 0 && !Number.isNaN(weekStart) && Math.min(...times) < weekStart;
}

/** On-time bonuses per subject, in the order each subject first appears in the feed. */
function countOnTime(decided: readonly RecordItem[]): readonly WeekStar[] {
  return decided
    .filter((r) => r.type === 'on_time_bonus')
    .reduce<readonly WeekStar[]>((acc, r) => {
      const at = acc.findIndex((s) => s.user.id === r.subject.id);
      return at === -1
        ? [...acc, { user: r.subject, onTime: 1 }]
        : acc.map((s, i) => (i === at ? { ...s, onTime: s.onTime + 1 } : s));
    }, []);
}

/**
 * Stars: ≥ WEEK_STAR_MIN_ON_TIME decided 守约守时 this week and no decided
 * penalty this week. Score plays no part, so a low score can still win. Ties
 * are all listed — most bonuses first, then feed order, never by name.
 */
export function computeWeekHighlights(
  records: readonly RecordItem[],
  nextResetAt: string,
): WeekHighlightsResult {
  const weekStart = weekStartOf(nextResetAt);
  if (!coversWholeWeek(records, weekStart)) {
    return { kind: 'hidden' };
  }
  const decided = records.filter((r) => affectsScore(r.status) && inWeek(r, weekStart));
  const penalized = new Set(decided.filter((r) => r.delta < 0).map((r) => r.subject.id));
  // Array.prototype.sort is stable, so equal counts keep their feed order.
  const stars = [...countOnTime(decided)]
    .filter((s) => s.onTime >= WEEK_STAR_MIN_ON_TIME && !penalized.has(s.user.id))
    .sort((a, b) => b.onTime - a.onTime);
  if (stars.length > 0) {
    return { kind: 'stars', stars };
  }
  return penalized.size === 0 ? { kind: 'all-clean' } : { kind: 'none' };
}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/week-stars.test.ts
npm run typecheck
```

预期：11 例 PASS；typecheck 通过（`tests/unit` 由 `tsconfig.worker.json` 检查——`weekStars.ts` 只依赖 `@shared/scoring`、`./constants`、`./feedStats`、`./time` 和类型，全是纯模块）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/constants.ts src/lib/weekStars.ts tests/unit/week-stars.test.ts
git commit -m "feat: 本周之星的计算与整周数据门槛"
```

---

### Task 4: ScoreGauge 新增 `tone="neutral"`

**Files:**
- Modify: `src/components/ScoreGauge.tsx:1-74`（整文件替换，签名只加可选 `tone`）
- Modify: `src/components/score-gauge.css`（`:47` 之后追加）
- Test: `tests/dom/score-gauge.test.tsx`

- [ ] **Step 1: 写失败的测试**

`tests/dom/score-gauge.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreGauge } from '../../src/components/ScoreGauge';

// tone="neutral" (spec §6.2): public views show the number, never the 段位 —
// neither in the ring's colour nor in what a screen reader hears.

describe('ScoreGauge', () => {
  it('keeps today’s tier colour and label by default', () => {
    render(<ScoreGauge score={96} />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', '信誉分 96 分，段位 誓约之光');
    expect(gauge.className).toBe('gauge');
    expect(gauge.style.getPropertyValue('--tier')).not.toBe('');
  });

  it('neutral: the label is only the score, and no tier colour is set', () => {
    render(<ScoreGauge score={38} tone="neutral" />);
    const gauge = screen.getByRole('img');
    expect(gauge).toHaveAttribute('aria-label', '信誉分 38 分');
    expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    expect(gauge).toHaveClass('gauge', 'gauge--neutral');
    expect(gauge.style.getPropertyValue('--tier')).toBe('');
  });

  it('neutral keeps a custom label', () => {
    render(<ScoreGauge score={120} tone="neutral" label="当前" />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '当前 100 分');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/score-gauge.test.tsx
```

预期：第 1 例 PASS（默认行为本来如此）；第 2、3 例 FAIL：aria-label 是 `信誉分 38 分，段位 资深鸽王` / `当前 100 分，段位 誓约之光`（TS 也会报 `tone` 不是已知 prop，vitest 不做类型检查所以照样跑）。

- [ ] **Step 3: 实现**

`src/components/ScoreGauge.tsx` 整文件替换为：

```tsx
import type { CSSProperties } from 'react';
import { clampScore, tierFor } from '@shared/scoring';
import './score-gauge.css';

interface ScoreGaugeProps {
  score: number;
  size?: number; // px diameter
  strokeWidth?: number;
  label?: string;
  /**
   * Default 'tier' — today's colour and aria-label. 'neutral': ring uses
   * --score-chip-fg, no --tier is set, aria-label is `${label} ${value} 分`
   * (no 段位). Everyone but the viewer themself gets 'neutral' (spec §6.2).
   */
  tone?: 'tier' | 'neutral';
}

/**
 * Hand-rolled SVG circular gauge (0..100). Arc color follows tierFor(score),
 * unless tone="neutral": on public views the score is public, but the 段位 is
 * a label the board does not pin on anyone but the viewer. Big tabular numeral
 * in the center. Animates via stroke-dashoffset (respects reduced motion
 * through the CSS transition).
 */
export function ScoreGauge({
  score,
  size = 132,
  strokeWidth = 10,
  label = '信誉分',
  tone = 'tier',
}: ScoreGaugeProps): JSX.Element {
  const value = clampScore(score);
  const tier = tierFor(value);
  const neutral = tone === 'neutral';
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - value / 100);
  const fontSize = size * 0.34;
  // React applies this through CSSOM, which the CSP allows without 'unsafe-inline'.
  const style: CSSProperties = neutral
    ? { width: size, height: size }
    : { width: size, height: size, ['--tier' as string]: tier.color };

  return (
    <div
      className={neutral ? 'gauge gauge--neutral' : 'gauge'}
      style={style}
      role="img"
      aria-label={neutral ? `${label} ${value} 分` : `${label} ${value} 分，段位 ${tier.name}`}
    >
      <svg
        className="gauge__svg"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
      >
        <circle
          className="gauge__track"
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
        />
        <circle
          className="gauge__arc"
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="gauge__center">
        <span className="gauge__value tabular" style={{ fontSize }}>
          {value}
        </span>
        <span className="gauge__unit">分</span>
      </div>
    </div>
  );
}
```

`src/components/score-gauge.css` 末尾追加：

```css
/* Public views (tone="neutral"): one colour for everybody, no glow — the ring
   must not hint at a 段位 (spec §6.2). */
.gauge--neutral .gauge__svg {
  filter: none;
}

.gauge--neutral .gauge__arc {
  stroke: var(--score-chip-fg);
}

.gauge--neutral .gauge__value {
  color: var(--score-chip-fg);
  text-shadow: none;
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/score-gauge.test.tsx
npm run typecheck
```

预期：3 例 PASS；typecheck 通过。`PlayerDetail.tsx:155` 不传 `tone`，默认 `'tier'`，行为不变（公开选手页的 neutral 归 P1-1）。

- [ ] **Step 5: 提交**

```bash
git add src/components/ScoreGauge.tsx src/components/score-gauge.css tests/dom/score-gauge.test.tsx
git commit -m "feat: ScoreGauge 新增 neutral 色调，公开处不念段位"
```

---

### Task 5: 信誉榜——同分同名次、无奖牌、分数常显、段位只给本人

**Files:**
- Modify: `src/components/Leaderboard.tsx:1-92`（整文件替换；`participants/trends/counts/onSelect` 不变，只加可选 `meId`、`highlights`）
- Modify: `src/components/leaderboard.css:1-162`（整文件替换，见 Step 4 的说明）
- Modify: `src/App.tsx:352-357`（`<Leaderboard>` 加 `meId`）
- Test: `tests/dom/board.test.tsx`（新建）

- [ ] **Step 1: 写失败的测试**

新建 `tests/dom/board.test.tsx`，内容是下面三段按顺序拼接（import、说明与 fixtures、Leaderboard 用例；后面的 Task 会继续往文件末尾追加 describe，并替换 import 块）：

```tsx
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import type { CaseStatus, PublicUser, RecordItem, ViolationType } from '../../src/types';

// P0-4 (spec §9): the board without shaming — tied ranks, no medals, scores on
// every width, 段位 only on the viewer's own row, 本周之星 instead of 红黑榜,
// a shorter feed, a compact report with no awards, and a welcome card.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function player(id: string, username: string, score: number): PublicUser {
  return { id, username, avatar_url: null, is_participant: true, is_judge: false, score, created_at: 'x' };
}

function rec(
  id: number,
  subjectId: string,
  type: ViolationType,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId === 'a' ? '阿杰' : subjectId === 'b' ? '小红' : '老王', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

const onTime = (id: number, who: string): RecordItem => rec(id, who, 'on_time_bonus', 2);
const OLD = rec(1, 'c', 'organizer_bonus', 2, 'decided', LAST_WEEK);
/** 阿杰 ×3, 小红 ×2 this week, and the feed reaches back into last week. */
const STAR_FEED = [onTime(6, 'a'), onTime(5, 'b'), onTime(4, 'a'), onTime(3, 'b'), onTime(2, 'a'), OLD];

const TIED = [player('a', '阿杰', 100), player('b', '小红', 100), player('c', '老王', 96)];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Leaderboard', () => {
  const renderBoard = (meId: string | null = null) =>
    render(<Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} meId={meId} />);

  it('gives tied scores the same rank', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: '第 1 名 阿杰，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 1 名 小红，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 3 名 老王，96 分' })).toBeInTheDocument();
  });

  it('hands out no medals', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/🥇|🥈|🥉/);
    expect(container.querySelector('[class*="lb-row--rank"]')).toBeNull();
  });

  it('shows every score as a number outside the gauge, and every gauge is neutral', () => {
    const { container } = renderBoard();
    const scores = [...container.querySelectorAll('.lb-row__score')].map((el) => el.textContent);
    expect(scores).toEqual(['100', '100', '96']);
    for (const gauge of screen.getAllByRole('img', { hidden: true })) {
      expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    }
  });

  it('shows a 段位 only on the viewer’s own row', () => {
    const { container } = renderBoard('c');
    expect(container.querySelectorAll('.tier-badge')).toHaveLength(1);
    const mine = screen.getByRole('button', { name: '第 3 名 老王，96 分' });
    expect(mine).toHaveClass('lb-row--me');
    expect(within(mine).getByText('誓约之光')).toBeInTheDocument();
  });

  it('shows no 段位 at all to a visitor', () => {
    const { container } = renderBoard(null);
    expect(container.querySelector('.tier-badge')).toBeNull();
    expect(container.querySelector('.lb-row--me')).toBeNull();
  });

  it('renders the highlights slot between the head and the list', () => {
    const { container } = render(
      <Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} highlights={<p className="wh">x</p>} />,
    );
    expect(container.querySelector('.lb__head + .wh + .lb__list')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：FAIL——「第 1 名 小红，100 分」找不到（今天是第 2 名）；文本里有 🥇🥈；没有 `.lb-row__score`；圆环 aria-label 含「段位」；`.tier-badge` 有 3 个；`highlights` 插槽不存在。

- [ ] **Step 3: 实现 `src/components/Leaderboard.tsx`（整文件替换）**

```tsx
import type { ReactNode } from 'react';
import type { PublicUser } from '../types';
import { competitionRanks } from '../lib/rank';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import './leaderboard.css';

interface LeaderboardProps {
  participants: PublicUser[];
  /** subject id -> net score change accumulated this week (from the records feed). */
  trends: Record<string, number>;
  /** subject id -> count of records involving them (from the records feed). */
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  /** The viewer: their row is highlighted and is the only one with a TierBadge. */
  meId?: string | null;
  /** Rendered between .lb__head and the list (WeekHighlights in P0; BoardMini's head from P3). */
  highlights?: ReactNode;
}

function Trend({ value }: { value: number }): JSX.Element {
  if (value === 0) {
    return <span className="lb-trend lb-trend--flat">±0</span>;
  }
  const up = value > 0;
  return (
    <span className={`lb-trend ${up ? 'lb-trend--up' : 'lb-trend--down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="tabular">{up ? `+${value}` : value}</span>
    </span>
  );
}

interface RowProps {
  player: PublicUser;
  rank: number;
  trend: number;
  count: number;
  isMe: boolean;
  onSelect: (id: string) => void;
}

/**
 * One board row. No medals and no 段位 for anyone but the viewer (spec §6.2):
 * the score is public, the label is not ours to pin on someone. The number
 * sits outside the gauge so phones, which drop the gauge, still show it (H6).
 */
function Row({ player, rank, trend, count, isMe, onSelect }: RowProps): JSX.Element {
  return (
    <button
      type="button"
      className={`lb-row${isMe ? ' lb-row--me' : ''}`}
      onClick={() => onSelect(player.id)}
      aria-label={`第 ${rank} 名 ${player.username}，${player.score} 分`}
    >
      <span className="lb-row__rank tabular">{rank}</span>

      <span className="lb-row__player">
        <Avatar name={player.username} src={player.avatar_url} size={44} />
        <span className="lb-row__id">
          <span className="lb-row__name">{player.username}</span>
          {isMe && (
            <span className="lb-row__badge">
              <TierBadge score={player.score} size="sm" />
            </span>
          )}
        </span>
      </span>

      <span className="lb-row__trend">
        <Trend value={trend} />
        <span className="lb-row__records">{count} 条记录</span>
      </span>

      <span className="lb-row__score tabular">{player.score}</span>

      <span className="lb-row__gauge">
        <ScoreGauge score={player.score} size={62} strokeWidth={6} tone="neutral" />
      </span>
    </button>
  );
}

export function Leaderboard({
  participants,
  trends,
  counts,
  onSelect,
  meId = null,
  highlights,
}: LeaderboardProps): JSX.Element {
  const ranks = competitionRanks(participants.map((p) => p.score));
  return (
    <section className="lb panel" aria-labelledby="lb-heading">
      <header className="lb__head">
        <h2 id="lb-heading" className="lb__title">
          信誉榜
        </h2>
        <span className="lb__count">{participants.length} 位选手</span>
      </header>

      {highlights}

      {participants.length === 0 ? (
        <p className="lb__empty">还没有上榜选手，登录后成为选手即可上榜。</p>
      ) : (
        <ol className="lb__list">
          {participants.map((p, index) => (
            <li key={p.id}>
              <Row
                player={p}
                rank={ranks[index]}
                trend={trends[p.id] ?? 0}
                count={counts[p.id] ?? 0}
                isMe={meId !== null && p.id === meId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 4: `src/components/leaderboard.css` 整文件替换**

下面的内容已经按 P0-1 的约定写好（`:hover` 包在 `@media (hover: hover)` 里、断点只用 600/1024、字号用 `--fs-*`）。按 P0-1 计划套用后的文件核对过：P0-1 在这个文件里只做了两处改动——`.lb-row:hover` 包进 `@media (hover: hover)`、`560px → 600px`，下面都已包含。替换前仍先 `git log -p origin/main -- src/components/leaderboard.css` 看一眼；如果 P0-1 实际合并的版本还有别的改动（比如 forced-colors 规则），把它补进下面的内容里再保存。本人那一行用 `--panel-2` 底色加 `--text` 竖边，**不用金色**：spec §6.2 规定 `--action`（金）只用于主操作按钮和当前导航项。删掉的规则：`.lb-row__medal`、`.lb-row--rank1/2/3`（奖牌与前三名描边）、手机上隐藏 `.lb-row__badge` 的规则（徽章现在只出现在本人那一行，手机上也要看得到）。

```css
.lb {
  padding: clamp(1rem, 0.75rem + 1vw, 1.5rem);
}

.lb__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border);
}

.lb__title {
  font-size: var(--text-h2);
  letter-spacing: 0.06em;
}

.lb__count {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.lb__empty {
  padding: 2rem 0.5rem;
  color: var(--muted);
  text-align: center;
}

.lb__list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* rank · player · trend · score · gauge. The gauge column only exists on
   desktop; below it the plain score takes its place (H6). */
.lb-row {
  width: 100%;
  min-height: 56px;
  display: grid;
  grid-template-columns: 2.4rem 1fr auto auto;
  align-items: center;
  gap: 0.75rem 1rem;
  padding: 0.7rem 0.5rem;
  border-radius: var(--r-md);
  border: 1px solid transparent;
  text-align: left;
  transition: background var(--dur-fast), border-color var(--dur-fast),
    transform var(--dur-fast) var(--ease);
}

.lb-row + .lb-row,
.lb__list li + li .lb-row {
  border-top: 1px solid var(--border);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

@media (hover: hover) {
  .lb-row:hover {
    background: var(--panel-2);
    border-color: var(--border-strong);
    transform: translateX(2px);
  }
}

/* The viewer's own row: a lifted surface and a plain edge — not gold, which is
   reserved for the primary action (spec §6.2) — and it is also the only row with
   a TierBadge, so it is not marked by colour alone. */
.lb-row--me {
  background: var(--panel-2);
  box-shadow: inset 3px 0 0 0 var(--text);
}

.lb-row__rank {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--muted);
  text-align: center;
}

.lb-row__player {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
}

.lb-row__id {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.lb-row__name {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: var(--fs-md);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lb-row__trend {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.25rem;
}

.lb-trend {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: var(--fs-sm);
}

.lb-trend--up {
  color: var(--up);
}
.lb-trend--down {
  color: var(--down);
}
.lb-trend--flat {
  color: var(--faint);
}

.lb-row__records {
  font-size: var(--fs-xs);
  color: var(--muted);
}

/* Public score: one neutral colour for everybody (spec §6.2). */
.lb-row__score {
  min-width: 2.5ch;
  font-size: var(--fs-xl);
  font-weight: 700;
  text-align: right;
  color: var(--score-chip-fg);
}

.lb-row__gauge {
  display: none;
  place-items: center;
}

@media (min-width: 1024px) {
  .lb-row__score {
    display: none;
  }
  .lb-row__gauge {
    display: grid;
  }
}

/* Phones: 名次 · 头像 · 名字 · 分数 (spec §6.4). */
@media (max-width: 600px) {
  .lb-row {
    grid-template-columns: 1.9rem 1fr auto;
    gap: 0.5rem 0.6rem;
  }
  .lb-row__trend {
    display: none;
  }
}
```

- [ ] **Step 5: App 传 `meId`**

1. `<Leaderboard>` 加 `meId`（基线 `:352-358`）：

```tsx
// 改前
              onSelect={setSelectedUserId}
            />
            <RulesPanel config={config} />
```

```tsx
// 改后
              onSelect={setSelectedUserId}
              meId={me?.id ?? null}
            />
            <RulesPanel config={config} />
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：board 6 例 PASS；dom 全量通过；css-conventions 通过；typecheck 通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/Leaderboard.tsx src/components/leaderboard.css src/App.tsx tests/dom/board.test.tsx
git commit -m "feat: 信誉榜同分同名次、不发奖牌、手机显示分数、段位只给本人"
```

---

### Task 6: 用本周之星替换红黑榜

**Files:**
- Create: `src/components/WeekHighlights.tsx`、`src/components/week-highlights.css`
- Delete: `src/components/RedBlackBoard.tsx`、`src/components/red-black-board.css`
- Modify: `src/App.tsx:26-27`（import）、`:284-285`（删 `top`/`bottom`）、`:327`（删 `<RedBlackBoard>`）、`:352-357`（`<Leaderboard>` 加 `highlights`）
- Modify: `src/app.css:79-82`、`:167-171`（删 `.rbb` 规则）
- Modify: `src/theme.css:303`（只删 `.hero-card__link,` 这一行）
- Modify: `src/components/OnboardingDialog.tsx:29`（只改 desc）
- Test: `tests/dom/board.test.tsx`（追加 WeekHighlights 用例）

- [ ] **Step 1: 写失败的测试**

把 `tests/dom/board.test.tsx` 顶部的 import 块替换为：

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import type { CaseStatus, PublicUser, RecordItem, ViolationType } from '../../src/types';
```

在文件末尾追加：

```tsx
describe('WeekHighlights', () => {
  it('names this week’s stars, most bonuses first, and links to them', async () => {
    const onSelectUser = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} onSelectUser={onSelectUser} />,
    );
    expect(container.textContent).toBe('⭐ 本周之星：阿杰（准时 3 次）、小红（准时 2 次）');
    await user.click(screen.getByRole('button', { name: '小红' }));
    expect(onSelectUser).toHaveBeenCalledWith('b');
  });

  it('renders nothing when the feed does not cover the whole week', () => {
    const { container } = render(<WeekHighlights records={STAR_FEED.slice(0, -1)} nextResetAt={NEXT_RESET} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('celebrates a clean week and nudges when nobody made it', () => {
    const { rerender } = render(<WeekHighlights records={[onTime(2, 'a'), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周全员守约 🎉')).toBeInTheDocument();
    rerender(<WeekHighlights records={[rec(2, 'a', 'no_show', -12), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周还没人摘星，今晚去约一局？')).toBeInTheDocument();
  });

  it('is never a heading', () => {
    render(<WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} />);
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('a low score can still be the star, and the board names no 鸽王', () => {
    const low = [player('a', '阿杰', 100), player('b', '小红', 30)];
    const { container } = render(
      <Leaderboard
        participants={low}
        trends={{}}
        counts={{}}
        onSelect={() => {}}
        highlights={<WeekHighlights records={[onTime(3, 'b'), onTime(2, 'b'), OLD]} nextResetAt={NEXT_RESET} />}
      />,
    );
    expect(container.querySelector('.wh')?.textContent).toBe('⭐ 本周之星：小红（准时 2 次）');
    expect(container.textContent).not.toContain('鸽王');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：FAIL，`Failed to resolve import "../../src/components/WeekHighlights"`。

- [ ] **Step 3: 实现 `src/components/WeekHighlights.tsx`**

```tsx
import { Fragment } from 'react';
import type { RecordItem } from '../types';
import { computeWeekHighlights } from '../lib/weekStars';
import type { WeekStar } from '../lib/weekStars';
import './week-highlights.css';

interface WeekHighlightsProps {
  records: readonly RecordItem[];
  nextResetAt: string;
  onSelectUser?: (id: string) => void;
}

function StarName({ star, onSelectUser }: { star: WeekStar; onSelectUser?: (id: string) => void }): JSX.Element {
  const name = <strong className="wh__name">{star.user.username}</strong>;
  return (
    <>
      {onSelectUser ? (
        <button type="button" className="wh__link" onClick={() => onSelectUser(star.user.id)}>
          {name}
        </button>
      ) : (
        name
      )}
      （准时 {star.onTime} 次）
    </>
  );
}

/**
 * One line in the board's head that replaced the old top/bottom board (spec §5 #1): it only ever
 * praises, with a threshold, and names nobody when the feed cannot vouch for
 * the whole week. Deliberately not a heading — the page keeps exactly one /约局/
 * heading and the board its own 信誉榜.
 */
export function WeekHighlights({
  records,
  nextResetAt,
  onSelectUser,
}: WeekHighlightsProps): JSX.Element | null {
  const result = computeWeekHighlights(records, nextResetAt);
  switch (result.kind) {
    case 'hidden':
      return null;
    case 'all-clean':
      return <p className="wh">本周全员守约 🎉</p>;
    case 'none':
      return <p className="wh wh--quiet">本周还没人摘星，今晚去约一局？</p>;
    case 'stars':
      return (
        <p className="wh">
          <span aria-hidden="true">⭐</span> 本周之星：
          {result.stars.map((star, i) => (
            <Fragment key={star.user.id}>
              {i > 0 && '、'}
              <StarName star={star} onSelectUser={onSelectUser} />
            </Fragment>
          ))}
        </p>
      );
  }
}
```

`src/components/week-highlights.css`：

```css
/* 本周之星 — one ~40px line in the board's head (spec §5 #1). Plain inline flow,
   not flex: the names and 「（准时 N 次）」 must wrap like prose. */
.wh {
  min-height: 40px;
  line-height: 1.6;
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm);
  color: var(--text);
}

.wh--quiet {
  color: var(--muted);
}

.wh__link {
  padding: 0;
  border-radius: var(--r-sm);
  color: inherit;
}

.wh__name {
  font-weight: 700;
  color: var(--ok);
}

@media (hover: hover) {
  .wh__link:hover .wh__name {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}

@media (pointer: coarse) {
  /* Inline name buttons: grow the hit area without moving the line. */
  .wh__link {
    padding-block: 0.6rem;
    margin-block: -0.6rem;
  }
}
```

- [ ] **Step 4: App 换掉红黑榜**

1. import：删 RedBlackBoard，加 WeekHighlights（基线 `:26-27`）：

```tsx
// 改前
import { RedBlackBoard } from './components/RedBlackBoard';
import { Leaderboard } from './components/Leaderboard';
```

```tsx
// 改后
import { Leaderboard } from './components/Leaderboard';
import { WeekHighlights } from './components/WeekHighlights';
```

2. 删掉 `top` / `bottom`（基线 `:284-285`）：

```tsx
// 改前
  const top = participants.length > 0 ? participants[0] : null;
  const bottom = participants.length > 1 ? participants[participants.length - 1] : null;
```

```tsx
// 改后：整段删除
```

3. 删掉 `<RedBlackBoard>` 及其后空行（基线 `:327-328`）：

```tsx
// 改前
        <RedBlackBoard top={top} bottom={bottom} onSelect={setSelectedUserId} />
```

```tsx
// 改后：整段删除
```

4. `<Leaderboard>` 加 `highlights`：

```tsx
// 改前
              meId={me?.id ?? null}
            />
```

```tsx
// 改后
              meId={me?.id ?? null}
              highlights={
                <WeekHighlights
                  records={records}
                  nextResetAt={config.nextResetAt}
                  onSelectUser={setSelectedUserId}
                />
              }
            />
```

- [ ] **Step 5: 删除红黑榜及其残留样式**

```bash
git rm src/components/RedBlackBoard.tsx src/components/red-black-board.css
grep -rn "RedBlackBoard\|red-black-board\|hero-card\|\.rbb" src tests
```

上面的 grep 此时应只剩 `src/app.css` 的两处 `.rbb` 和 `src/theme.css` 的 `.hero-card__link`，按下面删掉。

`src/app.css`——删除这一段（基线 `:79-83`，含其后的空行）：

```css
/* The board is the brand moment: give it room above, but only above. */
.app__main > .rbb {
  margin-top: clamp(0.5rem, 0.25rem + 1.5vw, 1.75rem);
}
```

再在 P0-1 改过的 `@media (max-width: 1023px)`（基线是 `:160` 的 `(max-width: 900px)`）里删除这几行（基线 `:167-171`），媒体查询本身和 `.app__grid`、`.app__col--side` 两条规则保留：

```css
  /* Reclaim the hero's breathing room on phones — vertical space is the scarce
     resource there, not visual drama. */
  .app__main > .rbb {
    margin-top: 0;
  }
```

`src/theme.css`——在 `@media (pointer: coarse)` 的「句子里的文字型按钮」列表里只删 `.hero-card__link,` 一行（基线 `:303`），改后：

```css
  .feed-row__subject,
  .invite__detail,
  .wr__regen {
    padding-block: 0.6rem;
    margin-block: -0.6rem;
  }
```

`src/components/OnboardingDialog.tsx:29`——红黑榜没了，desc 跟着改（契约 §2.3，只动这一行）：

```ts
// 改前
    desc: '拥有信誉分，出现在红黑榜上，接受裁判记录。',
// 改后
    desc: '拥有信誉分，出现在信誉榜上，接受裁判记录。',
```

- [ ] **Step 6: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
grep -rn "RedBlackBoard\|red-black-board\|hero-card\|\.rbb\|头号鸽王\|红黑榜" src
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.config.ts
npm run typecheck
```

预期：board 11 例 PASS；grep 无输出；dom、unit 全量通过（`onboarding-roles` 只断言 radio 名，不读 desc）；typecheck 通过。

- [ ] **Step 7: 提交**

```bash
git add src/components/WeekHighlights.tsx src/components/week-highlights.css src/App.tsx src/app.css src/theme.css src/components/OnboardingDialog.tsx tests/dom/board.test.tsx
git status --short   # RedBlackBoard.tsx / red-black-board.css 应显示为 D（Step 5 的 git rm 已暂存）
git commit -m "feat: 用本周之星替换红黑榜"
```

---

### Task 7: 首页动态流默认 10 条加「看更多」

**Files:**
- Modify: `src/components/RecordsFeed.tsx:1-160`（整文件替换；`records/title/onSelectUser/compact/emptyHint` 不变，只加可选 `previewCount`；`RecordRow` 内部多一个可选 `rowRef`。原来 78 行的 `RecordRow` 顺手拆成 `RecordRow`/`RecordLine`/`RecordMeta`/`RecordDelta` 四个小组件（机主规则：函数 < 50 行），**渲染出的 markup 与今天逐字节一致**——已用新旧两版对同一组记录（含 decided/awaiting_statement/judging/revoked/withdrawn、带与不带 `onSelectUser`）比对 `innerHTML`）
- Modify: `src/components/records-feed.css`（`:172` 之后追加）
- Modify: `src/App.tsx:24` 之后（import）、`:362-367`（`<RecordsFeed>` 加 `previewCount`）
- Test: `tests/dom/board.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

import 块替换为：

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import type { CaseStatus, PublicUser, RecordItem, ViolationType } from '../../src/types';
```

文件末尾追加：

```tsx
describe('RecordsFeed previewCount', () => {
  const many = Array.from({ length: 12 }, (_, i) => rec(100 - i, 'a', 'on_time_bonus', 2));

  it('shows the first N rows, then 看更多 reveals the rest and takes focus there', async () => {
    const user = userEvent.setup();
    const { container } = render(<RecordsFeed records={many} previewCount={10} />);
    expect(container.querySelectorAll('.feed-row')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: '看更多' }));
    const rows = container.querySelectorAll('.feed-row');
    expect(rows).toHaveLength(12);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(rows[10]);
  });

  it('has no 看更多 when everything fits, or without previewCount', () => {
    const { rerender } = render(<RecordsFeed records={many.slice(0, 10)} previewCount={10} />);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    rerender(<RecordsFeed records={many} />);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
  });

  it('keeps the .feed-row__status--escalate class for an open escalation', () => {
    const open = { ...rec(9, 'a', 'no_show', 0, 'awaiting_statement'), escalation_suggested: true };
    const { container } = render(<RecordsFeed records={[open]} previewCount={10} />);
    expect(container.querySelector('.feed-row__status--escalate')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：「shows the first N rows」FAIL（渲染了 12 行，没有「看更多」）；另两个新用例 PASS（默认行为与类名本来如此）。

- [ ] **Step 3: 实现 `src/components/RecordsFeed.tsx`（整文件替换）**

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CASE_STATUS_LABEL, VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem } from '../types';
import { relativeTime } from '../lib/time';
import { Avatar } from './Avatar';
import './records-feed.css';

interface RecordsFeedProps {
  records: RecordItem[];
  title?: string;
  onSelectUser?: (id: string) => void;
  compact?: boolean;
  emptyHint?: string;
  /** Show only the first N rows, then a 看更多 button that reveals the rest of what is loaded. */
  previewCount?: number;
}

export function RecordsFeed({
  records,
  title = '动态',
  onSelectUser,
  compact = false,
  emptyHint = '还没有任何记录。',
  previewCount,
}: RecordsFeedProps): JSX.Element {
  const headingId = useId();
  const hasTitle = title.trim().length > 0;
  const [expanded, setExpanded] = useState(false);
  const firstRevealed = useRef<HTMLLIElement>(null);
  const limited = !expanded && previewCount !== undefined && records.length > previewCount;
  const shown = limited ? records.slice(0, previewCount) : records;

  // 看更多 unmounts once pressed: hand focus to the first row it revealed, so
  // keyboard and screen-reader users carry on reading instead of landing on <body>.
  useEffect(() => {
    if (expanded) {
      firstRevealed.current?.focus();
    }
  }, [expanded]);
  return (
    <section
      className={`feed panel${compact ? ' feed--compact' : ''}`}
      aria-labelledby={hasTitle ? headingId : undefined}
      aria-label={hasTitle ? undefined : '记录'}
    >
      {hasTitle && (
        <header className="feed__head">
          <h2 id={headingId} className="feed__title">
            {title}
          </h2>
        </header>
      )}

      {records.length === 0 ? (
        <p className="feed__empty">{emptyHint}</p>
      ) : (
        <ul className="feed__list">
          {shown.map((r, i) => (
            <RecordRow
              key={r.id}
              record={r}
              onSelectUser={onSelectUser}
              rowRef={expanded && i === previewCount ? firstRevealed : undefined}
            />
          ))}
        </ul>
      )}

      {limited && (
        <button type="button" className="btn btn--ghost btn--sm feed__more" onClick={() => setExpanded(true)}>
          看更多
        </button>
      )}
    </section>
  );
}

interface RecordRowProps {
  record: RecordItem;
  onSelectUser?: (id: string) => void;
  /** Set on the first row 看更多 revealed: it takes focus (and so needs tabIndex -1). */
  rowRef?: RefObject<HTMLLIElement>;
}

function RecordRow({ record, onSelectUser, rowRef }: RecordRowProps): JSX.Element {
  const emoji = VIOLATION_MAP[record.type]?.emoji ?? '•';
  return (
    <li
      ref={rowRef}
      tabIndex={rowRef ? -1 : undefined}
      className={`feed-row feed-row--${record.status}`}
    >
      <span className="feed-row__emoji" aria-hidden="true">
        {emoji}
      </span>

      <div className="feed-row__main">
        <RecordLine record={record} onSelectUser={onSelectUser} />
        <RecordMeta record={record} />
      </div>

      <RecordDelta record={record} />
    </li>
  );
}

function RecordLine({ record, onSelectUser }: Omit<RecordRowProps, 'rowRef'>): JSX.Element {
  const label = VIOLATION_MAP[record.type]?.label ?? record.type;
  const statusLabel = CASE_STATUS_LABEL[record.status];
  return (
    <p className="feed-row__line">
      <NameLink
        id={record.subject.id}
        name={record.subject.username}
        avatar={record.subject.avatar_url}
        onSelectUser={onSelectUser}
      />
      <span className="feed-row__action">{label}</span>
      {statusLabel && (
        <span className={`feed-row__status feed-row__status--${record.status}`}>
          {statusLabel}
        </span>
      )}
      {record.escalation_suggested && record.status === 'awaiting_statement' && (
        <span
          className="feed-row__status feed-row__status--escalate"
          title="AI 认为够得上团灭级，等裁判确认"
        >
          待确认升级
        </span>
      )}
    </p>
  );
}

function RecordMeta({ record }: { record: RecordItem }): JSX.Element {
  return (
    <p className="feed-row__meta">
      <span className="feed-row__reporter">裁判 {record.reporter.username}</span>
      <span className="feed-row__dot" aria-hidden="true">
        ·
      </span>
      <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
      {/* Pre-verdict there is no headline yet, so show the AI's summary of the
          accusation instead — otherwise an open case reads as contentless. */}
      {record.verdict?.headline ? (
        <span className="feed-row__note">“{record.verdict.headline}”</span>
      ) : (
        record.claim_summary && (
          <span className="feed-row__note">“{record.claim_summary}”</span>
        )
      )}
    </p>
  );
}

function RecordDelta({ record }: { record: RecordItem }): JSX.Element {
  const positive = record.delta > 0;
  // Pre-verdict the delta is still 0 — show the pending range instead of a
  // misleading "0", so nobody reads an open case as a zero-point outcome.
  const undecided = record.status === 'awaiting_statement' || record.status === 'judging';
  const deltaText = undecided ? '?' : positive ? `+${record.delta}` : String(record.delta);
  const tone = undecided
    ? 'feed-row__delta--pending'
    : positive
      ? 'feed-row__delta--up'
      : 'feed-row__delta--down';
  const muted = record.status === 'revoked' || record.status === 'withdrawn';
  return (
    <span className={`feed-row__delta tabular ${tone}${muted ? ' feed-row__delta--muted' : ''}`}>
      {deltaText}
    </span>
  );
}

interface NameLinkProps {
  id: string;
  name: string;
  avatar: string | null;
  onSelectUser?: (id: string) => void;
}

function NameLink({ id, name, avatar, onSelectUser }: NameLinkProps): JSX.Element {
  const content = (
    <>
      <Avatar name={name} src={avatar} size={22} />
      <strong className="feed-row__name">{name}</strong>
    </>
  );
  if (!onSelectUser) {
    return <span className="feed-row__subject">{content}</span>;
  }
  return (
    <button
      type="button"
      className="feed-row__subject feed-row__subject--link"
      onClick={() => onSelectUser(id)}
    >
      {content}
    </button>
  );
}
```

`src/components/records-feed.css` 末尾追加：

```css
.feed__more {
  align-self: center;
  margin-top: 0.75rem;
}
```

- [ ] **Step 4: App 传 `previewCount`**

1. 在 feedStats 的 import 之后新增常量 import：

```tsx
// 改前
import { computeCounts, computeTrends } from './lib/feedStats';
```

```tsx
// 改后
import { computeCounts, computeTrends } from './lib/feedStats';
import { FEED_PREVIEW_COUNT } from './lib/constants';
```

2. `<RecordsFeed>` 加 `previewCount`（基线 `:362-367`）：

```tsx
// 改前
              emptyHint="还没有任何记录，等待第一笔。"
            />
```

```tsx
// 改后
              emptyHint="还没有任何记录，等待第一笔。"
              previewCount={FEED_PREVIEW_COUNT}
            />
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx tests/dom/p8-app.test.tsx
npm run typecheck
```

预期：board 14 例 PASS；`p8-app` 的 `.feed-row__status--escalate` 用例照常通过；typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/RecordsFeed.tsx src/components/records-feed.css src/App.tsx tests/dom/board.test.tsx
git commit -m "feat: 首页动态流默认 10 条加「看更多」"
```

---

### Task 8: 首页战报卡 compact，不渲染奖项

**Files:**
- Modify: `src/components/WeeklyReportCard.tsx:1-175`（整文件替换：拆出 `ReportHead`/`CompactBody`/`FullBody`，默认渲染与今天逐字一致；只加可选 `compact`）
- Modify: `src/components/weekly-report.css`（`:190` 之后追加）
- Modify: `src/App.tsx:330-331`（`<WeeklyReportCard>` 加 `compact`）
- Test: `tests/dom/board.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

import 块替换为：

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import type { CaseStatus, PublicUser, RecordItem, ViolationType, WeeklyReport } from '../../src/types';
```

文件末尾追加：

```tsx
describe('WeeklyReportCard compact', () => {
  const report: WeeklyReport = {
    week_start: '2026-10-19',
    stats: {
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      sessionsPlayed: 3,
      sessionsCollapsed: 0,
      casesFiled: 1,
      totalPenalty: -12,
      absentVerdicts: 0,
      attendanceRate: 0.8,
      upcomingNextWeek: 2,
      star: { name: '阿杰', delta: 6 },
      pigeon: { name: '老王', delta: -12 },
      bestTalker: null,
      harshest: null,
      topOrganizer: { name: '小红', count: 2 },
    },
    narrative: '平平无奇的一周。老王又鸽了一次。',
    source: 'ai',
    created_at: '2026-10-26 02:31:00',
  };

  it('shows the title, a few numbers and only the first sentence — and no award at all', () => {
    const { container } = render(<WeeklyReportCard report={report} compact />);
    expect(screen.getByRole('heading', { name: /上周战报/ })).toBeInTheDocument();
    expect(screen.getByText('平平无奇的一周。')).toBeInTheDocument();
    expect(container.querySelector('.wr-award')).toBeNull();
    expect(container.textContent).not.toContain('鸽王');
    expect(container.textContent).not.toContain('老王又鸽了一次');
    expect(container.querySelector('.wr__compact-stats')?.textContent).toBe('开局 3·立案 1·出勤率 80%');
  });

  it('keeps the stale heading and note', () => {
    render(<WeeklyReportCard report={report} compact stale />);
    expect(screen.getByRole('heading', { name: /往期战报/ })).toBeInTheDocument();
    expect(screen.getByText(/周一 10:30 之后发布/)).toBeInTheDocument();
  });

  it('is opt-in: the default card is unchanged', () => {
    const { container } = render(<WeeklyReportCard report={report} />);
    expect(container.querySelectorAll('.wr-award')).toHaveLength(3);
    expect(screen.getByText(report.narrative)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：「shows the title, a few numbers…」FAIL（渲染了 `.wr-award` 和「本周鸽王」、叙事全文）；「keeps the stale heading」「is opt-in」PASS。

- [ ] **Step 3: 实现 `src/components/WeeklyReportCard.tsx`（整文件替换）**

```tsx
import { useState } from 'react';
import type { WeeklyReport } from '../types';
import './weekly-report.css';

interface WeeklyReportCardProps {
  report: WeeklyReport;
  /** Admin only — re-roll the narrative if it landed flat. */
  onRegenerate?: () => void;
  regenerating?: boolean;
  /** Older than last week: last week's is not out yet (Monday 10:30). */
  stale?: boolean;
  /**
   * Home page: title, dates, a few numbers and the narrative's first sentence.
   * Renders no .wr-award at all — the home page names no 鸽王 (spec §2.4).
   */
  compact?: boolean;
}

const DISMISS_KEY = 'edg.report.dismissed';

function isDismissed(weekStart: string): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === weekStart;
  } catch {
    // Private mode / storage disabled: showing the card again is the harmless
    // direction to fail in.
    return false;
  }
}

function remember(weekStart: string): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, weekStart);
  } catch {
    /* nothing to do — the card simply reappears next load */
  }
}

function fmtDelta(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** Up to and including the first 。！？!?… (and any closing quote after it); the whole text if none. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[。！？!?…]+[」』”"）)]*/.exec(trimmed);
  return match ? match[0] : trimmed;
}

function attendance(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * 上周战报 — one paragraph of personality on top of numbers that came from SQL.
 *
 * The split is load-bearing: the prose is AI-written and allowed to be playful,
 * the figures below it are computed server-side and rendered deadpan. Nothing in
 * the stat strip is ever phrased as a joke, because a number that reads as a
 * punchline is a number nobody trusts.
 */
interface ReportHeadProps {
  report: WeeklyReport;
  stale: boolean;
  regenerating: boolean;
  onRegenerate?: () => void;
  onDismiss: () => void;
}

/** Shared by the full and the compact card: the h2 wording (/上周战报/, /往期战报/) is locked by tests. */
function ReportHead({ report, stale, regenerating, onRegenerate, onDismiss }: ReportHeadProps): JSX.Element {
  const s = report.stats;
  return (
    <>
      <header className="wr__head">
        <h2 id="wr-title" className="wr__title">
          <span aria-hidden="true">📮</span> {stale ? '往期战报' : '上周战报'}
          <span className="wr__range tabular">
            {shortDate(s.weekStart)} – {shortDate(s.weekEnd)}
          </span>
        </h2>
        <div className="wr__head-actions">
          {report.source === 'fallback' && <span className="wr__flag">AI 未参与</span>}
          {onRegenerate && (
            <button
              type="button"
              className="wr__regen"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? '重写中…' : '换个说法'}
            </button>
          )}
          <button type="button" className="wr__close" onClick={onDismiss} aria-label="本周不再显示">
            ✕
          </button>
        </div>
      </header>
      {stale && <p className="wr__note">上周的战报周一 10:30 之后发布。</p>}
    </>
  );
}

/** The home page's version: no awards, and only the narrative's first sentence. */
function CompactBody({ report }: { report: WeeklyReport }): JSX.Element {
  const s = report.stats;
  return (
    <>
      <p className="wr__narrative wr__narrative--compact">{firstSentence(report.narrative)}</p>
      <p className="wr__compact-stats">
        <span>开局 <strong className="tabular">{s.sessionsPlayed}</strong></span>
        <span aria-hidden="true">·</span>
        <span>立案 <strong className="tabular">{s.casesFiled}</strong></span>
        {s.attendanceRate !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span>出勤率 <strong className="tabular">{attendance(s.attendanceRate)}</strong></span>
          </>
        )}
      </p>
    </>
  );
}

function FullBody({ report }: { report: WeeklyReport }): JSX.Element {
  const s = report.stats;
  return (
    <>
      <p className="wr__narrative">{report.narrative}</p>

      <div className="wr__stats">
        <Stat value={String(s.sessionsPlayed)} label="开局" />
        <Stat value={String(s.casesFiled)} label="立案" />
        <Stat value={String(s.totalPenalty)} label="总扣分" tone={s.totalPenalty < 0 ? 'down' : undefined} />
        <Stat value={attendance(s.attendanceRate)} label="出勤率" />
      </div>

      <ul className="wr__awards">
        {s.star && <Award emoji="🏆" label="本周之星" who={s.star.name} val={fmtDelta(s.star.delta)} tone="up" />}
        {s.pigeon && (
          <Award emoji="🕊️" label="本周鸽王" who={s.pigeon.name} val={fmtDelta(s.pigeon.delta)} tone="down" />
        )}
        {s.bestTalker && (
          <Award
            emoji="🗣️"
            label="最会说话"
            who={s.bestTalker.name}
            val={`少扣 ${s.bestTalker.savedBy}`}
            tone="up"
          />
        )}
        {s.topOrganizer && (
          <Award
            emoji="📣"
            label="组局劳模"
            who={s.topOrganizer.name}
            val={`${s.topOrganizer.count} 局`}
          />
        )}
      </ul>

      {s.upcomingNextWeek > 0 && (
        <p className="wr__foot">
          接下来已经约了 <strong className="tabular">{s.upcomingNextWeek}</strong> 局。
        </p>
      )}
    </>
  );
}

/**
 * 上周战报 — one paragraph of personality on top of numbers that came from SQL.
 *
 * The split is load-bearing: the prose is AI-written and allowed to be playful,
 * the figures below it are computed server-side and rendered deadpan. Nothing in
 * the stat strip is ever phrased as a joke, because a number that reads as a
 * punchline is a number nobody trusts.
 */
export function WeeklyReportCard({
  report,
  onRegenerate,
  regenerating = false,
  stale = false,
  compact = false,
}: WeeklyReportCardProps): JSX.Element | null {
  const [hidden, setHidden] = useState(() => isDismissed(report.week_start));
  if (hidden) return null;

  const dismiss = (): void => {
    remember(report.week_start);
    setHidden(true);
  };

  return (
    <section className={`wr${compact ? ' wr--compact' : ''}`} aria-labelledby="wr-title">
      <ReportHead
        report={report}
        stale={stale}
        regenerating={regenerating}
        onRegenerate={onRegenerate}
        onDismiss={dismiss}
      />
      {compact ? <CompactBody report={report} /> : <FullBody report={report} />}
    </section>
  );
}

interface StatProps {
  value: string;
  label: string;
  tone?: 'up' | 'down';
}

function Stat({ value, label, tone }: StatProps): JSX.Element {
  return (
    <div className="wr-stat">
      <span className={`wr-stat__value tabular${tone ? ` wr-stat__value--${tone}` : ''}`}>
        {value}
      </span>
      <span className="wr-stat__label">{label}</span>
    </div>
  );
}

interface AwardProps {
  emoji: string;
  label: string;
  who: string;
  val: string;
  tone?: 'up' | 'down';
}

function Award({ emoji, label, who, val, tone }: AwardProps): JSX.Element {
  return (
    <li className="wr-award">
      <span className="wr-award__emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="wr-award__label">{label}</span>
      <span className="wr-award__who">{who}</span>
      <span className={`wr-award__val tabular${tone ? ` wr-award__val--${tone}` : ''}`}>{val}</span>
    </li>
  );
}
```

`src/components/weekly-report.css` 末尾追加：

```css
/* --- compact (home page): no awards, first sentence only --- */
.wr--compact {
  gap: 0.5rem;
}

.wr__narrative--compact {
  text-indent: 0;
}

.wr__compact-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  font-size: var(--fs-sm);
  color: var(--muted);
}

.wr__compact-stats strong {
  color: var(--text);
}
```

- [ ] **Step 4: App 传 `compact`**

1. `<WeeklyReportCard>` 加 `compact`（基线 `:330-331`）：

```tsx
// 改前
          <WeeklyReportCard
            report={report}
```

```tsx
// 改后
          <WeeklyReportCard
            report={report}
            compact
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx tests/dom/p8-app.test.tsx
npm run typecheck
```

预期：board 17 例 PASS；`p8-app` 的 /往期战报/、/周一 10:30 之后发布/、/上周战报/ 三条照常通过（它们渲染的是非 compact 默认卡）；typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/WeeklyReportCard.tsx src/components/weekly-report.css src/App.tsx tests/dom/board.test.tsx
git commit -m "feat: 首页战报卡改为 compact，不渲染奖项"
```

---

### Task 9: Discord 入群链接的配置 `VITE_DISCORD_INVITE_URL`

**Files:**
- Create: `src/lib/inviteUrl.ts`、`src/lib/env.ts`
- Modify: `src/vite-env.d.ts:3-12`（`ImportMetaEnv` 加一个字段）
- Modify: `docs/DEPLOY-PAGES.md:43` 之后（补一行）
- Test: `tests/unit/invite-url.test.ts`

- [ ] **Step 1: 写失败的测试**

`tests/unit/invite-url.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parseInviteUrl } from '../../src/lib/inviteUrl';

// VITE_DISCORD_INVITE_URL becomes an href on the welcome card; a bad value must
// hide the row, never render a broken or unsafe link.

describe('parseInviteUrl', () => {
  it('accepts an absolute https URL', () => {
    expect(parseInviteUrl('https://discord.nanako.org')).toBe('https://discord.nanako.org/');
    expect(parseInviteUrl('  https://discord.nanako.org/join  ')).toBe('https://discord.nanako.org/join');
  });

  it('treats unset and blank as not configured', () => {
    expect(parseInviteUrl(undefined)).toBeNull();
    expect(parseInviteUrl('')).toBeNull();
    expect(parseInviteUrl('   ')).toBeNull();
  });

  it('rejects anything that is not an absolute https URL', () => {
    expect(parseInviteUrl('http://discord.nanako.org')).toBeNull();
    expect(parseInviteUrl('javascript:alert(1)')).toBeNull();
    expect(parseInviteUrl('discord.gg/abc123')).toBeNull();
    expect(parseInviteUrl('/join')).toBeNull();
  });

  it('rejects a URL carrying credentials', () => {
    expect(parseInviteUrl('https://user:pw@discord.nanako.org')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/invite-url.test.ts
```

预期：FAIL，`Error: Cannot find module '../../src/lib/inviteUrl' imported from …`。

- [ ] **Step 3: 实现**

`src/lib/inviteUrl.ts`（纯，会被 unit 导入，所以不碰 `import.meta.env`）：

```ts
/**
 * VITE_DISCORD_INVITE_URL is build-time config, so it is checked here before it
 * becomes an href: only an absolute https: URL without credentials is used.
 * Anything else (unset, blank, http:, javascript:, a bare discord.gg code)
 * hides the 加入服务器 row instead of rendering a broken or unsafe link.
 */
export function parseInviteUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
```

`src/lib/env.ts`（只给 DOM 工程用）：

```ts
// Build-time settings read from import.meta.env (DOM project only — the unit
// suite type-checks without Vite's types, so pure modules must not import this).
import { parseInviteUrl } from './inviteUrl';

/** The Discord share page for 加入服务器; null hides the row. */
export const DISCORD_INVITE_URL: string | null = parseInviteUrl(
  import.meta.env.VITE_DISCORD_INVITE_URL,
);
```

`src/vite-env.d.ts`——在 `VITE_API_BASE` 之后加字段，改后的 `ImportMetaEnv`：

```ts
interface ImportMetaEnv {
  /**
   * Base URL of the API backend.
   * - Empty (default): same-origin — used when the Worker serves the SPA itself,
   *   or when EdgeOne edge-functions reverse-proxy /api and /auth (Option A).
   * - Set to the Worker origin (e.g. https://api.example.com) for a direct
   *   cross-origin split (Option B/C).
   */
  readonly VITE_API_BASE?: string;
  /**
   * Public page that hands out a Discord invite (recommended
   * https://discord.nanako.org — the share page rotates its own invites).
   * Unset or not an absolute https: URL → the welcome card's 加入服务器 row is hidden.
   */
  readonly VITE_DISCORD_INVITE_URL?: string;
}
```

`docs/DEPLOY-PAGES.md`——第 2 步「Cloudflare Pages 项目」里，在 `- 环境变量：\`VITE_API_BASE=https://capi.nanako.org\`` 这一行之后插入：

```markdown
   - 可选：`VITE_DISCORD_INVITE_URL=https://discord.nanako.org`（首页欢迎卡的「加入服务器 ↗」；填分享页，
     不要直接填 discord.gg 邀请码；不填或不是 https 地址时整行隐藏）
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/invite-url.test.ts
npm run typecheck
```

预期：4 例 PASS；typecheck 通过（`env.ts` 此时还没人导入，但 `tsconfig.json` 的 `include: ["src", …]` 会检查它）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/inviteUrl.ts src/lib/env.ts src/vite-env.d.ts docs/DEPLOY-PAGES.md tests/unit/invite-url.test.ts
git commit -m "feat: 新增 VITE_DISCORD_INVITE_URL 配置与校验"
```

---

### Task 10: RulesPanel 受控展开 + `#rules` 锚点

**Files:**
- Modify: `src/components/RulesPanel.tsx:6-15`、`:22`（**不碰** `:36` 的文案，那归 P0-5）
- Modify: `src/components/rules-panel.css:1-3`
- Modify: `src/App.tsx:131` 之后（`rulesOpen` 状态）、`:358`（`<RulesPanel>` 受控）
- Test: `tests/dom/board.test.tsx`（追加）

- [ ] **Step 1: 写失败的测试**

import 块替换为：

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaderboard } from '../../src/components/Leaderboard';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { RulesPanel } from '../../src/components/RulesPanel';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import type { CaseStatus, Config, PublicUser, RecordItem, ViolationType, WeeklyReport } from '../../src/types';
```

文件末尾追加：

```tsx
describe('RulesPanel', () => {
  const config: Config = {
    violations: [],
    tiers: [],
    weeklyHeal: 5,
    weeklyBonusCap: 5,
    statementWindowHours: 12,
    aiEnabled: false,
    maxBatchSubjects: 5,
    nextResetAt: NEXT_RESET,
  };

  it('is the #rules anchor and still toggles on its own', async () => {
    const user = userEvent.setup();
    const { container } = render(<RulesPanel config={config} />);
    expect(container.querySelector('section#rules')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: /计分规则/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('follows a controlled open and reports toggles to the parent', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<RulesPanel config={config} open={false} onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole('button', { name: /计分规则/ });
    await user.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false'); // the parent decides
    rerender(<RulesPanel config={config} open onOpenChange={onOpenChange} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：「is the #rules anchor」FAIL（没有 `section#rules`）；「follows a controlled open」FAIL（`onOpenChange` 没被调用，且点击后 `aria-expanded` 变成了 `true`）。

- [ ] **Step 3: 实现**

`src/components/RulesPanel.tsx`——替换 props 和组件开头（基线 `:6-15`）：

```tsx
// 改前
interface RulesPanelProps {
  config: Config;
}

/** Collapsible rules reference: violations table, tier ladder, weekly heal note. */
export function RulesPanel({ config }: RulesPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <section className="rules panel">
```

```tsx
// 改后
interface RulesPanelProps {
  config: Config;
  /** Controlled open state (the welcome card's 30 秒看懂 opens it). Omit both to keep the panel's own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Collapsible rules reference: violations table, tier ladder, weekly heal note. */
export function RulesPanel({ config, open: openProp, onOpenChange }: RulesPanelProps): JSX.Element {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const toggle = (): void => {
    const next = !open;
    if (openProp === undefined) {
      setOpenState(next);
    }
    onOpenChange?.(next);
  };

  return (
    <section className="rules panel" id="rules">
```

再把开关按钮的 `onClick`（基线 `:22`）改掉：

```tsx
// 改前
          onClick={() => setOpen((v) => !v)}
// 改后
          onClick={toggle}
```

`src/components/rules-panel.css`（基线 `:1-3`）：

```css
/* 改前 */
.rules {
  overflow: hidden;
}
/* 改后 */
.rules {
  overflow: hidden;
  /* 30 秒看懂 scrolls here: keep the heading clear of the sticky header. */
  scroll-margin-top: 5.5rem;
}
```

- [ ] **Step 4: App 持有 `rulesOpen`**

1. 在 `regenerating` 状态之后新增 `rulesOpen`（基线 `:131`）：

```tsx
// 改前
  const [regenerating, setRegenerating] = useState(false);
```

```tsx
// 改后
  const [regenerating, setRegenerating] = useState(false);
  // Controlled so the welcome card's 30 秒看懂 can open it.
  const [rulesOpen, setRulesOpen] = useState(false);
```

2. `<RulesPanel>` 改成受控（基线 `:358`）：

```tsx
// 改前
            <RulesPanel config={config} />
```

```tsx
// 改后
            <RulesPanel config={config} open={rulesOpen} onOpenChange={setRulesOpen} />
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
npm run typecheck
```

预期：board 19 例 PASS；typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/RulesPanel.tsx src/components/rules-panel.css src/App.tsx tests/dom/board.test.tsx
git commit -m "feat: RulesPanel 支持受控展开并加 #rules 锚点"
```

---

### Task 11: 未登录首页的欢迎卡

**Files:**
- Create: `src/components/WelcomeCard.tsx`、`src/components/welcome-card.css`、`src/lib/revealSection.ts`
- Modify: `src/App.tsx:11-22`（api import 加 `AUTH_LOGIN_URL`）、`:24` 之后（import）、`:26-27` 附近（组件 import）、`:286`（`showRules`）、`:311` 之后（插 WelcomeCard）
- Test: `tests/dom/board.test.tsx`（追加 WelcomeCard 与 App 首页用例）

- [ ] **Step 1: 写失败的测试**

import 块替换为（这是 `board.test.tsx` 的最终 import 块）：

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { Leaderboard } from '../../src/components/Leaderboard';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { RulesPanel } from '../../src/components/RulesPanel';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import { WelcomeCard } from '../../src/components/WelcomeCard';
import type {
  CaseStatus,
  Config,
  PublicUser,
  RecordItem,
  User,
  ViolationType,
  WeeklyReport,
} from '../../src/types';
```

文件末尾依次追加 WelcomeCard 用例、App 级 fetch 桩（照抄 `tests/dom/deep-link.test.tsx:8-37`，未命中路由回 500，能暴露多余请求）、App 首页用例：

```tsx
describe('WelcomeCard', () => {
  const renderCard = (discordInviteUrl: string | null = null, onShowRules = vi.fn()) =>
    render(
      <WelcomeCard loginUrl="/auth/login" discordInviteUrl={discordInviteUrl} onShowRules={onShowRules} weeklyHeal={5} />,
    );

  it('says what the board is, with the heal from config', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
    expect(screen.getByText('说了来就来；来不了，开局前说一声。')).toBeInTheDocument();
    expect(screen.getByText(/放鸽子会被记一笔，每周一 0 点自动回血/)).toHaveTextContent('+5');
    expect(screen.getByRole('link', { name: '用 Nanako 账号登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('heading', { name: /约局/ })).not.toBeInTheDocument();
  });

  it('30 秒看懂 asks the page to show the rules', async () => {
    const onShowRules = vi.fn();
    const user = userEvent.setup();
    renderCard(null, onShowRules);
    await user.click(screen.getByRole('button', { name: '30 秒看懂' }));
    expect(onShowRules).toHaveBeenCalledTimes(1);
  });

  it('hides the Discord row unless an invite page is configured', () => {
    const { unmount } = renderCard(null);
    expect(screen.queryByText(/还没进 Discord 群/)).not.toBeInTheDocument();
    unmount();
    renderCard('https://discord.nanako.org/');
    const link = screen.getByRole('link', { name: '加入服务器' });
    expect(link).toHaveAttribute('href', 'https://discord.nanako.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('can be dismissed for good', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    await user.click(screen.getByRole('button', { name: '不再显示欢迎卡' }));
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('edg.welcome.dismissed')).toBe('1');
    unmount();
    renderCard();
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
  });

  it('still shows when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderCard();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
  });
});

interface Call {
  method: string;
  path: string;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockFetch(routes: Record<string, () => Response>): Call[] {
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

describe('App — the board on the home page', () => {
  const ME: User = { ...TIED[2], oauth_username: 'c', is_admin: false };
  const REPORT = {
    week_start: '2026-10-19',
    stats: {
      weekStart: '2026-10-19', weekEnd: '2026-10-25', sessionsPlayed: 3, sessionsCollapsed: 0, casesFiled: 1,
      totalPenalty: -12, absentVerdicts: 0, attendanceRate: null, upcomingNextWeek: 0,
      star: null, pigeon: { name: '老王', delta: -12 }, bestTalker: null, harshest: null, topOrganizer: null,
    },
    narrative: '平平无奇的一周。',
    source: 'ai',
    created_at: '2026-10-26 02:31:00',
  };
  const routes = (me: User | null) => ({
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 12,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: NEXT_RESET,
      }),
    'GET /api/leaderboard': () => json(200, { participants: TIED }),
    'GET /api/records?limit=50': () => json(200, { records: STAR_FEED }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: REPORT }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
  });

  it('signed out: welcome card first, one /约局/ heading, stars in the board, no 鸽王 anywhere', async () => {
    mockFetch(routes(null));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
    expect(screen.getByText('⭐', { exact: false }).closest('.lb')).not.toBeNull();
    expect(document.body.textContent).not.toContain('鸽王');
    expect(document.querySelector('.wr-award')).toBeNull();
    expect(document.querySelector('.tier-badge')).toBeNull();
  });

  it('30 秒看懂 opens the rules and moves focus there', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      mockFetch(routes(null));
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByRole('button', { name: '30 秒看懂' }));
      const toggle = screen.getByRole('button', { name: /计分规则/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => expect(document.activeElement).toBe(toggle));
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('signed in: no welcome card, and the 段位 only on my own row', async () => {
    mockFetch(routes(ME));
    render(<App />);
    await screen.findByRole('heading', { name: /约局/ });
    await settle();
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.lb .tier-badge')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '第 3 名 老王，96 分' })).toHaveClass('lb-row--me');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx
```

预期：FAIL，`Failed to resolve import "../../src/components/WelcomeCard"`。

- [ ] **Step 3: 实现欢迎卡与滚动工具**

`src/components/WelcomeCard.tsx`：

```tsx
import { useState } from 'react';
import './welcome-card.css';

interface WelcomeCardProps {
  /** AUTH_LOGIN_URL — a top-level navigation, never fetch. */
  loginUrl: string;
  /** null → the 还没进 Discord 群？ row is hidden entirely. */
  discordInviteUrl: string | null;
  /** P0: the App opens RulesPanel and scrolls to it; P3: /board/rules. */
  onShowRules: () => void;
  /** config.weeklyHeal — never a literal 15 (test configs use 5). */
  weeklyHeal: number;
}

const DISMISS_KEY = 'edg.welcome.dismissed';

function isDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled: showing the card again is harmless.
    return false;
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* nothing to do — the card simply reappears next load */
  }
}

/**
 * First thing a signed-out visitor sees (spec §3.1, M23): what this board is,
 * what it costs to flake, and the way back. Its heading must never contain
 * 约局 — the page keeps exactly one /约局/ heading (SessionsPanel's).
 */
export function WelcomeCard({
  loginUrl,
  discordInviteUrl,
  onShowRules,
  weeklyHeal,
}: WelcomeCardProps): JSX.Element | null {
  const [hidden, setHidden] = useState(isDismissed);
  if (hidden) return null;

  const dismiss = (): void => {
    remember();
    setHidden(true);
  };

  return (
    <section className="welcome panel" aria-labelledby="welcome-title">
      <div className="welcome__head">
        <h2 id="welcome-title" className="welcome__title">
          开黑小队的守约记分板。
        </h2>
        <button type="button" className="welcome__close" onClick={dismiss} aria-label="不再显示欢迎卡">
          ✕
        </button>
      </div>
      <p className="welcome__line">说了来就来；来不了，开局前说一声。</p>
      <p className="welcome__line">
        放鸽子会被记一笔，每周一 0 点自动回血 <span className="tabular">+{weeklyHeal}</span>。
      </p>
      <div className="welcome__actions">
        <a className="btn btn--gold" href={loginUrl}>
          用 Nanako 账号登录
        </a>
        <button type="button" className="welcome__rules" onClick={onShowRules}>
          30 秒看懂 <span aria-hidden="true">›</span>
        </button>
      </div>
      {discordInviteUrl && (
        <p className="welcome__discord">
          还没进 Discord 群？{' '}
          <a href={discordInviteUrl} target="_blank" rel="noopener noreferrer">
            加入服务器 <span aria-hidden="true">↗</span>
          </a>
        </p>
      )}
    </section>
  );
}
```

`src/components/welcome-card.css`：

```css
/* 欢迎卡 — signed-out visitors only (spec §3.1). */
.welcome {
  display: grid;
  gap: 0.4rem;
  padding: clamp(1rem, 0.75rem + 1vw, 1.5rem);
}

.welcome__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.welcome__title {
  font-size: var(--fs-xl);
  letter-spacing: 0.02em;
}

.welcome__close {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  margin: -0.6rem -0.6rem 0 0;
  border-radius: var(--r-sm);
  color: var(--muted);
}

.welcome__line {
  font-size: var(--fs-md);
  color: var(--text);
}

.welcome__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.25rem;
  margin-top: 0.6rem;
}

.welcome__rules {
  min-height: var(--tap-min);
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--info);
}

.welcome__discord {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.welcome__discord a {
  color: var(--info);
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (hover: hover) {
  .welcome__close:hover {
    color: var(--text);
  }
  .welcome__rules:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
}
```

`src/lib/revealSection.ts`：

```ts
// DOM helper for in-page jumps (P0: 30 秒看懂 → #rules). P3 replaces the jump
// with a route; not unit-tested (needs the DOM) — covered by tests/dom/board.test.tsx.

/**
 * After the next frame (React has committed the section open), scroll it into
 * view and move focus to its first button, so keyboard and screen-reader users
 * land where sighted users are looking. Respects reduced motion.
 */
export function revealSection(id: string): void {
  window.requestAnimationFrame(() => {
    const section = document.getElementById(id);
    if (!section) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    section.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    section.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  });
}
```

- [ ] **Step 4: App 接上欢迎卡**

位置：main 里所有 notice（P0-3 的 StaleNotice、DiscordLinkedNotice、LinkMissingNotice）之后、InviteBanner 之前；只在未登录（`!me`）时渲染。如果 P0-3 把 LinkMissingNotice 挪了位置，就插在 main 里最后一个 notice 之后。

1. api 的 import 加 `AUTH_LOGIN_URL`（这是 P0-3 名下 import 块里唯一的一处加法）。P0-3 把数据请求挪去 `src/lib/coreData.ts` 之后，App 的 api import 收成了一行（P0-3 计划 Task 7 Step 5）：

```tsx
// 改前（P0-3 合并后）
import { ApiError, getRecord, logout as apiLogout, regenerateReport } from './api';
```

```tsx
// 改后
import { ApiError, AUTH_LOGIN_URL, getRecord, logout as apiLogout, regenerateReport } from './api';
```

如果实际合并的 P0-3 仍是多行写法，就在 `ApiError,` 下一行插入 `AUTH_LOGIN_URL,`；按字母序放在 `ApiError` 之后。

2. 在常量 import 之后新增 env 与 revealSection 的 import：

```tsx
// 改前
import { FEED_PREVIEW_COUNT } from './lib/constants';
```

```tsx
// 改后
import { FEED_PREVIEW_COUNT } from './lib/constants';
import { DISCORD_INVITE_URL } from './lib/env';
import { revealSection } from './lib/revealSection';
```

3. 在 WeekHighlights 的 import 之后新增 WelcomeCard 的 import：

```tsx
// 改前
import { WeekHighlights } from './components/WeekHighlights';
```

```tsx
// 改后
import { WeekHighlights } from './components/WeekHighlights';
import { WelcomeCard } from './components/WelcomeCard';
```

4. 在 `canRecord` 之后定义 `showRules`（基线 `:286`；普通函数，不是 hook，放在 loading/error 早退之后没问题）：

```tsx
// 改前
  const canRecord = me?.is_judge === true;
```

```tsx
// 改后
  const canRecord = me?.is_judge === true;
  const showRules = (): void => {
    setRulesOpen(true);
    revealSection('rules');
  };
```

5. 在 LinkMissingNotice 之后插入 WelcomeCard（基线 `:311`）：

```tsx
// 改前
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={() => setLinkMissing(null)} />}
```

```tsx
// 改后
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={() => setLinkMissing(null)} />}

        {!me && (
          <WelcomeCard
            loginUrl={AUTH_LOGIN_URL}
            discordInviteUrl={DISCORD_INVITE_URL}
            onShowRules={showRules}
            weeklyHeal={config.weeklyHeal}
          />
        )}
```

- [ ] **Step 5: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx tests/dom/deep-link.test.tsx tests/dom/discord-link.test.tsx tests/dom/p8-app.test.tsx
npm run typecheck
```

预期：board 27 例 PASS；`deep-link` 的「heading /约局/ 唯一」、`discord-link` 的「无参数时 heading /约局/ 唯一」照常通过（欢迎卡标题是「开黑小队的守约记分板。」，不含「约局」）；typecheck 通过。

- [ ] **Step 6: 提交**

```bash
git add src/components/WelcomeCard.tsx src/components/welcome-card.css src/lib/revealSection.ts src/App.tsx tests/dom/board.test.tsx
git commit -m "feat: 未登录首页新增欢迎卡"
```

---

### Task 12: 走势图手机字号 ≥12px、点按查看（M26 前半）

**Files:**
- Modify: `src/components/HistoryChart.tsx:1-105`（整文件替换；`history`、`color` 两个 props 不变）
- Modify: `src/components/history-chart.css:1-62`（整文件替换；替换前先跑 `git log -p origin/main -- src/components/history-chart.css`，看 P0-1 在这个文件里改了什么，把那些改动补进下面的内容再保存）
- Test: `tests/dom/history-chart.test.tsx`

- [ ] **Step 1: 写失败的测试**

`tests/dom/history-chart.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryChart } from '../../src/components/HistoryChart';
import type { HistoryPoint } from '../../src/types';

// M26 (first half): the axis numbers no longer live inside the stretched SVG
// (they shrank to ~6px on phones), and a point can be read by tapping or with
// the keyboard — not only by hovering.

/** The visible readout under the plot (the dots' hover <title>s carry the same words). */
const readout = (container: HTMLElement): string => container.querySelector('.chart__readout')?.textContent ?? '';

const HISTORY: HistoryPoint[] = [
  { at: '2026-10-01 12:00:00', score: 70 },
  { at: '2026-10-10 12:00:00', score: 82 },
  { at: '2026-10-20 12:00:00', score: 88 },
];

describe('HistoryChart', () => {
  it('draws the axis numbers as HTML, not SVG text', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    expect(container.querySelectorAll('svg text')).toHaveLength(0);
    const ticks = [...container.querySelectorAll('.chart__tick')].map((t) => t.textContent);
    expect(ticks).toEqual(['0', '25', '50', '75', '100']);
  });

  it('shows the latest point until another is picked', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    expect(readout(container)).toMatch(/^88 分 · /);
  });

  it('picks a point with the range input (keyboard path)', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    const scrub = screen.getByRole('slider', { name: '查看某次分数' });
    fireEvent.change(scrub, { target: { value: '0' } });
    expect(readout(container)).toMatch(/^70 分 · /);
    expect(scrub.getAttribute('aria-valuetext')).toMatch(/^70 分 · /);
  });

  it('picks the point nearest a tap on the plot', () => {
    const { container } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    const canvas = container.querySelector('.chart__canvas') as HTMLElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 320, height: 100, right: 320, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(canvas, { clientX: 160 }); // the middle of the plot → the middle point
    expect(readout(container)).toMatch(/^82 分 · /);
    fireEvent.click(canvas, { clientX: 5 });
    expect(readout(container)).toMatch(/^70 分 · /);
  });

  it('new data (another player, a refresh) starts at its latest point again', () => {
    const { container, rerender } = render(<HistoryChart history={HISTORY} color="#4aa3ff" />);
    fireEvent.change(screen.getByRole('slider', { name: '查看某次分数' }), { target: { value: '0' } });
    expect(readout(container)).toMatch(/^70 分 · /);
    rerender(<HistoryChart history={[...HISTORY, { at: '2026-10-25 12:00:00', score: 90 }]} color="#4aa3ff" />);
    expect(readout(container)).toMatch(/^90 分 · /);
  });

  it('a single point needs no picker', () => {
    const { container } = render(<HistoryChart history={[HISTORY[0]]} color="#4aa3ff" />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(readout(container)).toMatch(/^70 分 · /);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/history-chart.test.tsx
```

预期：6 例全部 FAIL——`svg text` 有 5 个、没有 `.chart__tick`；没有 `.chart__readout`（读数为空串）；没有 slider；没有 `.chart__canvas`。

> 说明：今天的 6px 来自 `HistoryChart.tsx:47-48` 的 `viewBox 640×200` + `preserveAspectRatio="none"`，在 375px 屏上 SVG 被压到约 330px 宽，`11px` 的 `<text>` 跟着缩到约 5.7px。所以只改字号没用，必须把数字移出 SVG。刻度位置用 React 的 `style={{ top: … }}`（走 CSSOM，CSP 允许）。

- [ ] **Step 3: 实现 `src/components/HistoryChart.tsx`（整文件替换）**

```tsx
import { useId, useState } from 'react';
import type { MouseEvent } from 'react';
import type { HistoryPoint } from '../types';
import { relativeTime } from '../lib/time';
import './history-chart.css';

interface HistoryChartProps {
  history: HistoryPoint[];
  color: string;
}

const W = 640;
const H = 200;
const PAD_X = 28;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;
const INNER_W = W - PAD_X * 2;
const INNER_H = H - PAD_TOP - PAD_BOTTOM;
const GRID_LINES = [0, 25, 50, 75, 100];

interface PlotPoint {
  px: number;
  py: number;
  point: HistoryPoint;
}

const yOf = (score: number): number => PAD_TOP + INNER_H * (1 - clamp01(score / 100));

function plotPoints(history: readonly HistoryPoint[]): PlotPoint[] {
  const n = history.length;
  const xOf = (i: number): number => (n === 1 ? W / 2 : PAD_X + (INNER_W * i) / (n - 1));
  return history.map((point, i) => ({ px: xOf(i), py: yOf(point.score), point }));
}

/** The point nearest a tap at `offsetX` of a plot `width` px wide (the SVG stretches to fit). */
function nearestIndex(offsetX: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return n - 1;
  const i = Math.round((((offsetX / width) * W - PAD_X) / INNER_W) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

const readout = (p: HistoryPoint): string => `${p.score} 分 · ${relativeTime(p.at)}`;

interface ChartSvgProps {
  points: readonly PlotPoint[];
  active: number;
  color: string;
}

function ChartSvg({ points, active, color }: ChartSvgProps): JSX.Element {
  const gradientId = useId();
  const coords = points.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');
  const floor = (PAD_TOP + INNER_H).toFixed(1);
  const area = `${PAD_X},${floor} ${coords} ${(W - PAD_X).toFixed(1)},${floor}`;
  const first = points[0].point;
  const last = points[points.length - 1].point;
  return (
    <svg
      className="chart__svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`分数走势，从 ${first.score} 分到 ${last.score} 分`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {GRID_LINES.map((g) => (
        <line key={g} className="chart__grid" x1={PAD_X} x2={W - PAD_X} y1={yOf(g)} y2={yOf(g)} />
      ))}
      <polygon className="chart__area" points={area} fill={`url(#${gradientId})`} />
      <polyline className="chart__line" points={coords} />
      {points.map((p, i) => (
        <circle
          key={i}
          className={`chart__dot${i === points.length - 1 ? ' chart__dot--last' : ''}${i === active ? ' chart__dot--active' : ''}`}
          cx={p.px}
          cy={p.py}
          r={i === active ? 5 : i === points.length - 1 ? 4 : 2.5}
        >
          <title>{readout(p.point)}</title>
        </circle>
      ))}
    </svg>
  );
}

/** Axis numbers as HTML beside the plot, positioned in % of its height (React style → CSSOM, CSP-safe). */
function AxisTicks(): JSX.Element {
  return (
    <div className="chart__ticks" aria-hidden="true">
      {GRID_LINES.map((g) => (
        <span key={g} className="chart__tick tabular" style={{ top: `${(yOf(g) / H) * 100}%` }}>
          {g}
        </span>
      ))}
    </div>
  );
}

/** A pick belongs to the history it was made on: new data (another player, a refresh) starts at the latest point. */
interface Pick {
  of: readonly HistoryPoint[];
  index: number;
}

/**
 * Hand-rolled SVG line chart of score over time. Y axis fixed to 0..100.
 *
 * The axis numbers are HTML beside the plot, not SVG <text>: the SVG
 * stretches to the card (preserveAspectRatio="none"), which shrank 11px labels
 * to ~6px on a phone (M26). Tapping the plot, or the range input under it,
 * picks a point and shows its score — hover-only <title> left touch and
 * keyboard users with nothing.
 */
export function HistoryChart({ history, color }: HistoryChartProps): JSX.Element {
  const [pick, setPick] = useState<Pick | null>(null);

  if (history.length === 0) {
    return <p className="chart__empty">暂无走势数据。</p>;
  }

  const points = plotPoints(history);
  const n = points.length;
  const active = pick !== null && pick.of === history && pick.index < n ? pick.index : n - 1;
  const choose = (index: number): void => setPick({ of: history, index });
  const onTap = (event: MouseEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    choose(nearestIndex(event.clientX - rect.left, rect.width, n));
  };

  return (
    <figure className="chart" style={{ ['--accent' as string]: color }}>
      <div className="chart__plot">
        <AxisTicks />
        <div className="chart__canvas" onClick={onTap}>
          <ChartSvg points={points} active={active} color={color} />
        </div>
      </div>

      {n > 1 && (
        <input
          type="range"
          className="chart__scrub"
          min={0}
          max={n - 1}
          step={1}
          value={active}
          onChange={(e) => choose(Number(e.target.value))}
          aria-label="查看某次分数"
          aria-valuetext={readout(points[active].point)}
        />
      )}
      <p className="chart__readout tabular">{readout(points[active].point)}</p>

      <figcaption className="chart__caption">
        <span>{relativeTime(history[0].at)}</span>
        <span className="chart__caption-now">现在 {history[n - 1].score} 分</span>
      </figcaption>
    </figure>
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
```

`src/components/history-chart.css`（整文件替换）：

```css
.chart {
  margin: 0;
}

/* Tick column + canvas: the numbers get their own column instead of being
   squeezed into the SVG's padding. */
.chart__plot {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
}

.chart__canvas {
  cursor: pointer;
}

.chart__svg {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 640 / 200;
  overflow: visible;
}

.chart__grid {
  stroke: var(--border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

/* Axis numbers: HTML beside the stretched SVG, so they stay 12px at any width (M26). */
.chart__ticks {
  position: relative;
}

.chart__tick {
  position: absolute;
  left: 0;
  transform: translateY(-50%);
  font-family: var(--font-num);
  font-size: var(--fs-xs);
  line-height: 1;
  color: var(--muted);
}

.chart__line {
  fill: none;
  stroke: var(--accent, var(--blue));
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 6px color-mix(in oklab, var(--accent) 45%, transparent));
}

.chart__dot {
  fill: var(--bg);
  stroke: var(--accent, var(--blue));
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.chart__dot--last,
.chart__dot--active {
  fill: var(--accent, var(--blue));
}

.chart__scrub {
  display: block;
  width: 100%;
  margin: 0.5rem 0 0;
  accent-color: var(--accent, var(--blue));
}

@media (pointer: coarse) {
  /* A finger needs a 44px track to grab the thumb. */
  .chart__scrub {
    min-height: var(--tap-min);
  }
}

.chart__readout {
  margin-top: 0.25rem;
  font-size: var(--fs-sm);
  color: var(--text);
  text-align: center;
}

.chart__caption {
  display: flex;
  justify-content: space-between;
  margin-top: 0.5rem;
  font-size: var(--fs-xs);
  color: var(--muted);
}

.chart__caption-now {
  color: var(--text);
  font-weight: 600;
}

.chart__empty {
  padding: 1.5rem;
  text-align: center;
  color: var(--muted);
}
```

- [ ] **Step 4: 运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/history-chart.test.tsx tests/dom/p8-app.test.tsx tests/dom/deep-link.test.tsx tests/dom/player-judge.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npm run typecheck
```

预期：history-chart 6 例 PASS；PlayerDetail 相关的 dom 测试照常通过（它们的桩 `history: []`，走「暂无走势数据。」分支）；css-conventions、typecheck 通过。

- [ ] **Step 5: 提交**

```bash
git add src/components/HistoryChart.tsx src/components/history-chart.css tests/dom/history-chart.test.tsx
git commit -m "fix: 走势图手机字号不小于 12px，支持点按查看"
```

---

### Task 13: 分享预览去掉「头号鸽王」（M23）

**Files:**
- Modify: `index.html:7`

- [ ] **Step 1: 先确认现状（这一步就是「失败的检查」）**

```bash
grep -n "头号鸽王" index.html; grep -c 'og:' index.html
```

预期：第 7 行命中「头号鸽王」；`og:` 计数为 0。

- [ ] **Step 2: 修改**

```html
<!-- 改前（:7） -->
    <meta name="description" content="EDG 信誉分 — 开黑守约计分板：本周最靠谱 vs 头号鸽王" />
<!-- 改后 -->
    <meta name="description" content="EDG 开黑大厅：约局、报名、守约记录。" />
    <meta property="og:title" content="EDG 信誉分" />
    <meta property="og:description" content="EDG 开黑大厅：约局、报名、守约记录。" />
```

- [ ] **Step 3: 验证**

```bash
grep -n "头号鸽王" index.html || echo "no 鸽王"
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts tests/unit/pages-headers.test.ts
npm run build && grep -o '<meta[^>]*og:[^>]*>' dist/index.html
```

预期：打印 `no 鸽王`；source-hygiene（index.html 无 NUL 字节）与 pages-headers 通过；构建产物里有两条 og 标签。

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "feat: 分享预览的 description 与 og 标签去掉「头号鸽王」"
```

---

## 收尾

### 全量验证

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npm run build
grep -rn "RedBlackBoard\|red-black-board\|hero-card\|\.rbb\|头号鸽王\|红黑榜" src index.html || echo "clean"
wc -l src/App.tsx
```

预期：
- typecheck 三个 tsconfig 全过。
- unit：比 Task 0 记下的基线多 4 个文件、24 个用例（按推荐顺序为 23 个文件 / 294 个用例）（`rank` 4、`feed-stats` 5、`week-stars` 11、`invite-url` 4），全部通过；`css-conventions` 扫到新 CSS 也通过。
- dom：多 3 个文件、36 个用例（按推荐顺序为 16 个文件 / 165 个用例；`score-gauge` 3、`board` 27、`history-chart` 6），全部通过；`modal-focus`、`deep-link`、`p8-app`、`discord-link`、`onboarding-roles`、`player-judge`、`session-rsvp-moved`、`verdict-privacy` 原样通过；不新增 `act(...)` 警告（`npx vitest run --config vitest.dom.config.ts tests/dom/board.test.tsx 2>&1 | grep -c "act("` 应为 0）。
- build 成功；grep 打印 `clean`；`App.tsx` 不超过约 450 行。
- 本 PR 不碰 worker / server 文件，不需要跑 `vitest.workers.config.ts`；CI 的 server、pg 两套照常由 CI 跑。

### 手动检查（附 375px 与 1280px 截图到 PR 描述，契约 §4）

本地起：`npm run dev`（Worker :8787）+ `npm run dev:web`（:5173）；验入群链接时用 `VITE_DISCORD_INVITE_URL=https://discord.nanako.org npm run dev:web` 再看一遍。

**375px（手机）**
- [ ] 未登录首页第一块是欢迎卡：标题「开黑小队的守约记分板。」，三行文案，回血数字与 `/api/config` 的 `weeklyHeal` 一致；「用 Nanako 账号登录」是金色按钮，点了整页跳到 `/auth/login`。
- [ ] 没配 `VITE_DISCORD_INVITE_URL` 时看不到「还没进 Discord 群？」整行；配了以后出现，点「加入服务器 ↗」新标签页打开。
- [ ] 点「30 秒看懂 ›」：规则面板展开，页面滚到「📖 计分规则」，标题没被 sticky Header 挡住；焦点环落在规则开关上（按 Tab 能看到）。系统开了「减少动态效果」时不是平滑滚动。
- [ ] 点欢迎卡 ✕ 后消失，刷新也不再出现；清掉 localStorage `edg.welcome.dismissed` 后又出现。登录后不出现。
- [ ] 红黑榜不见了；页面上任何地方都没有「鸽王」（战报卡只有标题、日期、「开局 · 立案 · 出勤率」和叙事第一句）。
- [ ] 信誉榜每行是「名次 · 头像 · 名字 · 分数」，分数数字清晰可见；没有 🥇🥈🥉、没有前三名的金/银/铜描边；同分的人名次相同（造两个 100 分的人看「1、1、3」）；没有「本周变化」列和 62px 圆环。
- [ ] 登录后自己那一行底色略亮、左侧一道浅色竖边（不是金色），并且**只有这一行**带段位徽章。
- [ ] 本周之星那一行在信誉榜标题下面：数据够一整周且有人达标时显示「⭐ 本周之星：…（准时 N 次）」，名字可点开选手页；feed 不覆盖整周时整行不出现。
- [ ] 动态流只显示 10 条，下面有「看更多」；点了展开其余已加载的记录，焦点落在第 11 条上。
- [ ] 打开任一有走势的选手：坐标数字 0/25/50/75/100 字号是 12px（DevTools 量）、不再被压扁；点图上任意位置，下方读数变成最近那一点的「N 分 · X天前」，对应圆点变实心；拖动下面的滑杆也能换点（触屏上滑杆高度 ≥44px）；关掉再打开另一个选手，读数回到他最新的一点。
- [ ] 横向不出现滚动条；所有可点元素触控尺寸 ≥44px（欢迎卡 ✕、「30 秒看懂」、本周之星的名字）。

**1280px（桌面）**
- [ ] 信誉榜每行右侧是 62px 圆环，圆环颜色所有人相同（`--score-chip-fg`，白色），没有按段位上色、没有辉光；分数数字只在圆环里出现一次（`.lb-row__score` 在 ≥1024px 隐藏）。
- [ ] 读屏（VoiceOver 或 DevTools Accessibility 面板）：行按钮读「第 N 名 名字，N 分」；圆环 aria-label 只有「信誉分 N 分」，不含「段位」。
- [ ] 鼠标悬停行有底色和右移，键盘 Tab 到行有 `--focus` 焦点环（P0-1 的 outline）。
- [ ] 右栏动态流截到 10 条后，左右两栏高度差明显变小（M27 在 P3-2 才彻底解决）。
- [ ] 战报卡 compact：管理员仍能看到「换个说法」，✕ 仍是「本周不再显示」。
- [ ] Tab 顺序与视觉顺序一致：欢迎卡 → 约局 → 战报 → 信誉榜（含本周之星名字）→ 规则 → 动态流 →「看更多」。
- [ ] `npm run build && grep -o '<meta[^>]*>' dist/index.html`：description 与 og:title、og:description 是新文案。
- [ ] 浏览器控制台没有 CSP 报错（`style-src` 不含 `'unsafe-inline'`；本 PR 的动态样式只有 React `style` prop：圆环尺寸、走势图刻度 `top`、`--accent`）。

---

## 自查

| spec 条目（§9 P0-4 及相关） | 覆盖的 Task |
|---|---|
| 手机显示分数（H6） | Task 5（`.lb-row__score` 任何宽度都显示，≥1024px 由圆环中心数字代替） |
| 同分同名次 | Task 1（`competitionRanks`）、Task 5 |
| 不发奖牌 | Task 5（删 `medal()`、`.lb-row--rank1/2/3`） |
| 段位只在本人那一行显示（M6 的 P0 部分） | Task 5（`meId` → 唯一的 TierBadge） |
| 公开处 ScoreGauge `tone="neutral"`，aria-label 不含段位 | Task 4（组件 + `score-gauge.test.tsx`）、Task 5（榜单传 neutral） |
| 62px 圆环只在桌面显示、去掉每行 drop-shadow（§6.4） | Task 5（`@media (min-width: 1024px)`）、Task 4（`.gauge--neutral .gauge__svg { filter: none }`） |
| `WeekHighlights` 替换 RedBlackBoard（H5、M24 公开部分） | Task 3、Task 6 |
| 整周门槛：feed 最旧一条早于周起点才显示，否则整行隐藏 | Task 3（`coversWholeWeek` + 3 个门槛用例）、Task 6（`hidden` 渲染 null） |
| 本周之星 = 本周 ≥2 次准时且无已判决扣分，只看已判决记录 | Task 3（`affectsScore` 过滤 + 用例） |
| 并列全部列出、不按名字排 | Task 3（「not by name」用例） |
| 低分的人也能拿本周之星 | Task 3（规则不读分数；「last week’s heavy penalty does not count」单测）、Task 6（`board.test` 30 分的人上榜用例） |
| 满分并列时不出任何「鸽王」 | Task 3（`all-clean` 用例）、Task 6、Task 11（App 首页全文无「鸽王」） |
| 文案「⭐ 本周之星：…」「本周还没人摘星，今晚去约一局？」「本周全员守约 🎉」 | Task 6 |
| WeekHighlights 不是 heading，页面仍只有一个 /约局/ 标题 | Task 6（「is never a heading」）、Task 11（App 用例 + deep-link/discord-link 回归） |
| 动态流默认 10 条加「看更多」（H7 P0 部分） | Task 7 |
| `.feed-row__status--escalate` 类名不变 | Task 7（用例）+ `p8-app.test.tsx:196-199` 回归 |
| 走势图手机字号 ≥12px、点按查看（M26 前半） | Task 12（刻度是 HTML、`--fs-xs` = 12px；点按 + range 滑杆；触屏滑杆 ≥44px；换数据时读数回到最新点） |
| index.html description 改写 + 新增 og:title / og:description（M23） | Task 13 |
| WelcomeCard（文案取 §3.1；可关闭、记 localStorage；标题不含「约局」） | Task 11 |
| 「30 秒看懂」先展开 RulesPanel 并滚过去 | Task 10（受控 + `#rules`）、Task 11（`revealSection` + App 用例） |
| 入群链接读 `VITE_DISCORD_INVITE_URL`，没配置时整行隐藏 | Task 9、Task 11 |
| WeeklyReportCard compact 不渲染 Award（含「本周鸽王」），h2 规则与 stale 提示不变 | Task 8（3 个用例 + `p8-app:183-193` 回归） |
| OnboardingDialog `ROLE_CARDS[0].desc` 不再提红黑榜 | Task 6 |
| 删 RedBlackBoard 及 `.hero-card__link` coarse 规则 | Task 6 |
| 首页不点名任何鸽王（spec §0 第 4 条、§11 第 2 条） | Task 6、Task 8、Task 13 |
| 组件签名只加可选 props（§6.5「签名」） | Task 4、5、7、8、10（全部可选；新组件 WelcomeCard/WeekHighlights 不受此限） |
| DOM 顺序 = 视觉顺序，不用 CSS `order` | Task 5（highlights 插在 head 与 list 之间的 DOM 位置）、Task 11（WelcomeCard 在 DOM 里排第一） |
| CSP：不插 `<style>`、不写 style 字符串 | Task 4、12（只用 React `style` prop） |
| 新 CSS 遵守 P0-1 的断点 / hover / 焦点约定 | Task 5、6、7、8、10、11、12（`css-conventions.test.ts` 把关） |
| 常量不写死：`WEEK_STAR_MIN_ON_TIME`、`FEED_PREVIEW_COUNT`、回血数读 `config.weeklyHeal` | Task 3、7、11 |
| 「M27（P0 部分）」 | Task 7（右栏截到 10 条缓解两栏失衡；彻底解决在 P3-2） |

**明确不在本 PR：** 公开选手页 ScoreGauge neutral 与 HistoryChart 的段位色（P1-1）；首页区块重排为 §2.4 的最终顺序与 BoardMini（P3-2）；规则页去掉 `blurb`（P3-6）；战报奖项改名「上周之星」（P3-7）；走势图原因标签（M26 后半，P4-5）；RulesPanel `:36`「本地时区」（P0-5）。
