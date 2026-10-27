# P1-4 契约文档、路由表与实机验收清单 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 P1 已经上线的地址化行为写进文档：`docs/CONTRACT.md`「Frontend expectations」的深链措辞改成「参数被翻译成该视图自己的地址」（「Only a positive integer id is read」「A link never writes」两句原样保留），补 `pending_hidden`、路由表、`history` 与返回键、`edg.return` 登录回跳；`RecordItem` 数据形状跟上 B1-1；README 新增「路由」一节；新建 P1-5 的实机 / 浏览器模拟验收清单 `docs/redesign-v5/p1-acceptance.md`，带结果记录表。

**Architecture:** 纯文档 PR，不碰任何代码和测试文件（P1 契约第 1 节：P1-4 的测试文件数 29 / 24 / 15 不变）。每个文档的「失败测试」是一个**不进仓库**的一次性检查脚本 `/tmp/p1-4-doc-checks.mjs`（Node ESM，只读文件、打印 PASS/FAIL、有失败就退出码 1），按 `acceptance` / `contract` / `readme` 三段分别跑：先跑出 FAIL，再写文档，再跑出全 PASS。文档里写到的每个行为、文案、常量，Task 0 先在上游分支的源码里 grep 到，对不上就停。

**Tech Stack:** Markdown（GitHub 渲染）、Node 24（只用来跑检查脚本和原有的 unit / dom 套件确认没有被碰到）、git。

**依赖:** 叠在 **P1-3** 之上（`claude/p1-3-login-return`），即 P1-0、B1-1、P1-1、P1-2、P1-3 都已在本地分支链上。文档描述的是它们按本目录 `contract.md`（下称「P1 契约」）实现后的行为：路由与文案（契约 4.1、4.7、4.8、4.9）、history 与浮层（4.2、4.3、4.6 的 Modal 部分）、登录回跳（4.11）、判决前脱敏（4.10）、托管（第 5 节 P1-0）、P1-5 清单结构（第 9 节）。

**分支:** `claude/p1-4-docs`，从本地分支 `claude/p1-3-login-return` 的 HEAD 开（`git switch -c claude/p1-4-docs claude/p1-3-login-return`）。不 fetch、不 rebase 到 `origin/main`、不 push、不开 PR。

---

## 文件结构

| 文件 | 动作 | 唯一职责 |
|---|---|---|
| `docs/redesign-v5/p1-acceptance.md` | 新建 | P1-5 验收清单：环境表、桌面浏览器模拟步骤（375×812 手机、1280×800 桌面、托管复测）、iOS Safari / Android Chrome 真机步骤、发现与修复表、结论、P1-5 修复分支规则、已知风险 |
| `docs/CONTRACT.md` | 修改 | ①`interface RecordItem`：`type`、`range` 可空，`note` 注释，新增 `pending_hidden?: true` 和说明（B1-1 的 API 形状）；②「Frontend expectations」一节（文件最后一节）整节换成新文本：`pending_hidden` 那句、深链改写、路由表、404 文案、保留前缀与 404.html、history、登录回跳 |
| `README.md` | 修改 | 在「## 技术栈」之前插入「## 路由」一节（spec §2.2 的表，标明 P1 已有的和后续阶段的）；「## 角色」表游客一行补「判决前只显示『有一起记录在处理中』」 |
| `/tmp/p1-4-doc-checks.mjs` | 新建（仓库外，不提交） | 三份文档的检查脚本，充当本 PR 的失败测试 |

不碰：`src/`、`worker/`、`server/`、`shared/`、`tests/`、`scripts/`、`index.html`、`docs/redesign-v5/README.md`（索引由领队在收录 P1 计划时一起改，见「对契约的补充」第 6 条）、`docs/DEPLOY-PAGES.md`（P1-0 已改）。

---

### Task 0: 开分支，确认上游行为和文档锚点都在

**Files:** 无改动（只读检查）

- [ ] **Step 1: 开分支**

```bash
cd "$(git rev-parse --show-toplevel)"
git status --short                                   # 期望：无输出
git rev-parse --verify claude/p1-3-login-return      # 期望：打印一个 commit hash
git rev-parse --verify claude/p1-4-docs 2>/dev/null && echo "claude/p1-4-docs 已存在，停下问领队"
git switch -c claude/p1-4-docs claude/p1-3-login-return
git branch --show-current                            # 期望：claude/p1-4-docs
```

上游分支不存在、工作区不干净、或 `claude/p1-4-docs` 已存在 → 停下，不要自己补。

- [ ] **Step 2: 确认文档要写的行为在源码里都有**

```bash
cd "$(git rev-parse --show-toplevel)"
fail=0
# need FILE TEXT：结构性的名字（导出、类名、prop、常量）必须在那个文件里
need() { grep -qF -- "$2" "$1" 2>/dev/null || { echo "MISSING: $1 :: $2"; fail=1; }; }
# copy TEXT：用户文案只要求在 src/ 某处（上游可能把它放进 routeCopy.ts / 组件 / 常量里）
copy() { grep -rqF -- "$1" src 2>/dev/null || { echo "MISSING: src/** :: $1"; fail=1; }; }
# P1-0：遗留 Pages Functions 和 edgeone.json 已删，构建拒绝 404.html
[ -e functions ] && { echo "MISSING: functions/ 仍在（P1-0 应已删除）"; fail=1; }
[ -e edgeone.json ] && { echo "MISSING: edgeone.json 仍在（P1-0 应已删除）"; fail=1; }
need scripts/pages-headers.mjs "404.html"
# B1-1：判决前脱敏
need worker/case-reads.ts "pending_hidden"
need worker/types.ts "pending_hidden"
need src/types.ts "pending_hidden?: boolean"
copy "有一起记录在处理中，判决后公开。"
copy "分数变化：判决后公开"
# P1-1：路由、断点、id 上限、文案、PageBar、置顶
need src/lib/routes.ts "export const RESERVED_PREFIXES = ['/api', '/auth', '/link']"
need src/lib/routes.ts "export function parseRoute"
need src/lib/constants.ts "DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'"
need src/lib/constants.ts "USER_ID_MAX = 128"
copy "这页不存在"
copy "找不到这局，链接可能写错了。"
copy "找不到这位选手。"
copy "链接里的案件不存在了。"
copy "打不开链接里的案件，稍后再试。"
copy "回大厅"
need src/components/PageBar.tsx "pagebar__back"
need src/components/PlayerDetail.tsx "pinnedRecord"
need src/components/PlayerDetail.tsx "pd__pinned"
copy "你点开的这一起"
# P1-2：history 浮层、滚动恢复
need src/lib/router.ts "scrollRestoration"
need src/lib/router.ts "export function pushLayerEntry"
need src/components/Modal.tsx "historyKey"
for f in RescheduleSheet AppealSheet RollCallDialog CaseDialog StatementDialog SessionFormDialog OnboardingDialog AdminAiPanel; do
  need "src/components/$f.tsx" "historyKey"
done
# P1-3：登录回跳
need src/lib/loginReturnShape.ts "LOGIN_RETURN_KEY = 'edg.return'"
need src/lib/constants.ts "LOGIN_RETURN_TTL_MS = 30 * 60 * 1000"
need src/lib/constants.ts "RETURN_PATH_MAX = 512"
copy "你登录前点的是"
copy "不用了"
copy "登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。"
copy "登录后报名"
need src/components/LoginLink.tsx "returnTo"
need src/components/SessionsPanel.tsx "LoginLink"
# P0：验收清单里引用的现有文案、按钮、CSS 和 viewport
need src/components/RescheduleSheet.tsx 'title="改到什么时候？"'
need src/components/RescheduleSheet.tsx "先不改"
need src/components/SessionDetailDialog.tsx "改时间"
need src/components/SessionsPanel.tsx "组一局"
need src/components/CaseActions.tsx "申诉"
need src/components/DraftNote.tsx "清空"
need src/components/AppealSheet.tsx 'title="申诉这一起"'
need src/components/AppealSheet.tsx "申诉理由会留在这台设备上，下次回来接着写。"
need src/components/AppealSheet.tsx 'confirmLabel="先离开"'
need src/components/AppealSheet.tsx 'cancelLabel="继续写"'
need src/components/Modal.tsx 'aria-label="关闭"'
need src/theme.css "env(safe-area-inset-bottom, 0px)"
need src/components/modal.css "var(--safe-bottom)"
need src/components/modal.css "overscroll-behavior: contain"
need src/components/modal.css "max-width: 480px"
need src/lib/modalStack.ts "overflow"
need src/App.tsx 'title="最新动态"'
need index.html 'content="width=device-width, initial-scale=1.0"'
[ $fail = 0 ] && echo "上游行为全部就位"
```

期望最后一行是 `上游行为全部就位`，没有任何 `MISSING:` 行。

- `need` 查结构性的名字（必须在那个文件里），`copy` 查用户文案（在 `src/` 任何文件里都算，上游可能把文案放进 `routeCopy.ts` 之类的常量文件）。
- 有 `MISSING:` → 先看是不是上游执行者换了写法（比如 `historyKey={'appeal'}`、文案拆成多段 JSX）：打开对应文件确认**行为和文案**与 P1 契约一致就算就位，并把实际写法记进本 PR 的提交说明；行为或文案真的不同 → 停下问领队，文档以代码为准还是以契约为准由领队定。
- 只有 `index.html` 那一条 MISSING（viewport 已被改过）→ 不算阻断：Task 1 写验收清单时，把第 7 节「安全区」那一条里的 viewport 原文换成实际内容，判断有没有 `viewport-fit=cover` 后照实写。

