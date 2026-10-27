# S1 实施计划 · 约局下线（一个 PR）

> v6 第 1 期。方案：[spec.md](spec.md)，主要依据 §2 第 1 条和 §3.3、§3.5、§4、§7。
> 本期几乎全是删除，新代码只有：旧地址的落地、旧报名按钮的回复、一个 PG 迁移。
> 行号只作提示，定位以锚点文字为准。本文没写到的细节以 spec 为准。

## 1. 目标

把约局从网页、机器人、接口里全部拿掉，同时做到下面几点：

- **旧链接不报错：**
  - `/sessions/*` 显示「约局功能已下线」页；
  - `?session=N` 落到首页，并提示「约局功能已下线」。
- **旧按钮有回应：** 约局卡片和私信上的报名按钮回复「约局功能已下线，这个按钮不再有效。」，只有按的人能看到。
- **旧卡片自动消失：** 迁移给每张已发出的约局卡片排一条 `session.removed`，由机器人删除。
- **历史还在：**
  - 约局的表和数据不动；
  - 旧案件页里来自约局的上下文照常显示（`worker/cases.ts` 对 `game_sessions` 的只读查询保留）；
  - 旧周报照常显示。
- **首页和导航变简单：** 首页按 spec §3.3 的顺序排列；去掉「组一局」；底部标签只剩「首页·N」「信誉榜」「我的」。

**不在 S1：**
- 入户向导和入户卡（S2）。S1 先保留现有的「未绑定」「私信不通」待办卡和 `OnboardingDialog`。
- `/admin`（S3、S5）。

