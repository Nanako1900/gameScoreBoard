# 前端重设计 v5 · 交接说明

> 状态截至 2026-10-27。从这里起，**代码由接手的人实现**；方案、计划文档和结果检查仍由原来的流程负责。
> 方案：[spec.md](spec.md)（§11 全部按推荐默认值拍板）。分析：[analysis.md](analysis.md)。

## 1. 总进度

| 分期 | 内容 | 计划 | 代码 | 状态 |
|---|---|---|---|---|
| P0 | 地基、视觉基础、安全网 | [plan-p0/](plan-p0/README.md) | 6 个 PR，#19–#24 | **已合并** |
| P1 | 地址化、登录回跳、判决前脱敏 | [plan-p1/](plan-p1/README.md) | P1-0（#25）、B1-1（#26）已合并；P1-1–P1-4 **待实现** | 进行中 |
| P2 | ★ 邀请后端 | [plan-p2/](plan-p2/README.md) | 未开始 | 计划已写 |
| P3 | 大厅、组织者控制台、信誉榜页 | [plan-p3.md](plan-p3.md) | 未开始 | 计划已写 |
| P4 | 案件、我的、审理、管理 | [plan-p4.md](plan-p4.md) | 未开始 | 计划已写 |
| P5 | 锦上添花（可选） | [plan-p5.md](plan-p5.md) | 未开始 | 计划已写 |

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
| #26 | B1-1 判决前脱敏：与案件无关的人只看到「有一起记录在处理中」 |
| #27 | 交接说明、P2 计划 |

> #24（P0-5）和 #26（B1-1）都改了后端：申诉理由上限 1000 → 500、常量移到 `shared/`、判决前脱敏。合并后要在 Coolify Redeploy 一次，否则线上后端仍是旧版本，判决前的指控也仍然公开。

## 3. 接手要做的（按顺序，一期一个 PR）

1. **在 Coolify Redeploy 后端**，让 #24、#26 的后端改动上线（见上一节）。
2. **P1 剩余部分，开一个 PR**：按顺序做这四份计划，每份做完是一组 commit，全部做完后一起开 PR。
   1. [plan-P1-1.md](plan-p1/plan-P1-1.md) 路由与旧深链
   2. [plan-P1-2.md](plan-p1/plan-P1-2.md) 浮层入 history 与返回键
   3. [plan-P1-3.md](plan-p1/plan-P1-3.md) 登录回跳与 ResumeHint
   4. [plan-P1-4.md](plan-p1/plan-P1-4.md) 契约文档、路由表与实机验收清单

   之后按 P1-4 产出的 `p1-acceptance.md` 做 P1-5 实机验收（iOS Safari、Android Chrome）。
3. **P2，开一个 PR**：按 P2-2 → P2-1 → P2-6 → P2-3 → P2-4 → P2-5 的顺序做，见 [plan-p2/README.md](plan-p2/README.md)。
   - P2-3 带数据库迁移，部署前先备份。
   - P2-5、P2-6 可按 spec §11 第 11 条的瘦身选项推迟到 P5。
4. **P3，开一个 PR**：[plan-p3.md](plan-p3.md)，7 步，没有迁移。
5. **P4，开一个 PR**：[plan-p4.md](plan-p4.md)，7 步，带数据库迁移，部署前先备份。
6. **P5，开一个 PR（全部可选）**：[plan-p5.md](plan-p5.md)，10 个独立小项，挑着做，PR 描述写明做了哪几项。

### 后续待办（不在任何分期里，需要机主拍板后再做）

- **撤案的案件要不要也脱敏**（B1-1 复核时提出）：判决前被撤案（`withdrawn`）的案件从没成立过，但撤案后它的类型、立案经过、AI 摘要、短评、量刑区间会对所有人公开。按 v4 §4.6「不做有罪推定」可能也该藏。改法：把 `worker/case-reads.ts` 里 `redactRecord` 的条件从「判决前」扩成「判决前或 `withdrawn`」，同时更新 withdrawn 的 dom 用例。spec 没要求，所以 B1-1 没做。
- **点名数据会泄露案由**（同上，LOW）：`GET /api/sessions/:id` 的 `players[].attendance_note`（组织者写的自由文本）对访客公开，判决前脱敏形态保留的 `classified_by = 'derived'` 加上 `session_id` 也能推出是放鸽子或迟到。要藏的话一起处理。

> **计划和实际代码的关系**：
> - P1 计划是在「P0 全部套上」的副本上写的。P0 实际合并的代码和那份副本比对过，没有缺口。
> - P2 计划是在「P0 + P1 按计划套上」的副本上写的。如果 P1 实现时偏离了计划，P2 的锚点可能对不上，以锚点文字为准调整，并在 PR 描述里写明。
> - 每份计划的 Task 0 都有开工前的核对命令和预期测试数，对不上就先停下查原因。

## 4. 每个 PR 怎么做

1. **一期一个 PR，按期的顺序做。** 期内按计划的顺序一步步做：
   - P1、P2 每一步各有一份计划（`plan-pN/plan-<id>.md`），按 TDD 拆好了 Task：先写失败的测试 → 确认它按写明的原因失败 → 实现 → 测试通过 → commit。计划里的代码都在临时副本上实际跑过。
   - P3–P5 是每期一份计划，写到文件、接口、测试要点这一层，代码由实现方自己写，测试照样先写。

   一期做完、全量验证通过后，开一个 PR。
2. **开分支**：每期开工时从最新的 `origin/main` 开一个分支，比如 `claude/p1-rest`、`claude/p2`，整期都在这个分支上做。计划里「每步单独开分支、叠放 PR」「不 push、不开 PR」之类的说法一律忽略。计划写的行号只作参考，**以锚点文字定位**。
3. **计划和实际代码对不上时**：在计划意图之内做最小修改，在 PR 描述里写明偏离了什么、为什么。
4. **提 PR 前跑全量验证**（Node 24：`export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH`）：
   ```bash
   npm run typecheck
   npx vitest run --config vitest.config.ts
   npx vitest run --config vitest.dom.config.ts
   npm run build
   ```
   动了 `worker/`、`server/`、`shared/` 或迁移时，再跑对应的 `tests/worker/*.test.ts`，以及 `npm run test:pg` 和 `npm run test:server`（会起嵌入式 Postgres）。
5. **PR 标题**：`<type>: <中文描述>（P1）` 这种形式，标出是哪一期。PR 描述按步骤分节，写清每一步做了什么、偏离了什么。commit 和 PR 描述都不加署名行。
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
