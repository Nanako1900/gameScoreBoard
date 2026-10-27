# P1-3 登录回跳与 ResumeHint 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 访客在只读页面（约局详情、选手页、案件页）点「登录」「登录后报名」或某个回答时，先把回跳意图写进 `sessionStorage['edg.return']`，登录回来后回到原页面；如果点的是某个回答，就用 `ResumeHint` 问「你登录前点的是「来」，确认一下？」并把那个按钮用金色圈出来，**用户再点一次才提交**（「A link never writes」，整个回跳过程没有任何非 GET 请求）。

**Architecture:** 纯模块 `src/lib/loginReturnShape.ts` 负责 `edg.return` 的序列化和全部校验（路径必须过路由白名单、id 必须是正整数、30 分钟有效、intent 不合法只丢 intent），DOM 模块 `src/lib/loginReturn.ts` 负责 sessionStorage 的读一次即删；`LoginLink` 是唯一的登录入口（仍是顶层 `<a>` 整页跳转，只在 onClick 里先写 storage）；新 hook `src/lib/useLoginResume.ts` 在 `useEntryTarget` 里作为入口目标的第二个来源（首登引导之后、旧深链优先；首登门控在 effect 里现读：P1-1 的 `blocked` 本来就是 `() => boolean`，原样传入），跳回原地址并把 intent 交给 `RouteView` → `SessionDetailDialog.resumeRsvp`；`SessionDetailDialog` 给访客渲染 `VisitorRsvpPrompt`（三个带 intent 的登录链接），给登录回来的人渲染 `ResumeHint` 和 `RsvpControls suggested`（被圈出的按钮用 `aria-describedby` 指向那句提问，读屏聚焦到按钮时也能听到）。

**Tech Stack:** React 18 + TypeScript + Vite；vitest（unit：`vitest.config.ts`，node 环境；dom：`vitest.dom.config.ts`，jsdom，setup `tests/dom/setup.ts`）；@testing-library/react + user-event。

**依赖:** P1 共享契约：本目录 `contract.md`（4.1 `routes.ts`、4.2 `router.ts`、4.9 `useEntryTarget`/`RouteView`、4.11 本 PR 的接口、6.1 测试约定）；上游 P1-1（`routes.ts`、`router.ts`、`useEntryTarget.ts`、`RouteView.tsx`、SessionDetailDialog 的 page/drawer）和 P1-2（`tests/dom/history.ts`、Modal 的 `historyKey`、`setup.ts` 的 async 版本）必须已经在上游分支上。

**分支:** `claude/p1-3-login-return`，从 `claude/p1-2-history` 的 HEAD 开（`git switch -c claude/p1-3-login-return claude/p1-2-history`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR。

---

## 文件结构

所有路径相对仓库根目录。行号只作参考，**一律按引用的锚点文字定位**。

| 文件 | 新/改 | 职责 |
|---|---|---|
| `src/lib/constants.ts` | 改（末尾追加 `// --- P1-3 ---` 小节） | `LOGIN_RETURN_TTL_MS`（30 分钟）、`RETURN_PATH_MAX`（512） |
| `src/lib/loginReturnShape.ts` | 新（纯） | `LOGIN_RETURN_KEY`、`LoginIntent`、`LoginReturn`、`serializeLoginReturn`、`parseLoginReturn`（全部校验规则）、`hasLegacyTarget`（这次启动是不是旧深链进来的）、`resumeRsvpFor`（intent 是不是关于这一局） |
| `src/lib/loginReturn.ts` | 新（DOM） | `saveLoginReturn`、`takeLoginReturn`（读、校验、总是删）、`clearLoginReturn`；所有 storage 访问都包 try/catch |
| `src/lib/useLoginResume.ts` | 新（DOM hook） | 登录回来后消费 `edg.return`：已登录、首登引导之后（`isBlocked()` 在 effect 里现读，外加地址里的 `?onboarding=1`）、没有旧深链时 `navigate(path)`（push）并保存 intent；离开那一局后丢掉 intent |
| `src/lib/useEntryTarget.ts` | 改（P1-1 建） | 解构参数里补上 `me`，函数体第一行调用 `useLoginResume({ ready, me, isBlocked: blocked })`，结果里追加 `resume`、`clearResume` |
| `src/components/LoginLink.tsx` | 新 | 唯一的登录入口：`<a href={AUTH_LOGIN_URL}>`，onClick 先 `saveLoginReturn(intent, returnTo)`，不 `preventDefault` |
| `src/components/ResumeHint.tsx` + `resume-hint.css` | 新 | 「你登录前点的是「来」，确认一下？」+「不用了」，`role="status"`；导出 `RESUME_HINT_TEXT_ID`（提问那段 `<p>` 的 id） |
| `src/components/VisitorRsvpPrompt.tsx` + `visitor-rsvp.css` | 新 | 访客的报名区：`role="group" aria-label="登录后报名"`，一句说明、可见标签「登录后报名：」、三个带 intent 的 `LoginLink`（来/待定/不来）、一个「用 Nanako 账号登录」 |
| `src/components/SessionDetailDialog.tsx` | 改（P1-3 分区：props 接口、`{canRsvp && (` 那一段、文件内 `RsvpControls`） | 新可选 props `resumeRsvp`、`onResumeDone`；访客分支；`ResumeHint`；`RsvpControls` 的 `suggested`（类名 + `aria-describedby`，文件内小工具 `describedBy`） |
| `src/components/session-detail.css` | 改（末尾追加） | `.sdt__rsvp-btn--suggested` 金色圈 |
| `src/components/SessionsPanel.tsx` + `sessions-panel.css` | 改（见「对契约的补充」第 4 条） | 访客在大厅约局行上看到「登录后报名」链接，回跳到 `/sessions/:id` |
| `src/components/Header.tsx` | 改（只改「登录」那个 `<a>` 和对应 import） | 换成 `<LoginLink className="btn btn--gold">登录</LoginLink>` |
| `src/components/WelcomeCard.tsx` | 改（只改登录 `<a>` 和 import） | 换成 `<LoginLink className="btn btn--gold" href={loginUrl}>` |
| `src/components/RouteView.tsx` | 改（P1-1 建） | 新可选 props `resume`、`onResumeDone`，只透传给同一 `sessionId` 的 `SessionDetailDialog` |
| `src/App.tsx` | 改（P1-3 分区） | `handleLogout` 里 `clearAllDrafts()` 后加 `clearLoginReturn()`；从 `useEntryTarget` 取 `resume`、`clearResume` 交给 `<RouteView>` |
| `tests/unit/login-return.test.ts` | 新 | `loginReturnShape` 的每条规则 |
| `tests/dom/login-return.test.tsx` | 新 | LoginLink 写入、ResumeHint/访客区、大厅行、完整的「只读页 → 登录 → 回到原页、有提示、没有 POST」 |

不碰：`Modal.tsx`、`modalStack.ts`、`router.ts`、`routes.ts`、`deepLink.ts`、`PlayerDetail.tsx`、`tests/dom/history.ts`（P1-2 已导出 `preventNavigation`）、`tests/dom/setup.ts`（P1-2 的 `sessionStorage.clear()` 已经覆盖 `edg.return`）、任何 `worker/`、`server/`、`shared/`、`docs/` 文件。

---

### Task 0：开工核对

**Files:** 无改动（只读核对）。

- [ ] **Step 1：确认上游分支、工作区干净，开分支**

```bash
git status --short                      # 期望：无输出
git branch --list claude/p1-2-history   # 期望：列出这个分支
git switch -c claude/p1-3-login-return claude/p1-2-history
git log --oneline -1                    # 记下起点 commit
```

上游分支不存在或工作区不干净 → 停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 2：核对本 PR 消费的上游接口都在**

```bash
grep -nE "export function (currentPath|navigate|useLocation|useRoute|resetRouterForTests)\b" src/lib/router.ts
# 期望 5 行
grep -nE "export (function (parseRoute|isAppPath|sessionPath)|const HOME_PATH)\b" src/lib/routes.ts
# 期望 4 行
grep -nE "readonly (ready|me|blocked|dismissLinkMissing)\b" src/lib/useEntryTarget.ts
# 期望 4 行：readonly ready: boolean; / readonly me: User | null; / readonly blocked: () => boolean; / readonly dismissLinkMissing: () => void;
#（plan-P1-1.md「对契约的补充」第 1 条：blocked 是 () => boolean，在 effect 里现读 onboardingAsked.current）
grep -nF "export function useEntryTarget({ ready, blocked, onPinned }: EntryTargetInput): EntryTargetResult {" src/lib/useEntryTarget.ts
# 期望 1 行（解构参数，解构里没有 me——Task 5 Step 4 把 me 补进去）
grep -nF "  return { linkMissing, dismissLinkMissing };" src/lib/useEntryTarget.ts
# 期望 1 行
grep -nF "const entryBlocked = useCallback(() => onboardingOpen || onboardingAsked.current, [onboardingOpen]);" src/App.tsx
# 期望 1 行
grep -nE "useEntryTarget\(|'onboarding'|askedAfterLink = " src/App.tsx
# 期望：useEntryTarget( 的行号大于 ?onboarding=1 effect 和 askedAfterLink effect 的行号（P1-1 Task 6 就是这么排的，App 里有注释
# 「declared after the onboarding effects」）。不是也不停：useLoginResume 另看地址里的 ?onboarding=1（Task 5 Step 3 说明），只在 PR 描述里记一句。
grep -nF "  const { linkMissing, dismissLinkMissing } = useEntryTarget({" src/App.tsx
# 期望 1 行
grep -n "<SessionDetailDialog" src/components/RouteView.tsx
# 期望 1 行（case 'session'，page 和 drawer 共用这一处）
grep -nF "            onChanged={props.onChanged}" src/components/RouteView.tsx
# 期望 2 行（`case 'session'` 和 `case 'player'` 各一处，第一处在 <SessionDetailDialog 里；RouteView 用 props.xxx 写法，不解构）
grep -nF "  onOpenStatement: (record: RecordItem) => void;" src/components/RouteView.tsx
# 期望 1 行（RouteViewProps 的最后一个成员）
grep -n "<RouteView" src/App.tsx
# 期望 1 行
grep -nE "export (async )?function (drainHistoryTraversals|preventNavigation)" tests/dom/history.ts
# 期望 2 行（都由 P1-2 提供；本 PR 不改这个文件）
grep -n "sessionStorage.clear()" tests/dom/setup.ts
# 期望 1 行
grep -n "// --- P1-2 ---" src/lib/constants.ts
# 期望 1 行，且它后面就是文件末尾的 P1-2 常量
grep -n "variant" src/components/SessionDetailDialog.tsx | head -3
# 期望：P1-1 已加的 variant prop
```