- [ ] **Step 3: 确认要改的文档锚点没被上游改过**

```bash
cd "$(git rev-parse --show-toplevel)"
sed -n '/^## Frontend expectations/,$p' docs/CONTRACT.md | shasum -a 256
# 期望：ffd08ab48499b32fd4de8788d2cee5bd592965dbd596a10296725ddc7a98aa8d
sed -n '/^## Frontend expectations/,$p' docs/CONTRACT.md | wc -l          # 期望：21（这一节是文件最后一节）
grep -cF '  type: ViolationType;           // v3: usually chosen by the AI, always validated' docs/CONTRACT.md   # 期望：1
grep -cF "  note: string | null;           // judge's short note — PUBLIC, like every field not marked PRIVATE" docs/CONTRACT.md   # 期望：1
grep -cF '  redacted: boolean;' docs/CONTRACT.md                          # 期望：1
grep -c '^## 技术栈$' README.md                                           # 期望：1
grep -c '^## 路由$' README.md                                             # 期望：0
grep -cF '选手主页（看得到案由、扣了几分和状态；陈述、申诉理由和判词只给当事人、立案人、裁判和管理员看）' README.md   # 期望：1
test -e docs/redesign-v5/p1-acceptance.md && echo "验收清单已存在，停下" || echo "验收清单不存在，可以新建"
```

哈希不对 → 有人改过这一节：用 `git log --oneline -- docs/CONTRACT.md` 看是谁改的，把他的改动并进 Task 2 的新文本（新文本里保留他加的句子）后再继续；拿不准就停下问领队。README 的「## 部署」一节 P1-0 改过，和本 PR 无关，不用核对。

- [ ] **Step 4: 跑基线测试，记下数字**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run test:unit 2>&1 | tail -6
npm run test:dom 2>&1 | tee /tmp/p1-4-dom-start.log | tail -6
grep -c 'not wrapped in act' /tmp/p1-4-dom-start.log
```

期望：unit **29 个文件**全过，dom **24 个文件**全过（P1 契约第 1 节「+ P1-3」一行）。把用例数记成 `U0`（unit）、`D0`（dom），act 警告行数记成 `W0`（P1 契约 6.4：基线只有 `onboarding-roles` 的那几条）。跨 PR 合成实测 `U0` = 414、`D0` = 299、`W0` = 3。文件数对不上 → 停下，不在本 PR 里补别人的文件。

---

### Task 1: P1-5 验收清单 `docs/redesign-v5/p1-acceptance.md`

**Files:**
- Create: `/tmp/p1-4-doc-checks.mjs`（仓库外，不提交）
- Create: `docs/redesign-v5/p1-acceptance.md`

- [ ] **Step 1: 写检查脚本（本 PR 的失败测试）**

把下面全文写进 `/tmp/p1-4-doc-checks.mjs`（Task 2、Task 3 也用它，只写这一次）：

```js
// P1-4 doc checks (throwaway, never committed). Run from the repo root:
//   node /tmp/p1-4-doc-checks.mjs <acceptance|contract|readme|all>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ACCEPTANCE = 'docs/redesign-v5/p1-acceptance.md';
const CONTRACT = 'docs/CONTRACT.md';
const README = 'README.md';
const results = [];

const read = (path) => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '');
const flat = (text) => text.replace(/\s+/g, ' ');
const count = (text, needle) => text.split(needle).length - 1;
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/** From `heading` (a whole line) up to the next level-2 heading. */
function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + heading.length + 2);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

/** Every row of every Markdown table has as many cells as its header. */
function tablesConsistent(text) {
  const cells = (line) => line.replace(/\\\|/g, '').split('|').length;
  let header = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) { header = 0; continue; }
    if (header === 0) { header = cells(line); continue; }
    if (cells(line) !== header) return line;
  }
  return null;
}

/** A `<word …>` outside code is eaten by GitHub's HTML sanitiser: write it inside backticks. */
function rawTag(text) {
  const prose = text.replace(/^\s*```[\s\S]*?^\s*```/gm, '').replace(/`[^`\n]*`/g, '');
  return prose.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s>/])/)?.[0] ?? null;
}

function mentions(label, text, needles) {
  const body = flat(text);
  for (const needle of needles) check(`${label}: mentions ${needle}`, body.includes(flat(needle)));
}

function stepIds(text, prefix, total) {
  const ids = [...text.matchAll(/^\| ([A-Z]-\d{2}) \|/gm)].map((m) => m[1]).filter((id) => id.startsWith(`${prefix}-`));
  const want = Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`);
  check(`acceptance: steps ${prefix}-01..${want.at(-1)} in order, once each`, ids.join(',') === want.join(','));
}

function acceptance() {
  const doc = read(ACCEPTANCE);
  check('acceptance: file exists', doc.length > 0);
  const headings = [
    '## 0. 怎么填', '## 1. 环境', '## 2. 浏览器模拟（先做）', '## 3. 真机（iOS Safari、Android Chrome）',
    '## 4. 发现与修复', '## 5. 结论', '## 6. 需要改代码时', '## 7. 已知风险与排查提示',
  ];
  for (const h of headings) check(`acceptance: heading "${h}" once`, count(doc, `\n${h}\n`) === 1);
  check('acceptance: findings table header', doc.includes('| 编号 | 设备/浏览器 | 步骤 | 实际 | 严重度 | 处理（commit 或「接受」） |'));
  stepIds(doc, 'M', 30);
  stepIds(doc, 'D', 8);
  stepIds(doc, 'H', 2);
  stepIds(doc, 'R', 13);
  mentions('acceptance', doc, [
    '375×812', '1280×800', 'DPR 3', 'safe-area-inset-bottom', 'viewport-fit=cover', 'history.length', 'history.state',
    'claude/p1-5-device-fixes', 'claude/p1-4-docs', 'fix: …（P1-5）', '找不到这局，链接可能写错了。', '找不到这位选手。',
    '这页不存在', '回大厅', '链接里的案件不存在了。', '你登录前点的是「来」，确认一下？', '不用了', '先离开', '继续写',
    '改到什么时候？', '申诉这一起', '判决后公开', '左缘右滑', '系统返回键', '手势返回', '‹ 返回',
    '(../CONTRACT.md#frontend-expectations)', '(../../README.md#路由)', 'about:blank',
    '可访问名是「你点开的这一起」', '登录后报名', 'history manipulation intervention',
  ]);
  check('acceptance: tables consistent', tablesConsistent(doc) === null);
  check('acceptance: no raw HTML tag outside code', rawTag(doc) === null);
}

function contract() {
  const doc = read(CONTRACT);
  const fe = section(doc, '## Frontend expectations');
  const fefl = flat(fe);
  check('contract: Frontend expectations present', fe.length > 0);
  check('contract: keeps "Only a positive integer id is read" once', count(fefl, 'Only a positive integer id is read') === 1);
  check('contract: keeps "A link never writes." once', count(fefl, 'A link never writes.') === 1);
  check('contract: old "stripped at once" wording gone', !fefl.includes('the parameter is stripped at once'));
  check('contract: old "200 most recent" clause gone', !fefl.includes('200 most recent cases'));
  mentions('contract', fe, [
    "the parameter is translated into that view's own address",
    'show the pending range, or 判决后公开 when the API hid it (`pending_hidden`).',
    '`/?session=<id>` becomes `/sessions/<id>`', '`/players/<subject>/cases/<id>`', 'moved (not copied) to the top',
    '`/cases/<id>`', 'No route starts with `/api`, `/auth` or `/link`', '`404.html`', '`history.state.edg === 1`',
    'puts one `/` entry under it, once', 'the back key closes only the topmost overlay', 'A reload never reopens an overlay.',
    "`sessionStorage['edg.return']`", '30 minutes', 'nothing is sent until the user presses the button again',
    '找不到这局，链接可能写错了。', '找不到这位选手。', '这页不存在', '回大厅', '链接里的案件不存在了。',
    '打不开链接里的案件，稍后再试。', '你登录前点的是「来」，确认一下？', '有一起记录在处理中，判决后公开。', '1024px',
    'A case with `redacted: true` says a statement exists', 'Prefer `claim_summary` over the raw `claim`',
    'the invite banner outranks the weekly report', "`verdict.source === 'fallback'` must be visually distinct",
    "the top-level jump to the API's `/auth/login`", 'at most 512 characters',
  ]);
  check('contract: no raw HTML tag outside code', rawTag(fe) === null);
  const start = doc.indexOf('interface RecordItem {');
  const record = start < 0 ? '' : doc.slice(start, doc.indexOf('\n}', start));
  mentions('contract RecordItem', record, [
    'type: ViolationType | null;', 'range: { min: number; max: number; base: number } | null;',
    'pending_hidden?: true;', 'redacted: boolean;',
  ]);
  check('contract: tables consistent', tablesConsistent(fe) === null);
}

