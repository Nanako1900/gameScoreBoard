# P1-1 路由与旧深链映射 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SPA 有地址。手写 `src/lib/router.ts`（`useRoute`/`useLocation`/`navigate`/`goBack`/`<Link>`/popstate）；`/sessions/:id`、`/players/:id`、`/players/:id/cases/:caseId`、`/cases/:id`（别名）接到 `SessionDetailDialog`/`PlayerDetail` 的 page（手机）和 drawer（桌面）形态，其余路径一律 `NotFound`；旧深链 `/?case=N`、`/?session=N` 翻译成新地址（`utm` 等其余参数原样带走，首登引导优先）；案件聚焦从「原地高亮」改为「移到最上方」（全页只有一个 `#case-N`）；两个 id 对不上时 `replaceState` 纠正；公开选手页的 `ScoreGauge` 用 `neutral`；品牌改用 `<Link>`。

**Architecture:** 纯模块 `src/lib/routes.ts`（路由表、解析与格式化、`routeCoversHome`、`readEdgState`）+ DOM 模块 `src/lib/router.ts`（全站唯一碰 `window.history` 的地方；`useSyncExternalStore`，快照按 `pathname + search` 缓存，popstate 监听全模块只装一个）。App 的大厅常驻挂载，被页面盖住时只加 `hidden`；`RouteView` 按路由和 `useRouteLayout()`（`matchMedia(DESKTOP_MEDIA_QUERY)`）渲染页面或抽屉；`useEntryTarget` 接管旧深链，`useCaseLookup` 保证每次导航最多一次 `GET /api/records/:id`。

**Tech Stack:** React 18.3（`useSyncExternalStore`）、TypeScript strict、Vite 6、Vitest 3（unit：node；dom：jsdom + Testing Library 16 + user-event 14）、纯 CSS（BEM）。

**依赖:** 共享契约：本目录 `contract.md`（§3 分区、§4.1–§4.9、§4.12、§4.13、§6、§7、§8）。上游 B1-1：`src/lib/recordView.ts` 的 `PENDING_HIDDEN_LABEL`、`isPendingHidden`、`violationLabel`，以及 `src/types.ts` 里 `RecordItem.type: ViolationType | null`、`pending_hidden?: boolean`。P0-2 的 `Modal` `variant`（`page`/`drawer`），P0-4 的 `ScoreGauge` `tone`。spec：`docs/redesign-v5/spec.md` §2.2–§2.4、§3.5、§3.8、§6.4、§9 P1-1。

**分支:** `claude/p1-1-router`，从 `claude/b1-1-redact` 的 HEAD 开：`git switch -c claude/p1-1-router claude/b1-1-redact`。不 fetch、不 rebase `origin/main`、不 push、不开 PR。

---

## 文件结构

所有路径相对仓库根目录。代码和测试都已在「P0 全部套上 + P1-0 + B1-1 的完整改动」的副本上逐任务回放过（审查时又从头回放了一遍，见本目录 `review-log.md`）：每一步「期望失败」「期望通过」都按本文写的命令实测过；跨 PR 合成（见 `README.md`「一致性检查记录」）里也原样套上、全绿。

| 文件 | 新/改 | 职责 |
|---|---|---|
| `src/lib/constants.ts` | 改（末尾追加 `// --- P1-1 ---`） | `DESKTOP_MEDIA_QUERY`、`USER_ID_MAX` |
| `src/lib/deepLink.ts` | 改 | 把 `const ID` 改名导出为 `ID_PATTERN`，其余不变 |
| `src/lib/routes.ts` | 新（纯） | `Route` 联合、`parseRoute`/`formatRoute`/各路径函数、`isAppPath`、`isUserId`、`routeCoversHome`、`EdgHistoryState`、`readEdgState` |
| `src/lib/routeCopy.ts` | 新（纯） | 404 与路由页文案常量、`PAGE_BACK_LABEL`、`PINNED_CASE_LABEL`、`pinnedCaseEyebrow()` |
| `src/lib/router.ts` | 新（DOM） | `useLocation`/`useRoute`/`navigate`/`goBack`/`currentPath`/`bootRouter`/`resetRouterForTests`；唯一调用 `history.*` 的模块 |
| `src/components/Link.tsx` | 新 | 站内 `<a href>`：普通左键在原地导航，修饰键/中键/`target`/`/api` 等交给浏览器 |
| `src/lib/useRouteLayout.ts` | 新 | `'page' \| 'drawer'`，JS 里唯一的断点 |
| `src/components/PageBar.tsx` + `page-bar.css` | 新 | page 形态的 sticky 顶栏：「‹ 返回」+ 不朗读的标题；头像菜单打开时把 Header 抬到它上面（补充第 9 条） |
| `src/components/NotFound.tsx` + `not-found.css` | 新 | 未知路径和详情 404 的统一视图，标题可聚焦，默认「回大厅」 |
| `src/components/SessionDetailDialog.tsx` | 改 | 可选 `variant`；page 插 PageBar、首次加载聚焦标题；page/drawer 的 404 → NotFound；center 逐字节不变 |
| `src/components/PlayerDetail.tsx` | 改 | 可选 `variant`/`pinnedRecord`/`refreshKey`；page 插 PageBar；404 → NotFound；`ScoreGauge tone`；置顶案件块（移动不复制）；`EscalationButtons` 抽成小组件；首次聚焦规则 |
| `src/components/player-detail.css` | 改（末尾追加） | `.pd__pinned`、`.pd__pinned-eyebrow` |
| `src/lib/useCaseLookup.ts` | 新 | `PinnedCase` 类型；`useCaseLookup(caseId, seed)`：每个 id 每次挂载最多一次 GET |
| `src/lib/useEntryTarget.ts` | 新 | 旧深链：挂载时在 `/` 上读、剥参数；数据就绪且首登引导结束后打开一次 |
| `src/components/RouteView.tsx` | 新 | 路由 → 页面/抽屉/NotFound；`CaseRoute` 同时服务 `playerCase` 和 `/cases/:id` 别名 |
| `src/App.tsx` | 改 | 删 `selectedUserId`/`sessionId`/`focusCaseId`/`deepLink`/`deepLinkDone`/`linkMissing` 和两段 effect；加 `pinned`、`playerRefreshKey`；打开详情一律导航；插 `<RouteView>`；`main`/`footer` 加 `hidden` |
| `src/components/Header.tsx` | 改 | 只改品牌那个 `<a>` → `<Link to="/">` |
| `src/app.css` | 改（末尾追加） | `.app__main[hidden]`、`.app__footer[hidden]`、`.app__page`、`.app__page-status` |
| `tests/unit/route.test.ts` | 新 | `routes.ts`、`DESKTOP_MEDIA_QUERY`、`pinnedCaseEyebrow` |
| `tests/dom/router.test.tsx` | 新 | `navigate`/`bootRouter`/popstate/`goBack`/`<Link>` |
| `tests/dom/route-pages.test.tsx` | 新 | NotFound/PageBar/`useRouteLayout`；两个详情组件的 page/drawer/404；App 里的各条路由（共 25 个用例） |
| `tests/dom/viewport.ts` | 新（测试辅助，不是测试文件） | `useDesktopViewport()` |
| `tests/dom/setup.ts` | 改 | `window.scrollTo` 空实现；`afterEach` 调 `resetRouterForTests()`、删 `window.matchMedia` |
| `tests/dom/deep-link.test.tsx`、`tests/dom/p8-app.test.tsx` | 改（只追加断言） | `pathname` 断言、「全页只有一个 `#case-7`」 |
| `tests/unit/source-hygiene.test.ts` | 改（末尾追加一个 `describe`） | `src/` 里只有 `router.ts` 能用 `history.*` |

不碰：`Modal.tsx`、`modalStack.ts`、`VerdictCard.tsx`、`session-detail.css`（P1-1 不需要它的样式；契约允许追加但这里用不上）、`worker/`、`server/`、`docs/`。

## 对契约的补充

以下是契约没写死、或照契约字面实现会出错的地方。都已在回放副本上验证，请写进 PR 描述供机主过目。

1. **`EntryTargetInput.blocked` 是 `() => boolean`，不是 `boolean`。** 首登对话框由 App 里的 onboarding effect 在「数据就绪」那次提交里打开，它同步把 `onboardingAsked.current` 置真；同一次提交里 `useEntryTarget` 的 effect 如果拿的是渲染时算好的布尔值，读到的还是 `false`，会抢在首登对话框之前打开案件（`p8-app.test.tsx`「waits for the first-run dialog」会失败）。所以 App 传 `useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen])`，并且 **`useEntryTarget` 的调用必须写在两个 onboarding effect 之后**（effect 按声明顺序执行）。P1-3 往 `useEntryTarget` 追加登录回跳时沿用这个签名。
2. **旧 `?case=` 的落地在「`onPinned` 提交之后」的 effect 里 `navigate`**（`useEntryTarget` 内部的 `landing` state）。`navigate` 通过 `useSyncExternalStore` 触发的是同步优先级的渲染，而 promise 回调里的 `setPinned` 是默认优先级；如果在 `.then` 里直接 `onPinned(); navigate()`，路由会先以 `pinned === null` 渲染，`RouteView` 再发一次 `GET /api/records/7`。回放实测：这样写 `p8-app.test.tsx`「opens once」得到 2 次请求而失败。
3. **`PinnedCase` 定义在 `src/lib/useCaseLookup.ts`，`RouteView.tsx` 用 `export type { PinnedCase }` 再导出**（契约 4.9 写在 RouteView 里）。理由：`useEntryTarget.ts`、`useCaseLookup.ts` 都在 `src/lib`，不应反向依赖组件文件。从 `RouteView` 导入的写法仍然成立。`useCaseLookup.ts` 另外导出 `CaseLookup`、`CaseLookupStatus` 类型。
4. **`playerCase` 和 `case` 两种路由渲染同一个 `CaseRoute` 组件、在同一位置**，所以 `/cases/7` replace 成 `/players/p/cases/7` 时组件不卸载，`useCaseLookup` 的结果原样保留，不会再请求一次；别名查到记录时仍按契约调用 `onPinned`。
5. **`routeCopy.ts` 多三个导出**：`PAGE_BACK_LABEL = '返回'`（PageBar 按钮，契约 §8 第 11 条）、`PINNED_CASE_LABEL = '你点开的这一起'`（置顶块的 `aria-label`，spec §3.8 原文）、`pinnedCaseEyebrow(record)`（纯函数，eyebrow 文案规则照契约 4.6，单测锁住）。
6. **drawer 形态下 `playerCase` 的案件 404/500**：渲染在一个 `variant="drawer"` 的 `Modal`（`labelledBy="notfound-title"`，关闭走 `goBack()`）里的 `NotFound`，因为这时大厅没被盖住，不能把 NotFound 插在大厅和页脚之间。`/cases/:id` 和未知路径永远用 page 容器（`routeCoversHome` 对它们恒为真）。抽屉里的 `NotFound` 传 `autoFocus={false}`：它的 `h2` 带 `data-autofocus`，由 Modal 自己把焦点交给它；如果 NotFound 先在子组件 effect 里抢焦点，Modal 的 effect 随后会把这个标题记成「关闭后还焦点的地方」，关掉抽屉焦点就丢了。`route-pages.test.tsx` 有一条桌面用例锁住这个分支。
7. **焦点**：PlayerDetail 的 drawer 形态不额外移动焦点（Modal 自己把焦点放到 ✕）；只有 page 形态在没有 `focusRecordId` 时聚焦 `h2#player-detail-title`。SessionDetailDialog 同理只在 page 形态聚焦标题。
8. **`PlayerDetail` 内抽出 `EscalationButtons` 小组件和 `renderCase` 闭包**（置顶块和列表共用一份卡片渲染），DOM 与今天完全相同；理由是「函数 < 50 行」，否则卡片 JSX 要复制两份。
9. **页面形态的 PageBar `z-index: 41`**：Header 是 `position: sticky; top: 0; z-index: 40`，PageBar 也贴顶，粘住之后要盖在 Header 上面（仍在 `--z-modal` 之下）。这是 CSS 里的一个具体数值，注释写明了理由。代价：头像菜单 `.hdr__dropdown` 的 `z-index: 50` 只在 `.hdr` 自己的层叠上下文（40）里有效，往下展开时会被 PageBar（41）盖住、点击落到「返回」上。所以 `page-bar.css` 末尾加一条 `.hdr:has(.hdr__dropdown) { z-index: 42; }`（规则因 PageBar 而存在，放在 PageBar 自己的样式里，不动 `header.css`）：菜单开着时把 Header 抬到 PageBar 上面（菜单只在打开时渲染）。不支持 `:has()` 的旧浏览器退回到「菜单被 PageBar 压住一截」，不影响其他功能；P1-5 实机清单里要看一眼。
10. **source-hygiene 的扫描是纯文本**：`src/**/*.{ts,tsx}` 里连注释也不能出现 `history.pushState`、`history.replaceState`、`history.back(`、`history.go(`、`history.forward(`、`history.state`（`routes.ts` 的注释因此措辞为「The mark the router puts on every entry it writes」）。P1-2 的注释已经避开这些字样（`plan-P1-2.md` Task 1 Step 3 (a)：P1-2 常量的注释不照抄契约 §4.12 旧稿），扫描范围不改。
11. **上游核对（不在本 PR 修）**：P0 时 `tests/unit/source-hygiene.test.ts` 的 `SOURCE_DIRS` 含 `'functions'`；P1-0（`plan-P1-0.md`）删掉 `functions/` 时已把它从列表里去掉。如果 Task 0 的 unit 基线里 source-hygiene 因 `functions/` 不存在而报错，说明 P1-0 没做完——停下，回报给领队，不在 P1-1 里补。
12. **路由视图的 key**：`SessionDetailDialog` 以 `sessionId` 为 key，`PlayerDetail` 以 `userId`（案件页 `userId:caseId`）为 key，换一局/换一人时整页重挂载（焦点规则重新跑一次）。跨过 1024px 时 `variant` 改变，`load` 的依赖含 `variant`，会重新请求一次详情——契约 4.5「组件会重挂载，可以接受」。
13. **spec §2.3 `?linked=discord` 一行的「去设置私信 ›」链接本 PR 不加**：它指向 P4 才有的 `/me/notify`，P1 里那是 NotFound。`DiscordLinkedNotice` 原样不动（`discord-link.test` 照常通过）；契约 §8 没列这一条，请机主过目，随 P4 的 `/me/notify` 一起加。

## 通用约定

- 所有命令在仓库根目录执行；每个新开的终端先执行 `export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`。
- 行号只作参考，**一律按引用的锚点文字定位**；替换前确认 `old` 片段在文件里恰好出现一次。
- 单个测试文件：`npx vitest run --config vitest.config.ts <文件>`（unit）或 `npx vitest run --config vitest.dom.config.ts <文件>`（dom）。不跑 `test:pg`、`test:server`。
- 提交信息照抄，不加任何署名行。

### Task 0：开工核对

**Files:** 无改动。

- [ ] **Step 1：上游分支存在，工作区干净，开分支**

```bash
git status --porcelain            # 期望：没有输出
git rev-parse --verify claude/b1-1-redact
git switch -c claude/p1-1-router claude/b1-1-redact
```

