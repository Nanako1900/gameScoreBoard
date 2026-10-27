# S2 实施计划 · 入户向导、私信开关、欢迎私信与指南（一个 PR）

> v6 第 2 期。方案：[spec.md](spec.md) §3.2、§3.5、§4.1、§4.3。前提：S1 已合并。
> 行号只作提示，定位以锚点文字为准。

## 1. 目标

新人从登录到会用机器人，在 `/welcome` 一页内走完。具体包括：

- **`/welcome`**：五步清单——登录 → 加入服务器并绑定 → 开启私信 → 名字与身份 → 机器人怎么用。每步是否完成都从服务器读。
- **欢迎私信**：绑定或换绑成功后，机器人自动发一条私信，内容是指南、网页地址，配好信息板频道后再加上频道。网页不单独追踪这条私信，只看现有的 `dm_ok`；另外提供「再发一次」，每天最多 3 次。
- **私信开关**：网页上第一次有了开关，接的是现成的 `POST /api/me/discord/notify`。
- **指南**：网页 `/guide` 和机器人 `/help` 用同一份文案。
- **首页入户卡**：已登录、但第 2–4 步没做完的人，待办最上面出现「还差 N 步完成入户 → 继续」。它取代「未绑定」「私信不通」两张卡。
- `OnboardingDialog` 弹窗退役。

**不在 S2：**
- 语音记录告知和 `/voice`：S3 加进指南。
- 信息板频道链接：S4 加进指南和欢迎私信。

