# P2-4 看板时区与 bot 对齐 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让网页和 Discord bot 用同一个「看板时区」（`RESET_TZ_OFFSET`）和同一套用词：`GET /api/config` 下发 `boardTzOffsetHours`；`shared/quickTime` 新增 `/yue` 那 5 个时段的 `BOARD_SLOTS`、`slotIso`（从 bot 搬过来）、`boardSlots`、`boardTzLabel`（+8 写「北京时间」，其他写「UTC+N」）；`src/lib/time.ts` 的 `formatWhen` 加可选的看板时区参数，新增 `formatBoardDateTime`（「周五 10/30 21:00（北京时间）」）和 `formatViewerAside`（浏览器时区不同时的「你那边 22:00」）；bot 的按钮、卡片字段、登记回复把「可能」改成「待定」（`shared/attendance` 的 `RSVP_LABEL`），`/yue` 的时段和 15 分钟提前量取自 shared，`/yue` 放开给已绑定的非上榜用户（spec §11 第 7 条）；`MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`、`DEFAULT_DURATION_MIN` 迁到 `shared/attendance.ts`。

**Architecture:** 只加数据和纯函数，不碰任何组件（契约第 2 节、第 8 节第 1、3、4 条：看板时区真正上屏是 P3-1 / P3-3 / P3-4）。`shared/quickTime.ts` 末尾追加 `// --- P2-4 ---` 小节，全部读「UTC + offsetHours」的墙钟，和进程、浏览器时区无关，Worker、Node bot、前端共用；bot 的 `YUE_SLOTS` 变成 `BOARD_SLOTS` 的别名、`slotIso` 原样 re-export（名字、`value`、算法都不变，Discord 已注册的 `/yue` choices 不变）。`src/lib/time.ts` 内部加一个 `wallClock(ms, offsetHours?)`：不传 offset 走浏览器时区（`formatWhen` 现有十几处调用输出一字不变），传了就读看板墙钟。三个常量在 `worker/sessions.ts` 原处改成 `export { … } from '../shared/attendance'`，现有测试的导入路径不用改。不碰数据库、没有迁移。

**Tech Stack:** TypeScript；Hono（Worker 路由）；discord.js 类型（bot 渲染）；vitest：unit（`vitest.config.ts`，纯 Node）、dom（`vitest.dom.config.ts`）、server（`vitest.server.config.ts`）、worker（`vitest.workers.config.ts`，Miniflare + D1）、pg（`vitest.pg.config.ts`，`tests/worker/**` + `tests/pg/**` 跑在嵌入式 PostgreSQL 17 上）。

**依赖:** P2 共享契约 本目录的 [contract.md](contract.md)（第 2 节 P2-4 文件清单；第 3 节 `worker/sessions.ts`、`worker/routes.ts`、`shared/attendance.ts`、`shared/quickTime.ts`、`server/src/discord/sessions.ts`、`src/types.ts`、`docs/*`、各测试文件的分区；4.2 `Config.boardTzOffsetHours?`；4.4 shared 常量和函数签名；第 5 节 Bot；7.1 被锁住的测试；第 9 节 P2-4 验收要点）。上游四个 PR 必须已在 `claude/p2-3-invite-context` 上：P2-2 建好 `tests/worker/session-routes.test.ts`（含 `call`、`asUser`）；P2-1 在 `shared/attendance.ts` 加了 `// --- P2-1 ---`、在 `worker/sessions.ts` 的 shared import 块里加了 `MAX_INVITES`、`MAX_SESSION_ROSTER`；P2-6 加了 `// --- P2-6 ---`；P2-3 加了 `// --- P2-3 ---`，并在 `server/src/discord/sessions.ts` 里 `import { SESSION_CANCEL_REASON_MAX } from '../../../shared/attendance'`、改了 `renderSessionDm` 的 cancelled 分支。

**分支:** `claude/p2-4-board-time`，从 `claude/p2-3-invite-context` 的 HEAD 开（`git switch -c claude/p2-4-board-time claude/p2-3-invite-context`）。不 fetch、不 rebase 到 `origin/main`、不 push、不开 PR、不合并。

---

## 文件结构

所有路径相对仓库根目录。行号只作提示（指规划副本 `/tmp/claude-redesign/p1/compose/repo`，上游 PR 会让它们漂移），**一律按引用的锚点文字定位**。

| 文件 | 新/改 | 职责 |
|---|---|---|
| `shared/attendance.ts` | 改（末尾追加 `// --- P2-4 ---`） | `MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`、`DEFAULT_DURATION_MIN`（值不变：5、10、120） |
| `worker/sessions.ts` | 改（只改 shared import 块和锚点 `export const MAX_OPEN_SESSIONS = 5;` 两行） | 两个常量改为从 shared 引入并 re-export，上方注释留在原处 |
| `shared/quickTime.ts` | 改（末尾追加 `// --- P2-4 ---`；`quickSlots`、`synthesizeTitle`、`isSynthesizedTitle`、`MIN_LEAD_MINUTES` 一字不动） | `BoardSlotDef`、`BOARD_SLOTS`、`BOARD_SLOT_MIN_LEAD_MS`、`slotIso`、`BoardSlot`、`boardSlots`、`boardTzLabel` |
| `src/lib/time.ts` | 改（纯模块，仍被 `tests/unit` 导入） | 私有 `WEEKDAYS`、`WallClock`、`wallClock`、`clockTime`；`formatWhen` 加可选第三参；新 `formatBoardDateTime`、`formatViewerAside` |
| `worker/routes.ts` | 改（锚点 `nextResetAt: nextResetAt(offset),` 之后一行） | `/api/config` 多 `boardTzOffsetHours: offset` |
| `src/types.ts` | 改（`interface Config` 末尾） | 可选 `boardTzOffsetHours?: number` |
| `server/src/discord/sessions.ts` | 改（P2-4 分区：import、`RSVP_LABEL`、`sessionCard` 的 fields、`invited` 私信的 fields、`YUE_SLOTS`/`slotIso`、`handleYue`） | 「可能」→「待定」；时段和提前量来自 shared；去掉上榜判断 |
| `docs/CONTRACT.md` | 改（`GET /api/config` 那一条） | 写上 `boardTzOffsetHours` |
| `docs/DEPLOY-DISCORD.md` | 改（第 7 节约局：`:169-171`、`:187-188` 的「可能」，`:191` 的 `/yue` 权限） | 和 bot 行为一致 |
| `tests/unit/board-time.test.ts` | 新 | `BOARD_SLOTS`、`slotIso`、`boardSlots`、`boardTzLabel`、`formatWhen`（不传 / 传 offset）、`formatBoardDateTime`、`formatViewerAside`；全部用 `process.env.TZ` 切换进程时区，结果与机器时区无关 |
| `tests/unit/source-hygiene.test.ts` | 改（import 区一行 + 文件末尾一个 describe） | `DEFAULT_DURATION_MIN` 等于 `0005_sessions.sql` 的 `COALESCE(s.duration_min, 120)` |
| `tests/worker/session-routes.test.ts` | 改（P2-2 建；末尾追加 `// --- P2-4 ---` describe） | `/api/config` 的 `boardTzOffsetHours`：未设 8、`'0'`、`'5.5'`、非法值 8 |
| `server/test/session-render.test.ts` | 改（import 区加行，`:2` 那一行不动；末尾追加 describe `labels and slots`） | 卡片字段名、按钮、私信用 `RSVP_LABEL`；`YUE_SLOTS === BOARD_SLOTS`；`slotIso` 是同一个函数 |
| `tests/pg/session-cards.test.ts` | 改（**改** `it('/yue is for bound players only'` 那个用例；`describe('/yue, more'` 里追加一个用例） | 非上榜但已绑定的人能 `/yue`；按钮登记「待定」时回复「待定」 |

不碰：任何组件和 CSS（`RescheduleSheet.tsx`、`SessionFormDialog.tsx` 换成看板时段是 P3-3、P3-4，见「对契约的补充」第 1 条）、`src/api.ts`（`getConfig` 的返回类型就是 `Config`，自动带上新字段）、`server/src/discord/commands.ts`（`YUE_SLOTS` 的名字和 `value` 不变，`:125` 的 choices 照常生成；`handleNotify` 归 P2-5）、`tests/unit/quickTime.test.ts`、任何迁移和 `schema.sql`。

---

### Task 0：开工核对

**Files:** 无改动（只读核对）。

- [ ] **Step 1：确认上游分支、工作区干净，开分支**

```bash
git status --short                               # 期望：无输出
git branch --list claude/p2-3-invite-context     # 期望：列出这个分支
git switch -c claude/p2-4-board-time claude/p2-3-invite-context
git log --oneline -1                             # 记下起点 commit
```

上游分支不存在或工作区不干净 → 停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对本 PR 要改的锚点和上游接口都在**

