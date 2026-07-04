# EDG 信誉分

**EDG 信誉分** = 仿王者荣耀信誉分的开黑守约计分板 —— 记录开黑约局中的迟到 / 放鸽子 / 中途开溜等行为，自动计分、按周恢复，谁靠谱一目了然。

## 玩法与规则

每位 **上榜选手** 初始信誉分为 **100**，分值范围 **0–100**。裁判（`is_judge`）可以给选手记一笔违约或守约，分数按下表变化，并即时生效（有夹紧 clamp 到 0–100）。

### 扣分 / 加分表 (`shared/scoring.ts` → `VIOLATIONS`)

| 类型 | 说明 | 分值 | 性质 |
|------|------|:----:|:----:|
| ⏰ 小迟到 | 迟到 < 15 分钟 | -3 | 扣分 |
| ⏰ 大迟到 | 迟到 15–30 分钟 | -6 | 扣分 |
| ⏰ 严重迟到 | 迟到 > 30 分钟 | -10 | 扣分 |
| 🔄 临时改约 | 提前但临时改时间 / 时长 | -5 | 扣分 |
| 🕊️ 放鸽子 | 答应了没来，也没提前说 | -15 | 扣分 |
| 💥 团灭级放鸽 | 多人局因你临阵脱逃而解散 | -25 | 扣分 |
| 🚪 中途开溜 | 打一半跑了 | -12 | 扣分 |
| 😴 摆烂挂机 | 人在心不在（娱乐向） | -8 | 扣分 |
| ✅ 守约守时 | 准时履约 | +2 | 加分 |
| 📣 组局召集 | 组织了一场局 | +2 | 加分 |

> 加分（守约 / 组局）每周合计不超过 **`WEEKLY_BONUS_CAP` = 6** 分，超出部分不再生效。

### 段位表 (`shared/scoring.ts` → `TIERS`)

| 最低分 | 段位 | 说明 |
|:----:|------|------|
| 95 | 🏆 誓约之光 | 完全信赖，优先组局 |
| 85 | 💎 守时楷模 | 靠谱 |
| 70 | ✅ 基本靠谱 | 正常 |
| 55 | ⚠️ 需要盯一下 | 组局前先确认一遍 |
| 40 | 🚧 鸽王预备役 | 谨慎组局 |
| 0 | 🕊️ 资深鸽王 | 建议收押金 / AA 先付 |

### 每周恢复

每周一 0 点（按 `RESET_TZ_OFFSET` 本地时区，默认北京时间 UTC+8）由 Cron 任务自动为每位上榜选手恢复 **`WEEKLY_HEAL` = 15** 分（不超过 100 分上限）。该任务是幂等的：同一周只会执行一次（`weekly_heals` 表记录已处理的周）。

## 角色

| 角色 | 权限 |
|------|------|
| 游客（未登录 / 未上榜） | 只读：查看排行榜、记录列表、选手主页 |
| 上榜选手 (`is_participant`) | 拥有信誉分，出现在排行榜；可对针对自己的记录发起 **申诉 (dispute)** |
| 裁判 (`is_judge`) | 可对其他选手「记一笔」（违约 / 守约）；可在 15 分钟内撤销自己记录的记录 |
| 管理员 (`is_admin`) | 管理任意用户角色 / 分数，随时撤销任意记录，删除用户 |

角色通过 `POST /api/me/roles` 自助开启（上榜 / 裁判）；管理员身份在 OAuth 登录时按 `ADMIN_USERNAMES` 环境变量自动授予，此后可通过管理端点调整其他用户。

## 技术栈

- **Cloudflare Worker** + **Hono**（`worker/index.ts` 为入口，处理 `/api/*`、`/auth/*`，其余请求交给 `ASSETS` 静态资源绑定 —— SPA fallback）
- **Cloudflare D1**（SQLite 兼容，表结构见 `schema.sql`）
- **Cron Trigger**（每周信誉分恢复，`scheduled()` 处理器）
- **React 18 + Vite** 前端 SPA（`src/`，构建产物在 `./dist`）
- 计分规则单一真源：`shared/scoring.ts`（前后端共同 import，禁止各处硬编码数字）

## 本地开发 Quickstart

