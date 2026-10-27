# P2 共享契约（前端重设计 v5 · ★ 邀请后端）

本文件是 P2 六个 PR（P2-1 … P2-6）共用的契约。各 `plan-P2-*.md` 只写自己的步骤，凡是跨 PR 的名字、签名、DDL、接口形状、文件归属、测试约定，一律以本文件为准。

> **定稿说明**：本文件已按六份计划的「对契约的补充」和跨 PR 合成（六份最终计划依次套在规划副本的同一份拷贝上，逐 PR 跑全部套件）的结果回写过：第 1 节加了逐 PR 实测表（1.1）；第 2、3 节的文件清单和分区按计划实际动到的文件改了（P2-6 的测试在新文件 `tests/worker/going-preview.test.ts`；P2-3、P2-5 各多一个 dom 测试文件；P2-4 多改 `docs/DEPLOY-DISCORD.md` 两行；几个共享测试文件的 import 区归属写清楚了）；3.1、4.4、4.6、7.1、10.4 按计划的定名回写；第 8 节新增第 15～22 条；第 9 节换成实测数字。计划正文和本文件仍有出入时，以计划正文为准（它们在合成副本上实测过）。

## 0. 依据与通用规则

- 已拍板的方案：`docs/redesign-v5/spec.md`（§11 全部按推荐默认值）。P2 用到：§9「P2 · ★ 邀请后端」表（P2-1 … P2-6）、§8 B2-1 … B2-6 和「迁移约定」「明确不动的」「常量迁移」「不做」、§3.4（约局历史）、§3.5（详情 + 组织者控制台、InviteSheet、取消确认）、§3.6（发起页的看板时区）、§4.1 ②③⑥⑦、§4.2（bot 对齐）、§4.3（不做可达人数）、§5 第 9 条（时间）、§10 第 6、7 条、§11 第 7、8、9、12 条。
- 前两期的规则继续有效：P0 契约（CSS 四种断点写法、hover 包进 `@media (hover: hover)`、CSP 不放 `unsafe-inline`、DOM 顺序 = 视觉顺序、§6.5 锁定文案、组件签名只加可选 props、新按钮不叫裸的「取消」「确认」「关闭」、toast 不用 `role="alert"`、被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块）和 P1 契约（`/tmp/claude-redesign/p1/final/contract.md`：只有 `src/lib/router.ts` 能碰 `window.history`，注释也算；新 CSS 过 `tests/unit/css-conventions.test.ts`；不新增 React `act(...)` 警告，基线只有 `onboarding-roles` 的 3 条；不新增首屏请求）。
- **规划所依据的代码基线**是 P0 + P1 全部套上之后的仓库，副本在 `/tmp/claude-redesign/p1/compose/repo`（HEAD `5ae164b`，一 PR 一个 commit）。下文 `路径:行号` 都指这个副本，**行号只作提示，定位一律以引用的锚点文字为准**。
- spec 和本契约冲突时以 spec 为准，**除了第 8 节列出的偏离**（每条都写了理由，需机主过目，写进对应 PR 描述）。spec 没写死、本契约写死了的文件名、导出名、常量名、类名、错误文案，一律照用，不另起名字。
- 机主编码规则：不可变更新；文件 200–400 行为宜、最多 800；函数 < 50 行；嵌套 ≤ 4 层；错误给友好的中文提示；在边界校验输入；不写 `console.log`；不写魔法数（领域常量放 `shared/`，前端时长门槛放 `src/lib/constants.ts`）；用户文案用 spec 原文的中文。
  - 例外说明：`worker/sessions.ts` 在基线上已经 985 行（超过 800）。P2 的新功能一律放进**新模块**（见第 2 节），`sessions.ts` 只改接线，P2 全程净增不超过约 90 行；不在 P2 里拆它（拆分会让六个叠放 PR 全部冲突，留给以后单独的 refactor PR）。
- 提交信息 `<type>: <中文描述>`，**不加任何署名行**（没有 `Co-Authored-By`、没有「Generated with」，沿用 P0/P1 和机主的全局设置）。
- 本轮**不 fetch、不 rebase 到 `origin/main`、不 push、不开 PR、不合并**。PR 由机主以后按叠放顺序处理。
- 「D1 和 PG 行为一致」靠的是同一套测试：`vitest.pg.config.ts` 把 `tests/worker/**` **原样**跑在 PostgreSQL（经 `server/src/db/d1.ts` 适配器）上。所以 P2 的每条 worker 测试天然两边都跑；SQL 只能写两边都合法的方言（见 3.4）。

## 1. 基线（= P0 + P1 全部套上之后，副本 HEAD `5ae164b`）

