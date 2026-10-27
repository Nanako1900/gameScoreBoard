# P4 实施计划 · 案件、我的、审理（一个 PR）

> **已作废（2026-10-27）**：方向改为 v6「Discord 为主，网页做减法」，本计划不再实施。仍有价值的几项列在 [v6 HANDOFF 后续待办](../redesign-v6/HANDOFF.md#5-后续待办不在-s1s5-里需要机主拍板后再做)，要做时重新写计划。

> 前端重设计 v5 第 4 期。方案：`docs/redesign-v5/spec.md`（§11 全部按推荐默认值拍板，P4 特别用到第 4、5、6、14、15 条）。
> **P4 = 一个分支、一个 PR、七步。** 文件名、组件名、props、路由、常量名以本文件为准；P3 引入的名字（`TodoInbox`、`TodoCard`、`BottomTabs`、`AccountMenu`、`useTodoSources`、`useLobbySessions` 等）沿用 P3 计划（`plan-p3.md`）的写法。本文件没写到的细节回 spec 查，两者冲突时以 spec 为准（第 7 节列的偏离除外）。
> 行号只作提示，**定位一律以锚点文字为准**（和 P0–P3 一样）。

## 1. 目标与范围

把案件、个人页、审理和管理从弹窗搬成有地址的页面，同时补齐 spec §8 的四项后端：维持原判与「每起只能申诉一次」（B4-1）、分数原因三件套（B4-2）、网页和 bot 共用的待办（B4-3）、下榜保护（B4-4）。spec §9 P4 合计 11.5 人日（前端 7.5、后端 4）。**有一组迁移**（D1 `migrations/005_review.sql`、PG `server/migrations/0008_review.sql`），新增两个接口（`GET /api/me/todo`、`POST /api/admin/records/:id/uphold`），扩展三个（`/api/users/:id`、`/api/leaderboard`、`/api/records`）。

做完后用户能看到：

- **「我的」`/me`**：分数、段位和一句只给自己看的 selfHint、回血预告、本周加减分、我的约局、我的案件；`/me/notify` 一页办完进群、绑定、私信开关；`/me/profile` 改名字和身份。底栏「我的」、头像菜单、首页分数行都改去这里。
- **写说明 `/cases/:id/statement`**：全屏写作页，四个快捷开头、草稿、提交前确认；收件箱和选手页的「写说明」都跳到这里。
- **记一笔 `/cases/new`**（可带 `?session=`）：提交后留在页面上，逐人看到归类、改案由、确认升级、失败重试、撤案倒计时（`CaseResult`）；约局详情给裁判加「这局有人出事了？记一笔 ›」。
- **案件页**：聚焦的那一起上方有时间线（`CaseTimeline`），手机底部是按角色给操作的操作栏（`CaseActionBar`）；管理员可以「维持原判」；改判后原判保留、可展开；每起只能申诉一次。
- **分数怎么来的**：选手页有账本（每周回血 / 案由 / 管理员调整），走势图点按能看到原因；榜单和首页分数行显示本周变化；本周之星改用后端数据，去掉「数据够一整周才显示」的门槛。
- **审理 `/review`**（裁判、管理员）：待确认升级、待复核申诉、我立的案；**管理 `/admin`**（AI 裁判、周报）；**入伙 `/join`**（新朋友四步引导）；首次登录多一个「先看看」。
- **待办与 bot**：「要你处理」改用 `GET /api/me/todo`，多出「可撤案」卡；bot `/todo` 多出改时间、待点名、待确认升级三类；bot `/score` 本人说明换成 selfHint；维持原判时当事人收到私信。
- **隐私**：别人的选手页不再显示段位徽章、段位说明和段位色；有未结案件或最近扣分的人不能自助下榜。

不在 P4：`/admin` 的「全部账号」子页（B5-1，P5 前隐藏）、AI 试跑用草稿配置（B5-3）、并行归类（B5-4）、bot 改发 `/cases/N`（spec 写「可选」，本期不做）、改分写理由（§10 第 11 条）、bot 的「陈述」改「说明」（§11 第 15 条）。

## 2. 前提

开工时 main 上应已合并 P0–P3（P3 即 `claude/p3-lobby-board` 那个 PR），后端已在 Coolify Redeploy。P2-5 / P2-6 若按瘦身推迟了，P4-1 的私信开关会缺，核对时报缺，在 PR 描述里写明。

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
git status --short                      # 必须为空
git fetch origin
git switch -c claude/p4-cases-me-review origin/main

# 核对 P1–P3 的导出都在：没有输出 = 全部存在；打印「缺：…」就先停下查原因
while read -r f s; do grep -qF -- "$s" "$f" 2>/dev/null || echo "缺：$f  $s"; done <<'EOF'
src/lib/routes.ts export function playerCasePath
src/lib/routes.ts export function sessionNewPath
src/lib/routes.ts export function boardPath
src/lib/routes.ts SESSION_HISTORY_PATH
src/lib/loginReturn.ts export function saveLoginReturn
src/components/LoginLink.tsx export function LoginLink
src/components/ConfirmInline.tsx export function ConfirmInline
src/components/CaseActions.tsx export function CaseActions
src/components/AppealSheet.tsx export function AppealSheet
src/api.ts export async function getDiscordLink
src/api.ts export async function setDiscordNotify
server/src/link-routes.ts /api/me/discord/notify
shared/scoring.ts export const APPEAL_MAX
shared/scoring.ts export const FILED_DM_GRACE_MS
shared/scoring.ts export function isFilingJudge
shared/attendance.ts export const DEFAULT_DURATION_MIN
src/lib/todo.ts export function buildTodo
src/lib/todo.ts export function todoBadgeCount
src/lib/useTodoSources.ts export function useTodoSources
src/lib/useLobbySessions.ts export function useLobbySessions
src/lib/download.ts export function copyText
src/components/TodoInbox.tsx onOpenStatement
src/components/BottomTabs.tsx export function showsBottomTabs
src/components/AccountMenu.tsx onOpenOnboarding
src/components/MyScoreLine.tsx variant
src/components/RouteView.tsx mySessions
src/components/SessionCard.tsx export function SessionCard
src/components/icons/index.tsx IconWithdraw
EOF
ls migrations/004_lobby.sql server/migrations/0007_lobby.sql          # 两个都在
ls migrations server/migrations | grep -E '^(005|0008)_'               # 必须没有输出
```

然后跑一遍第 6 节的六个套件和两个 build，记下数字作为基线，和 P3 PR 描述里的收尾数字对照；`act(...)` 警告应正好 3 条（`onboarding-roles`）。对不上多半是 P3 实现时偏离了计划，先弄清楚再开工；P3 改了名字时以 main 上的实际名字为准，在 PR 描述里写明。

## 3. 分步实现

顺序 **P4-7 → P4-4 → P4-5 → P4-6 → P4-1 → P4-2 → P4-3**，后端先行：

1. **P4-7 最先**：最小、纯后端；P4-3 的「先看看」靠它兜底（spec 开头「B 的问题」表：「只在首次登录时提供，另加后端下榜保护」；§11 第 5 条）。
2. **P4-4 第二**：本期唯一的迁移放在前面，后面各步看到的是最终表结构；`RecordItem` 的新字段一次定型。
3. **P4-5 在 P4-6 前**：`listTodo` 的「可撤案」「待确认升级」要用 P4-5 给 `listRecords` 加的 `reporter`、`escalationPending` 筛选。
4. **P4-6 在前端页面前**：底栏「我的」的圆点、`/me` 的「审理 · N 件」都读收件箱数据，先把来源换成 `/api/me/todo`。
5. **P4-1 → P4-2 → P4-3**：先搭 `/me` 和路由骨架、改头像菜单和底栏的链接；P4-2 的案件页规则函数（`caseActionsFor`）被 P4-3 的 `/review` 复用；`/review` 的「维持原判」「我立的案」要 P4-4、P4-5 都已就位。

每步按 TDD 做：先写测试 → 确认按预期原因失败 → 实现 → 通过 → commit。每步一组 commit，提交信息 `<type>: <中文描述>（P4-x）`，不加署名行。**每步结束时全部套件都要绿**，出问题可以按步回退。

**P4 的 8 条路由**（P4-1、P4-2、P4-3 各加自己的；`Route` 联合在 `| { readonly name: 'notFound' };` 之前追加，已有成员一个不改）：

| 路径 | `Route` 成员 | 路径函数 / 常量 | 加在 | 底栏 |
|---|---|---|---|---|
| `/me` | `{ name: 'me' }` | `ME_PATH` | P4-1 | 显示 |
| `/me/notify` | `{ name: 'meNotify' }` | `ME_NOTIFY_PATH` | P4-1 | 显示 |
| `/me/profile` | `{ name: 'meProfile' }` | `ME_PROFILE_PATH` | P4-1 | 显示 |
| `/cases/:id/statement` | `{ name: 'caseStatement'; caseId: number }` | `caseStatementPath(id)` | P4-2 | 隐藏 |
| `/cases/new` | `{ name: 'caseNew' }` | `caseNewPath(sessionId?)` | P4-2 | 隐藏 |
| `/review` | `{ name: 'review' }` | `REVIEW_PATH` | P4-3 | 显示 |
| `/admin` | `{ name: 'admin' }` | `adminPath(tab?)` | P4-3 | 显示 |
| `/join` | `{ name: 'join' }` | `joinPath(sessionId?)` | P4-3 | 显示 |

- query 不进 `Route`（和 P3 的 `?again=` 一样，`parseRoute` 只读 pathname）：`parseSessionQuery(search)`（`/cases/new?session=`、`/join?session=`，只认 `ID_PATTERN`，其他一律 null、不发请求）、`parseAdminTab(search): AdminTab`（`'ai' | 'report'`，缺省和不认识的值都是 `'ai'`；`users` 是 P5，P4 当作 `ai`）、`parseMeList(search)`（`'going' | 'organized'`，缺省 `going`）。
- `matchSegments`：`/cases/new` 的判断插在 `/cases/:id` 别名判断**之前**（`new` 不是数字 id，放后面会先变成 notFound）；`/cases/:id/statement` 是三段式，id 走 `ID_PATTERN`；`/me/*` 只认 `notify`、`profile`。`formatRoute`、`routeCoversHome` 各加 case：8 条都是页面，两种布局都返回 true。
- `showsBottomTabs`：除 P3 的 `sessionNew`、`rollcall` 外，再隐藏 `caseStatement`、`caseNew`、`playerCase`（这三页底部有 sticky 主按钮或操作栏，spec §2.1 不让底部挤在一起）。
- `tests/unit/route.test.ts`：「knows nothing of the later phases’ routes yet」删掉 `/me`、`/me/notify`、`/review`、`/admin`、`/join`、`/cases/new`、`/cases/7/statement` 七个（有意改动 #1，各步删自己的）；末尾追加 P4 describe：正例，以及 `/cases/new/1`、`/cases/07/statement`、`/cases/7/statement/x`、`/me/xyz` 都是 notFound。
- `docs/CONTRACT.md`「Frontend expectations」路由表、`README.md`「## 路由」表随各步加行。

### 第 1 步 · P4-7 下榜保护（B4-4）

**要做什么**：`POST /api/me/roles` 里，**非管理员**把 `is_participant` 从 1 改成 0 时，名下有未结案件（待说明、裁决中、申诉中），或 14 天内生效过判决扣分，就返回 409。管理员接口 `/api/admin/users/:id` 不受限（spec §10 第 9 条「需要找管理员」）。

**修改**
- `worker/case-limits.ts`：加常量 `LEAVE_BOARD_LOOKBACK_DAYS = 14` 和 `blocksLeavingBoard(db, userId): Promise<boolean>`。
- `worker/routes.ts` 锚点 `app.post('/api/me/roles'`：在 `updateRoles` 之前加守卫：

```ts
if (!caller.is_admin && caller.is_participant && optBool(body.is_participant) === false
    && (await blocksLeavingBoard(c.env.DB, caller.id))) {
  throw new ApiError(409, '你有未结束或最近的记录，暂时不能下榜，需要的话找管理员');
}
```

```sql
-- blocksLeavingBoard：两个引擎都合法（PG 的 datetime() 见 0001_init.sql）
SELECT 1 AS hit FROM records r
 WHERE r.subject_id = ?
   AND (r.status IN ('awaiting_statement', 'judging', 'appealed')
        OR (r.status = 'decided' AND r.delta < 0 AND EXISTS (
              SELECT 1 FROM score_events e
               WHERE e.user_id = r.subject_id
                 AND e.reason = 'record:' || CAST(r.id AS TEXT)
                 AND e.created_at >= datetime('now', ?))))   -- 绑定 `-${LEAVE_BOARD_LOOKBACK_DAYS} days`
 LIMIT 1
```

「14 天」按分数生效时间（`record:<id>` 事件，和 P3-7 周报的判决时间同一口径）；判决后被撤销（`revoked`）、撤案（`withdrawn`）的不算；加分不算。

**文案出处**：409 原文 spec §4.4 第 3 条。前端不用改：`OnboardingDialog` 保存失败时已经用 `role="alert"` 显示后端原文。

**测试**：新 `tests/worker/leave-board.test.ts`（D1 和 PG 都跑）：待说明 / 裁决中 / 申诉中各返回 409、`users` 行不变；13 天前生效的扣分 → 409，15 天前 → 200；被撤销的扣分、加分不挡；管理员照常下榜；0→0、只改 `is_judge` 不受影响；从没上过榜的人保存两个 false 不受影响。

**完成标准**：worker、pg 新文件全过；`http-guards.test.ts`「who may become a judge」原样通过。

### 第 2 步 · P4-4 维持原判与申诉次数（B4-1）

**要做什么**：管理员能把申诉中的案件「维持原判」（appealed → decided，判词和分数不变）；改判时保留原判；每起只能申诉一次（§11 第 6 条）；维持原判给当事人发私信（只在 PG）。

**迁移（两个引擎都加同样四列）**

```sql
-- migrations/005_review.sql（D1；SQLite 没有 ADD COLUMN IF NOT EXISTS，重复执行报 duplicate column 是预期的，写进文件头注释）
ALTER TABLE records ADD COLUMN appeal_outcome TEXT;  -- NULL | upheld | overridden
ALTER TABLE records ADD COLUMN reviewed_at    TEXT;  -- datetime('now') 形状
ALTER TABLE records ADD COLUMN reviewed_by    TEXT;  -- 复核的管理员 users.id，不加外键（同 settled_by）
ALTER TABLE records ADD COLUMN prior_verdict  TEXT;  -- JSON：第一次改判前的 {source, headline, reasoning, factors, delta}

-- server/migrations/0008_review.sql（PG）
ALTER TABLE records ADD COLUMN IF NOT EXISTS appeal_outcome text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS reviewed_at    text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS reviewed_by    text;
ALTER TABLE records ADD COLUMN IF NOT EXISTS prior_verdict  text;
-- 然后 CREATE OR REPLACE FUNCTION records_outbox()：完整照抄 0004_dm.sql 里的最新函数体，只加下面一个分支，
-- 位置在「judging → decided」分支之后、admin_override 分支之前
  ELSIF NEW.status = 'decided' AND OLD.status = 'appealed' AND NEW.appeal_outcome = 'upheld' THEN
    -- 必须排在 admin_override 分支前：改判过的案件再申诉、再维持时，那个分支的
    -- 「OLD.status = 'appealed'」条件也会命中，会误发「改判」私信。
    PERFORM outbox_emit('dm.upheld', 'user', NEW.subject_id, 'dm:case:' || rid || ':upheld', dm, NULL);
```

触发器 `records_outbox` 本身（`AFTER INSERT OR UPDATE OF status, delta, deadline_at`）不用重建。`schema.sql` 的 `records` 表同步加四列；`package.json` 加 `db:migrate5:local` / `db:migrate5:remote`（照 `db:migrate4:*` 写）。`server/src/import-d1.ts` 按导出的列名通用导入，不用改代码。

**修改（后端）**
- `worker/types.ts`：`RecordRow` / `RecordJoinRow` 加四列；`RecordItem` 加 `appeal_outcome: 'upheld' | 'overridden' | null`、`reviewed_at: string | null`、`prior_verdict: (Verdict & { delta: number }) | null`（`reviewed_by` 不进 JSON）。
- `worker/case-reads.ts`：`RECORD_SELECT` 加 `r.appeal_outcome`、`r.reviewed_at`、`r.prior_verdict`；`toRecordItem` 用 `parseFactors` 同样的防御写法解析 `prior_verdict`（坏值当 null）；`redactRecord` 对外人把 `prior_verdict` 置 null（和判词一样，只给当事人、立案人、裁判、管理员），`appeal_outcome`、`reviewed_at` 公开。
- `worker/cases.ts`：
  - 新 `upholdCase(db, caller, id)`：非管理员 403「需要管理员权限」；状态不是 appealed → 400「只有申诉中的案件可以维持原判」；`UPDATE records SET status = 'decided', appeal_outcome = 'upheld', reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ? AND status = 'appealed'`，改了 0 行 → 409「记录状态已变化，请刷新后重试」。不动 `score_events`。
  - `overrideCase` 的 UPDATE 加 `prior_verdict = COALESCE(prior_verdict, ?)`（绑定改判前的 verdict + delta 的 JSON，所以连改两次留的仍是最初的判决）；`rec.status === 'appealed'` 时再写 `appeal_outcome = 'overridden', reviewed_at = datetime('now'), reviewed_by = ?`。从 decided 直接改判（没申诉过）不写 `appeal_outcome`，当事人之后仍可申诉一次。
  - `appealCase`：`rec.appeal_outcome !== null` → 400「这起已经复核过了」；UPDATE 的 WHERE 加 `AND appeal_outcome IS NULL`（防并发）。
- `worker/routes-admin.ts`：`app.post('/api/admin/records/:id/uphold'`，`requireAdmin` 后调 `upholdCase`，返回 `{ record: redactRecord(record, caller) }`。不读请求体（见第 7 节第 2 条）。READ_ONLY 时照现有中间件返回 503。
- `server/src/discord/dm.ts`：`DmKind`、`DM_KINDS` 加 `'dm.upheld'`；`dmStillRelevant` 的新 case：`record.status === 'decided' && record.appeal_outcome === 'upheld'`；`renderDm` 的新 case：标题「你的申诉已复核：维持原判」，字段同 `dm.overridden`（类型、分数），一个打开案件的链接按钮；不带申诉理由。`server/src/outbox/dispatcher.ts` 的 `NEWS_KINDS` 加 `'dm.upheld'`（过 24 小时不再补发）。

**修改（前端）**
- `src/types.ts`：`RecordItem` 加可选 `appeal_outcome?`、`reviewed_at?`、`prior_verdict?`（旧 API 没有）。`src/api.ts`：`upholdRecord(id): Promise<{ record: RecordItem }>`（`POST /api/admin/records/:id/uphold`）。
- `src/components/CaseActions.tsx`：管理员、`status === 'appealed'`、**且 `record.appeal_outcome !== undefined`**（新 API）时，在「改判」之前加「维持原判」，点了用 `ConfirmInline` 原地确认（「维持原判？当事人不能再申诉这一起。」「再想想」「确认维持」，焦点落在「再想想」）；「申诉」只在 `appeal_outcome` 为 null 或缺省时出现。
- `src/components/VerdictCard.tsx`：`appeal_outcome === 'upheld'` 时判决区下加一行「申诉已复核：维持原判」；有 `prior_verdict` 时加 `<details>`，summary「看原判」，内容是原判的来源、标题、理由、分数（纯文本）。「该选手已申诉」等锁定文案不动。
- `src/components/AppealSheet.tsx`：说明区加一句「每起案件只能申诉一次。」（spec §3.10：§11 第 6 条拍板为每起一次且后端限制已上线，才可以写）。

**文案出处**：spec §8 B4-1、§3.8 操作栏表「管理员 · 申诉中」、§3.11、§4.2「申诉」行、§3.10 AppealSheet。

**测试**
- 新 `tests/worker/appeal-review.test.ts`：维持原判后状态 decided、delta 和判词不变、`appeal_outcome = 'upheld'`、`reviewed_at` 有值、`score_events` 没有新行；非管理员 403；decided 状态 400；重复维持 409；维持后再申诉 400「这起已经复核过了」；申诉中改判 → `overridden` + `prior_verdict` 存原判；连改两次 `prior_verdict` 仍是最初的；decided 直接改判不写 `appeal_outcome`、之后能申诉一次、复核后不能再申诉。
- `tests/worker/record-privacy.test.ts` 末尾追加：外人拿到的 `prior_verdict` 是 null，`appeal_outcome` 照常可见；当事人、管理员能看到 `prior_verdict`。
- `tests/pg/dm.test.ts` 追加：维持原判产生一条给当事人的 `dm.upheld`；先改判、再申诉、再维持 → 只有 `dm.upheld`，没有新的 `dm.overridden`；申诉后改判 → 只有 `dm.overridden`。`server/test/dm-render.test.ts` 追加 `renderDm('dm.upheld', …)` 的标题、字段、不含申诉理由。
- `tests/pg/import-d1.test.ts` 追加：四列原样导入；005 之前的导出这四列为 NULL。
- 新 `tests/dom/uphold-ui.test.tsx`：管理员看到「维持原判」、确认后 POST 正确路径；`appeal_outcome` 缺省（旧 API）时没有这个按钮；复核过的案件当事人没有「申诉」；判决卡的「申诉已复核：维持原判」和「看原判」；AppealSheet 那句话。

**完成标准**：全部套件绿（PG 套件跑过新触发器分支）；`verdict-privacy`、`player-judge`、`appeal-sheet` 原样通过；`grep -rn "dm.case.upheld" src server worker tests` 为空。

### 第 3 步 · P4-5 分数原因与账本（B4-2）

**要做什么**：① 历史点带原因；② 榜单带本周数字；③ `/api/records` 加三个筛选。前端用它们做账本、走势图原因、本周变化。**不往 `score_events.reason` 写任何自由文本。**

**后端**
- 新 `worker/score-reasons.ts`（纯）：`reasonKind(reason): { kind: 'case' | 'heal' | 'admin'; record_id: number | null } | null`。`record:N`、`override:N`、`revoke:N` → `case` + N；`weekly_heal` → `heal`；`admin_adjust` → `admin`；不认识的 → null（点上不带 kind）。
- `worker/db.ts` 的 `getUserProfile`：每个事件点加 `kind`、`record_id`（null 时不加）；开头那个 `BASE_SCORE` 起点不带。`HistoryPoint` 加可选 `kind?`、`record_id?`。
- 新 `worker/score-stats.ts`：`weekStatsFor(db, weekFromSql): Promise<Map<string, WeekStats>>`，三条 GROUP BY 批量查，不做 N+1；`/api/leaderboard` 路由用 `weekStartUtcSql(resetOffsetHours(c.env.RESET_TZ_OFFSET))` 调它，把字段并进每个 participant。bot `/top` 用的 `getLeaderboard` 不改。

  | 字段 | 含义 |
  |---|---|
  | `week_delta` | 本周（看板时区周一 0 点起）`score_events.delta` 之和，`reason NOT IN ('weekly_heal', 'admin_adjust')`（和 `worker/report.ts` 的 movers 同一口径） |
  | `week_on_time` | 本周生效（`record:<id>` 事件在本周）、状态 decided / appealed 的 `on_time_bonus` 记录数 |
  | `week_penalties` | 同上，`delta < 0` 的扣分记录数 |
  | `record_count` | 名下全部记录数，不含 `withdrawn`（取代前端按动态流前 50 条算的 `computeCounts`） |

- `worker/case-reads.ts` 的 `ListRecordsFilters` 加 `reporter?`、`escalationPending?`（`escalation_suggested = 1 AND status IN ('awaiting_statement','judging')`）、`before?`（`r.id < ?`）。`worker/routes.ts` 的 `GET /api/records`：`mine=filed`（未登录 401「未登录」，同 `mine=pending`）→ `reporter = caller.id`；`escalation` 只认 `pending`，其他值 400「无效的筛选」；`before` 走 `parseId`。结果照旧经 `redactRecords`。

**前端**
- `src/types.ts`：`HistoryPoint` 加可选 `kind?`、`record_id?`；新 `LeaderboardUser extends PublicUser`（四个字段都可选），`LeaderboardResponse.participants: LeaderboardUser[]`。`src/api.ts` 的 `RecordsQuery`：`mine?: 'pending' | 'filed'`、`escalation?: 'pending'`、`before?: number`，参数追加在 `mine` 之后（已有 URL 的顺序不变）。
- 新 `src/lib/scoreLedger.ts`（纯）：`buildLedger(history, records): LedgerEntry[]`（新的在前；`delta` = 相邻两点之差；`case` 的标签是「{案由}（{状态}）」，如「大迟到（已判决）」，带 `recordId` 链到 `playerCasePath`；记录不在列表里时写「案件 #N」；`heal` →「每周回血」，`admin` →「管理员调整」）、`weekDeltaFromHistory(history, nextResetAt)`、`reasonLabel(kind)`。
- 新 `src/components/ScoreLedger.tsx` + `score-ledger.css`（`.ledger`）：h3「分数怎么来的」，最新 10 条，其余收进 `<details>`「更早的 N 条」；任何一点都没有 `kind`（旧 API）时整块不渲染。放在 `PlayerDetail` 的聚焦案件之后、走势图之前；走势图改成 `<details>`「走势图」。
- `src/components/HistoryChart.tsx`：点按读数里加原因（`reasonLabel(point.kind)`，没有就不写）。
- `src/components/PlayerDetail.tsx`：名次后加「· 本周 ±0」（`weekDeltaFromHistory`；正数带 +，0 写 ±0，所有人都看得到——分数本来公开）。
- `src/App.tsx`：给 `Leaderboard` / `BoardMini` 的 `trends`、`counts` 在 participants 带了 `week_delta` / `record_count` 时用这两个字段，否则仍用 `computeTrends` / `computeCounts`。`src/lib/weekStars.ts` 加 `weekHighlightsFromBoard(participants)`（`week_on_time >= 2 && week_penalties === 0`，并列全部列出），`WeekHighlights` 在字段齐全时用它，门槛取消；字段缺省时照旧。
- `src/components/MyScoreLine.tsx`：可选 `weekDelta?: number`，有值时在名次后加「 · 本周 −4」（0 写「±0」）。可访问名「82 分 · 第 2 名」那段不变（`my-score-line.test.tsx` 锁）。

**文案出处**：spec §3.8（账本示例、「本周 ±0」）、§3.2（「· 本周 −4」）、§5 第 1、12 条、§6.4 密度、§10 第 11 条。

**测试**
- 新 `tests/unit/score-reasons.test.ts`、`tests/unit/ledger.test.ts`（`scoreLedger.ts`：相邻差、标签、链接、未知记录、本周边界跨看板周一）。
- 新 `tests/worker/score-explain.test.ts`（D1 + PG）：history 的 kind / record_id；榜单四个字段（回血和改分不进 `week_delta`、撤销进、上周的不算、周一 0 点边界按看板时区、`withdrawn` 不进 `record_count`）；`mine=filed` 访客 401、只返回我立的；`escalation=pending` 只出判决前且有建议的；`before` 游标；外人照样被脱敏。
- 新 `tests/dom/score-ledger.test.tsx`：账本三种标签和链接；旧 API 没有 kind 时没有账本、走势图照旧；走势图点按出原因；`MyScoreLine` 的 `weekDelta`；`WeekHighlights` 用榜单字段时低分的人也能拿、无门槛。

**完成标准**：全部套件绿；`board.test.tsx`、`my-score-line.test.tsx`、`history-chart.test.tsx`、`week-stars.test.ts` 原样通过（不传新字段时行为不变）；没有任何代码往 `score_events.reason` 写新的取值。

### 第 4 步 · P4-6 待办共用（B4-3）

**要做什么**：新 `worker/todo.ts` 的 `listTodo`，`GET /api/me/todo` 和 bot `/todo` 都调它；收件箱改用这个接口（404 退回 P3 的拼装模式）并加「可撤案」卡。

```ts
// worker/todo.ts —— 返回形状（网页 JSON 与 bot 共用）
export type TodoEntry =
  | { kind: 'invite' | 'moved'; key: string; session: InvitedSessionItem }
  | { kind: 'statement'; key: string; record: RecordItem }
  | { kind: 'rollcall'; key: string; session: SessionItem }
  | { kind: 'escalation'; key: string; record: RecordItem }
  | { kind: 'appeals'; key: 'appeals'; count: number; oldest: RecordItem[] }  // 最多 TODO_APPEALS_SHOWN(10) 起，最早的在前
  | { kind: 'withdraw'; key: string; record: RecordItem };
export interface TodoCounts {
  statements: number; invites: number; moved: number; rollcalls: number;
  escalations: number; appeals: number; withdrawable: number;
}
export interface TodoList { items: TodoEntry[]; counts: TodoCounts }   // items 按 kind 分组、组内按时间升序；不做 §3.2 的总排序（那是前端 sortTodo 的事）
export async function listTodo(db: D1Database, user: User, now: number): Promise<TodoList>;
```

| kind | 来源（key 的写法和 P3 `collectTodo` 一致） |
|---|---|
| `statement` | `listRecords(db, { pendingFor: user.id })` |
| `invite` / `moved` | `listMyInvites(db, user.id)`；`invite_reason === 'moved'` → moved |
| `rollcall` | 我组织、`status = 'open'`、`now ≥ starts_at + (duration_min ?? DEFAULT_DURATION_MIN) 分钟`；单独一条查询（从 `worker/sessions.ts` 导出 `SESSION_SELECT`、`toSessionItem` 给它用，不往已超 800 行的 sessions.ts 里加函数） |
| `escalation` | 管理员：`listRecords({ escalationPending: true })`；裁判：再加 `reporter: user.id`；都不是 → 无（点名产生的案件，立案人不是裁判，只进管理员的收件箱，spec §3.3） |
| `appeals` | 管理员且 `pendingCounts().appeals > 0`：`count` + 最早的 10 起（把 bot 的 `oldestAppeals` / `APPEALS_SHOWN` 挪进来） |
| `withdraw` | `listRecords({ reporter: user.id, status: 'awaiting_statement' })`：我立的、对方还没写说明的 |

**修改**
- `worker/routes.ts`：`app.get('/api/me/todo'`，`requireUser`（访客 401），`privateToViewer(c)`，每个 `record` 经 `redactRecord(…, caller)`，`oldest` 同理。
- `server/src/discord/commands.ts` 的 `handleTodo`：改调 `listTodo(ctx.db, user, Date.now())`。字段顺序与名字：「待写陈述（N）」→「改时间了（N）」→「待回应的约局（N）」→「待点名（N）」→「待确认升级（N）」→「待复核的申诉（N）」（已有三个的名字和相对顺序不变；bot 用词仍是「陈述」）；不显示 `withdraw`；除 `withdraw` 外没有任何项时回「没有待办，清清爽爽 ✨」。新行用现有 helper（`safeLine`、`discordTime`、`goTo`、`webUrl`），链接只有 bot 自己写的 `/?case=N`、`/?session=N`：改时间「🔁 **{局名}** · {新时间} · 你之前说「{RSVP_LABEL}」 · [查看]」，待点名「**{局名}** · {时间} 开局 · [去点名]」，升级「{当事人} · {案由} → 是团灭级吗？ · [去看看]」。`COMMANDS` 里 `/todo` 的描述补上「待点名、待确认升级」（bot 启动时 `bot-main.ts` 会重新注册）。按钮「去网页处理」本来就链到 `/`。
- `src/types.ts`：`ServerTodoEntry`、`TodoResponse`（照上面形状）。`src/api.ts`：`getTodo(): Promise<TodoResponse | undefined>`（404 → undefined，同 `getDiscordLink`）。
- `src/lib/todo.ts`：`TodoKind` 加 `'withdraw'`，`TodoItem` 加 `{ kind: 'withdraw'; key: 'withdraw'; records: RecordItem[] }`（服务端每起一条，这里合成一张卡）；`todoRank` 给它 10；`todoBadgeCount` 不计它（第 7 节第 3 条）；新 `buildTodoFromServer(server, local)`：把服务端各项换成 `TodoItem`（说明卡照旧用 `isUrgent` 算 `urgent`；申诉卡 `earliest = oldest[0] ?? null`），再加上只有前端知道的 `dm-broken`、`unbound`、`soon`、`cancelled`（沿用 `collectTodo` 的规则），按 key 去重后 `sortTodo`。
- 新 `src/lib/withdrawHint.ts`（纯，P4-2 的 `CaseResult` 也用）：`withdrawHint(createdAt, now): { phase: 'grace'; msLeft: number } | { phase: 'sent' }`，分界是 `created_at + FILED_DM_GRACE_MS`。
- `src/lib/useTodoSources.ts`：`Promise.allSettled([getTodo(), getDiscordLink()])`；`TodoExtra` 加 `server: TodoResponse | null`。`getTodo` 是 undefined（404）或失败时才按 P3 的规则补请求 appealed 列表。App：`extra.server ? buildTodoFromServer(…) : buildTodo(…)`。
- `src/components/TodoCard.tsx`：可撤案卡「你刚记的 N 笔，对方写说明前都能撤案」；最新那起还在 3 分钟内时写「3 分钟内撤案，对方不会收到私信（还剩 m:ss）」，之后换成「对方已收到私信；撤案后私信会改成『已撤回』」；N = 1 时按钮「撤案」（`withdrawCase`，成功 toast「已撤案。」，卡片消失、焦点回「要你处理」），N > 1 时链接「去审理 ›」（`/review`，第 7 步上线；之前先链到最新那起的案件页）。时钟用 `useNow(REVOKE_TICK_MS)`。

**文案出处**：spec §3.2 空状态、§3.3 可撤案卡与数据来源、§4.2「待办」行、§3.10 撤案规则。

**测试**
- 新 `tests/worker/todo-list.test.ts`（D1 + PG）：每类的条件和边界（`duration_min` 为 null 按 120；开局前不算待点名）；裁判只看到自己立的升级、管理员看到全部、不是裁判的组织者看不到；别人的案件和邀请不出现；`withdraw` 只有我立的待说明案件；`GET /api/me/todo` 访客 401、`Cache-Control` 是 private。
- `tests/pg/bot-commands.test.ts` 的 `/todo` describe 追加：三个新字段的名字、内容和链接（链接仍只匹配 `/?case=` / `/?session=`）；原有四个用例原样通过。
- `tests/unit/todo.test.ts` 追加：`buildTodoFromServer` 的映射、可撤案合并成一张、rank 10、不计数、本地四类保留、去重；`withdrawHint` 两段。
- `tests/dom/todo-inbox.test.tsx` 追加：接口可用时**不再请求** `/api/records?limit=50&status=appealed`；404 时和 P3 完全一样；可撤案卡 3 分钟前后只换提示、按钮一直可用、点了 POST `/api/records/:id/withdraw`；N > 1 时是链接。
- 改 `tests/dom/app-refresh.test.tsx` 那个登录用例（有意改动 #3）：URL 集合加 `/api/me/todo`（fixture 对它返回 404，走降级，原有 URL 一个不少）。

**完成标准**：全部套件绿；访客首屏 6 个 URL 不变；`grep -rn "oldestAppeals" server/src` 为空（已挪进 `worker/todo.ts`）。

### 第 5 步 · P4-1 我的、selfHint、段位色、bot `/score`

**要做什么**：`/me`、`/me/notify`、`/me/profile` 三页；selfHint；段位只在本人视图出现并在网页重映射颜色；入口改链接；bot `/score` 本人改用 selfHint（§11 第 14 条）。

**新建**
- `src/components/MePage.tsx` + `me-page.css`（`.me`）：`Modal variant="page"` + h2「我的」。DOM 顺序照 spec §3.9：`MyScoreCard`（只给上榜的人；没上榜时一句「你还没上榜，想上榜去「身份与名字」。」）→「我的约局」`<nav aria-label="我的约局">` 里三个链接「我答应的 N」`/me?list=going`、「我组的 N」`/me?list=organized`、「历史 ›」`/sessions/history`，当前项 `aria-current="page"`，下面是 `SessionCard` 列表（不传 `onAnswer`，数据是 `RouteView` 已有的 `mySessions`）→「我的案件 待写说明 N · 申诉中 N · 已判 N ›」（`playerPath(me.id)`）→ 设置行「通知与 Discord ● 私信正常 ›」「身份与名字 上榜选手 ›」「30 秒看懂规则 ›」（`/board/rules`）→「退出登录」。访客：`LoginLink returnTo={ME_PATH}`。「审理 ›」和「拉朋友进来 ›」两行在第 7 步加。本页自己取一次 `getUserDetail(me.id)`（案件计数和本周明细）。
- `src/components/MyScoreCard.tsx`（`.msc`）：`{ me, rank, config, weekDelta?, weekLines? }`。48px 分数 +「· {段位名}（只有你看得到）」+ `TierBadge` + selfHint + `healPreviewText(healPreview(…))` +「本周：大迟到 −6（10/21）· 守约守时 +2 ×1」（`buildLedger` 里本周的 `case` 项按案由合并；没有就不写这一行）+「看明细 ›」（`playerPath(me.id)`）。
- `src/components/NotifySetup.tsx` + `notify-setup.css`（`.ntf`）：① 加入 Discord 服务器（`DISCORD_INVITE_URL`，没配就整行隐藏）；② `<DiscordLinkCard onStatus={…} />`（绑定 / 解绑文案不变）+「绑定后：被约、改时间、该写说明都会私信你，在私信里能一键报名。」；③ 私信提醒开关（`<button role="switch" aria-checked>`「私信提醒」，调 P2-5 的 `setDiscordNotify(on)`）；`dm_ok === false` 时 `--attn` 提示「Bot 上次给你的私信没发出去。确认你还在服务器里，并打开「允许服务器成员私信」，然后点 [我改好了]」，「我改好了」= `setDiscordNotify(true)`。没绑时不显示 ③；`notify_dm` 缺省或开关接口返回 undefined（旧后端）时 ③ 换成「在 Discord 里用 /notify 开关」；`DiscordLinkCard` 自己因 404 不渲染时 ②③ 都不出。**不增加请求**：③ 的数据全来自 `onStatus`。
- `src/lib/tierColor.ts`（纯）：`webTierColor(tier)`，只把「需要盯一下」换成 `#d98e04`，其余返回 `tier.color`；`NEUTRAL_CHART_COLOR`（别人的走势图用，取 `theme.css` 里 `--text` 的同一个值）。`shared/scoring.ts` 的 hex 不动，bot 不受影响。

**修改**
- `shared/scoring.ts`：`Tier` 加 `selfHint: string`，`TIERS` 六档按 spec §5 selfHint 表逐字填。`blurb` 保留（AI 提示词等仍可用），网页和 bot 都不再显示它。
- `src/lib/routes.ts`：三条 `me*` 路由；`src/components/RouteView.tsx` 三个 case（都包 `PageShell`）；`/me/profile` 渲染 `<OnboardingDialog variant="page" …/>`。`RouteView` 加可选 `discord?`（App 里 `useTodoSources` 已有的 `discord`）、`todo?`（收件箱 items）、`onProfileSaved?`（App 现有的首登 `onSaved` 处理）：`/me` 设置行的「私信正常 / 私信送不到 / 还没绑」和第 7 步的「审理 · N 件」都从这里读，不另发请求。
- `src/components/OnboardingDialog.tsx`：可选 `variant?: 'center' | 'page'`（page：`Modal variant="page"` + `PageBar`「返回」→ `goBack()`，保存成功后也 `goBack()`）。三个选项和文案不变；`/me/profile` **不提供「先看看」**（spec §3.9）。
- `src/components/DiscordLinkCard.tsx`：可选 `onStatus?(link: DiscordLinkInfo | null | undefined)`，GET 落地时、解绑后各调一次；不传时行为不变。`DiscordLinkedNotice`：可选 `notifyTo?`，给了就加链接「去设置私信 ›」（P1 推迟到 P4 的那条）。
- 入口：`AccountMenu` 加可选 `profileTo?`、`notifyTo?`（给了就把「编辑身份」「通知与 Discord」渲染成 `<Link>`，不给照旧调 `onOpenOnboarding`）；App 给 `BottomTabs` 的 `myPath`、给 `AccountMenu` 的 `myPath` 都换成 `ME_PATH`，`BottomTabs` 在 `me` / `meNotify` / `meProfile` 上给「我的」`aria-current`；`MyScoreLine` 的 `onOpen` → `navigate(ME_PATH)`；`TodoInbox` 的 `onOpenNotify` → `navigate(ME_NOTIFY_PATH)`（P3 两类设置卡的过渡结束）。
- 段位只给本人（spec §5 第 8 条、§6.2）：`PlayerDetail` 看别人时不渲染 `TierBadge`、`pd__blurb`，头像不带段位环，走势图用 `NEUTRAL_CHART_COLOR`；看自己时把那段换成「只有你看得到」块：`TierBadge` + selfHint（+ 原有的回血预告）。`TierBadge` 的 `title` 改用 `selfHint`，颜色走 `webTierColor`，「需要盯一下」加类 `.tier-badge--outline`（描边 + 图标，和高段位的填充在形状上也不同）；`ScoreGauge`（tone tier）、本人头像环、`MyScoreCard` 同样走 `webTierColor`，经 CSSOM 设 `--tier`。`RulesPanel` 的段位表加一列 selfHint（spec §5 第 13 条）。
- `server/src/discord/commands.ts` 的 `handleScore`：本人分支 `tier.blurb` → `tier.selfHint`；查别人照旧只给分数。

**文案出处**：spec §3.9（三页线框、不增加请求、旧后端的降级说法）、§5 selfHint 表与第 8 条、§6.2 段位色、§2.1 头像菜单、§4.2「/score 本人说明」行、§4.4 第 1、2 条。

**测试**
- `tests/unit/scoring.test.ts` 追加：六档 selfHint 逐字。`tests/unit/contrast.test.ts` 追加：`#d98e04` 与 `--action` 金色的亮度比 ≥ 1.6。新 `tests/unit/tier-color.test.ts`。
- 新 `tests/dom/me-pages.test.tsx`：`/me` 访客 / 上榜 / 没上榜三种；三个筛选是链接且有 `aria-current`、没有 `role="tab"`；`/me/notify` 的 `/api/me/discord` **正好 1 次**；开关 POST `{ on }`；`dm_ok: false` 的提示和「我改好了」；旧后端两种降级；`/me/profile` 三个 radio、没有「先看看」、409 时 `role="alert"` 显示下榜保护原文；底栏「我的」的 `aria-current`。
- 新 `tests/dom/player-privacy.test.tsx`：别人的选手页没有 `.tier-badge`、没有 blurb / selfHint、仪表 `aria-label` 不含段位；自己的有「只有你看得到」和 selfHint。
- `tests/dom/discord-link.test.tsx` 追加：`onStatus` 调用一次、带回 GET 的结果；原有「请求数为 1」照常。
- `tests/pg/bot-commands.test.ts` 的 `/score` 追加：本人回复第二行就是 selfHint；查别人仍不含任何段位名。

**完成标准**：全部套件绿；`board.test.tsx`（首页 `.lb .tier-badge` 正好 1 个）、`onboarding-roles`、`score-gauge`、`my-score-line` 原样通过；`grep -rn "\.blurb" src server/src` 为空。

### 第 6 步 · P4-2 写说明页、案件页、立案页

**要做什么**：`/cases/:id/statement`、`/cases/new` + `CaseResult`、案件页的 `CaseTimeline` 和 `CaseActionBar`；所有「写说明」「记一笔」入口改成跳页。

**新建**
- `src/components/StatementRoute.tsx`：读 `caseId`，用 App 已有的 pinned 记录或 `getRecord(id)`；我是当事人且 `status === 'awaiting_statement'` → `<StatementDialog variant="page" …/>`；否则 `navigate(playerCasePath(subject.id, id), { replace: true })`（案件页会说明现在到哪一步）；404 / 500 → 原文案「链接里的案件不存在了。」/「打不开链接里的案件，稍后再试。」；访客 → `LoginLink`。有 `session_id` 时再取一次 `/api/sessions/:id` 拿局名，用于「阿飞 记了你一笔：大迟到（周五五排）」，失败就不写括号。
- `src/components/CaseNewRoute.tsx`：只给裁判和管理员（其他人渲染 `NotFound`，访客 `LoginLink`）；`?session=` 有效时取那局，`CaseDialog` 预填「报了来、在榜、不是我」的人和「来自约局：{局名}（已预填到场的人）」；提交后整页换成 `CaseResult`。
- `src/components/CaseResult.tsx` + `case-result.css`（`.cres`）：

```ts
interface CaseResultProps {
  input: NewCaseInput;          // 重试失败的人时原样再交一次，只换 subject_ids
  result: FileCasesResponse;    // { records, failed }
  me: User;
  config: Config;
  sessionId: number | null;     // 有就给「回到这局」
  onAgain: () => void;          // 「再记一笔」：清空表单回到填写态
}
```
  标题「记好了 · N 起」；每起一行「{当事人} · {案由}（AI / 保底判，AI 没参与）{区间} · {状态}」+「改案由 ▾」（`reclassifyCase`）；有升级建议的加「⚠ AI 建议团灭级」和「确认是团灭级」「不升级」（把 `PlayerDetail` 里的 `EscalationButtons` 抽到 `src/components/EscalationButtons.tsx`，文案不变）；失败的「失败：{名字} · 稍后再试」+「重试」；仍待说明的有一行撤案：`withdrawHint` 在 grace 时「3 分钟内撤案，对方不会收到私信（还剩 m:ss）」，之后「对方已收到私信；在对方写说明之前仍可撤案，私信会改成『已撤回』」，按钮「撤案这 N 起」**一直可用**；加分（立案即判决）不进撤案。底部「回到这局」「再记一笔」。
- `src/lib/caseResult.ts`（纯）：`filingWaitText(n)`：`n × CASE_FILING_SECONDS_PER_SUBJECT ≤ 60` →「可能要 1 分钟左右」，否则「可能要 1–3 分钟」。提交中显示「提交中：AI 正在逐个归类 N 个人，{filingWaitText}，别关页面」+ 转圈，不显示 1/3。
- `src/lib/caseActions.ts`（纯）：`caseActionsFor(record, me, now): CaseActionSet`，照 spec §3.8 操作栏表：当事人待说明 → `statement`；当事人已判决且 `appeal_outcome` 为 null → `appeal`；立案人待说明、管理员待说明或裁决中 → `withdraw`；立案人已判决且 `REVOKE_WINDOW_MS` 内 → `revoke`（带 `msLeft`，过了就没有，不出负数），管理员已判决 → `revoke`（无时钟）；`isFilingJudge` 且有升级建议、判决前 → `escalation`；管理员申诉中 → `uphold`、`override`；其他人 → 空。`CaseActions` 里私有的 `revokeState`、`canWithdraw` 挪进来，`CaseActions` 改用它（行为只多一处：管理员能撤裁决中的案件，和后端 `withdrawCase` 一致）。
- `src/lib/caseTimeline.ts`（纯）+ `src/components/CaseTimeline.tsx`（`.ctl`）：`caseSteps(record, now)` → 立案（立案人 · 时间）/ 等当事人说明（截止 + 还剩）/ AI 裁决或保底判 / 申诉·复核（有才出），每步 done / current / todo；脱敏的记录照样能画（不写类型）。
- `src/components/CaseActionBar.tsx` + `case-action-bar.css`（`.cab`）：只给 `PlayerDetail` 的聚焦那一起用；手机 `position: sticky; bottom: 0`（留 `safe-area-inset-bottom`），桌面抽屉里就地显示。按钮名：「写说明 ›」「申诉」「撤案」「撤销 · 还剩 mm:ss」「确认是团灭级」「不升级」「维持原判」「改判」。其他人和访客不渲染。聚焦那张 `VerdictCard` 不再传 `actions` / 升级按钮（提示文字留在卡里），全页每个按钮只出现一处。

**修改**
- `src/components/StatementDialog.tsx`：可选 `variant?: 'center' | 'page'`；四个快捷开头按钮（`STATEMENT_STARTERS`）只往文本框插字，不提交。草稿 key、字数上限、隐私说明、提交前确认都是 P0-5 已有的，不改。
- `src/components/CaseDialog.tsx`：可选 `variant?`、`prefill?: { sessionTitle: string; subjectIds: string[] }`、`onFiled?(input, result)`（给了就不自己关，交给宿主显示 `CaseResult`）。人数上限仍读 `config.maxBatchSubjects`。
- `src/components/PlayerDetail.tsx`：聚焦案件上方加 `CaseTimeline`，操作走 `CaseActionBar`；`onOpenStatement` 的调用方改为 `navigate(caseStatementPath(id))`。
- `src/App.tsx`：删 `statementCase` state 和 App 里的 `StatementDialog`、`CaseDialog` 实例；`TodoInbox` 的 `onOpenStatement`、`RouteView` 的 `onOpenStatement` 都改为跳 `caseStatementPath`；`AccountMenu` 的 `onRecord` 改为 `navigate(caseNewPath())`。
- `src/components/SessionDetailDialog.tsx`：记录区下面给裁判和管理员加 `<Link to={caseNewPath(session.id)}>这局有人出事了？记一笔 ›</Link>`（P3 推迟过来的）。
- `src/lib/constants.ts` 末尾 `// --- P4 ---`：`STATEMENT_STARTERS = ['家里临时有事', '网络断了', '提前在群里说过', '我认']`、`CASE_FILING_SECONDS_PER_SUBJECT = 20`。

**文案出处**：spec §3.8（时间线、操作栏表、撤销窗口）、§3.10（立案页、`CaseResult`、写说明页、快捷开头、撤案规则）、§5 第 14 条、§7 H16、M12。

**测试**
- 新 `tests/unit/case-actions.test.ts`（§3.8 表逐行，含「窗口过了不出负数」「复核过不能申诉」）、`tests/unit/case-timeline.test.ts`、`tests/unit/filing-wait.test.ts`（`filingWaitText`）。
- 新 `tests/dom/case-result.test.tsx`（spec 点名）：3 人的等待文案；每行的案由、来源（保底判有明显标识）、状态；重试只交失败的那个人；**过了 3 分钟撤案按钮仍可用，只换提示语**；加分不出撤案；「确认是团灭级」文案不变。
- 新 `tests/dom/case-pages.test.tsx`：写说明页（快捷开头只插字、没有 POST；提交前确认；不是当事人被 replace 到案件页；404 原文；底栏隐藏）；案件页手机布局的操作栏按角色出按钮、全页只有一个 `#case-N`、每个按钮只出现一次；`/cases/new?session=` 预填；非裁判看到 NotFound；约局详情的「记一笔」只给裁判和管理员。

**完成标准**：全部套件绿；`deep-link`、`p8-app`（`/api/records/7` 仍只请求 1 次）、`player-judge`（「够得上『团灭级放鸽』」）、`drafts`（单独渲染 `StatementDialog` / `CaseDialog`）、`verdict-privacy` 原样通过；`App.tsx` 不超过 520 行。

### 第 7 步 · P4-3 审理、管理、入伙、先看看

**要做什么**：`/review`、`/admin`、`/join` 三页；首登「先看看」；剩下的入口接好。

**新建**
- `src/components/ReviewPage.tsx` + `review-page.css`（`.rvw`）：只给裁判和管理员（其他人 `NotFound`，访客 `LoginLink`）。h2「审理」+「＋ 记一笔」（`caseNewPath()`）。三块，空的整块不出；三块都空时「没有待办，清清爽爽 ✨」：
  - 待确认升级：裁判 `getRecords({ mine: 'filed', escalation: 'pending' })`，管理员 `getRecords({ escalation: 'pending' })`，再用 `isFilingJudge` 过滤；每行「{当事人} · {案由} → 是团灭级吗？」+ `EscalationButtons`。
  - 待复核申诉（只给管理员）：`getRecords({ status: 'appealed', limit: 50 })`，最早的在前；每行「{当事人} · {案由} {分数} · 申诉理由：「…」」（没写就不出这段）+ `CaseActions`（维持原判、改判、撤销；改判后原判在判决卡的「看原判」里）。
  - 我立的案：`getRecords({ mine: 'filed', limit: 50 })` 里 `caseActionsFor` 给出 `withdraw` 或 `revoke` 的，「{当事人} · {案由} · 待说明」+「撤案」，或「… · 还能撤销 mm:ss」+「撤销」；窗口过了就不列。
- `src/components/AdminPage.tsx` + `admin-page.css`（`.adm`）：只给管理员。h2「管理」+ `<nav aria-label="管理">` 两个 `<Link>`「AI 裁判」`/admin?tab=ai`、「周报」`/admin?tab=report`，当前项 `aria-current="page"`，不用 `role="tab"`（「全部账号」P5 前不出）。AI 子页 = `<AdminAiPanel variant="page" />`；周报子页 = 最新一期 `WeeklyReportCard`（全文，管理员已有的「换个说法」就是 `regenerateReport`）。
- `src/components/JoinPage.tsx` + `join-page.css`（`.join`）：照 spec §3.12（`RouteView` 加可选 `onOpenOnboarding?` 给第 ② 步用）。带 `?session=` 时顶部一张只读 `SessionCard`（不传 `onAnswer`）；四步：① 登录（`LoginLink returnTo={joinPath(id)}`，登录后打勾）② 选身份（按钮打开 App 的 `OnboardingDialog`，不另做选择器；已有身份或有 `edg.onboarded` 标记时打勾）③ 加入 Discord 服务器（`DISCORD_INVITE_URL`，没配就隐藏）④ 绑定 Discord（`DiscordLinkCard`，`onBeforeBind` 里先写 `saveLoginReturn(undefined, joinPath(id))`；已绑打勾；404 时整步隐藏）+「没绑也行，打开网页就能报名。」；底部「去报名这局 →」或「进大厅 →」。每次顶层跳转前都写一次 `edg.return`；绑定回来落在 `/?linked=discord`，P1-3 的 `useLoginResume` 读到它就回 `/join`。本页不发任何写请求。
- `src/components/InviteFriendsCard.tsx`（`.ifc`）：桌面 aside 末尾一张小卡「拉朋友进来」+ 按钮「复制入伙链接」（`copyText(origin + '/join')`，成功 toast「链接已复制。」）。P3 因为 `/join` 不存在而没做（spec §2.4）。

**修改**
- `src/components/AdminAiPanel.tsx`：可选 `variant?`；试跑按钮旁加「用已保存的配置试跑」；把提示里的 `wrangler secret put AI_API_KEY` 换成和部署方式无关的说法「在后端环境变量里设置 AI_API_KEY」（M28 后半）。
- `src/components/OnboardingDialog.tsx`：`!me.is_participant && !me.is_judge` 时（首登、从没有身份）在三张卡之后加第 4 个 radio「先看看」，说明「也可以先看看，以后在『我的』里随时上榜。」（**不能**写「裁判资格由管理员授予」，`onboarding-roles.test.tsx:42` 要求它正好 2 次），对话框开头加「上榜后，你的分数会公开在榜上，答应了却没来会被记一笔。」；这类用户不预选任何选项。选「先看看」保存为两个 false（走现有 `/api/me/roles`，不加请求），并写 `localStorage['edg.onboarded.<userId>'] = '1'`。`page` 形态（`/me/profile`）不出「先看看」。`src/lib/draftShapes.ts`：`OnboardingChoice` 加 `'watch'`，`validateOnboardingDraft` 接受它。
- `src/App.tsx`：绑定回来再问一次首登的那个 effect（锚点 `if (!me.is_participant && !me.is_judge) {`）先看 `edg.onboarded.<id>`，有就不问；删 `AdminAiPanel` 弹窗实例，`AccountMenu` 加 `reviewTo={REVIEW_PATH}`（裁判、管理员）、`adminTo={adminPath()}`（管理员）——`AccountMenu` 再加这两个可选 prop，「审理」排在「记一笔」之前（spec §2.1）。
- `MePage`：裁判 / 管理员顶部加「审理 · N 件等你 ›」（N = 收件箱里 `escalation` 张数 + `appeals.count`）；设置区加「拉朋友进来 ›」（有 `navigator.share` 用它，否则 `copyText`，链接 `origin + '/join'`）。`TodoCard` 的申诉卡、可撤案卡（N > 1）「去审理 ›」改去 `REVIEW_PATH`。

**文案出处**：spec §3.11（审理、管理线框）、§3.12（入伙）、§4.4 第 3 条（先看看、首登讲后果、`edg.onboarded`）、§2.1（头像菜单）、§7 M21、M28、H15。

**测试**
- 新 `tests/dom/review-admin.test.tsx`：按角色出现的块和请求的 URL；申诉行显示理由、「维持原判」POST；「我立的案」只列能撤案 / 撤销的；空状态；非裁判 NotFound；`/admin` 子页链接与 `aria-current`、没有 `role="tab"`、`?tab=users` 落到 AI 子页、页面上没有 `wrangler` 字样、有「用已保存的配置试跑」。
- 新 `tests/dom/join-page.test.tsx`：四步与打勾；点登录和绑定前 `sessionStorage['edg.return']` 的 path 是 `/join?session=5`；只读约局卡没有「来」；整页没有 POST；Discord 404 时没有第 ④ 步。
- `tests/dom/onboarding-roles.test.tsx` 追加：没身份的人有第 4 个 radio「先看看」、什么都没预选、保存发 `{ is_participant: false, is_judge: false }` 并写 `edg.onboarded`；上榜选手仍是 3 个 radio；两种情况下「裁判资格由管理员授予」都正好 2 次。
- `tests/dom/discord-link.test.tsx` 追加：有 `edg.onboarded` 标记时绑定回来不再弹首登（`:267` 原用例照常）。`tests/unit/draft-shapes.test.ts` 追加 `'watch'`。
- 改 `tests/unit/login-return.test.ts`（有意改动 #2）：删掉 P3-4 改成的 `['a later-phase page', '/me']`（P4 之后没有「以后才有」的页面，`/xyz` 那条已覆盖未知页面），另加「`/me`、`/join?session=5`、`/cases/new?session=5` 被保留」。

**完成标准**：全部套件绿；`onboarding-roles` 原有断言全过；`login-return.test.tsx:416-431`（菜单里唯一的「退出登录」）原样通过；`grep -rn "wrangler" src/components` 为空。

## 4. 不能破的约束

先守 `docs/redesign-v5/HANDOFF.md` 第 4 节第 6 条（深链 `?case`、`?session`、`?linked`、`?onboarding` 永久兼容；spec §6.5 锁定文案和类名不改；CSP 不放内联 `<style>`、`style="…"` 字符串、`dangerouslySetInnerHTML`；DOM 顺序 = 视觉顺序；组件签名只加可选 props；新入口在接口 404 时静默隐藏），以及 P0–P3 的通用规则：CSS 约定（`css-conventions.test.ts` 自动查）；新按钮不叫裸的「取消」「确认」「关闭」；toast 不用 `role="alert"`；被 `tests/unit` 导入的 `src/lib` 模块必须纯；**只有 `src/lib/router.ts` 能碰 `window.history`（注释也算）**；不往 `src/theme.css` 加 token；不改 `Modal.tsx`、`modalStack.ts`；不新增 `act(...)` 警告（始终 3 条）；任何文件不超过 800 行，`App.tsx` 不超过 520 行，不往 `worker/sessions.ts` 加函数。

P4 特有：

1. **段位只在本人视图**：`TierBadge`、selfHint、段位色只出现在本人的选手页、`/me`、本人那一行；别人的选手页、榜单、名单、收件箱一律中性色，`ScoreGauge` 用 `tone="neutral"`。这是展示层约定，不是保密（spec §10 第 3 条），PR 描述照这个说法写。
2. **判决前脱敏照旧在后端做**：`/api/me/todo`、`/api/records` 的新筛选、`/review` 用到的每条记录都经 `redactRecord`；`prior_verdict`、`appeal_reason` 只给当事人、立案人、裁判、管理员。`listTodo` 只返回调用者自己的事。
3. **申诉理由可以不填，上限 `APPEAL_MAX`（500）**，网页 `maxLength`、后端截断、bot 弹窗都读 shared 的同一个常量；「只能申诉一次」的文字只在 B4-1 限制上线的同一个 PR 里出现。
4. **bot 文案「陈述」不变**（§11 第 15 条）：`/todo` 新字段也不写「说明」；「写陈述」「待写陈述（N）」「陈述快截止了」等被 `bot-commands`、`dm`、`p8-edges`、`session-cards` 测试锁着。
5. **D1 和 PG 行为一致**：新 worker 测试都放 `tests/worker/`，`vitest.pg.config.ts` 原样在 PG 上再跑一遍；SQL 只写两边都合法的（`CAST(… AS TEXT)`、`||`、`datetime('now', ?)` 带 `'-14 days'` 这样的修饰）；唯一的差别是 PG 有私信（`dm.upheld`），D1 没有，和现状一致。
6. **复用 P2-5 的私信开关**：`/me/notify` 只用已有的 `GET /api/me/discord`（经 `DiscordLinkCard` 的 `onStatus`）和 `POST /api/me/discord/notify`（`setDiscordNotify`），不加接口、不加请求；`discord-link.test` 的请求数仍是 1。
7. **不变的规则**（spec §8「明确不动的」）：`score_events.reason` 只存机器码；团灭级升级必须人工确认；说明只能交一次；`/api/records/:id/dispute` 旧别名保留；`safeNextPath`、cookie、CORS 不动。
8. **首屏请求**：访客仍正好 6 个；登录用户只多 `/api/me/todo`（它可用时反而少一个 appealed 列表）。新请求一律 `Promise.allSettled`，失败静默。
9. **只有这 3 处现有断言有意改动**（写进 PR 描述）：#1 `tests/unit/route.test.ts` 的 later-phases 列表删 7 个 P4 路径；#2 `tests/unit/login-return.test.ts` 删 `['a later-phase page', '/me']`；#3 `tests/dom/app-refresh.test.tsx` 登录用例的 URL 集合加 `/api/me/todo`。其余原有断言一律不改，只允许追加。

## 5. 数据库迁移与部署

| 引擎 | 文件 | 内容 |
|---|---|---|
| D1 | `migrations/005_review.sql` + `schema.sql` | `records` 加 `appeal_outcome`、`reviewed_at`、`reviewed_by`、`prior_verdict` |
| PG | `server/migrations/0008_review.sql` | 同样四列（`IF NOT EXISTS`）+ `CREATE OR REPLACE FUNCTION records_outbox()` 加 `dm.upheld` 分支 |

编号接在 P2-3 的 `004_lobby.sql` / `0007_lobby.sql` 之后（P3 没有迁移）。其余改动（B4-2、B4-3、B4-4）都没有迁移。

合并后的部署顺序：

1. **先备份**（现在还没有异地备份）：在 Coolify 的 postgres 容器里 `pg_dump -U edg -d edg -Fc > /tmp/edg-before-p4.dump`，拷到本机。D1 还在用的话也导一份：`npx wrangler d1 export edg-credit --remote --output=edg-before-p4.sql`。
2. **后端（Node + PG）**：GitHub Actions 构建好 `ghcr.io/nanako1900/gamescoreboard:latest` 后，在 Coolify **手动 Redeploy**；compose 的 `migrate` 服务会在 `app`、`bot` 启动前执行 `0008_review.sql`。确认：`/healthz` 返回 ok；`SELECT appeal_outcome FROM records LIMIT 1` 不报错；bot 日志出现 `registered N slash commands`（`/todo` 新描述生效）。
3. **D1 Worker**（还在用时）：先 `npm run db:migrate5:remote`，再 `npm run deploy`。顺序不能反：新代码的 `RECORD_SELECT` 读新列，没迁移会 500。
4. **前端**：Cloudflare Pages 从 main 自动部署。前端对旧后端都有降级（`appeal_outcome` 缺省 → 没有「维持原判」；`/api/me/todo` 404 → 拼装模式；`kind` / `week_*` 缺省 → 没有账本、照旧算本周），所以前后端谁先上都不会坏，但「维持原判」「可撤案卡」「账本」要等后端 Redeploy 后才出现。
5. 回滚：前端回滚到上一次部署即可；后端回滚镜像时迁移不用回退——四列和新触发器分支对旧代码无害（旧代码不写 `appeal_outcome`，那个分支不会触发；旧代码也没有维持原判接口）。

`DEPLOY.md` 的 D1 迁移清单加 `db:migrate5:*`；`docs/DEPLOY-DISCORD.md` 的私信类型列表加 `dm.upheld`；`docs/CONTRACT.md` 补两个新接口、`/api/records` 的三个参数、`/api/leaderboard` 和 `/api/users/:id` 的新字段。

## 6. 验证

每一步结束、提 PR 前都跑全量：

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck          # 三个 tsconfig
npm run test:unit
npm run test:dom           # 顺便数 act(...) 警告：仍是 3 条
npm run test:server        # dm-render 新用例
npm run test:worker        # D1：leave-board、appeal-review、score-explain、todo-list
npm run test:pg            # 同一批 worker 用例在 PG 上再跑 + dm、bot-commands、import-d1
npm run build
npm run build:pages        # dist 只有 _headers、assets/、index.html，没有 404.html
# 单跑一个文件：npx vitest run --config vitest.dom.config.ts tests/dom/<文件>
grep -rn "dm.case.upheld\|\.blurb\|oldestAppeals" src server/src worker    # 都应为空
grep -rn "wrangler" src/components                                           # 应为空
```

预期变化方向（相对开工基线）：unit 多 6 个文件（`score-reasons`、`ledger`、`tier-color`、`case-actions`、`case-timeline`、`filing-wait`），`todo`、`scoring`、`contrast`、`route`、`login-return`、`draft-shapes` 的用例数增加；dom 多 8 个文件（`uphold-ui`、`score-ledger`、`me-pages`、`player-privacy`、`case-result`、`case-pages`、`review-admin`、`join-page`），worker 多 4 个文件，pg 跟着多同样 4 个、外加 `dm`、`bot-commands`、`import-d1` 的用例；server 的 `dm-render` 用例增加。JS 体积会涨，把 build 输出的 kB 数写进 PR 描述。PG 已知抖动：`tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」负载高时可能超时，单独重跑确认，写进 PR 描述。

**手动检查（机主做；代理在 PR 里写「未手动验证」）**

375 × 812（手机）：
- [ ] `/me`：首屏看到分数卡（段位名 +「只有你看得到」+ selfHint + 回血预告 + 本周）；三个约局筛选能点；「退出登录」不被底栏挡住；没上榜的账号看到那句引导。
- [ ] `/me/notify`：三步；开关好点（≥ 44px），切换后状态对；把私信关掉让 bot 发一次失败，回来看到琥珀色提示和「我改好了」。
- [ ] 收件箱「写说明 ›」→ `/cases/:id/statement`：文本框字号不触发 iOS 缩放；快捷开头只插字；键盘弹起时「提交说明」可见；底栏隐藏；提交前有确认。
- [ ] 裁判「记一笔」→ `/cases/new`：提交中的等待文案；`CaseResult` 每行、改案由、撤案倒计时过 3 分钟后换提示且按钮还能点；底栏隐藏。
- [ ] 从 Discord 私信链接打开一起案件：时间线在上，操作栏贴底且不挡最后一张卡、刘海机底部留白；当事人 / 立案人 / 管理员看到的按钮不同，路人没有操作栏。
- [ ] 别人的选手页：没有段位徽章、段位说明和彩色环；自己的选手页有「只有你看得到」；账本和走势图点按的原因。
- [ ] `/review`、`/admin`、`/join` 三页在手机上按钮不挤、能换行；`/join` 走一遍登录和绑定能回到 `/join`。
- [ ] 新账号首次登录：对话框里有「先看看」、没有预选；选了之后去绑定 Discord，回来不再弹首登。

1280 × 800（桌面）：
- [ ] 头像菜单：我的 · 编辑身份 · 通知与 Discord ·（裁判）审理 · 记一笔 ·（管理员）管理 · 退出登录；前几项是链接、跳到对应页面。
- [ ] 选手抽屉里聚焦案件的操作栏是就地显示，不是贴底；Esc 只关最上层。
- [ ] `/admin` 两个子页的导航高亮；AI 子页没有「wrangler」字样；周报「换个说法」可用。
- [ ] 右栏末尾有「拉朋友进来」卡，复制出的链接是 `/join`。
- [ ] 系统开「减少动态效果」时没有多余动画；Windows 高对比下「需要盯一下」的描边徽章、操作栏按钮可辨。

## 7. 需要机主过目

以下是对 spec 的偏离或补充，写进 PR 描述：

1. **私信类型叫 `dm.upheld`**（spec 写 `dm.case.upheld`），和现有的 `dm.decided`、`dm.overridden`、`dm.revoked` 同一套命名，走同一条 `isDmKind` 分发；渲染放在 `server/src/discord/dm.ts` 的 `renderDm`（spec 写的「dispatcher.ts 的 renderDm」实际在 dm.ts）。
2. **维持原判不收备注**：spec B4-1 写了 `{note?}`，但新增列里没有存它的地方，私信也读不到。本期接口不读请求体。要留言就加一列 `review_note`（两个引擎各一句 ALTER，私信里带上），约 0.5 人日。
3. **可撤案卡**：服务端每起一条；收件箱合并成一张（N = 1 给「撤案」，N > 1 给「去审理 ›」）；**不计入**「大厅」角标和标签页标题（它是可选操作，不是欠着的事；P3 的取消通知同理）。只列我立的、对方还没写说明的案件，不另设时间窗口（说明窗口本身最多 12 小时）。
4. **申诉卡仍不写「最早的已等 N 天」**：库里没有申诉时间（`reviewed_at` 是复核时间）。要的话加 `appealed_at` 列。
5. **下榜保护的口径**：「14 天内已判决的扣分」按分数生效时间（`record:<id>` 事件）算，被撤销的不算；只挡非管理员把 1 改成 0，管理员接口和管理员本人不受限。
6. **`/cases/new?session=` 预填「报了来、在榜、不是自己」的人**：spec 文案写「已预填到场的人」，但立案多在结算前，没有到场数据；文案照 spec，只是预选，裁判可以改。
7. **别人的选手页变化较大**：去掉段位徽章、blurb、段位色头像环和走势图颜色（spec §5 第 8 条、§6.2）；规则页段位表加 selfHint 列（公开，spec §5 第 13 条）。
8. **两处小改动和新文案**：底栏在案件聚焦页（`/players/:id/cases/:caseId`）也隐藏，让给操作栏；spec 没给原句、本期新写的文案有：「你还没上榜，想上榜去「身份与名字」。」、维持原判的确认三句、「申诉已复核：维持原判」「看原判」「每起案件只能申诉一次。」、「已撤案。」、「拉朋友进来」「复制入伙链接」、bot `/todo` 三个新行的模板。

## 8. PR

- 分支 `claude/p4-cases-me-review`；标题：`feat: 案件页、我的、审理与管理，维持原判与共用待办（P4）`。commit 和 PR 描述都不加署名行。
- 描述要点：
  - **概要**：按七步列出做了什么（P4-7 下榜保护 → P4-4 维持原判与申诉次数 → P4-5 分数原因与账本 → P4-6 待办共用与 bot `/todo` → P4-1 我的与段位 → P4-2 案件三页 → P4-3 审理、管理、入伙、先看看），每步一两句，并说明后端先行的理由。
  - **迁移与部署**：两个迁移文件；部署前备份；Coolify Redeploy（`migrate` 服务自动执行 `0008`）；D1 先 `db:migrate5:remote` 再 `deploy`；前端对旧后端的降级。
  - **新接口与字段**：`GET /api/me/todo`、`POST /api/admin/records/:id/uphold`；`/api/records` 的 `mine=filed`、`escalation=pending`、`before`；`/api/leaderboard` 的 `week_delta`、`week_on_time`、`week_penalties`、`record_count`；history 点的 `kind`、`record_id`；`RecordItem` 的 `appeal_outcome`、`reviewed_at`、`prior_verdict`；新私信 `dm.upheld`；`/api/me/roles` 的 409。
  - **有意改动的 3 处现有断言**（第 4 节第 9 条），每处写改前锁什么、改后锁什么。
  - **偏离 spec 的地方**：第 7 节 8 条。
  - **验证**：六个套件 + 两个 build 的前后数字（文件 / 用例）、`act(...)` 警告仍为 3、JS 体积；PG 抖动如有就写明重跑结果；第 6 节手动检查清单（代理写「未手动验证」，由机主在 375 × 812 和 1280 × 800 上勾）。
  - **留给 P5**：`/admin` 全部账号（B5-1）、AI 试跑用草稿（B5-3）、并行归类（B5-4）；可选的 `review_note`、`appealed_at`；bot 改发 `/cases/N`。
