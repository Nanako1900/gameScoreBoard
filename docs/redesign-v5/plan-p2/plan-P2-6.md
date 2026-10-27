# P2-6 来的人预览 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 每个返回 `SessionItem` 的地方（`GET /api/sessions` 的三个 scope、`GET /api/sessions/:id`、`GET /api/me/invites`，以及经 `getSessionDetail` 返回整局的所有写接口）都带上 `going_preview`：最多 `GOING_PREVIEW_MAX`（5）个回答是「来」的人，按 `rsvp_at` 从早到晚（同一时刻按 `user_id`），每人只有 `id`、`username`（显示名优先）、`avatar_url`，**不带分数**（spec §8 B2-6、§3.1 卡片上的「(◉)(◉)(◉) 小明 阿杰 小红」）。列表一次批量 `IN (…)` 查询，不产生 N+1；详情从已经查出的名单里推导，不多查。

**Architecture：** 新模块 `worker/session-extras.ts`（契约 §3：只放「按一批 session id 一次查出」的读函数，P2-3 往里追加）提供 `goingPreviews(db, ids)`（一条 SQL 查整页）和纯函数 `previewOfPlayers(players)`（同样的过滤、排序、截断，给详情用）。`worker/sessions.ts` 只改接线：`toSessionItem` 多一个 `preview` 参数，`listSessions`、`listMyInvites` 在拿到整页 id 后各多一次 `goingPreviews`，`getSessionDetail` 用 `previewOfPlayers(mapped)`。Node 端（`server/src/api.ts`）复用同一个 Worker app、bot 复用同一批函数，所以 D1 和 PostgreSQL 走同一段代码；SQL 只用两边都合法的写法（契约 §3.4）。前端只加可选类型 `going_preview?`，不改任何组件（头像由 P3-1 的 SessionCard 渲染，契约 §8 第 1 条）。

**Tech Stack：** TypeScript、Hono（`worker/`）、Cloudflare D1 / PostgreSQL（`server/src/db/d1.ts` 适配器）、Vitest（worker：`vitest.workers.config.ts`，Miniflare + D1；pg：`vitest.pg.config.ts` 把 `tests/worker/**` 原样跑在 PostgreSQL 上）。

**依赖：** 上游分支 `claude/p2-1-invite`（P2-2 → P2-1 已完成）。本 PR 不调用 P2-2、P2-1 的任何新函数，只依赖：① `shared/attendance.ts` 末尾已有 `// --- P2-1 ---` 小节（本 PR 的 `// --- P2-6 ---` 接在它后面）；② `tests/worker/session-routes.test.ts` 已由 P2-2 建好，顶层有 `call(path, init?, overrides?)`、`asUser(sub, extra?)` 和 `env`、`seedUser` 的 import（`plan-P2-2.md`「对契约的补充」第 2 条）；③ P2-1 改过的 `worker/sessions.ts`（`export` 了 `getSessionRow`、`requireOrganizer`、`SessionJoinRow`、`normalizeInvites`）里，本 PR 要改的六处锚点原样还在。共享契约：本目录的 [contract.md](contract.md)（下称「契约」）§2「P2-6」、§3（`worker/sessions.ts`、`worker/types.ts`、`worker/session-extras.ts`、`shared/attendance.ts`、`src/types.ts`、`docs/CONTRACT.md`、`tests/worker/session-routes.test.ts` 的分区）、§3.4、§4.1「P2-6」行、§4.2、§4.4、§6 第 2、5 条、§7.1 `session-update.test.ts` 那一行、§9「P2-6」、§10.4。spec：`docs/redesign-v5/spec.md` §8 B2-6、§3.1、§3.5（名单不显示分数）、§9 P2-6 行、§7.2 M2。

**分支：** `claude/p2-6-going-preview`，从 `claude/p2-1-invite` 的 HEAD 开（`git switch -c claude/p2-6-going-preview claude/p2-1-invite`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR、不合并。下一个 PR（P2-3 `claude/p2-3-invite-context`）从本分支开。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `shared/attendance.ts` ★ | 改（只在末尾追加） | `// --- P2-6 ---` 小节：`GOING_PREVIEW_MAX = 5` |
| `worker/session-extras.ts` | 新（74 行） | 私有 `holes(count)`（占位符串，P2-3 复用）；`goingPreviews(db, sessionIds)`：一条 SQL 查整页，返回 `Map<sessionId, RecordActor[]>`，没人来的局不在 Map 里，空 id 列表不查库；`previewOfPlayers(players)`：从已查出的名单推导，同样的过滤、顺序、截断 |
| `worker/types.ts` ★ | 改 | `interface SessionItem` 末尾加 `going_preview: RecordActor[]` |
| `worker/sessions.ts` ★ | 改（净增 7 行：+15 −8） | import `./session-extras`；`toSessionItem(row, myRsvp, preview)`；`listSessions`、`listMyInvites` 各多一次 `goingPreviews`；`getSessionDetail` 用 `previewOfPlayers(mapped)` |
| `src/types.ts` ★ | 改 | `SessionItem` 末尾加可选 `going_preview?: UserRef[]` |
| `docs/CONTRACT.md` ★ | 改 | `interface SessionItem` 加一行 `going_preview` |
| `tests/worker/going-preview.test.ts` | 新（约 214 行） | describe `goingPreviews`（4 条）、describe `going_preview`（3 条）；D1 跑一遍，pg 套件再跑一遍 |
| `tests/worker/session-routes.test.ts` | 改（只在末尾追加） | describe `going_preview over HTTP (P2-6)`（1 条）；不加 import、不动别人的 describe |

**不碰：** `worker/routes.ts`（三个路由原样返回 `listSessions` / `getSessionDetail` / `listMyInvites` 的结果）、任何组件和 CSS、`src/api.ts`（`getSessions`、`getSession`、`getMyInvites` 的返回类型本来就是 `SessionItem` / `SessionDetail`，字段自动带上）、`server/**`（bot 的 `inviteLine`、`renderSessionCard` 不读新字段）、`schema.sql`、两边的迁移、`tests/worker/sessions.test.ts`（见「对契约的补充」第 1 条）。

---