命令前先：

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
```

在副本上实测（2026-10-27）：

| 套件 | 命令 | 配置 | 基线（文件 / 用例） |
|---|---|---|---|
| unit | `npm run test:unit` | `vitest.config.ts`（`tests/unit/**`，纯 Node） | **29 / 414** 全过 |
| dom | `npm run test:dom` | `vitest.dom.config.ts`（`tests/dom/**`，jsdom，setup `tests/dom/setup.ts`） | **24 / 299** 全过；只有 `onboarding-roles` 的 3 条 `act(...)` 警告 |
| server | `npm run test:server` | `vitest.server.config.ts`（`server/test/**`，纯 Node） | **22 / 290** 全过 |
| worker | `npm run test:worker` | `vitest.workers.config.ts`（`tests/worker/**`，Miniflare + D1，schema 来自 `schema.sql`） | **15 / 560 + 9 todo** 全过 |
| pg | `npm run test:pg` | `vitest.pg.config.ts`（`tests/worker/**` + `tests/pg/**`，PostgreSQL，schema 来自 `server/migrations/*`） | **27 / 838 + 9 todo**（= worker 15 个文件 + PG 专属 12 个文件）。本机能跑：没设 `TEST_DATABASE_URL` 时 `tests/pg/global-setup.ts` 起一个嵌入式 PG 17，全套约 110 秒 |
| typecheck | `npm run typecheck` | 三个 tsconfig（`tsconfig.json` 含 `src`、`shared`、`tests/dom`；`tsconfig.worker.json` 含 `worker`、`shared`、`tests`（除 dom）；`server/tsconfig.json` 含 `server/src`、`server/test`） | 通过 |
| build | `npm run build`；`npm run build:pages` | — | 通过；`dist/` 不含 `404.html`（P1-0 的检查） |

- **PG 套件的已知抖动**：机器负载高时 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」会撞 5 秒超时（实测全套跑时失败 1 次，单独跑 `npx vitest run --config vitest.pg.config.ts tests/pg/adapter.test.ts` 4/4 通过）。它不是 P2 引起的：遇到时单独重跑这一个文件确认，记进 PR 描述。
- P1 当时没在本地跑 pg/server；**P2 必须跑**：P2 改了 SQL、bot 和 Node 专属路由，`test:server` 和 `test:pg` 是这些改动唯一的证据。每个 PR 收尾跑全部六项（typecheck、unit、dom、server、worker、pg）加 build。
- 每个 P2 计划的 Task 0：确认上游分支存在且工作区干净；grep 核对本契约里它要消费的上游导出都在；跑一遍六个套件记下数字，和 1.1 表里上一个 PR 的「合并后」一行对照。对不上就停下，不在本 PR 里补别人的文件。

### 1.1 逐 PR 实测（跨 PR 合成副本）

六份最终计划依次套在规划副本的同一份拷贝上，每个 PR 收尾在它的分支快照上跑全部套件（Node v24.22.0，2026-10-27）。「文件 / 用例」；typecheck（三个 tsconfig）、`npm run build`、`npm run build:pages` 每一步都通过，`dist/` 没有 `404.html`；dom 的 `act(...)` 警告每一步都是 `onboarding-roles` 的 3 条；pg 六次全套都没有遇到上面说的 adapter 超时。

| 合并后 | unit | dom | server | worker | pg |
|---|---|---|---|---|---|
| 基线（P0 + P1，`5ae164b`） | 29 / 414 | 24 / 299 | 22 / 290 | 15 / 560 + 9 todo | 27 / 838 + 9 todo |
| + P2-2 | 29 / 414 | 24 / 299 | 22 / 290 | 17 / 579 + 9 todo | 29 / 857 + 9 todo |
| + P2-1 | 30 / 422 | 25 / 317 | 22 / 290 | 17 / 592 + 9 todo | 29 / 873 + 9 todo |
| + P2-6 | 30 / 422 | 25 / 317 | 22 / 290 | 18 / 600 + 9 todo | 30 / 881 + 9 todo |
| + P2-3 | 30 / 422 | 26 / 322 | 22 / 292 | 20 / 620 + 9 todo | 32 / 904 + 9 todo |
| + P2-4 | 31 / 456 | 26 / 322 | 22 / 295 | 20 / 621 + 9 todo | 32 / 906 + 9 todo |
| + P2-5 | 31 / 456 | 26 / 325 | 22 / 295 | 20 / 621 + 9 todo | 32 / 914 + 9 todo |

## 2. PR 拆分与叠放顺序

**顺序：P2-2 → P2-1 → P2-6 → P2-3 → P2-4 → P2-5**，每个分支从前一个分支的 HEAD 开（`git switch -c <分支> <上游分支>`，本地分支）：

```
claude/p1-4-docs
  └─> claude/p2-2-invitable
        └─> claude/p2-1-invite
              └─> claude/p2-6-going-preview
                    └─> claude/p2-3-invite-context
                          └─> claude/p2-4-board-time
                                └─> claude/p2-5-dm-status
```

| 顺序 | id | 名称 | 分支 | 从哪开 | 人日（spec） | 一句话 |
|---|---|---|---|---|---|---|
| 1 | P2-2 | 可邀请名单 | `claude/p2-2-invitable` | `claude/p1-4-docs` | 0.5 | `GET /api/me/invitable`：除自己外的所有账号，只有 id、名字、头像、是否在榜、上次一起玩的时间 |
| 2 | P2-1 | 建局后再叫人 | `claude/p2-1-invite` | `claude/p2-2-invitable` | 1.5 | `POST /api/sessions/:id/invite`；`api.ts` 的 `inviteToSession`；详情弹窗里最简版「＋ 再叫几个人」和 `InviteSheet` |
| 3 | P2-6 | 来的人预览 | `claude/p2-6-going-preview` | `claude/p2-1-invite` | 0.5 | 每个 `SessionItem` 带 `going_preview`（最多 5 人、按 `rsvp_at`、不带分数、一次批量查询） |
| 4 | P2-3 | 邀请上下文、取消理由、历史 | `claude/p2-3-invite-context` | `claude/p2-6-going-preview` | 3 | 迁移（D1 `004_lobby.sql` + `schema.sql`，PG `0007_lobby.sql`）；改期记 `prev_rsvp`/`prev_starts_at`；`/api/me/invites` 带 `invite_reason`；取消带理由；`scope=history`；bot 取消私信渲染理由 |
| 5 | P2-4 | 看板时区与 bot 对齐 | `claude/p2-4-board-time` | `claude/p2-3-invite-context` | 1.5 | `/api/config` 加 `boardTzOffsetHours`；`shared/quickTime` 的 `boardSlots`/`slotIso`/`boardTzLabel`；`formatWhen` 的看板时区版；bot 用词「待定」、`/yue` 时段取自 shared、`/yue` 放开给已绑定的非上榜用户；会话常量迁到 `shared/attendance.ts` |
| 6 | P2-5 | 私信状态与开关 | `claude/p2-5-dm-status` | `claude/p2-4-board-time` | 1 | **只在 Node 端**：`GET /api/me/discord` 加 `notify_dm`、`dm_ok`；新增 `POST /api/me/discord/notify {on}` |

合计 8 人日，和 spec §9 一致。

**为什么是这个顺序**：

1. **P2-2 在 P2-1 前面，两者一起上线**。P2-1 的「再叫几个人」名单来自 `/api/me/invitable`（spec §9：「名单来自 P2-2（两者一起上线）」）。P2-2 是纯只读接口，单独先合也无害；P2-1 的 PR 描述写明「和 P2-2 一起合并、一起部署」。这两个 PR 就是 spec 说的「最快的邀请闭环」（P0-2 → P0-6 → P2-1 + P2-2）的后半段，所以排最前。
2. **P2-6 在 P2-3 前面**：两者都改 `worker/sessions.ts` 的 `toSessionItem`。P2-6 只加一个参数（`preview`），P2-3 再往同一个函数里加两列；反过来排，P2-3 的迁移 PR 会夹在两次 `toSessionItem` 签名变化中间。P2-6 不需要迁移，可以先上。
3. **P2-3 是唯一带迁移的 PR**（D1 `migrations/004_lobby.sql` + `schema.sql`，PG `server/migrations/0007_lobby.sql`）。放在中间：它之前的 PR 都不需要迁移，可以先部署；它之后的 P2-4、P2-5 不碰 schema，回滚 P2-4/P2-5 不牵涉迁移。部署 P2-3 时 PG 由 compose 的 `migrate` 服务先跑（`compose.yaml:50-55`），D1 要手动 `npm run db:migrate4:remote`（P2-3 新增的脚本）。
4. **P2-4 在 P2-3 后面**：两者都改 `server/src/discord/sessions.ts`（P2-3 改 `renderSessionDm` 的 cancelled 分支，P2-4 改 `RSVP_LABEL`、卡片字段、`YUE_SLOTS`、`slotIso`、`handleYue`），区域不重叠；两者都在 `shared/attendance.ts` 末尾追加小节。P2-4 不碰数据库。
5. **P2-5 最后**：只在 Node 端（`server/src/link-routes.ts`、`server/src/discord/links.ts`、`commands.ts`），`discord_links` 只在 PG 里有，旧 Worker 上 `/api/me/discord*` 本来就是 404。它和前面任何 PR 都没有文件交集（除 `src/api.ts` 的末尾小节和 `docs/DEPLOY-DISCORD.md` 的不同行），所以放最后，随时可以单独合并或推迟（spec §11 第 11 条的瘦身选项①就是把它挪到 P5）。

### 每个 PR 动到的文件

图例：**新**＝新建，**改**＝修改。带 ★ 的是第 3 节列出的共享文件，必须守分区。

**P2-2 `claude/p2-2-invitable`**
- 新：`worker/invitable.ts`（`listInvitable`、`MAX_INVITABLE`）。
- 改：`worker/routes.ts` ★（`--- Invites ---` 小节加 `GET /api/me/invitable`）、`worker/types.ts` ★（`InvitableUser`）、`src/types.ts` ★（`InvitableUser`、`InvitableResponse`）、`src/api.ts` ★（`getInvitable`）、`docs/CONTRACT.md` ★（Authenticated 小节一条）。
- 测试：新 `tests/worker/invitable.test.ts`；新 `tests/worker/session-routes.test.ts`（HTTP 层，后面的 PR 往末尾追加 describe）。
- 不碰任何组件、`worker/sessions.ts`、bot。

**P2-1 `claude/p2-1-invite`**
- 新：`worker/session-invites.ts`（`inviteToSession`）、`src/lib/invitePicker.ts`（纯）、`src/lib/useInvitable.ts`、`src/components/InviteSheet.tsx` + `src/components/invite-sheet.css`。
- 改：`shared/attendance.ts` ★（末尾 `// --- P2-1 ---`：`MAX_INVITES`、`MAX_SESSION_ROSTER`、`INVITES_PER_ORGANIZER`）、`worker/sessions.ts` ★（常量改为从 shared 引入并 re-export；`MAX_ROLLCALL_ENTRIES = MAX_SESSION_ROSTER`；`normalizeInvites` 加 `field` 参数并导出；导出 `getSessionRow`、`requireOrganizer`、`type SessionJoinRow`）、`worker/routes.ts` ★（`POST /api/sessions/:id/invite`）、`worker/types.ts` ★（`InviteResult`）、`server/src/outbox/dispatcher.ts`（`INVITES_PER_ORGANIZER` 改为从 shared 引入并 re-export，值不变）、`src/types.ts` ★（`InviteResponse`）、`src/api.ts` ★（`inviteToSession`）、`src/components/SessionDetailDialog.tsx` ★（见 3.1）、`docs/CONTRACT.md` ★。
- 测试：追加 `tests/worker/invites.test.ts`（import 区整段替换 + 新 describe）、`tests/worker/session-routes.test.ts`（末尾 describe，不加 import）、`tests/pg/session-cards.test.ts`（import 区在 `worker/sessions` 那行之后加两行 + 新 describe）；新 `tests/unit/invite-picker.test.ts`、`tests/dom/invite-sheet.test.tsx`。

**P2-6 `claude/p2-6-going-preview`**
- 新：`worker/session-extras.ts`（`goingPreviews`、纯函数 `previewOfPlayers`、私有占位符助手 `holes(count)`；P2-3 往里追加）。
- 改：`shared/attendance.ts` ★（`// --- P2-6 ---`：`GOING_PREVIEW_MAX`）、`worker/sessions.ts` ★（`toSessionItem` 加 `preview` 参数；`listSessions`、`getSessionDetail`、`listMyInvites` 传入）、`worker/types.ts` ★（`SessionItem.going_preview`）、`src/types.ts` ★（可选 `going_preview?`）、`docs/CONTRACT.md` ★（`interface SessionItem` 一行）。
- 测试：新 `tests/worker/going-preview.test.ts`（describe `goingPreviews` 4 例、`going_preview` 3 例；`tests/worker/sessions.test.ts` 已 792 行，不往里追加，第 8 节第 8 条）、追加 `tests/worker/session-routes.test.ts`（末尾 describe，不加 import）。
- 不碰任何组件（P3-1 的 SessionCard 才渲染它）、`worker/routes.ts`、`src/api.ts`、`tests/worker/sessions.test.ts`。

**P2-3 `claude/p2-3-invite-context`**
- 新：`migrations/004_lobby.sql`、`server/migrations/0007_lobby.sql`。
- 改：`schema.sql` ★（两张表的 CREATE TABLE 各加两列）、`package.json`（`db:migrate4:local`、`db:migrate4:remote` 两个脚本）、`shared/attendance.ts` ★（`// --- P2-3 ---`：`SESSION_CANCEL_REASON_MAX`、`SESSION_HISTORY_PAGE`）、`worker/session-extras.ts`（追加 `attendanceSummaries`、`inviteContexts`）、`worker/sessions.ts` ★（`toSessionItem` 加两列；`updateSession` 的重置 UPDATE；`setRsvp` 的 upsert；`cancelSession` 加 `reason`；`listMyInvites` 带上下文；新 `listSessionHistory`）、`worker/routes.ts` ★（`GET /api/sessions` 的 `scope=history`/`before`；`POST …/cancel` 读 body）、`worker/types.ts` ★、`src/types.ts` ★、`src/api.ts` ★（`cancelSession(id, reason?)`、`getSessionHistory`、`getMyInvites` 的返回类型）、`server/src/discord/sessions.ts` ★（只改 `renderSessionDm` 的 `'dm.session.cancelled'` 分支）、`docs/CONTRACT.md` ★、`docs/DEPLOY-DISCORD.md` ★（「约局取消」那一行，`:188`）。
- **不改** `server/src/import-d1.ts`（它按 `information_schema` 动态取列，见 3.3）、任何 PG 触发器（见 3.2）、任何组件。
- 测试：新 `tests/worker/session-context.test.ts`、`tests/worker/session-history.test.ts`、`tests/dom/session-api.test.tsx`（`api.ts` 的 `cancelSession`/`getSessionHistory`/`getMyInvites`，第 8 节第 16 条）；追加 `tests/worker/session-routes.test.ts`（import 区追加三行 + 末尾 describe）、`tests/pg/session-cards.test.ts`、`tests/pg/import-d1.test.ts`（`exportFixture()` 不改，新用例在它的副本上加四列，第 8 节第 7 条）、`server/test/session-render.test.ts`（import 区一行 + 末尾 describe）。

**P2-4 `claude/p2-4-board-time`**
- 改：`shared/attendance.ts` ★（`// --- P2-4 ---`：`MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`、`DEFAULT_DURATION_MIN`）、`shared/quickTime.ts`（末尾追加看板时段与标签，旧 `quickSlots` 一字不改）、`worker/sessions.ts` ★（两个常量改为从 shared 引入并 re-export）、`worker/routes.ts` ★（`/api/config` 加一个字段）、`src/types.ts` ★（`Config.boardTzOffsetHours?`）、`src/lib/time.ts`（`formatWhen` 加可选第三参；新 `formatBoardDateTime`、`formatViewerAside`）、`server/src/discord/sessions.ts` ★（`RSVP_LABEL` 改用 shared、卡片字段、`YUE_SLOTS`/`slotIso` 改为引用 shared 并 re-export、`handleYue` 去掉上榜判断、15 分钟改用常量）、`docs/CONTRACT.md` ★（`/api/config` 一行）、`docs/DEPLOY-DISCORD.md` ★（`:169-171` 和 `:187-188` 的「可能」、`:191` 的 `/yue` 权限，第 8 节第 19 条）。
- 测试：新 `tests/unit/board-time.test.ts`；追加 `tests/unit/source-hygiene.test.ts`（import 区一行 + 末尾新 describe）、`tests/worker/session-routes.test.ts`（末尾 describe，不加 import）、`server/test/session-render.test.ts`（import 区：`RSVP_LABEL` 并进 P2-3 加的那一行，再加两行；末尾 describe）；**改** `tests/pg/session-cards.test.ts` 的「/yue is for bound players only」用例（按用例名定位；规划副本 `:351-360`，P2-1 加了两行 import 后是 `:353-362`，见第 7 节第 1 条），并在 `describe('/yue, more'` 的最后一个用例之后追加一个。
- **不碰任何组件**（`RescheduleSheet`、`SessionFormDialog` 换成看板时段是 P3-3、P3-4，见第 8 节第 3 条）。

**P2-5 `claude/p2-5-dm-status`**
- 改：`server/src/link-routes.ts`（`GET /api/me/discord` 多两个字段；新 `POST /api/me/discord/notify`）、`server/src/discord/links.ts`（`DiscordLink.dm_ok`、新 `setNotifyDm`）、`server/src/discord/commands.ts`（`handleNotify` 改为调用 `setNotifyDm`，回复文案不变）、`src/api.ts` ★（`DiscordLinkInfo` 可选两字段、`setDiscordNotify`）、`docs/DEPLOY-DISCORD.md` ★（`:8`、`:20`）。
- 测试：追加 `tests/pg/link-flow.test.ts`（import 区一行换两行；新 describe `setNotifyDm` 2 例、`the DM switch…` 6 例；**改** `:619` 一处断言，见第 7 节第 2 条）、`tests/dom/discord-link.test.tsx`（import 行加 `setDiscordNotify`，末尾 describe `setDiscordNotify` 3 例，只测 `api.ts`、不渲染组件，第 8 节第 16 条）。
- 不碰 worker、D1、任何组件（`/me/notify` 页面是 P4-1）。

## 3. 共享文件与分区归属

后来的 PR 一律**按锚点文字定位**，不按行号。追加型文件的小节标记固定为 `// --- P2-x ---`，按合并顺序排在文件末尾。

| 文件 | 谁改、改哪一块 |
|---|---|
| `worker/sessions.ts` | **P2-1**：锚点 `export const MAX_INVITES = 20;` 改为从 `../shared/attendance` 引入，并保留 `export { MAX_INVITES } from '../shared/attendance';`（`tests/worker/*` 从这里导入）；锚点 `const MAX_ROLLCALL_ENTRIES = 50;` 改为 `= MAX_SESSION_ROSTER`；`function getSessionRow`、`function requireOrganizer`、`interface SessionJoinRow`、`function normalizeInvites` 前加 `export`；`normalizeInvites(raw, organizerId, field: 'invite' \| 'user_ids' = 'invite')`，三条错误文案里的 `invite` 换成 `${field}`（`createSession` 的调用不传第三参，文案不变）。<br>**P2-6**：`toSessionItem(row, myRsvp)` → `toSessionItem(row, myRsvp, preview)`；`listSessions`、`listMyInvites` 在 `myRsvpMap` 旁边多一次 `goingPreviews(db, ids)`；`getSessionDetail` 从已查出的 `players` 里推导（不多查）。<br>**P2-3**：`toSessionItem` 的返回对象在 `settled_at` 后加 `cancel_reason`、`cancelled_at`；锚点 `UPDATE session_players SET rsvp = 'invited', rsvp_at = datetime('now')`（`:463`）；锚点 `rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at`（`:568`）；`cancelSession` 签名加 `rawReason` 和它的 UPDATE；`listMyInvites` 返回 `InvitedSessionItem[]`；在 `listMyInvites` 之后新增 `listSessionHistory`。<br>**P2-4**：锚点 `export const MAX_OPEN_SESSIONS = 5;` / `MAX_SESSIONS_PER_DAY = 10;` 改为从 shared 引入并 `export { … } from '../shared/attendance'`（`tests/worker/sessions.test.ts:14-15`、`tests/pg/concurrency.test.ts:9` 从这里导入），上方注释留在原处。<br>P2-2、P2-5 不碰。 |
| `worker/routes.ts` | **P2-2**：import 区加 `listInvitable`；在锚点 `app.get('/api/me/invites'` 那个路由**之后**加 `app.get('/api/me/invitable'`。<br>**P2-1**：import 区加 `inviteToSession`；在锚点 `app.post('/api/sessions/:id/cancel'` 那个路由**之后**加 `app.post('/api/sessions/:id/invite'`。<br>**P2-3**：锚点 `app.get('/api/sessions'` 的处理函数（加 history 分支）；锚点 `app.post('/api/sessions/:id/cancel'` 的处理函数（读 body）；import 区加 `listSessionHistory`。<br>**P2-4**：锚点 `nextResetAt: nextResetAt(offset),` 之后加一行 `boardTzOffsetHours: offset,`。<br>P2-6、P2-5 不碰。 |
| `worker/types.ts` | **P2-2**：文件末尾（`AppEnv` 之前）加 `InvitableUser`。**P2-1**：同处加 `InviteResult`。**P2-6**：`interface SessionItem` 末尾加 `going_preview`。**P2-3**：`SessionRow` 末尾加两列；`SessionPlayerJoinRow` 在 `record_id` 后加两列；`SessionItem` 加两列；`AttendanceSummary`、`HistorySessionItem`、`InviteReason`、`InvitedSessionItem` 放在 `SessionDetail` 之后。形状见 4.2。 |
| `worker/session-extras.ts`（新） | **P2-6** 建（`goingPreviews`、纯函数 `previewOfPlayers`、私有 `holes(count)`）；**P2-3** 在 import 区末尾追加两次 import（不改 P2-6 的两行），文件末尾追加 `InviteContext`、`inviteContexts`、`NO_ATTENDANCE`、`attendanceSummaries`，占位符一律用 P2-6 的 `holes()`（**不要**声明同名局部变量，会遮住它）。只放「按一批 session id 一次查出」的读函数，不放写操作。 |
| `shared/attendance.ts` | 追加型。**P2-1**：`// --- P2-1 ---` 小节；**P2-6**：`// --- P2-6 ---`；**P2-3**：`// --- P2-3 ---`；**P2-4**：`// --- P2-4 ---`。全部只追加，原有导出一个不动。具体常量见 4.4。 |
| `shared/quickTime.ts` | **只有 P2-4**：文件末尾追加，`quickSlots`、`synthesizeTitle`、`isSynthesizedTitle` 原样不动（`tests/unit/quickTime.test.ts` 不改）。 |
| `migrations/`、`schema.sql`、`server/migrations/` | **只有 P2-3**。 |
| `server/src/import-d1.ts`、`scripts/d1-export.mjs` | **P2 全程不改**（3.3）。 |
| `server/src/discord/sessions.ts` | **P2-3**：只改 `renderSessionDm` 里 `case 'dm.session.cancelled':` 那一段，加 import `SESSION_CANCEL_REASON_MAX`。<br>**P2-4**：删掉本地 `const RSVP_LABEL`（`:36`），改为 `import { RSVP_LABEL } from '../../../shared/attendance'`；卡片的 `{ name: '可能', …}`（`:120`）改为 `RSVP_LABEL.maybe`（同一数组里的 `'来'` 也改成 `RSVP_LABEL.going`，文字不变）；`invited` 私信里的 `{ name: '来', … }` 同样；`YUE_SLOTS`（`:241-247`）改为 `export const YUE_SLOTS = BOARD_SLOTS;`；`slotIso`（`:250-254`）删掉本地实现，改为 `export { slotIso } from '../../../shared/quickTime';`（`server/test/session-render.test.ts:2` 从这里导入）；`handleYue` 删掉 `:261` 一行，`:264` 的 `15 * 60_000` 换成 `BOARD_SLOT_MIN_LEAD_MS`。<br>两者区域不重叠。 |
| `server/src/discord/commands.ts` | **只有 P2-5**：`handleNotify`（`:360-375`）的 UPDATE 换成 `setNotifyDm(ctx.db, { discordUserId: input.caller.id }, on)`，回复文案一字不改。P2-4 **不碰**它（`YUE_SLOTS` 的名字、`value` 不变，`commands.ts:125` 的 choices 照常生成，不需要重新注册命令以外的改动）。 |
| `server/src/discord/links.ts`、`server/src/link-routes.ts` | **只有 P2-5**。 |
| `server/src/outbox/dispatcher.ts` | **只有 P2-1**：锚点 `export const INVITES_PER_ORGANIZER = 3;`（`:80`）改为从 shared 引入并 re-export（`tests/pg/session-cards.test.ts:13` 从这里导入），上方注释保留。`BUDGETS`、`invitesFrom`、`renderDm` 一律不动。 |
| `src/types.ts` | **P2-2**：在 `// --- Sessions ---` 之前加 `InvitableUser`、`InvitableResponse`。**P2-1**：`SettleResponse` 之后加 `InviteResponse`。**P2-6**：`SessionItem` 末尾加可选 `going_preview?`。**P2-3**：`SessionItem` 再加两个可选字段；`SessionDetail` 之后加 `AttendanceSummary`、`HistorySessionItem`、`InviteReason`、`InvitedSessionItem`、`InvitesResponse`。**P2-4**：`Config` 末尾加 `boardTzOffsetHours?`。**新字段在前端一律可选**（旧后端没有它们，现有 dom 测试的 fixture 也没有）。 |
| `src/api.ts` | **P2-2**：import 列表在 `FileCasesResponse,` 后加 `InvitableResponse,`、`InvitableUser,`；`// --- Sessions ---` 小节末尾（`getMyInvites` 之后）加 `getInvitable`。**P2-1**：import 列表在 `InvitableUser,` 后加 `InviteResponse,`；`// --- Weekly report ---` 之前加 `inviteToSession`。**P2-3**：import 列表以 `FileCasesResponse,` … `LeaderboardResponse,` 五行（含 P2-2、P2-1 的三行）为锚点整体替换，加 `HistorySessionItem`、`InvitesResponse`，另在 `SessionDetailResponse,` 后加 `SessionItem,`；`cancelSession` 加可选 `reason`；`getMyInvites` 返回类型改 `InvitesResponse`，`getSessionHistory` 紧接在它后面（排在 P2-2 的 `getInvitable` 之前）。**P2-5**：`// --- Discord binding (Node backend only) ---` 小节：`DiscordLinkInfo` 加两个可选字段，末尾加 `setDiscordNotify`。`getSessions` 的签名和 URL **不改**（`tests/dom/app-refresh.test.tsx:145` 锁首屏 URL 集合）。 |
| `src/components/SessionDetailDialog.tsx` | **只有 P2-1**（见 3.1）。 |
| `src/components/SessionsPanel.tsx`、`SessionFormDialog.tsx`、`RescheduleSheet.tsx`、`App.tsx`、`InviteBanner.tsx` | **P2 全程不改**。 |
| `docs/CONTRACT.md` | 每个 PR 只改自己的端点行和 `interface SessionItem` 里自己的字段行：**P2-2** Authenticated 小节加 `/api/me/invitable`；**P2-1** `**Sessions**` 小节在 `POST /api/sessions/:id/cancel` 下面加 `/invite`；**P2-6** `interface SessionItem` 加 `going_preview`；**P2-3** `SessionItem` 加两列、`/api/sessions` 一行加 `history`、`/cancel` 一行加 body、`/api/me/invites` 一行加三字段、新增 `HistorySessionItem`/`InvitedSessionItem` 形状；**P2-4** `/api/config` 一行加 `boardTzOffsetHours`。P2-5 不碰（Discord 路由写在 `docs/DEPLOY-DISCORD.md`）。 |
| `docs/DEPLOY-DISCORD.md` | **P2-3**：`:188`「约局取消」一行补「附组织者写的理由（如有）」（行数不变）。**P2-4**：`:169-171` 和 `:187-188` 的「可能」改「待定」（`:188` 只换这两个字，P2-3 加的理由保留）；`:191` 一行换成两行（「已绑定的用户都能发起（不必上榜）」+ 时段说明）。**P2-5**：`:8` 补 `POST /api/me/discord/notify`；`:20` `/notify` 一行补「网页上也能开关」。都按原文锚点替换。 |
| `tests/worker/session-routes.test.ts`（新） | **P2-2** 建（顶层 `BASE`、`SECRET`、`appEnv`、`call(path, init?, overrides?)`、`asUser(sub, extra?)`，照抄 `tests/worker/http-guards.test.ts:17-43` 的写法，cookie 用 `signSession`；import 区六行，含 `type Env`、`noAiEnv, seedUser`）；P2-1、P2-6、P2-3、P2-4 各在**末尾追加**一个 describe，不改别人的。import 区只有 **P2-3** 在 `import { noAiEnv, seedUser } from './helpers';` 之后追加三行（`createSession, setRsvp, updateSession`、worker 类型、`OFFSET_HOURS`），它的 Task 3、4 只改自己那一行类型 import；P2-1、P2-6、P2-4 不加 import。 |
| `tests/worker/going-preview.test.ts`（新） | **只有 P2-6**。 |
| `tests/pg/session-cards.test.ts` | **P2-1**：import 区在 `import { cancelSession, createSession, … } from '../../worker/sessions';` 之后加两行（`inviteToSession`、`SHARED_INVITES_PER_ORGANIZER`），末尾追加 describe `invites after creation`。**P2-3**：末尾追加 describe `a cancel with a reason`。**P2-4**：**改**「/yue is for bound players only」那个用例（按用例名定位，第 7 节第 1 条），并在 `describe('/yue, more'` 的最后一个用例之后追加一个用例。 |
| `server/test/session-render.test.ts` | **P2-3**：在 `import type { SessionDetail } from '../../worker/types';` 之后加 `import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';`，末尾追加 describe `the cancel DM`。**P2-4**：把 `RSVP_LABEL` 并进 P2-3 那一行（不另起一行），再加 `shared/quickTime`、`YUE_SLOTS` 两行 import，末尾追加 describe `labels and slots`。`:2` 的 import 行两个 PR 都不改（P2-4 靠 re-export 保住 `slotIso`）。 |
| `tests/unit/source-hygiene.test.ts` | **只有 P2-4**：import 区在 `import { FILED_DM_GRACE_MS } from '../../shared/scoring';` 之后加一行，文件末尾追加 describe（第 6.4 节）。 |
| `tests/dom/session-api.test.tsx`（新） | **只有 P2-3**。 |
| `tests/dom/discord-link.test.tsx` | **只有 P2-5**：import 行加 `setDiscordNotify`，末尾追加 describe；`:82`、`:194` 的请求数断言不动。 |

### 3.1 `SessionDetailDialog.tsx`（只有 P2-1）

现有签名 `{sessionId, me, onClose, onChanged, variant?, resumeRsvp?, onResumeDone?}` 一个不改。P2-1 只做这些：

1. import 区：`import type { … } from '../types'` 加 `InviteResponse`（前端名；`InviteResult` 是 `worker/types.ts` 的名字），加 `import { inviteToast } from '../lib/invitePicker';`、`import { useInvitable } from '../lib/useInvitable';`、`import { InviteSheet } from './InviteSheet';`。
2. state 区在 `const [rescheduleOpen, setRescheduleOpen] = useState(false);` 之后加 `const [inviteOpen, setInviteOpen] = useState(false);`。
3. 锚点 `const canRollCall = canManage && session?.status === 'open' && started;` 之后加：
   ```ts
   // P2-1: 再叫几个人 — same gate as the server (requireOrganizer, open, not started).
   const canInvite = canManage && session?.status === 'open' && !started;
   const invitable = useInvitable(canInvite);
   ```
   （hook 在 `return` 之前无条件调用，`enabled` 为假时不发请求。）
4. 在 `handleRescheduled` 之后加 `handleInvited(result: InviteResponse)`：`setInviteOpen(false)`、`setSession(result.session)`、`setError(null)`、toast `inviteToast(result.added)`（`tone: 'ok'`，文案见 4.6）、`onChanged()`。
5. `<OrganizerActions …>` 多传一个可选 `onInvite={showInviteEntry ? () => setInviteOpen(true) : undefined}`，其中 `showInviteEntry = invitable.state.kind === 'ready' || invitable.state.kind === 'error'`。
6. 文件内 `OrganizerActions` 组件：props 加可选 `onInvite?: () => void`；在 `{!started && (<button …>改时间</button>)}` **之前**渲染 `{!started && onInvite && (<button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onInvite}><span aria-hidden="true">＋ </span>再叫几个人</button>)}`（可访问名是「再叫几个人」）。
7. 在 `{session && rescheduleOpen && (<RescheduleSheet …/>)}` 之后加 `{session && inviteOpen && (<InviteSheet session={session} invitable={invitable} onClose={() => setInviteOpen(false)} onInvited={handleInvited} />)}`。

不碰：RSVP 区、`RsvpControls`、`CancelSessionControl`（取消理由输入框是 P3-3，第 8 节第 2 条）、名单、记录区、`<Modal>` 包装、标题聚焦、P1-3 的访客区和 ResumeHint。P2-1 后文件不超过 520 行（合成副本实测 475 → 510）。

### 3.2 PG 触发器与 outbox：P2 不改

逐条核对过 `server/migrations/0005_sessions.sql`：

- **新邀请的私信**：`session_players_outbox`（`:173-202`）在 `INSERT` 一行 `rsvp = 'invited'` 时 `outbox_emit('dm.session.invited', …, 'dm:session:<sid>:invited:<uid>')`（`:191`）。`POST …/invite` 用 `INSERT … ON CONFLICT DO NOTHING`：新行触发、已有的行不触发（冲突不算 INSERT），所以「后叫的人也收到邀请私信」**不用改触发器**。额度照旧由 dispatcher 管：`INVITES_PER_ORGANIZER = 3`（同一组织者对同一人 24 小时，`dispatcher.ts:80` + `invitesFrom` `:354-363`）和 `SESSION_DM_BUDGET = 10`（每人 24 小时，邀请和改期共用，`:78`、`:93`）。
- **改期**：P2-3 的重置 UPDATE 多写 `prev_rsvp`、`prev_starts_at`，但触发条件 `AFTER … UPDATE OF rsvp` 和「rsvp 没变就返回」（`:186`）都不受影响；`session_players_knows`（BEFORE，`:29-42`）只看 `rsvp`。`setRsvp` 的 upsert 多清两列，同理。
- **取消**：`sessions_outbox`（`:103-171`）的「什么都没变就返回」只比较 title/game/starts_at/capacity/duration_min/note/status（`:122-127`）。`cancel_reason`、`cancelled_at` 和 `status` 在**同一条** UPDATE 里写入，status 变了，取消分支（`:130-140`）照常按 `rsvp IN ('going','maybe') OR (invited AND knows)` 发 `dm.session.cancelled`，收件人集合不变。私信的 payload 只有 `session_id`，dispatcher 投递时 `loadSession` → `getSessionDetail` 读**当时**的局（`dispatcher.ts:563-594`），所以理由自然带上；「邀请私信在路上时局被取消」那条补发路径（`dispatcher.ts:584-591`）也走同一个渲染。
- **导入**：`edg.importing` 的守卫不变，导入带新列的历史数据不发任何事件。

所以 `0007_lobby.sql` 只有四条 `ADD COLUMN IF NOT EXISTS`，没有函数、没有触发器。

### 3.3 `import-d1`：只改测试

`server/src/import-d1.ts` 用 `information_schema.columns` 动态取每张表的列（`columnsOf`，`:84-91`），只插入导出里出现的列（`present`，`:169`），并按列做逐行校验和。所以：

- D1 迁移过 004、PG 迁移过 0007：四列原样导入、原样校验，**代码不用改**。
- D1 没迁移（导出里没有这四列）：PG 里这四列为 NULL，照常导入。
- **D1 迁移了、PG 没迁移**：preflight 报 `export has tables/columns this schema lacks: game_sessions.cancel_reason, …` 并拒绝（`:153-155`）。这是期望行为：先跑 PG 迁移（compose 的 `migrate` 服务本来就先于导入）。写进 P2-3 的 PR 描述。
- `scripts/d1-export.mjs` 是 `SELECT * FROM <table>`（`:54`），新列自动导出，不用改。
- spec §8 说「import-d1 脚本要带上新列」：实际只需要改 `tests/pg/import-d1.test.ts` 的 fixture（第 8 节第 7 条）。

### 3.4 SQL 方言：两个引擎都要合法

适配器只把 `?` 换成 `$n`，并给没有 RETURNING 的 INSERT 补 `RETURNING *`；**不翻译方言**（`server/src/db/d1.ts:13-15`）。P2 的 SQL 守这些：

- 时间：`created_at`/`cancelled_at`/`rsvp_at` 用 `datetime('now')`（PG 有同名函数，`0001_init.sql:18-29`），是 `YYYY-MM-DD HH:MM:SS`；`starts_at`/`prev_starts_at` 是 ISO。两种格式**不能混着比较**（`docs/CONTRACT.md` 「Timestamp formats are not interchangeable」）；和 `starts_at` 比较的「现在」一律 `new Date().toISOString()` 绑定进去（照 `listSessions` `:147-151` 的注释）。
- `UPDATE … SET rsvp = 'invited', prev_rsvp = rsvp, …`：右边读的是**更新前**的值，SQLite 和 PG 都是。
- `INSERT … SELECT … FROM users WHERE … ON CONFLICT (session_id, user_id) DO NOTHING`：SELECT 必须带 WHERE（SQLite 的 upsert 歧义，`worker/sessions.ts:364-367` 的注释）。
- `ORDER BY` 里不要在表达式中引用 SELECT 的别名（PG 只允许单独引用别名，`CASE WHEN alias IS NULL` 会报错），一律写底层表达式。
- 不用 `NULLS LAST`、不用行值比较 `(a, b) < (?, ?)`、不用窗口函数：用 `CASE WHEN … IS NULL THEN 1 ELSE 0 END`、展开的 `OR`、JS 里切片。
- `COUNT(*)` 在 PG 是 int8，适配器已转成 number；`is_participant` 在 PG 是 bigint，映射时 `=== 1` 转布尔。
- `IN (…)` 的占位符按个数生成（照 `myRsvpMap` `:127-134`），值一律绑定。

## 4. 接口

### 4.1 端点总表

| PR | 方法 + 路径 | 权限 | 请求 | 成功返回 | 错误（状态：`error` 原文） |
|---|---|---|---|---|---|
| P2-2 | `GET /api/me/invitable` | 登录 | — | `{ users: InvitableUser[] }`；头 `Cache-Control: private, no-store` | 401：`未登录` |
| P2-1 | `POST /api/sessions/:id/invite` | 登录 + `requireOrganizer`（组织者或管理员） | `{ user_ids: string[] }` | `{ session: SessionDetail, added: number, skipped: number }` | 见 4.3 |
| P2-6 | 所有返回 `SessionItem` 的地方 | 跟随原接口 | — | 每项多 `going_preview` | — |
| P2-3 | `GET /api/sessions?scope=history[&before=<id>]` | 公开 | — | `{ sessions: HistorySessionItem[] }`，每页 `SESSION_HISTORY_PAGE`（20）条 | 400：`无效的约局 ID`（`before` 不是正的安全整数） |
| P2-3 | `POST /api/sessions/:id/cancel` | 不变（组织者或管理员） | 可选 `{ reason?: string }`；**无 body 照旧** | `{ session }`，带 `cancel_reason`、`cancelled_at` | 不变 |
| P2-3 | `GET /api/me/invites` | 登录 | — | `{ sessions: InvitedSessionItem[] }` | 不变 |
| P2-3 | `GET /api/sessions`、`/api/sessions/:id`、`/api/me/invites` 等 | 不变 | — | 每个 `SessionItem` 多 `cancel_reason`、`cancelled_at` | — |
| P2-4 | `GET /api/config` | 公开 | — | 多 `boardTzOffsetHours: number` | — |
| P2-5 | `GET /api/me/discord` | 本人（Node 端） | — | `{ link: null \| { discord_username, linked_at, notify_dm: boolean, dm_ok: boolean } }` | 401：`未登录`；旧 Worker / 没配 Discord：404 |
| P2-5 | `POST /api/me/discord/notify` | 本人（Node 端） | `{ on: boolean }` | `{ link: { discord_username, linked_at, notify_dm, dm_ok } }` | 见 4.3 |

**所有** P2 新增或改动的写接口都沿用现有中间件：CSRF（`worker/routes.ts:170-174`；link-routes `:268-270`）、READ_ONLY 返回 503「系统维护中（只读），请稍后再试」（`worker/routes.ts:180-192`；link-routes 在处理函数里自己判断，照 `/unlink` `:281-282`）、CORS 的 `allowHeaders` 只有 `Content-Type`、`Accept`（spec §8「明确不动的」）。`safeNextPath`、cookie 不碰。

`/api/me/invitable` 放在 `/api/me/*` 下，避免被 `GET /api/users/:id`（`worker/routes.ts:278`）当成用户 id；在 Node 的 API 主机上它不在 `isBindingPath`（`server/src/api-host.ts:17-20` 只认 `/link`、`/api/me/discord`）里，照常交给 Worker app。`/api/me/discord/notify` 正好落在 `isBindingPath` 里，由 link-routes 处理。

### 4.2 数据形状

**`worker/types.ts`**（JSON 里布尔是真布尔）：

```ts
// --- P2-2 ---
/** One row of GET /api/me/invitable. Never a score, never anything about Discord. */
export interface InvitableUser {
  id: string;
  username: string;               // COALESCE(display_name, username)
  avatar_url: string | null;
  is_participant: boolean;
  /** starts_at (ISO) of the latest session, already started and not cancelled, where both said 来 and neither was marked 没来 / 请假; else null. */
  last_played_with_me_at: string | null;
}

