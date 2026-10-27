# P1 计划审查记录（汇总）

各计划 v1 → v2 的独立审查记录原样搬到这里（正文里不再保留「## 审查记录」）；最后一节是 v2 → final 的跨 PR 一致性检查记录。

## P1-0（plan-P1-0.md）

审查人：独立审查（P1-0 v2）。日期 2026-10-27。依据：spec §2.2、§9 P1-0、§10 第 5 条、§11 第 16 条；契约第 1、2、5、7 节；Cloudflare 文档「Serving Pages」。

**实测方式**：把 `/tmp/claude-redesign/p0/final/compose/repo` 复制到 `/tmp/claude-redesign/p1/rev-P1-0/repo`（`node_modules` 改成指向原目录各包的符号链接目录，免得 Vite / Vitest 缓存写进原仓库），`docs/DEPLOY-PAGES.md` 从分支上的真实文件复制进来，然后按本计划逐步套用、运行（Node v24.22.0）：

| 步骤 | 结果 |
|---|---|
| Task 0 Step 2 锚点 | 全部存在；但 `compose.yaml` 那条 grep 在 macOS（BSD grep）上**无输出**（中间的 `$` 被当成锚点）→ 改 `grep -nF`；`run_worker_first = true` 会同时命中第 6 行注释 → 加 `^`；`docs/DEPLOY-PAGES.md` 里 `functions/` 是 **4** 行（46、48、80、83），不是 3 行 |
| 基线 | unit 26 / 326，dom 20 / 219，worker 15 / 548 + 9 todo，与契约第 1 节一致 |
| Task 1 Step 2（红） | `Tests 2 failed \| 6 passed (8)`，两条都是 `expected null not to be null`，与计划一致 |
| Task 1 Step 4（绿） | `8 passed (8)` |
| Task 1 Step 5 真实构建 | 放 `public/404.html`：`exit=1`，报错文字与计划一致；删掉后 `exit=0`，`dist` = `_headers assets index.html` |
| Task 2 Step 2 / 4 / 6 | `1 failed \| 8 passed (9)`（`expected true to be false`）；删除后 unit `1 failed \| 329 passed (330)`，`ENOENT … scandir '…/functions'`；改 `SOURCE_DIRS` 后 26 / 330 全过；grep 只命中计划说的 2 行 |
| Task 3 | 两个文件 `30 passed (30)`（split-deploy 13、node-api 17）；临时去掉 `${url.search}` 后 `4 failed \| 26 passed (30)`，失败的正是计划列出的 4 条；还原后与原文件逐字相同 |
| 全量 | `npm run typecheck` 通过；unit 26 / 330；dom 20 / 219；worker 15 / 551 + 9 todo |
| Task 4 Step 2（`wrangler pages dev`，删除后） | 6 个地址全是 `200 text/html; charset=utf-8 SPA shell`；日志 `Compiled Worker successfully` 0 次、`No Functions. Shimming...` 1 次；本地响应**没有** CSP 头（与计划补充第 10 条一致） |
| 新增 Step 2b（`wrangler dev`） | `/sessions/1`、`/players/x/cases/1`、`/xyz` 都是 200 SPA shell；`/api/config` 是 `500 application/json`（本地 D1 无表），即归 Worker、不被回退吞掉 |
| Task 4 Step 3 生产 GET | 与规划表一致：community `/sessions/1` 先 `103` 再 `200 text/html` 带 CSP；community `/api/config`、`/auth/login` 都是 `404 text/html`（遗留 Functions）；`capi /sessions/1?x=1` → `302`、`location: https://community.nanako.org/sessions/1?x=1`、`no-store`；`capi /api/config` → `200 application/json` |
| Task 5 文档替换 | README、DEPLOY-EDGEONE.md、DEPLOY-PAGES.md 的「把 X 换成 Y」原文都逐字命中；`grep -c "待领队填写"` 实得 **8**（数的是行）→ 改成 `grep -o … \| wc -l`，实得 14 |

**对 v1 的修改（都已写进上文）**

1. Task 0 Step 2：`compose.yaml` 锚点改 `grep -nF`（v1 在 macOS 上会误报「锚点不在」而让执行者停下）；`run_worker_first` 加 `^`；`functions/` 期望行数 3 → 4。
2. Task 1：404.html 的注释改准确——Cloudflare 只用**顶层** `404.html` 决定是否进 SPA 模式，「最近的 404.html」只在非 SPA 模式下生效；保留递归检查（spec 要求「dist 里绝不能有」），理由写进注释和补充第 4 条。测试文件里的注释同步改。行为、报错文字、用例不变。
3. Task 2 Step 6：`--include` 通配符加引号（zsh 下不加引号直接 `no matches found`，规划审查时复现）。
4. Task 4：新增 Step 2b，用 `wrangler dev` 实测 Worker 单源部署的回退（spec ③ 要求「每一项都实测」，v1 只 grep 配置）；`kill` 之后补 `pkill -f`（npx 下的 workerd 可能残留占端口）；加 `No Functions` 的正向断言；提示 `HTTP/2 103` Early Hints。
5. Task 5 Step 4：第 7 步里那句「（这里原先提醒……）」改成直接陈述；Step 4 之后的 grep 期望写成确切的 2 行（文末小节在 Step 5 才加）。
6. Task 5 Step 5：核验表里 Worker 单源那一格写上本地 `wrangler dev` 的实测；`待领队填写` 计数改用 `grep -o | wc -l`。
7. 收尾第 3 部分（PR 预览）补三条领队必看的前提：Preview 环境是否设了 `VITE_API_BASE`（看 CSP `connect-src`）；预览域名不在 `capi` 的 `FRONTEND_ORIGIN` 里，浏览器里的 CORS 报错是预期的，只看 CSP 报错和请求目标；分支没有预览构建时由机主放开 Branch control 或手动 `wrangler pages deploy`。

**核对后保持不变的结论**

