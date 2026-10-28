# 管理页完整配置 AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 管理员在 `/admin/ai` 完整维护包括 API Key 在内的 AI 配置，网页和 Discord bot 下一次调用生效。

**Architecture:** 复用 `app_settings`、现有管理接口及共享 AI 加载入口。API Key 用独立部署主密钥加密，字段整体验证后通过 D1/PG 的原子 batch 保存；保留旧环境配置作为尚未迁入网页时的兼容。

**Tech Stack:** TypeScript、React 18、Hono、Web Crypto、Cloudflare D1、PostgreSQL D1 adapter、Vitest；不增加第三方加密依赖。

**Spec:** `docs/superpowers/specs/2026-10-28-admin-ai-config-design.md`。状态：用户于 2026-10-28 授权执行；实施、全量验证和独立审查均已完成，生产部署不在本轮范围。

## Global Constraints

- 基线为 S5 的 `origin/main=317ba1a`；当前工作目录仍在旧 P3 分支。执行前重新 fetch，核对最新差异，从最新 main 建实施分支；保留用户未跟踪文件 `COS_sdk_README_zh.md` 和这两份草案。
- Node 22 或 24；沿用一个全局 OpenAI 兼容配置与现有两阶段裁判、夹取、回退逻辑。
- `api_key` 省略保留、非空替换、`null` 清除；先拒绝原值中的 NUL/CR/LF（包括首尾换行），再 trim 并拒绝空值或超过 4096 字符的值。
- `AI_CONFIG_MASTER_KEY` 为 Base64 的 32 字节随机主密钥，app/bot 相同，不复用 `SESSION_SECRET`。
- AES-256-GCM、每次随机 12 字节 IV、128 位标签、AAD `edg-credit:ai.api_key:v1`。
- 仅凭据行缺失时回退旧环境 Key；清除态、密文损坏或解密失败不能恢复旧 Key。
- 管理端响应 `private, no-store`；不返回凭据明文/密文；不写浏览器存储、草稿、URL 或日志。
- 先完整校验与加密，再一次 `db.batch()`；D1/PG 保持相同行为，无 SQL 迁移。

## Review Focus

- 空密码框的普通保存：省略字段保持现有 Key，不能被误解释为清除（Task 2、3）。
- 清除后仍留有旧环境 Key：有效配置必须无凭据，不能复活旧值（Task 1、2）。
- app 与 bot 主密钥不一致、密文损坏：AI 安全回退，首页可读，不能静默改用旧 Key（Task 1、4）。
- 同时修改端点/模型/Key 时任一校验或写入失败：无半套配置、无 Key 外泄（Task 2）。
- 写入成功后重读失败、切账号后的迟到响应、上游错误回显 Key：正确反馈且不重新露出凭据（Task 2、3）。

---

### Task 1: 凭据封装与统一配置读取

**Files:**
- Create: `worker/ai/secrets.ts`, `tests/unit/ai-secrets.test.ts`
- Modify: `worker/ai/config.ts`, `worker/types.ts`, `tests/unit/ai-config.test.ts`
- Update callers: `worker/routes-admin.ts` 及其相关测试中的配置解析调用

**Interfaces:**
- `sealAiApiKey(apiKey: string, masterKey: string): Promise<string>`：返回设计规定的设置态 JSON。
- `openAiApiKey(envelope: string, masterKey: string): Promise<string>`：验证格式、版本、AAD 与认证标签；错误不包含输入材料。
- `resolveAiConfig(settings: Map<string, string>, env: AiEnvSlice): Promise<AiConfig>` 改为异步；`loadAiConfig(db, env): Promise<AiConfig>` 继续是领域入口。
- `AiEnvSlice`、`Env` 增加 `AI_CONFIG_MASTER_KEY?: string`；`AiConfig` 增加 `configuredEnabled: boolean`、`apiKeySource: 'database' | 'environment' | 'none'`、`apiKeyError: 'master_key_missing' | 'master_key_invalid' | 'decrypt_failed' | null`。
- `AI_SETTING_KEYS.apiKeyEncrypted = 'ai.api_key_encrypted'`；清除态固定为 JSON `{v:1,state:'cleared'}`。
- `aiDisabledReason(cfg: AiConfig): string | null` 只依据解析结果，移除对环境 Key 的二次判断。

- [x] **Step 1: 添加失败单测。** 覆盖加解密往返、相同 Key 不同 IV、错误主密钥、篡改、未知版本/非法封装；数据库优先、环境兼容、清除不复活、主密钥缺失/损坏时 `enabled === false`，并保留 `configuredEnabled`。
- [x] **Step 2: 确认测试红。** `npx vitest run --config vitest.config.ts tests/unit/ai-secrets.test.ts tests/unit/ai-config.test.ts`；应因缺少封装实现及现有“只读 env”断言而失败。
- [x] **Step 3: 实现封装和异步解析。** 无凭据行才使用旧 env；清除态不解密；解密故障转为固定状态，不向领域入口抛出凭据错误。普通配置读取优先级保持原样。
- [x] **Step 4: 更新所有生产/测试调用方并验证。** 上述单测及 `npm run typecheck` 通过；`git grep` 核对不存在未 await 的生产 `resolveAiConfig` 调用。
- [x] **Step 5: 提交本任务。** 记录凭据兼容边界、无需 SQL 迁移的决定；提交快照后完成独立审阅，通过后才进入下一任务。

