# P0 各 PR 计划的审查记录

> 六份计划各自的独立审查（v1 → v2）记录，原先附在每份计划末尾的「## 审查记录」，现集中在这里；计划正文（`plan-P0-N.md`）只保留要执行的内容。
> 文中提到的 `plan-P0-N.md`、`plan-P0-N.v2.md`、v1/v2、行号，都指当时 `/tmp/claude-redesign/p0/` 下的草稿版本；最终版本以本目录的 `plan-P0-N.md` 为准。之后的跨 PR 一致性检查（改了哪些、怎么验证）见 `README.md` 的「跨 PR 一致性检查记录」，本文末尾也有摘要。

---

## P0-1 地基与视觉基础

审查方式：在 `/tmp/claude-redesign/p0/p0-1-review/`（`git archive HEAD` 导出的快照副本，`node_modules` 软链到 worktree，worktree 本身未动）里从快照起逐 Task 照 v1 原文执行：每个 red 步骤的失败数和失败信息、每个 green 步骤的通过数、两段 diff 的 `git apply --check`，以及收尾的 `npm run typecheck`、全量 unit / dom、`modal-focus`、`vite build`。另把 P0-2/P0-3/P0-4/P0-6 计划里全部 ```css 代码块临时放进 `src/components/` 跑本 PR 的 `css-conventions.test.ts`，确认本 PR 的约定不会卡住它们。

### 改了什么、为什么

1. **新增 Task 9：H8 之后被组件规则压掉的触控尺寸（v1 漏掉的真回归）。** 导入顺序翻过来以后，theme.css coarse 块里的规则（0,1,0、现在最先加载）会输给组件里同类名同属性的顶层规则。逐条比对快照得到正好两处：
   - `theme.css:309-311` `.sessions__tab { min-height: 40px }` 被 `sessions-panel.css:30-31` `.sessions__tab { min-height: 36px }` 压掉 → 触屏页签变矮；
   - `theme.css:301-307` 的 `padding-block: 0.6rem; margin-block: -0.6rem` 对 `.hero-card__link` 只剩外边距生效（`red-black-board.css:164` `padding: 0.35rem 0` 压掉了内边距）→ 热区缩小并与上下文字叠 0.25rem。
   其余 coarse 选择器（`.btn`、`.btn--sm`、`.feed-row__subject`、`.invite__detail`、`.wr__regen`、`.modal__close`）在组件里没有同属性规则（`records-feed.css:73-78`、`invite-banner.css:59-64`、`weekly-report.css:57-62`、`modal.css:32-37` 只设 width/height，不设 min-*），不受影响。修法放在组件 css 里、**不动 theme.css 的 coarse 块**，因为 P0-2（`plan-P0-2.md:2017-2038` 以该块原文为「改前」）和 P0-4（`plan-P0-4.md:1364,1638-1647`）都按内容定位这块。新增断言 ⑧ 锁住这一类问题；red 步骤实测 `1 failed | 12 passed (13)`，正好列出上面两条；green 后 unit `223 passed`。
2. **用例数 222 → 223**（css-conventions 12 → 13）：`文件结构` 下的基线说明、收尾预期、试跑说明同步改。Task 8 结束时仍是 222（Task 9 在其后），那一处不改。
3. **Task 4 的 theme.css 行号**：v1 写 `theme.css:141-149` 却没说明是快照行号；Task 2 把 `:root` 从 65 行扩到 115 行后，这段实际在 `:191-199`。补注「按内容定位」。
4. **Task 6 Step 3 的核对命令**：v1 的 `git diff | grep '^[-+] ' | sort | uniq -c` 会把 Step 1 未提交的测试行（`+  it('writes red text…`、`+    expect(…`、`+  });`）也数进去，与给出的「预期」对不上。改成 `git diff -- src`，实测输出与预期四行完全一致。
5. **Task 7 Step 4 的 `git diff --stat`**：同理，实测不加路径是 `9 files changed, 39 insertions(+), 28 deletions(-)`；改成 `git diff --stat -- src`，实测 `8 files changed, 28 insertions(+), 28 deletions(-)` 与预期一致。
6. **Task 8「没有信息只在 hover 时出现」的说法收窄**：35 条 CSS `:hover` 规则确实只改边框/底色/位移/下划线；但 TSX 里有 5 处 `title=` 悬停提示（`AdminAiPanel.tsx:299`、`RecordsFeed.tsx:91`、`TierBadge.tsx:24`、`VerdictCard.tsx:62,65`）。本 PR 不碰 TSX，写明不在范围、留给换皮。
7. **Task 10（原 Task 9）视觉验收补全**：用脚本比对了快照中「theme.css 规则 × 同一元素上的组件规则」的全部同属性冲突，v1 的 5 项基本完整，只补了 `.srow__when` 的 `font-family` 也会从 `--font-num` 变为 `--font-display`（`sessions-panel.css` 里组件自己写的），并新增第 6 项触控尺寸（对应新 Task 9）；构建产物位置更新为做完 Task 1-9 后的实测值 `3523 < 22487 < 35277`。手动检查清单和 PR 截图项同步加一条。按钮/页签文案用组件里的原文（`SessionsPanel.tsx:22-23`「即将开始 / 已结束」，`RedBlackBoard.tsx:60`「查看战绩」）。
8. **「对契约的补充」加第 10 条**（断言 ⑧ 及其对 P0-2、P0-4 的影响），**自查表**加「H8 副作用」和「语义层不越界」两行（段位色 `#d98e04` 重映射在 spec `:1240` 属 P4-1；ScoreGauge `tone` 属 P0-4/P1-1，spec `:1001`）。

### 核对过、无需改动的部分

- 所有 Modify 行号与快照一致：`main.tsx:3-4`；`theme.css:6-70`、`:141-149`、`:236-244`、`:291-317`；18 处宽度媒体查询（`git grep -n '@media'` 输出逐条吻合）；23 处红字（22 条规则，`red-black-board.css:30,31` 同一规则两处）；`sentencing-scale.css:89-92`（`var(--down)` 共 14 处，只有 `:90` 是 `background`）；`case-dialog.css:47-51,149-152`、`session-form.css:93-96,184-186`、`onboarding-dialog.css:163-167`、`rules-panel.css:23-25`。
- 每个 red 步骤的预期都与实测一致：Task 1 `expected 112 to be less than 98`；Task 2 `25 failed | 6 passed (31)`；Task 3 正好 18 条；Task 4 `3 failed | 3 passed (6)` 且三条清单逐项吻合；Task 5 `3 failed | 6 passed (9)`；Task 6 22 条；Task 7 11 条；Task 8 35 条（`grep ':hover'` 交叉核对无遗漏）。Task 7、Task 8 两段 diff 均 `git apply --check` 通过。
- 对比度实测（WCAG 2.x）：`--faint #848fa0` 5.91/5.69/5.33/4.98；`--border-input #66738a` 4.04/3.89/3.64/3.40；`--danger-text #ff6b6f` 6.99/6.73/6.30/5.89；`--focus #8ab4ff` 9.26–7.80；`#e5484d` 在 `--panel-2` 上 4.17（注释「4.2:1」成立）；金/琥珀 1.45。与 spec §6.1 表、契约 §3.1 一致。
- 类型：两个新测试只用 `node:fs`/`node:path`/`vitest`，`tsconfig.worker.json`（`lib: ES2022`）下 `tsc` 无输出；`npm run typecheck` 三个 tsconfig 全过。代码全部不可变（reduce 返回新状态、只用 `filter/map/flatMap`）、函数 < 50 行、无 `console.log`、阈值都是具名常量。
- 其他测试：dom 8 文件 / 54 用例全过（jsdom 不加载 CSS，本 PR 只改一个 `.tsx` 的两行 import），`modal-focus` 4 / 4；§6.5 锁定文案、类名（`vc--focus`、`.feed-row__status--escalate`）、组件签名、深链、首屏请求都未触及。`.vc--focus` 的金色 outline（`verdict-card.css:123-126`）在新顺序下照样压过全局 `:focus-visible`。
- CSP：只改 `.css` 和 `main.tsx` 的 import 顺序，不引入内联 style/`<style>`；DOM 顺序：未引入 `order`/`*-reverse`/grid 重排（`.hero-card__body` 的 `flex-direction: column` 是既有的、不反转）。
- forced-colors 状态 chip 名单 9 个类名都真实存在（`records-feed.css:98`、`session-detail.css:40,123-124`、`sessions-panel.css:132-140`、`roll-call.css:64`、`tier-badge.css:1`），`html` 前缀的理由成立（例如 `.feed-row__status { border: 1px solid transparent }` 在组件里、后加载）。
- 范围：spec §9 P0-1 列出的每一项都有 Task；没有混入 P0-2（`.modal__close` coarse 规则仍原地不动）、P0-4（`.hero-card__link,` 行、RedBlackBoard 删除、ScoreGauge `tone`）或 P4-1（段位色）的内容。`.ob__name-input:focus` 去掉 `--glow-gold` 符合 spec §6.1「删掉所有 outline:none 加 box-shadow 的写法」。
- 跨 PR：P0-2/P0-3/P0-4/P0-6 计划里的 CSS 代码块全部通过断言 ①–⑦；⑧ 唯一的命中是 P0-4 计划里截出来的 theme.css coarse 块片段（脱离了 `@media` 外壳单独展示，提取时被当成顶层规则），不是真问题。

---

## P0-2 Modal 栈、sheet、ConfirmInline

独立审查（对照 d72e11b/31eb168 快照代码、spec §6.4/§6.5/§9、契约 §2–§5）。验证方式：在 `/tmp/claude-redesign/p0/p0-2-replay2`（`git archive HEAD` 快照 + 软链 node_modules，未装 P0-1）里**从本文件逐块抽取代码**，按 Task 1→8 顺序重放每个 red / green 步骤：red 的失败用例和报错与文中一致；green 后 dom 依次为 58 / 64 / 66 / 70 / 74 / 84 / 86，每个 Task 后 `npm run typecheck` 通过，unit 178/178（P0-1 前的基线），`vite build` 成功，`modal-focus.test.tsx` 原样 4/4，无新增 `act(...)` 警告。Task 5 的 ①–⑧ 增量改法应用到 Task 4 的文件后，与 Task 5 给出的全文**逐字节相同**（`diff` 无输出）。

### 改了什么

1. **`Modal` 函数超过 50 行（机主规则）。** v1 Task 5 的终稿里 `export function Modal` 从解构到结尾共 52 行（v1 `plan-P0-2.md:1704-1755`）。改法：Task 4 起把 portal + panel 的 JSX 拆进不导出的 `Layer` 组件（`LayerProps` 多一个 `panelRef`），`Modal` 只管 ref、`useLayer`、`usePageFocus` 和分支，终稿 45 行。拆组件不产生 DOM 节点，旧 markup 不变（`center without title keeps today’s markup exactly` 照过）。相应改了 Task 4 全文、Task 4「要点」第 3 条、Task 5 的 ③（四处 → 五处，加 `interface LayerProps`）、⑧（插入点改为 `return ( <Layer` 之前）、收窄说明，以及 Task 5 的核对全文。
2. **缺一条真实 `<StrictMode>` 用例。** 契约 §5 第 5 条（`contract.md:937`）要求 StrictMode 下 push/pop 按 id 幂等，`src/main.tsx` 用了 StrictMode；v1 只在 Task 1 用纯函数调用模拟。Task 2 在 `Modal — nested layers` 组里追加 `StrictMode’s mount → unmount → mount leaves one layer per open dialog`（层数、inert、嵌套 Esc、焦点还原、滚动锁），Task 1 文件头的 import 改为 `import { StrictMode, useState } from 'react';`。在旧 `Modal.tsx` 上实测失败为 `expected +0 to be 1`，已写进 Task 2 Step 2（失败数 5 → 6）。随之更新计数：`modal-stack` 9/11/15/19 → 10/12/16/20，dom 63/69/73/85 → 64/70/74/86，收尾与 PR 描述同步。
3. **手动检查 A 的按钮名写错。** 详情里打开点名的按钮是「点名结算」（`src/components/SessionDetailDialog.tsx:197-204`），出现条件是 `canManage && session.status === 'open' && started`（`:82`），不是「点名」。已改名并注明条件和出处。
4. **`ConfirmInline` 会为 `false` 渲染空的 `.ci__detail`。** v1 只排除 `undefined`/`null`；调用方写 `{cond && <Field />}`（P2 的取消理由就是这种写法，spec §3.5「P2 有 cancel_reason 之后才出现」）时得到 `false`，会留一个空框。加 `hasContent()`（同时排除布尔值），`renders no detail block…` 用例补一段 `children: false` 断言（用 RTL 的 `cleanup()` 隔开两次渲染，import 加 `cleanup`），用例数不变。「对契约的补充」第 2 条同步。
5. **用例名与断言不符。** `tone picks the confirm style: danger outline by default, gold for primary` 只断言了 danger（gold 在下一条），改名为 `the confirm is a danger outline button by default`。
6. **两处预期缺 dom 全量数字**：Task 3 Step 4、Task 7 Step 5 补上（66、84），便于每个 commit 自检。
7. **Task 0 基线**：补上 P0-1 计划给出的 unit 收尾预期 16 个文件 / 222 个用例（`plan-P0-1.md:1865`）作对照。
8. 自查表：StrictMode 一行补上 Task 2 新用例；新增「函数 < 50 行 / 不可变 / 无 console」一行。

### 核对过、无需改动

- 行号：`Modal.tsx:1-158`、inert 计数 `:16-38`、setup effect `:71-128`、焦点落点 `:115-119`；`modal.css:1-71`、hover 规则 `:47-51`（P0-1 计划 `plan-P0-1.md:1462-1475` 只把它包进 `@media (hover: hover)`）；`theme.css:309-317`（`.sessions__tab` + `.modal__close` coarse 规则在 `:313-316`，P0-1 只在 `:317` 之后追加，`plan-P0-1.md:919`）、`.btn--gold :223`、`.btn--ghost :246`；`tests/dom/setup.ts:1-2`；`index.html:17`；`PlayerDetail.tsx:136`；`SessionFormDialog.tsx:94`；`discord-link.test.tsx:183,197` 的 `getByRole('dialog')`——全部与快照一致。
- CSS 用到的现有 token 都在 `theme.css`：`--border-strong :13`、`--inner-glow :35`、`--shadow-pop :38`、`--r-sm/md/lg/pill :41-44`、`--dur-fast/--dur/--ease :64-66`；P0-1 token（`--z-modal`、`--tap-min`、`--sheet-max-h`、`--safe-bottom`、`--fs-*`、`.btn--danger-outline`）与契约 §3.1 同名。全局 `* { margin: 0 }`（`theme.css:80-82`）保证 bar 里的 `h2` 没有默认外边距。
- P0-1 的 `css-conventions.test.ts`（`plan-P0-1.md:446-582,640-671,976-1000,1058-1069,1311`）：本 PR 的 CSS 只用 `(max-width: 600px)` / `(min-width: 1024px)`，`:hover` 都在 `(hover: hover)` 里，没有 `outline: none`、`--focus-ring`、焦点 box-shadow、红字、表单控件选择器，可以通过（沙盒没有 P0-1，按其规则人工核对）。
- CSP：`scripts/pages-headers.mjs:29` 是 `style-src 'self' https://fonts.googleapis.com`（无 `'unsafe-inline'`）；本 PR 只用类名和 CSSOM（`body.style.overflow`），合规。
- 仓库没有 ESLint（`package.json` 无依赖、`node_modules/.bin` 无 eslint），`useEffect(..., [active])` / `[]` 的依赖写法不会被 lint 拦；`vitest.dom.config.ts` 设了 `globals: true`，RTL 自动 cleanup 生效；setup 文件的 `afterEach` 最先注册，在 Vitest 默认 `sequence.hooks: 'stack'` 下最后执行，注释成立。
- 层栈顺序与监听注册顺序一致（都由 effect 执行顺序决定），所以真实浏览器里 microtask 在监听之间冲刷、React 同步 flush passive effect 时，下层也不会在同一次 Esc 里接着关。
- 锁定文案：✕ 的可访问名仍为「关闭」；测试里的确认文案用 spec §3.5 原文（「取消这局？」「不取消了」「确认取消」），没有裸「取消」「确认」；没有越界改其它 PR 的文件。

### 看到但没改（超出 P0-2 范围，或改了会动今天的行为）

- 两层在**同一次 commit** 卸载时（例如父组件整体卸载、子层还开着），React 先跑外层 cleanup：外层还原焦点时 `#root` 仍是 inert（内层还没释放），焦点落不进去；内层再还原到已脱离文档的按钮，焦点最后落在 body。这是今天 `Modal.tsx:121-126` 就有的行为；P0-2 之后 Esc 不再连关两层，触发面已变小。改成延迟还原（microtask）会改变所有调用方的焦点时序，留给 P1-2（浮层入 history）一起处理。
- `dismissible={false}` 时点背景，浏览器会把焦点移到 body；下一次 Tab 由陷阱（`!panel.contains(active)` 分支）拉回面板第一个可聚焦元素。没有在背景 `mousedown` 上 `preventDefault`，因为背景层同时是滚动容器，拦掉默认行为有影响滚动条拖动的风险。

---

## P0-3 数据不崩、Toast、useUndo

审查方式：逐条对照代码（`31eb168` 快照）与 spec / 契约；另外把 v1 和 v2 计划的每个代码块原样套到仓库副本（`/tmp/claude-redesign/p0/p0-3-review/`，不碰 worktree），按任务顺序跑每一步的「确认失败」和「确认通过」，最后跑 typecheck、unit、dom 全量和 `vite build`。v2 结果：每个红步骤都按写明的原因失败，每个绿步骤都通过；最终 typecheck 三个 tsconfig 通过、unit 204/204、dom 77/77、build 成功，stderr 只有 `onboarding-roles` 原有的三条 `act(...)` 警告。（副本是 P0-1 之前的代码，没有 `css-conventions.test.ts`；新 CSS 已对照 P0-1 计划里这个测试的各条规则人工核过：断点只用 `min-width: 601px`，`:hover` 在 `@media (hover: hover)` 里，没有 outline 去除、没有 `--focus-ring`，没有用填充红写文字，用到的 `--r-*`、`--shadow-pop`、`--dur`、`--ease` 都在 `theme.css` 里。）

### 改了什么、为什么

1. **刷新失败的提示会被一次「只刷新别的部分」的成功刷新清掉（正确性）。** v1 的 `afterReload` 只要这一次 `failed` 为空，就设 `stale: null`、`loadedAt: now`。可是 App 里有只刷新部分 key 的调用：周报重写成功后 `refresh(['report'])`（契约 §3.3），跨过重置点时 `refresh(['config'])`（Task 10）。榜单刷新失败之后，管理员点一次「换个说法」，提示就没了，「N 分钟前」也从那一刻重新算，而榜单其实还是旧的——M11 要的「出错时诚实地局部提示」被破坏了。已用副本证实：新加的用例「stays up while what failed is still old…」在 v1 的 `useCoreData.ts` 上失败，在 v2 上通过。修法：`stale` 多一个 `keys` 字段（`StaleInfo`），还有失败的部分没被成功重拉就不清提示；`loadedAt` 只在这次刷新覆盖全部 `VISIBLE_KEYS` 时前移。见「对契约的补充」第 14 条、Task 7 Step 4、Task 9 第三个用例。
2. **两个新函数超过 50 行（机主规则）。** v1 的 `useCoreData` 62 行（v1 计划 :1574-1635），`ToastCard` 53 行（v1 :1036-1088）。改成：串行队列抽成文件内的 `useSerialQueue`，返回类型抽成 `CoreDataApi`（`useCoreData` 变成 48 行）；暂停计时抽成 `usePausableTimeout`（`ToastCard` 变成 37 行）。行为不变，Task 5、Task 7 的用例照常通过。
3. **周报重写没有任何测试，人工检查里的按钮名也写错了。** 按钮叫「换个说法」，进行中是「重写中…」（`src/components/WeeklyReportCard.tsx:84`），不是「重写」；这张卡在页面上叫「战报」（`WeeklyReportCard.tsx:70`）。v1 的 `.then(() => refresh(['report']), err => toast…)` 原样写在 JSX 深处（`App.tsx:339-344`），嵌套很深。改成：`AppMain` 里新增 `handleRegenerate(week)`，JSX 只剩 `() => handleRegenerate(report.week_start)`；错误文案改为「战报没换成新说法：…」/「战报没换成新说法，请稍后重试」，和卡片的叫法一致；Task 7 新增两个用例（成功时只多请求一次 `/api/report/latest`，榜单、config、约局都不重拉；失败时出现 `role=status` 的 toast、没有 alert、按钮恢复）。两个用例的红步骤已核实：一个是 `expected 2 to be 1`，另一个找不到 toast 文案，外加一条未处理的 `ApiError`。
4. **503 的注释与代码不符。** v1 写的是「READ_ONLY maintenance (worker/routes.ts:177-191) … answer 503」，但 READ_ONLY 中间件只拒绝写请求（`worker/routes.ts:187-189`：`writes` 只包括非 GET/HEAD/OPTIONS 和 `/auth/callback`），GET 在维护期间照常返回。注释改成：GET 的 503 来自托管网关，worker 自己的只读开关不会让 GET 返回 503。文案和判断逻辑（`ApiError.status === 503`）不变；网关返回 HTML 时 `parseJson` 抛出的 `ApiError` 仍然带 503（`src/api.ts:81-83`）。
5. **Task 8–11 的 App 行号不对。** 这几步都写「行号指上一 Task 之后的文件」，v1 给的却是插入本步导入之后的行号（`:180-182`、`:248`、`:191`、`:202`）。在副本上按顺序打出来，实际是 `:178-180`、`:267`（v2 多了 `handleRegenerate`，v1 是 `:247`）、`:190`、`:200`。已全部改正，并注明是「插入导入之前的行号」。
6. **unit 红步骤的报错写错了。** unit 项目找不到模块时报的是 `Error: Cannot find module '../../src/lib/tabTitle' imported from …`（`Tests  no tests`），不是 dom 项目那种 `Failed to resolve import`。Task 2、Task 3 已改。Task 4 的 `'00:00:30'` 实测无误，补了一句：在 `shouldAdvanceTime` 下秒数可能是 29。
7. **「首屏请求的顺序与今天一致」不准确。** 今天的代码要等五个主请求全部返回才发 me 的两个后续请求（`App.tsx:65-84`）；v1 的 `loadMe` 在 `/api/me` 一返回就发。URL 集合不变（Task 4、Task 11 两个用例锁住），但先后有变化。Task 7 Step 3 的说明已改成如实描述；代码不用改。
8. **人工检查里有一条做不到。** 「打开任意弹窗时触发一个 toast（周报重写失败最容易造）」——弹窗开着时 `#root` 是 inert 的，周报卡点不到，P0-3 的 App 里也没有别的 toast 调用点。另外 `Modal.tsx:140` 设了 `aria-modal="true"`，读屏软件可能不读弹窗外的 toast，v1 写的「会被朗读」不能保证。改成：P0-3 只验收弹窗外的 toast，弹窗内 toast 的真机验收移到 P0-6 的 RSVP toast；`Toast.tsx` 的注释和「对契约的补充」第 15 条把这个限制、以及按钮随提示消失后焦点落回 `<body>` 的问题写明（toast 只做补充反馈，弹窗里的错误继续用内联的 `role="alert"`，与契约 §3.3 一致）。
9. **数量和体量随上面几条更新。** `app-refresh` 8 → 11 个用例，dom 全量 74 → 77；`App.tsx` 约 436 → 442 行（多出来的是 `handleRegenerate`）；「对契约的补充」原来的 14、15 条顺延为 15、16 条；自查表补了周报重写和函数长度两行。

### 核过、没有改的

- Modify 行号：`Header.tsx:4`、`:17-25`、`:33`、`:61`；`time.ts` 共 153 行，在末尾追加；`App.tsx:3-22`、`:24`、`:47-95`、`:121-122`、`:146-161`、`:240-250`、`:258-281`，副本上逐字替换全部唯一命中。
- 选择器和接口：`.hdr__reset-time`（`Header.tsx:78`）、行名 `第 N 名 X，S 分`（`Leaderboard.tsx:56`）、「设为裁判」（`PlayerDetail.tsx:181`）及其走 `run → load → onChanged`（`:115-121`）、`setJudge` 的 URL `POST /api/admin/users/:id`（`api.ts:297-299`）、`limit=20&mine=pending` 的参数顺序（`api.ts:135-139`）、`MeResponse.pending`（`types.ts:171-174`）、`index.html:8` 的标题 `EDG 信誉分` 与 `BASE_TITLE` 一致。
- 锁定项：`p8-app.test.tsx:118-131`、`deep-link`、`discord-link`、`onboarding-roles`、`session-rsvp-moved`、`player-judge`、`verdict-privacy`、`modal-focus` 在 v2 下全部原样通过；toast 和 StaleNotice 都不用 `role="alert"`；新代码没有往 document 装 keydown 监听（只有 `visibilitychange`）；没有内联 style 字符串、`<style>` 或 `dangerouslySetInnerHTML`（CSP `style-src` 没有 `'unsafe-inline'`，`scripts/pages-headers.mjs:29`）；没有 CSS `order` 或 `*-reverse`；组件签名只多了 `App` 外层的 Provider，`Header` 的 props 不变。
- 契约里有意的偏离（`coreKeys.ts` 拆分、`TodoSource`、跨重置点拆成两次刷新、重试带上过期的 `config`）理由成立：`tsconfig.worker.json:3-7,18-19` 确实没有 DOM 和 `vite/client` 类型；回血确实挂在 `GET /api/config` 的 `waitUntil` 上（`worker/routes.ts:210-229`）。
- 范围：没有混进其他 PR 的内容（不碰 `Modal.tsx`、`SessionsPanel.tsx`、`tests/dom/setup.ts`、`shared/`、`worker/`）；契约 §3.3 和 spec §9 P0-3 那一行的每一项都有对应任务（见自查表）。

---

## P0-4 榜单、本周之星、欢迎卡

审查方式：在 `/tmp/claude-redesign/p0/p0-4-review/` 建了一份沙盒，内容是 d72e11b 的 `git archive`，套上 P0-1 计划的结果（取自 `p0-1-review/` 的 `src/**/*.css`、`theme.css`、`main.tsx`，以及 `contrast` / `css-conventions` / `source-hygiene` 三个测试），再加 P0-3 的 `src/lib/constants.ts`。然后把本计划每个 Task 的代码原样贴进去：整文件替换照贴，App / RulesPanel / app.css / theme.css / OnboardingDialog / vite-env / index.html 按「改前 → 改后」片段替换，并删掉 RedBlackBoard 两个文件。结果：
- `tsc -p tsconfig.json`、`tsc -p tsconfig.worker.json` 通过；server 不受影响。
- unit 20 个文件 246 例全过：P0-1 的 222 例加本 PR 的 24 例，`css-conventions` 也扫到了新 CSS。
- dom 11 个文件 90 例全过：基线 54 例加本 PR 的 36 例。`modal-focus`、`deep-link`、`p8-app`、`discord-link`、`onboarding-roles`、`player-judge`、`session-rsvp-moved`、`verdict-privacy` 都原样通过。新文件不出 `act(...)` 警告。
- `vite build` 成功，`dist/index.html` 里有新的 description、og:title、og:description。
- 红灯核对：把 6 个被改组件换回基线版本后重跑。每个红灯步骤写的「哪些 FAIL、哪些 PASS」都和实际一致，只有下面第 2 条的报错原文不对。

以下是这次改动的地方，每条都有依据。

1. **Task 0 有占位符 `cd /path/to/repo`**（原 :83），改成 `cd "$(git rev-parse --show-toplevel)"`。
2. **unit 红灯的报错原文写错了。** Task 1、2、3、9 原来写的是 `Failed to resolve import "…"`。实测 unit 工程报的是 `Error: Cannot find module '../../src/lib/<x>' imported from …`（Node 解析）；dom 工程才报 Vite 的 `Failed to resolve import`。Task 6、11 是 dom 测试，那两处原文正确，保留不动。
3. **Task 11 Step 4.1 的「改前」片段在 P0-3 合并后已经不存在。** 原计划按基线多行写法 `ApiError,\n  getConfig,` 定位（App.tsx:11-13）。但 P0-3 计划 Task 7 Step 5 把 App 的 api import 收成了一行 `import { ApiError, getRecord, logout as apiLogout, regenerateReport } from './api';`（`getConfig` 等已经挪进 `coreData.ts`），照原片段找不到。现在改成以 P0-3 的单行写法为「改前」，同时保留多行写法作退路。其余 App 片段都和 P0-3 计划逐一核对过，P0-3 合并后仍然能找到：`affectsScore` 与 `parseTimestamp` 的 import、`WEEK_MS`（P0-3 写明「留着」）、`computeTrends`/`computeCounts`、`regenerating` 状态、`canRecord`、LinkMissingNotice 那一行、`<WeeklyReportCard\n report=`、Leaderboard/RulesPanel/RecordsFeed 三处。
4. **WeekHighlights 的注释里有「红黑榜」三个字**（原 :1470「replaced 红黑榜」）。Task 6 Step 6 和收尾都要求 `grep -rn "…|红黑榜" src` 没有输出，留着这三个字这两步必然失败。注释改成「replaced the old top/bottom board」。沙盒里这条 grep 现在输出 clean。
5. **本人那一行用了金色。** 原 `.lb-row--me` 写的是 `color-mix(var(--action) 10%)` 加 `inset 2px var(--action)`，但 spec §6.2 规定 `--action`（金）只用于主操作按钮和当前导航项，M24「金色七义」正是本 PR 要处理的问题之一。改成 `background: var(--panel-2); box-shadow: inset 3px 0 0 0 var(--text)`，手动检查清单的措辞也跟着改了。这一行仍然有 TierBadge，所以不只靠颜色区分。另外核对了 P0-1 套用后的 leaderboard.css：P0-1 只做了 hover 包裹和 560→600 两处改动，Step 4 的说明里已经写明。
6. **`.wh` 原来用 `display: flex; flex-wrap: wrap`**（原 :1508-1513）。弹性布局会把「⭐」、各个名字按钮、「（准时 N 次）」「、」这些文字段拆成匿名 flex 项，换行只能落在项与项之间，开头的空格也会被吞掉。现在改成普通行内排版（`line-height: 1.6`，保留 `min-height: 40px`），并给 `.wh__link` 补了 `padding: 0`（theme.css:162-168 的 button 重置没清 padding）。textContent 断言不受影响。
7. **`RecordRow` 有 80 行**，违反机主规则「函数 < 50 行」。原计划整文件替换 RecordsFeed 时原样保留了它，只加了 `rowRef`。现在拆成 `RecordRow`/`RecordLine`/`RecordMeta`/`RecordDelta`。在沙盒里用新旧两版渲染同一组 5 种状态的记录（带与不带 `onSelectUser`），比对 `innerHTML`，逐字节相同。`.feed-row__status--escalate` 和 `p8-app.test.tsx:196-199` 照常通过。
8. **`HistoryChart` 主函数有 52 行。** 把刻度列抽成 `AxisTicks` 后降到 47 行。
9. **走势图换了数据，选中的点还停在旧下标上。** 原实现的 `picked` 只是一个下标，PlayerDetail 换人或刷新后，会显示新数据里同一下标的某个旧点，而不是最新点。现在把选中状态改成 `{ of: history, index }`，只认当初选点时那份数组，数据一换就回到最新点（不可变写法）。新增用例「new data … starts at its latest point again」，history-chart 从 5 例变 6 例。
10. **走势图滑杆在触屏上太小。** spec §6「`pointer:coarse` 下触控目标 ≥44px」。在 `@media (pointer: coarse)` 里给 `.chart__scrub` 加了 `min-height: var(--tap-min)`。
11. **补「低分也能拿本周之星」的单测。** spec §9 P0-4 的测试影响点名要这条单测。原 week-stars 只是顺带覆盖（「open, revoked…」那例里阿杰上周有 −12）。现在新增「上周被扣 25 分（所以分数低）、本周准时 2 次 → 仍是本周之星」，week-stars 从 10 例变 11 例。另外，board 那条「a board tied at 100 names no 鸽王」的用例里并没有 100 分并列，改名为「the board names no 鸽王」。满分并列的情况由 week-stars 的 all-clean 用例覆盖。
12. **用例数同步更新**：Task 0 写 unit +24、dom +36；Task 3 写 11 例；Task 12 写 6 例；收尾写 unit 24 例、dom 36 例；自查表的「低分」「走势图」两行也改了。

核对过、没有改的地方：
- 所有基线 `file:line` 都与 d72e11b 一致：App.tsx:2/23/24/26-27/45/96-119/131/252-256/284-285/286/311/327/330/352-358/362-367，app.css:79-82/160/167-171，theme.css:303，OnboardingDialog.tsx:29，RulesPanel.tsx:6-15/22/36，rules-panel.css:1-3，vite-env.d.ts:3-12，index.html:7，DEPLOY-PAGES.md:43，各 css 的行数 47/62/162/172/190，PlayerDetail.tsx:90-92/155。
- 引用到的已有符号都存在：`AUTH_LOGIN_URL`（api.ts:48）、`btn--ghost`/`btn--sm`、`--r-sm`/`--r-md`/`--dur-fast`/`--text-h2`、P0-1 的 `--fs-*`/`--ok`/`--info`/`--tap-min`/`--score-chip-fg`/`--action`，以及 `affectsScore`、`clampScore`、`tierFor`、`VIOLATION_MAP`、`CASE_STATUS_LABEL`、`lastWeekStartOf`、`parseTimestamp`。
- 锁定文案与类名（spec §6.5）：新按钮名「看更多」「30 秒看懂」「不再显示欢迎卡」「查看某次分数」都不和「关闭」「关闭提示」「取消」「确认」撞名；WelcomeCard / WeekHighlights / compact 战报里都没有含「约局」的标题；`/上周战报/`、`/往期战报/` 和「周一 10:30 之后发布」不变。
- CSP（scripts/pages-headers.mjs:27-38，`style-src` 不含 `'unsafe-inline'`）：动态样式只用 React 的 `style` prop 走 CSSOM（圆环尺寸、刻度 `top`、`--accent`），没有 `<style>`、HTML 里的 style 字符串、`dangerouslySetInnerHTML`；外链用 `rel="noopener noreferrer"`。
- DOM 顺序 = 视觉顺序：没有用 CSS `order`；highlights 在 DOM 里就放在榜单头部和列表之间，WelcomeCard 是 main 里各 notice 之后的第一块。
- 深链与首屏请求：本 PR 没有新增 effect 或请求；`DISCORD_INVITE_URL` 是构建时常量。
- 契约里没写、本计划自己新增或补充的部分，理由都写在「对契约的补充」里，审查后都保留：`WelcomeCardProps.weeklyHeal`，因为 spec §5 #3 和契约 §4 要求回血数读 config；`feedStats.ts`、`revealSection.ts`、`history-chart.test.tsx`、删 `app.css` 里的 `.rbb`、`DEPLOY-PAGES.md`。
- 没有夹带其他 PR 的范围：不碰 PlayerDetail（neutral 选手页归 P1-1）、不碰 RulesPanel:36（归 P0-5）、不碰 Modal、api.ts、shared/、worker/、server/。

---

## P0-5 安全网（草稿、申诉、回血、常量）

审查方式：逐条对照快照代码（d72e11b + 31eb168）、spec（§0、§1.2、§2.4、§3.1–3.3、§3.5、§3.8、§3.10、§5、§6、§9 P0-5、§10）、契约 §2.3/§2.4/§3.5/§4/§5，以及依赖 PR 的最新计划（`plan-P0-2.v2.md`、`plan-P0-3.v2.md`、`plan-P0-4.v2.md`）。另在 `/tmp/claude-redesign/p0/p0-5-review/repo` 搭了沙盒：以 P0-3 v2 的重放结果（`p0-3-review/final`）为底，叠上 P0-2 v2 的重放文件（`p0-2-replay2` 的 Modal / modalStack / ConfirmInline / useInlineConfirm / `tests/dom/setup.ts`）和 P0-4 的 `rank.ts`，按 Task 1→18 逐块套用 v1 的代码，跑每一步的红/绿，发现问题就改；最后在全新副本 `p0-5-review/replay` 里**只按本 v2 文件的代码块**从头重放一遍。v2 重放结果：typecheck 三个 tsconfig 通过；unit 204 → 236（+32）；dom 109 → 163（+54），stderr 里的 `act(...)` 警告只有 onboarding-roles 原有的三条；`cases.test.ts` 37/37；`vite build` 成功。沙盒里没有 P0-1（`css-conventions.test.ts` 未跑，新 CSS 已按 `plan-P0-1.v2.md` 里 `ALLOWED_WIDTH_FEATURES`、`HOVER_MEDIA`、`RED_TEXT`、`FORM_CONTROL`/`DIM_BORDER`、coarse 重申各条规则人工核对），也没有 P0-4 的 App 渲染区（Task 18 在 P0-3 的 App 上验证；P0-4 v2 的 `board.test.tsx` 断言——`.lb .tier-badge` 只有 1 个、行名「第 3 名 老王，96 分」精确匹配、未登录无「鸽王」——与 MyScoreLine 不冲突，已逐条核过）。

### 改了什么、为什么

1. **AppealSheet「关闭时保留理由」用例必然失败（v1 Task 10）。** v1 打完字立刻按 Esc→「先离开」，然后断言 `localStorage` 里有草稿；但组件没卸载（`onClose` 是 mock），400ms 防抖也没到，实测 `expected null not to be null`。改成用一个 `Host` 包装，`onClose` 时真的卸载 AppealSheet（和 PlayerDetail 里的真实用法一致），断言卸载补写后的值是「判重了」。
2. **useDraft 的假定时器用例会卡死 5 秒并拖垮下一条（v1 Task 8）。** `vi.useFakeTimers()` 不带 `shouldAdvanceTime` 时，RTL 的 `asyncWrapper` 在 `user.type` 后等一个 `setTimeout(0)`，它只认 Jest 的假定时器、不会推进 Vitest 的，于是超时；`finally` 没机会执行，假定时器漏到下一条用例，「drops the key…」也超时。实测两条都 5004ms 超时。改成 `fireEvent.change`（同步）+ 冻结时钟，用例变成确定性的；并补一步反证（注释掉卸载补写，这条应当失败——已实测）。
3. **点名分钟数输入会被吞（v1 Task 16，正确性）。** v1 让屏幕上的标记完全从草稿派生（`marks = mergeMarks(roster, draft.value)`），而草稿只存合法分钟数，所以敲到「1500」（超过 `LATE_MINUTES_MAX`）那一下输入框被清空——今天的行为是保留、由服务端报错。新增用例「never rewrites what is being typed…」在 v1 实现上失败（`toHaveValue(1500)` 收到空），改回「`marks` 是组件 state，草稿只存 `toStoredMark` 的结果」后通过。见「对契约的补充」第 19 条；红步骤 3 个 → 4 个，drafts 计数随之更新。
4. **发起约局恢复后会被带回「其他时间」并按它提交（v1 Task 15，正确性）。** v1 用 `custom !== ''` 决定恢复时是否展开「其他时间」，但用户看过「其他时间」再点回快捷时段时 `custom` 仍有值。新增用例（只假造 `Date` 到一个周一中午，保证有多个时段）在 v1 实现上失败，修法是打开「其他时间」时把 `chosen` 置 null、收起时写回屏幕上的时段，恢复时以 `chosen === null && custom !== ''` 判断。三种实现都实测过：快照代码 3 个失败、v1 实现 1 个失败、v2 全过。顺带把原来写死的 `3_600_000` 提成 `CUSTOM_DEFAULT_LEAD_MS`。见「对契约的补充」第 20 条。
5. **两条新的 `act(...)` 警告（v1 Task 17，违反契约 §1「新 PR 不得新增这类警告」）。** 「keeps the unsaved choice…」第二次渲染后立即结束、「never pre-picks…」是同步用例，DiscordLinkCard 的 `GET /api/me/discord` 在用例结束后才落地，实测打出两条警告。三个首登用例都改成等「绑定 Discord」链接出现后再结束（第三个改用 `{link: null}` 桩并改为 async）；Task 18 的两个 App 用例结尾加 `settle()`（照 `p8-app.test.tsx:38-41`）。
6. **函数超过 50 行（机主规则）。** v1 的 `useDraft` 52 行、`AppealSheet` 51 行，加上第 7 条后 `StatementForm` 55 行。拆出 `readInitial`、`useDraftSaving`、`AppealReason`、`StatementField`、`caseLine`，现在都 ≤ 46 行；行为不变，用例全过。
7. **「清空」后焦点掉到 `<body>`（无障碍）。** DraftNote 的「清空」按钮点完随提示一起卸载。AppealSheet、StatementDialog、CaseDialog 的 `onClear` 改为清草稿后聚焦对应文本框；AppealSheet 新增用例「清空 empties the reason and puts the caret back in it」。见「对契约的补充」第 18 条。
8. **bot 一侧没有测试锁住 `APPEAL_MAX`。** 任务要求核对 bot：`server/src/discord/case-actions.ts:40` 的本地常量和 `:123` 的 `maxLength` v1 已正确迁移（沙盒 typecheck 通过，bot 不再有别处截断申诉理由——`submitCaseAction` 直接调 `appealCase`，`:140-142`），但没有断言。Task 1 新增 Step 6，在 `tests/pg/dm.test.ts:824` 的 `openCaseAction('appeal', …)` 断言里加 `modal.field.maxLength: APPEAL_MAX`（`tests/pg` 在 `tsconfig.worker.json:18` 的 `include` 里，本地 typecheck 已过；运行看 CI）。见「对契约的补充」第 17 条。
9. **「回血中…」改为引用 P0-3 的 `RESET_PENDING_LABEL`。** `plan-P0-3.v2.md`「对契约的补充」第 4 条和 Task 1 明确导出它；v1 写字面量并留了一句「如果有就改」。现在直接引用，Task 0 加 grep 核对。
10. **unit 红步骤的报错写错了（Task 5/6/7）。** unit 工程找不到模块时报 `Error: Cannot find module '…' imported from …`、`Tests  no tests`，不是 dom 工程的 `Failed to resolve import`（沙盒实测）。
11. **Task 2 的失败信息不可读。** 对 520 个汉字的 `toBe` 只会打印截断的两串「长长长…」；先断言 `length`，失败信息变成 `expected 520 to be 500`（实测）。
12. **Task 13 会重复定义 `.sd__form`。** v1 在文件末尾追加一条和快照 `statement-dialog.css:59-62` 完全相同的 `.sd__form`，再附一句「如果还在就只留一处」——快照里它一直在（P0-1 不删它）。改为原样保留、不追加。
13. **行号与占位符。** Task 0 的 `cd /path/to/scoreboard` 是占位符，改为 `cd "$(git rev-parse --show-toplevel)"`；Task 4 的 `shared/scoring.ts:151` 在 Task 1 插入 12 行后是 `:163`（沙盒实测）；Task 11 的 Files 写成 `:44-65`，会把 `:45-48` 的 `JUDGE_BUSY`/`SCORE_BUSY` 也划进删除范围，改为 `:50-65`（Task 1 后 `:49-64`）；`RollCallDialog.tsx` 的 `max={1440}` 在 `:185` 不是 `:186`。
14. **「改完用编辑器格式化一次」不可执行。** 仓库没有 prettier / eslint（`node_modules/.bin` 里没有，根目录也没有配置）。CaseDialog、RollCallDialog 两处三元包裹改为给出完整的前后代码；PlayerDetail 的 fragment 改为写明「整块多缩进 2 格，用 `git diff -w` 审查」，兄弟节点 `AppealSheet` 的缩进也改对。
15. **imports 顺序。** v1 把 `../lib/*` 三行放在组件 import 之后；PlayerDetail 原来的顺序是 api → lib → 组件（快照 `PlayerDetail.tsx:4-17`），改为放回 `} from '../api';` 之后。
16. **forced-colors 下申诉链接没有可见标记。** 收尾手动检查第 12 条写「ForgivenessNote 的申诉链接仍有下划线」，但 v1 的 CSS 只在 hover 时加下划线；`forgiveness-note.css` 补一条 `@media (forced-colors: active)` 下划线。
17. **计数与说明随以上各条更新**：appeal-sheet 5/11 → 6/12；drafts 17/20/23 → 18/22/25；Task 12、15、16 的红步骤数；收尾给出具体增量（unit +3 文件 / +32 用例，dom +4 文件 / +54 用例）；PR 描述加「1 条 pg 断言」；「文件结构」表加 `tests/pg/dm.test.ts`；自查表加四行；「对契约的补充」第 3 条注明三个前端上限常量为何不进 `shared/`、第 15 条改写、新增第 17–21 条。

### 核过、没有改的

- 常量与 SQL：`worker/cases.ts:95`（本地 `REVOKE_WINDOW_MS`）、`:398`（截断）、`:423`（撤销窗口判断）、`:486`（改判理由仍用 `MAX_NARRATIVE_LEN`）；`server/migrations/0004_dm.sql:103-104` 是 `dm.filed` 的 `interval '3 minutes'`，`:106`、`:145` 依赖同一个数；Task 3 的正则只匹配 `dm.filed` 那条（临时改成 4 分钟实测 `expected 180000 to be 240000`）。
- 锁定项全部原样通过：`verdict-privacy` 原 6 个用例（`:47,55,62,94`）+ 新 withdrawn 用例；`player-judge`（PlayerDetail 里「取消」仍唯一，没有新增 GET）；`p8-app`（`?onboarding=1&case=7` 的 Esc、`#case-7` 焦点与 `block:'center'`、改分后 `/api/records?limit=50` 重拉）；`deep-link`（唯一 /约局/ 标题、无非 GET 请求）；`discord-link`（请求数 1、href 不变、「取消」「确认解绑」焦点）；`onboarding-roles`（「裁判资格由管理员授予」正好 2 次、`/api/me/roles` 请求体不变）；`session-rsvp-moved`；`modal-focus`；P0-2 的 `modal-stack`、`confirm-inline`；P0-3 的 `app-refresh`、`toast`。
- 接口：`appealCase(id, reason?)` 的请求体（`api.ts:207-209`，`reason: undefined` 序列化成 `{}`）、`submitStatement`、`createCases`（`{records, failed}`）、`createSession`、`rollCall`、`settleSession`、`getDiscordLink`（`api.ts:351-360`）、`getUserDetail` 路径；`Config`/`User`/`PublicUser`/`SessionDetail`/`SessionPlayer` 字段；`VIOLATION_MAP.late_major.label === '大迟到'`、`ATTENDANCE_DEFS` 的「准时」「迟到」；P0-2 的 `ConfirmInline` 两个按钮都是 `type="button"`、`useInlineConfirm.dismiss` 在重渲染后聚焦触发按钮；P0-3 的 `useNow`、`formatTimeLeft`（「还有 2 天」）、`COUNTDOWN_TICK_MS`、`useToast` 无 Provider 时 no-op。
- 文案与 spec 一致：立案经过、待说明、撤销 · 还剩 N 分钟、隐私三句、「确认提交？交了就不能改。」「再看看」「确认提交」、AppealSheet 的标题/两句提示/「先不申诉」「提交申诉」/「提交后要等管理员复核，确定吗？」「再想想」「确认申诉」/成功 toast、五类离开确认、回血预告与 ForgivenessNote 句式；没有「只能申诉一次」；没有新的裸「取消」「确认」按钮名；收尾两条 grep 在沙盒里输出与预期一致（P0-4 v2 的 WelcomeCard 也读 `weeklyHeal`，第二条 grep 在 P0-4 之后仍应无输出）。
- CSP（`scripts/pages-headers.mjs` 的 `style-src` 无 `'unsafe-inline'`）：新组件只用 className，没有 `style="…"` 字符串、`<style>`、`dangerouslySetInnerHTML`；DOM 顺序 = 视觉顺序（`.aps__actions` 手机上 `flex-direction: column`，没有 `*-reverse`、没有 `order`）。
- 范围：没有混进其他 PR 的内容（`ROLE_CARDS`、RulesPanel 受控 props、ScoreGauge、`time.ts` 都不碰）；spec §9 P0-5 那一行和任务给的范围清单每一项都在自查表里有对应 Task。

### 看到但没改

- spec §5 第 3 条的「回到 100 分时庆祝一次（满血复活 🎉）」不在 §9 P0-5 的清单里，也不在其他 P0 PR 里，本计划不做；建议机主决定放进 P4 的 MyScoreCard。
- spec §6.1/§6.2 要求截止时间不再上金色、不到 2 小时用 `--attn`；`.sd__deadline` 现在仍是金色/红色。P0-5 只改截止行的文案，颜色属于 P0-1 的 token 换皮或 P4 的写说明页，留在 PR 描述里提一句。
- 申诉成功后 PlayerDetail `load()` 会把整张案件列表换成「加载中…」，抽屉关闭时的焦点还原目标（「申诉」按钮）已经脱离文档，焦点落到 `<body>`。这是今天 `run()`→`load()` 就有的行为（任何案件操作之后都一样），改它要动 `load()` 的语义，不在本 PR 范围。
- `PlayerDetail`、`CaseDialog`、`RollCallDialog`、`SessionFormDialog` 的组件函数本来就超过 50 行（PlayerDetail 约 210 行）；本 PR 只在原处加几行，见「对契约的补充」第 21 条。

---

## P0-6 详情弹窗里的改时间与取消确认

v2 由独立审查写成。做法：逐条核对 v1 引用的 `file:line`、类型和选择器；再把 Task 1–5 的代码逐字套进 d72e11b 的副本里实际跑（依赖的 P0-2/P0-3 实现取自它们计划的沙盒，详见「对契约的补充」第 9 条）。v1 的代码和测试在沙盒里**全部按计划通过**，red 步骤的失败数量和原因也与 v1 写的一致。所以 v2 只做了下面这些修改。

### 改了什么

1. **「其他时间」的提前量移进 `src/lib/constants.ts`**（Task 1 Step 3、Task 2 Step 3、文件结构表、补充第 2 条）。v1 在 `RescheduleSheet.tsx` 里写了局部常量 `CUSTOM_LEAD_MS = 60 * 60 * 1000`。契约 §3.0 规定前端专用的时长和门槛都放在 `src/lib/constants.ts`，机主规则也要求不要硬编码数字，所以改成 P0-6 小节里的 `RESCHEDULE_CUSTOM_LEAD_MS`，跟 `RESCHEDULE_DM_DELAY_MIN` 放一起，在 Task 1 一并提交。数值仍然等于 `SessionFormDialog.tsx:128` 的 `3_600_000`，因此 Task 2 断言的 `2026-10-28T11:00` 不变。
2. **`RescheduleSheet` 主函数拆小**（Task 2 Step 3）。v1 主函数有 67 行（沙盒里数的：`RescheduleSheet.tsx:49-116`）。v2 把错误提示和两个按钮抽成不导出的 `SheetActions`，把「没选出时间时报什么错」抽成 `missingTargetError`，主函数降到约 60 行。DOM 结构、类名、`data-autofocus`、`role="alert"` 都和 v1 一模一样，Task 2 的 6 个用例原样通过。没有拆到 50 行以内，原因写在 Task 2「要点」里。
3. **`useUndo()` 的返回值改名为 `offerUndo`**（Task 5 Step 4/5）。v1 写的是 `const undo = useUndo()`，调用时成了 `undo({ …, undo: () => setRsvp(…) })`，同一个名字既是函数又是参数里的键，读起来容易混。只改了名字，行为不变。
4. **补上「取消这局放在最后」的断言**（Task 4 Step 1，「an admin who is not the organizer gets both」）。spec §3.5 写的是「次要的文字按钮，放在最后」，契约 §3.6 写的是「放在操作区最后」，但 v1 只把它放进了手动检查。v2 用 `compareDocumentPosition` 断言「取消这局」排在「改时间」之后。DOM 顺序就是视觉顺序（契约 §4），所以这条也覆盖了视觉顺序。用例总数不变，还是 20 个；Task 4 red 步骤里这个用例仍然在找「取消这局」那一步失败。
5. **去掉占位符**（Task 0 Step 1）。v1 有一行 `cd /path/to/repo`，改成注释「在仓库根目录执行」。
6. **「验证情况」改成可复核的说法**（补充第 9 条）。v1 说在 `/tmp` 的沙盒里跑过，但 `/tmp/claude-redesign/p0/` 下找不到 P0-6 的沙盒。v2 写明审查时实际用的沙盒和依赖来源，以及跑出的数字：typecheck 三套都过；unit 199/199（基线 178 + 21）；dom 74/74（基线 54 + 20），`session-rsvp-moved` 和 `modal-focus` 原样通过；没有新增 `act(...)` 警告；五个时区下结果一致。
7. 自查表「取消按钮在操作区最后」一行补上第 4 条新增的断言。

### 核对过、没改的

- **行号**（快照 d72e11b）：`SessionDetailDialog.tsx` 的 `:1`、`:2-8`、`:11-16`、`:38-39`、`:56-75`、`:77`、`:79`、`:95`、`:123-141`、`:185-196`/`:185-210`、`:231-235`，每段 Before 文本都和源文件逐字一致，并且只匹配一次（沙盒里用精确替换验证过）。另外核对了 `shared/attendance.ts:21,30,34,38`、`shared/quickTime.ts:19,59`、`src/lib/time.ts:15,95,113,133`、`src/types.ts:114,130`、`src/api.ts:231-252`、`worker/sessions.ts:420,424-427,432,463-467,471,530-540,537,310-313`、`server/migrations/0005_sessions.sql:136-139,149-152`（`'dm.session.changed'` 全文只出现一次，紧跟着的就是 `interval '3 minutes'`）、`SessionFormDialog.tsx:69,78,103-142,128`、`PlayerDetail.tsx:335`、`theme.css:176`（`.visually-hidden`）。
- **会渲染这几个组件的测试**：`grep -rl SessionDetailDialog tests/` 只命中 `session-rsvp-moved.test.tsx`。它单独渲染、不包 ToastProvider，`players: []`，`capacity: null`，所以「来」可点而且全组件唯一；409 时 `mutate` 返回 false、不弹 toast，alert 只有内联的那一条；POST 只发一次。新代码下原样通过。`deep-link.test.tsx:129-134` 的 `/api/sessions/3` 没配路由，返回 500，对话框停在错误态，不受影响。`tests/worker/sessions.test.ts:182` 的 /取消约局/ 匹配的是后端文案（`worker/sessions.ts:518`），前端按钮改名不影响它。
- **锁定文案（spec §6.5）**：新按钮名是「改时间」「取消这局」「不取消了」「确认取消」「先不改」「改到 X」「撤销」，没有裸的「取消」「确认」；toast 都不用 `role="alert"`；满员提示和两句说明都是普通 `<p>`。
- **契约偏差保留**：撤销时用「这次回复时的 starts_at」，契约写的是「最新」（补充第 3 条）。这是对的：服务端在那次成功的 POST 里刚核对过这个时间；局改期后它会返回 409，`useUndo` 会如实报错，不会把对旧时间的回答写到新时间上。`isFull`/`goingClosed` 拆成两个函数也保留，因为后端 `worker/sessions.ts:537` 放行已经占了座的人。
- **新文案**仍然按补充第 4 条在 PR 描述里请机主过目：「已改到 X。」「改了之后：」「取消中…」等。
- **标题不随改期更新**（补充第 7 条）属实：`worker/sessions.ts:424-427` 只在传了 title 时才改标题，`SessionsPanel.tsx:159` 会藏起合成的标题，但详情页的 h2 不藏。保留为已知问题，需要机主拍板，不在 P0-6 实施。
- **`SessionDetailDialog` 主函数偏长**：快照里是 207 行（`:28-235`），v1/v2 加完之后约 239 行。新增的逻辑大多已经放进三个子组件，主函数里多出来的主要是几个 handler。要再拆，就得改写本 PR 范围以外的 header 和名单 markup，所以留给 P1-1（契约 §2.4：P1-1 会给这个组件加 `variant`，到时一起拆）。
- **CSP**（`scripts/pages-headers.mjs`：`style-src` 没有 `'unsafe-inline'`）：新代码没有 `style` 属性、没有 `<style>`、没有 `dangerouslySetInnerHTML`。**DOM 顺序 = 视觉顺序**：CSS 里没有 `order` 或 `*-reverse`。**无障碍**：sheet 的焦点停在「先不改」，关闭后回到「改时间」；ConfirmInline 的焦点停在「不取消了」，退出确认后回到「取消这局」；取消成功后焦点落到 `tabIndex=-1` 的标题上；满员时「来」通过 `aria-describedby` 带上满员提示。
- **不在范围内、没有加进来的**：RosterGroups、OrganizerConsole、ShareActions、理由输入框、看板时区。这些属于 P2/P3。

---

## 跨 PR 一致性检查（最终一轮）摘要

- 方式：把六份计划按推荐合并顺序叠进同一个副本 `/tmp/claude-redesign/p0/final/compose/repo`（底是 P0-5 审查的 `p0-5-review/replay`，即 P0-2/P0-3/P0-5 的 v2 代码；再用 `git merge-file` 以 d72e11b 快照为基叠入 P0-1（`p0-1-review`，含 v2 的 Task 9）、P0-4（`p0-4-review`）、P0-6（`p0-6-stage` 中 P0-6 自己的文件）；`App.tsx` 用脚本把 P0-3 → P0-4 → P0-5 三份计划的「改前 → 改后」片段逐条套上，每条都恰好命中一次）。
- 结果（修正后）：`npm run typecheck` 三个 tsconfig 全过；unit **26 个文件 / 326 个用例**全过（含 `css-conventions` 13/13，扫到了 P0-2…P0-6 全部新 CSS）；dom **20 个文件 / 219 个用例**全过，stderr 只有 `onboarding-roles` 原有的 3 条 `act(...)` 警告；`tests/worker/cases.test.ts` 37/37；`vite build` 成功；`App.tsx` 454 行。
- 合并时只出现两处文本冲突，都是预期内的：`tests/unit/source-hygiene.test.ts`（P0-1 与 P0-5 都在文件末尾追加 describe，两段都留）、`src/components/statement-dialog.css`（P0-1 改了 `.sd__notice` 的颜色，P0-5 删掉整块，取删除）。
- 计划层面的修改：见 `README.md`「跨 PR 一致性检查记录」第 1–9 条。
