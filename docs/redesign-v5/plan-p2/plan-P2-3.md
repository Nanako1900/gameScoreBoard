# P2-3 邀请上下文、取消理由与历史 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** spec §8 B2-3 的四个子功能，加上它们需要的 P2 唯一一次迁移：① 改期时，在现有的重置 UPDATE 里记下每个回答过的人对旧时间的回答和旧时间（`prev_rsvp`、`prev_starts_at`），他重新回答时清空；② `GET /api/me/invites` 每项带 `invite_reason: 'new' | 'moved'`、`prev_rsvp`、`prev_starts_at`（只给本人）；③ `POST /api/sessions/:id/cancel` 接受可选的 `{ reason }`（trim 后最多 80 字），写入 `cancel_reason`、`cancelled_at`，每个 `SessionItem` 带上这两列，bot 的取消私信渲染理由（经 `safeLine`）；④ `GET /api/sessions?scope=history[&before=<id>]`：已开局的局（**含已取消的**），按 `starts_at DESC, id DESC` 每页 20 条，每项带 `attendance_summary`（一次 GROUP BY）。D1 和 PostgreSQL 行为一致。前端只加类型和 `src/api.ts` 函数，不改任何组件。

**Architecture：** 迁移：D1 `migrations/004_lobby.sql`（四条 `ALTER TABLE … ADD COLUMN`）+ `schema.sql` 的两张 CREATE TABLE 各加两列；PG `server/migrations/0007_lobby.sql`（四条 `ADD COLUMN IF NOT EXISTS`，没有触发器、函数改动，契约 §3.2）。写入只改 `worker/sessions.ts` 里三条现有 SQL（改期重置、`setRsvp` 的 upsert、`cancelSession` 的 UPDATE），读取的批量查询放在 P2-6 建的 `worker/session-extras.ts`（追加 `inviteContexts`、`attendanceSummaries`），`worker/sessions.ts` 只加接线和新的 `listSessionHistory`（净增约 60 行，契约 §0 的上限内）。路由只改 `worker/routes.ts` 的 `GET /api/sessions`（history 分支）和 `POST …/cancel`（读 body）。Node 端 `server/src/api.ts` 复用同一个 Worker app，所以两个引擎走同一段代码；`vitest.pg.config.ts` 把 `tests/worker/**` 原样跑在 PostgreSQL 上，是「行为一致」的证据。bot 只改 `renderSessionDm` 的 `'dm.session.cancelled'` 分支；PG 触发器、dispatcher、`server/src/import-d1.ts`、`scripts/d1-export.mjs` 都不改（契约 §3.2、§3.3）。

**Tech Stack：** TypeScript、Hono（`worker/`）、Cloudflare D1 / SQLite 与 PostgreSQL（经 `server/src/db/d1.ts` 适配器）、discord.js 的消息形状（`server/src/discord/`）、React 18 + Vite（`src/`，本 PR 只动类型和 `api.ts`）、Vitest（unit `vitest.config.ts`；dom `vitest.dom.config.ts`；server `vitest.server.config.ts`；worker `vitest.workers.config.ts`，Miniflare + D1，schema 来自 `schema.sql`；pg `vitest.pg.config.ts`，`tests/worker/**` + `tests/pg/**` 跑在嵌入式 PostgreSQL 17，schema 来自 `server/migrations/*`）。

**依赖：** 上游分支 `claude/p2-6-going-preview`（叠放顺序 P2-2 → P2-1 → P2-6 → **P2-3**，契约 §2）。本 PR 消费的上游部件，一律按契约的定义：
- P2-2：`tests/worker/session-routes.test.ts` 和它的顶层辅助 `call(path, init?, overrides?)`、`asUser(sub, extra?)`（带签名 cookie 和 `Origin: BASE`，见 `plan-P2-2.md`「对契约的补充」第 2 条）；import 行已有 `env`、`describe, expect, it`、`seedUser`。
- P2-1：`shared/attendance.ts` 的 `// --- P2-1 ---` 小节（本 PR 的小节排在 P2-6 之后）。
- P2-6：`worker/session-extras.ts`（`goingPreviews`）；`toSessionItem(row, myRsvp, preview)`；`listSessions`、`listMyInvites` 里的 `goingPreviews(db, ids)`；`worker/types.ts` 的 `SessionItem.going_preview`；`src/types.ts` 的 `going_preview?`；`shared/attendance.ts` 的 `// --- P2-6 ---`。

共享契约：本目录的 [contract.md](contract.md)（下称「契约」）§2「P2-3」、§3（`worker/sessions.ts`、`worker/routes.ts`、`worker/types.ts`、`worker/session-extras.ts`、`shared/attendance.ts`、`src/types.ts`、`src/api.ts`、`server/src/discord/sessions.ts`、`docs/*` 的分区；3.2 触发器不变；3.3 import-d1 只改测试；3.4 SQL 方言）、§4.1–4.5、§5「取消私信」、§6 第 4–6 条、§7.1、§7.3、§8 第 2、5、7、8、11 条、§9「P2-3」、§10.1–10.4。spec：`docs/redesign-v5/spec.md` §3.4、§3.5「取消这局 → 原地确认」、§4.1 ⑦、§4.2「取消私信」、§8 B2-3 与「迁移约定」、§9 P2-3 行。

**分支：** `claude/p2-3-invite-context`，从 `claude/p2-6-going-preview` 的 HEAD 开（`git switch -c claude/p2-3-invite-context claude/p2-6-going-preview`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR、不合并。下一个 PR（P2-4 `claude/p2-4-board-time`）从本分支开。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `migrations/004_lobby.sql` | 新 | D1 迁移：四条 `ALTER TABLE … ADD COLUMN`，文件头写明重跑会报 `duplicate column name`（契约 §10.1 原文） |
| `server/migrations/0007_lobby.sql` | 新 | PG 迁移：四条 `ADD COLUMN IF NOT EXISTS`，没有触发器（契约 §10.2 原文） |
| `schema.sql` ★ | 改 | `game_sessions` 在 `settled_by` 后加 `cancel_reason`、`cancelled_at`；`session_players` 在 `record_id` 后加 `prev_rsvp`、`prev_starts_at` |
| `package.json` | 改 | `db:migrate4:local`、`db:migrate4:remote` |
| `shared/attendance.ts` ★ | 改（末尾追加） | `// --- P2-3 ---`：`SESSION_CANCEL_REASON_MAX = 80`、`SESSION_HISTORY_PAGE = 20` |
| `worker/types.ts` ★ | 改 | `SessionRow`、`SessionPlayerJoinRow` 各加两列；`SessionItem` 加 `cancel_reason`、`cancelled_at`；`SessionDetail` 之后加 `AttendanceSummary`、`HistorySessionItem`、`InviteReason`、`InvitedSessionItem` |
| `worker/session-extras.ts` | 改（末尾追加） | `// --- P2-3 ---`：`InviteContext`、`inviteContexts`、`NO_ATTENDANCE`、`attendanceSummaries`（都是「一批 id 一次查」的读函数） |
| `worker/sessions.ts` ★ | 改 | `toSessionItem` 加两列；改期重置 UPDATE 多写 `prev_*`；`setRsvp` 的 upsert 清空 `prev_*`；`cancelSession(…, rawReason?)`；`listMyInvites` 返回 `InvitedSessionItem[]`；新 `listSessionHistory`（在 `listMyInvites` 之后） |
| `worker/routes.ts` ★ | 改 | `GET /api/sessions` 的 `scope=history` / `before` 分支；`POST /api/sessions/:id/cancel` 读 body；import `listSessionHistory` |
| `server/src/discord/sessions.ts` ★ | 改 | 只改 `renderSessionDm` 的 `'dm.session.cancelled'` 分支，加 import `SESSION_CANCEL_REASON_MAX` |
| `src/types.ts` ★ | 改 | `SessionItem` 加可选 `cancel_reason?`、`cancelled_at?`；`SessionDetail` 之后加 `AttendanceSummary`、`HistorySessionItem`、`InviteReason`、`InvitedSessionItem`、`InvitesResponse` |
| `src/api.ts` ★ | 改 | `cancelSession(id, reason?)`（不传 reason 时**不带 body**）；`getMyInvites(): Promise<InvitesResponse>`；新 `getSessionHistory(before?)` |
| `docs/CONTRACT.md` ★ | 改 | `interface SessionItem` 两行、`HistorySessionItem`/`InvitedSessionItem` 形状、`/api/sessions` 一行加 history、`/cancel` 一行加 body、`/api/me/invites` 一行加三字段 |
| `docs/DEPLOY-DISCORD.md` ★ | 改 | 「约局取消」一行补「附组织者写的理由（如有）」 |
| `tests/worker/session-context.test.ts` | 新 | 10 个用例：新列初始为空；取消理由（trim/截断/空白与非字符串为 null/再取消不覆盖/每个 SessionItem 都带）；改期上下文（写入、invited 与组织者不动、连改两次保留第一次、重新回答清空、只改名不写）；`invite_reason` new/moved；上下文不出现在详情、列表、名单里 |
| `tests/worker/session-history.test.ts` | 新 | 6 个用例：含已取消、不含未开局、新到旧；`attendance_summary` 五键含 0；游标翻页且页界落在同一时刻的并列里；未知游标返回空；`my_rsvp`/`going_preview`/取消两列；`scope=past` 不变 |
| `tests/worker/session-routes.test.ts` | 改（import 区追加、末尾追加一个 describe） | `P2-3 over HTTP` 4 个用例：无 body 的取消 200、带理由的取消、`/api/me/invites` 带上下文、history 公开 + `before` 翻页 + 坏游标 400 |
| `tests/pg/import-d1.test.ts` | 改（末尾追加） | 1 个用例：带四列的导出原样导入，不带四列的行为 NULL |
| `tests/pg/session-cards.test.ts` | 改（末尾追加） | describe `a cancel with a reason` 2 个用例：带理由的取消私信含理由、收件人 `['a','b']` 与不带理由时相同 |
| `server/test/session-render.test.ts` | 改（import 区加一行、末尾追加） | describe `the cancel DM` 2 个用例：没有理由时 description 与改动前逐字相同；有理由时另起一行「理由：…」，`EVIL` 被中和、换行被压掉、截到 80 字 |
| `tests/dom/session-api.test.tsx` | 新 | 5 个用例：`cancelSession` 有无 body；`getSessionHistory` 的 URL、旧后端返回 undefined、空页；`getMyInvites` 透传上下文 |

**不碰：** 任何组件和 CSS（取消理由输入框是 P3-3，契约 §8 第 2 条）、`src/App.tsx`、`server/src/import-d1.ts`、`scripts/d1-export.mjs`、`server/migrations/0001`–`0006`（触发器、函数）、`server/src/outbox/*`、`server/src/discord/sessions.ts` 里 `renderSessionDm` 的其他分支和 `RSVP_LABEL`/`YUE_SLOTS`/`slotIso`/`handleYue`（P2-4 的区域）、`getSessions` 的签名和 URL（`tests/dom/app-refresh.test.tsx:145`）、`SessionPlayer`/`toSessionPlayer`（改期上下文只给本人，契约 §4.2、§6 第 4 条）。

---

### Task 0：开分支、核对上游、记基线

**Files:** 无改动。

- [ ] **Step 1：确认上游分支存在、工作区干净，开分支**

```bash
git rev-parse --verify claude/p2-6-going-preview
git status --porcelain   # 期望：无输出
git switch -c claude/p2-3-invite-context claude/p2-6-going-preview
```

上游分支不存在或工作区不干净 → 停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对上游部件和本 PR 的锚点**

```bash
# P2-6 / P2-1 / P2-2 的部件（每条都要有输出）
grep -n "export async function goingPreviews" worker/session-extras.ts
grep -n "^function holes(count: number): string {$" worker/session-extras.ts   # P2-6 的私有占位符助手，本 PR 的两个批量读复用它
grep -n "^function toSessionItem($" worker/sessions.ts                 # P2-6 把签名拆成了多行
grep -n "^  preview: SessionItem\['going_preview'\],$" worker/sessions.ts   # toSessionItem 的第三个参数（P2-6）
grep -n "goingPreviews(db" worker/sessions.ts                        # listSessions、listMyInvites 各一处
grep -n "going_preview: RecordActor\[\];" worker/types.ts
grep -n "going_preview?: UserRef\[\];" src/types.ts
grep -n "^// --- P2-1 ---\|^// --- P2-6 ---" shared/attendance.ts       # 两行，P2-6 在后
grep -nE "^async function (call|asUser)\(" tests/worker/session-routes.test.ts   # 两行
# 本 PR 用到的锚点（每条期望恰好 1）
grep -c "^  SESSION_GAME_MAX,$" worker/sessions.ts
grep -c "^  Env,$" worker/sessions.ts
grep -c "^    settled_at: row.settled_at,$" worker/sessions.ts
grep -c "UPDATE session_players SET rsvp = 'invited', rsvp_at = datetime('now')" worker/sessions.ts
grep -c "rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at\`," worker/sessions.ts
grep -c "^): Promise<SessionItem\[\]> {$" worker/sessions.ts             # 期望 2（listSessions、listMyInvites）
grep -c "const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'));" worker/routes.ts
grep -c "^  settled_by   TEXT,$" schema.sql
grep -c "^  record_id       INTEGER,  " schema.sql
# 要新建的文件都还不在
test ! -e migrations/004_lobby.sql && test ! -e server/migrations/0007_lobby.sql \
  && test ! -e tests/worker/session-context.test.ts && test ! -e tests/worker/session-history.test.ts \
  && test ! -e tests/dom/session-api.test.tsx && echo "new files absent"
# 名字冲突检查：上游已经 import 过的名字，本 PR 在同一文件里不再 import
grep -nE "^import|^\} from" tests/worker/session-routes.test.ts
grep -nE "^import|^\} from" worker/session-extras.ts
```

