# EDG 信誉分

**EDG 信誉分** = 仿王者荣耀信誉分的开黑守约计分板 —— 迟到 / 放鸽子 / 中途开溜由裁判记一笔，**由 AI 裁判定性并量刑**、按周恢复，每周自动出一份**战报**。日常在 Discord 里约人，网页查看榜单、案件并处理管理操作。

## 玩法

每位 **上榜选手** 初始信誉分为 **100**，分值范围 **0–100**。

### 裁判只写事实，AI 定性 + 量刑

**记一笔时不用选类型，也不用一个一个记** —— 勾几个人、写一段话就完事：

```
裁判勾 N 人 + 写一段事实 → 提交（此时 0 分不扣）
        ↓
① AI 归类：读裁判的描述，归到某个案由 + 总结成一句话
   （被告此刻还没开口，所以他无法影响自己被归成哪一类）
        ↓
被告 12 小时内说明情况（不说也行，按缺席裁决）
        ↓
② AI 量刑：在 ① 定下的案由区间内定分 + 写判词
        ↓
分数生效
```

**归类和量刑是两次独立调用，这是安全边界不是性能选择**：合并就意味着归类要等被告
陈述之后才做，那被告就能用陈述影响自己的定性（「这其实只是小迟到」）。拆开之后，
陈述只能影响区间内的取值，碰不到区间本身。同理**多人立案时每人单独归类**，否则
针对 A 的控诉文字能污染 B 的定性。

归类失败（AI 挂了 / 返回非法案由 / 想返回加分类型）一律落到「其他」（-10 ~ 0，可判 0）
—— **失败必须偏向对被告有利**。

被告对判决不服可以**申诉**，转管理员人工复核；裁判在判决前可随时**撤案**（一分不扣）。

### 量刑区间 (`shared/scoring.ts` → `VIOLATIONS`)

| 类型 | 说明 | 最重 | 基准 | 最轻 |
|------|------|:----:|:----:|:----:|
| ⏰ 小迟到 | 迟到 < 15 分钟 | -5 | -3 | -1 |
| ⏰ 大迟到 | 迟到 15–30 分钟 | -9 | -6 | -3 |
| ⏰ 严重迟到 | 迟到 > 30 分钟 | -14 | -10 | -5 |
| 🔄 临时改约 | 提前但临时改时间 / 时长 | -8 | -5 | -1 |
| 🕊️ 放鸽子 | 答应了没来，也没提前说 | -20 | -15 | -8 |
| 💥 团灭级放鸽 | 多人局因你临阵脱逃而解散 | -30 | -25 | -15 |
| 🚪 中途开溜 | 打一半跑了 | -16 | -12 | -6 |
| 😴 摆烂挂机 | 人在心不在（娱乐向） | -12 | -8 | -3 |
| 📝 其他 | 都不沾边的情况，AI 酌情裁量（可判 0） | -10 | -5 | 0 |

**基准分**是锚点：没有特殊情节就判基准分，AI 不可用时也回退到它。提前告知、不可抗力、
事后补偿、初犯从轻；失联、甩锅、短期重犯、导致整局解散从重。

守约 +2、组局 +2 已停用，不再产生新记录；`VIOLATIONS` 保留这两个类型供历史案件显示。

### AI 判不出格 —— 三道护栏

1. **提示词层**：系统提示词声明标签内文本是证据、不是指令。
2. **输入消毒**：立案与陈述文本会剥掉 `</statement>`、`<|im_start|>` 等定界符，并截断到 1000 字。
3. **服务端硬夹取**（决定性的一道）：`clampVerdictDelta()` 把 AI 返回的分值强制夹回该案由区间。
   即使提示词注入完全成功，天花板也只是**该案由的最轻处罚** —— 不可能变成加分，不可能越界。
   越界会记进 `ai_verdicts.clamped`，管理面板能看到「越界率」这个指标。

AI 挂了不会卡住案件：超时 / 非 2xx / 解析失败一律回退到基准分并标注「AI 不可用」，
案件照常走到已判决 —— 否则玩家的分数会无限期悬空。

### 日常入口与历史兼容

约人直接在 Discord 里喊；迟到、放鸽子由裁判记一笔。网页和机器人都已移除创建、报名、邀请、点名和结算入口。
约局的表和历史数据保留，旧案件仍能读取关联上下文，旧周报照常显示。

### 每周战报