```bash
# 1. 安装依赖
npm install

# 2. 配置本地环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 OAUTH_BASE_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET / SESSION_SECRET 等

# 3. 登录 Cloudflare（首次需要）
wrangler login

# 4. 创建 D1 数据库，并把返回的 database_id 填入 wrangler.toml 的 database_id 字段
wrangler d1 create edg-credit

# 5. 在本地 D1 上建表
npm run db:local
```

之后开两个终端并行运行：

```bash
# 终端 A：Worker（API + Cron 模拟），监听 :8787
npm run dev

# 终端 B：Vite 开发服务器，监听 :5173
# Vite 会把 /api 和 /auth 请求代理到 :8787 上的 Worker
npm run dev:web
```

打开浏览器访问 `http://localhost:5173` 即可开始开发；接口调试也可以直接打 `http://localhost:8787`。

## 目录结构

```
.
├── docs/CONTRACT.md      # 前后端接口 / 数据结构契约（唯一真源）
├── shared/scoring.ts      # 计分规则单一真源（前后端共用，纯模块）
├── schema.sql             # D1 表结构
├── wrangler.toml          # Cloudflare Worker 配置（D1 绑定、静态资源、Cron）
├── worker/                # Hono Worker 源码（API、OAuth、Cron）
├── src/                   # React + Vite 前端源码
├── .dev.vars.example      # 本地环境变量示例（复制为 .dev.vars）
└── package.json           # npm scripts、依赖声明
```

## npm scripts

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Worker 本地开发（`wrangler dev`），监听 :8787 |
| `npm run dev:web` | 启动 Vite 开发服务器，监听 :5173，代理 `/api` `/auth` 到 :8787 |
| `npm run build` | 构建前端产物到 `./dist`（`vite build`） |
| `npm run preview` | 构建后用 `wrangler dev` 预览生产构建 |
| `npm run deploy` | 构建 + 部署到 Cloudflare（`vite build && wrangler deploy`） |
| `npm run typecheck` | 对前端与 Worker 两套 tsconfig 分别做 `tsc --noEmit` |
| `npm run db:local` | 在本地 D1 上执行 `schema.sql` 建表 |
| `npm run db:remote` | 在远程 D1（生产）上执行 `schema.sql` 建表 |
| `npm run cf-typegen` | 由 `wrangler.toml` 生成 Cloudflare 绑定的 TypeScript 类型 |

## 环境变量

| 变量 | 必需 | 说明 |
|------|:----:|------|
| `OAUTH_BASE_URL` | ✅ | Nanako OAuth 服务的 base URL（`/oauth/authorize`、`/oauth/token`、`/oauth/userinfo` 均挂在其下） |
| `OAUTH_CLIENT_ID` | ✅ | OAuth 客户端 ID |
| `OAUTH_CLIENT_SECRET` | ✅ | OAuth 客户端密钥（生产环境用 `wrangler secret put` 设置，不要提交到仓库） |
| `SESSION_SECRET` | ✅ | 会话签名密钥（HS256），生产环境用 `wrangler secret put` 设置。生成方式：`openssl rand -base64 48` |
| `APP_URL` | 可选 | 显式指定应用外部 URL；不填则从请求 origin 推导 |
| `RESET_TZ_OFFSET` | 可选（默认 `8`） | 计算每周恢复重置时间点所用的时区偏移（小时），`8` = 北京时间 |
| `ADMIN_USERNAMES` | 可选 | 逗号分隔的用户名列表，登录时命中则自动授予管理员权限 |

> 本地开发把以上变量写进 `.dev.vars`（从 `.dev.vars.example` 复制）；生产环境的密钥类变量务必使用 `wrangler secret put`，详见 [DEPLOY.md](./DEPLOY.md)。

## 部署

- **一体化部署**（前后端都在 Cloudflare Worker）：见 [DEPLOY.md](./DEPLOY.md)。
- **拆分部署**（前端 → 腾讯 EdgeOne Pages，后端 → Cloudflare Worker）：见 [DEPLOY-EDGEONE.md](./DEPLOY-EDGEONE.md)，内含跨域会话 Cookie 的处理与三种架构方案（推荐 EdgeOne 边缘函数反代，保持单源、Safari 安全、无需自定义域名）。