## 2. 开工前

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git status --short            # 必须为空
git fetch origin
git switch -c claude/s1-sessions-off origin/main
npm ci
```

先在 main 上跑一遍第 4 节的全部命令，记下每个套件的通过数，写进 PR 描述作为基线。2026-10-27 在 `69fa743` 上的结果见 [HANDOFF.md](HANDOFF.md#基线)。任何一项本来就不过，先停下查原因。

**删除的规矩：** 每删一个文件，先用 `grep -rn "<文件名>" src worker server/src shared tests` 确认已经没有剩余引用。还有引用的，按本计划改掉引用处，不要为了保留它去补兼容代码。

## 3. 步骤

每一步：先改测试（删除整块失效的测试、为新行为补测试）→ 实现 → 本步相关测试通过 → commit。commit 用 `<type>: <中文描述>（S1）`。

### 第 1 步 · 接口与 worker 模块

1. `worker/routes.ts`：删除下列路由。删除后这些地址统一返回现有的 404。
   - `GET /api/sessions`、`GET /api/sessions/:id`、`POST /api/sessions`、`PATCH /api/sessions/:id`；
   - `POST /api/sessions/:id/cancel`、`/invite`、`/rsvp`、`/rollcall`、`/settle`；
   - `GET /api/me/invites`、`GET /api/me/invitable`。
2. 删除 `worker/sessions.ts`、`worker/session-invites.ts`、`worker/session-extras.ts`、`worker/invitable.ts`。
   - 如果机器人和 `worker/cases.ts` 仍需要某个只读函数（例如按 id 读一个约局），把它挪进 `worker/cases.ts` 或新的小文件 `worker/session-reads.ts`，只保留读。
3. `shared/attendance.ts`：只留剩余代码还在用的部分，至少有 `isAllowedTypeOverride`（`worker/case-filing.ts` 在用），以及 `worker/types.ts` 描述历史数据用到的类型。其余常量、函数（报名、名额、邀请、点名、结算、组局奖励门槛等）一并删除。
4. 删除 `shared/quickTime.ts`。如果 `boardTzLabel` 之类还有非约局的使用者，把它挪到 `shared/` 下一个合适的位置，不要整份保留。
5. `worker/types.ts`、`worker/index.ts`、`/api/config`：删掉只为约局服务的字段和任务。`/api/config` 的返回如果有约局字段，就删掉，并同步改 `src/types.ts`。
   - `worker/case-filing.ts` 的 `FileCaseOptions.skipJudgeCheck`、`skipRateLimit` 原本只给结算用。没有调用方以后就删掉，`fileCase` 和 `fileCases` 里对应的分支也一起删掉。
   - 加分类型不能再手动立案：`POST /api/records` 带明确 `type` 时（`routes.ts` 里「+ `type` (deterministic …)」那一段），`kind === 'bonus'` 的类型返回 400「加分类型已停用」。
6. **测试：**
   - 删除 `tests/worker/` 下的：`sessions`、`session-update`、`session-history`、`session-routes`、`session-context`、`invites`、`invitable`、`going-preview`（8 个文件）。
   - `tests/worker/http-guards.test.ts`、`tests/worker/admin-users.test.ts` 里涉及约局的用例删掉，其余保留。
   - 删除 `tests/unit/quickTime.test.ts`；`tests/unit/attendance.test.ts` 只留剩余函数的用例。
   - **新增**一条 worker 用例：`GET /api/sessions` 和 `POST /api/sessions/1/rsvp` 返回 404。
   - **新增**一条 worker 用例：裁判 `POST /api/records { subject_id, type: 'on_time_bonus' }` 返回 400。

### 第 2 步 · 迁移与机器人

1. **新增 `server/migrations/0008_sessions_off.sql`**，按顺序做：
   - 删除约局触发器和它们的函数：`sessions_outbox`、`session_players_outbox`、`sessions_outbox_removed`、`session_players_knows`，以及只被它们用到的 `outbox_session_card`、`outbox_session_reminders`。函数用 `DROP … IF EXISTS`。
   - 删除还在排队的约局事件：`DELETE FROM outbox WHERE processed_at IS NULL AND (entity = 'session' OR kind LIKE 'dm.session.%')`。
   - 为每张已发出的约局卡片排一条删除事件：从 `discord_messages WHERE entity = 'session' AND purpose = 'card'` 选出卡片，用 `outbox_emit('session.removed', 'session', entity_id, 'session:' || entity_id || ':removed:s1', jsonb_build_object('channel_id', channel_id, 'message_id', message_id), now())` 逐张排队。payload 的形状和 `removeMessage` 读的一致（见 `server/src/outbox/dispatcher.ts` 的 `removeMessage`）。
   - 不删表，不删数据，不改 CHECK 约束。
   - D1 不需要迁移。
2. **`server/src/outbox/dispatcher.ts`：**
   - 删除 `session.card`、`session.starting` 和全部 `dm.session.*` 的处理，以及 `SESSION_DM_BUDGET`、`INVITES_PER_ORGANIZER`、`invitesFrom`、`deliverSessionDm` 等只为约局服务的代码。
   - `entity = 'session'` 的事件只剩 `session.removed`，交给 `removeMessage(row, 'session', 'card')`；其他 kind 一律 `skipped`，备注写「sessions are off」。
   - `entity = 'user'` 且 kind 以 `dm.session.` 开头的事件，同样直接 `skipped`。部署过程中旧 bot 可能还会写入这类事件，不能让它们落进 `unhandled`，空等 24 小时。
   - 403 提示里不再提 `DISCORD_SESSION_CHANNEL_ID`。
3. **`server/src/discord/`：**
   - `commands.ts`：
     - 删除 `/yue` 和 `YUE_SLOTS`；
     - `/todo` 的描述改为「我的待办：待写陈述（管理员还有待复核的申诉）」；
     - `/notify` 的描述去掉「约局时」；
     - `/score`、`/todo` 不再调用 `listMyInvites`，回复里也不再有邀请。
   - `sessions.ts`：删除。
   - `v1:rsvp:` 前缀的按钮改由一个小处理函数接管，回复「约局功能已下线，这个按钮不再有效。」，ephemeral。
   - `render.ts`、`dm.ts`：删掉约局卡片和约局私信的渲染。
4. **`server/src/discord/client.ts`：** `readBotConfig` 不再读 `DISCORD_SESSION_CHANNEL_ID`，`BotConfig`、`DispatcherConfig` 里的 `sessionChannelId` 也一起删除。这个变量如果还设着，忽略就行，不报错。`compose.yaml` 里 bot 服务的 `DISCORD_SESSION_CHANNEL_ID` 那一行（连同它的注释）也删掉。
5. **测试：**
   - 删除 `tests/pg/session-cards.test.ts`、`server/test/session-render.test.ts`。
   - `tests/pg/bot-commands.test.ts`、`tests/pg/concurrency.test.ts`、`tests/pg/p8-edges.test.ts`、`server/test/bot-client.test.ts` 里的约局用例删掉。
   - **新增（pg）：**
     - 迁移后，往 `game_sessions` / `session_players` 写数据不再产生任何 outbox 行；
     - 迁移前排队的 `dm.session.starting` 被删除；
     - 已发卡片的 `session.removed` 被排上，dispatcher 处理时调用 `api.remove`，并删除 `discord_messages` 里对应的行。
   - **新增（pg 或 server）：** `v1:rsvp:5:going:0` 得到「约局功能已下线，这个按钮不再有效。」；命令表里没有 `yue`。

### 第 3 步 · 周报

1. `worker/report.ts`：新生成的周报不再查询 `game_sessions` / `session_players`。删除 `sessionsPlayed`、`sessionsCollapsed`、`upcomingNextWeek`，以及组局人、出勤这几项统计，也就是 `firstRow<{ played: number }>` 附近和后面几段查询；`hadActivity` 不再看约局。
   - `worker/ai/report.ts` 也要一起改：
     - `ReportStats` 删掉这些字段；
     - `fallbackNarrative` 不再写「这周开了 N 局」或「这周没有已结算的约局。」；
     - `buildReportMessage` 不再把「已结算约局数」「下周已约局数」等行发给 AI；
     - `DEFAULT_REPORT_PROMPT` 里的「开黑约局」改为「开黑」。
   - 管理员在 AI 设置里自己改过的周报提示词不动。
2. 前端 `WeeklyReportCard`、机器人 `server/src/discord/report.ts`：旧周报 JSON 里可能还有这些字段。字段缺失或为 0 时，对应那一行不显示，其余照常。
3. **测试：**
   - worker：新周报的统计里没有约局字段；
   - dom：带 `sessionsPlayed: 3` 的旧周报照常渲染，没有这个字段的新周报不出现「开局」字样；
   - `server/test/report-render.test.ts` 同理。

### 第 4 步 · 网页路由与旧地址

1. `src/lib/routes.ts`：
   - 删除 `session`、`sessionNew`、`sessionHistory`、`rollcall`，以及 `SESSION_HISTORY_PATH`、`SESSION_NEW_PATH`；
   - **新增** `{ name: 'sessionGone' }`：`/sessions` 和它下面的任意路径都匹配到这里。
2. `RouteView.tsx`：`sessionGone` 渲染 `NotFound` 的一个变体。标题「约局功能已下线」，正文「约人直接在 Discord 里喊；迟到、放鸽子由裁判记录。」，按钮「回首页」。文案放进 `src/lib/routeCopy.ts`（新增 `SESSIONS_OFF`），删掉 `SESSION_NOT_FOUND`、`SEE_HISTORY`。
3. `src/lib/deepLink.ts`、`src/lib/useEntryTarget.ts`：`?session=N` 不再跳转，改为留在首页，用现有 Toast 提示「约局功能已下线」，并把参数从地址栏去掉（replace）。
4. **登录回跳**（`loginReturn.ts`、`loginReturnShape.ts`、`useLoginResume.ts`）：
   - 删除 `LoginIntent` 和 `intent`，只保留回到原地址；
   - 旧版本存下的带 `intent` 的值，照常解析出地址，`intent` 忽略；
   - 存下的地址如果在 `/sessions` 下，回首页。
   - `LoginLink` 去掉 `intent` prop。
5. **测试：**
   - unit `route`：`/sessions`、`/sessions/5`、`/sessions/new`、`/sessions/history`、`/sessions/5/rollcall`、`/sessions/x/y` 都解析成 `sessionGone`；
   - unit `deep-link`：`?session=5` 不再产生 session 目标；
   - unit/dom `login-return`：删掉报名意图相关的用例，新增「带 intent 的旧值仍能回跳」「`/sessions/5` 回首页」；
   - dom `deep-link`：`?session=5` 落首页，出现 Toast，地址栏不再有 `session`。

### 第 5 步 · 首页、导航、待办

1. `App.tsx`：
   - 去掉 `useLobbySessions`、`useRsvpAnswer`、`created` 状态、`sessionsKey` 和约局待办来源；
   - 首页 DOM 顺序改为：待办（已登录）/ 欢迎卡（未登录）→ `MyScoreLine` → `BoardMini` → 最近案件 → `WeeklyReportCard`（compact）；
   - 桌面两栏：左栏是待办 / 欢迎卡和最近案件，右栏是分数、`BoardMini`、战报。
   - `.app__lobby*` 类名可以保留，也可以改名，但 CSS 要同步删掉不再用到的部分。
2. **最近案件：** 复用 `RecordsFeed`（`App.tsx` 现在没有引用它，需要新引入），用它现有的 `previewCount={5}`，自带的「看更多」按钮照常保留。在 `App.tsx` 里，它的下方加「全部动态」链接（`Link` 到 `/board/feed`）。区块标题用「最近案件」。不另写组件，也不给 `RecordsFeed` 加新 prop。
3. **`Header`、`BottomTabs`：**
   - 删除 `HeaderCreate`（组一局）和「＋ 组一局」标签，以及对 `sessionNew` / `rollcall` 的隐藏逻辑；
   - 「大厅」改为「首页」；
   - 底部标签改为「首页·N」「信誉榜」「我的」。
4. **待办**（`TodoInbox`、`TodoCard`、`src/lib/todo.ts`、`src/lib/todoMarks.ts`）：
   - 删除 `InvitationCard`、`SessionTodo`、`SessionTodoKind`、`sessionTodos`、`handledSessionIds`、`seenCancelled`，以及 `onSession` 过滤；
   - 保留写说明、升级、申诉、未绑定、私信不通这几类；
   - `src/lib/constants.ts` 里 `TODO_RANKS` 的约局键一起删除。
5. **`coreData` / `useCoreData` / `src/api.ts` / `src/types.ts`：**
   - 删除 `invites`、`getMyInvites`；
   - 删除全部约局接口函数（`getSessions`、`getSession`、`createSession`、`updateSession`、`cancelSession`、`setRsvp`、`rollCall`、`settleSession`、`getSessionHistory`、`getInvitable`、`inviteToSession`）以及 `emitSession` 的引用；
   - 删除约局类型，大约 150 行。
6. **测试：**
   - dom `home-nav`、`route-pages`、`back-closes-layer`、`todo-inbox`、`app-refresh`、`board`、`board-pages`、`p8-app`、`discord-link`、`confirm-inline`、`toast`、`drafts`：只删约局用例。
   - **新增（dom）：**
     - 首页（已登录、未登录各一）按上面的顺序渲染；
     - 没有「组一局」；
     - 底部恰好三个标签；
     - 最近案件一开始显示 5 条，并且有「全部动态」链接。

### 第 6 步 · 删除约局组件、模块和文案

1. **删除组件**（连同同名 CSS）：
   - `CreatedCard`、`InviteSheet`、`NewSessionRoute`、`OrganizerConsole`、`PeoplePicker`、`RecentSessions`、`RescheduleSheet`；
   - `ResumeHint`、`RollCallDialog`、`RollCallFlow`、`RollCallPage`、`RosterGroups`、`RsvpControl`；
   - `SessionCard`、`SessionDetailDialog`、`SessionFormDialog`、`SessionHistoryPage`、`SessionsPanel`、`ShareActions`、`VisitorRsvpPrompt`。
2. **删除 `src/lib/` 模块：**
   - `download`、`ics`、`share`、`invitePicker`、`useInvitable`、`lobbySessions`、`useLobbySessions`；
   - `sessionActions`、`sessionAgain`、`sessionConsole`、`sessionSummary`、`sessionEvents`、`useRsvpAnswer`、`useUndo`。
   - 删除前确认 `useUndo`、`share`、`download` 没有非约局的使用者；有的话，只删约局部分。
3. **改：**
   - `src/lib/time.ts`：删掉只被约局用的函数（`formatDateTime`、`formatBoardDateTime`、`formatViewerAside`、`toDateTimeLocalValue`、`dayStartOn`、`weekStartOn`、`clockOn`、`toBoardInputValue`、`parseBoardInputValue`）。删前逐个 grep 确认。
   - `src/lib/draftShapes.ts`、`src/lib/drafts.ts`：删除 `rollcall`、`session` 两种草稿。localStorage 里残留的旧草稿读到时忽略，不报错。
   - `src/components/icons/index.tsx`：删除只给约局用的图标。
   - `src/lib/constants.ts`：删除 P0-6、P3-1、P3-3、P3-4 引入的约局常量。
4. **规则文案：**
   - `RulesGuide`：删除「约局」卡片和「点名结算」相关文案。
   - `RulesPanel`：违规表只列 `kind === 'penalty'` 的类型。
   - 加一句「迟到、放鸽子由裁判记一笔。」。语音记录在 S3 才上线，所以 S3 再补「机器人会记录语音进出时间作为参考」。
5. **测试：**
   - 删除 `tests/dom/` 下的：`invite-sheet`、`lobby-cards`、`new-session-page`、`organizer-actions`、`organizer-console`、`rollcall-page`、`session-history-page`、`session-rsvp-moved`、`session-api`（9 个文件）。
   - 删除 `tests/unit/` 下的：`session-actions`、`session-again`、`session-console`、`session-summary`、`lobby-sessions`、`invite-picker`、`ics`（7 个文件）。
   - `tests/unit/` 下的 `todo`、`draft-shapes`、`board-time`、`source-hygiene` 只删约局部分。
   - **新增（dom）：** 规则页不出现「约局」「点名」「守约守时」「组局召集」。
   - **新增（unit）：** 残留的 `rollcall` 草稿不会导致读取报错。

### 第 7 步 · 文档

- **`docs/CONTRACT.md`：**
  - 删除约局接口、`worker/sessions.ts` 等模块行；
  - `Worker modules` 表与第 1 步的结果一致；
  - 写明 `/sessions/*` 是「约局功能已下线」落地页，`?session` 落到首页并提示。
- **`docs/DEPLOY-DISCORD.md`：** 删除 §7 约局卡片与私信、`DISCORD_SESSION_CHANNEL_ID` 和 `/yue`；命令表与 spec §4.1 中 S1 的状态一致。
- **`README.md`：** 去掉约局功能介绍（如果有）。

## 4. 验证

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

全部通过。另外检查两件事：

- `grep -rn "sessions/new\|rollcall\|组一局\|约一局\|/yue\|约局\|开局" src server/src worker shared` 的结果应该只剩：迁移文件、「约局功能已下线」的文案和测试、`v1:rsvp` 的旧按钮回复、读历史数据用的类型和注释。其余命中逐条处理，PR 描述里列出保留下来的每一处。
- **数量：** PR 描述里写出各套件删除前后的测试数，并说明减少的数量与删除的文件对得上。

## 5. 需要机主过目

1. 「约局功能已下线」页的正文和旧按钮的回复文案。
2. 首页顺序，以及底部只剩三个标签。
3. 旧约局卡片会在部署后被机器人删除。如果想留在频道里当历史，合并前告诉实现方，把迁移里排 `session.removed` 的那一段去掉。

## 6. 部署

- 合并后要在 Coolify 里 Redeploy。compose 的 `migrate` 服务会执行 `0008_sessions_off.sql`，日志里应该能看到 `applied 1 (0008_sessions_off.sql)`。
- 部署前先备份数据库。
- `DISCORD_SESSION_CHANNEL_ID` 可以从环境变量里删掉。旧约局频道可以留着，也可以改作 S4 的信息板频道。

## 7. PR

- 分支：`claude/s1-sessions-off`
- 标题：`feat: 约局下线，网页只留榜单与案件（S1）`
- 描述按第 3 节的 7 步分节，写清每步删了什么、偏离了什么，并附上测试数对照。commit 和 PR 描述都不加署名行。
