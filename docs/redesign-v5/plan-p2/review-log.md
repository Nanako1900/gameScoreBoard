# P2 跨 PR 一致性检查与合成记录

本文件是 P2 六份计划（P2-2 → P2-1 → P2-6 → P2-3 → P2-4 → P2-5）的跨 PR 一致性检查记录。六份计划由不同的规划者并行写成，每人只在「P0 + P1 规划副本」上自检过，没有对着彼此的真实产出核对——后写的计划按契约原稿**假设**前面的 PR 长什么样。这一轮把六份计划按顺序真实套在同一份副本上，找出假设和现实对不上的地方，改计划正文（不只是改副本），直到照计划执行的人能一路绿到底。

各计划原稿没有「审查记录」一节（规划者的自检数字写在各自「收尾」里，本轮已换成合成实测），所以本文件只有跨 PR 这一部分。

## 1. 检查方式

### 1.1 读

六份计划和契约全部通读，重点看：消费方用的名字 / 签名 / 文件 / 导出和提供方的定义是否一致；两个 PR 改同一区域（`worker/sessions.ts`、`worker/routes.ts`、`shared/attendance.ts` 小节顺序、`src/api.ts`、`src/types.ts`、`worker/types.ts`、`SessionDetailDialog.tsx`、`docs/CONTRACT.md`、`server/src/discord/sessions.ts`、`tests/worker/session-routes.test.ts` 末尾的 describe、`tests/pg/session-cards.test.ts`）时写法是否冲突；先做的 PR 是否用了后做的 PR 才提供的东西；重复劳动；文案；测试文件重名；会被前面 PR 推移的行号；PR 之间的测试数算术。

另外看了规划者留下的自检副本，弄清楚每份计划是对着什么写的：

| 计划 | 规划者自检时的上游 | 结论 |
|---|---|---|
| P2-2 | P0 + P1 规划副本（真实上游） | 合成结果和它的自检副本逐字节相同 |
| P2-1 | P2-2 的自检副本（真实的 P2-2），计划正文由 `ops.py` 生成、按正文机械回放过 | 合成结果和它的回放副本逐字节相同 |
| P2-6 | 模拟的上游：`session-routes.test.ts` 头部取自 P2-2 计划，P2-1 只按契约放了常量和 `export` | 代码能套上；数字是模拟上游的 |
| P2-3 | 模拟的上游：P2-2 / P2-1 / P2-6 的「最小替身」（替身里 `toSessionItem` 是单行签名、`session-extras.ts` 导出 `inHoles`、`src/api.ts` 没有 P2-2/P2-1 的 import） | 三处锚点对不上（见第 2 节第 1～4 条），一处和 P2-6 撞名（第 5 条） |
| P2-4 | 模拟的上游：三个 `shared/attendance.ts` 小节、P2-1 的 import、bot 文件里 P2-3 的 import、只有 1 个用例的 `session-routes.test.ts` | 文件数期望错（第 6 条），四处「如果上游……就……」的分支要写死（第 7～9 条） |
| P2-5 | 只有 P0 + P1 规划副本 | 代码不受上游影响；开工数字要换（第 13 条） |

### 1.2 实际合成