- **Worker 代码还在、仍是线上路径**：`legacySpaRedirect`（`worker/http.ts`，`return \`${frontend.origin}${url.pathname}${url.search}\`;`）和 `worker/index.ts` 的 `app.all('*')` 通过 `server/src/api.ts` 的 `createApi` → `worker.fetch(withForwardedProto(request), env, ctx)` 跑在 `capi.nanako.org` 上，`compose.yaml` 两处默认 `FRONTEND_URL=https://community.nanako.org`；所以 302 测试对应的是生产行为，不改实现，只加测试（split-deploy 2 例 + node-api 1 例）。
- **`wrangler.toml` 的 `[assets]` / `run_worker_first`**：Worker 部署已下线，生产上是死配置；`npm run dev` / `preview` / `deploy` 仍读它，回退行为本地实测正常 → 只核验、不改（契约第 2 节）。`worker/index.ts` 同样不改。
- **删除 `functions/`、`edgeone.json` 的影响面**：除 `tests/unit/source-hygiene.test.ts` 的 `SOURCE_DIRS` 外，`src/ worker/ server/ shared/ scripts/ tests/`、所有 tsconfig、vitest 配置、`Dockerfile`、`.dockerignore`、`.github/workflows/*` 都不引用它们；只剩 `wrangler.toml` 注释和 `DEPLOY-EDGEONE.md` 正文提到 EdgeOne（前者不碰，后者顶部标注已停用）。
- **CSP**：`buildHeaders` 一字未动，`pages-headers.test.ts:32-55` 原样通过；`assertSpaFallback` 在写 `_headers` 之前执行，被拒的产物不会带 `_headers`。
- **owner 规则**：新函数都 < 50 行、无魔法数（`NOT_FOUND_PAGE` 常量）、无新增 `console.log`、报错文案中文；文件行数远低于 800；提交信息 `<type>: <中文描述>` 无署名行；不 rebase / push / 开 PR。a11y 不涉及（无 UI 改动）。
- **对契约的偏离**（补充第 1、2、3、5 条）都有实测理由：`source-hygiene` 不改会 ENOENT；`pages-headers.test.ts` 的 import 行必须扩充；`node-api.test.ts` 那一例覆盖的才是生产的 Node 路径。

**留给领队 / 机主的事**：「PR 预览」「合并部署后」两列需在 push 后手工填写；生产上 `community.nanako.org/api/*`、`/auth/*` 的 404 要等合并并重新部署 Pages 后才变成 SPA 外壳。`wrangler pages dev` / `wrangler dev` 会往 `~/Library/Preferences/.wrangler/logs/` 写日志，属正常。

## B1-1（plan-B1-1.md）

审查人：独立 reviewer-reviser（只读审查 + 在 `/tmp/claude-redesign/p1/rev-B1-1/repo` 上实测；该目录是 `/tmp/claude-redesign/p0/final/compose/repo` 的完整拷贝，没有改动规划副本、P0 工作区或任何 git 状态）。

**实测方法**：把 v1 计划里的每一段代码按原文抽出来，逐 Task 套到拷贝上，每一道「先失败」都实际跑过，再跑全量。

| 检查点 | 结果 |
|---|---|
| Task 0 Step 2 的锚点 grep（规划副本） | 全部命中；`src/types.ts` 的 `type: ViolationType;` / `range: SentencingRange;` 各有两处（第二处在 `CaseDraft`），Task 2 Step 3 的锚点带上下文所以唯一 → v2 在 Task 0 加了说明 |
| Task 1 Step 2 失败数 | v1 写的 4 failed / 9 passed 准确；v2 加强了 `keeps statement_at` 之后实测 **5 failed / 8 passed (13)** |
| Task 1 Step 4 失败数 | 实测 **5 failed / 14 passed (19)**，与计划一致（失败的正是 4 个 `is only “a case in progress”` 和 `is decided case by case in one list`） |
| Task 1 Step 5/6 套用后 | unit 13/13、worker 文件 19/19；`npm run typecheck`（三个 tsconfig，含 `server/tsconfig.json`）通过；worker 全量 **15 / 557 passed + 9 todo** |
| Task 2 Step 2 | `Cannot find module '../../src/lib/recordView'`，0 个用例，与计划一致 |
| Task 2 Step 6 typecheck 错误 | 与计划列出的 **12 条逐字一致**（文件、行列、错误码都对），没有别的消费者（PlayerDetail、SessionDetailDialog、WeekHighlights 只经 VerdictCard / 纯函数间接用到，已核对） |
| Task 2 全部锚点替换 | 6 个组件里每个旧字符串都唯一命中；改完 typecheck 过；`grep "VIOLATION_MAP\["` 只剩 `RollCallDialog.tsx` 和 `recordView.ts`；unit 27/341、dom 20/219 原样全过 |
| Task 3 Step 2 失败数 | 实测 **4 failed / 9 passed (13)**，失败的 4 个与计划所列一致 |
| Task 3 套用后 | `verdict-privacy` + `wording` 19/19；dom 全量 **20 / 225**，`act(...)` 警告仍只有 DiscordLinkCard 3 条；unit 27/341；`npm run build`、`npm run build:pages` 通过（`dist/_headers` 写出，CSP 不变） |
| 逐段改法 = 整文件 | 在规划副本的 VerdictCard 上按 v2 的 ①–⑥ 逐段改，结果与 v1 的完整文件只差 `PRIVATE_TO` 后一个空行，行为一致 |
| 两个引擎 | `server/src/api.ts` 直接 `import worker from '../../worker/index'`，网页路由只有一套；`vitest.pg.config.ts` 的 `include` 含 `tests/worker/**`，新增 9 个路由用例会在 CI 的 PG 上跑；PG schema（`server/migrations/0001_init.sql`）的 `note`/`claim_summary` 是 text、`escalation_suggested` 是 bigint，INSERT 写法与现有用例一致；`0006_p8.sql` 的升级触发器只往 outbox 写一行，无副作用 |
| 所有返回记录的网页路由 | `worker/routes.ts` 的 `/api/records`、`/api/records/:id`、`/api/users/:id`、`/api/sessions/:id` 和所有写路由，以及 `worker/routes-admin.ts` 的改判，全都经过 `redactRecord(s)`；没有别的路由直接吐 `RecordItem` |
| bot | `server/src` 不引用 `redactRecord`/`RecordView`；`verdict.ts` 只用 `canReadPrivate`，`handleVerdictButton` 先过 `isPostable`（只有已判决的 penalty）；`commands.ts` 只列 `decided`、`appealed`（管理员）和本人的待说明；周报 `worker/report.ts` 只统计 `decided`/`appealed`；`server/src/share/*` 不读记录 → bot 与分享页不受影响 |
| shared/ 的隐私辅助 | `shared/` 只有 `scoring.ts`、`attendance.ts`、`quickTime.ts`，没有隐私辅助；判决前判断此前散落在 `worker/cases.ts:419` 和 `RecordsFeed` 的 `undecided`，本 PR 只在 `case-reads.ts` 新增 `isPreVerdict`，不去动另外两处（范围外） |
| 下游计划的 grep | `plan-P1-4.md` Step 2 要求 `worker/case-reads.ts`、`worker/types.ts` 含 `pending_hidden`，`src/types.ts` 含 `pending_hidden?: boolean`，`src/lib/recordView.ts` 含「有一起记录在处理中，判决后公开。」和「分数变化：判决后公开」——本计划的代码全部命中；契约 §4.6 P1-1 的 eyebrow 用 `violationLabel(type)`，签名一致 |
| CSP / a11y / 机主规则 | 没有内联样式、没有新 `<script>`；新 CSS 只用已有 token（`--text-sm`、`--muted`），过 `css-conventions`；脱敏卡保留 `article#case-N[tabIndex=-1]` 和 `h4` 标题，emoji `aria-hidden`；新函数都 < 30 行，文件 ≤ 246 行，无 `console.log`，文案常量集中在 `recordView.ts`，`FALLBACK_EMOJI` 是常量；`redactRecord` 返回新对象（冻结输入用例覆盖） |

