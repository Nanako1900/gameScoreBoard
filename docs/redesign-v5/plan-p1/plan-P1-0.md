# P1-0 托管核验与遗留清理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 让 P1 的新地址（`/sessions/1`、`/players/x/cases/7`…）在每个托管上都落到 SPA：`npm run build:pages` 拒绝任何含 `404.html` 的产物；删除 Cloudflare Pages 会误部署成 Pages Functions 的 EdgeOne 遗留（`functions/api`、`functions/auth`、`edgeone.json`）并写明原因；用测试锁住旧主机 302 对 P1 地址保留 path 和 query；把核验结果写进 `docs/DEPLOY-PAGES.md`。

**Architecture：** 只动构建脚本、测试和文档。`scripts/pages-headers.mjs` 在写 `_headers` 之前递归扫描输出目录，发现 `404.html` 就抛错（构建非零退出）。`worker/http.ts` 的 `legacySpaRedirect` 和 `worker/index.ts` 的 `app.all('*')` 仍是线上代码（`server/src/api.ts` 把 Worker app 原样编进 Node，`capi.nanako.org` 设了 `FRONTEND_URL`），本 PR 只给它加测试、不改实现。`wrangler.toml` 的 `[assets] not_found_handling = "single-page-application"`、`run_worker_first = true` 是已下线的 Worker 单源部署的配置，生产上已是死配置，只在本地 `wrangler dev` / `npm run preview` 还用得到：只核验、不改（契约第 2 节）。

**Tech Stack：** Node 24（`export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`）、Vite 6、Vitest 3（unit：`vitest.config.ts`；worker：`vitest.workers.config.ts`，Miniflare）、wrangler 4（只用 `wrangler pages dev` 做本地核验）、Cloudflare Pages。

**依赖：** P0 全部合入的 `claude/p0-5-safety-net`（契约第 1 节基线：unit 26 文件 / 326 用例，dom 20 / 219，worker 15 / 548 + 9 todo）。不消费任何其他 P1 接口。