- 副本：`cp -R /tmp/claude-redesign/p1/compose/repo /tmp/claude-redesign/p2/compose`（HEAD `5ae164b` = P0 + P1 全部套上），`node_modules` 换成指向同一批包的符号链接目录，`@edg/server` 指回副本自己的 `server/`，不往 worktree 写任何东西。分支 `claude/p1-4-docs` 指向 `5ae164b`，之后每个 PR 一个分支、每个 Task 一个 commit（commit 信息照抄计划）。
- 套用方式：每份计划一个脚本（`/tmp/claude-redesign/p2/xcheck/apply_p2*.py`），**直接从最终计划的 markdown 里按序号取代码块**：「新建，完整内容」→ 文件必须不存在；「把 A 换成 B」→ A 在文件里必须正好出现 1 次；「之后 / 之前插入」→ 锚点正好 1 次；「文件末尾追加」→ 照计划说的空行。计划改了就重新取块，所以脚本套的永远是计划正文。只有三处是计划用文字描述范围、没有代码块锚点的（P2-4 的 `formatWhen` 整段、`YUE_SLOTS`+`slotIso` 整段、`DEPLOY-DISCORD.md` 的五处替换表），脚本按计划写的起止锚点取范围，结果和计划描述一致。
- 每个 Task 照计划先跑红、再实现、再跑绿（D1 和 PG 各一遍的地方都各跑一遍），记下数字（第 4 节）。
- 每个 PR 收尾在该 PR 分支的快照 worktree 上跑全部套件：typecheck（三个 tsconfig）、unit、dom（数 `act(...)` 警告）、server、worker、**pg**、`npm run build`、`npm run build:pages`（第 5 节）。契约要求 P2 每个 PR 都跑 pg 和 server，所以六个 PR 都跑了，不只是 P2-3 和最后。
- 计划改完后**从头重新合成一遍**（删掉全部 P2 分支，按最终计划重放 31 个 commit），第 4、5 节的数字都来自这次重放。每份计划 Task 0 的 grep、「范围核对」里的 diff / grep / wc 也在对应分支上逐条跑过，输出和计划写的期望一致。

## 2. 发现的问题与处理