对不上就停下。最后两条是为 Task 2–4 的 import 行准备的：本 PR 往这两个文件**追加新的 import 行**，不改上游的行。期望输出（跨 PR 合成副本实测）：

- `tests/worker/session-routes.test.ts` 的 import 区正好是 P2-2 建的六行（第 8–13 行：`cloudflare:test`、`vitest`、`worker/index`、`worker/session`、`import type { Env }`、`import { noAiEnv, seedUser } from './helpers';`）。P2-1、P2-6 的 describe 都只用 HTTP 和这些名字，**没有**加 import，所以 `createSession`、`setRsvp`、`updateSession`、`SessionItem`、`InvitedSessionItem`、`HistorySessionItem`、`OFFSET_HOURS` 都不在里面，Task 2–4 的 import 行原样追加。
- `worker/session-extras.ts` 的 import 区正好两行：`import { GOING_PREVIEW_MAX } from '../shared/attendance';`、`import type { RecordActor, SessionPlayer } from './types';`。本 PR 要的 `isSelfRsvp`、`SelfRsvp`、`ATTENDANCES`、`isAttendance`、`AttendanceSummary` 都不在里面，原样追加。

和上面不一样（说明上游不是按它的最终计划做的）→ 停下报告，不要自己去重或改上游的行。

- [ ] **Step 3：跑基线，记下实际数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | tail -4
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:server 2>&1 | tail -4
npm run test:worker 2>&1 | tail -4
npm run test:pg 2>&1 | tail -4
```

记为 **U0、D0、S0、W0、P0**（文件数 / 用例数）。全绿才往下走。期望（= P2-6 完工时，跨 PR 合成副本实测）：unit **30 / 422**、dom **25 / 317**、server **22 / 290**、worker **18 / 600 + 9 todo**、pg **30 / 881 + 9 todo**；对不上就停下。dom 的 `act(...)` 警告只有 `onboarding-roles` 那 3 条。`test:pg` 偶发 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」5 秒超时（契约 §1），遇到就单独重跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts` 确认 4/4，记进 PR 描述。

> 上面的数字来自跨 PR 合成副本（P0 + P1 规划副本依次套上 P2-2、P2-1、P2-6 的最终计划）。规划者当初是在「最小化替身」上自检的（worker 16/561、pg 28/839），那组数字已作废。

---

### Task 1：迁移——四列进 D1 和 PostgreSQL

**Files:**
- Create: `tests/worker/session-context.test.ts`
- Modify: `tests/pg/import-d1.test.ts`（末尾追加）
- Create: `migrations/004_lobby.sql`、`server/migrations/0007_lobby.sql`
- Modify: `schema.sql`、`package.json`

- [ ] **Step 1：写失败的测试**

新建 `tests/worker/session-context.test.ts`（Task 2、3 往末尾追加），内容：

```ts
// P2-3 (spec §8 B2-3 ①②③): what a move leaves behind for each person — what
// they had said, and to which time — and a cancel's reason. Runs on D1 here and,
// unchanged, on PostgreSQL (vitest.pg.config.ts), so both engines agree.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  listSessions,
  setRsvp,
  updateSession,
} from '../../worker/sessions';
import type { User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';

const HOUR_MS = 3_600_000;

/** Whole-minute instant `hours` from now, so ISO round-trips are exact. */
function minuteFromNow(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * HOUR_MS) / 60_000) * 60_000).toISOString();
}

interface Cast {
  org: User;
  a: User;
  b: User;
  c: User;
  d: User;
}

async function cast(): Promise<Cast> {
  return {
    org: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
    c: await seedUser({ id: 'c' }),
    d: await seedUser({ id: 'd' }),
  };
}

interface ContextRow {
  user_id: string;
  rsvp: string;
  prev_rsvp: string | null;
  prev_starts_at: string | null;
}

async function contextRows(sessionId: number): Promise<ContextRow[]> {
  const rows = await env.DB.prepare(
    `SELECT user_id, rsvp, prev_rsvp, prev_starts_at
       FROM session_players WHERE session_id = ? ORDER BY user_id`,
  )
    .bind(sessionId)
    .all<ContextRow>();
  return rows.results;
}

async function cancelColumns(id: number): Promise<{ cancel_reason: string | null; cancelled_at: string | null } | null> {
  return env.DB.prepare('SELECT cancel_reason, cancelled_at FROM game_sessions WHERE id = ?')
    .bind(id)
    .first<{ cancel_reason: string | null; cancelled_at: string | null }>();
}

describe('the P2-3 columns', () => {
  it('start empty on a new session and on every new row of its roster', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    expect(await cancelColumns(session.id)).toEqual({ cancel_reason: null, cancelled_at: null });
    expect(await contextRows(session.id)).toEqual([
      { user_id: 'a', rsvp: 'invited', prev_rsvp: null, prev_starts_at: null },
      { user_id: 'org', rsvp: 'going', prev_rsvp: null, prev_starts_at: null },
    ]);
  });
});
```

`tests/pg/import-d1.test.ts` **文件末尾**追加（原有 8 个用例和 `exportFixture()` 一个字不改：fixture 本身就是「D1 还没跑 004」的导出，新用例在它的副本上加一局带四列的数据，两种导出一次都验到）：

```ts
// --- P2-3 ---
describe('importD1 and the P2-3 columns', () => {
  it('carries cancel_reason / cancelled_at / prev_rsvp / prev_starts_at over as they are; an export from before 004 leaves them NULL', async () => {
    const data = exportFixture();
    data.users.push({ id: 'p2', username: 'p2', display_name: null, avatar_url: null, email: null, is_participant: 0, is_judge: 0, is_admin: 0, score: 100, created_at: T, updated_at: T });
    data.game_sessions.push({
      id: 8, organizer_id: 'org', title: '周二 20:00 开黑', game: null, starts_at: '2026-10-27T12:00:00.000Z', duration_min: null, capacity: null, note: null,
      status: 'cancelled', settled_at: null, settled_by: null, created_at: T, cancel_reason: '临时加班，改天', cancelled_at: T,
    });
    data.session_players.push(
      { session_id: 8, user_id: 'org', rsvp: 'going', rsvp_at: T, attendance: null, late_minutes: null, attendance_note: null, record_id: null, prev_rsvp: null, prev_starts_at: null },
      { session_id: 8, user_id: 'p2', rsvp: 'invited', rsvp_at: T, attendance: null, late_minutes: null, attendance_note: null, record_id: null, prev_rsvp: 'going', prev_starts_at: '2026-10-27T11:00:00.000Z' },
    );
    const result = await importD1(pool, data);
    expect(Object.keys(result.checksums)).toHaveLength(9);

    const sessions = await env.DB.prepare('SELECT id, cancel_reason, cancelled_at FROM game_sessions ORDER BY id').all();
    expect(sessions.results).toEqual([
      { id: 7, cancel_reason: null, cancelled_at: null },
      { id: 8, cancel_reason: '临时加班，改天', cancelled_at: T },
    ]);
    const players = await env.DB.prepare(
      'SELECT session_id, user_id, prev_rsvp, prev_starts_at FROM session_players ORDER BY session_id, user_id',
    ).all();
    expect(players.results).toEqual([
      { session_id: 7, user_id: 'org', prev_rsvp: null, prev_starts_at: null },
      { session_id: 7, user_id: 'p1', prev_rsvp: null, prev_starts_at: null },
      { session_id: 8, user_id: 'org', prev_rsvp: null, prev_starts_at: null },
      { session_id: 8, user_id: 'p2', prev_rsvp: 'going', prev_starts_at: '2026-10-27T11:00:00.000Z' },
    ]);
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-context.test.ts tests/pg/import-d1.test.ts
```

期望：D1 **1 failed (1)**，`D1_ERROR: no such column: cancel_reason`；PG **2 failed | 8 passed (10)**：`session-context` 那条报列不存在，`import-d1` 新用例报 `ImportError: export has tables/columns this schema lacks: game_sessions.cancel_reason, game_sessions.cancelled_at, session_players.prev_rsvp, session_players.prev_starts_at`（这正是契约 §3.3 说的「D1 迁移了、PG 没迁移」时 preflight 的拒绝）。

- [ ] **Step 3：D1 迁移**

新建 `migrations/004_lobby.sql`：

```sql
-- ============================================================================
-- EDG 信誉分 — v5 P2-3：邀请上下文 + 取消理由
--
--   wrangler d1 execute edg-credit --local  --file=./migrations/004_lobby.sql
--   wrangler d1 execute edg-credit --remote --file=./migrations/004_lobby.sql
--   （npm run db:migrate4:local / db:migrate4:remote）
--
-- 全新部署请直接用 schema.sql（已含这四列），不要跑这个文件。
--
-- SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重复执行会对每条 ALTER 报
-- "duplicate column name" —— 这是预期的，代表迁移已经做过了。
-- PostgreSQL 的同一改动在 server/migrations/0007_lobby.sql。
-- ============================================================================

-- 改期时记下这个人对旧时间的回答和旧时间（只给本人看，/api/me/invites）。
-- 回答过的人被改期重置为 invited 时写入；他重新回答时清空。
ALTER TABLE session_players ADD COLUMN prev_rsvp      TEXT;   -- going | maybe | out
ALTER TABLE session_players ADD COLUMN prev_starts_at TEXT;   -- ISO 8601 UTC，同 starts_at

-- 组织者取消时写的理由（trim 后最多 80 字，可空）和取消时间（datetime('now') 形状）。
ALTER TABLE game_sessions ADD COLUMN cancel_reason TEXT;
ALTER TABLE game_sessions ADD COLUMN cancelled_at  TEXT;
```

- [ ] **Step 4：PG 迁移**

新建 `server/migrations/0007_lobby.sql`：

```sql
-- v5 P2-3: invitation context and cancel reasons. The same change as D1's
-- migrations/004_lobby.sql. Same conventions as 0001: TEXT timestamps
-- (prev_starts_at ISO like starts_at; cancelled_at in SQLite's shape).
--
-- No trigger changes: session_players_outbox only looks at rsvp, and
-- sessions_outbox's cancel branch runs on the status change that is written in
-- the same UPDATE as cancel_reason / cancelled_at. The cancel DM reads the
-- session when it is delivered, so the reason is simply there.

ALTER TABLE session_players ADD COLUMN IF NOT EXISTS prev_rsvp      text;
ALTER TABLE session_players ADD COLUMN IF NOT EXISTS prev_starts_at text;
ALTER TABLE game_sessions   ADD COLUMN IF NOT EXISTS cancel_reason  text;
ALTER TABLE game_sessions   ADD COLUMN IF NOT EXISTS cancelled_at   text;
```

- [ ] **Step 5：`schema.sql`（全新部署和 worker 测试用它）**

`game_sessions` 里，把

```sql
  settled_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
```

换成

```sql
  settled_by   TEXT,
  cancel_reason TEXT,                              -- 取消理由（可空，≤80 字）
  cancelled_at  TEXT,                              -- 取消时间，datetime('now') 形状
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
```

`session_players` 里，把

```sql
  record_id       INTEGER,                         -- case filed from this outcome
```

换成

```sql
  record_id       INTEGER,                         -- case filed from this outcome
  prev_rsvp       TEXT,                            -- 改期前的回答（going | maybe | out），重新回答时清空
  prev_starts_at  TEXT,                            -- 改期前的开始时间（ISO），同上
```

注释里不写 `;`（`tests/worker/setup.ts` 按 `;` 切语句，契约 §7.1）。列的物理位置和 004 迁移后的不同无妨：代码一律按列名读写。

- [ ] **Step 6：`package.json` 两个脚本**

在 `"db:migrate3:remote": …,` 那一行之后加：

