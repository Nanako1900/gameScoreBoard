# P2-2 可邀请名单 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 新增只读接口 `GET /api/me/invitable`（spec §8 B2-2）：登录用户拿到除自己以外的所有账号（上榜的和没上榜的都在，解决 M14「不在榜的人邀请不到」），每人**只有五个键** `id`、`username`（显示名）、`avatar_url`、`is_participant`、`last_played_with_me_at`，不含分数、角色、邮箱和任何 Discord 信息（spec §11 第 9 条、契约 §6 第 1 条）；响应头 `Cache-Control: private, no-store`。前端只加类型和 `api.ts` 的 `getInvitable()`（404 时返回 `undefined`，供 P2-1 的入口静默隐藏）。本 PR 不改任何组件；它和 P2-1 一起构成「最快的邀请闭环」的后半段（spec §9 P2、契约 §2 第 1 条）。

**Architecture：** 新模块 `worker/invitable.ts` 只有一个读函数 `listInvitable(db, callerId)` 和常量 `MAX_INVITABLE = 500`，一条 SQL（契约 §10.5）：`users` LEFT JOIN 一个按 `session_players` 自连接聚合出的「上次一起玩」子查询，排序为「一起玩过的在前（越近越前）→ 在榜的在前 → 名字 → id」（契约 §8 第 9、10 条）。路由挂在 `worker/routes.ts` 的 `--- Invites ---` 小节、`/api/me/invites` 之后，`requireUser` + 现有的 `privateToViewer`。Node 端 `server/src/api.ts` 复用同一个 Worker app，`/api/me/invitable` 不在 `isBindingPath`（`server/src/api-host.ts` 只认 `/link`、`/api/me/discord`）里，所以 D1 和 PostgreSQL 走同一段代码；SQL 只用两边都合法的写法（契约 §3.4：没有 `NULLS LAST`，`ORDER BY` 不在表达式里引用别名，`starts_at` 和绑定进去的 ISO「现在」比较）。无迁移、不碰 `worker/sessions.ts`、不碰 bot。

**Tech Stack：** TypeScript、Hono（`worker/`）、React 18 + Vite（`src/`，本 PR 只改类型和 fetch 客户端）、Vitest（worker：`vitest.workers.config.ts`，Cloudflare pool + D1，schema 来自 `schema.sql`；PG：`vitest.pg.config.ts` 把 `tests/worker/**` 原样跑在嵌入式 PostgreSQL 17 上，schema 来自 `server/migrations/*`）。

**依赖：** 上游分支 `claude/p1-4-docs`（= P0 + P1 全部套上，规划副本 HEAD `5ae164b`）。共享契约：本目录的 [contract.md](contract.md)（下称「契约」）§2「P2-2」、§3（`worker/routes.ts`、`worker/types.ts`、`src/types.ts`、`src/api.ts`、`docs/CONTRACT.md`、`tests/worker/session-routes.test.ts` 的分区）、§4.1、§4.2、§4.5、§6 第 1 条、§7.2 末行、§7.4 第 2 条、§8 第 8–10 条、§9「P2-2」、§10.5。spec：`docs/redesign-v5/spec.md` §8 B2-2、§4.1 ②、§4.3、§9 P2-2 行、§11 第 9 条。

**分支：** `claude/p2-2-invitable`，从 `claude/p1-4-docs` 的 HEAD 开（`git switch -c claude/p2-2-invitable claude/p1-4-docs`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR、不合并。下一个 PR（P2-1 `claude/p2-1-invite`）从本分支开。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `worker/invitable.ts` | 新（64 行） | `MAX_INVITABLE`（500）、`listInvitable(db, callerId): Promise<InvitableUser[]>`；模块内 `InvitableRow`、`INVITABLE_SQL` |
| `worker/types.ts` ★ | 改 | 文件末尾 `AppEnv` 之前加 `// --- P2-2 ---` 和 `InvitableUser`（契约 §4.2 原样） |
| `worker/routes.ts` ★ | 改 | import 区加 `listInvitable`；`app.get('/api/me/invites'` 那个路由之后加 `app.get('/api/me/invitable'` |
| `src/types.ts` ★ | 改 | `// --- Sessions ---` 之前加 `InvitableUser`、`InvitableResponse` |
| `src/api.ts` ★ | 改 | import 加两个类型；`// --- Sessions ---` 小节末尾（`getMyInvites` 之后）加 `getInvitable` |
| `docs/CONTRACT.md` ★ | 改 | `### Authenticated (session cookie)` 小节、`POST /api/me/display-name` 那一条之后加 `GET /api/me/invitable` 一条 |
| `tests/worker/invitable.test.ts` | 新（173 行） | `listInvitable` 的 16 个用例：谁在名单上（3）、`last_played_with_me_at` 口径（1 个正例 + 10 个排除条件 + 1 个「只算有我的局」）、排序（1） |
| `tests/worker/session-routes.test.ts` | 新（93 行） | P2 的 HTTP 层测试文件，带共享辅助 `BASE`、`SECRET`、`appEnv`、`call`、`asUser`；本 PR 的 describe `GET /api/me/invitable (P2-2)` 3 个用例。P2-1、P2-6、P2-3、P2-4 在末尾各追加一个 describe |

**不碰：** `worker/sessions.ts`、`shared/**`、`server/**`（bot、`api-host.ts`）、`schema.sql`、`migrations/`、`server/migrations/`、任何组件和 CSS、`tests/dom/**`、`tests/unit/**`、`tests/pg/**`。

---

### Task 0：开分支、核对上游、记基线

**Files:** 无改动。

- [ ] **Step 1：确认上游分支存在、工作区干净，开分支**

