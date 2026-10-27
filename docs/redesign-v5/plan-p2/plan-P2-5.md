# P2-5 私信状态与开关 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已绑定 Discord 的人在网页上也能知道、也能改自己的私信状态：`GET /api/me/discord` 的 `link` 多两个布尔 `notify_dm`（私信开着没有）、`dm_ok`（上次私信送没送到）；新增 `POST /api/me/discord/notify {on}`，和 bot 的 `/notify` 是**同一个开关**（打开或关闭都把 `dm_ok` 重置为 1：「谁来要私信就再给一次机会」）。前端 `src/api.ts` 提供类型和 `setDiscordNotify`，404（旧 Worker、没配 Discord）时返回 `undefined`，让以后的界面静默隐藏。

**Architecture:** 只在 Node 端。写入收拢到 `server/src/discord/links.ts` 的新函数 `setNotifyDm(db, who, on)`（按 `user_id` 或 `discord_user_id` 定位，UPDATE 后读回，没有绑定返回 null）；bot 的 `handleNotify`（`server/src/discord/commands.ts`）改为调用它，回复文案一字不改；`server/src/link-routes.ts` 新增 `POST /api/me/discord/notify`，写法照 `/api/me/discord/unlink`（READ_ONLY → 登录 → 校验 → 写），GET 和 POST 共用一个只挑四个字段的 `linkView`（仍然从不下发 Discord id）。路由天然落在 `server/src/api-host.ts` 的 `isBindingPath`（`/api/me/discord` 前缀）里，CORS、CSRF 中间件不改就覆盖到。**本 PR 不改任何组件**：契约第 8 节第 1 条把 P2-5 的私信开关界面放在 P4-1（spec §3.9 `/me/notify`：`DiscordLinkCard` 加可选 `onStatus`，不增加请求）。

**Tech Stack:** Hono（Node 端 link-routes）、PostgreSQL（经 `server/src/db/d1.ts` 适配器，`discord_links` 只在 PG 里有）、React 前端的 `src/api.ts`；vitest（pg：`vitest.pg.config.ts`，嵌入式 PG 17；dom：`vitest.dom.config.ts`，jsdom）。

**依赖:** P2 共享契约 本目录的 [contract.md](contract.md)（第 2 节 P2-5 文件清单、第 3 节 `server/src/discord/commands.ts`/`links.ts`/`link-routes.ts`/`src/api.ts`/`docs/DEPLOY-DISCORD.md` 的分区、4.1 端点表、4.3「`POST /api/me/discord/notify {on}`」、4.5 P2-5、第 6 节第 3 条、7.1 `link-flow.test.ts:619` 与 `:652-671`、7.2、7.3、8 第 1 与第 13 条、9 P2-5 行）；spec `docs/redesign-v5/spec.md` §8 B2-5、§9 P2-5、§4.3（M22：本人自查）、§10 第 6 条。上游 P2-1 … P2-4 都不碰本 PR 的源文件（契约第 2 节第 5 条），只在 `src/api.ts` 的别的小节、`docs/DEPLOY-DISCORD.md` 的别的行动过；本 PR 不消费任何 P2 新导出。

**分支:** `claude/p2-5-dm-status`，从 `claude/p2-4-board-time` 的 HEAD 开（`git switch -c claude/p2-5-dm-status claude/p2-4-board-time`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR。

---

## 文件结构

所有路径相对仓库根目录。行号指契约基线副本 `/tmp/claude-redesign/p1/compose/repo`，只作提示，**一律按引用的锚点文字定位**（`server/src/**`、`tests/pg/link-flow.test.ts`、`tests/dom/discord-link.test.tsx` 是 P2-1 … P2-4 都不碰的，行号不变；`src/api.ts` 被 P2-2、P2-1、P2-3 在前面的小节加过行，本 PR 的锚点在合成副本上落在约第 380 行之后，**只认锚点**；`docs/DEPLOY-DISCORD.md` 的 `:8`、`:20` 在 P2-3、P2-4 改动的第 7 节之前，不漂）。

| 文件 | 新/改 | 职责 |
|---|---|---|
| `server/src/discord/links.ts` | 改 | `interface DiscordLink` 在 `notify_dm: number;` 后加 `dm_ok: number;`；文件末尾（`unlinkAccounts` 之后）新增 `setNotifyDm` |
| `server/src/discord/commands.ts` | 改 | import 行 `import { boundUser, linkByDiscordId, unlinkAccounts } from './links';` 换掉 `linkByDiscordId`；`async function handleNotify` 里的 UPDATE 换成 `setNotifyDm(ctx.db, { discordUserId: input.caller.id }, on)`，回复文案不变 |
| `server/src/link-routes.ts` | 改 | 文件头路由注释加一行；import 加 `optBool`、`readJsonBody`、`setNotifyDm`、`type DiscordLink`；`const READ_ONLY_MESSAGE` 之后加两条错误文案和 `linkView`；`app.get('/api/me/discord'` 改用 `linkView`；`app.post('/api/me/discord/unlink'` 之后新增 `app.post('/api/me/discord/notify'` |
| `src/api.ts` | 改（只动 `// --- Discord binding (Node backend only) ---` 小节） | `interface DiscordLinkInfo` 加可选 `notify_dm?`、`dm_ok?`；小节末尾（`unlinkDiscord` 之后）加 `setDiscordNotify` |
| `docs/DEPLOY-DISCORD.md` | 改（只动 `:8`、`:20` 两行） | 404 那句补上 `POST /api/me/discord/notify`；命令表 `/notify` 一行补「网页上也能开关」 |
| `tests/pg/link-flow.test.ts` | 改 | 顶部 import 加 `handleCommand`、`setNotifyDm`；`:619` 的键集合改成四个；文件末尾追加 describe `setNotifyDm`（2 例）和 describe `the DM switch: /api/me/discord and /api/me/discord/notify`（6 例） |
| `tests/dom/discord-link.test.tsx` | 改 | import 行加 `setDiscordNotify`；文件末尾追加 describe `setDiscordNotify`（3 例，只测 `api.ts`，不渲染组件） |