**v2 相对 v1 的修改**：

1. **范围核对的文件数 14 → 15**：「文件结构」表本来就是 15 行（`worker/types.ts`、`worker/case-reads.ts`、`src/types.ts`、`src/lib/recordView.ts`、6 个组件 + `verdict-card.css`、4 个测试），实测 `diff -rq` 也是 15 个。
2. **Task 3 Step 3 从「整文件替换」改成 6 处锚点修改 + 完整文件作为结果**，并修正核对方法：v1 说「替换前先 `git diff`」，但 Task 2 Step 12 已经提交，工作区 diff 是空的，起不到核对作用。v2 改成和 `claude/p1-0-hosting` 比，并给出规划副本的 sha256；哈希不一致时禁止整文件覆盖（P0 工作区当前的 `VerdictCard.tsx` 哈希就和规划副本不同——P0 还在进行中，最终可能一致也可能不一致，所以必须有这个分支）。Task 0 Step 2 也记下这个哈希。
3. **`keeps statement_at` 单测改成先红**：v1 的写法在改代码之前就能通过（今天的 `redactRecord` 本来就保留 `statement_at`），证明不了「新的隐藏路径保留 `statement_at`」。v2 同时断言 `pending_hidden: true`；Task 1 Step 2 的期望相应改为 5 failed / 8 passed。
4. **基线写成具体数字**：按 `plan-P1-0.v2.md` 的收尾表，开工时应是 unit 26/330、dom 20/219、worker 15/551 + 9 todo；收尾预期 27/345、20/225、15/560 + 9 todo。v1 只写「以 P1-0 收尾实测为准」。
5. **source-hygiene 的跨 PR 风险**：P1-0 v2 已经去掉 `SOURCE_DIRS` 里的 `'functions'`，v2 在 Task 0 加一条 grep 核对，风险说明改为「万一没改到就停下」。
6. **补充说明**：Task 1 Step 3 说明到期裁决只挂在 `GET /api/config` 上、PG 升级触发器无副作用；「对契约的补充」加第 8 条（`docs/CONTRACT.md` 的 `interface RecordItem` 由 P1-4 改，下游 grep 都能命中）；Task 3 Step 6 写明两个文件合计 19 passed。

**确认无需修改的点**：`RecordView` 联合类型和 `OpenRecordView.pending_hidden?: never` 在所有路由上 typecheck 通过；`redacted: true as const` 让两个分支都能赋给联合类型；dom 用例的 `/\b0\b/` 不会被倒计时（`还剩 2 小时 59 分`，向下取整）或相对时间误伤；`within(row).getByText('选手')` 只命中 `strong`（Avatar 的首字母是「手」）；`deadline_at` 在每个用例里现算，不会过期；原有 unit 5 个、worker 10 个、dom 7 个用例一字未改且全过。

**留给机主的观察（不改计划）**：`classified_by` 按契约保留，`'derived'`（点名推导）会让访客猜出是迟到或缺席，和「对契约的补充」第 6 条的点名数据是同一类问题；`VerdictCard` 主函数仍然超过 50 行（本 PR 之前就是），拆分不在 B1-1 范围。

## P1-1（plan-P1-1.md）

独立审查（reviewer-reviser），对象是 `/tmp/claude-redesign/p1/plan-P1-1.md`，依据 `/tmp/claude-redesign/p1/contract.md`、spec §2（全部）、§3.5、§3.8、§6.4、§9 P1-1、`docs/CONTRACT.md:400-420`，代码基线 `/tmp/claude-redesign/p0/final/compose/repo`。

#### 怎么验的

- 回放副本：`/tmp/claude-redesign/p1/scratch-P1-1/repo`（git 记录了每个 Task 一次提交）。起点 = P0 基线 + P1-0 的改动（取自 `rev-P1-0/repo`：删 `functions/`、`edgeone.json`，`source-hygiene` 去掉 `'functions'` 等）+ B1-1 v2 的完整改动（取自 `rev-B1-1/repo`：`recordView.ts`、`types.ts`、6 个组件、4 个测试、worker 两个文件），不是替身。
- 用脚本 `/tmp/claude-redesign/p1/scratch-P1-1/apply_plan.py` 直接从计划正文里取代码块，逐 Task 先套 Step 1（测试）跑「期望失败」，再套 Step 3（实现）跑「期望通过」；每个「把这段 → 替换为」都断言旧片段在文件里**恰好出现一次**。所有锚点全部唯一命中，没有一处要人工改。
- 基线实测：unit 27 个文件 / 345 个用例，dom 20 / 225，act 警告 3，typecheck 通过。
- 每一步的实测与计划写的一致：Task 1 `route.test.ts` 失败 → 2 个文件 19 个用例通过；Task 2 `router.test.tsx` 14 个通过、dom 21 个文件 239 个；Task 3 route-pages 4 个、css-conventions 13 个；Task 4 `3 failed | 4 passed (7)` → 3 个文件 29 个；Task 5 `6 failed | 7 passed (13)` → 4 个文件 44 个；Task 6 `15 failed | 20 passed (35)`、unit `1 failed | 4 passed (5)`（报出 `src/App.tsx`）→ 35 个、5 个全过。每个 Task 提交的文件和计划里 `git add` 的清单完全一致。
- 收尾（原计划）：typecheck（三个 tsconfig）通过；unit 28 个文件 363 个（U0 + 18）；dom 22 个文件 263 个（D0 + 38）；act 警告 3；`Not implemented` 0；`build:pages` 通过，`dist/` 只有 `_headers`、`assets`、`index.html`；`history.*` 的 grep 和 `console.log` 的 grep 都没有输出。
- 套上本次修订后，用 v2 正文在另一份干净副本（`/tmp/claude-redesign/p1/scratch-P1-1/replay2`）上从 Task 1 重新逐步回放：每一步的红 / 绿数字与 v2 写的一致（Task 6 Step 2 `16 failed | 20 passed (36)`，Step 4 36 个 + 18 个），最终文件与审查副本逐字节相同；收尾 unit 363、dom 264（D0 + 39）、act 3、`Not implemented` 0、typecheck、`build:pages` 都通过（dom 里唯一会红的是下面第 6 条的 B1-1 偶发用例）。

#### 改了什么（v1 → v2）