```json
    "db:migrate4:local": "wrangler d1 execute edg-credit --local --file=./migrations/004_lobby.sql",
    "db:migrate4:remote": "wrangler d1 execute edg-credit --remote --file=./migrations/004_lobby.sql",
```

- [ ] **Step 7：跑测试，确认通过**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-context.test.ts tests/pg/import-d1.test.ts
```

期望：D1 **1 passed (1)**；PG **10 passed (10)**。

可选（本机有 `sqlite3` 时）：确认 004 能套在**旧** schema 上、重跑报的是预期的错误：

```bash
rm -f /tmp/p23-004.db
git show claude/p2-6-going-preview:schema.sql | sqlite3 /tmp/p23-004.db
sqlite3 /tmp/p23-004.db < migrations/004_lobby.sql
sqlite3 /tmp/p23-004.db "SELECT name FROM pragma_table_info('game_sessions') WHERE name LIKE 'cancel%'; SELECT name FROM pragma_table_info('session_players') WHERE name LIKE 'prev%';"
sqlite3 /tmp/p23-004.db < migrations/004_lobby.sql   # 期望：每条 ALTER 报 duplicate column name
rm -f /tmp/p23-004.db
```

期望：第三条输出 `cancel_reason`、`cancelled_at`、`prev_rsvp`、`prev_starts_at`；第四条报 `duplicate column name`（规划时实测如此）。

- [ ] **Step 8：提交**

```bash
git add migrations/004_lobby.sql server/migrations/0007_lobby.sql schema.sql package.json tests/worker/session-context.test.ts tests/pg/import-d1.test.ts
git commit -m "feat: 约局表加邀请上下文与取消理由四列（D1 004、PG 0007、schema.sql）"
```

---

### Task 2：取消可以带理由，每个 `SessionItem` 带 `cancel_reason`、`cancelled_at`

**Files:**
- Modify: `tests/worker/session-context.test.ts`（import 区加一行、末尾追加）
- Modify: `tests/worker/session-routes.test.ts`（import 区追加、末尾追加 P2-3 的 describe）
- Modify: `shared/attendance.ts`（末尾追加）、`worker/types.ts`、`worker/sessions.ts`、`worker/routes.ts`

- [ ] **Step 1：写失败的测试**

`tests/worker/session-context.test.ts`：在 `import { describe, expect, it } from 'vitest';` 之后加一行

```ts
import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';
```

文件末尾追加：

```ts
describe('cancelSession with a reason', () => {
  const SQLITE_NOW = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  it('keeps the reason, trimmed and cut to SESSION_CANCEL_REASON_MAX, and when it was cancelled', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
    const long = `  ${'加'.repeat(SESSION_CANCEL_REASON_MAX + 5)}  `;
    const out = await cancelSession(env.DB, org, session.id, long);
    expect(out.status).toBe('cancelled');
    expect(out.cancel_reason).toBe('加'.repeat(SESSION_CANCEL_REASON_MAX));
    expect(out.cancelled_at).toMatch(SQLITE_NOW);
    expect(await cancelColumns(session.id)).toEqual({ cancel_reason: out.cancel_reason, cancelled_at: out.cancelled_at });
  });

  it('stores no reason for none, a blank one, or one that is not text — and still cancels', async () => {
    const { org } = await cast();
    for (const raw of [undefined, null, '   \n ', 42, { text: '临时加班' }]) {
      const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
      const out = await cancelSession(env.DB, org, session.id, raw);
      expect(out.status, String(raw)).toBe('cancelled');
      expect(out.cancel_reason, String(raw)).toBeNull();
      expect(out.cancelled_at, String(raw)).toMatch(SQLITE_NOW);
    }
  });

  it('cancelling again changes nothing: the first reason and time stay', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
    const first = await cancelSession(env.DB, org, session.id, '临时加班，改天');
    const again = await cancelSession(env.DB, org, session.id, '换个理由');
    expect(again.cancel_reason).toBe('临时加班，改天');
    expect(again.cancelled_at).toBe(first.cancelled_at);
  });

  it('every SessionItem carries both fields: null while open, the reason once cancelled', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    const [open] = await listSessions(env.DB, 'upcoming', null);
    expect(open).toMatchObject({ id: session.id, cancel_reason: null, cancelled_at: null });
    expect((await listMyInvites(env.DB, a.id))[0]).toMatchObject({ cancel_reason: null, cancelled_at: null });

    await cancelSession(env.DB, org, session.id, '下雨');
    const [mine] = await listSessions(env.DB, 'mine', a.id);
    expect(mine).toMatchObject({ id: session.id, status: 'cancelled', cancel_reason: '下雨' });
    expect(mine.cancelled_at).toMatch(SQLITE_NOW);
    expect((await getSessionDetail(env.DB, session.id, null)).cancel_reason).toBe('下雨');
  });
});
```

`tests/worker/session-routes.test.ts`：在 import 区最后一行 `import { noAiEnv, seedUser } from './helpers';` 之后**追加**这三行（P2-1、P2-6 没有加 import，这三行里的名字都还没导入过，Task 0 Step 2 已核对）：

```ts
import { createSession, setRsvp, updateSession } from '../../worker/sessions';
import type { SessionItem } from '../../worker/types';
import { OFFSET_HOURS } from './helpers';
```

文件末尾追加（这是本 PR 在这个文件里唯一的 describe，Task 3、4 往里加用例）：

```ts
// --- P2-3 ---
describe('P2-3 over HTTP: cancel reasons, invite context, history', () => {
  const HOUR_MS = 3_600_000;
  const inHours = (hours: number): string => new Date(Date.now() + hours * HOUR_MS).toISOString();
  const SQLITE_NOW = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  it('POST …/cancel without a body still cancels (the web today), with no reason', async () => {
    const org = await seedUser({ id: 'org' });
    const session = await createSession(env.DB, org, { starts_at: inHours(3) }, OFFSET_HOURS);
    const res = await call(`/api/sessions/${session.id}/cancel`, { method: 'POST', headers: await asUser('org') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: SessionItem };
    expect(body.session).toMatchObject({ status: 'cancelled', cancel_reason: null });
    expect(body.session.cancelled_at).toMatch(SQLITE_NOW);
  });

  it('POST …/cancel {reason} keeps it and answers with it', async () => {
    const org = await seedUser({ id: 'org' });
    const session = await createSession(env.DB, org, { starts_at: inHours(3) }, OFFSET_HOURS);
    const res = await call(`/api/sessions/${session.id}/cancel`, {
      method: 'POST',
      headers: await asUser('org', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ reason: '  临时加班，改天  ' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { session: SessionItem }).session.cancel_reason).toBe('临时加班，改天');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
```

期望：**6 failed**（`cancelSession with a reason` 4 条、`P2-3 over HTTP` 2 条），其余（Task 1 的 1 条和上游 PR 在 `session-routes` 里的用例）通过。失败都是字段还不存在：`expected undefined to be …`、`… to match object { …, cancel_reason: null }`。（`SESSION_CANCEL_REASON_MAX` 还没导出，第一条里 `'加'.repeat(undefined)` 是空串，所以报的是 `expected undefined to be ''`。）

- [ ] **Step 3：`shared/attendance.ts` 末尾追加 P2-3 小节**（排在 `// --- P2-6 ---` 之后）

```ts
// --- P2-3 ---
/** A cancel reason, trimmed, is cut to this many characters. It goes into DMs and onto the session page. */
export const SESSION_CANCEL_REASON_MAX = 80;
/** Sessions per page of GET /api/sessions?scope=history. */
export const SESSION_HISTORY_PAGE = 20;
```

- [ ] **Step 4：`worker/types.ts`**

`interface SessionRow` 末尾，把

```ts
  settled_by: string | null;
  created_at: string;
}
```

换成

```ts
  settled_by: string | null;
  created_at: string;
  cancel_reason: string | null;
  cancelled_at: string | null;
}
```

`interface SessionItem` 末尾（P2-6 的 `going_preview` 之后），把

```ts
  going_preview: RecordActor[];
}
```

换成

```ts
  going_preview: RecordActor[];
  /** P2-3: the organizer's reason, trimmed and cut to SESSION_CANCEL_REASON_MAX; null when none (or not cancelled). */
  cancel_reason: string | null;
  /** P2-3: when it was cancelled, datetime('now') shape; null when not cancelled, or cancelled before P2-3. */
  cancelled_at: string | null;
}
```

- [ ] **Step 5：`worker/sessions.ts`**

顶部 `from '../shared/attendance'` 的 import 列表里，把

```ts
  SESSION_GAME_MAX,
```

换成

```ts
  SESSION_CANCEL_REASON_MAX,
  SESSION_GAME_MAX,
```

`toSessionItem` 的返回对象里（契约 §3：`settled_at` 之后），把

```ts
    settled_at: row.settled_at,
```

换成

```ts
    settled_at: row.settled_at,
    // `?? null`: a database not yet migrated (004 / 0007) has no such columns.
    cancel_reason: row.cancel_reason ?? null,
    cancelled_at: row.cancelled_at ?? null,
```

`cancelSession` 的签名，把

```ts
export async function cancelSession(
  db: D1Database,
  caller: User,
  id: number,
): Promise<SessionDetail> {
```

换成

```ts
export async function cancelSession(
  db: D1Database,
  caller: User,
  id: number,
  rawReason?: unknown,
): Promise<SessionDetail> {
```

同一函数里，把

```ts
  if (row.status === 'cancelled') return getSessionDetail(db, id, caller.id);
  const res = await db
    .prepare("UPDATE game_sessions SET status = 'cancelled' WHERE id = ? AND status = 'open'")
    .bind(id)
    .run();
```

换成

```ts
  if (row.status === 'cancelled') return getSessionDetail(db, id, caller.id);
  const reason = normalizeOptionalText(rawReason, SESSION_CANCEL_REASON_MAX);
  const res = await db
    .prepare(
      `UPDATE game_sessions SET status = 'cancelled', cancel_reason = ?, cancelled_at = datetime('now')
        WHERE id = ? AND status = 'open'`,
    )
    .bind(reason, id)
    .run();
```

（`normalizeOptionalText` 是文件里已有的函数，`game`、`note` 用的也是它：不是字符串 → null，trim 后为空 → null，否则截到 80。已取消时提前返回、不覆盖第一次的理由和时间；`settled` 的 400、并发时的 409 一条不改。）

- [ ] **Step 6：`worker/routes.ts` 的取消路由读 body**

`app.post('/api/sessions/:id/cancel'` 的处理函数里，把

```ts
    const caller = requireUser(c.get('user'));
    const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'));
```

换成

```ts
    const caller = requireUser(c.get('user'));
    // No body (the web today) reads as {}: no reason.
    const body = await readJsonBody(c.req.raw);
    const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'), body.reason);
```

（`readJsonBody` 已经在 import 区；空 body 时它返回 `{}`（`worker/http.ts` 的 `readJsonBody`），所以今天的前端——`organizer-actions.test.tsx:316` 锁着 `body: null`——照常工作。CSRF、READ_ONLY 中间件不变。）

- [ ] **Step 7：跑测试，确认通过**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
npm run typecheck
```

期望：两个引擎上 `session-context` **5 passed**、`session-routes` **10 passed**（P2-2 的 3 条 + P2-1 的 4 条 + P2-6 的 1 条 + 本 PR 2 条），两个文件合计 **15 passed (15)**；typecheck 通过。

- [ ] **Step 8：提交**

```bash
git add shared/attendance.ts worker/types.ts worker/sessions.ts worker/routes.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
git commit -m "feat: 取消约局可带理由，SessionItem 带 cancel_reason、cancelled_at"
```

---

### Task 3：改期记下 `prev_rsvp` / `prev_starts_at`，`/api/me/invites` 带 `invite_reason`

**Files:**
- Modify: `tests/worker/session-context.test.ts`（末尾追加）、`tests/worker/session-routes.test.ts`（改本 PR 自己的一行 import、P2-3 describe 里加一个用例）
- Modify: `worker/types.ts`、`worker/session-extras.ts`（import 区追加一行、末尾追加）、`worker/sessions.ts`

- [ ] **Step 1：写失败的测试**

`tests/worker/session-context.test.ts` 末尾追加：

```ts
describe('a move remembers what each person had said, and to which time', () => {
  it('writes prev_rsvp / prev_starts_at for those who had answered — not the invited, not the organizer', async () => {
    const { org, a, b, c, d } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id, b.id, c.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    await setRsvp(env.DB, d, session.id, 'out');

    await updateSession(env.DB, org, session.id, { starts_at: minuteFromNow(26) });

    const old = session.starts_at;
    expect(await contextRows(session.id)).toEqual([
      { user_id: 'a', rsvp: 'invited', prev_rsvp: 'going', prev_starts_at: old },
      { user_id: 'b', rsvp: 'invited', prev_rsvp: 'maybe', prev_starts_at: old },
      { user_id: 'c', rsvp: 'invited', prev_rsvp: null, prev_starts_at: null },
      { user_id: 'd', rsvp: 'invited', prev_rsvp: 'out', prev_starts_at: old },
      { user_id: 'org', rsvp: 'going', prev_rsvp: null, prev_starts_at: null },
    ]);
  });

  it('a second move keeps the time they actually answered', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await updateSession(env.DB, org, session.id, { starts_at: minuteFromNow(26) });
    await updateSession(env.DB, org, session.id, { starts_at: minuteFromNow(50) });
    const [row] = (await contextRows(session.id)).filter((r) => r.user_id === 'a');
    expect(row).toEqual({ user_id: 'a', rsvp: 'invited', prev_rsvp: 'going', prev_starts_at: session.starts_at });
  });

  it('answering again clears it; a change that is not a move writes none', async () => {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id, b.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'out');
    await updateSession(env.DB, org, session.id, { title: '只改名字', note: '老地方' });
    expect((await contextRows(session.id)).every((r) => r.prev_rsvp === null && r.prev_starts_at === null)).toBe(true);

    await updateSession(env.DB, org, session.id, { starts_at: minuteFromNow(26) });
    await setRsvp(env.DB, a, session.id, 'out');
    const rows = await contextRows(session.id);
    expect(rows.find((r) => r.user_id === 'a')).toEqual({ user_id: 'a', rsvp: 'out', prev_rsvp: null, prev_starts_at: null });
    expect(rows.find((r) => r.user_id === 'b')).toMatchObject({ rsvp: 'invited', prev_rsvp: 'out' });
  });
});

describe('/api/me/invites says why each invitation is there', () => {
  it("'new' for a first invitation, 'moved' with what they had said and the old time", async () => {
    const { org, a, c } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id, c.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'maybe');
    const later = minuteFromNow(26);
    await updateSession(env.DB, org, session.id, { starts_at: later });

    const [forA] = await listMyInvites(env.DB, a.id);
    expect(forA).toMatchObject({
      id: session.id,
      starts_at: later,
      my_rsvp: 'invited',
      invite_reason: 'moved',
      prev_rsvp: 'maybe',
      prev_starts_at: session.starts_at,
    });
    const [forC] = await listMyInvites(env.DB, c.id);
    expect(forC).toMatchObject({ id: session.id, invite_reason: 'new', prev_rsvp: null, prev_starts_at: null });
  });

  it('keeps the context out of everything but the person’s own invites', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await updateSession(env.DB, org, session.id, { starts_at: minuteFromNow(26) });
    const detail = await getSessionDetail(env.DB, session.id, a.id);
    const [listed] = await listSessions(env.DB, 'upcoming', a.id);
    for (const shown of [detail, listed, ...detail.players]) {
      expect(JSON.stringify(shown)).not.toMatch(/prev_rsvp|prev_starts_at|invite_reason/);
    }
  });
});
```

`tests/worker/session-routes.test.ts`：把 Task 2 加的那一行

```ts
import type { SessionItem } from '../../worker/types';
```

换成

```ts
import type { InvitedSessionItem, SessionItem } from '../../worker/types';
```

在 P2-3 的 describe 里、最后一个用例之后（文件最后一行 `});` 之前）插入：

```ts
  it('GET /api/me/invites carries invite_reason and what the caller had said', async () => {
    const org = await seedUser({ id: 'org' });
    const a = await seedUser({ id: 'a' });
    const session = await createSession(env.DB, org, { starts_at: inHours(3), invite: [a.id] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await updateSession(env.DB, org, session.id, { starts_at: inHours(26) });
    const res = await call('/api/me/invites', { headers: await asUser('a') });
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: InvitedSessionItem[] };
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ invite_reason: 'moved', prev_rsvp: 'going', prev_starts_at: session.starts_at });
  });
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
```

期望：**5 failed**：`a move remembers …` 3 条（`prev_rsvp` 全是 null，`toEqual` 不等）、`'new' for a first invitation, 'moved' …` 1 条、`GET /api/me/invites carries invite_reason …` 1 条（`invite_reason` 缺失）。`keeps the context out of everything …` 现在就通过（还没有任何上下文可漏），它在 Step 7 之后守住第 6 节第 4 条的隐私边界。

- [ ] **Step 3：`worker/types.ts`**

顶部 import，把

```ts
import type { Attendance, Rsvp, SessionStatus } from '../shared/attendance';
```

换成

```ts
import type { Attendance, Rsvp, SelfRsvp, SessionStatus } from '../shared/attendance';
```

`interface SessionPlayerJoinRow` 里，把

```ts
  record_id: number | null;
  u_username: string;