- [ ] **Step 2：核对本 PR 消费的上游接口都在**

```bash
grep -n "export const PENDING_HIDDEN_LABEL\|export function isPendingHidden\|export function violationLabel" src/lib/recordView.ts
# 期望 3 行（B1-1）
grep -n "pending_hidden?: boolean\|type: ViolationType | null" src/types.ts
# 期望 2 行（B1-1）
grep -n "^const ID = " src/lib/deepLink.ts
# 期望 1 行：const ID = /^[1-9]\d{0,14}$/;
grep -n "// P1-1: resetRouterForTests();" tests/dom/setup.ts
# 期望 1 行
grep -n "export type ModalVariant = 'center' | 'sheet' | 'drawer' | 'page';" src/components/Modal.tsx
grep -n "tone?: 'tier' | 'neutral';" src/components/ScoreGauge.tsx
grep -n "// --- P0-5 ---" src/lib/constants.ts
grep -c "P1-1" src/lib/constants.ts          # 期望 0
ls src/lib/router.ts src/lib/routes.ts 2>&1  # 期望：No such file or directory（两个都不存在）
```

任何一条对不上就停下，回报领队，不在本 PR 里补别人的文件。

- [ ] **Step 3：跑基线，记下数字**

```bash
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c "not wrapped in act"
npm run typecheck
```

期望：unit **27 个文件**全过（P0 的 26 + B1-1 的 `record-view.test.ts`），记用例数为 **U0**；dom **20 个文件**全过，记用例数为 **D0**；act 警告 **3** 条（`onboarding-roles` 原有的）；typecheck 通过。审查回放（P0 + P1-0 + B1-1 v2）实测 U0 = 345、D0 = 225；分支上的数字以实测为准。文件数对不上（例如 source-hygiene 因 `functions/` 不存在而报错，见「对契约的补充」第 11 条）就停下。

上游偶发失败（已在 B1-1 修掉）：B1-1 的 `tests/dom/verdict-privacy.test.tsx`「only says a case is in progress … never a 0」早先用 `deadline_at = now + 3h`，造数据和渲染落在同一毫秒时倒计时显示「还剩 3 小时 0 分」，`/\b0\b/` 偶发失败；`plan-B1-1.md` 已改成 `now + 3.5h`。如果分支上这条仍会偶发失败（B1-1 执行者没改到），单独重跑确认能过，回报领队，不在本 PR 修。

### Task 1：路由表 `routes.ts`、路由文案 `routeCopy.ts`、P1-1 常量

**Files:**
- Create: `tests/unit/route.test.ts`
- Create: `src/lib/routes.ts`
- Create: `src/lib/routeCopy.ts`
- Modify: `src/lib/constants.ts`（末尾追加）
- Modify: `src/lib/deepLink.ts`（只导出 `ID_PATTERN`）

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/route.test.ts`（完整内容）：

```ts
// P1-1: the address table (spec §2.2) — src/lib/routes.ts is pure, so it is tested here.

import { describe, expect, it } from 'vitest';
import { DESKTOP_MEDIA_QUERY, USER_ID_MAX } from '../../src/lib/constants';
import { pinnedCaseEyebrow } from '../../src/lib/routeCopy';
import {
  casePath,
  formatRoute,
  isAppPath,
  isUserId,
  parseRoute,
  playerCasePath,
  playerPath,
  readEdgState,
  routeCoversHome,
  sessionPath,
  type LinkableRoute,
  type Route,
} from '../../src/lib/routes';

const NOT_FOUND: Route = { name: 'notFound' };

describe('parseRoute', () => {
  it('reads the five P1 routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/sessions/5')).toEqual({ name: 'session', sessionId: 5 });
    expect(parseRoute('/players/p')).toEqual({ name: 'player', userId: 'p' });
    expect(parseRoute('/players/p/cases/7')).toEqual({ name: 'playerCase', userId: 'p', caseId: 7 });
    expect(parseRoute('/cases/7')).toEqual({ name: 'case', caseId: 7 });
  });

  it('takes only a positive integer id of at most 15 digits', () => {
    for (const bad of ['0', '07', '-1', '1e3', 'abc', '1.5', '1234567890123456', '']) {
      expect(parseRoute(`/sessions/${bad}`), bad).toEqual(NOT_FOUND);
      expect(parseRoute(`/cases/${bad}`), bad).toEqual(NOT_FOUND);
      expect(parseRoute(`/players/p/cases/${bad}`), bad).toEqual(NOT_FOUND);
    }
    expect(parseRoute('/sessions/123456789012345')).toEqual({ name: 'session', sessionId: 123456789012345 });
  });

  it('knows nothing of the later phases’ routes yet', () => {
    for (const later of [
      '/sessions/new',
      '/sessions/history',
      '/sessions/5/rollcall',
      '/board',
      '/board/feed',
      '/me',
      '/me/notify',
      '/review',
      '/admin',
      '/join',
      '/cases/new',
      '/cases/7/statement',
      '/players',
      '/players/p/cases',
      '/xyz',
    ]) {
      expect(parseRoute(later), later).toEqual(NOT_FOUND);
    }
  });

  it('never takes over /api, /auth or /link — but /apix is an ordinary unknown path', () => {
    for (const reserved of ['/api', '/api/', '/api/config', '/auth/login', '/auth', '/link', '/link/discord']) {
      expect(isAppPath(reserved), reserved).toBe(false);
      expect(parseRoute(reserved), reserved).toEqual(NOT_FOUND);
    }
    expect(isAppPath('/apix')).toBe(true);
    expect(isAppPath('/authors')).toBe(true);
    expect(isAppPath('sessions/5')).toBe(false);
  });

  it('forgives exactly one trailing slash', () => {
    expect(parseRoute('/sessions/5/')).toEqual({ name: 'session', sessionId: 5 });
    expect(parseRoute('/players/p/')).toEqual({ name: 'player', userId: 'p' });
    expect(parseRoute('/sessions/5//')).toEqual(NOT_FOUND);
    expect(parseRoute('//')).toEqual(NOT_FOUND);
  });

  it('decodes user ids, %2F included, and refuses broken or oversized ones', () => {
    expect(parseRoute('/players/%E9%80%89%E6%89%8B')).toEqual({ name: 'player', userId: '选手' });
    expect(parseRoute('/players/a%2Fb/cases/7')).toEqual({ name: 'playerCase', userId: 'a/b', caseId: 7 });
    expect(parseRoute('/players/%E0%A4%A')).toEqual(NOT_FOUND);
    expect(parseRoute('/players/a%00b')).toEqual(NOT_FOUND);
    expect(parseRoute(`/players/${'x'.repeat(USER_ID_MAX)}`)).toEqual({ name: 'player', userId: 'x'.repeat(USER_ID_MAX) });
    expect(parseRoute(`/players/${'x'.repeat(USER_ID_MAX + 1)}`)).toEqual(NOT_FOUND);
  });
});

describe('isUserId', () => {
  it('is non-empty, at most USER_ID_MAX, without NUL', () => {
    expect(isUserId('discord:123')).toBe(true);
    expect(isUserId('')).toBe(false);
    expect(isUserId('a\u0000b')).toBe(false);
    expect(isUserId('x'.repeat(USER_ID_MAX + 1))).toBe(false);
  });
});

describe('formatRoute and the path builders', () => {
  it('build what parseRoute reads back, never ending in a slash', () => {
    const routes: LinkableRoute[] = [
      { name: 'home' },
      { name: 'session', sessionId: 5 },
      { name: 'player', userId: 'a/b 选手' },
      { name: 'playerCase', userId: 'a/b', caseId: 7 },
      { name: 'case', caseId: 7 },
    ];
    for (const route of routes) {
      const path = formatRoute(route);
      expect(path === '/' || !path.endsWith('/'), path).toBe(true);
      expect(parseRoute(path)).toEqual(route);
    }
  });

  it('encode the user id', () => {
    expect(sessionPath(5)).toBe('/sessions/5');
    expect(playerPath('a/b')).toBe('/players/a%2Fb');
    expect(playerCasePath('p', 7)).toBe('/players/p/cases/7');
    expect(casePath(7)).toBe('/cases/7');
  });
});

describe('routeCoversHome', () => {
  it('hides the lobby under pages and NotFound, not under drawers', () => {
    expect(routeCoversHome({ name: 'home' }, 'page')).toBe(false);
    expect(routeCoversHome({ name: 'home' }, 'drawer')).toBe(false);
    expect(routeCoversHome(NOT_FOUND, 'drawer')).toBe(true);
    expect(routeCoversHome({ name: 'case', caseId: 7 }, 'drawer')).toBe(true);
    for (const route of [
      { name: 'session', sessionId: 5 },
      { name: 'player', userId: 'p' },
      { name: 'playerCase', userId: 'p', caseId: 7 },
    ] as const) {
      expect(routeCoversHome(route, 'page'), route.name).toBe(true);
      expect(routeCoversHome(route, 'drawer'), route.name).toBe(false);
    }
  });
});

describe('readEdgState', () => {
  it('knows the router’s own entries by edg: 1 alone', () => {
    expect(readEdgState(null)).toBeNull();
    expect(readEdgState('x')).toBeNull();
    expect(readEdgState({ edg: 2, idx: 1 })).toBeNull();
    expect(readEdgState({ edg: 1, idx: 3 })).toEqual({ edg: 1, idx: 3 });
  });

  it('reads a missing or broken idx as 0', () => {
    for (const idx of [undefined, -1, 1.5, '2', Number.NaN]) {
      expect(readEdgState({ edg: 1, idx }), String(idx)).toEqual({ edg: 1, idx: 0 });
    }
  });
});

describe('DESKTOP_MEDIA_QUERY', () => {
  // The four width features css-conventions.test.ts allows: JS must use the same desktop line.
  const CSS_WIDTH_FEATURES = ['max-width: 600px', 'min-width: 601px', 'max-width: 1023px', 'min-width: 1024px'];

  it('is the CSS desktop breakpoint', () => {
    expect(DESKTOP_MEDIA_QUERY).toBe('(min-width: 1024px)');
    expect(CSS_WIDTH_FEATURES).toContain(DESKTOP_MEDIA_QUERY.slice(1, -1));
  });
});