1. **P2-3 Task 0 的 grep 找的是替身里的单行签名。** 计划写 `grep -n "function toSessionItem(row: SessionJoinRow, myRsvp: Rsvp | null, preview: RecordActor\[\]): SessionItem"`，而真实的 P2-6 把签名拆成了多行、第三个参数类型写成 `SessionItem['going_preview']`（P2-6「对契约的补充」第 4 条）。执行者会在 Task 0 停下。→ 改成 `^function toSessionItem($` 和 `^  preview: SessionItem\['going_preview'\],$` 两条，另加一条核对 P2-6 的私有 `holes()`（第 5 条要用）。
2. **P2-3 Task 5 改 `src/api.ts` import 列表的锚点落空。** 原稿锚点是相邻的 `  FileCasesResponse,` / `  LeaderboardResponse,`，但 P2-2 在中间插了 `InvitableResponse,`、`InvitableUser,`，P2-1 又插了 `InviteResponse,`，锚点出现 0 次（合成时实际报错）。→ 锚点改成这五行整体，替换成按字母序插入 `HistorySessionItem`、`InvitesResponse` 的七行；说明里写明中间三行属于 P2-2、P2-1。重放通过。
3. **P2-3 Task 3 改 `listMyInvites` 结尾只用文字描述**（「把 `.all<SessionJoinRow>();` 之后、函数结尾之前的语句（P2-6 写的……）整段换成」），没有可匹配的原文。→ 补上 P2-6 写的那两行原文作为锚点（只出现 1 次），再给替换后的八行。
4. **P2-3 Task 0 / Task 2 留了「如果上游已经 import 过某个名字就删掉」的分支。** 真实的 P2-1、P2-6 在 `session-routes.test.ts` 里一行 import 都没加，`session-extras.ts` 的 import 只有 P2-6 的两行。→ Task 0 改成逐条写出期望的 import 区（对不上就停），Task 2 的「已经 import 过的名字就删掉」和「对契约的补充」第 5 条的「按 Task 0 去重」改成确定的说法。
5. **P2-3 在 `worker/session-extras.ts` 里声明局部 `const holes = …`，遮住了 P2-6 同文件的私有函数 `holes(count)`，也是重复代码。** P2-3 的替身导出的是 `inHoles`，规划者以为不能复用。TS 不报错，但同名遮蔽容易误读，P2-6「对契约的补充」第 2 条本来就说 `holes` 是留给 P2-3 用的。→ `inviteContexts`、`attendanceSummaries` 改为 `IN (${holes(sessionIds.length)})`，删掉两处局部变量；P2-3「对契约的补充」第 3 条改写；契约第 3 节、10.4 写明「占位符一律用 `holes()`，不要声明同名局部变量」。重放后 P2-3 的全部用例照常通过。
6. **P2-4 Task 0 的文件数期望是按契约原稿推算的**：dom 25、worker 19、pg 31。真实上游多了 P2-6 的 `tests/worker/going-preview.test.ts`（契约原稿让它追加进 `sessions.test.ts`）和 P2-3 的 `tests/dom/session-api.test.tsx`（契约原稿 dom 一栏是「—」），实际是 dom 26、worker 20、pg 32。计划写「文件数对不上就停下报告」，执行者会停。→ Task 0 换成合成实测的五组「文件 / 用例」（30/422、26/322、22/292、20/620、32/904），收尾表的文件数同步改（26、20、32），并在括号里给出实测的完工数字。
7. **P2-4 Task 5 给 `server/test/session-render.test.ts` 加 import 的写法依赖「P2-3 有没有加过」。** 原稿是「在 `import type { SessionDetail } …` 之后加三行（含 `import { RSVP_LABEL } from '../../shared/attendance'`），P2-3 加过就把 `RSVP_LABEL` 并进那一行」。P2-3 确实在同一位置加了 `import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';`，照字面先加三行会出现两条同源 import，和计划自己的要求相反。→ 改成确定的「改前（两行）→ 改后（四行，`RSVP_LABEL, SESSION_CANCEL_REASON_MAX` 合一行）」；bot 源文件的 import「P2-3 若还引了别的名字」同样写死。
8. **P2-4 Task 1 改 `worker/sessions.ts` 的 shared import 块，文字和「改完应是」不一致**（文字说在 `ORGANIZER_BONUS_MIN_ATTENDEES` 之前加两行，结果块却和 P2-1 的两行交错排序），还留了「P2-1 若排成别的顺序」的分支。→ 改成以 P2-1 的结果为锚点的「改前四行 → 改后六行」。
9. **P2-4 的 `Env` 类型 import 留了「Task 0 发现没导入就补一行」的分支。** P2-2 建文件时已经 `import type { Env }`。→ Task 0 说明和 Task 4 Step 1 写死「不加 import」；Task 4 Step 2 的红改成确定的 `1 failed | 12 passed (13)`（12 = P2-2 的 3 + P2-1 的 4 + P2-6 的 1 + P2-3 的 4）。
10. **P2-4 Task 1 Step 4 说 `tests/worker/sessions.test.ts`「P2-6 追加过 going_preview 后会更多」**，而 P2-6 用的是新文件。→ 改成确定的 40 例。
11. **契约落后于计划。** 契约原稿：P2-6 追加 `sessions.test.ts`；P2-3、P2-5 没有 dom 测试；P2-4 只改 `DEPLOY-DISCORD.md` 的 `:169-171`、`:191`；`session-routes.test.ts`、`session-render.test.ts`、`session-cards.test.ts`、`source-hygiene.test.ts` 的 import 区归属没写；3.1 让前端用 `InviteResult`（那是 worker 的名字，4.2 / 4.5 给前端的是 `InviteResponse`）；4.6 没有 `Invitable`、`inviteToast`；10.4 没有 `previewOfPlayers`、`holes`、`InviteContext`、`NO_ATTENDANCE`；7.1 说 P2-3 改 `import-d1` 的 fixture（实际不改 fixture、在副本上加数据）。→ 契约第 2、3 节、3.1、4.4、4.6、7.1、10.4 按计划回写，开头加定稿说明，第 8 节新增第 15～22 条（各计划「对契约的补充」里需要机主过目的部分），第 1 节加逐 PR 实测表，第 9 节换成实测数字。
12. **跨计划引用指向临时路径**：`/tmp/claude-redesign/p2/contract.md`、`/tmp/claude-redesign/p2/plan-P2-2.md`。→ 统一改成本目录的 `contract.md`、`plan-P2-x.md`。规划副本路径 `/tmp/claude-redesign/p1/compose/repo` 只作「行号指哪份代码」的说明，保留。
13. **P2-6、P2-3、P2-4、P2-5 的「规划时实测」和 Task 0 基线是模拟上游上的数字**（例如 P2-6 写 worker 16/561 → 17/569，P2-3 写 18/581、pg 30/862，P2-4 写 unit 29/414 → 30/448，P2-5 写 dom 24/302、pg 27/846）。Task 0 只写「以实测为准」，执行者没有对照基准，PR 之间的数字也接不上。→ 四份计划的 Task 0 都写上「= 上一个 PR 完工时」的合成实测数字，各 Task 的绿、收尾表和「规划时实测」段落换成合成实测（原来的增量全部吻合，只是绝对数字变了），旧数字标明作废。P2-2、P2-1 原稿的数字和合成结果一致，没改。
14. **P2-5 说「P2-1 … P2-4 不碰下面的源文件，行号在上游分支上应当不变」**，但 `src/api.ts` 被 P2-2、P2-1、P2-3 在前面的小节加过行（Discord 小节从第 332 行附近移到第 380 行附近）。→ 改成逐个文件说明哪些会漂、哪些不会，`src/api.ts` 只认锚点。
15. **P2-6 Task 2 Step 3 对 `tsc` 红的描述不全**：实际除了 `TS2345` 还有 `TS2339`（`going_preview` 不在 `SessionItem` 上）。→ 补上。