```

换成

```ts
  record_id: number | null;
  prev_rsvp: string | null;
  prev_starts_at: string | null;
  u_username: string;
```

（`SessionPlayer` / `toSessionPlayer` 不加：上下文只经 `/api/me/invites` 给本人。）

在

```ts
export interface SessionDetail extends SessionItem {
  players: SessionPlayer[];
}
```

之后插入 P2-3 的四个类型（契约 §4.2；`AttendanceSummary`、`HistorySessionItem` 在 Task 4 用）：

```ts
// --- P2-3 ---
/** Roll-call outcomes of one session, by kind: all five keys, zeros included. */
export type AttendanceSummary = Record<Attendance, number>;

/** One row of GET /api/sessions?scope=history. */
export interface HistorySessionItem extends SessionItem {
  attendance_summary: AttendanceSummary;
}

export type InviteReason = 'new' | 'moved';

/** One row of GET /api/me/invites. The context is the caller's own: never shown to anyone else. */
export interface InvitedSessionItem extends SessionItem {
  /** 'moved' when prev_starts_at is set: they had answered, then the time changed. */
  invite_reason: InviteReason;
  /** What they had said to the old time. */
  prev_rsvp: SelfRsvp | null;
  /** The old time (ISO), as they answered it. */
  prev_starts_at: string | null;
}
```

- [ ] **Step 4：`worker/session-extras.ts`**

在 import 区最后一行之后**追加**一行（不改 P2-6 的 import 行）：

```ts
import { isSelfRsvp, type SelfRsvp } from '../shared/attendance';
```

文件末尾追加：

```ts
// --- P2-3 ---

/** What a move left behind for one person: what they had said, and to which time. */
export interface InviteContext {
  prev_rsvp: SelfRsvp | null;
  prev_starts_at: string | null;
}

/** The caller's own context in each of `sessionIds` (rows they are not in are simply absent). */
export async function inviteContexts(
  db: D1Database,
  callerId: string,
  sessionIds: number[],
): Promise<Map<number, InviteContext>> {
  if (sessionIds.length === 0) return new Map();
  // holes() is P2-6's private helper in this file: placeholders from the count only.
  const rows = await db
    .prepare(
      `SELECT session_id, prev_rsvp, prev_starts_at FROM session_players
        WHERE user_id = ? AND session_id IN (${holes(sessionIds.length)})`,
    )
    .bind(callerId, ...sessionIds)
    .all<{ session_id: number; prev_rsvp: string | null; prev_starts_at: string | null }>();
  return new Map(
    rows.results.map((r) => [
      r.session_id,
      {
        prev_rsvp: r.prev_rsvp !== null && isSelfRsvp(r.prev_rsvp) ? r.prev_rsvp : null,
        prev_starts_at: r.prev_starts_at,
      },
    ]),
  );
}
```

- [ ] **Step 5：`worker/sessions.ts`**

`import type { … } from './types'` 列表里，把

```ts
  Env,
```

换成

```ts
  Env,
  InviteReason,
  InvitedSessionItem,