```bash
git rev-parse --verify claude/p1-4-docs
git status --porcelain   # 期望：无输出
git switch -c claude/p2-2-invitable claude/p1-4-docs
```

上游分支不存在或工作区不干净 → 停下报告，不要自己补上游的文件。

- [ ] **Step 2：核对锚点都在、新文件都不在**

```bash
grep -n "^import { judgeCase } from './ai/provider';$" worker/routes.ts         # 期望：1 行
grep -n "app.get('/api/me/invites', async (c) => {" worker/routes.ts            # 期望：1 行
grep -n "^function privateToViewer(c: Context<AppEnv>): void {$" worker/routes.ts # 期望：1 行
grep -n "^/\*\* Hono generics for the app: bindings + per-request variables. \*/$" worker/types.ts  # 期望：1 行
grep -n "^// --- Sessions -----" src/types.ts                                     # 期望：1 行
grep -n "^  FileCasesResponse,$" src/api.ts                                       # 期望：1 行
grep -n "^export function getMyInvites(): Promise<SessionsResponse> {$" src/api.ts # 期望：1 行
grep -n "^export class ApiError extends Error {$" src/api.ts                      # 期望：1 行
grep -n "POST /api/me/display-name" docs/CONTRACT.md                              # 期望：1 行
grep -n "under(path, '/api/me/discord')" server/src/api-host.ts                   # 期望：1 行（/api/me/invitable 不会被 link-routes 截走）
test ! -e worker/invitable.ts && test ! -e tests/worker/invitable.test.ts && test ! -e tests/worker/session-routes.test.ts && echo "new files absent"
grep -rn "InvitableUser\|listInvitable\|getInvitable\|/api/me/invitable" worker src tests docs/CONTRACT.md   # 期望：无输出（`SessionFormDialog.tsx` 里的局部变量 `invitable`、`draftShapes.ts` 的 `invitableIds` 与本 PR 无关，不在此列）
```

每条都要有期望的输出。对不上就停下。

- [ ] **Step 3：跑基线，记下实际数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg 2>&1 | grep -E "Test Files|Tests |FAIL"   # 约 110 秒；没设 TEST_DATABASE_URL 时自己起嵌入式 PG 17
```

记为 **U0 / D0 / S0 / W0 / G0**（G = PG 套件）。期望（契约 §1，规划时在副本上复测一致）：typecheck 通过；unit **29 / 414**；dom **24 / 299**，`not wrapped in act` 只有 `onboarding-roles` 那 3 条；server **22 / 290**；worker **15 / 560 passed + 9 todo**；pg **27 / 838 passed + 9 todo**。

> PG 的已知抖动（契约 §1）：机器负载高时 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」会超时。规划时副本的基线还见到 `tests/pg/concurrency.test.ts`「a yes that read the old time before a move landed is refused, not written for the new time」在全套跑时失败 1 次（当时同机还有别的 PG 套件在跑）。遇到这两条之一：单独重跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts tests/pg/concurrency.test.ts`（规划时 2 个文件 21 / 21 通过），通过就按 G0 = 27 / 838 + 9 todo 记，并记进 PR 描述。别的红 → 停下。

---

### Task 1：`listInvitable`（名单、五个键、「上次一起玩」、排序）

**Files:**
- Create: `tests/worker/invitable.test.ts`
- Create: `worker/invitable.ts`
- Modify: `worker/types.ts`（文件末尾，`AppEnv` 之前）

- [ ] **Step 1：写失败的测试**

新建 `tests/worker/invitable.test.ts`，完整内容：