## 3. 核对过、没有冲突的

- **共享文件的分区**（都在合成副本上以锚点唯一命中、按顺序套上）：
  - `worker/sessions.ts`：P2-1（import 两个常量、`MAX_ROLLCALL_ENTRIES`、四个 `export`、`normalizeInvites` 的 `field`）、P2-6（import `session-extras`、`toSessionItem` 第三参、三个调用点）、P2-3（import、`toSessionItem` 两列、改期 UPDATE、upsert、`cancelSession`、`listMyInvites`、`listSessionHistory`）、P2-4（import、两个常量 re-export）互不重叠。行数 985 → 992 → 999 → 1059 → 1060 → 1060，P2 全程净增 75 行，在契约第 0 节「约 90 行」以内；新逻辑都在新模块里。
  - `worker/routes.ts`：P2-2（`/api/me/invites` 之后）、P2-1（`/cancel` 路由之后，以它的最后三行为锚点）、P2-3（`/cancel` 处理函数开头、`/api/sessions` 处理函数开头、import 列表）、P2-4（`/api/config` 一行）。P2-1 和 P2-3 都碰 `/cancel` 路由，但一个用结尾三行、一个用开头两行，按 P2-1 → P2-3 的顺序互不干扰。
  - `shared/attendance.ts`：`// --- P2-1 ---` → `// --- P2-6 ---` → `// --- P2-3 ---` → `// --- P2-4 ---`，都只追加；原有导出一个没动。
  - `worker/types.ts`、`src/types.ts`：P2-2、P2-1、P2-6、P2-3、P2-4 各自的位置都在；前端新字段一律可选，现有 dom fixture 不用改。
  - `src/components/SessionDetailDialog.tsx`：只有 P2-1，475 → 510 行（≤ 520）。
  - `docs/CONTRACT.md`：P2-2（Authenticated 一条）、P2-1（`/cancel` 下面一条）、P2-6（`SessionItem` 一行）、P2-3（`SessionItem` 两行、两个形状、`/api/sessions`、`/cancel`、`/api/me/invites`）、P2-4（`/api/config`）。P2-3 把 `/cancel` 一行换成三行时，P2-1 紧跟其后的 `/invite` 条目原样保留。
  - `docs/DEPLOY-DISCORD.md`：P2-3 改 `:188`（行数不变）；P2-4 改 `:169-171`、`:187-188`（`:188` 只换「可能」两个字，P2-3 加的理由保留）、`:191`（一行变两行）；P2-5 改 `:8`、`:20`（在第 7 节之前，不漂）。改完 `grep 可能` 只剩 `:104`「可能带出私事」。
  - `server/src/discord/sessions.ts`：P2-3 只改 import 一行和 `'dm.session.cancelled'` 分支；P2-4 把那行 import 扩成 `RSVP_LABEL, SESSION_CANCEL_REASON_MAX` 并加 quickTime 一行，其余在卡片、`invited` 私信、`/yue` 小节。`commands.ts` 只有 P2-5 改。
  - `tests/worker/session-routes.test.ts`：五个 describe 依次在末尾（`GET /api/me/invitable (P2-2)`、`POST /api/sessions/:id/invite (P2-1)`、`going_preview over HTTP (P2-6)`、`P2-3 over HTTP: …`、`GET /api/config: the board's time zone`），名字不重；各自的小辅助（`json`、`openSession`、`invite`、`rosterOf`、`postOk`、`textOf`、`answeredAt`、`inHours`、`boardOffset`）都在自己的 describe 里；P2-3 的两个用例插在它自己的 describe 末尾时，它是文件最后一个 describe（P2-4 之后才追加）。
  - `tests/pg/session-cards.test.ts`：P2-1（import 两行 + describe）、P2-3（describe）、P2-4（改「/yue is for bound players only」、在 `/yue, more` 里加一例），锚点都按用例名，不受 P2-1 加两行 import 的行号漂移影响。