### Task 0：开分支、核对上游、记基线

**Files:** 无改动。

- [ ] **Step 1：确认上游分支存在、工作区干净，开分支**

```bash
git rev-parse --verify claude/p2-1-invite
git status --porcelain   # 期望：无输出
git switch -c claude/p2-6-going-preview claude/p2-1-invite
```

上游分支不存在或工作区不干净 → 停下报告，不要自己补 P2-2 / P2-1 的文件。

- [ ] **Step 2：核对上游交付和本 PR 的锚点**

```bash
grep -n "^// --- P2-1 ---$" shared/attendance.ts                     # 期望：一行
grep -n "GOING_PREVIEW_MAX\|// --- P2-6 ---" shared/attendance.ts    # 期望：无输出
test ! -e worker/session-extras.ts && test ! -e tests/worker/going-preview.test.ts && echo "new files absent"
grep -n "^async function call(\|^async function asUser(" tests/worker/session-routes.test.ts   # 期望：两行（P2-2 建的共享辅助）
grep -n "^import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';$" tests/worker/session-routes.test.ts   # 期望：一行
grep -n "seedUser" tests/worker/session-routes.test.ts | head -1      # 期望：import 行（from './helpers'）
grep -n "^function toSessionItem(row: SessionJoinRow, myRsvp: Rsvp | null): SessionItem {$" worker/sessions.ts
grep -n "^    my_rsvp: myRsvp,$" worker/sessions.ts
grep -n "^  const mine = await myRsvpMap($" worker/sessions.ts
grep -n "^  return rows.results.map((r) => toSessionItem(r, mine.get(r.id) ?? null));$" worker/sessions.ts
grep -n "^  return { ...toSessionItem(row, mine), players: mapped };$" worker/sessions.ts
grep -n "^  return rows.results.map((r) => toSessionItem(r, 'invited'));$" worker/sessions.ts
grep -n "^import { synthesizeTitle } from '../shared/quickTime';$" worker/sessions.ts
grep -c "toSessionItem(" worker/sessions.ts                           # 期望：4（定义 1 + 调用 3；P2-1 的 session-invites.ts 不调用它）
grep -rln "toSessionItem" worker                                    # 期望：只有 worker/sessions.ts
grep -n "my_rsvp: Rsvp | null;" worker/types.ts src/types.ts         # 期望：各一行
grep -n "^  my_rsvp: 'invited' | 'going' | 'maybe' | 'out' | null;$" docs/CONTRACT.md   # 期望：一行
```

除标了「期望：无输出」的，每条都要有输出。对不上就停下报告（属于上游 PR），不在本 PR 里补。

- [ ] **Step 3：跑基线，记下实际数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg 2>&1 | grep -E "Test Files|Tests |FAIL"
```

记为 **U0**、**D0**、**S0**、**W0**、**P0**（文件数 / 用例数）。全绿才继续；dom 的 `act(...)` 警告只有 `onboarding-roles`（DiscordLinkCard）那 3 条。期望（= P2-1 完工时，跨 PR 合成副本实测）：unit **30 / 422**、dom **25 / 317**、server **22 / 290**、worker **17 / 592 + 9 todo**、pg **29 / 873 + 9 todo**；对不上就停下报告。pg 若只有 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」超时（契约 §1 的已知抖动），单独重跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts`，4/4 通过就记下、继续。

---

### Task 1：`goingPreviews` 与 `previewOfPlayers`（一次批量查询）

**Files:**
- Create: `tests/worker/going-preview.test.ts`
- Create: `worker/session-extras.ts`
- Modify: `shared/attendance.ts`（文件末尾）

- [ ] **Step 1：写失败的测试**

新建 `tests/worker/going-preview.test.ts`，完整内容：

