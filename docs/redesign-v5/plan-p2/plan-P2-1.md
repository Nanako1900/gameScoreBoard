# P2-1 建局后再叫人 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 组织者（或管理员）在约局建好之后、开局之前，还能再叫人：新接口 `POST /api/sessions/:id/invite { user_ids }` 把新的人写成 `invited`（已经在局里的行——来、待定、不来、还没回——一律不动），返回 `{ session, added, skipped }`；在 PostgreSQL 上每个新行照旧由触发器发一条邀请私信、受同样的额度。前端加 `api.ts` 的 `inviteToSession`，并在**现有**约局详情弹窗的组织者操作区挂一个最简版「＋ 再叫几个人」入口和 `InviteSheet`（名单来自 P2-2 的 `GET /api/me/invitable`；接口 404 时入口静默不出现）。

**Architecture:** 后端逻辑放新模块 `worker/session-invites.ts`（`worker/sessions.ts` 已 985 行，只导出四个现有的内部函数 / 类型、把常量改成从 `shared/` 引入）：先权限后状态（`requireOrganizer` → open → 没开局），再校验 `user_ids`（复用加了 `field` 参数的 `normalizeInvites`），名单上限 `MAX_SESSION_ROSTER = 50` 先友好检查一次，写入时在一个 `db.batch` 里先 `UPDATE … SET status = status` 拿行锁、再逐人 `INSERT … SELECT … WHERE 还开着 AND 名单没满 ON CONFLICT DO NOTHING`，`added` = 各 INSERT 的 `changes` 之和。PG 触发器、dispatcher 逻辑一行不改，只把 `INVITES_PER_ORGANIZER` 改为从 `shared/attendance.ts` 引入并原处 re-export。前端：纯模块 `src/lib/invitePicker.ts`（分组、勾选上限、toast 文案）、hook `src/lib/useInvitable.ts`（只在组织者 / 管理员看开局前的 open 局时请求一次；404 → `unsupported`）、组件 `InviteSheet`（`Modal variant="sheet" historyKey="invite"`，返回键关闭），`SessionDetailDialog` 只按契约 3.1 接线。

**Tech Stack:** Cloudflare Worker + Hono + D1（`tests/worker/**`，Miniflare）；Node + PostgreSQL（同一批 worker 测试经 `server/src/db/d1.ts` 适配器跑在 PG 上，加 `tests/pg/**`）；React 18 + TypeScript + Vite；vitest（unit / dom / server / worker / pg 五套配置）；@testing-library/react + user-event。

**依赖:** P2 共享契约 本目录的 [contract.md](contract.md)（下称「契约」）：§0 规则、§1 基线、§2「P2-1」、§3 分区（`worker/sessions.ts`、`worker/routes.ts`、`worker/types.ts`、`shared/attendance.ts`、`server/src/outbox/dispatcher.ts`、`src/types.ts`、`src/api.ts`、`docs/CONTRACT.md`、`tests/worker/session-routes.test.ts`、`tests/pg/session-cards.test.ts`）、§3.1（`SessionDetailDialog.tsx` 只有 P2-1）、§3.2（PG 触发器不改）、§3.4（SQL 方言）、§4.1、§4.2、§4.3（`/invite` 的校验顺序与错误）、§4.4、§4.5、§4.6（界面）、§6 第 2 条、§7.1、§7.2、§8 第 6、8、12、14 条、§9「P2-1」。spec `docs/redesign-v5/spec.md`：§3.5（InviteSheet 线框与文案）、§4.1 ②、§4.3、§8 B2-1、§9 P2-1、§11 第 9 条。上游 **P2-2**（`plan-P2-2.md`）必须已经在上游分支上：`worker/invitable.ts` 的 `listInvitable`、`GET /api/me/invitable`、两边的 `InvitableUser`、`src/types.ts` 的 `InvitableResponse`、`src/api.ts` 的 `getInvitable`（404 → `undefined`）、`tests/worker/session-routes.test.ts` 及其顶层辅助 `call(path, init?, overrides?)`、`asUser(sub, extra?)`。**本 PR 和 P2-2 一起合并、一起部署**（契约 §2 第 1 条）。

**分支:** `claude/p2-1-invite`，从 `claude/p2-2-invitable` 的 HEAD 开（`git switch -c claude/p2-1-invite claude/p2-2-invitable`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR、不合并。下一个 PR（P2-6 `claude/p2-6-going-preview`）从本分支开。

---

## 文件结构

所有路径相对仓库根目录。行号只作参考，**一律按引用的锚点文字定位**。★ = 契约 §3 的共享文件，只动本 PR 的分区。

| 文件 | 新/改 | 职责 |
|---|---|---|
| `shared/attendance.ts` ★ | 改（末尾追加 `// --- P2-1 ---`） | `MAX_INVITES`（20）、`MAX_SESSION_ROSTER`（50）、`INVITES_PER_ORGANIZER`（3）——值和原来一字不差 |
| `worker/sessions.ts` ★ | 改（7 处小改，净增 7 行） | import 两个常量；`MAX_ROLLCALL_ENTRIES = MAX_SESSION_ROSTER`；`export { MAX_INVITES } from '../shared/attendance'`；`SessionJoinRow`、`getSessionRow`、`requireOrganizer`、`normalizeInvites` 加 `export`；`normalizeInvites` 加 `field` 参数（默认 `'invite'`，`createSession` 的文案不变） |
| `worker/session-invites.ts` | 新（86 行） | `inviteToSession(db, caller, id, rawUserIds): Promise<InviteResult>`：校验顺序见契约 §4.3，写入见契约 §4.3 的 batch |
| `worker/types.ts` ★ | 改（`AppEnv` 之前，P2-2 的 `InvitableUser` 之后） | `InviteResult` |
| `worker/routes.ts` ★ | 改 | import `inviteToSession`；`app.post('/api/sessions/:id/cancel'` 之后加 `app.post('/api/sessions/:id/invite'` |
| `server/src/outbox/dispatcher.ts` | 改（只动 `INVITES_PER_ORGANIZER` 那两行和 import 区一行） | 改为从 shared 引入并原处 re-export；`BUDGETS`、`invitesFrom`、`renderDm` 不动 |
| `docs/CONTRACT.md` ★ | 改（`**Sessions**` 小节 `/cancel` 下面加一条） | `/invite` 的契约 |
| `src/types.ts` ★ | 改（`SettleResponse` 之后） | `InviteResponse` |
| `src/api.ts` ★ | 改（`// --- Sessions ---` 小节末尾、P2-2 的 `getInvitable` 之后） | `inviteToSession(id, userIds)` |
| `src/lib/invitePicker.ts` | 新（纯，45 行） | `inviteGroups`、`toggleInvite`、`inviteToast` 及类型 |
| `src/lib/useInvitable.ts` | 新（58 行） | `useInvitable(enabled)` → `{ state, reload }`，导出 `InvitableState`、`Invitable` |
| `src/components/InviteSheet.tsx` + `invite-sheet.css` | 新（182 + 92 行） | 最简版「再叫几个人」：两组 checkbox、置灰「已在局里 / 说了不来」、20 人上限、规则说明、提交与错误 |
| `src/components/SessionDetailDialog.tsx` ★ | 改（契约 3.1 的 7 点，475 → 510 行） | 入口、状态、`handleInvited`、渲染 sheet |
| `tests/worker/invites.test.ts` | 改（import 区 + 末尾新 describe，9 个用例） | D1 / PG 两边的写入规则 |
| `tests/worker/session-routes.test.ts` ★ | 改（末尾新 describe，4 个用例） | HTTP 层：形状、401、400/404/403、CSRF / READ_ONLY |
| `tests/pg/session-cards.test.ts` ★ | 改（import 区两行 + 末尾 describe `invites after creation`，3 个用例） | 后叫的人收到一条邀请私信、再叫不重发、说了不来的不再发、共用组织者每天 3 条 |
| `tests/unit/invite-picker.test.ts` | 新（8 个用例） | 纯规则 |
| `tests/dom/invite-sheet.test.tsx` | 新（18 个用例） | sheet 本身 7 个；详情弹窗里的入口 11 个（含 404 降级、四种不发请求、返回键、只有一个「来」） |

不碰：`worker/invitable.ts`（P2-2）、任何迁移 / `schema.sql` / PG 触发器（契约 §3.2）、`server/src/discord/*`、`src/components/SessionsPanel.tsx`、`SessionFormDialog.tsx`、`RescheduleSheet.tsx`、`App.tsx`、`InviteBanner.tsx`、`Modal.tsx`、`src/lib/router.ts`、`theme.css`、`tests/dom/setup.ts`、`tests/dom/history.ts`、任何现有测试的断言。

---

### Task 0：开工核对

**Files:** 无改动（只读核对）。

- [ ] **Step 1：确认上游分支、工作区干净，开分支**

```bash
git status --short                          # 期望：无输出
git branch --list claude/p2-2-invitable     # 期望：列出这个分支
git switch -c claude/p2-1-invite claude/p2-2-invitable
git log --oneline -1                        # 记下起点 commit（P2-2 的最后一个提交「docs: …」）
```

上游分支不存在或工作区不干净 → 停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对本 PR 消费的 P2-2 接口和要改的锚点都在**

```bash
grep -n "export async function listInvitable" worker/invitable.ts                 # 期望 1 行
grep -n "app.get('/api/me/invitable'" worker/routes.ts                            # 期望 1 行
grep -nx "import { listInvitable } from './invitable';" worker/routes.ts          # 期望 1 行
grep -n "export interface InvitableUser" worker/types.ts src/types.ts             # 期望 2 行
grep -n "export interface InvitableResponse" src/types.ts                         # 期望 1 行
grep -n "export async function getInvitable(): Promise<InvitableUser\[\] | undefined>" src/api.ts   # 期望 1 行
grep -nE "^  InvitableUser,$" src/api.ts                                          # 期望 1 行（import type 列表里）
grep -nE "^async function (call|asUser)\(" tests/worker/session-routes.test.ts    # 期望 2 行
grep -n "^import type { Env } from '../../worker/types';" tests/worker/session-routes.test.ts      # 期望 1 行
grep -nE "^const MAX_ROLLCALL_ENTRIES = 50;|^export const MAX_INVITES = 20;|^interface SessionJoinRow|^async function getSessionRow|^function requireOrganizer|^function normalizeInvites" worker/sessions.ts   # 期望 6 行
grep -n "^export const INVITES_PER_ORGANIZER = 3;" server/src/outbox/dispatcher.ts   # 期望 1 行
grep -n "MAX_INVITES\|MAX_SESSION_ROSTER\|INVITES_PER_ORGANIZER" shared/attendance.ts   # 期望：无输出
ls worker/session-invites.ts src/lib/invitePicker.ts src/lib/useInvitable.ts src/components/InviteSheet.tsx 2>&1 | grep -c "No such file"   # 期望 4
```

任何一条对不上（尤其 P2-2 的 `call` / `asUser` 签名、`getInvitable` 的 404 语义）→ 停下报告，不要自己改 P2-2 的文件。

- [ ] **Step 3：跑基线，记下数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -c "not wrapped in act"
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg 2>&1 | grep -E "Test Files|Tests |FAIL"
```

记为 **U0 / D0 / A0 / S0 / W0 / G0**。期望（= P2-2 完工时，`plan-P2-2.md`「收尾」表；规划时在副本上实测一致）：typecheck 通过；unit **29 / 414**；dom **24 / 299**；`act` 警告 **3** 条（都是 `onboarding-roles`）；server **22 / 290**；worker **17 / 579 passed + 9 todo**；pg **29 / 857 passed + 9 todo**。

> PG 的已知抖动（契约 §1）：机器负载高时 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」会撞 5 秒超时；`plan-P2-2.md` 还记过 `tests/pg/concurrency.test.ts` 的一次偶发失败（同机有别的 PG 套件在跑）。遇到这两条之一：单独重跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts tests/pg/concurrency.test.ts`，通过就按上面的数记，并记进 PR 描述。别的红 → 停下。

---

### Task 1：`inviteToSession` 的写入规则（常量进 shared，D1 + PG）

**Files:**
- Modify: `shared/attendance.ts`（末尾追加 `// --- P2-1 ---`）
- Modify: `worker/sessions.ts`（7 处，见 Step 4）
- Modify: `worker/types.ts`（`AppEnv` 之前加 `InviteResult`）
- Create: `worker/session-invites.ts`
- Test: `tests/worker/invites.test.ts`（import 区 + 末尾新 describe）

- [ ] **Step 1：写失败的测试**

先改 import 区。`tests/worker/invites.test.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
import { synthesizeTitle } from '../../shared/quickTime';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  setRsvp,
} from '../../worker/sessions';
import { OFFSET_HOURS, seedUser } from './helpers';
```

改成：

```ts
import { synthesizeTitle } from '../../shared/quickTime';
import { MAX_INVITES as SHARED_MAX_INVITES, MAX_SESSION_ROSTER } from '../../shared/attendance';
import {
  MAX_INVITES,
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  setRsvp,
} from '../../worker/sessions';
import { inviteToSession } from '../../worker/session-invites';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';
```