1. **头像菜单被 PageBar 压住（真 bug，CSS）**。`.pagebar` 是 `z-index: 41`（为了粘住后盖在 `.hdr` 上），但 `.hdr` 是 `position: sticky; z-index: 40`，自成层叠上下文，里面 `.hdr__dropdown` 的 `z-index: 50` 出不了这个上下文。手机页面形态下打开头像菜单，菜单往下展开的那一截会被 PageBar 盖住，点击会落到「返回」上。修法：`page-bar.css` 末尾加 `.hdr:has(.hdr__dropdown) { z-index: 42; }`（菜单只在打开时渲染，见 `Header.tsx` 的 `{menuOpen && (`）。放在 PageBar 自己的样式里，不碰 `header.css`；它确实跨了 BEM 块，注释写明了原因。不支持 `:has()` 的旧浏览器退回到 v1 的表现。补充第 9 条、文件结构表、手动检查第 8 条同步改了。
2. **桌面抽屉里的 NotFound 抢焦点，关闭后焦点丢失（a11y）**。`RouteNotice` 的 drawer 分支里，`NotFound` 默认 `autoFocus`，它的子组件 effect 先于 Modal 的 `useLayer` effect 执行，于是 Modal 把这个标题记成 `restore`，关掉抽屉后把焦点还给一个已卸载的元素，焦点落回 `body`。改成 `<NotFound title={title} autoFocus={false} />`，焦点由 Modal 按 `[data-autofocus]` 交给标题。补充第 6 条改写。
3. **新增一个用例**锁住第 2 条所在的分支（v1 没有任何用例走到 drawer 形态的 `RouteNotice`，而补充第 6 条专门讲了它）：route-pages「on a desktop, a case that is gone says so in a drawer over the lobby; ✕ goes home」。数字随之改：Task 6 Step 2 `16 failed | 20 passed (36)`，Step 4 36 个，dom 总数 **D0 + 39**，route-pages 25 个。Task 6 Step 4 顺手加跑 `css-conventions`。
4. **数字与说法**：基线来源从「B1-1 替身」改为 P0 + P1-0 + B1-1 v2；收尾的回放数字改成 345 → 363、225 → 264（旧的 326 → 344、219 → 257 是替身基线）。Task 1 Step 2 的报错写准（第一个解析失败的是 `routeCopy`）。补充第 11 条改成「P1-0 v2 已处理，出现就停下」。
5. **空行**：PlayerDetail 第（6）段、App 第（2）（3）（23）（24）段是整块删除，照字面做会留下双空行；写明连空行一起删。App 回放 426 行（不清空行 430 行），都在 420–460 之内。
6. **Task 0 加了一条上游偶发失败的说明**：B1-1 的 `verdict-privacy.test.tsx`「… never a 0」用 `deadline_at = now + 3h` 现算，倒计时偶尔显示「还剩 3 小时 0 分」，`/\b0\b/` 失败。审查时 7 次完整 dom 运行里碰到 2 次（`countdownParts` 向下取整，只有造数据和渲染落在同一毫秒时才正好是 3 小时 0 分），单独重跑该文件 13/13 通过。不是 P1-1 的问题，不在本 PR 修；应回报给 B1-1 的负责人（把用例的截止时间改成 `now + 3h - 30s` 之类的值即可）。

#### 核对过、不需要改的点

- **锚点与名字**：所有替换片段都唯一命中；`ID_PATTERN`、`DEEP_LINK_PARAMS`、`readDeepLink`、`withoutParams`、`getRecord`、`ApiError.status`、`CASE_STATUS_LABEL`、`ModalVariant`、`ScoreGauge` 的 `tone`（`gauge--neutral`）、`Modal` 的 `data-autofocus` / `usePageFocus` / drawer 的 `.modal__bar` ✕（`aria-label="关闭"`）都存在，类型对得上（tsc 通过）。`tests/dom` 在 `tsconfig.json` 的 include 里，测试代码也过了类型检查（`noUnusedLocals: false`，Task 3 时 route-pages 里暂时没用到的 import 不报错）。
- **会渲染到被改组件的现有测试**：`organizer-actions`、`session-rsvp-moved`（SessionDetailDialog 默认 center 不变）、`p8-app`、`player-judge`、`appeal-sheet`（PlayerDetail 默认 center；`player-judge` 的「不新增 GET」成立）、`deep-link`、`discord-link`（`?onboarding=1` 留在地址里）、`app-refresh`（首屏请求集合不变）、`board`（唯一 /约局/ 标题）、`my-score-line`（DOM 顺序）、`modal-focus`、`modal-stack` 全部原样通过。
- **范围**：§2.2–§2.4 + §9 P1-1 要的都在：手写 router（`useRoute`/`useLocation`/`navigate`/`goBack`/`<Link>`/popstate，监听全模块一个，只改 hash 的 popstate 忽略）；只开五条路由，其他全部 NotFound，`/api`、`/auth`、`/link` 不接管（`navigate` 整页跳转、`Link` 交给浏览器）；旧深链 `?session=`（先 replace 剥参数、就绪后 push `/sessions/N` + 其余参数）、`?case=`（一次 GET、落到 `/players/<subject>/cases/N?utm=…`）、非法 id、404/500 停在 `/` 用原文案、`linked=discord` 只剥 `linked`、首登引导优先；置顶是**移动**（全页一个 `#case-N`，保留 `focusRecordId`、`vc--focus`、`block: 'center'`）；id 对不上 replace 纠正；`/cases/:id` 别名；公开选手页 ScoreGauge 中性；品牌 `<Link>`；`tests/dom/setup.ts` 的 `afterEach` 重置路由。
- **CSP**：没有新的内联 `<script>` 或 `style` 属性（PlayerDetail 头部的 `--accent` 是原有的）；`pages-headers` 的 CSP 断言原样通过。
- **a11y**：Link 是真 `<a href>`（修饰键、中键、`target` 放行）；PageBar 按钮可访问名就是「返回」，标题 `aria-hidden`、不是 heading；page 形态加载后把焦点给 h2（`tabIndex=-1`），drawer 由 Modal 管；置顶块是有名字的 region「你点开的这一起」。
- **机主规则**：新函数都 < 50 行、新文件都 < 450 行（route-pages 测试 434 行）；没有 `console.log`；常量在 `constants.ts` 的 P1-1 小节或模块内具名常量；提交信息 `<type>: <中文>`、无署名行；没有 push / PR / rebase 指令。

#### 看过但有意不改

- `NOT_FOUND_STATUS = 404` 在四个文件里各写了一份具名常量（不是魔法数）。合并到 `constants.ts` 要改契约 §4.12 的 P1-1 小节，收益小，保留。
- `useRouteLayout` 用 `MediaQueryList.addEventListener`（Safari 14+）。更老的浏览器不在支持范围，不加 `addListener` 兜底。
- 手机页面形态下从大厅点进再「返回」，焦点不回到原来点的那一行（大厅被 `hidden` 时焦点落到 `body`）。滚动恢复是 P1-2 的事，焦点回位 spec 没要求；可以记进 P1-5 的观察项。
- PageBar 粘住后盖住 Header 上面一截，Header 下沿还会露出几像素（两者高度不同）。这是 v1 有意的取舍（补充第 9 条），属于视觉细节，留给 P1-5 实机看。
- spec §2.3 `?linked=discord` 一行里的「去设置私信 ›」链接指向 P4 才有的 `/me/notify`，P1-1 不加；契约 §8 没列这一条，v2 把它写成了「对契约的补充」第 13 条，随 PR 描述请机主过目。
- `EntryTargetInput.blocked` 是 getter、`PinnedCase` 放在 `useCaseLookup.ts`：与契约字面不同，v1 的补充第 1、3 条理由成立（回放验证过 getter 写法是让 p8「waits for the first-run dialog」通过的必要条件）。