```ts
// P2-6: going_preview — who's coming, on every session card (spec §8 B2-6).
// Lists get it from one batch query per page (worker/session-extras.ts); the
// detail derives it from the roster it already loaded. Names and avatars only,
// never a score. Runs on D1 here and on PostgreSQL in the pg suite.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GOING_PREVIEW_MAX } from '../../shared/attendance';
import { goingPreviews, previewOfPlayers } from '../../worker/session-extras';
import { createSession, getSessionDetail, setRsvp } from '../../worker/sessions';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';

const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();

async function pair(): Promise<{ organizer: User; a: User; b: User }> {
  return {
    organizer: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
  };
}

/** datetime('now') has one-second resolution: pin answer times so the order is certain. */
async function answeredAt(sessionId: number, userId: string, at: string): Promise<void> {
  await env.DB.prepare('UPDATE session_players SET rsvp_at = ? WHERE session_id = ? AND user_id = ?')
    .bind(at, sessionId, userId)
    .run();
}

/** In answer order, ties broken by id: what every preview of crowdedSession() must show. */
const CROWD_FIRST_FIVE = ['p2', 'p4', 'org', 'p3', 'p1'];

/**
 * Ten people around one session: seven said 来 (org and p1–p6), one 待定 (m),
 * one 不来 (o), one still invited (i). m, o and i answered earliest of all.
 */
async function crowdedSession(): Promise<{ session: SessionDetail; organizer: User; invitee: User }> {
  const organizer = await seedUser({ id: 'org' });
  const going: User[] = [];
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) going.push(await seedUser({ id }));
  const maybe = await seedUser({ id: 'm' });
  const out = await seedUser({ id: 'o' });
  const invitee = await seedUser({ id: 'i' });
  const session = await createSession(env.DB, organizer, {
    title: '十人局',
    starts_at: FUTURE,
    capacity: 10,
    invite: [invitee.id],
  }, OFFSET_HOURS);
  for (const p of going) await setRsvp(env.DB, p, session.id, 'going');
  await setRsvp(env.DB, maybe, session.id, 'maybe');
  await setRsvp(env.DB, out, session.id, 'out');
  const times: Array<[string, string]> = [
    ['org', '2026-10-20 10:00:03'],
    ['p1', '2026-10-20 10:00:05'],
    ['p2', '2026-10-20 10:00:01'],
    ['p3', '2026-10-20 10:00:03'], // same second as org: the id breaks the tie ('org' < 'p3')
    ['p4', '2026-10-20 10:00:02'],
    ['p5', '2026-10-20 10:00:09'],
    ['p6', '2026-10-20 10:00:07'],
    ['m', '2026-10-20 10:00:00'],
    ['o', '2026-10-20 10:00:00'],
    ['i', '2026-10-20 10:00:00'],
  ];
  for (const [id, at] of times) await answeredAt(session.id, id, at);
  return { session, organizer, invitee };
}

/** A D1 handle that counts the statements it is asked to prepare. */
function counting(): { db: D1Database; prepared: () => number } {
  let n = 0;
  const db = {
    prepare: (sql: string) => {
      n += 1;
      return env.DB.prepare(sql);
    },
  } as unknown as D1Database;
  return { db, prepared: () => n };
}

describe('goingPreviews', () => {
  it('answers for a whole page of sessions in one query, and asks nothing for no sessions', async () => {
    const { organizer, a, b } = await pair();
    const one = await createSession(env.DB, organizer, { title: '一', starts_at: FUTURE }, OFFSET_HOURS);
    const two = await createSession(env.DB, organizer, { title: '二', starts_at: FUTURE }, OFFSET_HOURS);
    const three = await createSession(env.DB, organizer, { title: '三', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, two.id, 'going');
    await setRsvp(env.DB, b, three.id, 'maybe');
    await answeredAt(two.id, organizer.id, '2026-10-20 10:00:02');
    await answeredAt(two.id, a.id, '2026-10-20 10:00:01');

    const probe = counting();
    const previews = await goingPreviews(probe.db, [one.id, two.id, three.id]);
    expect(probe.prepared()).toBe(1);
    expect(previews.get(one.id)?.map((p) => p.id)).toEqual([organizer.id]);
    expect(previews.get(two.id)?.map((p) => p.id)).toEqual([a.id, organizer.id]);
    expect(previews.get(three.id)?.map((p) => p.id)).toEqual([organizer.id]);

    const idle = counting();
    expect((await goingPreviews(idle.db, [])).size).toBe(0);
    expect(idle.prepared()).toBe(0);
  });

  it(`keeps the first ${GOING_PREVIEW_MAX} who said 来, by answer time then id — never 待定, invited or 不来`, async () => {
    const { session } = await crowdedSession();
    const preview = (await goingPreviews(env.DB, [session.id])).get(session.id);
    expect(preview?.map((p) => p.id)).toEqual(CROWD_FIRST_FIVE);
    expect(preview).toHaveLength(GOING_PREVIEW_MAX);

    // The detail derives the same five from its roster, whatever order it holds them in.
    const detail = await getSessionDetail(env.DB, session.id, null);
    expect(previewOfPlayers([...detail.players].reverse())).toEqual(preview);
  });

  it('carries the display name and the avatar, and nothing else — never a score', async () => {
    const { organizer, a } = await pair();
    await env.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?')
      .bind('阿杰', 'https://cdn.example.com/a.png', a.id)
      .run();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await answeredAt(session.id, organizer.id, '2026-10-20 10:00:01');
    await answeredAt(session.id, a.id, '2026-10-20 10:00:02');

    const preview = (await goingPreviews(env.DB, [session.id])).get(session.id) ?? [];
    expect(preview).toEqual([
      { id: organizer.id, username: organizer.username, avatar_url: null },
      { id: a.id, username: '阿杰', avatar_url: 'https://cdn.example.com/a.png' },
    ]);
    for (const person of preview) {
      expect(Object.keys(person).sort()).toEqual(['avatar_url', 'id', 'username']);
    }
  });

  it('leaves out a session nobody is coming to', async () => {
    const { organizer } = await pair();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await env.DB.prepare("UPDATE session_players SET rsvp = 'maybe' WHERE session_id = ?")
      .bind(session.id)
      .run();
    expect((await goingPreviews(env.DB, [session.id])).has(session.id)).toBe(false);
    expect(previewOfPlayers((await getSessionDetail(env.DB, session.id, null)).players)).toEqual([]);
  });
});
```

要点：
- `datetime('now')` 只到秒，同一秒里写的几行顺序靠 `user_id` 决定，所以用例一律用 `answeredAt` 把 `rsvp_at` 钉死。`crowdedSession` 里 p2/p4/org/p3/p1 这个顺序既不是插入顺序也不是 id 顺序，`org` 和 `p3` 同一秒，验证同刻按 id。`m`（待定）、`o`（不来）、`i`（还没回）回答得最早，却一个都不能出现。
- `counting()` 包一层只数 `prepare` 次数的 D1 句柄（PG 套件里 `env.DB` 是适配器，同样有 `prepare`），直接证明「一页一条查询、空列表不查库」。
- 第二条用例把详情的 `players` 倒过来再交给 `previewOfPlayers`，证明它自己排序，不依赖 `PLAYER_SELECT` 的 `ORDER BY`。
- seed 的用户分数都是 100、有一个显示名一个头像；`Object.keys` 断言只有三个键。

- [ ] **Step 2：跑测试，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.workers.config.ts tests/worker/going-preview.test.ts
```

期望：整个文件加载失败，`Error: Cannot find module '../../worker/session-extras' imported from …/tests/worker/going-preview.test.ts`，`Test Files 1 failed (1)`、`Tests no tests`。

- [ ] **Step 3：`shared/attendance.ts` 末尾追加常量**

在文件**最末尾**（P2-1 的 `// --- P2-1 ---` 小节之后，原有导出一个不动）追加：

```ts

// --- P2-6 ---
/** People shown on a session card before "+N". */
export const GOING_PREVIEW_MAX = 5;
```

- [ ] **Step 4：新建 `worker/session-extras.ts`**

完整内容：