describe('pinnedCaseEyebrow', () => {
  const base = { id: 7, type: 'no_show', status: 'awaiting_statement' } as const;

  it('names the charge and the stage for those who may read the case', () => {
    expect(pinnedCaseEyebrow(base)).toBe('案件 #7 · 放鸽子 · 待说明');
    expect(pinnedCaseEyebrow({ ...base, status: 'appealed' })).toBe('案件 #7 · 放鸽子 · 申诉中');
  });

  it('drops the empty label of a decided case', () => {
    expect(pinnedCaseEyebrow({ ...base, status: 'decided' })).toBe('案件 #7 · 放鸽子');
  });

  it('says only 处理中 when the API hid the case (B1-1)', () => {
    expect(pinnedCaseEyebrow({ ...base, type: null, status: 'judging', pending_hidden: true })).toBe('案件 #7 · 处理中');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/route.test.ts
```

期望：FAIL，`Test Files 1 failed`、`no tests`——报 `Failed to load url ../../src/lib/routeCopy`（按 import 顺序第一个不存在的模块；`routes.ts` 同样不存在，`constants` 的新导出此时是 undefined，不单独报错）。

- [ ] **Step 3：实现**

在 `// --- P0-5 ---` 小节之后、文件末尾追加到 `src/lib/constants.ts`：

```ts

// --- P1-1 ---
/** The one breakpoint JS needs: page vs drawer for /sessions/:id and /players/:id. Same as the CSS (min-width: 1024px). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
/** /players/:id — OAuth subjects are free-form; anything longer is not one of ours. */
export const USER_ID_MAX = 128;
```

修改 `src/lib/deepLink.ts`，按锚点逐段替换（每段 `old` 在文件里恰好出现一次；行号不可靠时只认锚点文字）：

（1）把这段：

```ts
const ID = /^[1-9]\d{0,14}$/;
```

替换为：

```ts
/** A positive integer id, at most 15 digits: the only id a link may carry (the router reuses it). */
export const ID_PATTERN = /^[1-9]\d{0,14}$/;
```

（2）把这段：

```ts
    if (raw !== null && ID.test(raw)) return { kind, id: Number(raw) };
```

替换为：

```ts
    if (raw !== null && ID_PATTERN.test(raw)) return { kind, id: Number(raw) };
```

新建 `src/lib/routes.ts`（完整内容）：

```ts
// src/lib/routes.ts — the app's addresses (spec §2.2) as data. Pure: no window,
// no document, no storage, no React, so tests/unit can import it.
//
// P1 knows five routes; everything else is NotFound. Later phases add members to
// `Route` and never change the ones here. No route starts with /api, /auth or
// /link: those belong to the API, and the SPA only ever sees them when the
// hosting is misconfigured.

import { USER_ID_MAX } from './constants';
import { ID_PATTERN } from './deepLink';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'session'; readonly sessionId: number }
  | { readonly name: 'player'; readonly userId: string }
  | { readonly name: 'playerCase'; readonly userId: string; readonly caseId: number }
  /** Alias: look the case up, then replace the address with its playerCase one. */
  | { readonly name: 'case'; readonly caseId: number }
  | { readonly name: 'notFound' };

export type LinkableRoute = Exclude<Route, { name: 'notFound' }>;
/** Phone and tablet: the view is a page; desktop (DESKTOP_MEDIA_QUERY): a drawer over the lobby. */
export type RouteLayout = 'page' | 'drawer';

/** The mark the router puts on every entry it writes (P1-1: edg + idx; P1-2 adds fields). */
export interface EdgHistoryState {
  readonly edg: 1;
  /** 0 for the entry the tab landed on; a push is the current idx + 1; a replace keeps it. */
  readonly idx: number;
}

export const HOME_PATH = '/';
export const RESERVED_PREFIXES = ['/api', '/auth', '/link'] as const;

const HOME: Route = { name: 'home' };
const NOT_FOUND: Route = { name: 'notFound' };

/** Not one of the API's prefixes (`/apix` is not `/api`). */
export function isAppPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  return !RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** OAuth subjects are free-form (worker/oauth.ts): non-empty, bounded, no NUL. */
export function isUserId(raw: string): boolean {
  return raw.length > 0 && raw.length <= USER_ID_MAX && !raw.includes('\u0000');
}

function numericId(raw: string): number | null {
  return ID_PATTERN.test(raw) ? Number(raw) : null;
}

function userIdFrom(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return isUserId(decoded) ? decoded : null;
  } catch {
    return null; // a malformed %-escape
  }
}

/** Exactly one trailing slash is forgiven (`/sessions/5/`); `/` itself stays. */
function withoutTrailingSlash(pathname: string): string {
  const once = pathname.length > 1 && pathname.endsWith('/') && !pathname.endsWith('//');
  return once ? pathname.slice(0, -1) : pathname;
}

function playerRoute(segment: string): Route {
  const userId = userIdFrom(segment);
  return userId === null ? NOT_FOUND : { name: 'player', userId };
}

function playerCaseRoute(segment: string, rawCaseId: string): Route {
  const userId = userIdFrom(segment);
  const caseId = numericId(rawCaseId);
  return userId === null || caseId === null ? NOT_FOUND : { name: 'playerCase', userId, caseId };
}

function idRoute(name: 'session' | 'case', raw: string): Route {
  const id = numericId(raw);
  if (id === null) return NOT_FOUND;
  return name === 'session' ? { name, sessionId: id } : { name, caseId: id };
}

function matchSegments(segments: readonly string[]): Route {
  const [head, first, second, third] = segments;
  if (segments.length === 2 && head === 'sessions') return idRoute('session', first);
  if (segments.length === 2 && head === 'cases') return idRoute('case', first);
  if (segments.length === 2 && head === 'players') return playerRoute(first);
  if (segments.length === 4 && head === 'players' && second === 'cases') return playerCaseRoute(first, third);
  return NOT_FOUND;
}

/** Reads only the pathname: search and hash never choose a route. */
export function parseRoute(pathname: string): Route {
  if (!isAppPath(pathname)) return NOT_FOUND;
  const path = withoutTrailingSlash(pathname);
  if (path === HOME_PATH) return HOME;
  return matchSegments(path.slice(1).split('/'));
}

export function sessionPath(sessionId: number): string {
  return `/sessions/${sessionId}`;
}

export function playerPath(userId: string): string {
  return `/players/${encodeURIComponent(userId)}`;
}

export function playerCasePath(userId: string, caseId: number): string {
  return `${playerPath(userId)}/cases/${caseId}`;
}

export function casePath(caseId: number): string {
  return `/cases/${caseId}`;
}

/** Never ends in `/` (except the home page itself). */
export function formatRoute(route: LinkableRoute): string {
  switch (route.name) {
    case 'home':
      return HOME_PATH;
    case 'session':
      return sessionPath(route.sessionId);
    case 'player':
      return playerPath(route.userId);
    case 'playerCase':
      return playerCasePath(route.userId, route.caseId);
    case 'case':
      return casePath(route.caseId);
  }
}

/** Whether the lobby is hidden under this route: pages cover it, drawers sit on top of it. */
export function routeCoversHome(route: Route, layout: RouteLayout): boolean {
  switch (route.name) {
    case 'home':
      return false;
    case 'notFound':
    case 'case':
      return true;
    default:
      return layout === 'page';
  }
}

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** The router's mark on a history entry, or null for an entry it did not write. */
export function readEdgState(raw: unknown): EdgHistoryState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { edg, idx } = raw as { edg?: unknown; idx?: unknown };
  if (edg !== 1) return null;
  return { edg: 1, idx: isIndex(idx) ? idx : 0 };
}
```

新建 `src/lib/routeCopy.ts`（完整内容）（`recordView.ts` 是 B1-1 的纯模块）：

```ts
// src/lib/routeCopy.ts — what the router's pages say (spec §2.2). Pure: tests/unit imports it.
// The two case sentences are pinned by tests (deep-link.test.tsx, p8-app.test.tsx).

import { CASE_STATUS_LABEL } from '@shared/scoring';
import type { RecordItem } from '../types';
import { PENDING_HIDDEN_LABEL, isPendingHidden, violationLabel } from './recordView';

export const NOT_FOUND_TITLE = '这页不存在';
export const SESSION_NOT_FOUND = '找不到这局，链接可能写错了。';
export const PLAYER_NOT_FOUND = '找不到这位选手。';
export const CASE_GONE = '链接里的案件不存在了。';
export const CASE_UNAVAILABLE = '打不开链接里的案件，稍后再试。';
export const BACK_HOME = '回大厅';
export const CASE_OPENING = '正在打开案件…';
/** PageBar's button: history decides where it goes, so it does not promise 大厅 (contract §8 #11). */
export const PAGE_BACK_LABEL = '返回';
/** aria-label of the pinned case on /players/:id/cases/:caseId (spec §3.8). */
export const PINNED_CASE_LABEL = '你点开的这一起';

type EyebrowRecord = Pick<RecordItem, 'id' | 'type' | 'status' | 'pending_hidden'>;

/**
 * 「案件 #7 · 放鸽子 · 待说明」 for whoever may read the case; 「案件 #7 · 处理中」 for
 * the rest before the verdict (B1-1). A decided case has no status label, so it
 * ends at the charge.
 */
export function pinnedCaseEyebrow(record: EyebrowRecord): string {
  const head = `案件 #${record.id}`;
  if (isPendingHidden(record)) return `${head} · ${PENDING_HIDDEN_LABEL}`;
  return [head, violationLabel(record.type), CASE_STATUS_LABEL[record.status]]
    .filter((part) => part !== '')
    .join(' · ');
}
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/route.test.ts tests/unit/deep-link.test.ts
npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.worker.json --noEmit
```

期望：2 个文件、19 个用例全过（`route.test.ts` 16 个，`deep-link.test.ts` 原有 3 个原样通过）；两个 tsc 都没有输出。

- [ ] **Step 5：提交**

```bash
git add tests/unit/route.test.ts src/lib/routes.ts src/lib/routeCopy.ts src/lib/constants.ts src/lib/deepLink.ts
git commit -m "feat: 新增路由表 routes.ts 与路由文案（P1-1）"
```

### Task 2：`router.ts`、`<Link>`，测试 setup 重置路由

**Files:**
- Create: `tests/dom/router.test.tsx`
- Create: `src/lib/router.ts`
- Create: `src/components/Link.tsx`
- Modify: `tests/dom/setup.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/dom/router.test.tsx`（完整内容）：

```tsx
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link } from '../../src/components/Link';
import { bootRouter, currentPath, goBack, navigate, useLocation, useRoute } from '../../src/lib/router';

// P1-1: src/lib/router.ts and <Link>. tests/dom/setup.ts resets the router
// (and the address) after every test.

function RouteName(): JSX.Element {
  const route = useRoute();
  const { search } = useLocation();
  return (
    <p data-testid="route">
      {route.name}
      {search}
    </p>
  );
}

const routeText = (): string | null => screen.getByTestId('route').textContent;

/** A link's default action must never reach jsdom (it cannot navigate). Records whether anyone stopped it first. */
function stopDocumentNavigation(): { prevented: () => boolean; restore: () => void } {
  let prevented = false;
  const onClick = (event: MouseEvent): void => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', onClick);
  return { prevented: () => prevented, restore: () => document.removeEventListener('click', onClick) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('navigate', () => {
  it('pushes a marked entry and tells the subscribers', () => {
    bootRouter();
    render(<RouteName />);
    const before = window.history.length;
    act(() => navigate('/sessions/5?x=1'));
    expect(window.location.pathname).toBe('/sessions/5');
    expect(window.location.search).toBe('?x=1');
    expect(window.history.length).toBe(before + 1);
    expect(window.history.state).toEqual({ edg: 1, idx: 1 });
    expect(routeText()).toBe('session?x=1');
  });

  it('replaces in place, keeping the index', () => {
    bootRouter();
    render(<RouteName />);
    act(() => navigate('/players/p'));
    const before = window.history.length;
    act(() => navigate('/players/q', { replace: true }));
    expect(window.location.pathname).toBe('/players/q');
    expect(window.history.length).toBe(before);
    expect(window.history.state).toEqual({ edg: 1, idx: 1 });
  });

  it('does not push the address it is already on', () => {
    bootRouter();
    act(() => navigate('/sessions/5'));
    const before = window.history.length;
    act(() => navigate('/sessions/5'));
    expect(window.history.length).toBe(before);
  });

  it('scrolls to the top on a push, unless asked to keep the scroll', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    act(() => navigate('/players/p', { keepScroll: true }));
    act(() => navigate('/players/q', { replace: true }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('refuses anything but an in-app path', () => {
    expect(() => navigate('sessions/5')).toThrow('navigate 只接受站内路径');
    expect(() => navigate('//evil.example/x')).toThrow('navigate 只接受站内路径');
    expect(() => navigate('https://evil.example/')).toThrow('navigate 只接受站内路径');
  });

  it('currentPath is pathname + search', () => {
    act(() => navigate('/sessions/5?utm=dc'));
    expect(currentPath()).toBe('/sessions/5?utm=dc');
  });
});

describe('bootRouter', () => {
  it('marks the entry the tab landed on, once', () => {
    window.history.replaceState(null, '', '/sessions/5?x=1');
    const before = window.history.length;
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 0 });
    expect(window.location.pathname + window.location.search).toBe('/sessions/5?x=1');
    window.history.replaceState({ edg: 1, idx: 4 }, '');
    bootRouter();
    expect(window.history.state).toEqual({ edg: 1, idx: 4 });
    expect(window.history.length).toBe(before);
  });
});

describe('popstate', () => {
  it('re-reads the address on back', async () => {
    bootRouter();
    render(<RouteName />);
    act(() => navigate('/players/p'));
    expect(routeText()).toBe('player');
    window.history.back();
    await waitFor(() => expect(routeText()).toBe('home'));
  });

  it('ignores a popstate that only moved the hash', () => {
    let renders = 0;
    function Counter(): JSX.Element {
      renders += 1;
      return <RouteName />;
    }
    render(<Counter />);
    const before = renders;
    window.history.replaceState(window.history.state, '', '/#x');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    expect(renders).toBe(before);
    expect(routeText()).toBe('home');
  });
});

describe('goBack', () => {
  it('steps back through our own entries', async () => {
    bootRouter();
    act(() => navigate('/sessions/5'));
    goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('from the entry the tab landed on, replaces with the fallback instead of leaving the site', () => {
    window.history.replaceState(null, '', '/sessions/5');
    bootRouter();
    const before = window.history.length;
    render(<RouteName />);
    act(() => goBack());
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
    expect(routeText()).toBe('home');
  });
});

describe('<Link>', () => {
  it('is a real link that navigates in place on a plain click', () => {
    bootRouter();
    render(
      <>
        <Link to="/sessions/5">周五五排</Link>
        <RouteName />
      </>,
    );
    const link = screen.getByRole('link', { name: '周五五排' });
    expect(link).toHaveAttribute('href', '/sessions/5');
    const guard = stopDocumentNavigation();
    try {
      fireEvent.click(link);
      expect(guard.prevented()).toBe(true);
    } finally {
      guard.restore();
    }
    expect(window.location.pathname).toBe('/sessions/5');
    expect(routeText()).toBe('session');
  });

  it('leaves modified clicks, other buttons, other targets and API paths to the browser', () => {
    render(
      <>
        <Link to="/sessions/5">本页</Link>
        <Link to="/sessions/6" target="_blank">
          新标签
        </Link>
        <Link to="/auth/login">登录</Link>
      </>,
    );
    const guard = stopDocumentNavigation();
    try {
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        fireEvent.click(screen.getByRole('link', { name: '本页' }), init);
        expect(guard.prevented(), JSON.stringify(init)).toBe(false);
      }
      fireEvent.click(screen.getByRole('link', { name: '新标签' }));
      expect(guard.prevented()).toBe(false);
      fireEvent.click(screen.getByRole('link', { name: '登录' }));
      expect(guard.prevented()).toBe(false);
    } finally {
      guard.restore();
    }
    expect(window.location.pathname).toBe('/');
  });

  it('runs the caller’s onClick first, and respects its preventDefault', () => {
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(
      <Link to="/sessions/5" onClick={onClick}>
        周五五排
      </Link>,
    );
    fireEvent.click(screen.getByRole('link', { name: '周五五排' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/router.test.tsx
```

期望：FAIL，`no tests`——找不到 `../../src/components/Link`、`../../src/lib/router`。

- [ ] **Step 3：实现**

新建 `src/lib/router.ts`（完整内容）：

```ts
// src/lib/router.ts — the one module that drives window.history (spec §2.2;
// source-hygiene keeps it that way). Hand-written on purpose: five routes do not
// need a dependency.
//
// The address is the state: useLocation() reads window.location, cached by
// pathname + search, so a test that sets the address with replaceState before
// render() is read correctly. Every entry the router writes carries
// { edg: 1, idx }; idx > 0 means there is an entry of ours behind this one.

import { useSyncExternalStore } from 'react';
import { HOME_PATH, isAppPath, parseRoute, readEdgState, type Route } from './routes';

export interface RouterLocation {
  readonly pathname: string;
  /** '' or '?…' */
  readonly search: string;
  readonly route: Route;
}

export interface NavigateOptions {
  /** Default false: pushState. */
  readonly replace?: boolean;
  /** Default false: a push scrolls to the top. Desktop drawers pass true — the lobby stays put. */
  readonly keepScroll?: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: RouterLocation | null = null;

const keyOf = (pathname: string, search: string): string => pathname + search;
const currentKey = (): string => keyOf(window.location.pathname, window.location.search);

function readLocation(): RouterLocation {
  const { pathname, search } = window.location;
  if (snapshot === null || keyOf(snapshot.pathname, snapshot.search) !== keyOf(pathname, search)) {
    snapshot = { pathname, search, route: parseRoute(pathname) };
  }
  return snapshot;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** A popstate that only moved the hash changes nothing here (spec §2.2: no hash routing). */
function onPopState(): void {
  if (snapshot !== null && keyOf(snapshot.pathname, snapshot.search) === currentKey()) return;
  notify();
}

function subscribe(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState);
  };
}

const currentIndex = (): number => readEdgState(window.history.state)?.idx ?? 0;

export function useLocation(): RouterLocation {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

export function useRoute(): Route {
  return useLocation().route;
}

/** pathname + search of the current entry (LoginLink saves it, P1-3). */
export function currentPath(): string {
  return currentKey();
}

/** In-app paths only; /api, /auth and /link leave the SPA with a full page load. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('navigate 只接受站内路径');
  }
  const url = new URL(path, window.location.origin);
  if (!isAppPath(url.pathname)) {
    window.location.assign(path);
    return;
  }
  const target = keyOf(url.pathname, url.search);
  const replace = options.replace === true;
  if (!replace && target === currentKey()) return; // no duplicate entries
  const idx = currentIndex();
  if (replace) {
    window.history.replaceState({ edg: 1, idx }, '', target);
  } else {
    window.history.pushState({ edg: 1, idx: idx + 1 }, '', target);
    if (options.keepScroll !== true) window.scrollTo(0, 0);
  }
  notify();
}

/** Back through our own entries; from the first one, replace with `fallback` instead of leaving the site. */
export function goBack(fallback: string = HOME_PATH): void {
  if (currentIndex() > 0) {
    window.history.back();
    return;
  }
  navigate(fallback, { replace: true });
}

/** Marks the entry the tab landed on (idempotent: StrictMode and repeated renders are safe). */
export function bootRouter(): void {
  if (readEdgState(window.history.state) !== null) return;
  window.history.replaceState({ edg: 1, idx: 0 }, '', currentKey());
}

/** Tests only (tests/dom/setup.ts): forget everything, back to '/' with no state. */
export function resetRouterForTests(): void {
  listeners.clear();
  window.removeEventListener('popstate', onPopState);
  snapshot = null;
  window.history.replaceState(null, '', HOME_PATH);
}
```

新建 `src/components/Link.tsx`（完整内容）：

```tsx
import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';
import { isAppPath } from '../lib/routes';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** An in-app path, optionally with a search; never a hash. */
  to: string;
  replace?: boolean;
  keepScroll?: boolean;
}

const MAIN_BUTTON = 0;

const pathnameOf = (to: string): string => to.split(/[?#]/, 1)[0];

/** New tab, download, a caller that handled it, or a path the SPA does not own: the browser's job. */
function leftToBrowser(event: MouseEvent<HTMLAnchorElement>, to: string, target: string | undefined): boolean {
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const elsewhere = target !== undefined && target !== '' && target !== '_self';
  return event.defaultPrevented || event.button !== MAIN_BUTTON || modified || elsewhere || !isAppPath(pathnameOf(to));
}

/** A real <a href>: middle-click, ⌘-click and "copy link" keep working; a plain click navigates in place. */
export function Link({ to, replace, keepScroll, onClick, target, children, ...rest }: LinkProps): JSX.Element {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (leftToBrowser(event, to, target)) return;
    event.preventDefault();
    navigate(to, { replace, keepScroll });
  };
  return (
    <a {...rest} href={to} target={target} onClick={handleClick}>
      {children}
    </a>
  );
}
```

把 `tests/dom/setup.ts` 整个替换。现在的内容（P0-5 之后）是：

```ts
// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next.
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: resetRouterForTests();
});
```

替换为（P1-1 的同步版本；P1-2 再改成 async 并在最前面排空 history 遍历）：

```ts
// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';
import { resetRouterForTests } from '../../src/lib/router';

// P1-1: jsdom does not implement scrolling; the router scrolls to the top on push.
window.scrollTo = () => {};

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P1-1: subscribers and the cached location; then history.replaceState(null, '', '/').
  resetRouterForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next.
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: a test that stubbed a desktop viewport must not leave it behind.
  delete (window as { matchMedia?: unknown }).matchMedia;
});
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/router.test.tsx
npx vitest run --config vitest.dom.config.ts
npx tsc -p tsconfig.json --noEmit
```

期望：`router.test.tsx` 14 个用例全过；整个 dom 套件 21 个文件、**D0 + 14** 个用例全过（setup 里的 `resetRouterForTests()` 与各测试自己的 `replaceState(null, '', '/')` 等价，旧测试不受影响）；tsc 无输出。

- [ ] **Step 5：提交**

```bash
git add tests/dom/router.test.tsx src/lib/router.ts src/components/Link.tsx tests/dom/setup.ts
git commit -m "feat: 新增手写路由 router.ts 与 Link 组件（P1-1）"
```

### Task 3：`useRouteLayout`、`PageBar`、`NotFound`

**Files:**
- Create: `tests/dom/viewport.ts`
- Create: `tests/dom/route-pages.test.tsx`（本任务写文件头、桩数据和第一个 `describe`；Task 4–6 依次在末尾追加）
- Create: `src/lib/useRouteLayout.ts`
- Create: `src/components/PageBar.tsx`、`src/components/page-bar.css`
- Create: `src/components/NotFound.tsx`、`src/components/not-found.css`

- [ ] **Step 1：写失败的测试**

新建 `tests/dom/viewport.ts`（完整内容）：

```ts
// Test helper (not a test file): a desktop viewport for one test. Without it
// jsdom has no window.matchMedia, so the router lays routes out as pages.
// tests/dom/setup.ts deletes the stub after every test.

import { DESKTOP_MEDIA_QUERY } from '../../src/lib/constants';

function stubQuery(query: string): MediaQueryList {
  const list = {
    matches: query === DESKTOP_MEDIA_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  return list as unknown as MediaQueryList;
}

/** Only DESKTOP_MEDIA_QUERY matches; prefers-reduced-motion and the rest do not. */
export function useDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stubQuery });
}
```

新建 `tests/dom/route-pages.test.tsx`，内容是下面两段依次拼接（中间空一行）。第一段是文件头、请求桩和桩数据（后面几个任务的用例也用它们，这时有些还没用上）：

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { NotFound } from '../../src/components/NotFound';
import { PageBar } from '../../src/components/PageBar';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { useRouteLayout } from '../../src/lib/useRouteLayout';
import type { PublicUser, RecordItem, SessionDetail, User } from '../../src/types';
import { useDesktopViewport } from './viewport';

// P1-1: the routes of spec §2.2 inside the app — pages on a phone, drawers on a
// desktop, NotFound, and the case a link points at moved to the top.

interface Call {
  method: string;
  path: string;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(404, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const count = (calls: Call[], path: string): number => calls.filter((c) => c.path === path).length;

const CASE: RecordItem = {
  id: 7,
  subject: { id: 'p', username: '选手', avatar_url: null },
  reporter: { id: 'j', username: '裁判', avatar_url: null },
  type: 'no_show',
  delta: -12,
  note: null,
  claim: '说好八点五排结果没来',
  claim_summary: '八点没来',
  classified_by: 'ai',
  escalation_suggested: false,
  session_id: null,
  statement: null,
  statement_at: null,
  appeal_reason: null,
  deadline_at: null,
  status: 'decided',
  verdict: { source: 'ai', headline: '', reasoning: '', factors: [] },
  range: { min: -20, max: -10, base: -15 },
  created_at: '2026-10-26 09:00:00',
  redacted: true,
};
const PLAYER: PublicUser = {
  id: 'p',
  username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  score: 88,
  created_at: '2026-10-01 00:00:00',
};
const SELF: User = { ...PLAYER, oauth_username: 'p', is_admin: false };
const ROW = '第 1 名 选手，88 分';
const SESSION: SessionDetail = {
  id: 5,
  organizer: { id: 'org', username: '组织者', avatar_url: null },
  title: '周五五排',
  game: null,
  starts_at: '2026-10-30T13:00:00.000Z',
  duration_min: null,
  capacity: null,
  note: null,
  status: 'open',
  settled_at: null,
  created_at: '2026-10-01 00:00:00',
  counts: { invited: 0, going: 1, maybe: 0, out: 0 },
  my_rsvp: null,
  players: [],
};

function routes(me: User | null = null): Record<string, () => Response> {
  return {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 12,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-01T16:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [PLAYER] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    'GET /api/sessions/5': () => json(200, { session: SESSION, records: [] }),
    'GET /api/records/7': () => json(200, { record: CASE }),
    'GET /api/records/9': () => json(500, { error: 'boom' }),
    'GET /api/users/p': () => json(200, { user: PLAYER, records: [{ ...CASE, id: 6 }, CASE], history: [] }),
  };
}

const lobbyHidden = (): boolean => document.querySelector('.app__main')?.hasAttribute('hidden') ?? false;

afterEach(() => {
  vi.unstubAllGlobals();
});
```

第二段：

```tsx
describe('building blocks', () => {
  it('NotFound: the heading takes focus, 回大厅 is a real link home', () => {
    render(<NotFound title="这页不存在" />);
    const heading = screen.getByRole('heading', { name: '这页不存在' });
    expect(heading).toHaveAttribute('id', 'notfound-title');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', { name: '回大厅' })).toHaveAttribute('href', '/');
  });

  it('NotFound takes a detail view’s heading id and its own actions', () => {
    render(
      <NotFound
        title="找不到这位选手。"
        headingId="player-detail-title"
        actions={[{ label: '看信誉榜', to: '/board' }]}
        autoFocus={false}
      />,
    );
    const heading = screen.getByRole('heading', { name: '找不到这位选手。' });
    expect(heading).toHaveAttribute('id', 'player-detail-title');
    expect(document.activeElement).not.toBe(heading);
    expect(screen.getByRole('link', { name: '看信誉榜' })).toHaveAttribute('href', '/board');
    expect(screen.queryByRole('link', { name: '回大厅' })).not.toBeInTheDocument();
  });

  it('PageBar: one 返回 button; the title is context, not a heading', async () => {
    const onBack = vi.fn();
    render(<PageBar backLabel="返回" title="周五五排" onBack={onBack} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('周五五排')).toHaveAttribute('aria-hidden', 'true');
  });

  it('useRouteLayout: a page without matchMedia, a drawer on a desktop', () => {
    function Layout(): JSX.Element {
      return <p>{useRouteLayout()}</p>;
    }
    const phone = render(<Layout />);
    expect(screen.getByText('page')).toBeInTheDocument();
    phone.unmount();
    useDesktopViewport();
    render(<Layout />);
    expect(screen.getByText('drawer')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx
```

期望：FAIL，`no tests`——找不到 `NotFound`、`PageBar`、`useRouteLayout`。

- [ ] **Step 3：实现**

新建 `src/lib/useRouteLayout.ts`（完整内容）：

```ts
import { useSyncExternalStore } from 'react';
import { DESKTOP_MEDIA_QUERY } from './constants';
import type { RouteLayout } from './routes';

// The only breakpoint in JS (contract §8 #9): a page and a drawer differ in
// semantics (inert, focus trap), not just in looks, so CSS alone cannot switch them.

function desktopQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_MEDIA_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = desktopQuery();
  if (query === null) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readLayout(): RouteLayout {
  return desktopQuery()?.matches === true ? 'drawer' : 'page';
}

/** 'drawer' at ≥1024px, else 'page' (also when matchMedia is missing, as in jsdom). */
export function useRouteLayout(): RouteLayout {
  return useSyncExternalStore(subscribe, readLayout, readLayout);
}
```

新建 `src/components/PageBar.tsx`（完整内容）：

```tsx
import './page-bar.css';

interface PageBarProps {
  /** The button's visible text, and so its accessible name (P1 passes 返回). */
  backLabel: string;
  /** Callers pass their onClose, which goes back in history. */
  onBack: () => void;
  /** Context once the page's own heading has scrolled away; hidden from assistive tech (not a heading). */
  title?: string;
  /** Right-hand controls (P3's 分享, P4's ⋯); none in P1. */
  actions?: React.ReactNode;
}

/** The sticky top of a page-form view (spec §3.5, §3.8). Drawers use Modal's own ✕ instead. */
export function PageBar({ backLabel, onBack, title, actions }: PageBarProps): JSX.Element {
  return (
    <div className="pagebar">
      <button type="button" className="pagebar__back" onClick={onBack}>
        <span aria-hidden="true">‹</span> {backLabel}
      </button>
      {title && (
        <span className="pagebar__title" aria-hidden="true">
          {title}
        </span>
      )}
      {actions && <div className="pagebar__actions">{actions}</div>}
    </div>
  );
}
```

新建 `src/components/page-bar.css`（完整内容）：

```css
/* PageBar (P1-1): back, and a quiet title, pinned to the top of a page-form view. */

.pagebar {
  position: sticky;
  top: 0;
  /* Over the sticky .hdr (z-index 40) once stuck, under every modal layer (--z-modal). */
  z-index: 41;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  padding: 0.25rem 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.pagebar__back {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  padding: 0 0.75rem 0 0.25rem;
  border: 0;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--fs-md);
  cursor: pointer;
}

@media (hover: hover) {
  .pagebar__back:hover {
    background: var(--panel-2);
  }
}

.pagebar__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: var(--fs-sm);
}

.pagebar__actions {
  display: flex;
  gap: 0.5rem;
  margin-left: auto;
}

/* The account menu (.hdr__dropdown, z-index 50) only counts inside the header's
   own stacking context (z-index 40), so it would open under a stuck PageBar:
   lift the header above the bar while the menu is open (it renders only then). */
.hdr:has(.hdr__dropdown) {
  z-index: 42;
}
```

新建 `src/components/NotFound.tsx`（完整内容）：

```tsx
import { useEffect, useRef } from 'react';
import { HOME_PATH } from '../lib/routes';
import { BACK_HOME } from '../lib/routeCopy';
import { Link } from './Link';
import './not-found.css';

export interface NotFoundAction {
  readonly label: string;
  readonly to: string;
}

interface NotFoundProps {
  title: string;
  /** Default 'notfound-title'; the detail views pass their own labelledBy id. */
  headingId?: string;
  /** Default: 回大厅. 看约局历史 / 看信誉榜 arrive with their pages (P3-6, contract §8 #3). */
  actions?: readonly NotFoundAction[];
  /** Default true: focus moves to the heading on mount. */
  autoFocus?: boolean;
}

const DEFAULT_ACTIONS: readonly NotFoundAction[] = [{ label: BACK_HOME, to: HOME_PATH }];

/** Rendered by the SPA itself: the hosting never serves a 404.html (spec §2.2). */
export function NotFound({
  title,
  headingId = 'notfound-title',
  actions = DEFAULT_ACTIONS,
  autoFocus = true,
}: NotFoundProps): JSX.Element {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (autoFocus) headingRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="notfound">
      <h2 id={headingId} ref={headingRef} className="notfound__title" tabIndex={-1} data-autofocus>
        {title}
      </h2>
      <div className="notfound__actions">
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className="btn btn--gold">
            {action.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

新建 `src/components/not-found.css`（完整内容）：

```css
/* NotFound (P1-1): unknown addresses and the detail views' 404s. */

.notfound {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  padding: clamp(3rem, 2rem + 6vw, 6rem) 1rem;
  text-align: center;
}

.notfound__title {
  font-size: var(--text-h2);
  color: var(--text);
}

.notfound__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.75rem;
}
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
npx tsc -p tsconfig.json --noEmit
```

期望：`route-pages.test.tsx` 4 个用例全过；`css-conventions.test.ts` 13 个用例全过（hover 在 `@media (hover: hover)` 里、没有 `outline: none`、没有新断点）；tsc 无输出。

- [ ] **Step 5：提交**

```bash
git add tests/dom/viewport.ts tests/dom/route-pages.test.tsx src/lib/useRouteLayout.ts src/components/PageBar.tsx src/components/page-bar.css src/components/NotFound.tsx src/components/not-found.css
git commit -m "feat: 新增 PageBar、NotFound 与页面/抽屉形态判断（P1-1）"
```

### Task 4：`SessionDetailDialog` 的 page / drawer 形态

**Files:**
- Modify: `tests/dom/route-pages.test.tsx`（末尾追加一个 `describe`）
- Modify: `src/components/SessionDetailDialog.tsx`

- [ ] **Step 1：写失败的测试**

在 `tests/dom/route-pages.test.tsx` 末尾空一行后追加：

```tsx
describe('SessionDetailDialog — page and drawer', () => {
  it('page: PageBar first, no dialog, the title focused once loaded', async () => {
    mockFetch(routes());
    const onClose = vi.fn();
    render(<SessionDetailDialog variant="page" sessionId={5} me={null} onClose={onClose} onChanged={() => {}} />);
    const title = await screen.findByRole('heading', { name: '周五五排' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.modal-page')?.firstElementChild).toHaveClass('pagebar');
    await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drawer: a dialog with Modal’s own ✕ and no PageBar', async () => {
    mockFetch(routes());
    render(<SessionDetailDialog variant="drawer" sessionId={5} me={null} onClose={() => {}} onChanged={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: '周五五排' });
    expect(dialog).toHaveClass('modal__panel--drawer');
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });

  it('a 404 is NotFound on a page — and still today’s line in the center dialog', async () => {
    mockFetch(routes());
    const page = render(
      <SessionDetailDialog variant="page" sessionId={999} me={null} onClose={() => {}} onChanged={() => {}} />,
    );
    const heading = await screen.findByRole('heading', { name: '找不到这局，链接可能写错了。' });
    expect(heading).toHaveAttribute('id', 'session-detail-title');
    page.unmount();

    render(<SessionDetailDialog sessionId={999} me={null} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('unrouted GET /api/sessions/999')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '找不到这局，链接可能写错了。' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx
```

期望：FAIL，`3 failed | 4 passed (7)`——三个新用例失败（没有 PageBar、抽屉没有 `modal__panel--drawer`、404 没有 NotFound 标题）。

- [ ] **Step 3：实现**

修改 `src/components/SessionDetailDialog.tsx`，按锚点逐段替换（每段 `old` 在文件里恰好出现一次；行号不可靠时只认锚点文字）：

（1）把这段：

```tsx
import { fullNotice, goingClosed, rsvpFeedback } from '../lib/sessionActions';
```

替换为：

```tsx
import { PAGE_BACK_LABEL, SESSION_NOT_FOUND } from '../lib/routeCopy';
import { fullNotice, goingClosed, rsvpFeedback } from '../lib/sessionActions';
```

（2）把这段：

```tsx
import { ConfirmInline } from './ConfirmInline';
```

替换为：

```tsx
import { ConfirmInline } from './ConfirmInline';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
```

（3）把这段：

```tsx
  /** Called after any mutation so parent lists and the leaderboard refresh. */
  onChanged: () => void;
}

const RSVP_ORDER = SELF_RSVPS;
```

替换为：

```tsx
  /** Called after any mutation so parent lists and the leaderboard refresh. */
  onChanged: () => void;
  /** Default 'center' — today's dialog, byte for byte. 'page' / 'drawer': the /sessions/:id route (P1-1). */
  variant?: 'center' | 'page' | 'drawer';
}

const RSVP_ORDER = SELF_RSVPS;
const TITLE_ID = 'session-detail-title';
const NOT_FOUND_STATUS = 404;
```

（4）把这段：

```tsx
  onClose,
  onChanged,
}: SessionDetailDialogProps): JSX.Element {
```

替换为：

```tsx
  onClose,
  onChanged,
  variant = 'center',
}: SessionDetailDialogProps): JSX.Element {
```

（5）把这段：

```tsx
  const [flash, setFlash] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
```

替换为：

```tsx
  const [flash, setFlash] = useState<string | null>(null);
  // A 404 on the page / drawer forms: NotFound instead of the bare error line (spec §2.2).
  const [missing, setMissing] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleFocused = useRef(false);
```

（6）把这段：

```tsx
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);
```

替换为：

```tsx
    } catch (err) {
      if (variant !== 'center' && err instanceof ApiError && err.status === NOT_FOUND_STATUS) {
        setMissing(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : '加载失败');
    }
  }, [sessionId, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  // The page form: once the session is in, focus its title (spec §6.4) — only the first time.
  useEffect(() => {
    if (variant !== 'page' || session === null || titleFocused.current) return;
    titleFocused.current = true;
    titleRef.current?.focus();
  }, [variant, session]);
```

（7）把这段：

```tsx
      <Modal open onClose={onClose} labelledBy="session-detail-title" size="lg">
        {!session ? (
```

替换为：

```tsx
      <Modal open onClose={onClose} labelledBy={TITLE_ID} size="lg" variant={variant}>
        {variant === 'page' && <PageBar backLabel={PAGE_BACK_LABEL} title={session?.title} onBack={onClose} />}
        {missing ? (
          <NotFound title={SESSION_NOT_FOUND} headingId={TITLE_ID} />
        ) : !session ? (
```

（8）把这段：

```tsx
              <h2 id="session-detail-title" className="sdt__title" ref={titleRef} tabIndex={-1}>
```

替换为：

```tsx
              <h2 id={TITLE_ID} className="sdt__title" ref={titleRef} tabIndex={-1}>
```

`variant` 缺省为 `'center'`，`Modal` 收到 `variant="center"` 与不传完全一样，所以 `organizer-actions`、`session-rsvp-moved` 看到的 markup 不变；center 形态的 404 仍走原来的 `setError`。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx tests/dom/organizer-actions.test.tsx tests/dom/session-rsvp-moved.test.tsx
npx tsc -p tsconfig.json --noEmit
```

期望：3 个文件、29 个用例全过（route-pages 7 个）；tsc 无输出。

- [ ] **Step 5：提交**

```bash
git add tests/dom/route-pages.test.tsx src/components/SessionDetailDialog.tsx
git commit -m "feat: 约局详情支持页面与抽屉形态，404 显示找不到这局（P1-1）"
```

### Task 5：`PlayerDetail` 的 page / drawer 形态、案件置顶、中性 ScoreGauge

**Files:**
- Modify: `tests/dom/route-pages.test.tsx`（末尾追加一个 `describe`）
- Modify: `src/components/PlayerDetail.tsx`
- Modify: `src/components/player-detail.css`（末尾追加）

- [ ] **Step 1：写失败的测试**

在 `tests/dom/route-pages.test.tsx` 末尾空一行后追加：

```tsx
describe('PlayerDetail — page, drawer and the focused case', () => {
  it('moves the focused case to the top: one #case-7, the list skips it, the count stays', async () => {
    mockFetch(routes());
    render(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={7} />);
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    const pinned = screen.getByRole('region', { name: '你点开的这一起' });
    expect(pinned).toHaveTextContent('案件 #7 · 放鸽子');
    expect(pinned).toContainElement(document.getElementById('case-7'));
    expect(document.querySelectorAll('.pd__cases .vc')).toHaveLength(1);
    expect(document.querySelector('.pd__count')).toHaveTextContent('2');
  });

  it('pins the route’s copy when the list does not hold the case', async () => {
    mockFetch({ ...routes(), 'GET /api/users/p': () => json(200, { user: PLAYER, records: [{ ...CASE, id: 6 }], history: [] }) });
    render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} focusRecordId={7} pinnedRecord={CASE} />);
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    expect(document.querySelector('.pd__count')).toHaveTextContent('1');
  });

  it('page form: the name takes focus; a case that is nowhere leaves the page unscrolled', async () => {
    mockFetch(routes());
    const plain = render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} />);
    const name = await screen.findByRole('heading', { name: '选手' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(document.querySelector('.modal-page')?.firstElementChild).toHaveClass('pagebar');
    plain.unmount();

    render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} focusRecordId={99} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('region', { name: '你点开的这一起' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.pd__cases .vc')).toHaveLength(2);
  });

  it('loads again when refreshKey changes', async () => {
    const calls = mockFetch(routes());
    const view = render(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={0} />);
    await screen.findByRole('heading', { name: '选手' });
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={1} />);
    await waitFor(() => expect(count(calls, '/api/users/p')).toBe(2));
  });

  it('shows everyone the score, but the 段位 only to the player themself', async () => {
    mockFetch(routes());
    const visitor = render(<PlayerDetail userId="p" me={null} onClose={() => {}} />);
    const gauge = await screen.findByRole('img', { name: /^信誉分 88 分/ });
    expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    expect(gauge).toHaveClass('gauge--neutral');
    visitor.unmount();

    render(<PlayerDetail userId="p" me={SELF} onClose={() => {}} />);
    expect(await screen.findByRole('img', { name: /^信誉分 88 分/ })).toHaveAccessibleName(/段位/);
  });

  it('a 404 is NotFound on the page and drawer forms — and still today’s line in the center dialog', async () => {
    mockFetch(routes());
    const page = render(<PlayerDetail variant="page" userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toHaveAttribute('id', 'player-detail-title');
    page.unmount();

    const drawer = render(<PlayerDetail variant="drawer" userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toBeInTheDocument();
    drawer.unmount();

    render(<PlayerDetail userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByText('unrouted GET /api/users/ghost')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx
```

期望：FAIL，`6 failed | 7 passed (13)`——六个新用例全部失败（没有「你点开的这一起」、`pinnedRecord` 被忽略、page 不聚焦名字、`refreshKey` 不重载、公开仪表念了段位、page/drawer 的 404 没有 NotFound）。

- [ ] **Step 3：实现**

修改 `src/components/PlayerDetail.tsx`，按锚点逐段替换（每段 `old` 在文件里恰好出现一次；行号不可靠时只认锚点文字）：

（1）把这段：

```tsx
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { useNow } from '../lib/useNow';
import { Modal } from './Modal';
```

替换为：

```tsx
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { PAGE_BACK_LABEL, PINNED_CASE_LABEL, PLAYER_NOT_FOUND, pinnedCaseEyebrow } from '../lib/routeCopy';
import { useNow } from '../lib/useNow';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PageBar } from './PageBar';
```

（2）把这段：

```tsx
  /** The board's config: with it, the player's own page previews the weekly heal (P0-5). */
  config?: Config;
}

interface DetailState {
  status: 'loading' | 'ready' | 'error';
```

替换为：

```tsx
  /** The board's config: with it, the player's own page previews the weekly heal (P0-5). */
  config?: Config;
  /** Default 'center' — today's dialog. 'page' / 'drawer': the /players/:id route (P1-1). */
  variant?: 'center' | 'page' | 'drawer';
  /** The focused case as the route already read it: pinned even before (or without) the list's own copy. */
  pinnedRecord?: RecordItem | null;
  /** Bumped by the app when the cases changed elsewhere (a statement was judged): load again. */
  refreshKey?: number;
}

interface DetailState {
  /** 'missing': a 404 on the page / drawer forms — NotFound instead of the error line. */
  status: 'loading' | 'ready' | 'error' | 'missing';
```

（3）把这段：

```tsx
/** busyId while the score is being set by hand. */
const SCORE_BUSY = -2;

export function PlayerDetail({
```

替换为：

```tsx
/** busyId while the score is being set by hand. */
const SCORE_BUSY = -2;
const TITLE_ID = 'player-detail-title';
const NOT_FOUND_STATUS = 404;

/** The focused case: the list's own copy when it has one (it is the fresher), else the route's. */
function pickPinned(
  records: readonly RecordItem[] | undefined,
  focusRecordId: number | null,
  fallback: RecordItem | null,
): RecordItem | null {
  if (focusRecordId === null) return null;
  const own = records?.find((r) => r.id === focusRecordId);
  if (own) return own;
  return fallback !== null && fallback.id === focusRecordId ? fallback : null;
}

function focusCase(id: number): void {
  const card = document.getElementById(`case-${id}`);
  if (!card) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  card.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  card.focus({ preventScroll: true });
}

interface EscalationButtonsProps {
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/** 确认是团灭级 / 维持原案由 — the filing judge's co-sign of an AI escalation hint. */
function EscalationButtons({ busy, onConfirm, onDismiss }: EscalationButtonsProps): JSX.Element {
  return (
    <>
      <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={onConfirm}>
        确认是团灭级
      </button>
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onDismiss}>
        维持原案由
      </button>
    </>
  );
}

/**
 * Once, when the page first has its data: the linked case is brought into view
 * and focused (else the page opens unscrolled — CONTRACT); a page-form view
 * without one focuses its heading (spec §6.4). Reloads never move focus again.
 */
function useFirstFocus(
  ready: boolean,
  focusRecordId: number | null,
  pinnedShown: boolean,
  variant: NonNullable<PlayerDetailProps['variant']>,
): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    if (focusRecordId !== null) {
      if (pinnedShown) focusCase(focusRecordId);
      return;
    }
    if (variant === 'page') document.getElementById(TITLE_ID)?.focus();
  }, [ready, focusRecordId, pinnedShown, variant]);
}

export function PlayerDetail({
```

（4）把这段：

```tsx
  focusRecordId = null,
  config,
}: PlayerDetailProps): JSX.Element {
```

替换为：

```tsx
  focusRecordId = null,
  config,
  variant = 'center',
  pinnedRecord = null,
  refreshKey = 0,
}: PlayerDetailProps): JSX.Element {
```

（5）把这段：

```tsx
  const [overriding, setOverriding] = useState<number | null>(null);
  const focused = useRef(false);
```

替换为：

```tsx
  const [overriding, setOverriding] = useState<number | null>(null);
```

（6）把这段：

```tsx
  // Once the cases are in: bring the linked one into view, and focus it.
  useEffect(() => {
    if (focused.current || focusRecordId === null || state.status !== 'ready') return;
    focused.current = true;
    const card = document.getElementById(`case-${focusRecordId}`);
    if (!card) return; // not among the cases shown here
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    card.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    card.focus({ preventScroll: true });
  }, [focusRecordId, state.status]);

```

整段删除（连同它后面那一个空行，删完后 `const now = useNow(REVOKE_TICK_MS);` 和 `const load = useCallback(` 之间只留一个空行）。

（7）把这段：

```tsx
    } catch (err) {
      setState({
        status: 'error',
        data: null,
        error: err instanceof ApiError ? err.message : '加载失败',
      });
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);
```

替换为：

```tsx
    } catch (err) {
      const gone = variant !== 'center' && err instanceof ApiError && err.status === NOT_FOUND_STATUS;
      setState({
        status: gone ? 'missing' : 'error',
        data: null,
        error: err instanceof ApiError ? err.message : '加载失败',
      });
    }
  }, [userId, variant]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);
```

（8）把这段：

```tsx
  const tier = tierFor(score);

  return (
    <>
    <Modal open onClose={onClose} labelledBy="player-detail-title" size="lg">
      {state.status === 'loading' && (
```

替换为：

```tsx
  const tier = tierFor(score);
  const pinned = pickPinned(data?.records, focusRecordId, pinnedRecord);
  useFirstFocus(state.status === 'ready', focusRecordId, pinned !== null, variant);

  // Only the filing judge (or an admin) may co-sign the -25 charge, so only they
  // get the buttons — a reporter who is no judge (any more) does not.
  const canCoSign = (r: RecordItem): boolean =>
    me !== null && (me.is_admin || (me.is_judge && r.reporter.id === me.id));

  // One card, wherever it sits: pinned at the top (focused) or in the list below.
  const renderCase = (r: RecordItem, focusedCard: boolean): JSX.Element => (
    <VerdictCard
      key={r.id}
      record={r}
      focused={focusedCard}
      escalation={
        canCoSign(r) ? (
          <EscalationButtons
            busy={busyId === r.id}
            onConfirm={() => void run(r.id, () => confirmEscalation(r.id))}
            onDismiss={() => void run(r.id, () => dismissEscalation(r.id))}
          />
        ) : undefined
      }
      actions={
        <CaseActions
          record={r}
          me={me}
          isSelf={isSelf}
          busy={busyId === r.id}
          overriding={overriding === r.id}
          onStartOverride={() => setOverriding(r.id)}
          onCancelOverride={() => setOverriding(null)}
          now={now}
          note={
            isSelf && config && data && r.status === 'decided' && r.delta < 0 ? (
              <ForgivenessNote delta={r.delta} scoreAfter={data.user.score} weeklyHeal={config.weeklyHeal} />
            ) : undefined
          }
          onStatement={() => onOpenStatement?.(r)}
          onAppeal={() => setAppealing(r)}
          onWithdraw={() => void run(r.id, () => withdrawCase(r.id))}
          onRevoke={() => void run(r.id, () => revokeRecord(r.id))}
          onOverride={(delta, reason) => {
            setOverriding(null);
            void run(r.id, () => overrideCase(r.id, delta, reason));
          }}
        />
      }
    />
  );

  return (
    <>
    <Modal open onClose={onClose} labelledBy={TITLE_ID} size="lg" variant={variant}>
      {variant === 'page' && <PageBar backLabel={PAGE_BACK_LABEL} onBack={onClose} />}

      {state.status === 'missing' && <NotFound title={PLAYER_NOT_FOUND} headingId={TITLE_ID} />}

      {state.status === 'loading' && (
```

（9）把这段：

```tsx
            <ScoreGauge score={score} size={128} strokeWidth={11} />
```

替换为：

```tsx
            {/* Everyone's score is public; the 段位 colour and name are the viewer's own only (spec §3.8). */}
            <ScoreGauge score={score} size={128} strokeWidth={11} tone={isSelf ? 'tier' : 'neutral'} />
```

（10）把这段：

```tsx
                <h2 id="player-detail-title" className="pd__name">
```

替换为：

```tsx
                <h2 id={TITLE_ID} className="pd__name" tabIndex={-1}>
```

（11）把这段：

```tsx
          </header>

          <section className="pd__section" aria-label="分数走势">
```

替换为：

```tsx
          </header>

          {/* Moved here, not copied: the list below skips it, so the page has one #case-N (spec §3.8). */}
          {pinned && (
            <section className="pd__section pd__pinned" aria-label={PINNED_CASE_LABEL}>
              <p className="pd__pinned-eyebrow">{pinnedCaseEyebrow(pinned)}</p>
              {renderCase(pinned, true)}
            </section>
          )}

          <section className="pd__section" aria-label="分数走势">
```

（12）把这段：

```tsx
                {data.records.map((r) => (
                  <VerdictCard
                    key={r.id}
                    record={r}
                    focused={r.id === focusRecordId}
                    escalation={
                      // Only the filing judge (or an admin) may co-sign the -25
                      // charge, so only they get the buttons — a reporter who is
                      // no judge (any more) does not.
                      me !== null && (me.is_admin || (me.is_judge && r.reporter.id === me.id)) ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => void run(r.id, () => confirmEscalation(r.id))}
                          >
                            确认是团灭级
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busyId === r.id}
                            onClick={() => void run(r.id, () => dismissEscalation(r.id))}
                          >
                            维持原案由
                          </button>
                        </>
                      ) : undefined
                    }
                    actions={
                      <CaseActions
                        record={r}
                        me={me}
                        isSelf={isSelf}
                        busy={busyId === r.id}
                        overriding={overriding === r.id}
                        onStartOverride={() => setOverriding(r.id)}
                        onCancelOverride={() => setOverriding(null)}
                        now={now}
                        note={
                          isSelf && config && r.status === 'decided' && r.delta < 0 ? (
                            <ForgivenessNote delta={r.delta} scoreAfter={data.user.score} weeklyHeal={config.weeklyHeal} />
                          ) : undefined
                        }
                        onStatement={() => onOpenStatement?.(r)}
                        onAppeal={() => setAppealing(r)}
                        onWithdraw={() => void run(r.id, () => withdrawCase(r.id))}
                        onRevoke={() => void run(r.id, () => revokeRecord(r.id))}
                        onOverride={(delta, reason) => {
                          setOverriding(null);
                          void run(r.id, () => overrideCase(r.id, delta, reason));
                        }}
                      />
                    }
                  />
                ))}
```

替换为：

```tsx
                {data.records.filter((r) => r.id !== pinned?.id).map((r) => renderCase(r, false))}
```

替换完以后文件约 368 行。核对：`focused` 这个 ref 已经不存在（由 `useFirstFocus` 里的 `done` 取代）；`data.records.length`（「案件 N」的计数）和空列表文案「还没有任何记录，保持靠谱！」的条件都没动；`TierBadge`、`pd__blurb`、头像环色不动（契约 §8 第 7 条）。

在文件末尾追加 `src/components/player-detail.css`：

```css

/* --- The case a link pointed at (P1-1, spec §3.8) ------------------------------ */

.pd__pinned {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.pd__pinned-eyebrow {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  color: var(--muted);
}
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx tests/dom/p8-app.test.tsx tests/dom/player-judge.test.tsx tests/dom/appeal-sheet.test.tsx
npx tsc -p tsconfig.json --noEmit
```

期望：4 个文件、44 个用例全过（route-pages 13 个；`p8-app`「scrolls the linked case into view」仍拿到 `block: 'center'`；`player-judge` 的「PlayerDetail 不新增 GET」成立）；tsc 无输出。

- [ ] **Step 5：提交**

```bash
git add tests/dom/route-pages.test.tsx src/components/PlayerDetail.tsx src/components/player-detail.css
git commit -m "feat: 选手页支持页面与抽屉形态，案件聚焦改为置顶移动（P1-1）"
```

### Task 6：接线——`RouteView`、旧深链、App 与品牌链接

**Files:**
- Modify: `tests/dom/route-pages.test.tsx`（末尾追加 App 级用例）
- Modify: `tests/dom/deep-link.test.tsx`、`tests/dom/p8-app.test.tsx`（只追加断言）
- Modify: `tests/unit/source-hygiene.test.ts`（末尾追加一个 `describe`）
- Create: `src/lib/useCaseLookup.ts`
- Create: `src/lib/useEntryTarget.ts`
- Create: `src/components/RouteView.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Header.tsx`
- Modify: `src/app.css`（末尾追加）

- [ ] **Step 1：写失败的测试**

在 `tests/dom/route-pages.test.tsx` 末尾空一行后追加：

```tsx
describe('unknown addresses', () => {
  it('render NotFound in place of the lobby; 回大厅 goes home without a reload', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/xyz');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    expect(screen.queryByRole('heading', { name: /约局/ })).not.toBeInTheDocument();
    const home = screen.getByRole('link', { name: '回大厅' });
    expect(home).toHaveAttribute('href', '/');
    await user.click(home);
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  });

  it('say which thing is missing on a session or player that does not exist', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/999');
    const first = render(<App />);
    expect(await screen.findByRole('heading', { name: '找不到这局，链接可能写错了。' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回大厅' })).toHaveAttribute('href', '/');
    first.unmount();

    window.history.replaceState(null, '', '/players/ghost');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toBeInTheDocument();
  });

  it('keep the old sentences for a case that is gone, or cannot be read right now', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/8');
    const first = render(<App />);
    expect(await screen.findByRole('heading', { name: '链接里的案件不存在了。' })).toBeInTheDocument();
    first.unmount();

    window.history.replaceState(null, '', '/cases/9');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '打不开链接里的案件，稍后再试。' })).toBeInTheDocument();
  });
});

describe('/sessions/:id', () => {
  it('on a phone is a page: PageBar, no dialog, the lobby hidden, the title focused', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/5');
    const user = userEvent.setup();
    render(<App />);
    const title = await screen.findByRole('heading', { name: '周五五排' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    // Opened straight from outside: 返回 has nothing of ours behind it, so it replaces with '/'.
    const before = window.history.length;
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  });

  it('on a desktop is a drawer over the lobby; ✕ closes it', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/5');
    const user = userEvent.setup();
    render(<App />);
    const drawer = await screen.findByRole('dialog');
    expect(drawer.className).toContain('modal__panel--drawer');
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(false);
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('/players/:id', () => {
  it('opens from the board as its own address; 返回 goes back to the lobby', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: ROW }));
    expect(window.location.pathname).toBe('/players/p');
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByRole('button', { name: ROW })).toBeInTheDocument();
  });

  it('the brand link goes home in place', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '选手' });
    await user.click(screen.getByRole('link', { name: 'EDG 信誉分 首页' }));
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('button', { name: ROW })).toBeInTheDocument();
  });
});

describe('/players/:id/cases/:caseId', () => {
  it('moves the case to the top — one #case-7 on the page, focused, the rest below', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/7');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    const card = document.getElementById('case-7');
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    expect(card?.closest('.pd__pinned')).not.toBeNull();
    expect(card?.className).toContain('vc--focus');
    expect(screen.getByRole('region', { name: '你点开的这一起' })).toHaveTextContent('案件 #7 · 放鸽子');
    expect(document.getElementById('case-6')?.closest('.pd__cases')).not.toBeNull();
    expect(document.querySelector('.pd__count')).toHaveTextContent('2');
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('when the two ids disagree, the case’s subject wins — in place, no error', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/players/wrong/cases/7?utm=dc');
    const before = window.history.length;
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/players/p/cases/7'));
    expect(window.location.search).toBe('?utm=dc');
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(count(calls, '/api/users/wrong')).toBe(0);
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('/cases/:id is an alias: looked up once, then replaced with the player address', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/cases/7');
    const before = window.history.length;
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/players/p/cases/7'));
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('on a desktop opens as a drawer with the case pinned', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/7');
    render(<App />);
    const drawer = await screen.findByRole('dialog');
    expect(drawer.className).toContain('modal__panel--drawer');
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(lobbyHidden()).toBe(false);
  });

  it('on a desktop, a case that is gone says so in a drawer over the lobby; ✕ goes home', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/8');
    const user = userEvent.setup();
    render(<App />);
    const drawer = await screen.findByRole('dialog', { name: '链接里的案件不存在了。' });
    expect(drawer.className).toContain('modal__panel--drawer');
    expect(lobbyHidden()).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '链接里的案件不存在了。' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
```

在 `tests/dom/deep-link.test.tsx` 的原用例里**只追加**断言（原有断言一个字不改）：

（1）把这段：

```tsx
    expect(window.location.search).toBe('?utm=dc');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
```

替换为：

```tsx
    expect(window.location.search).toBe('?utm=dc');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    // P1-1: the link became the case's own address, and the case was moved — not copied — to the top.
    expect(window.location.pathname).toBe('/players/p/cases/7');
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
  });
```

（2）把这段：

```tsx
      expect(window.location.search, bad).toBe('');
      unmount();
```

替换为：

```tsx
      expect(window.location.search, bad).toBe('');
      expect(window.location.pathname, bad).toBe('/');
      unmount();
```

（3）把这段：

```tsx
    expect(await screen.findByText('链接里的案件不存在了。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
  });
```

替换为：

```tsx
    expect(await screen.findByText('链接里的案件不存在了。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
```

（4）把这段：

```tsx
    expect(window.location.search).toBe('');
  });
});
```

替换为：

```tsx
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/sessions/3');
  });
});
```

在 `tests/dom/p8-app.test.tsx` 的原用例里**只追加**断言：

（1）把这段：

```tsx
    expect(await screen.findByText('打不开链接里的案件，稍后再试。')).toBeInTheDocument();
  });
```

替换为：

```tsx
    expect(await screen.findByText('打不开链接里的案件，稍后再试。')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
```

（2）把这段：

```tsx
    expect(calls.filter((c) => c.path === '/api/records/7')).toHaveLength(1);
  });
```

替换为：

```tsx
    expect(calls.filter((c) => c.path === '/api/records/7')).toHaveLength(1);
    expect(window.location.pathname).toBe('/players/p/cases/7');
  });
```

（3）把这段：

```tsx
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
  });
```

替换为：

```tsx
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/players/p/cases/7');
  });
```

（4）把这段：

```tsx
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
```

替换为：

```tsx
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
      // P1-1: the focused case is moved to the top, so the page still holds exactly one #case-7.
      expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
```

在文件末尾追加 `tests/unit/source-hygiene.test.ts`：

```ts

// P1-1 (contract §6.5): src/lib/router.ts is the only module that drives
// window.history — anything else writing an entry would break 返回 and the idx marks.
describe('history API', () => {
  const HISTORY_USE = /history\.(?:pushState|replaceState|back\(|go\(|forward\(|state\b)/;
  const ROUTER = path.join('src', 'lib', 'router.ts');

  it('is used only by src/lib/router.ts', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src'))
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.relative(ROOT, file))
      .filter((file) => file !== ROUTER)
      .filter((file) => HISTORY_USE.test(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('still sees the router itself (the scan is not vacuous)', () => {
    expect(HISTORY_USE.test(readFileSync(path.join(ROOT, ROUTER), 'utf8'))).toBe(true);
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx tests/dom/deep-link.test.tsx tests/dom/p8-app.test.tsx
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts
```

期望：dom `16 failed | 20 passed (36)`——route-pages 的 12 个 App 级用例、deep-link 的 `?case=` 与 `?session=` 两条（`pathname`）、p8 的「opens once」「waits for the first-run dialog」两条（`pathname`）失败；unit `1 failed | 4 passed (5)`——`history API > is used only by src/lib/router.ts` 报出 `src/App.tsx`。

- [ ] **Step 3：实现**

新建 `src/lib/useCaseLookup.ts`（完整内容）：

```ts
import { useEffect, useRef, useState } from 'react';
import { ApiError, getRecord } from '../api';
import type { RecordItem } from '../types';

/** A case already read on the way in (old ?case= link, /cases/:id): the page needs no second GET. */
export interface PinnedCase {
  readonly caseId: number;
  readonly record: RecordItem;
}

export type CaseLookupStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface CaseLookup {
  readonly status: CaseLookupStatus;
  readonly record: RecordItem | null;
}

interface Fetched extends CaseLookup {
  readonly caseId: number;
}

const IDLE: CaseLookup = { status: 'idle', record: null };
const LOADING: CaseLookup = { status: 'loading', record: null };
const NOT_FOUND_STATUS = 404;

/**
 * GET /api/records/:caseId once per case id per mount — never again on a
 * re-render or on the app's refreshes (p8-app pins exactly one request).
 * A seed for the same id is used as is.
 */
export function useCaseLookup(caseId: number | null, seed: PinnedCase | null): CaseLookup {
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const requested = useRef<number | null>(null);
  const seeded = caseId !== null && seed !== null && seed.caseId === caseId;

  useEffect(() => {
    if (caseId === null || seeded || requested.current === caseId) return;
    requested.current = caseId;
    // No "live" flag: StrictMode re-runs this effect, and the first request is the one that counts.
    getRecord(caseId).then(
      ({ record }) => setFetched({ caseId, status: 'ready', record }),
      (err: unknown) => {
        const gone = err instanceof ApiError && err.status === NOT_FOUND_STATUS;
        setFetched({ caseId, status: gone ? 'missing' : 'error', record: null });
      },
    );
  }, [caseId, seeded]);

  if (caseId === null) return IDLE;
  if (seeded) return { status: 'ready', record: seed.record };
  if (fetched !== null && fetched.caseId === caseId) return { status: fetched.status, record: fetched.record };
  return LOADING;
}
```

新建 `src/lib/useEntryTarget.ts`（完整内容）：

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, getRecord } from '../api';
import type { User } from '../types';
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './deepLink';
import { navigate } from './router';
import { HOME_PATH, playerCasePath, sessionPath } from './routes';
import { CASE_GONE, CASE_UNAVAILABLE } from './routeCopy';
import type { PinnedCase } from './useCaseLookup';

// Old links (spec §2.3, kept forever): the bot's DMs say /?case=N and /?session=N.
// They are read once, on '/', and translated into the view's own address.

export type EntryTarget =
  /** /?session=N → '/sessions/N' plus the other parameters. */
  | { readonly kind: 'path'; readonly path: string }
  /** /?case=N → its subject's page, once GET /api/records/N says who that is. */
  | { readonly kind: 'case'; readonly caseId: number; readonly rest: string };

interface EntryTargetInput {
  /** The core data is in. */
  readonly ready: boolean;
  readonly me: User | null;
  /** Read when the target is about to open: the first-run dialog goes first (contract 补充). */
  readonly blocked: () => boolean;
  readonly onPinned: (pinned: PinnedCase) => void;
}

interface EntryTargetResult {
  /** CASE_GONE / CASE_UNAVAILABLE for the lobby's LinkMissingNotice. */
  readonly linkMissing: string | null;
  readonly dismissLinkMissing: () => void;
}

/** Everything a target does not carry along; what is left (utm=…) rides to the new address. */
const ENTRY_PARAMS = ['case', 'session', 'linked', 'onboarding'];
const NOT_FOUND_STATUS = 404;

function readEntryTarget(): EntryTarget | null {
  const { pathname, search } = window.location;
  if (pathname !== HOME_PATH) return null;
  const link = readDeepLink(search);
  if (link === null) return null;
  const rest = withoutParams(search, ENTRY_PARAMS);
  return link.kind === 'session'
    ? { kind: 'path', path: sessionPath(link.id) + rest }
    : { kind: 'case', caseId: link.id, rest };
}

/** case / session always (a bad id too), linked only as the bind's landing; onboarding stays for its own effect. */
function stripEntryParams(): void {
  const { pathname, search } = window.location;
  if (pathname !== HOME_PATH) return;
  const params = new URLSearchParams(search);
  const names = [...DEEP_LINK_PARAMS, ...(params.get('linked') === 'discord' ? ['linked'] : [])];
  if (!names.some((name) => params.has(name))) return;
  navigate(HOME_PATH + withoutParams(search, names), { replace: true });
}

export function useEntryTarget({ ready, blocked, onPinned }: EntryTargetInput): EntryTargetResult {
  const [target] = useState(readEntryTarget);
  const opened = useRef(false);
  const [linkMissing, setLinkMissing] = useState<string | null>(null);
  // Set together with onPinned: navigating from an effect after that commit means the
  // case page already has the record (a store update would otherwise render first).
  const [landing, setLanding] = useState<string | null>(null);

  useEffect(stripEntryParams, []);

  useEffect(() => {
    if (!ready || target === null || opened.current || blocked()) return;
    opened.current = true;
    if (target.kind === 'path') {
      navigate(target.path);
      return;
    }
    getRecord(target.caseId).then(
      ({ record }) => {
        onPinned({ caseId: target.caseId, record });
        setLanding(playerCasePath(record.subject.id, target.caseId) + target.rest);
      },
      (err: unknown) => {
        setLinkMissing(err instanceof ApiError && err.status === NOT_FOUND_STATUS ? CASE_GONE : CASE_UNAVAILABLE);
      },
    );
  }, [ready, target, blocked, onPinned]);

  useEffect(() => {
    if (landing !== null) navigate(landing);
  }, [landing]);

  const dismissLinkMissing = useCallback((): void => setLinkMissing(null), []);
  return { linkMissing, dismissLinkMissing };
}
```

新建 `src/components/RouteView.tsx`（完整内容）：

```tsx
import { useEffect } from 'react';
import type { Config, RecordItem, User } from '../types';
import { goBack, navigate, type RouterLocation } from '../lib/router';
import { playerCasePath, type RouteLayout } from '../lib/routes';
import { CASE_GONE, CASE_OPENING, CASE_UNAVAILABLE, NOT_FOUND_TITLE } from '../lib/routeCopy';
import { useCaseLookup, type PinnedCase } from '../lib/useCaseLookup';
import { Modal } from './Modal';
import { NotFound } from './NotFound';
import { PlayerDetail } from './PlayerDetail';
import { SessionDetailDialog } from './SessionDetailDialog';

export type { PinnedCase };

interface RouteViewProps {
  location: RouterLocation;
  layout: RouteLayout;
  me: User | null;
  config: Config;
  pinned: PinnedCase | null;
  playerRefreshKey: number;
  /** /cases/:id resolved its case: App keeps it, so the case page needs no second GET. */
  onPinned: (pinned: PinnedCase) => void;
  onChanged: () => void;
  onOpenStatement: (record: RecordItem) => void;
}

/** Every route view closes the same way: back through history, or to '/' if this tab started here. */
const close = (): void => goBack();

function PageShell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="app__page">{children}</div>;
}

/** Pages sit in the flow where the hidden lobby was; drawers portal out on their own. */
function LayoutShell({ layout, children }: { layout: RouteLayout; children: React.ReactNode }): JSX.Element {
  return layout === 'page' ? <PageShell>{children}</PageShell> : <>{children}</>;
}

function RouteNotice({ layout, title }: { layout: RouteLayout; title: string }): JSX.Element {
  if (layout === 'page') {
    return (
      <PageShell>
        <NotFound title={title} />
      </PageShell>
    );
  }
  // Modal moves focus to the heading itself ([data-autofocus]); NotFound must not do it first,
  // or Modal would remember the heading as the place to give focus back to on close.
  return (
    <Modal open variant="drawer" size="lg" labelledBy="notfound-title" onClose={close}>
      <NotFound title={title} autoFocus={false} />
    </Modal>
  );
}

function CaseOpening(): JSX.Element {
  return (
    <PageShell>
      <p className="app__page-status" role="status">
        {CASE_OPENING}
      </p>
    </PageShell>
  );
}

interface CaseRouteProps extends RouteViewProps {
  caseId: number;
  /** null for the /cases/:id alias. */
  userId: string | null;
}

/**
 * /players/:id/cases/:caseId and its /cases/:id alias. Both render this one
 * component at the same place, so the lookup survives the alias' replace.
 */
function CaseRoute(props: CaseRouteProps): JSX.Element | null {
  const { caseId, userId, location, layout, pinned, onPinned } = props;
  const { status, record } = useCaseLookup(caseId, pinned);
  const subject = record?.subject.id ?? null;

  useEffect(() => {
    if (record === null || subject === null || subject === userId) return;
    // The alias, or /players/A/cases/7 when 7 is B's: B's address, in place, no error (spec §2.2).
    if (pinned?.caseId !== caseId) onPinned({ caseId, record });
    navigate(playerCasePath(subject, caseId) + location.search, { replace: true });
  }, [record, subject, userId, caseId, location.search, pinned, onPinned]);

  if (status === 'missing' || status === 'error') {
    const title = status === 'missing' ? CASE_GONE : CASE_UNAVAILABLE;
    return <RouteNotice layout={userId === null ? 'page' : layout} title={title} />;
  }
  if (record === null || userId === null || subject !== userId) {
    return userId === null || layout === 'page' ? <CaseOpening /> : null;
  }
  return (
    <LayoutShell layout={layout}>
      <PlayerDetail
        key={`${userId}:${caseId}`}
        variant={layout}
        userId={userId}
        me={props.me}
        config={props.config}
        focusRecordId={caseId}
        pinnedRecord={record}
        refreshKey={props.playerRefreshKey}
        onClose={close}
        onOpenStatement={props.onOpenStatement}
        onChanged={props.onChanged}
      />
    </LayoutShell>
  );
}

/** What the address shows on top of (or instead of) the lobby (contract §4.9). */
export function RouteView(props: RouteViewProps): JSX.Element | null {
  const { location, layout } = props;
  const { route } = location;
  switch (route.name) {
    case 'home':
      return null;
    case 'notFound':
      return <RouteNotice layout="page" title={NOT_FOUND_TITLE} />;
    case 'session':
      return (
        <LayoutShell layout={layout}>
          <SessionDetailDialog
            key={route.sessionId}
            variant={layout}
            sessionId={route.sessionId}
            me={props.me}
            onClose={close}
            onChanged={props.onChanged}
          />
        </LayoutShell>
      );
    case 'player':
      return (
        <LayoutShell layout={layout}>
          <PlayerDetail
            key={route.userId}
            variant={layout}
            userId={route.userId}
            me={props.me}
            config={props.config}
            refreshKey={props.playerRefreshKey}
            onClose={close}
            onOpenStatement={props.onOpenStatement}
            onChanged={props.onChanged}
          />
        </LayoutShell>
      );
    case 'playerCase':
      return <CaseRoute {...props} caseId={route.caseId} userId={route.userId} />;
    case 'case':
      return <CaseRoute {...props} caseId={route.caseId} userId={null} />;
  }
}
```

修改 `src/App.tsx`，按锚点逐段替换（每段 `old` 在文件里恰好出现一次；行号不可靠时只认锚点文字）：

（1）把这段：

```tsx
import { ApiError, AUTH_LOGIN_URL, getRecord, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { DEEP_LINK_PARAMS, readDeepLink, withoutParams } from './lib/deepLink';
```

替换为：

```tsx
import { ApiError, AUTH_LOGIN_URL, logout as apiLogout, regenerateReport } from './api';
import { lastWeekStartOf } from './lib/time';
import { bootRouter, navigate, useLocation } from './lib/router';
import { playerPath, routeCoversHome, sessionPath } from './lib/routes';
import { useRouteLayout } from './lib/useRouteLayout';
import { useEntryTarget } from './lib/useEntryTarget';
import type { PinnedCase } from './lib/useCaseLookup';
```

（2）把这段：

```tsx
import { PlayerDetail } from './components/PlayerDetail';
```

整段删除（替换为空）。

（3）把这段：

```tsx
import { SessionDetailDialog } from './components/SessionDetailDialog';
```

整段删除（替换为空）。

（4）把这段：

```tsx
import { LinkMissingNotice } from './components/LinkMissingNotice';
```

替换为：

```tsx
import { LinkMissingNotice } from './components/LinkMissingNotice';
import { RouteView } from './components/RouteView';
```

（5）把这段：

```tsx
function AppMain(): JSX.Element {
  const { state, refresh, setMe } = useCoreData();
  const toast = useToast();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [caseOpen
```

替换为：

```tsx
function AppMain(): JSX.Element {
  // Before anything reads the address: mark the entry this tab landed on (router.ts).
  useState(bootRouter);
  const location = useLocation();
  const layout = useRouteLayout();
  const { state, refresh, setMe } = useCoreData();
  const toast = useToast();
  const [caseOpen
```

（6）把这段：

```tsx
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [aiPanelOpen
```

替换为：

```tsx
  const [sessionFormOpen, setSessionFormOpen] = useState(false);
  const [aiPanelOpen
```

（7）把这段：

```tsx
  // ?case= / ?session= (links from Discord): read once, opened once data is in.
  const [deepLink] = useState(() => readDeepLink(window.location.search));
  const deepLinkDone = useRef(false);
  // Set by the effects
```

替换为：

```tsx
  // Set by the effects
```

（8）把这段：

```tsx
  const onboardingAsked = useRef(false);
  const [focusCaseId, setFocusCaseId] = useState<number | null>(null);
  const [linkMissing, setLinkMissing] = useState<string | null>(null);

  useEffect(() => {
    // One-off parameters: stripped at once, so a reload does not repeat them.
    const params = new URLSearchParams(window.location.search);
    const oneOff = [...(params.get('linked') === 'discord' ? ['linked'] : []), ...DEEP_LINK_PARAMS];
    if (!oneOff.some((name) => params.has(name))) {
      return;
    }
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${withoutParams(window.location.search, oneOff)}`,
    );
  }, []);
```

替换为：

```tsx
  const onboardingAsked = useRef(false);
  // The case an old ?case= link or /cases/:id resolved: its page shows it without a second GET.
  const [pinned, setPinned] = useState<PinnedCase | null>(null);
  // Bumped when a statement is judged: the player page behind the dialog reloads its cases.
  const [playerRefreshKey, setPlayerRefreshKey] = useState(0);
```

（9）把这段：

```tsx
      params.delete('onboarding');
      const qs = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${qs ? `?${qs}` : ''}`,
      );
    }
  }, [ready?.me]);
```

替换为：

```tsx
      params.delete('onboarding');
      const qs = params.toString();
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
    }
  }, [ready?.me]);
```

（10）把这段：

```tsx
  // Open what the link points at, once: a case in its subject's page, or a
  // session. Through the same reads as clicking there — so the same rules.
  useEffect(() => {
    if (!ready || !deepLink || deepLinkDone.current || onboardingOpen || onboardingAsked.current) return;
    deepLinkDone.current = true;
    if (deepLink.kind === 'session') {
      setSessionId(deepLink.id);
      return;
    }
    getRecord(deepLink.id)
      .then(({ record }) => {
        setFocusCaseId(record.id);
        setSelectedUserId(record.subject.id);
      })
      .catch((err: unknown) => {
        setLinkMissing(
          err instanceof ApiError && err.status === 404 ? '链接里的案件不存在了。' : '打不开链接里的案件，稍后再试。',
        );
      });
  }, [ready, deepLink, onboardingOpen]);
```

替换为：

```tsx
  // Old ?case= / ?session= links, once the data is in and the first-run dialog is done
  // (declared after the onboarding effects: it reads onboardingAsked after they ran).
  const entryBlocked = useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen]);
  const { linkMissing, dismissLinkMissing } = useEntryTarget({
    ready: ready !== null,
    me: ready?.me ?? null,
    blocked: entryBlocked,
    onPinned: setPinned,
  });

  // Opening a view is navigating to its address; a desktop drawer keeps the lobby's scroll.
  const openRoute = useCallback(
    (path: string): void => navigate(path, { keepScroll: layout === 'drawer' }),
    [layout],
  );
  const openPlayer = useCallback((id: string): void => openRoute(playerPath(id)), [openRoute]);
  const openSession = useCallback((id: number): void => openRoute(sessionPath(id)), [openRoute]);
```

（11）把这段：

```tsx
  const { config, participants, records, me, myPending, invites, report } = state.data;
```

替换为：

```tsx
  const { config, participants, records, me, myPending, invites, report } = state.data;
  // A page (phone) or NotFound replaces the lobby; it stays mounted, only hidden (contract §8 #6).
  const covered = routeCoversHome(location.route, layout);
```

（12）把这段：

```tsx
      <main className="app__main">
```

替换为：

```tsx
      <main className="app__main" hidden={covered}>
```

（13）把这段：

```tsx
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={() => setLinkMissing(null)} />}
```

替换为：

```tsx
        {linkMissing && <LinkMissingNotice message={linkMissing} onDismiss={dismissLinkMissing} />}
```

（14）把这段：

```tsx
        <InviteBanner invites={invites} onAnswered={handleChanged} onOpen={setSessionId} />
```

替换为：

```tsx
        <InviteBanner invites={invites} onAnswered={handleChanged} onOpen={openSession} />
```

（15）把这段：

```tsx
        {me && <MyScoreLine me={me} rank={myRank} config={config} onOpen={() => setSelectedUserId(me.id)} />}
```

替换为：

```tsx
        {me && <MyScoreLine me={me} rank={myRank} config={config} onOpen={() => openPlayer(me.id)} />}
```

（16）把这段：

```tsx
          onOpenSession={setSessionId}
```

替换为：

```tsx
          onOpenSession={openSession}
```

（17）把这段：

```tsx
              onSelect={setSelectedUserId}
```

替换为：

```tsx
              onSelect={openPlayer}
```

（18）把这段：

```tsx
                  onSelectUser={setSelectedUserId}
```

替换为：

```tsx
                  onSelectUser={openPlayer}
```

（19）把这段：

```tsx
              onSelectUser={setSelectedUserId}
              emptyHint
```

替换为：

```tsx
              onSelectUser={openPlayer}
              emptyHint
```

（20）把这段：

```tsx
      </main>

      <footer className="app__footer">
```

替换为：

```tsx
      </main>

      <RouteView
        location={location}
        layout={layout}
        me={me}
        config={config}
        pinned={pinned}
        playerRefreshKey={playerRefreshKey}
        onPinned={setPinned}
        onChanged={handleChanged}
        onOpenStatement={setStatementCase}
      />

      <footer className="app__footer" hidden={covered}>
```

（21）把这段：

```tsx
          onClose={() => setStatementCase(null)}
          onDecided={handleChanged}
```

替换为：

```tsx
          onClose={() => setStatementCase(null)}
          onDecided={() => {
            handleChanged();
            setPlayerRefreshKey((n) => n + 1);
          }}
```

（22）把这段：

```tsx
          onCreated={(session) => {
            handleChanged();
            setSessionId(session.id);
          }}
```

替换为：

```tsx
          onCreated={(session) => {
            handleChanged();
            openSession(session.id);
          }}
```

（23）把这段：

```tsx
      {sessionId !== null && (
        <SessionDetailDialog
          sessionId={sessionId}
          me={me}
          onClose={() => setSessionId(null)}
          onChanged={handleChanged}
        />
      )}

```

整段删除（替换为空）。

（24）把这段：

```tsx

      {selectedUserId && (
        <PlayerDetail
          userId={selectedUserId}
          me={me}
          config={config}
          focusRecordId={focusCaseId}
          onClose={() => {
            setSelectedUserId(null);
            setFocusCaseId(null);
          }}
          onOpenStatement={(record) => {
            setSelectedUserId(null);
            setFocusCaseId(null);
            setStatementCase(record);
          }}
          onChanged={handleChanged}
        />
      )}
```

整段删除（替换为空）。

替换完以后核对 `src/App.tsx`：
- `grep -n "window.history" src/App.tsx` 没有输出；`grep -n "selectedUserId\|setSessionId\|focusCaseId\|deepLink\|getRecord" src/App.tsx` 没有输出。
- `useEntryTarget(...)` 写在「Back from binding Discord」那个 effect **之后**（对契约的补充第 1 条）。
- `PendingBanner onOpen={setStatementCase}`、FAB「记一笔」、`CaseDialog`、`OnboardingDialog`、`AdminAiPanel` 都没动；`<main>` 里的子元素顺序没动（`my-score-line` 的 DOM 顺序断言）。
- 第（2）（3）（23）（24）段删掉的是整行或整块：连同多出来的空行一起删（import 区不留空行；`{aiPanelOpen && …}` 前后各只有一个空行；`</div>` 前不留空行）。
- `wc -l src/App.tsx` 在 420–460 之间（回放结果 426；没清空行时是 430）。

修改 `src/components/Header.tsx`，只动品牌那个元素（子元素不动）：

（1）把这段：

```tsx
import { Avatar } from './Avatar';
```

替换为：

```tsx
import { Avatar } from './Avatar';
import { Link } from './Link';
```

（2）把这段：

```tsx
        <a className="hdr__brand" href="/" aria-label="EDG 信誉分 首页">
```

替换为：

```tsx
        <Link to="/" className="hdr__brand" aria-label="EDG 信誉分 首页">
```

（3）把这段：

```tsx
            <span className="hdr__subtitle">开黑守约计分板</span>
          </span>
        </a>
```

替换为：

```tsx
            <span className="hdr__subtitle">开黑守约计分板</span>
          </span>
        </Link>
```

在文件末尾追加 `src/app.css`：

```css

/* --- Routes (P1-1) ------------------------------------------------------------ */

/* A page-form route hides the lobby, which stays mounted. Without this the
   components' own `display` would beat the UA's [hidden] rule. */
.app__main[hidden],
.app__footer[hidden] {
  display: none;
}

.app__page {
  flex: 1;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 0 var(--space-page) clamp(2rem, 1.5rem + 3vw, 4rem);
}

.app__page-status {
  padding: 3rem 1rem;
  text-align: center;
  color: var(--muted);
}
```

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/route-pages.test.tsx tests/dom/deep-link.test.tsx tests/dom/p8-app.test.tsx
npx vitest run --config vitest.config.ts tests/unit/source-hygiene.test.ts tests/unit/css-conventions.test.ts
npx vitest run --config vitest.dom.config.ts
npx tsc -p tsconfig.json --noEmit
```

期望：3 个 dom 文件 36 个用例全过；source-hygiene 5 个、css-conventions 13 个全过；整个 dom 套件 22 个文件、**D0 + 39** 个用例全过（`app-refresh` 的首屏请求集合、`discord-link` 的 `?onboarding=1`、`board` 的唯一 /约局/ 标题、`my-score-line` 的 DOM 顺序都原样通过）；tsc 无输出。

- [ ] **Step 5：提交**

```bash
git add tests/dom/route-pages.test.tsx tests/dom/deep-link.test.tsx tests/dom/p8-app.test.tsx tests/unit/source-hygiene.test.ts src/lib/useCaseLookup.ts src/lib/useEntryTarget.ts src/components/RouteView.tsx src/App.tsx src/components/Header.tsx src/app.css
git commit -m "feat: 接入路由与旧深链映射，品牌改用 Link（P1-1）"
```

## 收尾

- [ ] **全量验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts
npx vitest run --config vitest.dom.config.ts
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c "not wrapped in act"
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c "Not implemented"
npm run build:pages
ls dist
grep -rnE "history\.(pushState|replaceState|back\(|go\(|forward\(|state)" src | grep -v "^src/lib/router.ts"
wc -l src/App.tsx src/components/PlayerDetail.tsx src/components/SessionDetailDialog.tsx src/components/RouteView.tsx src/lib/router.ts src/lib/routes.ts
```

期望：
- typecheck（三个 tsconfig）通过。`tests/unit/route.test.ts` 里 `type: null` 的用例依赖 B1-1 把 `RecordItem.type` 改成可空。
- unit：**27 → 28 个文件**，用例 **U0 + 18**（`route.test.ts` 16 个、`source-hygiene` 新 `describe` 2 个），全过。
- dom：**20 → 22 个文件**，用例 **D0 + 39**（`router.test.tsx` 14 个、`route-pages.test.tsx` 25 个），全过。审查回放与跨 PR 合成实测（以 P0 + P1-0 + B1-1 为起点）：unit 345 → 363，dom 225 → 264，typecheck 和 `build:pages` 通过。
- act 警告仍是 **3** 条；`Not implemented` 为 **0**。
- 如果 dom 全量里只有 `verdict-privacy.test.tsx`「… never a 0」红、报的是「还剩 3 小时 0 分」，说明 B1-1 没按最终计划改截止时间（见 Task 0），单独重跑该文件确认通过即可，并回报领队。
- `build:pages` 成功（含 P1-0 的「dist 不含 404.html」检查），`dist/` 里只有 `index.html`、`assets/`、`_headers`。
- `grep` 没有输出。
- 行数：App 420–460（回放 426）、PlayerDetail ≈368、SessionDetailDialog ≈426、RouteView ≈155、router ≈121、routes ≈156，全部 < 800。
- 不跑 `test:worker`（本 PR 不碰 `worker/`）、`test:pg`、`test:server`。

- [ ] **手动检查（领队或执行者在本机做；需要本地 API）**

本地起服务：终端 1 `npx wrangler dev`（:8787，首次先 `npm run db:local`），终端 2 `npx vite`（:5173，把 `/api`、`/auth` 代理到 :8787）。用 Chrome DevTools 设备模式 375×812 和 1280×800 各走一遍：

1. 375×812：大厅点榜单上的一个人 → 地址变 `/players/<id>`，页面形态，顶部「‹ 返回」，大厅和页脚不见了；点「返回」→ 回到 `/`，大厅还在原位（P1-2 才恢复滚动位置）。
2. 375×812：浏览器返回键与「返回」效果一致；前进键再进入选手页。
3. 375×812：地址栏直接输入 `/sessions/999999` → 「找不到这局，链接可能写错了。」+「回大厅」；`/xyz` → 「这页不存在」；`/players/不存在` → 「找不到这位选手。」。
4. 375×812：`/?session=<真实 id>&utm=dc` → 地址变 `/sessions/<id>?utm=dc`；`/?case=<真实 id>` → `/players/<当事人>/cases/<id>`，那一起在最上方、居中、有金色聚焦框，下面的「案件 N」列表里没有它。
5. 1280×800：点一局 → 右侧 480px 抽屉，大厅在底下；✕、Esc、点背景都回到 `/`。点一个人 → 右侧抽屉。
6. 两种视口：点 Header 品牌 → 回 `/`，没有整页刷新（Network 面板里没有新的 document 请求）。
7. 375×812 打开 `/sessions/<id>`：加载完焦点在约局标题上；Shift+Tab 能回到「返回」和 Header（page 形态不困焦点、不给 `#root` 加 inert）。
8. 375×812 在 `/players/<id>` 上（登录后）点右上角头像：菜单完整盖在 PageBar 上面，点菜单第一项不会误点到「返回」；往下滚动后 PageBar 贴顶、盖住 Header。

本地没有数据时，第 1、4、5 条用 `/players/<自己的 id>`（登录后）验证即可；完整的真机验收在 P1-5（P1-4 写的 `docs/redesign-v5/p1-acceptance.md`，第 8 条对应其中的 M-30）。

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| §2.2 `router.ts` 手写，`useRoute`、`navigate`、`<Link>`、popstate | Task 2 |
| §2.2 数字 id 只接受 `^[1-9]\d{0,14}$`，复用并导出 `deepLink.ts` 的正则 | Task 1（`ID_PATTERN`） |
| §2.2 用户 id 非空、≤128、无 NUL，使用时 `encodeURIComponent` | Task 1（`isUserId`、`playerPath`） |
| §2.2 所有路由不以 `/api`、`/auth`、`/link` 开头；SPA 不接管这三个前缀 | Task 1（`isAppPath`、`parseRoute`）、Task 2（`navigate` 整页跳转、`Link` 交给浏览器） |
| §2.2 不用 hash：只改 hash 的 popstate 被忽略 | Task 2（`onPopState`，`router.test.tsx`「ignores a popstate that only moved the hash」） |
| §2.2 路由压的每一条历史都带 `{edg: 1, …}` | Task 2（`navigate`、`bootRouter`；`idx` 是契约 §8 第 2 条） |
| §2.2 两个 id 对不上时以 `record.subject.id` 为准 replace | Task 6（`CaseRoute`，route-pages「when the two ids disagree」） |
| §2.2 `/cases/:id` 别名：先查当事人再 replace | Task 6（`CaseRoute`，route-pages「/cases/:id is an alias」） |
| 桌面上案件 404：抽屉里的 NotFound，焦点由 Modal 交给标题，✕ 回 `/` | Task 6（`RouteNotice`，route-pages「on a desktop, a case that is gone」） |
| §2.2 404 文案：案件「链接里的案件不存在了。」/500「打不开链接里的案件，稍后再试。」、约局「找不到这局，链接可能写错了。」、选手「找不到这位选手。」、其他「这页不存在」+「回大厅」 | Task 1（`routeCopy.ts`）、Task 3（`NotFound`）、Task 4、Task 5、Task 6 |
| §2.2 404 次要操作「看约局历史」「看信誉榜」 | 推迟到 P3-6（契约 §8 第 3 条）；`NotFound` 的 `actions` prop 已备好 |
| §2.3 `/?session=N` → `/sessions/N` + 其余参数（replace `/` 再 push） | Task 6（`useEntryTarget`；deep-link「?session= opens the session」追加 `pathname`） |
| §2.3 `/?case=N` → 一次 GET 后落到 `/players/<subject>/cases/N?utm=…`，置顶、`vc--focus`、聚焦、`block:'center'`，不请求第二次 | Task 5（置顶）、Task 6（`landing`、`pinned`；deep-link、p8「opens once」） |
| §2.3 非法 id 剥参数停在 `/`、不发请求 | Task 6（`stripEntryParams`；deep-link「ignores anything but a positive id」追加 `pathname`） |
| §2.3 404/500 停在 `/`，大厅上原文案 | Task 6（`linkMissing` → `LinkMissingNotice`） |
| §2.3 `?linked=discord` 只剥 `linked`，`?onboarding=1` 先弹首登再跳 | Task 6（`stripEntryParams` 留下 `onboarding`；`blocked` getter；p8「waits for the first-run dialog」） |
| §2.4 首页 DOM 顺序、全页唯一 /约局/ 标题 | Task 6（`RouteView` 插在 `</main>` 之后；PageBar/NotFound 不加 /约局/ 标题；`board`、`my-score-line` 原样通过） |
| §3.5 `SessionDetailDialog` 可选 `variant`，签名不变；page 的 PageBar；被取消的局照常显示 | Task 4 |
| §3.8 `PlayerDetail` 可选 `variant`、`pinnedRecord`，现有 props 保留 | Task 5 |
| §3.8 案件聚焦是**移动**不是复制，全页一个 `#case-N`，保留 `focusRecordId`、`vc--focus`、`block:'center'` | Task 5（`pickPinned`、`renderCase`、列表 `filter`；route-pages、deep-link、p8 追加断言） |
| §3.8 eyebrow「案件 #N · 类型 · 状态」/「案件 #N · 处理中」（档位 b） | Task 1（`pinnedCaseEyebrow` 单测）、Task 5（渲染） |
| §3.8 / §9 P1-1 公开选手页 ScoreGauge 用 neutral | Task 5（`tone={isSelf ? 'tier' : 'neutral'}`，route-pages「shows everyone the score」） |
| §6.4 page 形态：不 portal、不 inert、不困焦点，打开时焦点到标题，Esc 不关 | Modal 已实现（P0-2）；Task 4、Task 5 负责加载后聚焦标题 |
| §6.4 「P1-1 的路由状态也在同一个 `afterEach` 里重置」 | Task 2（`tests/dom/setup.ts`） |
| §2.1 品牌用 `<Link>`，点击不再整页刷新 | Task 6（Header；route-pages「the brand link goes home in place」） |
| §9 P1-1 测试：`route.test.ts`（非法 id、未知路径、三个前缀、只改 hash、id 不一致） | Task 1（`route.test.ts`）、Task 2（hash，`router.test.tsx`）、Task 6（id 不一致，`route-pages.test.tsx`） |
| 契约 §4.5 `DESKTOP_MEDIA_QUERY` 与 CSS 断点一致 | Task 1（`route.test.ts`「is the CSS desktop breakpoint」） |
| 契约 §4.9 大厅被盖住时保持挂载，只加 `hidden`；`.app__main[hidden]` | Task 6（App、`app.css`） |
| 契约 §4.9 `StatementDialog` 叠在选手页上，判完 `playerRefreshKey` +1 | Task 5（`refreshKey`）、Task 6（App `onDecided`） |
| 契约 §6.4 首屏请求集合不变、不新增 act 警告 | 收尾（`app-refresh` 原样通过；警告仍 3 条） |
| 契约 §6.5 只有 `router.ts` 用 `history.*` | Task 6（source-hygiene 追加） |
| 契约 §7 风险表里 P1-1 相关的锁定断言 | Task 2、4、5、6 的「确认通过」步骤逐个列出 |
