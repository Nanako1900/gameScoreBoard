# S4 实施计划 · Discord 信息板（一个 PR）

> v6 第 4 期。方案：[spec.md](spec.md) §4.2、§6、§8。前提：S1–S3 已合并。
> 行号只作提示，定位以锚点文字为准。

## 1. 目标

在 `DISCORD_BOARD_CHANNEL_ID` 指定的频道里，机器人只维护一条消息：

- **内容**：信誉榜前 15、最近 5 起判决、处理中的数量、最新战报一句话。
- **按钮**：「我的情况」「语音记录」「打开网页」。
- **更新方式**：数据变化后约 10–40 秒原地编辑。事件排在 10 秒后执行，dispatcher 最长每 30 秒轮询一次。消息被删、频道换了，都会自己恢复。

做法完全复用现有的 outbox 加 `discord_messages`，参照周报帖子的投递（`server/src/outbox/report-delivery.ts`）。

## 2. 开工前

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git status --short
git fetch origin
git switch -c claude/s4-info-board origin/main
npm ci
```

先在 main 上跑一遍第 5 节的全部命令，把各套件的通过数记下来，作为基线。

## 3. 步骤

每步按同一个顺序做：先写会失败的测试 → 实现 → 测试通过 → commit。commit 信息写成 `<type>: <中文描述>（S4）`。

### 第 1 步 · 迁移

新增 `server/migrations/0011_board.sql`，做两件事：

1. **放宽 CHECK 约束**，`outbox.entity` 和 `discord_messages.entity` 都允许 `'board'`：
   - 先删掉旧约束，再按原列表加上 `'board'` 重建，保留 `'session'`，因为历史行还在。
   - 约束名以实际为准。PG 给内联 CHECK 的默认名是 `outbox_entity_check` / `discord_messages_entity_check`，删除时用 `DROP CONSTRAINT IF EXISTS`。
2. **触发器** `board_refresh()`：
   - 排一次刷新：`outbox_schedule('board.refresh', 'board', 'main', 'board:main:refresh', '{}'::jsonb, now() + interval '10 seconds', true)`。
   - 导入期间不触发：`current_setting('edg.importing', true) = 'on'` 时直接返回。现有的 records 触发器也是这么写的。
   - 挂在下面这些地方，全部用 `FOR EACH STATEMENT`。同一条语句改了很多行，也只排一次。
     - `score_events`：`AFTER INSERT`
     - `records`：`AFTER INSERT OR UPDATE OF status OR DELETE`
     - `users`：`AFTER INSERT OR DELETE OR UPDATE OF username, display_name, is_participant, score`。榜单名字取的是 `COALESCE(display_name, username)`（`worker/db.ts` 的 `getLeaderboard`），所以 `username` 也要算。
     - `weekly_reports`：`AFTER INSERT OR UPDATE`
   - 函数用 `CREATE OR REPLACE`，触发器先 `DROP TRIGGER IF EXISTS` 再建，整个文件可以重复执行。

**测试（pg）**：
- 一条 `score_events` 插入后，outbox 里有一条 `board.refresh`，`available_at` 大约在 10 秒后；
- 接着再改一次 `records.status`，这条事件的 `available_at` 不变，outbox 里也没有多出新行；
- 导入标志打开时，不产生事件。

### 第 2 步 · 渲染（纯函数）

新增 `server/src/discord/board.ts`：

```ts
export interface BoardData {
  top: { rank: number; name: string; score: number }[];          // 上榜选手前 15，名次按网页的并列规则
  recent: { id: number; subject: string; typeLabel: string; delta: number; at: string }[]; // 最近 5 起已判决的扣分案件；at 就是 /verdicts 显示的那个时间字段
  pending: number;                                                 // awaiting_statement + judging 的数量
  report: { weekStart: string; line: string } | null;              // 最新战报一句话
  updatedAt: number;
}
export async function loadBoardData(db: D1Database): Promise<BoardData>;
export function boardMessage(data: BoardData, frontendUrl: string): ChannelMessage;
```

**取数**：

| 数据 | 来源 |
|---|---|
| 榜单 | `getLeaderboard`，只取 `is_participant` 的人；名次与 `src/lib/rank.ts` 的竞赛排名一致，规则挪到 `shared/` 两边共用，或者在这里照写一份并加一条对照测试 |
| 最近判决 | 和 `/verdicts` 用同一个查询（`listRecords({ status: 'decided' })`）、同样的排序和公开字段，过滤掉加分类型（`kind === 'bonus'`，也就是历史上的守约、组局 +2），取前 5 条。`listRecords` 是先截断后过滤的，所以要么在 SQL 里直接排除加分类型，要么多取一些（例如 20 条）再过滤。数据库里没有单独的「判决时间」列，不要自己造一个 |
| 处理中数量 | 一条 `COUNT(*)` |
| 战报 | `getLatestReport`，摘要一句话复用 `server/src/discord/report.ts` 里现成的标题或要点 |

**消息格式**：
- 一条消息，3 个 embed，每个都用 `clampEmbed`：
  1. 「信誉榜」：每行「`1.` 名字 — 112 分」，用 `safeLine`。
  2. 「最近判决」：每行「名字 · 类型 · −6 · <t:…:R>」，行尾带链接 `webUrl(frontendUrl, { case: id })`。它生成的是 `?case=<id>` 永久深链，网页会自动跳到案件页。
  3. 「动态」：
     - 「目前有 N 起记录在处理中」，N 为 0 时写「目前没有处理中的记录」；
     - 战报一句话加链接；
     - 「更新于 <t:…:R>」。
- 一行按钮：
  - 「我的情况」：`v1:board:me`
  - 「语音记录」：`v1:board:voice`
  - `linkButton('打开网页', webUrl(frontendUrl))`

**不能出现的内容**：段位、@ 提及、任何 Discord id、判决前案件的人名。消息设 `allowed_mentions: { parse: [] }`（客户端已经全局这么设了，这里再写一次也没关系）。

**测试（server）**：
- 15 人榜单、并列名次的渲染；
- `pending` 为 0 和不为 0 两种情况；
- 没有战报时，整段省略；
- 名字里有 Markdown 特殊字符或超长时会被处理；
- 断言输出里没有 `<@`，也没有段位名。

### 第 3 步 · 投递

1. 新增 `server/src/outbox/board-delivery.ts`，结构照抄 `report-delivery.ts`：
   - `BOARD_KINDS = new Set(['board.refresh'])`。
   - 没配 `DISCORD_BOARD_CHANNEL_ID` 时，结果为 `skipped`，备注「no board channel configured」。
   - 读 `discord_messages`，条件是 `entity = 'board'`、`entity_id = 'main'`、`purpose = 'board'`。
     - **有记录，频道也一致**：调用 `api.edit`。如果报 `UNKNOWN_MESSAGE` 或 `UNKNOWN_CHANNEL`，删掉这条记录，往下走「重发」。
     - **有记录，但频道变了**：先删旧消息，删除时忽略「消息或频道不存在」（10008/10003）和 403（旧频道里机器人可能已经没有权限，S1 之前删约局卡片的代码也是这样处理的），再删掉记录，往下走「重发」。
     - **重发**：`api.send` 时带上 `nonceFor(row)`，再用 upsert 写回 `discord_messages`。
   - 每次都渲染最新状态，和事件里的 payload 无关。
2. `server/src/outbox/dispatcher.ts`：按 entity 分发的地方加上 `row.entity === 'board' && BOARD_KINDS.has(row.kind)`；403 提示里加上 `DISCORD_BOARD_CHANNEL_ID`。
3. 配置：
   - `server/src/discord/client.ts` 的 `readBotConfig` 读 `DISCORD_BOARD_CHANNEL_ID`：可以为空，否则必须是 17–20 位数字，校验写法照 `DISCORD_VERDICT_CHANNEL_ID`。
   - `DispatcherConfig` 加上 `boardChannelId`。
   - **`compose.yaml`**：bot 服务的环境变量是一项一项列出来的，没列出的变量传不进容器。所以要加一行 `DISCORD_BOARD_CHANNEL_ID: ${DISCORD_BOARD_CHANNEL_ID:-}`，并照着 `DISCORD_VERDICT_CHANNEL_ID` 写一行注释。
   - `docs/DEPLOY-DISCORD.md` 的环境变量表加上这个变量。
4. 启动时补一次刷新：`bot-main.ts` 在 `ClientReady` 之后用 `outbox_schedule`（同一个 dedupe key，coalesce）排一次 `board.refresh`。这样一来，第一次部署、换频道、机器人宕机期间发生的变化都能补上。
5. **测试（pg）**：
   - 第一次投递调用 `send`，并写入 `discord_messages`；
   - 第二次投递调用 `edit`，不再 `send`；
   - `edit` 返回 10008 后会重发；
   - 换频道后，先 `remove` 再 `send`；
   - 没配频道时结果为 `skipped`。

### 第 4 步 · 按钮

在 `server/src/discord/commands.ts`（或按钮处理所在的文件）里接上两个按钮，回复一律 ephemeral：

- `v1:board:me`：
  - 已绑定：内容等于 `/score`（看自己）加 `/todo`，两段放在一个回复里，直接复用现有的两个处理函数；
  - 没绑定：提示去绑定，和 `/score` 一样。
- `v1:board:voice`：等于 `/voice`，`days` 用默认值，看自己。

按钮可以在信息板频道里按，不受 `WRONG_GUILD_TEXT` 的限制，但仍然要求交互来自 `GUILD_ID`。

**测试（pg `bot-commands`）**：两个按钮在已绑定、未绑定时各一条。

### 第 5 步 · 指南与文档

- `shared/guide.ts`：加一条提示「信息板频道里随时能看榜单和最近判决，按「我的情况」看自己的」。
- 欢迎私信：如果配了信息板频道，加一行 `<#频道id>`。频道链接不算「Discord 账号信息」，可以出现。
- `docs/DEPLOY-DISCORD.md` 新增「信息板」一节：
  - 新建一个文字频道，比如 `📋信息板`；
  - 频道权限：`@everyone` 禁止发言，允许查看和读历史；机器人允许查看、发言、嵌入链接；
  - 把频道 id 填进 `DISCORD_BOARD_CHANNEL_ID`；
  - 也可以复用原来的约局频道，把旧消息清空即可。
