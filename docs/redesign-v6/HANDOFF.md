# v6 交接说明 · Discord 为主，网页做减法

> 状态截至 2026-10-27。**代码由接手的人实现**；方案、计划和结果检查仍由原来的流程负责。
> 方案见 [spec.md](spec.md)，机主已确认设计，第 2 节的决定也已经拍板。v5 的历史文档在 [`../redesign-v5/`](../redesign-v5/HANDOFF.md)。

## 1. 总进度

| 分期 | 内容 | 计划 | 状态 |
|---|---|---|---|
| v5 P0–P2 | 地基、地址化、判决前脱敏、邀请后端 | `../redesign-v5/` | 已合并（#19–#34） |
| v5 P3 | 大厅、组织者控制台、信誉榜页 | `../redesign-v5/plan-p3.md` | 已合并（[#35](https://github.com/Nanako1900/gameScoreBoard/pull/35)），已上线 |
| v5 P4、P5 | 案件、我的、审理、管理；锦上添花 | — | **作废**，由 v6 取代；仍有价值的几项见第 5 节 |
| **S1** | 约局下线 | [plan-s1.md](plan-s1.md) | 未开始 |
| **S2** | 入户向导、私信开关、欢迎私信、指南 | [plan-s2.md](plan-s2.md) | 未开始 |
| **S3** | 语音进出记录 | [plan-s3.md](plan-s3.md) | 未开始 |
| **S4** | Discord 信息板 | [plan-s4.md](plan-s4.md) | 未开始 |
| **S5** | 管理页补全 | [plan-s5.md](plan-s5.md) | 未开始 |

## 2. 接手要做的

按 S1 → S2 → S3 → S4 → S5 的顺序做，**一期一个 PR**。前一期合并之后，再从最新的 `origin/main` 开下一期。

每期 PR 开出来以后先停下，等检查意见和机主合并，再开始下一期。

v5 遗留的两项验收：

- **P1-5 真机验收**（`../redesign-v5/p1-acceptance.md`）：约局相关的条目已经作废。其余条目（登录回跳、返回键关浮层、榜单和案件深链）等 S2 合并后，由机主在真机上一起验。
- **P2 真实邀请私信验收**：邀请随 S1 一起删除，**不用再做**。

## 3. 每个 PR 怎么做

1. **开分支**：每期从最新的 `origin/main` 开，分支名见各期计划。
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
- CI 全绿，测试数的变化说得清。

检查意见直接写在 PR 上。

## 5. 后续待办（不在 S1–S5 里，需要机主拍板后再做）

- **撤案的案件要不要也脱敏**（B1-1 复核时提出）：判决前被撤案（`withdrawn`）的案件，目前它的类型、经过、AI 摘要、量刑区间都对所有人公开。改法：把 `worker/case-reads.ts` 里 `redactRecord` 的条件从「判决前」扩成「判决前或 `withdrawn`」。
- **点名备注泄露**（LOW）：
  - `attendance_note` 原本经 `GET /api/sessions/:id` 公开。S1 删掉这个接口后，这条泄露就没有了。
  - 旧案件上 `classified_by = 'derived'` 加 `session_id` 仍然能看出这件事来自点名，但再也查不到点名内容。合并 S1 后复核一次，没问题就把这项关掉。
- **从 v5 P4、P5 里留下来、可能还值得做的**（计划已作废，要做就重新写）：
  - 维持原判，每个案件只能申诉一次（v5 P4-4，带迁移）；
  - 分数明细和本周变化（v5 P4-5）；
  - 退榜保护（v5 P4-7）；
  - 自托管字体加更严的 CSP、按路由拆包、往期战报列表（v5 P5-1、P5-9、P5-6）。

## 6. 部署提醒

- **前端**：Cloudflare Pages 从 main 自动部署。
- **后端**：合并后 GitHub Actions 构建 `ghcr.io/nanako1900/gamescoreboard:latest`，**要在 Coolify 里手动 Redeploy**。PG 迁移由 compose 的 `migrate` 服务在启动前自动执行。**部署前先备份数据库。**

| 期 | 迁移 | 机主还要做 |
|---|---|---|
| S1 | PG `0008_sessions_off.sql` | 可以删掉 `DISCORD_SESSION_CHANNEL_ID`；旧约局卡片会被机器人删掉 |
| S2 | PG `0009_welcome.sql` | 无 |
| S3 | PG `0010_voice.sql`；D1 `005_voice.sql` | 确认机器人能看见所有需要留证的语音频道；在服务器里发公告，说明开始记录语音进出；部署后看 `/status` 的 `voice` 字段 |
| S4 | PG `0011_board.sql` | 建只读频道，填 `DISCORD_BOARD_CHANNEL_ID`，重启 bot |
| S5 | 无 | 无 |

## 基线

2026-10-27，在 `69fa743`（P3 合并后的 main）上，Node v24.22.0，全部通过：

| 套件 | 文件 | 测试 |
|---|---|---|
| typecheck、build、build:pages | — | 通过 |
| unit（`vitest.config.ts`） | 37 | 567 |
| dom（`vitest.dom.config.ts`） | 35 | 471 |
| worker（`vitest.workers.config.ts`） | 20 | 630（另有 9 todo） |
| pg（`npm run test:pg`） | 32 | 923（另有 9 todo） |
| server（`npm run test:server`） | 22 | 295 |

S1 删掉的测试多，测试数会明显下降。S1 的 PR 要写清各套件减少了多少、对应删了哪些文件。后面各期以前一期合并后实际跑出来的数为准。