**分支：** `claude/p1-0-hosting`，从本地分支 `claude/p0-5-safety-net` 开（`git switch -c claude/p1-0-hosting claude/p0-5-safety-net`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR。下一个 PR（B1-1 `claude/b1-1-redact`）从本分支 HEAD 开。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/pages-headers.mjs` | 改 | Pages 构建的后处理：原有的 `_headers` 生成（CSP 一个字不改）之前，先 `assertSpaFallback(outDir)`：递归找 `404.html`，找到就抛错让 `build:pages` 失败 |
| `tests/unit/pages-headers.test.ts` | 改（import 行扩充 + 末尾追加两个 `describe`） | 原 5 个用例不动；新增「产物有 `404.html` 就失败（顶层 / 嵌套）、正常产物通过」3 例，「仓库根没有 `functions/`、没有 `edgeone.json`」1 例 |
| `functions/api/[[default]].js` | 删 | EdgeOne 边缘函数：把 `/api/*` 反代到已下线的 `gamescoreboard-bn.me-22e.workers.dev`。Cloudflare Pages 会把根目录 `functions/` 部署成 Pages Functions，所以它现在实际挂在 `community.nanako.org/api/*` 上 |
| `functions/auth/[[default]].js` | 删 | 同上，`/auth/*` |
| `edgeone.json` | 删 | EdgeOne 构建配置，EdgeOne 已不用 |
| `tests/unit/source-hygiene.test.ts` | 改（只改 `SOURCE_DIRS` 一行） | 删掉 `'functions'`：目录不在了，`readdirSync` 会 ENOENT（规划副本实测）。P1-1 在文件**末尾**追加 describe，与这一行不冲突 |
| `tests/worker/split-deploy.test.ts` | 改（末尾追加一个 `describe`） | 旧主机对 `/sessions/5?x=1`、`/players/a%2Fb/cases/7?utm=dc` 的 302 Location 保留 path 和 query、`no-store` |
| `tests/worker/node-api.test.ts` | 改（末尾追加一个 `describe`） | 生产路径（Node 包装 + `FRONTEND_URL`）对 `/sessions/5?x=1` 同样 302；这个文件在 CI 的 PG 轮里也跑 |
| `README.md` | 改（「## 部署」里 EdgeOne 那一条） | 写明 EdgeOne 已停用、遗留文件已删、原因见核验记录 |
| `DEPLOY-EDGEONE.md` | 改（标题下插一段「已停用」） | 正文不删，只作历史参考 |
| `docs/DEPLOY-PAGES.md` | 改（第 2 步「注意：仓库根目录的 `functions/`」那三行、第 7/8 步「**注意**：EdgeOne 边缘函数反代」那四行 + 文末新增一节） | 准备步骤改成「根目录不能有 `functions/`、dist 不能有 `404.html`」；第 7、8 步的 EdgeOne 提醒改成「P1-0 已删除」；新增「## SPA 回退核验（P1-0）」记录每个托管的结论和实测 |

不碰：任何 `src/`、`worker/`、`server/` 源码；`wrangler.toml`；`.github/workflows/*`；`vite.config.ts`；`.dev.vars.example`。

---

### Task 0：开分支、核对基线

**Files：** 无改动。

- [ ] **Step 1：开分支，确认干净**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git rev-parse --verify claude/p0-5-safety-net   # 不存在就停下，报告「上游分支 claude/p0-5-safety-net 不存在」
git switch -c claude/p1-0-hosting claude/p0-5-safety-net
git status --porcelain                          # 期望：无输出
```

- [ ] **Step 2：核对本计划要改的锚点都在**

```bash
ls functions/api functions/auth edgeone.json
grep -n "const SOURCE_DIRS = \['worker', 'shared', 'src', 'tests', 'migrations', 'functions'\];" tests/unit/source-hygiene.test.ts
grep -n "^const outDir = process.argv\[2\] ?? 'dist';" scripts/pages-headers.mjs
grep -n "^import { writeFileSync } from 'node:fs';" scripts/pages-headers.mjs
grep -n "^import { mkdtempSync, readFileSync } from 'node:fs';" tests/unit/pages-headers.test.ts
grep -n "export function legacySpaRedirect" worker/http.ts
grep -n "legacySpaRedirect(c.env, c.req.url)" worker/index.ts
grep -n "ASSETS: NO_ASSETS" server/src/api.ts
grep -n 'not_found_handling = "single-page-application"' wrangler.toml
grep -n '^run_worker_first = true' wrangler.toml   # 只要第 12 行那条配置，不要第 6 行的注释
grep -nF 'FRONTEND_URL: ${FRONTEND_URL:-https://community.nanako.org}' compose.yaml   # 期望 2 行（api、bot 两个服务）；-F：BSD grep 把中间的 $ 当锚点
grep -n "functions/" docs/DEPLOY-PAGES.md        # 期望 4 行（分支上实测在 48、50、82、85 行；行号会漂，认文字：第 2 步「注意：仓库根目录的 `functions/`」两行、第 7/8 步两行）
grep -n "腾讯 EdgeOne Pages" README.md            # 期望 1 行（「## 部署」一节里「**拆分部署**」那一条，分支上在 277 行）
ls dist/404.html public 2>&1                    # 期望：两个都 No such file
```

任何一条对不上（文件不存在、锚点文字不同）就停下报告，不在本 PR 里补别人的文件。

- [ ] **Step 3：跑基线并记下数字**

```bash
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
```

期望（契约第 1 节）：unit `26 passed (26)` / `326 passed (326)`；dom `20 passed (20)` / `219 passed (219)`；worker `15 passed (15)` / `548 passed | 9 todo (557)`。把实际值记为 U0、D0、W0；后面所有「期望」都按「U0 + 增量」理解。对不上就停下。

---

### Task 1：`build:pages` 拒绝含 `404.html` 的产物

**Files：**
- Modify: `tests/unit/pages-headers.test.ts`（import 行 + 末尾追加）
- Modify: `scripts/pages-headers.mjs`

- [ ] **Step 1：写失败的测试**

把 `tests/unit/pages-headers.test.ts` 第 5 行

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
```

改成

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
```

然后在文件末尾（最后一个 `});` 之后）追加：

```ts

// P1-0: Cloudflare Pages only falls back to index.html (the SPA) when the deploy
// has no top-level 404.html; spec §2.2 bans one anywhere in dist, nested included.
describe('scripts/pages-headers.mjs refuses a dist with 404.html', () => {
  function distWith(files: readonly string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pages-dist-'));
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), '<!doctype html>');
    }
    return dir;
  }

  function buildFails(dir: string): { status: number | null; stderr: string } | null {
    try {
      execFileSync(process.execPath, [SCRIPT, dir], {
        env: { ...process.env, VITE_API_BASE: 'https://capi.nanako.org' },
        stdio: 'pipe',
      });
      return null;
    } catch (err) {
      const failure = err as { status: number | null; stderr: Buffer };
      return { status: failure.status, stderr: failure.stderr.toString('utf8') };
    }
  }

  it('fails on a top-level 404.html, names it, and writes no _headers', () => {
    const dir = distWith(['index.html', '404.html']);
    const failure = buildFails(dir);
    expect(failure).not.toBeNull();
    expect(failure?.status).not.toBe(0);
    expect(failure?.stderr).toContain('404.html');
    expect(existsSync(path.join(dir, '_headers'))).toBe(false);
  });

  it('fails on a nested 404.html too, naming its path inside dist', () => {
    const failure = buildFails(distWith(['index.html', 'assets/404.html']));
    expect(failure).not.toBeNull();
    expect(failure?.status).not.toBe(0);
    expect(failure?.stderr).toContain('assets/404.html');
  });

  it('passes a normal Vite output (index.html + assets/)', () => {
    const dir = distWith(['index.html', 'assets/index-abc123.js']);
    expect(buildFails(dir)).toBeNull();
    expect(readFileSync(path.join(dir, '_headers'), 'utf8')).toContain('Content-Security-Policy:');
  });
});
```

说明：`buildFails` 里的 `distWith` 是本 describe 内的局部函数；`SCRIPT`、`execFileSync`、`tmpdir`、`path` 都是文件顶部已有的。原有 5 个用例和 `run`/`csp` 两个辅助函数一个字不改（`pages-headers.test.ts:32-55` 的 CSP 断言被契约第 7 节锁住）。

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/pages-headers.test.ts
```

期望：`Tests  2 failed | 6 passed (8)`。失败的是 `fails on a top-level 404.html…`（`expected null not to be null`）和 `fails on a nested 404.html too…`（同样的消息）；`passes a normal Vite output` 已经通过。

- [ ] **Step 3：实现**

`scripts/pages-headers.mjs` 改三处。

(a) 文件头注释：把

```js
// Usage: VITE_API_BASE=https://capi.nanako.org node scripts/pages-headers.mjs [dist]

import { writeFileSync } from 'node:fs';
```

改成

```js
// It also guards the SPA fallback (P1-0): Cloudflare Pages serves index.html for
// unknown paths (/sessions/1, /players/x/cases/7) only when the deploy has no
// 404.html, so a dist that contains one fails the build here.
//
// Usage: VITE_API_BASE=https://capi.nanako.org node scripts/pages-headers.mjs [dist]

import { readdirSync, writeFileSync } from 'node:fs';
```

(b) 在 `buildHeaders` 函数结束（`].join('\n');` 下一行的 `}`）和 `const outDir = process.argv[2] ?? 'dist';` 之间插入：

```js

/** A top-level one switches Cloudflare Pages off SPA mode (spec §2.2 bans it anywhere). */
const NOT_FOUND_PAGE = '404.html';