#### 回放环境的注意事项（给后来的审查者）

- `/tmp/claude-redesign/p0/final/compose/repo/node_modules` 是指向 worktree `node_modules` 的符号链接，而 worktree 的 `node_modules` 里有一个指回自己的 `node_modules/node_modules` 链接。直接 `cp -R` 再把 `node_modules` 换成实拷贝时，这个自引用链接也会被带过来，结果出现两份 React，dom 的 act 警告从 3 条暴增到几百条。审查副本删掉了这个链接（并把 `@edg/server` 链接指回副本自己的 `server/`）后，数字才和基线一致。真实分支上执行者在 worktree 里跑，不受影响。
- 审查开头的几次测试是透过那个符号链接跑的，vitest 因此在 worktree 的 `node_modules/.vite/vitest/` 里更新了结果缓存文件（只是缓存，不是源码或 git 跟踪的文件）。之后的所有运行都换成了副本自己的 `node_modules`。

## P1-2（plan-P1-2.md）

独立审查（审查兼修订），对象是 `plan-P1-2.md`；本文件 `plan-P1-2.v2.md` 是修订后的完整计划。

#### 怎么核对的

- **基线**：P1-2 依赖 P1-1，`/tmp/claude-redesign/p0/final/compose/repo` 里还没有 `router.ts`/`routes.ts`，所以用的是 P1-1 计划回放出来的副本 `/tmp/claude-redesign/p1/p1-1/replay`（P0 全部 + P1-1 + B1-1 的类型桩），复制到 `/tmp/claude-redesign/p1/scratch-P1-2/repo`，再从本计划的 markdown 里**原样抽出**每段代码、按每个锚点做替换（锚点一处都没对不上）。
- **基线数字**（P1-1 回放）：unit 27 个文件 / 344；dom 22 个文件 / 257；`act(...)` 警告 3 条。unit 比契约少 1 个文件、`npm run typecheck` 在 `tests/unit/route.test.ts:178` 报 `null` 不能赋给 `ViolationType`，两者都是回放里 B1-1 只有类型桩造成的，和 P1-2 无关；真实分支上 B1-1 完整落地后应是 28 个文件且 typecheck 通过（Task 0 照常核对）。
- **每个红灯步骤都分阶段实测过**：
  - Task 1 Step 2：3 个失败（推算并与 P1-1 的 `readEdgState` 对照：`HISTORY_SHEET_NAME_MAX` 未定义时 `'x'.repeat(NaN)` 为空串，那条用例在 `toHaveLength` 失败）。
  - Task 3 Step 2：3 失败 1 通过，失败原因与计划所写一致。
  - Task 3 Step 5：换掉 router 后正好那 4 个 P1-1 用例失败，dom 全量其余 257 个全过。
  - Task 4 Step 2：4 失败 9 通过（加上本次新增的用例）；Task 4 实现后 13 个全过。
  - Task 5 Step 2：3 失败 16 通过；实现后 19 个全过。
- **最终状态**：dom 23 个文件 / 276（= 257 + 19）全过，`act(...)` 警告仍是 3 条；unit 27 / 350（= 344 + 6）全过（含 `source-hygiene` 的 `history API`）；`tsc -p tsconfig.json` 通过；`npm run build:pages` 通过，`dist/` 只有 `_headers`、`assets/`、`index.html`；卫生 grep 无输出；`back-closes-layer` 连跑 5 次全过，不抖。
- **现有测试**：`organizer-actions`、`appeal-sheet`、`drafts`、`p8-app`、`deep-link`、`modal-focus`、`modal-stack`、`onboarding-roles`、`player-judge`、`discord-link`、`router`（改过前提的 2 个）、`route-pages`（改过前提的 2 个）全部通过。
- **规则**：函数都 < 50 行；`router.ts` 约 375 行、`useHistoryLayer.ts` 60、`Modal.tsx` 334、测试 503；没有 `console.log`；常量进了 `constants.ts` 的 P1-2 小节；测试里的 `TRAVERSAL_TICKS`、`DAY_MS` 有名字；不碰 CSS，不加内联脚本或样式（CSP 不受影响）；Modal 不加任何 document/window 监听，legacy center 的 markup 不变；提交信息格式对，没有署名行；分支从 `claude/p1-1-router` 开，不 rebase、不 push、不开 PR。
- **范围**：§2.2 的 overlay 入 history（`{edg: 1, sheet}`，多出的 `idx`/`layer`/`y` 在契约 §8 第 2 条）、界面关闭回到原位（契约 §8 第 1 条：同步 `onClose` + 静默后退）、popstate 只关栈顶、只在没有 `edg` 标记的深层地址垫一次 `/`、刷新去掉 sheet 不重开、P0-2 的 `modalStack` 不动（键盘归它，返回键归 router）、新测试文件里有「刷新不让历史变长」（单元级 + App 级）和「刷新不重开浮层」（单元级 + Modal 级 + App 级）。都在。

#### 改了什么（v1 → v2）

1. **修了一个滚动恢复的漏洞**：v1 只在路由 push 前记 `y`。「浮层里导航」会强制 replace 掉浮层条目（Task 3 第 6 条），而浮层条目下面那条路由条目是被 `pushLayerEntry` 离开的，没有 `y`。真实场景：大厅滚到一半 → 开「发起约局」→ 建局成功跳到 `/sessions/N` → 返回大厅，回到了**顶部**。v2 让 `pushLayerEntry` 压条目前也调用 `rememberScroll(currentState())`（`rememberScroll` 挪到 `restoreScroll` 上面，签名不变），并在 Task 4 加了用例「the scroll under an overlay survives a navigation from inside it」（先写测试实测红灯：`scrollTo` 最后一次是 `(0, 0)`；修完变绿；dom 全量不受影响）。相应地改了 Task 3 的清单第 6 条、Task 4/5 的用例数、收尾表格、「对契约的补充」第 8 条和自查表。
2. **Task 0 的一条 grep 永远不会命中**：`grep -nE "import \{[^}]*readEdgState"` 要求名字和 `{` 在同一行，但 P1-1 的 `route.test.ts` 是多行 import。改成 `grep -n 'readEdgState,'`。
3. **Task 1 Step 4、Task 3 Step 7 的类型检查命令查不到要查的文件**：`tsconfig.json` 只包含 `src`、`shared`、`tests/dom`，`tests/unit/route.test.ts` 由 `tsconfig.worker.json` 检查。改成 `npm run typecheck`。
4. **Task 5 Step 4 关于 `p8-app:133-144` 的说明补全**：加临时打印实测，这个用例里入口跳转确实排在 OnboardingDialog 的静默后退之后（先 `go(-1)`，再 push `/players/p/cases/7`）；补了一句：若跳转先于静默后退执行，走的是「浮层条目被导航用掉」，两种顺序最后都是 `[/, 目标]`。
5. **手动检查**加了两条（第 6 条浮层里导航后的滚动；第 7 条 Chrome 的 history manipulation intervention），并提醒 P1-4 的清单里没有就补上。