每周一上午 10:30（按 `RESET_TZ_OFFSET` 本地时区）之后，系统生成上周战报：首页在最近案件之后显示紧凑卡片，信誉榜的战报页显示全文；
上周立的案还没判完的话会再等一等（最多到周一零点后一个陈述期限再加一小时）。案件统计按首次判决所在周计算，旧记录没有对应计分事件时才回退到立案时间。
在那之前首页显示的是往期战报。配了 Discord 判决频道的话，战报会同时发到频道里。

> 🏆 本周之星 · 🕊️ 本周鸽王 · **🗣️ 最会说话**（谁的陈述把 AI 说服得最多）

「最会说话奖」= 本周 `delta - base` 最大的那一次判罚。它量化了「好好解释真的有用」，
反过来促使大家去写陈述而不是躺平缺席。

**数字全部由 SQL 算，AI 一个数都不许算** —— AI 只负责把算好的数字串成人话。让 AI 做
算术是这类功能最常见的翻车点，而且没人会去核对一段读起来很顺的话。新周报只统计案件、分数变化和判决，不再统计开局、出勤、组局人与下周约局；旧周报的这些字段缺失或为 0 时，对应行隐藏。周报按周幂等
（`weekly_reports` 以周为主键），AI 挂了就回退到模板，只是没那么好笑。

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

每周一 0 点（按 `RESET_TZ_OFFSET` 本地时区，默认北京时间 UTC+8）自动为每位上榜选手恢复
**`WEEKLY_HEAL` = 15** 分（不超过 100 分上限）。该任务是幂等的：同一周只会执行一次
（`weekly_heals` 表记录已处理的周）。它和「逾期案件裁决」都挂在首次访问的 `GET /api/config`
上惰性执行，因此**不强制需要 Cron Trigger**。

## 角色

| 角色 | 权限 |
|------|------|
| 游客（未登录 / 未上榜） | 只读：查看排行榜、记录列表、选手主页（判决后看得到案由、扣了几分和状态，判决前只显示「有一起记录在处理中」；陈述、申诉理由和判词只给当事人、立案人、裁判和管理员看） |
| 上榜选手 (`is_participant`) | 拥有信誉分，出现在排行榜；被立案时可**说明情况**，判决后可**申诉** |
| 裁判 (`is_judge`) | 可**一次对多人立案**（只写事实，AI 归类+量刑）；可改案由（历史点名案件仍只在放鸽子和团灭级放鸽之间改）、确认团灭级升级（都限自己立的案）；判决前可撤案，判决后 15 分钟内可撤销 |
| 管理员 (`is_admin`) | 管理任意用户角色 / 分数，复核申诉并**改判**，随时撤销任意记录，删除用户；配置 AI 裁判 |

「上榜」通过 `POST /api/me/roles` 自助开启或关闭。**裁判资格由管理员授予**：在选手主页点「设为裁判」（`POST /api/admin/users/:id`
`{"is_judge": true}`）；已是裁判的人可以自己放弃，放弃后要管理员重新授予。每次立案都会私信被告（Discord，P6），所以不能人人自封裁判。
管理员身份在 OAuth 登录时按 `ADMIN_SUBJECT_IDS` 环境变量自动授予，此后可通过管理端点调整其他用户。

## 路由

前端是单页应用，没有引入路由库：`src/lib/routes.ts`（纯函数）负责解析 pathname，`src/lib/router.ts` 负责 `history`。查询串和 hash 不参与选路由。手机（窄于 1024px）上选手是整页，顶部有 sticky 的「‹ 返回」；桌面（1024px 及以上）上是右侧抽屉，首页留在底下。

| 路由 | 呈现（手机 / 桌面） | 内容 |
|---|---|---|
| `/` | 页面 | 待办 / 欢迎卡 → 我的分数（已上榜）→ 紧凑信誉榜 → 最近案件 → 紧凑战报 |
| `/welcome` | 手机、桌面均为整页 | 五步入户，也可编辑名字、身份、Discord 绑定与私信设置 |
| `/guide` | 手机、桌面均为整页 | 机器人指南，与 `/help`、欢迎私信和入户第 5 步共用文案 |
| `/sessions`、`/sessions/*` | 页面 | 「约局功能已下线」，正文「约人直接在 Discord 里喊；迟到、放鸽子由裁判记录。」，附「回首页」 |
| `/players/:id` | 页面 / 右侧抽屉 | 选手页：分数、走势、记录 |
| `/players/:id/cases/:caseId` | 同选手页 | 这一起案件移到最上方（移动，不是复制）并获得焦点 |
| `/cases/:id` | 别名 | 先查出当事人，再换成上一行的地址 |
| `/board`、`/board/feed`、`/board/report`、`/board/rules` | 页面 | 信誉榜 / 动态 / 战报 / 规则 |
| 其他任何路径 | 页面 | 「这页不存在」，附「回大厅」 |

