# P5 实施计划 · 锦上添花（全部可选，一个 PR）

> **已作废（2026-10-27）**：方向改为 v6「Discord 为主，网页做减法」，本计划不再实施。仍有价值的几项列在 [v6 HANDOFF 后续待办](../redesign-v6/HANDOFF.md#5-后续待办不在-s1s5-里需要机主拍板后再做)，要做时重新写计划。

> 前端重设计 v5 第 5 期。方案：`docs/redesign-v5/spec.md`（§11 全部按推荐默认值拍板）。P5 用到：§9 P5 清单、§8 B5-1…B5-5、§5 第 2、16 条、§6.3、§6.4、§10 第 15 条、§11 第 2、9、13、15 条。
> 文件名、组件名按开工时的 main 写：P0–P3 的名字对照过代码和计划；P4 的计划还没写，P4 的东西只用 spec 里的叫法（`/admin?tab=…`、`AdminAiPanel`、`CaseResult` 等），以 P4 实际代码为准。行号只作提示，**定位一律以锚点文字为准**。

## 1. 目标与范围

P5 把 spec §9 P5 清单里的十项小改进收尾：自托管字体并收紧 CSP、PWA 的 manifest 和图标、立案时 AI 并行归类、`/admin` 全部账号、AI 试跑用草稿配置、往期战报、「你不在时发生了什么」、第二批 SVG 图标、按路由拆包，以及给组织者的「催一下」。spec 估 4.5–5.5 人日。**每一项都可选，互相独立，可以挑着做**：每项单独成一个或几个 commit，没挑的那节整节跳过，PR 描述写明做了哪几项。本期**没有迁移**（B5-1…B5-5 在 spec §8 都写「无」）。

不在本期：bot 的「陈述」改「说明」（§11 第 15 条已定 bot 保留「陈述」，所以 §9 里那条可选改名不做）；预览环境的 staging API（§11 第 13 条，M30 不处理）；service worker、浅色模式，以及 §10 第 15 条列的其他「不做」。

| # | 项 | spec | 价值 | 工作量 | 动后端 | 可否跳过 |
|---|---|---|---|---|---|---|
| 1 | 自托管字体 + 收紧 CSP | §6.3 | 高：去掉第三方请求和阻塞渲染的样式表 | 小 | 否 | 可以；推荐做 |
| 2 | PWA manifest + 图标 | §5 第 16 条 | 中 | 小（要图标稿） | 否 | 可以 |
| 3 | 立案时 AI 并行归类 | B5-4 | 中：8 人立案最坏从约 160 秒降到约 60 秒（H16） | 小 | Worker | 可以 |
| 4 | `/admin` 全部账号 | B5-1 | 中：给不在榜的人设裁判（M14 后半） | 小 | Worker | 可以 |
| 5 | AI 试跑用草稿配置 | B5-3 | 低–中（M28 后半） | 小 | Worker | 可以 |
| 6 | 往期战报 | B5-2 | 中（低优先级「没有往期」） | 中 | Worker | 可以 |
| 7 | `SinceLastVisit` | §5 第 2 条 | 低–中 | 中 | 否 | 可以 |
| 8 | 第二批 SVG 图标 | §6.4 | 低 | 小 | 否 | 先砍 |
| 9 | 按路由 lazy 拆包 | M29 | 中：首屏 JS 变小 | 中（要改测试） | 否 | 可以 |
| 10 | 「催一下」 | B5-5 | 低 | 大：只在 Node 端，碰私信额度 | Node | spec 标「可选」，最先砍 |

表的顺序就是推荐的实现顺序：先做收益高、风险小的；拆包放在其他界面项之后，一次覆盖新加的页面；「催一下」放最后，砍掉不影响前面任何一项。

## 2. 前提：开工时 main 上应已有 P1–P4

开工时 main 上应已合并 P0–P4 的全部 PR，后端已在 Coolify Redeploy。如果当初按 §11 第 11 条的瘦身选项把 P2-5、P2-6、P3-4、P3-6 的历史页或 P3-7 推迟了，它们照各自原计划单独做，**不并进本 PR**。

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH   # Node v24.22.0
git status --short                      # 必须为空
git fetch origin
git switch -c claude/p5-polish origin/main

# 核对本期要接的上游都在：没有输出 = 齐了；打印「缺：…」就先停下查原因
while read -r f s; do grep -qF -- "$s" "$f" 2>/dev/null || echo "缺：$f  $s"; done <<'EOF'
src/components/icons/index.tsx IconClose
src/components/Skeleton.tsx Skeleton
src/components/BoardPage.tsx BoardPage
src/components/WeeklyReportCard.tsx hidePigeon
src/lib/lobbySessions.ts sessionEndsAt
src/lib/useTodoSources.ts useTodoSources
worker/sessions.ts export function requireOrganizer
worker/sessions.ts export async function getSessionRow
scripts/pages-headers.mjs https://fonts.googleapis.com
EOF
grep -rn "tab=users\|'users'" src/lib/routes.ts src/components | head -3   # P4-3 的 /admin 子页（P5 前隐藏「全部账号」）
grep -rn "appeal_outcome" worker | head -1                                 # P4-4 已合并
```

然后跑全量（第 5 节的命令），把六个套件的「文件 / 用例」数和 `npm run build` 打印的 JS / CSS 体积记下来，作为本 PR 的基线写进 PR 描述。

## 3. 分项实现

### 3.1 自托管字体 + 收紧 CSP（§6.3）

**要做什么**：Rajdhani 不再从 Google Fonts 拉，改成打包进 `dist/assets/` 的 woff2 拉丁子集（只要现在用的 500 / 600 / 700 三档）；CSP 的 `style-src`、`font-src` 去掉 Google 的两个域名。中文回退不动：`src/theme.css` 的 `--font-display` 已经是「Rajdhani → PingFang SC / Noto Sans SC / Microsoft YaHei → system-ui」（`--font-num` 只用于数字，回退到等宽字体），拉丁子集带 `unicode-range`，中文字符自然落到系统字体。

**文件**：
- `package.json`：`dependencies` 加 `@fontsource/rajdhani`（npm 上的 Fontsource 包，OFL 许可，固定版本）。不想加依赖的备选：把三个 woff2 放进 `src/assets/fonts/`，自己写 `@font-face`（`font-display: swap`、`unicode-range` 照 Google 的拉丁段）。
- `src/main.tsx`：在 `import './theme.css';` **之前**导入 `@fontsource/rajdhani/latin-500.css`、`latin-600.css`、`latin-700.css`（文件名以包里实际为准）。`source-hygiene` 只要求 theme.css 在 App 之前，不受影响。
- `index.html`：删掉两条 `preconnect` 和 `fonts.googleapis.com/css2?family=Rajdhani…` 那条 `<link>`。不加字体 preload（文件名带 hash，index.html 里写不出来）。
- `vite.config.ts`：`build.assetsInlineLimit` 改成函数，`.woff2`/`.woff` 一律不内联。否则小于 4 KB 的字体会变成 `data:` URL，被 `font-src 'self'` 拦掉。
- `scripts/pages-headers.mjs` 的 `contentSecurityPolicy`，只改两行：

```js
"style-src 'self'",
"font-src 'self'",
```

**文案**：无。

**测试**：
- `tests/unit/pages-headers.test.ts` 第一个用例**新增**两条断言（spec §6.3：现有用例没有断言这两项，所以是新增、不是修改）：`expect(policy['style-src']).toBe("'self'")`、`expect(policy['font-src']).toBe("'self'")`；再加一条：整条 CSP 里不含 `fonts.googleapis.com`、`fonts.gstatic.com`、`unsafe-inline`。其余断言一字不改。
- `tests/unit/source-hygiene.test.ts` 新增：`index.html` 不含 `fonts.googleapis.com`、`fonts.gstatic.com`。

**完成标准**：`npm run build:pages` 后 `dist/_headers` 的 CSP 只有这两处变化；`dist/assets/` 里有 `rajdhani-latin-*.woff2`，构建出的 CSS 里没有 `url(data:font`；本地预览数字和拉丁字母是 Rajdhani、中文是系统字体，Console 没有 CSP 报错，Network 里没有任何 Google 域名的请求。

**可否跳过**：可以，独立。做了它，Lighthouse「阻塞渲染的资源」里那条 Google Fonts 样式表会消失。

### 3.2 PWA manifest + 图标（§5 第 16 条）

**要做什么**：只加 `manifest.webmanifest` 和图标，让「添加到主屏幕」有正确的名字、图标，并且全屏打开。**不加 service worker**（§10 第 15 条：避免旧前端配新 API 的错配），也不用 `vite-plugin-pwa` 这类会顺带生成 service worker 的插件。不追求 Chrome 的「安装」提示，浏览器菜单里的「添加到主屏幕」能用就算完成。

**文件**（仓库现在没有 `public/`，新建；Vite 原样拷到 `dist/` 根目录，不带 hash）：
- `public/manifest.webmanifest`
- `public/icons/icon.svg`（favicon，SPA 现在没有任何 favicon）、`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`（主体在中间 80% 的安全区里）、`apple-touch-icon.png`（180×180，不透明）。PNG 从 `icon.svg` 一次性导出后提交，不在构建里生成。
- `index.html`（`<head>` 里，现有 description、og 标签不动）：

```html
<meta name="theme-color" content="#0a0e14" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

manifest 的字段（颜色取 `src/theme.css` 的 `--bg: #0a0e14`；`start_url` 和 `scope` 不能以 `/api`、`/auth`、`/link` 开头）：

```json
{
  "name": "EDG 信誉分", "short_name": "EDG 信誉分", "lang": "zh-CN",
  "description": "EDG 开黑大厅：约局、报名、守约记录。",
  "id": "/", "start_url": "/", "scope": "/", "display": "standalone",
  "background_color": "#0a0e14", "theme_color": "#0a0e14",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

CSP 不用改：manifest 走 `default-src 'self'`，图标走 `img-src 'self'`。`dist/` 从此除了 `_headers`、`assets/`、`index.html` 还有 `manifest.webmanifest` 和 `icons/`；P1-0 的 404.html 检查照常扫，`public/` 里不能放 `404.html`。

**文案**：名字和 description 与 `index.html` 现有的 `<title>`、description 一致（spec §3.1）。

**测试**：新 `tests/unit/pwa-manifest.test.ts`（纯 Node）：manifest 是合法 JSON，`start_url`、`scope` 是 `/`，`display` 是 `standalone`；每个图标文件存在，PNG 实际尺寸（读 IHDR）和 `sizes` 一致，有一个 `purpose: "maskable"`；`theme_color` 等于 theme.css 里的 `--bg`；`index.html` 引用了 manifest；`src/` 里不出现 `serviceWorker`（锁住 §10 第 15 条）。

**完成标准**：Chrome DevTools → Application → Manifest 没有报错，图标都能显示；Android Chrome、iOS Safari 实机「添加到主屏幕」后图标、名字正确，打开是全屏、没有地址栏，并且能登录（见第 5 节手动检查）。

**可否跳过**：可以，独立。图标图案要机主定（第 6 节第 1 条），没有图标稿就先跳过这一项。

### 3.3 立案时 AI 并行归类（B5-4）

**要做什么**：`worker/case-filing.ts` 的 `fileCases` 现在用 `for … of` 逐个 `await fileCase(...)`（锚点 `for (const a of accusations) {`），改成并发上限 3 的池，每人各自 try/catch。输入顺序不变：`records`、`failed` 都按原来的顺序排，P4-2 的 `CaseResult` 逐人显示不受影响。角色检查、共用描述的校验仍然在池之前只做一次（`:276-283` 的注释说的语义不变）。

**文件**：
- 新 `worker/pool.ts`：`mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]>`，结果按输入下标排，任何一个失败不影响其他。不碰 Workers 专属类型，`tests/unit` 能直接导入。
- `shared/scoring.ts`：`CLASSIFY_CONCURRENCY = 3`（P4-2 估等待时间时也要读它）。
- `worker/case-filing.ts`：循环换成 `mapPool(accusations, CLASSIFY_CONCURRENCY, …)`，把 settled 结果按下标拆回 `records` 和 `failed`；`failed` 的错误文案沿用现在的写法（`ApiError` 的 message，否则「立案失败」）。
- 可选顺带：P4-2 按人数估等待时间的那处（spec §3.10「每人约 20 秒，封顶写『可能要 1–3 分钟』」）改成按轮数估：`Math.ceil(n / CLASSIFY_CONCURRENCY)` × 20 秒；「逐个归类」改成「正在归类」。

**注意**：
- 每日立案上限（`assertRateLimits`：立案人 24 小时 40 起）是在 AI 调用**之前**查的。并发时，接近上限的立案人同一批里最多会多放过 `CLASSIFY_CONCURRENCY − 1` 起（第 6 节第 4 条）。同一批里的人两两不同，所以「同一个人 24 小时 5 次」不受影响。
- AI 供应商限流（429）时，`classifyClaim` 回退成保底判（`classified_by` 为 fallback），不会报错。并发 3 是 spec 定的，不另加重试。

**测试**：
- 新 `tests/unit/pool.test.ts`：同时在跑的不超过 `limit`，并且确实会跑满 `limit`；结果按输入顺序；一个 reject 不影响其他；空数组；`limit` 大于条数。
- `tests/worker/batch-cases.test.ts` 末尾新 describe（D1 和 PG 都跑）：开着 AI 的 env，用 `vi.stubGlobal('fetch', …)`（`tests/worker/cases.test.ts` 已有这个写法）挂起每次分类请求、记录同时在飞的个数；7 个人立案：同时在飞的最多 3 个，`records` 按输入顺序，其中一人不在榜时只有他进 `failed`。现有用例原样通过。

**完成标准**：上述测试通过；8 人立案在 AI 开着时大约三轮返回。

**可否跳过**：可以，独立。

### 3.4 `/admin` 全部账号（B5-1）

**要做什么**：后端新增 `GET /api/admin/users`，返回全部账号（含不在榜的）；P4-3 的 `/admin?tab=users`「全部账号」子页从隐藏变为可用：列出所有人，每行可以「设为裁判 / 取消裁判资格」。

**接口**：`GET /api/admin/users` → `{ users: [{ id, username, is_participant, is_judge, score }] }`，五个键正好是 spec §8 的字段：
- 只给管理员（`requireAdmin`，401 / 403）；`Cache-Control: private, no-store`（`worker/routes.ts` 的 `privateToViewer` 是文件内私有函数，不跨文件导入，直接写这个头）；
- `username` 取显示名 `COALESCE(display_name, username)`（和 P2-2 的 `/api/me/invitable` 一致）；`is_participant`、`is_judge` 是布尔值；
- **不 `SELECT *`**：`users` 表里有 `email`，也不 JOIN `discord_links`，不带任何 `discord_*` 字段；
- 排序：在榜的在前，然后按名字、再按 id；上限 500（新常量，和 P2-2 的 `MAX_INVITABLE` 同一个数），SQL 两个引擎都合法。

**文件**：`worker/routes-admin.ts`（在 `POST /api/admin/users/:id` 之前加 GET，查询写成 `worker/db.ts` 里的一个函数）；`src/types.ts` 的 `AdminUser`；`src/api.ts` 的 `getAdminUsers(): Promise<AdminUser[] | undefined>`（404 → `undefined`，写法照 P2-2 的 `getInvitable`）；P4-3 的 `/admin` 页面和新的 `AdminUsersPanel`；`docs/CONTRACT.md` 加一条端点。

**前端**：进 `/admin` 时请求一次（不是首屏请求）。`undefined`（旧后端 404）时「全部账号」导航链接不出现，这就是 P4-3 的「P5 前隐藏」。列表每行：名字、「未上榜」标记（不在榜的人，沿用 spec §3.5 的叫法）、「裁判」标记、分数；按钮复用现有 `setJudge`（`POST /api/admin/users/:id {is_judge}`），按钮名一字不改：「设为裁判」「取消裁判资格」（spec §6.5 锁定）。操作成功后刷新这份列表，并照 P0-3 的规则让榜单、用户、动态流的 key 失效（`app-refresh.test.tsx`「设为裁判 invalidates …」那条的口径）。在榜的人名字链到 `/players/:id`。

**文案**：按钮是锁定文案；「未上榜」出自 spec §3.5；空列表、读失败沿用页面现有的提示写法（role="status"，不用 alert）。

**测试**：`tests/worker/admin-users.test.ts` 末尾新 describe「GET /api/admin/users」（D1 和 PG）：匿名 401、非管理员 403；包含不在榜的人；每项正好五个键（没有 `email`、`avatar_url`、任何 `discord_*`）；排序；`Cache-Control`。新 `tests/dom/admin-users.test.tsx`：列表和「未上榜」；点「设为裁判」发 `POST /api/admin/users/<id>`，body `{"is_judge":true}`；**404 时没有「全部账号」链接，也没有 alert**。

**完成标准**：管理员能把一个不在榜的人设为裁判，这人随后能立案（`case-filing` 只看 `is_judge`）。

**可否跳过**：可以，独立。不做的话「全部账号」子页继续隐藏，给不在榜的人设裁判仍然只能直接调接口。

### 3.5 AI 试跑用草稿配置（B5-3）

**要做什么**：管理员在 AI 配置表单里改了模型、地址、温度或提示词，还没保存，就能直接试跑看效果。API Key 仍然只来自服务端机密，不经过前端。

**接口**：`POST /api/admin/ai-config/test` 的 body 从 `{ claim?, statement? }` 扩成 `{ claim?, statement?, draft?: AiConfigPatch }`（`AiConfigPatch` 就是保存接口用的那个类型）。
- 校验和保存接口**同一套**：把 `POST /api/admin/ai-config` 里的字段校验（`base_url` 必须 https 或 localhost、`temperature` 在 0–2、提示词不超过 8000 字、`enabled` 必须是布尔）抽成一个函数，两个路由共用，不复制。草稿的 `base_url` 会收到真实的 API Key，所以这条校验必须和保存时一样严。
- `draft.api_key`（或顶层 `api_key`）出现就 400，文案和保存接口拒收 `api_key` 的那句相同（P4-3 改过措辞的话，以改后的为准）。
- 实现：`readSettings` 读出的 Map 复制一份，把草稿字段按 `AI_SETTING_KEYS` 盖上去，再交给 `resolveAiConfig`（不改原 Map）。这样「开着 + 地址 + 模型 + 有 Key 才算启用」和 `promptVersion` 的算法都不用重写。**不写 `app_settings`**。
- 响应在原有字段上加 `draft_applied: true`。旧后端会忽略 `draft`、照旧用已保存的配置，前端靠这个字段分辨。

**文件**：`worker/routes-admin.ts`（两个 AI 路由）、`worker/ai/config.ts`（叠加草稿的纯函数）、`src/api.ts` 的 `testAiConfig` 参数加 `draft?`、`src/types.ts` 的 `AiTestResponse.draft_applied?`、`src/components/AdminAiPanel.tsx`（`handleSave` 里拼 patch 的那段抽成函数，`handleTest` 也用它，发 `testAiConfig({ draft })`）。

**文案**：按钮「用样例案试跑」不改。P4-3 加的「用已保存的配置试跑」改成「用表单里现在的配置试跑，不会保存」；响应没有 `draft_applied` 时，结果旁写「后端还没更新，这次用的是已保存的配置」。两句都是本计划拟的（第 6 节第 2 条）。

**测试**：`tests/worker/admin-routes.test.ts` 末尾新 describe（D1 和 PG）：stub `fetch` 拿到发给 AI 的请求，草稿的 `model`、`prompt`、`base_url` 生效；`api_key` 400；非法 `base_url`、温度 400；试跑前后 `app_settings` 一行不变；非管理员 403（现有的路由守卫表照常通过）。新 `tests/dom/admin-ai-draft.test.tsx`：改了模型再点试跑，请求 body 带 `draft.model`，而且没有发 `POST /api/admin/ai-config`；body 里没有 `api_key`；没有 `draft_applied` 时出现回退提示。

**完成标准**：改提示词后不保存直接试跑，结果按新提示词出；刷新页面配置仍是旧的。

**可否跳过**：可以，独立。

### 3.6 往期战报（B5-2）

**要做什么**：`/board/report` 在上周战报下面列出更早的周报，可以一页页往前翻。

**接口**：`GET /api/reports?before=<week>`，公开。
- 返回 `{ reports: WeeklyReport[], next_before: string | null }`：`week_start` 早于 `before` 的周报，最新的在前，每页 8 条（`worker/report.ts` 内部常量）。多查一行来判断还有没有，有就把这一页最后一条的 `week_start` 放进 `next_before`。
- 不带 `before` 就从最新一周开始；`before` 必须是 `YYYY-MM-DD`，否则 400，文案沿用 `regenerateReport` 的「周起始日格式应为 YYYY-MM-DD」。
- SQL 写成两条（有游标 / 没游标），**不要写 `(? IS NULL OR week_start < ?)`**：PG 推不出单独一个占位符的类型（P2 契约「两边都合法的方言」）。

```sql
SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT ?
SELECT * FROM weekly_reports WHERE week_start < ? ORDER BY week_start DESC LIMIT ?
```

**文件**：`worker/report.ts`（`listReports(db, before)`，复用 `toReport`）；`worker/routes.ts`（在 `GET /api/report/latest` 旁边加路由）；`src/api.ts` 的 `getReports(before?)`（404 → `undefined`）；`src/components/WeeklyReportCard.tsx` 把完整正文导出成可复用的 `ReportBody`（参数含 `hidePigeon`；`WeeklyReportCard` 的签名不变）；新 `src/components/ReportArchive.tsx` + css；P3-6 的 `BoardPage` 战报子页在 `WeeklyReportCard` 下面放 `<ReportArchive />`；`docs/CONTRACT.md` 加端点。

**容易错的地方**：
- **不能在一页里渲染多个 `WeeklyReportCard`**：它的 h2 固定是 `id="wr-title"`，h2 文字匹配 `/上周战报/`、`/往期战报/`（被测试锁定）。列表用 `ReportBody`，小节标题避开这两个词。
- **鸽王**：§11 第 2 条，网页上不点名鸽王。旧周报的 `stats` 里仍有 pigeon，列表里每一期都传 `hidePigeon`。叙事正文照旧显示（spec：已发布的周报保持现状）。
- 第一次请求带 `before=<上面那张卡的 week_start>`，不重复显示它；只在进入 `/board/report` 时请求，首屏请求集合一个不加。

**文案**：小节 h2「更早的战报」，每期一个 h3，写周的起止日期（格式和战报卡现有的「10/19–10/25」一致）；翻页按钮「再往前看」；没有更早的就不渲染这一节。这三处是本计划拟的（第 6 节第 2 条）。

**测试**：`tests/worker/report.test.ts` 末尾新 describe（D1 和 PG）：最新在前、每页 8 条、`before` 不含当周、`next_before` 正确、坏游标 400、没有数据时是 `[]`。新 `tests/dom/report-archive.test.tsx`：渲染列表、「再往前看」带上 `next_before`、**`stats` 里带 pigeon 的旧周报不出「上周鸽王」奖项**、404 时这一节不出现也没有 alert、页面上 `/往期战报/` 标题最多一个。

**完成标准**：有三期以上周报时，`/board/report` 能翻到最早一期；访客也能看。

**可否跳过**：可以，独立。

### 3.7 `SinceLastVisit`「你不在时发生了什么」（§5 第 2 条）

**要做什么**：登录用户回到首页时，如果上次来之后有新情况，给一行摘要，例如「上次来之后：结束了 2 局，你 +2；阿杰约了周六的局。」只给本人看，可以关；没有新内容就不显示。**不加任何请求**：只用首页已经拿到的数据。

**数据**（都来自 P3 已有的数据，首屏请求集合不变）：
- 本机记录：`localStorage['edg.lastSeen']` = `{ v: 1, userId, at: <epoch ms>, score }`。spec 只写了记 `lastSeenAt`；另外记下当时的分数，是因为动态流里看不到每周回血和管理员改分，算不出「你 ±N」（第 6 节第 3 条）。`userId` 对不上（换了账号）当作没有记录。退出登录时清掉，和 P3-2 的 `edg.todo.*` 在同一处。
- 「结束了 N 局」：`useLobbySessions().mine` 里没取消、并且 `sessionEndsAt(s)` 落在（上次，现在］之间的局。`mine` 是 null（失败）就不说这一句。
- 「你 +N / −N」：`me.score − 记录里的 score`，不在榜或为 0 就不说。
- 「X 约了周六的局」：`upcoming` 里 `created_at` 晚于上次、组织者不是我的局。`created_at` 是 SQLite 的 `YYYY-MM-DD HH:MM:SS`（UTC、没有时区标记），**一律用 `src/lib/time.ts` 的 `parseTimestamp`**，不能直接 `Date.parse`（V8 会按本地时间解析，北京时间差 8 小时）。周几按看板时区（`config.boardTzOffsetHours`，缺省时用浏览器时区），复用 `time.ts` 现有的格式函数。
- 第一次来（没有记录）不显示。读到记录后，等 `me` 就绪马上写入新的 `{at: now, score}`：摘要在这次浏览里一直留着，刷新以后就不再重复。

**文件**：新 `src/lib/sinceLastVisit.ts`（纯：`summarizeSince(prev, me, mine, upcoming, now)` 返回摘要或 `null`，`visitSummaryText(summary, offsetHours?)`）；新 `src/lib/useLastSeen.ts`（读写 storage，全部 try/catch，坏值当没有）；新 `src/components/SinceLastVisit.tsx` + css。放在首页「要你处理」（`TodoInbox`）之后、`MyScoreLine` 之前；桌面在主栏同一位置（第 6 节第 3 条）。

**无障碍**：是一段普通文字（`<p>`，外层 `aria-label="上次来之后"`），**不用标题元素**。首页只能有一个匹配 `/约局/` 的标题，局名也不出现在这里。不用 `role="alert"`。关闭按钮带可访问名，不叫裸的「关闭」。

**文案**：主句照 spec §5 第 2 条的示例；一次来了多个新局时写「阿杰等 3 人约了新局」；关闭按钮的可访问名「不看这条」。后两处是本计划拟的（第 6 节第 2 条）。

**测试**：新 `tests/unit/since-last-visit.test.ts`：没有记录 → null；没有新内容 → null；结束的局计数不含已取消、不含还没结束的；分数差的正负和 0；别人的 `userId` 被忽略；SQLite 格式的 `created_at` 按 UTC 比较；我自己约的局不算。新 `tests/dom/since-last-visit.test.tsx`：预置记录后渲染出摘要；访客不渲染；关闭后消失；**首屏请求的 URL 集合和 `app-refresh.test.tsx` 锁的一致**；退出登录后 `edg.lastSeen` 被清掉。

**完成标准**：隔一段时间再来能看到准确的摘要，马上刷新不再出现。

**可否跳过**：可以，独立。

### 3.8 第二批 SVG 图标（§6.4）

**要做什么**：把 P3-1 第一批之后还留在界面上、当语义图标用的 emoji 换成同源 SVG，写法和第一批一样：放进 `src/components/icons/index.tsx`，每个导出 `(props: { className?: string }) => JSX.Element`，`viewBox="0 0 24 24"`、`stroke="currentColor"`、`aria-hidden="true"`、`focusable="false"`，旁边一定有文字。

**范围**：开工时盘点（P4 加了页面，以那时的代码为准）：

```bash
grep -rnoP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{26FF}\x{2B50}]" src/components --include='*.tsx' | sort | uniq -c
```

现在的代码里能看到的候选：`VerdictCard` 的 🔒（隐私）、⚖（判决）、📝（说明）；`OnboardingDialog` 的 ⚖、🏅；`RulesPanel` 的 📖；`SessionsPanel` 的 📅；点名（P3-5 起在 `RollCallFlow`）的 📝；`AdminAiPanel` 的 ⚠（第一批已有 `IconWarning`，直接用）。最终清单写进 PR 描述。

**不换的**：玩梗的 🎉 ✨ 🎮 📮；shared 里 `ATTENDANCE_DEFS`、`VIOLATIONS` 和段位的 emoji（bot 也在用）；战报卡的奖项 emoji（§10 第 1 条：梗留在战报里）；**`Modal` 的 ✕**（`tests/dom/modal-stack.test.tsx:186,193` 按 textContent 断言了 `'✕'`）。

**文案**：不变。按钮和链接的可访问名一律不变，图标不进可访问名。

**测试**：新 `tests/unit/semantic-emoji.test.ts`：扫描 `src/components/**/*.tsx`，上面那段 emoji 只能出现在白名单里，防止回潮。如果 P3-1 已经有逐个渲染图标、检查 `aria-hidden` 的用例，把新图标加进去；没有就新建 `tests/dom/icons.test.tsx`。forced-colors 下可见靠 `currentColor`，手动看一眼。

**完成标准**：盘点清单里的都换完；现有 dom 测试原样通过。

**可否跳过**：可以，价值最低，时间紧就先砍。

### 3.9 按路由 lazy 拆包（M29）

**要做什么**：不常用的页面改成 `React.lazy` 按需加载，缩小首屏 JS（P2 时单包已是 291 kB，gzip 93 kB）。

**拆哪些**：P3 的 `BoardPage`、`SessionHistoryPage`、`RollCallPage`、`NewSessionRoute`；P4 的 `/me`、`/me/notify`、`/me/profile`、`/cases/new`、`/cases/:id/statement`、`/review`、`/admin`、`/join` 页面（组件名以 P4 代码为准）。**留在主包**：大厅首页、`SessionDetailDialog`（`/sessions/:id`）、`PlayerDetail`（`/players/:id`、案件页）、`NotFound`、路由、`Modal`、`Toast`。它们是 bot 深链 `/?session=`、`/?case=` 落地的地方，`deep-link`、`p8-app` 测试用同步断言和精确的请求次数锁着。

**文件**：
- 新 `src/components/lazyPages.ts`：每个页面一行。组件都是具名导出，所以写成 `lazy(() => import('./BoardPage').then((m) => ({ default: m.BoardPage })))`。
- 新 `src/components/ChunkErrorBoundary.tsx`（错误边界只能写成 class 组件）：分块加载失败时显示 `role="alert"` 的「页面没加载出来，可能是网站刚更新过。」和一个「刷新页面」按钮（`location.reload()`）。**这一条不能省**：部署之后，开着的旧标签页再去要旧的 chunk 文件名，Cloudflare Pages 的 SPA 回退会返回 index.html，`import()` 必然失败。不做自动刷新，避免循环。
- `src/components/RouteView.tsx`：懒加载的 case 包进 `<ChunkErrorBoundary><Suspense fallback={<Skeleton label="页面加载中…" />}>…</Suspense></ChunkErrorBoundary>`。fallback **不放标题**（P3 约定：测试靠等标题出现来判断数据就绪）。

**CSP**：生产构建里 Vite 用 `<link rel="stylesheet">` 和 `<link rel="modulepreload">` 加载分块的 CSS 和 JS，都在 `'self'` 之内，不插 `<style>`，现有 CSP 够用。`dev` 模式会插 `<style>`，但不受 `_headers` 约束。

**测试**：
- spec 写明「DOM 测试改用 findBy 等 Suspense 加载完」：跑一遍 dom 套件，导航到懒加载页面以后**紧接着**用 `getBy*` / `queryBy*` 的地方改成 `await findBy*`（「断言不存在」的，先 `findBy` 等页面出来再 `queryBy`）。**只改等待方式，不改断言内容**。`act(...)` 警告仍然只有 `onboarding-roles` 的 3 条。
- 新 `tests/dom/lazy-routes.test.tsx`：进入懒加载页面先看到 `aria-busy` 的骨架，然后是页面；单独渲染 `ChunkErrorBoundary`，包一个 `lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))`，出现 alert 和「刷新页面」。

**完成标准**：`npm run build` 输出多个 JS chunk，入口 chunk 比基线小（前后的 kB 和 gzip 数写进 PR 描述）；手动走一遍每个懒加载页面，样式和拆包前一致。CSS 拆分后加载顺序会变，重点看按钮、卡片这类公共样式有没有被页面样式盖掉。

**可否跳过**：可以。改动面最大（碰所有页面测试的等待方式），所以排在其他界面项之后，一次覆盖新加的页面。

### 3.10 「催一下」（B5-5，可选中的可选）

**要做什么**：组织者在开局前，给还没回复的人（仍是 `invited`）发一条 Bot 私信提醒。**只在 Node 端实现**：D1 Worker 本来就没有私信，那里这个接口是 404，前端不显示入口。

**接口**：`POST /api/sessions/:id/nudge`，没有 body。
- 顺序和 P2-1 的 `/invite` 一致：401 → 503（只读）→ 400（id）→ 404 → 403（`getSessionRow` 再 `requireOrganizer(row, caller)`：组织者或管理员）→ 400（已取消 / 已结算）→ 400（已开局）。
- 写 outbox：一条 `INSERT … SELECT … ON CONFLICT (dedupe_key) DO NOTHING RETURNING entity_id`，收件人是这局里 `rsvp = 'invited'`、不是组织者的人，kind `dm.session.nudge`，payload `{session_id}`，dedupe key `'dm:nudge:' || user_id || ':' || <看板日期>`。按 spec 字面「按人按天」：同一个人一天最多被催一次，不分是哪一局。看板日期按 `RESET_TZ_OFFSET`（`resetOffsetHours`）换算。
- 返回 `{ queued, already }`：这次新排进队的人数、今天已经被催过的人数。**不返回、也不能推出谁能收到私信**（§4.3、§11 第 9 条）：没绑 Discord 的人照样排队，由 dispatcher 跳过，所以 `queued` 和谁绑了没有关系。

**文件**：
- 新 `server/src/session-nudge.ts`（逻辑）；路由注册在 `server/src/link-routes.ts` 的 Hono app 里，复用它现成的会话读取、CSRF、CORS 和只读判断。
- `server/src/api-host.ts`：新增 `isNodeOnlyPath(url)` = `isBindingPath(url)` 或路径精确匹配 `^/api/sessions/[1-9]\d{0,14}/nudge$`（判断前照样先 decode，和 `routedPath` 一致）。`createApiHost` 和 `server/src/backend.ts`（没配 Discord 时整组回 404 的那个分支）都改用它。
- `server/src/discord/sessions.ts`：`SessionDmKind` 和 `SESSION_DM_KINDS` 加 `'dm.session.nudge'`；`sessionDmRelevant` 里它和 invited 一样，要求 `isUpcoming(session, now) && rsvp === 'invited'`（发出前对方已经回复了，就跳过）；`renderSessionDm` 加一个 case，带 `rsvpRow` 按钮，标题经过 `safeLine`。
- `server/src/outbox/dispatcher.ts`，额度并进现有那一组（数值不变，spec §8「额度不动」）：

```ts
{ kinds: ['dm.session.invited', 'dm.session.changed', 'dm.session.nudge'], limit: SESSION_DM_BUDGET },
```

  `deliverSessionDm` 发送成功后「`knows = true` + 补发取消通知」那个分支也加上 nudge：收到催促就算知道这局了。
- 前端：P3-3 的 `OrganizerConsole`【开局前】状态，「N 人还没回」旁边加「催一下」，用 `ConfirmInline` 原地确认。只在 `counts.invited > 0`、并且后端是 Node 时出现。判断 Node 的依据是 P3-2 的 `useTodoSources` 已经拿到的 `discord`：既不是 `undefined`（404），也不是 `'error'`。经 `RouteView` 把它作为新的可选 prop 传到详情页，**不加新请求**。POST 仍然返回 404 时，按钮在这一页上隐藏，不出 alert。
- `src/api.ts` 的 `nudgeSession(id)`；`docs/CONTRACT.md`、`docs/DEPLOY-DISCORD.md` 各加一条。

**文案**（spec 只有「催一下」三个字，其余是本计划拟的，第 6 节第 2 条）：确认「私信提醒还没回的 N 人？同一个人一天最多被催一次。」[先不催] [催一下]；成功 toast（role="status"）「已提醒 N 人。没绑 Discord 的朋友，记得在群里喊一声。」（照 spec §3.5 InviteSheet 那句的口吻）；`queued` 为 0 时「今天已经催过了，明天再试。」；私信标题「👋 {组织者} 在等你回话：{局名}」。

**测试**：新 `tests/pg/session-nudge.test.ts`：组织者 200，`queued` 等于还没回的人数（不含组织者，含没绑 Discord 的人）；当天再催 `queued: 0`、`already` 等于人数；非组织者 403、管理员可以；已开局、已取消 400；dispatcher 只给仍是 invited 的人发，排队后对方回复了就 skipped；和 invited、changed 共用 `SESSION_DM_BUDGET`（当天第 11 条会话私信被跳过）；响应里没有任何和绑定有关的字段。`server/test/session-render.test.ts` 加 nudge 的渲染（`safeLine`、按钮）。Worker 侧在 `tests/worker/session-routes.test.ts` 末尾加一条：`POST /api/sessions/1/nudge` 是 404。新 `tests/dom/organizer-nudge.test.tsx`：Node 后端时有按钮、D1（`discord` 为 `undefined`）时没有；确认后只发一次 POST；toast 文案；404 时按钮消失、没有 alert。

**完成标准**：Node 后端上，组织者催一下，没回的人收到一条带「来 / 待定 / 不来」按钮的私信，并且受每日额度约束；D1 上看不到入口。

**可否跳过**：可以，spec 本身标「可选」。改动面最大（Node 路由分流、dispatcher、额度），也最先砍。

## 4. 不能破的约束

先照 `docs/redesign-v5/HANDOFF.md` 第 4 节：一次一个 PR；以锚点文字定位；对不上时在计划意图之内做最小修改，并在 PR 描述里写明；提 PR 前跑全量验证；标题 `<type>: <中文描述>（<PR id>）`，commit 和 PR 描述都不加署名行；固定约束（`?case`、`?session`、`?linked`、`?onboarding` 永久兼容；§6.5 锁定文案和类名不改；CSP 不允许内联 `<style>`、`style="…"` 字符串、`dangerouslySetInnerHTML`；DOM 顺序就是视觉顺序；组件签名只加可选 props；新入口在接口 404 时静默隐藏）。

本期特有的：

1. **CSP 只收紧不放宽**：只有 `style-src`、`font-src` 变成 `'self'`，不加任何新来源、不加 `unsafe-inline`；改 CSP 的同时在 `tests/unit/pages-headers.test.ts` **新增**断言锁住结果，其余断言一字不改。PWA 和拆包都不需要动 CSP；谁觉得要放宽，就停下来回报。
2. **不加 service worker**（§10 第 15 条）：不注册 `navigator.serviceWorker`，不引入 workbox 或 `vite-plugin-pwa`。`pwa-manifest.test.ts` 锁住这一条。
3. **bot 用词不改**：bot 保留「陈述」（§11 第 15 条）；`server/src/discord/*` 里只有「催一下」新增的渲染，不改任何已有文案。
4. **不做 staging API**（§11 第 13 条）。
5. **隐私**：网页上不点名鸽王，往期列表也一样（§11 第 2 条）；`/api/admin/users` 只有五个键，不带 `email`、`discord_*`；「催一下」的响应和文案都不透露谁能收到私信（§4.3、§11 第 9 条）；AI 的 API Key 不经过前端（B5-3）。
6. **请求**：首屏请求集合不变（`app-refresh.test.tsx` 锁着）。`SinceLastVisit` 只用已有数据；往期战报、全部账号只在各自页面请求；「催一下」靠已有的 `/api/me/discord` 结果判断后端能力。
7. **D1 和 PG 一致**：新 SQL 两边都合法（不用 `? IS NULL` 这种推不出类型的占位符），`tests/worker/**` 在 pg 配置下再跑一遍；本期没有迁移。只在 Node 端的只有 B5-5，Worker 上必须是 404。
8. **锁定的测试点**：`modal-stack.test.tsx` 的 `'✕'`；`/上周战报/`、`/往期战报/` 的标题规则；「设为裁判」「取消裁判资格」；`act(...)` 警告仍是 3 条。

## 5. 验证

命令（Node 24）：

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npx vitest run --config vitest.config.ts        # unit
npx vitest run --config vitest.dom.config.ts    # dom（数一下 act(...) 警告：仍是 3 条）
npm run test:worker                             # 第 3–6、10 项动了 worker/
npm run test:server                             # 第 10 项
npm run test:pg                                 # tests/worker/** + tests/pg/**，起嵌入式 PG
npm run build                                   # 记下各 chunk 的 kB / gzip，和基线对比
VITE_API_BASE=https://capi.nanako.org npm run build:pages
cat dist/_headers | grep Content-Security-Policy   # 只有 style-src、font-src 变成 'self'
ls dist dist/assets                             # 多了 manifest.webmanifest、icons/、*.woff2、多个 js chunk；没有 404.html
grep -l "data:font" dist/assets/*.css || echo "字体没有被内联"
```

`tests/pg/adapter.test.ts` 偶发 5 秒超时（负载高时）：单独重跑那个文件确认 4/4，记进 PR 描述。

手动检查（预览环境只看静态页面，§11 第 13 条；要连接口的项在合并部署后到正式环境看）：

- [ ] **Lighthouse**（Chrome DevTools，移动端模拟，Performance 一项）：和基线比 FCP、LCP；「阻塞渲染的资源」里不再有 fonts.googleapis.com。新版 Lighthouse 已没有 PWA 分类，PWA 看 DevTools → Application → Manifest。
- [ ] **包体积**：入口 chunk 前后的 kB 和 gzip 数（`npm run build` 的输出），写进 PR 描述。
- [ ] **字体**：数字和拉丁字母是 Rajdhani，中文是系统字体（iOS、Android、Windows 各看一眼）；Network 里字体来自同源 `/assets/`；Console 没有 CSP 报错。
- [ ] **PWA**：Android Chrome、iOS Safari 实机「添加到主屏幕」：图标、名字正确，打开是全屏；**在主屏幕图标里能登录**，登录回来停在原页（OAuth 要跳到 API 域名，iOS 主屏幕模式下的 cookie 是单独一份，这里最容易出问题）；没有浏览器返回键时，每个页面都能靠 PageBar 回去。
- [ ] **拆包**：逐个打开懒加载页面，骨架 → 内容，样式和改前一致；部署新版本后，在旧标签页里点进一个没加载过的页面，出现「刷新页面」提示。
- [ ] **往期战报**：`/board/report` 能往前翻，没有「上周鸽王」奖项。
- [ ] **全部账号**：管理员给不在榜的小号设裁判，小号能立案。
- [ ] **AI 试跑**：改提示词不保存直接试跑，结果按新提示词出；刷新后配置未变。
- [ ] **并行归类**：AI 开着时 8 人立案约 1 分钟返回，结果顺序和选人顺序一致。
- [ ] **SinceLastVisit**：隔天再来看到摘要，内容和实际一致；刷新后不再出现。
- [ ] **催一下**：正式后端上，用一局只叫了自己小号的测试局：小号收到私信、按钮能用；当天再催提示「已经催过」。

## 6. 需要机主过目

1. **PWA 图标的图案和显示模式**：SPA 现在没有任何 favicon（Discord 分享页的 `favicon.svg` 是另一个形象），图标稿要机主定。如果实机发现 iOS 主屏幕模式下登录回不来，是把 `display` 改成 `browser`（从主屏幕打开普通 Safari 标签页），还是接受主屏幕里只能看、不能登录？
2. **本计划自拟的文案**（spec 没给原文）：往期战报的「更早的战报」「再往前看」；`SinceLastVisit` 多局时的写法和「不看这条」；拆包失败的「页面没加载出来，可能是网站刚更新过。」「刷新页面」；AI 试跑的两句提示；「催一下」的确认、toast、「今天已经催过了」和私信标题。
3. **`SinceLastVisit` 的位置和算法**：放在「要你处理」之后、我的分数之前（spec §2.4 的首页顺序里没有它）；「你 ±N」用本机记下的上次分数来算（spec 只写记 `lastSeenAt`），所以换设备或清缓存后第一次不显示。
4. **并行归类的代价**：接近每日立案上限（24 小时 40 起）时，同一批最多多放过 2 起；供应商限流时，同一批里会有更多人走保底判。
5. **「催一下」的规则**：按 spec 字面「按人按天」去重，一个人一天最多被催一次，不分是哪一局；入口只在 Node 后端出现，判断依据是 `/api/me/discord` 不是 404。
6. **新增依赖 `@fontsource/rajdhani`**（OFL 许可，只用拉丁子集的 500 / 600 / 700）。不想加依赖，就把三个 woff2 直接提交进仓库。

## 7. PR

**标题**：`feat: 锦上添花：自托管字体、PWA、按路由拆包、往期战报等（P5）`。只挑了几项时，标题列实际做了的，例如 `feat: 自托管字体并收紧 CSP、PWA 图标（P5）`。

**描述要点**：
- **做了哪几项、没做哪几项**：照第 1 节的表逐项打勾，没做的写「本 PR 不含」。每项对应哪些 commit。
- **CSP 前后对比**：贴 `_headers` 里改前、改后的两行，说明只收紧。
- **数字**：六个套件开工基线和收尾的「文件 / 用例」；`act(...)` 警告仍是 3 条；入口 chunk 和总 JS / CSS 的 kB、gzip 前后对比；Lighthouse 前后的 FCP、LCP（如果做了）。
- **有意改动的测试**：拆包改成 `findBy` 的文件清单（只改等待方式）；`pages-headers.test.ts` 新增的断言。
- **偏离与自拟**：第 6 节各条的结论；开工时第二批图标的盘点清单。
- **部署**：没有迁移。动了 `worker/` 的项（第 3–6 项）合并后要在 Coolify Redeploy；还在用 D1 Worker 的环境也要重新部署 Worker。前端对旧后端都有降级：往期战报和全部账号 404 时隐藏；AI 试跑没有 `draft_applied` 时提示用的是已保存的配置。「催一下」只在 Node 端，需要 Redeploy 以后才出现。前端由 Cloudflare Pages 自动部署，部署后用 `curl -sI <站点>/` 看一眼 CSP。
- **手动检查**：第 5 节清单逐条写结果，没做的写「未手动验证」。
