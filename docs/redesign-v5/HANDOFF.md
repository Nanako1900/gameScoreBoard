# 前端重设计 v5 · 交接说明

> 状态截至 2026-10-27。从这里起，**代码由接手的人实现**；方案、计划文档和结果检查仍由原来的流程负责。
> 方案：[spec.md](spec.md)（§11 全部按推荐默认值拍板）。分析：[analysis.md](analysis.md)。

## 1. 总进度

| 分期 | 内容 | 计划 | 代码 | 状态 |
|---|---|---|---|---|
| P0 | 地基、视觉基础、安全网 | [plan-p0/](plan-p0/README.md) | 6 个 PR，#19–#24 | **已合并** |
| P1 | 地址化、登录回跳、判决前脱敏 | [plan-p1/](plan-p1/README.md) | P1-0 已合并（#25）；B1-1 已写完待合并（[#26](https://github.com/Nanako1900/gameScoreBoard/pull/26)）；P1-1–P1-4 **待实现** | 进行中 |
| P2 | ★ 邀请后端 | [plan-p2/](plan-p2/README.md) | 未开始 | 计划已写 |
| P3 | 大厅、组织者控制台、信誉榜页 | 未写 | 未开始 | — |
| P4 | 案件、我的、审理、管理 | 未写 | 未开始 | — |
| P5 | 锦上添花（可选） | 未写 | 未开始 | — |

## 2. 已经在 main 上的

| PR | 内容 |
|---|---|
| #18 | 分析、定稿方案、P0 计划 |
| #19 | P0-1 地基：层叠顺序、焦点环、对比度、token |
| #20 | P0-2 Modal 层栈、sheet 形态、ConfirmInline |
| #21 | P0-3 刷新不崩、Toast 与撤销、分钟级倒计时 |
| #22 | P0-6 约局详情里改时间、取消确认、报名反馈 |
| #23 | P0-4 榜单与首页去羞辱化 |
| #24 | P0-5 安全网：草稿、申诉、撤销倒计时、回血预告 |
| #25 | P1-0 托管核验，删除 EdgeOne 遗留 Functions；同时带上 P1 计划 |

> P0-5 改了后端（申诉理由上限 1000 → 500、常量移到 `shared/`）。如果合并后还没在 Coolify 重新部署过，后端仍是旧版本。

## 3. 接手要做的（按顺序）

1. **审查并合并 [#26](https://github.com/Nanako1900/gameScoreBoard/pull/26)（B1-1 判决前脱敏）**。代码已写完，独立复核过，本地全量测试都通过。
   - 合并前要拍板一件事：判决前被撤案的案件（`withdrawn`）撤案后类型和立案经过会公开。spec 没要求藏，要藏就另开一条。
   - 合并后在 Coolify Redeploy 后端。
2. **P1-1 路由与旧深链**：[plan-p1/plan-P1-1.md](plan-p1/plan-P1-1.md)，分支 `claude/p1-1-router`。
3. **P1-2 浮层入 history 与返回键**：[plan-p1/plan-P1-2.md](plan-p1/plan-P1-2.md)。
4. **P1-3 登录回跳与 ResumeHint**：[plan-p1/plan-P1-3.md](plan-p1/plan-P1-3.md)。
5. **P1-4 契约文档、路由表与实机验收清单**：[plan-p1/plan-P1-4.md](plan-p1/plan-P1-4.md)。之后按它产出的 `p1-acceptance.md` 做 P1-5 实机验收（iOS Safari、Android Chrome）。
6. **P2，顺序 P2-2 → P2-1 → P2-6 → P2-3 → P2-4 → P2-5**：见 [plan-p2/README.md](plan-p2/README.md)。
   - P2-3 带数据库迁移，部署前先备份。
   - P2-5、P2-6 可按 spec §11 第 11 条的瘦身选项推迟到 P5。
7. **P3、P4、P5 的计划还没写**，由文档方在 P2 之后补上。

> **计划和实际代码的关系**：
> - P1 计划是在「P0 全部套上」的副本上写的。P0 实际合并的代码和那份副本比对过，没有缺口。
> - P2 计划是在「P0 + P1 按计划套上」的副本上写的。如果 P1 实现时偏离了计划，P2 的锚点可能对不上，以锚点文字为准调整，并在 PR 描述里写明。
> - 每份计划的 Task 0 都有开工前的核对命令和预期测试数，对不上就先停下查原因。

## 4. 每个 PR 怎么做

1. **一次只做一个 PR，按顺序来。** 每个 PR 有一份计划（`plan-pN/plan-<id>.md`），里面按 TDD 拆好了 Task：先写失败的测试 → 确认它按写明的原因失败 → 实现 → 测试通过 → commit。计划里的代码都在临时副本上实际跑过。
2. **开分支**：从最新的 `origin/main`（前一个 PR 已合并时），或者从前一个 PR 的分支（还没合并时，叠放）开。计划写的行号只作参考，**以锚点文字定位**。
3. **计划和实际代码对不上时**：在计划意图之内做最小修改，在 PR 描述里写明偏离了什么、为什么。
4. **提 PR 前跑全量验证**（Node 24：`export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`）：
   ```bash
   npm run typecheck
   npx vitest run --config vitest.config.ts
   npx vitest run --config vitest.dom.config.ts
   npm run build
   ```
   动了 `worker/`、`server/`、`shared/` 或迁移时，再跑对应的 `tests/worker/*.test.ts`，以及 `npm run test:pg` 和 `npm run test:server`（会起嵌入式 Postgres）。
5. **PR 标题**：`<type>: <中文描述>（<PR id>）`。commit 和 PR 描述都不加署名行。
6. **固定的约束**（详见 `plan-p0/README.md`「共享契约 · 规则」）：
   - 深链 `?case`、`?session`、`?linked`、`?onboarding` 永久兼容；
   - spec §6.5 锁定的文案和类名不改；
   - CSP 不允许内联 `<style>`、`style="…"` 字符串、`dangerouslySetInnerHTML`；
   - DOM 顺序就是视觉顺序；
   - 组件签名只能加可选 props；
   - 新的前端入口在接口返回 404 时静默隐藏。

## 5. 检查结果

每个 PR 开出来后，由检查方对照计划和 spec 复核，重点看：

- 计划里的 Task 是否都做了，有没有超出范围；
- 隐私规则（判决前脱敏、段位只给本人、不暴露 `discord_*`）；
- 锁定文案、CSP、无障碍；
- D1 和 PostgreSQL 行为一致；
- CI 全绿。

检查意见直接写在 PR 上。

## 6. 部署提醒

- **前端**：Cloudflare Pages 从 main 自动部署。
- **后端**：合并后 GitHub Actions 构建 `ghcr.io/nanako1900/gamescoreboard:latest`，**要在 Coolify 里手动 Redeploy**。PostgreSQL 迁移由 compose 的 `migrate` 服务在启动前自动执行。
- **P2-3 带迁移**（D1 `004_lobby.sql`、PG `0007_lobby.sql`）。部署前先备份数据库，现在还没有异地备份。