```ts
// Batch reads for session lists: one query per page of sessions, never one per
// session (no N+1). Every function here takes the ids of a whole page and
// answers for all of them at once with a bound `IN (…)` list.
//
// Reads only — nothing in this module writes.

import { GOING_PREVIEW_MAX } from '../shared/attendance';
import type { RecordActor, SessionPlayer } from './types';

/** `?, ?, …` for `count` values. Built from the count only — the values stay bound. */
function holes(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

// --- P2-6: going_preview -------------------------------------------------------

interface GoingPreviewRow {
  session_id: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
}

function toPreviewMap(rows: readonly GoingPreviewRow[]): Map<number, RecordActor[]> {
  const out = new Map<number, RecordActor[]>();
  for (const r of rows) {
    const list = out.get(r.session_id) ?? [];
    if (list.length >= GOING_PREVIEW_MAX) continue;
    out.set(r.session_id, [...list, { id: r.user_id, username: r.username, avatar_url: r.avatar_url }]);
  }
  return out;
}

/**
 * For each session: up to GOING_PREVIEW_MAX people whose answer is 来, earliest
 * answer first (ties by user id). Names and avatars only — never a score.
 * A session nobody is coming to has no entry. No ids, no query.
 */
export async function goingPreviews(
  db: D1Database,
  sessionIds: readonly number[],
): Promise<Map<number, RecordActor[]>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .prepare(
      `SELECT sp.session_id, sp.user_id,
              COALESCE(u.display_name, u.username) AS username, u.avatar_url
         FROM session_players sp
         JOIN users u ON u.id = sp.user_id
        WHERE sp.rsvp = 'going' AND sp.session_id IN (${holes(sessionIds.length)})
        ORDER BY sp.session_id ASC, sp.rsvp_at ASC, sp.user_id ASC`,
    )
    .bind(...sessionIds)
    .all<GoingPreviewRow>();
  return toPreviewMap(rows.results);
}

function byAnswerTime(a: SessionPlayer, b: SessionPlayer): number {
  if (a.rsvp_at !== b.rsvp_at) return a.rsvp_at < b.rsvp_at ? -1 : 1;
  if (a.user.id === b.user.id) return 0;
  return a.user.id < b.user.id ? -1 : 1;
}

/**
 * The same preview, from a roster already loaded (the detail page): same filter,
 * same order, same cut as goingPreviews — and no query.
 */
export function previewOfPlayers(players: readonly SessionPlayer[]): RecordActor[] {
  return players
    .filter((p) => p.rsvp === 'going')
    .sort(byAnswerTime)
    .slice(0, GOING_PREVIEW_MAX)
    .map((p) => ({ id: p.user.id, username: p.user.username, avatar_url: p.user.avatar_url }));
}
```

要点（对照契约 §10.4、§3.4）：
- SQL 只用两边都合法的写法：`COALESCE`、`JOIN`、`IN (?, …)`（占位符按个数生成、值全部绑定，照 `myRsvpMap`）；`ORDER BY` 只用底层列（不引用别名 `username`）；不用窗口函数，「每局前 5 个」在 JS 里截（`toPreviewMap`）。PG 里 `session_id` 是 bigint，适配器已转成 number（`myRsvpMap` 同样拿它当 Map 的键）。
- 只选 `id`、显示名、`avatar_url`，**不选 `u.score`**（对比 `PLAYER_SELECT` 选了 `u_score` 但不输出）；也不碰 `discord_*`（契约 §6 第 2 条）。
- `previewOfPlayers` 的排序和 SQL 一致：`rsvp_at` 再 `user_id`，都按码点比较（D1 是 BINARY 排序；PG 的库必须按码点排序，否则 `migrate` 拒绝启动——就是 `tests/pg/adapter.test.ts` 锁的那条）。`filter` 先产出新数组再 `sort`，不改动传入的 `players`。
- 不可变：`toPreviewMap` 每次 `set` 一个新数组。