#### 核对过、没有改的（写给执行者和机主）

- **两层一起被返回键弹掉、又都被离开确认拦下**（只有长按返回一次跳两条时才会发生）：React 先跑子组件的 effect，内层先重压、外层后重压，外层的条目会落到内层上面。需要两层都有未保存草稿再加长按返回，极少见，P1 不处理；P1-5 遇到再记。
- **同一次提交里一个浮层换成另一个**（关一个、马上挂一个新实例）：旧条目会留在新条目下面，等新浮层关闭时 `closedOnTop` 一次退两步，自己会修复；中间如果按返回键，要多按一次。现有调用方没有这种写法。
- **前进键回到一个桌面抽屉条目**：`restoreScroll` 用的是那条的 `y`，经返回离开的条目没有记 `y`，所以大厅会滚到顶。只影响「返回之后再前进」，可以接受；P1-5 遇到再记。
- **`SILENT_BACK_TIMEOUT_MS` 超时之后迟到的 popstate** 会被当作用户的返回，关掉栈顶。只在浏览器 1 秒内没有完成同文档的历史遍历时发生。
- 契约 §4.6 的「下一个微任务里仍 open 就重新压」改成了靠 `pops` 重新渲染（「对契约的补充」第 1 条），实测「继续写之后再按返回仍是离开确认」通过，焦点仍在「继续写」。
- `tests/dom/router.test.tsx`、`tests/dom/route-pages.test.tsx` 不在契约 §2 列给 P1-2 的文件里，但它们锁的是 P1-1「不垫 `/`」的行为，spec §2.2 要求 P1-2 改掉；只挪前提、不删断言（「对契约的补充」第 9 条），写进 PR 描述。

## P1-3（plan-P1-3.md）

独立审查（reviewer-reviser），对照 `/tmp/claude-redesign/p1/contract.md`、spec §2/§3.5/§3.1/§4.1「登录回跳」/§9 P1-3、analysis §6、`docs/CONTRACT.md:398-420`，以及规划基线 `/tmp/claude-redesign/p0/final/compose/repo`。

**怎么验的**：P1-1、P1-2 还没有落地，计划也还没出，所以拿 P1-2 规划者的草稿实现（`/tmp/claude-redesign/p1/p1-2-scratch/repo-p11` 的 `src/`、`tests/`，含 router/routes/useEntryTarget/RouteView/Modal historyKey/`tests/dom/history.ts`/async setup）叠在 P0 基线副本上当「上游」，在 `/tmp/claude-redesign/p1/scratch-P1-3/rev/` 下把计划逐条套上去跑。第一轮按 v1 原文套（Task 5 按草稿的形状手工改写），第二轮在全新副本上**机械地**按本 v2 的代码块和锚点套完 Task 1–5。第二轮的结果：
- unit 27 → 28 个文件、350 → 395 个用例（+45，与 Task 1 Step 5 一致）；dom 23 → 24 个文件、263 → 279 个用例（+16，与收尾一致）；`act(...)` 警告仍是 `onboarding-roles` 的 3 条；`npm run build` 通过，`dist/` 只有 `index.html` 和 `assets/`；`App.tsx` 430 行（≤ 470）。
- 每个 Task 的 RED 步骤实际失败信息与计划写的一致（Task 2 两条 `expected null…`/`…to be null`；Task 3 五条找不到提问或 group；Task 4 找不到「登录后报名 周五五排」；Task 5 七条失败、「a visitor load neither follows nor removes it」一条通过）。
- typecheck 唯一的错误是草稿上游自带的 `tests/unit/route.test.ts(178,41)`（草稿没带 B1-1 的可空 `type`），与 P1-3 无关；P1-3 新增和改动的文件全部过 typecheck。
- `board.test.tsx:286`、`session-rsvp-moved.test.tsx:72-90`、`organizer-actions.test.tsx:402`、`discord-link`、`deep-link`、`p8-app`、`route-pages`、`router`、`back-closes-layer`、`app-refresh`、`my-score-line`、`css-conventions`、`source-hygiene` 原样全过。

**改了什么（v1 → v2）**：
1. **`blocked` 的形状不再是硬前提**（阻断级）。v1 的 Task 0 要求 `readonly blocked: boolean`，否则停下；`useLoginResume` 在渲染时读 `blocked`。实测上游草稿把它写成了 `() => boolean`——因为 `onboardingAsked.current` 是同一次提交里的 effect 置上的，渲染时的布尔值读不到（契约 4.9 的布尔写法会让 `p8-app:133-144` 的「先首登、再深链」失败，所以真正的 P1-1 很可能也会偏离）。v2：`useLoginResume` 改收 `isBlocked: () => boolean`、在 effect 里现读，并保留 `?onboarding=1` 地址检查；Task 0 记下 BLOCKED=bool/fn、参数写法、`me` 在不在；Task 5 Step 4 给出四种一行写法，`me` 缺失时的补法也写明。
2. **`useEntryTarget` 的解构里可能没有 `me`**：草稿就是 `({ ready, blocked, onPinned })`。v1 的「解构写法」那行会引用未定义的 `me`。v2 写明把 `me` 加进解构（或在 input 缺字段时按契约 4.9 补上）。
3. **`RouteView` 的传值写法**：草稿用 `props.xxx`，v1 的代码块写的是局部名 `resume`、`onResumeDone`。v2 代码块改成 `props.resume`、`props.onResumeDone`，解构写法作为备选写明。
4. **无障碍**：`role="status"` 区域和文字同时插入时读屏不一定播报，而 page 形态加载完把焦点放在标题上。v2 让被圈出的按钮 `aria-describedby` 指向提问（`ResumeHint` 导出 `RESUME_HINT_TEXT_ID`，`SessionDetailDialog` 文件内加 `describedBy` 小工具，和满员说明的 id 可以并存），并在 Task 3 的第一个用例里断言 `toHaveAccessibleDescription(QUESTION)`、「待定」没有 `aria-describedby`。用例数不变。`organizer-actions:402`（满员时「来」的说明）实测不受影响。
5. **zsh 下的命令**：收尾的 `grep … --include=*.ts --include=*.tsx` 在 zsh 里会因为通配符没有匹配直接报错（本机 shell 是 zsh），v2 加了引号。
6. **`AUTH_LOGIN_URL` 的期望输出写错**：`WelcomeCard.tsx` 的 props 注释里也有这个词，v1 说「只剩 LoginLink.tsx」会让执行者误判。v2 改成先 grep `href={AUTH_LOGIN_URL}` 期望为空，再列出允许出现的几行。
7. 文件表、Architecture、自查表、「对契约的补充」第 6 条同步更新；补充新增第 12 条（`aria-describedby`）和第 13 条（满员时被圈的是「来」：按钮照旧禁用、满员说明照旧、提示照旧出现）。