```ts
// P2-2: the list behind GET /api/me/invitable — everyone but the caller, five
// keys each, and when the caller last really played with them (contract §8 #9:
// started, not cancelled, both said 来, neither marked 没来 / 请假). Runs on D1
// and, through vitest.pg.config.ts, on PostgreSQL.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { listInvitable } from '../../worker/invitable';
import { seedUser } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEYS = ['avatar_url', 'id', 'is_participant', 'last_played_with_me_at', 'username'];

/** An ISO instant `offsetMs` from now — the shape starts_at is stored in. */
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

interface Seat {
  rsvp?: 'invited' | 'going' | 'maybe' | 'out';
  attendance?: 'on_time' | 'late' | 'no_show' | 'left_early' | 'excused' | null;
}

/** A session organised by `organizer`, with one row per seat (default: said 来, not marked). */
async function sessionWith(
  organizer: string,
  startsAt: string,
  status: 'open' | 'cancelled' | 'settled',
  seats: Record<string, Seat>,
): Promise<void> {
  const created = await env.DB.prepare(
    "INSERT INTO game_sessions (organizer_id, title, starts_at, status) VALUES (?, '测试局', ?, ?)",
  )
    .bind(organizer, startsAt, status)
    .run();
  const sessionId = Number(created.meta.last_row_id);
  for (const [userId, seat] of Object.entries(seats)) {
    await env.DB.prepare(
      'INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, ?, ?)',
    )
      .bind(sessionId, userId, seat.rsvp ?? 'going', seat.attendance ?? null)
      .run();
  }
}

async function lastPlayed(callerId: string, userId: string): Promise<string | null | undefined> {
  const users = await listInvitable(env.DB, callerId);
  return users.find((u) => u.id === userId)?.last_played_with_me_at;
}

describe('listInvitable — who is on it', () => {
  it('is everyone but the caller, on the board or not', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'board' });
    await seedUser({ id: 'friend', participant: false });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.id)).toEqual(['board', 'friend']);
    expect(users.map((u) => u.is_participant)).toEqual([true, false]);
  });

  it('gives five keys and nothing else: no score, no roles, no email', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', judge: true, admin: true, score: 37 });
    await env.DB.prepare(
      "UPDATE users SET email = 'a@example.com', avatar_url = 'https://cdn.example.com/a.png' WHERE id = 'a'",
    ).run();

    const users = await listInvitable(env.DB, 'me');

    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]).sort()).toEqual(KEYS);
    expect(users[0]).toEqual({
      id: 'a',
      username: 'a',
      avatar_url: 'https://cdn.example.com/a.png',
      is_participant: true,
      last_played_with_me_at: null,
    });
    const text = JSON.stringify(users);
    for (const leak of ['score', 'judge', 'admin', 'email', 'a@example.com', '37']) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it('shows the display name when there is one, like the rest of the site', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', username: 'oauth_a' });
    await seedUser({ id: 'b', username: 'oauth_b' });
    await env.DB.prepare("UPDATE users SET display_name = '阿杰' WHERE id = 'a'").run();

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => [u.id, u.username])).toEqual([
      ['b', 'oauth_b'],
      ['a', '阿杰'],
    ]);
  });
});

describe('listInvitable — last_played_with_me_at', () => {
  it('is the start of the latest session we both said 来 to and both turned up for', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    const latest = iso(-1 * DAY);
    await sessionWith('me', iso(-3 * DAY), 'settled', { me: { attendance: 'on_time' }, x: { attendance: 'late' } });
    await sessionWith('x', iso(-2 * DAY), 'settled', { x: { attendance: 'on_time' }, me: { attendance: 'left_early' } });
    // Started, not settled yet, nobody marked: still counts.
    await sessionWith('x', latest, 'open', { x: {}, me: {} });
    // Later, but cancelled: does not count, and does not hide the real one.
    await sessionWith('me', iso(-1 * HOUR), 'cancelled', { me: {}, x: {} });

    expect(await lastPlayed('me', 'x')).toBe(latest);
  });

  const EXCLUDED: [string, { status?: 'open' | 'cancelled'; startsAt?: string; me?: Seat; them?: Seat }][] = [
    ['the session was cancelled', { status: 'cancelled' }],
    ['it has not started yet', { status: 'open', startsAt: iso(3 * HOUR) }],
    ['I only said 待定', { me: { rsvp: 'maybe' } }],
    ['they only said 待定', { them: { rsvp: 'maybe' } }],
    ['they never answered', { them: { rsvp: 'invited' } }],
    ['they said 不来', { them: { rsvp: 'out' } }],
    ['I was marked 没来', { me: { attendance: 'no_show' } }],
    ['I was marked 请假', { me: { attendance: 'excused' } }],
    ['they were marked 没来', { them: { attendance: 'no_show' } }],
    ['they were marked 请假', { them: { attendance: 'excused' } }],
  ];

  it.each(EXCLUDED)('stays null when %s', async (_why, tweak) => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    await sessionWith('me', tweak.startsAt ?? iso(-1 * DAY), tweak.status ?? 'settled', {
      me: tweak.me ?? {},
      x: tweak.them ?? {},
    });

    expect(await lastPlayed('me', 'x')).toBeNull();
  });

  it('counts only sessions the caller was in, not two others playing together', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    await seedUser({ id: 'y' });
    await sessionWith('x', iso(-1 * DAY), 'settled', { x: {}, y: {} });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.last_played_with_me_at)).toEqual([null, null]);
    expect(await lastPlayed('x', 'y')).not.toBeNull();
  });
});

describe('listInvitable — order', () => {
  it('puts who played with me first (latest first), then the board, then by name and id', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'p-old', username: 'Zed' });
    await seedUser({ id: 'p-new', username: 'Yan', participant: false });
    await seedUser({ id: 'bea', username: 'Bea' });
    await seedUser({ id: 'amy', username: 'Amy' });
    await seedUser({ id: 'q2', username: '同名' });
    await seedUser({ id: 'q1', username: '同名' });
    await seedUser({ id: 'dan', username: 'Dan', participant: false });
    await seedUser({ id: 'cat', username: 'Cat', participant: false });
    await sessionWith('me', iso(-3 * DAY), 'settled', { me: {}, 'p-old': {} });
    await sessionWith('me', iso(-1 * DAY), 'settled', { me: {}, 'p-new': {} });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.id)).toEqual(['p-new', 'p-old', 'amy', 'bea', 'q1', 'q2', 'cat', 'dan']);
  });
});
```

要点：`sessionWith` 直接插 `game_sessions` / `session_players`（`rsvp` 默认 `going`、`attendance` 默认 NULL），和 `tests/worker/record-privacy.test.ts` 的 `cast()` 一样，两个引擎都能跑（PG 上触发器照常写 outbox，不影响断言）。10 个排除条件各是一个独立用例（契约 §8 第 9 条：已开局、没取消、双方都 `going`、双方都没被点成 `no_show` / `excused`）；正例里放了一场**更晚但已取消**的局，证明排除的局不会盖住真正的「上次」。排序用例里 `'Amy' < 'Bea' < '同名'` 依赖按码位排序：D1 是 SQLite 的 BINARY，PG 测试库和生产库由 `server/src/db/migrate.ts` 拒绝非码位排序的库（`tests/pg/adapter.test.ts` 锁着）。