- **名字和签名**：`listInvitable`、`MAX_INVITABLE`、`getInvitable`、`InvitableUser`、`InvitableResponse`、`inviteToSession`（worker 和 `api.ts` 两个同名函数在不同层）、`InviteResult` / `InviteResponse`、`normalizeInvites(raw, organizerId, field)`、`getSessionRow`、`requireOrganizer`、`SessionJoinRow`、`goingPreviews`、`previewOfPlayers`、`toSessionItem(row, myRsvp, preview)`、`cancelSession(db, caller, id, rawReason?)`、`listMyInvites(): InvitedSessionItem[]`、`listSessionHistory`、`attendanceSummaries`、`inviteContexts`、`getSessionHistory`、`BOARD_SLOTS`、`slotIso`、`boardSlots`、`boardTzLabel`、`formatWhen(value, now, offsetHours?)`、`formatBoardDateTime`、`formatViewerAside`、`setNotifyDm`、`setDiscordNotify`——提供方和消费方写法一致，三个 tsconfig 每一步都通过。`commands.ts` 的 `/todo`、`/score` 拿到 `InvitedSessionItem[]` 照常编译；`src/lib/coreData.ts` 调 `getMyInvites()` 照常编译。
- **先后顺序**：没有哪个 PR 用到后面 PR 才提供的东西。P2-1 的 `/invite` 新行在 P2-3 之后自然是 `invite_reason: 'new'`；P2-6 的 `goingPreviews` 被 P2-3 的 `listSessionHistory` 复用；P2-3 的 `readJsonBody` 在 P2-1 之前就已在 `routes.ts` 的 import 里。
- **测试文件名**：新文件 `tests/worker/{invitable,session-routes,going-preview,session-context,session-history}.test.ts`、`tests/unit/{invite-picker,board-time}.test.ts`、`tests/dom/{invite-sheet,session-api}.test.tsx` 两两不重名，也不和现有文件重名（现有 `tests/unit/time.test.ts`、`quickTime.test.ts`、`client-time.test.ts` 与 `board-time.test.ts` 不同名）。
- **文案**：InviteSheet 的「再叫几个人」「在榜的」「其他朋友（未上榜，不参与计分）」「· 已在局里」「· 说了不来」「一次最多叫 20 人」「绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 3 条邀请私信。」「没绑的人要自己上网页看，把链接发到群里最稳。」「已叫 N 人。没绑 Discord 的朋友，记得在群里喊一声。」「没有叫到新的人：选的人已经在局里了。」在 P2-1 代码、契约 4.6、spec §3.5 三处一致（spec 的 toast 多一个「[复制邀请链接]」按钮，属 P3-3，契约 4.6 已写明）。bot「待定」= `shared/attendance` 的 `RSVP_LABEL.maybe`，按钮、卡片、私信、登记回复、`DEPLOY-DISCORD.md` 一致。没有新的裸「取消」「确认」「关闭」按钮。
- **测试数的算术**：每个 PR 的 Task 0 基线 = 上一个 PR 的完工数字（第 5 节），增量和各计划「收尾」表一致：P2-2 worker +2 / +19；P2-1 unit +1 / +8、dom +1 / +18、worker +13、pg +16；P2-6 worker +1 / +8、pg +1 / +8；P2-3 dom +1 / +5、server +2、worker +2 / +20、pg +2 / +23；P2-4 unit +1 / +34、server +3、worker +1、pg +2；P2-5 dom +3、pg +8。`act(...)` 警告始终是 `onboarding-roles` 的 3 条。
- **范围**：六份计划都不 fetch、不 rebase、不 push、不开 PR；31 个 commit 都是 `<type>: <中文>`，没有署名行；只有 P2-1 碰组件（改 `SessionDetailDialog.tsx`、新建 `InviteSheet`），其余五个 PR 一个组件、一行 CSS 都不改；只有 P2-3 改 schema / 迁移。

