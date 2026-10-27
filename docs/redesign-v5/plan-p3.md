# P3 实施计划 · 大厅、组织者与信誉榜（一个 PR）

> 前端重设计 v5 第 3 期。方案：`docs/redesign-v5/spec.md`（§11 全部按推荐默认值拍板，P3 特别用到第 2、10 条）。
> 本文件把规划时对照代码核过的详细契约（没有入库，不需要读）压成一份：**P3 = 一个分支、一个 PR、七步**。文件名、组件名、props、路由、常量名以本文件为准；本文件没写到的细节回 spec 查，两者冲突时以 spec 为准（第 6 节列的偏离除外）。
> 计划里的行号只作提示，**定位一律以锚点文字为准**（和 P0–P2 一样）。

## 1. 目标与范围

把首页从「计分板」改成「以约局为中心的大厅」：登录用户一进来先看到「要你处理」（邀请、改时间、待写说明、该点名等），下面是按时间分组的约局时间线；组织者在约局详情里有一块按局状态切换的控制台；完整榜单、动态、战报、规则搬到独立的 `/board` 页；补齐 `/sessions/new`、`/sessions/:id/rollcall`、`/sessions/history` 三个页面；后端只改一处——周报按判决时间统计（B3-1）。spec §9 P3 合计 11.5 人日（后端 1 人日）。**没有迁移，没有新接口**。

做完后用户能看到：

- **手机首页（登录）**：要你处理 → 我的分数 → 约局（进行中 / 今晚 / 本周 / 更晚 / 已取消）→ 信誉榜前 5 名（不在前 5 时末尾补自己那行）→ 上周战报（compact）→ 最近结束（折叠）；底部四个标签「大厅·N」「信誉榜」「＋ 组一局」「我的」。访客：欢迎卡 → 约局 → 榜 → 战报 → 最近结束。
- **桌面首页（≥1024px）**：左栏收件箱、约局、最近结束；右侧 sticky 栏分数卡、榜前 9 名、战报；顶栏「大厅 · 信誉榜 · 规则 ｜ ＋ 组一局 · 头像菜单」。
- **约局卡片**：报名按钮直接在卡上（「来 / 待定 / 不来」），已答应的显示「你：来」+「改成不来」，进行中写「开局后不能改报名」，已在收件箱里的只写「↑ 在「要你处理」里」；不显示任何分数。
- **约局详情**：看板时间两行（「北京时间」+「你那边」）、「你去吗？」、按回答分组的「谁会来」、分享 / 复制链接 / 加到日历（.ics）、组织者控制台（开局前 / 进行中 / 该点名 / 已结算）、取消理由、完整版「再叫几个人」（搜索、「上次一起玩的」「和上次一样」）、每张记录可以点进案件。
- **新页面**：`/sessions/new`（手机页面、桌面居中弹窗，支持 `?again=` 再约一次）、`/sessions/:id/rollcall`（点名页）、`/sessions/history`（含已取消和理由）、`/board`、`/board/feed`、`/board/report`、`/board/rules`（30 秒看懂 + 用词表 + 不带 blurb 的段位表）。
- **周报**：新生成的周报按判决时间统计，卡片写「判决」「上周之星」「上周鸽王」；`/board/report` 不显示「上周鸽王」奖项。
- **删掉**：首页的「记一笔」浮动按钮（FAB，入口移到头像菜单）、`InviteBanner`、`PendingBanner`、首页上的完整榜单 / 规则 / 动态流。

不在 P3：`/me*`、`/review`、`/admin`、`/join`、`/cases/new`、`/cases/:id/statement`（P4，P3 里照旧是 NotFound）；`/api/me/todo` 和可撤案卡（P4-6）；详情页「这局有人出事了？记一笔」（P4-2）；`InviteFriendsCard`（指向 P4 的 `/join`）。

## 2. 前提

开工时 main 上应已合并：P0（#19–#24）、P1（P1-0、B1-1、P1-1–P1-4）、P2（P2-1–P2-6，含 P2-3 的迁移），并且后端已在 Coolify Redeploy。P2-5、P2-6 若按 §11 第 11 条瘦身推迟了，P3 照样能做（`going_preview`、`dm_ok` 缺省时对应显示自动隐藏），但下面的核对会报缺，在 PR 描述里写明。

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
git status --short                      # 必须为空
git fetch origin
git switch -c claude/p3-lobby-board origin/main