// --- P2-1 ---
export interface InviteResult {
  session: SessionDetail;
  /** Rows actually inserted (each one an invitation; on PostgreSQL each queues a DM). */
  added: number;
  /** Distinct requested ids, minus the organizer, minus `added`: already in it, or unknown. */
  skipped: number;
}

// SessionItem（P2-6、P2-3 追加，服务端一律必有）：
export interface SessionItem {
  /* …现有字段… */
  /** P2-6: up to GOING_PREVIEW_MAX people whose answer is 来, earliest answer first. Names and avatars only. */
  going_preview: RecordActor[];
  /** P2-3: the organizer's reason, trimmed and cut to SESSION_CANCEL_REASON_MAX; null when none (or not cancelled). */
  cancel_reason: string | null;
  /** P2-3: when it was cancelled, datetime('now') shape; null when not cancelled, or cancelled before P2-3. */
  cancelled_at: string | null;
}

// --- P2-3 ---
export type AttendanceSummary = Record<Attendance, number>;   // on_time, late, no_show, left_early, excused
export interface HistorySessionItem extends SessionItem {
  attendance_summary: AttendanceSummary;                       // all five keys, zeros included
}
export type InviteReason = 'new' | 'moved';
export interface InvitedSessionItem extends SessionItem {
  /** 'moved' when prev_starts_at is set: they had answered, then the time changed. */
  invite_reason: InviteReason;
  prev_rsvp: SelfRsvp | null;      // what they had said to the old time
  prev_starts_at: string | null;   // the old time (ISO), as they answered it
}