**看过、不改的**：

- commit 信息只有 P2-1、P2-4 带「（P2-x）」后缀，其余不带——不影响什么，各计划照原样。
- `session-routes.test.ts` 里 P2-6、P2-3、P2-4 的 describe 前有 `// --- P2-x ---` 注释，P2-2、P2-1 没有——外观差异。
- `worker/sessions.ts` 里有两条 `export { … } from '../shared/attendance'`（P2-1 的 `MAX_INVITES`、P2-4 的两个额度常量，分在注释两边）。合成一条要改别人的分区，留给以后拆 `sessions.ts` 的 refactor PR。
- P2-4 计划里 dom 日志写到 `/tmp/p2-4-dom*.log`、P2-3 的可选 sqlite3 检查用 `/tmp/p23-004.db`：这是执行者在自己机器上的临时文件，保留。

## 4. 逐 Task 的红 / 绿（最终计划重放，合成副本）

「文件；用例」。红都按计划写的原因失败（模块不存在、路由 404、字段缺失、文案还是「可能」……），绿都通过；只列测试命令，typecheck 每个 Task 都通过（P2-6 Task 2、P2-3 Task 5 的红阶段 `tsc` 按计划报错）。

| PR | 步骤 | 套件 | 结果 |
|---|---|---|---|
| P2-2 | t1-red | worker | 1 failed (1)；no tests |
| P2-2 | t1-green | worker | 1 passed (1)；16 passed (16) |
| P2-2 | t1-green | pg | 1 passed (1)；16 passed (16) |
| P2-2 | t2-red | worker | 1 failed (1)；3 failed (3) |
| P2-2 | t2-green | worker | 2 passed (2)；19 passed (19) |
| P2-2 | t2-green | pg | 2 passed (2)；19 passed (19) |
| P2-1 | t1-red | worker | 1 failed (1)；no tests |
| P2-1 | t1-green | worker | 1 passed (1)；24 passed (24) |
| P2-1 | t1-green | pg | 1 passed (1)；24 passed (24) |
| P2-1 | t1-related | worker | 3 passed (3)；118 passed，1 todo (119) |
| P2-1 | t2-red | worker | 1 failed (1)；3 failed，4 passed (7) |
| P2-1 | t2-green | worker | 1 passed (1)；7 passed (7) |
| P2-1 | t2-green | pg | 1 passed (1)；7 passed (7) |
| P2-1 | t3-first | pg | 1 passed (1)；52 passed (52) |
| P2-1 | t3-after | pg | 1 passed (1)；52 passed (52) |
| P2-1 | t3 | server | 22 passed (22)；290 passed (290) |
| P2-1 | t4-red | unit | 1 failed (1)；no tests |
| P2-1 | t4-green | unit | 1 passed (1)；8 passed (8) |
| P2-1 | t5-red | dom | 1 failed (1)；no tests |
| P2-1 | t5-green | dom | 1 passed (1)；7 passed (7) |
| P2-1 | t5-css | unit | 1 passed (1)；13 passed (13) |
| P2-1 | t6-red | dom | 1 failed (1)；7 failed，11 passed (18) |
| P2-1 | t6-green | dom | 1 passed (1)；18 passed (18) |
| P2-1 | t6-related | dom | 7 passed (7)；97 passed (97) |
| P2-6 | t1-red | worker | 1 failed (1)；no tests |
| P2-6 | t1-green | worker | 1 passed (1)；4 passed (4) |
| P2-6 | t1-green | pg | 1 passed (1)；4 passed (4) |
| P2-6 | t2-red | worker | 2 failed (2)；4 failed，11 passed (15) |
| P2-6 | t2-green | worker | 2 passed (2)；15 passed (15) |
| P2-6 | t2-green | pg | 2 passed (2)；15 passed (15) |
| P2-6 | t2-all | worker | 18 passed (18)；600 passed，9 todo (609) |
| P2-6 | t3 | dom | 25 passed (25)；317 passed (317) |
| P2-3 | t1-red | worker | 1 failed (1)；1 failed (1) |
| P2-3 | t1-red | pg | 2 failed (2)；2 failed，8 passed (10) |
| P2-3 | t1-green | worker | 1 passed (1)；1 passed (1) |
| P2-3 | t1-green | pg | 2 passed (2)；10 passed (10) |
| P2-3 | t2-red | worker | 2 failed (2)；6 failed，9 passed (15) |
| P2-3 | t2-green | worker | 2 passed (2)；15 passed (15) |
| P2-3 | t2-green | pg | 2 passed (2)；15 passed (15) |
| P2-3 | t3-red | worker | 2 failed (2)；5 failed，16 passed (21) |
| P2-3 | t3-green | worker | 4 passed (4)；99 passed，1 todo (100) |
| P2-3 | t3-green | pg | 3 passed (3)；75 passed，1 todo (76) |
| P2-3 | t4-red | worker | 2 failed (2)；6 failed，12 passed (18) |
| P2-3 | t4-green | worker | 3 passed (3)；58 passed (58) |
| P2-3 | t4-green | pg | 3 passed (3)；58 passed (58) |
| P2-3 | t5-red | dom | 1 failed (1)；4 failed，1 passed (5) |
| P2-3 | t5-green | dom | 2 passed (2)；25 passed (25) |
| P2-3 | t6-red | server | 1 failed (1)；1 failed，8 passed (9) |
| P2-3 | t6-red | pg | 1 failed (1)；1 failed，53 passed (54) |
| P2-3 | t6-green | server | 1 passed (1)；9 passed (9) |
| P2-3 | t6-green | pg | 1 passed (1)；54 passed (54) |
| P2-4 | t1-red | unit | 1 failed (1)；1 failed，5 passed (6) |
| P2-4 | t1-green | unit | 1 passed (1)；6 passed (6) |
| P2-4 | t1-green | worker | 1 passed (1)；40 passed (40) |
| P2-4 | t2-red | unit | 1 failed (1)；17 failed (17) |
| P2-4 | t2-green | unit | 2 passed (2)；29 passed (29) |
| P2-4 | t3-red | unit | 1 failed (1)；13 failed，20 passed (33) |
| P2-4 | t3-green | unit | 4 passed (4)；75 passed (75) |
| P2-4 | t3 | dom | 26 passed (26)；322 passed (322) |
| P2-4 | t4-red | worker | 1 failed (1)；1 failed，12 passed (13) |
| P2-4 | t4-green | worker | 2 passed (2)；50 passed (50) |
| P2-4 | t5-red | server | 1 failed (1)；3 failed，9 passed (12) |
| P2-4 | t5-red | pg | 1 failed (1)；1 failed，54 passed (55) |
| P2-4 | t5-green | server | 22 passed (22)；295 passed (295) |
| P2-4 | t5-green | pg | 2 passed (2)；83 passed (83) |
| P2-4 | t6-red | pg | 1 failed (1)；1 failed，54 passed (55) |
| P2-4 | t6-green | pg | 2 passed (2)；83 passed (83) |
| P2-5 | t1-red | pg | 1 failed (1)；2 failed，40 passed (42) |
| P2-5 | t1-green | pg | 3 passed (3)；128 passed (128) |
| P2-5 | t2-red | pg | 1 failed (1)；5 failed，43 passed (48) |
| P2-5 | t2-green | pg | 1 passed (1)；48 passed (48) |
| P2-5 | t3-red | dom | 1 failed (1)；3 failed，14 passed (17) |
| P2-5 | t3-green | dom | 1 passed (1)；17 passed (17) |