- `docs/CONTRACT.md`：outbox kind 加上 `board.refresh`，说明 entity 新增 `board`。

## 4. 不能破的约束

- 信息板是公开频道。里面只放网页上本来就公开的内容，不放段位，判决前的案件只给数量。
- Discord 限速：同一频道 5 秒内最多 5 次编辑。10 秒合并加上 coalesce 已经足够，不要另加定时刷新。
- 机器人重启、消息被删、频道变更这几种情况，都必须能恢复到「频道里正好一条信息板」。

## 5. 验证

```bash
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.workers.config.ts
env -u TEST_DATABASE_URL npm run test:pg
npm run test:server
npm run build
npm run build:pages
```

全部通过。PR 描述里写出各套件前后的测试数。

## 6. 需要机主过目

1. 榜单显示前 15 名，最近判决显示 5 起。
2. 这三个 embed 的标题和文案。

## 7. 部署

1. 先备份，再在 Coolify 里 Redeploy。`migrate` 会执行 `0011_board.sql`。
2. 按 `DEPLOY-DISCORD.md` 建好频道、设好权限，再填 `DISCORD_BOARD_CHANNEL_ID`。改了环境变量之后要重启 bot 服务。
3. 机器人起来后不到 1 分钟，频道里会出现信息板。之后随便改一个分数，10–40 秒内信息板应该就会更新。

## 8. PR

- 分支：`claude/s4-info-board`
- 标题：`feat: Discord 信息板，机器人原地更新榜单与判决（S4）`
- 描述按第 3 节的 5 步分节写。commit 和描述里都不加署名行。