**核对过、没改的**：
- 锚点全部能在 P0 基线 + 上游草稿里唯一命中：`Header.tsx` 的 `href={AUTH_LOGIN_URL}` 那个 `<a>` 和 `import { AUTH_LOGIN_URL } from '../api';`（Header 里只有这两处）、`import { Avatar } from './Avatar';`；`WelcomeCard.tsx` 的 `import { useState } from 'react';` 和登录 `<a>`；`SessionDetailDialog.tsx` 的 `import { RescheduleSheet }…`、`variant?:`/`variant = 'center',`、`const canRollCall = …`、`{canRsvp && (` 三行、`RsvpControlsProps`、`function RsvpControls(…)`、按钮 `className`/`aria-describedby`、`const FULL_NOTICE_ID`；`SessionsPanel.tsx` 的两条 import、`const canRsvp =` 两行、`srow__rsvp` 块之后的 `</li>`；`App.tsx` 的 `import { clearAllDrafts }…`、`handleLogout` 三行、`useEntryTarget({`、`<RouteView` 的 `onOpenStatement={setStatementCase}`。
- 引用的名字都存在：`AUTH_LOGIN_URL`（`src/api.ts:48`）、`isSelfRsvp`/`SELF_RSVPS`/`RSVP_LABEL`/`SelfRsvp`（`shared/attendance.ts`）、`readDeepLink`（`src/lib/deepLink.ts`）、契约 4.1/4.2 的 `HOME_PATH`/`isAppPath`/`parseRoute`/`sessionPath`/`currentPath`/`navigate`/`useLocation`/`resetRouterForTests`、`tests/dom/history.ts` 的 `preventNavigation`（草稿已带，Task 2 Step 1 的条件步骤保留）、CSS 变量 `--gold`/`--gold-dim`/`--r-md`/`--r-pill`/`--fs-sm`/`--text-xs`/`--text`/`--muted`（`src/theme.css`）。
- 范围：spec §3.5「未登录访客」（`VisitorRsvpPrompt` 文案逐字）、「登录回来后」（`ResumeHint` 文案逐字、金色描边、再点一次才提交）、§4.1 登录回跳四步、§9 P1-3「没有任何 POST」、任务要求的「登录后报名」（详情里的可见标签 + 大厅行的链接）都在；`path` 白名单、正整数 id、读一次就删、访客不读不删、旧深链优先、退出登录清除都有用例。TTL 按契约用 30 分钟（spec 15 分钟，补充第 10 条已请机主过目）。
- CSP：没有内联 style、没有新脚本；登录仍是顶层 `<a>` 跳转，`LoginLink` 不 `preventDefault`。
- 机主规则：新文件都远小于 800 行（`login-return.test.tsx` ≈ 430 行、`SessionDetailDialog.tsx` ≈ 470 行）；新函数都 < 50 行（`RsvpControls` ≈ 40 行；`SessionDetailDialog` 本体在 P0 就已超过 50 行，P1-3 只加约 20 行，不在本 PR 拆）；没有 `console.log`；常量进 `constants.ts` 的 P1-3 小节；提交信息是「feat: 中文（P1-3）」且无署名行；不 rebase、不 push、不开 PR。
- 已知剩余风险（写进 PR 描述即可，不阻断）：真正的 P1-1 若和草稿再有出入（比如 `RouteView` 里有两处 `<SessionDetailDialog`），按 Task 0 记下的行数每处都加；`useEntryTarget(` 若排在 `askedAfterLink` effect 之前且 `blocked` 是布尔，Discord 绑定回来重弹首登那条路径上回跳可能先于对话框（见补充第 6 条，影响很小）。

## P1-4（plan-P1-4.md）

独立审查（reviewer-reviser）对 v1 的核对方式：按 v1 原文把检查脚本、验收清单、CONTRACT 的四处 `RecordItem` 替换和整节替换、README 两处替换，在 `/tmp/claude-redesign/p1/scratch-P1-4/` 里对分支上真实的 `docs/CONTRACT.md`、`README.md`（只读拷贝；规划副本里没有 `docs/`）逐步套用并跑脚本；v2 改完后再从 v2 文件里重新抽出每个代码块、从头套一遍（`e2e/`），结果和下面的期望数字一致。Task 0 Step 2 的 grep 在 P0 规划副本上跑过（P0 那几行全部就位、P1 那几行全部 MISSING，符合预期），P1 那几行又分别在 P1-1、P1-2、P1-3 的规划草稿副本上跑过（各自的名字都在）。没有在 worktree 里跑任何测试或构建。

**核对无误、保留的部分**
- `docs/CONTRACT.md`「## Frontend expectations」是最后一节，21 行，sha256 `ffd08ab4…a8aa8d` 与 v1 写的一致；四处 `RecordItem` 替换的 `old_string` 在文件里各只出现一次（`range: {…}` 带上 `created_at` 一行后唯一）；文件以一个换行结尾，替换后仍是。
- README 的 `## 技术栈`、角色表游客一行、`## 路由` 不存在，都与 v1 一致；P0 计划没有改 README / CONTRACT，P1-0 只改 README「部署」一节，不冲突。
- 两句锁定原文「Only a positive integer id is read」「A link never writes.」在新文本里各一次、一字不改；新文本和 P1 契约 4.1、4.2、4.3、4.6、4.8、4.9、4.10、4.11、4.12 逐条对过（id 正则、128 上限、`RESERVED_PREFIXES`、`edg/idx/sheet/layer/y`、垫一次 `/`、去 sheet、`scrollRestoration = 'manual'`、`/?case=` 只请求一次并移动置顶、只在 `/` 上消费、`?onboarding=1` 任何路径、`edg.return` 形状与 30 分钟、旧深链优先、退出清掉）。
- 验收清单引用的现有文案和 CSS 都在代码里：`改到什么时候？`、`先不改`、`改时间`、`组一局`、`申诉`、`申诉这一起`、离开确认三句、`清空`、Modal ✕ 的「关闭」、`--safe-bottom`、sheet 在 ≤600px 贴底、抽屉 `max-width: 480px`、`overscroll-behavior: contain`、body `overflow: hidden` 锁滚动、申诉框 `--fs-md`（16px）、「最新动态」。
- 不碰代码、测试文件数 29 / 24 / 15 不变；没有测试读 `docs/` 或 README（`grep -rln 'CONTRACT\|README\|docs/' tests` 无结果）。CSP、a11y 不受影响。
- 提交信息 `docs: <中文>`、无署名行；不 fetch / rebase / push / 开 PR；P1-5 修复分支从 `claude/p1-4-docs` 开。