## 5. 每个 PR 收尾的全量实测

快照 worktree，Node v24.22.0，2026-10-27；typecheck 三个 tsconfig、`npm run build`、`npm run build:pages` 每一步都通过，`dist/` 只有 `_headers`、`assets/`、`index.html`（没有 `404.html`）。「文件 / 用例」；dom 的 `act(...)` 警告每一步都是 3 条。

| 合并后 | unit | dom | server | worker | pg |
|---|---|---|---|---|---|
| 基线（P0 + P1，`5ae164b`） | 29 / 414 | 24 / 299 | 22 / 290 | 15 / 560 + 9 todo | 27 / 838 + 9 todo |
| + P2-2 | 29 / 414 | 24 / 299 | 22 / 290 | 17 / 579 + 9 todo | 29 / 857 + 9 todo |
| + P2-1 | 30 / 422 | 25 / 317 | 22 / 290 | 17 / 592 + 9 todo | 29 / 873 + 9 todo |
| + P2-6 | 30 / 422 | 25 / 317 | 22 / 290 | 18 / 600 + 9 todo | 30 / 881 + 9 todo |
| + P2-3 | 30 / 422 | 26 / 322 | 22 / 292 | 20 / 620 + 9 todo | 32 / 904 + 9 todo |
| + P2-4 | 31 / 456 | 26 / 322 | 22 / 295 | 20 / 621 + 9 todo | 32 / 906 + 9 todo |
| + P2-5 | 31 / 456 | 26 / 325 | 22 / 295 | 20 / 621 + 9 todo | 32 / 914 + 9 todo |

