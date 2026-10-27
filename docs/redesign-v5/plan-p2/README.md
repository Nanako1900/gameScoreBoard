# P2 实施计划（前端重设计 v5 · ★ 邀请后端）

## 目标

落地 v5 重设计的 P2「★ 邀请后端」（spec §9 P2 表，合计 8 人日；每项都能单独上线，新接口在旧后端上返回 404 时前端静默隐藏入口）：

- 先给登录用户一份「可以叫谁」的名单 `GET /api/me/invitable`——除自己外的所有账号，上榜的和没上榜的都在（M14），每人只有 id、名字、头像、是否在榜、上次一起玩的时间，不含分数和任何 Discord 信息（P2-2）；
- 组织者在建局之后、开局之前还能再叫人：`POST /api/sessions/:id/invite`，已在局里的行（来、待定、不来、没回）一律不动，PG 上每个新行照旧由触发器发一条邀请私信、受同样的额度；网页在**现有**详情弹窗里挂一个最简版「＋ 再叫几个人」和 `InviteSheet`，接口 404 时入口不出现（P2-1，和 P2-2 一起上线，这两个 PR 就是 spec 说的「最快的邀请闭环」的后半段）；
- 每个 `SessionItem` 带 `going_preview`：最多 5 个回答「来」的人，按回答先后，只有名字和头像，一页一条批量查询（P2-6）；
- P2 唯一一次迁移（D1 `004_lobby.sql` + `schema.sql`，PG `0007_lobby.sql`，四列）：改期时记下每个人对旧时间的回答，`/api/me/invites` 告诉本人「这是新邀请还是改了时间」；取消可以带理由，私信里带上（经 `safeLine`）；`GET /api/sessions?scope=history` 历史页数据（含已取消、游标翻页、出勤人数）（P2-3）；
- 看板时区和 bot 对齐：`/api/config` 下发 `boardTzOffsetHours`，`shared/quickTime` 有 `/yue` 那五个时段和时区标签，`formatWhen` 可以按看板时钟显示；bot 的「可能」改成「待定」，`/yue` 的时段和 15 分钟提前量取自 shared，已绑定的非上榜用户也能 `/yue`；三个会话常量迁到 `shared/attendance.ts`（P2-4）；
- 只在 Node 端：`GET /api/me/discord` 多 `notify_dm`、`dm_ok`，新增 `POST /api/me/discord/notify {on}`，和 bot 的 `/notify` 是同一个开关（P2-5）。

P2 的界面**只有「＋ 再叫几个人」一处**：取消理由输入框、看板时段上屏、头像预览、私信开关的界面都在 P3 / P4（契约第 8 节第 1～4、22 条），每个 P2 PR 只交付接口、类型和 `src/api.ts` 函数。方向和 spec §11 的每个拍板项都按推荐默认值执行（§11 第 7 条：`/yue` 向网页看齐；第 8 条：看板时区标「北京时间」/「UTC+N」；第 9 条：不做「多少人能收到私信」；第 11 条：P2-5、P2-6 是瘦身时可以挪走的两项）。

## 依据

- 已拍板的方案：`docs/redesign-v5/spec.md`。P2 用到：§9「P2 · ★ 邀请后端」表、§8 B2-1 … B2-6 和「迁移约定」「明确不动的」「常量迁移」「不做」、§3.4、§3.5、§3.6、§4.1 ②③⑥⑦、§4.2、§4.3、§5 第 9 条、§10 第 6、7、13 条、§11 第 7、8、9、11、12 条。
- 前两期的计划：`docs/redesign-v5/plan-p0/`、`docs/redesign-v5/plan-p1/`。P0、P1 契约的规则在 P2 继续有效。
- 规划所依据的代码基线：「P0 + P1 全部套上之后」的仓库（规划副本 `/tmp/claude-redesign/p1/compose/repo`，HEAD `5ae164b`）。计划里的 `路径:行号` 指这个副本，只作参考；**定位一律以引用的锚点文字为准**。
- 共享契约原文：本目录的 [contract.md](contract.md)（已按各计划的「对契约的补充」和跨 PR 合成的结果回写过，开头有定稿说明）。下文「共享契约」一节摘出了执行时最常用的部分。
- 各 PR 计划：本目录的 `plan-P2-2.md`、`plan-P2-1.md`、`plan-P2-6.md`、`plan-P2-3.md`、`plan-P2-4.md`、`plan-P2-5.md`。本轮一致性检查的完整记录（含逐 Task 的红 / 绿实测）在 [review-log.md](review-log.md)。

## 六个 PR

按叠放顺序排列。