- [ ] **Step 2：跑测试，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.workers.config.ts tests/worker/invitable.test.ts
```

期望：`Error: Cannot find module '../../worker/invitable'`，**Test Files 1 failed (1)，Tests no tests**（模块还不存在）。

- [ ] **Step 3：`worker/types.ts` 加 `InvitableUser`**

在 `worker/types.ts` 的锚点

```ts
/** Hono generics for the app: bindings + per-request variables. */
export interface AppEnv {
```

**之前**插入（后面留一个空行；P2-1 的 `InviteResult` 会接在 `InvitableUser` 后面，同样在 `AppEnv` 之前）：

```ts
// --- P2-2 ---
/** One row of GET /api/me/invitable. Never a score, never anything about Discord. */
export interface InvitableUser {
  id: string;
  /** COALESCE(display_name, username), like every other name the site shows. */
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  /** starts_at (ISO) of the latest session, already started and not cancelled, where both said 来 and neither was marked 没来 / 请假; else null. */
  last_played_with_me_at: string | null;
}
```

- [ ] **Step 4：新建 `worker/invitable.ts`**

完整内容：

```ts
// P2-2: GET /api/me/invitable — everyone the caller could invite to a session.
//
// Names and avatars only: the SELECT lists its five columns (never `u.*`) and
// joins nothing about Discord, so no score, role, email or binding can leak
// (spec §8 B2-2, contract §6.1). `last_played_with_me_at` is the caller's own
// history with each person, so the route marks the response private.
//
// The SQL must be valid on SQLite (D1) and PostgreSQL alike (contract §3.4):
// no NULLS LAST, no SELECT aliases inside ORDER BY expressions.

import type { InvitableUser } from './types';

/** Upper bound on the rows one call returns: a friend group is a few dozen people. */
export const MAX_INVITABLE = 500;

interface InvitableRow {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: number;
  last_played_with_me_at: string | null;
}

// "Played with me" (contract §8 #9): a session that has started (starts_at is
// ISO, so it is compared with an ISO "now", never datetime('now')) and was not
// cancelled, where both of us said 来 and neither was marked 没来 / 请假. An
// unmarked attendance counts as there: most sessions never get a roll call.
// Order: who played with me (latest first), then the board, then name and id.
const INVITABLE_SQL = `
  SELECT u.id, COALESCE(u.display_name, u.username) AS username, u.avatar_url, u.is_participant,
         lp.at AS last_played_with_me_at
    FROM users u
    LEFT JOIN (
          SELECT them.user_id AS user_id, MAX(g.starts_at) AS at
            FROM session_players me
            JOIN game_sessions g      ON g.id = me.session_id
            JOIN session_players them ON them.session_id = me.session_id AND them.user_id <> me.user_id
           WHERE me.user_id = ?
             AND g.status <> 'cancelled' AND g.starts_at <= ?
             AND me.rsvp = 'going' AND them.rsvp = 'going'
             AND (me.attendance IS NULL OR me.attendance NOT IN ('no_show', 'excused'))
             AND (them.attendance IS NULL OR them.attendance NOT IN ('no_show', 'excused'))
           GROUP BY them.user_id
         ) lp ON lp.user_id = u.id
   WHERE u.id <> ?
   ORDER BY CASE WHEN lp.at IS NULL THEN 1 ELSE 0 END, lp.at DESC,
            u.is_participant DESC, COALESCE(u.display_name, u.username) ASC, u.id ASC
   LIMIT ?`;

/** Everyone but the caller, as exactly the five keys of InvitableUser. */
export async function listInvitable(db: D1Database, callerId: string): Promise<InvitableUser[]> {
  const nowIso = new Date().toISOString();
  const rows = await db
    .prepare(INVITABLE_SQL)
    .bind(callerId, nowIso, callerId, MAX_INVITABLE)
    .all<InvitableRow>();
  return rows.results.map((row) => ({
    id: row.id,
    username: row.username,
    avatar_url: row.avatar_url,
    is_participant: row.is_participant === 1,
    last_played_with_me_at: row.last_played_with_me_at,
  }));
}
```

- [ ] **Step 5：跑测试，确认通过（D1，再 PG）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/invitable.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/invitable.test.ts
npx tsc -p tsconfig.worker.json --noEmit
```

期望：D1 **16 passed (16)**；PG **16 passed (16)**（含嵌入式 PG 启动约 10–20 秒）；tsc 无输出。

> 规划时另做过变异检查（不是执行步骤）：把 SQL 里 `me.attendance`、`them.attendance` 两个条件分别改成恒真 → 各 2 个用例失败；把 `me.rsvp = 'going' AND them.rsvp = 'going'` 改成恒真 → 4 个失败；把 `g.status <> 'cancelled' AND g.starts_at <= ?` 改成恒真 → 3 个失败。测试不是空转的。

- [ ] **Step 6：提交**

```bash
git add worker/invitable.ts worker/types.ts tests/worker/invitable.test.ts
git commit -m "feat: 新增 listInvitable，按「上次一起玩」排出除自己外的可邀请名单"
```

---

### Task 2：路由 `GET /api/me/invitable` 和 P2 的 HTTP 测试文件

**Files:**
- Create: `tests/worker/session-routes.test.ts`
- Modify: `worker/routes.ts`（import 区；`--- Invites ---` 小节）

- [ ] **Step 1：写失败的路由测试（同时建好 P2 共用的 HTTP 测试文件）**

新建 `tests/worker/session-routes.test.ts`，完整内容：

```ts
// HTTP layer of the P2 lobby endpoints, through the real app so middleware
// order (CSRF, READ_ONLY, auth) and error mapping are covered too. Runs on D1
// and, through vitest.pg.config.ts, on PostgreSQL.
//
// P2-2 creates this file with the shared helpers below; P2-1, P2-6, P2-3 and
// P2-4 each append one describe at the end and leave the rest as it is.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { noAiEnv, seedUser } from './helpers';

const BASE = 'https://score.example.com';
const SECRET = 'test-session-secret-0123456789abcdef';

function appEnv(overrides: Partial<Env> = {}): Env {
  return noAiEnv({
    SESSION_SECRET: SECRET,
    OAUTH_BASE_URL: 'https://idp.example.com',
    OAUTH_CLIENT_ID: 'client',
    OAUTH_CLIENT_SECRET: 'secret',
    ...overrides,
  });
}

async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${BASE}${path}`, init), appEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Headers of a same-origin request signed in as `sub`. */
async function asUser(sub: string, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await signSession({ sub }, SECRET);
  return { Cookie: `${SESSION_COOKIE}=${token}`, Origin: BASE, ...extra };
}