pg 本轮六次全套都没有遇到契约第 1 节说的 `adapter.test.ts` 5 秒超时；规划阶段（几个 PG 套件同机并行时）见过它和 `concurrency.test.ts` 的一条各失败一次，单独重跑通过——各计划 Task 0 里的处理办法保留。

## 6. 计划文件的改动范围

最终计划 = 各计划原稿做了上面第 2 节的修改：

| 文件 | 改了什么 |
|---|---|
| `plan-P2-2.md` | 只有引用路径（第 12 条） |
| `plan-P2-1.md` | 只有引用路径（第 12 条） |
| `plan-P2-6.md` | Task 0 基线写上 P2-1 完工的实测数字；Task 2 Step 3 的 `tsc` 红、Step 6 的期望；「规划时的实测」换成合成实测（第 13、15 条）；引用路径 |
| `plan-P2-3.md` | Task 0 的 grep 和 import 区期望（第 1、4 条）、基线数字；Task 2 的 import 说明和期望；Task 3 `listMyInvites` 的锚点（第 3 条）和期望；`session-extras.ts` 两处改用 `holes()`（第 5 条）；Task 4、Task 6 的期望；Task 5 `src/api.ts` 的 import 锚点（第 2 条）；收尾的实测段落、`--numstat` 注释；「对契约的补充」第 3、5 条；自查表一行；引用路径 |
| `plan-P2-4.md` | Task 0 的 grep 注释、说明、基线（第 6、9 条）；Task 1 的 import 块改成「改前 → 改后」、Step 4 的期望（第 8、10 条）；Task 4 的 import 说明和红（第 9 条）；Task 5 的两处 import 改成确定写法（第 7 条）；收尾表和实测段落、`wc -l` 注释（第 6、13 条）；引用路径 |
| `plan-P2-5.md` | 行号说明（第 14 条）；Task 0 的开工表写上 P2-4 完工的实测数字和预计完工数字、收尾期望（第 13 条）；引用路径 |
| `contract.md` | 定稿说明；1.1 逐 PR 实测表；第 2 节文件清单；第 3 节分区表（`session-extras.ts`、`src/api.ts`、`session-routes`、`going-preview`、`session-cards`、`session-render`、`source-hygiene`、`session-api`、`discord-link`、`DEPLOY-DISCORD.md`）；3.1、4.4、4.6、7.1、10.4；第 8 节第 8 条补一项、新增第 15～22 条；第 9 节实测数字（第 11 条） |