// SessionRow 末尾：cancel_reason: string | null; cancelled_at: string | null;
// SessionPlayerJoinRow 在 record_id 后：prev_rsvp: string | null; prev_starts_at: string | null;
```

`SessionPlayer`（`toSessionPlayer`）**不**加 `prev_*`：改期上下文只给本人看，只经 `/api/me/invites` 返回（第 6 节）。

**`src/types.ts`**（新字段在前端一律可选，旧后端和现有 fixture 都没有）：

```ts
// P2-2
export interface InvitableUser { id: string; username: string; avatar_url: string | null; is_participant: boolean; last_played_with_me_at: string | null }
export interface InvitableResponse { users: InvitableUser[] }
// P2-1
export interface InviteResponse { session: SessionDetail; added: number; skipped: number }
// SessionItem 追加
  going_preview?: UserRef[];        // P2-6
  cancel_reason?: string | null;    // P2-3
  cancelled_at?: string | null;     // P2-3
// P2-3
export type AttendanceSummary = Record<Attendance, number>;
export interface HistorySessionItem extends SessionItem { attendance_summary: AttendanceSummary }
export type InviteReason = 'new' | 'moved';
export interface InvitedSessionItem extends SessionItem { invite_reason?: InviteReason; prev_rsvp?: SelfRsvp | null; prev_starts_at?: string | null }
export interface InvitesResponse { sessions: InvitedSessionItem[] }
// P2-4：Config 末尾
  /** Board time zone (RESET_TZ_OFFSET), hours. Absent from an older API: fall back to the browser's zone and say 本地时间. */
  boardTzOffsetHours?: number;
```

前端读到缺字段时的约定：`invite_reason` 缺 = `'new'`；`going_preview` 缺 = 不显示头像；`boardTzOffsetHours` 缺 = 浏览器时区 +「本地时间」；`cancel_reason` 缺 = 没有理由。

### 4.3 写接口的校验顺序与错误

**`POST /api/sessions/:id/invite`**（`worker/session-invites.ts` 的 `inviteToSession(db, caller, id, rawUserIds): Promise<InviteResult>`；路由 `requireUser` → `readJsonBody` → `inviteToSession(c.env.DB, caller, parseId(id, '约局'), body.user_ids)` → `c.json(result)`）

按这个顺序检查（先权限后状态，和 `updateSession` 一致：`tests/worker/session-update.test.ts:602` 锁了「先 403 后 400」）：

| # | 情况 | 状态 | `error` |
|---|---|---|---|
| 1 | 没登录 | 401 | `未登录` |
| 2 | READ_ONLY | 503 | `系统维护中（只读），请稍后再试`（中间件） |
| 3 | id 非法 | 400 | `无效的约局 ID` |
| 4 | 局不存在 | 404 | `约局不存在` |
| 5 | 不是组织者也不是管理员 | 403 | `只有组织者可以操作这个约局` |
| 6 | `status` 不是 `open` | 400 | `已取消 / 已结算的约局不能再叫人` |
| 7 | 已开局（`parseSqlUtc(starts_at) <= Date.now()`） | 400 | `约局已开始，不能再叫人` |
| 8 | `user_ids` 不是数组（含缺失） | 400 | `user_ids 必须是数组` |
| 9 | 数组为空 | 400 | `至少选一个人` |
| 10 | 有非字符串或空串 | 400 | `user_ids 里有无效的用户 ID` |
| 11 | 去重、去掉**这局的组织者**（`row.organizer_id`，不是调用者）后超过 `MAX_INVITES`（20） | 400 | `一次最多邀请 20 人` |
| 12 | 名单现有行数 + 请求里还不在局里的人数 > `MAX_SESSION_ROSTER`（50） | 400 | `这局最多 50 人，已经有 N 人了` |
| — | 去掉组织者后一个都不剩 | 200 | `{ session, added: 0, skipped: 0 }`，不写库 |
| — | CSRF 失败 | 403 | `请求来源不被允许` |

第 8、9 条由 `inviteToSession` 自己先查（`normalizeInvites` 对 `undefined`/`null` 返回空数组、不报错，不能靠它；`createSession` 的 `invite` 可省略、`invite: []` 合法，这个行为不变）；第 10、11 条由 `normalizeInvites(raw, row.organizer_id, 'user_ids')` 完成。第 12 条先读一次 `SELECT user_id FROM session_players WHERE session_id = ?`，算出请求里还不在局里的人数；写入时 SQL 里的计数再守一次（并发时超出的行被跳过、计入 `skipped`）。文案里的数字一律用常量插值。

写入（一个 `db.batch`，原子）：

```ts
db.prepare('UPDATE game_sessions SET status = status WHERE id = ?').bind(id),   // PG: take the session's row lock (as setRsvp does); D1 serialises batches
...ids.map((userId) =>
  db.prepare(
    `INSERT INTO session_players (session_id, user_id, rsvp)
     SELECT ?, u.id, 'invited' FROM users u
      WHERE u.id = ?
        AND EXISTS (SELECT 1 FROM game_sessions WHERE id = ? AND status = 'open')
        AND (SELECT COUNT(*) FROM session_players WHERE session_id = ?) < ?
     ON CONFLICT (session_id, user_id) DO NOTHING`,
  ).bind(id, userId, id, id, MAX_SESSION_ROSTER),
),
```

- `added` = 各 INSERT 的 `meta.changes` 之和；`skipped = ids.length - added`。
- **已有的行一律不动**：说了不来的仍是 `out`、来的仍是 `going`、还没回的仍是 `invited`（`rsvp_at` 也不变）。不存在的用户 id 被 `FROM users WHERE` 丢掉，计入 `skipped`，不报错（和 `createSession` 一致，`tests/worker/invites.test.ts:82`）。
- 写入时局已被取消（检查和写之间）：`EXISTS … status = 'open'` 让所有 INSERT 都是 0 行，返回 `added: 0`。不另报错（详情里能看到「已取消」）。
- 返回 `{ session: await getSessionDetail(db, id, caller.id), added, skipped }`。
- D1 上不发私信（没有触发器），和现状一致；PG 上每个新行一条 `dm.session.invited`（3.2）。
- 响应里**没有**任何「多少人能收到私信」的数字（§11 第 9 条）。

**`POST /api/sessions/:id/cancel {reason?}`**（`cancelSession(db, caller, id, rawReason?: unknown)`；路由 `const body = await readJsonBody(c.req.raw)`——空 body 时它返回 `{}`（`worker/http.ts:51-60`），旧前端照常——再传 `body.reason`）

- 校验和错误一条不改（`settled` 400、已取消再取消原样返回不覆盖理由、409「约局状态已变化，请刷新后重试」）。
- `reason = normalizeOptionalText(rawReason, SESSION_CANCEL_REASON_MAX)`：不是字符串 → null；trim 后为空 → null；否则截到 80（和 `game`、`note` 用同一个函数，见第 7 节「已知 BUG」）。
- UPDATE：`UPDATE game_sessions SET status = 'cancelled', cancel_reason = ?, cancelled_at = datetime('now') WHERE id = ? AND status = 'open'`。

**`POST /api/me/discord/notify {on}`**（`server/src/link-routes.ts`，放在 `/api/me/discord/unlink` 之后，写法照它）

| # | 情况 | 状态 | `error` |
|---|---|---|---|
| 1 | READ_ONLY | 503 | `系统维护中（只读），请稍后再试`（`READ_ONLY_MESSAGE`） |
| 2 | 没登录 | 401 | `未登录` |
| 3 | `on` 不是布尔（含缺失、body 不是 JSON） | 400 | `缺少 on（true 或 false）` |
| 4 | 没绑定 | 409 | `还没有绑定 Discord` |
| 5 | 外站来源 | 403 | `请求来源不被允许`（csrfGuard） |

- body 用 `readJsonBody(c.req.raw)`（从 `worker/http` 引入，拒绝 NUL），`optBool(body.on)`。
- 写入走新函数 `setNotifyDm(db, who: { userId: string } | { discordUserId: string }, on: boolean): Promise<DiscordLink | null>`（`server/src/discord/links.ts`）：`UPDATE discord_links SET notify_dm = ?, dm_ok = 1, updated_at = datetime('now') WHERE user_id = ?`（或 `discord_user_id = ?`），然后读回；没有这一行返回 null。语义和 bot `/notify` 完全相同（打开或关闭都把 `dm_ok` 重置为 1：「谁来要私信就再给一次机会」，`commands.ts:365-368`），区别只是按 `user_id` 定位。bot 的 `handleNotify` 改为调用它。
- 返回 `{ link: { discord_username, linked_at, notify_dm: link.notify_dm === 1, dm_ok: link.dm_ok === 1 } }`，`Cache-Control: no-store`。
- 不写 `link_audit`（那张表只记绑定、换绑、解绑）。

### 4.4 `shared/` 的新常量与函数

`shared/attendance.ts`（只追加，按小节）：

```ts
// --- P2-1 ---
/** People one create (invite) or one POST …/invite may name. */
export const MAX_INVITES = 20;
/** A session's roster never grows past this by invitation: roll call takes at most this many entries. */
export const MAX_SESSION_ROSTER = 50;
/** Invitation DMs one organizer may send one person per 24 h (the dispatcher enforces it; the web says it). */
export const INVITES_PER_ORGANIZER = 3;