describe('GET /api/me/invitable (P2-2)', () => {
  /** PostgreSQL only: bind `userId` to Discord. D1 has no discord_links table — the one error allowed. */
  async function bindDiscordWherePossible(userId: string): Promise<void> {
    try {
      await env.DB.prepare(
        "INSERT INTO discord_links (discord_user_id, user_id, discord_username) VALUES ('123456789012345678', ?, 'discordhandle')",
      )
        .bind(userId)
        .run();
    } catch (err) {
      expect(String(err)).toMatch(/no such table: discord_links/);
    }
  }

  it('answers 401 未登录 without a session', async () => {
    const res = await call('/api/me/invitable');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
  });

  it('lists everyone but the caller, privately, with five keys and nothing about scores or Discord', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', score: 37, judge: true });
    await seedUser({ id: 'b', participant: false });
    await env.DB.prepare("UPDATE users SET display_name = '阿杰', email = 'a@example.com' WHERE id = 'a'").run();
    await bindDiscordWherePossible('a');

    const res = await call('/api/me/invitable', { headers: await asUser('me') });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      users: [
        { id: 'a', username: '阿杰', avatar_url: null, is_participant: true, last_played_with_me_at: null },
        { id: 'b', username: 'b', avatar_url: null, is_participant: false, last_played_with_me_at: null },
      ],
    });
    for (const leak of ['score', 'discord', '123456789012345678', 'email', 'judge']) {
      expect(text.toLowerCase(), leak).not.toContain(leak);
    }
  });

  it('still answers while the site is read-only: it writes nothing', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a' });

    const res = await call('/api/me/invitable', { headers: await asUser('me') }, { READ_ONLY: '1' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { users: { id: string }[] }).users.map((u) => u.id)).toEqual(['a']);
  });
});
```

要点：
- 顶层辅助 `BASE`、`SECRET`、`appEnv`、`call`、`asUser` 照抄 `tests/worker/http-guards.test.ts` 的 `appEnv` / `call` 写法（契约 §3），`asUser(sub, extra?)` 返回带签名 cookie 和 `Origin: BASE` 的请求头（后面的 PR 发 POST 时直接过 CSRF）。后面的 PR 只在**文件末尾追加** describe，不重新声明这些顶层名字；各自的小辅助写在自己的 describe 里（像本 PR 的 `bindDiscordWherePossible`）。
- `bindDiscordWherePossible`：`discord_links` 只在 PostgreSQL 里有。PG 那一跑真的给 `a` 绑上 Discord，再断言响应文本里没有 `discord` 和那串 id（契约 §6 第 1 条「PG 那一跑里 `discord_links` 有数据也一样」）；D1 上插入报 `no such table: discord_links`，这是**唯一**被容忍的错误，别的错误让用例失败。
- 第三个用例证明它是纯读接口：`READ_ONLY=1` 时照常 200（维护中间件只拦写）。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts
```

期望：**3 failed (3)**，三条都是路由不存在：`answers 401 未登录 without a session` → `expected 404 to be 401`；另外两条 → `expected 404 to be 200`。

- [ ] **Step 3：`worker/routes.ts` 的 import**

锚点（唯一一行）：

```ts
import { judgeCase } from './ai/provider';
```

在它**下一行**插入：

```ts
import { listInvitable } from './invitable';
```

- [ ] **Step 4：`worker/routes.ts` 加路由**

锚点（`// --- Invites ---` 小节里唯一的路由）：

```ts
  app.get('/api/me/invites', async (c) => {
    const caller = requireUser(c.get('user'));
    const sessions = await listMyInvites(c.env.DB, caller.id);
    return c.json({ sessions });
  });
```

在这个路由的 `});` **之后**插入一个空行和下面这段（插入后，它和 `// --- Weekly report ---` 之间仍是一个空行）：

```ts
  // P2-2: who the caller could invite. Under /api/me/ because GET
  // /api/users/:id would read /api/users/invitable as a user id. Private:
  // last_played_with_me_at is the caller's own history.
  app.get('/api/me/invitable', async (c) => {
    const caller = requireUser(c.get('user'));
    const users = await listInvitable(c.env.DB, caller.id);
    privateToViewer(c);
    return c.json({ users });
  });
```

（`requireUser` 已从 `./http` 引入；`privateToViewer` 是本文件已有的函数，`GET /api/users/:id`、`GET /api/sessions/:id` 也用它。）

- [ ] **Step 5：跑测试，确认通过（D1，再 PG）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts tests/worker/invitable.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/session-routes.test.ts tests/worker/invitable.test.ts
npx tsc -p tsconfig.worker.json --noEmit
```

期望：D1 **Test Files 2 passed (2)，Tests 19 passed (19)**；PG 同样 **2 / 19 passed**（PG 那一跑里 `discord_links` 的插入成功——否则 `bindDiscordWherePossible` 里的断言会失败）；tsc 无输出。

- [ ] **Step 6：提交**

```bash
git add worker/routes.ts tests/worker/session-routes.test.ts
git commit -m "feat: 新增 GET /api/me/invitable，登录可读、响应不缓存"
```

---

### Task 3：前端类型和 `getInvitable`

**Files:**
- Modify: `src/types.ts`（`// --- Sessions ---` 之前）
- Modify: `src/api.ts`（import 区；`// --- Sessions ---` 小节末尾）