function readme() {
  const doc = read(README);
  const at = doc.indexOf('\n## 路由\n');
  check('readme: one "## 路由" heading', count(doc, '\n## 路由\n') === 1);
  check('readme: 路由 sits right before 技术栈', at > 0 && doc.indexOf('\n## ', at + 1) === doc.indexOf('\n## 技术栈\n'));
  const routes = section(doc, '## 路由');
  const rows = [
    ['`/`', 'P1 已有'], ['`/sessions/:id`', 'P1 已有'], ['`/players/:id`', 'P1 已有'],
    ['`/players/:id/cases/:caseId`', 'P1 已有'], ['`/cases/:id`', 'P1 已有'], ['其他任何路径', 'P1 已有'],
    ['`/sessions/new`（可带 `?again=<id>`）', 'P3-4'], ['`/sessions/:id/rollcall`', 'P3-5'],
    ['`/sessions/history`', 'P3-6'], ['`/board`、`/board/feed`、`/board/report`、`/board/rules`', 'P3-6'],
    ['`/cases/:id/statement`', 'P4-2'], ['`/cases/new`（可带 `?session=<id>`）', 'P4-2'],
    ['`/me`、`/me/notify`、`/me/profile`', 'P4-1'], ['`/review`', 'P4-3'],
    ['`/join`（可带 `?session=<id>`）', 'P4-3'], ['`/admin`（`?tab=ai\\|users\\|report`）', 'P4-3'],
  ];
  const lines = routes.split('\n');
  for (const [cell, phase] of rows) {
    const row = lines.find((line) => line.startsWith(`| ${cell} |`));
    check(`readme: row ${cell} → ${phase}`, row !== undefined && row.includes(phase));
  }
  mentions('readme', routes, [
    '`404.html`', '`/api`、`/auth`、`/link`', '`/?case=N`', '`/?session=N`', "`sessionStorage['edg.return']`",
    '1024px', '‹ 返回', '(./docs/CONTRACT.md#frontend-expectations)', '(./docs/redesign-v5/p1-acceptance.md)',
  ]);
  check('readme: acceptance doc the section links to exists', existsSync(join(ROOT, ACCEPTANCE)));
  check('readme: tables consistent', tablesConsistent(routes) === null);
  check('readme: no raw HTML tag outside code', rawTag(routes) === null);
  check('readme: 角色表的游客一行写了判决前', doc.includes('判决前只显示「有一起记录在处理中」'));
  check('readme: 角色表的旧说法已去掉', !doc.includes('选手主页（看得到案由'));
}

const RUNS = { acceptance, contract, readme };
const which = process.argv[2] ?? 'all';
const selected = which === 'all' ? Object.keys(RUNS) : [which];
for (const name of selected) {
  if (!RUNS[name]) throw new Error(`unknown section: ${name}`);
  RUNS[name]();
}
for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}\n`);
const failed = results.filter((r) => !r.ok).length;
process.stdout.write(`${results.length - failed} passed, ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
```

- [ ] **Step 2: 跑 acceptance 段，确认失败**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs acceptance; echo "exit=$?"
```

期望：第一条是 `FAIL acceptance: file exists`，最后两行是 `2 passed, 46 failed` 和 `exit=1`（通过的两条是空文件上的「tables consistent」和「no raw HTML tag outside code」）。

- [ ] **Step 3: 写验收清单**

用 Write 工具新建 `docs/redesign-v5/p1-acceptance.md`，内容逐字照抄下面四个反引号围起来的部分（不含围栏那两行）：

````markdown
# P1 实机验收清单（P1-5）