**v1 → v2 的修改**
1. **GitHub 会吞掉裸尖括号（缺陷）**：v1 的 CONTRACT 新文本写了 `「<name>有一起记录在处理中，判决后公开。」`，其中的 `<name>` 在反引号外，GitHub 当成 HTML 标签过滤掉，渲染出来只剩「「有一起记录…」」。改成用「老王」举例。验收清单 M-25 的 `「<A2 的名字>」` 虽然按 CommonMark 不构成标签，也一并改成「（A2 的名字）」。检查脚本三段各加一条 `no raw HTML tag outside code`（把 v1 文本放进去会 FAIL，已验证）。
2. **置顶区的「你点开的这一起」不是可见文字**：P1 契约 4.6 它是 `<section aria-label>`，可见的是 eyebrow「案件 #N · …」。v1 的 M-14 写「最上面是『你点开的这一起』」，领队会看不到而误判。改成「头部下面第一块就是第 C 起（eyebrow …；可访问名在 Accessibility 面板里看）」，并把「那张卡居中」放宽为「滚进视口（能居中时居中）」——置顶卡紧挨页头，页面顶端没法真正居中。脚本加一条 mention。
3. **Task 0 Step 2 的文案 grep 太死**：v1 要求「你点开的这一起」在 `PlayerDetail.tsx`、「你登录前点的是」在 `ResumeHint.tsx` 等，P1-1 规划草稿把前者放进了 `routeCopy.ts` 的 `PINNED_CASE_LABEL`。改成两种检查：`need 文件 名字` 查结构性名字，`copy 文案` 在整个 `src/` 里查；另补 `pd__pinned`、`RETURN_PATH_MAX = 512` 和验收清单新引用的 P0 文案 / CSS（`改时间`、`组一局`、`申诉`、`清空`、`aria-label="关闭"`、`--safe-bottom`、`overscroll-behavior`、`480px`、`overflow`、`最新动态`）。
4. **验收步骤的前提数据**：N 必须不是测试账号组织的局（`SessionDetailDialog` 的 `canRsvp` 排除组织者），且账号还没回「来」（P1-3 的 ResumeHint 在 `my_rsvp === resumeRsvp` 时直接 `onResumeDone`），否则 M-23 看不到提示；C_self 必须是 `decided` 且没申诉过（`CaseActions` 只在这时给「申诉」）。写进第 1 节环境表；「对契约的补充」加第 8 条。
5. **设备模拟只对当前标签页生效**：v1 的 M-01、M-08、D-04 用「新标签页」，新标签页里没有 DevTools 设备模式，会在桌面宽度下做手机项。第 0 节新增「直接打开 X」的定义（同一标签页地址栏回车，条目同样没有路由标记），M-08 改成先开 `about:blank` 再粘贴，期望「再按一次回到 `about:blank`」（v1 写的「后退按钮变灰」不准确）；M-05、M-09、M-14～M-20、D-04、D-07 统一写「直接打开」；无痕窗口要重开 DevTools 也写进第 0 节。
6. **R-02 的 iOS 期望会误报**：iOS 左缘右滑对同文档条目也播整屏快照动画，「不会把底下的约局页一起滑走」做不到。改成「松手后仍停在约局页才算通过」。
7. **M-25「任何地方都没有 0」过严**：时间、日期里本来就有 0。改成「分数变化不写成 0」；「大厅动态流」改成实际标题「最新动态」，并注明只有它在预览条数里时才看得到。
8. **申诉草稿会留在设备上**：M-11～M-13 打的字存在 localStorage，第 0 节加一句「做完再打开一次申诉、点『清空』、✕ 关掉」。
9. **本地栈的数据**：本地 D1 是空的，第 1 节写明要先自己组局、立案，做不到时哪些项照做（M-17～M-20）。
10. **第 7 节补两条排查提示**：R-07 背景跟着滚时先看 body `overflow: hidden` / `overscroll-behavior` 在该 iOS 版本的支持；手机横屏宽于 600px 时 sheet 居中、不贴底，属正常。R-10 的「战报附近」改成「排行榜或『最新动态』附近」（P0 大厅里战报卡在榜单上方，不在最下面）。
11. **CONTRACT「Login return」更准确**：登录跳的是 API 的 `/auth/login`（`AUTH_LOGIN_URL = ${API_BASE}/auth/login`，生产在 `capi.nanako.org`），不是同源路径；补上 `path` 上限 512、在 `/` 上没有 intent 时不存并删掉旧值；「When the callback lands on `/`」改成「On the first signed-in load (the OAuth callback lands on `/` …)」，与契约 4.11「`ready && me !== null && !blocked` 时读」一致。`RecordItem` 注释的「the same people」改成「anyone else」，指代更清楚。History 一条补「the routed drawers are addresses of their own」（路由抽屉不设 `historyKey`）。脚本加两条 mention。
12. **README 路由表 `/` 一行**：v1 写「登录后看要处理的事」，那是 P3 的收件箱，P1 还没有；改成「约局、排行榜和最新动态（P3 改成以约局为中心、带『要你处理』的大厅）」。
13. **每个命令块自带 `cd` 到仓库根和 Node 24 的 `PATH`**（执行代理的 shell 状态不跨调用保留）；Task 0 Step 3、Step 4，Task 1～3 的检查与提交块、收尾的套件块都补上。
14. **「对契约的补充」第 5 条的出处更正**：「界面关闭后历史栈长度回到打开前」出自契约第 5 节 P1-2 的测试口径，不是第 9 节；第 9 节本来就是数返回键。
15. **期望数字随之更新**（都已实测）：acceptance 空跑 `2 passed, 44 failed` → 写完 `46 passed`；contract 改前 `10 passed, 31 failed` → 改后 `41 passed`；readme 改前 `3 passed, 29 failed` → 改后 `32 passed`；收尾 `all` 为 `119 passed, 0 failed`。


## 跨 PR 一致性检查（v2 → final）

检查方式、发现的 12 个问题及处理、核对过没有冲突的点、每份计划的改动范围，都写在本目录 `README.md`「跨 PR 一致性检查记录」一节，这里不重复。要点：

- 六份计划按 P1-0 → B1-1 → P1-1 → P1-2 → P1-3 → P1-4 依次套在规划副本的同一份拷贝上（`/tmp/claude-redesign/p1/compose/repo`，每个 PR 一个 commit），每一步跑 typecheck、unit、dom（P1-0、B1-1 另跑 worker）。
- 逐 PR 实测：unit 26/326 → 26/330 → 27/345 → 28/363 → 28/369 → 29/414 → 29/414；dom 20/219 → 20/219 → 20/225 → 22/264 → 23/283 → 24/299 → 24/299；worker 15/548 → 15/551 → 15/560（+ 9 todo）；`act(...)` 警告始终 3 条、`Not implemented` 0 条；最终 `npm run build`、`npm run build:pages` 通过，P1-4 的文档检查 121/121。
- 改动最大的是 P1-3（它的审查是对着上游草稿做的：Task 0、Task 5 的「两种写法都接受」按 P1-1、P1-2 的真实写法写死）、P1-4（验收清单收进 P1-1/P1-2/P1-3 的手动检查项）和契约（按各计划的「对契约的补充」回写）。