### Task 2: 管理接口原子保存与输出过滤

**Files:**
- Modify: `worker/routes-admin.ts`, `worker/routes.ts`, `worker/ai/provider.ts`, `worker/ai/classify.ts`, `worker/ai/report.ts`
- Create: `worker/ai/redact.ts`, `tests/unit/ai-redact.test.ts`
- Modify: `tests/worker/admin-routes.test.ts`, `tests/unit/ai-provider.test.ts`, `tests/unit/ai-classify.test.ts`
- Add report-response tests to the existing AI report test location or a focused `tests/unit/ai-report-secret.test.ts`

**Interfaces:**
- POST 增加 `api_key?: string | null`，未知非法类型返回 400；先完整验证所有字段，再构造一组 prepared statements 并 `DB.batch()`。
- GET 增加 `configured_enabled`、`api_key_source`、`can_update_api_key`；后者仅表示主密钥有效，可设置/更换新 Key。`has_api_key` 以有效解析结果计算，不回传 Key 或密文。
- `redactAiSecret(text: string, apiKey: string): string`：将当前非空 Key 的精确出现替换为 `[已隐藏]`；空 Key 不改文本。
- 三条 AI 客户端在上游文本进入错误、审计和业务输出前调用过滤；试跑移除未被前端使用的 `raw` 返回字段，并更新接口契约。

- [x] **Step 1: 添加失败 API/单测。** 管理员可设置/更换/省略/清除；未登录 401、非管理员 403、只读拒绝写；空白/超长/非法类型及首尾带换行的原始输入拒绝；缺主密钥设置失败但普通保存可用、清除仍可用。
- [x] **Step 2: 添加原子性与泄露失败测试。** 同一请求合法模型+非法温度或 Key 时零写入；batch 中后续写入失败全部回滚；GET/POST/test、错误、审计及 AI 输出均不含假 Key；GET/test 也带 `private, no-store`。
- [x] **Step 3: 确认测试红。** 分别执行定向 unit 和 `npx vitest run --config vitest.workers.config.ts tests/worker/admin-routes.test.ts`，应由当前拒绝 `api_key`、非原子写入或未过滤响应触发失败。
- [x] **Step 4: 实现并验证。** 保留现有 URL/温度/提示词校验；缺主密钥写 Key 返回固定 503 原因，输入非法返回 400；明文不进入 SQL。配置解析错误不能让 `GET /api/config` 返回 500。重跑定向测试，并在 PG 套件执行同一共享 API 场景。
- [x] **Step 5: 提交本任务。** 核对显式清除屏蔽 env、三个 AI 客户端都应用过滤、鉴权在解析敏感请求前执行；提交快照后独立审阅，通过后才进入下一任务。

### Task 3: 管理页设置、更换与清除 API Key

**Files:**
- Modify: `src/components/AiSettings.tsx`, `src/types.ts`, `src/components/admin-ai.css`, `tests/dom/admin-ai.test.tsx`
- Modify if required: `src/api.ts`（沿用现有 POST 方法，不新增服务端代理）

**Interfaces:**
- `AiConfigPatch.api_key?: string | null`；`AiConfigResponse` 增加 Task 2 的三个只读元数据字段，前端声明为可选，以兼容旧后端；服务端固定返回。
- 普通保存不附带 Key；更换态提交非空输入；明确清除提交 `null`。密码框永不回填；启用开关读 `configured_enabled`，旧后端缺少该字段时回退 `enabled`。
- 继续用已保存配置试跑，不发送未保存 Key；有未保存修改时显示“请先保存配置，再试跑”。

- [x] **Step 1: 添加失败 DOM 测试。** 状态与来源、空框普通保存保留、替换请求、本页新增清除两步确认、缺主密钥禁用更换并给一次性部署提示但仍能清除、旧后端隐藏新增凭据操作、首尾换行等非法输入不提交。
- [x] **Step 2: 添加状态隔离失败测试。** 保存成功清空输入；请求失败清空 Key 且保留普通字段；写入成功但重读失败提示“修改已保存，状态刷新失败”；切账号/失权/卸载后的旧响应不恢复凭据输入；试跑仅在已保存配置上执行。
- [x] **Step 3: 确认测试红。** `npx vitest run --config vitest.dom.config.ts tests/dom/admin-ai.test.tsx`；应因缺少 Key 控件和旧环境提示而失败。
- [x] **Step 4: 实现现有页面内的交互。** 使用 `type="password"` 与 `autoComplete="new-password"`；复用项目既有确认交互模式，为本页新增清除两步确认；保留错误反馈和请求失效隔离。设置能力为 false 只禁用设置/更换，清除在新后端仍可操作；不加凭据草稿、不用内联样式。成功写入后单独处理状态刷新失败，避免误导重复提交。
- [x] **Step 5: 验证并提交。** 定向 DOM、现有成员/管理路由测试及类型检查通过；提交快照后独立审阅，通过后才进入下一任务。