不碰：任何组件（`DiscordLinkCard.tsx`、`OnboardingDialog.tsx` 等，界面是 P4-1）、`worker/`、`shared/`、`schema.sql`、`migrations/`、`server/migrations/`（`notify_dm` 在 `0002_discord.sql:12`、`dm_ok` 在 `0004_dm.sql:11`，早已存在）、`server/src/api-host.ts`、`server/src/outbox/*`、`docs/CONTRACT.md`（契约第 3 节：P2-5 不碰）、`link_audit`（开关不是绑定变更）。

---

### Task 0：开工核对

**Files:** 无改动（只读核对）。

- [ ] **Step 1：确认上游分支、工作区干净，开分支**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
git status --short                         # 期望：无输出
git branch --list claude/p2-4-board-time   # 期望：列出这个分支
git switch -c claude/p2-5-dm-status claude/p2-4-board-time
git log --oneline -1                       # 记下起点 commit
```

上游分支不存在或工作区不干净 → 停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对本 PR 要改的锚点都在、没被上游动过**

```bash
grep -nF "export function optBool(v: unknown): boolean | undefined {" worker/http.ts            # 期望 1 行
grep -nF "export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {" worker/http.ts   # 期望 1 行
grep -nF "return under(path, '/link') || under(path, '/api/me/discord');" server/src/api-host.ts  # 期望 1 行（新路由由它转给 link-routes）
grep -nF "  notify_dm: number;" server/src/discord/links.ts                                     # 期望 1 行
grep -nc "dm_ok" server/src/discord/links.ts                                                    # 期望 0
grep -nF "import { boundUser, linkByDiscordId, unlinkAccounts } from './links';" server/src/discord/commands.ts   # 期望 1 行
grep -nF "async function handleNotify(input: CommandInput, ctx: BotContext): Promise<BotReply> {" server/src/discord/commands.ts   # 期望 1 行
grep -nF "app.post('/api/me/discord/unlink', async (c) => {" server/src/link-routes.ts         # 期望 1 行
grep -nF "// --- Discord binding (Node backend only) -----------------------------------" src/api.ts   # 期望 1 行
grep -nF "export async function unlinkDiscord(): Promise<void> {" src/api.ts                    # 期望 1 行
grep -nF "    expect(Object.keys(body.link).sort()).toEqual(['discord_username', 'linked_at']);" tests/pg/link-flow.test.ts   # 期望 1 行
grep -nE "notify_dm|dm_ok|setNotifyDm|setDiscordNotify" server/src/link-routes.ts src/api.ts tests/pg/link-flow.test.ts tests/dom/discord-link.test.tsx   # 期望无输出
```

任何一条不符 → 停下报告（说明上游改了契约说它不碰的地方）。

- [ ] **Step 3：跑六个套件和 build，记下开工数字**

```bash
npm run typecheck
npm run test:unit
npm run test:dom      # 记下 act(...) 警告条数：应当只有 onboarding-roles 的 3 条
npm run test:server
npm run test:worker
npm run test:pg       # 约 60–110 秒；adapter.test.ts 的 5 秒超时见契约第 1 节，单独重跑那一个文件确认
npm run build
```

把文件数 / 用例数填进下表「开工时」一列，应当等于 P2-4 计划「完工时」的数字。对不上就停下，不在本 PR 里补别人的东西。

| 套件 | 开工时（= P2-4 完工时，跨 PR 合成副本实测） | 本 PR 预计增量 | 完工时（合成副本实测） |
|---|---|---|---|
| unit | 31 / 456 | 0 | 31 / 456 |
| dom | 26 / 322，`act` 3 条 | +3 用例（文件数不变） | 26 / 325，`act` 3 条 |
| server | 22 / 295 | 0 | 22 / 295 |
| worker | 20 / 621 + 9 todo | 0 | 20 / 621 + 9 todo |
| pg | 32 / 906 + 9 todo | +8 用例（文件数不变；`link-flow` 40 → 48） | 32 / 914 + 9 todo |

规划者当初只在「契约基线 + 本 PR」上自检（不含 P2-1 … P2-4：开工 29/414、24/299、22/290、15/560、27/838；完工 dom 24/302、pg 27/846），增量和合成副本一致。

---

### Task 1：`setNotifyDm`，bot `/notify` 改用它

**Files:**
- 改：`server/src/discord/links.ts`
- 改：`server/src/discord/commands.ts`
- 测试：`tests/pg/link-flow.test.ts`（import 区 + 末尾追加 describe `setNotifyDm`）

- [ ] **Step 1：写失败的测试**

`tests/pg/link-flow.test.ts` 顶部，把锚点

```ts
import { linkAccounts } from '../../server/src/discord/links';
```

换成

```ts
import { handleCommand } from '../../server/src/discord/commands';
import { linkAccounts, setNotifyDm } from '../../server/src/discord/links';
```

文件末尾（`describe('the API host', () => {` 那个 describe 的结尾 `});` 之后）追加：

```ts
describe('setNotifyDm', () => {
  const BOT = { db: pgEnv.DB, appUrl: API, frontendUrl: SPA };

  async function dmState(userId: string): Promise<{ notify_dm: number; dm_ok: number } | null> {
    return pgEnv.DB.prepare('SELECT notify_dm, dm_ok FROM discord_links WHERE user_id = ?')
      .bind(userId)
      .first<{ notify_dm: number; dm_ok: number }>();
  }

  async function closeDms(userId: string): Promise<void> {
    await pgEnv.DB.prepare('UPDATE discord_links SET dm_ok = 0 WHERE user_id = ?').bind(userId).run();
  }

  it('finds the binding by Nanako or Discord id, and every switch clears a closed-DM mark', async () => {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    await linkAccounts(pgEnv.DB, { userId: 'b', discordUserId: BOB_ID, discordUsername: 'bob', replace: false, via: 'web' });
    await closeDms('a');

    const off = await setNotifyDm(pgEnv.DB, { userId: 'a' }, false);
    expect(off).toMatchObject({ user_id: 'a', discord_user_id: ALICE_ID, notify_dm: 0, dm_ok: 1 });
    expect(await dmState('a')).toEqual({ notify_dm: 0, dm_ok: 1 });
    expect(await dmState('b')).toEqual({ notify_dm: 1, dm_ok: 1 });

    await closeDms('a');
    const on = await setNotifyDm(pgEnv.DB, { discordUserId: ALICE_ID }, true);
    expect(on).toMatchObject({ user_id: 'a', notify_dm: 1, dm_ok: 1 });
    expect(await dmState('a')).toEqual({ notify_dm: 1, dm_ok: 1 });
    // Not a binding change: link_audit keeps only the two links.
    expect((await audit()).map((r) => r.action)).toEqual(['link', 'link']);
  });

  it('returns null for someone not bound, and the bot\'s /notify still answers the same words', async () => {
    await seedUser({ id: 'a' });
    expect(await setNotifyDm(pgEnv.DB, { userId: 'a' }, true)).toBeNull();
    expect(await setNotifyDm(pgEnv.DB, { discordUserId: BOB_ID }, true)).toBeNull();
    const caller = { id: ALICE_ID, username: 'alice' };
    expect(await handleCommand({ commandName: 'notify', caller, targetUser: null, state: 'off' }, BOT)).toEqual({
      content: '你还没有绑定 Nanako 账号。先用 /link 绑定，再来试试。',
      ephemeral: true,
    });

    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    await closeDms('a');
    expect(await handleCommand({ commandName: 'notify', caller, targetUser: null, state: 'off' }, BOT)).toEqual({
      content: '已关闭私信提醒。网页上仍能看到一切；想重新打开用 /notify 开。',
      ephemeral: true,
    });
    expect(await dmState('a')).toEqual({ notify_dm: 0, dm_ok: 1 });
    const reply = await handleCommand({ commandName: 'notify', caller, targetUser: null, state: 'on' }, BOT);
    expect(reply.content).toBe(
      '已打开私信提醒：被立案、陈述快截止、出判决、管理员调整分数、约局，以及（裁判）AI 建议升级时会私信你。收不到的话，检查一下服务器的「允许私信」设置。',
    );
    expect(await dmState('a')).toEqual({ notify_dm: 1, dm_ok: 1 });
    expect(await handleCommand({ commandName: 'notify', caller, targetUser: null, state: 'off' }, { ...BOT, readOnly: true })).toEqual({
      content: '系统维护中（只读），请稍后再试。',
      ephemeral: true,
    });
    expect(await dmState('a')).toEqual({ notify_dm: 1, dm_ok: 1 });
  });
});
```

（第二例把 bot `/notify` 的三句回复文案原文钉住：`handleNotify` 改写后一字不能变；`READ_ONLY` 时什么都不写。）

- [ ] **Step 2：运行，确认失败**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/link-flow.test.ts
```