```bash
grep -nE "^// --- P2-(1|6|3) ---$" shared/attendance.ts
# 期望 3 行，顺序 P2-1、P2-6、P2-3，P2-3 那一节在文件末尾（SESSION_CANCEL_REASON_MAX、SESSION_HISTORY_PAGE）
grep -nE "export const (MAX_OPEN_SESSIONS|MAX_SESSIONS_PER_DAY|DEFAULT_DURATION_MIN)" shared/attendance.ts
# 期望无输出（P2-4 才加）
grep -nF "export const MAX_OPEN_SESSIONS = 5;" worker/sessions.ts
grep -nF "export const MAX_SESSIONS_PER_DAY = 10;" worker/sessions.ts
# 期望各 1 行，紧挨着，上面是注释「Per organizer: sessions open at once, and sessions created per 24 hours.」
grep -nF "export { MAX_INVITES } from '../shared/attendance';" worker/sessions.ts
# 期望 1 行（P2-1）
sed -n '/^import {$/,/^} from .\.\.\/shared\/attendance.;$/p' worker/sessions.ts | head -8
# 期望：文件第一个 import 块，里面有 `  MAX_INVITES,`、`  MAX_SESSION_ROSTER,`（P2-1）和 `  ORGANIZER_BONUS_MIN_ATTENDEES,`
grep -nF "nextResetAt: nextResetAt(offset)," worker/routes.ts                       # 期望 1 行
grep -nF "  nextResetAt: string;" src/types.ts                                      # 期望 1 行（interface Config 的最后一个成员）
grep -n "boardTzOffsetHours\|BOARD_SLOTS\|boardSlots" -r src shared worker server/src # 期望无输出
grep -nF "from '../../../shared/attendance'" server/src/discord/sessions.ts
# 期望 1 行，含 SESSION_CANCEL_REASON_MAX（P2-3 加的）
grep -nF "const RSVP_LABEL: Record<RsvpChoice, string> = { going: '来', maybe: '可能', out: '不来' };" server/src/discord/sessions.ts   # 期望 1 行
grep -nF "{ name: '可能', value: \`\${session.counts.maybe} 人\`, inline: true }," server/src/discord/sessions.ts                     # 期望 1 行
grep -nF "fields: [{ name: '来', value: seats(session), inline: true }] }" server/src/discord/sessions.ts                            # 期望 1 行（invited 私信）
grep -nF "export const YUE_SLOTS: ReadonlyArray<" server/src/discord/sessions.ts                                                   # 期望 1 行
grep -nF "export function slotIso(dayOffset: number, hour: number, offsetHours: number, now = Date.now()): string {" server/src/discord/sessions.ts   # 期望 1 行
grep -nF "if (!user.is_participant) return ephemeralReply('只有上榜选手可以发起约局（网页上可以改身份）。');" server/src/discord/sessions.ts      # 期望 1 行
grep -nF "if (Date.parse(startsAt) < Date.now() + 15 * 60_000) {" server/src/discord/sessions.ts                                     # 期望 1 行
grep -nE "^async function call\(|overrides: Partial<Env>|^import type \{ Env \}" tests/worker/session-routes.test.ts
# 期望：call 的签名是 (path, init = {}, overrides: Partial<Env> = {})（P2-2 照抄 http-guards.test.ts:17-43），并且导入了 Env 类型
grep -nF "import { parseRsvpButton, renderSessionDm, sessionCard, sessionDmRelevant, slotIso } from '../src/discord/sessions';" server/test/session-render.test.ts   # 期望 1 行（第 2 行，本 PR 不改它）
grep -nF "import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';" server/test/session-render.test.ts   # 期望 1 行（P2-3 加的，紧跟在 `import type { SessionDetail } …` 之后），Task 5 把 RSVP_LABEL 并进这一行
grep -nF "it('/yue is for bound players only', async () => {" tests/pg/session-cards.test.ts   # 期望 1 行
grep -nF "describe('/yue, more', () => {" tests/pg/session-cards.test.ts                       # 期望 1 行
grep -nF "  it('says where the card goes only when there is a session channel', async () => {" tests/pg/session-cards.test.ts   # 期望 1 行（'/yue, more' 的最后一个用例）
grep -nF "COALESCE(s.duration_min, 120)" server/migrations/0005_sessions.sql        # 期望 1 行
```

任何一条对不上（尤其上游的 `// --- P2-x ---` 小节、`session-routes.test.ts` 的 `call` 签名和 `import type { Env }`、bot 文件和 `session-render.test.ts` 里 P2-3 的 import）→ 停下报告，不要自己补上游 PR 的东西。（跨 PR 合成副本上每一条都和注释写的一致：`session-routes.test.ts` 第 12 行就是 P2-2 的 `import type { Env } from '../../worker/types';`，Task 4 不用补 import。）

- [ ] **Step 3：跑基线，记下数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
npm run typecheck
npm run test:unit   2>&1 | grep -E "Test Files|Tests "
npm run test:dom > /tmp/p2-4-dom-base.log 2>&1; grep -E "Test Files|Tests " /tmp/p2-4-dom-base.log; grep -c "not wrapped in act" /tmp/p2-4-dom-base.log
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg     2>&1 | grep -E "FAIL|Test Files|Tests "
```

期望（= P2-3 完工时，跨 PR 合成副本实测；新文件：P2-1 的 unit `invite-picker`、dom `invite-sheet`，P2-2 的 worker `invitable`、`session-routes`，P2-6 的 worker `going-preview`，P2-3 的 worker `session-context`、`session-history` 和 dom `session-api`）：
- typecheck 通过；
- unit **30 / 422** 全过，记为 **U0**；
- dom **26 / 322** 全过，记为 **D0**；`act(...)` 警告条数记为 **A0**（应仍是 3）；
- server **22 / 292** 全过，记为 **S0**；
- worker **20 / 620** 全过（另有 9 个 todo），记为 **W0**；
- pg **32 / 904** 全过（9 todo），记为 **P0**。遇到 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」5 秒超时，按契约第 1 节单独重跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts`（期望 4/4），记进 PR 描述。

文件数对不上就停下报告（说明上游 PR 的测试文件和契约不一致），不在本 PR 里处理。

---

### Task 1：会话常量迁到 `shared/attendance.ts`

**Files:**
- Modify: `shared/attendance.ts`（末尾追加 `// --- P2-4 ---`）
- Modify: `worker/sessions.ts`（shared import 块；锚点 `export const MAX_OPEN_SESSIONS = 5;` 两行）
- Test: `tests/unit/source-hygiene.test.ts`（import 区一行 + 文件末尾一个 describe）

- [ ] **Step 1：写失败的测试**

`tests/unit/source-hygiene.test.ts` 的 import 区，在锚点 `import { FILED_DM_GRACE_MS } from '../../shared/scoring';` 之后加一行：

```ts
import { DEFAULT_DURATION_MIN } from '../../shared/attendance';
```

文件**末尾**追加：

```ts

// P2-4 (spec §8 常量迁移): a session with no length is taken to last
// DEFAULT_DURATION_MIN. The roll-call reminder in 0005_sessions.sql says the same
// thing in SQL; the two must not drift apart.
describe('session constants that SQL repeats', () => {
  it('DEFAULT_DURATION_MIN equals COALESCE(s.duration_min, …) in 0005_sessions.sql', () => {
    const sql = readFileSync(path.join(ROOT, 'server/migrations/0005_sessions.sql'), 'utf8');
    const defaults = [...sql.matchAll(/COALESCE\(s\.duration_min, (\d+)\)/g)].map((m) => Number(m[1]));
    expect(defaults.length, 'no COALESCE(s.duration_min, N) in 0005_sessions.sql').toBeGreaterThan(0);
    expect(new Set(defaults)).toEqual(new Set([DEFAULT_DURATION_MIN]));
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts 2>&1 | grep -E "FAIL|AssertionError|Tests "
```

期望：`Tests  1 failed | 5 passed (6)`；失败的是 `session constants that SQL repeats > DEFAULT_DURATION_MIN equals …`，`AssertionError: expected Set{ 120 } to deeply equal Set{ undefined }`（`shared/attendance` 还没有这个导出）。

- [ ] **Step 3：实现**

`shared/attendance.ts` **文件末尾**（`// --- P2-3 ---` 小节之后）追加：

```ts

// --- P2-4 ---
/** Per organizer: sessions open and still ahead at once, and created per rolling 24 h (cancelled ones count). */
export const MAX_OPEN_SESSIONS = 5;
export const MAX_SESSIONS_PER_DAY = 10;
/** A session without a length is taken to last this long. MUST equal COALESCE(s.duration_min, 120) in server/migrations/0005_sessions.sql (source-hygiene). */
export const DEFAULT_DURATION_MIN = 120;
```

`worker/sessions.ts`：

1. 文件第一个 import 块（`} from '../shared/attendance';` 结尾的那个）的开头，锚点（原文，只出现 1 次；`MAX_INVITES`、`MAX_SESSION_ROSTER` 是 P2-1 加的）：

   ```ts
   import {
     MAX_INVITES,
     MAX_SESSION_ROSTER,
     ORGANIZER_BONUS_MIN_ATTENDEES,
   ```

   换成（两个新名字和 P2-1 的两个按字母序排在一起）：

   ```ts
   import {
     MAX_INVITES,
     MAX_OPEN_SESSIONS,
     MAX_SESSION_ROSTER,
     MAX_SESSIONS_PER_DAY,
     ORGANIZER_BONUS_MIN_ATTENDEES,
   ```

2. 锚点两行

   ```ts
   export const MAX_OPEN_SESSIONS = 5;
   export const MAX_SESSIONS_PER_DAY = 10;
   ```

   整体换成一行（上方 `/** Per organizer: … must not be free. */` 注释原样留着）：

   ```ts
   export { MAX_OPEN_SESSIONS, MAX_SESSIONS_PER_DAY } from '../shared/attendance';
   ```

   `assertCanOrganize` 和 `:345-352` 附近的错误文案继续用这两个名字（现在来自 import），一个字不改。`tests/worker/sessions.test.ts:14-15`、`tests/pg/concurrency.test.ts:9` 仍从 `worker/sessions` 导入，靠这行 re-export。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts 2>&1 | grep -E "Tests "