// --- P2-6 ---
/** People shown on a session card before "+N". */
export const GOING_PREVIEW_MAX = 5;

// --- P2-3 ---
/** A cancel reason, trimmed, is cut to this many characters. It goes into DMs and onto the session page. */
export const SESSION_CANCEL_REASON_MAX = 80;
/** Sessions per page of GET /api/sessions?scope=history. */
export const SESSION_HISTORY_PAGE = 20;

// --- P2-4 ---
/** Per organizer: sessions open and still ahead at once, and created per rolling 24 h (cancelled ones count). */
export const MAX_OPEN_SESSIONS = 5;
export const MAX_SESSIONS_PER_DAY = 10;
/** A session without a length is taken to last this long. MUST equal COALESCE(s.duration_min, 120) in server/migrations/0005_sessions.sql (source-hygiene). */
export const DEFAULT_DURATION_MIN = 120;
```

- 迁过来的常量**值一字不改**，原位置改为 `import` + `export { … } from '../shared/attendance'`（worker）或 `export { INVITES_PER_ORGANIZER } from '../../../shared/attendance'`（dispatcher），现有测试的导入路径都不用改。
- `worker/sessions.ts` 的 `MAX_ROLLCALL_ENTRIES` 改为 `= MAX_SESSION_ROSTER`（值仍是 50），保证邀请能填满的名单一定能一次点完名。

`shared/quickTime.ts`（P2-4，末尾追加；纯函数，不读时钟以外的全局）：

```ts
// --- P2-4: the board's time zone (RESET_TZ_OFFSET) ---------------------------

export interface BoardSlotDef { value: string; name: string; dayOffset: number; hour: number }
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
export function slotIso(dayOffset: number, hour: number, offsetHours: number, now = Date.now()): string;
export interface BoardSlot extends QuickSlot { value: string }
/** BOARD_SLOTS still at least BOARD_SLOT_MIN_LEAD_MS ahead, as chips: label = the slot's name. Never empty (明晚 is always ahead). */
export function boardSlots(now: number, offsetHours: number): BoardSlot[];
/** 8 → '北京时间'; 0 → 'UTC'; 9 → 'UTC+9'; -5 → 'UTC-5'; 5.5 → 'UTC+5:30'; -3.5 → 'UTC-3:30'. */
export function boardTzLabel(offsetHours: number): string;
```

- `YUE_SLOTS` 变成 `BOARD_SLOTS` 的别名（名字、`value`、`name` 都不变，所以 Discord 的命令定义 `commands.ts:125` 生成的 choices 不变）。
- bot 文件里 `slotIso` 写成 `import { BOARD_SLOTS, BOARD_SLOT_MIN_LEAD_MS, slotIso } from '../../../shared/quickTime';` + `export { slotIso };`（`handleYue` 自己还要调用它，`export … from` 不产生本地绑定），对外效果等同 re-export（P2-4「对契约的补充」第 2 条）。
- 旧的 `quickSlots`、`MIN_LEAD_MINUTES`（30）**保留不动**：现有的 `SessionFormDialog`、`RescheduleSheet` 和它们的测试继续用它，P3 才换（spec §4.2「旧的 quickSlots 保留，现有测试不变」）。

`src/lib/time.ts`（P2-4；`formatWhen` 的现有调用全部不传第三参，输出一字不变）：

```ts
/** offsetHours omitted → today's output exactly. Given → the same buckets (今天 / 明天 / 周X / M月D日) read on the board's wall clock. */
export function formatWhen(value: string, now: number = Date.now(), offsetHours?: number): string;
/** '周五 10/30 21:00（北京时间）' — the board's wall clock and its zone label (spec §11 #8). '' when unparseable. */
export function formatBoardDateTime(value: string, offsetHours: number): string;
/** '你那边 22:00' when the viewer's UTC offset at that instant differs from the board's; '你那边 周六 01:00' when the viewer's date differs too; null when the zones agree or the value is unparseable. */
export function formatViewerAside(value: string, offsetHours: number): string | null;
```

spec §5 第 9 条那行完整的「周五 10/30 21:00（北京时间）· 还有 2 小时 · 你那边 22:00」由 P3 用 `formatBoardDateTime` + 现有的 `formatTimeLeft` + `formatViewerAside` 拼（第 8 节第 4 条）。

### 4.5 `src/api.ts` 的新函数

```ts
// P2-2 — 404 = an API without the endpoint: undefined, so the entry hides (like getDiscordLink).
export async function getInvitable(): Promise<InvitableUser[] | undefined>;      // GET /api/me/invitable
// P2-1
export function inviteToSession(id: number, userIds: string[]): Promise<InviteResponse>;   // POST /api/sessions/:id/invite { user_ids }
// P2-3
export function cancelSession(id: number, reason?: string): Promise<{ session: SessionDetail }>;
//   reason === undefined → post(path) with NO body (organizer-actions.test.tsx:316 pins body: null); else post(path, { reason }).
export async function getSessionHistory(before?: number): Promise<HistorySessionItem[] | undefined>;
//   GET /api/sessions?scope=history[&before=N]. undefined when any item lacks attendance_summary:
//   an older API reads an unknown scope as 'upcoming' and answers 200 (worker/routes.ts:287-288), not 404.
export function getMyInvites(): Promise<InvitesResponse>;                       // 类型变宽，URL 不变
// P2-5
export interface DiscordLinkInfo { discord_username: string; linked_at: string; notify_dm?: boolean; dm_ok?: boolean }
export async function setDiscordNotify(on: boolean): Promise<DiscordLinkInfo | undefined>;   // 404 → undefined; 409 等照常抛 ApiError
```

`getSessions(scope)` 的签名和 URL 不变。

### 4.6 P2 唯一的界面改动：P2-1 的「＋ 再叫几个人」

完整的组织者控制台（`OrganizerConsole`、带「和上次一样」「上次一起玩的」和搜索的 `InviteSheet`、迁过去的 `RescheduleSheet`、取消理由、`ShareActions`）是 P3-3。P2 只在**现有**详情弹窗的组织者操作区（`OrganizerActions`）里加一个入口和一个最简的 sheet；P2-2 … P2-6 不改任何组件、CSS。

**入口**（`SessionDetailDialog.tsx`，3.1）
- 显示条件：`canManage`（组织者或管理员，和 `requireOrganizer` 一致）且 `status === 'open'` 且没开局，且 `useInvitable` 的状态是 `ready` 或 `error`。
- 位置：`OrganizerActions` 里第一个，在「改时间」之前（spec §3.5 线框 `[＋ 再叫几个人]   [改时间]`）。
- **404 静默隐藏**：`GET /api/me/invitable` 返回 404 时状态为 `unsupported`，入口不渲染，也不出现任何提示（和 `getDiscordLink` 的做法一样）。
- 不满足显示条件时**不发** `/api/me/invitable` 请求（访客、普通玩家、已开局、已取消、已结算）。

**`src/lib/useInvitable.ts`**

```ts
export type InvitableState =
  | { kind: 'off' }                                  // enabled is false: nothing asked
  | { kind: 'loading' }
  | { kind: 'ready'; users: InvitableUser[] }
  | { kind: 'error' }                                // anything but 404: the entry stays, the sheet offers 重试
  | { kind: 'unsupported' };                         // 404: this API has no /api/me/invitable