除了 `useEntryTarget(` 的位置（见上面的注释），任何一条对不上（尤其 `useEntryTarget` 的结果里没有 `dismissLinkMissing`、`router.ts` 少了导出、`history.ts` 没有 `preventNavigation`）→ 停下报告，不要自己改 P1-1/P1-2 的接口和文件。P1-1 执行者只在写法上有细微偏差（比如参数改成 `(input: EntryTargetInput)`）时，按 Task 5 Step 4 末尾的备选写法做，接口不变。

- [ ] **Step 3：跑基线，记下数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c "not wrapped in act"
```

期望：typecheck 通过；unit **28 个文件**全过（契约第 1 节「+ P1-2」一行），记下用例数为 **U0**；dom **23 个文件**全过，记下用例数为 **D0**（跨 PR 合成实测 U0 = 369、D0 = 283）；`act(...)` 警告条数记为 **A0**（基线是 `onboarding-roles` 的 3 条，P1-1/P1-2 不应增加）。文件数对不上就停下。

不跑 `npm run test:pg`、`npm run test:server`（嵌入式 Postgres，交给 CI）。

---

### Task 1：`edg.return` 的纯校验模块

**Files:**
- Modify: `src/lib/constants.ts`（末尾追加）
- Create: `src/lib/loginReturnShape.ts`
- Test: `tests/unit/login-return.test.ts`

- [ ] **Step 1：写失败的测试**

新建 `tests/unit/login-return.test.ts`，完整内容：

```ts
// P1-3: edg.return — the rules a saved login return must pass before it moves
// anyone anywhere (spec §4.1 登录回跳, P1 contract 4.11).

import { describe, expect, it } from 'vitest';
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from '../../src/lib/constants';
import {
  LOGIN_RETURN_KEY,
  hasLegacyTarget,
  parseLoginReturn,
  resumeRsvpFor,
  serializeLoginReturn,
} from '../../src/lib/loginReturnShape';
import type { LoginIntent } from '../../src/lib/loginReturnShape';

const NOW = 1_761_500_000_000;
const GOING: LoginIntent = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

/** A stored value as JSON text, with any field overridden or removed (undefined). */
function stored(fields: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, path: '/sessions/5', savedAt: NOW, ...fields });
}

describe('serializeLoginReturn', () => {
  it('writes the contract shape, with or without an intent', () => {
    expect(JSON.parse(serializeLoginReturn('/sessions/5', GOING, NOW))).toEqual({
      v: 1,
      path: '/sessions/5',
      savedAt: NOW,
      intent: { kind: 'rsvp', sessionId: 5, rsvp: 'going' },
    });
    expect(JSON.parse(serializeLoginReturn('/players/p', undefined, NOW))).toEqual({
      v: 1,
      path: '/players/p',
      savedAt: NOW,
    });
  });

  it('round-trips through parseLoginReturn', () => {
    expect(parseLoginReturn(serializeLoginReturn('/sessions/5?utm=dc', GOING, NOW), NOW)).toEqual({
      v: 1,
      path: '/sessions/5?utm=dc',
      savedAt: NOW,
      intent: GOING,
    });
  });

  it('uses the edg.return key', () => {
    expect(LOGIN_RETURN_KEY).toBe('edg.return');
  });
});

describe('parseLoginReturn — the whole value', () => {
  it('nothing stored, or not JSON, or not an object → null', () => {
    expect(parseLoginReturn(null, NOW)).toBeNull();
    expect(parseLoginReturn('', NOW)).toBeNull();
    expect(parseLoginReturn('{"v":1,', NOW)).toBeNull();
    expect(parseLoginReturn('"/sessions/5"', NOW)).toBeNull();
    expect(parseLoginReturn('null', NOW)).toBeNull();
    expect(parseLoginReturn('[1]', NOW)).toBeNull();
  });

  it('another version → null', () => {
    expect(parseLoginReturn(stored({ v: 2 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ v: '1' }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ v: undefined }), NOW)).toBeNull();
  });

  it('older than the TTL, from the future, or without a finite savedAt → null', () => {
    expect(parseLoginReturn(stored({ savedAt: NOW - LOGIN_RETURN_TTL_MS }), NOW)).not.toBeNull();
    expect(parseLoginReturn(stored({ savedAt: NOW - LOGIN_RETURN_TTL_MS - 1 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: NOW + 1 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: '1761500000000' }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: null }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: undefined }), NOW)).toBeNull();
  });
});

describe('parseLoginReturn — the path is the router whitelist', () => {
  it.each([
    '/sessions/5',
    '/sessions/5?utm=dc',
    '/players/p',
    '/players/a%2Fb',
    '/players/p/cases/7',
    '/cases/7',
  ])('keeps a page the router knows: %s', (path) => {
    expect(parseLoginReturn(stored({ path }), NOW)?.path).toBe(path);
  });

  it.each([
    ['not a string', 5],
    ['missing', undefined],
    ['empty', ''],
    ['relative', 'sessions/5'],
    ['protocol-relative', '//evil.example/sessions/5'],
    ['absolute URL', 'https://evil.example/sessions/5'],
    ['backslash', '/\\evil.example'],
    ['hash', '/sessions/5#x'],
    ['the lobby', '/'],
    ['the lobby with a query', '/?session=5'],
    ['an unknown page', '/xyz'],
    ['not a positive id', '/sessions/0'],
    ['a leading zero', '/sessions/07'],
    ['not a number', '/sessions/abc'],
    ['an exponent', '/cases/1e3'],
    ['a later-phase page', '/sessions/new'],
    ['the API', '/api/me'],
    ['the login itself', '/auth/login'],
    ['the Discord link flow', '/link/discord'],
    ['too long', `/players/${'x'.repeat(RETURN_PATH_MAX)}`],
  ])('drops %s', (_label, path) => {
    expect(parseLoginReturn(stored({ path }), NOW)).toBeNull();
  });

  it('a path of exactly RETURN_PATH_MAX characters is still fine', () => {
    const prefix = '/sessions/5?q=';
    const path = prefix + 'x'.repeat(RETURN_PATH_MAX - prefix.length);
    expect(path).toHaveLength(RETURN_PATH_MAX);
    expect(parseLoginReturn(stored({ path }), NOW)?.path).toBe(path);
  });
});

describe('parseLoginReturn — a bad intent is dropped on its own', () => {
  it('keeps a matching rsvp intent for each answer', () => {
    for (const rsvp of ['going', 'maybe', 'out'] as const) {
      const intent = { kind: 'rsvp', sessionId: 5, rsvp };
      expect(parseLoginReturn(stored({ intent }), NOW)?.intent).toEqual(intent);
    }
  });

  it.each([
    ['another kind', { kind: 'create', sessionId: 5, rsvp: 'going' }],
    ['invited is not an answer', { kind: 'rsvp', sessionId: 5, rsvp: 'invited' }],
    ['an unknown answer', { kind: 'rsvp', sessionId: 5, rsvp: 'yes' }],
    ['another session', { kind: 'rsvp', sessionId: 6, rsvp: 'going' }],
    ['the id as a string', { kind: 'rsvp', sessionId: '5', rsvp: 'going' }],
    ['not an object', 'rsvp:going'],
    ['null', null],
  ])('%s → the path stays, the intent goes', (_label, intent) => {
    const parsed = parseLoginReturn(stored({ intent }), NOW);
    expect(parsed).toEqual({ v: 1, path: '/sessions/5', savedAt: NOW });
    expect(parsed).not.toHaveProperty('intent');
  });

  it('an rsvp intent on a page that is not a session is dropped', () => {
    const parsed = parseLoginReturn(stored({ path: '/players/p', intent: GOING }), NOW);
    expect(parsed).toEqual({ v: 1, path: '/players/p', savedAt: NOW });
  });

  it('extra fields never come back out', () => {
    const parsed = parseLoginReturn(
      stored({ intent: { ...GOING, auto: true }, next: 'https://evil.example' }),
      NOW,
    );
    expect(parsed).toEqual({ v: 1, path: '/sessions/5', savedAt: NOW, intent: GOING });
  });
});

describe('resumeRsvpFor', () => {
  it('only answers for the session the intent was about', () => {
    expect(resumeRsvpFor(GOING, 5)).toBe('going');
    expect(resumeRsvpFor(GOING, 6)).toBeNull();
    expect(resumeRsvpFor(null, 5)).toBeNull();
    expect(resumeRsvpFor(undefined, 5)).toBeNull();
  });
});