| id | 名称 | 分支 | 从哪开（依赖） | 人日（spec） | 主要文件 | 新增 / 改动的测试 |
|---|---|---|---|---|---|---|
| [P2-2](plan-P2-2.md) | 可邀请名单 | `claude/p2-2-invitable` | `claude/p1-4-docs`（P0 + P1 全部） | 0.5 | 新 `worker/invitable.ts`（`listInvitable`、`MAX_INVITABLE = 500`，一条两边都合法的 SQL）；`worker/routes.ts`（`/api/me/invites` 之后加 `GET /api/me/invitable`，`privateToViewer`）；两边的 `InvitableUser`、前端 `InvitableResponse`；`src/api.ts` 的 `getInvitable`（404 → `undefined`）；`docs/CONTRACT.md` 一条 | 新 `tests/worker/invitable.test.ts`（16）；新 `tests/worker/session-routes.test.ts`（P2 的 HTTP 层文件，带共享辅助 `call`、`asUser`，3） |
| [P2-1](plan-P2-1.md) | 建局后再叫人 | `claude/p2-1-invite` | `claude/p2-2-invitable` | 1.5 | 新 `worker/session-invites.ts`（`inviteToSession`）；`worker/sessions.ts`（常量改从 shared 引入、四个 `export`、`normalizeInvites` 的 `field`）；`shared/attendance.ts` `// --- P2-1 ---`（`MAX_INVITES`、`MAX_SESSION_ROSTER`、`INVITES_PER_ORGANIZER`）；`dispatcher.ts` 原处 re-export；`POST /api/sessions/:id/invite`；新 `src/lib/invitePicker.ts`（纯）、`useInvitable.ts`、`InviteSheet.tsx` + css；`SessionDetailDialog.tsx`（契约 3.1，475 → 510 行） | `invites.test.ts` +9；`session-routes` +4；`tests/pg/session-cards.test.ts` +3；新 `tests/unit/invite-picker.test.ts`（8）、`tests/dom/invite-sheet.test.tsx`（18，含 404 降级） |
| [P2-6](plan-P2-6.md) | 来的人预览 | `claude/p2-6-going-preview` | `claude/p2-1-invite` | 0.5 | 新 `worker/session-extras.ts`（`goingPreviews`、`previewOfPlayers`、私有 `holes`）；`toSessionItem` 第三参、`listSessions`/`listMyInvites`/`getSessionDetail` 接线；`shared/attendance.ts` `// --- P2-6 ---`（`GOING_PREVIEW_MAX`）；两边的 `going_preview` | 新 `tests/worker/going-preview.test.ts`（7，含 N+1 回归锁）；`session-routes` +1 |
| [P2-3](plan-P2-3.md) | 邀请上下文、取消理由、历史 | `claude/p2-3-invite-context` | `claude/p2-6-going-preview` | 3 | 新 `migrations/004_lobby.sql`、`server/migrations/0007_lobby.sql`；`schema.sql`；`package.json`（`db:migrate4:local/remote`）；`shared/attendance.ts` `// --- P2-3 ---`；`worker/sessions.ts`（改期 UPDATE、upsert、`cancelSession` 的理由、`listMyInvites` 带上下文、新 `listSessionHistory`）；`session-extras.ts` 追加 `inviteContexts`、`attendanceSummaries`；`routes.ts`（`scope=history`、`/cancel` 读 body）；`src/api.ts`（`cancelSession(id, reason?)`、`getSessionHistory`、`getMyInvites` 类型）；bot 取消私信；`docs/CONTRACT.md`、`DEPLOY-DISCORD.md:188` | 新 `tests/worker/session-context.test.ts`（10）、`session-history.test.ts`（6）、`tests/dom/session-api.test.tsx`（5）；`session-routes` +4；`server/test/session-render.test.ts` +2；`session-cards` +2；`tests/pg/import-d1.test.ts` +1 |
| [P2-4](plan-P2-4.md) | 看板时区与 bot 对齐 | `claude/p2-4-board-time` | `claude/p2-3-invite-context` | 1.5 | `shared/attendance.ts` `// --- P2-4 ---`（三个常量，`worker/sessions.ts` 原处 re-export）；`shared/quickTime.ts` 末尾（`BOARD_SLOTS`、`BOARD_SLOT_MIN_LEAD_MS`、`slotIso`、`boardSlots`、`boardTzLabel`）；`src/lib/time.ts`（`formatWhen` 第三参、`formatBoardDateTime`、`formatViewerAside`）；`/api/config` 的 `boardTzOffsetHours`、`Config.boardTzOffsetHours?`；bot（「待定」、`YUE_SLOTS = BOARD_SLOTS`、`/yue` 不再要求上榜）；`docs/CONTRACT.md`、`DEPLOY-DISCORD.md` | 新 `tests/unit/board-time.test.ts`（33）；`source-hygiene` +1；`session-routes` +1；`session-render` +3；`session-cards` 改 1（「/yue is for bound players only」→「for anyone bound」）+1 |
| [P2-5](plan-P2-5.md) | 私信状态与开关（只在 Node 端） | `claude/p2-5-dm-status` | `claude/p2-4-board-time` | 1 | `server/src/discord/links.ts`（`dm_ok`、新 `setNotifyDm`）；`commands.ts`（`/notify` 改用它，文案不变）；`server/src/link-routes.ts`（`linkView`、`POST /api/me/discord/notify`）；`src/api.ts`（`DiscordLinkInfo` 两个可选字段、`setDiscordNotify`）；`DEPLOY-DISCORD.md:8`、`:20` | `tests/pg/link-flow.test.ts` +8、改 `:619`；`tests/dom/discord-link.test.tsx` +3 |

## 叠放顺序与开分支规则

**顺序：P2-2 → P2-1 → P2-6 → P2-3 → P2-4 → P2-5。** 每个分支从前一个分支的 HEAD 开，PR 叠放，由机主以后按顺序合并：

```
claude/p1-4-docs
  └─> claude/p2-2-invitable
        └─> claude/p2-1-invite
              └─> claude/p2-6-going-preview
                    └─> claude/p2-3-invite-context
                          └─> claude/p2-4-board-time
                                └─> claude/p2-5-dm-status
```