期望：`Tests  2 failed | 40 passed (42)`；两例都是 `TypeError: (0 , setNotifyDm) is not a function`。

- [ ] **Step 3：实现 `setNotifyDm`**

`server/src/discord/links.ts`，`interface DiscordLink` 里把锚点

```ts
  notify_dm: number;
  linked_at: string;
```

换成

```ts
  notify_dm: number;
  /** 0 once Discord refused a DM (50007: DMs closed); the dispatcher then stops trying. */
  dm_ok: number;
  linked_at: string;
```

文件末尾（`export async function unlinkAccounts(` 整个函数之后）追加：

```ts
/**
 * Turn DMs on or off for this Nanako user or this Discord user — the bot's
 * /notify and the web's switch are this one function. Either way the "DMs
 * closed" mark is cleared: whoever asks about DMs gets one more try. Not a
 * binding change, so nothing goes to link_audit. Returns the binding as it now
 * stands, or null when there is none.
 */
export async function setNotifyDm(
  db: D1Database,
  who: { userId: string } | { discordUserId: string },
  on: boolean,
): Promise<DiscordLink | null> {
  const flag = on ? 1 : 0;
  const update =
    'userId' in who
      ? db
          .prepare("UPDATE discord_links SET notify_dm = ?, dm_ok = 1, updated_at = datetime('now') WHERE user_id = ?")
          .bind(flag, who.userId)
      : db
          .prepare("UPDATE discord_links SET notify_dm = ?, dm_ok = 1, updated_at = datetime('now') WHERE discord_user_id = ?")
          .bind(flag, who.discordUserId);
  await update.run();
  return 'userId' in who ? linkByUserId(db, who.userId) : linkByDiscordId(db, who.discordUserId);
}
```

两条 UPDATE 写成两个字面量（不拼列名）；SQL 和 `commands.ts` 原来那条一字相同，`datetime('now')` 在 PG 上由适配器改写（原 bot 代码就是这么用的）。

- [ ] **Step 4：bot 改用它**

`server/src/discord/commands.ts`，import 锚点

```ts
import { boundUser, linkByDiscordId, unlinkAccounts } from './links';
```

换成（`linkByDiscordId` 在本文件只有 `handleNotify` 用，改完就不再需要）

```ts
import { boundUser, setNotifyDm, unlinkAccounts } from './links';
```

`async function handleNotify` 里，把锚点