> **验收对象**：P1 全部 PR（P1-0 托管、B1-1 判决前脱敏、P1-1 路由、P1-2 浮层与返回键、P1-3 登录回跳）合并并部署之后的前端。
> **谁来做**：领队（机主或主会话）。第 2 节可以在桌面浏览器里模拟；第 3 节只能在真机上做，执行代理不勾第 3 节。
> **依据**：`docs/redesign-v5/spec.md` §2.2「路由规则」、§2.3 旧深链映射、§6.4（page / sheet / drawer 的语义）、§9 P1-5、§10 第 5 条；前后端约定见 [`docs/CONTRACT.md`「Frontend expectations」](../CONTRACT.md#frontend-expectations)，路由一览见 [README「路由」](../../README.md#路由)。

## 0. 怎么填

- 每一项都是「操作 → 期望」。结果栏只写三种：`通过`、`不通过（F-nn）`、`跳过（原因）`。不通过的项在第 4 节新开一行，编号从 `F-01` 起递增。
- **返回键**：桌面模拟里是浏览器的后退按钮（macOS `⌘[`，Windows / Linux `Alt+←`）；真机上指 Android 的系统返回键和手势返回、iOS Safari 的左缘右滑和工具栏的「‹」。
- 每一步做完在 DevTools 控制台跑下面这一行（只读，什么都不改），拿结果和「期望」对照：

  ```js
  ({ at: location.pathname + location.search, len: history.length, state: history.state, y: Math.round(scrollY) })
  ```

- **「直接打开 X」**：在当前标签页的地址栏输入或粘贴 X 回车（这样进来的条目没有路由的标记，和从 Discord、书签、新标签页进来一样）。设备模拟只对开着 DevTools 的那个标签页生效：新开的标签页、无痕窗口要重新打开 DevTools 和设备模式，再刷新一次。
- **判断「历史有没有多出条目」看按几次返回键回到哪里，不看 `history.length` 变没变小**：`history.length` 把还能「前进」的条目也算在内，关浮层时的静默后退不会让它变小。`len` 只在 M-09（刷新不让历史变长）里用。
- **不写数据**：除了 M-23、M-26、D-08 的「登录」和可选的 M-29（会新建一局），整份清单不提交任何表单（M-27 只改本标签页的 sessionStorage，不算）。M-05～M-07、M-10～M-13、D-05 打开的「改时间」「申诉」只看不交，离开时选「先不改」「先离开」或 ✕。M-24 提示出现后点「不用了」；除非你本来就要报名，不要再点「来」。M-13 之后申诉草稿还留在这台设备上：再打开一次「申诉」，点草稿旁的「清空」，再点 ✕ 关掉。

## 1. 环境

- **地址**：首选生产 `https://community.nanako.org`，等机主合并 P1 并重新部署 Pages 之后再做。Cloudflare Pages 的预览地址没有 API（spec §11 第 13 条），只能看静态页面，不用来做这份清单。真机只用生产地址。
- 本地栈（按 README「本地开发 Quickstart」：`npm run db:local` 之后 `npm run dev` 起 :8787，再 `npm run dev:web` 起 `http://localhost:5173`）也能做第 2 节，但本地库是空的，要先登录、自己组一局、立一起案才有下表的 N、C；登录要 `.dev.vars` 里配好能回到 localhost 的 OAuth。做不到的项记成「跳过（本地没有数据 / OAuth）」，不依赖数据的 M-17～M-20 照做。

| 项 | 值 |
|---|---|
| 地址 | |
| 前端版本（Pages 部署 id，或 `git rev-parse --short HEAD`） | |
| 日期 | |
| 执行人 | |
| 桌面浏览器与版本 | |
| iOS：设备 / 系统版本 / Safari 版本 | |
| Android：设备 / 系统版本 / Chrome 版本 | |
| 测试账号（只写用户名，不写密码） | |
| N：一局还没开始、不是你组织的局的 id，你的账号在这局还没回「来」（M-22～M-24、M-26、D-08 要用：组织者没有报名按钮，已经是「来」时不会出现提示） | |
| N_own：你自己组织（或你是管理员）、还没开始的局的 id | |
| C / A：任意一起案件的编号，和它当事人的 id | |
| B：另一位选手的 id（不是 A） | |
| C_self：当事人是你、状态是已判决、还没申诉过的案件编号（只有这种案件有「申诉」按钮；没有就跳过 M-11～M-13、R-05） | |
| C_pending / A2：一起还在等说明或裁决中的案件，和它当事人的 id（可选） | |
| 已取消的局的 id（可选） | |

## 2. 浏览器模拟（先做）

**手机形态**：Chrome 打开 DevTools（`⌘⌥I` / `Ctrl+Shift+I`）→「Toggle device toolbar」（`⌘⇧M` / `Ctrl+Shift+M`）→ 顶部 Dimensions 选「Responsive」，宽 375、高 812，即 **375×812**；右上角「⋮」里打开「Add device pixel ratio」设成 **DPR 3**、「Add device type」设成「Mobile」（带触控）→ 刷新页面。用 Claude 桌面版的内置浏览器时，选 mobile 预设（也是 375×812）。

**桌面形态**：关掉设备工具栏，把页面区域调到 **1280×800**（或在 Responsive 里填 1280×800、device type 选「Desktop」）。

设备模拟不模拟 iOS 的手势、安全区和地址栏收起，这些在第 3 节真机上看。

### 2.1 手机 375×812

| 编号 | 操作 | 期望 | 结果 |
|---|---|---|---|
| M-01 | 直接打开 `<地址>/`，往下滚到能看见「约局」列表，跑控制台那一行，记下 `y` | `at` 是 `/`；`state.edg` 是 1（路由盖过章） | |
| M-02 | 点列表里任意一局 | 地址变成 `/sessions/N`；整页显示这一局，大厅看不见；顶部 sticky 条左边是「‹ 返回」；页面在最上面（`y` 为 0）；`document.activeElement.id` 是 `session-detail-title` | |
| M-03 | 按返回键 | 回到 `/`，不白屏、不重新出现骨架屏；`y` 和 M-01 记下的基本一致（刚才那张卡片还在视口里） | |
| M-04 | 再点一局，然后点页面上的「‹ 返回」 | 和 M-03 一样回到 `/`，滚动位置还在 | |
| M-05 | 直接打开 `<地址>/sessions/N_own`，点「改时间」 | 底部弹出「改到什么时候？」；地址不变；`state.sheet` 是 `'reschedule'` | |
| M-06 | 按返回键；再按一次 | 第一次只关掉改时间浮层，还在 `/sessions/N_own`；第二次回到 `/` | |
| M-07 | 回到 `/sessions/N_own`，打开改时间，点「先不改」（或 ✕） | 浮层关闭，`state` 里没有 `sheet`；接着按返回键一次就回到 `/`，不会停在同一页 | |
| M-08 | 地址栏先打开 `about:blank`，再粘贴 `<地址>/sessions/N` 回车，页面加载完后在页面空白处点一下 | 打开的就是这一局；`state.edg` 是 1；按返回键 → 回到 `/` 大厅（垫的那一条）；再按一次 → 离开本站，回到 `about:blank`（不点页面直接按返回的情况见 M-28） | |
| M-09 | 直接打开 `<地址>/sessions/N`，然后刷新 3 次，每次刷新后跑控制台那一行 | 三次的 `len` 一样，`state` 不变；之后按返回键一次就回到 `/` | |
| M-10 | 在 `/sessions/N_own` 打开改时间浮层，然后刷新 | 刷新后浮层不重开，`state` 里没有 `sheet`；按返回键一次页面看起来没变（还是 `/sessions/N_own`，这是 spec §2.2 写明的代价）；再按一次回到 `/` | |
| M-11 | 打开 `/players/<你的 id>/cases/C_self`，点「申诉」，在理由框里随便打几个字（不提交） | 底部弹出「申诉这一起」 | |
| M-12 | 按返回键 | 不离开：浮层里出现「申诉理由会留在这台设备上，下次回来接着写。」，焦点在「继续写」 | |
| M-13 | 点「继续写」，再按返回键；最后点「先离开」 | 理由还在；又出现同一个确认，地址没变、页面没离开；「先离开」后浮层关闭，留在选手页 | |
| M-14 | 直接打开旧链接 `<地址>/?case=C&utm=dc` | 地址变成 `/players/A/cases/C?utm=dc`；选手头部下面第一块就是第 C 起（上面一行 eyebrow「案件 #C · …」，这块区域的可访问名是「你点开的这一起」，在 DevTools 的 Accessibility 面板里看），那张卡滚进视口（能居中时居中）、有焦点框；`document.querySelectorAll('[id="case-C"]').length` 是 1（移动，不是复制）；按返回键 → 大厅（地址 `/?utm=dc`） | |
| M-15 | 直接打开旧链接 `<地址>/?session=N` | 地址变成 `/sessions/N`，`location.search` 为空；按返回键 → `/` | |
| M-16 | 直接打开 `<地址>/players/B/cases/C`（B 不是 C 的当事人） | 地址被改成 `/players/A/cases/C`，不报错；按返回键不会回到写错的那个地址 | |
| M-17 | 直接打开 `<地址>/sessions/999999999` | 「找不到这局，链接可能写错了。」和「回大厅」；点「回大厅」→ `/` | |
| M-18 | 直接打开 `<地址>/players/no-such-player-p1` | 「找不到这位选手。」 | |
| M-19 | 先直接打开 `<地址>/cases/999999999`，再直接打开 `<地址>/?case=999999999` | 前者整页显示「链接里的案件不存在了。」和「回大厅」；后者停在 `/`，大厅顶部提示「链接里的案件不存在了。」 | |
| M-20 | 依次直接打开 `/xyz`、`/sessions/07`、`/sessions/new` | 都是「这页不存在」和「回大厅」（`/sessions/new` 要到 P3-4 才有） | |
| M-21 | 打开一局已取消的局 `/sessions/<已取消的局>` | 照常显示，标为已取消，不是「找不到这局」；没有已取消的局就跳过 | |
| M-22 | 开无痕窗口（未登录），打开 `/sessions/N` | 报名区写着「登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。」，下面是「来」「待定」「不来」三个链接和「用 Nanako 账号登录」 | |
| M-23 | 点「来」，走完登录 | 回到 `/sessions/N`（第一次登录的账号会先弹身份引导，关掉以后才跳）；看到「你登录前点的是「来」，确认一下？」，「来」按钮带金色描边；Network 面板里落地之后没有任何 POST / PATCH / DELETE（身份引导里你自己点的除外）；`sessionStorage.getItem('edg.return')` 是 `null` | |
| M-24 | 点「不用了」；再按一次返回键，然后从大厅重新点进这一局 | 提示消失，焦点在局标题上，什么都没提交，你在这局的报名还是原样；返回键回到 `/` 大厅；重新进来不再出现提示 | |
| M-25 | 无痕窗口打开 `/players/A2/cases/C_pending` | eyebrow 是「案件 #C_pending · 处理中」；卡片写「（A2 的名字）有一起记录在处理中，判决后公开。」和「分数变化：判决后公开」；看不到案由、立案经过和区间，分数变化不写成 `0`；大厅「最新动态」里如果有这一行，只剩名字和「处理中」。没有这样的案件就跳过 | |
| M-26 | 无痕窗口（未登录）回到大厅，在约局列表里 N 那一行点「登录后报名」（点之前先跑一次控制台那一行确认还在 `/`），走完登录 | 点下去时 `sessionStorage.getItem('edg.return')` 的 `path` 是 `/sessions/N`、没有 `intent`；登录回来落在 `/sessions/N`，**不**出现「你登录前点的是…」的提示；没有任何 POST | |
| M-27 | 已登录，在大厅的控制台执行 `sessionStorage.setItem('edg.return', JSON.stringify({ v: 1, path: '//evil.example', savedAt: Date.now() }))`，然后刷新 | 不跳转，停在 `/`；`sessionStorage.getItem('edg.return')` 变成 `null` | |
| M-28 | 只在 Chrome 做：地址栏打开 `about:blank`，粘贴 `<地址>/sessions/N` 回车，**不点页面任何地方**直接按返回键 | 两种结果都如实记：回到 `/` 大厅（同 M-08）；或者直接离开本站——Chrome 的 history manipulation intervention 会跳过没有用户操作时写入的 `/`，这是浏览器策略，在第 4 节记一行，处理写「接受」 | |
| M-29 | （可选，会真的新建一局：只在本地栈或测试账号上做，生产上写「跳过（会写数据）」）大厅往下滚一段，点「组一局」，建好一局 | 落到 `/sessions/<新 id>`；按返回键回到大厅，滚动位置是点「组一局」之前的位置，不是顶部 | |
| M-30 | 已登录，打开 `/players/A`（整页形态），点右上角头像打开账号菜单；关掉菜单后往下滚一段 | 菜单整块盖在「‹ 返回」条上面，点菜单第一项不会点到「返回」；滚动后「‹ 返回」条贴住顶部、盖住页头 | |

### 2.2 桌面 1280×800

| 编号 | 操作 | 期望 | 结果 |
|---|---|---|---|
| D-01 | 大厅往下滚一段，点一局 | 右侧弹出约 480px 宽的抽屉，大厅留在底下（变暗）；地址 `/sessions/N`；大厅的滚动位置没变 | |
| D-02 | 点抽屉右上角的 ✕（可访问名「关闭」） | 抽屉关闭，地址回到 `/`；焦点回到刚才点的那一局 | |
| D-03 | 再开一局按 Esc；再开一局点抽屉外的暗处 | 都和 D-02 一样 | |
| D-04 | 直接打开 `<地址>/players/A` | 抽屉形态，底下是大厅；按返回键 → `/` | |
| D-05 | 在 `/sessions/N_own` 的抽屉里打开「改时间」 | 返回键第一次只关改时间，第二次关抽屉回到 `/` | |
| D-06 | 开着 `/sessions/N` 的抽屉，把窗口从 1280 拖窄到 900，再拖回 1280 | 窄于 1024px 变成整页（「‹ 返回」），地址不变，内容重新出现；拖回去又是抽屉 | |
| D-07 | 直接打开 `<地址>/?case=C` | 抽屉里的选手页，那一起在最上面并有焦点；地址是 `/players/A/cases/C` | |
| D-08 | 无痕窗口（未登录）重复 M-22～M-24 | 约局是右侧抽屉；报名区、登录回来后的提示和「来」的金色描边与手机一样；没有任何 POST | |

### 2.3 托管复测（部署后做一次）

| 编号 | 操作 | 期望 | 结果 |
|---|---|---|---|
| H-01 | `curl -sI <地址>/sessions/1`、`curl -sI <地址>/players/x/cases/1` | 都是 200、`content-type: text/html`（SPA 回退生效；构建产物里没有 `404.html`） | |
| H-02 | `curl -sI <地址>/api/config`；再看浏览器 Network 面板 | community 域名上的 `/api/config` 也是 SPA 的 `text/html`（P1-0 删了 `functions/`，不再反代）；应用自己的请求都发往 `VITE_API_BASE`（生产是 `https://capi.nanako.org`） | |

## 3. 真机（iOS Safari、Android Chrome）

每项在两台机器上各做一次，各填一栏。

| 编号 | 操作 | 期望 | iOS Safari | Android Chrome |
|---|---|---|---|---|
| R-01 | 重复 M-02～M-04 | 同 M-02～M-04。Android 的系统返回键和手势返回各试一次；iOS 的左缘右滑和工具栏「‹」各试一次 | | |
| R-02 | 重复 M-05～M-07 | 返回键 / 手势只关改时间浮层，松手后仍停在约局页。iOS 左缘右滑时整屏跟着手指移动是 Safari 自己的快照动画，正常；松手后约局页不见了、回到大厅才算不通过 | | |
| R-03 | 重复 M-08：从 Discord 私信或备忘录里点 `/sessions/N` 的链接 | 进来就是这一局，返回一次到大厅。从 Discord App 的内置浏览器打开时返回键可能直接回 Discord，这时改用「在浏览器中打开」再测，并在格子里注明 | | |
| R-04 | 重复 M-09、M-10（iOS 下拉或地址栏刷新，Android 地址栏刷新） | 同 M-09、M-10 | | |
| R-05 | 重复 M-11～M-13 | 同 M-11～M-13；系统返回手势也先弹离开确认 | | |
| R-06 | 在有 Home 指示条的 iPhone（或手势导航的 Android）上打开改时间浮层，滚到底 | 「先不改」「改到 …」整排按钮露在 Home 指示条 / 手势条上方，不被压住（sheet 底部留 `safe-area-inset-bottom`） | | |
| R-07 | 点「组一局」，在勾人的名单里滚到底后继续往上滑；改时间浮层里也试一次 | 只有浮层在滚，背景大厅不动；iOS 不出现把背景一起拖走的橡皮筋 | | |
| R-08 | 在约局页上下快速滚动，让地址栏收起、展开几次 | sticky 的「‹ 返回」条一直贴着顶部，不抖、不被地址栏盖住 | | |
| R-09 | 手机横屏、再竖回来；有 iPad / 平板时也横竖屏一次 | 手机横屏一般不到 1024px，仍是整页，内容不丢；平板横竖屏跨过 1024px 时整页和抽屉互相切换，地址不变、内容重新出现。没有平板就在格子里写「跳过（无平板）」 | | |
| R-10 | 大厅滚到很下面（排行榜或「最新动态」附近），点一个人或一局，返回 | 回到原来的位置；iOS 返回手势松手后不先跳到顶部再跳回来 | | |
| R-11 | 未登录时点「登录」进到登录页，不登录，用返回键回来 | 不白屏，地址和内容一致；再按返回键的行为正常（不重复回到登录页） | | |
| R-12 | 用无痕标签页重复 M-22～M-24 | 同 M-22～M-24 | | |
| R-13 | 在申诉理由框里点一下，让键盘弹出 | 页面不自动放大（输入框字号 ≥ 16px）；键盘弹出后理由框和按钮仍然看得见 | | |

## 4. 发现与修复

严重度：**阻断**（走不通或会丢数据）/ **高**（明显不对，但有绕法）/ **中**（体验问题）/ **低**（细节）。「处理」填修复的 commit（短 hash），或者「接受」并写一句理由，或者「挪到 Px」。

| 编号 | 设备/浏览器 | 步骤 | 实际 | 严重度 | 处理（commit 或「接受」） |
|---|---|---|---|---|---|
| F-01 | | | | | |

## 5. 结论

- [ ] 全部通过
- [ ] 有遗留：列出编号（F-nn），每条写明去向（P1-5 已修 / 接受 / 挪到 Px）

执行人：　　　　日期：

## 6. 需要改代码时

- 只有第 4 节里有要修的项才开分支：`git switch -c claude/p1-5-device-fixes claude/p1-4-docs`。不需要改代码就不开。
- 每个修复一个 commit，提交信息 `fix: …（P1-5）`（例：`fix: sheet 底部按钮让出 Home 指示条（P1-5）`），不加署名行；把 commit 短 hash 填回第 4 节。
- 每个 commit 之前跑 `npm run typecheck`、`npm run test:unit`、`npm run test:dom`，全过再提交；spec §6.5 锁定的文案和断言一个不改，只能追加断言。
- 不 rebase 到 `origin/main`、不 push、不开 PR，由机主按叠放顺序处理。

## 7. 已知风险与排查提示

- **安全区**：`index.html` 的 viewport 现在是 `width=device-width, initial-scale=1.0`，没有 `viewport-fit=cover`。iOS 上这时 `env(safe-area-inset-bottom)` 通常是 0，`--safe-bottom`（`src/theme.css`）就不起作用。R-06 不通过时先查这里；加 `viewport-fit=cover` 会让整页内容延伸到刘海和 Home 指示条下面，顶栏和底部要一起留安全区，属于 P1-5 的修复范围，改之前先在第 4 节写清楚。
- **`history.length` 不会变小**：见第 0 节。关浮层时的静默后退留下一个可以「前进」的条目，这是正常的。
- **开着浮层刷新**：之后第一次返回页面看起来没变（回到同一地址的无浮层条目），这是 spec §2.2 接受的代价，不记为缺陷。
- **桌面跨过 1024px**：整页和抽屉切换时组件会重新挂载、重新请求一次详情，可以接受（P1 契约 4.5）。
- **大厅被整页盖住时仍在后台定时刷新**：这是为了返回时不重拉、滚动位置能恢复（P1 契约第 8 节第 6 条），不记为缺陷。
- **Discord 内置浏览器**：它的返回键和历史不一定走网页的 history，R-03 以系统浏览器为准。
- **背景跟着滚（R-07）**：浮层打开时 `src/lib/modalStack.ts` 给 `<body>` 加 `overflow: hidden`，sheet 面板自己有 `overscroll-behavior: contain`（`src/components/modal.css`）。较旧的 iOS Safari 对这两者支持不全，不通过时先记下系统版本，修复属于 P1-5。
- **横屏的 sheet**：sheet 只在宽度 ≤ 600px 时贴底（`src/components/modal.css`），手机横屏一般超过 600px，这时它居中显示、底部不留安全区，属于正常。
- **账号菜单与「‹ 返回」条（M-30）**：菜单开着时靠 `.hdr:has(.hdr__dropdown)` 把页头抬到「‹ 返回」条上面（`src/components/page-bar.css`）。不支持 `:has()` 的旧浏览器上菜单会被压住一截，这是 P1-1 已知的取舍（`plan-P1-1.md`「对契约的补充」第 9 条），记下浏览器版本，处理写「接受」或「挪到 P3」。
````

写的时候注意：
- 表格里每一行的 `|` 数量和表头一样（脚本会查）；步骤编号 M-01～M-30、D-01～D-08、H-01～H-02、R-01～R-13 按顺序、各出现一次。
- 第 1 节「环境」表、各步骤的「结果」栏、第 4 节 F-01 那一行、第 5 节的执行人和日期**故意留空**，那是领队填的，不是占位符遗漏。
- Task 0 Step 2 里如果 `index.html` 那一条 MISSING，按那里的说明改第 7 节第一条。
- 正文（反引号外）不写 `<英文单词>` 这种尖括号：GitHub 会把它当 HTML 标签吞掉。占位写成 `` `<地址>` ``（放进反引号）或「（A2 的名字）」（脚本的 `no raw HTML tag outside code` 会查）。

- [ ] **Step 4: 跑 acceptance 段，确认通过**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs acceptance; echo "exit=$?"
```

期望：最后两行 `48 passed, 0 failed`、`exit=0`。有 FAIL 就按条目名改文档，不改脚本。

- [ ] **Step 5: 提交**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/redesign-v5/p1-acceptance.md
git commit -m "docs: 新增 P1-5 实机验收清单与记录表"
git show --stat --format=%B HEAD | head -8      # 期望：只有这一个文件；提交信息没有任何署名行
```

---

### Task 2: `docs/CONTRACT.md` 的数据形状与「Frontend expectations」

**Files:**
- Modify: `docs/CONTRACT.md`（`interface RecordItem` 四处；「## Frontend expectations」整节）

- [ ] **Step 1: 跑 contract 段，确认失败**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs contract; echo "exit=$?"
```

期望：`10 passed, 31 failed`、`exit=1`。通过的 10 条是「这一节存在」「两句锁定原文各出现一次」、原有的四条约定还在、`redacted: boolean;` 还在、表格一致、没有裸 HTML 标签——它们在改完之后也必须继续通过。

- [ ] **Step 2: 改 `interface RecordItem`（B1-1 的 API 形状）**

用 Edit 工具做下面四处替换（每处 `old_string` 在文件里只出现一次，Task 0 Step 3 已核对）。

①
```ts
  type: ViolationType;           // v3: usually chosen by the AI, always validated
```
换成
```ts
  type: ViolationType | null;    // v3: usually chosen by the AI, always validated; null only when pending_hidden
```

②
```ts
  note: string | null;           // judge's short note — PUBLIC, like every field not marked PRIVATE
```
换成
```ts
  note: string | null;           // judge's short note — PUBLIC, like every field not marked PRIVATE (except while pending_hidden)
```

③（带上下一行，`range: {…}` 在别的接口里也出现过）
```ts
  range: { min: number; max: number; base: number };
  created_at: string;
```
换成
```ts
  range: { min: number; max: number; base: number } | null;  // null only when pending_hidden
  created_at: string;
```

④（`RecordItem` 的最后一行和右花括号）
```ts
  redacted: boolean;
}
```
换成
```ts
  redacted: boolean;
  // Before a verdict (`awaiting_statement`, `judging`) anyone else sees even
  // less, so a case is not presented as proven: type, range, claim,
  // claim_summary and note are null, escalation_suggested is false, and
  // `pending_hidden: true` is set (on top of `redacted: true`). id, subject,
  // reporter, delta (still 0), classified_by, session_id, statement_at,
  // deadline_at, status, verdict (still null) and created_at stay. In every other
  // case the key is absent.
  pending_hidden?: true;
}
```

注释里的「anyone else」接的是上面 PRIVATE 那段注释的「For anyone else」（当事人、立案人、裁判、管理员之外的人）。改完核对一次：`grep -n 'pending_hidden' worker/case-reads.ts worker/types.ts` 里保留和隐藏的字段与这段注释一致（P1 契约 4.10）；不一致以代码为准改注释，并在提交说明里写一句。

- [ ] **Step 3: 整节替换「Frontend expectations」**

这一节是 `docs/CONTRACT.md` 的最后一节。用 Edit 工具，`old_string` 是下面这段原文（从 `## Frontend expectations` 到文件末尾，Task 0 Step 3 的哈希就是它）：