- 开分支：`git switch -c <分支> <上游分支>`（本地分支）。上游分支不存在或工作区不干净就停下，不在本 PR 里补别人的文件。**本轮计划不 fetch、不 rebase、不 push、不开 PR、不合并**。
- **第一个分支从 `claude/p1-4-docs` 开。** 现状：`origin/main` 里只有 P0 和 P1-0（PR #25 已合并）；B1-1（`claude/b1-1-redact`）是 PR #26，等待合并；**P1-1、P1-2、P1-3、P1-4 还没有实现**（本地和远端都没有这些分支）。所以 P2 要么等 P1-1 … P1-4 按 P1 计划做完、在 `claude/p1-4-docs` 上开工，要么等它们都合并进 main 之后从 `origin/main` 开（见下一条）。不要从 `claude/b1-1-redact` 或现在的 main 直接开：P2 的锚点、基线数字和测试辅助都是按「P1 全部套上之后」写的（例如 P2-1 改的 `SessionDetailDialog.tsx` 带着 P1-1 的 `variant` 和 P1-3 的访客区，`InviteSheet` 用 P1-2 的 `historyKey`）。
- **前面的 PR 合并之后，后面的分支也可以从 `origin/main` 开**（先 `git fetch`，确认上游 PR 都已合并进 main，再 `git switch -c <分支> origin/main`）。这样做时每份计划 Task 0 的 grep 和基线数字照样适用：合并后的 main 和叠放分支的内容相同，数字应和下表上一个 PR 的「合并后」一行一致；对不上就停下。这一条是给以后合并时用的；本轮执行仍在本地分支链上。
- 现有分支 `claude/p2-pages-split` 和新分支名不冲突，不要动它。
- 为什么是这个顺序（契约第 2 节）：P2-2 是 P2-1 名单的来源，两者一起合并、一起部署；P2-6 和 P2-3 都改 `toSessionItem`，P2-6 只加一个参数、不需要迁移，先上；P2-3 是唯一带迁移的 PR，放在中间，它之后的 P2-4、P2-5 回滚不牵涉迁移；P2-5 只在 Node 端、和前面没有源文件交集，放最后，随时可以单独合并或推迟（spec §11 第 11 条的瘦身选项就是把它挪到 P5）。
- 共享文件的追加位置是固定的，后来的 PR 按锚点文字定位，不按行号：
  - `shared/attendance.ts`：原有导出之后依次是 `// --- P2-1 ---`、`// --- P2-6 ---`、`// --- P2-3 ---`、`// --- P2-4 ---`，都只追加。
  - `worker/sessions.ts`（已 985 行，P2 只改接线、新逻辑放新模块）：P2-1、P2-6、P2-3、P2-4 各改各的锚点，全程净增 75 行（985 → 1060）。
  - `worker/session-extras.ts`：P2-6 建，P2-3 在 import 区末尾追加、在文件末尾追加；占位符一律用 P2-6 的私有 `holes()`。
  - `tests/worker/session-routes.test.ts`：P2-2 建；P2-1、P2-6、P2-3、P2-4 各在末尾追加一个 describe；import 区只有 P2-3 追加三行。
  - `src/api.ts`：P2-2、P2-1 在 import 列表和 `// --- Sessions ---` 小节加东西；P2-3 以它们加过的五行 import 为锚点整体替换；P2-5 只动 Discord 小节。
  - `server/src/discord/sessions.ts` 和 `server/test/session-render.test.ts`：P2-3 先各加一行 `SESSION_CANCEL_REASON_MAX` 的 import，P2-4 把 `RSVP_LABEL` 并进那一行。
  - `docs/DEPLOY-DISCORD.md`：P2-3 改 `:188`，P2-4 改 `:169-171`、`:187-188`、`:191`，P2-5 改 `:8`、`:20`。

## 共享契约（执行时以此为准）

### 规则