export interface Invitable { state: InvitableState; reload: () => void }   // P2-1 定名，InviteSheet 的 prop 用它
export function useInvitable(enabled: boolean): Invitable;
```

`enabled` 第一次为真时请求一次；之后不自动重拉（`reload` 只由 sheet 的「重试」调用）。卸载后不再 setState。

**`src/lib/invitePicker.ts`**（纯模块，`tests/unit` 导入）

```ts
export type InviteRowState = 'free' | 'in' | 'out';   // in = 已在局里（invited/going/maybe），out = 说了不来
export interface InviteRow { user: InvitableUser; state: InviteRowState }
export interface InviteGroups { onBoard: InviteRow[]; others: InviteRow[] }   // 保持服务端顺序
export function inviteGroups(users: readonly InvitableUser[], players: readonly SessionPlayer[]): InviteGroups;
/** Adds or removes `id`; never past MAX_INVITES; returns a new array. */
export function toggleInvite(selected: readonly string[], id: string, max?: number): string[];
/** The toast after POST …/invite (the two texts below). P2-1 补充：放进纯模块，unit 锁原文。 */
export function inviteToast(added: number): string;
```

**`src/components/InviteSheet.tsx`** + `invite-sheet.css`（BEM 前缀 `.ivs`）

- props：`{ session: SessionDetail; invitable: Invitable; onClose: () => void; onInvited: (result: InviteResponse) => void }`。
- 每一行是可见的原生 checkbox（不是 SessionFormDialog 那种隐藏 input 的胶囊；`PeoplePicker` 的抽取是 P3-3）。管理员（不是组织者）打开时，组织者本人会出现在名单里并显示「· 已在局里」（P2-2 只排除调用者）。
- `<Modal open onClose={onClose} labelledBy="invite-sheet-title" variant="sheet" title="再叫几个人" historyKey="invite">`（P1-2 的返回键关闭；`historyKey` 不超过 `HISTORY_SHEET_NAME_MAX`）。
- 内容自上而下（DOM 顺序 = 视觉顺序）：
  1. 状态：`loading` →「加载中…」（`role="status"`）；`error` →「名单没加载出来，稍后再试。」+「重试」按钮（`role="status"`，**不用 alert**：`organizer-actions.test.tsx:356` 锁了详情里没有 alert）；`ready` 且两组都空 →「还没有别的朋友登录过。把链接发到群里，他们登录后就能在这里叫到。」
  2. 两组（各一个 `<fieldset>` + `<legend>`）：「在榜的」、「其他朋友（未上榜，不参与计分）」。每人一个 checkbox：头像 + 名字；`in` 的 disabled 并带「· 已在局里」，`out` 的 disabled 并带「· 说了不来」（spec §3.5：尊重对方的回答，`/invite` 也不改已有的行）。**不显示分数、段位、是否绑了 Discord**。
  3. 已选满 `MAX_INVITES` 时，其余未选的 checkbox disabled，并显示「一次最多叫 20 人」。
  4. 说明（spec §3.5 原文）：「绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 3 条邀请私信。」「没绑的人要自己上网页看，把链接发到群里最稳。」——3 来自 `INVITES_PER_ORGANIZER`。
  5. 提交失败时服务端原文（`role="alert"`，只在 sheet 内）。
  6. 底部：「已选 N 人」+ 金色主按钮「叫 N 人」（N 为 0 时 disabled 且文字为「叫人」；提交中「叫人中…」）。
- 成功：`onInvited(result)`；详情弹窗关 sheet、用返回的 `session` 替换、`onChanged()`、toast（`tone: 'ok'`，不用 alert）：
  - `added > 0`：「已叫 {added} 人。没绑 Discord 的朋友，记得在群里喊一声。」（spec §3.5 的 toast 去掉「[复制邀请链接]」按钮，那是 P3-3 的 ShareActions）
  - `added === 0`：「没有叫到新的人：选的人已经在局里了。」
- 新类名：`.ivs`、`__status`、`__group`、`__legend`、`__row`、`__row--off`、`__tag`、`__cap`、`__note`、`__error`、`__bar`、`__count`。不往 `theme.css` 加 token；过 css-conventions。

## 5. Bot

| 项 | 现状（锚点） | P2 之后 | PR |
|---|---|---|---|
| RSVP 标签 | `server/src/discord/sessions.ts:36` 本地 `RSVP_LABEL = { going: '来', maybe: '可能', out: '不来' }`；按钮用它（`:84`）；登记回复用它（`:222`） | 改用 `shared/attendance` 的 `RSVP_LABEL`：按钮「来 / 待定 / 不来」、回复「已登记：**待定**」 | P2-4 |
| 卡片字段 | `:120` `{ name: '可能', … }` | `{ name: RSVP_LABEL.maybe, … }`（「待定」）；同一数组的「来」、`invited` 私信里的「来」也改为 `RSVP_LABEL.going`（文字不变） | P2-4 |
| `/yue` 时段 | `YUE_SLOTS`（`:241-247`）、`slotIso`（`:250-254`）在 bot 文件里 | `YUE_SLOTS = BOARD_SLOTS`、`slotIso` re-export 自 `shared/quickTime`；名字、`value`、算法不变 | P2-4 |
| `/yue` 提前量 | `:264` `Date.now() + 15 * 60_000` | `+ BOARD_SLOT_MIN_LEAD_MS`（值不变），文案「{slot} 已经过了（或马上就到），换个时间吧。」不变 | P2-4 |
| `/yue` 权限 | `:261` 非上榜用户：「只有上榜选手可以发起约局（网页上可以改身份）。」 | **删掉这一行**（§11 第 7 条）：已绑定的用户都能 `/yue`，和网页 `POST /api/sessions`（任何登录用户）一致；没绑定仍回 `NOT_LINKED`；额度照旧由 `createSession` 管（5 个未开局、24 小时 10 个） | P2-4 |
| `/yue` 成功文案 | 「在网页上可以看到它、邀请人。」 | 不变（P2-1 之后这句话名副其实） | — |
| 取消私信 | `renderSessionDm` 的 `'dm.session.cancelled'`：description「原定 {when}，由 {organizer} 取消。」 | 有理由时 description 末尾换行加「理由：{safeLine(cancel_reason, SESSION_CANCEL_REASON_MAX)}」；没有理由时和现在逐字相同。`safeLine` 去掉换行、中和 markdown 链接和提及（`render.ts:97-100`），消息本身 `allowed_mentions: { parse: [] }` | P2-3 |
| 取消卡片 | `sessionCard` 的 cancelled 形态（删除线标题、「已取消」、无按钮） | **不变**（理由只进私信，频道卡片不显示，spec §4.2 只要求私信） | — |
| `/notify` | `commands.ts:360-375` 自己写 UPDATE（`:367`） | 改为调用 `setNotifyDm`，SQL 和回复文案不变 | P2-5 |
| `/todo`、`/score` 里的 `listMyInvites` | `commands.ts:221`、`:327` | 返回值多了字段，渲染不变 | P2-3 |

**改动的 bot 测试**（都在第 6 节有用例名）：
- **改**：`tests/pg/session-cards.test.ts:351-360`「/yue is for bound players only」——原来断言已绑定的非上榜用户收到「上榜选手」（spec §4.2 说「grep 无结果」，**不对**，见第 7 节第 1 条）。改成「/yue is for anyone bound — on the board or not」：`viewer`（非上榜、已绑定）的 `/yue` 建出一局（`organizer_id = 'viewer'`，回复含「已发起约局」），未绑定的 `dc(8)` 仍含 `/link`。
- **新增**（`server/test/session-render.test.ts`，P2-4）：卡片字段名含 `RSVP_LABEL.maybe`、不含「可能」；按钮 label 依次是 `RSVP_LABEL.going`、`.maybe`、`.out`；`YUE_SLOTS` 与 `BOARD_SLOTS` 相同（同一引用）；`slotIso` 从 bot 模块和 shared 导入的是同一个函数。
- **新增**（`server/test/session-render.test.ts`，P2-3）：取消私信带理由时含「理由：」且 `EVIL` 那串里的 `](`、`@everyone`、`<@` 都被中和；不带理由时 description 和改动前逐字相同。
- **新增**（`tests/pg/session-cards.test.ts`，P2-3）：带理由取消后投递的私信含理由，收件人集合和不带理由时相同（`['a','b']`）。
- **新增**（`tests/pg/session-cards.test.ts`，P2-4，`describe('/yue, more'` 里）：按钮登记「待定」时回复含「待定」。
- 不受影响：`tests/pg/bot-commands.test.ts`（没有断言「可能」或 `/yue` 权限）、`tests/pg/dm.test.ts:569-585`（`/notify` 打开后 `dm_ok`、`notify_dm` 都是 1，`setNotifyDm` 行为相同）。

## 6. 隐私

1. **`/api/me/invitable` 只返回五个字段**：`id`、`username`、`avatar_url`、`is_participant`、`last_played_with_me_at`。SQL 只 SELECT 这些（不写 `u.*`），不 JOIN `discord_links`，**不含任何 `discord_*` 字段，也不含 `score`、段位、`is_judge`、`is_admin`、`email`**。测试断言 `Object.keys(user).sort()` 正好是这五个，并断言响应文本不含 `score`、`discord`（PG 那一跑里 `discord_links` 有数据也一样）。头 `Cache-Control: private, no-store`（`last_played_with_me_at` 是「我和谁玩过」，因人而异）。
2. **没有可达人数**（§11 第 9 条、§4.3）：`/invite` 的响应只有 `added`（插入的行数）和 `skipped`（已在局里或不存在），**不**返回、也不在任何地方推导「其中几人能收到私信」；InviteSheet 不显示谁绑了 Discord；文案只说规则（「绑了 Discord 且开着私信的人会收到」「一天最多 3 条」）。`going_preview`、`SessionPlayer`、`InvitableUser` 都不带绑定信息。
3. **私信状态只给本人**：`notify_dm`、`dm_ok` 只出现在 `GET /api/me/discord` 和 `POST /api/me/discord/notify` 的响应里，两者都按 session cookie 认人、只返回调用者自己的绑定；Discord id 仍然从不下发（`link-flow.test.ts:617` 的断言保留）。组织者、管理员都看不到别人的私信状态。
4. **改期上下文只给本人**：`prev_rsvp`、`prev_starts_at`、`invite_reason` 只出现在 `/api/me/invites`（本人的被邀请列表），不进 `SessionPlayer`、详情、列表。
5. **公开的新字段**：`going_preview`（来的人的名字和头像——名单本来就公开，不带分数）、`attendance_summary`（只有人数，详情里本来就公开每人的出勤）、`cancel_reason` 和 `cancelled_at`（和 `note` 一样随局公开：spec §3.4 的历史页本来就显示「阿杰：临时加班，改天」）。P3-3 的取消确认文案要写明「理由会写进私信，也会显示在这局的页面上」（第 8 节第 5 条）。
6. 前端渲染组织者写的理由一律当纯文本（React 转义），不做 markdown；bot 侧经 `safeLine`。

## 7. 风险

### 7.1 现有测试锁住、P2 会碰到的东西

行号指规划副本。除表中明确写「改」的两处外，原有断言一律不改，只允许在新 describe 里追加。

| 位置 | 锁住了什么 | 谁要小心、怎么处理 |
|---|---|---|
| **`tests/pg/session-cards.test.ts` 的 `it('/yue is for bound players only'`**（规划副本 `:351-360`；P2-1 在 import 区加两行后是 `:353-362`，按用例名定位） | 「/yue is for bound players only」：已绑定的非上榜 `viewer` 的 `/yue` 回复含「上榜选手」 | **P2-4 改这个用例**（§11 第 7 条的有意行为变化；spec §4.2、§10 第 13 条说「现有测试没有断言……grep 无结果」与代码不符）。新断言见第 5 节。PR 描述写明 |
| **`tests/pg/link-flow.test.ts:619`** | `Object.keys(body.link).sort()` 正好是 `['discord_username', 'linked_at']` | **P2-5 改成** `['discord_username', 'dm_ok', 'linked_at', 'notify_dm']`；同用例里「不含 Discord id」（`:617`）保留不动 |
| `tests/pg/link-flow.test.ts:652-671` | `/api/me/discord/unlink` 的 CORS 预检 | P2-5 不改 link-routes 的 CORS 中间件（`allowMethods` 已含 POST、`allowHeaders` 不变）；新路由自动被覆盖，追加一条 notify 的预检用例 |
| `tests/worker/session-update.test.ts:239`、`:249-250`、`:269`、`:383` | `SELECT *` 读回的整行 `toEqual({...before, …})`；`updateSession(…, {})` 的返回 `toEqual(session)` | 新列在 `before` 里同样存在，仍成立；`going_preview` 两次都由 `getSessionDetail` 从 players 推导，相等。P2-3、P2-6 跑这几条确认 |
| `tests/worker/session-update.test.ts:650-690` | 改期后所有人回到 `invited`、`counts`、`listMyInvites` 的 id | P2-3 只在同一条 UPDATE 里多写两列，`playerRows` 只选旧列，不受影响；上下文另在 `session-context.test.ts` 断言 |
| `tests/worker/session-update.test.ts:602-610` | 陌生人对已取消的局先拿到 403 | P2-1 的 `/invite` 照同样顺序（4.3） |
| `tests/worker/sessions.test.ts:14-15`、`:98-128`；`tests/pg/concurrency.test.ts:9`、`:330-363` | 从 `worker/sessions` 导入 `MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`；额度行为 | P2-4 在原处 re-export，值不变（`sessions.test.ts` P2 全程不改，40 例） |
| `tests/dom/discord-link.test.tsx:82`、`:194` | `DiscordLinkCard` 只发一次请求 | P2-5 不改组件，只在文件末尾追加只测 `api.ts` 的 describe |
| `tests/pg/session-cards.test.ts:13`、`:519-537`、`:606-616`、`:723-728` | 从 dispatcher 导入 `INVITES_PER_ORGANIZER`、`SESSION_DM_BUDGET`；邀请私信额度 | P2-1 在 dispatcher 原处 re-export，值不变；新用例证明后叫的人也受同一额度 |
| `tests/pg/session-cards.test.ts:185-195`、`:796-834` | 取消私信的收件人集合 | P2-3 不改触发器（3.2）；带理由时收件人相同（新用例） |
| `tests/pg/session-cards.test.ts:336-349`、`:545-566` | `/yue` 按看板时间建局（`T12:00:00.000Z`）、「已经过了」、「约局频道」 | P2-4 只换来源，算法和 15 分钟不变 |
| `server/test/session-render.test.ts:2`、`:33-41` | 从 `../src/discord/sessions` 导入 `slotIso` 并测它 | P2-4 保留 re-export；新增「同一个函数」断言 |
| `server/test/session-render.test.ts:105-109` | 每种 session 私信都含 `/?session=3` | P2-3 的理由行在 description，不碰按钮 |
| `tests/pg/import-d1.test.ts:11-37`、`:47-56` | fixture 的列、`checksums` 有 9 张表 | P2-3 **不改** `exportFixture()`（它就是「D1 还没跑 004」的导出），追加一条用例：在它的副本上加一局带四列（值非空）的数据，两种导出一次都验（P2-3「对契约的补充」第 2 条）；表数仍是 9 |
| `tests/dom/organizer-actions.test.tsx:316` | 取消只有一个 POST，`body: null` | P2-3 的 `cancelSession(id)`（不传 reason）必须不带 body；P2 不在界面上传 reason |
| `tests/dom/organizer-actions.test.tsx:356` | 普通玩家打开详情时没有任何 `role="alert"` | P2-1 的名单错误态用 `role="status"`，且只在 sheet 内；普通玩家根本不请求名单 |
| `tests/dom/organizer-actions.test.tsx:31-45`（及 `route-pages`、`back-closes-layer`、`login-return`、`session-rsvp-moved` 的 `mockFetch`） | 未路由的请求一律 500 | 组织者 / 管理员打开开局前的详情时，P2-1 会多一个 `GET /api/me/invitable`，在这些测试里得到 500 → 状态 `error` → 入口照常显示、无 alert。这些测试只断言 `writes(calls)` 或按路径计数，不受影响；P2-1 收尾时跑全量 dom 确认 |
| `tests/dom/organizer-actions.test.tsx:221`、`:251`、`:294-298` | 关 sheet 后焦点回「改时间」；取消确认里只有两个按钮、焦点落点 | 新按钮排在「改时间」前面，不进取消确认；名字是「再叫几个人」 |
| `tests/dom/session-rsvp-moved.test.tsx`、`tests/dom/login-return.test.tsx:240` | 每个面板只有一个「来」 | InviteSheet 不加 RSVP 按钮 |
| `tests/dom/app-refresh.test.tsx:145`、`:391` | 首屏 URL 集合 | P2 不改 `getSessions`，大厅不加请求；`/api/me/invitable` 只在详情里、只给管理者 |
| dom 的 `act(...)` 警告（基线 3 条） | P1 契约 6.4 | `useInvitable` 的请求在详情加载完后才发，可能在测试结束前落地。P2-1 收尾跑全量 dom，警告条数必须仍是 3；多出来就在 hook 里用 mounted 标记并在相关新测试里 `await` 到入口出现 |
| `tests/unit/quickTime.test.ts` | `quickSlots` 的行为 | P2-4 不改 `quickSlots`；新函数在新测试文件 |
| `tests/worker/setup.ts:19-37` | 按 `;` 切 `schema.sql`、去掉 `--` 注释 | P2-3 在 `schema.sql` 里只加列，注释里不写 `;`，字符串字面量里不写 `--` |
| `tests/pg/setup.ts:7-21` | 每个测试 TRUNCATE 的表清单 | P2 不加表，不用改 |
| `it.todo` `tests/worker/session-update.test.ts:414-420` | 已知 BUG：`String#slice` 按 UTF-16 截断，emoji 卡在边界会留下孤立代理 | `cancel_reason` 复用 `normalizeOptionalText`，有同样的问题；**不在 P2 修**（要连 title/game/note 一起修），P2-3 的 PR 描述点名 |

### 7.2 额度之间的相互作用

| 额度 | 值 / 出处 | P2 的影响 |
|---|---|---|
| 同时未开局的局 | `MAX_OPEN_SESSIONS = 5`（P2-4 迁到 shared） | 不变。`/yue` 放开后，更多人能组局，但每人仍受这个上限 |
| 滚动 24 小时发起数 | `MAX_SESSIONS_PER_DAY = 10`，**含已取消的** | 不变。带理由取消不退还额度 |
| 一次邀请的人数 | `MAX_INVITES = 20`（建局时、每次 `/invite`） | `/invite` 可以多次调用，所以另加名单上限 |
| 名单总人数 | `MAX_SESSION_ROSTER = 50`（新，P2-1） | 只拦邀请。玩家**自己报名**（`setRsvp` 插行）不受它限制——这是现状：自己报名的 `maybe`/`out` 本来就不限人数，点名上限 50 在那种情况下早已可能不够。P2 不改 `setRsvp`，写进风险 |
| 邀请私信（同一组织者 → 同一人） | `INVITES_PER_ORGANIZER = 3` / 24 小时（dispatcher） | 建局时的邀请和 `/invite` 的邀请一起算；超了的私信被跳过（`skipped`），对方仍能在网页「要你处理」里看到邀请。InviteSheet 文案如实说明 |
| 邀请 + 改期私信（每人） | `SESSION_DM_BUDGET = 10` / 24 小时 | 不变；`/invite` 不改它 |
| 取消私信 | 每局每人最多一条（dedupe key） | 不变；带理由不多发 |
| 改期 | 无次数上限，私信 3 分钟内合并 | 不变；P2-3 只多记上下文 |
| `/api/me/invitable` | 只读 | `MAX_INVITABLE = 500` 行上限（`worker/invitable.ts` 内部常量） |
| `/api/me/discord/notify` | 无频率限制 | 幂等 UPDATE；CSRF + 登录。和 bot `/notify` 一样会把 `dm_ok` 重置为 1：一个关了服务器私信的人连按「打开」只会让 dispatcher 多试一次、再被 50007 标回 0，不会刷屏 |

### 7.3 迁移与回滚

- **D1 `migrations/004_lobby.sql`**：四条 `ALTER TABLE … ADD COLUMN …`（可空、无默认值）。SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重跑会对每条报 `duplicate column name`——和 002、003 一样在文件头注释里写明「这是预期的，代表迁移已经做过了」。全新部署直接用 `schema.sql`（已含新列）。
- **PG `server/migrations/0007_lobby.sql`**：四条 `ADD COLUMN IF NOT EXISTS`，幂等；由 compose 的 `migrate` 服务在应用启动前跑（`compose.yaml:50-55`、`server/src/db/migrate.ts` 一个文件一个事务、advisory lock）。
- **部署顺序**：先迁移、后代码。新代码读 `cancel_reason`、`prev_rsvp` 等列；没迁移就部署代码，`cancelSession` 和改期的 UPDATE 会报列不存在。旧代码配新 schema 没问题（新列可空，`SELECT g.*` 多出来的键被 `toSessionItem` 忽略）。
- **回滚代码**：直接回退 P2-3 的 commit 即可，**不用**回退迁移（多出来的四列对旧代码无害）。
- **彻底回滚 schema**（一般不需要；会丢掉改期上下文和取消理由）：
  - D1：`ALTER TABLE session_players DROP COLUMN prev_rsvp;` 等四条（D1 的 SQLite ≥ 3.35 支持 DROP COLUMN）。
  - PG：`ALTER TABLE session_players DROP COLUMN IF EXISTS prev_rsvp;` 等四条，再 `DELETE FROM schema_migrations WHERE name = '0007_lobby.sql';`。没有触发器或函数要还原（3.2）。
- **导入**：D1 迁移了而 PG 没迁移时导入会被 preflight 拒绝（3.3）。
- **P2-4、P2-5 没有迁移**；P2-5 用的 `notify_dm`（`0002_discord.sql:12`）、`dm_ok`（`0004_dm.sql:11`）早已存在。

### 7.4 其他风险

1. **旧后端识别不了 `scope=history`**：未知 scope 被当成 `upcoming`（`worker/routes.ts:287-288`），返回 200 而不是 404，前端没法按 404 隐藏。所以 `getSessionHistory` 以「每项都有 `attendance_summary`」判断支持与否（4.5）；旧后端恰好没有未开局的局时返回 `[]`，历史页显示空状态——无害。P3-6 照这个约定用。
2. **`/api/me/invitable` 的规模**：每次全表扫一遍 `users` 加一次聚合子查询；对一个朋友群（几十人）无所谓，上限 500 行兜底。
3. **详情弹窗多一个请求**：只对组织者 / 管理员、只在开局前、每次打开一次。
4. **两套后端分叉（spec §10 第 6 条）**：P2-5 只在 Node 端；旧 Worker 上 `/api/me/discord*` 是 404，前端已有的 `getDiscordLink` 和新 `setDiscordNotify` 都在 404 时返回 `undefined`。
5. **`worker/sessions.ts` 已超 800 行**（第 0 节）：P2 的新逻辑放在 `session-invites.ts`、`session-extras.ts`、`invitable.ts`。
6. **看板时区和浏览器时区**：P2-4 只提供数据和函数，现有界面仍按浏览器时区显示、写「本地时间」（`RescheduleSheet.tsx:100`、`:149`、`organizer-actions.test.tsx:142` 锁了「（本地时间）」）。看板时区真正上屏在 P3-3（改时间）、P3-4（发起页）、P3-1（卡片）。

## 8. 对 spec 的偏离与补充（请机主过目，写进对应 PR 描述）

1. **P2 的界面只有「＋ 再叫几个人」一处**（P2-1）。spec §9 P2 表本来就只在 P2-1 写了界面；P2-3 的取消理由、P2-4 的看板时段 / 时区标签、P2-6 的头像预览、P2-5 的私信开关，界面都在 P3 / P4（P3-3、P3-4、P3-1、P4-1）。每个 P2 PR 都提供好接口、类型和 `api.ts` 函数。
2. **取消理由的输入框在 P3-3**：spec §3.5 写「P2 有 cancel_reason 之后才出现」，这里理解为依赖关系而不是放在哪个 PR；P3-3 本来就列了「取消理由」。P2-3 合并后到 P3-3 之前，网页暂时不能写理由（API 已支持）。
3. **`RescheduleSheet` 的时段 P2 不换**：组件注释「Until P2 there is no board timezone…」（`RescheduleSheet.tsx:76-77`）在 P2-4 后过时，由 P3-3 把它迁进控制台时一起换成 `boardSlots` 并改注释。理由同第 1 条，且 `organizer-actions.test.tsx:142` 锁着「（本地时间）」。
4. **`formatWhen` 的第三参只换时区、不改输出形状**：spec §5 第 9 条把整行「周五 10/30 21:00（北京时间）· 还有 2 小时」都叫 formatWhen。现有十几处调用依赖它的紧凑形状（「今天 20:00」），所以拆成三个函数（4.4）：`formatWhen(v, now, offset)` 是紧凑形状的看板版，`formatBoardDateTime` 是带时区标签的绝对时间，`formatViewerAside` 是「你那边」。P3 按需拼接。
5. **取消理由是公开的**：`SessionItem` 随局公开（spec §3.4 的历史页就是这样显示的），所以 P3-3 的确认文案建议写「理由（选填，会写进私信，也会显示在这局的页面上）」，而不只是 spec 的「会写进私信」。
6. **新增名单上限 `MAX_SESSION_ROSTER = 50`**（P2-1）：spec 只说复用 `normalizeInvites`（每次 20 人），但 `/invite` 可以反复调用，名单会无限长，而点名一次最多 50 条（`MAX_ROLLCALL_ENTRIES`，`worker/sessions.ts:48`）。50 就是点名上限，两者改为同一个常量。
7. **`import-d1` 不改代码**（3.3）：spec §8 说要带上新列，实际脚本按 `information_schema` 动态取列，只改 `tests/pg/import-d1.test.ts`。
8. **测试放的位置和 spec 列的文件名不完全一样**：
   - P2-2：spec 写 `users.test`，放在新 `tests/worker/invitable.test.ts`（`users.test.ts` 已 1015 行，且它测的是 `worker/db.ts`）。
   - P2-1：PG 的「后叫的人也收到邀请私信并受额度限制」spec 写 `tests/pg/dm.test.ts`；P2-3 的「取消理由私信」spec 写 `tests/pg/outbox.test.ts`。两者都放在 `tests/pg/session-cards.test.ts`：现有的约局私信用例、`fakeDiscord`/`bind`/`cast`/`dispatcher` 辅助都在那里，`dm.test.ts` 和 `outbox.test.ts` 测的是案件。
   - P2-3：spec 写 `session-update.test.ts`、`sessions.test.ts`；改期上下文和取消理由放新 `tests/worker/session-context.test.ts`，历史放新 `tests/worker/session-history.test.ts`（前者已 1134 行、后者 792 行）。`session-update.test.ts` 的现有用例原样通过（7.1）。
   - P2-6：契约原稿写「追加 `sessions.test.ts`（新 describe `going_preview`）」；实际放在新 `tests/worker/going-preview.test.ts`（理由同 P2-3：`sessions.test.ts` 792 行，加上约 200 行会超过 800）。
   - HTTP 层的用例集中在新 `tests/worker/session-routes.test.ts`。
9. **`last_played_with_me_at` 的口径**（spec 只写「按 session_players 聚合」）：已开局（`starts_at <= 现在`）且没取消的局里，双方都是 `rsvp = 'going'`，且双方都没被点成 `no_show`、`excused`（`attendance` 为 NULL 视为到了：很多局不点名）。取这些局 `starts_at` 的最大值。
10. **`/api/me/invitable` 的排序**：一起玩过的在前（越近越前），然后在榜的在前，再按名字、id。P2 的 InviteSheet 按「在榜的 / 其他朋友」分两组、组内保持这个顺序；P3-3 的「上次一起玩的」分组也用这个字段。
11. **`scope=history` 的分页**：固定每页 `SESSION_HISTORY_PAGE = 20` 条，`before=<id>` 是上一页最后一项的 id；按 `starts_at DESC, id DESC`，游标展开成 `starts_at < c.starts_at OR (starts_at = c.starts_at AND id < c.id)`。游标 id 不存在时返回空列表（不是 400）。前端以「返回条数 < 20」判断没有下一页。路由仍不读 `limit`，`scope=past` 不变。
12. **`/invite` 的空列表和「只剩组织者」**：空数组 400「至少选一个人」；去掉组织者后不剩人时 200 `{added: 0, skipped: 0}`。`normalizeInvites` 加了 `field` 参数，`/invite` 的错误文案说 `user_ids`。
13. **`POST /api/me/discord/notify` 的响应和错误**：返回最新的 `link`（不是 `{ ok: true }`），没绑定时 409「还没有绑定 Discord」（不用 404，因为 404 被前端读作「后端不支持」）。
14. **`INVITES_PER_ORGANIZER` 迁到 `shared/attendance.ts`**（spec 的常量迁移表没列）：InviteSheet 的文案要说「一天最多 3 条」，不能在前端写死。dispatcher 原处 re-export，值不变。

以下第 15～22 条是各计划「对契约的补充」里需要机主过目的部分，定稿时并进来（原文和理由见对应计划）：

15. **测试数都比本契约原稿估得多**（第 9 节已换成实测）：P2-2 `invitable` 16 例（10 个排除条件各一例）、P2-1 dom 18 例、P2-6 7 例、P2-3 worker 20 例、P2-4 `board-time` 33 例（三个进程时区各跑一遍）。
16. **新增了契约原稿里 dom 一栏是「—」的测试**：P2-3 的 `tests/dom/session-api.test.tsx`（5 例：`cancelSession` 不传 reason 就不带 body、`getSessionHistory` 的 URL 与旧后端返回 `undefined`、`getMyInvites` 透传上下文）；P2-5 在 `tests/dom/discord-link.test.tsx` 末尾加 3 例（`setDiscordNotify` 的请求体、404、409）。都只测 `api.ts`、不渲染组件，不影响 `act(...)` 警告数。P2-2 的 `getInvitable` 不单测，由 P2-1 的 `invite-sheet.test.tsx`（404 降级、500 错误态）经 `useInvitable` 覆盖。
17. **`toSessionItem` 对 `cancel_reason`、`cancelled_at` 用 `?? null` 兜底**（P2-3）：代码先于迁移上线时读接口仍返回 `null`；写接口照样会报列不存在，所以「先迁移、后代码」仍然必须。
18. **`/invite` 的名单上限检查把不存在的 id 也算进「还不在局里的人数」**（P2-1）：只在离 50 人只差几个时有影响，最坏是一个打错的 id 让请求被拒；省一次 `users` 查询。并发路径（检查后、写入前被别人加满）没有确定性用例，由每条 INSERT 的 SQL 守卫保证。
19. **P2-4 多改了 `docs/DEPLOY-DISCORD.md` 的 `:187`、`:188` 两处「可能」**（「约局改了时间」「约局取消」的收件人描述），`:191` 另补一句时段和 15 分钟的说明；`docs/CONTRACT.md` 的 `/api/config` 条目多写两行（单位是小时、可以是小数）。
20. **`boardTzLabel` 对 +8 以外一律写数字**（0 写 `UTC`、`UTC+5:30`、`UTC+5:45`）；`formatViewerAside` 按「那一刻」的浏览器 offset 比较（夏令时有用例）；`src/lib/time.ts` 内部多了私有的 `WallClock`/`wallClock`/`clockTime`/`WEEKDAYS`，不传 offset 的分支逐行等价于原实现（P2-4）。
21. **P2-5 的 `handleNotify` 改成先写后判**（`setNotifyDm` 读回 null 就回 `NOT_LINKED`，少一次查询；回复文案一字不改），GET 和 POST 共用只挑四个字段的 `linkView`；`DEPLOY-DISCORD.md:20` 写明「网页上的按钮随 `/me/notify` 页上线」，免得读者去找还不存在的按钮。
22. **界面仍然只有「＋ 再叫几个人」**：P2-4 的任务说明曾提到把 `RescheduleSheet` 换成看板时段、P2-5 的任务说明曾提到在 `DiscordLinkCard` 里放私信开关，两份计划都按本契约第 2、3 节和第 8 节第 1、3 条**没有做**（理由：P3-3 / P4-1 本来就要迁这两处，`organizer-actions.test.tsx:142` 锁着「（本地时间）」，`discord-link.test.tsx` 锁着请求数）。机主要提前做，需要先改本契约再加 Task。

## 9. 各 PR 的验收要点与新增的测试

数字是跨 PR 合成副本上的实测（第 1.1 节），各计划的 Task 0 和「收尾」用的就是这些数。PG 套件包含 `tests/worker/**`，所以 worker 的增量在 pg 里再算一遍。

| PR | unit | dom | server | worker（D1） | pg 专属 | 要点 |
|---|---|---|---|---|---|---|
| P2-2 | — | — | — | 新 `invitable.test.ts`（16）、新 `session-routes.test.ts`（3） | — | 五个键、无分数无 discord、显示名、不含自己、非上榜也在、`last_played_with_me_at` 口径（第 8 节第 9 条的每个排除条件一例）、排序；HTTP 401、`private, no-store`、READ_ONLY 时照常可读 |
| P2-1 | 新 `invite-picker.test.ts`（8） | 新 `invite-sheet.test.tsx`（18） | — | `invites.test.ts` 新 describe（9）、`session-routes` +4 | `session-cards` 新 describe（3） | 4.3 表里每一行；已有的行（含 out）不变；未知 id 计入 skipped；管理员可以；名单上限；被叫的人出现在他的 `/api/me/invites`。dom：组织者看到「再叫几个人」；**404 时入口不存在（降级测试）**；普通玩家、访客、已开局、已取消都不发名单请求；分组、置灰和「已在局里」「说了不来」；满 20 禁用；提交体正好 `{ user_ids: [...] }`；成功 toast 原文；失败 alert 只在 sheet 里；返回键关 sheet。PG：后叫的人收到一条 `dm.session.invited`、再叫一次不再发、说了不来的不再发、超过 `INVITES_PER_ORGANIZER` 被跳过 |
| P2-6 | — | — | — | 新 `going-preview.test.ts`（7）、`session-routes` +1 | — | 最多 5 个、按 `rsvp_at`（同秒按 id）、只有 `id/username/avatar_url`；`maybe`/`invited`/`out` 不在里面；列表、详情、`/api/me/invites`（另含 `mine`、`past`）一致；没人来时是 `[]`；一页一条查询（N+1 回归锁）；公开列表的响应文本不含 `score` |
| P2-3 | — | 新 `session-api.test.tsx`（5） | `session-render` +2 | 新 `session-context.test.ts`（10）、新 `session-history.test.ts`（6）、`session-routes` +4 | `session-cards` +2、`import-d1` +1 | 改期写 `prev_*`、`invited` 的行不动、组织者不动、连改两次保留第一次、`setRsvp` 清空、`invite_reason` new/moved、上下文只给本人；取消理由 trim/截断/空白为 null/非字符串为 null/无 body 为 null、`cancelled_at` 是 sqlite 形状、再取消不覆盖；history 含已取消、不含未开局、`attendance_summary` 五键含 0、游标翻页含同一时刻的并列、未知游标返回空、`scope=past` 不变；HTTP：无 body 的取消 200、`before=abc` 400、history 公开；前端 `cancelSession` 不传 reason 不带 body、`getSessionHistory` 旧后端返回 `undefined`；PG：带理由的取消私信、收件人不变、导入新列 |
| P2-4 | 新 `board-time.test.ts`（33）、`source-hygiene` +1 | — | `session-render` +3 | `session-routes` +1 | `session-cards` 改 1、+1 | `boardSlots` 的五个时段、过滤、跨日期线（三个进程时区各跑一遍）；`slotIso` 与原测试一致；`boardTzLabel` 各种 offset；`formatWhen` 不传第三参时输出不变（Asia/Shanghai、UTC、America/Los_Angeles 各一组）、传了时按看板时钟；`formatBoardDateTime`；`formatViewerAside` 同区为 null、异区、跨日、夏令时；`DEFAULT_DURATION_MIN` 等于 `0005_sessions.sql` 的 `COALESCE(s.duration_min, 120)`；`/api/config` 的 `boardTzOffsetHours`（默认 8、`'0'`、`'5.5'`、非法值 8）；bot 标签与 `/yue` 权限 |
| P2-5 | — | `discord-link` +3 | — | — | `link-flow` +8（新 describe 2 + 6）、改 `:619` | GET 多两个布尔；POST 打开 / 关闭写库且 `dm_ok` 回到 1；401、409、400（八种 body）、403（外站 `text/plain`）、503（READ_ONLY）；预检；响应不含 Discord id；只改自己的绑定；不写 `link_audit`；bot `/notify` 三句回复原文不变；前端 `setDiscordNotify` 请求体、404 → `undefined`、409 抛错 |

每个 PR 收尾：`npm run typecheck`、`npm run test:unit`、`npm run test:dom`（`act` 警告仍是 3 条）、`npm run test:server`、`npm run test:worker`、`npm run test:pg`（遇到第 1 节说的 adapter 超时就单独重跑那个文件）、`npm run build`。

## 10. 附：DDL 与关键 SQL

### 10.1 D1：`migrations/004_lobby.sql`（P2-3）

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

`schema.sql`：`game_sessions` 在 `settled_by TEXT,` 之后、`created_at` 之前加

```sql
  cancel_reason TEXT,                              -- 取消理由（可空，≤80 字）
  cancelled_at  TEXT,                              -- 取消时间，datetime('now') 形状
```

`session_players` 在 `record_id INTEGER,` 之后加

```sql
  prev_rsvp       TEXT,                            -- 改期前的回答（going | maybe | out），重新回答时清空
  prev_starts_at  TEXT,                            -- 改期前的开始时间（ISO），同上
```

（schema.sql 里列的位置和迁移后的物理顺序不同无妨：代码一律按列名读写。）

`package.json` 在 `db:migrate3:remote` 之后加：

```json
"db:migrate4:local": "wrangler d1 execute edg-credit --local --file=./migrations/004_lobby.sql",
"db:migrate4:remote": "wrangler d1 execute edg-credit --remote --file=./migrations/004_lobby.sql",
```

### 10.2 PG：`server/migrations/0007_lobby.sql`（P2-3）

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

### 10.3 P2-3 的写入

`updateSession` 的重置（锚点 `:463-467`，只改 SET 和 bind）：

```sql
UPDATE session_players
   SET rsvp = 'invited', rsvp_at = datetime('now'), prev_rsvp = rsvp, prev_starts_at = ?
 WHERE session_id = ? AND user_id <> ? AND rsvp IN ('going', 'maybe', 'out')
-- bind(row.starts_at /* the time they answered — as stored */, id, row.organizer_id)
```

`WHERE … rsvp IN ('going','maybe','out')` 本来就把还是 `invited` 的行排除在外，所以连续改期时，还没重新回答的人保留的是**他当时回答的那个时间**（spec §8 B2-3 ①），不需要 CASE。

`setRsvp` 的 upsert（锚点 `:567-568`）：

```sql
ON CONFLICT(session_id, user_id) DO UPDATE SET
  rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at, prev_rsvp = NULL, prev_starts_at = NULL
```

（新插入的行两列本来就是 NULL。）

`cancelSession`：见 4.3。

### 10.4 批量读（`worker/session-extras.ts`）

```ts
// P2-6
function holes(count: number): string;   // 私有：`?, ?, …`，P2-3 的两个函数也用它
export async function goingPreviews(db: D1Database, sessionIds: readonly number[]): Promise<Map<number, RecordActor[]>>;
//   SELECT sp.session_id, sp.user_id, COALESCE(u.display_name, u.username) AS username, u.avatar_url
//     FROM session_players sp JOIN users u ON u.id = sp.user_id
//    WHERE sp.rsvp = 'going' AND sp.session_id IN (?, …)
//    ORDER BY sp.session_id ASC, sp.rsvp_at ASC, sp.user_id ASC
//   → 每个 session 在 JS 里截前 GOING_PREVIEW_MAX 个。空 id 列表直接返回空 Map，不查库。
//   getSessionDetail 不调用它：从已查出的 players 里 filter going、按 rsvp_at、user_id 排序、截 5（同一顺序）。
export function previewOfPlayers(players: readonly SessionPlayer[]): RecordActor[];   // 上面那段推导，纯函数，P2-6 定名

// P2-3
export async function attendanceSummaries(db: D1Database, sessionIds: number[]): Promise<Map<number, AttendanceSummary>>;
//   SELECT session_id, attendance, COUNT(*) AS n FROM session_players
//    WHERE session_id IN (?, …) AND attendance IS NOT NULL GROUP BY session_id, attendance
//   → 每个 id 都有五个键，没有的为 0。

export interface InviteContext { prev_rsvp: SelfRsvp | null; prev_starts_at: string | null }
export async function inviteContexts(db: D1Database, callerId: string, sessionIds: number[]):
  Promise<Map<number, InviteContext>>;    // 不是 going/maybe/out 的 prev_rsvp 读成 null（isSelfRsvp）
export const NO_ATTENDANCE: Readonly<AttendanceSummary>;   // 冻结的全零，listSessionHistory 兜底用
//   SELECT session_id, prev_rsvp, prev_starts_at FROM session_players WHERE user_id = ? AND session_id IN (?, …)
```

`listSessionHistory(db, callerId, before: number | null): Promise<HistorySessionItem[]>`（`worker/sessions.ts`，P2-3）：

```sql
-- 有 before 时先：SELECT id, starts_at FROM game_sessions WHERE id = ?   （没有 → 返回 []）
${SESSION_SELECT}
 WHERE g.starts_at < ?                                             -- new Date().toISOString()
   AND (g.starts_at < ? OR (g.starts_at = ? AND g.id < ?))         -- 只在有游标时拼上
 ORDER BY g.starts_at DESC, g.id DESC
 LIMIT ?                                                           -- SESSION_HISTORY_PAGE
```

然后和 `listSessions` 一样补 `myRsvpMap`、`goingPreviews`，再补 `attendanceSummaries`。路由：`scope === 'history'` 时 `before` 有值就 `parseId(before, '约局')`，调用 `listSessionHistory(c.env.DB, caller?.id ?? null, before)`；其他 scope 走原来的 `listSessions`，忽略 `before`。

### 10.5 `listInvitable`（`worker/invitable.ts`，P2-2）

```sql
SELECT u.id, COALESCE(u.display_name, u.username) AS username, u.avatar_url, u.is_participant,
       lp.at AS last_played_with_me_at
  FROM users u
  LEFT JOIN (
        SELECT them.user_id AS user_id, MAX(g.starts_at) AS at
          FROM session_players me
          JOIN game_sessions g    ON g.id = me.session_id
          JOIN session_players them ON them.session_id = me.session_id AND them.user_id <> me.user_id
         WHERE me.user_id = ?
           AND g.status <> 'cancelled' AND g.starts_at <= ?               -- new Date().toISOString()
           AND me.rsvp = 'going' AND them.rsvp = 'going'
           AND (me.attendance IS NULL OR me.attendance NOT IN ('no_show', 'excused'))
           AND (them.attendance IS NULL OR them.attendance NOT IN ('no_show', 'excused'))
         GROUP BY them.user_id
       ) lp ON lp.user_id = u.id
 WHERE u.id <> ?
 ORDER BY CASE WHEN lp.at IS NULL THEN 1 ELSE 0 END, lp.at DESC,
          u.is_participant DESC, COALESCE(u.display_name, u.username) ASC, u.id ASC
 LIMIT ?                                                                   -- MAX_INVITABLE = 500
-- bind(callerId, nowIso, callerId, MAX_INVITABLE)
```

映射：`is_participant: row.is_participant === 1`，其余原样；**只输出这五个键**。