首页的 DOM 顺序与上表一致。桌面左栏是待办 / 欢迎卡和最近案件，右栏是分数、信誉榜和战报。最近案件初始显示 5 条，可用原有「看更多」，下方「全部动态」打开 `/board/feed`。页头没有创建约局入口，手机底部标签只有「首页·N」「信誉榜」「我的」；裁判和管理员的「记一笔」仍在头像菜单里。

S2 已用 `/welcome` 取代首登身份弹窗：首页访客点「开始」，头像菜单的「编辑身份」「通知与 Discord」也到这里。
入户是登录 → 加入服务器并绑定 → 开启私信 → 名字与身份 → 指南，完成状态来自服务器；旧 Worker 不支持 Discord 时隐藏控件，不会跳过绑定与私信步骤。
服务器状态已知、步骤 2–4 仍有缺项的已登录用户在待办最前看到「还差 N 步完成入户」，可关闭 7 天；出现新的未完成步骤时重新显示，不计入待办数字或提示圆点。
新绑、换绑自动发送欢迎私信，开启私信的人还可手动重发（滚动 24 小时最多 3 次，自动欢迎不占次数）。后续语音、信息板与管理路由按 [v6 分期](./docs/redesign-v6/spec.md#9-分期) 实施；v5 P4、P5 规划已经作废。

- **id**：案件数字 id 只认 `^[1-9]\d{0,14}$`（所以 `/cases/07` 无效）；选手 id 是 OAuth 的 subject，路径里一律 `encodeURIComponent`，最长 128 个字符。`/players/A/cases/7` 里第 7 起的当事人不是 A 时，地址直接换成正确的选手，不报错。`/sessions` 的任意子路径都落到下线页。
- **后端前缀**：路由不以 `/api`、`/auth`、`/link` 开头，这些归 API。托管必须对其他所有路径返回 `index.html`（SPA 回退），构建产物里不能有 `404.html`（`npm run build:pages` 发现就失败）。
- **旧链接永久可用**：`/?session=N` 留在首页，弹出「约局功能已下线」Toast，并用 replace 清掉参数；`/?case=N` 先查一次这起案件，再变成 `/players/<当事人>/cases/N`；`utm` 之类的其他参数原样保留。`?onboarding=1`、`?linked=discord` 都先进入 `/welcome`，后者显示绑定成功提示；点「完成，去首页」后再继续原来的只读目标。案件 / session 深链优先，其次登录回跳，再其次入户前的非首页地址。
- **返回键**：直接打开深层地址（新标签页、Discord 私信）时先垫一条 `/`，所以返回一次就回到首页，刷新不会越垫越多。底部浮层和对话框各占一条历史，返回键只关最上面那一层（有草稿的先问一句）；刷新不会重开浮层；回到首页时滚动位置还在。
- **登录回跳**：点「登录」之前，当前站内地址存进 `sessionStorage['edg.return']`，30 分钟内有效，登录回来自动回到原页。旧版本值中的报名 `intent` 忽略，地址仍照常解析；存下的 `/sessions` 及子路径统一回首页。登录回跳不执行任何业务操作，旧 `?case` / `?session` 深链优先。入户期间，同一标签页的 `edg.welcome.return` 只保留合法原目标 30 分钟，可跨 Discord 绑定和页面刷新；当前显式目标优先于旧记录，完成入户或退出登录清掉记录。
- 细节以 [docs/CONTRACT.md「Frontend expectations」](./docs/CONTRACT.md#frontend-expectations) 为准；真机验收清单见 [docs/redesign-v5/p1-acceptance.md](./docs/redesign-v5/p1-acceptance.md)，其中约局项已经作废，其余按 v6 HANDOFF 由机主验收。

## 技术栈

- **Cloudflare Worker** + **Hono**（`worker/index.ts` 为入口，处理 `/api/*`、`/auth/*`，其余请求交给 `ASSETS` 静态资源绑定 —— SPA fallback）
- **Cloudflare D1**（SQLite 兼容，表结构见 `schema.sql`）
- **惰性后台任务**（每周恢复 + 逾期案件裁决，挂在 `/api/config` 的 `waitUntil` 上；`scheduled()` 亦可）
- **React 18 + Vite** 前端 SPA（`src/`，构建产物在 `./dist`）
- 单一真源（前后端共同 import，禁止各处硬编码）：`shared/scoring.ts`（计分与量刑区间）、`shared/attendance.ts`（历史案件改案由校验）、`shared/boardTime.ts`（榜单时区标签）
- **AI 裁判**：任何 OpenAI 兼容端点（`worker/ai/`，仅用 `fetch`，无 SDK 依赖）
- 测试：Vitest（纯逻辑单测）+ `@cloudflare/vitest-pool-workers`（真实 D1 集成测试）

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
├── docs/CONTRACT.md       # 前后端接口 / 数据结构契约（唯一真源）
├── docs/DESIGN-v2.md      # v2 设计文档（为什么这样设计、威胁模型、分期）
├── shared/scoring.ts      # 计分规则 + 量刑区间 + 案件状态机（纯模块，前后端共用）
├── shared/attendance.ts   # 历史案件的改案由校验（纯模块）
├── shared/boardTime.ts    # 榜单时区标签（纯模块）
├── schema.sql             # D1 表结构（全新部署用）
├── migrations/            # v1 → v2 增量迁移（已有数据的库用）
├── wrangler.toml          # Cloudflare Worker 配置（D1 绑定、静态资源、变量）
├── worker/                # Hono Worker 源码
│   ├── cases.ts           #   案件生命周期：立案 → 陈述 → 裁决 → 申诉 / 撤销
│   ├── report.ts          #   周报统计（全部 SQL 算）+ 按周幂等生成
│   └── ai/                #   归类 / 量刑 / 周报三套调用，输入消毒 + 输出夹取
├── src/                   # React + Vite 前端源码
├── server/                # Node 后端（Coolify / Docker Compose），npm workspace
│   ├── src/app.ts         #   按 Host 分流：discord.* → 分享页，api.* → API
│   ├── src/api.ts         #   在 Node 上运行 Worker 原封不动的代码（Env、waitUntil、定时任务）
│   ├── src/db/d1.ts       #   PostgreSQL 上的 D1 兼容适配层
│   ├── migrations/        #   PostgreSQL 表结构（schema.sql 的忠实移植）
│   ├── src/share/         #   Discord 分享页，移植自 discord-share（poller + linkedom）
│   ├── share-public/      #   分享页静态文件（原 discord-share/public）
│   └── test/              #   Node 端测试
├── Dockerfile, compose.yaml # 镜像与 Coolify stack，见 docs/DEPLOY-COOLIFY.md
├── tests/unit/            # 纯逻辑单测（Node）
├── tests/worker/          # 真实 D1 集成测试（Miniflare）
├── .dev.vars.example      # 本地环境变量示例（复制为 .dev.vars）
└── package.json           # npm scripts、依赖声明
```

## npm scripts

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 Worker 本地开发（`wrangler dev`），监听 :8787 |
| `npm run dev:web` | 启动 Vite 开发服务器，监听 :5173，代理 `/api` `/auth` 到 :8787 |
| `npm run build` | 构建前端产物到 `./dist`（`vite build`） |
| `npm run build:pages` | Cloudflare Pages 构建：`vite build` + 按 `VITE_API_BASE` 生成 `dist/_headers`（CSP 等） |
| `npm run preview` | 构建后用 `wrangler dev` 预览生产构建 |
| `npm run deploy` | 构建 + 部署到 Cloudflare（`vite build && wrangler deploy`） |
| `npm run typecheck` | 对前端与 Worker 两套 tsconfig 分别做 `tsc --noEmit` |
| `npm test` | 跑全部测试（单测 + D1 集成测试） |
| `npm run test:unit` | 只跑纯逻辑单测（快） |
| `npm run test:worker` | 只跑 D1 集成测试（Miniflare） |
| `npm run test:server` | 只跑 Node 后端测试（`server/`） |
| `npm run test:pg` | 把 worker 集成测试在 **PostgreSQL** 上再跑一遍（经 D1 兼容适配层；本地自动起嵌入式 PG，CI 用 `TEST_DATABASE_URL`） |
| `node scripts/d1-export.mjs <dir>` | 导出 D1 全部表为 JSON（切换用，只读） |
| `node scripts/compare-api.mjs <old> <new>` | 逐个对比两套部署的公开 API（切换 go/no-go 用） |
| `npm run build -w server` | 打包 Node 后端到 `server/dist`（esbuild） |
| `npm run dev -w server` | 本地跑 Node 后端（tsx watch） |
| `npm run db:local` | 在本地 D1 上执行 `schema.sql` 建表 |
| `npm run db:remote` | 在远程 D1（生产）上执行 `schema.sql` 建表 |
| `npm run db:migrate:local` | 在本地 D1 上执行 v1 → v2 迁移 |
| `npm run db:migrate:remote` | 在远程 D1 上执行 v1 → v2 迁移 |
| `npm run db:migrate3:local` | 在本地 D1 上执行 v2 → v3 迁移 |
| `npm run db:migrate3:remote` | 在远程 D1 上执行 v2 → v3 迁移 |
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
| `ADMIN_SUBJECT_IDS` | 可选 | 逗号分隔的 OAuth subject id（`users.id`），登录时命中则自动授予管理员权限 |
| `ADMIN_USERNAMES` | 可选（已废弃） | 逗号分隔的用户名；设置了 `ADMIN_SUBJECT_IDS` 后被忽略 |
| `READ_ONLY` | 可选 | `1` = 维护模式：所有写请求返回 503，惰性任务与 Cron 跳过（数据库切换时用） |
| `HOST_ONLY_COOKIES` | 可选 | `1` = cookie 名加 `__Host-` 前缀（SPA 在 Pages、Worker 在 api 子域时用，见 docs/DEPLOY-PAGES.md）；不能与 `COOKIE_DOMAIN` 同时设置 |
| `AI_BASE_URL` | AI 必需 | OpenAI 兼容端点，须以 `/v1` 结尾（代码只拼 `/chat/completions`） |
| `AI_MODEL` | AI 必需 | 模型名，如 `gpt-4o-mini` / `deepseek-chat` |
| `AI_API_KEY` | AI 必需 | **只能用 `wrangler secret put` 设置，永不落库** |
| `AI_ENABLED` | 可选（默认 `true`） | `false` 时一律按基准分判罚 |
| `AI_TEMPERATURE` | 可选（默认 `0.2`） | 判罚要可复现，建议 ≤ 0.3 |
| `AI_SYSTEM_PROMPT` | 可选 | 量刑提示词；留空用内置。归类与周报提示词只在管理面板里改（热生效，无需重新部署） |
| `STATEMENT_WINDOW_HOURS` | 可选（默认 `12`） | 被告说明情况的时限，超时按缺席裁决 |

> 本地开发把以上变量写进 `.dev.vars`（从 `.dev.vars.example` 复制）；生产环境的密钥类变量务必使用 `wrangler secret put`，详见 [DEPLOY.md](./DEPLOY.md)。
>
> `AI_BASE_URL` / `AI_MODEL` / `AI_TEMPERATURE` / `AI_SYSTEM_PROMPT` 都可以在
> **管理员 → AI 裁判配置**面板里改，写入 `app_settings` 表并覆盖环境变量 —— 提示词需要反复调，
> 不该改一次就重新部署一次。`AI_API_KEY` 是唯一的例外：它只从 Worker 机密读取，
> 因为把密钥存进 D1 等于任何 SQL 读路径都能拿到它。

## 部署

- **一体化部署**（前后端都在 Cloudflare Worker）：见 [DEPLOY.md](./DEPLOY.md)。
- **SPA → Cloudflare Pages，Worker 只做 API**（`score.` + `api.` 子域）：见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)。
- **Node 后端（Coolify + Docker Compose）**：Discord 分享页 `discord.nanako.org`，以及（P3a 起）跑在 PostgreSQL 上的 API。见 [docs/DEPLOY-COOLIFY.md](./docs/DEPLOY-COOLIFY.md)；API 从 Worker 切过去的步骤见 [docs/DEPLOY-CUTOVER.md](./docs/DEPLOY-CUTOVER.md)。
- **EdgeOne（已停用）**：前端已在 Cloudflare Pages（`community.nanako.org`），API 在 Node（`capi.nanako.org`），EdgeOne 不再使用。遗留的边缘函数 `functions/`（把 `/api`、`/auth` 反代到已下线的 workers.dev）和 `edgeone.json` 已在 P1-0 删除：Cloudflare Pages 会把根目录的 `functions/` 部署成 Pages Functions，挂在 `community.nanako.org/api/*`、`/auth/*` 上。核验记录见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)「SPA 回退核验（P1-0）」；[DEPLOY-EDGEONE.md](./DEPLOY-EDGEONE.md) 只作历史参考。