npm run typecheck
npx vitest run --config vitest.workers.config.ts tests/worker/sessions.test.ts 2>&1 | grep -E "Test Files|Tests "
```

期望：source-hygiene `6 passed (6)`；typecheck 通过；`tests/worker/sessions.test.ts` **40 passed (40)**（P2-6 的 `going_preview` 用例在它自己的新文件 `tests/worker/going-preview.test.ts` 里，没有追加到这个文件）。

- [ ] **Step 5：提交**

```bash
git add shared/attendance.ts worker/sessions.ts tests/unit/source-hygiene.test.ts
git commit -m "refactor: 约局额度和默认时长常量迁到 shared/attendance（P2-4）"
```

---

### Task 2：`shared/quickTime` 的看板时段和时区标签

**Files:**
- Modify: `shared/quickTime.ts`（末尾追加 `// --- P2-4 ---`；文件前面的一切不动）
- Test: `tests/unit/board-time.test.ts`（新）

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/board-time.test.ts`，完整内容（Task 3 再往里加一行 import 和后半段）：

```ts
// P2-4: the board's time zone (RESET_TZ_OFFSET), on the web and in the bot —
// spec §4.2「时区与时段」, §11 #8. Every case here must read the same in any
// process time zone, so the shared functions run under several zones
// (process.env.TZ, as in client-time.test.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOARD_SLOTS,
  BOARD_SLOT_MIN_LEAD_MS,
  boardSlots,
  boardTzLabel,
  slotIso,
} from '../../shared/quickTime';

const ZONES = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles'] as const;
const ORIGINAL_TZ = process.env.TZ;

function restoreTz(): void {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
}

/** Monday 2026-10-26, 12:00 at UTC+8. */
const NOW = Date.parse('2026-10-26T04:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('BOARD_SLOTS', () => {
  it("are /yue's five choices, in order, and a slot must be 15 minutes ahead", () => {
    expect(BOARD_SLOTS.map((s) => [s.value, s.name, s.dayOffset, s.hour])).toEqual([
      ['tonight20', '今晚 20:00', 0, 20],
      ['tonight21', '今晚 21:00', 0, 21],
      ['tonight22', '今晚 22:00', 0, 22],
      ['tomorrow20', '明晚 20:00', 1, 20],
      ['dayafter20', '后天 20:00', 2, 20],
    ]);
    expect(BOARD_SLOT_MIN_LEAD_MS).toBe(15 * MINUTE);
  });
});

describe.each(ZONES)('board slots with the process in %s', (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(restoreTz);

  it('slotIso is board-local: 20:00 at UTC+8 is 12:00 UTC, across the date line too', () => {
    expect(slotIso(0, 20, 8, NOW)).toBe('2026-10-26T12:00:00.000Z');
    expect(slotIso(1, 20, 8, NOW)).toBe('2026-10-27T12:00:00.000Z');
    // 01:00 on the 27th at UTC+8 is still the 26th in UTC: "tonight" is the 27th's.
    expect(slotIso(0, 20, 8, Date.parse('2026-10-26T17:00:00.000Z'))).toBe('2026-10-27T12:00:00.000Z');
    expect(slotIso(0, 20, 5.5, NOW)).toBe('2026-10-26T14:30:00.000Z');
    expect(slotIso(0, 20, -5, NOW)).toBe('2026-10-26T01:00:00.000Z');
  });

  it('boardSlots offers all five at noon, labelled with their names, in order', () => {
    const slots = boardSlots(NOW, 8);
    expect(slots.map((s) => [s.value, s.label, s.iso])).toEqual([
      ['tonight20', '今晚 20:00', '2026-10-26T12:00:00.000Z'],
      ['tonight21', '今晚 21:00', '2026-10-26T13:00:00.000Z'],
      ['tonight22', '今晚 22:00', '2026-10-26T14:00:00.000Z'],
      ['tomorrow20', '明晚 20:00', '2026-10-27T12:00:00.000Z'],
      ['dayafter20', '后天 20:00', '2026-10-28T12:00:00.000Z'],
    ]);
    for (const s of slots) expect(s.at).toBe(Date.parse(s.iso));
  });

  it('drops a slot that has passed or is less than 15 minutes away (exactly 15 stays)', () => {
    const at2045 = Date.parse('2026-10-26T12:45:00.000Z'); // 20:45 at UTC+8
    expect(boardSlots(at2045, 8).map((s) => s.value)).toEqual(['tonight21', 'tonight22', 'tomorrow20', 'dayafter20']);
    expect(boardSlots(at2045 + 1, 8).map((s) => s.value)).toEqual(['tonight22', 'tomorrow20', 'dayafter20']);
  });

  it("reads the board's day, not UTC's: at 23:00 on the 25th (UTC-5) tonight is gone", () => {
    // NOW is 23:00 on Sunday the 25th at UTC-5.
    expect(boardSlots(NOW, -5).map((s) => [s.value, s.iso])).toEqual([
      ['tomorrow20', '2026-10-27T01:00:00.000Z'],
      ['dayafter20', '2026-10-28T01:00:00.000Z'],
    ]);
  });

  it('is never empty: 明晚 20:00 is always ahead', () => {
    for (const offset of [8, 0, -5, 5.5, 14, -12]) {
      for (let t = NOW; t < NOW + 48 * HOUR; t += 15 * MINUTE) {
        expect(boardSlots(t, offset).map((s) => s.value)).toContain('tomorrow20');
      }
    }
  });
});