再追加新 describe（9 个用例：新的人进 `invited` 且出现在他自己的 `listMyInvites` 里；已有的行一律不动（`rsvp`、`rsvp_at` 原样）；未知 id 计入 `skipped`；去重、去掉**这局的**组织者（管理员调用时也是）、只剩组织者时 200 / `added: 0`；陌生人 403（已取消的局也先 403）、404；已取消 / 已结算 / 已开局 400，且先于名单校验；名单校验的四种 400 和 `createSession` 的 `invite` 文案不变；名单上限 50；常量来自 shared）。在 `tests/worker/invites.test.ts` 的**文件末尾**（最后一行 `});` 之后）空一行，追加：

```ts
// --- P2-1: inviting more people after creation (spec §8 B2-1, P2 contract 4.3) ---

describe('inviteToSession — inviting more people after creation', () => {
  const open = (organizer: User, invite: string[] = []): Promise<SessionDetail> =>
    createSession(env.DB, organizer, { starts_at: FUTURE, invite }, OFFSET_HOURS);
  const rsvpOf = (s: SessionDetail, id: string): string | null =>
    s.players.find((p) => p.user.id === id)?.rsvp ?? null;
  const rows = async (sessionId: number) =>
    (
      await env.DB.prepare(
        'SELECT user_id, rsvp, rsvp_at FROM session_players WHERE session_id = ? ORDER BY user_id',
      )
        .bind(sessionId)
        .all()
    ).results;

  /** `n` more people already in the session (straight rows: no limits in the way). */
  async function crowd(sessionId: number, n: number): Promise<void> {
    const statements = Array.from({ length: n }, (_, i) => [
      env.DB.prepare("INSERT INTO users (id, username) VALUES (?, ?)").bind(`crowd${i}`, `crowd${i}`),
      env.DB.prepare("INSERT INTO session_players (session_id, user_id, rsvp) VALUES (?, ?, 'invited')").bind(
        sessionId,
        `crowd${i}`,
      ),
    ]).flat();
    await env.DB.batch(statements);
  }

  it('puts new people in invited, and they find it in their own invites', async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, b.id]);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(0);
    expect(rsvpOf(res.session, a.id)).toBe('invited');
    expect(rsvpOf(res.session, b.id)).toBe('invited');
    expect(res.session.counts).toEqual({ invited: 2, going: 1, maybe: 0, out: 0 });
    expect(res.session.my_rsvp).toBe('going');
    expect((await listMyInvites(env.DB, a.id)).map((x) => x.id)).toEqual([s.id]);
  });

  it('never touches a row that is already there: a yes stays a yes, a no stays a no', async () => {
    const { organizer, a, b, c } = await cast();
    const s = await open(organizer, [a.id, b.id, c.id]);
    await setRsvp(env.DB, a, s.id, 'going');
    await setRsvp(env.DB, b, s.id, 'out');
    const before = await rows(s.id);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, b.id, c.id]);
    expect(res).toMatchObject({ added: 0, skipped: 3 });
    expect(await rows(s.id)).toEqual(before);
    expect(rsvpOf(res.session, b.id)).toBe('out');
  });

  it('counts an unknown id as skipped instead of failing', async () => {
    const { organizer, a } = await cast();
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, 'ghost']);
    expect(res).toMatchObject({ added: 1, skipped: 1 });
    expect(res.session.players.some((p) => p.user.id === 'ghost')).toBe(false);
  });

  it("de-duplicates, and drops the session's organizer even when an admin asks", async () => {
    const { organizer, a } = await cast();
    const admin = await seedUser({ id: 'admin', admin: true });
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, admin, s.id, [a.id, a.id, organizer.id]);
    expect(res).toMatchObject({ added: 1, skipped: 0 });
    expect(rsvpOf(res.session, organizer.id)).toBe('going');
    expect(res.session.my_rsvp).toBeNull();
    // Nobody left once the organizer is dropped: nothing to do, and not an error.
    const none = await inviteToSession(env.DB, organizer, s.id, [organizer.id]);
    expect(none).toMatchObject({ added: 0, skipped: 0 });
  });

  it('is for the organizer or an admin: a stranger gets 403, even on a cancelled session', async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    await expect(inviteToSession(env.DB, a, s.id, [b.id])).rejects.toMatchObject({
      status: 403,
      message: '只有组织者可以操作这个约局',
    });
    await cancelSession(env.DB, organizer, s.id);
    await expect(inviteToSession(env.DB, a, s.id, [b.id])).rejects.toMatchObject({ status: 403 });
    await expect(inviteToSession(env.DB, organizer, 999_999, [b.id])).rejects.toMatchObject({
      status: 404,
      message: '约局不存在',
    });
  });

  it('refuses a cancelled, a settled and a started session — before reading the list', async () => {
    const { organizer, a } = await cast();
    const closed = '已取消 / 已结算的约局不能再叫人';
    const cancelled = await open(organizer);
    await cancelSession(env.DB, organizer, cancelled.id);
    await expect(inviteToSession(env.DB, organizer, cancelled.id, [a.id])).rejects.toMatchObject({
      status: 400,
      message: closed,
    });
    await expect(inviteToSession(env.DB, organizer, cancelled.id, 'x')).rejects.toMatchObject({ message: closed });

    const settled = await open(organizer);
    await env.DB.prepare("UPDATE game_sessions SET status = 'settled' WHERE id = ?").bind(settled.id).run();
    await expect(inviteToSession(env.DB, organizer, settled.id, [a.id])).rejects.toMatchObject({ message: closed });

    const started = await open(organizer);
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?').bind(PAST, started.id).run();
    await expect(inviteToSession(env.DB, organizer, started.id, [a.id])).rejects.toMatchObject({
      status: 400,
      message: '约局已开始，不能再叫人',
    });
    expect(await listMyInvites(env.DB, a.id)).toHaveLength(0);
  });

  it('checks the list: an array, not empty, real ids, at most MAX_INVITES at once', async () => {
    const { organizer } = await cast();
    const s = await open(organizer);
    const refuse = (raw: unknown, message: string) =>
      expect(inviteToSession(env.DB, organizer, s.id, raw)).rejects.toMatchObject({ status: 400, message });
    await refuse(undefined, 'user_ids 必须是数组');
    await refuse('a', 'user_ids 必须是数组');
    await refuse([], '至少选一个人');
    await refuse([''], 'user_ids 里有无效的用户 ID');
    await refuse([42], 'user_ids 里有无效的用户 ID');
    await refuse(
      Array.from({ length: MAX_INVITES + 1 }, (_, i) => `u${i}`),
      `一次最多邀请 ${MAX_INVITES} 人`,
    );
    // Creating a session still says `invite`.
    await expect(
      createSession(env.DB, organizer, { starts_at: FUTURE, invite: 'a' }, OFFSET_HOURS),
    ).rejects.toMatchObject({ message: 'invite 必须是数组' });
  });

  it(`never grows a roster past ${MAX_SESSION_ROSTER}`, async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    await crowd(s.id, MAX_SESSION_ROSTER - 2); // with the organizer: one seat left
    const full = (n: number) => `这局最多 ${MAX_SESSION_ROSTER} 人，已经有 ${n} 人了`;
    await expect(inviteToSession(env.DB, organizer, s.id, [a.id, b.id])).rejects.toMatchObject({
      status: 400,
      message: full(MAX_SESSION_ROSTER - 1),
    });
    expect(rsvpOf(await getSessionDetail(env.DB, s.id, organizer.id), a.id)).toBeNull();
    expect(await inviteToSession(env.DB, organizer, s.id, [a.id])).toMatchObject({ added: 1, skipped: 0 });
    // Someone already in costs nothing, even at the limit.
    expect(await inviteToSession(env.DB, organizer, s.id, [a.id])).toMatchObject({ added: 0, skipped: 1 });
    await expect(inviteToSession(env.DB, organizer, s.id, [b.id])).rejects.toMatchObject({
      message: full(MAX_SESSION_ROSTER),
    });
  });

  it('takes its limits from shared/attendance (worker/sessions re-exports them)', () => {
    expect(MAX_INVITES).toBe(SHARED_MAX_INVITES);
    expect(SHARED_MAX_INVITES).toBe(20);
    expect(MAX_SESSION_ROSTER).toBe(50);
  });
});
```

要点：`crowd()` 直接插 `users` 和 `session_players` 行（绕过 20 人一次的上限）把局填到 49 人；`PAST` / `FUTURE` / `cast()` 是这个文件顶部已有的。

- [ ] **Step 2：跑测试，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.workers.config.ts tests/worker/invites.test.ts 2>&1 | grep -E "Error|Test Files|Tests "
```

期望：整个文件加载失败——`Error: Failed to load url ../../worker/session-invites (resolved id: ../../worker/session-invites) … Does the file exist?`，`Test Files  1 failed (1)`，`Tests  no tests`。

- [ ] **Step 3：`shared/attendance.ts` 追加常量**

`shared/attendance.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
/** Sanity bound on how far ahead a session may be scheduled (90 days). */
export const SESSION_MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;
```

改成：

```ts
/** Sanity bound on how far ahead a session may be scheduled (90 days). */
export const SESSION_MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;