### Task 4: 双运行时接线、文档与发布验收

**Files:**
- Modify: `compose.yaml`, `.dev.vars.example`, `README.md`, `DEPLOY.md`, `docs/DEPLOY-COOLIFY.md`, `docs/DEPLOY-DISCORD.md`, `docs/CONTRACT.md`
- Update stale key-only-in-env comments: `schema.sql`, `worker/types.ts`, `worker/ai/config.ts` 和前端相关说明；仅注释变更，无 SQL 迁移。
- Add: `tests/pg/ai-config.test.ts`, `server/test/ai-config-env.test.ts`（按现有测试辅助构造隔离环境）

**Interfaces:**
- compose 的 app、bot 均透传 `AI_CONFIG_MASTER_KEY: ${AI_CONFIG_MASTER_KEY:-}`；旧 AI 环境变量继续兼容首次迁入前的实例。
- Node API `buildEnv` 和 bot `actionCtx.env` 继续使用既有环境透传，共享 `loadAiConfig`；不引入各自缓存或第二份凭据存储。

- [x] **Step 1: 添加跨进程失败测试。** app 保存数据库 Key 后，模拟 bot 的独立 Env/DB 实例的下一次领域调用使用新 Key；错配/缺少主密钥时安全回退、公开配置可读，修复主密钥后可读取同一密文。测试使用临时 PG 和假提供商，不调用线上服务。
- [x] **Step 2: 验证接线并更新文档。** 明确一次性生成和持久保存主密钥、app/bot 同值、Redeploy、网页录入/试跑、bot 试跑、首次迁入兼容及凭据备份要求；删除当前功能说明中的 `wrangler secret put AI_API_KEY` 强制要求，保留旧部署资料的历史说明。对“Key 永不入库”改为“Key 仅以密文入库”。
- [x] **Step 3: 全量验证。** 在 Node 22/24 运行 `npm run typecheck`、`env -u TEST_DATABASE_URL npm test`、`npm run build`、`npm run build:pages`、`npm run build --workspace server`、`git diff --check`。`npm test` 已包含 PG；从这次入口就清除 `TEST_DATABASE_URL`，确保使用临时内嵌数据库，不再重复跑 PG 全量，不得把真实数据库用于测试。Task 2 单独运行 PG 时同样使用 `env -u TEST_DATABASE_URL npm run test:pg`。
- [x] **Step 4: 模拟验收与独立终审。** 桌面/手机管理页，纯网页首次配置、保留/更换/清除、试跑失败和密文故障；确认裁判无访问权限。评审检查明文泄露、事务边界、env 清除复活和 app/bot 一致性。
- [x] **Step 5: 交付可审阅变更与发布说明。** 本计划本身不执行真实配置、迁移或部署。未来按用户实施授权完成代码与验证；生产部署遵循当时明确授权的范围。


## 执行验证记录 · 2026-10-28

基线 `317ba1a`；Node v24.22.1。独立终审代码快照 `bb08d90`，无遗留 Critical/Important/Minor 问题。后续本节只记录结果，不改变产品代码。

| 验证 | 结果 |
|---|---|
| typecheck | 前端、Worker、server 全部通过 |
| unit | 40 文件，601 通过 |
| DOM | 36 文件，474 通过 |
| D1 Worker | 18 文件，555 通过，5 个已有 todo |
| Node server | 32 文件，378 通过 |
| PostgreSQL | 40 文件，953 通过，5 个相同已有 todo |
| build / build:pages / server build | 全部通过 |
| 独立浏览器验收 | 1280×900、390×900 共 26 项通过，无页面错误或横向溢出 |
| Compose 消费者验证 | 缺主密钥时 RED；接线后 app 与 bot 均成功读取加密凭据 |
| 独立代码审查 | 凭据、页面、接口与完整分支均通过；已修复并复查 JSON 转义密钥的截断边界问题 |

全量命令为 `env -u TEST_DATABASE_URL npm test`，只使用临时本地 PostgreSQL；五套执行合计 2961 项通过、零失败。未调用真实 AI 提供商、Discord Gateway 或生产数据库；页面验收用本地假 API，跨运行时测试用本地假提供商。未执行生产配置、迁移或部署；无需 SQL 迁移。