## 2. 开工前

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
git status --short
git fetch origin
git switch -c claude/s2-welcome origin/main
npm ci
```

在 main 上跑第 4 节的全部命令，记下各套件的通过数作为基线。S1 合并后的数字以那次实际跑出来的为准，写进 PR 描述。

## 3. 步骤

每一步都是：先写失败的测试 → 实现 → 测试通过 → commit。commit 信息用 `<type>: <中文描述>（S2）` 的格式。

### 第 1 步 · 共用指南文案

1. **新增 `shared/guide.ts`**，纯数据，不引入任何依赖：
   - `GUIDE_INTRO`：一两句话，说明 Discord 是日常入口，网页用来看榜单和案件。
   - `GUIDE_COMMANDS`：`{ name, text }[]`，按 S2 时的命令表填写：`/score`、`/top`、`/verdicts`、`/todo`、`/report`、`/notify`、`/link`、`/unlink`、`/help`。说明文字要短，比如「`/score` 查自己的分数和段位，只有你看得到」。
   - `GUIDE_TIPS`：几条提示，比如「被记了一笔会私信你，按私信里的按钮写陈述」「私信收不到：隐私设置里允许服务器成员私信」。
2. **新增 `src/components/GuideContent.tsx`**，读 `shared/guide.ts` 渲染。`/guide` 页和 `/welcome` 第 5 步都用它。
3. **测试**：unit 检查 `GUIDE_COMMANDS` 的每个 `name` 都在 `server/src/discord/commands.ts` 的 `COMMANDS` 里，反过来也成立：每个注册的命令都在指南里，`yue` 不在。

### 第 2 步 · 欢迎私信（迁移 + 机器人）

1. **新增 `server/migrations/0009_welcome.sql`**：
   - 在 `discord_links` 上加 `AFTER INSERT` 触发器。新绑和换绑都会插入一行，所以两种情况都会触发。
   - 触发器排一条事件：`outbox_emit('dm.welcome', 'user', NEW.user_id, 'dm:welcome:' || NEW.discord_user_id || ':' || NEW.linked_at, '{}'::jsonb, now())`，然后 `PERFORM pg_notify('outbox', '')`，和现有的触发器一样，dispatcher 马上醒来，不用等 30 秒轮询。
   - 导入期间（`current_setting('edg.importing', true) = 'on'`）不触发。
   - 用 `CREATE OR REPLACE FUNCTION` 加 `DROP TRIGGER IF EXISTS`，重复执行不报错。
2. **投递**：
   - 在 `server/src/outbox/dispatcher.ts` 的 `deliverDm` 里接上 `dm.welcome`。它的 payload 是 `{}`，没有 `record_id`，所以要放在 `deliverDm` 最前面，排在「是不是案件私信」和读 `record_id` 的判断之前，写法照 `dm.removed`、`dm.score.adjusted`。收件人照常经过 `recipient()` 过滤：要绑定、`notify_dm` 开着、`dm_ok` 为 1。
   - 渲染放进 `server/src/discord/dm.ts`，新函数 `renderWelcomeDm(frontendUrl)`，正文取自 `shared/guide.ts`，末尾附网页链接。
   - 不受每日私信预算限制。重发次数在接口里限制（见下文）。
   - 50007 照旧把 `dm_ok` 置 0。
3. **`/help` 命令**：
   - 加进 `server/src/discord/commands.ts`。
   - 回复只有自己能看到（ephemeral），用 embed 渲染 `shared/guide.ts`，并附一个「打开网页」链接按钮。
   - 不需要绑定也能用。
4. **测试**：
   - pg：插入一条 `discord_links` 后，outbox 里有一条 `dm.welcome`；换绑后又多一条；同一行更新 `discord_username` 不会产生新事件。
   - server/pg：dispatcher 处理 `dm.welcome` 时会调用 `openDm` 和 `send`；`notify_dm = 0` 时结果为 `skipped`。
   - pg `bot-commands`：`/help` 回复是 ephemeral，内容里有 `/score`。
5. **现有 pg 测试会受影响**：触发器上线后，每次 `linkAccounts` 都会多排一条 `dm.welcome`，所以数私信条数的断言会对不上，例如 `tests/pg/dm.test.ts` 里的 `toHaveLength(2)` 和 `toEqual([])`。
   - 已知受影响的套件：`dm`、`escalation`、`score-dm`、`p8-edges`、`bot-commands`。`outbox`、`link-flow` 也会调用绑定，跑 pg 套件时一起核对。main 上没有共用的绑定辅助函数，各套件都是直接调用 `linkAccounts`。
   - 处理办法：在这些套件共用的绑定辅助函数里，绑定后执行 `DELETE FROM outbox WHERE kind = 'dm.welcome'`。如果某个套件没有共用的辅助函数，就在它自己的 `beforeEach` 里做同样的事。
   - 不要为了测试在生产触发器里加开关。
   - PR 描述里列出改了哪些测试文件。

### 第 3 步 · 「再发一次」接口

写在 `server/src/link-routes.ts`，和现有的 `/api/me/discord*` 放在一起（这些接口只有 Node 后端有）。

1. `GET /api/me/discord` **不改**：它已经返回 `notify_dm` 和 `dm_ok`，第 3 步的完成条件和提示只用这两个字段。
2. **新增 `POST /api/me/discord/welcome`**：
   - 只读模式（`isReadOnly`）下，和其他写接口一样返回 503。
   - 要求已登录且已绑定，未绑定返回 409，写法照 `/notify`。
   - 私信开关关着时返回 409，提示「先打开私信通知」。
   - 过去 24 小时内，这个用户 dedupe key 带 `:resend:` 的 `dm.welcome` 已经有 3 条时，返回 429，提示「24 小时内已经重发 3 次，稍后再试」。绑定时自动发的那一条不算在内。
   - 通过时：先把 `dm_ok` 置为 1（和机器人交互时的做法一样），再用 `outbox_emit` 排一条 `dm.welcome`，dedupe key 为 `'dm:welcome:' || user_id || ':resend:' || <毫秒时间戳>`，然后 `pg_notify('outbox', '')`。
   - 返回 `{ ok: true }`。
3. **`src/api.ts`**：新增 `resendWelcome()`；现有的 `setDiscordNotify` 开始被调用。
4. **测试**（server 或 pg，写法参考 `link-flow.test.ts`）：
   - 绑定后连续重发 3 次都成功，第 4 次返回 429；
   - 未绑定返回 409；
   - 私信开关关着返回 409；
   - 只读模式返回 503；
   - 重发会把 `dm_ok` 从 0 改回 1。

### 第 4 步 · `/welcome` 与 `/guide` 页面

1. **路由**：`src/lib/routes.ts` 新增 `{ name: 'welcome' }`（`/welcome`）和 `{ name: 'guide' }`（`/guide`）。两者都是整页：手机上是页面，桌面上是抽屉，和 `board` 一样按 `useRouteLayout` 处理。
2. **新增 `src/components/WelcomePage.tsx`**（加同名 CSS），按顺序放五张步骤卡：
   1. **登录**：没登录时显示 `LoginLink`，登录后回到 `/welcome`。已登录显示「已登录：<名字>」。
   2. **加入服务器并绑定 Discord**：
      - 先放「加入服务器」按钮，链接用 `src/lib/inviteUrl.ts` 读出的服务器邀请地址，没配就不显示；
      - 再嵌入现有的 `DiscordLinkCard`，它负责绑定和解绑；
      - 完成条件：`link` 不为空。
   3. **开启私信通知**：
      - 一个开关，调用 `setDiscordNotify`；
      - 提示文案按 spec §3.2：`dm_ok` 为真时显示「已开启。没收到欢迎私信？点「再发一次」」；为假时显示两条排查提示和「再发一次」；
      - 点「再发一次」后用 Toast 提示 spec §3.2 的原文，不轮询；
      - 私信开关关着时，不显示「再发一次」；
      - 完成条件：开关开着，并且 `dm_ok` 为真。
   4. **名字与身份**：
      - 把 `OnboardingDialog` 里的显示名和身份两块提成 `src/components/IdentityForm.tsx`，原样搬过来，包括锁定文案「裁判资格由管理员授予」和 sessionStorage 草稿；
      - 完成条件：`is_participant` 或 `is_judge` 至少一个为真。
   5. **机器人怎么用**：`GuideContent`，底部按钮「完成，去首页」，点了 `navigate('/')`。

   - 卡片标题前的状态标记用文字加图标，例如「✓ 已完成」，不能只靠颜色区分。
   - 第一个没完成的步骤展开，其余折叠，折叠的卡点开可以展开。
   - 第 2 步没做完时，第 3 步只显示「先完成上一步」。
   - 访客只能看到第 1 步可操作，其余显示为灰色。
3. **新增 `src/components/GuidePage.tsx`**：用 `PageBar` 加 `GuideContent`。
4. **入口调整**：
   - `?onboarding=1`：不再打开弹窗，改为 `navigate('/welcome', { replace: true })`。
   - `?linked=discord`：先显示现有的 `DiscordLinkedNotice`，再 `navigate('/welcome', { replace: true })`。
   - 这两个参数仍然永久兼容，后端的跳转地址不改。
   - `AccountMenu` 里的「编辑身份」「通知与 Discord」改成 `Link` 到 `/welcome`。
   - `WelcomeCard`（访客首页）的主按钮改为「开始」，指向 `/welcome`；「30 秒看懂」保留。
5. **退役**：
   - 删除 `OnboardingDialog.tsx` 及其 CSS；
   - `App.tsx` 不再渲染它；
   - 原来测弹窗的 dom 用例改成测 `/welcome`。
6. **测试（dom）**：
   - 访客打开 `/welcome`，只有第 1 步可操作；
   - 已登录未绑定，第 2 步展开；
   - 已绑定但私信关着，第 3 步展开，点开关会调用 `setDiscordNotify(true)`；
   - `dm_ok` 为假时有排查提示和「再发一次」，点了会调用 `resendWelcome`；为真时也有「再发一次」，但没有排查提示；
   - 四步都完成时，第 5 步展开，点「完成，去首页」回到 `/`；
   - `?onboarding=1` 和 `?linked=discord` 都会落到 `/welcome`；
   - `/guide` 页上能看到 `/help`。

### 第 5 步 · 首页入户卡

1. `src/lib/todo.ts` / `TodoCard`：
   - 删除 `unbound` 和 `dm-broken` 两种卡；
   - 新增 `onboarding` 卡，文案「还差 N 步完成入户」，按钮「继续」指向 `/welcome`；
   - N 是第 2–4 步中没完成的步数，判断条件和 `WelcomePage` 用同一个纯函数，新增在 `src/lib/onboardingSteps.ts`；
   - 排在待办最前面；
   - `todoMarks` 里 `unboundDismissed` 那一套改成 `onboardingDismissed`：关掉后 7 天内不再出现，新的步骤没做完时重新出现。
2. **测试**：
   - unit：`onboardingSteps` 的各种组合；
   - dom：未绑定用户的首页有入户卡，并且没有旧的「未绑定」卡；四步都完成的用户没有入户卡。

### 第 6 步 · 文档

- `docs/CONTRACT.md`：
  - 新增 `/welcome`、`/guide` 两个路由；
  - 新增 `POST /api/me/discord/welcome`；
  - 写明 `?onboarding`、`?linked` 新的落点。
- `docs/DEPLOY-DISCORD.md`：命令表加上 `/help`，私信种类加上 `dm.welcome`。

## 4. 验证

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

全部通过。PR 描述里写出各套件的前后测试数。

## 5. 需要机主过目

1. 指南文案（`shared/guide.ts`）。合并前请机主读一遍。
2. 欢迎私信的内容。
3. 入户卡被关掉后，7 天内不再出现。

## 6. 部署

- 合并后在 Coolify 里 Redeploy。`migrate` 会执行 `0009_welcome.sql`。部署前先备份。
- 部署时 Discord 会刷新命令表，`/help` 随之出现。
- 已经绑定的老用户不会补发欢迎私信，因为触发器只对新插入的绑定生效。

## 7. PR

- 分支：`claude/s2-welcome`
- 标题：`feat: 入户向导、私信开关、欢迎私信与机器人指南（S2）`
- 描述：按第 3 节的 6 步分节写，说明每一步的偏离。commit 和描述里都不加署名行。
