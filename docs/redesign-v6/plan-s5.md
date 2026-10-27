# S5 实施计划 · 管理页补全（一个 PR）

> v6 第 5 期。方案见 [spec.md](spec.md) §3.4。前提：S1–S4 已合并，S3 已建好 `/admin` 外壳、「语音记录」标签和头像菜单里的「管理」入口。
> 行号只作提示，定位以锚点文字为准。本期没有迁移。

## 1. 目标

- **`/admin/ai`**（只给管理员）：`AdminAiPanel` 弹窗里的内容搬进管理页，弹窗和头像菜单里的「AI 设置」项一起退役。
- **`/admin/members`**（只给管理员）：列出全部账号，包括不上榜的裁判和游客，可以在这里设为裁判、取消裁判资格、调整分数。
- **修正「记一笔」的权限**：网页对管理员显示「记一笔」，但后端只认 `is_judge`，所以不是裁判的管理员一记就是 403。改成管理员也能记。

**不做：**
- 删除账号：不可恢复，不放进界面。
- 授予管理员：涉及安全，仍然只能改数据库。
- 上榜开关：spec 没有要求。

## 2. 开工前

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git status --short
git fetch origin
git switch -c claude/s5-admin origin/main
npm ci
```

先在 main 上跑一遍第 5 节的全部命令，记下各套件的通过数作为基线。

## 3. 步骤

每一步：先写失败的测试 → 实现 → 测试通过 → commit。commit 信息写成 `<type>: <中文描述>（S5）`。

### 第 1 步 · 管理员可以记一笔

1. `worker/case-filing.ts` 里有**两处**裁判检查，都要改：
   - `fileCases` 开头「Check the role ONCE, up front」那段。网页「记一笔」发的是 `subject_ids`，走的就是这里。
   - `fileCase` 开头。单个 `subject_id` 走这里。

   做法：新增一个 `canFile(reporter: User): boolean`，规则是 `is_judge || is_admin`，两处都调用它。403 的文案改为「需要裁判或管理员权限」。前端的 `canRecord` 本来就是这个规则，改完后前后端一致。
2. 测试（worker）：
   - 不是裁判的管理员 `POST /api/records { subject_ids: [...], claim }` 成功。这是网页实际走的路径，必须测到。
   - 同一个人用单个 `subject_id` 的形式也成功。
   - 既不是裁判也不是管理员，仍然返回 403。

### 第 2 步 · 账号列表接口

1. `worker/routes-admin.ts`：新增 `GET /api/admin/users`，用 `requireAdmin` 拦权限。
   - 返回 `{ users: AdminUserRow[], truncated: boolean }`，按 `created_at` 倒序，最多 500 条。
   - `AdminUserRow` 包含：`id`、`username`（生效的显示名）、`avatar_url`、`is_participant`、`is_judge`、`is_admin`、`score`、`created_at`。
   - 不返回 email，也不返回任何 Discord 信息。
2. `src/api.ts` 新增 `getAdminUsers()`；`src/types.ts` 加上 `AdminUserRow`。
3. 测试（worker；pg 套件会再跑一遍）：
   - 非管理员返回 403；
   - 管理员能看到不上榜的账号；
   - 返回里没有 `email` 和 `discord`。

### 第 3 步 · `/admin/ai`

1. 路由：`admin` 的 `tab` 加上 `'ai'`，对应 `/admin/ai`。
2. 把 `AdminAiPanel.tsx` 的表单、测试按钮和 7 天统计提成 `src/components/AiSettings.tsx`，放进 `AdminPage` 的「AI 设置」标签。删掉弹窗外壳；`admin-ai.css` 沿用，用不到的规则删掉。
3. `AccountMenu`：删掉 S3 改名后的「AI 设置」项。管理员从「管理」（`/admin`）进来后切标签。
4. 测试（dom）：
   - 管理员打开 `/admin/ai` 能看到 AI 设置，保存时调用 `updateAiConfig`；
   - 裁判打开 `/admin/ai` 看到 NotFound；
   - 头像菜单里不再有会打开弹窗的项。

### 第 4 步 · `/admin/members`

1. 路由：`tab` 再加 `'members'`，对应 `/admin/members`。
2. 新增 `src/components/MemberList.tsx`，配同名 CSS。
   - 顶部是搜索框，按名字在客户端过滤；下面一行一个账号。
   - 每行显示：头像、名字、身份标签（上榜 / 裁判 / 管理员）、分数、注册时间。
   - 每行的操作：
     - 「设为裁判」/「取消裁判资格」：复用 `setJudge`，文案按 v5 §6.5 锁定的写法；
     - 「调整分数」：展开现有的 `AdminScoreForm`。
   - 自己那一行不显示「取消裁判资格」。
   - 操作成功后重新拉一次列表，并用 Toast 提示结果。
3. `AdminPage` 的标签：裁判只看到「语音记录」；管理员看到「语音记录」「AI 设置」「成员」。
4. 测试（dom）：
   - 列表能渲染出不上榜的账号；
   - 搜索能过滤；
   - 点「设为裁判」调用 `setJudge(id, true)`；
   - 自己那一行没有「取消裁判资格」；
   - 裁判打开 `/admin/members` 看到 NotFound。

### 第 5 步 · 文档

`docs/CONTRACT.md`：
- 新增 `GET /api/admin/users`；
- 路由表补上 `/admin/ai`、`/admin/members`；
- 立案权限改为「裁判或管理员」。

## 4. 不能破的约束

- `/admin/ai` 和 `/admin/members` 只有管理员能进。其他人在网页上看到 NotFound，调接口得到 403（沿用 `requireAdmin` 现有的行为）。
- 列表和接口里不能出现 email 或任何 Discord 信息。

## 5. 验证

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

全部要通过。PR 描述里写出各套件改动前后的测试数。

## 6. 需要机主过目

1. 不是裁判的管理员也能记一笔（第 1 步）。如果你希望只有裁判能记，就反过来做：对不是裁判的管理员隐藏「记一笔」。
2. 成员页不提供删除账号、授予管理员和上榜开关。

## 7. 部署

没有迁移。合并后前端由 Pages 自动部署，后端要在 Coolify 里点 Redeploy。

## 8. PR

- 分支：`claude/s5-admin`
- 标题：`feat: 管理页补全：AI 设置与成员列表（S5）`
- 描述：按第 3 节的 5 步分节写。commit 和描述都不加署名行。