````markdown
## Frontend expectations
- Fetch `/api/config`, `/api/leaderboard`, `/api/records`, `/api/me` on load, plus
  `/api/records?mine=pending` when `pending.statements > 0`.
- Import display constants from `@shared/scoring` and `@shared/attendance`.
- A pre-verdict case must never render its `delta` as `0` — show the pending range.
- Prefer `claim_summary` over the raw `claim` for headlines; fall back to the type
  label when it is null (pre-v3 rows).
- An invitation is an action the user owes, so the invite banner outranks the
  weekly report on the page.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
- Links into the app (the bot's DMs and replies use them): `/?case=<id>` opens
  that case in its subject's page, scrolled to and focused (if it is among the
  200 most recent cases the page shows; else the page opens unscrolled);
  `/?session=<id>`
  opens the session. Only a positive integer id is read (anything else is
  ignored), the parameter is stripped at once, and the link only picks which
  ordinary view opens — what it shows and which controls come from the API and
  `/api/me` as always. A link never writes. A case that is gone gets a notice.
- A case with `redacted: true` says a statement exists (when `statement_at` is
  set) rather than calling it a verdict in absence, and shows no verdict words.
````

`new_string` 是下面这段（文件仍以一个换行结尾）：

````markdown
## Frontend expectations
- Fetch `/api/config`, `/api/leaderboard`, `/api/records`, `/api/me` on load, plus
  `/api/records?mine=pending` when `pending.statements > 0`.