// --- P2-1 ---
/** People one create (invite) or one POST …/invite may name. */
export const MAX_INVITES = 20;
/** A session's roster never grows past this by invitation: roll call takes at most this many entries. */
export const MAX_SESSION_ROSTER = 50;
/** Invitation DMs one organizer may send one person per 24 h (the dispatcher enforces it; the web says it). */
export const INVITES_PER_ORGANIZER = 3;
```

（`SESSION_MAX_LEAD_MS` 是文件最后一行；P2-6 / P2-3 / P2-4 的小节以后接在本小节之后。）

- [ ] **Step 4：`worker/sessions.ts` 的 7 处小改**

4a. import 区引入两个常量。`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
import {
  ORGANIZER_BONUS_MIN_ATTENDEES,
```

改成：

```ts
import {
  MAX_INVITES,
  MAX_SESSION_ROSTER,
  ORGANIZER_BONUS_MIN_ATTENDEES,
```

4b. 点名上限和名单上限是同一个数（契约 §8 第 6 条：邀请能填满的名单一定能一次点完名）。`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
const MAX_ROLLCALL_ENTRIES = 50;
```

改成：

```ts
const MAX_ROLLCALL_ENTRIES = MAX_SESSION_ROSTER;
```

4c.–4e. 三个现有的内部声明加 `export`（`session-invites.ts` 要用；签名不变）。`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
interface SessionJoinRow extends SessionRow {
```

改成：

```ts
export interface SessionJoinRow extends SessionRow {
```

`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
async function getSessionRow(db: D1Database, id: number): Promise<SessionJoinRow> {
```

改成：

```ts
export async function getSessionRow(db: D1Database, id: number): Promise<SessionJoinRow> {
```

`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
function requireOrganizer(row: SessionRow, caller: User): void {
```

改成：

```ts
export function requireOrganizer(row: SessionRow, caller: User): void {
```

4f. `MAX_INVITES` 改为从 shared 再导出（`tests/worker/invites.test.ts` 从这里导入；上方 `MAX_OPEN_SESSIONS` 的注释原样留着，那是 P2-4 的分区）。`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
export const MAX_INVITES = 20;
```

改成：

```ts
export { MAX_INVITES } from '../shared/attendance';
```

4g. `normalizeInvites` 加 `export` 和 `field` 参数，两条错误文案里的 `invite` 换成 `${field}`（第三条「一次最多邀请 N 人」不含字段名，不动；`createSession` 的调用 `normalizeInvites(input.invite, organizer.id)` 不传第三参，文案不变）。`worker/sessions.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
function normalizeInvites(raw: unknown, organizerId: string): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, 'invite 必须是数组');
  const ids = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0) throw new ApiError(400, 'invite 里有无效的用户 ID');
```

改成：

```ts
/** `field` names the list in the errors: `invite` when creating, `user_ids` for POST …/invite (P2-1). */
export function normalizeInvites(
  raw: unknown,
  organizerId: string,
  field: 'invite' | 'user_ids' = 'invite',
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, `${field} 必须是数组`);
  const ids = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0) throw new ApiError(400, `${field} 里有无效的用户 ID`);
```


改完 `wc -l worker/sessions.ts` 应是 **992**（985 + 7，契约 §0：P2 全程净增不超过约 90 行）。

- [ ] **Step 5：`worker/types.ts` 加 `InviteResult`**

`worker/types.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
/** Hono generics for the app: bindings + per-request variables. */
```

改成：

```ts
// --- P2-1 ---
/** What POST /api/sessions/:id/invite answers. */
export interface InviteResult {
  session: SessionDetail;
  /** Rows actually inserted (each one an invitation; on PostgreSQL each queues a DM). */
  added: number;
  /** Distinct requested ids, minus the organizer, minus `added`: already in it, or unknown. */
  skipped: number;
}

/** Hono generics for the app: bindings + per-request variables. */
```

（插在 P2-2 的 `InvitableUser` 之后、`AppEnv` 之前，契约 §3 `worker/types.ts` 一行。）

- [ ] **Step 6：新建 `worker/session-invites.ts`**

新建 `worker/session-invites.ts`，完整内容：

```ts
// P2-1 (spec §8 B2-1): invite more people after a session was created.
//
// POST /api/sessions/:id/invite { user_ids } → { session, added, skipped }.
// New people land in `invited`; a row already there — a yes, a no, an
// unanswered invitation — is never touched (the answer is theirs). On
// PostgreSQL each inserted row is an INSERT the session_players_outbox trigger
// turns into one dm.session.invited (0005_sessions.sql), under the
// dispatcher's allowances; D1 sends nothing, as today.

import { MAX_SESSION_ROSTER } from '../shared/attendance';
import type { InviteResult, User } from './types';
import { ApiError } from './errors';
import {
  getSessionDetail,
  getSessionRow,
  normalizeInvites,
  requireOrganizer,
  type SessionJoinRow,
} from './sessions';
import { parseSqlUtc } from './time';

/** Who may invite, and when: the caller first, then the session (session-update's order). */
function assertCanInvite(row: SessionJoinRow, caller: User): void {
  requireOrganizer(row, caller);
  if (row.status !== 'open') throw new ApiError(400, '已取消 / 已结算的约局不能再叫人');
  if (parseSqlUtc(row.starts_at) <= Date.now()) throw new ApiError(400, '约局已开始，不能再叫人');
}

/** The ids asked for: an array, not empty, then normalizeInvites (strings, distinct, ≤ MAX_INVITES, no organizer). */
function requestedIds(raw: unknown, organizerId: string): string[] {
  // normalizeInvites reads a missing list as "nobody" (creating a session may omit it); here it is required.
  if (!Array.isArray(raw)) throw new ApiError(400, 'user_ids 必须是数组');
  if (raw.length === 0) throw new ApiError(400, '至少选一个人');
  return normalizeInvites(raw, organizerId, 'user_ids');
}

/** The friendly roster check, with the count in the message; the INSERTs hold it again. */
async function assertRosterRoom(db: D1Database, id: number, ids: readonly string[]): Promise<void> {
  const present = await db
    .prepare('SELECT user_id FROM session_players WHERE session_id = ?')
    .bind(id)
    .all<{ user_id: string }>();
  const inIt = new Set(present.results.map((r) => r.user_id));
  const fresh = ids.filter((userId) => !inIt.has(userId)).length;
  if (inIt.size + fresh > MAX_SESSION_ROSTER) {
    throw new ApiError(400, `这局最多 ${MAX_SESSION_ROSTER} 人，已经有 ${inIt.size} 人了`);
  }
}

/** One INSERT per person, in one batch: still open, still room, unknown ids and existing rows skipped. */
async function insertInvites(db: D1Database, id: number, ids: readonly string[]): Promise<number> {
  const results = await db.batch([
    // PostgreSQL: take the session's row lock first (as setRsvp does); D1 serialises batches.
    db.prepare('UPDATE game_sessions SET status = status WHERE id = ?').bind(id),
    ...ids.map((userId) =>
      db
        .prepare(
          `INSERT INTO session_players (session_id, user_id, rsvp)
           SELECT ?, u.id, 'invited' FROM users u
            WHERE u.id = ?
              AND EXISTS (SELECT 1 FROM game_sessions WHERE id = ? AND status = 'open')
              AND (SELECT COUNT(*) FROM session_players WHERE session_id = ?) < ?
           ON CONFLICT (session_id, user_id) DO NOTHING`,
        )
        .bind(id, userId, id, id, MAX_SESSION_ROSTER),
    ),
  ]);
  return results.slice(1).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

export async function inviteToSession(
  db: D1Database,
  caller: User,
  id: number,
  rawUserIds: unknown,
): Promise<InviteResult> {
  const row = await getSessionRow(db, id);
  assertCanInvite(row, caller);
  const ids = requestedIds(rawUserIds, row.organizer_id);
  if (ids.length === 0) {
    return { session: await getSessionDetail(db, id, caller.id), added: 0, skipped: 0 };
  }
  await assertRosterRoom(db, id, ids);
  const added = await insertInvites(db, id, ids);
  return { session: await getSessionDetail(db, id, caller.id), added, skipped: ids.length - added };
}
```

要点：
- 顺序照契约 §4.3：`getSessionRow`（404）→ `requireOrganizer`（403）→ `status !== 'open'`（400）→ `parseSqlUtc(starts_at) <= Date.now()`（400）→ `user_ids` 不是数组 / 空数组（400，`normalizeInvites` 对 `undefined` 返回空数组，不能靠它）→ `normalizeInvites(raw, row.organizer_id, 'user_ids')`（非字符串或空串、超过 20 人）→ 只剩组织者就直接 200 → 名单上限（先读一次 `session_players`）→ 写入。
- 去掉的是 `row.organizer_id`（这局的组织者），不是调用者：管理员替人叫人时，组织者本人仍被去掉，管理员自己可以被叫进来。
- 写入的 SQL 两个引擎都合法（契约 §3.4）：`INSERT … SELECT … FROM users u WHERE …`（SELECT 带 WHERE，SQLite 的 upsert 歧义）、`ON CONFLICT (session_id, user_id) DO NOTHING`（已有的行冲突不算 INSERT，PG 触发器不触发）、`COUNT(*)` 和绑定的 50 比较。并发时被别人填满：INSERT 的 `changes = 0`，计入 `skipped`，不报错（契约 §4.3）。
- 不返回任何「多少人能收到私信」的数（契约 §6 第 2 条）。

- [ ] **Step 7：跑测试，确认通过（D1 和 PG 各一遍）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/invites.test.ts 2>&1 | grep -E "Test Files|Tests "
npx vitest run --config vitest.pg.config.ts tests/worker/invites.test.ts 2>&1 | grep -E "Test Files|Tests "
npx vitest run --config vitest.workers.config.ts tests/worker/sessions.test.ts tests/worker/session-update.test.ts tests/worker/invites.test.ts 2>&1 | grep -E "Test Files|Tests "
npm run typecheck
```

期望：D1 `Tests  24 passed (24)`（原有 15 + 新 9）；PG 同样 `24 passed (24)`；三个文件一起 `Test Files  3 passed (3)`、**`Tests  118 passed | 1 todo (119)`**（`normalizeInvites` 改签名、点名上限改引用都没碰到 `sessions.test.ts` / `session-update.test.ts` 的现有用例）；typecheck 通过。

- [ ] **Step 8：提交**

```bash
git add shared/attendance.ts worker/sessions.ts worker/types.ts worker/session-invites.ts tests/worker/invites.test.ts
git commit -m "feat: 建局后再叫人的写入逻辑 inviteToSession（P2-1）"
```

---

### Task 2：路由 `POST /api/sessions/:id/invite`、HTTP 测试、`docs/CONTRACT.md`

**Files:**
- Modify: `worker/routes.ts`（import 区；`--- Sessions ---` 小节）
- Modify: `docs/CONTRACT.md`（`**Sessions**` 小节）
- Test: `tests/worker/session-routes.test.ts`（末尾新 describe，P2-2 的部分一字不动）

- [ ] **Step 1：写失败的测试**

在 `tests/worker/session-routes.test.ts` 的**文件末尾**（最后一行 `});` 之后）空一行，追加：

```ts
describe('POST /api/sessions/:id/invite (P2-1)', () => {
  const IN_3H = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString();
  const json = { 'Content-Type': 'application/json' };

  /** `org` opens a session through the API; `a` and `b` exist. Returns its id. */
  async function openSession(): Promise<number> {
    await seedUser({ id: 'org' });
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b', participant: false });
    const res = await call('/api/sessions', {
      method: 'POST',
      headers: await asUser('org', json),
      body: JSON.stringify({ starts_at: IN_3H() }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { session: { id: number } }).session.id;
  }

  async function invite(path: string, sub: string, body: unknown, overrides: Partial<Env> = {}): Promise<Response> {
    return call(path, { method: 'POST', headers: await asUser(sub, json), body: JSON.stringify(body) }, overrides);
  }

  async function rosterOf(id: number): Promise<string[]> {
    const res = await call(`/api/sessions/${id}`);
    const body = (await res.json()) as { session: { players: { user: { id: string } }[] } };
    return body.session.players.map((p) => p.user.id).sort();
  }

  it('invites, and answers exactly { session, added, skipped }', async () => {
    const id = await openSession();
    const res = await invite(`/api/sessions/${id}/invite`, 'org', { user_ids: ['a', 'b', 'ghost'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: number; players: { user: { id: string }; rsvp: string }[] };
      added: number;
      skipped: number;
    };
    expect(Object.keys(body).sort()).toEqual(['added', 'session', 'skipped']);
    expect(body).toMatchObject({ added: 2, skipped: 1, session: { id } });
    expect(body.session.players.filter((p) => p.rsvp === 'invited').map((p) => p.user.id).sort()).toEqual(['a', 'b']);
    // Nothing about who can be reached by DM (spec §11 #9).
    expect(JSON.stringify(body).toLowerCase()).not.toContain('discord');
  });

  it('answers 401 未登录 without a session cookie', async () => {
    const id = await openSession();
    const res = await call(`/api/sessions/${id}/invite`, {
      method: 'POST',
      headers: { Origin: 'https://score.example.com', ...json },
      body: JSON.stringify({ user_ids: ['a'] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
  });

  it('answers 400 for a bad id, 404 for a missing session, 403 for a stranger', async () => {
    const id = await openSession();
    const bad = await invite('/api/sessions/abc/invite', 'org', { user_ids: ['a'] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: '无效的约局 ID' });
    const missing = await invite('/api/sessions/999999/invite', 'org', { user_ids: ['a'] });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: '约局不存在' });
    const stranger = await invite(`/api/sessions/${id}/invite`, 'a', { user_ids: ['b'] });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: '只有组织者可以操作这个约局' });
    const noList = await invite(`/api/sessions/${id}/invite`, 'org', {});
    expect(noList.status).toBe(400);
    expect(await noList.json()).toEqual({ error: 'user_ids 必须是数组' });
  });

  it('writes nothing for a cross-origin form-style post or while read-only', async () => {
    const id = await openSession();
    // text/plain needs no preflight, and readJsonBody still parses it: hono/csrf must stop it.
    const foreign = await call(`/api/sessions/${id}/invite`, {
      method: 'POST',
      headers: await asUser('org', { 'Content-Type': 'text/plain', Origin: 'https://evil.example.com' }),
      body: JSON.stringify({ user_ids: ['a'] }),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: '请求来源不被允许' });
    const readOnly = await invite(`/api/sessions/${id}/invite`, 'org', { user_ids: ['a'] }, { READ_ONLY: '1' });
    expect(readOnly.status).toBe(503);
    expect(await readOnly.json()).toEqual({ error: '系统维护中（只读），请稍后再试' });
    expect(await rosterOf(id)).toEqual(['org']);
  });
});
```

要点：
- 只用 P2-2 已有的顶层名字（`call`、`asUser`、`seedUser`、`type Env`），**不加 import 行**（`plan-P2-2.md`「对契约的补充」第 2 条）；局用 HTTP 的 `POST /api/sessions` 建，名单用公开的 `GET /api/sessions/:id` 读。
- CSRF 用例用 `Content-Type: text/plain`：hono/csrf 只拦表单类和无 body 的跨站 POST，JSON 交给 CORS 预检（`tests/worker/http-guards.test.ts`「leaves JSON requests to CORS」锁着）；而 `readJsonBody` 不看 Content-Type，所以 `text/plain` 带 JSON 正文的跨站 POST 才是真正要拦的那种（契约 §4.3 表末行「CSRF 失败 403」）。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts 2>&1 | grep -E "✓|×|→|Tests "
```

期望：`Tests  3 failed | 4 passed (7)`。失败的是新 describe 的前三个（`invites, and answers exactly …`：`expected 404 to be 200`；`answers 401 未登录 …`：`expected 404 to be 401`；`answers 400 for a bad id …`：`expected 404 to be 400`）。P2-2 的 3 个照常通过；新 describe 的第 4 个（`writes nothing for a cross-origin form-style post or while read-only`）**此时也通过**——CSRF 和 READ_ONLY 都是中间件，在路由之前就拦下了；它锁的是「新路由被这两道中间件覆盖」，Step 4 之后仍须通过。

- [ ] **Step 3：加路由**

import 区（P2-2 那一行之后）：`worker/routes.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
import { listInvitable } from './invitable';
```

改成：

```ts
import { listInvitable } from './invitable';
import { inviteToSession } from './session-invites';
```

路由放在 `/cancel` 之后（契约 §3 `worker/routes.ts` 一行）：`worker/routes.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
    const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'));
    return c.json({ session });
  });
```

改成：

```ts
    const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'));
    return c.json({ session });
  });

  // P2-1: invite more people after creation. Organizer or admin, open and not started.
  app.post('/api/sessions/:id/invite', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const result = await inviteToSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'), body.user_ids);
    return c.json(result);
  });
```

（`requireUser` → `readJsonBody` → `parseId` → `inviteToSession`，契约 §4.3 的路由写法；CSRF、READ_ONLY 由已有中间件处理，`allowHeaders` 不动。）

- [ ] **Step 4：跑测试，确认通过（D1 和 PG）**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/session-routes.test.ts 2>&1 | grep -E "Test Files|Tests "
npx vitest run --config vitest.pg.config.ts tests/worker/session-routes.test.ts 2>&1 | grep -E "Test Files|Tests "
npm run typecheck
```

期望：D1 `Tests  7 passed (7)`；PG `Tests  7 passed (7)`；typecheck 通过。

- [ ] **Step 5：`docs/CONTRACT.md` 补一条**

`docs/CONTRACT.md`，锚点（原文，整段替换；只出现 1 次）：

```md
- `POST /api/sessions/:id/cancel` → `{ session }`.
```

改成：

```md
- `POST /api/sessions/:id/cancel` → `{ session }`.
- `POST /api/sessions/:id/invite` `{ user_ids: string[] }` → `{ session, added, skipped }` (P2-1).
  Invite more people after creation. Organizer/admin (403 first, like `PATCH`), `open`
  and not started (400). `user_ids` is required and not empty; at most 20 distinct ids
  at once, the session's organizer dropped (nobody left → 200 with `added: 0`). The
  roster never grows past 50 by invitation (400 「这局最多 50 人，已经有 N 人了」).
  New people land in `invited`; a row already there — going, maybe, out or invited — is
  never touched, and unknown ids are dropped. `added` = rows inserted, `skipped` = the
  other requested ids. On PostgreSQL each new row queues one invitation DM under the
  same allowances as at creation; nothing in the answer says who can be reached by DM.
```


- [ ] **Step 6：提交**

```bash
git add worker/routes.ts docs/CONTRACT.md tests/worker/session-routes.test.ts
git commit -m "feat: 新增 POST /api/sessions/:id/invite 路由和契约说明（P2-1）"
```

---

### Task 3：PG：后叫的人也收到邀请私信；dispatcher 的额度常量改从 shared 引入

**Files:**
- Modify: `server/src/outbox/dispatcher.ts`（import 区一行；`INVITES_PER_ORGANIZER` 两行）
- Test: `tests/pg/session-cards.test.ts`（import 区加两行；末尾 describe `invites after creation`）

- [ ] **Step 1：写 PG 用例**

import 区（`worker/sessions` 那一行之后加两行，原有的行不改）：`tests/pg/session-cards.test.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
import { cancelSession, createSession, rollCall, setRsvp, settleSession, updateSession } from '../../worker/sessions';
```

改成：

```ts
import { cancelSession, createSession, rollCall, setRsvp, settleSession, updateSession } from '../../worker/sessions';
import { inviteToSession } from '../../worker/session-invites';
import { INVITES_PER_ORGANIZER as SHARED_INVITES_PER_ORGANIZER } from '../../shared/attendance';
```

末尾追加：在 `tests/pg/session-cards.test.ts` 的**文件末尾**（最后一行 `});` 之后）空一行，追加：

```ts
describe('invites after creation', () => {
  /** Invitation DMs that reached bound user `n` (see cast: org 1, a 2, b 3). */
  const invitationsTo = (sent: ReturnType<typeof fakeDiscord>['sent'], n: number) =>
    sent.filter((m) => m.channelId === `dm-${dc(n).id}` && text(m.message).includes('约你'));

  it('someone invited after creation gets one invitation DM; asking again sends nothing', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    expect(await inviteToSession(env.DB, org, session.id, ['a', 'b'])).toMatchObject({ added: 2, skipped: 0 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(1);
    expect(invitationsTo(discord.sent, 3)).toHaveLength(1);

    expect(await inviteToSession(env.DB, org, session.id, ['a'])).toMatchObject({ added: 0, skipped: 1 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(1);
    const queued = await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' ORDER BY entity_id");
    expect(queued.rows.map((r) => r.entity_id)).toEqual(['a', 'b']);
  });

  it('someone who said no is not asked again', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'out');
    expect(await inviteToSession(env.DB, org, session.id, ['a', 'b'])).toMatchObject({ added: 1, skipped: 1 });
    const queued = await pool.query("SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' ORDER BY entity_id");
    expect(queued.rows.map((r) => r.entity_id)).toEqual(['a', 'b']); // a's is the one from creation
  });

  it(`shares the organizer's ${INVITES_PER_ORGANIZER} invitations a day with invitations made at creation`, async () => {
    expect(INVITES_PER_ORGANIZER).toBe(SHARED_INVITES_PER_ORGANIZER);
    const { org } = await cast();
    for (let i = 0; i < INVITES_PER_ORGANIZER; i += 1) {
      await createSession(env.DB, org, { starts_at: IN_2H(), invite: ['a'] }, OFFSET_HOURS);
    }
    const later = await createSession(env.DB, org, { starts_at: IN_3H() }, OFFSET_HOURS);
    const discord = fakeDiscord();
    const d = dispatcher(discord.api, null);
    await d.runOnce();
    expect(await inviteToSession(env.DB, org, later.id, ['a'])).toMatchObject({ added: 1 });
    await d.runOnce();
    expect(invitationsTo(discord.sent, 2)).toHaveLength(INVITES_PER_ORGANIZER);
    const held = await pool.query(
      "SELECT entity_id FROM outbox WHERE kind = 'dm.session.invited' AND result = 'skipped' AND last_error LIKE 'enough invitations%'",
    );
    expect(held.rows.map((r) => r.entity_id)).toEqual(['a']);
  });
});
```

要点：`cast()` 绑了 `org`→`dc(1)`、`a`→`dc(2)`、`b`→`dc(3)`；`dispatcher()`、`fakeDiscord()`、`text()`、`IN_2H` / `IN_3H` 都是这个文件已有的辅助。三个用例分别证明：后叫的人各收到**一条**「约你」私信、再叫一次（`ON CONFLICT DO NOTHING`）不再入队；说了不来的人不会被重新邀请（只有建局时那一条事件）；建局时的邀请和 `/invite` 的邀请一起算 `INVITES_PER_ORGANIZER`（第 4 条被 dispatcher 以 `enough invitations…` 跳过）。

- [ ] **Step 2：跑 PG 用例**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts 2>&1 | grep -E "×|Test Files|Tests "
```