describe('hasLegacyTarget', () => {
  it('only an old link on the lobby counts', () => {
    expect(hasLegacyTarget('/', '?case=7')).toBe(true);
    expect(hasLegacyTarget('/', '?session=3&utm=dc')).toBe(true);
    expect(hasLegacyTarget('/', '?case=abc')).toBe(false);
    expect(hasLegacyTarget('/', '?onboarding=1')).toBe(false);
    expect(hasLegacyTarget('/', '')).toBe(false);
    expect(hasLegacyTarget('/sessions/5', '?session=3')).toBe(false);
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/login-return.test.ts
```

期望：FAIL，报错是找不到 `../../src/lib/loginReturnShape`（或 `LOGIN_RETURN_TTL_MS` 不存在）。

- [ ] **Step 3：追加常量**

在 `src/lib/constants.ts` **文件末尾**（`// --- P1-2 ---` 小节之后）追加：

```ts

// --- P1-3 ---
/** edg.return older than this is ignored: a login that took longer is not the same visit. */
export const LOGIN_RETURN_TTL_MS = 30 * 60 * 1000;
/** edg.return.path upper bound. */
export const RETURN_PATH_MAX = 512;
```

- [ ] **Step 4：写纯模块**

新建 `src/lib/loginReturnShape.ts`，完整内容（纯模块：不碰 `window`/`document`/storage，不导入 React；`routes.ts`、`deepLink.ts`、`constants.ts`、`@shared/attendance` 都是纯的）：

```ts
// edg.return (spec §4.1 登录回跳, P1 contract 4.11): where a visitor was, and
// what they clicked, right before the top-level jump to the login page. Pure —
// no window, no storage — so tests/unit can hold every rule. The value only
// ever leads to a question on screen: a saved intent never writes anything.

import { isSelfRsvp } from '@shared/attendance';
import type { SelfRsvp } from '@shared/attendance';
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from './constants';
import { readDeepLink } from './deepLink';
import { HOME_PATH, isAppPath, parseRoute } from './routes';
import type { Route } from './routes';

export const LOGIN_RETURN_KEY = 'edg.return';

const VERSION = 1;

/** The one intent P1 knows: an answer clicked on a session before logging in. */
export type LoginIntent = { readonly kind: 'rsvp'; readonly sessionId: number; readonly rsvp: SelfRsvp };

export interface LoginReturn {
  readonly v: 1;
  /** pathname + search, never a hash. */
  readonly path: string;
  readonly savedAt: number;
  readonly intent?: LoginIntent;
}

/** The route a stored path leads to, or null when it is not a page worth coming back to. */
function returnRoute(path: unknown): Route | null {
  if (typeof path !== 'string' || path.length > RETURN_PATH_MAX) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('\\') || path.includes('#')) return null;
  const pathname = path.split('?')[0];
  if (!isAppPath(pathname)) return null;
  const route = parseRoute(pathname);
  return route.name === 'home' || route.name === 'notFound' ? null : route;
}

function isFresh(savedAt: unknown, now: number): savedAt is number {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return false;
  const age = now - savedAt;
  return age >= 0 && age <= LOGIN_RETURN_TTL_MS;
}

/** A well-formed intent that matches the page it was saved on; anything else is dropped. */
function readIntent(raw: unknown, route: Route): LoginIntent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, sessionId, rsvp } = raw as Record<string, unknown>;
  if (kind !== 'rsvp' || typeof rsvp !== 'string' || !isSelfRsvp(rsvp)) return null;
  if (route.name !== 'session' || sessionId !== route.sessionId) return null;
  return { kind: 'rsvp', sessionId: route.sessionId, rsvp };
}

export function serializeLoginReturn(path: string, intent: LoginIntent | undefined, now: number): string {
  const base: LoginReturn = { v: VERSION, path, savedAt: now };
  return JSON.stringify(intent ? { ...base, intent } : base);
}

/** Validates everything; a bad or stale value is null, a bad intent alone is dropped. Never throws. */
export function parseLoginReturn(raw: string | null, now: number): LoginReturn | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, path, savedAt, intent } = parsed as Record<string, unknown>;
  if (v !== VERSION || !isFresh(savedAt, now)) return null;
  const route = returnRoute(path);
  if (route === null || typeof path !== 'string') return null;
  const kept = readIntent(intent, route);
  return kept ? { v: VERSION, path, savedAt, intent: kept } : { v: VERSION, path, savedAt };
}

/** An old ?case= / ?session= link opened this load: it wins over edg.return (contract 4.11). */
export function hasLegacyTarget(pathname: string, search: string): boolean {
  return pathname === HOME_PATH && readDeepLink(search) !== null;
}

/** The answer to point at on session `sessionId`, if the saved intent was about it. */
export function resumeRsvpFor(intent: LoginIntent | null | undefined, sessionId: number): SelfRsvp | null {
  return intent && intent.sessionId === sessionId ? intent.rsvp : null;
}
```

- [ ] **Step 5：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/login-return.test.ts
```

期望：PASS，**45** 个用例全过。

- [ ] **Step 6：提交**

```bash
git add src/lib/constants.ts src/lib/loginReturnShape.ts tests/unit/login-return.test.ts
git commit -m "feat: 新增 edg.return 登录回跳的纯校验模块（P1-3）"
```

---

### Task 2：`LoginLink`——登录前记下回跳地址

**Files:**
- Create: `src/lib/loginReturn.ts`、`src/components/LoginLink.tsx`
- Modify: `src/components/Header.tsx`、`src/components/WelcomeCard.tsx`
- Test: `tests/dom/login-return.test.tsx`（新建：公共脚手架 + 第一个 describe）

- [ ] **Step 1：确认测试辅助 `preventNavigation` 已由 P1-2 提供**

`tests/dom/history.ts` 是 P1-2 建的测试辅助（`plan-P1-2.md` Task 2 Step 1），里面已经导出契约 6.1 的 `preventNavigation(): () => void`：在 `document` 上挂冒泡阶段的 `click` 监听，对 `a[href]` 调 `preventDefault()`，React 根节点上的 `onClick`（`saveLoginReturn`）照常先跑。Task 0 Step 2 已经 grep 过它；本 PR **不改**这个文件。万一没有（P1-2 没做完）→ 停下报告，不在本 PR 里补。

- [ ] **Step 2：写失败的测试**

新建 `tests/dom/login-return.test.tsx`。先写公共脚手架（后面 Task 3–5 的 describe 都追加在这个文件**末尾**，脚手架里的 import 和辅助函数一次写全，`tsconfig.json` 的 `noUnusedLocals` 是 false，暂时没用到的 import 不影响 typecheck）：

```tsx
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { LOGIN_RETURN_TTL_MS } from '../../src/lib/constants';
import { LOGIN_RETURN_KEY, serializeLoginReturn } from '../../src/lib/loginReturnShape';
import type { LoginIntent } from '../../src/lib/loginReturnShape';
import { navigate, resetRouterForTests } from '../../src/lib/router';
import type { RecordItem, SessionDetail, User } from '../../src/types';
import { preventNavigation } from './history';

// P1-3 (spec §3.5, §4.1 登录回跳): a visitor on a read-only page clicks 来, logs
// in, and lands back on that page with a question — "A link never writes", so
// nothing is posted until they click again.

interface Call {
  method: string;
  path: string;
}

const HOUR = 3_600_000;
const QUESTION = '你登录前点的是「来」，确认一下？';
const SUGGESTED = 'sdt__rsvp-btn--suggested';
const GOING: LoginIntent = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

const ME: User = {
  id: 'p',
  username: '选手',
  oauth_username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

const CASE: RecordItem = {
  id: 7,
  subject: { id: 'q', username: '当事人', avatar_url: null },
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

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function session(id: number, myRsvp: SessionDetail['my_rsvp']): SessionDetail {
  return {
    id,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-01 00:00:00',
    counts: { invited: 0, going: 1, maybe: 0, out: 0 },
    my_rsvp: myRsvp,
    players: [],
  };
}

interface Stub {
  calls: Call[];
  /** Back from the login page: /api/me answers with ME from now on. */
  signIn: () => void;
}

interface StubOptions {
  /** GET /api/sessions?scope=upcoming. */
  listed?: SessionDetail[];
  /** my_rsvp on session 5 once signed in. */
  myRsvp?: SessionDetail['my_rsvp'];
}

/** The app's reads — a visitor until signIn() — and an RSVP that answers like the server. */
function stubApi(options: StubOptions = {}): Stub {
  const calls: Call[] = [];
  let me: User | null = null;
  const routes: Record<string, () => Response> = {
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
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: options.listed ?? [] }),
    'GET /api/sessions/3': () => json(200, { session: session(3, null), records: [] }),
    'GET /api/sessions/5': () =>
      json(200, { session: session(5, me ? (options.myRsvp ?? null) : null), records: [] }),
    'GET /api/records/7': () => json(200, { record: CASE }),
    'GET /api/users/q': () =>
      json(200, {
        user: { id: 'q', username: '当事人', avatar_url: null, is_participant: true, is_judge: false, score: 88, created_at: 'x' },
        records: [CASE],
        history: [],
      }),
    'POST /api/sessions/5/rsvp': () => json(200, { session: session(5, 'going') }),
    'POST /auth/logout': () => json(200, { ok: true }),
  };
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
  return {
    calls,
    signIn: () => {
      me = ME;
    },
  };
}

const writes = (calls: readonly Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

const stored = (): unknown => {
  const raw = window.sessionStorage.getItem(LOGIN_RETURN_KEY);
  return raw === null ? null : JSON.parse(raw);
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/**
 * What the OAuth round trip leaves behind (P1 contract 6.1): a fresh load of
 * `url` (the API lands on '/'), signed in, with edg.return as given.
 */
function backFromLogin(stub: Stub, raw: string | null, url = '/'): RenderResult {
  resetRouterForTests();
  if (raw !== null) window.sessionStorage.setItem(LOGIN_RETURN_KEY, raw);
  if (url !== '/') window.history.replaceState(null, '', url);
  stub.signIn();
  return render(<App />);
}

// jsdom cannot follow a clicked <a href>; LoginLink's own click handler still runs.
let allowNavigation: () => void = () => {};
beforeEach(() => {
  allowNavigation = preventNavigation();
});
afterEach(() => {
  allowNavigation();
  vi.unstubAllGlobals();
});
```

紧接着在文件末尾追加本任务的 describe：

```tsx
describe('LoginLink — every way into the login page', () => {
  it('the header’s 登录 remembers the page it was clicked on', async () => {
    stubApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/sessions/5');
    render(<App />);
    const login = await screen.findByRole('link', { name: '登录' });
    expect(login).toHaveAttribute('href', '/auth/login');
    await user.click(login);
    expect(stored()).toEqual({ v: 1, path: '/sessions/5', savedAt: expect.any(Number) });
  });

  it('the lobby’s 用 Nanako 账号登录 forgets an older one (nothing to come back to)', async () => {
    stubApi();
    const user = userEvent.setup();
    window.sessionStorage.setItem(LOGIN_RETURN_KEY, serializeLoginReturn('/sessions/5', GOING, Date.now()));
    render(<App />);
    const login = await screen.findByRole('link', { name: '用 Nanako 账号登录' });
    expect(login).toHaveAttribute('href', '/auth/login');
    await user.click(login);
    expect(stored()).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
});
```

- [ ] **Step 3：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx
```

期望：2 个用例都 FAIL——第一个 `expected null to deeply equal { v: 1, path: '/sessions/5', … }`（Header 的登录还是普通 `<a>`，没写 storage）；第二个 `expected { … } to be null`（旧值没被清掉）。

- [ ] **Step 4：写 storage 模块**

新建 `src/lib/loginReturn.ts`，完整内容：

```ts
// sessionStorage side of edg.return (P1 contract 4.11). The login is a
// top-level navigation away and back in the same tab, which sessionStorage
// survives; another tab never sees it. Storage may be missing or blocked
// (private mode): every access is guarded and nothing here throws.

import { currentPath } from './router';
import { LOGIN_RETURN_KEY, parseLoginReturn, serializeLoginReturn } from './loginReturnShape';
import type { LoginIntent, LoginReturn } from './loginReturnShape';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // merely touching storage throws when the browser blocks it
  }
}

/**
 * Remembers where to come back to (default: this page) before the jump to the
 * login page. A page not worth coming back to — the lobby, an unknown path —
 * clears an older value instead. False only when storage is unusable.
 */
export function saveLoginReturn(intent?: LoginIntent, returnTo: string = currentPath()): boolean {
  const store = storage();
  if (!store) return false;
  const now = Date.now();
  const checked = parseLoginReturn(serializeLoginReturn(returnTo, intent, now), now);
  try {
    if (checked === null) {
      store.removeItem(LOGIN_RETURN_KEY);
    } else {
      store.setItem(LOGIN_RETURN_KEY, serializeLoginReturn(checked.path, checked.intent, now));
    }
    return true;
  } catch {
    return false; // full or blocked: the login still works, it just lands on the lobby
  }
}

/** Reads, validates and always removes: a saved return is used at most once. */
export function takeLoginReturn(now: number = Date.now()): LoginReturn | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(LOGIN_RETURN_KEY);
    if (raw === null) return null;
    store.removeItem(LOGIN_RETURN_KEY);
    return parseLoginReturn(raw, now);
  } catch {
    return null;
  }
}

/** Logging out: whoever signs in next on this tab must not be sent to someone else's page. */
export function clearLoginReturn(): void {
  try {
    storage()?.removeItem(LOGIN_RETURN_KEY);
  } catch {
    /* nothing stored, or nothing reachable — either way nothing to clear */
  }
}
```

- [ ] **Step 5：写 `LoginLink`**

新建 `src/components/LoginLink.tsx`，完整内容：

```tsx
import type { ReactNode } from 'react';
import { AUTH_LOGIN_URL } from '../api';
import { saveLoginReturn } from '../lib/loginReturn';
import type { LoginIntent } from '../lib/loginReturnShape';

interface LoginLinkProps {
  className?: string;
  /** Default AUTH_LOGIN_URL. */
  href?: string;
  /** What the visitor clicked — shown back to them after login, never sent. */
  intent?: LoginIntent;
  /** Where to come back to; default the current page (router's currentPath()). */
  returnTo?: string;
  /** Accessible name when the visible text alone is ambiguous (one per list row). */
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * Every way into the login page. Still a plain top-level <a> (analysis §6):
 * the click only writes edg.return first, it never prevents the navigation.
 */
export function LoginLink({
  className,
  href = AUTH_LOGIN_URL,
  intent,
  returnTo,
  ariaLabel,
  children,
}: LoginLinkProps): JSX.Element {
  const remember = (): void => {
    saveLoginReturn(intent, returnTo);
  };
  return (
    <a className={className} href={href} aria-label={ariaLabel} onClick={remember}>
      {children}
    </a>
  );
}
```

- [ ] **Step 6：Header 的「登录」换成 `LoginLink`**

`src/components/Header.tsx`：

删掉这一行 import（`AUTH_LOGIN_URL` 在 Header 里只被「登录」用到；先 `grep -n "AUTH_LOGIN_URL" src/components/Header.tsx` 确认只有 import 和这一处）：

```tsx
import { AUTH_LOGIN_URL } from '../api';
```

在锚点 `import { Avatar } from './Avatar';` 下面加一行：

```tsx
import { LoginLink } from './LoginLink';
```

把锚点 `href={AUTH_LOGIN_URL}` 所在的元素，改前：

```tsx
            <a className="btn btn--gold" href={AUTH_LOGIN_URL}>
              登录
            </a>
```

改后：

```tsx
            <LoginLink className="btn btn--gold">登录</LoginLink>
```

（P1-1 改的品牌 `<Link to="/" className="hdr__brand" …>` 不动。）

- [ ] **Step 7：WelcomeCard 的登录换成 `LoginLink`**

`src/components/WelcomeCard.tsx`：

在锚点 `import { useState } from 'react';` 下面加一行：

```tsx
import { LoginLink } from './LoginLink';
```

改前：

```tsx
        <a className="btn btn--gold" href={loginUrl}>
          用 Nanako 账号登录
        </a>
```

改后（`href`、文字、类名都不变，`board.test.tsx:286` 断言 `href="/auth/login"` 和名字「用 Nanako 账号登录」）：

```tsx
        <LoginLink className="btn btn--gold" href={loginUrl}>
          用 Nanako 账号登录
        </LoginLink>
```

`WelcomeCardProps` 的 `loginUrl` 注释「a top-level navigation, never fetch」保持不变。

- [ ] **Step 8：跑测试，确认通过**

```bash
npm run typecheck
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx tests/dom/board.test.tsx tests/dom/discord-link.test.tsx
```

期望：typecheck 通过；`login-return` 2 个用例 PASS；`board`、`discord-link` 原样全过。

- [ ] **Step 9：提交**

```bash
git add src/lib/loginReturn.ts src/components/LoginLink.tsx src/components/Header.tsx src/components/WelcomeCard.tsx tests/dom/login-return.test.tsx
git commit -m "feat: 新增 LoginLink，登录前记下回跳地址（P1-3）"
```

---

### Task 3：约局详情的访客报名区和 `ResumeHint`

**Files:**
- Create: `src/components/ResumeHint.tsx`、`src/components/resume-hint.css`、`src/components/VisitorRsvpPrompt.tsx`、`src/components/visitor-rsvp.css`
- Modify: `src/components/SessionDetailDialog.tsx`、`src/components/session-detail.css`（末尾追加）
- Test: `tests/dom/login-return.test.tsx`（末尾追加一个 describe）

- [ ] **Step 1：写失败的测试**

在 `tests/dom/login-return.test.tsx` **文件末尾**追加：

```tsx
describe('the session page — ResumeHint and the visitor prompt', () => {
  function renderDetail(resumeRsvp: 'going' | null, myRsvp: SessionDetail['my_rsvp'] = null) {
    const stub = stubApi({ myRsvp });
    stub.signIn();
    const onResumeDone = vi.fn();
    render(
      <SessionDetailDialog
        sessionId={5}
        me={ME}
        onClose={() => {}}
        onChanged={() => {}}
        resumeRsvp={resumeRsvp}
        onResumeDone={onResumeDone}
      />,
    );
    return { stub, onResumeDone };
  }

  it('asks about the earlier click and rings that button — without answering', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const hint = (await screen.findByText(QUESTION)).closest('.resume-hint');
    expect(hint).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '来' })).toHaveClass(SUGGESTED);
    expect(screen.getByRole('button', { name: '来' })).toHaveAttribute('aria-pressed', 'false');
    // Focusing the ringed button reads the question too (a status region inserted with its text may go unannounced).
    expect(screen.getByRole('button', { name: '来' })).toHaveAccessibleDescription(QUESTION);
    expect(screen.getByRole('button', { name: '待定' })).not.toHaveClass(SUGGESTED);
    expect(screen.getByRole('button', { name: '待定' })).not.toHaveAttribute('aria-describedby');
    expect(screen.getAllByRole('button', { name: '来' })).toHaveLength(1);
    await settle();
    expect(onResumeDone).not.toHaveBeenCalled();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('不用了 forgets the click without answering, and focus lands on the title', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const user = userEvent.setup();
    await screen.findByText(QUESTION);
    await user.click(screen.getByRole('button', { name: '不用了' }));
    expect(onResumeDone).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '周五五排' }));
    expect(writes(stub.calls)).toEqual([]);
  });

  it('clicking the ringed 来 again is what answers — once', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const user = userEvent.setup();
    await screen.findByText(QUESTION);
    await user.click(screen.getByRole('button', { name: '来' }));
    await waitFor(() => expect(onResumeDone).toHaveBeenCalled());
    expect(writes(stub.calls)).toEqual([{ method: 'POST', path: '/api/sessions/5/rsvp' }]);
  });

  it('already that answer: nothing to ask, and the hint is done', async () => {
    const { stub, onResumeDone } = renderDetail('going', 'going');
    expect(await screen.findByRole('button', { name: '来' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(onResumeDone).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '来' })).not.toHaveClass(SUGGESTED);
    expect(writes(stub.calls)).toEqual([]);
  });

  it('a visitor gets 登录后报名: three login links that remember the answer, and the login button', async () => {
    stubApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/sessions/5');
    render(<SessionDetailDialog sessionId={5} me={null} onClose={() => {}} onChanged={() => {}} />);
    const prompt = await screen.findByRole('group', { name: '登录后报名' });
    expect(within(prompt).getByText('登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。')).toBeInTheDocument();
    for (const name of ['来', '待定', '不来', '用 Nanako 账号登录']) {
      expect(within(prompt).getByRole('link', { name })).toHaveAttribute('href', '/auth/login');
    }
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '我的报名' })).not.toBeInTheDocument();

    await user.click(within(prompt).getByRole('link', { name: '待定' }));
    expect(stored()).toEqual({
      v: 1,
      path: '/sessions/5',
      savedAt: expect.any(Number),
      intent: { kind: 'rsvp', sessionId: 5, rsvp: 'maybe' },
    });
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx
```

期望：新加的 5 个用例 FAIL（前四个找不到「你登录前点的是「来」，确认一下？」或 `onResumeDone` 没被调用；第五个找不到名为「登录后报名」的 group）；Task 2 的 2 个仍然 PASS。

- [ ] **Step 3：写 `ResumeHint`**

新建 `src/components/ResumeHint.tsx`：

```tsx
import { RSVP_LABEL } from '@shared/attendance';
import type { SelfRsvp } from '@shared/attendance';
import './resume-hint.css';

/** The question's id: the ringed button points at it (aria-describedby), so focusing it reads the question. */
export const RESUME_HINT_TEXT_ID = 'resume-hint-text';

interface ResumeHintProps {
  /** The answer the visitor clicked before logging in. */
  rsvp: SelfRsvp;
  /** 不用了: forget the earlier click. */
  onDismiss: () => void;
}

/**
 * Back from the login page: ask, never write (spec §3.5, "A link never writes").
 * The button it points at is ringed in RsvpControls; only clicking it again answers.
 */
export function ResumeHint({ rsvp, onDismiss }: ResumeHintProps): JSX.Element {
  return (
    <div className="resume-hint" role="status">
      <p id={RESUME_HINT_TEXT_ID} className="resume-hint__text">
        {`你登录前点的是「${RSVP_LABEL[rsvp]}」，确认一下？`}
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        不用了
      </button>
    </div>
  );
}
```

新建 `src/components/resume-hint.css`：

```css
/* P1-3 — ResumeHint: the question asked after login, right above 来 / 待定 / 不来. */
.resume-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--gold-dim);
  border-radius: var(--r-md);
  background: color-mix(in oklab, var(--gold) 8%, transparent);
}

.resume-hint__text {
  flex: 1;
  min-width: 12em;
  font-size: var(--fs-sm);
  color: var(--text);
}
```

- [ ] **Step 4：写 `VisitorRsvpPrompt`**

新建 `src/components/VisitorRsvpPrompt.tsx`：

```tsx
import { RSVP_LABEL, SELF_RSVPS } from '@shared/attendance';
import { LoginLink } from './LoginLink';
import './visitor-rsvp.css';

interface VisitorRsvpPromptProps {
  sessionId: number;
}

/**
 * A signed-out visitor's RSVP area (spec §3.5 未登录访客). Each answer is a
 * login link that remembers what was clicked, so the page can ask about it
 * after login (ResumeHint) — it is never submitted on the visitor's behalf.
 */
export function VisitorRsvpPrompt({ sessionId }: VisitorRsvpPromptProps): JSX.Element {
  return (
    <div className="vrp" role="group" aria-label="登录后报名">
      <p className="vrp__line">登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。</p>
      <div className="vrp__choices">
        <span className="vrp__label" aria-hidden="true">
          登录后报名：
        </span>
        {SELF_RSVPS.map((rsvp) => (
          <LoginLink
            key={rsvp}
            className="btn btn--ghost btn--sm vrp__choice"
            intent={{ kind: 'rsvp', sessionId, rsvp }}
          >
            {RSVP_LABEL[rsvp]}
          </LoginLink>
        ))}
      </div>
      <LoginLink className="btn btn--gold btn--sm vrp__login">用 Nanako 账号登录</LoginLink>
    </div>
  );
}
```

新建 `src/components/visitor-rsvp.css`（按钮用现成的 `.btn--sm`，coarse 指针下 40px 由 `theme.css` 负责，这里不写 `min-height`，免得压过 theme 的触控尺寸）：

```css
/* P1-3 — VisitorRsvpPrompt: the signed-out visitor's 登录后报名 area in a session. */
.vrp {
  display: grid;
  gap: 0.5rem;
  justify-items: start;
}

.vrp__line {
  font-size: var(--fs-sm);
  color: var(--muted);
}

.vrp__choices {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.vrp__label {
  font-size: var(--fs-sm);
  color: var(--muted);
}
```

- [ ] **Step 5：改 `SessionDetailDialog.tsx`（P1-3 分区）**

5a. import：在锚点 `import { RescheduleSheet } from './RescheduleSheet';` 下面加两行：

```tsx
import { RESUME_HINT_TEXT_ID, ResumeHint } from './ResumeHint';
import { VisitorRsvpPrompt } from './VisitorRsvpPrompt';
```

（`SelfRsvp` 已经从 `@shared/attendance` 导入，`useEffect` 已经从 `react` 导入，不用再加。）

5b. props 接口：在 `interface SessionDetailDialogProps { … }` 的**最后一个成员之后**（P1-1 加的 `variant?: 'center' | 'page' | 'drawer';` 之后）、右花括号之前，加：

```tsx
  /** P1-3: the answer clicked before logging in — only pointed at, never submitted. */
  resumeRsvp?: SelfRsvp | null;
  /** P1-3: the question above was answered, dismissed, or does not apply here. */
  onResumeDone?: () => void;
```

5c. 解构参数：在 `export function SessionDetailDialog({` 的参数列表**末尾**（P1-1 加的 `variant = 'center',` 之后）、`}: SessionDetailDialogProps)` 之前，加：

```tsx
  resumeRsvp = null,
  onResumeDone,
```

5d. 派生值和处理函数：在锚点

```tsx
  const canRollCall = canManage && session?.status === 'open' && started;
```

这一行**下面**插入：

```tsx
  // P1-3: a visitor answers through the login page; back here, the click is asked about.
  const canVisitorRsvp = me === null && session?.status === 'open' && !started;
  const resumeAsk: SelfRsvp | null =
    resumeRsvp !== null && canRsvp && session?.my_rsvp !== resumeRsvp ? resumeRsvp : null;

  // Nothing to ask (already that answer, the organizer, started…): forget the click.
  useEffect(() => {
    if (resumeRsvp !== null && session !== null && resumeAsk === null) onResumeDone?.();
  }, [resumeRsvp, session, resumeAsk, onResumeDone]);

  /** An answer clicked here, with or without the hint: the hint is done either way. */
  const answerHere = async (next: SelfRsvp): Promise<void> => {
    await answer(next);
    if (resumeRsvp !== null) onResumeDone?.();
  };

  const dismissResume = (): void => {
    onResumeDone?.();
    // The hint (and its focused button) leaves: focus the title, not <body>.
    titleRef.current?.focus();
  };
```

（这段在组件顶层、任何 `return` 之前，hooks 顺序固定。`answer` 内部的 `mutate` 自己吞掉错误并显示 `role="alert"`，所以 `await answer(next)` 不会抛，成功、失败后都会调 `onResumeDone`，符合契约 4.11。）

5e. RSVP 区：锚点 `{canRsvp && (` 那一段，改前：

```tsx
            {canRsvp && (
              <RsvpControls session={session} busy={busy} onAnswer={(r) => void answer(r)} />
            )}
```

改后：

```tsx
            {resumeAsk && <ResumeHint rsvp={resumeAsk} onDismiss={dismissResume} />}
            {canRsvp && (
              <RsvpControls
                session={session}
                busy={busy}
                suggested={resumeAsk ?? undefined}
                onAnswer={(r) => void answerHere(r)}
              />
            )}
            {canVisitorRsvp && <VisitorRsvpPrompt sessionId={session.id} />}
```

5f. 文件内的 `RsvpControls`。先在锚点 `const FULL_NOTICE_ID = 'session-detail-full';` 这一行**下面**加一个小工具（两个说明 id 可能同时成立：满员时被圈的正好是「来」）：

```tsx

/** aria-describedby from the ids that apply, or undefined when none does. */
function describedBy(...ids: (string | null)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== null);
  return present.length > 0 ? present.join(' ') : undefined;
}
```

接口改前：

```tsx
interface RsvpControlsProps {
  session: SessionDetail;
  busy: boolean;
  onAnswer: (rsvp: SelfRsvp) => void;
}
```

改后：

```tsx
interface RsvpControlsProps {
  session: SessionDetail;
  busy: boolean;
  /** P1-3: ringed in gold — the answer clicked before login. Only clicking it answers. */
  suggested?: SelfRsvp;
  onAnswer: (rsvp: SelfRsvp) => void;
}
```

函数签名改前：

```tsx
function RsvpControls({ session, busy, onAnswer }: RsvpControlsProps): JSX.Element {
```

改后：

```tsx
function RsvpControls({ session, busy, suggested, onAnswer }: RsvpControlsProps): JSX.Element {
```

按钮的 `className` 改前：

```tsx
              className={`btn btn--sm${session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'}`}
```

改后（可访问名仍是「来」「待定」「不来」，选中态仍只靠 `aria-pressed`）：

```tsx
              className={`btn btn--sm${session.my_rsvp === r ? ' btn--gold' : ' btn--ghost'}${
                suggested === r ? ' sdt__rsvp-btn--suggested' : ''
              }`}
```

同一个按钮的 `aria-describedby` 改前：

```tsx
              aria-describedby={shut && notice ? FULL_NOTICE_ID : undefined}
```

改后（满员说明照旧；被圈出的按钮再指向那句提问。`organizer-actions.test.tsx:402` 断言满员时「来」的说明是「来 2/2 满了，可以先报待定。」——那里没有 `suggested`，输出不变）：

```tsx
              aria-describedby={describedBy(
                shut && notice ? FULL_NOTICE_ID : null,
                suggested === r ? RESUME_HINT_TEXT_ID : null,
              )}
```

5g. 在 `src/components/session-detail.css` **文件末尾**（P1-1 追加的内容之后）追加。用 `border-color` + `box-shadow` 画圈，**不用 `outline`**——`outline` 会压过 `theme.css` 的 `:focus-visible` 焦点环：

```css
/* P1-3 — the answer clicked before login, ringed in gold until it is clicked again.
   The selected state stays aria-pressed; this is only a pointer. */
.sdt__rsvp-btn--suggested {
  border-color: var(--gold);
  box-shadow: 0 0 0 1px var(--gold);
}

@media (hover: hover) {
  /* Restate the ring: .btn:hover would otherwise grey the edge out. */
  .sdt__rsvp-btn--suggested:hover {
    border-color: var(--gold);
  }
}
```

- [ ] **Step 6：跑测试，确认通过**

```bash
npm run typecheck
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx tests/dom/session-rsvp-moved.test.tsx tests/dom/organizer-actions.test.tsx tests/dom/route-pages.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

期望：`login-return` 7 个用例 PASS；`session-rsvp-moved`（详情面板只有一个「来」、409 原文）、`organizer-actions`（含 `:402` 满员时「来」的无障碍说明）、`route-pages` 原样全过；`css-conventions` 全过。`RsvpControls` 改完约 40 行（< 50）。

- [ ] **Step 7：提交**

```bash
git add src/components/ResumeHint.tsx src/components/resume-hint.css src/components/VisitorRsvpPrompt.tsx src/components/visitor-rsvp.css src/components/SessionDetailDialog.tsx src/components/session-detail.css tests/dom/login-return.test.tsx
git commit -m "feat: 约局详情加访客「登录后报名」和登录回来后的 ResumeHint（P1-3）"
```

---

### Task 4：大厅约局行的「登录后报名」

**Files:**
- Modify: `src/components/SessionsPanel.tsx`、`src/components/sessions-panel.css`（末尾追加）
- Test: `tests/dom/login-return.test.tsx`（末尾追加一个 describe）

- [ ] **Step 1：写失败的测试**

在 `tests/dom/login-return.test.tsx` **文件末尾**追加：

```tsx
describe('a lobby row for a visitor', () => {
  it('登录后报名 comes back to that session', async () => {
    stubApi({ listed: [session(5, null)] });
    const user = userEvent.setup();
    render(<App />);
    const link = await screen.findByRole('link', { name: '登录后报名 周五五排' });
    expect(link).toHaveAttribute('href', '/auth/login');
    await user.click(link);
    expect(stored()).toEqual({ v: 1, path: '/sessions/5', savedAt: expect.any(Number) });
    expect(window.location.pathname).toBe('/');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx
```

期望：新用例 FAIL（找不到名为「登录后报名 周五五排」的 link）；其余 7 个 PASS。

- [ ] **Step 3：改 `SessionsPanel.tsx`**

import：在锚点 `import { formatWhen, parseTimestamp } from '../lib/time';` 下面加：

```tsx
import { sessionPath } from '../lib/routes';
```

在锚点 `import { Avatar } from './Avatar';` 下面加：

```tsx
import { LoginLink } from './LoginLink';
```

`SessionRow` 里，在锚点

```tsx
  const canRsvp =
    me !== null && session.status === 'open' && !started && session.organizer.id !== me.id;
```

下面插入：

```tsx
  // P1-3: a visitor signs in first and comes back to this session's page.
  const canAskLogin = me === null && session.status === 'open' && !started;
```

`SessionRow` 的 return 里，`{canRsvp && ( … )}` 那一块（`<div className="srow__rsvp" …>`）结束之后、`</li>` 之前插入。锚点是这一块的最后四行（在文件里只出现一次）：

```tsx
          ))}
        </div>
      )}
    </li>
```

在 `      )}` 和 `    </li>` 之间插入：

```tsx

      {canAskLogin && (
        <LoginLink
          className="srow__login"
          returnTo={sessionPath(session.id)}
          ariaLabel={`登录后报名 ${session.title}`}
        >
          登录后报名
        </LoginLink>
      )}
```

- [ ] **Step 4：追加样式**

在 `src/components/sessions-panel.css` **文件末尾**追加（只用 `max-width: 600px` 断点，hover 包在 `@media (hover: hover)`；`.srow__login` 不在 `theme.css` 的 coarse 清单里，自己写 `min-height: 40px` 不冲突）：

```css
/* P1-3 — a visitor's 登录后报名 on a row: a login link that comes back to this session. */
.srow__login {
  flex: none;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.8rem;
  margin-right: 0.4rem;
  border-radius: var(--r-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--gold);
  border: 1px solid var(--gold-dim);
}

@media (hover: hover) {
  .srow__login:hover {
    color: var(--text);
    border-color: var(--gold);
  }
}

@media (max-width: 600px) {
  .srow__login {
    margin: 0 0.4rem 0.4rem;
  }
}
```

- [ ] **Step 5：跑测试，确认通过**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx tests/dom/session-rsvp-moved.test.tsx tests/dom/my-score-line.test.tsx tests/dom/board.test.tsx tests/dom/app-refresh.test.tsx
npx vitest run --config vitest.config.ts tests/unit/css-conventions.test.ts
```

期望：`login-return` 8 个 PASS；其余原样全过（登录用户看不到这条链接；访客大厅的首屏请求集合不变）。

- [ ] **Step 6：提交**

```bash
git add src/components/SessionsPanel.tsx src/components/sessions-panel.css tests/dom/login-return.test.tsx
git commit -m "feat: 大厅约局行给访客「登录后报名」（P1-3）"
```

---

### Task 5：登录回来后回到原页面，退出登录清掉回跳记录

**Files:**
- Create: `src/lib/useLoginResume.ts`
- Modify: `src/lib/useEntryTarget.ts`、`src/components/RouteView.tsx`、`src/App.tsx`
- Test: `tests/dom/login-return.test.tsx`（末尾追加一个 describe）

- [ ] **Step 1：写失败的测试**

在 `tests/dom/login-return.test.tsx` **文件末尾**追加：

```tsx
describe('登录回跳 — back from the login page', () => {
  it('a visitor clicks 来, logs in, is back on the page and asked — nothing is written', async () => {
    const stub = stubApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/sessions/5');
    const { unmount } = render(<App />);

    const prompt = await screen.findByRole('group', { name: '登录后报名' });
    expect(within(prompt).queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    await user.click(within(prompt).getByRole('link', { name: '来' }));
    expect(stored()).toEqual({
      v: 1,
      path: '/sessions/5',
      savedAt: expect.any(Number),
      intent: { kind: 'rsvp', sessionId: 5, rsvp: 'going' },
    });

    unmount();
    backFromLogin(stub, null);

    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sessions/5');
    expect(screen.getByRole('button', { name: '来' })).toHaveClass(SUGGESTED);
    expect(screen.getByRole('button', { name: '来' })).toHaveAttribute('aria-pressed', 'false');
    expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY)).toBeNull();
    await settle();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('the first-run dialog goes first, then the way back', async () => {
    const stub = stubApi();
    const user = userEvent.setup();
    backFromLogin(stub, serializeLoginReturn('/sessions/5', GOING, Date.now()), '/?onboarding=1');

    expect(await screen.findByRole('radiogroup', { name: '选择身份' })).toBeInTheDocument();
    await settle();
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sessions/5');
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each([
    ['/?case=7', '/players/q/cases/7'],
    ['/?session=3', '/sessions/3'],
  ])('an old link (%s) wins: edg.return is dropped, not followed', async (url, landing) => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/sessions/5', GOING, Date.now()), url);

    await waitFor(() => expect(window.location.pathname).toBe(landing));
    await settle();
    expect(stub.calls.some((c) => c.path === '/api/sessions/5')).toBe(false);
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY)).toBeNull();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('a stale or tampered value goes nowhere and is removed', async () => {
    const values = [
      serializeLoginReturn('/sessions/5', GOING, Date.now() - LOGIN_RETURN_TTL_MS - 1),
      JSON.stringify({ v: 1, path: '//evil.example/sessions/5', savedAt: Date.now() }),
      JSON.stringify({ v: 1, path: '/sessions/abc', savedAt: Date.now() }),
      JSON.stringify({ v: 1, path: '/auth/login', savedAt: Date.now() }),
      '{not json',
    ];
    for (const raw of values) {
      const stub = stubApi();
      const { unmount } = backFromLogin(stub, raw);
      await screen.findByRole('heading', { name: /约局/ });
      await settle();
      expect(window.location.pathname, raw).toBe('/');
      expect(stub.calls.some((c) => c.path === '/api/sessions/5'), raw).toBe(false);
      expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY), raw).toBeNull();
      expect(writes(stub.calls), raw).toEqual([]);
      unmount();
    }
  });

  it('a visitor load neither follows nor removes it', async () => {
    const raw = serializeLoginReturn('/sessions/5', GOING, Date.now());
    window.sessionStorage.setItem(LOGIN_RETURN_KEY, raw);
    stubApi();
    render(<App />);
    await screen.findByRole('heading', { name: /约局/ });
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY)).toBe(raw);
  });

  it('once the session page is left, the question is not asked again', async () => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/sessions/5', GOING, Date.now()));
    expect(await screen.findByText(QUESTION)).toBeInTheDocument();

    act(() => navigate('/'));
    await waitFor(() => expect(screen.queryByText(QUESTION)).not.toBeInTheDocument());
    act(() => navigate('/sessions/5'));
    expect(await screen.findByRole('button', { name: '来' })).not.toHaveClass(SUGGESTED);
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('logging out forgets it', async () => {
    // jsdom cannot reload (handleLogout ends with location.reload()) and says so on console.error.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const stub = stubApi();
      const user = userEvent.setup();
      backFromLogin(stub, null);
      await screen.findByRole('heading', { name: /约局/ });
      window.sessionStorage.setItem(LOGIN_RETURN_KEY, serializeLoginReturn('/sessions/5', GOING, Date.now()));
      await user.click(screen.getByRole('button', { name: /选手/ }));
      await user.click(screen.getByRole('button', { name: '退出登录' }));
      await waitFor(() => expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY)).toBeNull());
      expect(quiet.mock.calls.every(([first]) => String(first).includes('Not implemented: navigation'))).toBe(true);
    } finally {
      quiet.mockRestore();
    }
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx
```

期望：新 describe 的 8 个用例（`it.each` 展开成 2 个）里 **7 个 FAIL**（没有跳回 `/sessions/5`、storage 没被删、退出登录没清），只有「a visitor load neither follows nor removes it」PASS（它锁的是「访客不读不删」，实现前后都应成立）；前面 8 个仍然 PASS。

- [ ] **Step 3：写 `useLoginResume`**

新建 `src/lib/useLoginResume.ts`，完整内容：

```ts
// P1-3: the second source of an entry target (P1 contract 4.9 / 4.11). Back
// from the login page, edg.return says where the visitor was and what they
// clicked: go back there (push), and keep the click as a question for the
// session page to ask. It never answers on anyone's behalf.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { takeLoginReturn } from './loginReturn';
import { hasLegacyTarget } from './loginReturnShape';
import type { LoginIntent } from './loginReturnShape';
import { currentPath, navigate, useLocation } from './router';
import type { Route } from './routes';

interface LoginResumeInput {
  /** Core data is in. */
  readonly ready: boolean;
  readonly me: User | null;
  /**
   * The first-run dialog goes first (spec §4.1 step 2) — the old links' gate.
   * Read inside the effect, not at render: the flag it reads is set by an
   * effect of the same commit.
   */
  readonly isBlocked: () => boolean;
}

export interface LoginResume {
  readonly resume: LoginIntent | null;
  readonly clearResume: () => void;
}

/** ?onboarding=1 is still in the address until App's onboarding effect has read it. */
function onboardingPending(search: string): boolean {
  return new URLSearchParams(search).get('onboarding') === '1';
}

function isOnSession(route: Route, intent: LoginIntent): boolean {
  return route.name === 'session' && route.sessionId === intent.sessionId;
}

export function useLoginResume({ ready, me, isBlocked }: LoginResumeInput): LoginResume {
  const location = useLocation();
  // Read at the first render, before the entry effect strips ?case= / ?session=: such a link wins.
  const [superseded] = useState(() => hasLegacyTarget(location.pathname, location.search));
  const [resume, setResume] = useState<LoginIntent | null>(null);
  const taken = useRef(false);
  const arrived = useRef(false);
  const pending = onboardingPending(location.search);

  // Once per load, signed in, after the first-run dialog. A visitor never reads
  // or removes it (the TTL does); a signed-in load always removes it.
  useEffect(() => {
    if (!ready || me === null || pending || taken.current || isBlocked()) return;
    taken.current = true;
    const saved = takeLoginReturn();
    if (saved === null || superseded) return;
    if (saved.path !== currentPath()) navigate(saved.path);
    if (saved.intent) setResume(saved.intent);
  }, [ready, me, pending, isBlocked, superseded]);

  // The question belongs to that session's page: once left, it is not asked again.
  useEffect(() => {
    if (resume === null) {
      arrived.current = false;
    } else if (isOnSession(location.route, resume)) {
      arrived.current = true;
    } else if (arrived.current) {
      setResume(null);
    }
  }, [location.route, resume]);

  const clearResume = useCallback((): void => setResume(null), []);
  return { resume, clearResume };
}
```

说明：
- **首登门控在 effect 里现读（`isBlocked()`），不在渲染时算**：`onboardingAsked.current` 是 App 的 onboarding effect 在同一次提交里置上的，渲染时读到的还是旧值。P1-1 的 `blocked` 就是 `() => boolean`（`plan-P1-1.md`「对契约的补充」第 1 条，App 传的是 `entryBlocked` 这个 `useCallback`），Step 4 原样传进来。
- **另看地址里的 `?onboarding=1`（`pending`）**：App 的 onboarding effect 读掉这个参数之前一律等着，所以「有首登引导就先走引导」（spec §4.1 第 2 步）不依赖 `useEntryTarget(` 在 App 里排在 onboarding effect 前面还是后面。
- `superseded` 在**第一次渲染**时从路由地址读出（`useEntryTarget` 的 mount effect 剥掉 `?case=`/`?session=` 之前），所以调用放在 `useEntryTarget` 的渲染阶段任意位置都对；Step 4 放第一行只是为了好找。
- 先 `navigate` 再 `setResume`：P1-2 在静默后退期间（比如 Esc 关掉首登对话框）会把导航排队，这期间 `resume` 已有值但路由还在 `/`，第二个 effect 只在「到过那一局之后又离开」时才清，不会误清。
- `isBlocked` 是 App 的 `entryBlocked`（`useCallback`，只随 `onboardingOpen` 变），所以这个 effect 不会每次渲染都重跑；即使重跑也有 `taken` 挡着，不发请求。

- [ ] **Step 4：`useEntryTarget` 接上（P1-3 追加）**

`src/lib/useEntryTarget.ts`：

import 区追加：

```ts
import { useLoginResume } from './useLoginResume';
import type { LoginIntent } from './loginReturnShape';
```

`interface EntryTargetResult` 里，在锚点 `readonly dismissLinkMissing: () => void;` 下面加：

```ts
  /** P1-3: the answer clicked before login, for the session page to ask about (never sent). */
  readonly resume: LoginIntent | null;
  readonly clearResume: () => void;
```

函数签名和函数体第一行，改前（P1-1 的写法，Task 0 Step 2 已核对）：

```ts
export function useEntryTarget({ ready, blocked, onPinned }: EntryTargetInput): EntryTargetResult {
```

改后（解构里补上 `me`——`EntryTargetInput` 里本来就有这个字段、App 本来就在传，P1-1 只是用不到它；第一行调用 `useLoginResume`，在 P1-1 的任何 `useState`/`useRef`/`useEffect` 之前）：

```ts
export function useEntryTarget({ ready, me, blocked, onPinned }: EntryTargetInput): EntryTargetResult {
  // P1-3: edg.return, the second source of an entry target (contract 4.11).
  const { resume, clearResume } = useLoginResume({ ready, me, isBlocked: blocked });
```

（P1-1 执行者若把参数写成了 `(input: EntryTargetInput)`，这一行改写成 `useLoginResume({ ready: input.ready, me: input.me, isBlocked: input.blocked })`，别的不变。）

函数最后一行，改前：

```ts
  return { linkMissing, dismissLinkMissing };
```

改后：

```ts
  return { linkMissing, dismissLinkMissing, resume, clearResume };
```

- [ ] **Step 5：`RouteView` 透传（P1-3 追加）**

`src/components/RouteView.tsx`：

import 区追加：

```tsx
import { resumeRsvpFor } from '../lib/loginReturnShape';
import type { LoginIntent } from '../lib/loginReturnShape';
```

`interface RouteViewProps` 里，在锚点 `onOpenStatement: (record: RecordItem) => void;` 下面加：

```tsx
  /** P1-3: from useEntryTarget — only handed to the session it is about. */
  resume?: LoginIntent | null;
  onResumeDone?: () => void;
```

RouteView 在组件里用 `props.xxx` 写法（P1-1 的 `onChanged={props.onChanged}`），不解构，所以下面直接写 `props.resume`、`props.onResumeDone`（`resumeRsvpFor` 的第一个参数接受 `undefined`）。

`case 'session'` 里唯一的 `<SessionDetailDialog`（page 和 drawer 共用这一处），改前：

```tsx
            sessionId={route.sessionId}
            me={props.me}
            onClose={close}
            onChanged={props.onChanged}
          />
```

改后：

```tsx
            sessionId={route.sessionId}
            me={props.me}
            onClose={close}
            onChanged={props.onChanged}
            resumeRsvp={resumeRsvpFor(props.resume, route.sessionId)}
            onResumeDone={props.onResumeDone}
          />
```

其他路由（player、playerCase、case、notFound）不传。

- [ ] **Step 6：`App.tsx` 接上（P1-3 分区）**

6a. import：在锚点 `import { clearAllDrafts } from './lib/drafts';` 下面加：

```tsx
import { clearLoginReturn } from './lib/loginReturn';
```

6b. `handleLogout`：改前：

```tsx
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
    window.location.reload();
```

改后：

```tsx
    // Drafts are this person's: whoever signs in next on this device must not find them.
    clearAllDrafts();
    clearLoginReturn();
    window.location.reload();
```

6c. 取 `useEntryTarget` 的结果：锚点 `  const { linkMissing, dismissLinkMissing } = useEntryTarget({`（P1-1 的写法，Task 0 Step 2 已核对）改成：

```tsx
  const { linkMissing, dismissLinkMissing, resume, clearResume } = useEntryTarget({
```

（参数对象原样不动，里面已经有 `me` 和 `blocked: entryBlocked`。）

6d. `<RouteView`：在它已有的最后一个属性 `onOpenStatement={setStatementCase}` 下面、`/>` 之前加两行：

```tsx
        resume={resume}
        onResumeDone={clearResume}
```

改完 `wc -l src/App.tsx`，期望 ≤ 470（契约第 3 节；跨 PR 合成实测 434）。

- [ ] **Step 7：跑测试，确认通过**

```bash
npm run typecheck
npx vitest run --config vitest.dom.config.ts tests/dom/login-return.test.tsx tests/dom/deep-link.test.tsx tests/dom/p8-app.test.tsx tests/dom/discord-link.test.tsx tests/dom/back-closes-layer.test.tsx tests/dom/router.test.tsx tests/dom/route-pages.test.tsx tests/dom/app-refresh.test.tsx
```

期望：`login-return` **16 个用例全过**；其余原样全过（旧深链、首登引导优先、浮层与返回键、首屏请求集合都不受影响）。

如果「the first-run dialog goes first, then the way back」在 Esc 之前就跳到了 `/sessions/5`：先确认 `useLoginResume` 的 effect 条件里有 `pending` 和 `isBlocked()`（照 Step 3 原文）；再核对 App 里 `blocked` 是否就是契约 4.9 的 `onboardingOpen || onboardingAsked.current`。不要改测试。

- [ ] **Step 8：提交**

```bash
git add src/lib/useLoginResume.ts src/lib/useEntryTarget.ts src/components/RouteView.tsx src/App.tsx tests/dom/login-return.test.tsx
git commit -m "feat: 登录回来后回到原页面并提示，退出登录清掉回跳记录（P1-3）"
```

---

## 收尾

- [ ] **完整验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | tail -4
npx vitest run --config vitest.dom.config.ts 2>&1 | grep -c "not wrapped in act"
npm run build && ls dist && ls dist/assets | head
```

期望：
- typecheck 三个 tsconfig 全过。
- unit：**29 个文件**，用例数 = **U0 + 45**，全过。
- dom：**24 个文件**，用例数 = **D0 + 16**，全过（`login-return.test.tsx` 16 个 = Task 2 的 2 个 + Task 3 的 5 个 + Task 4 的 1 个 + Task 5 的 8 个；Task 5 里 `it.each` 的两行各算一个）。
- `act(...)` 警告条数 = **A0**（不新增）。
- build 通过；`dist/` 里只有 `index.html` 和 `assets/`（没有 `404.html`，P1-0 的检查）。
- 不跑 `test:pg`、`test:server`、`test:worker`（本 PR 不碰 `worker/`、`server/`）。

- [ ] **源码卫生**

```bash
grep -rn "console\.log" src/lib/loginReturn.ts src/lib/loginReturnShape.ts src/lib/useLoginResume.ts src/components/LoginLink.tsx src/components/ResumeHint.tsx src/components/VisitorRsvpPrompt.tsx   # 期望无输出
grep -rn 'history\.\(pushState\|replaceState\|back\|go\|forward\|state\)' src --include='*.ts' --include='*.tsx' | grep -v "src/lib/router.ts"   # 期望无输出（P1-1 的 source-hygiene 也会锁）；--include 的值必须加引号，zsh 下不加会报 no matches found
grep -rn 'href={AUTH_LOGIN_URL}' src   # 期望无输出：登录入口都走 LoginLink
grep -rn "AUTH_LOGIN_URL" src/components   # 期望只有 LoginLink.tsx（import、注释、默认值）和 WelcomeCard.tsx 的那行注释「AUTH_LOGIN_URL — a top-level navigation, never fetch.」
wc -l src/App.tsx src/components/SessionDetailDialog.tsx src/components/SessionsPanel.tsx   # 期望 App ≤ 470，其余 < 800
git status --short   # 期望无输出
git log --oneline claude/p1-2-history..HEAD   # 期望 5 个 commit，信息都是「feat: …（P1-3）」，没有任何署名行
```

- [ ] **手动核对（领队在浏览器里做，记进 P1-4 写的 `docs/redesign-v5/p1-acceptance.md` 第 2 节；代理不需要真机）**

用 `npm run dev:web`（或预览部署），Chrome DevTools 设备模式 375×812、DPR 3、触控：
1. 退出登录状态打开 `/sessions/<一个还没开始的局>` → 报名区是「登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。」、「登录后报名：」和三个链接，没有可点的报名按钮。
2. 点「来」→ 整页跳到登录页（地址栏真的离开了站点，不是弹窗）；DevTools → Application → Session Storage 里有 `edg.return`，值形如 `{"v":1,"path":"/sessions/N","savedAt":…,"intent":{"kind":"rsvp","sessionId":N,"rsvp":"going"}}`。
3. 登录回来（落在 `/` 或 `/?onboarding=1`）→ 新用户先看到首登对话框，关掉后才跳；地址回到 `/sessions/N`，出现「你登录前点的是「来」，确认一下？」，「来」有金色圈；`edg.return` 已经没了；Network 面板里**没有** `POST /api/sessions/N/rsvp`。
4. 点「不用了」→ 提示消失，焦点在局标题上，仍然没有 POST；或者点被圈出的「来」→ 只有一次 POST，提示消失。
5. 回跳后按一次返回键 → 回到大厅（P1-2 垫的 `/`）；再进这一局，不再提示。
6. 在大厅（未登录）点某个约局行的「登录后报名」→ 登录回来落在那一局，没有提示（这条不带 intent）。
7. 在 Session Storage 里手工把 `edg.return` 改成 `{"v":1,"path":"//evil.example","savedAt":<现在>}` 再刷新已登录的大厅 → 不跳转，值被删掉。
8. 1280×800 桌面：同样的流程，约局是右侧抽屉，提示和金色圈一样出现。

这 8 条已收进 P1-4 写的验收清单：1 → M-22，2、3 → M-23，4、5 → M-24，6 → M-26，7 → M-27，8 → D-08。领队按清单做一次即可，不用在这里重复。发现问题记进验收文档第 4 节「发现与修复」表；要改代码时按契约第 9 节从 `claude/p1-4-docs` 开 `claude/p1-5-device-fixes`。

---

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| §9 P1-3「登录回跳 `edg.return`」：顶层跳转前写 sessionStorage | Task 2（`saveLoginReturn`、`LoginLink`，Header/WelcomeCard 改用它） |
| §4.1 第 1 步「`path` 必须能被路由解析（相当于白名单），id 必须是正整数」 | Task 1（`parseLoginReturn` 用 `isAppPath` + `parseRoute`，拒绝 home/notFound；`/sessions/0`、`/sessions/07`、`/cases/1e3`、`//evil`、`\`、`#`、超长都有用例） |
| §4.1 第 1 步「intent 只能是 rsvp:going\|maybe\|out」（`create`/`none` 属于 P3/P4） | Task 1（`readIntent`；`create`、`invited`、别的局、字符串 id 都只丢 intent） |
| §4.1 第 2 步「有首登引导就先走引导」 | Task 5（`waiting = blocked \|\| ?onboarding=1`；dom 用例「the first-run dialog goes first」） |
| §4.1 第 3 步「跳到 path；intent 是 rsvp 就圈出按钮问确认一下，再点一次才写入」 | Task 3（`ResumeHint`、`suggested`）、Task 5（`navigate(path)`、`resume` 透传） |
| §4.1 第 4 步「读一次就删」+「没有任何 POST」 | Task 2（`takeLoginReturn` 总是删）、Task 5（dom 用例断言 `writes(calls)` 为空、storage 为 null） |
| §3.5「未登录访客：RSVP 区换成『登录后就能回…』[用 Nanako 账号登录]」 | Task 3（`VisitorRsvpPrompt`） |
| §3.5「登录回来后：你登录前点的是「来」，确认一下？……再点一次才提交」 | Task 3 |
| §3.1「[登录后报名] ← 点击后记下回跳意图」（任务要求的面板文字） | Task 3（详情里的「登录后报名：」组）、Task 4（大厅行的「登录后报名」链接） |
| §10 / analysis §6「登录是 `<a>` 顶层跳转，不用 fetch」 | Task 2（`LoginLink` 不 `preventDefault`；`href` 仍是 `AUTH_LOGIN_URL`） |
| CONTRACT「A link never writes」「Only a positive integer id is read」 | Task 1 的校验、Task 3/5 的「没有 POST」断言 |
| 契约 4.11「旧深链优先，有旧深链时登录回跳的值直接丢掉」 | Task 1（`hasLegacyTarget`）、Task 5（`?case=7`、`?session=3` 两个用例） |
| 契约 4.9「首登引导优先」 | Task 5（`isBlocked()` 在 effect 里现读 P1-1 的 `blocked: () => boolean` + 地址里的 `pending`；Task 0 Step 2 核对 P1-1 的签名） |
| 契约 4.11「访客不读不删，靠 TTL 过期」 | Task 5（用例「a visitor load neither follows nor removes it」） |
| 契约 4.11「退出登录时 `clearLoginReturn()`」 | Task 5 Step 6b + 用例「logging out forgets it」 |
| 契约 4.11「只在 `canRsvp` 且 `my_rsvp !== resumeRsvp` 时显示，否则直接 `onResumeDone()`」 | Task 3（`resumeAsk` + effect；用例「already that answer」） |
| 契约 4.11「成功或失败后都调 `onResumeDone`」 | Task 3（`answerHere`） |
| analysis §6「选中状态不能只靠颜色表示」、无障碍 | Task 3（选中仍只靠 `aria-pressed`；金色圈只是指引，被圈按钮 `aria-describedby` 指向提问，用例断言 `toHaveAccessibleDescription(QUESTION)`） |
| 契约 4.12 P1-3 常量 | Task 1 Step 3 |
| 契约 4.13 新类名 `.vrp`、`.resume-hint`、`.sdt__rsvp-btn--suggested` | Task 3（CSS 过 `css-conventions`） |
| 契约第 7 节风险：`board.test.tsx:278-287`、`session-rsvp-moved:72-90` | Task 2 Step 8、Task 3 Step 6、Task 4 Step 5 都跑这两个文件 |
| §11 第 3、16 条 | 不涉及（B1-1、P1-0） |

## 对契约的补充

以下是契约没写死、本计划写死了的东西（理由附后），请 P1-4 写进 PR 描述、机主过目：

1. **新文件 `src/lib/useLoginResume.ts`**：契约 4.11 说消费逻辑在 `useEntryTarget` 里「追加」。本计划把它放进独立 hook，`useEntryTarget` 只在第一行调用它、在结果里多返回两个字段。理由：`useEntryTarget` 是 P1-1 的文件，内部写法以 P1-1 实现为准，独立 hook 让 P1-3 只依赖 `EntryTargetInput` 的 `ready`/`me`/`blocked` 三个字段，改动面最小，也不让 `useEntryTarget` 本身变长（函数 < 50 行的规则）。
2. **`loginReturnShape.ts` 多导出两个纯函数**：`hasLegacyTarget(pathname, search)`（这次启动是不是 `/?case=`、`/?session=` 进来的——`useLoginResume` 在首次渲染时自己判断，不需要读 `useEntryTarget` 的内部变量）和 `resumeRsvpFor(intent, sessionId)`（`RouteView` 只把 intent 交给对应的那一局）。都在 `login-return.test.ts` 里有用例。
3. **`saveLoginReturn(intent?, returnTo?)` 和 `LoginLink` 的 `returnTo`、`ariaLabel`**：契约里 `saveLoginReturn` 只有 `intent` 一个参数、总用 `currentPath()`。大厅行的「登录后报名」是在 `/` 上点的，但要回到 `/sessions/:id`，所以加了可选的 `returnTo`（默认仍是 `currentPath()`，也照样过 `parseLoginReturn` 的白名单）。`ariaLabel` 让列表里每一行的链接名字不重复（「登录后报名 周五五排」，可见文字是名字的前缀，满足 label-in-name）。另外「当前在 `/` 且没有 intent 时删掉旧值」推广成「任何不值得回来的页面（`/`、未知路径）都删掉旧值」——同一条规则，白名单只写一遍。
4. **改了 `SessionsPanel.tsx` 和 `sessions-panel.css`（新类名 `.srow__login`）**：契约第 2 节 P1-3 的文件清单里没有它们。本任务明确要求「访客在面板里看到『登录后报名』」，spec §3.1 的线框也在约局卡片上画了「[登录后报名] ← 点击后记下回跳意图」。P3 把 SessionsPanel 换成 SessionCard 时，这条链接跟着迁过去即可。登录用户看不到它，`session-rsvp-moved` 的列表用例（登录用户）不受影响。
5. **`VisitorRsvpPrompt` 里有可见标签「登录后报名：」**（`aria-hidden`，因为 group 已经用 `aria-label="登录后报名"` 命名，避免读两遍），以及 `.vrp` 下的子元素类名 `.vrp__line`、`.vrp__choices`、`.vrp__label`、`.vrp__choice`、`.vrp__login`，`.resume-hint` 下的 `.resume-hint__text`。
6. **`useLoginResume` 的首登门控是 effect 里现读的 `isBlocked()`，再加地址里仍有 `?onboarding=1` 就「等着」**：`onboardingAsked.current` 由 App 的 onboarding effect 在同一次提交里置上，渲染时算出的布尔值读不到它；App 的 onboarding effect 和入口 effect 谁先谁后又取决于 hook 声明顺序。P1-1 的 `blocked` 就是这样一个函数（App 的 `entryBlocked`），`useEntryTarget(` 也排在两个 onboarding effect 之后，所以连「Discord 绑定回来、还没选身份时 App 重新弹首登」这条不看地址的路径也是先弹首登；看地址（`pending`）是额外的一道保险，不依赖声明顺序。
7. **离开那一局之后丢掉 intent**：契约只说「读一次就删」（storage）。本计划让 App 里的 `resume` 也只服务一次——到过那一局又离开（返回大厅、去别的页面），回来时不再提示，避免同一个旧点击被反复问。
8. **点「不用了」后焦点移到局标题**（`h2#session-detail-title`，已有 `tabIndex={-1}`）：提示连同它里面获得焦点的按钮一起消失，焦点不能掉到 `<body>`。
9. **`tests/dom/history.ts` 的 `preventNavigation`**：契约 6.1 定义了它，由 P1-2 在它新建的测试辅助文件里一并导出（`plan-P1-2.md`「对契约的补充」第 11 条）；本 PR 只导入，不改那个文件。
10. **有效期**：spec §4.1 写的是「有效期 15 分钟」，契约 4.12 / 第 8 节第 12 条定为 30 分钟。本计划照契约用 `LOGIN_RETURN_TTL_MS = 30 * 60 * 1000`；机主若要回到 15 分钟，只改这一个常量（单元测试按常量算边界，不用改）。
11. **金色圈用 `border-color` + `box-shadow: 0 0 0 1px`，不用 `outline`**：`outline` 会覆盖 `theme.css` 的 `:focus-visible` 焦点环（同为一个类/伪类的特异度，组件 CSS 后加载）。hover 时在 `@media (hover: hover)` 里重申边框色，免得 `.btn:hover` 把它变灰。
12. **被圈出的按钮带 `aria-describedby` 指向提问**（`ResumeHint` 导出 `RESUME_HINT_TEXT_ID = 'resume-hint-text'`，`SessionDetailDialog` 文件内加小工具 `describedBy`）：`role="status"` 区域和文字一起插入时，读屏软件不一定播报；焦点落到「来」时会读出「你登录前点的是「来」，确认一下？」。契约 4.11 的 `ResumeHintProps` 不变，只多一个导出常量。
13. **满员时被圈的是「来」**：「来」照旧被 `goingClosed` 禁用，下面照旧显示「来 N/N 满了，可以先报待定。」，提示仍然出现（用户需要知道之前那次点击没生效、为什么），选别的回答或「不用了」都会结束提示。