describe('boardTzLabel', () => {
  it('says 北京时间 for +8, UTC for 0, and UTC±H[:MM] otherwise', () => {
    expect(boardTzLabel(8)).toBe('北京时间');
    expect(boardTzLabel(0)).toBe('UTC');
    expect(boardTzLabel(9)).toBe('UTC+9');
    expect(boardTzLabel(-5)).toBe('UTC-5');
    expect(boardTzLabel(5.5)).toBe('UTC+5:30');
    expect(boardTzLabel(-3.5)).toBe('UTC-3:30');
    expect(boardTzLabel(5.75)).toBe('UTC+5:45');
    expect(boardTzLabel(14)).toBe('UTC+14');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/board-time.test.ts 2>&1 | grep -E "FAIL|TypeError|Tests " | head -8
```

期望：`Tests  17 failed (17)`（`BOARD_SLOTS` 1 个 + 三个时区各 5 个 + `boardTzLabel` 1 个）；报错是 `TypeError: Cannot read properties of undefined (reading 'map')`、`TypeError: (0 , slotIso) is not a function` 之类（导出还不存在）。

- [ ] **Step 3：实现**

`shared/quickTime.ts` **文件末尾**（`isSynthesizedTitle` 之后）追加。文件里已有的私有 `pad2` 和接口 `QuickSlot` 直接复用：

```ts

// --- P2-4: the board's time zone (RESET_TZ_OFFSET) ---------------------------
// Everything below reads the board's wall clock (UTC + offsetHours), never the
// process's or the browser's zone: /yue and the web offer the same instants.

const HOUR_MS = 3_600_000;
/** The board offset whose label is a name rather than a number. */
const BEIJING_OFFSET_HOURS = 8;

export interface BoardSlotDef {
  value: string;
  name: string;
  dayOffset: number;
  hour: number;
}

/** /yue's `when` choices and the web's quick picks — one list (spec §4.2). Board-local. */
export const BOARD_SLOTS: readonly BoardSlotDef[] = [
  { value: 'tonight20', name: '今晚 20:00', dayOffset: 0, hour: 20 },
  { value: 'tonight21', name: '今晚 21:00', dayOffset: 0, hour: 21 },
  { value: 'tonight22', name: '今晚 22:00', dayOffset: 0, hour: 22 },
  { value: 'tomorrow20', name: '明晚 20:00', dayOffset: 1, hour: 20 },
  { value: 'dayafter20', name: '后天 20:00', dayOffset: 2, hour: 20 },
];

/** A slot closer than this is not offered on the web, and /yue refuses it. (Was 15 * 60_000 inline in handleYue.) */
export const BOARD_SLOT_MIN_LEAD_MS = 15 * 60_000;

/** `dayOffset` days from today at `hour`:00, board-local, as an ISO instant. Moved verbatim from server/src/discord/sessions.ts. */
export function slotIso(dayOffset: number, hour: number, offsetHours: number, now = Date.now()): string {
  const local = new Date(now + offsetHours * HOUR_MS);
  const atLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hour);
  return new Date(atLocal - offsetHours * HOUR_MS).toISOString();
}

export interface BoardSlot extends QuickSlot {
  value: string;
}

/** BOARD_SLOTS still at least BOARD_SLOT_MIN_LEAD_MS ahead, as chips: label = the slot's name. Never empty (明晚 is always ahead). */
export function boardSlots(now: number, offsetHours: number): BoardSlot[] {
  const earliest = now + BOARD_SLOT_MIN_LEAD_MS;
  return BOARD_SLOTS.flatMap((slot) => {
    const iso = slotIso(slot.dayOffset, slot.hour, offsetHours, now);
    const at = Date.parse(iso);
    return at >= earliest ? [{ value: slot.value, label: slot.name, iso, at }] : [];
  });
}

/** 8 → '北京时间'; 0 → 'UTC'; 9 → 'UTC+9'; -5 → 'UTC-5'; 5.5 → 'UTC+5:30'; -3.5 → 'UTC-3:30'. */
export function boardTzLabel(offsetHours: number): string {
  if (offsetHours === BEIJING_OFFSET_HOURS) return '北京时间';
  if (offsetHours === 0) return 'UTC';
  const sign = offsetHours < 0 ? '-' : '+';
  const minutes = Math.round(Math.abs(offsetHours) * 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `UTC${sign}${hours}${rest === 0 ? '' : `:${pad2(rest)}`}`;
}
```

`slotIso` 的算法、`>= earliest` 的边界和 bot 现在的 `handleYue`（`Date.parse(startsAt) < Date.now() + 15 * 60_000` 时拒绝）完全一致：网页给出的时段，`/yue` 一定接受。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/board-time.test.ts tests/unit/quickTime.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests "
npm run typecheck
```

期望：`Test Files  2 passed (2)`、`Tests  29 passed (29)`（board-time 17 + `quickTime.test.ts` 原有 12，后者一个字没改）；typecheck 通过。

- [ ] **Step 5：提交**

```bash
git add shared/quickTime.ts tests/unit/board-time.test.ts
git commit -m "feat: shared/quickTime 新增看板时段 boardSlots、slotIso 和时区标签 boardTzLabel（P2-4）"
```

---

### Task 3：`src/lib/time.ts` 的看板时钟：`formatWhen` 第三参、`formatBoardDateTime`、`formatViewerAside`

**Files:**
- Modify: `src/lib/time.ts`
- Test: `tests/unit/board-time.test.ts`（import 区一行 + 末尾追加）

- [ ] **Step 1：写失败的测试**

`tests/unit/board-time.test.ts` 的 import 区，在 `} from '../../shared/quickTime';` 之后加一行：

```ts
import { formatBoardDateTime, formatViewerAside, formatWhen } from '../../src/lib/time';
```

文件**末尾**追加：

```ts

// --- src/lib/time.ts: the board's clock on the web (spec §5 #9, §11 #8) -------

/** Run `fn` with the process in `tz`, then put the zone back. */
function inZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    restoreTz();
  }
}

/** Friday 2026-10-30, 21:00 at UTC+8. */
const FRI_2100_BJ = '2026-10-30T13:00:00.000Z';

describe('formatWhen without a board offset is unchanged (browser zone)', () => {
  const CASES: Record<(typeof ZONES)[number], Array<[string, string]>> = {
    // NOW is Monday 12:00 here.
    'Asia/Shanghai': [
      ['2026-10-26T12:00:00.000Z', '今天 20:00'],
      ['2026-10-27 12:00:00', '明天 20:00'],
      [FRI_2100_BJ, '周五 21:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 21:00'],
    ],
    // NOW is Monday 04:00 here.
    UTC: [
      ['2026-10-26T12:00:00.000Z', '今天 12:00'],
      ['2026-10-27 12:00:00', '明天 12:00'],
      [FRI_2100_BJ, '周五 13:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 13:00'],
    ],
    // NOW is Sunday 21:00 here (PDT); PST from 1 November.
    'America/Los_Angeles': [
      ['2026-10-26T12:00:00.000Z', '明天 05:00'],
      ['2026-10-27 12:00:00', '周二 05:00'],
      [FRI_2100_BJ, '周五 06:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 05:00'],
    ],
  };

  it.each(ZONES)('in %s', (tz) => {
    inZone(tz, () => {
      for (const [value, label] of CASES[tz]) expect(formatWhen(value, NOW), value).toBe(label);
      expect(formatWhen('not a date', NOW)).toBe('');
    });
  });
});

describe.each(ZONES)("formatWhen on the board's clock, with the process in %s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(restoreTz);

  it('reads the wall clock at the given offset', () => {
    expect(formatWhen(FRI_2100_BJ, NOW, 8)).toBe('周五 21:00');
    expect(formatWhen(FRI_2100_BJ, NOW, 0)).toBe('周五 13:00');
    expect(formatWhen(FRI_2100_BJ, NOW, 5.5)).toBe('周五 18:30');
    expect(formatWhen('2026-11-06T13:00:00.000Z', NOW, 8)).toBe('11月6日 21:00');
    expect(formatWhen('not a date', NOW, 8)).toBe('');
  });

  it("buckets 今天 / 明天 by the board's day, not the viewer's", () => {
    const mon2330 = Date.parse('2026-10-26T15:30:00.000Z'); // Monday 23:30 at UTC+8
    const tue0030 = '2026-10-26T16:30:00.000Z'; // Tuesday 00:30 at UTC+8, still Monday in UTC
    expect(formatWhen(tue0030, mon2330, 8)).toBe('明天 00:30');
    expect(formatWhen(tue0030, mon2330, 0)).toBe('今天 16:30');
    // NOW is Sunday 23:00 at UTC-5: Monday 07:00 there is tomorrow.
    expect(formatWhen('2026-10-26T12:00:00.000Z', NOW, -5)).toBe('明天 07:00');
  });

  it('formatBoardDateTime: weekday, M/D, time and the zone label', () => {
    expect(formatBoardDateTime(FRI_2100_BJ, 8)).toBe('周五 10/30 21:00（北京时间）');
    expect(formatBoardDateTime('2026-10-30 13:00:00', 8)).toBe('周五 10/30 21:00（北京时间）');
    expect(formatBoardDateTime(FRI_2100_BJ, 0)).toBe('周五 10/30 13:00（UTC）');
    expect(formatBoardDateTime(FRI_2100_BJ, 5.5)).toBe('周五 10/30 18:30（UTC+5:30）');
    expect(formatBoardDateTime(FRI_2100_BJ, -5)).toBe('周五 10/30 08:00（UTC-5）');
    // 01:00 on Saturday at UTC+8 is still Friday in UTC.
    expect(formatBoardDateTime('2026-10-30T17:00:00.000Z', 8)).toBe('周六 10/31 01:00（北京时间）');
    expect(formatBoardDateTime('not a date', 8)).toBe('');
  });
});

describe('formatViewerAside: 你那边, only when the viewer is elsewhere', () => {
  it('is null when the browser keeps the board time, or the value is unparseable', () => {
    expect(inZone('Asia/Shanghai', () => formatViewerAside(FRI_2100_BJ, 8))).toBeNull();
    expect(inZone('UTC', () => formatViewerAside(FRI_2100_BJ, 0))).toBeNull();
    expect(inZone('Asia/Kolkata', () => formatViewerAside(FRI_2100_BJ, 5.5))).toBeNull();
    expect(inZone('Asia/Tokyo', () => formatViewerAside('not a date', 8))).toBeNull();
  });

  it("gives the viewer's time when the zones differ", () => {
    expect(inZone('Asia/Tokyo', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 22:00');
    expect(inZone('America/Los_Angeles', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 06:00');
    expect(inZone('Asia/Kolkata', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 18:30');
  });

  it("adds the viewer's weekday when their date is not the board's", () => {
    // Friday 23:30 at UTC+8 is already Saturday in Tokyo.
    expect(inZone('Asia/Tokyo', () => formatViewerAside('2026-10-30T15:30:00.000Z', 8))).toBe('你那边 周六 00:30');
    // Saturday 01:00 at UTC+8 is still Friday morning in Los Angeles.
    expect(inZone('America/Los_Angeles', () => formatViewerAside('2026-10-30T17:00:00.000Z', 8))).toBe('你那边 周五 10:00');
  });

  it("compares the viewer's offset at that instant (daylight saving)", () => {
    // Los Angeles is UTC-7 until 1 November 2026, then UTC-8.
    expect(inZone('America/Los_Angeles', () => formatViewerAside(FRI_2100_BJ, -7))).toBeNull();
    expect(inZone('America/Los_Angeles', () => formatViewerAside('2026-11-06T13:00:00.000Z', -7))).toBe('你那边 05:00');
  });
});
```

说明：所有期望值都写死了进程时区（`describe.each(ZONES)` + `beforeAll`，或者 `inZone`），所以在任何机器、任何 `TZ` 下结果都一样；第一个 describe 是对**现有** `formatWhen` 的回归锁（spec §5 第 9 条：formatWhen 原来没有单测），所以它在 Step 2 就是绿的。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/board-time.test.ts 2>&1 | grep -E "FAIL|AssertionError|TypeError|Tests " | head -12
```

期望：`Tests  13 failed | 20 passed (33)`。通过的 20 个 = Task 2 的 17 个 + 「without a board offset is unchanged」的 3 个。失败的 13 个：三个时区各 3 个（`reads the wall clock at the given offset`、`buckets 今天 / 明天…`、`formatBoardDateTime…`）+ `formatViewerAside` 的 4 个。典型报错：Asia/Shanghai 下 `expected '周五 21:00' to be '周五 13:00'`、`expected '明天 00:30' to be '今天 16:30'`（第三参被忽略，按进程时区算了）；`formatBoardDateTime` / `formatViewerAside` 是 `TypeError: … is not a function`。

- [ ] **Step 3：实现**

`src/lib/time.ts`（纯模块，被 `tests/unit` 导入；只从 `@shared/quickTime` 引入一个纯函数，不引入任何 DOM / 存储）：

1. 文件头注释之后、`const MINUTE = 60_000;` 之前加 import；`const DAY = 24 * HOUR;` 之后加 `WEEKDAYS`。改完开头是：

   ```ts
   // Time formatting helpers: relative timestamps and a countdown formatter.
   // All pure; no side effects.

   import { boardTzLabel } from '@shared/quickTime';

   const MINUTE = 60_000;
   const HOUR = 60 * MINUTE;
   const DAY = 24 * HOUR;
   const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
   ```

   （`@shared` 别名在 `vitest.config.ts`、`vitest.dom.config.ts`、`vite.config.ts`、`tsconfig.json` 里都已配置，`src/lib` 别的模块就是这么引 shared 的，例如 `import { MAX_SCORE } from '@shared/scoring';`。）

2. 从锚点 `/**\n * Compact when-label for a scheduled session` 开始、到 `formatWhen` 函数结束的右花括号为止（下一段是 `/** \`datetime-local\` input value`），整段替换为：

   ```ts
   /** One reading of a wall clock: the browser's (offsetHours omitted) or the board's (UTC + offsetHours). */
   interface WallClock {
     month: number;
     date: number;
     weekday: number;
     hours: number;
     minutes: number;
     /** 00:00 of that day on the same clock, as epoch ms. */
     dayStart: number;
   }

   function wallClock(ms: number, offsetHours?: number): WallClock {
     if (offsetHours === undefined) {
       const d = new Date(ms);
       const start = new Date(ms);
       start.setHours(0, 0, 0, 0);
       return {
         month: d.getMonth() + 1,
         date: d.getDate(),
         weekday: d.getDay(),
         hours: d.getHours(),
         minutes: d.getMinutes(),
         dayStart: start.getTime(),
       };
     }
     // Shift so that the UTC getters read the board's wall clock.
     const shift = offsetHours * HOUR;
     const d = new Date(ms + shift);
     return {
       month: d.getUTCMonth() + 1,
       date: d.getUTCDate(),
       weekday: d.getUTCDay(),
       hours: d.getUTCHours(),
       minutes: d.getUTCMinutes(),
       dayStart: Math.floor((ms + shift) / DAY) * DAY - shift,
     };
   }

   function clockTime(at: WallClock): string {
     return `${pad2(at.hours)}:${pad2(at.minutes)}`;
   }

   /**
    * Compact when-label for a scheduled session: '今天 20:00' / '明天 20:00' /
    * '周五 20:00', falling back to a date beyond a week out.
    *
    * `formatDateTime` produces '7月28日 09:48 周二' — 14 characters, which wrapped
    * the invite banner onto three lines on a 375px screen and orphaned a word. For
    * a game that is days away at most, the weekday is the part people actually read.
    *
    * offsetHours omitted → today's output exactly (the browser's zone). Given → the
    * same buckets (今天 / 明天 / 周X / M月D日) read on the board's wall clock (P2-4).
    */
   export function formatWhen(value: string, now: number = Date.now(), offsetHours?: number): string {
     const ms = parseTimestamp(value);
     if (Number.isNaN(ms)) return '';
     const at = wallClock(ms, offsetHours);
     const time = clockTime(at);
     const days = Math.round((at.dayStart - wallClock(now, offsetHours).dayStart) / DAY);
     if (days === 0) return `今天 ${time}`;
     if (days === 1) return `明天 ${time}`;
     if (days > 1 && days < 7) return `${WEEKDAYS[at.weekday]} ${time}`;
     return `${at.month}月${at.date}日 ${time}`;
   }

   /** '周五 10/30 21:00（北京时间）' — the board's wall clock and its zone label (spec §11 #8). '' when unparseable. */
   export function formatBoardDateTime(value: string, offsetHours: number): string {
     const ms = parseTimestamp(value);
     if (Number.isNaN(ms)) return '';
     const at = wallClock(ms, offsetHours);
     return `${WEEKDAYS[at.weekday]} ${at.month}/${at.date} ${clockTime(at)}（${boardTzLabel(offsetHours)}）`;
   }

   /**
    * '你那边 22:00' when the viewer's UTC offset at that instant differs from the
    * board's; '你那边 周六 01:00' when the viewer's date differs too; null when the
    * zones agree or the value is unparseable.
    */
   export function formatViewerAside(value: string, offsetHours: number): string | null {
     const ms = parseTimestamp(value);
     if (Number.isNaN(ms)) return null;
     // getTimezoneOffset is minutes BEHIND UTC, for this instant (daylight saving included).
     if (-new Date(ms).getTimezoneOffset() === Math.round(offsetHours * 60)) return null;
     const viewer = wallClock(ms);
     const board = wallClock(ms, offsetHours);
     const sameDay = viewer.month === board.month && viewer.date === board.date;
     return sameDay ? `你那边 ${clockTime(viewer)}` : `你那边 ${WEEKDAYS[viewer.weekday]} ${clockTime(viewer)}`;
   }
   ```

   不传 offset 的分支逐行等价于原实现（同样的本地 0 点、同样的 `Math.round(差 / DAY)`，夏令时那天也一样），所以现有调用（`App.tsx`、`InviteBanner.tsx`、`SessionsPanel.tsx`、`SessionDetailDialog.tsx`、`RescheduleSheet.tsx` 等）输出一字不变。`formatDateTime`、`toDateTimeLocalValue` 不动。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/board-time.test.ts tests/unit/client-time.test.ts tests/unit/time.test.ts tests/unit/countdown.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests "
npm run typecheck
npm run test:dom > /tmp/p2-4-dom-t3.log 2>&1; grep -E "Test Files|Tests " /tmp/p2-4-dom-t3.log; grep -c "not wrapped in act" /tmp/p2-4-dom-t3.log
```

期望：四个 unit 文件全过（board-time 33 个）；typecheck 通过；dom **D0 个全过**、`act(...)` 警告 **A0** 条（所有组件仍不传第三参，组件测试里的时间文案不变）。

- [ ] **Step 5：提交**

```bash
git add src/lib/time.ts tests/unit/board-time.test.ts
git commit -m "feat: formatWhen 可按看板时区显示，新增 formatBoardDateTime 和「你那边」formatViewerAside（P2-4）"
```

---

### Task 4：`/api/config` 下发 `boardTzOffsetHours`

**Files:**
- Modify: `worker/routes.ts`（锚点 `nextResetAt: nextResetAt(offset),`）
- Modify: `src/types.ts`（`interface Config` 末尾）
- Modify: `docs/CONTRACT.md`（`- \`GET /api/config\`` 那一条）
- Test: `tests/worker/session-routes.test.ts`（末尾追加）

- [ ] **Step 1：写失败的测试**

`tests/worker/session-routes.test.ts` **文件末尾**追加（用 P2-2 写好的 `call(path, init, overrides)` 和它已经导入的 `type Env`；不加 import）：

```ts

// --- P2-4 ---
describe("GET /api/config: the board's time zone", () => {
  async function boardOffset(overrides: Partial<Env>): Promise<unknown> {
    const res = await call('/api/config', {}, overrides);
    expect(res.status).toBe(200);
    return ((await res.json()) as { boardTzOffsetHours?: unknown }).boardTzOffsetHours;
  }

  it('is RESET_TZ_OFFSET, the same hours the weekly reset uses (8 when unset)', async () => {
    expect(await boardOffset({ RESET_TZ_OFFSET: undefined })).toBe(8);
    expect(await boardOffset({ RESET_TZ_OFFSET: '0' })).toBe(0);
    expect(await boardOffset({ RESET_TZ_OFFSET: '5.5' })).toBe(5.5);
    expect(await boardOffset({ RESET_TZ_OFFSET: 'not a number' })).toBe(8);
  });
});
```

（取值规则就是现有的 `resetOffsetHours`（`worker/time.ts`）：空或不是有限数时回落到 8；本 PR 不改它。）

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts 2>&1 | grep -E "FAIL|AssertionError|Tests "
```

期望：只有新用例失败，`Tests  1 failed | 12 passed (13)`（12 = P2-2 的 3 + P2-1 的 4 + P2-6 的 1 + P2-3 的 4），`AssertionError: expected undefined to be 8`。

- [ ] **Step 3：实现**

`worker/routes.ts`，`app.get('/api/config'` 的 `c.json({ … })` 里，锚点行之后加一行：

```ts
      nextResetAt: nextResetAt(offset),
      boardTzOffsetHours: offset,
```

（`offset` 就是同一个处理函数开头的 `const offset = resetOffsetHours(c.env.RESET_TZ_OFFSET);`，回血和周报用的也是它。）

`src/types.ts`，`interface Config` 的最后一个成员 `  nextResetAt: string;` 之后加：

```ts
  /** Board time zone (RESET_TZ_OFFSET), hours. Absent from an older API: fall back to the browser's zone and say 本地时间. */
  boardTzOffsetHours?: number;
```

`docs/CONTRACT.md`，`### Public (no auth)` 下 `- \`GET /api/config\`` 那一条，把

```
  → `{ violations, tiers, weeklyHeal, weeklyBonusCap, statementWindowHours, aiEnabled, maxBatchSubjects, nextResetAt }`
```

换成

```
  → `{ violations, tiers, weeklyHeal, weeklyBonusCap, statementWindowHours, aiEnabled, maxBatchSubjects, nextResetAt, boardTzOffsetHours }`
  `boardTzOffsetHours` is `RESET_TZ_OFFSET` as a number of hours (default 8; may be fractional, e.g. 5.5): the board's
  time zone, the one `/yue` and the weekly reset use. Times are still sent as ISO instants; the web shows them on this clock.
```

下面「Also fires (non-blocking) three idempotent jobs…」两行不动。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts tests/worker/http-guards.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests "
npm run typecheck
```

期望：两个文件全过（`http-guards.test.ts` 里 `/api/config` 的只读、后台任务用例不受影响）；typecheck 通过（前端 `Config` 的新字段可选，现有 dom fixture 不用改）。

- [ ] **Step 5：提交**

```bash
git add worker/routes.ts src/types.ts docs/CONTRACT.md tests/worker/session-routes.test.ts
git commit -m "feat: /api/config 下发看板时区 boardTzOffsetHours（P2-4）"
```

---

### Task 5：bot 用「待定」，`/yue` 的时段和提前量来自 shared

**Files:**
- Modify: `server/src/discord/sessions.ts`（import、`RSVP_LABEL`、`sessionCard` 的 fields、`renderSessionDm` 的 `invited` 分支、`YUE_SLOTS`/`slotIso`、`handleYue` 的 15 分钟）
- Test: `server/test/session-render.test.ts`（import 区 + 末尾追加 describe `labels and slots`）
- Test: `tests/pg/session-cards.test.ts`（`describe('/yue, more'` 里追加一个用例）

- [ ] **Step 1：写失败的测试（server）**

`server/test/session-render.test.ts` 的 import 区，**第 2 行**（`import { parseRsvpButton, renderSessionDm, sessionCard, sessionDmRelevant, slotIso } from '../src/discord/sessions';`）**不动**。锚点（原文，只出现 1 次；第二行是 P2-3 加的）：

```ts
import type { SessionDetail } from '../../worker/types';
import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';
```

换成（`RSVP_LABEL` 按字母序并进 P2-3 那一行，不另起一行；再加两行）：

```ts
import type { SessionDetail } from '../../worker/types';
import { RSVP_LABEL, SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';
import { BOARD_SLOTS, slotIso as sharedSlotIso } from '../../shared/quickTime';
import { YUE_SLOTS } from '../src/discord/sessions';
```

文件**末尾**（P2-3 的 describe `the cancel DM` 之后）追加：

```ts

// --- P2-4 ---
describe('labels and slots', () => {
  /** The labels of a message's RSVP buttons, in order (the web link has no custom_id). */
  function rsvpLabels(card: ReturnType<typeof sessionCard>): Array<string | undefined> {
    return card.components.flatMap((row) => row.components).flatMap((b) => ('custom_id' in b ? [b.label] : []));
  }

  it('the card says 来 / 待定 like the web: field names and buttons come from RSVP_LABEL', () => {
    const card = sessionCard(session(), 'https://score.example', NOW);
    expect(card.embeds[0].fields?.map((f) => f.name)).toEqual(['组织者', RSVP_LABEL.going, RSVP_LABEL.maybe, '报名的人']);
    expect(RSVP_LABEL.maybe).toBe('待定');
    expect(rsvpLabels(card)).toEqual([RSVP_LABEL.going, RSVP_LABEL.maybe, RSVP_LABEL.out]);
    expect(JSON.stringify(card)).not.toContain('可能');
  });

  it('the invitation and the new-time DM use the same words', () => {
    const invited = renderSessionDm('dm.session.invited', session(), 'https://score.example');
    expect(invited.embeds[0].fields?.map((f) => f.name)).toEqual([RSVP_LABEL.going]);
    expect(rsvpLabels(invited)).toEqual([RSVP_LABEL.going, RSVP_LABEL.maybe, RSVP_LABEL.out]);
    const changed = renderSessionDm('dm.session.changed', session(), 'https://score.example');
    expect(rsvpLabels(changed)).toEqual([RSVP_LABEL.going, RSVP_LABEL.maybe, RSVP_LABEL.out]);
    for (const kind of ['dm.session.invited', 'dm.session.changed', 'dm.session.cancelled', 'dm.session.starting', 'dm.session.rollcall'] as const) {
      expect(JSON.stringify(renderSessionDm(kind, session(), 'https://score.example')), kind).not.toContain('可能');
    }
  });

  it("/yue's slots and slotIso are the shared ones the web uses", () => {
    expect(YUE_SLOTS).toBe(BOARD_SLOTS);
    expect(slotIso).toBe(sharedSlotIso);
  });
});
```

（`session()`、`NOW` 是文件开头已有的 fixture 和时钟。）

- [ ] **Step 2：写失败的测试（PG）**

`tests/pg/session-cards.test.ts`，`describe('/yue, more'` 里最后一个用例 `it('says where the card goes only when there is a session channel'` 的结束 `});` 之后、这个 describe 的结束 `});` 之前，追加：

```ts

  // P2-4: the bot says 待定 where it said 可能 — the web's word (RSVP_LABEL).
  it('a 待定 button is answered with 待定', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const reply = await handleRsvpButton(session.id, 'maybe', session.starts_at, dc(2), ctx);
    expect(reply.content).toContain('已登记：**待定**');
    expect(reply.content).not.toContain('可能');
  });
```

（`cast`、`createSession`、`handleRsvpButton`、`dc`、`ctx`、`IN_2H`、`OFFSET_HOURS`、`env` 都是文件里已有的导入和辅助；不新增 import。）

- [ ] **Step 3：跑测试，确认失败**

```bash
npx vitest run --config vitest.server.config.ts server/test/session-render.test.ts 2>&1 | grep -E "FAIL|AssertionError|Tests "
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts 2>&1 | grep -E "FAIL|AssertionError|Tests "
```

期望：
- server：`3 failed`，分别是 `expected [ '组织者', '来', '可能', '报名的人' ] to deeply equal [ '组织者', '来', '待定', '报名的人' ]`、`expected [ '来', '可能', '不来' ] to deeply equal [ '来', '待定', '不来' ]`、以及 `YUE_SLOTS` 和 `BOARD_SLOTS` 不是同一个引用（`… to be …  // Object.is equality`）。其余原有用例全过。
- PG：`1 failed`，`expected '已登记：**可能**。现在来 1 人。' to contain '已登记：**待定**'`。

- [ ] **Step 4：实现**

`server/src/discord/sessions.ts`：

1. import：把 P2-3 加的那一行

   ```ts
   import { SESSION_CANCEL_REASON_MAX } from '../../../shared/attendance';
   ```

   改成（`RSVP_LABEL` 按字母序并进 P2-3 这一行）并在它下面加 quickTime 一行：

   ```ts
   import { RSVP_LABEL, SESSION_CANCEL_REASON_MAX } from '../../../shared/attendance';
   import { BOARD_SLOTS, BOARD_SLOT_MIN_LEAD_MS, slotIso } from '../../../shared/quickTime';
   ```

2. 删掉本地标签那一行（`export type RsvpChoice …` 保留：`rsvpButtonId`、`parseRsvpButton`、`rsvpRow` 的 `styles`、`handleRsvpButton` 都在用）：

   ```ts
   const RSVP_LABEL: Record<RsvpChoice, string> = { going: '来', maybe: '可能', out: '不来' };
   ```

   `rsvpRow` 里的 `label: RSVP_LABEL[choice],` 和 `handleRsvpButton` 里的 ``已登记：**${RSVP_LABEL[choice]}**`` 不用改：现在读到的是 shared 的 `Record<Rsvp, string>`（`RsvpChoice` 是 `Rsvp` 的子集），going/out 文字不变，maybe 变成「待定」。

3. `sessionCard` 的 `fields` 里两行

   ```ts
         { name: '来', value: seats(session), inline: true },
         { name: '可能', value: `${session.counts.maybe} 人`, inline: true },
   ```

   换成

   ```ts
         { name: RSVP_LABEL.going, value: seats(session), inline: true },
         { name: RSVP_LABEL.maybe, value: `${session.counts.maybe} 人`, inline: true },
   ```

4. `renderSessionDm` 的 `case 'dm.session.invited':` 里 `fields: [{ name: '来', value: seats(session), inline: true }] }` 换成 `fields: [{ name: RSVP_LABEL.going, value: seats(session), inline: true }] }`（同一行其余不动）。`case 'dm.session.cancelled':`（P2-3 的分区）不碰。

5. `// --- /yue ---` 小节里，从 `/** The \`when\` choices of /yue, in the board's time zone (RESET_TZ_OFFSET). */` 到 `slotIso` 函数结束的右花括号为止（`YUE_SLOTS` 数组 + 本地 `slotIso` 实现），整段换成：

   ```ts
   /** The `when` choices of /yue, in the board's time zone (RESET_TZ_OFFSET): the web's quick picks too (shared/quickTime). */
   export const YUE_SLOTS = BOARD_SLOTS;

   /** `dayOffset` days from today at `hour`:00, board-local, as an ISO instant. Lives in shared/quickTime now. */
   export { slotIso };
   ```

   （`handleYue` 还要在本文件里调用 `slotIso`，所以是「import + `export { slotIso }`」，效果等同契约写的 `export { slotIso } from '../../../shared/quickTime'`，`server/test/session-render.test.ts:2` 的导入照常成立。）

6. `handleYue` 里

   ```ts
     if (Date.parse(startsAt) < Date.now() + 15 * 60_000) {
   ```

   换成

   ```ts
     if (Date.parse(startsAt) < Date.now() + BOARD_SLOT_MIN_LEAD_MS) {
   ```

   回复文案「{slot} 已经过了（或马上就到），换个时间吧。」不变。上榜判断这一步**先不动**（Task 6）。

- [ ] **Step 5：跑测试，确认通过**

```bash
npm run typecheck
npm run test:server 2>&1 | grep -E "FAIL|Test Files|Tests "
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts tests/pg/bot-commands.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests "
```

期望：typecheck 通过（`commands.ts:125` 的 `YUE_SLOTS.map((s) => ({ name: s.name, value: s.value }))` 对 `readonly BoardSlotDef[]` 照样成立）；server **22 个文件、S0 + 3** 全过（原有的 `slotIso` 用例 `:33-41` 靠 re-export 照常通过）；两个 PG 文件全过（`/yue proposes a session at the chosen board-local time`、`refuses a slot that has already passed today` 证明时段和 15 分钟没变；`bot-commands.test.ts` 没有断言「可能」）。

- [ ] **Step 6：提交**

```bash
git add server/src/discord/sessions.ts server/test/session-render.test.ts tests/pg/session-cards.test.ts
git commit -m "feat: bot 用「待定」并从 shared 取 /yue 时段和 slotIso（P2-4）"
```

---

### Task 6：`/yue` 放开给已绑定的非上榜用户（spec §11 第 7 条）

**Files:**
- Modify: `server/src/discord/sessions.ts`（`handleYue`）
- Test: `tests/pg/session-cards.test.ts`（**改** `it('/yue is for bound players only'` 这个用例，契约 7.1 第一行）

- [ ] **Step 1：改测试（有意的行为变化）**

`tests/pg/session-cards.test.ts`，`describe('RSVP buttons and /yue'` 里整个用例

```ts
  it('/yue is for bound players only', async () => {
    await seedUser({ id: 'viewer', participant: false });
    await bind('viewer', 5);
    expect((await handleCommand({ commandName: 'yue', caller: dc(5), targetUser: null, when: 'dayafter20' }, ctx)).content).toContain(
      '上榜选手',
    );
    expect((await handleCommand({ commandName: 'yue', caller: dc(8), targetUser: null, when: 'dayafter20' }, ctx)).content).toContain(
      '/link',
    );
  });
```

换成

```ts
  // P2-4 (spec §11 #7): the bot follows the web, where anyone signed in may organise.
  it('/yue is for anyone bound — on the board or not', async () => {
    await seedUser({ id: 'viewer', participant: false });
    await bind('viewer', 5);
    const reply = await handleCommand({ commandName: 'yue', caller: dc(5), targetUser: null, when: 'dayafter20' }, ctx);
    expect(reply.content).toContain('已发起约局');
    expect(reply.content).not.toContain('上榜选手');
    const rows = await pool.query<{ organizer_id: string }>('SELECT organizer_id FROM game_sessions');
    expect(rows.rows.map((r) => r.organizer_id)).toEqual(['viewer']);
    expect((await handleCommand({ commandName: 'yue', caller: dc(8), targetUser: null, when: 'dayafter20' }, ctx)).content).toContain(
      '/link',
    );
  });
```

（`pool` 已从 `./cloudflare-test` 导入；`setup.ts` 每个用例前 TRUNCATE，所以 `game_sessions` 里只有这一局。没绑定的 `dc(8)` 仍回 `NOT_LINKED`。）

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts 2>&1 | grep -E "FAIL|AssertionError|Tests "
```

期望：`1 failed`，`/yue is for anyone bound — on the board or not`：`expected '只有上榜选手可以发起约局（网页上可以改身份）。' to contain '已发起约局'`。

- [ ] **Step 3：实现**

`server/src/discord/sessions.ts` 的 `handleYue`：

1. 删掉这一行：

   ```ts
     if (!user.is_participant) return ephemeralReply('只有上榜选手可以发起约局（网页上可以改身份）。');
   ```

2. 函数上方的注释

   ```ts
   /** /yue: propose a session. The card is posted by the dispatcher, like any new session. */
   ```

   换成

   ```ts
   /**
    * /yue: propose a session. The card is posted by the dispatcher, like any new session.
    * Anyone bound may, on the board or not — as on the web (spec §11 #7); createSession keeps the caps.
    */
   ```

额度不变：`createSession` 里的 `assertCanOrganize`（`MAX_OPEN_SESSIONS` 5 个未开局、`MAX_SESSIONS_PER_DAY` 24 小时 10 个）对 `/yue` 和网页一样生效。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts tests/pg/bot-commands.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests "
npm run typecheck
grep -n "上榜选手可以发起" -r server/src   # 期望无输出
```

- [ ] **Step 5：提交**

```bash
git add server/src/discord/sessions.ts tests/pg/session-cards.test.ts
git commit -m "feat: /yue 放开给已绑定的非上榜用户，和网页发起约局一致（P2-4）"
```

---

### Task 7：Discord 部署说明对齐

**Files:**
- Modify: `docs/DEPLOY-DISCORD.md`（`## 7. 约局（P7）` 一节）

- [ ] **Step 1：改文字**

逐条替换（每条在文件里只出现一次；`:187-188` 两行见「对契约的补充」第 3 条）：

| 原文 | 改成 |
|---|---|
| `组织者、来 / 可能的人数、报名的人，` | `组织者、来 / 待定的人数、报名的人，` |
| `附 **[来] [可能] [不来]** 按钮。` | `附 **[来] [待定] [不来]** 按钮（和网页同样的字）。` |
| `（来、可能、不来都一样）` | `（来、待定、不来都一样）` |
| `局里所有人（来 / 可能 / 不来 / 被邀请）` | `局里所有人（来 / 待定 / 不来 / 被邀请）` |
| `报了来 / 可能的，` | `报了来 / 待定的，`（P2-3 在同一行末尾加的「附组织者写的理由（如有）」保留） |

把这一行

```
`/yue` 只能由已绑定的**上榜选手**发起，时间按 `RESET_TZ_OFFSET`（默认 UTC+8）算，标题自动生成。
```

换成两行

```
`/yue` 已绑定的用户都能发起（不必上榜，和网页一样），时间按 `RESET_TZ_OFFSET`（默认 UTC+8）算，标题自动生成。
时段（今晚 20/21/22 点、明晚 20 点、后天 20 点）和网页的快捷时段是同一组（`shared/quickTime` 的 `BOARD_SLOTS`），不足 15 分钟的时段会被拒绝。
```

- [ ] **Step 2：核对**

```bash
grep -n "可能" docs/DEPLOY-DISCORD.md     # 期望只剩 :104「可能带出私事」（不是 RSVP 用词）
grep -n "上榜选手" docs/DEPLOY-DISCORD.md # 期望无输出
```

- [ ] **Step 3：提交**

```bash
git add docs/DEPLOY-DISCORD.md
git commit -m "docs: Discord 部署说明改用「待定」，写明 /yue 不必上榜（P2-4）"
```

---

## 收尾

- [ ] **完整验证**（契约第 9 节：六个套件 + build）

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit   2>&1 | grep -E "Test Files|Tests "
npm run test:dom > /tmp/p2-4-dom.log 2>&1; grep -E "Test Files|Tests " /tmp/p2-4-dom.log; grep -c "not wrapped in act" /tmp/p2-4-dom.log
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg     2>&1 | grep -E "FAIL|Test Files|Tests "
npm run build && ls dist
```

期望（和 Task 0 的基线对照；括号里是跨 PR 合成副本的实测）：

| 套件 | 文件 | 用例 |
|---|---|---|
| typecheck | — | 三个 tsconfig 全过 |
| unit | 30 → **31**（新 `board-time.test.ts`） | **U0 + 34**（board-time 33 + source-hygiene 1）（422 → **456**） |
| dom | **26**（不变） | **D0**（不变，322）；`act(...)` 警告 **A0**（= 3） |
| server | **22**（不变） | **S0 + 3**（`labels and slots`）（292 → **295**） |
| worker | **20**（不变） | **W0 + 1**（`session-routes` 的 config 用例）（620 → **621**），9 todo 不变 |
| pg | **32**（不变） | **P0 + 2**（worker 那 1 个在 PG 上再跑一遍 + `session-cards` 新增 1 个；改写的那个用例不增不减）（904 → **906**），9 todo 不变 |
| build | — | 通过；`dist/` 只有 `index.html` 和 `assets/`（没有 `404.html`） |

PG 撞上 `adapter.test.ts` 那条 5 秒超时：单独重跑那一个文件确认 4/4，记进 PR 描述（契约第 1 节，和本 PR 无关）。

上表括号里的数字来自跨 PR 合成副本（P0 + P1 规划副本依次套上 P2-2、P2-1、P2-6、P2-3 的最终计划和本计划）。规划者当初是在最小替身上自检的（开工 unit 29/414、dom 24/299、server 22/290、worker 16/561、pg 28/839），绝对数字已作废，增量（+1 文件 / +34、0、+3、+1、+2）和合成副本一致。

每一步的红绿也照上面各 Task 写的数字实测过（Task 1：1 failed / 5 passed；Task 2：17 failed；Task 3：13 failed / 20 passed；Task 4：1 failed；Task 5：server 3 failed、PG 1 failed；Task 6：PG 1 failed）。

- [ ] **源码卫生**

```bash
grep -rn "console\.log" shared/quickTime.ts src/lib/time.ts server/src/discord/sessions.ts            # 期望无输出
grep -rn "'可能'" server/src src shared worker                                                         # 期望无输出
grep -rn "15 \* 60_000" server/src/discord/sessions.ts                                                 # 期望无输出（改用 BOARD_SLOT_MIN_LEAD_MS）
grep -nE "export const (MAX_OPEN_SESSIONS|MAX_SESSIONS_PER_DAY)" worker/sessions.ts                    # 期望无输出（只剩 re-export）
grep -n "quickSlots\|MIN_LEAD_MINUTES" src/components/RescheduleSheet.tsx src/components/SessionFormDialog.tsx   # 期望和开工时一样（本 PR 不换组件的时段）
git diff claude/p2-3-invite-context --stat -- src/components                                            # 期望无输出
wc -l shared/quickTime.ts src/lib/time.ts server/src/discord/sessions.ts worker/sessions.ts
# 期望前三个 < 400（合成副本：173、249、280）；worker/sessions.ts 比开工时多 1 行（1059 → 1060）（import 块 +2、两行常量换成一行 re-export；契约第 0 节：它已超 800 行，P2 只改接线）
git status --short                                                                                      # 期望无输出
git log --oneline claude/p2-3-invite-context..HEAD
# 期望 7 个 commit（refactor ×1、feat ×5、docs ×1），信息都是「<type>: 中文描述（P2-4）」，没有任何署名行
```

- [ ] **PR 描述要点**（由机主以后开 PR 时用；本轮不开 PR、不 push）
  1. `/yue` 的权限是**有意的行为变化**（spec §11 第 7 条）：已绑定的非上榜用户也能 `/yue`，和网页一致；改了 `tests/pg/session-cards.test.ts` 的「/yue is for bound players only」用例（spec §4.2、§10 第 13 条说「现有测试没有断言」，与代码不符，契约 7.1）。额度仍是 5 个未开局、24 小时 10 个。
  2. bot 的「可能」改成「待定」：按钮、卡片字段、登记回复、邀请 / 改期私信。Discord 的 `/yue` 命令定义（choices 的 `name`、`value`）没变，不需要重新注册命令。
  3. 看板时区只提供了数据和函数：界面仍按浏览器时区显示，`RescheduleSheet` 仍写「（本地时间）」，P3-1 / P3-3 / P3-4 接上（「对契约的补充」第 1 条）。
  4. 无迁移；回滚就是回退这 7 个 commit。

---

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| §8 B2-4「`GET /api/config` 加 `boardTzOffsetHours`，取值来自 `RESET_TZ_OFFSET`」；契约 4.1、4.2 | Task 4（路由一行、`Config.boardTzOffsetHours?`、`docs/CONTRACT.md`；用例：未设 8、`'0'`、`'5.5'`、非法 8） |
| §4.2 / B2-4「新增 `shared/quickTime.boardSlots(now, offsetHours)`，时段就是 `/yue` 的那 5 个」「`slotIso` 移进 shared」「旧的 `quickSlots` 保留，现有测试不变」；契约 4.4 | Task 2（`BOARD_SLOTS`、`BOARD_SLOT_MIN_LEAD_MS`、`slotIso`、`BoardSlot`、`boardSlots`；`quickTime.test.ts` 不改、照跑） |
| §3.6 / §11 第 8 条「+8 写『北京时间』，其他写『UTC+N』」 | Task 2（`boardTzLabel`，含 0、负数、半小时、45 分钟） |
| §11 第 8 条「浏览器时区不同时附上『你那边 HH:MM』」；§3.5「只有浏览器时区和看板时区不同时才显示」 | Task 3（`formatViewerAside`：同区 null、异区、跨日带星期、夏令时按那一刻的 offset） |
| §5 第 9 条「`formatWhen(value, now, offsetHours?)` … formatWhen 目前没有单测，要新增」；契约第 8 节第 4 条（拆成三个函数） | Task 3（不传第三参的回归锁在 Asia/Shanghai、UTC、America/Los_Angeles 各一组；传了按看板墙钟分桶；`formatBoardDateTime` 输出「周五 10/30 21:00（北京时间）」） |
| 契约第 9 节「时区测试不依赖机器时区」 | Task 2、3 的每个时间断言都在 `process.env.TZ` 显式设定下执行（`describe.each(ZONES)` + `beforeAll`/`afterAll`，或 `inZone`），写法同 `tests/unit/client-time.test.ts` |
| §4.2「RSVP 用词：按钮和卡片字段都用 `RSVP_LABEL.maybe`」（`sessions.ts:36`、`:120`）；契约第 5 节 | Task 5（删本地 `RSVP_LABEL`；卡片、邀请私信字段；server 用例断言字段名、按钮、全部私信不含「可能」；PG 用例断言回复「已登记：**待定**」） |
| §4.2「`YUE_SLOTS` 改为从 shared 取」；契约第 5 节「名字、`value`、算法不变」「15 分钟改用常量」 | Task 5（`YUE_SLOTS = BOARD_SLOTS`、`export { slotIso }`、`BOARD_SLOT_MIN_LEAD_MS`；server 用例断言同一引用、同一函数；现有 `/yue` 时间和「已经过了」用例照常通过） |
| §11 第 7 条 / §4.2「`/yue` 去掉上榜限制，新增『已绑定的非上榜用户能 /yue』用例」；契约 7.1 第一行 | Task 6（删判断；改写的用例断言建出 `organizer_id = 'viewer'` 的局、回复「已发起约局」、未绑定仍是 `/link`） |
| §8「常量迁移」：`MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`、`DEFAULT_DURATION_MIN` 移到 `shared/`；契约 4.4「值一字不改、原处 re-export」 | Task 1（`shared/attendance.ts` 的 `// --- P2-4 ---`；`worker/sessions.ts` re-export；source-hygiene 锁 `DEFAULT_DURATION_MIN` = SQL 的 120） |
| 契约第 3 节 `docs/DEPLOY-DISCORD.md`「`:169-171` 的『可能』改『待定』；`:191` 改成『已绑定的用户都能发起（不必上榜）』」 | Task 7 |
| 契约第 3 节分区：`shared/quickTime.ts` 只追加、`server/test/session-render.test.ts:2` 不改、`tests/unit/source-hygiene.test.ts` 末尾追加、`session-routes.test.ts` 末尾追加 | Task 1–5 都按锚点追加；Task 0 Step 2 核对锚点 |
| 契约第 2 节「P2-4 不碰任何组件」、第 7.4 节第 6 条、第 8 节第 3 条 | 全文不改 `src/components/**`；收尾的 `git diff … -- src/components` 检查 |
| P1 契约「被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块」 | Task 3（`time.ts` 只多引一个 shared 纯函数） |
| 机主编码规则：不写魔法数、函数 < 50 行、不可变 | `BOARD_SLOT_MIN_LEAD_MS`、`BEIJING_OFFSET_HOURS`、`HOUR_MS`、`WEEKDAYS` 是具名常量；新函数都在 25 行以内；`boardSlots` 用 `flatMap` 生成新数组，不改 `BOARD_SLOTS` |
| 提交信息 `<type>: <中文描述>`，无署名；不 push、不 rebase、不开 PR | 每个 Task 的提交步骤；收尾的 `git log` 检查 |

## 对契约的补充

以下是契约没写死、本计划写死了的东西（理由附后），请写进 PR 描述、机主过目：

1. **`RescheduleSheet` 在 P2-4 里不换成看板时段（照契约，不照任务说明）。** 下发本计划的任务说明里写了「P0-6 的 RescheduleSheet 现在把浏览器时区的时段标成『本地时间』，P2-4 按 spec 把它换成看板时间」。但约束本计划的契约在四处明确写了相反的安排：第 2 节 P2-4「**不碰任何组件**（`RescheduleSheet`、`SessionFormDialog` 换成看板时段是 P3-3、P3-4）」、第 3 节「`RescheduleSheet.tsx` … P2 全程不改」、第 7.4 节第 6 条、第 8 节第 3 条（理由：P3-3 把 RescheduleSheet 迁进组织者控制台时一起换；`tests/dom/organizer-actions.test.tsx:142` 锁着「（本地时间）」）。spec §3.5 的「和 /yue 同一组时段（P2 起）」说的是数据从 P2 起可用，契约把它理解为依赖关系。本计划按契约执行：P2-4 只提供 `boardSlots`、`boardTzLabel`、`formatBoardDateTime`、`formatViewerAside` 和 `config.boardTzOffsetHours`，组件文件一个不改。机主如果要在 P2-4 就换，需要改契约第 2、3 节和第 8 节第 3 条，并在本 PR 里加一个 Task：`RescheduleSheet` 在 `config.boardTzOffsetHours` 有值时用 `boardSlots(Date.now(), offset)` 和 `boardTzLabel(offset)`、没有时退回 `quickSlots` 和「本地时间」，同时改 `organizer-actions.test.tsx:142`（并补一条「有 offset 时显示『北京时间』」的 dom 用例）；这会和 P3-3 的迁移计划重叠。
2. **`slotIso` 在 bot 文件里是「import + `export { slotIso }`」**，不是契约字面的 `export { slotIso } from '../../../shared/quickTime'`：`handleYue` 自己还要调用它，`export … from` 不产生本地绑定。对外效果相同（`server/test/session-render.test.ts:2` 照常导入，新用例断言是同一个函数）。
3. **`docs/DEPLOY-DISCORD.md` 多改了 `:187`、`:188` 两处「可能」**（「约局改了时间」「约局取消」两行的收件人描述）。契约只点了 `:169-171` 和 `:191`，但这两行说的是同一个 RSVP 状态，留着「可能」就和 bot 的按钮对不上。`:188` 是 P2-3 改过的行，P2-4 叠在它后面、只换这两个字，不碰 P2-3 加的「附组织者写的理由（如有）」，没有冲突。`:191` 另补一句时段和 15 分钟的说明。
4. **`docs/CONTRACT.md` 的 `/api/config` 条目多写了两行说明**（单位是小时、可以是小数、时间仍以 ISO 下发），契约只要求「加 `boardTzOffsetHours`」。
5. **`boardTzLabel` 对 `+8` 以外的值一律写数字**（含 0 写 `UTC`、半小时 `UTC+5:30`、45 分钟 `UTC+5:45`）；契约 4.4 列的例子都覆盖了，45 分钟、+14 是本计划补的用例。不认识的输入（`NaN`）不在这里处理：`resetOffsetHours` 永远返回有限数，前端读 config 时缺字段就走「本地时间」（契约 4.2），由 P3 的调用方守。
6. **`formatViewerAside` 按「那一刻」的浏览器 offset 比较**（`getTimezoneOffset()` 取 `value` 那个时间点的，不是现在的），所以洛杉矶夏令时结束前后、看板 offset 设成 -7 时，一个返回 null、一个返回「你那边 05:00」，有用例锁住。跨日判断只比月、日（±14 小时内不可能出现同月同日不同年的情况）。
7. **`src/lib/time.ts` 多了私有的 `WallClock`/`wallClock`/`clockTime`/`WEEKDAYS`**，`formatWhen` 改为调用它们；不传 offset 的分支逐行保持原算法（本地 0 点 + `Math.round`），并且有三个时区的回归用例。`formatDateTime` 自己那份星期数组没动（不在本 PR 范围）。
8. **`tests/unit/board-time.test.ts` 有 33 个用例**（契约估「约 10」）：`describe.each` 在三个进程时区下各跑一遍同一组断言，才能证明结果与机器时区无关。
9. **`a 待定 button is answered with 待定` 放在 `describe('/yue, more'` 里**，照契约第 3、5 节；它测的其实是按钮回复，不是 `/yue`。