期望：**直接通过**，`Tests  52 passed (52)`（原有 49 + 新 3）。这里没有红：私信由 0005 的 `session_players_outbox` 触发器发（契约 §3.2），P2-1 不改触发器；这三条是给「`/invite` 的 INSERT 和建局时的 INSERT 走同一条路」补的行为测试。若这里失败，说明 Task 1 的 INSERT 和触发器的假设不符——停下排查，不要改触发器。

- [ ] **Step 3：dispatcher 的常量改为从 shared 引入并 re-export**

import 区：`server/src/outbox/dispatcher.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
import type pg from 'pg';
```

改成：

```ts
import type pg from 'pg';
import { INVITES_PER_ORGANIZER } from '../../../shared/attendance';
```

常量（上方 `SESSION_DM_BUDGET` 的注释和定义不动）：`server/src/outbox/dispatcher.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
/** Invitations from one organizer to one person per 24 h. */
export const INVITES_PER_ORGANIZER = 3;
```

改成：

```ts
/** Invitations from one organizer to one person per 24 h. Lives in shared/ since P2-1: the web's InviteSheet says it too. */
export { INVITES_PER_ORGANIZER } from '../../../shared/attendance';
```

（`deliverSessionDm` 里 `>= INVITES_PER_ORGANIZER` 用的是 import 进来的同一个值；`tests/pg/session-cards.test.ts:13` 仍从 dispatcher 导入它。）

- [ ] **Step 4：跑 PG 用例、server 套件、typecheck**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/session-cards.test.ts 2>&1 | grep -E "×|Test Files|Tests "
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run typecheck
```

期望：PG `Tests  52 passed (52)`；server `22 / 290` 不变（= S0）；typecheck 通过（`server/tsconfig.json` 也检查到 `shared/attendance.ts`）。

- [ ] **Step 5：提交**

```bash
git add server/src/outbox/dispatcher.ts tests/pg/session-cards.test.ts
git commit -m "test: 后叫的人也收到邀请私信并共用组织者额度；INVITES_PER_ORGANIZER 改从 shared 引入（P2-1）"
```

---

### Task 4：前端类型、`api.ts` 的 `inviteToSession`、纯规则 `invitePicker`

**Files:**
- Create: `src/lib/invitePicker.ts`
- Modify: `src/types.ts`（`SettleResponse` 之后）
- Modify: `src/api.ts`（import 区；`// --- Sessions ---` 小节末尾）
- Test: `tests/unit/invite-picker.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/invite-picker.test.ts`，完整内容：

```ts
// P2-1: who the InviteSheet offers, and how picking works (P2 contract 4.6).

import { describe, expect, it } from 'vitest';
import {
  INVITES_PER_ORGANIZER,
  MAX_INVITES,
  MAX_SESSION_ROSTER,
  type Rsvp,
} from '@shared/attendance';
import { inviteGroups, inviteToast, toggleInvite } from '../../src/lib/invitePicker';
import type { InvitableUser, SessionPlayer } from '../../src/types';

function user(id: string, isParticipant = true): InvitableUser {
  return { id, username: `名字${id}`, avatar_url: null, is_participant: isParticipant, last_played_with_me_at: null };
}

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: `名字${id}`, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

describe('inviteGroups', () => {
  it('splits the board from the other friends and keeps the server order in each', () => {
    const users = [user('z'), user('y', false), user('x'), user('w', false)];
    const groups = inviteGroups(users, []);
    expect(groups.onBoard.map((r) => r.user.id)).toEqual(['z', 'x']);
    expect(groups.others.map((r) => r.user.id)).toEqual(['y', 'w']);
    expect([...groups.onBoard, ...groups.others].every((r) => r.state === 'free')).toBe(true);
  });

  it('marks who is already in (invited, going, maybe) and who said no', () => {
    const users = [user('i'), user('g'), user('m'), user('o', false), user('f', false)];
    const players = [player('i', 'invited'), player('g', 'going'), player('m', 'maybe'), player('o', 'out')];
    const { onBoard, others } = inviteGroups(users, players);
    expect(onBoard.map((r) => [r.user.id, r.state])).toEqual([
      ['i', 'in'],
      ['g', 'in'],
      ['m', 'in'],
    ]);
    expect(others.map((r) => [r.user.id, r.state])).toEqual([
      ['o', 'out'],
      ['f', 'free'],
    ]);
  });

  it('two empty groups for nobody', () => {
    expect(inviteGroups([], [player('org', 'going')])).toEqual({ onBoard: [], others: [] });
  });
});

describe('toggleInvite', () => {
  it('adds and removes, always as a new array', () => {
    const none: readonly string[] = [];
    const one = toggleInvite(none, 'a');
    expect(one).toEqual(['a']);
    expect(none).toEqual([]);
    const two = toggleInvite(one, 'b');
    expect(two).toEqual(['a', 'b']);
    expect(toggleInvite(two, 'a')).toEqual(['b']);
    expect(two).toEqual(['a', 'b']);
  });

  it(`stops at MAX_INVITES (${MAX_INVITES}) by default, but a full list can still drop someone`, () => {
    const full = Array.from({ length: MAX_INVITES }, (_, i) => `u${i}`);
    const same = toggleInvite(full, 'extra');
    expect(same).toEqual(full);
    expect(same).not.toBe(full);
    expect(toggleInvite(full, 'u0')).toHaveLength(MAX_INVITES - 1);
    expect(toggleInvite(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });
});

describe('inviteToast', () => {
  it('says how many were asked, and to shout in the group', () => {
    expect(inviteToast(2)).toBe('已叫 2 人。没绑 Discord 的朋友，记得在群里喊一声。');
  });

  it('says so when nobody new was asked', () => {
    expect(inviteToast(0)).toBe('没有叫到新的人：选的人已经在局里了。');
  });
});

describe('the limits the sheet and the server share', () => {
  it('are the values the backend has always used', () => {
    expect(MAX_INVITES).toBe(20);
    expect(MAX_SESSION_ROSTER).toBe(50);
    expect(INVITES_PER_ORGANIZER).toBe(3);
  });
});
```


- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/invite-picker.test.ts 2>&1 | grep -E "Error|Test Files|Tests "
```

期望：`Error: Cannot find module '../../src/lib/invitePicker' imported from …/tests/unit/invite-picker.test.ts`，`Test Files  1 failed (1)`，`Tests  no tests`。

- [ ] **Step 3：新建纯模块**

新建 `src/lib/invitePicker.ts`，完整内容：

```ts
// P2-1: the rules behind 再叫几个人 (InviteSheet). Pure — tests/unit imports it.