```ts
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const link = await linkByDiscordId(ctx.db, input.caller.id);
  if (!link) return ephemeralReply(NOT_LINKED);
  const on = input.state !== 'off';
  // Also clears a "DMs closed" mark: whoever asks for DMs gets one more try.
  await ctx.db
    .prepare("UPDATE discord_links SET notify_dm = ?, dm_ok = 1, updated_at = datetime('now') WHERE discord_user_id = ?")
    .bind(on ? 1 : 0, input.caller.id)
    .run();
  return ephemeralReply(
```

换成

```ts
  if (ctx.readOnly) return ephemeralReply(READ_ONLY_TEXT);
  const on = input.state !== 'off';
  // Also clears a "DMs closed" mark: whoever asks for DMs gets one more try.
  const link = await setNotifyDm(ctx.db, { discordUserId: input.caller.id }, on);
  if (!link) return ephemeralReply(NOT_LINKED);
  return ephemeralReply(
```

后面 `on ? '已打开私信提醒：…' : '已关闭私信提醒。…'` 两句**一字不动**。没绑定的人：UPDATE 命中 0 行、读回 null → 照旧回 `NOT_LINKED`，结果和原来先读后写相同，只少一次查询。

- [ ] **Step 5：运行，确认通过（连同锁住 `/notify` 行为的两个旧文件）**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/link-flow.test.ts tests/pg/dm.test.ts tests/pg/bot-commands.test.ts
npm run typecheck
```

期望：`Test Files  3 passed (3)`、`Tests  128 passed (128)`（`link-flow` 42 + `dm` + `bot-commands`；`dm.test.ts:569-585`「until /notify turns them back on」照旧通过）；typecheck 无输出错误。

- [ ] **Step 6：提交**

```bash
git add server/src/discord/links.ts server/src/discord/commands.ts tests/pg/link-flow.test.ts
git commit -m "feat: 新增 setNotifyDm，bot /notify 改为调用它（文案不变）"
```

---

### Task 2：`GET /api/me/discord` 多两个字段，新增 `POST /api/me/discord/notify`

**Files:**
- 改：`server/src/link-routes.ts`
- 测试：`tests/pg/link-flow.test.ts`（改 `:619` 一行 + 末尾追加 describe）

- [ ] **Step 1：写失败的测试**

`tests/pg/link-flow.test.ts`，用例 `it('shows the binding before and after — never the Discord id'` 里（契约 7.1：同一用例里 `expect(text).not.toContain(ALICE_ID);` 保留不动），把锚点

```ts
    expect(Object.keys(body.link).sort()).toEqual(['discord_username', 'linked_at']);
```

换成

```ts
    expect(Object.keys(body.link).sort()).toEqual(['discord_username', 'dm_ok', 'linked_at', 'notify_dm']);
```

文件末尾（Task 1 追加的 `describe('setNotifyDm'` 之后）追加：

```ts
describe('the DM switch: /api/me/discord and /api/me/discord/notify', () => {
  const ON_MISSING = { error: '缺少 on（true 或 false）' };

  async function setNotify(
    host: Host,
    cookie: string | null,
    body?: string,
    origin = SPA,
    contentType = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { Origin: origin, 'Content-Type': contentType };
    if (cookie) headers.Cookie = cookie;
    return host(new Request(`${API}/api/me/discord/notify`, { method: 'POST', headers, body }));
  }

  async function getLink(host: Host, cookie: string): Promise<Response> {
    return host(new Request(`${API}/api/me/discord`, { headers: { Cookie: cookie, Origin: SPA } }));
  }

  async function dmState(userId: string): Promise<{ notify_dm: number; dm_ok: number } | null> {
    return pgEnv.DB.prepare('SELECT notify_dm, dm_ok FROM discord_links WHERE user_id = ?')
      .bind(userId)
      .first<{ notify_dm: number; dm_ok: number }>();
  }

  /** a ↔ alice, b ↔ bob; alice's last DM bounced (dm_ok = 0). */
  async function twoBound(): Promise<void> {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    await linkAccounts(pgEnv.DB, { userId: 'b', discordUserId: BOB_ID, discordUsername: 'bob', replace: false, via: 'web' });
    await pgEnv.DB.prepare("UPDATE discord_links SET dm_ok = 0 WHERE user_id = 'a'").run();
  }

  it('GET tells the caller their own switch and whether DMs get through', async () => {
    await twoBound();
    const { host } = makeHost();
    const res = await getLink(host, await session('a'));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      link: { discord_username: 'alice', linked_at: expect.any(String), notify_dm: true, dm_ok: false },
    });
    expect(((await (await getLink(host, await session('b'))).json()) as { link: unknown }).link).toMatchObject({
      discord_username: 'bob',
      notify_dm: true,
      dm_ok: true,
    });
  });

  it('turns the caller\'s DMs off and on, each time giving a closed DM one more try', async () => {
    await twoBound();
    const { host } = makeHost();
    const sess = await session('a');
    const off = await setNotify(host, sess, JSON.stringify({ on: false }));
    expect(off.status).toBe(200);
    expect(off.headers.get('Cache-Control')).toBe('no-store');
    expect(off.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    const text = await off.text();
    expect(text).not.toContain(ALICE_ID);
    expect(JSON.parse(text)).toEqual({
      link: { discord_username: 'alice', linked_at: expect.any(String), notify_dm: false, dm_ok: true },
    });
    expect(await dmState('a')).toEqual({ notify_dm: 0, dm_ok: 1 });

    await pgEnv.DB.prepare("UPDATE discord_links SET dm_ok = 0 WHERE user_id = 'a'").run();
    const on = await setNotify(host, sess, JSON.stringify({ on: true }));
    expect(((await on.json()) as { link: unknown }).link).toMatchObject({ notify_dm: true, dm_ok: true });
    expect(await dmState('a')).toEqual({ notify_dm: 1, dm_ok: 1 });
    // Only the caller's own binding; and no binding change to audit.
    expect(await dmState('b')).toEqual({ notify_dm: 1, dm_ok: 1 });
    expect((await audit()).map((r) => r.action)).toEqual(['link', 'link']);
  });

  it('is 401 without a session, 400 without a boolean on, 409 when not bound', async () => {
    await twoBound();
    await seedUser({ id: 'c' });
    const { host } = makeHost();
    const none = await setNotify(host, null, JSON.stringify({ on: false }));
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: '未登录' });

    const sess = await session('b');
    for (const body of [undefined, '', 'not json', '{}', '{"on":"false"}', '{"on":0}', '{"on":null}', '[false]']) {
      const res = await setNotify(host, sess, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(ON_MISSING);
    }
    expect(await dmState('b')).toEqual({ notify_dm: 1, dm_ok: 1 });

    const unbound = await setNotify(host, await session('c'), JSON.stringify({ on: true }));
    expect(unbound.status).toBe(409);
    expect(await unbound.json()).toEqual({ error: '还没有绑定 Discord' });
  });

  it('refuses a switch posted from a foreign site', async () => {
    await twoBound();
    const { host } = makeHost();
    // What a cross-site <form enctype="text/plain"> can send without a preflight; the body still parses as JSON.
    const res = await setNotify(host, await session('b'), JSON.stringify({ on: false }), 'https://evil.example', 'text/plain');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '请求来源不被允许' });
    expect(await dmState('b')).toEqual({ notify_dm: 1, dm_ok: 1 });
  });

  it('answers the CORS preflight for the SPA origin only', async () => {
    const { host } = makeHost();
    const preflight = (origin: string) =>
      host(
        new Request(`${API}/api/me/discord/notify`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
        }),
      );
    const ok = await preflight(SPA);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(ok.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('content-type');
    expect((await preflight('https://evil.example')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('is 503 in READ_ONLY maintenance, while GET still answers', async () => {
    await twoBound();
    const { host } = makeHost({ READ_ONLY: '1' });
    const sess = await session('b');
    const res = await setNotify(host, sess, JSON.stringify({ on: false }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: '系统维护中（只读），请稍后再试' });
    expect(await dmState('b')).toEqual({ notify_dm: 1, dm_ok: 1 });
    expect(((await (await getLink(host, sess)).json()) as { link: unknown }).link).toMatchObject({ notify_dm: true, dm_ok: true });
  });
});
```

说明：
- 「外站」用例用 `Content-Type: text/plain`：`hono/csrf` 只拦表单能发的三种类型（`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`），外站要发 `application/json` 必须先过 CORS 预检，而预检只放行 SPA（下一例）。`text/plain` 正是外站 `<form enctype="text/plain">` 能伪造的那一种，且 `readJsonBody` 照样会把它当 JSON 读——所以这一例锁的是真正的攻击面。
- 400 的八种 body：缺 body、空串、不是 JSON、`{}`、字符串 `"false"`、数字 `0`、`null`、数组；都不写库。
- 「只改自己的绑定」「响应不含 Discord id」「不写 `link_audit`」对应契约第 6 节第 3 条和 4.3 最后一条。

- [ ] **Step 2：运行，确认失败**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/link-flow.test.ts
```

期望：`Tests  5 failed | 43 passed (48)`。失败的是：改过的 `:619`（`expected [ 'discord_username', 'linked_at' ] to deeply equal [ 'discord_username', 'dm_ok', …(2) ]`）、「GET tells the caller…」（两个键对四个键）、「turns the caller's DMs off and on…」（`expected 404 to be 200`）、「is 401 without a session…」（`expected 404 to be 401`）、「is 503 in READ_ONLY…」（`expected 404 to be 503`）。「refuses a switch posted from a foreign site」和「answers the CORS preflight…」此时**已经通过**：它们锁的是 `/api/*` 上已有的 CSRF、CORS 中间件也罩住新路径，实现后必须仍然通过。

- [ ] **Step 3：实现**

`server/src/link-routes.ts`：

(a) 文件头注释，锚点

```ts
//   GET  /api/me/discord         the SPA's view of the caller's own binding
//   POST /api/me/discord/unlink
```

之后加一行：

```ts
//   POST /api/me/discord/notify  {on} the caller's DM switch — the bot's /notify
```

(b) import，锚点

```ts
import { allowedOrigins, cookieConfig, isReadOnly, parseCsvList } from '../../worker/http';
```

换成

```ts
import { allowedOrigins, cookieConfig, isReadOnly, optBool, parseCsvList, readJsonBody } from '../../worker/http';
```

锚点

```ts
import { linkAccounts, linkByDiscordId, linkByUserId, unlinkAccounts } from './discord/links';
```

换成

```ts
import {
  linkAccounts,
  linkByDiscordId,
  linkByUserId,
  setNotifyDm,
  unlinkAccounts,
  type DiscordLink,
} from './discord/links';
```

(c) 锚点 `const READ_ONLY_MESSAGE = '系统维护中（只读），请稍后再试';` 之后加：

```ts
const NOTIFY_ON_MISSING = '缺少 on（true 或 false）';
const NOT_BOUND = '还没有绑定 Discord';

/** What the SPA may see of the caller's own binding. Never the Discord id: the SPA has no use for it. */
function linkView(link: DiscordLink) {
  return {
    discord_username: link.discord_username,
    linked_at: link.linked_at,
    notify_dm: link.notify_dm === 1,
    dm_ok: link.dm_ok === 1,
  };
}
```

(d) `app.get('/api/me/discord'` 的处理函数里，把锚点

```ts
    c.header('Cache-Control', 'no-store');
    // Never the Discord id: the SPA has no use for it.
    return c.json({ link: link ? { discord_username: link.discord_username, linked_at: link.linked_at } : null });
```

换成

```ts
    c.header('Cache-Control', 'no-store');
    return c.json({ link: link ? linkView(link) : null });
```

(e) 在 `app.post('/api/me/discord/unlink', async (c) => {` 整个路由（以 `return c.json({ ok: true, removed: removed !== null });` 和 `});` 结尾）**之后**、`// --- binding pages ---` 之前加：

```ts
  // Same switch as the bot's /notify, found by the session's user instead.
  // Unbound is 409, not 404: the SPA reads 404 as "this backend has no Discord".
  app.post('/api/me/discord/notify', async (c) => {
    if (isReadOnly(env)) throw new ApiError(503, READ_ONLY_MESSAGE);
    const session = await readSession(c.req.raw);
    if (!session) throw new ApiError(401, '未登录');
    const on = optBool((await readJsonBody(c.req.raw)).on);
    if (on === undefined) throw new ApiError(400, NOTIFY_ON_MISSING);
    const link = await setNotifyDm(db, { userId: session.user.id }, on);
    if (!link) throw new ApiError(409, NOT_BOUND);
    c.header('Cache-Control', 'no-store');
    return c.json({ link: linkView(link) });
  });
```

校验顺序就是契约 4.3 的表：CSRF（中间件，403）→ READ_ONLY（503）→ 登录（401）→ `on`（400）→ 绑定（409）。`readJsonBody` 遇到 NUL 照常 400（`worker/http.ts` 的 `NUL_MESSAGE`）。CORS 中间件（`allowMethods` 已含 POST，`allowHeaders` 只有 `Content-Type`、`Accept`）不改。

- [ ] **Step 4：运行，确认通过**

```bash
npx vitest run --config vitest.pg.config.ts tests/pg/link-flow.test.ts
npm run typecheck
```

期望：`Tests  48 passed (48)`；typecheck 通过。

- [ ] **Step 5：提交**

```bash
git add server/src/link-routes.ts tests/pg/link-flow.test.ts
git commit -m "feat: GET /api/me/discord 带上私信开关和送达状态，新增 POST /api/me/discord/notify"
```

---

### Task 3：前端 `src/api.ts` 的类型和 `setDiscordNotify`

**Files:**
- 改：`src/api.ts`（只动 `// --- Discord binding (Node backend only) ---` 小节）
- 测试：`tests/dom/discord-link.test.tsx`（import 行 + 末尾追加 describe）

这个 PR 不渲染任何新东西，所以 `DiscordLinkCard` 的请求数断言（`tests/dom/discord-link.test.tsx:82`、`:194` 的 `toHaveLength(1)`）原样不动、原样通过。新 describe 自带一个记录请求体的 fetch 桩（文件里现有的 `mockFetch` 不记 body），只测 `api.ts` 函数。

- [ ] **Step 1：写失败的测试**

`tests/dom/discord-link.test.tsx` 的 import 锚点

```ts
import { ApiError, DISCORD_LINK_URL, getDiscordLink } from '../../src/api';
```

换成

```ts
import { ApiError, DISCORD_LINK_URL, getDiscordLink, setDiscordNotify } from '../../src/api';
```

文件末尾追加：

```tsx
describe('setDiscordNotify', () => {
  interface Sent {
    method: string;
    path: string;
    body: unknown;
  }

  /** Answers every request with one response, recording what was sent. */
  function answer(status: number, body: unknown): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        sent.push({ method: init?.method ?? 'GET', path: url.replace(/^https?:\/\/[^/]+/, ''), body: init?.body ?? null });
        return Promise.resolve(json(status, body));
      }),
    );
    return sent;
  }

  it('posts exactly { on } and resolves the binding as it now stands', async () => {
    const link = { discord_username: 'nanako_edg', linked_at: '2026-10-20 12:00:00', notify_dm: false, dm_ok: true };
    const sent = answer(200, { link });
    await expect(setDiscordNotify(false)).resolves.toEqual(link);
    expect(sent).toEqual([{ method: 'POST', path: '/api/me/discord/notify', body: '{"on":false}' }]);
  });

  it('resolves undefined on 404 — a backend without the switch', async () => {
    answer(404, { error: 'Not found' });
    await expect(setDiscordNotify(true)).resolves.toBeUndefined();
  });

  it('throws the API\'s words for anything else, e.g. 409 when not bound', async () => {
    answer(409, { error: '还没有绑定 Discord' });
    const err = await setDiscordNotify(true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: '还没有绑定 Discord' });
  });
});
```

- [ ] **Step 2：运行，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/discord-link.test.tsx
```

期望：`Tests  3 failed | 14 passed (17)`；三例都是 `TypeError: (0 , setDiscordNotify) is not a function`。

- [ ] **Step 3：实现**

`src/api.ts`，把锚点

```ts
export interface DiscordLinkInfo {
  discord_username: string;
  linked_at: string;
}
```

换成（两个字段可选：旧后端、P2-5 之前的 Node 后端都没有它们，现有 dom fixture `BOUND` 也没有）

```ts
export interface DiscordLinkInfo {
  discord_username: string;
  linked_at: string;
  /** DMs on or off (the bot's /notify, or setDiscordNotify). Absent from an API older than P2-5. */
  notify_dm?: boolean;
  /** false once Discord refused a DM (DMs closed); turning DMs on or off clears it. */
  dm_ok?: boolean;
}
```

在锚点

```ts
export async function unlinkDiscord(): Promise<void> {
  await post<unknown>('/api/me/discord/unlink');
}
```

之后追加：

```ts

/**
 * Turn the caller's Discord DMs on or off; resolves the binding as it now
 * stands. `undefined` on 404 — a backend without the switch, like
 * getDiscordLink — so the UI can hide it. Not bound is 409, thrown as usual.
 */
export async function setDiscordNotify(on: boolean): Promise<DiscordLinkInfo | undefined> {
  try {
    const { link } = await post<{ link: DiscordLinkInfo }>('/api/me/discord/notify', { on });
    return link;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return undefined;
    throw err;
  }
}
```

- [ ] **Step 4：运行，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/discord-link.test.tsx
npm run typecheck
```

期望：`Tests  17 passed (17)`；typecheck 通过。

- [ ] **Step 5：提交**

```bash
git add src/api.ts tests/dom/discord-link.test.tsx
git commit -m "feat: 前端 api 加 setDiscordNotify，DiscordLinkInfo 带上私信开关字段"
```

---

### Task 4：`docs/DEPLOY-DISCORD.md` 两行

**Files:**
- 改：`docs/DEPLOY-DISCORD.md`（只动 `:8`、`:20`；P2-3 动 `:188`，P2-4 动 `:169-171`、`:191`，互不重叠）

- [ ] **Step 1：改 `:8`**

锚点

```md
> `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` 留空时 `/link/discord` 和 `/api/me/discord` 都是 404，
```

换成

```md
> `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` 留空时 `/link/discord`、`/api/me/discord` 和 `POST /api/me/discord/notify` 都是 404，
```

- [ ] **Step 2：改 `:20`**

锚点

```md
| `/notify 开/关` | 私信提醒开关（P6，默认开） | 只有自己 |
```

换成

```md
| `/notify 开/关` | 私信提醒开关（P6，默认开）；网页上也能开关（`POST /api/me/discord/notify`，和 bot 是同一个开关；网页上的按钮随 `/me/notify` 页上线） | 只有自己 |
```

- [ ] **Step 3：核对只动了这两行**

```bash
git diff --stat -- docs/DEPLOY-DISCORD.md   # 期望：1 file changed, 2 insertions(+), 2 deletions(-)
```

- [ ] **Step 4：提交**

```bash
git add docs/DEPLOY-DISCORD.md
git commit -m "docs: DEPLOY-DISCORD 补上网页私信开关接口"
```

---

## 收尾

- [ ] **Step 1：全套验证**

```bash
npm run typecheck
npm run test:unit
npm run test:dom      # act(...) 警告仍然只有 onboarding-roles 的 3 条
npm run test:server
npm run test:worker
npm run test:pg       # 遇到 adapter.test.ts 的 5 秒超时：npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts 单独重跑确认 4/4，记进 PR 描述
npm run build
```

期望：全部通过；和 Task 0 的「开工时」相比只有 dom +3、pg +8，其余不变（文件数都不变），即 Task 0 表里「完工时」一列：unit 31/456、dom 26/325、server 22/295、worker 20/621 + 9 todo、pg 32/914 + 9 todo。

规划者的自检（只在契约基线 `5ae164b` + 本 PR 四个 commit 上，2026-10-27，Node v24.22.0；跨 PR 合成副本上的数字见上一段）：typecheck 通过；unit 29/414；dom 24/302（基线 299，+3），act 警告 3 条且都来自 `onboarding-roles`；server 22/290；worker 15/560 + 9 todo；pg 全套一次 `1 failed | 845 passed | 9 todo`，失败的正是 `adapter.test.ts`「refuses a database whose text does not sort by code point」5 秒超时，单独重跑 4/4 通过 → 等于 27/846 + 9 todo（基线 838，+8）；build 通过。

- [ ] **Step 2：核对改动范围**

```bash
git log --oneline claude/p2-4-board-time..HEAD   # 期望 4 个 commit：feat setNotifyDm / feat 路由 / feat 前端 api / docs
git diff --stat claude/p2-4-board-time..HEAD
# 期望正好 7 个文件：docs/DEPLOY-DISCORD.md、server/src/discord/commands.ts、server/src/discord/links.ts、
# server/src/link-routes.ts、src/api.ts、tests/dom/discord-link.test.tsx、tests/pg/link-flow.test.ts
git diff claude/p2-4-board-time..HEAD -- src/components worker shared schema.sql migrations server/migrations docs/CONTRACT.md   # 期望无输出
git diff claude/p2-4-board-time..HEAD | grep -nE "console\.log|Co-Authored-By"   # 期望无输出
```

- [ ] **Step 3：写 PR 描述草稿（不推送、不开 PR）**

要点：只在 Node 端（旧 Worker 上 `/api/me/discord*` 本来就是 404，前端 `setDiscordNotify` 在 404 时返回 `undefined`）；无迁移，可单独回滚（回滚只是两个字段消失、POST 变 404）；bot `/notify` 文案不变；界面在 P4-1（契约第 8 节第 1 条）；「对契约的补充」全部照抄；pg 套件若遇 adapter 超时，写明单独重跑的结果。

---

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §8 B2-5「`GET /api/me/discord` 加 `notify_dm`、`dm_ok`」 | Task 2（`linkView`；用例「GET tells the caller…」、改过的 `:619`） |
| spec §8 B2-5「`POST /api/me/discord/notify {on: boolean}`，`UPDATE … notify_dm=?, dm_ok=1 WHERE user_id=?`」 | Task 1（`setNotifyDm`）、Task 2（路由；用例「turns the caller's DMs off and on…」查库 `{ notify_dm: 0, dm_ok: 1 }` / `{ 1, 1 }`） |
| spec §8 B2-5「只在 Node 端实现」、§10 第 6 条「404 时静默隐藏，并配降级测试」 | 只改 `server/src/*`；Task 3 `setDiscordNotify` 404 → `undefined`（dom 用例「resolves undefined on 404」）；本 PR 没有新入口要隐藏，入口在 P4-1 |
| spec §9 P2-5「测试：link-flow」 | Task 1、Task 2 共 +8 例，全在 `tests/pg/link-flow.test.ts` |
| spec §4.3 M22「让本人知道自己收不收得到」 | `dm_ok` 只给本人（Task 2）；提示与「我改好了」重试的界面在 P4-1 |
| 契约 4.3 表第 1–5 行（503、401、400、409、403）与错误原文 | Task 2：「is 503 in READ_ONLY…」「is 401 … 400 … 409 …」「refuses a switch posted from a foreign site」 |
| 契约 4.3「body 用 `readJsonBody`，`optBool(body.on)`」 | Task 2 Step 3 (e) |
| 契约 4.3「`setNotifyDm(db, who, on): Promise<DiscordLink \| null>`，读回，没有这一行返回 null」 | Task 1 Step 3；用例「returns null for someone not bound…」 |
| 契约 4.3「语义和 bot `/notify` 完全相同；bot 的 `handleNotify` 改为调用它」、第 5 节 `/notify` 行「SQL 和回复文案不变」 | Task 1 Step 4；用例钉住三句回复原文；`dm.test.ts:569-585` 照旧通过 |
| 契约 4.3「返回 `{ link: {…四个字段} }`，`Cache-Control: no-store`」 | Task 2（POST 与 GET 都断言 `no-store`） |
| 契约 4.3「不写 `link_audit`」 | Task 1、Task 2 用例都断言 `link_audit` 只有原来的 `link` |
| 契约 4.5 `DiscordLinkInfo` 两个可选字段、`setDiscordNotify` 404 → undefined、409 照常抛 | Task 3 |
| 契约第 6 节第 3 条「只返回调用者自己的绑定；Discord id 从不下发」 | Task 2：a、b 各自读到自己的状态；a 关私信不影响 b；POST 响应文本不含 `ALICE_ID`；`:617` 断言保留 |
| 契约 7.1 `link-flow.test.ts:619` 改成四个键 | Task 2 Step 1 |
| 契约 7.1 `:652-671` 预检：中间件不改，追加 notify 的预检用例 | Task 2「answers the CORS preflight for the SPA origin only」 |
| 契约 7.2「无频率限制，幂等 UPDATE；CSRF + 登录」 | Task 2（无限流代码；CSRF 用例） |
| 契约 7.3「P2-5 没有迁移」 | 文件结构「不碰」一栏 |
| 契约第 8 节第 1 条「P2-5 的私信开关界面在 P4-1」 | 不改任何组件；`discord-link.test.tsx:82`、`:194` 请求数断言不动 |
| 契约第 8 节第 13 条「没绑定 409，不用 404」 | Task 2 Step 3 (e) 注释 + 用例 |
| 契约第 3 节 `commands.ts`、`links.ts`、`link-routes.ts` 只有 P2-5；`src/api.ts` 只动 Discord 小节；`DEPLOY-DISCORD.md` 只动 `:8`、`:20` | Task 1–4；收尾 Step 2 的 diff 范围核对 |
| 契约第 1 节「每个 PR 收尾跑六个套件加 build」 | 收尾 Step 1 |

## 对契约的补充

以下是契约没写死、本计划写死了的东西（理由附后），请写进 PR 描述、机主过目：

1. **界面不在本 PR**：任务说明里提到「在现有 DiscordLinkCard / 通知设置里显示本人的私信状态和开关」，但同时限定「只做契约派给 P2 的」。契约第 8 节第 1 条和第 2 节 P2-5 行（「不碰 … 任何组件（`/me/notify` 页面是 P4-1）」）都把这个开关的界面放在 P4-1，spec §9 P4-1 也写明由 `DiscordLinkCard` 加 `onStatus` 交给 `/me/notify`、不增加请求。所以本 PR 只交付接口、类型和 `setDiscordNotify`，`DiscordLinkCard` 一行不改，`discord-link.test.tsx` 的请求数断言自然不变。机主若想提前在卡片里放开关，应当单独开一个 P4-1 的前置 PR，而不是塞进这个只动 Node 端、随时可推迟的 PR。
2. **补了 3 条 dom 用例**：契约第 9 节 P2-5 行的 dom 一栏是「—」，但 `setDiscordNotify` 是新代码，404 → `undefined` 又是以后界面隐藏的依据，所以照现有 `describe('getDiscordLink'` 的样子在同一文件末尾追加 describe `setDiscordNotify`（请求体正好 `{"on":false}`、404、409）。只测函数、不渲染组件。
3. **`handleNotify` 先写后判**：契约只说「UPDATE 换成 `setNotifyDm(…)`」。原来是先 `linkByDiscordId` 再 UPDATE；`setNotifyDm` 本身就读回、没有绑定时返回 null，所以改成直接调用、用它的返回值判断 `NOT_LINKED`。没绑定时 UPDATE 命中 0 行，结果和原来相同，少一次查询；`linkByDiscordId` 从 `commands.ts` 的 import 里去掉（`links.ts` 仍导出它，`link-routes.ts` 还在用）。
4. **`linkView` 一个函数给 GET 和 POST 共用**：两处都必须「只给四个字段、从不给 Discord id」，写一份，原来 GET 里那句「Never the Discord id」注释挪到它的 JSDoc 上。
5. **外站用例用 `text/plain`**：契约第 9 节要求测 403（外站）。`hono/csrf` 对 `application/json` 不检查（那种请求跨站必须先过预检，由 CORS 拦），所以用外站表单真能发出的 `text/plain` 来测，并在注释里写明；现有 `/unlink` 的外站用例不带 Content-Type（被当作 `text/plain`），口径一致。
6. **`setNotifyDm` 的两条 UPDATE 写成字面量**，不按 `who` 拼列名：SQL 一眼可审，和 bot 原来那条一字相同。
7. **`DEPLOY-DISCORD.md:20` 的措辞**：契约要求补「网页上也能开关」。本 PR 合并时网页上还没有按钮，所以写成「网页上也能开关（`POST /api/me/discord/notify`，和 bot 是同一个开关；网页上的按钮随 `/me/notify` 页上线）」，免得读文档的人去找一个还不存在的按钮。
8. **用例数**：契约估「约 6」+ 改 `:619`。实际是 describe `setNotifyDm` 2 例（直接测函数的两种定位、null、bot 文案）+ describe `the DM switch…` 6 例，共 +8；dom +3。