- Import display constants from `@shared/scoring` and `@shared/attendance`.
- A pre-verdict case must never render its `delta` as `0` — show the pending
  range, or 判决后公开 when the API hid it (`pending_hidden`). Such a case says
  only that it exists — for a subject named 老王, 「老王有一起记录在处理中，判决后公开。」
  — and its feed row shows only the name and 「处理中」.
- Prefer `claim_summary` over the raw `claim` for headlines; fall back to the type
  label when it is null (pre-v3 rows).
- An invitation is an action the user owes, so the invite banner outranks the
  weekly report on the page.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
- Links into the app (the bot's DMs and replies use them) stay valid for ever:
  `/?session=<id>` and `/?case=<id>`. Only a positive integer id is read
  (anything else is ignored and simply stripped), and the parameter is
  translated into that view's own address: `/?session=<id>` becomes
  `/sessions/<id>`; `/?case=<id>` looks the case up once
  (`GET /api/records/<id>`) and becomes
  `/players/<subject>/cases/<id>`, where that case is moved (not copied) to the
  top of its subject's page, scrolled to the centre and focused. Other query
  parameters (`utm`, …) are kept. The link only picks which ordinary view
  opens — what it shows and which controls come from the API and `/api/me` as
  always. A link never writes. A case that is gone leaves you on `/` with
  「链接里的案件不存在了。」 (any other failure: 「打不开链接里的案件，稍后再试。」).
  These parameters are read on `/` only. `?linked=discord` is stripped and shows
  the Discord-linked notice; `?onboarding=1` (on any path) opens the first-login
  dialog first, and the link's target opens once it is closed.
- Routes (`src/lib/routes.ts` parses, `src/lib/router.ts` owns `history`; no
  router library). Only these exist; every other path renders the front-end
  page 「这页不存在」 with a 「回大厅」 link:

  | Path | Phone (< 1024px) | Desktop (≥ 1024px) |
  |---|---|---|
  | `/` | the hall | the hall |
  | `/sessions/<id>` | a page with a sticky 「‹ 返回」 bar | a right-hand drawer over the hall |
  | `/players/<userId>` | a page with a sticky 「‹ 返回」 bar | a right-hand drawer over the hall |
  | `/players/<userId>/cases/<id>` | that player's page, the case moved to the top and focused | the same, in the drawer |
  | `/cases/<id>` | alias: looks the case up once, then replaces itself with the row above | the same |

  Numeric ids match `^[1-9]\d{0,14}$` (so `/sessions/07` is not a session). A
  user id is the OAuth subject: non-empty, at most 128 characters, no NUL,
  always `encodeURIComponent`-ed in the path. When a case's `subject.id` is not
  the `<userId>` in the address, the address is replaced with the subject's —
  never an error. Not found: `/sessions/<id>` → 「找不到这局，链接可能写错了。」;
  `/players/<userId>` → 「找不到这位选手。」; a case → 「链接里的案件不存在了。」, any
  other failure → 「打不开链接里的案件，稍后再试。」. A cancelled session is not a
  404; it shows as cancelled.
- No route starts with `/api`, `/auth` or `/link` (those belong to the API), and
  routing never uses the hash: a `popstate` that only changed the hash is
  ignored. Every host must serve `index.html` for any other path (SPA
  fallback), so the build output must never contain a `404.html`
  (`npm run build:pages` fails if it does).
- History. Every entry the router writes carries `history.state.edg === 1`
  (plus `idx`; an overlay's entry also `sheet` and `layer`; `y` is the scroll
  position to restore). Opening a deep address without that mark (a new tab, a
  bookmark, a link from Discord) puts one `/` entry under it, once — reloading
  never adds another, so one back from such an address reaches the hall. An
  overlay (a sheet or a dialog; the routed drawers are addresses of their own)
  adds one entry at the same address: the back key closes only the topmost
  overlay (one that holds a draft asks first, and keeps its entry if the user
  stays), and closing it from the UI goes back over its entry silently, so the
  next back behaves as if it had never opened. A reload never reopens an
  overlay. `history.scrollRestoration` is `manual`: going back
  restores the scroll position the entry was left at.
- Login return. Right before the top-level jump to the API's `/auth/login`, the
  current address (path and query, no hash) is saved as JSON in
  `sessionStorage['edg.return']` (a page not worth coming back to — `/` or an
  unknown path — saves nothing and drops any old value; a lobby row's
  「登录后报名」 saves that session's address instead), e.g.
  `{"v":1,"path":"/sessions/5","savedAt":1761500000000,"intent":{"kind":"rsvp","sessionId":5,"rsvp":"going"}}`
  (`intent` only when a visitor pressed 来 / 待定 / 不来). On the first signed-in
  load (the OAuth callback lands on `/`; after the first-login dialog, if one
  opens) it is read once and always deleted; a valid one saved less than 30
  minutes ago opens that address. It is only ever an in-app path — at most 512
  characters, starts with `/` but not `//`, no `\` or `#`, an app route other
  than `/` — so it can never become an open redirect. The intent only becomes
  a hint, 「你登录前点的是「来」，确认一下？」: nothing is sent until the user
  presses the button again. A legacy `?case=` / `?session=` link wins over it;
  logging out clears it.
- A case with `redacted: true` says a statement exists (when `statement_at` is
  set) rather than calling it a verdict in absence, and shows no verdict words.
````

要点（脚本会逐条查）：
- 「Only a positive integer id is read」「A link never writes.」两句一字不改，各出现一次（允许跨行折行，脚本把空白压成一个空格再比）。
- 旧的「the parameter is stripped at once」和「if it is among the 200 most recent cases the page shows; else the page opens unscrolled」两处删掉：P1-1 起置顶卡用解析时拿到的记录（`pinnedRecord`），查得到就一定显示。
- 「A pre-verdict case must never render its `delta` as `0` — show the pending range, or 判决后公开 when the API hid it (`pending_hidden`).」逐字是 P1 契约 4.10 末尾写定的句子。
- 其余原有条目（首屏请求、`@shared` 常量、`claim_summary`、邀请排在战报前、fallback 要可区分、`redacted: true`）原样保留、顺序不变，新条目插在深链条目和 `redacted` 条目之间。
- 判决前那句用「老王」举例，不写裸的 `<name>`（GitHub 会把 `<name>` 当成 HTML 标签吞掉，读者只看到「有一起记录…」）。
- 登录回跳写的是 **API 的** `/auth/login`（`src/api.ts`：``AUTH_LOGIN_URL = `${API_BASE}/auth/login` ``，生产在 `capi.nanako.org`），`path` 上限 512（`RETURN_PATH_MAX`）；不值得回来的页面（`/`、未知路径）不存、并删掉旧值，大厅约局行的「登录后报名」存那一局的地址（`plan-P1-3.md`：`saveLoginReturn(intent?, returnTo?)`、`LoginLink` 的 `returnTo`）。

- [ ] **Step 4: 跑 contract 段，确认通过**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs contract; echo "exit=$?"
git diff --stat                                   # 期望：只有 docs/CONTRACT.md
```

期望：`41 passed, 0 failed`、`exit=0`。

- [ ] **Step 5: 提交**

```bash
cd "$(git rev-parse --show-toplevel)"
git add docs/CONTRACT.md
git commit -m "docs: CONTRACT 前端约定改为参数翻译成视图地址，补路由、返回键、登录回跳与 pending_hidden"
git show --stat --format=%B HEAD | head -8      # 期望：只有 docs/CONTRACT.md；没有署名行
```

---

### Task 3: README「路由」一节和角色表

**Files:**
- Modify: `README.md`（`## 技术栈` 之前插入新节；`## 角色` 表游客一行）

- [ ] **Step 1: 跑 readme 段，确认失败**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs readme; echo "exit=$?"
```

期望：`3 passed, 29 failed`、`exit=1`（通过的三条是「链接到的验收清单存在」——Task 1 已建——和空节上的「tables consistent」「no raw HTML tag outside code」）。

- [ ] **Step 2: 插入「## 路由」**

用 Edit 工具：`old_string` 是

```markdown
## 技术栈
```

（README 里这一行只出现一次），`new_string` 是下面四个反引号之间的全部内容——新的一节，末尾空一行，再接原来的 `## 技术栈`：

````markdown
## 路由

前端是单页应用，没有引入路由库：`src/lib/routes.ts`（纯函数）负责解析地址，`src/lib/router.ts` 负责 `history`。手机（窄于 1024px）上约局和选手是整页，顶部有 sticky 的「‹ 返回」；桌面（1024px 及以上）上是右侧抽屉，大厅留在底下。

| 路由 | 呈现（手机 / 桌面） | 内容 | 状态 |
|---|---|---|---|
| `/` | 页面 | 大厅：约局、排行榜和最新动态（P3 改成以约局为中心、带「要你处理」的大厅） | P1 已有 |
| `/sessions/:id` | 页面 / 右侧抽屉 | 约局详情：时间、谁会来、报名；组织者改时间、取消 | P1 已有 |
| `/players/:id` | 页面 / 右侧抽屉 | 选手页：分数、走势、记录 | P1 已有 |
| `/players/:id/cases/:caseId` | 同选手页 | 这一起案件移到最上方（移动，不是复制）并获得焦点 | P1 已有 |
| `/cases/:id` | 别名 | 先查出当事人，再换成上一行的地址 | P1 已有 |
| 其他任何路径 | 页面 | 「这页不存在」，附「回大厅」 | P1 已有 |
| `/sessions/new`（可带 `?again=<id>`） | 页面 / 居中弹窗 | 发起约局 | 计划 P3-4 |
| `/sessions/:id/rollcall` | 页面 | 点名 | 计划 P3-5 |
| `/sessions/history` | 页面 | 约局历史，含被取消的局和取消理由 | 计划 P3-6 |
| `/board`、`/board/feed`、`/board/report`、`/board/rules` | 页面 | 信誉榜 / 动态 / 战报 / 规则 | 计划 P3-6 |
| `/cases/:id/statement` | 全屏写作页 | 当事人写说明 | 计划 P4-2 |
| `/cases/new`（可带 `?session=<id>`） | 页面 | 裁判立案 | 计划 P4-2 |
| `/me`、`/me/notify`、`/me/profile` | 页面 | 我的、通知与 Discord、身份 | 计划 P4-1 |
| `/review` | 页面 | 审理：待确认的升级、待复核的申诉 | 计划 P4-3 |
| `/join`（可带 `?session=<id>`） | 页面 | 给被拉进来的新朋友的入伙引导 | 计划 P4-3 |
| `/admin`（`?tab=ai\|users\|report`） | 页面 | 管理：AI 配置、全部账号、重写周报 | 计划 P4-3 |

「计划」的路由上线之前，打开它们看到的是「这页不存在」。

- **id**：数字 id 只认 `^[1-9]\d{0,14}$`（所以 `/sessions/07` 不是一局）；选手 id 是 OAuth 的 subject，路径里一律 `encodeURIComponent`，最长 128 个字符。`/players/A/cases/7` 里第 7 起的当事人不是 A 时，地址直接换成正确的选手，不报错。
- **后端前缀**：路由不以 `/api`、`/auth`、`/link` 开头，这些归 API。托管必须对其他所有路径返回 `index.html`（SPA 回退），构建产物里不能有 `404.html`（`npm run build:pages` 发现就失败）。
- **旧链接永久可用**：bot 私信里的 `/?session=N` 变成 `/sessions/N`；`/?case=N` 先查一次这起案件，再变成 `/players/<当事人>/cases/N`；`utm` 之类的其他参数原样保留。`/?linked=discord`、`/?onboarding=1` 照旧，bot 不用改。
- **返回键**：直接打开深层地址（新标签页、Discord 私信）时先垫一条 `/`，所以返回一次就回到大厅，刷新不会越垫越多。底部浮层和对话框各占一条历史，返回键只关最上面那一层（有草稿的先问一句）；刷新不会重开浮层；回到大厅时滚动位置还在。
- **登录回跳**：点「登录」之前，当前地址存进 `sessionStorage['edg.return']`（大厅约局行的「登录后报名」存的是那一局的地址），30 分钟内有效，登录回来自动回到原页。未登录时点过的「来 / 待定 / 不来」只变成一句提示，要再点一次才报名，绝不自动提交。
- 细节以 [docs/CONTRACT.md「Frontend expectations」](./docs/CONTRACT.md#frontend-expectations) 为准；真机验收清单见 [docs/redesign-v5/p1-acceptance.md](./docs/redesign-v5/p1-acceptance.md)。

## 技术栈
````

注意：这段文字里有 `` `^[1-9]\d{0,14}$` `` 和 `\|`。用 Edit 工具原样写入；**不要**用 JS 的 `String.prototype.replace(旧, 新字符串)` 之类的脚本插入，`$` 加反引号会被当成替换模式，把前文重复插进去。表格里 `?tab=ai\|users\|report` 的反斜杠是 GitHub 表格里转义 `|` 的写法，保留。

- [ ] **Step 3: 角色表的游客一行跟上 B1-1**

用 Edit 工具把

```markdown
选手主页（看得到案由、扣了几分和状态；陈述、申诉理由和判词只给当事人、立案人、裁判和管理员看）
```

换成

```markdown
选手主页（判决后看得到案由、扣了几分和状态，判决前只显示「有一起记录在处理中」；陈述、申诉理由和判词只给当事人、立案人、裁判和管理员看）
```

这一行的其余部分（`| 游客（未登录 / 未上榜） | 只读：查看排行榜、记录列表、` 和末尾的 ` |`）不动。

- [ ] **Step 4: 跑 readme 段，确认通过**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs readme; echo "exit=$?"
grep -n '^## ' README.md        # 期望：……「## 角色」「## 路由」「## 技术栈」……依次相邻
git diff --stat                 # 期望：只有 README.md
```

期望：`32 passed, 0 failed`、`exit=0`。

- [ ] **Step 5: 提交**

```bash
cd "$(git rev-parse --show-toplevel)"
git add README.md
git commit -m "docs: README 新增路由一节，角色表补判决前脱敏"
git show --stat --format=%B HEAD | head -8      # 期望：只有 README.md；没有署名行
```

---

## 对契约的补充

P1 契约第 2 节写的 P1-4 范围是「`docs/CONTRACT.md`『Frontend expectations』、README 新增『路由』、新建 `p1-acceptance.md`，不碰代码」，第 5 节列了要写进去的内容。下面几处是本计划补上、契约没写到的，理由附后：

1. **`docs/CONTRACT.md` 的 `interface RecordItem` 也改**（`type`、`range` 可空，`note` 注释，新增 `pending_hidden?: true` 和说明）。理由：CONTRACT.md 开头写明它是前后端「single source of truth」，「MUST match this document exactly」；B1-1 按契约不改 CONTRACT.md，P1 里只有本 PR 动它。只改 Frontend expectations 而不改数据形状，文档会自相矛盾（一边说 `type` 永远是 `ViolationType`，一边说前端要处理 `pending_hidden`）。改动只写 API 实际输出（P1 契约 4.10），不新增字段名。
2. **README「角色」表游客一行补一句判决前的说法**。理由：原文「选手主页（看得到案由、扣了几分和状态…）」在 B1-1 之后对判决前的案件不再成立；本 PR 本来就改 README，顺手改掉一句错话，不改表的结构。
3. **CONTRACT.md 是英文文档**，spec 的「参数被翻译成该视图自己的地址」译成 `the parameter is translated into that view's own address`；两句锁定的英文原句一字不改，只允许折行。中文用户文案（404、提示语）照 spec / 代码原文用中文引用。
4. **删掉旧深链条目里「200 most recent cases … else the page opens unscrolled」那半句**。理由：P1-1 起 `/?case=N` 先 `GET /api/records/N`，置顶卡用这份记录（`pinnedRecord`），不再依赖选手页列表里有没有它；保留这半句会误导。
5. **验收清单在契约第 9 节的五部分之外多了第 0 节（怎么填）、第 6 节（需要改代码时）、第 7 节（已知风险）、2.3 托管复测（H-01、H-02）、M-25（判决前脱敏的样子），以及从 P1-2、P1-3 计划的「手动检查」收进来的 M-26（大厅约局行的「登录后报名」）、M-27（被篡改的 `edg.return`）、M-28（Chrome 的 history manipulation intervention）、M-29（浮层里导航后的滚动恢复，可选）、M-30（账号菜单盖在「‹ 返回」条上，P1-1）、D-08（桌面的登录回跳）**，步骤都编了号。理由：P1-5 是唯一会在部署后的真实页面上看 P1-0、B1-1 结果的地方；编号让第 4 节的「步骤」一栏能直接引用。另外，契约第 9 节第 2 步的期望本来就是数返回键（「返回键仍然只需要一次就到大厅」）；清单在第 0 节明确写出不要拿 `history.length` 判断浮层关没关（契约第 5 节 P1-2 的「界面关闭后历史栈长度回到打开前」是对实现的测试口径，不是给人看的）：真浏览器里 `history.back()` 之后 `history.length` 不会变小（能「前进」的条目也算在内），拿它判断会误报；`history.length` 只用在「刷新不让历史变长」（M-09）这一项。
6. **不改 `docs/redesign-v5/README.md`（设计文档索引）**。理由：契约没把它列给 P1-4；领队把 P1 计划收进 `docs/redesign-v5/plan-p1/` 时会一起加索引行，本 PR 先加会和那次改动撞车。验收清单从根 README 的「路由」一节可以直接点到。
7. **没有新测试文件，也不往现有测试里追加断言**（契约第 1 节「+ P1-4：无」）。文档的检查放在仓库外的一次性脚本里，不提交。
8. **验收清单写明了各步骤的前提数据**：N 不能是测试账号自己组织的局、账号在这局还没回「来」（`SessionDetailDialog` 的 `canRsvp` 排除组织者；P1-3 的 ResumeHint 在 `my_rsvp === resumeRsvp` 时不出现）；C_self 必须是 `decided` 且没申诉过（`CaseActions` 只在 `isSelf && status === 'decided'` 时给「申诉」）。理由：不写前提，领队拿错数据会把正常行为记成缺陷。

---

## 收尾

- [ ] **全部检查一次**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
node /tmp/p1-4-doc-checks.mjs all; echo "exit=$?"
```

期望：`121 passed, 0 failed`、`exit=0`。

- [ ] **确认没碰代码**

```bash
git diff --stat claude/p1-3-login-return..HEAD
# 期望：正好 3 个文件：README.md、docs/CONTRACT.md、docs/redesign-v5/p1-acceptance.md
git diff --name-only claude/p1-3-login-return..HEAD -- src worker server shared tests scripts index.html
# 期望：无输出
git log --oneline claude/p1-3-login-return..HEAD
# 期望：3 个提交，依次是 docs: 新增 P1-5…、docs: CONTRACT…、docs: README…
git log --format=%B claude/p1-3-login-return..HEAD | grep -ciE 'co-authored-by|generated with'
# 期望：0
git status --short
# 期望：无输出
```

- [ ] **原有套件不变**

```bash
cd "$(git rev-parse --show-toplevel)"
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | tail -6
npm run test:dom 2>&1 | tee /tmp/p1-4-dom-end.log | tail -6
grep -c 'not wrapped in act' /tmp/p1-4-dom-end.log
```

期望：typecheck 通过；unit **29 个文件 / `U0` 个用例**全过，dom **24 个文件 / `D0` 个用例**全过，和 Task 0 Step 4 记下的完全一样（本 PR 增量为 0）；act 警告行数等于 `W0`。

- [ ] **人工看一遍渲染**

在编辑器的 Markdown 预览（或 GitHub 的文件预览）里打开三份文件：
- README「路由」表 16 行、4 列不错位；`/admin` 那一行显示成 `?tab=ai|users|report`；两个链接分别跳到 CONTRACT 的「Frontend expectations」和验收清单。
- CONTRACT「Frontend expectations」里缩进在列表项下的路由表能渲染成表格（列表项内表格前后各有一个空行）；「老王有一起记录在处理中，判决后公开。」整句可见。
- 验收清单的四张步骤表、环境表、发现与修复表都渲染正常；第 0 节的控制台那一行是代码块。

- [ ] **交给领队**：P1-5 由领队按 `docs/redesign-v5/p1-acceptance.md` 执行（第 2 节可在桌面浏览器做，第 3 节要真机）。执行代理不勾第 3 节；只有第 4 节出现要修的项时才从 `claude/p1-4-docs` 开 `claude/p1-5-device-fixes`。`/tmp/p1-4-doc-checks.mjs` 可留可删，不进仓库。

---

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| spec §2.3 末条：CONTRACT.md:410-417 改成「参数被翻译成该视图自己的地址」，两句英文原样 | Task 2 Step 3；脚本 `contract` 段前五条 |
| spec §9 P1-4「CONTRACT.md『Frontend expectations』改写」 | Task 2 |
| P1 契约 4.10 末：补「… or 判决后公开 when the API hid it (`pending_hidden`)」 | Task 2 Step 3 |
| P1 契约第 5 节 P1-4：新增路由表、`edg.return`、浮层与返回键的说明 | Task 2 Step 3（Routes、No route starts with、History、Login return 四条） |
| spec §2.2 路由规则（数字 id、用户 id、两 id 对不上、404 文案、不用 hash、保留前缀、不放 404.html） | Task 2 Step 3；Task 3 Step 2 的规则条目 |
| spec §8 B1-1 / §11 第 3 条档位 (b) 的 API 形状 | Task 2 Step 2（RecordItem）；Task 3 Step 3（角色表）；验收 M-25 |
| spec §9 P1-4「README 列出路由表」（标明 P1 已有的五条和后续阶段的） | Task 3 Step 2（6 行「P1 已有」含 NotFound，10 行「计划 P3-x / P4-x」） |
| spec §9 P1-5：iOS Safari、Android Chrome 的返回键 | 验收 R-01、R-02、R-05（系统返回键、手势返回、左缘右滑） |
| spec §9 P1-5：浮层入栈 | 验收 M-05～M-07、M-10～M-13、D-05、R-02、R-05 |
| spec §9 P1-5：垫 `/` | 验收 M-08、M-09、R-03、R-04 |
| spec §9 P1-5：滚动恢复 | 验收 M-03、M-04、D-01、R-10 |
| spec §9 P1-5：sheet 的安全区 | 验收 R-06；第 7 节「安全区」 |
| P1 契约第 9 节第 2 步的每一条模拟项 | M-01～M-04（点局、返回、滚动）、M-05～M-07（改时间 sheet）、M-11～M-13（申诉离开确认）、M-08～M-09（新标签页、刷新 3 次）、M-10（开着 sheet 刷新）、M-14～M-15（旧链接）、M-16～M-20（纠正与 404）、M-22～M-24（登录回跳）、D-01～D-07（桌面抽屉） |
| P1-1、P1-2、P1-3 计划「手动检查」里清单原来没有的项 | M-24（返回后再进不再提示）、M-26、M-27、M-28、M-29、M-30、D-08 |
| P1 契约第 9 节第 3 步的真机附加项 | R-01（系统返回键、手势、左缘右滑）、R-06（安全区）、R-07（滚动不带动背景）、R-09（跨 1024px）、R-08（sticky PageBar 不抖） |
| P1 契约第 9 节第 1、4、5 步（环境、发现与修复表、结论）和修复分支规则 | 验收第 1、4、5、6 节 |
| 浏览器模拟 375×812（DPR 3、触控）与 1280×800 的设置步骤 | 验收第 2 节开头 |
| spec §11 第 16 条（遗留 Functions 已删）部署后的复测 | Task 0 Step 2 的前两条；验收 H-02 |
| spec §10 第 5 条（路由的维护面、所有托管配 SPA 回退） | 验收 H-01；CONTRACT「No route starts with」条 |
| P1 契约第 2 节「P1-4 不碰代码」、第 1 节「+ P1-4 测试文件数不变」 | 收尾「确认没碰代码」「原有套件不变」 |
| 机主规则：提交 `<type>: <中文描述>`、无署名行；不 rebase / push / 开 PR | Task 1～3 Step 5；收尾的 `grep -ciE` |
| GitHub 渲染：反引号外不写会被当成 HTML 标签的尖括号 | 脚本三段各一条 `no raw HTML tag outside code`；收尾「人工看一遍渲染」 |
| 桌面浏览器模拟的可操作性（设备模拟只对当前标签页生效、「直接打开」的定义、新标签页的替代做法） | 验收第 0 节「直接打开 X」、M-08 的 `about:blank` |

---