import { MAX_INVITES, type Rsvp } from '@shared/attendance';
import type { InvitableUser, SessionPlayer } from '../types';

/** in = already in the session (invited / going / maybe); out = said 不来. Both are left alone (spec §3.5). */
export type InviteRowState = 'free' | 'in' | 'out';

export interface InviteRow {
  user: InvitableUser;
  state: InviteRowState;
}

/** 在榜的 / 其他朋友（未上榜）, each in the server's order (played with first, then by name). */
export interface InviteGroups {
  onBoard: InviteRow[];
  others: InviteRow[];
}

function rowState(rsvp: Rsvp | undefined): InviteRowState {
  if (rsvp === undefined) return 'free';
  return rsvp === 'out' ? 'out' : 'in';
}

export function inviteGroups(users: readonly InvitableUser[], players: readonly SessionPlayer[]): InviteGroups {
  const rsvpById = new Map<string, Rsvp>(players.map((p) => [p.user.id, p.rsvp]));
  const rows = users.map((user): InviteRow => ({ user, state: rowState(rsvpById.get(user.id)) }));
  return {
    onBoard: rows.filter((r) => r.user.is_participant),
    others: rows.filter((r) => !r.user.is_participant),
  };
}

/** Adds or removes `id`; never past `max` (MAX_INVITES); returns a new array. */
export function toggleInvite(selected: readonly string[], id: string, max: number = MAX_INVITES): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= max ? [...selected] : [...selected, id];
}

/** The toast after POST …/invite (P2 contract 4.6; spec §3.5 without the copy-link button, which is P3-3). */
export function inviteToast(added: number): string {
  return added > 0
    ? `已叫 ${added} 人。没绑 Discord 的朋友，记得在群里喊一声。`
    : '没有叫到新的人：选的人已经在局里了。';
}
```

（只 import `@shared/attendance` 和 `../types` 的类型：`tests/unit` 能在纯 Node 下导入，P0 契约「被 tests/unit 导入的 src/lib 模块必须是纯模块」。）

- [ ] **Step 4：`src/types.ts` 加 `InviteResponse`**

`src/types.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
export interface SettleResponse {
  session: SessionDetail;
  created: number;
  skipped: number;
}
```

改成：

```ts
export interface SettleResponse {
  session: SessionDetail;
  created: number;
  skipped: number;
}

/** POST /api/sessions/:id/invite (P2-1). */
export interface InviteResponse {
  session: SessionDetail;
  /** People this request actually invited. */
  added: number;
  /** The other ids asked for: already in it, or unknown. */
  skipped: number;
}
```


- [ ] **Step 5：`src/api.ts` 加 `inviteToSession`**

import 区（P2-2 加的 `InvitableUser,` 下一行，保持字母序）：`src/api.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
  InvitableUser,
```

改成：

```ts
  InvitableUser,
  InviteResponse,
```

函数放在小节末尾、P2-2 的 `getInvitable` 之后（锚点是紧随其后的小节标题行）：`src/api.ts`，锚点（原文，整段替换；只出现 1 次）：

```ts
// --- Weekly report ---------------------------------------------------------
```

改成：

```ts
/** P2-1: invite more people after creation. Organizer or admin; rows already there are never changed. */
export function inviteToSession(id: number, userIds: string[]): Promise<InviteResponse> {
  return post<InviteResponse>(`/api/sessions/${id}/invite`, { user_ids: userIds });
}

// --- Weekly report ---------------------------------------------------------
```

（正文正好是 `{ user_ids }`；`post()` 带 `Content-Type: application/json`。错误照常抛 `ApiError`，由 sheet 显示原文。）

- [ ] **Step 6：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/invite-picker.test.ts 2>&1 | grep -E "Test Files|Tests "
npm run typecheck
```

期望：`Tests  8 passed (8)`；typecheck 通过。

- [ ] **Step 7：提交**

```bash
git add src/lib/invitePicker.ts src/types.ts src/api.ts tests/unit/invite-picker.test.ts
git commit -m "feat: 前端 inviteToSession、InviteResponse 和再叫人名单的纯规则（P2-1）"
```

---

### Task 5：`useInvitable` 和最简版 `InviteSheet`

**Files:**
- Create: `src/lib/useInvitable.ts`
- Create: `src/components/InviteSheet.tsx`
- Create: `src/components/invite-sheet.css`
- Test: `tests/dom/invite-sheet.test.tsx`（本 Task 建文件，sheet 本身的 7 个用例）

- [ ] **Step 1：写失败的测试**

新建 `tests/dom/invite-sheet.test.tsx`，完整内容：

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { INVITES_PER_ORGANIZER, MAX_INVITES, type Rsvp } from '@shared/attendance';
import { InviteSheet } from '../../src/components/InviteSheet';
import type { Invitable, InvitableState } from '../../src/lib/useInvitable';
import type { InvitableUser, SessionDetail, SessionPlayer } from '../../src/types';

// P2-1: 再叫几个人 — the minimal InviteSheet (P2 contract 4.6). Only Date is
// faked, as in organizer-actions; timers stay real.

const NOW = new Date(2026, 9, 28, 10, 0);
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 9, day, hour, minute).toISOString();
const START = at(28, 21);

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
    my_rsvp: 'going',
    players: [player('org', 'going'), player('a', 'going'), player('b', 'maybe'), player('c', 'out'), player('d', 'invited')],
    ...overrides,
  };
}

function friend(id: string, isParticipant = true): InvitableUser {
  return { id, username: `玩家${id}`, avatar_url: null, is_participant: isParticipant, last_played_with_me_at: null };
}