```

import 区末尾（P2-6 的 `goingPreviews` import 之后）追加一行：

```ts
import { inviteContexts } from './session-extras';
```

`updateSession` 里改期的重置（锚点 `UPDATE session_players SET rsvp = 'invited', rsvp_at = datetime('now')`），把

```ts
      // no too (a no to 20:00 is not a no to 23:00).
      statements.push(
        db
          .prepare(
            `UPDATE session_players SET rsvp = 'invited', rsvp_at = datetime('now')
              WHERE session_id = ? AND user_id <> ? AND rsvp IN ('going', 'maybe', 'out')`,
          )
          .bind(id, row.organizer_id),
```

换成（`prev_rsvp = rsvp` 右边读的是更新前的值，SQLite 和 PostgreSQL 都是；`WHERE … rsvp IN ('going','maybe','out')` 本来就排除了还是 `invited` 的行和组织者，所以连改两次时保留的是他当时回答的那个时间，不需要 CASE，契约 §10.3）

```ts
      // no too (a no to 20:00 is not a no to 23:00). What they had said, and to
      // which time, stays for their own /api/me/invites (P2-3). Rows still
      // 'invited' are not touched, so a second move keeps the time they answered.
      statements.push(
        db
          .prepare(
            `UPDATE session_players
                SET rsvp = 'invited', rsvp_at = datetime('now'), prev_rsvp = rsvp, prev_starts_at = ?
              WHERE session_id = ? AND user_id <> ? AND rsvp IN ('going', 'maybe', 'out')`,
          )
          .bind(row.starts_at, id, row.organizer_id),
```

`setRsvp` 的 upsert（锚点 `rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at`），把

```ts
           rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at`,
```

换成

```ts
           rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at, prev_rsvp = NULL, prev_starts_at = NULL`,
```

`listMyInvites` 的返回类型，把

```ts
  callerId: string,
): Promise<SessionItem[]> {
```

换成（`listSessions` 的签名是 `callerId: string | null,` 加 `limit`，不会误中）

```ts
  callerId: string,
): Promise<InvitedSessionItem[]> {
```

同一函数里，`.all<SessionJoinRow>();` 之后、函数结尾 `}` 之前是 P2-6 写的两行（锚点，原文，只出现 1 次）：

```ts
  const previews = await goingPreviews(db, rows.results.map((r) => r.id));
  return rows.results.map((r) => toSessionItem(r, 'invited', previews.get(r.id) ?? []));
```

整段换成：

```ts
  const ids = rows.results.map((r) => r.id);
  const previews = await goingPreviews(db, ids);
  const contexts = await inviteContexts(db, callerId, ids);
  return rows.results.map((r) => {
    const ctx = contexts.get(r.id) ?? { prev_rsvp: null, prev_starts_at: null };
    const reason: InviteReason = ctx.prev_starts_at === null ? 'new' : 'moved';
    return { ...toSessionItem(r, 'invited', previews.get(r.id) ?? []), invite_reason: reason, ...ctx };
  });
```

- [ ] **Step 6：跑测试，确认通过（含被锁住的改期用例）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts tests/worker/session-update.test.ts tests/worker/invites.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts tests/worker/session-update.test.ts
npm run typecheck
```

期望：全过。`session-context` **10 passed**；`session-update.test.ts` 原有用例原样通过（契约 §7.1：`:239`、`:249-250`、`:383` 的整行 `toEqual`，`:650-690` 的改期名单——`playerRows` 只选旧列）。合成副本实测：D1 四个文件 **99 passed + 1 todo**，PG 三个文件 **75 passed + 1 todo**。

- [ ] **Step 7：提交**

```bash
git add worker/types.ts worker/session-extras.ts worker/sessions.ts tests/worker/session-context.test.ts tests/worker/session-routes.test.ts
git commit -m "feat: 改期记下 prev_rsvp/prev_starts_at，/api/me/invites 带 invite_reason"
```

---

### Task 4：`GET /api/sessions?scope=history`

**Files:**
- Create: `tests/worker/session-history.test.ts`
- Modify: `tests/worker/session-routes.test.ts`（改本 PR 自己的一行 import、P2-3 describe 里加一个用例）
- Modify: `worker/session-extras.ts`（import 区再追加、末尾追加）、`worker/sessions.ts`、`worker/routes.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/worker/session-history.test.ts`：

```ts
// P2-3 (spec §3.4, §8 B2-3 ④): GET /api/sessions?scope=history — sessions that
// have started, cancelled ones included, newest first, each with its roll-call
// counts, paged by `before=<id>`. Runs on D1 here and, unchanged, on PostgreSQL.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SESSION_HISTORY_PAGE, type Attendance, type Rsvp, type SessionStatus } from '../../shared/attendance';
import { createSession, listSessionHistory, listSessions } from '../../worker/sessions';
import { OFFSET_HOURS, seedUser } from './helpers';

const HOUR_MS = 3_600_000;

/** Whole-minute ISO instant `hours` from now (negative: in the past). */
function hoursFromNow(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * HOUR_MS) / 60_000) * 60_000).toISOString();
}

interface PastPlayer {
  rsvp: Rsvp;
  attendance?: Attendance;
}

interface PastSession {
  startsAt: string;
  status?: SessionStatus;
  cancelReason?: string;
  /** user id → their answer and (optionally) what roll call said. The organizer is always going. */
  players?: Record<string, PastPlayer>;
}

/** A session that already started — createSession refuses those, so it is written directly. */
async function pastSession(organizerId: string, spec: PastSession): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO game_sessions (organizer_id, title, starts_at, status, cancel_reason)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(organizerId, `局 ${spec.startsAt}`, spec.startsAt, spec.status ?? 'settled', spec.cancelReason ?? null)
    .run();
  const id = Number(res.meta.last_row_id);
  const players: Record<string, PastPlayer> = { [organizerId]: { rsvp: 'going' }, ...spec.players };
  for (const [userId, p] of Object.entries(players)) {
    await env.DB.prepare('INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, ?, ?)')
      .bind(id, userId, p.rsvp, p.attendance ?? null)
      .run();
  }
  return id;
}

const ZEROS = { on_time: 0, late: 0, no_show: 0, left_early: 0, excused: 0 };

describe('listSessionHistory', () => {
  it('lists started sessions newest first — cancelled ones too — and none still ahead', async () => {
    const org = await seedUser({ id: 'org' });
    const ahead = await createSession(env.DB, org, { starts_at: hoursFromNow(3) }, OFFSET_HOURS);
    const settled = await pastSession('org', { startsAt: hoursFromNow(-30) });
    const cancelled = await pastSession('org', { startsAt: hoursFromNow(-5), status: 'cancelled', cancelReason: '临时加班，改天' });
    const underWay = await pastSession('org', { startsAt: hoursFromNow(-1), status: 'open' });

    const history = await listSessionHistory(env.DB, null, null);
    expect(history.map((s) => s.id)).toEqual([underWay, cancelled, settled]);
    expect(history.map((s) => s.id)).not.toContain(ahead.id);
    expect(history[1]).toMatchObject({ status: 'cancelled', cancel_reason: '临时加班，改天' });
  });

  it('counts roll call by kind: all five keys, zeros included', async () => {
    await seedUser({ id: 'org' });
    for (const id of ['a', 'b', 'c', 'd']) await seedUser({ id });
    const called = await pastSession('org', {
      startsAt: hoursFromNow(-30),
      players: {
        a: { rsvp: 'going', attendance: 'on_time' },
        b: { rsvp: 'going', attendance: 'late' },
        c: { rsvp: 'going', attendance: 'no_show' },
        d: { rsvp: 'maybe' },
      },
    });
    await env.DB.prepare("UPDATE session_players SET attendance = 'on_time' WHERE session_id = ? AND user_id = 'org'")
      .bind(called)
      .run();
    const uncalled = await pastSession('org', { startsAt: hoursFromNow(-2), status: 'open', players: { a: { rsvp: 'going' } } });

    const history = await listSessionHistory(env.DB, null, null);
    const byId = new Map(history.map((s) => [s.id, s.attendance_summary]));
    expect(byId.get(called)).toEqual({ ...ZEROS, on_time: 2, late: 1, no_show: 1 });
    expect(byId.get(uncalled)).toEqual(ZEROS);
  });

  it(`pages by before=<id>, ${SESSION_HISTORY_PAGE} a page: ties on one instant broken by id, nothing twice`, async () => {
    await seedUser({ id: 'org' });
    const tie = hoursFromNow(-150);
    const ids: number[] = [];
    for (let i = 0; i < SESSION_HISTORY_PAGE + 3; i += 1) {
      // Two oldest, then three sharing one start, then the rest: newest first,
      // the first page ends inside the tie.
      const startsAt = i < 2 ? hoursFromNow(-200 + i) : i < 5 ? tie : hoursFromNow(-100 + i);
      ids.push(await pastSession('org', { startsAt }));
    }

    const first = await listSessionHistory(env.DB, null, null);
    expect(first).toHaveLength(SESSION_HISTORY_PAGE);
    expect(first.slice(-2).map((s) => s.starts_at)).toEqual([tie, tie]);
    const second = await listSessionHistory(env.DB, null, first[first.length - 1].id);
    const seen = [...first, ...second].map((s) => s.id);
    expect(second).toHaveLength(3);
    expect(new Set(seen).size).toBe(ids.length);
    expect([...seen].sort((x, y) => x - y)).toEqual(ids);
    const order = [...first, ...second].map((s) => [s.starts_at, s.id] as const);
    for (let i = 1; i < order.length; i += 1) {
      const [prevAt, prevId] = order[i - 1];
      const [at, id] = order[i];
      expect(prevAt > at || (prevAt === at && prevId > id), `${prevAt}#${prevId} before ${at}#${id}`).toBe(true);
    }
    expect(await listSessionHistory(env.DB, null, second[second.length - 1].id)).toEqual([]);
  });

  it('gives an empty page for a cursor that does not exist', async () => {
    await seedUser({ id: 'org' });
    await pastSession('org', { startsAt: hoursFromNow(-3) });
    expect(await listSessionHistory(env.DB, null, 999_999)).toEqual([]);
  });

  it('carries the caller’s own answer, going_preview and the cancel fields like every list', async () => {
    await seedUser({ id: 'org' });
    await seedUser({ id: 'a' });
    const id = await pastSession('org', { startsAt: hoursFromNow(-3), players: { a: { rsvp: 'maybe' } } });
    const [asA] = await listSessionHistory(env.DB, 'a', null);
    expect(asA).toMatchObject({ id, my_rsvp: 'maybe', cancel_reason: null, cancelled_at: null });
    expect(asA.going_preview.map((p) => p.id)).toEqual(['org']);
    const [asNobody] = await listSessionHistory(env.DB, null, null);
    expect(asNobody.my_rsvp).toBeNull();
  });

  it('leaves scope=past as it was: no cancelled sessions, no attendance_summary', async () => {
    await seedUser({ id: 'org' });
    const settled = await pastSession('org', { startsAt: hoursFromNow(-30) });
    await pastSession('org', { startsAt: hoursFromNow(-5), status: 'cancelled' });
    const past = await listSessions(env.DB, 'past', null);
    expect(past.map((s) => s.id)).toEqual([settled]);
    expect(past[0]).not.toHaveProperty('attendance_summary');
  });
});
```

`tests/worker/session-routes.test.ts`：把 Task 3 的

```ts
import type { InvitedSessionItem, SessionItem } from '../../worker/types';
```

换成

```ts
import type { HistorySessionItem, InvitedSessionItem, SessionItem } from '../../worker/types';
```

在 P2-3 的 describe 里、最后一个用例之后（文件最后一行 `});` 之前）插入：

```ts
  it('GET /api/sessions?scope=history is public, pages with before=<id>, and refuses a bad cursor', async () => {
    await seedUser({ id: 'org' });
    const inserted = await env.DB.prepare(
      "INSERT INTO game_sessions (organizer_id, title, starts_at, status, cancel_reason) VALUES ('org', '昨晚', ?, 'cancelled', '下雨')",
    )
      .bind(inHours(-3))
      .run();
    const id = Number(inserted.meta.last_row_id);

    const res = await call('/api/sessions?scope=history');
    expect(res.status).toBe(200);
    const { sessions } = (await res.json()) as { sessions: HistorySessionItem[] };
    expect(sessions.map((s) => [s.id, s.status, s.cancel_reason])).toEqual([[id, 'cancelled', '下雨']]);
    expect(sessions[0].attendance_summary).toEqual({ on_time: 0, late: 0, no_show: 0, left_early: 0, excused: 0 });

    const next = await call(`/api/sessions?scope=history&before=${id}`);
    expect(await next.json()).toEqual({ sessions: [] });
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const refused = await call(`/api/sessions?scope=history&before=${bad}`);
      expect(refused.status, bad).toBe(400);
      expect(await refused.json()).toEqual({ error: '无效的约局 ID' });
    }
    // Other scopes ignore `before`, as before.
    expect((await call('/api/sessions?scope=past&before=abc')).status).toBe(200);
  });
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-history.test.ts tests/worker/session-routes.test.ts
```

期望：**6 failed**：`session-history` 5 条 `TypeError: (0 , listSessionHistory) is not a function`；`session-routes` 的 history 用例 `expected [] to deeply equal [ [ 1, 'cancelled', '下雨' ] ]`（旧路由把未知 scope 当 `upcoming`，契约 §7.4 第 1 条）。`leaves scope=past as it was` 现在就通过（回归锁）。

- [ ] **Step 3：`worker/session-extras.ts`**

import 区再追加两行：

```ts
import { ATTENDANCES, isAttendance } from '../shared/attendance';
import type { AttendanceSummary } from './types';
```

文件末尾追加：

```ts
/** A session nobody has been roll-called in: all five kinds, zero each. */
export const NO_ATTENDANCE: Readonly<AttendanceSummary> = Object.freeze(
  Object.fromEntries(ATTENDANCES.map((a) => [a, 0])) as AttendanceSummary,
);

/** Roll-call counts per session: every id gets all five keys, zeros included. One GROUP BY for the page. */
export async function attendanceSummaries(
  db: D1Database,
  sessionIds: number[],
): Promise<Map<number, AttendanceSummary>> {
  const out = new Map<number, AttendanceSummary>(sessionIds.map((id) => [id, { ...NO_ATTENDANCE }]));
  if (sessionIds.length === 0) return out;
  const rows = await db
    .prepare(
      `SELECT session_id, attendance, COUNT(*) AS n FROM session_players
        WHERE session_id IN (${holes(sessionIds.length)}) AND attendance IS NOT NULL
        GROUP BY session_id, attendance`,
    )
    .bind(...sessionIds)
    .all<{ session_id: number; attendance: string; n: number }>();
  for (const r of rows.results) {
    const before = out.get(r.session_id);
    if (before && isAttendance(r.attendance)) out.set(r.session_id, { ...before, [r.attendance]: Number(r.n) });
  }
  return out;
}
```

（`COUNT(*)` 在 PG 是 int8，适配器已转成 number，`Number(r.n)` 只是兜底；`ORDER BY`/`GROUP BY` 不引用别名，契约 §3.4。占位符用 P2-6 在本文件里的私有 `holes()`，不要再声明同名的局部变量——那会遮住它。）

- [ ] **Step 4：`worker/sessions.ts`**

`from '../shared/attendance'` 的 import 列表里，把

```ts
  SESSION_GAME_MAX,
```

换成

```ts
  SESSION_GAME_MAX,
  SESSION_HISTORY_PAGE,
```

`import type { … } from './types'` 列表里，把

```ts
  Env,
  InviteReason,
```

换成

```ts
  Env,
  HistorySessionItem,
  InviteReason,