# 核对 P1、P2 的导出都在：没有输出 = 全部存在；打印「缺：…」就先停下查原因
while read -r f s; do grep -qF -- "$s" "$f" 2>/dev/null || echo "缺：$f  $s"; done <<'EOF'
src/lib/router.ts export function goBack
src/lib/router.ts export function navigate
src/lib/routes.ts export function routeCoversHome
src/lib/routes.ts export function playerCasePath
src/lib/routes.ts export type RouteLayout
src/lib/deepLink.ts export const ID_PATTERN
src/components/RouteView.tsx function PageShell
src/components/Link.tsx export function Link
src/components/PageBar.tsx export function PageBar
src/components/NotFound.tsx export interface NotFoundAction
src/components/LoginLink.tsx export function LoginLink
src/components/ResumeHint.tsx RESUME_HINT_TEXT_ID
src/lib/useRouteLayout.ts export function useRouteLayout
src/lib/useLeaveGuard.ts export function useLeaveGuard
src/api.ts getInvitable
src/api.ts inviteToSession
src/api.ts getSessionHistory
src/api.ts getDiscordLink
src/api.ts dm_ok
src/types.ts going_preview
src/types.ts cancel_reason
src/types.ts invite_reason
src/types.ts prev_starts_at
src/types.ts attendance_summary
src/types.ts boardTzOffsetHours
shared/attendance.ts export const DEFAULT_DURATION_MIN
shared/attendance.ts export const MAX_OPEN_SESSIONS
shared/attendance.ts export const MAX_SESSIONS_PER_DAY
shared/attendance.ts export const MAX_INVITES
shared/attendance.ts SESSION_HISTORY_PAGE
shared/attendance.ts SESSION_CANCEL_REASON_MAX
shared/quickTime.ts export function boardSlots
shared/quickTime.ts export function boardTzLabel
shared/quickTime.ts export function isSynthesizedTitle
shared/quickTime.ts BOARD_SLOT_MIN_LEAD_MS
src/lib/time.ts export function formatBoardDateTime
src/lib/time.ts export function formatViewerAside
src/lib/invitePicker.ts export function inviteGroups
src/lib/useInvitable.ts export function useInvitable
src/components/InviteSheet.tsx function PeoplePicker
src/lib/sessionActions.ts export function rescheduleSlots
src/lib/sessionActions.ts export function rsvpFeedback
src/lib/sessionActions.ts export function goingClosed
src/lib/useUndo.ts export function useUndo
worker/case-filing.ts function isFilingJudge(caller: User, reporterId: string): boolean {
EOF
```

然后跑一遍第 5 节的六个套件和两个 build，记下数字作为基线。规划副本（P0 + P1 + P2 按计划套上）上的参考值：unit 31 文件 / 456 例、dom 26 / 325（`act(...)` 警告正好 3 条，都来自 `onboarding-roles.test.tsx`）、server 22 / 295、worker 20 / 621 + 9 todo、pg 32 / 914 + 9 todo；build JS 约 291 kB。对不上多半是 P1 / P2 实现时偏离了计划，先弄清楚再开工。

## 3. 分步实现

顺序 **P3-1 → P3-7 → P3-6 → P3-5 → P3-3 → P3-4 → P3-2**（spec 只给编号，没给顺序）。理由：第 1 步的卡片、RSVP 控件、大厅数据是后面所有步骤的地基；第 2 步独立；第 3 步要在第 7 步把榜单 / 规则 / 动态从首页拿掉之前先有 `/board`；第 4 步的点名页是控制台和收件箱的链接目标；第 5 步抽出的 `PeoplePicker`、`ShareActions`、余量规则给第 6 步用；第 6 步给控制台和点名完成页加「再约一次」（它指向的 `/sessions/new` 这时才有）；第 7 步最后删旧横幅和 FAB，保证替代品先上。

每步按 TDD 做：先写测试 → 确认按预期原因失败 → 实现 → 通过 → commit。每步一组 commit，提交信息 `<type>: <中文描述>（P3-x）`，不加署名行。**每步结束时全部套件都要绿**，这样出问题时可以按步回退。

### 第 1 步 · P3-1 约局卡片与时间线

**要做什么**：第一批 SVG 图标；`RsvpControl`、`SessionCard`、`RosterGroups` 进大厅和详情页；大厅改成时间线分组；登录用户多取 `scope=mine`（失败静默）、按 id 去重；`handledElsewhere`；`edg:session` 同步；「最近结束」折叠块。

**新建**
- `src/components/icons/index.tsx` + `icons.css`：15 个导出 `IconAwaiting` `IconMoved` `IconLive` `IconRollcall` `IconFull` `IconShare` `IconCalendar` `IconDiscord` `IconWarning` `IconHeal` `IconReview` `IconPlus` `IconClose` `IconWithdraw` `IconCheck`。每个 `(props: { className?: string }) => JSX.Element`，渲染 `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">`，不写 `style`。图标永远配文字。
- `src/lib/lobbySessions.ts`（纯）：
  ```ts
  type SessionPhase = 'upcoming' | 'live' | 'due' | 'settled' | 'cancelled';
  sessionPhase(s, now): SessionPhase   // live = starts_at 起 (duration_min ?? DEFAULT_DURATION_MIN) 分钟内；之后仍 open = due
  sessionEndsAt(s): number
  mergeSessions(...lists): SessionItem[]                // 按 id 去重，靠前的列表优先，null 当空
  patchSession<T extends SessionItem>(list, session): T[]
  type TimelineKey = 'live' | 'tonight' | 'week' | 'later' | 'cancelled';  // TIMELINE_LABEL：进行中 / 今晚 / 本周 / 更晚 / 已取消
  lobbyTimeline(sessions, now, offsetHours?): TimelineGroup[]
  ```
  `lobbyTimeline`：live → 进行中；upcoming 按看板日期（无 offset 用浏览器时区）分今晚（今天）/ 本周（下周一 0 点前）/ 更晚；cancelled 且 `now < starts_at + LOBBY_CANCELLED_KEEP_MS` → 末尾的「已取消」组；due、settled 不进大厅。组内按 `starts_at` 升序、同刻按 id；空组不返回。
- `src/lib/sessionEvents.ts`（DOM）：`SESSION_EVENT = 'edg:session'`、`emitSession(session)`、`onSession(listener)`（返回退订函数）。
- `src/lib/useLobbySessions.ts`：`useLobbySessions({ enabled, me, refreshKey }): LobbySessions`，返回 `upcoming`、`mine`（没请求或失败都是 `null`）、`loading`、`failed`、`reload()`。`Promise.allSettled([getSessions('upcoming'), me ? getSessions('mine') : null])`，**不传 limit**；刷新失败保留旧列表；卸载后不 setState；订阅 `onSession` 用 `patchSession` 合并。
- `src/lib/useRsvpAnswer.ts`：`useRsvpAnswer({ reload, onAnswered? }): { busyId, error, answer(session, rsvp) }`。每次都 `setRsvp(id, rsvp, session.starts_at)`；toast 用 `rsvpFeedback`，可撤销的走 `useUndo`（撤销 = 用当时的 `starts_at` 再设回旧值），首次回复只提示「已回复：来。开局前想改随时改。」；409 先 `await reload()` 再设 `error`；其他失败用 `ApiError.message`，否则「报名失败」。
- `src/components/RsvpControl.tsx` + `rsvp-control.css`（`.rsvp`）：props `value`、`onAnswer`、`busy?`、`label?` / `labelledBy?`（二选一）、`goingClosed?` + `goingClosedNoteId?`、`suggested?` + `suggestedNoteId?`、`contextId?`。`<div role="group">` 里三个 `<button aria-pressed>`，文字正好是 `RSVP_LABEL`；选中的前面加 `<IconCheck />`。`aria-describedby` 只在有值时设置，没有时**属性不出现**。被圈的按钮加类 `sdt__rsvp-btn--suggested`。「不来」用中性色。
- `src/components/SessionCard.tsx` + `session-card.css`（`.scard`）：props `session`、`me`、`now`、`boardTzOffsetHours?`、`handled?`、`busy?`、`onOpen`、`onAnswer?`（不传 = 不给报名）。DOM：`<li className="scard scard--{phase}">` → `<button className="scard__main">`（时间行 `formatWhen(starts_at, now, offset)` · `formatTimeLeft`、局名（非自动标题时）、「{组织者} 组局」、游戏、「来 N/上限」、`going_preview` 头像 + 名字）→ 操作区。操作区按顺序只出一种：① live：`IconLive`「{HH:MM} 开的」+「开局后不能改报名」；② cancelled：「已取消」+「理由：{cancel_reason}」；③ 组织者本人：「你组的局」；④ `handled`：「↑ 在「要你处理」里」；⑤ 访客：`` <LoginLink className="scard__login" returnTo={sessionPath(id)} ariaLabel={`登录后报名 ${title}`}>登录后报名</LoginLink> ``；⑥ 已答应：chip「你：来」+ 按钮「改成不来」；⑦ 其余：`` <RsvpControl label={`报名 ${title}`} contextId=… goingClosed=… /> ``。满员加 `IconFull`「满员」角标。卡里没有 h 标签、不显示分数。
- `src/components/RosterGroups.tsx` + `roster-groups.css`（`.roster`）：`{ session: SessionDetail }`。h3「谁会来」；分组来（「来 N/上限」）/ 待定 / 还没回 / 不来，空组不渲染；组织者加「· 组局」，不在榜加「· 未上榜」，「不来」加「提前说了」+ ✓；结算后照今天的写法加出勤。名字只渲染一次（标签和名字分开放）。不显示分数、段位、Discord。
- `src/components/RecentSessions.tsx` + `recent-sessions.css`（`.recent`）：props `refreshKey`、`boardTzOffsetHours?`、`onOpenSession`。h2 里的按钮「最近结束」（`aria-expanded`），**默认折叠，第一次展开才请求 `scope=past`**（不传 limit），已展开时随 `refreshKey` 重取；显示前 `RECENT_SESSIONS_SHOWN` 条（`SessionCard` 不传 `onAnswer`）；失败 `role="status"`「这块没加载出来，你的操作没丢。」+「重试」；空「还没有已结束的约局。」。访客也有。

**修改**
- `src/api.ts`：`setRsvp`、`updateSession`、`cancelSession`、`inviteToSession` 成功后调 `emitSession(res.session)`；URL、body、返回值一字不改。
- `src/lib/time.ts` 末尾 `// --- P3-1 ---`：`dayStartOn`、`weekStartOn`、`clockOn`（给时间线和卡片用的日界、周界、时钟；有 offset 按看板时钟，没有按浏览器时区）。现有函数一字不改。
- `src/lib/constants.ts` 末尾 `// --- P3-1 ---`：`LOBBY_CANCELLED_KEEP_MS = 24 * 60 * 60 * 1000`、`RECENT_SESSIONS_SHOWN = 10`。
- `src/components/SessionsPanel.tsx` + `sessions-panel.css`：props 加 `lobby?`、`handledElsewhere?: ReadonlySet<number>`、`boardTzOffsetHours?`；不传 `lobby` 时自己调 `useLobbySessions`。标题区保留 h2（`<span aria-hidden="true">📅</span> 约局`）和登录用户的「组一局」；有 offset 时标题下写一次「时间均为北京时间」/「时间均为 UTC+N」。列表 = `lobbyTimeline(mergeSessions(lobby.upcoming, lobby.mine), now, offset)`，组名用 `<p className="sessions__group">`（不是标题），`now` 来自 `useNow(COUNTDOWN_TICK_MS)`；报名用 `useRsvpAnswer`，失败原文 `role="alert"`。读失败改成 `role="status"`「这块没加载出来，你的操作没丢。」+「重试」（有旧列表时放在列表上方）。空状态「今晚还没人组局。第一个开黑的永远是英雄。」+ 登录「组一局」/ 访客 `LoginLink`「登录后组局」。删 `SessionRow`、`SCOPES`、tablist 和 `.srow` 样式。
- `src/components/SessionDetailDialog.tsx` + `session-detail.css`：props 加 `boardTzOffsetHours?`。锚点 `<p className="sdt__when tabular">{formatDateTime(session.starts_at)}</p>`：有 offset 时换两行（`formatBoardDateTime`；第二行 `formatTimeLeft` · 「约 N 小时」· `formatViewerAside`，非空的用「 · 」连），**没有 offset 时逐字不变**。RSVP 区：`<p id="session-rsvp-q">你去吗？</p>` + `<RsvpControl labelledBy="session-rsvp-q">`，下面两句说明和满员说明（id 仍是 `session-detail-full`）照旧；删文件内 `RsvpControls`、`FULL_NOTICE_ID`、`describedBy`（搬进 `RsvpControl.tsx`）。详情页仍用 P0-6 的 `mutate`，不用 `useRsvpAnswer`。名单那个 `<section>` 换成 `<RosterGroups session={session} />`。live / due 且不能管理时写「开局后不能改报名」；已取消时头部下方「已取消」+「{组织者}：{理由}」（纯文本）。
- `src/App.tsx`：在 `const counts = useMemo(() => (ready ? computeCounts(ready.records) : {}), [ready]);` 之后、`if (state.status === 'loading')` 之前（hooks 必须在提前 return 之前）加 `const lobby = useLobbySessions({ enabled: ready !== null, me: ready?.me ?? null, refreshKey: sessionsKey });`；`<SessionsPanel` 加 `lobby={lobby}`、`boardTzOffsetHours={config.boardTzOffsetHours}`；其后插 `<RecentSessions …/>`。
- `src/components/RouteView.tsx`：`case 'session'` 给 `SessionDetailDialog` 传 `boardTzOffsetHours={props.config.boardTzOffsetHours}`。

**文案出处**：spec §3.1、§3.2（分组、「你：来」「改成不来」「↑ 在「要你处理」里」、空状态、失败提示）、§3.4（已取消卡）、§3.5（「你去吗？」、名单）、§4.1 ⑧「开局后不能改报名」。

**测试**
- 新 `tests/unit/lobby-sessions.test.ts`：`sessionPhase` 四个边界（含 `duration_min` 缺省按 120）；`mergeSessions` 去重和优先级；`patchSession`；`lobbyTimeline` 分组、跨看板午夜、跨周一、已取消保留 24 小时、due / settled 不进大厅、三种进程时区。
- 新 `tests/dom/lobby-cards.test.tsx`：卡片各分支（进行中、已取消带理由、组织者、handled、访客链接名「登录后报名 {局名}」、已答应的「改成不来」、满员角标）；按钮名始终是「来」、选中靠 `aria-pressed`；**`scope=mine` 返回 500 时静默**（无 alert、无 status、列表照常）；两个列表返回同一局时只有一组「来」；`handledElsewhere`；`edg:session` 合并；`RosterGroups` 不出现分数；「最近结束」点开才请求 `/api/sessions?scope=past`；详情页无 offset 时头部逐字不变。
- 改 `tests/dom/app-refresh.test.tsx` 用例「signed in with things to do: the same URLs plus the two follow-ups, and (N) in the tab title」：URL 集合加 `/api/sessions?scope=mine`（原有 8 个一个不删）。

**完成标准**：全部套件绿；`session-rsvp-moved`、`login-return`、`organizer-actions`、`invite-sheet` 原样通过；访客首屏 URL 集合（`app-refresh.test.tsx:145-161`）不变；`act(...)` 警告仍是 3 条。

### 第 2 步 · P3-7 周报按判决时间统计（后端 B3-1）

**要做什么**：`computeStats` 的立案数、团灭数、「最会说话」三条查询改按判决时间；返回值加 `basis: 'verdict'`；周报卡改标签。

**修改**
- `worker/report.ts`：定义一个内部常量（判决时间表达式），三条查询共用——`cases`（`SELECT COUNT(*) AS filed …`）、`collapsed`（`type = 'no_show_group'`）、`sentenced`（最会说话）。`cases` 和 `collapsed` 现在是 `FROM records` 不带别名，要改成 `FROM records r`：
  ```sql
  COALESCE(
    (SELECT MIN(e.created_at) FROM score_events e
      WHERE e.user_id = r.subject_id AND e.reason = 'record:' || CAST(r.id AS TEXT)),
    r.created_at)
  ```
  把 `created_at >= ? AND created_at < ?` 换成「上面的表达式 >= ? AND 上面的表达式 < ?」，`status IN ('decided','appealed')` 等其余条件不变。`movers`（之星 / 鸽王，本来就按 `score_events.created_at`）不动。按 `user_id` 过滤是为了用上 `idx_events_user`；`||`、`CAST(… AS TEXT)`、`MIN(text)` 在 D1 和 PG 都合法。返回值加 `basis: 'verdict'`。
- `worker/ai/report.ts`：`ReportStats` 加 `basis?: 'verdict'`；`buildReportMessage`、`fallbackNarrative` 不读它（提示词和兜底叙事一字不变）。
- `src/types.ts`：前端 `ReportStats` 加 `basis?: 'verdict'`。
- `src/components/WeeklyReportCard.tsx`：`label="本周之星"` → `"上周之星"`，`label="本周鸽王"` → `"上周鸽王"`；`FullBody` 的 `<Stat … label="立案" />` 和 `CompactBody` 的「立案 …」在 `stats.basis === 'verdict'` 时写「判决」，否则仍写「立案」；props 加 `hidePigeon?: boolean`（真时 `FullBody` 不渲染鸽王那个 Award）。
- `docs/CONTRACT.md`「### Weekly report」：把「so a case filed late on Sunday is counted (cases filed, total penalty) in its week」改成按判决时间的说法（cases, total penalty, group wipes and 最会说话 count the week a case was judged — its `record:<id>` score event; older rows fall back to when they were filed — reports written before this change keep the numbers they were written with）。

**不碰**：`server/src/discord/report.ts`（bot 周报卡，spec B3-1「本轮不改」）、`lastWeekStillOpen`（保留，生成时机不变）、任何迁移。旧周报不重算；只有管理员「换个说法」会让那一周按新口径重算。

**文案出处**：spec §8 B3-1、§5 第 1 条（两个「之星」不再同名）、§11 第 2、10 条。

**测试**
- `tests/worker/report.test.ts` 末尾新 describe（D1 和 PG 都跑）：上周立案、本周判决（score_event 在本周）的记录算本周不算上周；上周判决的照算上周；没有 `record:<id>` 事件的回退到 `created_at`（现有用例的 `reason = 'record:seed'` 走这条，结果不变）；团灭数和「最会说话」同口径；`basis === 'verdict'`；`ensureWeeklyReport` 存下的 `stats` 等于 `computeStats`。
- 新 `tests/dom/weekly-report.test.tsx`：「上周之星」「上周鸽王」标签；`basis` 有 / 无时「判决 / 立案」；`hidePigeon` 时没有鸽王那个 `.wr-award`、其余奖项还在（fixture 的叙事别写「鸽王」二字）。

**完成标准**：worker、pg 两个套件都跑过；`board.test.tsx` 的 compact 文字（fixture 没有 `basis`，仍是「立案」）和默认 3 个奖项照常通过；`tests/pg/bot-commands.test.ts` 的「本周之星」不受影响。

### 第 3 步 · P3-6 信誉榜页与约局历史

**要做什么**：`/board` 四个子页、`/sessions/history`；「30 秒看懂」改去 `/board/rules`；404 页补次要链接。

**新建**
- `src/components/BoardPage.tsx` + `board-page.css`（`.board`）：`{ tab: BoardTab; config; me; data?: BoardData }`，`BoardData = { participants, records, report, reportStale, trends, counts, regenerating, onRegenerate?, onSelectUser }`（`reportStale` 和首页同一个算法 `lastWeekStartOf`）。`<Modal open variant="page" labelledBy="board-title" onClose={goBack}>` → `<h2 id="board-title" tabIndex={-1}>信誉榜</h2>` → `<nav className="board__nav" aria-label="信誉榜">` 四个 `<Link>`「榜单」`/board`、「动态」、「战报」、「规则」，当前项 `aria-current="page"`，**不用 `role="tab"`** → 子页：
  - 榜单：`<Leaderboard … title="全部选手" highlights={<WeekHighlights …/>} />`（全部人）；
  - 动态：`<RecordsFeed … title="最新动态" emptyHint="还没有任何记录，等待第一笔。" />`（不传 `previewCount`）；
  - 战报：`<WeeklyReportCard … hidePigeon dismissible={false} />`；`report === null` 时「还没有战报。每周一 10:30 之后发布上周的。」；
  - 规则：`<RulesGuide config />` + `<RulesPanel config alwaysOpen />`。
  没有 PageBar（一级目的地）。四个子页共用一个挂载（`key` 不变）：只有从别处进来时焦点到 h2，切子页时焦点留在点的链接上。`data` 缺省时渲染空状态。
- `src/components/RulesGuide.tsx` + `rules-guide.css`（`.guide`、`.gloss`）：h2「30 秒看懂」+ 四张卡（各一个 h3）：
  - 约局：「想打就组一局，叫上朋友；被叫的人回「来 / 待定 / 不来」。」
  - 守约：「说了来就来；来不了，开局前说一声。开局前说不来，点名结算不会记你。」
  - 分数与回血：「每人从 100 分起；放鸽子会被记一笔；每周一 0 点自动回血 +{config.weeklyHeal}，最多回到 100。」（有 offset 时加「（北京时间）」；数字读 config，测试 mock 里是 5）
  - 出事了怎么办：「先写说明 → AI 裁决 → 不服可以申诉」（spec §5 第 13 条原文）
  - h3「用词表」+ `<dl>` 照抄 spec §5 用词表六行，末尾「不再使用「撤回」这个词（报名的 toast 撤销除外）。」
- `src/components/SessionHistoryPage.tsx` + `session-history.css`（`.shist`）：`{ boardTzOffsetHours? }`。`Modal variant="page"` + `<PageBar backLabel="返回" onBack={goBack} />` + h2「约局历史」（`tabIndex=-1`，加载完聚焦）。数据 `getSessionHistory(before?)`：`undefined`（旧后端）→「这个服务器还不支持约局历史。」；第一页 `[]` →「还没有开过的局。」；失败 → `role="status"`「这块没加载出来，你的操作没丢。」+「重试」。每行一个 `<Link to={sessionPath(id)}>`：「{M/D 周X HH:MM} · {局名或游戏} · {状态}」，已结算加 `attendance_summary` 非零项（「准时 4 · 迟到 1」），已取消加一行「{组织者}：{cancel_reason}」。上一页正好 `SESSION_HISTORY_PAGE` 条时显示「加载更多」（`before` = 最后一项 id）。

**修改**
- `src/lib/routes.ts`：`BoardTab = 'list' | 'feed' | 'report' | 'rules'`、`BOARD_TABS`；`Route` 联合在 `| { readonly name: 'notFound' };` 之前加 `{ name: 'board'; tab: BoardTab }`、`{ name: 'sessionHistory' }`；`boardPath(tab)`（`'list'` → `/board`）、`SESSION_HISTORY_PATH = '/sessions/history'`。`history` 的判断必须插在锚点 `if (segments.length === 2 && head === 'sessions') return idRoute('session', first);` **之前**（否则先变成 notFound）；`board` 加在 `return NOT_FOUND;` 之前。解析：`/board`、`/board/` → list；`/board/feed|report|rules`；`/board/list`、`/board/xyz`、`/board/feed/1`、`/sessions/history/2` → notFound。`formatRoute`、`routeCoversHome` 各加 case（两个都是 page，两种布局都返回 true）。文件头注释改成「P1 + P3 的路由」。
- `src/components/RouteView.tsx`：props 加 `board?: BoardData`；`case 'board'` 渲染 `BoardPage`，`case 'sessionHistory'` 渲染 `SessionHistoryPage`，都包在 `PageShell` 里。
- `src/App.tsx`：`<WelcomeCard` 加 `rulesTo={boardPath('rules')}`；首页 `<WeeklyReportCard compact` 加 `moreTo={boardPath('report')}`；在 `counts` 之后用 `useMemo` 组 `BoardData` 传给 `<RouteView board={…}>`。
- `src/components/WelcomeCard.tsx`：可选 `rulesTo?`，给了就把「30 秒看懂 ›」渲染成 `<Link>`（可访问名「30 秒看懂」），不给仍是按钮。
- `src/components/RulesPanel.tsx` + `rules-panel.css`：可选 `alwaysOpen?`（不渲染折叠按钮，标题是普通 h2「计分规则」）；段位表删掉 `rules__tier-blurb` 那个 span（两种形态都删）。
- `src/components/Leaderboard.tsx`：可选 `title?`（默认「信誉榜」）。
- `src/components/WeeklyReportCard.tsx`：可选 `moreTo?`（`ReportHead` 加「读全文 ›」`<Link>`）、`dismissible?`（`false` 时不渲染 ✕、也不读「本周不再显示」的记录）。
- `src/components/SessionsPanel.tsx`：标题区 h2 之后加 `<Link to={SESSION_HISTORY_PATH} className="sessions__more">历史 <span aria-hidden="true">›</span></Link>`；`RecentSessions.tsx` 末尾加「看全部历史 ›」。
- `src/lib/routeCopy.ts`：`SEE_HISTORY = '看约局历史'`、`SEE_BOARD = '看信誉榜'`。`SessionDetailDialog.tsx` 锚点 `<NotFound title={SESSION_NOT_FOUND} headingId={TITLE_ID} />` 加 `actions`：回大厅 `/`、看约局历史；`PlayerDetail.tsx` 的 404 加看信誉榜 `/board`。
- `docs/CONTRACT.md`「Frontend expectations」路由表加 `/board`（含三个子页）、`/sessions/history`，404 那句补次要链接；`README.md`「## 路由」表对应行改成已上线。

**文案出处**：spec §2.2（路由、子页导航不是 tablist、404 次要链接）、§3.4（历史）、§5 第 13 条与用词表、§3.1（「读全文 ›」）。

**测试**
- `tests/unit/route.test.ts`：从 `it('knows nothing of the later phases’ routes yet'` 的列表删 `/sessions/history`、`/board`、`/board/feed`；末尾新 describe 写正向解析、`formatRoute`、`routeCoversHome` 和上面的反例。
- 新 `tests/dom/board-pages.test.tsx`：四个子页与 `aria-current`、没有 `role="tab"`；从别处进来焦点到 h2、切子页不抢焦点；`/board/report` 没有鸽王奖项、用户在首页关过卡片后仍显示；规则页没有 blurb、回血数字读 config；404 的次要链接。
- 新 `tests/dom/session-history-page.test.tsx`：分页、已取消行的理由、旧后端（`undefined`）、空、失败。
- 改 `tests/dom/board.test.tsx:404-421`「30 秒看懂 opens the rules and moves focus there」：点链接 → `pathname === '/board/rules'`、焦点在 h2「信誉榜」、页上有四张卡和常显的「计分规则」。（`:290-296` 单独渲染 WelcomeCard 的按钮用例不改。）

**完成标准**：全部套件绿；首页标题仍只有一个匹配 `/约局/`；`route-pages.test.tsx` 的 404「回大厅」仍唯一。

### 第 4 步 · P3-5 点名页

**要做什么**：`/sessions/:id/rollcall` 页面；`RollCallDialog` 的内容抽成 `RollCallFlow`；完成页摘要。

**新建**
- `src/components/RollCallFlow.tsx`：`RollCallDialog` 原有的全部内容（两步 + 草稿 + 离开确认），不含 `<Modal>`。props `{ session, titleId, onClose, onSettled(session, created), variant: 'dialog' | 'page' }`；`page` 时不再出 h2，底部操作栏 sticky。
- `src/components/RollCallPage.tsx` + `rollcall-page.css`（`.rcp`；`RollCallFlow` 继续用 `.rc`）：`{ sessionId, me, boardTzOffsetHours?, onChanged }`。`Modal variant="page" labelledBy="rollcall-page-title"` → `PageBar backLabel="返回"`（`title` 传局名）→ h2「点名 · {局名}」+「1/2」「2/2」→ `RollCallFlow variant="page"`。页面自己 `getSession` 一次，进入条件：不是组织者也不是管理员 →「只有组织者和管理员能点名。」；没开局 →「这局还没开始，开局后才能点名。」；已结算 →「这局已经结算了。」；已取消 →「这局已取消。」；404 → `NotFound(SESSION_NOT_FOUND)`。前四种附「回到这局」链接。完成后再 `getSession` 一次拿记录，显示「已结算 ✓」+ `settledSummary(...)` +「回到这局」（`<Link to={sessionPath(id)} replace>`），并调 `onChanged()`。
- `src/lib/sessionSummary.ts`（纯）：`settledSummary(players, records): string` →「已结算 · 准时 4 · 迟到 1 · 立案 1 起，等当事人说明」：出勤只列非零项；有 `awaiting_statement` 记录才加「，等当事人说明」；没有记录不写立案。

**修改**
- `src/components/RollCallDialog.tsx`：变成 `<Modal … historyKey="rollcall"><RollCallFlow variant="dialog" …/></Modal>` 的薄包装，签名 `{ open, session, onClose, onSettled }` 一字不改（应用里不再用它，留给单独渲染它的测试）。
- `src/lib/routes.ts`：`Route` 加 `{ name: 'rollcall'; sessionId: number }`；`rollcallPath(id)` → `/sessions/5/rollcall`；三段式判断加在 `return NOT_FOUND;` 之前，id 走 `ID_PATTERN`；`/sessions/07/rollcall`、`/sessions/5/rollcall/x` → notFound；`routeCoversHome` 两种布局都是 true。
- `src/components/RouteView.tsx`：`case 'rollcall'` → `<RollCallPage key={id} sessionId me onChanged boardTzOffsetHours />`。
- `src/components/SessionDetailDialog.tsx`：删 `rollCallOpen`、`flash` 两个 state、`{flash && …}`、`{session && rollCallOpen && (<RollCallDialog …/>)}` 和它的 import；`onRollCall={() => setRollCallOpen(true)}` 改成 `onRollCall={() => navigate(rollcallPath(session.id))}`。按钮名「点名结算」和位置这一步不变。
- `docs/CONTRACT.md`、`README.md` 路由表各加一行。

**草稿与离开**：继续用 P0-5 的 `localStorage['edg.draft.rollcall.<id>']`，每次标记实时写；离开确认沿用 P0 文案「点名还没提交，标记会留在这台设备上。」「继续点名」「先离开」。PageBar「返回」和流程里的「取消」都走离开确认；浏览器返回键直接离开（草稿还在）。

**文案出处**：spec §3.7、§4.1 ⑨⑩。

**测试**
- 新 `tests/dom/rollcall-page.test.tsx`：四种进入条件与 404；草稿恢复（同一个 key）；「返回」走离开确认；结算后的摘要和「回到这局」；详情页「点名结算」跳到点名页。
- 新 `tests/unit/session-summary.test.ts`：`settledSummary` 各分支。
- `tests/unit/route.test.ts`：later-phases 列表删 `/sessions/5/rollcall`；末尾追加 describe。

**完成标准**：全部套件绿；`drafts.test.tsx:421-477`（单独渲染 `RollCallDialog`）、`organizer-actions.test.tsx:275-281` 原样通过。

### 第 5 步 · P3-3 组织者控制台

**要做什么**：`OrganizerConsole`（四态）；完整版 `InviteSheet`（抽出 `PeoplePicker`、搜索、「上次一起玩的」「和上次一样」）；`RescheduleSheet` 迁入并换看板时段；取消理由；`ShareActions` 和 `.ics`；组局余量；每张记录可点进案件。

**新建**
- `src/components/OrganizerConsole.tsx` + `organizer-console.css`（`.oc`）：props `session`、`records`、`now`、`busy`、`boardTzOffsetHours?`、`mySessions?`、`meId`、`onSessionChanged(session)`、`onCancel(reason?): Promise<boolean>`、`onChanged`。`<section className="oc" aria-labelledby="oc-title"><h2 id="oc-title">组织者</h2>`，按 `consoleState(session, now)` 切换：

  | 状态 | 内容（自上而下） |
  |---|---|
  | `before` | `gapLine`（「还差 1 人满员 · 2 人还没回」；满员「{N}/{N} 到齐，就等开打 🎉」；无上限只写「2 人还没回」）→「＋ 再叫几个人」（名单 ready / error 时）→「改时间」→ 余量提示 → 最后「取消这局」 |
  | `live` | `IconLive`「进行中 · {HH:MM} 开的，预计 {HH:MM} 结束」→ `<Link to={rollcallPath(id)} className="btn btn--ghost">现在点名</Link>` →「绑了 Discord 的话，结束后 Bot 也会私信提醒你。」 |
  | `due` | 「局结束了，点个名？」「点名只记出勤；扣不扣分，下一步你说了算。」→ `<Link … className="btn btn--gold">去点名</Link>` |
  | `settled` | `settledSummary(session.players, records)`（「再约一次」第 6 步加） |

  控制台持有唯一一个 `useInvitable(state === 'before')`（从详情页挪来，请求时机不变）、`InviteSheet` 和 `RescheduleSheet` 的开关与成功处理（toast 原文不变：`inviteToast(added)`、「已改到 {formatWhen(new)}。」；再叫人成功的 toast 加操作「复制邀请链接」）。控制台里没有任何「来 / 待定 / 不来」。
  `CancelSessionControl` 搬进这个文件：仍是 `ConfirmInline`（「取消这局？」「不取消了 / 确认取消」、`tone="danger"`、`focus="cancel"`、`busyLabel="取消中…"`，正文原句不变）；`session.cancel_reason !== undefined` 时在正文下加 `<label>`「理由（选填，会写进私信，也会显示在这局的页面上）」+ `<input maxLength={SESSION_CANCEL_REASON_MAX}>`；提交 `onCancel(reason.trim() || undefined)`，空白时 `cancelSession(id)` 不带 body。确认后立即提交，不做延迟撤回。
- `src/lib/sessionConsole.ts`（纯）：`ConsoleState = 'before' | 'live' | 'due' | 'settled' | 'cancelled'`、`consoleState(s, now)`（就是 `sessionPhase` 的映射）、`rosterGap(session): { missing: number | null; pending: number }`、`gapLine(session): string | null`、`sessionQuota(mine, meId, now): { openLeft; dayLeft }`（我组织的 open 且未开局 → `MAX_OPEN_SESSIONS − n`；我组织的、`created_at` 在滚动 24 小时内（含已取消）→ `MAX_SESSIONS_PER_DAY − n`；不小于 0；`created_at` 经 `parseTimestamp`）、`quotaHint(q): string | null`（更紧的那个 ≤ `QUOTA_HINT_AT` 才给）。
- `src/components/PeoplePicker.tsx` + `people-picker.css`（`.ppk`）：从 `InviteSheet.tsx` 里抽出来。props `groups: PickerGroups`、`selected`、`max`（`MAX_INVITES`）、`busy`、`onToggle`、`search?: { value; onChange }`（`type="search"`，可访问名「搜名字」）、`lineup?: { ids; onPick }`（「和上次一样」，ids 为空不渲染）。三组各一个 `<fieldset>` + `<legend>`，空组不渲染：「上次一起玩的」「在榜的」「其他朋友（未上榜，不参与计分）」；每人一个可见的原生 checkbox；已在局里 / 说了不来的 disabled 带原因；选满后其余 disabled 并提示「一次最多叫 20 人」。搜索框和「和上次一样」只在名单 ready 且非空时出现。
- `src/components/ShareActions.tsx` + `share-actions.css`（`.share`）：`{ session, boardTzOffsetHours? }`。按钮依次：有 `navigator.share` 时「分享邀请」（`AbortError` 忽略，其他失败退回复制）；「复制链接」（成功 toast「链接已复制。朋友打开后登录就能报名。」，失败 toast「没复制成功，请手动复制：{url}」`tone: 'error'`，都不是 alert）；「加到日历」。只在 `status === 'open'` 且 `phase === 'upcoming'` 时渲染；访客也有。PageBar 不放「分享」。
- `src/lib/share.ts`（纯）：`sessionShareUrl(origin, id)`、`shareText(session, now, offsetHours?)` →「周五 21:00 无畏契约，还差 1 人，来不来？」（无上限写「已经 N 人」，满员写「人齐了」）。
- `src/lib/ics.ts`（纯）：`buildIcs(e: IcsEvent)`、`icsFileName(id)` → `edg-session-${id}.ics`。`IcsEvent = { uid, title, startsAt, durationMin, url, description?, alarmMin, now }`。输出形状（时间一律 UTC，行尾 `\r\n`）：
  ```
  BEGIN:VCALENDAR / VERSION:2.0 / PRODID:-//EDG 信誉分//约局//ZH / CALSCALE:GREGORIAN / METHOD:PUBLISH
  BEGIN:VEVENT
  UID:edg-session-5@<host>   DTSTAMP / DTSTART / DTEND 都写 YYYYMMDDTHHMMSSZ
  SUMMARY:局名（游戏）        DESCRIPTION:备注\n链接        URL:<链接>
  BEGIN:VALARM / ACTION:DISPLAY / DESCRIPTION:{局名} 快开局了 / TRIGGER:-PT15M / END:VALARM
  END:VEVENT / END:VCALENDAR
  ```
  文本值转义 `\\`、`;`、`,`、换行（写成 `\n`）；超过 75 个 UTF-8 字节的行按 RFC 5545 折行（`\r\n` + 一个空格，不在多字节字符中间断开）。`durationMin = duration_min ?? DEFAULT_DURATION_MIN`，`alarmMin = SESSION_START_REMINDER_MIN`。用户写的内容只当文本值。
- `src/lib/download.ts`（DOM）：`downloadText(filename, text, mime)`（Blob + `URL.createObjectURL` + `<a download>` + 之后 `revokeObjectURL`；mime 用 `text/calendar;charset=utf-8`）、`copyText(text): Promise<boolean>`（`navigator.clipboard` 不可用或失败返回 false）。

**修改**
- `src/components/SessionDetailDialog.tsx`：锚点 `{canManage && session.status === 'open' && (<OrganizerActions` 那段换成 `OrganizerConsole`，条件改为 `canManage && session.status !== 'cancelled'`；删文件内 `OrganizerActions`、`CancelSessionControl`、`rescheduleOpen` / `inviteOpen` state、`handleRescheduled`、`handleInvited`、`useInvitable` 那几行和两个 sheet 的渲染；`handleCancel` 加可选 `reason`；名单之后加 `<ShareActions>`；记录区标题改「这局的记录 {N}」，每张 `VerdictCard` 下加 `` <Link to={playerCasePath(r.subject.id, r.id)} aria-label={`看案件 #${r.id}`}>看这一起 ›</Link> ``；props 加 `mySessions?`。改完应明显短于 510 行。
- `src/components/InviteSheet.tsx` + `invite-sheet.css`：签名 `{ session, invitable, onClose, onInvited }` 不变；改用 `PeoplePicker`，加搜索和「和上次一样」。
- `src/lib/invitePicker.ts` 末尾追加（纯）：`pickerGroups(users, players, query?)`（recent = `last_played_with_me_at` 非空的人，保持服务端顺序；其余照 `inviteGroups` 分；按名字子串过滤，不分大小写）、`lastLineup(users)`（`last_played_with_me_at` 等于最大值的那批人，最多 `MAX_INVITES`）、`pickLineup(selected, lineup, freeIds, max?)`（只并入 free 的人）。原有三个函数一字不改。
- `src/components/RescheduleSheet.tsx` + `reschedule-sheet.css`：可选 `boardTzOffsetHours?`。给了：时段 = `rescheduleSlots(boardSlots(now, offset), starts_at)`，「现在：」用 `formatBoardDateTime`，「其他时间」用 `toBoardInputValue` / `parseBoardInputValue`；**没给时一字不变**。由控制台渲染。
- `src/lib/time.ts` 末尾 `// --- P3-3 ---`：`toBoardInputValue(ms, offsetHours)`、`parseBoardInputValue(value, offsetHours): number | null`（datetime-local 值按看板时钟读写）。
- `shared/attendance.ts` 末尾 `// --- P3-3 ---`：`SESSION_START_REMINDER_MIN = 15`（注释写明必须等于 `server/migrations/0005_sessions.sql` 的 `interval '15 minutes'`）。
- `src/lib/constants.ts` `// --- P3-3 ---`：`QUOTA_HINT_AT = 1`。
- `src/components/RouteView.tsx`：props 加 `mySessions?`，`case 'session'` 传下去；`src/App.tsx`：`<RouteView` 加 `mySessions={lobby.mine}`。

**文案出处**：spec §3.5（控制台四态、InviteSheet、RescheduleSheet、取消确认、组局余量）、§4.1 ⑤⑪、§5 B 额外两条、M12。余量 1：「你还能再开 1 个局（同时最多 {MAX_OPEN_SESSIONS} 个还没开的）」/「24 小时内还能再发起 1 个」；余量 0：「同时最多 {MAX_OPEN_SESSIONS} 个还没开的局，你已经满了」/「24 小时内最多发起 {MAX_SESSIONS_PER_DAY} 个，你已经满了」。

**测试**
- 新 `tests/dom/organizer-console.test.tsx`：四态；缺人提示和「到齐」；余量提示（1、0、`mySessions` 为 null 不显示）；取消理由（有、空白不带 body、`cancel_reason` 缺省时没有输入框）；InviteSheet 三组、搜索、「和上次一样」不选已在局里和说了不来的、上限；`/api/me/invitable` 404 → 没有「再叫几个人」；复制成功 / 失败的 toast；ShareActions 只在开局前出现；每张记录的链接。jsdom 缺的 `URL.createObjectURL`、`navigator.clipboard`、`navigator.share` 在本文件里用 `vi.stubGlobal` / `Object.defineProperty` 装上、`afterEach` 还原（不改 `tests/dom/setup.ts`）。
- 新 `tests/unit/session-console.test.ts`：`consoleState`、`rosterGap`、`gapLine`、`sessionQuota`（滚动 24 小时、含已取消）、`quotaHint`。
- 新 `tests/unit/ics.test.ts`：`.ics` 结构、UTC、转义、75 字节折行、VALARM；`shareText` 各分支。
- `tests/unit/invite-picker.test.ts` 末尾追加 describe：`pickerGroups`、`lastLineup`、`pickLineup`。
- `tests/unit/source-hygiene.test.ts` 末尾追加 describe：`0005_sessions.sql` 里 `starts - interval '15 minutes'` 的数字等于 `SESSION_START_REMINDER_MIN`（照 P2-4 锁 `DEFAULT_DURATION_MIN` 的写法）。
- 改 `tests/dom/organizer-actions.test.tsx:275-281`「once it has started there is only 点名结算」：同一场景只有链接「现在点名」（`href="/sessions/1/rollcall"`），没有「改时间」「取消这局」；新增一例「已过预计结束 → 链接「去点名」」。

**完成标准**：全部套件绿；`invite-sheet.test.tsx` 18 例、`organizer-actions.test.tsx` 其余用例、`back-closes-layer.test.tsx:441-505` 原样通过；`pages-headers.test.ts` 的 CSP 一字不改。

### 第 6 步 · P3-4 发起页

**要做什么**：`/sessions/new`（手机页面、桌面居中弹窗）、`?again=`、「和上次一样」、更多设置、看板时段、离开保护；「约好了」卡；控制台和点名完成页的「再约一次」。

**新建**
- `src/lib/sessionAgain.ts`（纯）：`againPrefill(detail, meId, now): AgainPrefill`，`{ invite（那局名单里除我、说了不来的，≤ MAX_INVITES）, startsAt（原时间 + AGAIN_STEP_DAYS 天的整数倍，直到晚于 now + BOARD_SLOT_MIN_LEAD_MS）, game, capacity, durationMin, title（只在不是自动标题时）}`。备注不预填；时间用「其他时间」那一栏显示。
- `src/components/NewSessionRoute.tsx`：`{ me, config, layout, participants, mySessions?, onCreated }`。访客：「登录后就能组局。」+ `LoginLink`「用 Nanako 账号登录」（回跳当前地址，含 `?again=`），不渲染表单、不发请求。登录：`useInvitable(true)`；`parseAgain(location.search)` 有值时 `getSession(id)` **一次**，失败当没有 `?again=`、不报错；然后 `<SessionFormDialog open routed variant={layout === 'page' ? 'page' : 'center'} …>`，`onClose = goBack()`。
- `src/components/CreatedCard.tsx` + `created-card.css`（`.created`）：`{ session, boardTzOffsetHours? }`，`<p>`「约好了 🎮 把链接发到群里吧」+ `<ShareActions>`；不是标题、不是 alert、不抢焦点。

**修改**
- `src/components/SessionFormDialog.tsx` + `session-form.css`：签名 `{ open, participants, selfId, onClose, onCreated }` 不变，加可选 `variant?: 'center' | 'page'`、`routed?`（真：不给 Modal 传 `historyKey`，成功后只调 `onCreated`）、`boardTzOffsetHours?`（时段 = `boardSlots`，legend「什么时候？（{boardTzLabel}）」，「其他时间」按看板时钟换算）、`invitable?`（ready 时用 `PeoplePicker` 三组；unsupported / 不给时退回 `participants`）、`again?`、`mySessions?`（余量提示）。「更多：游戏 / 人数上限 / 时长 / 备注」折叠按钮（`aria-expanded`），上限 `SESSION_GAME_MAX`、`SESSION_NOTE_MAX`、人数 2–`MAX_SESSION_ROSTER`。叫谁下面的说明换成 spec §3.6 原文：「被叫的人：绑了 Discord 的会收到私信，能一键报名；其他人打开网页会在「要你处理」里看到。不叫人也行，大家可以自己报名。」提交按钮文字不变（「约！」「约！（叫 N 人）」「创建中…」），`page` 时 sticky 在底部。撞上 429：后端原文 `role="alert"`。**不传新 props 时行为和今天完全一样。**
- `src/lib/draftShapes.ts`：`SessionDraftValue` 加可选 `more?: { game; capacity; durationMin; note }`（都是 string），旧草稿照常通过 `validateSessionDraft`。
- `src/lib/routes.ts`：`Route` 加 `{ name: 'sessionNew' }`（`?again=` 不进 Route）；`SESSION_NEW_PATH = '/sessions/new'`、`sessionNewPath(again?)`、`parseAgain(search): number | null`（只认 `ID_PATTERN`）。`new` 的判断插在 `idRoute('session', …)` 那个锚点**之前**；`/sessions/new/1` → notFound；`routeCoversHome` 是 `layout === 'page'`。
- `src/components/RouteView.tsx`：props 加 `participants?`、`created?`、`onCreated?`；`case 'sessionNew'` 渲染 `NewSessionRoute`（手机包 `PageShell`，桌面是弹在大厅上的居中弹窗）；`case 'session'` 加 `created={props.created === route.sessionId}`。
- `src/App.tsx`：删 `sessionFormOpen` state、`{sessionFormOpen && (<SessionFormDialog …/>)}` 和它的 import；`SessionsPanel` 的 `onCreate` 改为 `() => navigate(sessionNewPath())`；新 state `created: number | null`；`onCreated(session)` = `setCreated(session.id)` + `handleChanged()` + `navigate(sessionPath(session.id), { replace: true })`；路由离开那一局时清掉 `created`（一个 effect）；`<RouteView` 加 `participants`、`created`、`onCreated`。
- `src/components/SessionDetailDialog.tsx`：props 加 `created?`，头部之后 `{created && <CreatedCard …/>}`。
- 「再约一次」：`OrganizerConsole` 的 `settled` 状态在摘要之后加 `<Link to={sessionNewPath(session.id)} className="btn btn--gold">再约一次</Link>` +「同一批人，默认下周同一时间」；`RollCallPage` 完成页在「回到这局」之后加同一个链接。
- `src/components/SessionsPanel.tsx`：访客空状态的 `LoginLink` 加 `returnTo={sessionNewPath()}`。
- `src/lib/constants.ts` `// --- P3-4 ---`：`AGAIN_STEP_DAYS = 7`。`docs/CONTRACT.md`、`README.md` 路由表加一行。

**离开保护**：沿用 P0 文案「这局还没约，已选的 N 个人会留在这台设备上。」「继续编辑」「先离开」（草稿 `edg.draft.session` 其实会保存，所以不用 spec §3.6 的「不会保存」）。「返回」/ ✕ / Esc 都先确认再 `goBack()`。

**文案出处**：spec §3.6、§4.1 ①⑪、§5 B 额外「再约一次」、§3.5「组局余量」。

**测试**
- 新 `tests/dom/new-session-page.test.tsx`：访客、手机页面、桌面弹窗；`?again=` 预填（人、时间 +7 天、游戏）与坏 id 不请求；「和上次一样」；「更多」字段进请求体；看板时段和「其他时间」按看板时钟换算；离开确认；建好后 `replace` 到新局并出现「约好了」卡；控制台和点名完成页的「再约一次」；`/api/me/invitable` 404 时退回榜单名单。
- 新 `tests/unit/session-again.test.ts`：`againPrefill` 各分支。
- `tests/unit/route.test.ts`：later-phases 列表删 `/sessions/new`；末尾追加 describe（含 `parseAgain`）。
- `tests/unit/login-return.test.ts:106`：`['a later-phase page', '/sessions/new']` 换成 `['a later-phase page', '/me']`；另加一例「`/sessions/new` 和 `/sessions/new?again=5` 被保留」。

**完成标准**：全部套件绿；`drafts.test.tsx:360-404`（单独渲染 `SessionFormDialog`）和 `tests/unit/draft-shapes.test.ts` 原样通过。

### 第 7 步 · P3-2 首页改版

**要做什么**：`TodoInbox`（拼装模式，§3.2 排序）、`MyScoreLine`、`BoardMini`、`BottomTabs`、TopBar 和统一的头像菜单、骨架屏、桌面两栏；`isFilingJudge` 移到 shared；删除 `InviteBanner`、`PendingBanner`、FAB。

**新建**
- `src/lib/todo.ts`（纯，不从 `api.ts` 导入类型）：`TodoKind` = `'dm-broken' | 'statement' | 'rollcall' | 'moved' | 'invite' | 'soon' | 'escalation' | 'appeals' | 'cancelled' | 'unbound'`；`TodoSources = { me, now, pending, myPending, invites, feed, mine, appealed, discord, seenCancelled, unboundDismissed }`；导出 `collectTodo`、`todoRank`、`sortTodo`、`buildTodo`、`todoBadgeCount`、`handledSessionIds`、`meNeedsAttention`。每类卡的来源：

  | 卡（rank） | 条件 |
  |---|---|
  | `dm-broken`（1） | `/api/me/discord` 返回对象且 `dm_ok === false` |
  | `statement`（urgent 2，其余 5） | `myPending` 里 `awaiting_statement` 的每一起；`urgent = deadline_at !== null && isUrgent(deadline_at, now)` |
  | `rollcall`（3） | `mine` 里我组织的、`sessionPhase === 'due'` |
  | `moved`（4）/ `invite`（6） | `invites` 里 `my_rsvp === 'invited'` 且 upcoming；`invite_reason === 'moved'` 且有 `prev_starts_at` → moved |
  | `soon`（7） | `mine` 里 `my_rsvp === 'going'`、不是我组织的、open、`0 < starts_at − now ≤ TODO_SOON_MS` |
  | `escalation`（8） | `feed` 里 `escalation_suggested`、状态 `awaiting_statement` / `judging`、`isFilingJudge(me, record.reporter.id)` |
  | `appeals`（9） | `me.is_admin && pending.appeals > 0`；`earliest` = `appealed` 里 `created_at` 最早的（没拿到 → null） |
  | `cancelled`（11） | `mine` 里已取消、不是我组织的、我是 going / maybe / invited、`now < starts_at + LOBBY_CANCELLED_KEEP_MS`、不在 `seenCancelled` |
  | `unbound`（12） | `discord === null` 且没点过「不再提示」 |

  （10 是 P4 的可撤案。）组内：说明按 `deadline_at`（null 最后），局按 `starts_at`，升级按 `created_at`，再按 key。`todoBadgeCount` = 除 `cancelled`、`unbound` 外每张计 1，`appeals` 计 `count`；`handledSessionIds` = `invite`、`moved`、`soon` 的局 id；`meNeedsAttention` = 有 `appeals`、`escalation` 或 `dm-broken`。
- `src/lib/todoMarks.ts`（DOM，storage，全部 try/catch，坏值当空）：`SEEN_CANCELLED_KEY = 'edg.todo.seen-cancelled'`（JSON 数组，最多 `TODO_SEEN_MAX` 个）、`UNBOUND_DISMISSED_KEY = 'edg.todo.unbound-dismissed'`；`readSeenCancelled`、`markCancelledSeen`、`readUnboundDismissed`、`dismissUnbound`、`clearTodoMarks`。
- `src/lib/useTodoSources.ts`：`useTodoSources({ me, pendingAppeals, refreshKey }): { appealed, discord, settled }`。登录后、`refreshKey` / `me.id` 变化、`pendingAppeals` 从 0 变正时：`Promise.allSettled([me.is_admin && pendingAppeals > 0 ? getRecords({ status: 'appealed', limit: INBOX_APPEALS_LIMIT }) : null, getDiscordLink()])`。URL 正好是 `/api/records?limit=50&status=appealed` 和 `/api/me/discord`。失败静默（`appealed = null`、`discord = 'error'`）；404 → `undefined` → 两类设置卡都不出。
- `src/components/TodoInbox.tsx` + `todo-inbox.css`（`.todo`、`.tcard`）与 `src/components/TodoCard.tsx`：`TodoInbox` props `items: readonly TodoItem[] | null`（null = 首次加载中）、`now`、`boardTzOffsetHours?`、`busyId`、`error`、`onAnswer(session, rsvp)`、`onOpenSession(id)`、`onOpenStatement(record)`、`onOpenNotify()`、`onSeenCancelled(sessionId)`、`onDismissUnbound()`；`TodoCard` = 去掉 `items`、`error`，加 `item`。`<section className="todo panel" aria-labelledby="todo-title">` → h2「要你处理」（有卡时加「 · {todoBadgeCount}」）→ 报名失败的 `role="alert"` → `<ul>` 每张卡一个 `<li>`；`items === null` 时 `<Skeleton label="要你处理加载中" lines={2} />`；空数组「没有待办，清清爽爽 ✨」。订阅 `onSession`：某局不再是 `invited` 时它的 invite / moved 卡立刻消失，`soon` 卡在不再是 `going` 时消失；卡片消失后焦点到 h2（`tabIndex=-1`）。邀请 / 改时间卡用 `` RsvpControl label={`报名 ${title}`} ``；快开局卡只有一个「改成不来」（一键提交、toast 可撤销）。说明卡在 P4 前打开 App 的 `setStatementCase`；两类设置卡在 P4 前打开 `OnboardingDialog`；申诉卡按钮去最早那一起的案件页（列表没拿到时卡在、没有按钮）。urgent 说明卡、`dm-broken`、`moved` 用 `--attn` + 图标 + 文字。
- `src/components/BoardMini.tsx`：props `{ participants, trends, counts, records, nextResetAt, meId, rows, onSelect }`，渲染 `<Leaderboard … limit={rows} moreTo="/board" highlights={<WeekHighlights …/>} />`，`rows` 手机 `BOARD_MINI_ROWS_PHONE`（5）/ 桌面 `BOARD_MINI_ROWS_DESKTOP`（9）。外层类 `.lb` 保留。
- `src/components/BottomTabs.tsx` + `bottom-tabs.css`（`.btabs`）：`{ me, route, todoCount, meDot, myPath }` + 纯函数 `showsBottomTabs(route)`（`sessionNew`、`rollcall` 之外都显示）。`<nav className="btabs" aria-label="主导航">` 放在 `.app` 最后：「大厅」`/`（角标 `<span className="visually-hidden">，要你处理 </span>{n}`）、「信誉榜」`/board`、「＋ 组一局」（登录 `<Link to={SESSION_NEW_PATH}>`，访客 `<LoginLink returnTo={SESSION_NEW_PATH}>`，可访问名「组一局」）、「我的」（登录去 `myPath`，`meDot` 时圆点 + visually-hidden「，有待办」；访客 `LoginLink`）。当前项 `aria-current="page"`。
- `src/components/AccountMenu.tsx`（样式沿用 `header.css` 的 `.hdr__menu` / `.hdr__dropdown*`）：`{ me, myPath, onOpenOnboarding, onRecord?, onOpenAdmin?, onLogout, dot? }`。触发按钮 `aria-expanded`，**可访问名里必须有 `me.username`**；展开 `<div className="hdr__dropdown panel" id="hdr-account-menu" role="group" aria-label="账户菜单">`，项依次：「我的」→「编辑身份」→「通知与 Discord」→（裁判 / 管理员）「记一笔」→（管理员）「管理」→「退出登录」。Esc / 点外面关闭的行为照今天。
- `src/components/Skeleton.tsx` + `skeleton.css`（`.skel`）：`{ label, lines?, className? }` → `<div className="skel" aria-busy="true"><span className="visually-hidden">{label}</span>{灰条 aria-hidden}</div>`；闪动只写在 `@media (prefers-reduced-motion: no-preference)` 里。也替换第 1 步 `SessionsPanel` 的「加载中…」和 `RecentSessions` 展开中。

**修改**
- `src/components/Header.tsx` + `header.css`（就是 spec 的 TopBar；文件名、组件名、`.hdr` 前缀不改）：现有 props 不变，加可选 `pending?`（首次加载中不渲染账户区和导航）、`layout?`、`route?`、`onRecord?`、`myPath?`。DOM 顺序：品牌 `<Link … aria-label="EDG 信誉分 首页">` →（桌面）`<nav className="hdr__nav" aria-label="页面">`「大厅」「信誉榜」「规则」（`/board/rules`）→ 回血倒计时 `.hdr__reset`（保留 `.hdr__reset-time`）→（桌面）「＋ 组一局」→ 登录 `AccountMenu` / 访客 `<LoginLink className="btn btn--gold">登录</LoginLink>`。
- `src/components/Leaderboard.tsx` + `leaderboard.css`：可选 `limit?`（只渲染前 N 名；本人在榜但不在其中时补一个 aria-hidden 的省略行和本人那行，名次按全榜算）、`moreTo?`（标题区「完整榜 ›」，可访问名「完整榜」）。默认行为不变。
- `src/components/MyScoreLine.tsx` + `my-score-line.css`：可选 `variant?: 'line' | 'card'`（只换样式类 `.msl--card`），可访问名和 `aria-label="我的分数"` 不变；`onOpen` 在 P4 前仍去 `playerPath(me.id)`。
- `src/components/SessionsPanel.tsx`：可选 `hideCreate?`（真时标题区和空状态都不出「组一局」按钮）。
- `src/App.tsx`：首页渲染区整体重排（见下）；`const extra = useTodoSources({ me, pendingAppeals: pending.appeals, refreshKey: sessionsKey })`；`items = me ? buildTodo({ …core, mine: lobby.mine, appealed: extra.appealed, discord: extra.discord, seenCancelled, unboundDismissed, now }) : []`；`lobby.loading || !extra.settled` 时给收件箱 `null`；`useTabTitle(todoBadgeCount(items))`（`src/lib/tabTitle.ts` 的 `todoCount` 保留不删，`countdown.test.ts` 锁着，App 不再调用）；`SessionsPanel` 传 `handledElsewhere={handledSessionIds(items)}`、`hideCreate`；收件箱报名用 `useRsvpAnswer({ reload: lobby.reload, onAnswered: handleChanged })`；`handleLogout` 在 `clearLoginReturn()` 之后调 `clearTodoMarks()`；删 `rulesOpen` / `showRules` / `revealSection`。超过 520 行就把首页排布抽成 `src/components/HomeLobby.tsx`。
- `src/app.css`：删 `.app__grid`、`.app__col*`、`.app__fab*`，加 `.app__lobby*`、`.app--tabs`（`padding-bottom` 留出底栏 + `env(safe-area-inset-bottom)`）；`src/components/toast.css` 在 `.app--tabs` 下把 toast 上移同样距离（一条规则）。
- `src/lib/coreData.ts`：`invites` 的类型放宽为 `InvitedSessionItem[]`，URL 不变。
- `shared/scoring.ts` 末尾 `// --- P3-2 ---`：`interface FilingViewer { id; is_admin; is_judge }` + `isFilingJudge(viewer, reporterId)` = `viewer.is_admin || (viewer.is_judge && reporterId === viewer.id)`。`worker/case-filing.ts` 删私有的 `function isFilingJudge(caller: User, reporterId: string): boolean {`，改从 `../shared/scoring` 引入，三处调用一字不改。
- `src/lib/constants.ts` `// --- P3-2 ---`：`TODO_SOON_MS = 2h`、`INBOX_APPEALS_LIMIT = 50`、`TODO_SEEN_MAX = 50`、`BOARD_MINI_ROWS_PHONE = 5`、`BOARD_MINI_ROWS_DESKTOP = 9`。
- `docs/CONTRACT.md`：把「An invitation is an action the user owes, so the invite banner outranks the weekly report on the page.」改成收件箱的说法，并在首屏请求那条后补登录后的三个请求；`README.md` 改 `/` 那一行。

**首页 DOM 顺序**（= 视觉顺序，按 `useRouteLayout()` 渲染两套）：
- 首次加载：`<Header pending config={null} me={null} …/>` + `<main className="app__main" aria-busy="true">` + visually-hidden `role="status"`「信誉分加载中…」+ 三块 `Skeleton`。**外壳里没有任何标题**。加载失败页不变。
- `<main className="app__main" hidden={covered}>`：h1（visually-hidden「EDG 信誉分」）→ `StaleNotice`、`DiscordLinkedNotice`、`LinkMissingNotice` → 按布局：
  - 手机（`page`）登录：`TodoInbox` → `MyScoreLine` → `SessionsPanel` → `BoardMini`(5) → `WeeklyReportCard compact` → `RecentSessions`；访客：`WelcomeCard` → `SessionsPanel` → `BoardMini` → `WeeklyReportCard compact` → `RecentSessions`。
  - 桌面（`drawer`）：`<div className="app__lobby"><div className="app__lobby-main">`（登录 `TodoInbox` / 访客 `WelcomeCard` → `SessionsPanel` → `RecentSessions`）`</div><aside className="app__lobby-side">`（`MyScoreLine variant="card"`（登录）→ `BoardMini`(9) → `WeeklyReportCard compact`）`</aside></div>`，aside sticky。
- 之后：`RouteView` → `footer.app__footer`（`hidden={covered}`）→ `CaseDialog`、`StatementDialog`、`OnboardingDialog`、`AdminAiPanel` → `BottomTabs`（`layout === 'page' && showsBottomTabs(route)`，此时 `.app` 加 `.app--tabs`）。

**删除**（替代品已在本步上齐之后）：`src/components/InviteBanner.tsx`、`invite-banner.css`、`PendingBanner.tsx`、`pending-banner.css`、App 里的 FAB（`app__fab`）和首页上的完整 `Leaderboard`、`RulesPanel`、`RecordsFeed`。然后 `grep -rn "revealSection\|FEED_PREVIEW_COUNT" src` 没有调用方时，删 `src/lib/revealSection.ts` 和常量 `FEED_PREVIEW_COUNT`。

**文案出处**：spec §2.1（导航、头像菜单）、§2.4（DOM 顺序）、§3.1–§3.3（收件箱各卡、排序、空状态、骨架）、§4.4（未绑卡）。收件箱各卡原文：
- 说明：「{立案人}记了你一笔 · {案由}」「{时间} 截止（{还剩…}）」「先说说发生了什么，AI 裁决会参考你的说明。」「草稿已存 · 写了 N 字」「写说明 ›」
- 改时间：「改时间了 · {组织者}的局」「原定 {旧时间} → {新时间}」（旧时间 `<del>`，前面 visually-hidden「原定」）「你之前说「{RSVP_LABEL}」，新时间还来吗？」
- 邀请：「{组织者}约你 · {游戏或局名}」「{时间} · {还有…} · 来 N」「看详情 ›」「开局前说不来，点名结算不会记你。」
- 快开局：「你答应了：{时间} · {还有…}」「来不了？现在说一声」「改成不来」
- 取消通知：「通知 · {组织者}取消了{时间}的局」「理由：…」「知道了」
- 点名：「该点名了 · {局名}」「{HH:MM} 开局 · {多久前}结束 · 来 N」「点名只记出勤；扣不扣分，下一步你说了算。」「去点名 ›」
- 升级：「待你确认 · AI 建议升级」「{当事人} · {案由} → 是团灭级吗？」「需要在判决前确认。」「去看看 ›」
- 申诉：「{N} 个申诉待复核」「去审理 ›」
- 私信：「Bot 上次给你的私信没发出去」「确认你还在服务器里，并打开「允许服务器成员私信」。」「去设置 ›」
- 未绑：「还没绑定 Discord」「绑定后：被约、改时间、该写说明都会私信你，在私信里能一键报名。」「去绑定 ›」「不再提示」

**测试**
- 新 `tests/unit/todo.test.ts`：每类卡的来源条件、12 档排序与组内顺序、计数、`handledSessionIds`、`meNeedsAttention`、各来源为 null 时的降级、`isFilingJudge` 三种情况。
- 新 `tests/dom/todo-inbox.test.tsx`：**每次回复都带 `starts_at`**；**收件箱和大厅里同一局只有一组「来」**；回复后卡片消失、焦点到「要你处理」；空状态原文；骨架 `aria-busy`；`/api/me/discord` 404 / 500 时没有设置卡；取消通知「知道了」后不再出现；未绑卡「不再提示」；申诉卡在列表失败时仍在、没有按钮。
- 新 `tests/dom/home-nav.test.tsx`：底栏四项、`aria-current`、角标和圆点、在发起 / 点名页隐藏；头像菜单按角色的项与顺序、「退出登录」；桌面两栏的 DOM 顺序；访客首页仍满足 `board.test.tsx:393-401`。
- 改 `tests/dom/app-refresh.test.tsx` 同一个用例：URL 集合再加 `/api/me/discord`、`/api/records?limit=50&status=appealed`；fixture 的 `/api/records?limit=20&mine=pending` 改为返回两起待说明（今天返回 `[]`，和 `pending.statements: 2` 矛盾），使标题仍是 `(3) EDG 信誉分`；用例名改成「…plus the follow-ups and the inbox’s reads…」。

**完成标准**：全部套件绿；`grep -rn "InviteBanner\|PendingBanner\|app__fab" src tests` 为空；`App.tsx` ≤ 520 行（否则已抽出 `HomeLobby.tsx`）；`board.test.tsx`、`my-score-line.test.tsx`、`login-return.test.tsx`、`route-pages.test.tsx`、`deep-link.test.tsx`、`p8-app.test.tsx`、`discord-link.test.tsx` 原样通过；worker 的升级确认 / 不升级 / 改案由用例照常通过。

## 4. 不能破的约束

先守 `docs/redesign-v5/HANDOFF.md` 第 4 节第 6 条（深链 `?case`、`?session`、`?linked`、`?onboarding` 永久兼容；spec §6.5 锁定文案和类名不改；CSP 不放内联 `<style>`、`style="…"` 字符串、`dangerouslySetInnerHTML`；DOM 顺序 = 视觉顺序；组件签名只加可选 props；新入口在接口 404 时静默隐藏），以及 P0–P2 契约（`docs/redesign-v5/plan-p0|p1|p2/contract.md`）的通用规则：CSS 只用四种断点写法、hover 包进 `@media (hover: hover)`、不写 `outline: none`、红字用 `var(--danger-text)`、表单边框用 `var(--border-input)`（`css-conventions.test.ts` 自动查）；新按钮不叫裸的「取消」「确认」「关闭」；toast 不用 `role="alert"`；被 `tests/unit` 导入的 `src/lib` 模块必须纯（不碰 `window` / `document` / storage、不导入 React）；**只有 `src/lib/router.ts` 能碰 `window.history`（注释也算）**；不往 `src/theme.css` 加 token；不改 `Modal.tsx`、`modalStack.ts`、`tests/dom/setup.ts`；不新增 `act(...)` 警告（始终 3 条）；不加模块级状态；没有迁移。

P3 特有：

1. **全页只有一个匹配 `/约局/` 的标题**：`SessionsPanel` 的 h2「约局」。卡片（`SessionCard`、`TodoCard`、历史行、点名名单行）里没有 h1–h6（局名可能含「约局」）；收件箱叫「要你处理」，名单叫「谁会来」，控制台叫「组织者」，发起页叫「约一局」；历史、信誉榜、点名页盖住大厅。
2. **首屏请求**：访客正好 6 个（`/api/config`、`/api/leaderboard`、`/api/records?limit=50`、`/api/me`、`/api/report/latest`、`/api/sessions?scope=upcoming`），一个不加——`RecentSessions` 点开才请求。登录用户只多 `/api/sessions?scope=mine`、`/api/me/discord`，以及管理员且 `pending.appeals > 0` 时的 `/api/records?limit=50&status=appealed`。原有 URL 一字不改；新请求一律 `Promise.allSettled`、**不放进 `loadInitialCore` 的 `Promise.all`**，失败静默（不出 alert、不出 toast、不进 StaleNotice）。「换个说法」不碰 `sessionsKey`；回到标签页不顺带请求 `/api/config`。
3. **RSVP 按钮的可访问名永远是「来」「待定」「不来」**：✓ 图标 aria-hidden，选中只靠 `aria-pressed`，局名不拼进按钮名（列表用组名「报名 {局名}」给上下文）；`aria-describedby` 只在有值时出现；每个面板只有一组；同一局在收件箱时大厅只给提示（`handledElsewhere`）；「改成不来」是单独的按钮名。
4. **锁定文案一字不改**（spec §6.5 全表，加上 P3 会碰到的）：409 原文「约局时间已经改了，请按新的时间重新确认」；「来 = 承诺，没来会被记一笔；待定不算承诺。」「开局前说不来，点名结算不会记你。」「来 N/N 满了，可以先报待定。」；报名 toast「已回复：来。开局前想改随时改。」「已改成：来」「收到，提前说了点名就不会记你 👍」「已撤销」；改时间 sheet 全部文案（无 offset 时「（本地时间）」、「先不改」默认焦点、toast「已改到 今天 22:00。」）；取消「取消这局」「取消这局？」「不取消了」「确认取消」「取消中…」、toast「这局已取消。」；「再叫几个人」在「改时间」之前；ResumeHint 和类名 `sdt__rsvp-btn--suggested`；访客「登录后报名」「用 Nanako 账号登录」、顶栏「登录」、菜单「退出登录」、品牌「EDG 信誉分 首页」；`/上周战报/`、`/往期战报/`、「周一 10:30 之后发布」；404 文案和「回大厅」；「没有待办，清清爽爽 ✨」（和 bot `/todo` 一字不差）；两段离开确认（P0）。
5. **看板时区回退**：`config.boardTzOffsetHours` 缺省（旧 API 和现有全部 fixture）时，输出和今天**逐字相同**（浏览器时区、`formatWhen` 不传第三参、`quickSlots`、「本地时间」）。旧后端的其他字段同理：`cancel_reason` 缺省 → 没有理由框；`going_preview` 缺省 → 不显示头像；`invite_reason` 缺省 → 当新邀请；`scope=history` 不支持 → 一句说明；`/api/me/invitable` 404 → 没有「再叫几个人」、发起页退回榜单名单。
6. **替代品先上，旧的后删**：`InviteBanner`、`PendingBanner`、FAB 只在第 7 步、`TodoInbox` 和头像菜单「记一笔」都已可用之后删除；首页的榜单 / 规则 / 动态只在 `/board` 子页（第 3 步）已存在后拿掉。
7. **隐私**：大厅卡片、名单、收件箱、历史页、分享文本、`.ics` 一律不显示分数、段位、是否绑了 Discord；`dm_ok` 只来自本人的 `/api/me/discord`，只给本人看；取消理由是公开的，渲染一律纯文本。段位色只在本人那一行。
8. **颜色**：`--attn` 只给需要你处理、说明截止不到 2 小时、改时间了、私信送不到；「不来」、已取消用中性色，不用红；`--danger` 不给人上色；每处颜色都配图标和文字。`pointer: coarse` 下新按钮 ≥ 44px；forced-colors 下 chip、角标、底栏当前项用边框表达。
9. **只有这 5 处现有断言有意改动**（写进 PR 描述）：`app-refresh.test.tsx:391-418`（第 1、7 步）、`route.test.ts:41-62` 的 later-phases 列表（第 3、4、6 步各删自己的路径）、`login-return.test.ts:106`（第 6 步）、`board.test.tsx:404-421`（第 3 步）、`organizer-actions.test.tsx:275-281`（第 5 步）。其余原有断言一律不改，只允许追加。
10. **文件大小**：任何文件不超过 800 行；`SessionDetailDialog.tsx` 第 5 步后应明显变短；`App.tsx` 不超过 520 行；P3 不碰 `worker/sessions.ts`。

## 5. 验证

每一步结束、提 PR 前都跑全量：

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck          # tsconfig.json、tsconfig.worker.json（无 DOM 库）、server/tsconfig.json
npm run test:unit
npm run test:dom           # 顺便数 act(...) 警告：仍是 3 条
npm run test:server
npm run test:worker
npm run test:pg            # 起嵌入式 PG 17，约 1 分钟；P3-7 的 report 用例在这里跑 PG 版本
npm run build
npm run build:pages        # dist 只有 _headers、assets/、index.html，没有 404.html
# 单跑一个文件：npx vitest run --config vitest.dom.config.ts tests/dom/<文件>
```

预期变化方向（相对开工时的基线）：

- typecheck、两个 build 通过；server 套件**不变**（P3 不碰 `server/`）。
- unit 多 6 个文件（`lobby-sessions`、`session-summary`、`session-console`、`ics`、`session-again`、`todo`），`route`、`invite-picker`、`source-hygiene`、`login-return` 的用例数增加。
- dom 多 9 个文件（`lobby-cards`、`weekly-report`、`board-pages`、`session-history-page`、`rollcall-page`、`organizer-console`、`new-session-page`、`todo-inbox`、`home-nav`）。
- worker 文件数不变、用例数增加（`report.test.ts`）；pg 跟着增加同样的用例。
- JS 体积会涨（新组件），把 build 输出的 kB 数写进 PR 描述。
- PG 已知抖动：负载高时 `tests/pg/adapter.test.ts`「refuses a database whose text does not sort by code point」可能 5 秒超时，单独重跑确认 4/4，写进 PR 描述。

**手动检查（机主做；代理在 PR 里写「未手动验证」）**

375 × 812（手机）：
- [ ] 登录首页顺序：要你处理 → 我的分数 → 约局 → 信誉榜前 5（不在前 5 时末尾补自己那行）→ 上周战报 → 最近结束（折叠）。
- [ ] 访客首页：欢迎卡 → 约局 → 榜 → 战报；首屏能看到欢迎卡、第一个约局、榜单前 1–2 名；没有「鸽王」。
- [ ] 底栏四项、「大厅」角标数 = 收件箱标题里的数、标签页标题 `(N) EDG 信誉分`；toast 不被底栏挡；刘海机底部安全区留白。
- [ ] 约局卡：进行中、今晚 / 本周 / 更晚分组、已取消灰卡带理由、满员角标、「你：来 / 改成不来」、「↑ 在「要你处理」里」；按钮好点（≥ 44px）。
- [ ] 收件箱里点「来」：卡片消失、焦点到「要你处理」、大厅那张卡同步变成「你：来」；toast 撤销可用。
- [ ] 详情页：两行时间（北京时间 / 你那边）、「你去吗？」、「谁会来」分组、分享三按钮（系统分享面板、复制、`.ics` 在 iOS / Android 上能加进日历且有 15 分钟提醒）。
- [ ] 组织者控制台四态；「再叫几个人」搜索、「和上次一样」；改时间显示北京时间时段；取消理由出现在私信和灰卡上。
- [ ] `/sessions/new`：页面形态、sticky「约！」、底栏隐藏、选了人后点返回会确认；`?again=` 预填下周同一时间。
- [ ] 点名页：底栏隐藏、标记后返回会确认、刷新后标记还在；完成页摘要、「回到这局」「再约一次」。
- [ ] `/board` 四个子页、`/board/rules` 四张卡 + 用词表、段位表没有 blurb；`/sessions/history`「加载更多」。
- [ ] 系统开「减少动态效果」时骨架不闪；Windows 高对比（forced-colors）下 chip、角标、底栏当前项可辨。

1280 × 800（桌面）：
- [ ] 两栏：左（收件箱、约局、最近结束），右 sticky（分数卡、榜前 9、战报）；滚动时右栏粘住。
- [ ] 顶栏「大厅 · 信誉榜 · 规则 ｜ ＋ 组一局 · 头像菜单」，当前项高亮；没有底栏；头像菜单按角色出现「记一笔」「管理」，最后是「退出登录」。
- [ ] `/sessions/new` 是盖在大厅上的居中弹窗；建好后到新局并出现「约好了」卡，按返回键不回到空表单。
- [ ] 详情抽屉里的控制台、InviteSheet、RescheduleSheet；Esc 只关最上层。
- [ ] 窗口宽度跨过 1024px 来回拖，页面不报错、内容不丢。

## 6. 需要机主过目

以下是对 spec 的偏离或补充，写进 PR 描述：

1. **登录后首屏多 2 个请求（管理员最多 3 个）**：`scope=mine`（spec P3-1 本来就有）、`/api/me/discord`（为了收件箱的「私信送不到」「没绑 Discord」两类卡）、有待复核申诉时的 appealed 列表；spec §10 第 4 条估 1–2 个。`app-refresh.test.tsx` 的 URL 集合因此有意改动。想省一个请求，可以把两类设置卡推到 P4-1。
2. **周报口径**：新周报的 `stats` 多一个 JSON 键 `basis: 'verdict'`，卡片据此写「判决」；旧周报不重算，仍写「立案」。bot 周报卡和 AI 提示词里的「立案」不改（spec B3-1「bot 本轮不改」），所以新口径下 bot 卡写的「立案 N 起」实际是判决数。`/board/report` 用新的可选 prop `hidePigeon` 隐藏「上周鸽王」，叙事正文里若写了鸽王照旧保留（§11 第 2 条）。
3. **「和上次一样」= `last_played_with_me_at` 最近的那批人**（我最近一局双方都来了的人），不是 spec 字面的「这个组织者上一局的阵容」：零额外请求，InviteSheet 和发起页同一份规则。「再约一次」预填：那局名单除我和说了不来的人、原时间加 7 天的整数倍直到在未来、游戏 / 人数 / 时长，局名只在不是自动标题时预填，备注不预填。
4. **收件箱在 P4 前的简化**：申诉卡只写「N 个申诉待复核」，不写「最早的已等 N 天」（`RecordItem` 没有申诉时间，用立案时间会写错），按钮去最早立案的那一起；徽标和标签页计数不算取消通知和「没绑 Discord」，申诉按条数计（spec 两张线框的数字口径不一致，取第一张）；升级卡只看动态流前 50 条。
5. **推迟或不做**：详情页「这局有人出事了？记一笔 ›」推迟到 P4-2（要 `/cases/new?session=`），P3 的「记一笔」入口只有头像菜单（满足「FAB 删除前头像菜单里的记一笔已可用」）；桌面 aside 的 `InviteFriendsCard` 不做（指向 P4 的 `/join`）；PageBar 不放「分享 ⇪」，分享只在名单下面一处。
6. **桌面两栏和手机单栏渲染两套 DOM**：spec §2.4 的手机顺序（分数在约局前、最近结束在最后）和桌面顺序（分数在 aside、最近结束在 main）无法用一份 DOM 同时满足「DOM 顺序 = 视觉顺序」，所以按 `useRouteLayout()` 各渲染各的；顶栏导航只在桌面、底栏只在手机（避免两份同名链接）。代价：窗口跨过 1024px 时首页各块重新挂载（P1 的抽屉 / 页面切换也是这样）。
7. **点名和发起页的离开确认沿用 P0 文案**：草稿其实存在 `localStorage`、不会丢，所以不用 spec §3.6 / §3.7 的「不会保存」「离开会丢失」；浏览器返回键直接离开点名页、不拦（草稿还在）。另：已取消的局在大厅时间线末尾单独成「已取消」组（保留到原定开局后 24 小时），不插回「进行中 / 今晚」，免得误导。
8. **P4 之前的过渡**：「我的」（底栏、头像菜单、MyScoreLine）去 `/players/<我>`，P4-1 有 `/me` 再换；菜单项仍叫「退出登录」（测试锁，spec 写「退出」）；「编辑身份」「通知与 Discord」和收件箱的两类设置卡都打开 `OnboardingDialog`；「最近结束」访客也有（折叠、点开才请求，不影响访客首屏）。

## 7. PR

- 分支 `claude/p3-lobby-board`；标题：`feat: 大厅、组织者控制台与信誉榜（P3）`。commit 和 PR 描述都不加署名行。
- 描述要点：
  - **概要**：按七步列出做了什么（P3-1 卡片与时间线 → P3-7 周报口径 → P3-6 信誉榜页与历史 → P3-5 点名页 → P3-3 组织者控制台 → P3-4 发起页 → P3-2 首页改版），每步一两句，并说明顺序的理由（替代品先上、旧的后删）。
  - **有意改动的 5 处现有断言**（第 4 节第 9 条），每处写改前锁什么、改后锁什么。
  - **偏离 spec 的地方**：第 6 节 8 条。
  - **后端与部署**：没有迁移、没有新接口；改了 `worker/report.ts`（周报口径）和 `worker/case-filing.ts`（`isFilingJudge` 移到 `shared/scoring.ts`，行为不变）。合并后前端由 Cloudflare Pages 自动部署，**后端要在 Coolify 手动 Redeploy**；下一份周报（周一 10:30 后）按判决时间生成，已有周报不变，管理员对某周「换个说法」会按新口径重算那一周。
  - **验证**：六个套件 + 两个 build 的前后数字（文件 / 用例）、`act(...)` 警告仍为 3、JS 体积；PG 抖动如有就写明重跑结果；第 5 节手动检查清单（代理写「未手动验证」，由机主在 375 × 812 和 1280 × 800 上勾）。
  - **留给 P4**：`/me*`、`/cases/new?session=` 和详情页的「记一笔」、`/api/me/todo` 与可撤案卡、申诉卡的「已等 N 天」、「我的」改去 `/me`。
