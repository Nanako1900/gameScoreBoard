# EDG 信誉分

**EDG 信誉分** = 仿王者荣耀信誉分的开黑守约计分板 —— 迟到 / 放鸽子 / 中途开溜由裁判或管理员记一笔，**由 AI 裁判定性并量刑**、按周恢复，每周自动出一份**战报**。日常在 Discord 里约人，网页查看榜单、案件并处理管理操作。

## 玩法

每位 **上榜选手** 初始信誉分为 **100**，分值范围 **0–100**。

### 裁判或管理员只写事实，AI 定性 + 量刑

**记一笔时不用选类型，也不用一个一个记** —— 勾几个人、写一段话就完事：

```
裁判或管理员勾 N 人 + 写一段事实 → 提交（此时 0 分不扣）
        ↓
① AI 归类：读立案人的描述，归到某个案由 + 总结成一句话
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

被告对判决不服可以**申诉**，转管理员人工复核；立案人或管理员可在等待说明期间**撤案**（一分不扣）。

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

约人直接在 Discord 里喊；迟到、放鸽子由裁判或管理员记一笔。网页和机器人都已移除创建、报名、邀请、点名和结算入口。
约局的表和历史数据保留，旧案件仍能读取关联上下文，旧周报照常显示。

### 每周战报

每周一上午 10:30（按 `RESET_TZ_OFFSET` 本地时区）之后，系统生成上周战报：首页在最近判决之后只显示一行日期与阅读链接，`/board/report` 显示全文；
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
| 裁判 (`is_judge`) | 可**一次对多人立案**（只写事实，AI 归类+量刑）；可改案由（历史点名案件仍只在放鸽子和团灭级放鸽之间改）、确认团灭级升级（都限自己立的案）；等待说明时可撤案，判决后可在立案起 15 分钟窗口内撤销 |
| 管理员 (`is_admin`) | 可**一次对多人立案**；设撤裁判、调整分数，复核申诉并**改判**，随时撤销任意记录；配置 AI 裁判 |

「上榜」在「设置 → 个人资料」（`/settings/profile`）通过 `POST /api/me/roles` 自助开启或关闭。**裁判资格由管理员授予**：在「设置 → 成员与权限」（`/settings/members`，包括不上榜账号）操作，调用 `POST /api/admin/users/:id`
`{"is_judge": true}`；个人页只提供统一管理入口。已是裁判的人可以自己放弃，放弃后要管理员重新授予。每次立案都会私信被告（Discord，P6），所以不能人人自封裁判。
管理员身份在 OAuth 登录时按 `ADMIN_SUBJECT_IDS` 环境变量自动授予，此后可通过管理端点调整其他用户。

## 路由

前端是单页应用，没有引入路由库：`src/lib/routes.ts`（纯函数）只解析 pathname，`src/lib/router.ts` 负责 `history`。查询串和 hash 不参与 `parseRoute`；页面可以单独读取 `?view=public`、`?user=` 等筛选或对象上下文。所有目的页在手机和桌面都是整页，进入后隐藏首页内容，保留全局主导航；详情页的「返回」按实际历史回退。

主导航在所有宽度上固定为 **首页 / 信誉榜 / 案件 / 设置**。案件项显示已登录用户的待办数，管理员申诉按案件数计；头像菜单只保留「我的记录」「退出登录」。裁判工具从案件页进入。

| 路由 | 内容与权限（手机、桌面均为整页） |
|---|---|
| `/` | 问候与榜单入口 → 独立入户提示 → 我的分数、待办摘要 → 最近三条判决 → 一行战报链接；访客显示紧凑欢迎卡 |
| `/board` | 全部上榜成员、分数与本周变化；每周恢复倒计时放在榜单页 |
| `/cases` | 已登录默认「我的待办」，访客默认「公开记录」；`?view=public` 可直达公开记录与状态筛选 |
| `/settings` | 默认显示个人资料设置，与 `/settings/profile` 相同 |
| `/settings/profile` | 名字来源、自定义名字、上榜身份；保留已获裁判资格的说明与放弃入口 |
| `/settings/discord` | Discord 绑定、换绑、解绑、私信开关和欢迎私信重发；需登录，旧后端不支持时隐藏入口 |
| `/settings/members` | 仅管理员：全部账号（含不上榜者）、按名字搜索、设撤裁判；人工调分链接到工具页 |
| `/settings/ai` | 仅管理员：连接、凭据、启用开关与试跑；高级提示词和近 7 天统计折叠显示 |
| `/tools` | 裁判或管理员的工具目录；`toolsPath('home')` 的落点 |
| `/tools/filing` | 裁判或管理员立案：选人、共同事实和个人补充 |
| `/tools/voice` | 裁判或管理员按日查看语音名单；`?user=<编码后的用户 ID>` 查看个人 7 / 14 / 31 天明细 |
| `/tools/score` | 仅管理员：选账号并两步确认调分；`?user=<编码后的用户 ID>` 直达指定账号 |
| `/players/:id` | 个人分数、走势和历史记录；本人另有私密语音记录，裁判和管理员看他人时获得语音工具链接 |
| `/players/:id/cases/:caseId` | 单案页：标题「案件 #N」、当事人链接和唯一的 `case-N` 焦点，不堆其他历史或走势 |
| `/cases/:id` | 兼容别名：只读查询当事人，再 replace 到对应单案地址 |
| `/welcome` | 五步入户：登录 → 加入并绑定 → 开启私信 → 名字与身份 → 指南 |
| `/guide` | 公开机器人指南，与 `/help`、欢迎私信和入户第 5 步共用文案 |
| `/board/report`、`/board/rules` | 完整战报、规则与指南；战报从首页进入，规则在页脚 |
| `/board/feed` | 兼容旧动态地址，显示案件的公开记录页 |
| `/admin`、`/admin/voice` | 兼容旧地址，显示当前语音工具；保留裁判或管理员权限检查 |
| `/admin/members`、`/admin/ai` | 兼容旧地址，分别显示当前成员设置、AI 设置；仍仅管理员可见 |
| `/sessions`、`/sessions/*` | 「约局功能已下线」，附「回首页」；不读取或重开约局 |
| 其他任何路径 | 「这页不存在」，附「回大厅」 |

首页的 DOM 顺序就是阅读和视觉顺序：桌面只将分数与待办摘要并排，窄屏自然向下排列。不上榜账号显示「当前不上榜」，不展示虚构分数；无待办只留一行，读取未完成不冒充零。最近判决最多三条，只含已判决或申诉中案件，不含历史加分、判决前案件，也不提供「看更多」；完整的当前读取记录与历史状态在案件页。页面不再显示迷你榜或首页战报全文。

`/welcome` 保留首次入户用途，日常编辑集中在设置。完成状态来自服务器；旧 Worker 不支持 Discord 时隐藏控件，不会跳过绑定与私信步骤。服务器状态已知、步骤 2–4 仍有缺项的用户在首页看到「还差 N 步完成入户」，可关闭 7 天；新出现的缺项会重新显示，该提示不计入待办数字或提示圆点。新绑、换绑自动发送欢迎私信，开启私信的人还可手动重发（滚动 24 小时最多 3 次，自动欢迎不占次数）。

设置中的普通表单独立保存，修改后离开或返回会先提示；API Key 不回填、不写草稿，放弃修改会撤下输入。立案草稿可保留，部分成功后只重试失败的人。已经发出的保存可能在服务端完成；切换账号、权限或操作对象后，旧请求不能把数据、草稿、Toast 或刷新结果带入新页面。

网页使用白灰浅色表面、系统 UI 字体与中性分数颜色，数字使用系统等宽字体，不加载外部字体，正文和输入 16px、说明 14px、时间 12px，触摸目标至少 44px。本人个人页仍可见自己的段位名称与说明；他人页面不显示个人段位，分数、仪表、头像与走势图不传播段位颜色。CSP 下不使用内联 `style`、内联样式标签或 `dangerouslySetInnerHTML`，SVG 样式通过属性和 CSS 类表达。

私密语音证据保留原有保守规则：网页本人个人页可查 7 / 14 / 31 天明细，Discord `/voice` 默认近 7 天、最多 14 天；只有本人、裁判和管理员能读，越权返回 404。只认已持久化覆盖，缺口和空记录不代表缺席，未关闭语音段不直接宣称仍在线；记录保存 90 天，超期查询返回 400。清理旧长段时同步撤销受影响时段的全局覆盖。配置 `DISCORD_BOARD_CHANNEL_ID` 后，Discord 信息板继续原地更新公开榜单与判决，并提供私密本人入口，保留删除、重启找回和重复清理。

成员列表最多显示最新 500 个账号，搜索只在当前列表内；不提供删除账号、授予管理员或切换他人上榜状态。v5 P4、P5 规划已经作废。

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
├── migrations/            # D1 增量迁移（已有数据的库用）
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
| `npm run typecheck` | 对前端、Worker、Node 后端三套 tsconfig 分别做 `tsc --noEmit` |
| `npm test` | 跑 unit、DOM、D1、Node 后端及 PostgreSQL 测试 |
| `npm run test:unit` | 只跑纯逻辑单测（快） |
| `npm run test:dom` | 只跑前端 DOM 测试 |
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
| `npm run db:migrate5:local` | 在本地 D1 上执行 `migrations/005_voice.sql`，添加语音记录与覆盖表 |
| `npm run db:migrate5:remote` | 由机主在备份后执行远程 D1 的 `migrations/005_voice.sql`；不会启动语音写入器 |
| `npm run cf-typegen` | 由 `wrangler.toml` 生成 Cloudflare 绑定的 TypeScript 类型 |

S3 的全新 D1 用 `schema.sql` 建表即可；已有 D1 由机主先备份，再执行 `npm run db:migrate5:remote`，
本地验证用 `npm run db:migrate5:local`。`migrations/005_voice.sql` 可重复执行，不删除约局表或历史数据。
PG 由机主按 [Discord 部署说明](./docs/DEPLOY-DISCORD.md#s3-语音记录) 备份并 Redeploy，迁移服务执行 `0010_voice.sql`。S4 信息板另执行 `0011_board.sql`，频道权限和配置见[信息板部署说明](./docs/DEPLOY-DISCORD.md#s4-信息板)。
语音记录由 Node bot 写入；D1 提供同样的读取接口，空表按未覆盖处理。

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
| `AI_CONFIG_MASTER_KEY` | 网页设置 Key 必需 | Base64 编码的 32 字节随机主密钥；一次生成、持久保存，app 与 bot 必须同值 |
| `AI_BASE_URL` | 可选兼容默认值 | OpenAI 兼容端点，代码拼 `/chat/completions`；日常在管理页配置 |
| `AI_MODEL` | 可选兼容默认值 | 模型名；日常在管理页配置 |
| `AI_API_KEY` | 可选旧实例兼容 | 仅数据库从未设置或清除凭据时使用；管理页 Key 仅以密文入库 |
| `AI_ENABLED` | 可选（默认 `true`） | `false` 时一律按基准分判罚 |
| `AI_TEMPERATURE` | 可选（默认 `0.2`） | 判罚要可复现，建议 ≤ 0.3 |
| `AI_SYSTEM_PROMPT` | 可选 | 量刑提示词；留空用内置。归类与周报提示词只在管理面板里改（热生效，无需重新部署） |
| `STATEMENT_WINDOW_HOURS` | 可选（默认 `12`） | 被告说明情况的时限，超时按缺席裁决 |

> 本地开发把以上变量写进 `.dev.vars`（从 `.dev.vars.example` 复制）；生产环境的密钥类变量务必使用 `wrangler secret put`，详见 [DEPLOY.md](./DEPLOY.md)。
>
> **设置 → AI 模型与密钥**（`/settings/ai`）维护端点、模型、API Key、温度、启用开关及量刑／归类／周报三套提示词；保存后网页与 bot 的下一次 AI 调用读取已提交配置，无需重新部署。
>
> 首次启用：用 `openssl rand -base64 32` **生成一次** `AI_CONFIG_MASTER_KEY`，作为运行时机密持久保存；Node 的 app 与 bot 必须使用同一值，随后 Redeploy。管理员在网页录入端点、模型、Key 后先保存，再点试跑（不改分），然后在 Discord 提交一条测试案件陈述验证 bot。没有任何提供商环境变量也能完成首次配置。
>
> Key 输入留空表示保留；更换时输入新值；明确清除后停止 AI 并走既有回退，旧环境 Key 不会复活。试跑使用已保存配置，有未保存修改时先保存。主密钥缺失、错配或密文损坏时 AI 安全停用，公开配置仍可读；修复为原主密钥后可继续读取原密文。
>
> 迁入前可保留旧环境 Key 作兼容，完成网页与 bot 验收后再移除；已有凭据行时它不再生效。数据库凭据备份必须配套保管原主密钥（与数据库分开存储）；不要在部署时随机重建，也不要复用 `SESSION_SECRET`。无需新增表或 SQL 迁移。

## 部署

- **一体化部署**（前后端都在 Cloudflare Worker）：见 [DEPLOY.md](./DEPLOY.md)。
- **SPA → Cloudflare Pages，Worker 只做 API**（`score.` + `api.` 子域）：见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)。
- **Node 后端（Coolify + Docker Compose）**：Discord 分享页 `discord.nanako.org`，以及（P3a 起）跑在 PostgreSQL 上的 API。见 [docs/DEPLOY-COOLIFY.md](./docs/DEPLOY-COOLIFY.md)；API 从 Worker 切过去的步骤见 [docs/DEPLOY-CUTOVER.md](./docs/DEPLOY-CUTOVER.md)。
- **EdgeOne（已停用）**：前端已在 Cloudflare Pages（`community.nanako.org`），API 在 Node（`capi.nanako.org`），EdgeOne 不再使用。遗留的边缘函数 `functions/`（把 `/api`、`/auth` 反代到已下线的 workers.dev）和 `edgeone.json` 已在 P1-0 删除：Cloudflare Pages 会把根目录的 `functions/` 部署成 Pages Functions，挂在 `community.nanako.org/api/*`、`/auth/*` 上。核验记录见 [docs/DEPLOY-PAGES.md](./docs/DEPLOY-PAGES.md)「SPA 回退核验（P1-0）」；[DEPLOY-EDGEONE.md](./DEPLOY-EDGEONE.md) 只作历史参考。