```

把 Task 3 加的

```ts
import { inviteContexts } from './session-extras';
```

换成

```ts
import { NO_ATTENDANCE, attendanceSummaries, inviteContexts } from './session-extras';
```

在 `listMyInvites` 之后、`export async function updateSession(` 之前插入（空一行隔开）：

```ts
/**
 * GET /api/sessions?scope=history: sessions that have started, cancelled ones
 * included (scope=past leaves those out), newest first, SESSION_HISTORY_PAGE a
 * page. `before` is the last id of the previous page; an unknown one gives [].
 */
export async function listSessionHistory(
  db: D1Database,
  callerId: string | null,
  before: number | null,
): Promise<HistorySessionItem[]> {
  // ISO "now": starts_at is ISO (see listSessions).
  const binds: unknown[] = [new Date().toISOString()];
  let cursor = '';
  if (before !== null) {
    const at = await db
      .prepare('SELECT id, starts_at FROM game_sessions WHERE id = ?')
      .bind(before)
      .first<{ id: number; starts_at: string }>();
    if (!at) return [];
    // (starts_at, id) < (cursor) spelled out: no row values, portable to both engines.
    cursor = 'AND (g.starts_at < ? OR (g.starts_at = ? AND g.id < ?))';
    binds.push(at.starts_at, at.starts_at, at.id);
  }
  const rows = await db
    .prepare(`${SESSION_SELECT} WHERE g.starts_at < ? ${cursor} ORDER BY g.starts_at DESC, g.id DESC LIMIT ?`)
    .bind(...binds, SESSION_HISTORY_PAGE)
    .all<SessionJoinRow>();
  const ids = rows.results.map((r) => r.id);
  const mine = await myRsvpMap(db, callerId, ids);
  const previews = await goingPreviews(db, ids);
  const summaries = await attendanceSummaries(db, ids);
  return rows.results.map((r) => ({
    ...toSessionItem(r, mine.get(r.id) ?? null, previews.get(r.id) ?? []),
    attendance_summary: summaries.get(r.id) ?? { ...NO_ATTENDANCE },
  }));
}
```

（游标展开成 `starts_at < ? OR (starts_at = ? AND id < ?)`，不用行值比较；「现在」用 `new Date().toISOString()` 绑定，因为 `starts_at` 是 ISO，契约 §3.4。路由仍不读 `limit`。）

- [ ] **Step 5：`worker/routes.ts`**

`from './sessions'` 的 import 列表里，把

```ts
  listMyInvites,
  listSessions,
```

换成

```ts
  listMyInvites,
  listSessionHistory,
  listSessions,
```

`app.get('/api/sessions'` 的处理函数开头，把

```ts
  app.get('/api/sessions', async (c) => {
    const caller = c.get('user');
    const raw = c.req.query('scope');
```

换成

```ts
  app.get('/api/sessions', async (c) => {
    const caller = c.get('user');
    const raw = c.req.query('scope');
    if (raw === 'history') {
      // P2-3: started sessions, cancelled ones too, paged by before=<id>.
      const before = c.req.query('before');
      const cursor = before === undefined ? null : parseId(before, '约局');
      return c.json({ sessions: await listSessionHistory(c.env.DB, caller?.id ?? null, cursor) });
    }
```

（`before` 不是正的安全整数 → `parseId` 抛 400「无效的约局 ID」；其他 scope 照旧、忽略 `before`；history 公开，和 `past` 一样。）

- [ ] **Step 6：跑测试，确认通过**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-history.test.ts tests/worker/session-routes.test.ts tests/worker/sessions.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-history.test.ts tests/worker/session-routes.test.ts tests/worker/sessions.test.ts
npm run typecheck
```

期望：全过；`session-history` **6 passed**，`sessions.test.ts`（含 `listSessions` 的 `past`/`mine` 用例）原样通过。合成副本实测：两个引擎都是 **3 个文件 58 passed**（`session-history` 6 + `session-routes` 12 + `sessions` 40）。

- [ ] **Step 7：提交**

```bash
git add worker/session-extras.ts worker/sessions.ts worker/routes.ts tests/worker/session-history.test.ts tests/worker/session-routes.test.ts
git commit -m "feat: GET /api/sessions?scope=history（含已取消、before 游标、attendance_summary）"
```

---

### Task 5：前端类型与 `src/api.ts`

**Files:**
- Create: `tests/dom/session-api.test.tsx`
- Modify: `src/types.ts`、`src/api.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/dom/session-api.test.tsx`（dom 套件只收 `*.test.tsx`；`fetch` 的打桩照 `tests/dom/organizer-actions.test.tsx` 的 `mockFetch`）：

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSession, getMyInvites, getSessionHistory } from '../../src/api';
import type { HistorySessionItem, SessionItem } from '../../src/types';

// P2-3: the client side of a cancel reason, scope=history and the invite context.

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Every request answers `reply`; returns what was asked. */
function mockFetch(reply: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const call: Call = {
        method: init?.method ?? 'GET',
        path: url.replace(/^https?:\/\/[^/]+/, ''),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      return Promise.resolve(reply(call));
    }),
  );
  return calls;
}

const ITEM: SessionItem = {
  id: 7,
  organizer: { id: 'org', username: '阿杰', avatar_url: null },
  title: '周二 20:00 开黑',
  game: '云顶',
  starts_at: '2026-10-27T12:00:00.000Z',
  duration_min: null,
  capacity: null,
  note: null,
  status: 'cancelled',
  settled_at: null,
  created_at: '2026-10-26 01:00:00',
  counts: { invited: 0, going: 1, maybe: 0, out: 0 },
  my_rsvp: null,
  cancel_reason: '临时加班，改天',
  cancelled_at: '2026-10-27 08:00:00',
};
const HISTORY: HistorySessionItem = {
  ...ITEM,
  attendance_summary: { on_time: 0, late: 0, no_show: 0, left_early: 0, excused: 0 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cancelSession', () => {
  it('sends no body without a reason (as today), and { reason } with one', async () => {
    const calls = mockFetch(() => json(200, { session: { ...ITEM, players: [] } }));
    await cancelSession(7);
    await cancelSession(7, '临时加班，改天');
    expect(calls).toEqual([
      { method: 'POST', path: '/api/sessions/7/cancel', body: null },
      { method: 'POST', path: '/api/sessions/7/cancel', body: { reason: '临时加班，改天' } },
    ]);
  });
});

describe('getSessionHistory', () => {
  it('asks for scope=history, with before=<id> for the next page', async () => {
    const calls = mockFetch(() => json(200, { sessions: [HISTORY] }));
    expect(await getSessionHistory()).toEqual([HISTORY]);
    expect(await getSessionHistory(7)).toEqual([HISTORY]);
    expect(calls.map((c) => c.path)).toEqual(['/api/sessions?scope=history', '/api/sessions?scope=history&before=7']);
  });

  it('is undefined from an API without scope=history (it answers as if upcoming)', async () => {
    mockFetch(() => json(200, { sessions: [ITEM] }));
    expect(await getSessionHistory()).toBeUndefined();
  });

  it('is an empty page when there is nothing more', async () => {
    mockFetch(() => json(200, { sessions: [] }));
    expect(await getSessionHistory(3)).toEqual([]);
  });
});

describe('getMyInvites', () => {
  it('passes the invite context through, and still reads an older API without it', async () => {
    const moved = { ...ITEM, status: 'open', invite_reason: 'moved', prev_rsvp: 'going', prev_starts_at: '2026-10-27T11:00:00.000Z' };
    mockFetch(() => json(200, { sessions: [moved, ITEM] }));
    const { sessions } = await getMyInvites();
    expect(sessions[0]).toMatchObject({ invite_reason: 'moved', prev_rsvp: 'going' });
    expect(sessions[1].invite_reason ?? 'new').toBe('new');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/session-api.test.tsx
npm run typecheck
```

期望：**4 failed | 1 passed**：`cancelSession` 那条第二次请求的 body 是 `null`；`getSessionHistory` 三条 `TypeError: (0 , getSessionHistory) is not a function`。`getMyInvites` 那条运行时已通过（JSON 原样透传），它的红在类型上：typecheck 报 `tests/dom/session-api.test.tsx` 的 5 个错误（没有 `getSessionHistory`、`HistorySessionItem` 导出，`cancel_reason` 不在 `SessionItem` 上，`cancelSession` 只收 1 个参数，`invite_reason` 不在 `SessionItem` 上）。

- [ ] **Step 3：`src/types.ts`**

顶部 import，把

```ts
import type { Attendance, Rsvp, SessionStatus } from '@shared/attendance';
```

换成

```ts
import type { Attendance, Rsvp, SelfRsvp, SessionStatus } from '@shared/attendance';
```

`interface SessionItem` 末尾（P2-6 的 `going_preview?` 之后），把

```ts
  going_preview?: UserRef[];
}
```

换成（新字段在前端一律可选：旧后端和现有 fixture 都没有，契约 §4.2）

```ts
  going_preview?: UserRef[];
  /** P2-3: the organizer's cancel reason (plain text). Absent from an older API: no reason. */
  cancel_reason?: string | null;
  /** P2-3: when it was cancelled (sqlite datetime shape). */
  cancelled_at?: string | null;
}
```

在

```ts
export interface SessionDetail extends SessionItem {
  players: SessionPlayer[];
}
```

之后插入：

```ts
// P2-3
export type AttendanceSummary = Record<Attendance, number>;

/** One row of GET /api/sessions?scope=history. */
export interface HistorySessionItem extends SessionItem {
  attendance_summary: AttendanceSummary;
}

export type InviteReason = 'new' | 'moved';

/** One row of GET /api/me/invites. Missing fields (an older API) read as a new invitation. */
export interface InvitedSessionItem extends SessionItem {
  invite_reason?: InviteReason;
  prev_rsvp?: SelfRsvp | null;
  prev_starts_at?: string | null;
}

export interface InvitesResponse {
  sessions: InvitedSessionItem[];
}
```

- [ ] **Step 4：`src/api.ts`**

顶部 `import type { … } from './types'` 列表里（中间三行是 P2-2 加的 `InvitableResponse`、`InvitableUser` 和 P2-1 加的 `InviteResponse`，原样保留），把

```ts
  FileCasesResponse,
  InvitableResponse,
  InvitableUser,
  InviteResponse,
  LeaderboardResponse,
```

换成（保持字母序：`HistorySessionItem` 在 `Invitable…` 之前，`InvitesResponse` 紧跟 `InviteResponse`）

```ts
  FileCasesResponse,
  HistorySessionItem,
  InvitableResponse,
  InvitableUser,
  InviteResponse,
  InvitesResponse,
  LeaderboardResponse,
```

再把

```ts
  SessionDetailResponse,
  SessionsResponse,
```

换成

```ts
  SessionDetailResponse,
  SessionItem,
  SessionsResponse,
```

把

```ts
export function cancelSession(id: number): Promise<{ session: SessionDetail }> {
  return post<{ session: SessionDetail }>(`/api/sessions/${id}/cancel`);
}
```

换成

```ts
/** `reason` omitted: no body at all, exactly as before P2-3. */
export function cancelSession(id: number, reason?: string): Promise<{ session: SessionDetail }> {
  const path = `/api/sessions/${id}/cancel`;
  return reason === undefined
    ? post<{ session: SessionDetail }>(path)
    : post<{ session: SessionDetail }>(path, { reason });
}
```

把

```ts
/** Sessions the caller was invited to and has not answered. Drives the banner. */
export function getMyInvites(): Promise<SessionsResponse> {
  return request<SessionsResponse>('/api/me/invites');
}
```

换成

```ts
/** Sessions the caller was invited to and has not answered. Drives the banner. */
export function getMyInvites(): Promise<InvitesResponse> {
  return request<InvitesResponse>('/api/me/invites');
}

type MaybeHistoryItem = SessionItem & { attendance_summary?: HistorySessionItem['attendance_summary'] };

function isHistoryItem(item: MaybeHistoryItem): item is HistorySessionItem {
  return typeof item.attendance_summary === 'object' && item.attendance_summary !== null;
}

/**
 * P2-3: sessions that started, cancelled ones too, newest first; `before` = the
 * last id of the previous page (fewer than a full page = no more). undefined
 * from an API without scope=history: it reads an unknown scope as 'upcoming'
 * and answers 200, so the sign is items without attendance_summary.
 */
export async function getSessionHistory(before?: number): Promise<HistorySessionItem[] | undefined> {
  const cursor = before === undefined ? '' : `&before=${before}`;
  const { sessions } = await request<{ sessions: MaybeHistoryItem[] }>(`/api/sessions?scope=history${cursor}`);
  return sessions.every(isHistoryItem) ? sessions : undefined;
}
```

（`getSessions` 的签名和 URL 不改：`tests/dom/app-refresh.test.tsx:145` 锁首屏 URL 集合。旧后端把 `scope=history` 当 `upcoming` 返回 200，所以「不支持」的信号是条目缺 `attendance_summary`，契约 §4.5、§7.4 第 1 条；P3-6 的历史页照这个约定用。）

- [ ] **Step 5：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/session-api.test.tsx tests/dom/organizer-actions.test.tsx
npm run typecheck
```

期望：**25 passed**（新文件 5 + `organizer-actions` 20，其中 `:316` 的「一个 POST、`body: null`」原样通过）；typecheck 通过（`src/lib/coreData.ts` 里调用 `getMyInvites()` 的地方拿到的是 `SessionItem` 的子类型，照常编译）。

- [ ] **Step 6：提交**

```bash
git add src/types.ts src/api.ts tests/dom/session-api.test.tsx
git commit -m "feat: 前端类型与 api.ts：cancelSession 可带理由、getSessionHistory、getMyInvites 带邀请上下文"
```

---

### Task 6：bot 的取消私信带上理由

**Files:**
- Modify: `server/test/session-render.test.ts`（import 区加一行、末尾追加）、`tests/pg/session-cards.test.ts`（末尾追加）
- Modify: `server/src/discord/sessions.ts`（只改 `'dm.session.cancelled'` 分支和一行 import）

- [ ] **Step 1：写失败的测试**

`server/test/session-render.test.ts`：`:2` 的 import 行不动（P2-4 也不动它），在

```ts
import type { SessionDetail } from '../../worker/types';
```

之后加一行

```ts
import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';
```

文件末尾追加（`session()`、`EVIL` 是文件里已有的；`1793016000` 是 fixture 的 `starts_at` `2026-10-26T12:00:00.000Z` 的秒数）：

```ts
// --- P2-3 ---
describe('the cancel DM', () => {
  const BEFORE_P2_3 = '原定 <t:1793016000:F>（<t:1793016000:R>），由 组织者 取消。';
  const descriptionOf = (s: SessionDetail): string =>
    renderSessionDm('dm.session.cancelled', s, 'https://score.example').embeds[0].description ?? '';

  it('without a reason reads exactly as before', () => {
    expect(descriptionOf(session({ status: 'cancelled' }))).toBe(BEFORE_P2_3);
    expect(descriptionOf(session({ status: 'cancelled', cancel_reason: null, cancelled_at: null }))).toBe(BEFORE_P2_3);
  });

  it('with a reason adds it on its own line, defused and cut to SESSION_CANCEL_REASON_MAX', () => {
    const plain = descriptionOf(session({ status: 'cancelled', cancel_reason: '临时加班，改天' }));
    expect(plain).toBe(`${BEFORE_P2_3}\n理由：临时加班，改天`);

    const evil = descriptionOf(session({ status: 'cancelled', cancel_reason: `${EVIL}\n第二行` }));
    const reason = evil.split('\n理由：')[1] ?? '';
    expect(reason).toContain('报名');
    expect(reason).not.toContain('](');
    expect(reason).not.toMatch(/@everyone/);
    expect(reason).not.toContain('<@');
    expect(reason).not.toContain('\n');

    const long = descriptionOf(session({ status: 'cancelled', cancel_reason: '加'.repeat(SESSION_CANCEL_REASON_MAX + 20) }));
    expect([...(long.split('\n理由：')[1] ?? '')].length).toBeLessThanOrEqual(SESSION_CANCEL_REASON_MAX);
  });
});
```

`tests/pg/session-cards.test.ts` **文件末尾**追加（`cast`、`events`、`fakeDiscord`、`dispatcher`、`text`、`IN_2H` 都是文件里已有的辅助；`cancelSession`、`createSession`、`setRsvp` 已在 `:6` 的 import 里）：

```ts
// --- P2-3 ---
describe('a cancel with a reason', () => {
  async function cancelled(reason?: string): Promise<{ to: string[]; texts: string[] }> {
    const { org, a, b } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    await cancelSession(env.DB, org, session.id, reason);
    const to = (await events()).filter((e) => e.kind === 'dm.session.cancelled').map((e) => e.entity_id).sort();
    const discord = fakeDiscord();
    await dispatcher(discord.api, null).runOnce();
    const texts = discord.sent.filter((s) => text(s.message).includes('约局取消了')).map((s) => text(s.message));
    return { to, texts };
  }

  it('reaches the same people, and the DM carries the reason', async () => {
    const { to, texts } = await cancelled('  临时加班，改天  ');
    expect(to).toEqual(['a', 'b']);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).toContain('理由：临时加班，改天');
  });

  it('without one, the same people and no reason line', async () => {
    const { to, texts } = await cancelled();
    expect(to).toEqual(['a', 'b']);
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).not.toContain('理由');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.server.config.ts server/test/session-render.test.ts
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts
```

期望：server **1 failed | 8 passed**（`with a reason adds it on its own line …`：description 里没有理由行）；`without a reason reads exactly as before` 现在就通过（回归锁）。PG **1 failed**：`reaches the same people, and the DM carries the reason` 报 `expected '{"embeds":[{"title":"🚫 约局取消了：…' to contain '理由：临时加班，改天'`；收件人断言 `['a','b']` 已经成立（触发器不改，契约 §3.2）。

- [ ] **Step 3：`server/src/discord/sessions.ts`**

import 区，把

```ts
import { ApiError } from '../../../worker/errors';
```

换成

```ts
import { SESSION_CANCEL_REASON_MAX } from '../../../shared/attendance';
import { ApiError } from '../../../worker/errors';
```

`renderSessionDm` 里，把

```ts
    case 'dm.session.cancelled':
      return message({ title: `🚫 约局取消了：${title}`, description: `原定 ${when}，由 ${organizer} 取消。`, color: GREY }, [
        web,
      ]);
```

换成

```ts
    case 'dm.session.cancelled': {
      // P2-3: the organizer's reason, when there is one, on a line of its own.
      const said = `原定 ${when}，由 ${organizer} 取消。`;
      const reason = session.cancel_reason ? safeLine(session.cancel_reason, SESSION_CANCEL_REASON_MAX) : '';
      const description = reason ? `${said}\n理由：${reason}` : said;
      return message({ title: `🚫 约局取消了：${title}`, description, color: GREY }, [web]);
    }
```

（`safeLine` 已在 import 里：去掉换行、中和 markdown 链接和提及，`render.ts` 的 `safeLine`；消息本身 `allowed_mentions: { parse: [] }`。私信 payload 只有 `session_id`，dispatcher 投递时 `loadSession` → `getSessionDetail` 读**当时**的局，所以理由自然在 `session.cancel_reason` 里，`dispatcher.ts` 不改。频道卡片 `sessionCard` 的已取消形态不变，理由只进私信，契约 §5。）

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.server.config.ts server/test/session-render.test.ts
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts
npm run typecheck
```

期望：server **9 passed**；PG `session-cards` **54 passed**（原有 49 + P2-1 的 3 + 本 PR 2）；typecheck 通过。

- [ ] **Step 5：提交**

```bash
git add server/src/discord/sessions.ts server/test/session-render.test.ts tests/pg/session-cards.test.ts
git commit -m "feat: bot 取消私信带上组织者写的理由（经 safeLine）"
```

---

### Task 7：文档

**Files:**
- Modify: `docs/CONTRACT.md`、`docs/DEPLOY-DISCORD.md`

- [ ] **Step 1：`docs/CONTRACT.md`**

`interface SessionItem` 的结尾（P2-6 加了 `going_preview` 一行，本 PR 的两行接在它后面），把

```ts
}

interface SessionDetail extends SessionItem { players: SessionPlayer[] }
```

换成

```ts
  cancel_reason: string | null;  // P2-3: the organizer's reason (trimmed, ≤ 80 chars); public like `note`
  cancelled_at: string | null;   // P2-3: sqlite datetime format; null if not cancelled (or cancelled before P2-3)
}

interface SessionDetail extends SessionItem { players: SessionPlayer[] }

// P2-3: GET /api/sessions?scope=history
interface HistorySessionItem extends SessionItem {
  attendance_summary: { on_time: number; late: number; no_show: number; left_early: number; excused: number }; // all five keys
}

// P2-3: GET /api/me/invites — the context is the caller's own, never shown elsewhere
interface InvitedSessionItem extends SessionItem {
  invite_reason: 'new' | 'moved';            // 'moved' = they had answered, then the time changed
  prev_rsvp: 'going' | 'maybe' | 'out' | null; // what they had said to the old time
  prev_starts_at: string | null;               // the old time (ISO), as they answered it
}
```

`### Public (no auth)` 小节里，把

```markdown
- `GET /api/sessions?scope=upcoming|past|mine` → `{ sessions: SessionItem[] }` (`mine` requires auth).
```

换成

```markdown
- `GET /api/sessions?scope=upcoming|past|mine` → `{ sessions: SessionItem[] }` (`mine` requires auth).
  `scope=history[&before=<id>]` → `{ sessions: HistorySessionItem[] }`: sessions that have started,
  **cancelled ones included** (`past` leaves them out), newest first (`starts_at`, then id), 20 a page;
  `before` is the last id of the previous page (an unknown id gives `[]`; not a positive integer → 400).
```

`### Authenticated (session cookie)` 的 **Sessions** 里，把

```markdown
- `POST /api/sessions/:id/cancel` → `{ session }`.
```

换成

```markdown
- `POST /api/sessions/:id/cancel` `{ reason? }` → `{ session }`. The body is optional (none = no
  reason). `reason` is trimmed and cut to 80 characters; blank or not a string → null. Stored with
  `cancelled_at`; cancelling again changes neither. The cancel DM quotes it.
```

再把

```markdown
- `GET /api/me/invites` → `{ sessions: SessionItem[] }`. Open, future sessions the
  caller was invited to and has not answered. Drives the one-tap invite banner.
```

换成

```markdown
- `GET /api/me/invites` → `{ sessions: InvitedSessionItem[] }`. Open, future sessions the
  caller was invited to and has not answered. Drives the one-tap invite banner. Each says why:
  `invite_reason: 'moved'` with `prev_rsvp` / `prev_starts_at` when the caller had answered and the
  time then changed (a later move keeps the time they answered; answering again clears it), else `'new'`.
```

- [ ] **Step 2：`docs/DEPLOY-DISCORD.md`（「约局取消」那一行，契约 §3 的 `:188`）**

把

```markdown
| 约局取消 | 还在局里、知道这个局的人：报了来 / 可能的，以及回应过、或 bot 给他发过邀请或改期私信的人；已经开局后再取消就不发了 |
```

换成

```markdown
| 约局取消 | 还在局里、知道这个局的人：报了来 / 可能的，以及回应过、或 bot 给他发过邀请或改期私信的人；已经开局后再取消就不发了。附组织者写的理由（如有） |
```

- [ ] **Step 3：核对并提交**

```bash
grep -n "cancel_reason\|HistorySessionItem\|InvitedSessionItem\|scope=history" docs/CONTRACT.md   # 期望：上面写进去的几处
grep -n "附组织者写的理由" docs/DEPLOY-DISCORD.md                                                 # 期望：1 行
git add docs/CONTRACT.md docs/DEPLOY-DISCORD.md
git commit -m "docs: CONTRACT 与 DEPLOY-DISCORD 写明取消理由、scope=history、邀请上下文"
```

---

## 收尾

- [ ] **完整验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | tail -4
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:server 2>&1 | tail -4
npm run test:worker 2>&1 | tail -4
npm run test:pg 2>&1 | tail -4
npm run build
npm run build:pages
test ! -e dist/404.html && echo "no 404.html"
```

期望（相对 Task 0 记下的数字）：

| 套件 | 文件 | 用例 | 新增来源 |
|---|---|---|---|
| typecheck | — | 通过 | — |
| unit | U0 | U0 + 0 | — |
| dom | D0 + 1 | D0 + 5；`act(...)` 警告仍是 3 条 | `session-api.test.tsx` 5 |
| server | S0 | S0 + 2 | `session-render.test.ts` 2 |
| worker（D1） | W0 + 2 | W0 + 20（todo 不变） | `session-context` 10、`session-history` 6、`session-routes` 4 |
| pg | P0 + 2 | P0 + 23（todo 不变） | 上面 worker 的 20 条在 PG 上再跑一遍 + `session-cards` 2 + `import-d1` 1 |
| build / build:pages | — | 通过；`dist/` 没有 `404.html` | — |

跨 PR 合成副本（P0 + P1 规划副本依次套上 P2-2、P2-1、P2-6 和本计划）逐步实测：unit 30/422 → 30/422；dom 25/317 → **26/322**（`act` 警告 3 条不变）；server 22/290 → **22/292**；worker 18/600 → **20/620**（+ 9 todo）；pg 30/881 → **32/904**（+ 9 todo）；typecheck、`npm run build`、`npm run build:pages` 通过，`dist/` 无 `404.html`。每个 Task 的红/绿都按上面写的出现过（Task 1 红 D1 1 failed、PG 2 failed | 8 passed；Task 2 红 6 failed | 9 passed；Task 3 红 5 failed | 16 passed；Task 4 红 6 failed | 12 passed；Task 5 红 4 failed | 1 passed；Task 6 红 server 1 failed | 8 passed、PG 1 failed | 53 passed）。遇到 `tests/pg/adapter.test.ts` 的 5 秒超时，按 Task 0 Step 3 的办法单独重跑。

- [ ] **范围核对**

```bash
git diff --stat claude/p2-6-going-preview          # 期望：正好「文件结构」表里的 21 个文件
git diff --stat claude/p2-6-going-preview -- src/components src/App.tsx src/lib server/src/import-d1.ts scripts server/src/outbox \
  server/migrations/0001_init.sql server/migrations/0002_discord.sql server/migrations/0003_outbox.sql \
  server/migrations/0004_dm.sql server/migrations/0005_sessions.sql server/migrations/0006_p8.sql   # 期望：无输出
git diff claude/p2-6-going-preview -- server/src/discord/sessions.ts | grep -E '^[-+][^-+]'   # 期望：只有 import 一行和 cancelled 分支
git diff --numstat claude/p2-6-going-preview -- worker/sessions.ts      # 期望 69 增 9 删（净增 60，契约 §0 的上限内；合成副本实测）
grep -n "console.log" worker/session-extras.ts worker/sessions.ts worker/routes.ts src/api.ts server/src/discord/sessions.ts   # 期望：无输出
git log --format=%B claude/p2-6-going-preview..HEAD | grep -ciE "co-authored|generated with"   # 期望：0
git log --oneline claude/p2-6-going-preview..HEAD    # 期望：7 个提交，Task 1–7 各一个
```

- [ ] **给机主的 PR 描述要点**（部署与迁移说明原样写进去）

1. **这是 P2 唯一带迁移的 PR。部署顺序：先迁移、后代码。** 新代码读写 `cancel_reason`、`cancelled_at`、`prev_rsvp`、`prev_starts_at`；没迁移就上新代码，改期和取消的 UPDATE 会报列不存在（`toSessionItem` 读不到列时兜底为 null，但写不行）。旧代码配新 schema 没问题（新列可空，`SELECT g.*` 多出来的键被旧的 `toSessionItem` 忽略）。
   - **PostgreSQL（Node 后端）**：compose 的一次性 `migrate` 服务在 app 启动前跑 `server/dist/migrate-main.js`（`compose.yaml` 的 `migrate:`；`server/src/db/migrate.ts` 按文件名顺序、一个文件一个事务、advisory lock），app 只在它退出 0 之后启动。部署后看 migrate 容器日志应有 `migrations: applied 1 (0007_lobby.sql)`。`0007` 是 `ADD COLUMN IF NOT EXISTS`，重跑无害。没有触发器或函数改动（契约 §3.2）。
   - **D1（还在用旧 Worker 的环境）**：部署 Worker **之前**手动跑 `npm run db:migrate4:remote`（本地开发 `npm run db:migrate4:local`）。SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重跑会对每条报 `duplicate column name`——预期行为，代表已经迁移过（和 002、003 一样）。全新部署直接用 `schema.sql`（已含四列），不要跑 004。
   - **D1 → PG 导入**（切换当晚）：`server/src/import-d1.ts` 按 `information_schema` 动态取列，不用改。D1 已迁 004 而 PG 没迁 0007 时，preflight 会拒绝（`export has tables/columns this schema lacks: game_sessions.cancel_reason, …`）——先让 `migrate` 服务跑完（compose 本来就是这个顺序）。D1 没迁 004 时四列在 PG 里为 NULL，照常导入。`scripts/d1-export.mjs` 是 `SELECT *`，新列自动导出。
   - **回滚**：回退本 PR 的代码即可，不用回退迁移（多出来的四列对旧代码无害）。真要回滚 schema（会丢改期上下文和取消理由，一般不需要）：D1 `ALTER TABLE session_players DROP COLUMN prev_rsvp;`、`… DROP COLUMN prev_starts_at;`、`ALTER TABLE game_sessions DROP COLUMN cancel_reason;`、`… DROP COLUMN cancelled_at;`；PG 同样四条加 `IF EXISTS`，再 `DELETE FROM schema_migrations WHERE name = '0007_lobby.sql';`。
2. **界面还不能写理由**（契约 §8 第 2 条）：API 已支持 `{ reason }`，网页的取消确认里那个「理由（选填）」输入框在 P3-3 加；本 PR 合并后到 P3-3 之前，理由只能经 API 写入。私信和接口已经能带理由。
3. **取消理由是公开的**（契约 §6 第 5 条、§8 第 5 条）：`cancel_reason` 随 `SessionItem` 公开，和 `note` 一样（spec §3.4 的历史页本来就显示「阿杰：临时加班，改天」）。P3-3 的确认文案建议写「理由（选填，会写进私信，也会显示在这局的页面上）」，而不只是 spec §3.5 的「会写进私信」。前端渲染一律当纯文本；bot 侧经 `safeLine`。
4. **改期上下文只给本人**：`prev_rsvp`、`prev_starts_at`、`invite_reason` 只出现在 `/api/me/invites`，不进详情、列表、`SessionPlayer`（`session-context.test.ts`「keeps the context out of everything but the person’s own invites」锁住）。
5. **已知问题，不在本 PR 修**：`cancel_reason` 复用 `normalizeOptionalText`，和 `title`/`game`/`note` 一样按 UTF-16 截断，emoji 卡在第 80 个位置会留下孤立代理（`tests/worker/session-update.test.ts` 的 `it.todo`，契约 §7.1 末行）。要修就四个字段一起修。
6. **测试放的位置和 spec 列的文件名不一样**（契约 §8 第 8 条）：改期上下文和取消理由在新 `tests/worker/session-context.test.ts`，历史在新 `tests/worker/session-history.test.ts`，取消私信的 PG 用例在 `tests/pg/session-cards.test.ts`（不是 spec 写的 `tests/pg/outbox.test.ts`）；`session-update.test.ts`、`sessions.test.ts` 的原有用例原样通过。另有本计划新增的 `tests/dom/session-api.test.tsx`（见下「对契约的补充」第 1 条）。
7. **分页约定**（契约 §8 第 11 条）：每页 20，`before=<上一页最后一项的 id>`，`starts_at DESC, id DESC`，游标 id 不存在返回空列表；前端以「返回条数 < 20」判断没有下一页。`scope=past` 不变（排除已取消，「最近结束」继续用它）。
8. 本 PR 没有改 PG 触发器：带理由取消的收件人和不带理由时相同（`session-cards`「a cancel with a reason」两条），取消私信每局每人仍最多一条。

## 对契约的补充

1. **新增 `tests/dom/session-api.test.tsx`（5 个用例）。** 契约 §2 的 P2-3 测试清单和 §9 表里 dom 一栏是「—」。但 `src/api.ts` 的 `getSessionHistory` 有真实逻辑（旧后端把未知 scope 当 `upcoming` 返回 200，所以要靠「每项都有 `attendance_summary`」判断支持与否），`cancelSession(id, reason?)` 有「不传就不带 body」的约定，TDD 规则要求先有失败的测试。`fetch` 打桩照 `organizer-actions.test.tsx` 的 `mockFetch`。不渲染任何组件，不影响 `act(...)` 警告数。
2. **`tests/pg/import-d1.test.ts` 的 `exportFixture()` 不改**，新用例在它的副本上加一局带四列的数据（一局已取消带理由、一个 `prev_*` 非空的人）。契约 §7.1 写的是「fixture 的行里加四列（值非空）」；这里的做法同样让四列带非空值走一遍导入和逐列校验和，同时保留原 fixture 作为「D1 还没跑 004」的导出（另一种真实的生产情况），一个用例两种都验（`present` 是各行键的并集，缺键的行导入为 NULL）。表数仍是 9。
3. **`worker/session-extras.ts` 多导出 `InviteContext`（接口）和 `NO_ATTENDANCE`（冻结的全零 `AttendanceSummary`）。** 前者是 `inviteContexts` 返回值的名字，后者让 `listSessionHistory` 不用类型断言就能兜底。`inviteContexts` 把不是 `going`/`maybe`/`out` 的 `prev_rsvp` 读成 null（`isSelfRsvp` 守卫，边界校验）。两个批量查询的占位符都用 P2-6 在同一文件里的私有 `holes(count)`（跨 PR 一致性检查改的：原稿各自声明了局部 `const holes`，会遮住 P2-6 的同名函数，也是重复代码）。
4. **`toSessionItem` 对两列用 `?? null` 兜底**：代码先于迁移上线时（部署顺序搞反），读接口仍返回 `null` 而不是缺键；写接口照样会报错，所以 PR 描述里的「先迁移、后代码」仍然必须。
5. **`tests/worker/session-routes.test.ts`**：本 PR 只追加 import 行（`createSession`、`setRsvp`、`updateSession`、类型、`OFFSET_HOURS`），不改 P2-2 的行；P2-1、P2-6 没有加任何 import（Task 0 Step 2 核对），不会撞名。P2-3 的 4 个 HTTP 用例放在一个 describe 里，Task 2 建、Task 3/4 往里加，符合契约 §3「每个 PR 在末尾追加一个 describe」。
6. **`listSessionHistory` 的游标若指向一局还没开始的局**，返回的就是已开局的第一页（所有已开局的局都早于它）；前端只会传历史页里出现过的 id，不另设 400。
7. **`server/test/session-render.test.ts` 的 `session()` fixture 用 `as SessionDetail`**，没有 `cancel_reason` 键；取消分支对 `undefined`/`null`/空串一视同仁（没有理由行），新用例两种都验。

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §8「迁移约定」：D1 `migrations/004_lobby.sql`（注释说明没有 `IF NOT EXISTS`）+ `schema.sql`；PG `0007_lobby.sql` 用 `ADD COLUMN IF NOT EXISTS` | Task 1 Step 3–5（契约 §10.1、§10.2 原文）；Step 7 的 sqlite3 实测 |
| `package.json` 的 `db:migrate4:local` / `db:migrate4:remote` | Task 1 Step 6；收尾 PR 描述第 1 条 |
| import-d1 要带上新列（spec §8）→ 只改测试（契约 §3.3、§8 第 7 条） | Task 1 Step 1 的 `import-d1` 用例；Task 1 Step 2 的 preflight 红；对契约的补充第 2 条 |
| 契约 §3.2：PG 触发器、outbox 不改；收件人集合不变 | 「不碰」；收尾范围核对；Task 6 的 PG 用例 `to` = `['a','b']`（有无理由各一条） |
| B2-3 ①：改期在重置 UPDATE 里写 `prev_rsvp = rsvp`、`prev_starts_at = 旧 starts_at`；invited 的行不动、组织者不动；连改两次保留第一次；`setRsvp` 清空 | Task 3 Step 5；`session-context`「writes prev_rsvp …」「a second move …」「answering again clears it …」 |
| B2-3 ②：`/api/me/invites` 每项 `invite_reason: 'new' \| 'moved'`、`prev_rsvp`、`prev_starts_at` | Task 3 Step 3、5；`session-context`「'new' for a first invitation, 'moved' …」；`session-routes` 的 invites 用例 |
| 契约 §6 第 4 条：上下文只给本人，`SessionPlayer` 不加 | Task 3 Step 3 的说明；`session-context`「keeps the context out of everything …」 |
| B2-3 ③：`POST …/cancel {reason?}`，trim ≤ 80，写 `cancel_reason`、`cancelled_at`；无 body 照旧；再取消不覆盖 | Task 2 Step 5、6；`session-context` 的 cancel describe 4 条；`session-routes` 两条取消用例 |
| `SessionItem` 带两列（列表、详情、`/api/me/invites`、history 都有） | Task 2 Step 4、5；`session-context`「every SessionItem carries both fields …」；`session-history`「carries … the cancel fields」 |
| bot 取消私信渲染理由，经 `safeLine`；没理由时逐字不变；卡片不变 | Task 6 Step 3；`session-render`「the cancel DM」两条；PG 两条 |
| B2-3 ④ / spec §3.4：`scope=history` 含已取消、不含未开局，`before=<id>` 游标，`attendance_summary` 五键（一次 GROUP BY）；`scope=past` 不变；路由不读 `limit` | Task 4；`session-history` 6 条；`session-routes` 的 history 用例（公开、翻页、坏游标 400、`past` 忽略 `before`） |
| 契约 §3.4 方言：ISO 的「现在」绑定、展开的 `OR` 游标、不引用别名、占位符按个数生成、`prev_rsvp = rsvp` 读旧值 | Task 3 Step 5、Task 4 Step 3–4；PG 套件全绿 |
| D1 与 PG 行为一致 | 每个 Task 的绿都在两个引擎上跑；收尾 `test:worker` + `test:pg` |
| 契约 §4.4：`SESSION_CANCEL_REASON_MAX = 80`、`SESSION_HISTORY_PAGE = 20` 放 `shared/attendance.ts` 的 `// --- P2-3 ---` | Task 2 Step 3 |
| 契约 §4.2 / §4.5 前端：新字段一律可选；`cancelSession(id, reason?)` 不传不带 body；`getSessionHistory` 旧后端返回 undefined；`getMyInvites(): Promise<InvitesResponse>`；`getSessions` 不改 | Task 5；`session-api.test.tsx`；`organizer-actions.test.tsx:316` 原样通过 |
| 契约 §3 分区：`worker/sessions.ts` 只改列出的几处，`listSessionHistory` 放 `listMyInvites` 之后；`session-extras.ts` 只放读函数；`server/src/discord/sessions.ts` 只改 cancelled 分支；`docs/CONTRACT.md` 只改自己的行 | Task 2–7；收尾范围核对 |
| 契约 §0：`worker/sessions.ts` 净增受控、不拆文件 | 收尾 `--numstat`（合成副本 +69 −9） |
| 不改任何组件、CSS（契约 §8 第 1、2 条） | 「不碰」；收尾范围核对 |
| 部署与迁移说明（PG `migrate` 服务、D1 `db:migrate4:remote`、回滚、导入顺序） | 收尾 PR 描述第 1 条 |
| 已知 BUG（UTF-16 截断）点名 | 收尾 PR 描述第 5 条 |
| 机主规则：不可变（新对象、`NO_ATTENDANCE` 冻结、`{ ...before, … }`）、新函数 < 50 行、文件 < 800 行（新文件都是）、无 `console.log`、无魔法数（80、20 在 shared）、错误文案中文、提交 `<type>: <中文>` 无署名 | 各 Task；收尾范围核对 |
| 分支：从 `claude/p2-6-going-preview` 开 `claude/p2-3-invite-context`；不 fetch/rebase/push/PR | Task 0 Step 1；「分支」 |