本 Task 没有新的运行时测试（契约 §9 的 P2-2 行 unit / dom 都是「—」）：`getInvitable` 的 404 → `undefined`、其他错误照常抛出，由紧接着的 P2-1 的 `tests/dom/invite-sheet.test.tsx`（「404 时入口不存在」降级测试、错误态「重试」）经 `useInvitable` 覆盖，两个 PR 一起合并、一起部署（契约 §2 第 1 条）。这里的验证是 typecheck 和全量 dom 回归（见「对契约的补充」第 1 条）。

- [ ] **Step 1：`src/types.ts` 加两个类型**

锚点（唯一一行）：

```ts
// --- Sessions ---------------------------------------------------------------
```

在它**之前**插入（后面留一个空行）：

```ts
// --- Invitable people (P2-2) -------------------------------------------------

/** One row of GET /api/me/invitable: names and avatars only — never a score, never Discord. */
export interface InvitableUser {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  /** When the caller last really played with them (ISO starts_at); null if never. */
  last_played_with_me_at: string | null;
}

export interface InvitableResponse {
  users: InvitableUser[];
}
```

- [ ] **Step 2：`src/api.ts` 的 import**

在 `import type { … } from './types';` 列表里，锚点行 `  FileCasesResponse,` 的**下一行**插入（保持字母序）：

```ts
  InvitableResponse,
  InvitableUser,
```

- [ ] **Step 3：`src/api.ts` 加 `getInvitable`**

锚点（`// --- Sessions ---` 小节的最后一个函数）：

```ts
export function getMyInvites(): Promise<SessionsResponse> {
  return request<SessionsResponse>('/api/me/invites');
}
```

在它的 `}` **之后**插入一个空行和下面这段（插入后，它和 `// --- Weekly report ---` 之间仍是一个空行）：

```ts
/**
 * Everyone the caller could invite (P2-2). Resolves `undefined` when the API
 * has no such endpoint — an older backend answers 404 — so the invite entry
 * can hide itself, like getDiscordLink. Any other failure throws ApiError.
 */
export async function getInvitable(): Promise<InvitableUser[] | undefined> {
  try {
    const { users } = await request<InvitableResponse>('/api/me/invitable');
    return users;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}
```

- [ ] **Step 4：typecheck 和前端回归**

```bash
npm run typecheck
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
```

期望：typecheck 三个 tsconfig 都通过；dom 仍是 **D0（24 / 299）**、`act` 警告仍是 3 条；unit 仍是 **U0（29 / 414）**。

- [ ] **Step 5：提交**

```bash
git add src/types.ts src/api.ts
git commit -m "feat: 前端新增 InvitableUser 类型和 getInvitable（404 时返回 undefined）"
```

---

### Task 4：`docs/CONTRACT.md` 补一条端点

**Files:**
- Modify: `docs/CONTRACT.md`（`### Authenticated (session cookie)` 小节）

- [ ] **Step 1：加端点说明**

锚点（唯一一行）：

```markdown
- `POST /api/me/display-name` `{ display_name: string | null }` → `{ user }`.
```

在它的**下一行**插入（紧接着，后面仍是原来的空行和 `**Cases**`）：

```markdown
- `GET /api/me/invitable` → `{ users: InvitableUser[] }`, `Cache-Control: private, no-store`
  (P2-2). Everyone but the caller (at most 500), each exactly `{ id, username,
  avatar_url, is_participant, last_played_with_me_at }` — `username` is the display
  name; never a score, a role, an email or anything about Discord.
  `last_played_with_me_at` is the `starts_at` of the latest session that has started,
  was not cancelled, and where both said `going` and neither was marked `no_show` /
  `excused` (unmarked counts as there); `null` if none. Order: people played with
  (latest first), then participants, then name, then id. 401 signed out. An older
  API answers 404: the client hides the invite entry.
```

- [ ] **Step 2：核对**

```bash
grep -c "GET /api/me/invitable" docs/CONTRACT.md                                      # 期望：1
git diff --stat HEAD -- docs/CONTRACT.md                                               # 期望：1 file changed, 9 insertions(+)
```

- [ ] **Step 3：提交**

```bash
git add docs/CONTRACT.md
git commit -m "docs: 契约补 GET /api/me/invitable"
```

---

## 收尾