- [ ] **Step 5：跑测试，确认通过（两个引擎）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/going-preview.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/going-preview.test.ts
npm run typecheck
```

期望：两次都是 `Tests 4 passed (4)`；typecheck 通过。

- [ ] **Step 6：提交**

```bash
git add shared/attendance.ts worker/session-extras.ts tests/worker/going-preview.test.ts
git commit -m "feat: 新增 goingPreviews，一次批量查出每局来的人"
```

---

### Task 2：每个 `SessionItem` 带上 `going_preview`

**Files:**
- Modify: `tests/worker/going-preview.test.ts`（import 区、常量区、文件末尾）
- Modify: `tests/worker/session-routes.test.ts`（只在文件末尾追加）
- Modify: `worker/types.ts`（`interface SessionItem`）
- Modify: `worker/sessions.ts`（六处锚点）

- [ ] **Step 1：在 `going-preview.test.ts` 里写失败的接线测试**

① import 区：把

```ts
import { createSession, getSessionDetail, setRsvp } from '../../worker/sessions';
```

换成

```ts
import {
  createSession,
  getSessionDetail,
  listMyInvites,
  listSessions,
  setRsvp,
} from '../../worker/sessions';
```

② 在 `const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();` 下面加一行：

```ts
const PAST = new Date(Date.now() - 3 * 3_600_000).toISOString();
```

③ 文件**末尾**追加：

```ts
describe('going_preview', () => {
  const ids = (s: { going_preview: { id: string }[] }): string[] => s.going_preview.map((p) => p.id);

  it('is on every list, the detail and the invite inbox — the same five, in the same order', async () => {
    const { session, organizer, invitee } = await crowdedSession();

    const upcoming = await listSessions(env.DB, 'upcoming', null);
    expect(upcoming.map(ids)).toEqual([CROWD_FIRST_FIVE]);
    expect((await listSessions(env.DB, 'mine', organizer.id)).map(ids)).toEqual([CROWD_FIRST_FIVE]);
    const invites = await listMyInvites(env.DB, invitee.id);
    expect(invites.map(ids)).toEqual([CROWD_FIRST_FIVE]);
    expect(invites[0].going_preview).toEqual(upcoming[0].going_preview);
    expect((await getSessionDetail(env.DB, session.id, invitee.id)).going_preview).toEqual(
      upcoming[0].going_preview,
    );

    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(PAST, session.id)
      .run();
    expect((await listSessions(env.DB, 'past', null)).map(ids)).toEqual([CROWD_FIRST_FIVE]);
  });

  it('is an empty list, not a missing one, when nobody is coming', async () => {
    const { organizer } = await pair();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await env.DB.prepare("UPDATE session_players SET rsvp = 'maybe' WHERE session_id = ?")
      .bind(session.id)
      .run();
    expect((await listSessions(env.DB, 'upcoming', null))[0].going_preview).toEqual([]);
    expect((await getSessionDetail(env.DB, session.id, null)).going_preview).toEqual([]);
  });

  it('costs the same number of queries for one session as for four', async () => {
    const { organizer, a } = await pair();
    const listed = async () => {
      const probe = counting();
      const rows = await listSessions(probe.db, 'upcoming', a.id);
      return { rows, queries: probe.prepared() };
    };
    const inbox = async () => {
      const probe = counting();
      const rows = await listMyInvites(probe.db, a.id);
      return { rows, queries: probe.prepared() };
    };

    await createSession(env.DB, organizer, { title: '一', starts_at: FUTURE, invite: [a.id] }, OFFSET_HOURS);
    const listOne = await listed();
    const inboxOne = await inbox();
    for (const title of ['二', '三', '四']) {
      await createSession(env.DB, organizer, { title, starts_at: FUTURE, invite: [a.id] }, OFFSET_HOURS);
    }
    const listFour = await listed();
    const inboxFour = await inbox();

    expect(listFour.rows).toHaveLength(4);
    expect(inboxFour.rows).toHaveLength(4);
    expect(listFour.queries).toBe(listOne.queries);
    expect(inboxFour.queries).toBe(inboxOne.queries);
    for (const s of [...listFour.rows, ...inboxFour.rows]) expect(ids(s)).toEqual([organizer.id]);
  });
});
```

要点：第一条把同一局在 `upcoming`、`mine`、`/api/me/invites` 的函数、详情、`past` 五处的预览逐一比对（契约 §9「列表、详情、`/api/me/invites` 三处一致」）；第二条证明没人来时是 `[]` 而不是缺键（服务端一律必有，契约 §4.2）；第三条是 N+1 的回归锁：一局和四局时 `listSessions`、`listMyInvites` 发出的语句数相同（只比相等、不写死条数，P2-3 往这两个函数里加批量读时不用改它）。

- [ ] **Step 2：在 `session-routes.test.ts` 末尾写失败的 HTTP 测试**

文件**末尾**追加（只用 P2-2 建的顶层 `call`、`asUser` 和已有的 `env`、`seedUser`；建局、报名都走 HTTP，所以**不加任何 import**，不动前面的 describe）：

```ts
// --- P2-6 ---
describe('going_preview over HTTP (P2-6)', () => {
  const json = { 'Content-Type': 'application/json' };

  async function postOk(path: string, sub: string, body: unknown): Promise<Response> {
    const res = await call(path, { method: 'POST', headers: await asUser(sub, json), body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    return res;
  }

  /** The raw body of a 200 GET, anonymous unless `sub` is given. */
  async function textOf(path: string, sub?: string): Promise<string> {
    const res = await call(path, sub ? { headers: await asUser(sub) } : {});
    expect(res.status).toBe(200);
    return res.text();
  }

  async function answeredAt(sessionId: number, userId: string, at: string): Promise<void> {
    await env.DB.prepare('UPDATE session_players SET rsvp_at = ? WHERE session_id = ? AND user_id = ?')
      .bind(at, sessionId, userId)
      .run();
  }

  it('rides on /api/sessions, /api/sessions/:id and /api/me/invites — names and avatars, never a score', async () => {
    await seedUser({ id: 'org', score: 87 });
    await seedUser({ id: 'fan', score: 64 });
    await seedUser({ id: 'guest' });
    await env.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?')
      .bind('阿杰', 'https://cdn.example.com/fan.png', 'fan')
      .run();
    const created = await postOk('/api/sessions', 'org', {
      starts_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      invite: ['guest'],
    });
    const id = ((await created.json()) as { session: { id: number } }).session.id;
    await postOk(`/api/sessions/${id}/rsvp`, 'fan', { rsvp: 'going' });
    await answeredAt(id, 'org', '2026-10-20 10:00:01');
    await answeredAt(id, 'fan', '2026-10-20 10:00:02');
    const expected = [
      { id: 'org', username: 'org', avatar_url: null },
      { id: 'fan', username: '阿杰', avatar_url: 'https://cdn.example.com/fan.png' },
    ];

    const list = await textOf('/api/sessions');
    expect(list).not.toContain('score');
    expect((JSON.parse(list) as { sessions: { going_preview?: unknown }[] }).sessions[0].going_preview).toEqual(
      expected,
    );

    const detail = await textOf(`/api/sessions/${id}`);
    expect(detail).not.toContain('score');
    expect((JSON.parse(detail) as { session: { going_preview?: unknown } }).session.going_preview).toEqual(expected);

    const inbox = await textOf('/api/me/invites', 'guest');
    expect(inbox).not.toContain('score');
    expect((JSON.parse(inbox) as { sessions: { going_preview?: unknown }[] }).sessions[0].going_preview).toEqual(
      expected,
    );
  });
});
```

要点：公开列表、详情（匿名）和本人的邀请收件箱三个端点，响应**原文**里都没有 `score`（`org`、`fan` 的分数特意不是 100，真漏了也能看出来），`going_preview` 是显示名优先、带头像、恰好三个键。

- [ ] **Step 3：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/going-preview.test.ts tests/worker/session-routes.test.ts
npx tsc -p tsconfig.worker.json --noEmit 2>&1 | head -3
```

期望：新加的 **4 条失败**，其余全过（Task 1 的 4 条、P2-2 和 P2-1 在 `session-routes` 里的用例）：
- `going_preview > is on every list, the detail and the invite inbox — the same five, in the same order` → `TypeError: Cannot read properties of undefined (reading 'map')`
- `going_preview > is an empty list, not a missing one, when nobody is coming` → `AssertionError: expected undefined to deeply equal []`
- `going_preview > costs the same number of queries for one session as for four` → `TypeError: Cannot read properties of undefined (reading 'map')`
- `going_preview over HTTP (P2-6) > rides on /api/sessions, …` → `AssertionError: expected undefined to deeply equal [ { id: 'org', …(2) }, …(1) ]`

`tsc` 此时报 `tests/worker/going-preview.test.ts` 的 `TS2345`（`ids` 的参数类型和 `SessionItem` 对不上）和 `TS2339`（`Property 'going_preview' does not exist on type 'SessionItem'`）——预期之内，Step 4 之后消失。

- [ ] **Step 4：`worker/types.ts` 加字段**

把

```ts
  /** The caller's own RSVP, when authenticated. */
  my_rsvp: Rsvp | null;
}
```

换成

```ts
  /** The caller's own RSVP, when authenticated. */
  my_rsvp: Rsvp | null;
  /** P2-6: up to GOING_PREVIEW_MAX people whose answer is 来, earliest answer first. Names and avatars only. */
  going_preview: RecordActor[];
}
```

（`RecordActor` 就在同一文件里，`{ id; username; avatar_url }`。）

- [ ] **Step 5：`worker/sessions.ts` 接线（六处，全部按锚点）**

① import：在 `import { synthesizeTitle } from '../shared/quickTime';` 下面加一行

```ts
import { goingPreviews, previewOfPlayers } from './session-extras';
```

② `toSessionItem` 的签名：把

```ts
function toSessionItem(row: SessionJoinRow, myRsvp: Rsvp | null): SessionItem {
```

换成

```ts
function toSessionItem(
  row: SessionJoinRow,
  myRsvp: Rsvp | null,
  preview: SessionItem['going_preview'],
): SessionItem {
```

（用 `SessionItem['going_preview']` 而不是 `RecordActor[]`：不用碰 `import type { … } from './types'` 那一列，少一处和上下游的冲突。）

③ 同一函数的返回对象：把

```ts
    my_rsvp: myRsvp,
  };
}
```

换成

```ts
    my_rsvp: myRsvp,
    going_preview: preview,
  };
}
```

④ `listSessions` 末尾：把

```ts
  const mine = await myRsvpMap(
    db,
    callerId,
    rows.results.map((r) => r.id),
  );
  return rows.results.map((r) => toSessionItem(r, mine.get(r.id) ?? null));
```

换成

```ts
  const ids = rows.results.map((r) => r.id);
  const mine = await myRsvpMap(db, callerId, ids);
  const previews = await goingPreviews(db, ids);
  return rows.results.map((r) =>
    toSessionItem(r, mine.get(r.id) ?? null, previews.get(r.id) ?? []),
  );
```

⑤ `getSessionDetail` 的返回：把

```ts
  return { ...toSessionItem(row, mine), players: mapped };
```

换成

```ts
  return { ...toSessionItem(row, mine, previewOfPlayers(mapped)), players: mapped };
```

⑥ `listMyInvites` 的返回：把

```ts
  return rows.results.map((r) => toSessionItem(r, 'invited'));
```

换成

```ts
  const previews = await goingPreviews(db, rows.results.map((r) => r.id));
  return rows.results.map((r) => toSessionItem(r, 'invited', previews.get(r.id) ?? []));
```

两次查询顺序 `await`（不用 `Promise.all`）：PG 适配器下并发查询没有收益，顺序写和 `myRsvpMap` 的现有风格一致。`createSession`、`updateSession`、`cancelSession`、`setRsvp`、`rollCall`、`settleSession`、P2-1 的 `inviteToSession` 都经 `getSessionDetail` 返回整局，自动带上 `going_preview`，不用改。

- [ ] **Step 6：跑测试，确认通过（两个引擎）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/going-preview.test.ts tests/worker/session-routes.test.ts
npx vitest run --config vitest.pg.config.ts tests/worker/going-preview.test.ts tests/worker/session-routes.test.ts
npm run typecheck
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
```

期望：两个引擎上这两个文件全过，`Tests 15 passed (15)`（`going-preview` 7 条 + `session-routes` 里 P2-2 的 3 条、P2-1 的 4 条 + 本 PR 1 条）；typecheck 通过；worker 全量 **W0 文件数 + 1、W0 用例数 + 8**（合成副本：18 / 600），`9 todo` 不变。全量里 `tests/worker/session-update.test.ts` 那几条整行 `toEqual`（契约 §7.1：`:239`、`:249-250`、`:269`、`:383`）原样通过——`updateSession(…, {})` 和 `getSessionDetail` 两次都由 `previewOfPlayers` 从同一份名单推导，相等。

- [ ] **Step 7：提交**

```bash
git add worker/types.ts worker/sessions.ts tests/worker/going-preview.test.ts tests/worker/session-routes.test.ts
git commit -m "feat: 每个 SessionItem 带 going_preview（列表、详情、邀请收件箱）"
```

---

### Task 3：前端类型与 `docs/CONTRACT.md`

**Files:**
- Modify: `src/types.ts`（`interface SessionItem`）
- Modify: `docs/CONTRACT.md`（`interface SessionItem`）

本任务只有类型和文档，没有可以先红的行为测试；验证靠 typecheck 和 dom 全量（现有 fixture 都没有这个字段，必须仍能编译、仍全过）。

- [ ] **Step 1：`src/types.ts` 加可选字段**

把

```ts
  counts: { invited: number; going: number; maybe: number; out: number };
  my_rsvp: Rsvp | null;
}
```

换成

```ts
  counts: { invited: number; going: number; maybe: number; out: number };
  my_rsvp: Rsvp | null;
  /** P2-6: up to 5 who said 来, earliest answer first — names and avatars, never a score. Absent from an older API: show no avatars. */
  going_preview?: UserRef[];
}
```

（这段只在 `SessionItem` 里出现一次。可选是契约 §3 / §4.2 的规定：旧后端没有它、现有 dom fixture 也没有；缺字段 = 不显示头像。）

- [ ] **Step 2：`docs/CONTRACT.md` 加一行**

在 `interface SessionItem {` 那段里，把

```ts
  my_rsvp: 'invited' | 'going' | 'maybe' | 'out' | null;
}
```

换成

```ts
  my_rsvp: 'invited' | 'going' | 'maybe' | 'out' | null;
  going_preview: { id: string; username: string; avatar_url: string | null }[];  // up to GOING_PREVIEW_MAX (5) who said 来, earliest answer first; never a score
}
```

- [ ] **Step 3：验证**

```bash
npm run typecheck
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
```

期望：typecheck 通过；dom 仍是 **D0**，`act(...)` 警告仍是 3 条。

- [ ] **Step 4：提交**

```bash
git add src/types.ts docs/CONTRACT.md
git commit -m "feat: 前端 SessionItem 加可选 going_preview，CONTRACT.md 补字段说明"
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
npm run build:pages && test ! -e dist/404.html && echo "no 404.html"
```

期望（相对 Task 0 记下的基线）：

| 套件 | 文件 | 用例 | 新增来源 |
|---|---|---|---|
| unit | U0 | U0 | — |
| dom | D0 | D0（`act` 警告 3 条） | — |
| server | S0 | S0 | — |
| worker（D1） | W0 + 1 | W0 + 8（+ 9 todo 不变） | `going-preview.test.ts` 7、`session-routes.test.ts` 1 |
| pg | P0 + 1 | P0 + 8（+ 9 todo 不变） | 同上（`tests/worker/**` 在 PG 上再跑一遍） |

pg 若只有 `tests/pg/adapter.test.ts` 那条超时，单独重跑那个文件确认 4/4，记进 PR 描述（契约 §1）。

**跨 PR 合成副本的实测**（P0 + P1 规划副本依次套上 P2-2、P2-1 的最终计划和本计划；规划者当初是在模拟的上游上自检的，worker 16/561、pg 28/839 那组绝对数字已作废，增量一致）：
- 基线：unit 30/422、dom 25/317（`act` 3 条）、server 22/290、worker 17 / 592 + 9 todo、pg 29 / 873 + 9 todo。
- Task 1 Step 2：`Cannot find module '../../worker/session-extras'`，`Tests no tests`。Step 5：D1、PG 各 4/4；typecheck 通过。
- Task 2 Step 3：两个文件 `4 failed | 11 passed (15)`，失败的正是上面列的四条；`tsc` 报 `TS2345`、`TS2339`。Step 6：D1、PG 各 15/15；worker 全量 18 / 600 + 9 todo（+1 文件、+8 用例）。
- 收尾：typecheck 通过；unit 30/422、dom 25/317（`act` 3 条）、server 22/290 不变；worker **18 / 600 + 9 todo**；pg **30 / 881 + 9 todo 全过**；`npm run build`、`npm run build:pages` 通过，`dist/` 无 `404.html`。

- [ ] **范围核对**

```bash
git diff --stat claude/p2-1-invite                 # 期望：正好「文件结构」表里的 8 个文件
git diff --stat claude/p2-1-invite -- worker/routes.ts src/components src/api.ts server schema.sql migrations server/migrations tests/worker/sessions.test.ts   # 期望：无输出
git diff claude/p2-1-invite -- shared/attendance.ts | grep "^-[^-]"                 # 期望：无输出（只追加）
git diff claude/p2-1-invite -- tests/worker/session-routes.test.ts | grep "^-[^-]"  # 期望：无输出（只在末尾追加）
git diff claude/p2-1-invite -- worker/sessions.ts | grep -c "^+[^+]"               # 期望：15（另有 8 行删除，净增 7）
grep -n "score" worker/session-extras.ts                                            # 期望：只有注释里的「never a score」
grep -rn "console.log" worker/session-extras.ts tests/worker/going-preview.test.ts  # 期望：无输出
git log --format=%B claude/p2-1-invite..HEAD | grep -ciE "co-authored|generated with"   # 期望：0
```

- [ ] **给机主的 PR 描述要点**：一句话说明（每个 `SessionItem` 多 `going_preview`，最多 5 人、按回答先后、只有名字和头像）；没有迁移、没有界面（头像在 P3-1 的 SessionCard 上屏）；查询次数不随局数增长（附 `costs the same number of queries…` 用例）；两个引擎的数字；下面「对契约的补充」第 1–3 条请机主过目。

## 对契约的补充

1. **测试放在新文件 `tests/worker/going-preview.test.ts`，没有追加进 `tests/worker/sessions.test.ts`。** 契约 §2「P2-6」写的是「追加 `sessions.test.ts`（新 describe `going_preview`）」，但那个文件在基线上已经 792 行，本 PR 的用例连同辅助（`crowdedSession`、`answeredAt`、`counting`）约 200 行，追加后约 990 行，超过机主规则的 800 行上限。契约 §8 第 8 条对 P2-3 用的是同一个理由（「`sessions.test.ts` 792 行」→ 新文件）。新文件只属于本 PR，不和任何上下游 PR 冲突；`vitest.pg.config.ts` 的 `include` 是 `tests/worker/**/*.test.ts`，PG 照样跑。describe 名仍叫 `going_preview`（另有一组 `goingPreviews` 直接测批量函数）；用例数 7（契约 §9 计划「约 3」，多出来的是批量函数本身的单测和 N+1 回归锁）。
2. **`worker/session-extras.ts` 多导出一个纯函数 `previewOfPlayers(players)`。** 契约 §10.4 写「`getSessionDetail` 不调用 `goingPreviews`：从已查出的 players 里 filter going、按 rsvp_at、user_id 排序、截 5（同一顺序）」，没说这段写在哪。放在 `goingPreviews` 旁边，两种算法（SQL `ORDER BY` 和 JS 比较函数）挨着、改一处就看得见另一处，`sessions.ts` 也只多一个调用（契约 §0：`sessions.ts` 只改接线）。它不查库、不写库，不违反「只放批量读」的分区规则。另有私有的 `holes(count)` 占位符助手，P2-3 追加 `attendanceSummaries`、`inviteContexts` 时可以直接用。
3. **`session-routes.test.ts` 的 P2-6 describe 不加任何 import。** 建局用 `POST /api/sessions`（带 `invite`）、报名用 `POST /api/sessions/:id/rsvp`，都经 P2-2 的 `call` + `asUser`；`rsvp_at`、显示名、头像用顶层已有的 `env` 直接写。这样 P2-3 在这个文件里追加 `import { createSession, … } from '../../worker/sessions'` 时不会和本 PR 撞名（P2-2 计划「对契约的补充」第 2 条：后来的 PR 各自追加 import 行、不改已有的行）。
4. **`toSessionItem` 的新参数类型写成 `SessionItem['going_preview']`**，不往 `worker/sessions.ts` 的 `import type { … } from './types'` 列表里加 `RecordActor`：效果相同，少碰一处共享区域。
5. **`going_preview` 的口径**：组织者建局时自动是 `going`，所以通常也在预览里（按他的 `rsvp_at` 排位，不强制排第一）；不在榜的人（`is_participant = 0`）也照常出现（名单本来就公开，spec §3.5 只要求不显示分数）。`counts.going` 仍是总人数，前端「+N」= `counts.going - going_preview.length`。
6. **D1 的绑定参数上限**：`goingPreviews` 绑定的参数个数 = 这一页的局数。`listSessions` 的 `limit` 被夹在 1–100（路由固定用默认 50），`listMyInvites` 是 `LIMIT 20`，P2-3 的历史页是 `SESSION_HISTORY_PAGE = 20`，都不超过 D1 每条语句 100 个参数的上限。以后谁把页长调到 100 以上，要同时给这里分批。
7. **不改 `worker/routes.ts`、`src/api.ts`、任何组件**（契约 §3 表：P2-6 不碰 routes；§8 第 1 条：头像界面在 P3-1）。`server/src/discord/commands.ts` 的 `inviteLine` 和 bot 卡片只读旧字段，`server/test/session-render.test.ts` 的 fixture 是 `as SessionDetail` 断言，新增必填字段不影响编译（规划时 `test:server` 22/290 不变）。

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §8 B2-6：`[{id, username, avatar_url}]`、最多 5 个 | Task 1 Step 3（`GOING_PREVIEW_MAX`）、Step 4（`toPreviewMap` 截断）；用例 `keeps the first 5 …`、`carries the display name …`（`Object.keys` 三个键） |
| 按 `rsvp_at` 排序（同刻按 `user_id`） | Task 1 Step 4 SQL `ORDER BY sp.session_id, sp.rsvp_at, sp.user_id`、`byAnswerTime`；`crowdedSession` 的 p2/p4/org/p3/p1（含同一秒的并列） |
| **不带分数**（spec §8、§3.1、§3.5；契约 §6 第 5 条） | SQL 不选 `u.score`；HTTP 用例三个端点的原文 `not.toContain('score')`；范围核对 `grep score` |
| 只有回答「来」的人；`maybe` / `invited` / `out` 不在里面（契约 §9） | SQL `WHERE sp.rsvp = 'going'`、`previewOfPlayers` 的 `filter`；`crowdedSession` 里 m、o、i 回答最早仍不出现 |
| 一次批量 `IN (…)` 查询，避免 N+1（spec §8 B2-6、§10.4） | `goingPreviews` 一条 SQL；用例 `answers for a whole page … in one query`（`prepared() === 1`、空列表 0）和 `costs the same number of queries for one session as for four` |
| 空 id 列表不查库（契约 §10.4） | `goingPreviews` 首行早返回；`idle.prepared() === 0` |
| 详情从已查出的 `players` 推导、不多查、同一顺序（契约 §3、§10.4） | Task 2 Step 5 ⑤；用例里倒序名单交给 `previewOfPlayers` 结果相同；列表与详情 `toEqual` |
| `toSessionItem(row, myRsvp, preview)`；`listSessions`、`listMyInvites` 各多一次 `goingPreviews`（契约 §3） | Task 2 Step 5 ②–④、⑥ |
| 列表、详情、`/api/me/invites` 三处一致（契约 §9） | 用例 `is on every list, the detail and the invite inbox …`（另含 `mine`、`past`）；HTTP 用例三个端点同一 `expected` |
| 服务端一律必有、没人来时是 `[]`（契约 §4.2） | `previews.get(r.id) ?? []`；用例 `is an empty list, not a missing one …` |
| `worker/types.ts`：`going_preview: RecordActor[]`（契约 §4.2） | Task 2 Step 4 |
| `src/types.ts`：可选 `going_preview?: UserRef[]`；缺 = 不显示头像（契约 §3、§4.2） | Task 3 Step 1；dom 全量不变 |
| `shared/attendance.ts` 只追加 `// --- P2-6 ---`（契约 §3、§4.4） | Task 1 Step 3；范围核对 `grep "^-[^-]"` 无输出 |
| `docs/CONTRACT.md` 只改 `interface SessionItem` 一行（契约 §3） | Task 3 Step 2 |
| `session-routes.test.ts` 只在末尾追加一个 describe（契约 §3） | Task 2 Step 2；范围核对 |
| 两个引擎：D1 worker 测试 + PG 套件（契约 §0、§1） | Task 1 Step 5、Task 2 Step 6 各跑 `vitest.pg.config.ts`；收尾 `npm run test:pg` |
| SQL 方言两边合法（契约 §3.4：`ORDER BY` 不引用别名、不用窗口函数、`IN` 占位符按个数生成） | Task 1 Step 4 要点 |
| `session-update.test.ts` 整行 `toEqual` 仍成立（契约 §7.1） | Task 2 Step 6 worker 全量 |
| 无迁移（spec §8 B2-6） | 范围核对：`schema.sql`、`migrations`、`server/migrations` 无改动 |
| 不改组件、不改 routes（契约 §2、§3、§8 第 1 条） | 范围核对 |
| `worker/sessions.ts` 只改接线、P2 全程净增不超过约 90 行（契约 §0） | 本 PR 净增 7 行；新逻辑在 `session-extras.ts` |
| 机主规则：不可变（`toPreviewMap` 每次新数组、`filter` 后再排序）、新文件 < 800 行、函数 < 50 行、无 `console.log`、无魔法数（`GOING_PREVIEW_MAX` 在 shared）、提交 `<type>: <中文>` 无署名 | 各 Task；收尾「范围核对」 |
| 每个 PR 收尾跑六个套件 + build（契约 §1、§9） | 收尾「完整验证」 |
| 分支：从 `claude/p2-1-invite` 开 `claude/p2-6-going-preview`，不 fetch / rebase / push / PR | Task 0 Step 1；「分支」 |