/** a is in (going), c said no; e is free on the board, f is a free friend off it. */
const FRIENDS: InvitableUser[] = [friend('a'), friend('c'), friend('e'), friend('f', false)];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InviteSheet', () => {
  function renderSheet(state: InvitableState): { onInvited: Mock; reload: Mock; sheet: HTMLElement } {
    const onInvited = vi.fn();
    const reload = vi.fn();
    const invitable: Invitable = { state, reload };
    render(<InviteSheet session={makeSession()} invitable={invitable} onClose={() => {}} onInvited={onInvited} />);
    return { onInvited, reload, sheet: screen.getByRole('dialog', { name: '再叫几个人' }) };
  }

  it('groups people, and greys out who is already in or said no', () => {
    mockFetch({});
    const { sheet } = renderSheet({ kind: 'ready', users: FRIENDS });
    const board = within(sheet).getByRole('group', { name: '在榜的' });
    const others = within(sheet).getByRole('group', { name: '其他朋友（未上榜，不参与计分）' });
    const onBoard = within(board).getAllByRole('checkbox');
    expect(onBoard).toHaveLength(3); // in the server's order
    expect(onBoard[0]).toHaveAccessibleName('玩家a · 已在局里');
    expect(onBoard[1]).toHaveAccessibleName('玩家c · 说了不来');
    expect(onBoard[2]).toHaveAccessibleName('玩家e');
    expect(within(board).getByRole('checkbox', { name: '玩家a · 已在局里' })).toBeDisabled();
    expect(within(board).getByRole('checkbox', { name: '玩家c · 说了不来' })).toBeDisabled();
    expect(within(board).getByRole('checkbox', { name: '玩家e' })).toBeEnabled();
    expect(within(others).getByRole('checkbox', { name: '玩家f' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: '叫人' })).toBeDisabled();
    expect(within(sheet).getByText('已选 0 人')).toBeInTheDocument();
  });

  it('says the rules, never who can be reached', () => {
    mockFetch({});
    const { sheet } = renderSheet({ kind: 'ready', users: FRIENDS });
    expect(
      within(sheet).getByText(
        `绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 ${INVITES_PER_ORGANIZER} 条邀请私信。`,
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('没绑的人要自己上网页看，把链接发到群里最稳。')).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/已绑|未绑定|能收到私信的/);
  });

  it(`stops at ${MAX_INVITES} people at once`, async () => {
    mockFetch({});
    const many = Array.from({ length: MAX_INVITES + 1 }, (_, i) => friend(`n${i}`));
    const user = userEvent.setup();
    const { sheet } = renderSheet({ kind: 'ready', users: many });
    const boxes = within(sheet).getAllByRole('checkbox');
    for (const box of boxes.slice(0, MAX_INVITES)) await user.click(box);
    expect(boxes[MAX_INVITES]).toBeDisabled();
    expect(boxes[0]).toBeEnabled(); // a picked one can still be dropped
    expect(within(sheet).getByText(`一次最多叫 ${MAX_INVITES} 人`)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: `叫 ${MAX_INVITES} 人` })).toBeEnabled();
  });

  it('sends exactly { user_ids }, once, and hands the answer back', async () => {
    const answer = { session: makeSession(), added: 2, skipped: 0 };
    const calls = mockFetch({ 'POST /api/sessions/1/invite': () => json(200, answer) });
    const user = userEvent.setup();
    const { sheet, onInvited } = renderSheet({ kind: 'ready', users: FRIENDS });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家f' }));
    expect(within(sheet).getByText('已选 2 人')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '叫 2 人' }));
    await waitFor(() => expect(onInvited).toHaveBeenCalledWith(answer));
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/invite', body: { user_ids: ['e', 'f'] } },
    ]);
  });

  it("shows the server's reason inside the sheet and stays open", async () => {
    mockFetch({ 'POST /api/sessions/1/invite': () => json(400, { error: '约局已开始，不能再叫人' }) });
    const user = userEvent.setup();
    const { sheet, onInvited } = renderSheet({ kind: 'ready', users: FRIENDS });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('button', { name: '叫 1 人' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('约局已开始，不能再叫人');
    expect(within(sheet).getByRole('button', { name: '叫 1 人' })).toBeEnabled();
    expect(within(sheet).getByRole('checkbox', { name: '玩家e' })).toBeChecked();
    expect(onInvited).not.toHaveBeenCalled();
  });

  it('a list that did not load says so, without an alert, and offers 重试', async () => {
    mockFetch({});
    const user = userEvent.setup();
    const { sheet, reload } = renderSheet({ kind: 'error' });
    expect(within(sheet).getByRole('status')).toHaveTextContent('名单没加载出来，稍后再试。');
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: '重试' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says when the list is still loading, or nobody else has logged in yet', () => {
    mockFetch({});
    const { unmount } = render(
      <InviteSheet
        session={makeSession()}
        invitable={{ state: { kind: 'loading' }, reload: () => {} }}
        onClose={() => {}}
        onInvited={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('加载中…');
    unmount();
    render(
      <InviteSheet
        session={makeSession()}
        invitable={{ state: { kind: 'ready', users: [] }, reload: () => {} }}
        onClose={() => {}}
        onInvited={() => {}}
      />,
    );
    expect(
      screen.getByText('还没有别的朋友登录过。把链接发到群里，他们登录后就能在这里叫到。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
  });
});
```

要点：只假 `Date`（和 `organizer-actions.test.tsx` 一样），计时器是真的；`mockFetch` 对没登记的请求回 500，多出来的请求会变成失败。可访问名用 `toHaveAccessibleName` 断言（头像的首字母 `<span aria-hidden>` 不进名字）。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/invite-sheet.test.tsx 2>&1 | grep -E "Error|Test Files|Tests "
```

期望：`Error: Failed to resolve import "../../src/components/InviteSheet" from "tests/dom/invite-sheet.test.tsx". Does the file exist?`，`Test Files  1 failed (1)`，`Tests  no tests`。

- [ ] **Step 3：新建 `useInvitable`**

新建 `src/lib/useInvitable.ts`，完整内容：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { getInvitable } from '../api';
import type { InvitableUser } from '../types';

export type InvitableState =
  | { kind: 'off' } // enabled is false: nothing asked
  | { kind: 'loading' }
  | { kind: 'ready'; users: InvitableUser[] }
  | { kind: 'error' } // anything but 404: the entry stays, the sheet offers 重试
  | { kind: 'unsupported' }; // 404: this API has no /api/me/invitable

export interface Invitable {
  state: InvitableState;
  /** Ask again (the sheet's 重试). */
  reload: () => void;
}

async function loadInvitable(): Promise<InvitableState> {
  try {
    const users = await getInvitable();
    return users === undefined ? { kind: 'unsupported' } : { kind: 'ready', users };
  } catch {
    // The sheet says the list did not load and offers 重试; the reason is not the user's to act on.
    return { kind: 'error' };
  }
}

/**
 * P2-1: who 再叫几个人 can offer, from GET /api/me/invitable (P2-2). Asks once,
 * the first time `enabled` is true (an organizer or admin on an open session
 * that has not started); never for anyone else. `reload` asks again.
 */
export function useInvitable(enabled: boolean): Invitable {
  const [state, setState] = useState<InvitableState>({ kind: 'off' });
  const [attempt, setAttempt] = useState(0);
  const askedFor = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Once per attempt: not again when `enabled` flips back, nor on StrictMode's second run.
    if (!enabled || askedFor.current === attempt) return;
    askedFor.current = attempt;
    setState({ kind: 'loading' });
    void loadInvitable().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
```

要点（契约 §4.6）：`enabled` 第一次为真时请求一次，之后不自动重拉（`askedFor` 记住已经为哪一次 `attempt` 请求过：`enabled` 变回真、StrictMode 的第二次 effect 都不会再发）；`reload` 只由 sheet 的「重试」调用；`mounted` 保证卸载后不再 `setState`（契约 §7.1：不新增 `act(...)` 警告）。`getInvitable` 的 404 → `undefined` → `unsupported`；其他错误 → `error`。

- [ ] **Step 4：新建 `InviteSheet`**

新建 `src/components/InviteSheet.tsx`，完整内容：

```tsx
import { useState } from 'react';
import { INVITES_PER_ORGANIZER, MAX_INVITES } from '@shared/attendance';
import type { InviteResponse, SessionDetail } from '../types';
import { ApiError, inviteToSession } from '../api';
import { inviteGroups, toggleInvite, type InviteRow } from '../lib/invitePicker';
import type { Invitable, InvitableState } from '../lib/useInvitable';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import './invite-sheet.css';

interface InviteSheetProps {
  session: SessionDetail;
  invitable: Invitable;
  onClose: () => void;
  onInvited: (result: InviteResponse) => void;
}

const TITLE_ID = 'invite-sheet-title';
const ROW_TAG: Record<Exclude<InviteRow['state'], 'free'>, string> = {
  in: '已在局里',
  out: '说了不来',
};

interface SendInvites {
  error: string | null;
  busy: boolean;
  send: (userIds: readonly string[]) => Promise<void>;
}

/** One POST …/invite; on failure the sheet stays open with the server's reason. */
function useSendInvites(sessionId: number, onInvited: (result: InviteResponse) => void): SendInvites {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (userIds: readonly string[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onInvited(await inviteToSession(sessionId, [...userIds]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
      setBusy(false);
    }
  };
  return { error, busy, send };
}

/**
 * 再叫几个人 — the minimal P2-1 sheet over the session detail (spec §3.5; the
 * full one, with search and 和上次一样, is P3-3). Rows already in the session
 * are greyed out: POST …/invite never changes them anyway. No scores, no
 * Discord status: only what the rules are (spec §4.3).
 */
export function InviteSheet({ session, invitable, onClose, onInvited }: InviteSheetProps): JSX.Element {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const { error, busy, send } = useSendInvites(session.id, onInvited);
  const { state, reload } = invitable;
  const full = selected.length >= MAX_INVITES;
  const count = selected.length;

  return (
    <Modal open onClose={onClose} labelledBy={TITLE_ID} variant="sheet" title="再叫几个人" historyKey="invite">
      <div className="ivs">
        <ListStatus state={state} onRetry={reload} />
        {state.kind === 'ready' && (
          <PeoplePicker
            groups={inviteGroups(state.users, session.players)}
            selected={selected}
            full={full}
            busy={busy}
            onToggle={(id) => setSelected((prev) => toggleInvite(prev, id))}
          />
        )}
        {full && <p className="ivs__cap">一次最多叫 {MAX_INVITES} 人</p>}
        <p className="ivs__note">
          绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 {INVITES_PER_ORGANIZER} 条邀请私信。
        </p>
        <p className="ivs__note">没绑的人要自己上网页看，把链接发到群里最稳。</p>
        {error && (
          <p className="ivs__error" role="alert">
            {error}
          </p>
        )}
        <div className="ivs__bar">
          <span className="ivs__count tabular">已选 {count} 人</span>
          <button
            type="button"
            className="btn btn--gold"
            disabled={busy || count === 0}
            onClick={() => void send(selected)}
          >
            {busy ? '叫人中…' : count > 0 ? `叫 ${count} 人` : '叫人'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Loading, a failed list (with 重试), or nobody to ask. Never an alert: the dialog behind has none either. */
function ListStatus({ state, onRetry }: { state: InvitableState; onRetry: () => void }): JSX.Element | null {
  if (state.kind === 'loading') {
    return (
      <p className="ivs__status" role="status">
        加载中…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="ivs__status">
        <p role="status">名单没加载出来，稍后再试。</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          重试
        </button>
      </div>
    );
  }
  if (state.kind === 'ready' && state.users.length === 0) {
    return <p className="ivs__status">还没有别的朋友登录过。把链接发到群里，他们登录后就能在这里叫到。</p>;
  }
  return null;
}

interface PeoplePickerProps {
  groups: ReturnType<typeof inviteGroups>;
  selected: readonly string[];
  full: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
}

function PeoplePicker({ groups, selected, full, busy, onToggle }: PeoplePickerProps): JSX.Element {
  const group = (legend: string, rows: InviteRow[]): JSX.Element | null =>
    rows.length === 0 ? null : (
      <fieldset className="ivs__group">
        <legend className="ivs__legend">{legend}</legend>
        {rows.map((row) => (
          <PersonRow
            key={row.user.id}
            row={row}
            checked={selected.includes(row.user.id)}
            locked={busy || (full && !selected.includes(row.user.id))}
            onToggle={onToggle}
          />
        ))}
      </fieldset>
    );
  return (
    <>
      {group('在榜的', groups.onBoard)}
      {group('其他朋友（未上榜，不参与计分）', groups.others)}
    </>
  );
}

interface PersonRowProps {
  row: InviteRow;
  checked: boolean;
  /** Busy, or the list is full and this one is not in it. */
  locked: boolean;
  onToggle: (id: string) => void;
}

/** A checkbox per person: avatar and name only. Already in / said no: disabled, with why. */
function PersonRow({ row, checked, locked, onToggle }: PersonRowProps): JSX.Element {
  const { user, state } = row;
  const off = state !== 'free';
  return (
    <label className={`ivs__row${off ? ' ivs__row--off' : ''}`}>
      <input
        type="checkbox"
        checked={!off && checked}
        disabled={off || locked}
        onChange={() => onToggle(user.id)}
      />
      <Avatar name={user.username} src={user.avatar_url} size={24} />
      <span>{user.username}</span>
      {off && ' '}
      {off && <span className="ivs__tag">· {ROW_TAG[state]}</span>}
    </label>
  );
}
```

要点：
- `<Modal … variant="sheet" title="再叫几个人" historyKey="invite">`：P1-2 的返回键关闭；`'invite'` 不超过 `HISTORY_SHEET_NAME_MAX`（32）。
- DOM 顺序 = 视觉顺序（契约 §4.6）：状态 → 两组 → 「一次最多叫 20 人」 → 两句规则 → 错误（`role="alert"`，只在 sheet 内）→ 底部「已选 N 人」+ 金色主按钮。
- 名单错误态用 `role="status"`，不用 alert（`organizer-actions.test.tsx:356` 锁了详情里没有 alert）。
- 每人是真的 checkbox（不是只靠颜色的胶囊）：`in` / `out` 的禁用并在名字后写「· 已在局里」「· 说了不来」——文字和名字之间是一个独立的空格文本节点，所以可访问名是「玩家a · 已在局里」。**不显示分数、段位、是否绑了 Discord**（契约 §6 第 2 条）。
- 按钮文案：0 人「叫人」（禁用）、N 人「叫 N 人」、提交中「叫人中…」。新按钮不叫裸的「取消」「确认」「关闭」。

- [ ] **Step 5：新建样式**

新建 `src/components/invite-sheet.css`，完整内容：

```css
/* 再叫几个人 — InviteSheet, nested over 约局详情 (P2-1) */

.ivs {
  display: grid;
  gap: 1rem;
}

.ivs__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  font-size: var(--fs-sm);
  color: var(--muted);
}

.ivs__group {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.ivs__legend {
  margin-bottom: 0.35rem;
  padding: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}

.ivs__row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: var(--tap-min);
  padding: 0 0.25rem;
  border-radius: var(--r-sm);
  font-size: var(--fs-md);
  color: var(--text);
  cursor: pointer;
}

.ivs__row > input {
  flex: none;
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  accent-color: var(--action);
}

/* Already in, or said no: greyed and not pickable — the words say why, not only the colour. */
.ivs__row--off {
  color: var(--muted);
  cursor: default;
}

.ivs__tag {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.ivs__cap {
  font-size: var(--fs-sm);
  color: var(--action);
}

.ivs__note {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.ivs__error {
  font-size: var(--fs-sm);
  color: var(--danger-text);
}

.ivs__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border);
}

.ivs__count {
  font-size: var(--fs-sm);
  color: var(--muted);
}
```

（BEM 前缀 `.ivs`，只用 `theme.css` 已有的 token；没有 `:hover` 规则；不改焦点样式——checkbox 用 `theme.css` 的 `:focus-visible`；红字用 `--danger-text`；`.ivs__row > input` 不写边框，过 `css-conventions` 的表单控件规则。）

- [ ] **Step 6：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/invite-sheet.test.tsx 2>&1 | grep -E "Test Files|Tests "
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts 2>&1 | grep -E "Test Files|Tests "
npm run typecheck
```

期望：`Tests  7 passed (7)`；css-conventions `Tests  13 passed (13)`；typecheck 通过。

- [ ] **Step 7：提交**

```bash
git add src/lib/useInvitable.ts src/components/InviteSheet.tsx src/components/invite-sheet.css tests/dom/invite-sheet.test.tsx
git commit -m "feat: 最简版「再叫几个人」InviteSheet 和 useInvitable（P2-1）"
```

---

### Task 6：约局详情接上「＋ 再叫几个人」

**Files:**
- Modify: `src/components/SessionDetailDialog.tsx`（契约 3.1 的 7 点；其余区域不碰）
- Test: `tests/dom/invite-sheet.test.tsx`（import 区 + 末尾新 describe，11 个用例）

- [ ] **Step 1：写失败的测试**

import 区：`tests/dom/invite-sheet.test.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
import { InviteSheet } from '../../src/components/InviteSheet';
import type { Invitable, InvitableState } from '../../src/lib/useInvitable';
import type { InvitableUser, SessionDetail, SessionPlayer } from '../../src/types';
```

改成：

```tsx
import { InviteSheet } from '../../src/components/InviteSheet';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { ToastProvider } from '../../src/components/Toast';
import { bootRouter } from '../../src/lib/router';
import type { Invitable, InvitableState } from '../../src/lib/useInvitable';
import type { InvitableUser, SessionDetail, SessionPlayer, User } from '../../src/types';
import { drainHistoryTraversals, overlayMarks } from './history';
```

末尾追加：在 `tests/dom/invite-sheet.test.tsx` 的**文件末尾**（最后一行 `});` 之后）空一行，追加：

```tsx
describe('再叫几个人 in the session dialog', () => {
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
  const detail = (s: SessionDetail): Response => json(200, { session: s, records: [] });
  const friends = (): Response => json(200, { users: FRIENDS });
  const listRequests = (calls: Call[]): Call[] => calls.filter((c) => c.path === '/api/me/invitable');

  /** The dialog inside a ToastProvider, as App renders it. */
  function renderDialog(me: User | null): Mock {
    const onChanged = vi.fn();
    render(
      <ToastProvider>
        <SessionDetailDialog sessionId={1} me={me} onClose={() => {}} onChanged={onChanged} />
      </ToastProvider>,
    );
    return onChanged;
  }

  /** Let a response already on its way land (inside act: it sets state). */
  async function settle(): Promise<void> {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }

  it('the organizer gets ＋ 再叫几个人, first, before 改时间', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()), 'GET /api/me/invitable': friends });
    renderDialog(ORGANIZER);
    const entry = await screen.findByRole('button', { name: '再叫几个人' });
    expect(entry).toHaveTextContent('＋ 再叫几个人');
    const reschedule = screen.getByRole('button', { name: '改时间' });
    expect(entry.compareDocumentPosition(reschedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an API without /api/me/invitable (404): no entry, and nothing said about it', async () => {
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': () => json(404, { error: 'Not Found' }),
    });
    renderDialog(ORGANIZER);
    expect(await screen.findByRole('button', { name: '改时间' })).toBeInTheDocument();
    await waitFor(() => expect(listRequests(calls)).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('button', { name: '再叫几个人' })).toBeNull();
    expect(screen.queryByText(/名单/)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it.each([
    ['a player', PLAYER, { my_rsvp: 'invited' as const }],
    ['a visitor', null, {}],
    ['the organizer, once it has started', ORGANIZER, { starts_at: at(28, 9) }],
    ['the organizer of a cancelled session', ORGANIZER, { status: 'cancelled' as const }],
  ])('%s: no list request, no entry', async (_who, me, overrides) => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession(overrides)), 'GET /api/me/invitable': friends });
    renderDialog(me);
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    await settle();
    expect(listRequests(calls)).toEqual([]);
    expect(screen.queryByRole('button', { name: '再叫几个人' })).toBeNull();
  });

  it('inviting closes the sheet, shows who was asked, tells the lists and says so', async () => {
    const after = makeSession({
      counts: { invited: 3, going: 2, maybe: 1, out: 1 },
      players: [...makeSession().players, player('e', 'invited'), player('f', 'invited')],
    });
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': friends,
      'POST /api/sessions/1/invite': () => json(200, { session: after, added: 2, skipped: 0 }),
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家f' }));
    await user.click(within(sheet).getByRole('button', { name: '叫 2 人' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '再叫几个人' })).toBeNull());
    expect(await screen.findByText('已叫 2 人。没绑 Discord 的朋友，记得在群里喊一声。')).toBeInTheDocument();
    expect(screen.getByText('玩家e')).toBeInTheDocument();
    expect(screen.getByText('玩家f')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '再叫几个人' })).toHaveFocus();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/invite', body: { user_ids: ['e', 'f'] } },
    ]);
    expect(listRequests(calls)).toHaveLength(1);
  });

  it('nobody new: says so', async () => {
    mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': friends,
      'POST /api/sessions/1/invite': () => json(200, { session: makeSession(), added: 0, skipped: 1 }),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    await user.click(screen.getByRole('checkbox', { name: '玩家e' }));
    await user.click(screen.getByRole('button', { name: '叫 1 人' }));
    expect(await screen.findByText('没有叫到新的人：选的人已经在局里了。')).toBeInTheDocument();
  });

  it('a list that failed to load keeps the entry; 重试 in the sheet asks again', async () => {
    let failing = true;
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': () => (failing ? json(500, { error: '服务器开小差了' }) : friends()),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    expect(within(sheet).getByRole('status')).toHaveTextContent('名单没加载出来，稍后再试。');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    failing = false;
    await user.click(within(sheet).getByRole('button', { name: '重试' }));
    expect(await within(sheet).findByRole('checkbox', { name: '玩家e' })).toBeEnabled();
    expect(listRequests(calls)).toHaveLength(2);
  });

  it('the back button closes only the sheet', async () => {
    window.history.replaceState(null, '', '/');
    bootRouter();
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()), 'GET /api/me/invitable': friends });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    expect(overlayMarks().sheet).toBe('invite');
    await act(async () => {
      window.history.back();
      await drainHistoryTraversals();
    });
    expect(screen.queryByRole('dialog', { name: '再叫几个人' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '周五五排' })).toBeInTheDocument();
    expect(writes(calls)).toEqual([]);
  });

  it('an admin who was invited still has exactly one 来, and none in the sheet', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })), 'GET /api/me/invitable': friends });
    const user = userEvent.setup();
    renderDialog(ADMIN);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    expect(within(sheet).queryByRole('button', { name: '来' })).toBeNull();
    // The panel behind is inert while the sheet is up: count it too.
    expect(screen.getAllByRole('button', { name: '来', hidden: true })).toHaveLength(1);
  });
});
```

要点：
- 「404 时入口不存在」是 spec §8「新接口在旧 Worker 上返回 404 时，前端静默隐藏对应入口，每个入口配一条降级测试」要的那条：先等名单请求真的发出，再让 404 落地（`settle()`），断言没有入口、没有「名单…」字样、没有 alert。
- 四种不发请求（普通玩家、访客、已开局、已取消）用 `it.each`，计 4 个用例。
- 返回键用例照 `back-closes-layer.test.tsx` 的写法：`bootRouter()` 后打开 sheet，`history.state.sheet` 是 `'invite'`，`history.back()` 只关 sheet，详情弹窗还在。
- 最后一条锁住 `session-rsvp-moved` 的约定：管理员（也被邀请了）打开 sheet 时，整页仍只有一个「来」（sheet 打开时后面的面板是 inert，所以用 `hidden: true` 数），sheet 里没有「来」。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/invite-sheet.test.tsx 2>&1 | grep -E "×|→|Tests "
```

期望：`Tests  7 failed | 11 passed (18)`。失败的 7 个：`the organizer gets ＋ 再叫几个人 …`、`inviting closes the sheet …`、`nobody new …`、`a list that failed to load …`、`the back button …`、`an admin who was invited …`（都是 `Unable to find role="button" and name "再叫几个人"`），以及 `an API without /api/me/invitable (404) …`（`expected [] to have a length of 1 but got +0`：还没有人发名单请求）。通过的 11 个是 Task 5 的 7 个和四个「不发请求」（此时本来就不发）。

- [ ] **Step 3：接线（契约 3.1，逐条）**

3a. import 区（第 1 点）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
import type { RecordItem, SessionDetail, User } from '../types';
```

改成：

```tsx
import type { InviteResponse, RecordItem, SessionDetail, User } from '../types';
```

`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
```

改成：

```tsx
import { inviteToast } from '../lib/invitePicker';
import { formatDateTime, formatWhen, parseTimestamp } from '../lib/time';
```

`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
import { useUndo } from '../lib/useUndo';
```

改成：

```tsx
import { useInvitable } from '../lib/useInvitable';
import { useUndo } from '../lib/useUndo';
```

`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
import { RescheduleSheet } from './RescheduleSheet';
```

改成：

```tsx
import { RescheduleSheet } from './RescheduleSheet';
import { InviteSheet } from './InviteSheet';
```

3b. state（第 2 点）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
```

改成：

```tsx
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
```

3c. `handleInvited`（第 4 点；toast 文案来自 `inviteToast`，`tone: 'ok'`，不用 alert）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
    toast.show({ message: `已改到 ${formatWhen(updated.starts_at)}。`, tone: 'ok' });
    onChanged();
  };
```

改成：

```tsx
    toast.show({ message: `已改到 ${formatWhen(updated.starts_at)}。`, tone: 'ok' });
    onChanged();
  };

  const handleInvited = (result: InviteResponse): void => {
    setInviteOpen(false);
    setSession(result.session);
    setError(null);
    toast.show({ message: inviteToast(result.added), tone: 'ok' });
    onChanged();
  };
```

3d. 显示条件和 hook（第 3、5 点；hook 在 `return` 之前无条件调用，`enabled` 为假时不发请求）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
  const canRollCall = canManage && session?.status === 'open' && started;
```

改成：

```tsx
  const canRollCall = canManage && session?.status === 'open' && started;
  // P2-1: 再叫几个人 — same gate as the server (requireOrganizer, open, not started).
  const canInvite = canManage && session?.status === 'open' && !started;
  const invitable = useInvitable(canInvite);
  // 404 (an API without the list) hides the entry; a failed list keeps it — the sheet offers 重试.
  const showInviteEntry = invitable.state.kind === 'ready' || invitable.state.kind === 'error';
```

3e. 传给 `OrganizerActions`（第 5 点）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
                busy={busy}
                onReschedule={() => setRescheduleOpen(true)}
```

改成：

```tsx
                busy={busy}
                onInvite={showInviteEntry ? () => setInviteOpen(true) : undefined}
                onReschedule={() => setRescheduleOpen(true)}
```

3f. 渲染 sheet（第 7 点，在 `RescheduleSheet` 那块之后）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
          onRescheduled={handleRescheduled}
        />
      )}
```

改成：

```tsx
          onRescheduled={handleRescheduled}
        />
      )}

      {session && inviteOpen && (
        <InviteSheet
          session={session}
          invitable={invitable}
          onClose={() => setInviteOpen(false)}
          onInvited={handleInvited}
        />
      )}
```

3g. `OrganizerActions` 的 props（第 6 点）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
  busy: boolean;
  onReschedule: () => void;
  onRollCall: () => void;
```

改成：

```tsx
  busy: boolean;
  /** P2-1: set only when the invitable list answered (ready or failed); absent → no 再叫几个人. */
  onInvite?: () => void;
  onReschedule: () => void;
  onRollCall: () => void;
```

3h. 按钮排在「改时间」之前（第 6 点；`＋ ` 用 `aria-hidden`，可访问名是「再叫几个人」）：`src/components/SessionDetailDialog.tsx`，锚点（原文，整段替换；只出现 1 次）：

```tsx
  busy,
  onReschedule,
  onRollCall,
  onCancel,
}: OrganizerActionsProps): JSX.Element {
  return (
    <div className="sdt__actions">
```

改成：

```tsx
  busy,
  onInvite,
  onReschedule,
  onRollCall,
  onCancel,
}: OrganizerActionsProps): JSX.Element {
  return (
    <div className="sdt__actions">
      {!started && onInvite && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onInvite}>
          <span aria-hidden="true">＋ </span>再叫几个人
        </button>
      )}
```


改完 `wc -l src/components/SessionDetailDialog.tsx` 应是 **510**（契约 3.1：不超过 520）。

- [ ] **Step 4：跑测试，确认通过；再跑会受影响的现有 dom 文件**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/invite-sheet.test.tsx 2>&1 | grep -E "Test Files|Tests "
npx vitest run --config vitest.dom.config.ts tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx tests/dom/login-return.test.tsx tests/dom/back-closes-layer.test.tsx tests/dom/route-pages.test.tsx tests/dom/modal-focus.test.tsx tests/dom/app-refresh.test.tsx 2>&1 | grep -E "×|Test Files|Tests "
npm run typecheck
```

期望：`Tests  18 passed (18)`；七个现有文件 `Test Files  7 passed (7)`、**`Tests  97 passed (97)`**，一个断言都不用改（契约 §7.1：组织者 / 管理员打开开局前的详情时多一个 `GET /api/me/invitable`，在这些文件的 `mockFetch` 里得到 500 → `error` → 入口照常显示、没有 alert；它们只断言 `writes(calls)` 或按路径计数）；typecheck 通过。

- [ ] **Step 5：提交**

```bash
git add src/components/SessionDetailDialog.tsx tests/dom/invite-sheet.test.tsx
git commit -m "feat: 约局详情加「＋ 再叫几个人」入口，接口 404 时静默隐藏（P2-1）"
```

---

## 收尾

- [ ] **完整验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -c "not wrapped in act"
npm run test:server 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
npm run test:pg 2>&1 | grep -E "Test Files|Tests |FAIL"
npm run build
npm run build:pages
test ! -e dist/404.html && echo "no 404.html"
```

期望（相对 Task 0 的基线）：

| 套件 | 文件 | 用例 | 新增来源 |
|---|---|---|---|
| typecheck | — | 通过 | — |
| unit | U0 + 1（= **30**） | U0 + 8（= **422**） | `invite-picker.test.ts` 8 |
| dom | D0 + 1（= **25**） | D0 + 18（= **317**）；`act` 警告 = A0（**3**） | `invite-sheet.test.tsx` 18 |
| server | S0（22） | S0（290） | — |
| worker（D1） | W0（17） | W0 + 13（= **592 passed + 9 todo**） | `invites.test.ts` 9、`session-routes.test.ts` 4 |
| pg | G0（29） | G0 + 16（= **873 passed + 9 todo**） | worker 的 13 个在 PG 上再跑一遍，加 `session-cards.test.ts` 3 |
| build / build:pages | — | 通过，`dist/` 无 `404.html` | — |

规划时在副本（`/tmp/claude-redesign/p1/compose/repo` 的拷贝，上游 = `plan-P2-2.md` 执行后的 `claude/p2-2-invitable`）上**按本计划逐步执行**后实测：typecheck 通过；unit 30 / 422；dom 25 / 317（`act` 警告 3 条，都是 `onboarding-roles`）；server 22 / 290；worker 17 / 592 + 9 todo；pg 29 / 873 + 9 todo（这一次全套无抖动）；build、build:pages 通过，`dist/` 无 `404.html`。各 Task 的红 / 绿也都是实测：Task 1 红 = 模块不存在，绿 = D1 24 / 24、PG 24 / 24、三文件 118 + 1 todo；Task 2 红 = 3 failed | 4 passed，绿 = D1 7 / 7、PG 7 / 7；Task 3 = PG 52 / 52（改 dispatcher 前后都是）；Task 4 红 = 模块不存在，绿 = 8 / 8；Task 5 红 = 模块不存在，绿 = 7 / 7；Task 6 红 = 7 failed | 11 passed，绿 = 18 / 18、七个现有 dom 文件 97 / 97。

- [ ] **范围核对**

```bash
git diff --stat claude/p2-2-invitable -- worker/invitable.ts schema.sql migrations/ server/migrations/ server/src/discord/ src/App.tsx src/components/SessionsPanel.tsx src/components/SessionFormDialog.tsx src/components/RescheduleSheet.tsx src/components/InviteBanner.tsx src/components/Modal.tsx src/lib/router.ts src/theme.css tests/dom/setup.ts tests/dom/history.ts   # 期望：无输出
git diff --stat claude/p2-2-invitable        # 期望：19 files changed（新 7 个：worker/session-invites.ts、src/lib/invitePicker.ts、src/lib/useInvitable.ts、src/components/InviteSheet.tsx、src/components/invite-sheet.css、tests/unit/invite-picker.test.ts、tests/dom/invite-sheet.test.tsx；改 12 个）
git log --oneline claude/p2-2-invitable..HEAD               # 期望：6 个提交（Task 1–6）
git log --format=%B claude/p2-2-invitable..HEAD | grep -ciE "co-authored|generated with"   # 期望：0
git diff claude/p2-2-invitable -- tests/worker/session-routes.test.ts | grep -c "^-[^-]"   # 期望：0（P2-2 的部分一行没删）
grep -rn "console\.log" worker/session-invites.ts src/lib/invitePicker.ts src/lib/useInvitable.ts src/components/InviteSheet.tsx   # 期望：无输出
grep -rn 'history\.\(pushState\|replaceState\|back\|go\|forward\|state\)' src --include='*.ts' --include='*.tsx' | grep -v "src/lib/router.ts"   # 期望：无输出（zsh 下 --include 的值要加引号）
grep -n "discord\|score" src/components/InviteSheet.tsx   # 期望 1 行：文件头注释里的「No scores, no」（规则文案里的 Discord 是大写，不算）
wc -l worker/sessions.ts src/components/SessionDetailDialog.tsx worker/session-invites.ts src/components/InviteSheet.tsx   # 期望 992 / 510 / 86 / 182
git status --short                                           # 期望：无输出
```

- [ ] **手动核对（机主在预览环境做；代理不需要真机）**

用 `npm run dev:web`（或预览部署，Node 后端，带 P2-2），Chrome DevTools 设备模式 375×812、触控：
1. 以组织者打开一个还没开局的约局 → 组织者操作区第一个按钮是「＋ 再叫几个人」，在「改时间」左边；Network 面板里有一次 `GET /api/me/invitable`（`Cache-Control: private, no-store`）。
2. 点开 → 底部抽屉「再叫几个人」：「在榜的」「其他朋友（未上榜，不参与计分）」两组；已经在局里的人置灰带「· 已在局里」，说了不来的置灰带「· 说了不来」；没有任何分数或 Discord 状态；下方两句规则，写着「一天最多收到你 3 条邀请私信」。
3. 按手机返回键（或浏览器后退）→ 只关 sheet，详情还在；再按一次才离开详情。
4. 勾两个人 → 「已选 2 人」「叫 2 人」→ 提交：sheet 关闭，名单里多了两个「待回复」，toast「已叫 2 人。没绑 Discord 的朋友，记得在群里喊一声。」，大厅列表刷新；Network 里正好一个 `POST /api/sessions/N/invite`，正文 `{"user_ids":[…]}`。
5. 被叫的人（绑了 Discord、开着私信）几秒内收到 Bot「📨 … 约你：…」私信；没绑的人在网页首页「要你处理」里看到这局。
6. 以普通玩家打开同一局 → 没有「再叫几个人」，Network 里没有 `/api/me/invitable`；开局后、取消后同样没有。
7. 对着只部署了旧 Worker（没有 `/api/me/invitable`）的环境 → 组织者看不到入口，也没有任何报错提示。
8. 1280×800 桌面：详情是右侧抽屉，sheet 和行为同上。

- [ ] **给机主的 PR 描述要点**：和 P2-2 一起合并、一起部署（契约 §2 第 1 条）；无迁移、不改 PG 触发器和 dispatcher 逻辑（契约 §3.2：`INSERT … ON CONFLICT DO NOTHING` 的新行触发 `dm.session.invited`，已有的行不触发；额度照旧 `INVITES_PER_ORGANIZER = 3` / `SESSION_DM_BUDGET = 10`）；新增名单上限 `MAX_SESSION_ROSTER = 50` 并让点名上限引用它（契约 §8 第 6 条）；`MAX_INVITES`、`INVITES_PER_ORGANIZER` 迁到 `shared/attendance.ts`、原处 re-export、值不变（契约 §8 第 14 条）；逻辑放在新模块 `worker/session-invites.ts` 而不是 spec §8 B2-1 说的 `worker/sessions.ts`（契约 §0：那个文件已超 800 行）；PG 用例放在 `tests/pg/session-cards.test.ts` 而不是 spec 写的 `tests/pg/dm.test.ts`（契约 §8 第 8 条）；隐私：响应和界面都没有「几人能收到私信」（spec §11 第 9 条、§4.3）；界面只是最简版，搜索、「和上次一样」「上次一起玩的」、成功 toast 里的「复制邀请链接」都在 P3-3；下面「对契约的补充」第 1–9 条；PG 抖动如遇到写明。

---

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §8 B2-1：`POST /api/sessions/:id/invite`，登录 + `requireOrganizer`，open 且没开局，READ_ONLY 503 | Task 1（`assertCanInvite`）、Task 2（路由 + HTTP 用例：401、403、400、404、503、CSRF 403） |
| B2-1：请求 `{user_ids}`，复用 `normalizeInvites`（最多 20、去重、去掉组织者） | Task 1 Step 4g（`field` 参数）、Step 6（`requestedIds`）；用例「checks the list」「de-duplicates…」 |
| B2-1：`INSERT … SELECT … ON CONFLICT DO NOTHING`，已有的行（包括说了不来的）一律不动 | Task 1 Step 6（`insertInvites`）；用例「never touches a row that is already there」（`rsvp`、`rsvp_at` 原样）、PG「someone who said no is not asked again」 |
| B2-1：返回 `{session, added, skipped}` | Task 1（`InviteResult`）、Task 2（「answers exactly { session, added, skipped }」断言三个键） |
| B2-1 测试清单：重复、非组织者 403、管理员可以、已开局 400、已取消 400、不覆盖 out、上限 | Task 1 的 9 个用例逐条对应；「上限」既有一次 20 人，也有名单 50 人 |
| B2-1：PG 触发器自动发私信、额度由 dispatcher 管；D1 不发 | Task 3 的 3 个 PG 用例（一条、不重发、共用每天 3 条）；D1 侧不涉及 |
| 契约 §4.3 校验顺序 1–12 与文案 | Task 1 用例（3–12 行、「只剩组织者 200」）、Task 2 用例（1–5 行、CSRF） |
| 契约 §4.3 写入：行锁 + 两个守卫、`added` = changes 之和、`skipped = ids.length - added` | Task 1 Step 6；并发路径没有确定性用例，见「对契约的补充」第 6 条 |
| 契约 §4.4：`MAX_INVITES`、`MAX_SESSION_ROSTER`、`INVITES_PER_ORGANIZER` 进 shared，原处 re-export，`MAX_ROLLCALL_ENTRIES = MAX_SESSION_ROSTER` | Task 1 Step 3–4、Task 3 Step 3；用例「takes its limits from shared/attendance」、PG 用例首行、unit「the limits the sheet and the server share」 |
| 契约 §4.5：`inviteToSession(id, userIds): Promise<InviteResponse>` | Task 4 Step 5；dom「sends exactly { user_ids }」 |
| 契约 §4.6 入口：`canManage` + open + 没开局 + `ready`/`error`；在「改时间」之前；可访问名「再叫几个人」 | Task 6 Step 3d、3h；dom「the organizer gets ＋ 再叫几个人, first, before 改时间」 |
| 契约 §4.6 / spec §8：404 静默隐藏，配降级测试 | Task 5（`unsupported`）、Task 6；dom「an API without /api/me/invitable (404)…」 |
| 契约 §4.6：不满足条件时不发 `/api/me/invitable` | Task 6；dom `it.each` 四种 |
| 契约 §4.6 `useInvitable`：首次 enabled 时请求一次、`reload` 只由重试调、卸载后不 setState | Task 5 Step 3；dom「a list that failed to load…重试」（正好 2 次请求）、「inviting closes the sheet…」（正好 1 次） |
| 契约 §4.6 `invitePicker`：`inviteGroups`、`toggleInvite` | Task 4；unit 7 个 |
| spec §3.5 / 契约 §4.6 InviteSheet：两组、置灰「已在局里」「说了不来」、不显示分数和 Discord、20 人上限、两句规则（3 来自常量）、错误只在 sheet、「已选 N 人」「叫 N 人」 | Task 5；sheet 的 7 个 dom 用例 |
| 契约 §4.6：`historyKey="invite"`，返回键关闭（P1-2） | Task 5 Step 4；dom「the back button closes only the sheet」 |
| 契约 §4.6 toast 两种文案、`tone: 'ok'` | Task 4（`inviteToast`）、Task 6 Step 3c；dom「inviting closes the sheet…」「nobody new: says so」 |
| 契约 3.1：签名不变、7 点、不碰 RSVP / 取消 / 名单 / 记录 / Modal / P1-3 区、≤ 520 行 | Task 6 Step 3（3a–3h）；`wc -l` = 510 |
| 契约 §6 第 2 条 / spec §11 第 9 条：没有可达人数 | Task 2「…nothing about who can be reached」（响应不含 `discord`）；sheet「says the rules, never who can be reached」 |
| 契约 §7.1：`organizer-actions:356` 无 alert、`session-rsvp-moved` 一个「来」、各 `mockFetch` 的 500、`act` 警告仍 3 条、`modal-focus` 原样 | Task 6 Step 4（七个现有文件 97 / 97）、收尾（A0 = 3）；dom「an admin who was invited still has exactly one 来」 |
| 契约 §3.4 SQL 方言 | Task 1 Step 7 在 PG 上跑同一文件；收尾全量 pg |
| P0/P1 契约：CSS 过 css-conventions、无 hover、DOM 顺序 = 视觉顺序、新按钮不叫裸「取消/确认/关闭」、只有 router 碰 history | Task 5 Step 5–6；收尾的 grep |
| spec §4.1「同步机制：`inviteToSession` 成功后派发 `edg:session`」 | 不在 P2-1（P3 的同步机制）；本 PR 用返回的 `session` 替换详情并 `onChanged()` 让列表刷新，见「对契约的补充」第 8 条 |

## 对契约的补充

以下是契约没写死、本计划写死了的东西（理由附后），请写进 PR 描述、机主过目：

1. **前端的结果类型叫 `InviteResponse`**：契约 3.1 第 1、4 条写「`InviteResult` 类型」「`handleInvited(result: InviteResult)`」，但 `InviteResult` 是 `worker/types.ts` 的名字；契约 4.2 / 4.5 / 4.6 给前端定的是 `src/types.ts` 的 `InviteResponse`。`SessionDetailDialog` 从 `../types` 引入 `InviteResponse`，形状相同。
2. **`useInvitable` 的返回类型导出为 `Invitable`**（`{ state: InvitableState; reload: () => void }`，形状和契约 4.6 一字不差），`InviteSheet` 的 `invitable` prop 用它，免得同一个对象类型写两遍。
3. **`invitePicker.ts` 多导出 `inviteToast(added)`**：契约 4.6 的两条 toast 文案放进纯模块，unit 直接锁原文；`SessionDetailDialog` 只调用它。
4. **HTTP 的 CSRF 用例用 `Content-Type: text/plain`**：契约 4.3 表末行「CSRF 失败 403」。hono/csrf 放过 `application/json`（交给 CORS 预检，`http-guards.test.ts` 锁着），所以用 JSON 发的跨站请求会到达路由并以 200 成功（同站的 cookie 在测试里是直接带上的）；真正的 CSRF 形态是不需要预检的 `text/plain`，而 `readJsonBody` 照样解析它。用例因此在 Task 2 的红阶段就通过（中间件在路由之前），它锁的是「新路由在这两道中间件后面」。
5. **名单上限检查里「请求里还不在局里的人数」把不存在的 id 也算进去**（契约 4.3 第 12 条没区分）：只在离 50 人只差几个时有影响，最坏是一个打错的 id 让请求被拒、提示「已经有 N 人了」；不存在的 id 本来就会在写入时被丢掉。这样少一次 `users` 查询。
6. **SQL 守卫的并发路径没有确定性的用例**：「检查之后、写入之前名单被别人加满」需要两个连接交错，D1 串行执行 batch 做不到；行为由每条 INSERT 的 `(SELECT COUNT(*) …) < 50` 和 `EXISTS … status = 'open'` 保证，超出的行 `changes = 0` 计入 `skipped`。单线程下的名单上限和「已取消」都有用例。
7. **PG 用例 3 个**（契约 §9 估约 2）：多了「说了不来的人不会被重新邀请」，因为它是 spec §3.5「尊重对方的回答」在私信上的体现（没有新的 `dm.session.invited` 事件）。
8. **不派发 `edg:session` 事件**：spec §4.1 的同步机制（收件箱、大厅、详情按 id 合并）是 P3 的；P2-1 只按契约 3.1 第 4 条用返回的 `session` 替换详情，再 `onChanged()` 让 App 刷新列表（和 `handleRescheduled` 同一做法）。
9. **InviteSheet 的每一行是可见的原生 checkbox**，不是 `SessionFormDialog` 那种隐藏 input 的胶囊：最简版不抽 `PeoplePicker`（spec §3.5 说从 SessionFormDialog 抽出来，那是 P3-3），而可见的 checkbox 让选中状态不只靠颜色、置灰的行也有原生的禁用语义。管理员（不是组织者）打开时，组织者本人会出现在名单里并显示「· 已在局里」（P2-2 只排除调用者）。