- spec 和契约冲突时以 spec 为准，**除了契约第 8 节列出的偏离与补充**（第 1～22 条，有测试或实现理由，需机主过目，写进对应 PR 描述）。spec 没写死、契约写死了的文件名、导出名、常量名、类名、错误文案，一律照用。计划正文和契约还有出入时，以计划正文为准（它们在合成副本上实测过），并回报领队。
- P0、P1 契约的规则继续有效：CSS 四种断点写法、hover 包进 `@media (hover: hover)`、不写 `outline: none`、红字 `var(--danger-text)`；CSP 不放 `unsafe-inline`；DOM 顺序 = 视觉顺序；§6.5 锁定文案；组件签名只加可选 props；新按钮不叫裸的「取消」「确认」「关闭」；toast 不用 `role="alert"`；被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块；**只有 `src/lib/router.ts` 能碰 `history`（注释也算）**；新 CSS 过 `css-conventions`；不新增 `act(...)` 警告（基线只有 `onboarding-roles` 的 3 条）；不新增首屏请求。
- **D1 和 PG 行为一致靠同一套测试**：`vitest.pg.config.ts` 把 `tests/worker/**` 原样跑在 PostgreSQL 上。SQL 只写两边都合法的方言（契约 3.4：ISO「现在」绑定进去比较 `starts_at`；不用 `NULLS LAST`、行值比较、窗口函数；`ORDER BY` 表达式里不引用 SELECT 别名；`IN (…)` 占位符按个数生成）。
- **P2 每个 PR 收尾都跑六个套件**（typecheck、unit、dom、server、worker、pg）加 `npm run build`、`build:pages`。pg 本机能跑（没设 `TEST_DATABASE_URL` 时起嵌入式 PG 17，约 110 秒）。`tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」在机器负载高时偶发 5 秒超时：单独重跑那个文件确认 4/4，记进 PR 描述。
- 隐私（契约第 6 节）：`/api/me/invitable` 只有五个键、不 SELECT `u.*`、不 JOIN `discord_links`、`private, no-store`；任何地方都**不返回、不推导「多少人能收到私信」**；`notify_dm`、`dm_ok` 只给本人；改期上下文只经 `/api/me/invites` 给本人；`cancel_reason` 和 `note` 一样随局公开。
- 机主编码规则：不可变更新；文件最多 800 行（`worker/sessions.ts` 是已知例外，P2 不拆）；函数 < 50 行；嵌套 ≤ 4 层；错误给友好的中文提示；在边界校验输入；不写 `console.log`；不写魔法数（领域常量放 `shared/`）；用户文案用 spec 原文的中文。
- 提交信息 `<type>: <中文描述>`，**不加任何署名行**。

### 接口表（谁提供、名字、签名要点）

| 提供方 | 名字 / 位置 | 要点 |
|---|---|---|
| P2-2 | `GET /api/me/invitable` → `{ users: InvitableUser[] }` | 登录；除自己外所有账号（≤ 500）；`{ id, username（显示名）, avatar_url, is_participant, last_played_with_me_at }`；排序：一起玩过的在前（越近越前）→ 在榜的 → 名字 → id；`last_played_with_me_at` = 已开局、没取消、双方都「来」、双方都没被点成没来 / 请假的局里最晚的 `starts_at` |
| P2-2 | `listInvitable(db, callerId)`；`getInvitable(): Promise<InvitableUser[] \| undefined>` | 404 → `undefined`（入口静默隐藏），其他错误照抛 `ApiError` |
| P2-1 | `POST /api/sessions/:id/invite { user_ids }` → `{ session, added, skipped }` | 先权限后状态：401 → 503 → 400 id → 404 → 403 → 400「已取消 / 已结算的约局不能再叫人」→ 400「约局已开始，不能再叫人」→ `user_ids` 400（不是数组 / 空 / 无效 id / 超 20）→ 名单 50 人上限 400；只剩组织者 → 200 `added: 0`；`INSERT … SELECT … ON CONFLICT DO NOTHING`，已有的行一律不动 |
| P2-1 | `inviteToSession(db, caller, id, rawUserIds)`（worker）；`inviteToSession(id, userIds)`（`src/api.ts`）；`InviteResult`（worker）/ `InviteResponse`（前端） | worker 侧导出 `getSessionRow`、`requireOrganizer`、`SessionJoinRow`、`normalizeInvites(raw, organizerId, field)` |
| P2-1 | `useInvitable(enabled): Invitable`（`off` / `loading` / `ready` / `error` / `unsupported`）；`invitePicker`：`inviteGroups`、`toggleInvite`、`inviteToast`；`InviteSheet { session, invitable, onClose, onInvited }` | `Modal variant="sheet" historyKey="invite"`；入口条件：`canManage` + `open` + 没开局 + 名单 `ready` / `error`；不满足条件不发请求 |
| P2-6 | `SessionItem.going_preview: RecordActor[]`（前端可选 `going_preview?: UserRef[]`） | 最多 `GOING_PREVIEW_MAX`（5），按 `rsvp_at`、同秒按 `user_id`；列表一页一次 `goingPreviews`，详情用 `previewOfPlayers` 从名单推导；没人来是 `[]` |
| P2-3 | 迁移四列：`game_sessions.cancel_reason`、`cancelled_at`；`session_players.prev_rsvp`、`prev_starts_at` | D1 `004_lobby.sql`（重跑报 `duplicate column name`，预期）+ `schema.sql`；PG `0007_lobby.sql`（`ADD COLUMN IF NOT EXISTS`），没有触发器改动 |
| P2-3 | `POST /api/sessions/:id/cancel { reason? }`；`cancelSession(id, reason?)`（不传就**不带 body**） | trim 后截到 80（`SESSION_CANCEL_REASON_MAX`），空白或非字符串为 null；再取消不覆盖；每个 `SessionItem` 带 `cancel_reason`、`cancelled_at` |
| P2-3 | `GET /api/me/invites` → `InvitedSessionItem[]` | `invite_reason: 'new' \| 'moved'`、`prev_rsvp`、`prev_starts_at`，只给本人 |
| P2-3 | `GET /api/sessions?scope=history[&before=<id>]` → `HistorySessionItem[]`；`getSessionHistory(before?)` | 已开局、含已取消、`starts_at DESC, id DESC`、每页 `SESSION_HISTORY_PAGE`（20）、`attendance_summary` 五键含 0；坏游标 400、未知游标 `[]`；旧后端把未知 scope 当 upcoming 返回 200，所以前端以「每项都有 `attendance_summary`」判断支持与否 |
| P2-4 | `GET /api/config` 多 `boardTzOffsetHours`（`RESET_TZ_OFFSET`，默认 8，可以是小数） | 前端 `Config.boardTzOffsetHours?` 缺了就按浏览器时区写「本地时间」 |
| P2-4 | `shared/quickTime`：`BOARD_SLOTS`、`BOARD_SLOT_MIN_LEAD_MS`、`slotIso`、`boardSlots(now, offset)`、`boardTzLabel(offset)`；`src/lib/time`：`formatWhen(v, now, offset?)`、`formatBoardDateTime`、`formatViewerAside` | 旧 `quickSlots`、`MIN_LEAD_MINUTES` 不动；`formatWhen` 不传第三参时输出一字不变；`YUE_SLOTS = BOARD_SLOTS`（名字、`value` 不变，不用重新注册命令） |
| P2-4 | `shared/attendance`：`MAX_OPEN_SESSIONS`、`MAX_SESSIONS_PER_DAY`、`DEFAULT_DURATION_MIN` | 值不变，`worker/sessions.ts` 原处 re-export；`source-hygiene` 锁 `DEFAULT_DURATION_MIN` = SQL 里的 120 |
| P2-5 | `GET /api/me/discord` 多 `notify_dm`、`dm_ok`；`POST /api/me/discord/notify { on }`；`setNotifyDm(db, who, on)`；`setDiscordNotify(on)` | 只在 Node 端；503 → 401 → 400「缺少 on（true 或 false）」→ 409「还没有绑定 Discord」；打开或关闭都把 `dm_ok` 重置为 1；从不下发 Discord id；前端 404 → `undefined` |

### 被测试锁住、P2 会碰到的东西（摘要；完整表在 contract.md 7.1）

- **有意改的两处**：`tests/pg/session-cards.test.ts` 的「/yue is for bound players only」（P2-4 改成「for anyone bound」，spec §11 第 7 条；spec 说「没有现有断言」与代码不符）；`tests/pg/link-flow.test.ts:619` 的键集合（P2-5 改成四个键）。其余原有断言一律不改。
- `tests/dom/organizer-actions.test.tsx:316`：取消只发一个 POST、`body: null`——P2-3 的 `cancelSession(id)` 不传 reason 时不带 body。`:356`：普通玩家打开详情没有 `role="alert"`——P2-1 的名单错误态用 `role="status"`。`:142`：「（本地时间）」——P2 不改 `RescheduleSheet`。
- `tests/dom/app-refresh.test.tsx:145`：首屏 URL 集合——P2 不改 `getSessions`，`/api/me/invitable` 只在详情里、只给管理者。
- `tests/worker/session-update.test.ts` 的整行 `toEqual` 和改期名单——P2-6、P2-3 之后原样通过。
- `server/test/session-render.test.ts:2` 从 bot 模块导入 `slotIso`——P2-4 保留 re-export。
- `tests/worker/setup.ts` 按 `;` 切 `schema.sql`——P2-3 的列注释里不写 `;`。

## 每个 PR 之后的测试数字

跨 PR 合成副本（六份最终计划依次套在规划副本的同一份拷贝上），每个 PR 收尾在它的分支快照上跑全部套件，Node v24.22.0。「文件 / 用例」；typecheck（三个 tsconfig）、`npm run build`、`npm run build:pages` 每一步都通过，`dist/` 只有 `_headers`、`assets/`、`index.html`；dom 的 `act(...)` 警告始终是 `onboarding-roles` 的 3 条。

| 合并后 | unit | dom | server | worker | pg |
|---|---|---|---|---|---|
| 基线（P0 + P1，`5ae164b`） | 29 / 414 | 24 / 299 | 22 / 290 | 15 / 560 + 9 todo | 27 / 838 + 9 todo |
| + P2-2 | 29 / 414 | 24 / 299 | 22 / 290 | 17 / 579 + 9 todo | 29 / 857 + 9 todo |
| + P2-1 | 30 / 422 | 25 / 317 | 22 / 290 | 17 / 592 + 9 todo | 29 / 873 + 9 todo |
| + P2-6 | 30 / 422 | 25 / 317 | 22 / 290 | 18 / 600 + 9 todo | 30 / 881 + 9 todo |
| + P2-3 | 30 / 422 | 26 / 322 | 22 / 292 | 20 / 620 + 9 todo | 32 / 904 + 9 todo |
| + P2-4 | 31 / 456 | 26 / 322 | 22 / 295 | 20 / 621 + 9 todo | 32 / 906 + 9 todo |
| + P2-5 | 31 / 456 | 26 / 325 | 22 / 295 | 20 / 621 + 9 todo | 32 / 914 + 9 todo |

pg 包含 `tests/worker/**`，所以每个 worker 用例在 pg 里再算一次；pg 比 worker 多出来的是 `tests/pg/**`。本轮六次 pg 全套都没有遇到 adapter 超时。每份计划 Task 0 的基线就是上表上一行，「收尾」的期望就是本行。

## 部署说明

- **P2-2 和 P2-1 一起合并、一起部署**（P2-1 的入口依赖 P2-2 的名单；只上 P2-2 无害，只上 P2-1 时名单 404、入口不出现）。两者都没有迁移。
- **P2-6、P2-4、P2-5 没有迁移**。P2-5 只在 Node 端生效；旧 Worker 上 `/api/me/discord*` 本来就是 404，前端在 404 时返回 `undefined`。P2-4 部署后 bot 的按钮、卡片、私信从「可能」变成「待定」，已绑定的非上榜用户可以 `/yue`；`/yue` 命令定义（choices）没变，**不需要重新注册命令**。
- **P2-3 是 P2 唯一带迁移的 PR，部署顺序是「先备份、再迁移、后代码」**：新代码读写四个新列，没迁移就上新代码，改期和取消会报列不存在（读接口有 `?? null` 兜底，写不行）；旧代码配新 schema 没问题。
  1. **先备份。** 按 `docs/DESIGN-v4-discord-coolify.md` §9.1 的约定，有迁移的部署之前先手动备份一次：启用了 compose 里的 `pg-backup` 就手动触发一次；没启用就在 Coolify 服务器上 `docker exec <postgres 容器> pg_dump -U edg -d edg -Fc > edg-before-p2-3.dump`（不要加 `-t`，否则二进制输出会被终端破坏）。还在用 D1 的环境，用 `node scripts/d1-export.mjs export-before-p2-3/`（只读，需要已登录的 wrangler）导出一份。
  2. **PostgreSQL（Node 后端，Coolify）**：在 Coolify 上把 `APP_TAG` 指到含 P2-3 的镜像、重新部署。compose 的一次性 `migrate` 服务先跑 `server/dist/migrate-main.js`（按文件名顺序、一个文件一个事务、advisory lock），退出 0 之后 `app` 才启动。migrate 容器日志应是 `migrations: applied 1 (0007_lobby.sql), already applied 6`；如果 migrate 失败，`app` 不会启动，旧容器继续服务，按备份排查。`0007` 是 `ADD COLUMN IF NOT EXISTS`，重跑无害；没有触发器或函数改动。
  3. **D1（还在用旧 Worker 的环境）**：部署 Worker **之前**手动跑 `npm run db:migrate4:remote`（本地开发 `npm run db:migrate4:local`）。SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重跑会对每条报 `duplicate column name`——预期行为，代表已经迁过（和 002、003 一样）。全新部署直接用 `schema.sql`（已含四列），不要跑 004。
  4. **D1 → PG 导入**：`server/src/import-d1.ts` 按 `information_schema` 动态取列，不用改。D1 迁了 004 而 PG 没迁 0007 时 preflight 会拒绝（`export has tables/columns this schema lacks: game_sessions.cancel_reason, …`）——先让 `migrate` 跑完（compose 本来就是这个顺序）。D1 没迁 004 时四列在 PG 里为 NULL，照常导入。
  5. **回滚**：回退 P2-3 的代码即可，不用回退迁移（多出来的四列对旧代码无害）。真要回滚 schema（会丢改期上下文和取消理由，一般不需要）：D1 四条 `ALTER TABLE … DROP COLUMN …`；PG 四条 `DROP COLUMN IF EXISTS` 再 `DELETE FROM schema_migrations WHERE name = '0007_lobby.sql';`。
- P2-3 合并后到 P3-3 之前，网页上还不能写取消理由（API 已支持，`/api/sessions/:id/cancel` 带 `{ reason }` 才写）；私信和接口已经能带理由。

## 怎么执行

1. **一次只做一个 PR，按叠放顺序来。** 每个 PR 用 `superpowers:subagent-driven-development` 按它的计划逐个 Task 执行：先写失败的测试，确认它按写明的原因失败，再实现，确认通过，最后 commit（提交信息照抄计划，不加署名行）。不在当前会话里执行就用 `superpowers:executing-plans`。
2. **开工前**跑计划的 Task 0：确认上游分支存在、工作区干净，`git switch -c <分支> <上游分支>`；用 grep 核对上游接口和锚点都在（每份计划都写了期望输出，已在合成副本的对应阶段逐条跑过）；跑六个套件并对照上表上一行。任何一项对不上就停下回报领队，不在本 PR 里补别人的文件。
3. **收尾**跑计划「收尾」里的全部步骤：六个套件 + build、范围核对的 diff / grep / wc、PR 描述要点。数字和上表本行对不上就继续修。手动核对（P2-1 的 375×812 和 1280×800 检查、P2-2 的浏览器访问）由机主在预览环境做，代理做不到的写「未手动验证」。
4. **不 rebase、不 push、不开 PR、不合并。** 每份计划「PR 描述要点」和「对契约的补充」由机主以后开 PR 时使用。

## 需要机主过目的事项

已写进各计划的 PR 描述要求，合并前请看：

1. **契约第 8 节的 22 条偏离与补充**，尤其：
   - 第 1～4、22 条：P2 的界面只有「＋ 再叫几个人」；取消理由输入框（P3-3）、`RescheduleSheet` 换看板时段（P3-3）、`formatWhen` 拆成三个函数、私信开关界面（P4-1）都不在 P2。P2-4、P2-5 的任务说明曾提到在 P2 里做后两项，计划按契约没有做。
   - 第 5 条：**取消理由是公开的**（随 `SessionItem` 下发，和 `note` 一样），建议 P3-3 的确认文案写「理由（选填，会写进私信，也会显示在这局的页面上）」。
   - 第 6 条：新增名单上限 `MAX_SESSION_ROSTER = 50`，点名上限改为引用它。
   - 第 13 条：`POST /api/me/discord/notify` 没绑定时回 409（不用 404，404 被前端读作「后端不支持」）。
   - 第 8、15、16 条：测试放的位置、新增的 dom 测试、比原估多的用例数。
2. **P2-4 的 `/yue` 权限是有意的行为变化**（spec §11 第 7 条）：已绑定的非上榜用户也能 `/yue`，额度仍是 5 个未开局、24 小时 10 个；为此改了一个现有 PG 用例。
3. **P2-3 部署要先迁移**（见上一节），并且这是 P2 唯一要手动跑 D1 命令的地方。
4. **已知问题，不在 P2 修**：`cancel_reason` 复用 `normalizeOptionalText`，和 `title`/`game`/`note` 一样按 UTF-16 截断，emoji 卡在第 80 个位置会留下孤立代理（`session-update.test.ts` 的 `it.todo`）。要修就四个字段一起修，建议另开条目。
5. **`worker/sessions.ts` 已超 800 行**（P2 后 1060 行），P2 按契约第 0 节只改接线、不拆；建议 P2 全部合并后单独开一个 refactor PR 拆它，顺便把两条 `export { … } from '../shared/attendance'` 合成一条。
6. **`docs/CONTRACT.md` 的「Worker modules」表**没有列 P2 新增的 `worker/invitable.ts`、`worker/session-invites.ts`、`worker/session-extras.ts`（契约第 3 节：每个 PR 只改自己的端点行），建议 P2 合并后一个文档 PR 补三行（P2-2「对契约的补充」第 6 条）。
7. **`/api/me/discord/notify` 没有频率限制**（幂等 UPDATE + CSRF + 登录；和 bot `/notify` 一样会把 `dm_ok` 重置为 1，最坏是 dispatcher 多试一次，契约 7.2）。
8. **spec §11 第 11 条的瘦身选项**：P2-5、P2-6 可以挪到 P5。按本计划，P2-5 在最后，可以直接不做或推迟；P2-6 在 P2-3 前面，推迟它的话 P2-3 的 `listSessionHistory`、`listMyInvites` 和 Task 0 要跟着改（不建议）。

## 跨 PR 一致性检查记录

完整记录（方法、每一条问题、逐 Task 的红 / 绿、每个 PR 的全量实测）在 [review-log.md](review-log.md)。这里是摘要。

### 检查方式

六份计划和契约都通读了；另外看了规划者留下的自检副本，弄清楚每份计划是对着什么上游写的：P2-2 对着真实基线、P2-1 对着真实的 P2-2；**P2-6、P2-3、P2-4 都是对着「按契约原稿捏的替身」写的**，P2-5 只对着基线。

然后做了一次**完整的实际合成**（`/tmp/claude-redesign/p2/compose`，规划副本的拷贝，每个 PR 一个分支、每个 Task 一个 commit，共 31 个；`node_modules` 是指向现有包的符号链接，没有往 worktree 写任何东西）：每份计划一个脚本，**直接从最终计划的 markdown 里按序号取代码块**，「新建」要求文件不存在、「把 A 换成 B」要求 A 正好出现 1 次，照计划先红后绿，D1 和 PG 都要跑的地方都跑；每个 PR 收尾在分支快照上跑六个套件和两个 build。计划改完后删掉全部 P2 分支、按最终计划从头重放了一遍，上表的数字来自这次重放。各计划 Task 0 的 grep、「范围核对」的 diff / grep / wc 也在对应分支上逐条跑过，输出和计划写的期望一致。P2-2、P2-1 的合成结果和规划者的自检副本逐字节相同。

### 发现的问题与处理

1. **P2-3 Task 0 grep 的是替身里的单行 `toSessionItem` 签名**，真实的 P2-6 是多行、第三参是 `SessionItem['going_preview']`——执行者会在 Task 0 停下。→ 改成两条按真实写法的 grep。
2. **P2-3 改 `src/api.ts` import 列表的锚点落空**（`FileCasesResponse,` / `LeaderboardResponse,` 中间已有 P2-2、P2-1 加的三行，合成时实际报「出现 0 次」）。→ 锚点改成这五行整体，按字母序插入。
3. **P2-3 改 `listMyInvites` 结尾只有文字描述**，没有可匹配的原文。→ 补上 P2-6 那两行原文作锚点。
4. **P2-3 留了「上游 import 过就删掉」的分支**，真实上游没有加任何 import。→ 写死期望的 import 区，对不上就停。
5. **P2-3 在 `session-extras.ts` 里声明局部 `const holes`，遮住了 P2-6 同文件的私有函数 `holes()`，也是重复代码。** → 两个批量读改用 `holes(sessionIds.length)`；契约写明不要再声明同名变量。
6. **P2-4 Task 0 的文件数期望按契约原稿推算（dom 25、worker 19、pg 31）**，真实上游多了 P2-6 的 `going-preview.test.ts` 和 P2-3 的 `session-api.test.tsx`（26 / 20 / 32），计划又写「文件数对不上就停下」。→ Task 0 和收尾换成合成实测。
7. **P2-4 给 `session-render.test.ts`、bot 源文件加 import 的写法依赖「P2-3 有没有加过」**，照字面会出现两条同源 import。→ 改成确定的「改前 → 改后」，`RSVP_LABEL` 并进 P2-3 那一行。
8. **P2-4 Task 1 的 import 块文字和结果块不一致、还留了「P2-1 若排成别的顺序」**。→ 以 P2-1 的结果为锚点写「改前四行 → 改后六行」。
9. **P2-4 的 `Env` import 留了「没导入就补」的分支**（P2-2 早已导入）、Task 4 的红写成「N passed」、Task 1 说 `sessions.test.ts` 会因 P2-6 变多（P2-6 用的是新文件）。→ 都写死（12 passed、40 例）。
10. **契约落后于计划**：P2-6 的测试文件、P2-3 / P2-5 的 dom 测试、P2-4 多改的两行文档、几个共享测试文件的 import 区归属、3.1 的 `InviteResult` / `InviteResponse`、4.6 的 `Invitable` / `inviteToast`、10.4 的 `previewOfPlayers` / `holes` / `InviteContext` / `NO_ATTENDANCE`、7.1 的 `import-d1` fixture 做法。→ 契约按计划回写，加定稿说明、1.1 实测表，第 8 节新增第 15～22 条，第 9 节换成实测数字。
11. **四份计划的基线和「规划时实测」是替身上的数字**（例如 P2-6 写 worker 16/561，P2-3 写 18/581、pg 30/862，P2-4 写 unit 29/414，P2-5 写 dom 24/302、pg 27/846），PR 之间接不上。→ 每份计划的 Task 0 写上一个 PR 完工时的合成实测数字，各 Task 的绿和收尾换成合成实测（原来的增量全部吻合）。
12. **P2-5 说上游不碰它的文件、行号不变**，但 `src/api.ts` 的 Discord 小节已从第 332 行附近移到第 380 行附近。→ 逐个文件说明，`src/api.ts` 只认锚点。
13. **跨计划引用指向临时路径**（`/tmp/claude-redesign/p2/contract.md`、`…/plan-P2-2.md`）。→ 改成本目录的文件名。另补了 P2-6 Task 2 的 `tsc` 红（还有 `TS2339`）。

### 核对过、没有冲突的

- **共享文件的分区**：`worker/sessions.ts`（四个 PR 的锚点互不重叠，净增 75 行）、`worker/routes.ts`（P2-1 和 P2-3 都碰 `/cancel` 路由，一个用结尾三行、一个用开头两行，按顺序互不干扰）、`shared/attendance.ts` 的四个小节顺序、`worker/types.ts`、`src/types.ts`、`SessionDetailDialog.tsx`（只有 P2-1，510 行）、`docs/CONTRACT.md`（P2-3 把 `/cancel` 一行换成三行后，P2-1 的 `/invite` 条目原样在下面）、`docs/DEPLOY-DISCORD.md`（三个 PR 的行不重叠，`:188` 由 P2-3、P2-4 先后改不同的字）、bot 文件、`session-routes.test.ts` 的五个 describe（名字不重，辅助都在各自 describe 里）、`session-cards.test.ts`。
- **名字和签名**：P2-2 … P2-5 提供和消费的所有导出（见接口表）写法一致，三个 tsconfig 每一步都通过；`commands.ts`、`coreData.ts` 拿到变宽的 `InvitedSessionItem[]` 照常编译。
- **先后顺序**：没有哪个 PR 用到后面才提供的东西。
- **测试文件名**：九个新测试文件两两不重名，也不和现有文件重名。
- **文案**：InviteSheet 的全部文案和两条 toast 在 P2-1 代码、契约 4.6、spec §3.5 三处一致；bot「待定」= `RSVP_LABEL.maybe`，按钮、卡片、私信、登记回复、部署文档一致；没有新的裸「取消」「确认」「关闭」按钮。
- **测试数的算术**：每个 PR 的开工数字 = 上一个 PR 的完工数字，各计划收尾表的增量和实测一致；`act(...)` 警告始终 3 条。
- **范围**：没有一个计划要求 fetch、rebase、push、开 PR 或合并；31 个 commit 都是 `<type>: <中文>`，没有署名行；只有 P2-1 碰组件，只有 P2-3 碰 schema 和迁移。
- **看过但不改**：commit 后缀「（P2-x）」只有 P2-1、P2-4 用；`session-routes.test.ts` 里有的 describe 前有 `// --- P2-x ---` 注释、有的没有；`worker/sessions.ts` 里两条同源 re-export（各属一个 PR，留给以后的 refactor）；计划里执行者自己的临时日志路径。

### 计划文件的改动范围

| 文件 | 改了什么 |
|---|---|
| `plan-P2-2.md`、`plan-P2-1.md` | 只有引用路径（数字和合成结果一致） |
| `plan-P2-6.md` | Task 0 基线、Task 2 的 `tsc` 红和期望、实测段落、引用路径 |
| `plan-P2-3.md` | Task 0 的 grep 与 import 区期望和基线；Task 2 的 import 说明和期望；Task 3 的锚点和期望；`session-extras.ts` 两处改用 `holes()`；Task 4、6 的期望；Task 5 的 `src/api.ts` 锚点；收尾实测；「对契约的补充」第 3、5 条；引用路径 |
| `plan-P2-4.md` | Task 0 的 grep 注释、说明和基线；Task 1 的 import 块和期望；Task 4 的 import 说明和红；Task 5 的两处 import；收尾表和实测段落；引用路径 |
| `plan-P2-5.md` | 行号说明；Task 0 的开工 / 完工表；收尾期望；引用路径 |
| `contract.md` | 定稿说明；1.1；第 2、3 节；3.1、4.4、4.6、7.1、10.4；第 8 节第 8 条补一项、新增第 15～22 条；第 9 节实测数字 |