/**
 * Every 404.html under dir, as a path relative to root with forward slashes.
 * Outside SPA mode Pages serves the nearest 404.html up the tree, so a nested
 * one is refused too: the build never ships a page that can shadow a route.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function notFoundPages(root, dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return notFoundPages(root, full);
    if (entry.name !== NOT_FOUND_PAGE) return [];
    return [path.relative(root, full).split(path.sep).join('/')];
  });
}

/** @param {string} outDir */
function assertSpaFallback(outDir) {
  const found = notFoundPages(outDir, outDir);
  if (found.length === 0) return;
  throw new Error(
    `构建产物里不能有 ${NOT_FOUND_PAGE}（找到：${found.join('、')}）：` +
      'Cloudflare Pages 看到它就不再把未知路径回退到 index.html，/sessions/1 这类地址会变成 404。删掉它再构建。',
  );
}
```

(c) 把文件末尾的

```js
const outDir = process.argv[2] ?? 'dist';
writeFileSync(path.join(outDir, '_headers'), buildHeaders(process.env.VITE_API_BASE));
```

改成

```js
const outDir = process.argv[2] ?? 'dist';
assertSpaFallback(outDir); // before writing anything: a refused dist never looks deployable
writeFileSync(path.join(outDir, '_headers'), buildHeaders(process.env.VITE_API_BASE));
```

最后一行原有的 `console.log(\`wrote …\`)` 不动（构建日志，不是本 PR 新增的；`source-hygiene` 只扫 `src/` 等目录且不查 console）。不用 `readdirSync(…, { recursive: true })`：Pages 构建镜像的 Node 版本不受本仓库控制，手写递归在任何 Node 18+ 上都一样。

- [ ] **Step 4：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/pages-headers.test.ts
```

期望：`Tests  8 passed (8)`。

- [ ] **Step 5：用真实构建再验一次（不提交任何临时文件）**

```bash
mkdir -p public && printf '<!doctype html>' > public/404.html
VITE_API_BASE=https://capi.nanako.org npm run build:pages; echo "exit=$?"
```

期望：`exit=1`，输出里有 `Error: 构建产物里不能有 404.html（找到：404.html）：Cloudflare Pages 看到它就不再把未知路径回退到 index.html…`（Vite 把 `public/` 原样拷进 `dist/`，这正是 404.html 最可能混进来的路）。

```bash
rm -rf public
VITE_API_BASE=https://capi.nanako.org npm run build:pages; echo "exit=$?"
ls dist
git status --porcelain
```

期望：`exit=0`，最后一行 `wrote dist/_headers`；`ls dist` 是 `_headers  assets  index.html`；`git status --porcelain` 只列出 `M scripts/pages-headers.mjs` 和 `M tests/unit/pages-headers.test.ts`（`dist/` 在 `.gitignore` 里）。

- [ ] **Step 6：提交**

```bash
git add scripts/pages-headers.mjs tests/unit/pages-headers.test.ts
git commit -m "feat: build:pages 发现产物里有 404.html 就失败，守住 Pages 的 SPA 回退"
```

---

### Task 2：删除 EdgeOne 遗留（`functions/`、`edgeone.json`）

**Files：**
- Modify: `tests/unit/pages-headers.test.ts`（末尾追加）
- Delete: `functions/api/[[default]].js`、`functions/auth/[[default]].js`、`edgeone.json`
- Modify: `tests/unit/source-hygiene.test.ts`（`SOURCE_DIRS` 一行）

- [ ] **Step 1：写失败的测试**

在 `tests/unit/pages-headers.test.ts` 末尾（Task 1 追加的 describe 之后）追加：

```ts

// P1-0 (spec §11 #16): Cloudflare Pages deploys a root functions/ directory as
// Pages Functions. The EdgeOne leftovers there reverse-proxied /api/* and /auth/*
// on community.nanako.org to the retired workers.dev Worker.
describe('Cloudflare Pages project root', () => {
  const ROOT = path.resolve(__dirname, '../..');

  it('has no functions/ directory and no edgeone.json', () => {
    expect(existsSync(path.join(ROOT, 'functions'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'edgeone.json'))).toBe(false);
  });
});
```

- [ ] **Step 2：跑测试，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/pages-headers.test.ts
```

期望：`Tests  1 failed | 8 passed (9)`，失败的是 `Cloudflare Pages project root > has no functions/ directory and no edgeone.json`，消息 `expected true to be false`。

- [ ] **Step 3：删除文件**

```bash
git rm -r functions edgeone.json
ls functions edgeone.json 2>&1    # 期望：两个都 No such file or directory
```

- [ ] **Step 4：跑 unit 全量，看到 source-hygiene 因目录不存在而失败**

```bash
npx vitest run --config vitest.config.ts
```

期望：`Tests  1 failed | 329 passed (330)`（按 U0 + 4 − 1 理解）。失败的是 `tests/unit/source-hygiene.test.ts > source files > contain no raw NUL bytes`，错误 `ENOENT: no such file or directory, scandir '…/functions'`。

- [ ] **Step 5：改 source-hygiene 的目录表**

`tests/unit/source-hygiene.test.ts` 第 12 行，把

```ts
const SOURCE_DIRS = ['worker', 'shared', 'src', 'tests', 'migrations', 'functions'];
```

改成

```ts
const SOURCE_DIRS = ['worker', 'shared', 'src', 'tests', 'migrations'];
```

文件其他部分不动（P1-1 会在文件末尾追加 `describe('history API')`）。

- [ ] **Step 6：跑测试，确认通过**

```bash
npx vitest run --config vitest.config.ts
grep -rn "functions/api\|functions/auth\|edgeone.json" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.json' src worker server shared scripts tests | grep -v node_modules
```

（`--include` 的通配符必须加引号：Bash 工具的 shell 是 zsh，不加引号会直接报 `no matches found`。）

期望：`Test Files  26 passed (26)`、`Tests  330 passed (330)`（U0 + 4）；grep 只命中 `tests/unit/pages-headers.test.ts` 里本 Task 写的 2 行（`it('has no functions/ directory and no edgeone.json'` 和 `existsSync(path.join(ROOT, 'edgeone.json'))`），没有源码再引用这些文件。

- [ ] **Step 7：提交**

```bash
git add tests/unit/pages-headers.test.ts tests/unit/source-hygiene.test.ts   # 删除已由 git rm 暂存
git status --short                       # 期望：3 行 D（两个 functions 文件、edgeone.json）+ 2 行 M
git commit -m "chore: 删除 EdgeOne 遗留的 Pages Functions 和 edgeone.json（EdgeOne 已停用，Cloudflare Pages 会把 functions/ 挂到 /api、/auth 上）"
```

---

### Task 3：锁住旧主机 302 对 P1 地址保留 path 和 query

**Files：**
- Modify: `tests/worker/split-deploy.test.ts`（末尾追加）
- Modify: `tests/worker/node-api.test.ts`（末尾追加）

核验结论（写进 Task 5 的文档）：`legacySpaRedirect`（`worker/http.ts`，锚点 `export function legacySpaRedirect(env: Env, requestUrl: string): string | null`）返回 `` `${frontend.origin}${url.pathname}${url.search}` ``，`worker/index.ts` 的 `app.all('*', …)` 在它非空时 `c.redirect(target, 302)` 并加 `Cache-Control: no-store`。旧 Worker 部署虽已下线，这段代码仍通过 `server/src/api.ts`（`worker.fetch(withForwardedProto(request), env, ctx)`）跑在 `capi.nanako.org` 上，`compose.yaml` 默认 `FRONTEND_URL=https://community.nanako.org`。所以实现不用改，只补测试。这两条测试**写完就会通过**（是给现有行为上锁），Step 3 用一次临时改坏来证明它们真能抓住回归。

- [ ] **Step 1：写测试**

`tests/worker/split-deploy.test.ts` 末尾追加（`call`、`API`、`SPA`、`SPLIT` 都是文件顶部已有的）：

```ts

// P1-0: the P1 routes (/sessions/:id, /players/:id/cases/:caseId) are plain SPA
// paths, so an old link on this host must land on the same address over there.
describe('old links to the P1 routes', () => {
  it('302s /sessions/5?x=1 to the same path and query on FRONTEND_URL', async () => {
    const res = await call(`${API}/sessions/5?x=1`, {}, SPLIT);
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Location')).toBe(`${SPA}/sessions/5?x=1`);
  });

  it('keeps an encoded player id and the case segment as they were', async () => {
    const res = await call(`${API}/players/a%2Fb/cases/7?utm=dc`, {}, SPLIT);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`${SPA}/players/a%2Fb/cases/7?utm=dc`);
  });
});
```

`tests/worker/node-api.test.ts` 末尾追加（`api` 是文件顶部已有的 `createApi(buildEnv({ ...BASE_ENV, ...extra }, testEnv.DB), …)` 包装）：

```ts

// P1-0: production capi.nanako.org is this Node wrapper with FRONTEND_URL set
// (compose.yaml). Old SPA links that still hit the API host keep path and query.
describe('createApi — old SPA links on the API host', () => {
  it('302s /sessions/5?x=1 to FRONTEND_URL, uncacheable', async () => {
    const res = await api({ FRONTEND_URL: 'https://community.example.com' }).fetch(
      new Request('https://api.example.com/sessions/5?x=1'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Location')).toBe('https://community.example.com/sessions/5?x=1');
  });
});
```

- [ ] **Step 2：跑测试**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/split-deploy.test.ts tests/worker/node-api.test.ts
```

期望：`Test Files  2 passed (2)`、`Tests  30 passed (30)`（split-deploy 13、node-api 17）。

- [ ] **Step 3：证明测试能抓住回归（临时改坏，再还原）**

```bash
sed -i.bak 's|return `${frontend.origin}${url.pathname}${url.search}`;|return `${frontend.origin}${url.pathname}`;|' worker/http.ts
npx vitest run --config vitest.workers.config.ts tests/worker/split-deploy.test.ts tests/worker/node-api.test.ts
mv worker/http.ts.bak worker/http.ts
git diff --stat worker/                 # 期望：无输出（已还原）
```

期望（改坏期间）：`Tests  4 failed | 26 passed (30)`，失败的是新加的 3 条，加上原有的 `links to the old SPA host > redirect to the same path and query on FRONTEND_URL — temporary and uncacheable`。还原后 `git diff --stat worker/` 必须为空。

- [ ] **Step 4：跑 worker 全量**

```bash
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
```

期望：`Test Files  15 passed (15)`、`Tests  551 passed | 9 todo (560)`（W0 + 3）。

- [ ] **Step 5：提交**

```bash
git add tests/worker/split-deploy.test.ts tests/worker/node-api.test.ts
git commit -m "test: 锁住旧主机把 /sessions/5?x=1 这类 P1 地址原样 302 到 FRONTEND_URL"
```

---

### Task 4：本地核验 Pages 的 SPA 回退（不提交）

**Files：** 无改动；结果填进 Task 5 的文档。

`wrangler pages dev` 按 Cloudflare Pages 的规则托管 `dist/`，而且会像线上一样把根目录 `functions/` 编成 Pages Functions，所以能在本地复现「删除前 / 删除后」的差别。规划时（wrangler 4.107）实测：删除前日志有 `✨ Compiled Worker successfully`、`/api/config` 被反代到 workers.dev 拿回 404；删除后没有这一行、`/api/config` 返回 SPA 的 index.html。规划时本地**没有**看到 `_headers` 里的 CSP 生效，所以 CSP 只在 PR 预览上核（收尾第 3 部分）。

- [ ] **Step 1：构建并起本地 Pages**

```bash
VITE_API_BASE=https://capi.nanako.org npm run build:pages
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 > /tmp/p1-0-pages-dev.log 2>&1 &
echo $! > /tmp/p1-0-pages-dev.pid
sleep 12
```

（用 Bash 工具时也可以 `run_in_background`；端口被占就换 8789 并同步改下面的命令。）

- [ ] **Step 2：逐个地址实测**

```bash
for p in /sessions/1 /players/x/cases/1 /cases/7 /xyz /api/config /auth/login; do
  printf '%-20s ' "$p"
  curl -s -o /tmp/p1-0-body.txt -w '%{http_code} %{content_type} ' --max-time 10 "http://127.0.0.1:8788$p"
  grep -q '<div id="root"></div>' /tmp/p1-0-body.txt && echo 'SPA shell' || echo 'NOT SPA'
done
grep -c "Compiled Worker successfully" /tmp/p1-0-pages-dev.log
grep -c "No Functions" /tmp/p1-0-pages-dev.log
kill "$(cat /tmp/p1-0-pages-dev.pid)"; sleep 1
pkill -f "wrangler pages dev dist --port 8788" || true   # npx 的子进程（workerd）有时不随父进程退出
```

期望：6 行全是 `200 text/html; charset=utf-8 SPA shell`；第一个 `grep -c` 输出 `0`（没有 Pages Functions 被编译），第二个输出 `1`（wrangler 打印 `No Functions. Shimming...`）。任何一行不是 `SPA shell` 就停下排查（多半是 `dist/` 不对或 `functions/` 没删干净），不要继续写文档。

- [ ] **Step 2b：本地核验 Worker 单源部署的回退（spec §9 P1-0 ③，只核验）**

`wrangler.toml` 的 `[assets]` 在生产上已是死配置（Worker 部署已下线），但 `npm run dev` / `npm run preview` / `npm run deploy` 还读它，所以本地实测一次，结果写进 Task 5 的核验表：

```bash
npx wrangler dev --port 8792 --ip 127.0.0.1 > /tmp/p1-0-worker-dev.log 2>&1 &
echo $! > /tmp/p1-0-worker-dev.pid
sleep 20
for p in /sessions/1 /players/x/cases/1 /xyz /api/config; do
  printf '%-20s ' "$p"
  curl -s -o /tmp/p1-0-body.txt -w '%{http_code} %{content_type} ' --max-time 10 "http://127.0.0.1:8792$p"
  grep -q '<div id="root"></div>' /tmp/p1-0-body.txt && echo 'SPA shell' || echo 'NOT SPA'
done
kill "$(cat /tmp/p1-0-worker-dev.pid)"; sleep 1
pkill -f "wrangler dev --port 8792" || true
```

期望：前 3 行 `200 text/html; charset=utf-8 SPA shell`（`run_worker_first` → `app.all('*')` → `ASSETS` → `not_found_handling = "single-page-application"`）；`/api/config` 是 `application/json`、`NOT SPA`。本地 D1 没建表时它是 `500 {"error":"服务器内部错误"}`（规划审查时实测如此），这没关系：要证明的只是 `/api` 归 Worker、不被 SPA 回退吞掉。不要为此跑 `npm run db:local`（会写本地 D1 状态，与本 PR 无关）。`.wrangler/` 在 `.gitignore` 里。

- [ ] **Step 3：记下生产现状（只发 GET）**

```bash
for u in https://community.nanako.org/sessions/1 https://community.nanako.org/players/x/cases/1 \
         https://community.nanako.org/api/config https://community.nanako.org/auth/login \
         'https://capi.nanako.org/sessions/1?x=1' https://capi.nanako.org/api/config; do
  echo "== $u"
  curl -s -o /tmp/p1-0-body.txt -D - --max-time 15 "$u" | grep -iE '^HTTP|^content-type|^location|^cache-control|^content-security-policy' | cut -c1-110
done
```

`community.nanako.org` 的 HTML 地址会先回一行 `HTTP/2 103`（Cloudflare Early Hints），看第二个 `HTTP` 行。规划时（2026-10-27，审查时复测一致）的结果，执行时对照，不一样就按实际写：

| 地址 | 规划时实测 |
|---|---|
| `community.nanako.org/sessions/1` | `200`，`text/html`，带 `content-security-policy` |
| `community.nanako.org/players/x/cases/1` | `200`，`text/html`，带 CSP |
| `community.nanako.org/api/config` | `404`，Cloudflare 的「Page not found」HTML（遗留 Functions 反代到已下线的 workers.dev） |
| `community.nanako.org/auth/login` | `404`，同上 |
| `capi.nanako.org/sessions/1?x=1` | `302`，`location: https://community.nanako.org/sessions/1?x=1`，`cache-control: no-store` |
| `capi.nanako.org/api/config` | `200`，`application/json` |

网络不通（沙箱、超时）就在文档里写「执行时无法访问，待领队补测」，不要编数字。

---

### Task 5：文档——EdgeOne 停用说明与 SPA 回退核验记录

**Files：**
- Modify: `README.md`
- Modify: `DEPLOY-EDGEONE.md`
- Modify: `docs/DEPLOY-PAGES.md`

文档没有自动测试；每一步用 grep 验证。

- [ ] **Step 1：README「## 部署」里 EdgeOne 那一条**

把 `README.md` 里这一整行（约第 277 行，锚点「**拆分部署**（前端 → 腾讯 EdgeOne Pages」）

```md
- **拆分部署**（前端 → 腾讯 EdgeOne Pages，后端 → Cloudflare Worker）：见 [DEPLOY-EDGEONE.md](./DEPLOY-EDGEONE.md)，内含跨域会话 Cookie 的处理与三种架构方案（推荐 EdgeOne 边缘函数反代，保持单源、Safari 安全、无需自定义域名）。
```

换成

```md
- **EdgeOne（已停用）**：前端已在 Cloudflare Pages（`community.nanako.org`），API 在 Node（`capi.nanako.org`），EdgeOne 不再使用。遗留的边缘函数 `functions/`（把 `/api`、`/auth` 反代到已下线的 workers.dev）和 `edgeone.json` 已在 P1-0 删除：Cloudflare Pages 会把根目录的 `functions/` 部署成 Pages Functions，挂在 `community.nanako.org/api/*`、`/auth/*` 上。核验记录见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)「SPA 回退核验（P1-0）」；[DEPLOY-EDGEONE.md](./DEPLOY-EDGEONE.md) 只作历史参考。
```

```bash
grep -n "EdgeOne（已停用）" README.md      # 期望 1 行
grep -n "腾讯 EdgeOne Pages" README.md     # 期望：无输出
```

- [ ] **Step 2：DEPLOY-EDGEONE.md 顶部加「已停用」**

在第 1 行 `# 拆分部署指南 — 前端 EdgeOne + 后端 Cloudflare` 和第 3 行「本指南把 EDG 信誉分**前端部署到腾讯 EdgeOne Pages」之间（即标题后的空行之后）插入下面这段，后面再留一个空行；正文一个字不删：

```md
> **已停用（P1-0）**：前端已迁到 Cloudflare Pages（`community.nanako.org`），API 跑在 Node（`capi.nanako.org`），EdgeOne 不再使用。
> 本文提到的 `functions/api/[[default]].js`、`functions/auth/[[default]].js` 和 `edgeone.json` 已从仓库删除——留着它们，
> Cloudflare Pages 会把 `functions/` 部署成 Pages Functions，把 `community.nanako.org/api/*`、`/auth/*` 反代到已下线的 workers.dev。
> 下面的正文只作历史参考；真要用时从 git 历史取回：`git show "$(git log -1 --format=%H --diff-filter=D -- edgeone.json)^:functions/api/[[default]].js"`。
> 当前部署见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)。
```

```bash
sed -n 1,9p DEPLOY-EDGEONE.md            # 期望：标题、空行、上面 5 行引用、空行、「本指南把 EDG 信誉分…」
```

- [ ] **Step 3：docs/DEPLOY-PAGES.md 第 2 步里的 `functions/` 提醒（锚点「注意：仓库根目录的 `functions/`（EdgeOne 的反代）」）**

把

```md
   - 注意：仓库根目录的 `functions/`（EdgeOne 的反代）会被 Pages 一起部署成 Pages Functions，
     挂在 `community.nanako.org/api/*`、`/auth/*` 上。SPA 不会请求它们（所有请求都走
     `VITE_API_BASE`），第 8 步下线 EdgeOne 时删掉 `functions/` 目录即可。
```

换成

```md
   - 仓库根目录**不能有** `functions/`：Pages 会把它部署成 Pages Functions，挂在 `/api/*`、`/auth/*` 上。
     原来那份 EdgeOne 反代（转发到已下线的 workers.dev）已在 P1-0 删除，见文末「SPA 回退核验（P1-0）」。
   - `dist/` 里**不能有** `404.html`：有它 Pages 就不做 SPA 回退，`/sessions/1` 这类地址会变成 404。
     `npm run build:pages` 发现它（任何层级）会直接失败。
```

- [ ] **Step 4：docs/DEPLOY-PAGES.md 第 7、8 步里的 EdgeOne 提醒（锚点「**注意**：EdgeOne 边缘函数反代的上游写死了 workers.dev 地址」）**

把

```md
   **注意**：EdgeOne 边缘函数反代的上游写死了 workers.dev 地址（`functions/api/[[default]].js`），
   做这一步之前先处理 EdgeOne。
8. **EdgeOne**：在 EdgeOne Pages 项目里把整站重定向到 `https://community.nanako.org`，
   或者直接删除该项目；然后删掉仓库里的 `functions/` 目录。
```

换成

```md
   EdgeOne 的边缘函数反代（上游写死了 workers.dev）已在 P1-0 删除，做这一步不必再先处理 EdgeOne。
8. **EdgeOne**：已完成。EdgeOne 不再使用，仓库里的 `functions/` 和 `edgeone.json` 已在 P1-0 删除。
   EdgeOne 控制台里如果还留着项目，删掉或整站重定向到 `https://community.nanako.org` 即可，与本仓库无关。
```

```bash
grep -n "functions/" docs/DEPLOY-PAGES.md   # 期望 2 行：第 2 步「仓库根目录**不能有** `functions/`」、第 8 步「仓库里的 `functions/` 和 `edgeone.json` 已在 P1-0 删除」
```

- [ ] **Step 5：docs/DEPLOY-PAGES.md 文末新增「SPA 回退核验（P1-0）」**

在文件最后一行（「EdgeOne 如果已经删除也不影响：…」）之后空一行，追加下面整节。表格里「本地」一列填 Task 4 Step 2 的实测，「P1-0 部署前」一列填 Task 4 Step 3 的实测（和规划时一样就照抄下面的值）；「PR 预览」「合并部署后」两列留给领队，原样保留「待领队填写」。

```md

## SPA 回退核验（P1-0）

P1 起前端有真实地址（`/sessions/:id`、`/players/:id`、`/players/:id/cases/:caseId`、`/cases/:id`，以及前端渲染的 404 页）。
任何托管都必须把这些未知路径交给 `index.html`（状态码 200），并且不接管 `/api`、`/auth`、`/link`（SPA 的路由规则也从不使用这三个前缀）。

### 各托管的结论

| 托管 | 现状 | SPA 回退靠什么 | P1-0 做了什么 |
|---|---|---|---|
| Cloudflare Pages（`community.nanako.org`） | 生产前端 | Pages 的规则：部署里**没有** `404.html` 时，未知路径一律返回 `index.html`（200） | `npm run build:pages` 发现 `dist/` 任何层级有 `404.html` 就失败（`scripts/pages-headers.mjs` 的 `assertSpaFallback`，`tests/unit/pages-headers.test.ts` 覆盖） |
| Pages Functions（根目录 `functions/`） | EdgeOne 遗留，被 Pages 当成 Functions 部署在 `/api/*`、`/auth/*` 上，反代到已下线的 workers.dev（实测 404） | — | **删除** `functions/api/[[default]].js`、`functions/auth/[[default]].js` 和 `edgeone.json`（spec §11 第 16 条默认：EdgeOne 已不用）；`tests/unit/pages-headers.test.ts` 断言它们不会回来 |
| EdgeOne Pages | 不再使用 | — | 不需要回退规则；`DEPLOY-EDGEONE.md` 顶部标注「已停用」 |
| 旧 Worker 单源部署（`wrangler.toml` `[assets]`） | 已由机主下线；配置还在，只给本地 `npm run dev` / `npm run preview` 用 | `not_found_handling = "single-page-application"` + `run_worker_first = true`，`worker/index.ts` 的 `app.all('*')` 回退到 `ASSETS` | 只核验、不改：本地 `npx wrangler dev` 实测 `/sessions/1`、`/players/x/cases/1`、`/xyz` 都是 200 SPA 外壳，`/api/config` 是 Worker 的 JSON；`tests/worker/split-deploy.test.ts`「keeps serving the SPA when FRONTEND_URL is unset…」覆盖 `app.all('*')` 的回退 |
| Node API（`capi.nanako.org`） | 生产 API，**不托管前端** | 不回退：`server/src/api.ts` 的 `NO_ASSETS` 对非 API 路径答 404；设了 `FRONTEND_URL`（`compose.yaml` 默认 `https://community.nanako.org`）时，`legacySpaRedirect` 先把它们带着 path 和 query 302 + `no-store` 到前端 | 新增测试：`split-deploy.test.ts`「old links to the P1 routes」、`node-api.test.ts`「createApi — old SPA links on the API host」 |
| Discord 分享页（`discord.nanako.org`） | 独立的静态页，不是这个 SPA | 不适用 | 无 |

### 实测记录

只发 GET。`<预览>` 是这个 PR 分支在 Pages 上的预览地址：机主 push 分支后，在 Cloudflare 后台 → Workers & Pages → 本项目 → Deployments 里找分支 `claude/p1-0-hosting` 的那次部署（分支别名形如 `https://claude-p1-0-hosting.<项目名>.pages.dev`）。

| 检查 | 命令 | 期望 | 本地 `wrangler pages dev` | P1-0 部署前（生产） | PR 预览 | 合并部署后（生产） |
|---|---|---|---|---|---|---|
| 约局地址 | `curl -sI <站点>/sessions/1` | `200`，`text/html`，预览和生产带 `Content-Security-Policy` | 200 text/html，SPA shell | 200 text/html，带 CSP | 待领队填写 | 待领队填写 |
| 案件地址 | `curl -sI <站点>/players/x/cases/1` | `200`，`text/html` | 200 text/html，SPA shell | 200 text/html，带 CSP | 待领队填写 | 待领队填写 |
| 未知地址 | `curl -s -o /dev/null -w '%{http_code}' <站点>/xyz` | `200`（404 由前端渲染） | 200 | 200 | 待领队填写 | 待领队填写 |
| `/api` 不归 Pages 管 | `curl -s -o /dev/null -w '%{http_code} %{content_type}' <站点>/api/config` | 删除后：`200 text/html`（SPA 外壳，不是反代、不是 JSON） | 200 text/html，SPA shell | 404 text/html（Functions 反代到已下线的 workers.dev） | 待领队填写 | 待领队填写 |
| `/auth` 不归 Pages 管 | `curl -sI <站点>/auth/login` | 删除后：`200 text/html`，没有指向 nanako.org 的 302 | 200 text/html，SPA shell | 404 text/html（同上） | 待领队填写 | 待领队填写 |
| Pages 构建日志 | Pages 后台该次部署的 Build log | 没有 `Found Functions directory` / `Compiled Worker successfully`；部署详情的 Functions 页显示没有函数 | 日志里 `Compiled Worker successfully` 出现 0 次 | 有 Functions | 待领队填写 | 待领队填写 |
| 旧主机 302 | `curl -sI 'https://capi.nanako.org/sessions/1?x=1'` | `302`，`location: https://community.nanako.org/sessions/1?x=1`，`cache-control: no-store` | — | 302，location 同期望，no-store | — | 待领队填写 |
| API 本身 | `curl -s https://capi.nanako.org/api/config` | `200` JSON | — | 200 application/json | — | 待领队填写 |

删除 `functions/` 要等机主合并并重新部署 Pages 才在生产生效：部署后复测 `/api/config` 在 `community.nanako.org` 上应返回 SPA 的 `index.html`（200、`text/html`），而不是反代结果。SPA 自己从不请求这个地址（所有请求都走 `VITE_API_BASE`），所以删除前后用户都感觉不到差别。
```

```bash
grep -n "^## SPA 回退核验（P1-0）" docs/DEPLOY-PAGES.md     # 期望 1 行
grep -o "待领队填写" docs/DEPLOY-PAGES.md | wc -l            # 期望 14（不能用 grep -c：它数的是行，会得到 8）
```

（14 = 前 6 行各 2 个 + 「旧主机 302」「API 本身」各 1 个。若 Task 4 Step 3 因网络无法访问而改写了「部署前」列，数字不变。）

- [ ] **Step 6：提交**

```bash
git add README.md DEPLOY-EDGEONE.md docs/DEPLOY-PAGES.md
git commit -m "docs: 写明 EdgeOne 已停用、遗留文件已删，记录 SPA 回退核验（P1-0）"
```

---

## 收尾

**1. 全量验证（执行代理跑）**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | grep -E "Test Files|Tests "
npm run test:dom 2>&1 | grep -E "Test Files|Tests "
npm run test:worker 2>&1 | grep -E "Test Files|Tests "
VITE_API_BASE=https://capi.nanako.org npm run build:pages && ls dist
npm run build && ls dist
git status --porcelain
git log --oneline claude/p0-5-safety-net..HEAD
```

期望：

| 项 | 期望（相对 Task 0 的 U0 / D0 / W0） | 规划副本实测 |
|---|---|---|
| typecheck | 通过 | 通过 |
| unit | 文件数不变（26），用例 U0 + 4 | 26 / 330 |
| dom | 文件数不变（20），用例 D0 + 0；`act(...)` 警告仍只有 `onboarding-roles` 的 3 条 | 20 / 219 |
| worker | 文件数不变（15），用例 W0 + 3，todo 不变 | 15 / 551 passed + 9 todo |
| `build:pages` | 成功，最后一行 `wrote dist/_headers`；`dist` 只有 `_headers assets index.html` | 同左 |
| `build` | 成功；`dist` 只有 `assets index.html` | 同左 |
| `git status --porcelain` | 无输出 | — |
| `git log` | 4 个提交：`feat: build:pages 发现产物里有 404.html…`、`chore: 删除 EdgeOne 遗留的 Pages Functions…`、`test: 锁住旧主机…`、`docs: 写明 EdgeOne 已停用…`；都没有署名行 | — |

`npm run test:pg`、`npm run test:server` 本地不跑（嵌入式 Postgres），交给 CI；`node-api.test.ts` 新增的用例在 CI 的 PG 轮里会再跑一次。

```bash
git log --format=%B claude/p0-5-safety-net..HEAD | grep -ciE "co-authored-by|generated with"   # 期望 0
```

**2. 本地手工核验（执行代理跑，已在 Task 4 做过；改动后再跑一次）**

Task 4 Step 1–2b 的命令：Pages 6 个地址都是 `200 text/html … SPA shell`，`Compiled Worker successfully` 0 次；`wrangler dev` 前 3 个地址 SPA shell、`/api/config` 是 JSON。跑完确认 8788、8792 端口没有残留进程（`lsof -i :8788 -i :8792` 无输出）。

**3. PR 预览核验（领队在机主 push 分支后执行，执行代理不 push）**

在 `docs/DEPLOY-PAGES.md`「实测记录」表里填「PR 预览」一列：

```bash
P=https://claude-p1-0-hosting.<项目名>.pages.dev     # 以 Pages 后台显示的预览地址为准
curl -sI "$P/sessions/1" | grep -iE '^HTTP|^content-type|^content-security-policy'        # 200、text/html、有 CSP
curl -sI "$P/players/x/cases/1" | grep -iE '^HTTP|^content-type'                           # 200、text/html
curl -s -o /dev/null -w '%{http_code}\n' "$P/xyz"                                           # 200
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "$P/api/config"                    # 200 text/html（不是 JSON、不是 404）
curl -sI "$P/auth/login" | grep -iE '^HTTP|^location'                                       # 200，没有 location
```

开测前先确认两件预览特有的事：
- **预览环境变量**：Cloudflare Pages 的环境变量分 Production / Preview 两套。`curl -sI "$P/sessions/1"` 的 `content-security-policy` 里 `connect-src` 必须含 `https://capi.nanako.org`；只有 `'self'` 说明 Preview 环境没设 `VITE_API_BASE`，SPA 会去请求预览域名自己的 `/api`（拿到 SPA 外壳）——到 Pages 设置 → Environment variables → Preview 补上 `VITE_API_BASE=https://capi.nanako.org` 再重新部署这次预览，然后重测。
- **预览没有构建**：项目若把 Preview 分支设成只构建部分分支，Deployments 里会找不到这个分支，需机主在 Settings → Builds → Branch control 里放开，或由机主在本地 `npx wrangler pages deploy dist --branch claude-p1-0-hosting` 手动上传（执行代理不做）。
- `curl -sI` 的第一行可能是 `HTTP/2 103`（Early Hints），看第二个 `HTTP` 行。

再在浏览器里打开 `$P/sessions/1`：页面能加载（P1-0 时还是大厅，P1-1 起才是约局页），DevTools Console 没有 CSP 报错，Network 里的 API 请求都发往 `capi.nanako.org`。预览域名不在 `capi` 的 `FRONTEND_ORIGIN` 里，所以这些请求在 Console 里报 **CORS** 错误、页面显示加载失败的提示是**预期的**，不算回归；要看的是没有 **CSP**（`Refused to connect` / `Content Security Policy`）报错、请求目标是 `capi.nanako.org` 而不是预览域名。Pages 构建日志里不应出现 `Found Functions directory`；会看到一条「wrangler.toml 不是 Pages 配置、已跳过」之类的警告（它没有 `pages_build_output_dir`），这是预期的，不处理。预览若开了 Cloudflare Access 保护，curl 会拿到 302 到 `cloudflareaccess.com`，那就改用已登录的浏览器核验并在表里注明。

**4. 合并部署后（领队）**

填「合并部署后」一列：同第 3 部分的命令换成 `https://community.nanako.org`，另加 `curl -sI 'https://capi.nanako.org/sessions/1?x=1'`（302 到 `https://community.nanako.org/sessions/1?x=1`、`no-store`）和 `curl -s https://capi.nanako.org/api/config`（200 JSON）。

**5. 写进 PR 描述（机主以后开 PR 时用）**：本 PR 删除了 `functions/` 和 `edgeone.json`（原因：EdgeOne 已停用，Cloudflare Pages 会把它们部署成反代到已下线 workers.dev 的 Functions）；`wrangler.toml` 和 `worker/index.ts` 只核验未改；下面「对契约的补充」各条。

## 对契约的补充

1. **`tests/unit/source-hygiene.test.ts` 也要改一行**（契约第 2 节 P1-0 文件表没列）：`SOURCE_DIRS` 里的 `'functions'` 必须去掉，否则目录删除后 `readdirSync` 直接 ENOENT（规划副本实测）。只改这一行；P1-1 按契约在文件末尾追加 `describe('history API')`，两者不冲突。
2. **`tests/unit/pages-headers.test.ts` 不是纯追加**：import 行扩充为 `existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync`。原有 5 个用例和 `run`/`csp` 一字不改。
3. **多一条防回归测试**：「仓库根没有 `functions/`、没有 `edgeone.json`」（放在 `pages-headers.test.ts`），给 spec §11 第 16 条的决定上锁；Task 2 的 TDD 也靠它先红后绿。
4. **404.html 检查是递归的**：按 Cloudflare 文档（Serving Pages），决定是否进入 SPA 模式的是**顶层** `404.html`；不在 SPA 模式时 Pages 才沿目录往上找最近的 `404.html`。嵌套的那个单独不会关掉 SPA 回退，但 spec §2.2 / §10 第 5 条的说法是「dist 里绝不能有 404.html」，所以任何层级都拒绝（更严，不会误伤：Vite 产物本来就只有 `index.html` 和 `assets/`）。
5. **`tests/worker/node-api.test.ts` 追加 1 例**（契约只写了 `split-deploy.test.ts`）：生产的 `capi.nanako.org` 是 Node 包装，不是 Worker；这一例走的是 `createApi` + `buildEnv` 的真实路径，并且会在 CI 的 PG 轮再跑一次。worker 文件数不变（15），用例 +3（split-deploy 2、node-api 1）。
6. **`split-deploy.test.ts` 多一例编码过的选手 id**（`/players/a%2Fb/cases/7?utm=dc`）：P1-1 的 `playerPath` 用 `encodeURIComponent`，302 必须不解码、不改写。
7. **CI 不改**：`.github/workflows/ci.yml` 跑的是 `npm run build`，不是 `build:pages`。404 检查由 `test:unit` 里真跑脚本的用例覆盖，Pages 自己的构建命令就是 `build:pages`，所以不加 CI 步骤，`ci.yml` 不在本 PR 的文件范围里。
8. **只核验、不改的旧注释**：`wrangler.toml`（第 72、82–98 行附近 EdgeOne 方案 A/B/C 的注释）、`.dev.vars.example`（第 53–57 行）、`vite.config.ts` 顶部「dist, which the Cloudflare Worker serves」、`README.md`「部署」里「`score.` + `api.` 子域」的旧说法都已过时，但契约规定本 PR 不碰 `wrangler.toml`，其余也不影响托管行为，留给以后的文档清理。
9. **spec §9 P1-0 ② 和 ⑤ 的处理**：② EdgeOne 的回退规则不适用（EdgeOne 已停用，见核验表）；⑤ Node/Coolify 不托管这个 SPA（`NO_ASSETS` → 404，或设了 `FRONTEND_URL` 时 302），已有 `node-api.test.ts`「404s non-API paths — this host serves no SPA」，本 PR 再加 302 一例。
10. **本地 `wrangler pages dev` 不作为 CSP 的依据**：规划时 wrangler 4.107 本地没有应用 `_headers`，CSP 只在 PR 预览和生产上核。

## 自查

| spec / 契约条目 | 落在哪里 |
|---|---|
| §9 P1-0 ① Pages SPA 回退，dist 里绝不能有 404.html；build 检查新增「dist 不含 404.html」 | Task 1（脚本 + 3 个用例 + 真实 `build:pages` 正反两次）；Task 4 本地核验；收尾第 3、4 部分预览 / 生产核验 |
| §9 P1-0 ② EdgeOne 回退规则 | 不适用（EdgeOne 已停用）：Task 5 Step 2、Step 5 核验表；补充第 9 条 |
| §9 P1-0 ③ Worker 单源部署（`[assets]`、`run_worker_first`、`app.all('*')`） | 只核验不改：Architecture 段、Task 0 Step 2 的 grep、Task 4 Step 2b 本地 `wrangler dev` 实测、Task 5 Step 5 核验表（生产死配置，仅本地 `dev` / `preview` / `deploy` 脚本还读） |
| §9 P1-0 ④ 旧主机 302 带 path 和 query；`split-deploy.test.ts` 新增「`/sessions/5?x=1` 的 302 Location 保留 path 和 query」 | Task 3（split-deploy 2 例 + node-api 1 例 + 改坏验证） |
| §9 P1-0 ⑤ Node/Coolify 若托管前端也实测 | 不托管：Task 5 Step 5 核验表；Task 4 Step 3 实测 `capi` 的 302 和 `/api/config` |
| §9 P1-0 ⑥ / §11 第 16 条：删除遗留 Pages Functions 和 `edgeone.json` 并写明原因 | Task 2（删除 + 防回归测试 + source-hygiene）；Task 5 Step 1–5（README、DEPLOY-EDGEONE.md、DEPLOY-PAGES.md） |
| 每项实测 `/sessions/1` 返回 index.html、200，`/api/*` 不由 Pages 提供 | Task 4（本地）；收尾第 3 部分（PR 预览）、第 4 部分（生产） |
| §2.2「所有路径都不以 `/api`、`/auth`、`/link` 开头；构建产物里永远不放 `404.html`」 | Task 1、Task 2；核验表首段 |
| §10 第 5 条「所有托管都要配好 SPA 回退」 | Task 5 Step 5「各托管的结论」表 |
| 契约第 2 节：不碰 `src/`、`worker/` 源码，`wrangler.toml` 只核验 | 文件结构「不碰」一行；Task 3 Step 3 改坏后 `git diff --stat worker/` 为空 |
| 契约第 5 节 P1-0 验收（`curl` 四条、只发 GET、「部署后复测 `/api/config`」） | Task 4 Step 3；Task 5 Step 5 实测表和末段；收尾第 4 部分 |
| 契约第 1 节文件数（unit 26、dom 20、worker 15 不变） | 收尾第 1 部分 |
| 提交 `<type>: <中文描述>`、无署名行；不 rebase / push / 开 PR | 每个 Task 的提交步骤；收尾第 1 部分的署名 grep；分支行 |