- [ ] **完整验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run build
npm run build:pages
test ! -e dist/404.html && echo "no 404.html"
```

期望（相对 Task 0 记下的基线）：

| 套件 | 文件 | 用例 | 新增来源 |
|---|---|---|---|
| typecheck | — | 通过 | — |
| unit | U0（29） | U0（414） | — |
| dom | D0（24） | D0（299），`act` 警告 3 条 | — |
| server | S0（22） | S0（290） | — |
| worker（D1） | W0 + 2（= 17） | W0 + 19（= **579 passed + 9 todo**） | `invitable.test.ts` 16、`session-routes.test.ts` 3 |
| pg | G0 + 2（= 29） | G0 + 19（= **857 passed + 9 todo**） | 同上两个文件在 PostgreSQL 上再跑一遍 |
| build / build:pages | — | 通过，`dist/` 无 `404.html` | — |

规划时在副本（`/tmp/claude-redesign/p1/compose/repo` 的拷贝，`claude/p1-4-docs` = `5ae164b`）上按本计划逐步执行后实测：typecheck 通过；unit 29 / 414；dom 24 / 299（`act` 警告 3 条）；server 22 / 290；worker **17 / 579 + 9 todo**；pg **29 / 857 + 9 todo**（这一次全套无抖动）；`npm run build`、`npm run build:pages` 通过，`dist/` 无 `404.html`。各 Task 的红 / 绿数字也都是实测：Task 1 红 = 模块不存在、绿 = D1 16 / 16、PG 16 / 16；Task 2 红 = 3 failed（404）、绿 = D1 19 / 19、PG 19 / 19。

- [ ] **范围核对**

```bash
git diff --stat claude/p1-4-docs -- worker/sessions.ts shared/ server/ schema.sql migrations/ src/components/ src/lib/ tests/dom/ tests/unit/ tests/pg/   # 期望：无输出
git diff --stat claude/p1-4-docs                       # 期望：8 files changed（新 3 个：worker/invitable.ts、两个测试；改 5 个：worker/types.ts、worker/routes.ts、src/types.ts、src/api.ts、docs/CONTRACT.md）
git log --oneline claude/p1-4-docs..HEAD               # 期望：4 个提交（Task 1–4）
git log --format=%B claude/p1-4-docs..HEAD | grep -ciE "co-authored|generated with"   # 期望：0
grep -n "u\.\*\|discord\|score" worker/invitable.ts    # 期望：只有文件头注释里的 2 行（"never `u.*`"、"no score, role, email or binding"），SQL 里没有
grep -rn "console.log" worker/invitable.ts src/api.ts  # 期望：无输出
wc -l worker/invitable.ts worker/routes.ts worker/types.ts src/api.ts src/types.ts   # 都 < 800
```

- [ ] **手工检查（可选，机主在预览环境做）**：登录后在浏览器打开 `/api/me/invitable`：看到 `{"users":[…]}`，自己不在里面，没上榜的朋友也在，每项只有五个键，响应头 `Cache-Control: private, no-store`；退出登录再开是 `{"error":"未登录"}`（401）；和某人一起「来」过一局已开局的约局后，他排到最前、`last_played_with_me_at` 是那局的 `starts_at`。本 PR 网页上没有任何可见变化（入口在 P2-1）。

- [ ] **给机主的 PR 描述要点**：纯只读接口、无迁移、不改界面；和 P2-1 一起合并、一起部署（契约 §2 第 1 条）；隐私：只五个键、SQL 不 SELECT `u.*`、不 JOIN `discord_links`、`private, no-store`（契约 §6 第 1 条，spec §11 第 9 条）；`last_played_with_me_at` 的口径和排序（契约 §8 第 9、10 条）；测试放在新 `tests/worker/invitable.test.ts` 而不是 spec 写的 `users.test`（契约 §8 第 8 条）；下面「对契约的补充」第 1–7 条；PG 抖动如遇到写明。

## 对契约的补充

1. **本 PR 不给 `getInvitable` 写前端运行时测试。** 契约 §9 的 P2-2 行 unit / dom 都是「—」；`getInvitable` 和 `getDiscordLink` 同一写法（404 → `undefined`，其他 `ApiError` 照抛），由 P2-1 的 `tests/dom/invite-sheet.test.tsx`（404 时入口不存在、500 时错误态）经 `useInvitable` 覆盖。不在本 PR 新增 dom 文件，是为了让叠放在后面的 P2-1 … P2-5 开工时的 dom 基线（24 / 299）保持契约 §1 的数字。若机主希望本 PR 自带这层测试，最省事的是在 P2-1 的 `invite-sheet.test.tsx` 里把 `getInvitable` 单列一个 describe（两条：404 → `undefined`；500 → 抛 `ApiError`），而不是在这里加文件。
2. **`tests/worker/session-routes.test.ts` 的共享辅助（契约 §3 只写了「含 `call`、`asUser`」）定为：** 顶层 `BASE = 'https://score.example.com'`、`SECRET`、`appEnv(overrides?)`、`call(path, init?, overrides?): Promise<Response>`、`asUser(sub, extra?): Promise<Record<string, string>>`（带签名 cookie 和 `Origin: BASE`）；import 行已含 `createExecutionContext, env, waitOnExecutionContext`、`describe, expect, it`、`worker`、`SESSION_COOKIE, signSession`、`type Env`、`noAiEnv, seedUser`。后面的 PR 需要别的 import（例如 `createSession`）时在 import 区**追加一行**，不改已有的行；不重新声明上面这些顶层名字；没有顶层 `errorOf`（错误原文用 `(await res.json()).error` 或 `toEqual({ error: … })`）。
3. **用例数比契约 §9 的「约 5」多（16 个）**：10 个排除条件各占一个 `it.each` 用例（`me` / `them` 两边的 `no_show`、`excused` 都各测一次，`them` 的 `maybe`、`invited`、`out` 也各测一次），失败时能直接看出是哪一条口径坏了。HTTP 层 3 个，和「约 3」一致。
4. **PG 专属的 Discord 数据在 HTTP 测试里用 try/catch 播种**（`bindDiscordWherePossible`）：`tests/worker/**` 拿不到「当前是哪个引擎」的标志，`discord_links` 又只在 PG 里有。catch 里断言错误正是 D1 的 `no such table: discord_links`，所以不会悄悄吞掉别的错误。
5. **`MAX_INVITABLE` 照契约 §2 导出**（§7.2 说它是内部常量；导出不影响任何调用方）。本 PR 不为 500 行上限单写用例（要造 501 个用户，两个引擎各跑一遍不划算）；上限经 `LIMIT ?` 绑定，见代码。
6. **`docs/CONTRACT.md` 只加端点一条**（契约 §3：每个 PR 只改自己的端点行）。同文件 `## Worker modules` 表没有列 `worker/invitable.ts`（P2-1 的 `session-invites.ts`、P2-6 的 `session-extras.ts` 同理），建议 P2 全部合并后由一个文档 PR 一次补齐三行。
7. **PG 抖动多一条**：契约 §1 只记了 `adapter.test.ts`；规划时副本基线全套跑还见到 `tests/pg/concurrency.test.ts` 的「a yes that read the old time before a move landed …」失败 1 次（同机并行着别的 PG 套件），单独重跑通过。它测的是 `setRsvp` 的并发，和本 PR 无关。

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §8 B2-2：`GET /api/me/invitable`，登录可读 | Task 2 Step 4；Step 1「answers 401 未登录 without a session」 |
| 返回 `{ users: [...] }`，不含自己 | Task 1 Step 4；`invitable.test.ts`「is everyone but the caller, on the board or not」；`session-routes.test.ts` 第 2 条 `toEqual` |
| 非上榜的人也在（M14） | 同上两条（`friend` / `b` 是 `participant: false`） |
| 只有五个键：`id`、`username`、`avatar_url`、`is_participant`、`last_played_with_me_at`（契约 §4.2、§6 第 1 条） | Task 1 Step 4 的映射；「gives five keys and nothing else …」`Object.keys(...).sort()`；HTTP 第 2 条整体 `toEqual` |
| 不含分数、角色、邮箱；不含任何 `discord_*`（spec §8、§11 第 9 条；契约 §6 第 1 条，PG 上有绑定数据也一样） | SQL 只 SELECT 五列、不 JOIN `discord_links`（Task 1 Step 4）；两处文本 `not.toContain`；`bindDiscordWherePossible`（Task 2 Step 1）；收尾「范围核对」grep |
| `is_participant` 是真布尔（PG 上是 bigint） | 映射 `=== 1`；`toEqual` 里 `true` / `false`（两个引擎都跑） |
| `username` 是显示名 `COALESCE(display_name, username)` | 「shows the display name …」；HTTP 第 2 条 `'阿杰'` |
| `Cache-Control: private, no-store`（契约 §4.1） | Task 2 Step 4 `privateToViewer(c)`；HTTP 第 2 条 |
| 放在 `/api/me/*` 下，不被 `GET /api/users/:id` 吃掉；Node API 主机照常交给 Worker app | Task 2 Step 4 的位置和注释；Task 0 Step 2 核对 `isBindingPath` |
| 纯读：READ_ONLY 时照常可用 | HTTP 第 3 条 |
| `last_played_with_me_at` 口径（契约 §8 第 9 条）：已开局、没取消、双方 `going`、双方都没被点成 `no_show` / `excused`，未点名算到了；取最大 `starts_at` | Task 1 Step 4 的 `INVITABLE_SQL`；正例 1 条（含 `late`、`left_early`、未点名的 `open` 局、更晚的已取消局）；`it.each` 10 条排除；「counts only sessions the caller was in …」 |
| 排序（契约 §8 第 10 条）：一起玩过的在前（越近越前）→ 在榜的 → 名字 → id | 「puts who played with me first …」 |
| 无迁移（spec §8 B2-2「按 session_players 聚合」） | 文件结构：不碰 `schema.sql`、`migrations/`、`server/migrations/` |
| 两个引擎都对（契约 §0 末条、§3.4 方言） | Task 1、Task 2 的 Step 5 都跑 `vitest.pg.config.ts`；收尾 `npm run test:pg` |
| SQL 方言：无 `NULLS LAST`、`ORDER BY` 不在表达式里引用别名、ISO「现在」绑定 | Task 1 Step 4（`CASE WHEN lp.at IS NULL …` 用子查询列 `lp.at`，不是 SELECT 别名） |
| `MAX_INVITABLE = 500`（契约 §7.2、§7.4 第 2 条） | Task 1 Step 4 |
| 契约 §2 文件清单：新 `worker/invitable.ts`；改 `routes.ts`、`worker/types.ts`、`src/types.ts`、`src/api.ts`、`docs/CONTRACT.md`；新两个测试文件 | Task 1–4；收尾「范围核对」8 个文件 |
| 契约 §3 分区：`worker/types.ts` 在 `AppEnv` 之前加 `// --- P2-2 ---`；`routes.ts` 在 `/api/me/invites` 之后；`src/types.ts` 在 `// --- Sessions ---` 之前；`src/api.ts` 在 Sessions 小节末尾；`CONTRACT.md` Authenticated 小节 | Task 1 Step 3；Task 2 Step 3–4；Task 3 Step 1–3；Task 4 Step 1 |
| 契约 §3：`session-routes.test.ts` 由 P2-2 建，含 `call`、`asUser`，照抄 `http-guards.test.ts` 写法、cookie 用 `signSession` | Task 2 Step 1；「对契约的补充」第 2 条 |
| 契约 §4.5：`getInvitable(): Promise<InvitableUser[] \| undefined>`，404 → `undefined` | Task 3 Step 3 |
| 契约 §4.2 前端类型 `InvitableUser`、`InvitableResponse` | Task 3 Step 1 |
| 不碰任何组件、`worker/sessions.ts`、bot（契约 §2） | 收尾「范围核对」第一条 |
| spec §9 验收「不泄露 discord 字段，也不含分数」 | 见上「不含分数 …」一行 |
| 机主规则：新函数 < 50 行（`listInvitable` 16 行）、文件 < 800 行、无 `console.log`、无魔法数（`MAX_INVITABLE`）、不可变映射（新对象）、错误友好中文（`未登录` 来自 `requireUser`）、提交 `<type>: <中文>` 无署名 | 各 Task；收尾「范围核对」 |
| 分支：从 `claude/p1-4-docs` 开 `claude/p2-2-invitable`；不 fetch / rebase / push / PR | Task 0 Step 1 |
