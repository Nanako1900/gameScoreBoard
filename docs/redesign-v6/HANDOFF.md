# v6 交接说明 · Discord 为主，网页做减法

> 状态截至 2026-10-28。S1–S6 和 #42 已合并；S7「网页与 Discord 语音记录呈现」开发完成，待 PR 验收。合并状态不代表已部署，部署与备份仍由机主负责。
> 方案见 [spec.md](spec.md)，机主已确认设计，第 2 节的决定也已经拍板。v5 的历史文档在 [`../redesign-v5/`](../redesign-v5/HANDOFF.md)。

## 1. 总进度

| 分期 | 内容 | 计划 | 状态 |
|---|---|---|---|
| v5 P0–P2 | 地基、地址化、判决前脱敏、邀请后端 | `../redesign-v5/` | 已合并（#19–#34） |
| v5 P3 | 大厅、组织者控制台、信誉榜页 | `../redesign-v5/plan-p3.md` | 已合并（[#35](https://github.com/Nanako1900/gameScoreBoard/pull/35)），已上线 |
| v5 P4、P5 | 案件、我的、审理、管理；锦上添花 | — | **作废**，由 v6 取代；仍有价值的几项见第 5 节 |
| **S1** | 约局下线 | [plan-s1.md](plan-s1.md) | 已合并（[#37](https://github.com/Nanako1900/gameScoreBoard/pull/37)） |
| **S2** | 入户向导、私信开关、欢迎私信、指南 | [plan-s2.md](plan-s2.md) | 已合并（[#38](https://github.com/Nanako1900/gameScoreBoard/pull/38)） |
| **S3** | 语音进出记录 | [plan-s3.md](plan-s3.md) | 已合并（[#39](https://github.com/Nanako1900/gameScoreBoard/pull/39)） |
| **S4** | Discord 信息板 | [plan-s4.md](plan-s4.md) | 已合并（[#40](https://github.com/Nanako1900/gameScoreBoard/pull/40)） |
| **S5** | 管理页补全 | [plan-s5.md](plan-s5.md) | 已合并（[#41](https://github.com/Nanako1900/gameScoreBoard/pull/41)） |
| #42 | AI 提供商配置与密钥管理 | — | 已合并（[#42](https://github.com/Nanako1900/gameScoreBoard/pull/42)） |
| **S6** | 清爽总览、集中设置与浅色视觉 | [plan-s6.md](plan-s6.md) | 已合并（[#43](https://github.com/Nanako1900/gameScoreBoard/pull/43)） |
| **S7** | 网页与 Discord 语音记录呈现 | [plan-s7.md](plan-s7.md) | 开发完成，待 PR 验收 |

## 2. 接手要做的

S1 → S6 已依次完成。S7 从合并 #43 后的最新 `origin/main` 开始，仍按**一期一个 PR**处理；当前分支 `codex/voice-record-format`，PR 标题 `feat: 优化网页与 Discord 语音记录呈现（S7）`。

每期 PR 开出来以后先停下，等检查意见和机主合并，再开始下一期。

S6 网页结构继续以 [plan-s6.md](plan-s6.md) 和 spec §3 为准：所有宽度同一套「首页／信誉榜／案件／设置」，个人与案件整页；首页仅分数、待办摘要、最近三条判决和一行战报；日常设置集中在 `/settings/*`，裁判工作集中在 `/tools/*`。旧 `/board/feed`、`/admin*` 和永久深链继续兼容，入户完成先回首页再继续原目标。本人段位名称仍保留，所有分数视觉中性。

S7 仅优化语音呈现与 `/voice` 网页入口，见 [plan-s7.md](plan-s7.md)；秒级边界、零分钟短段、空日、首次未知、跨日延续和截断保底见 [验收记录](s7-acceptance.md)。采集、覆盖、累计、90 天保留期与权限均不变。

v5 遗留的两项验收：

- **P1-5 真机验收**（`../redesign-v5/p1-acceptance.md`）：约局相关的条目已经作废。其余条目（登录回跳、返回键关浮层、榜单和案件深链）等 S2 合并后，由机主在真机上一起验。
- **P2 真实邀请私信验收**：邀请随 S1 一起删除，**不用再做**。

## 3. 每个 PR 怎么做

1. **开分支与基线**：每期从最新的 `origin/main` 开，分支名见各期计划。开工前先在该 main 上跑下面的全量验证，记下文件、通过和 todo 数；任何套件原本失败，先停下查明原因。
2. **TDD**：先写会失败的测试 → 实现 → 测试通过 → commit。计划写到文件、接口、测试要点这一层，代码由实现方自己写。计划里的行号只作参考，**以锚点文字定位**。
3. **计划和代码对不上时**：在计划意图之内做最小修改，在 PR 描述里写明偏离了什么、为什么。
4. **提 PR 前跑全量验证**（Node 22 或 24）：
   ```bash
   npm run typecheck
   npx vitest run --config vitest.config.ts
   npx vitest run --config vitest.dom.config.ts
   npx vitest run --config vitest.workers.config.ts
   env -u TEST_DATABASE_URL npm run test:pg
   npm run test:server
   npm run build
   npm run build:pages
   ```
   PR 描述里写出各套件改动前后的测试数。
5. **标题和提交**：PR 标题写成 `<type>: <中文描述>（S1）` 这种形式。commit 和 PR 描述都不加署名行。
6. **固定约束**（详见 spec §8）：
   - 判决前脱敏；分数公开，段位只给本人看；不暴露 `discord_*`；语音记录只给裁判、管理员和本人看。
   - 深链 `?case`、`?session`、`?linked`、`?onboarding` 永久兼容，落点按 spec §3.5。
   - CSP 不允许内联 `<style>`、`style="…"`、`dangerouslySetInnerHTML`。
   - DOM 顺序就是视觉顺序；组件签名只能加可选 props；D1 和 PostgreSQL 行为一致。

## 4. 检查结果

每个 PR 开出来以后，检查方对照计划和 spec 复核，重点看：

- 计划里的步骤是否都做了，有没有超出范围；
- 隐私规则（见上）；
- 删除是否干净：没有留下孤儿文件、孤儿 CSS、没人调用的导出；
- 迁移在 PG 上能重复执行，不会报错；D1 迁移的写法和现有文件一致；
- 证据相关的规则（S3 的对账和未覆盖时段）一条不少；
- 语音覆盖只认已经持久化的时间，未落库尾段显示未覆盖；没有当前可信覆盖的开段显示「尚未记录离开」。累计时长先加当天全部秒数再向下取整，超出 90 天保留期的查询返回 400；
- CI 全绿，测试数的变化说得清。

检查意见直接写在 PR 上。

## 5. 后续待办（不在 S1–S7 里，需要机主拍板后再做）

- **撤案的案件要不要也脱敏**（B1-1 复核时提出）：判决前被撤案（`withdrawn`）的案件，目前它的类型、经过、AI 摘要、量刑区间都对所有人公开。改法：把 `worker/case-reads.ts` 里 `redactRecord` 的条件从「判决前」扩成「判决前或 `withdrawn`」。
- **点名备注泄露**（LOW）：
  - `attendance_note` 原本经 `GET /api/sessions/:id` 公开。S1 删掉这个接口后，这条泄露就没有了。
  - 旧案件上 `classified_by = 'derived'` 加 `session_id` 仍然能看出这件事来自点名，但再也查不到点名内容。合并 S1 后复核一次，没问题就把这项关掉。
- **从 v5 P4、P5 里留下来、可能还值得做的**（计划已作废，要做就重新写）：
  - 维持原判，每个案件只能申诉一次（v5 P4-4，带迁移）；这项限制尚未实现，S6 沿用现有申诉行为；
  - 分数明细和本周变化（v5 P4-5）；
  - 退榜保护（v5 P4-7）；
  - 自托管字体加更严的 CSP、按路由拆包、往期战报列表（v5 P5-1、P5-9、P5-6）。

## 6. 部署提醒

- 以下步骤由机主操作。实现与验收期间不操作 Coolify、Cloudflare 或远程数据库，不执行远程迁移，也不自行合并 PR。S6、S7 均没有迁移或远程配置变更。
- **前端**：Cloudflare Pages 从 main 自动部署。
- **后端**：合并后 GitHub Actions 构建 `ghcr.io/nanako1900/gamescoreboard:latest`，**要在 Coolify 里手动 Redeploy**。PG 迁移由 compose 的 `migrate` 服务在启动前自动执行。**部署前先备份数据库。**

| 期 | 迁移 | 机主还要做 |
|---|---|---|
| S1 | PG `0008_sessions_off.sql` | 可以删掉 `DISCORD_SESSION_CHANNEL_ID`；旧约局卡片会被机器人删掉 |
| S2 | PG `0009_welcome.sql` | 无 |
| S3 | PG `0010_voice.sql`；D1 `005_voice.sql` | 确认机器人能看见所有需要留证的语音频道；在服务器里发公告，说明开始记录语音进出；部署后看 `/status` 的 `voice` 字段 |
| S4 | PG `0011_board.sql` | 建只读频道，给机器人查看、读取消息历史、发送消息和嵌入链接权限，填 `DISCORD_BOARD_CHANNEL_ID`，重启 bot；详见 [信息板部署说明](../DEPLOY-DISCORD.md#s4-信息板) |
| S5 | 无 | 无 |
| S6 | 无 | 合并后验收浅色导航、集中设置、旧地址、登录与入户回跳；本期没有远程配置变更 |
| S7 | 无 | 按既有流程更新网页与 app/bot，验收 `/voice` 私密回复、两端格式与长记录省略提示；无需新配置 |

## S6 基线

S6 开工基线：2026-10-28，在 `a943100`（#42 合并后的 `origin/main`）上，Node `22.22.3`，全部通过：

| 套件 | 文件 | 测试 |
|---|---|---|
| typecheck、build、build:pages | — | 通过 |
| unit（`vitest.config.ts`） | 40 | 601 |
| dom（`vitest.dom.config.ts`） | 36 | 474 |
| worker / D1（`vitest.workers.config.ts`） | 18 | 555（另有 5 todo） |
| pg（`env -u TEST_DATABASE_URL npm run test:pg`） | 40 | 953（另有 5 todo） |
| server（`npm run test:server`） | 32 | 378 |

PG 基线使用临时本地数据库。最终验证结果由本期 PR 记录；测试数有变化时写明对应新增、迁移或删除的覆盖，不把基线数当作最终结果。

## S6 提交前验证

2026-10-28，Node `22.22.3`。基于同一工作树完成下列全量验证，全部通过；PG 明确取消 `TEST_DATABASE_URL`，使用临时本机数据库。

| 验证 | 开工前（文件 / 通过） | 提交前（文件 / 通过） | todo |
|---|---|---|---|
| typecheck | 通过 | 通过 | — |
| unit | 40 / 601 | 44 / 687 | 0 |
| DOM | 36 / 474 | 50 / 657 | 0 |
| worker / D1 | 18 / 555 | 18 / 555 | 5 → 5 |
| PostgreSQL | 40 / 953 | 40 / 953 | 5 → 5 |
| server | 32 / 378 | 32 / 378 | 0 |
| build | 通过 | 通过 | — |
| build:pages | 通过 | 通过 | — |

单元测试净增 86，DOM 净增 183。退役的首页摘星模块删除 12 项 unit、5 项 DOM；清掉已不存在的立案 select 后移除 2 项 CSS 控件检查，并新增 2 项路由文档检查。其余旧业务边界继续保留或迁到共享编辑器，新增覆盖包括导航、设置、离开保护、异步权限隔离、公开脱敏、单案与工具页、CSP、浅色与可读性。

本机浏览器检查及必要衔接见 [s6-acceptance.md](s6-acceptance.md)。这些结果不代表远程部署或机主真机验收。

## S7 基线与提交前验证

2026-10-28，Node `22.22.3`，从 `3119a96`（#43 合并后的最新 `origin/main`）开始。开工前及提交前八项验证全部通过；PG 均取消 `TEST_DATABASE_URL`，仅临时本机数据库。

| 验证 | 开工前（文件 / 通过） | 提交前（文件 / 通过） | todo |
|---|---|---|---|
| typecheck | 通过 | 通过 | — |
| unit | 44 / 687 | 46 / 707 | 0 |
| DOM | 50 / 657 | 51 / 668 | 0 |
| worker / D1 | 18 / 555 | 18 / 555 | 5 → 5 |
| PostgreSQL | 40 / 953 | 40 / 955 | 5 → 5 |
| server | 32 / 378 | 32 / 384 | 0 |
| build、build:pages | 通过 | 通过 | — |

未删既有测试。新增 unit 20 项（共享格式 18、文档 2），DOM 11 项（语音布局 9、工具页入口 2），PG 2 项网页入口，server 6 项呈现边界。既有精度、缺口、隐私、权限与异步隔离断言保留并对齐新文案。没有迁移、远程配置、部署或真实 Discord 发送；本机验收与实际渲染样例见 [s7-acceptance.md](s7-acceptance.md)。
