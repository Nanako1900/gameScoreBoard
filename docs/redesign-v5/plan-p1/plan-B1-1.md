# B1-1 判决前脱敏（后端） 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 案件判决前（`awaiting_statement`、`judging`），对当事人、立案人、裁判、管理员以外的人（`canReadPrivate` 为假），后端 `redactRecord` 把类型、立案经过、AI 摘要、短评、量刑区间、升级建议都隐藏掉，只告诉他「某某有一起记录在处理中」（spec §8 B1-1，§11 第 3 条档位 b）；保留 `statement_at`。前端能渲染 `type`/`range` 为 null 的记录：VerdictCard 显示「处理中」「X有一起记录在处理中，判决后公开。」「分数变化：判决后公开」，动态流这一行只剩名字和「处理中」。

**Architecture：** 后端只改一个函数 `worker/case-reads.ts` 的 `redactRecord`（所有网页路由都经过它，Node 端 `server/src/api.ts` 直接复用同一个 Worker app，所以 D1 和 PostgreSQL 两个引擎走的是同一段代码）；`worker/types.ts` 的 `RecordView` 变成「完整形态 | 判决前脱敏形态」的联合类型。前端：`src/types.ts` 的 `RecordItem` 加 `pending_hidden?`、`type`/`range` 可空；新建纯模块 `src/lib/recordView.ts` 提供文案和 `violationLabel`/`violationDef`；VerdictCard 对脱敏形态走一个独立的内部组件 `PendingHiddenCard`，RecordsFeed 只改这一行的标签和 chip；其余组件只加类型守卫，行为不变。bot 不经过 `redactRecord`，不改。

**Tech Stack：** TypeScript、Hono（worker/）、React 18 + Vite（src/）、Vitest（unit：`vitest.config.ts`；dom：`vitest.dom.config.ts` + jsdom + Testing Library；worker：`vitest.workers.config.ts`，Cloudflare pool + D1；PG：`vitest.pg.config.ts` 用同一批 `tests/worker/**` 跑 PostgreSQL，本地不跑）。

**依赖：** 上游分支 `claude/p1-0-hosting`（P1-0 已完成：`functions/`、`edgeone.json` 已删除，`tests/unit/source-hygiene.test.ts` 的 `SOURCE_DIRS` 已去掉 `'functions'`；见本目录 `plan-P1-0.md`）。共享契约：本目录 `contract.md`（下称「契约」）§2「B1-1」、§3（`src/types.ts` 只有 B1-1 改）、§4.10、§5「B1-1」、§7 风险表。spec：`docs/redesign-v5/spec.md` §8 B1-1、§9 B1-1 行、§10 第 12 条、§11 第 3 条、§6 语气表「判决前（公开视图）」。

**分支：** `claude/b1-1-redact`，从 `claude/p1-0-hosting` 的 HEAD 开（`git switch -c claude/b1-1-redact claude/p1-0-hosting`）。不 fetch、不 rebase `origin/main`、不 push、不开 PR、不合并。下一个 PR（P1-1 `claude/p1-1-router`）从本分支开。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `worker/types.ts` | 改 | `RecordView` 改成联合类型：`OpenRecordView`（今天的形态，永远没有 `pending_hidden` 键）和 `PendingHiddenRecordView`（`type`/`range`/`claim`/`claim_summary`/`note` 为 null、`escalation_suggested: false`、`redacted: true`、`pending_hidden: true`）；新导出 `PendingHiddenField` |
| `worker/case-reads.ts` | 改 | 新导出 `isPreVerdict(status)`；内部 `blankVerdictWords`（从 `redactRecord` 里抽出来的判词置空逻辑，行为不变）；`redactRecord` 在判决前对无关的人追加隐藏 |
| `src/types.ts` ★ | 改 | `RecordItem.type: ViolationType \| null`、`range: SentencingRange \| null`、新增可选 `pending_hidden?: boolean`（契约 §3：只有 B1-1 改这个文件） |
| `src/lib/recordView.ts` | 新（纯模块） | `PENDING_HIDDEN_LABEL`、`PENDING_HIDDEN_DELTA`、`isPendingHidden`、`pendingHiddenSentence`、`violationDef`、`violationLabel` |
| `src/components/VerdictCard.tsx` | 改 | 脱敏形态走内部组件 `PendingHiddenCard`；抽出 `StatementWritten`、`TrialProgress` 两个内部小组件供两种形态共用（非脱敏卡片 DOM 不变）；`range` 为 null 时不画量刑尺 |
| `src/components/verdict-card.css` | 改（只在末尾追加） | `.vc__delta-hidden` |
| `src/components/RecordsFeed.tsx` | 改 | 脱敏行：标签「处理中」、emoji `•`、不显示状态 chip、「待确认升级」chip 和 `claim_summary` |
| `src/components/CaseActions.tsx` | 改 | `range` 为 null 时不渲染改判表单（类型守卫）；`OverrideForm` 改收 `range` prop |
| `src/components/StatementDialog.tsx` | 改 | 类型守卫：`violationLabel(record.type)`、`record.range && <SentencingScale …>`；文案不变 |
| `src/components/AppealSheet.tsx` | 改 | 类型守卫：`violationLabel(record.type)`；文案不变 |
| `src/components/PendingBanner.tsx` | 改 | 类型守卫：`violationLabel(next.type)`；文案不变 |
| `tests/unit/record-privacy.test.ts` | 改（只追加） | 新 `describe('redactRecord before the verdict')`：8 个用例 |
| `tests/worker/record-privacy.test.ts` | 改（只追加） | 新 `describe('a case before its verdict, on the web')`：9 个用例，D1 和 PG 两个引擎都跑 |
| `tests/unit/record-view.test.ts` | 新 | `recordView.ts` 的 5 个用例 + 本周之星/走势不受脱敏记录影响的 2 个用例 |
| `tests/dom/verdict-privacy.test.tsx` | 改（只追加；import 行加 `within` 和 `RecordsFeed`） | VerdictCard 脱敏形态 4 个用例、RecordsFeed 脱敏行 2 个用例 |

**不碰：** `src/App.tsx`、`src/components/PlayerDetail.tsx`（置顶卡 eyebrow「案件 #N · 处理中」是 P1-1 的事，它会用本 PR 的 `violationLabel(null)`）、`server/**`（bot）、`shared/**`、`docs/**`（CONTRACT.md 的措辞由 P1-4 补）、`src/components/records-feed.css`（契约允许追加，但本 PR 不需要新样式）。

---

### Task 0：开分支、核对上游、记基线

**Files:** 无改动。

- [ ] **Step 1：确认上游分支存在、工作区干净，开分支**

```bash
git rev-parse --verify claude/p1-0-hosting
git status --porcelain   # 期望：无输出
git switch -c claude/b1-1-redact claude/p1-0-hosting
```

上游分支不存在或工作区不干净 → 停下报告，不要自己补 P1-0 的文件。

- [ ] **Step 2：核对本 PR 要改的锚点都在、要新建的文件都不在**

```bash
test ! -e functions && test ! -e edgeone.json && echo "P1-0 OK"
grep -n "export function redactRecord(record: RecordItem, viewer: User | null): RecordView" worker/case-reads.ts
grep -n "export interface RecordView extends RecordItem" worker/types.ts
grep -n "^  type: ViolationType;$" src/types.ts
grep -n "^  range: SentencingRange;$" src/types.ts
grep -n "redacted?: boolean;" src/types.ts
grep -n "const def = VIOLATION_MAP\[record.type\];" src/components/VerdictCard.tsx src/components/StatementDialog.tsx
grep -n "VIOLATION_MAP\[record.type\]?.emoji ?? '•'" src/components/RecordsFeed.tsx
grep -n "return <OverrideForm record={record} onCancel={props.onCancelOverride} onSubmit={props.onOverride} />;" src/components/CaseActions.tsx
test ! -e src/lib/recordView.ts && test ! -e tests/unit/record-view.test.ts && echo "new files absent"
grep -rn "redactRecord\|RecordView" server/src   # 期望：无输出（bot 只用 canReadPrivate）
grep -n "canReadPrivate" server/src/discord/verdict.ts   # 期望：import 一行 + 调用一行
grep -n "const SOURCE_DIRS" tests/unit/source-hygiene.test.ts   # 期望：一行，且不含 'functions'（P1-0 已改）
git show claude/p1-0-hosting:src/components/VerdictCard.tsx | shasum -a 256   # 记下来，Task 3 Step 3 要用（规划副本 cc5eb4b9…96c7）
```

每条 grep 都要有输出（标了「期望：无输出」的除外）。对不上就停下。注意 `src/types.ts` 里 `^  type: ViolationType;$` 和 `^  range: SentencingRange;$` 各有**两处**（另一处在 `CaseDraft`，点名草稿，不改）；Task 2 Step 3 的锚点带了上下文，只会命中 `RecordItem` 那一处。

- [ ] **Step 3：跑基线，记下实际数字**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | tail -5
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:worker 2>&1 | tail -5
```

记为 **U0**（unit 文件数/用例数）、**D0**（dom）、**W0**（worker）。期望（`plan-P1-0.md` 收尾表：P0-5 基线 + P1-0 的 unit +4、worker +3）：unit **26 / 330**，dom **20 / 219**，worker **15 / 551 passed + 9 todo**。数字不同但全绿 → 以实测为准记下（后面一律按「U0 + 增量」理解）；有红 → 停下。dom 的 `act(...)` 警告只有 `onboarding-roles`（DiscordLinkCard）那 3 条。

> 已知风险：如果 Step 2 的 `SOURCE_DIRS` 还含 `'functions'`（P1-0 没改到），`readdirSync` 会抛 ENOENT、unit 基线就是红的。这属于 P1-0，停下报告，不在本 PR 里修。

---

### Task 1：后端 `redactRecord` 判决前脱敏（档位 b）

**Files:**
- Modify: `tests/unit/record-privacy.test.ts`（末尾追加）
- Modify: `tests/worker/record-privacy.test.ts`（末尾追加）
- Modify: `worker/types.ts`（`RecordView` 一段）
- Modify: `worker/case-reads.ts`（`redactRecord` 一段）

- [ ] **Step 1：写失败的单测**

在 `tests/unit/record-privacy.test.ts` **文件末尾**追加（原有 5 个用例一个字不改；`record`、`user` 是文件里已有的常量和函数）：

```ts

// B1-1 (spec §11 #3 tier b): before the verdict, an outsider learns only that a case exists.
describe('redactRecord before the verdict', () => {
  const pendingCase: RecordItem = {
    ...record,
    type: 'no_show',
    delta: 0,
    note: '立案短评',
    claim: '说好八点五排结果没来',
    claim_summary: '八点没来',
    escalation_suggested: true,
    session_id: 5,
    statement: '家里有事',
    statement_at: '2026-10-26 10:00:00',
    appeal_reason: null,
    deadline_at: '2026-10-26 21:00:00',
    status: 'awaiting_statement',
    verdict: null,
  };

  for (const status of ['awaiting_statement', 'judging'] as const) {
    for (const viewer of [null, user('x')]) {
      it(`hides the accusation itself while ${status}, from ${viewer ? 'an unrelated user' : 'a visitor'}`, () => {
        const view = redactRecord({ ...pendingCase, status }, viewer);
        expect(view).toEqual({
          ...pendingCase,
          status,
          type: null,
          range: null,
          claim: null,
          claim_summary: null,
          note: null,
          escalation_suggested: false,
          statement: null,
          appeal_reason: null,
          verdict: null,
          redacted: true,
          pending_hidden: true,
        });
      });
    }
  }

  it('keeps statement_at, so the page can still say a statement was written', () => {
    expect(redactRecord(pendingCase, null)).toMatchObject({ pending_hidden: true, statement_at: '2026-10-26 10:00:00' });
    expect(redactRecord({ ...pendingCase, statement_at: null }, null)).toMatchObject({ pending_hidden: true, statement_at: null });
  });

  it('leaves the input as it is', () => {
    const frozen = Object.freeze({ ...pendingCase });
    const view = redactRecord(frozen, null);
    expect(view).not.toBe(frozen);
    expect(frozen.claim).toBe('说好八点五排结果没来');
    expect(frozen.type).toBe('no_show');
  });

  it('hides nothing more from the subject, the reporter, judges and admins', () => {
    for (const viewer of [user('s'), user('r'), user('j', { is_judge: true }), user('a', { is_admin: true })]) {
      const view = redactRecord(pendingCase, viewer);
      expect(view).toEqual({ ...pendingCase, redacted: false });
      expect(view).not.toHaveProperty('pending_hidden');
    }
  });

  it('stops once there is a verdict: decided, appealed, revoked and withdrawn cases keep their type', () => {
    for (const status of ['decided', 'appealed', 'revoked', 'withdrawn'] as const) {
      const view = redactRecord({ ...pendingCase, status }, null);
      expect(view, status).not.toHaveProperty('pending_hidden');
      expect(view, status).toMatchObject({ type: 'no_show', claim: '说好八点五排结果没来', note: '立案短评', range: pendingCase.range, redacted: true });
    }
  });
});
```

- [ ] **Step 2：跑单测，确认失败**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npx vitest run --config vitest.config.ts tests/unit/record-privacy.test.ts
```

期望：**5 failed | 8 passed (13)**，失败的是 4 个 `hides the accusation itself while …`（今天的输出里 `type`、`claim` 都还在）和 `keeps statement_at …`（今天没有 `pending_hidden`；断言它是为了证明 `statement_at` 是在**新的**隐藏路径上被保留的）。原有 5 个和另外 3 个新用例（输入不变、相关的人不受影响、判决后不受影响——守卫型，今天就成立）通过。

- [ ] **Step 3：写失败的路由级测试（D1 与 PG 共用）**

在 `tests/worker/record-privacy.test.ts` **文件末尾**追加（原有用例不改；`get`、`routes`、`seedUser`、`env` 都是文件里已有的）：

```ts

// B1-1 (spec §11 #3 tier b): before the verdict an outsider learns only that a
// case exists — not its type, its accusation, the judge's note or its range.
describe('a case before its verdict, on the web', () => {
  const ACCUSATION = ['SECRETCLAIM', 'SECRETSUMMARY', 'SECRETNOTE'];

  /** A case still awaiting its verdict, with the accusation filled in and a statement already written. */
  async function castPending(status: 'awaiting_statement' | 'judging'): Promise<{ recordId: number; sessionId: number }> {
    await seedUser({ id: 'subject' });
    await seedUser({ id: 'reporter', judge: true });
    await seedUser({ id: 'judge2', judge: true });
    await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'outsider' });
    const session = await env.DB.prepare(
      "INSERT INTO game_sessions (organizer_id, title, starts_at, status) VALUES ('reporter', '周五五排', ?, 'settled')",
    )
      .bind(new Date(Date.now() - 86_400_000).toISOString())
      .run();
    const sessionId = Number(session.meta.last_row_id);
    const record = await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, note, claim, claim_summary, escalation_suggested,
                            statement, statement_at, deadline_at, status, session_id)
       VALUES ('subject', 'reporter', 'no_show', 0, 'SECRETNOTE 短评', 'SECRETCLAIM 说好八点五排结果没来', 'SECRETSUMMARY 八点没来', 1,
               'SECRETSTMT 家里有事', datetime('now'), datetime('now', '+1 day'), ?, ?)`,
    )
      .bind(status, sessionId)
      .run();
    return { recordId: Number(record.meta.last_row_id), sessionId };
  }

  for (const status of ['awaiting_statement', 'judging'] as const) {
    for (const viewer of [undefined, 'outsider'] as const) {
      it(`is only “a case in progress” while ${status}, for ${viewer ?? 'a visitor who is not logged in'}, on every route`, async () => {
        const { recordId, sessionId } = await castPending(status);
        for (const route of routes(recordId, sessionId)) {
          const res = await get(route.path, viewer);
          expect(res.status, route.path).toBe(200);
          for (const marker of [...ACCUSATION, 'SECRETSTMT']) expect(res.text, `${route.path} leaks ${marker}`).not.toContain(marker);
          const record = route.pick(res.json);
          expect(record, route.path).toMatchObject({
            id: recordId,
            type: null,
            range: null,
            claim: null,
            claim_summary: null,
            note: null,
            escalation_suggested: false,
            statement: null,
            redacted: true,
            pending_hidden: true,
            status,
            delta: 0,
            session_id: sessionId,
            subject: { id: 'subject' },
            reporter: { id: 'reporter' },
          });
          // A statement was written: the page must still be able to say so.
          expect(record.statement_at, route.path).not.toBeNull();
          expect(record.deadline_at, route.path).not.toBeNull();
        }
      });
    }
  }

  for (const viewer of ['subject', 'reporter', 'judge2', 'admin']) {
    it(`is shown whole to the ${viewer}`, async () => {
      const { recordId, sessionId } = await castPending('awaiting_statement');
      for (const route of routes(recordId, sessionId)) {
        const res = await get(route.path, viewer);
        for (const marker of ACCUSATION) expect(res.text, `${route.path} for ${viewer}`).toContain(marker);
        const record = route.pick(res.json);
        expect(record, route.path).toMatchObject({ type: 'no_show', escalation_suggested: true, redacted: false });
        expect(record, route.path).not.toHaveProperty('pending_hidden');
        expect(record.range, route.path).not.toBeNull();
      }
    });
  }

  it('is decided case by case in one list: a decided case of the same person stays public', async () => {
    const { recordId } = await castPending('awaiting_statement');
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source)
       VALUES ('subject', 'reporter', 'late_minor', -3, '迟到了五分钟', 'decided', 'fallback')`,
    ).run();
    const res = await get('/api/records', 'outsider');
    const records = res.json.records as Array<Record<string, unknown>>;
    const pending = records.find((r) => r.id === recordId);
    const decided = records.find((r) => r.id !== recordId);
    expect(pending).toMatchObject({ type: null, pending_hidden: true });
    expect(decided).toMatchObject({ type: 'late_minor', claim: '迟到了五分钟', delta: -3, redacted: true });
    expect(decided).not.toHaveProperty('pending_hidden');
  });
});
```

说明：`deadline_at` 用 `datetime('now', '+1 day')`（`tests/worker/batch-cases.test.ts:382` 用的同一写法，PG 适配层支持）；截止时间在未来，而且到期裁决只挂在 `GET /api/config`（`worker/routes.ts` 的 `sweepDueCases`）上，这些路由都不会触发。PG 上 `escalation_suggested = 1` 且 `awaiting_statement` 的 INSERT 会触发 `records_outbox_escalation`（`server/migrations/0006_p8.sql`）往 outbox 写一条 `dm.escalation`——测试里没有 dispatcher，PG 套件每个用例前清库，无副作用。

- [ ] **Step 4：跑路由级测试，确认失败**

```bash
npx vitest run --config vitest.workers.config.ts tests/worker/record-privacy.test.ts
```

期望：**5 failed | 14 passed (19)**：4 个 `is only “a case in progress” …` 和 `is decided case by case in one list …` 失败；原有 10 个、`is shown whole to the …` 4 个通过。

- [ ] **Step 5：改 `worker/types.ts` 的 `RecordView`**

把锚点 `export interface RecordView extends RecordItem {` 连同它上面的 JSDoc 整段：

```ts
/**
 * A case as the web API returns it to one viewer. The statement, the appeal
 * reason and the verdict's words (headline, reasoning, factors — written after
 * reading the statement, often quoting it) are only for the subject, the
 * reporter, judges and admins; anyone else gets them blanked and `redacted`.
 * The outcome (type, delta, status, who) stays public.
 */
export interface RecordView extends RecordItem {
  redacted: boolean;
}
```

替换为：

```ts
/**
 * A case as the web API returns it to one viewer. The statement, the appeal
 * reason and the verdict's words (headline, reasoning, factors — written after
 * reading the statement, often quoting it) are only for the subject, the
 * reporter, judges and admins; anyone else gets them blanked and `redacted`.
 * After the verdict the outcome (type, delta, status, who) stays public;
 * before it, see PendingHiddenRecordView.
 */
export type RecordView = OpenRecordView | PendingHiddenRecordView;

/** Every case a viewer may read in full, and every decided case. Never carries `pending_hidden`. */
export interface OpenRecordView extends RecordItem {
  redacted: boolean;
  pending_hidden?: never;
}

/** The accusation's fields an outsider must not read before the verdict (B1-1, spec §11 #3 tier b). */
export type PendingHiddenField = 'type' | 'range' | 'claim' | 'claim_summary' | 'note' | 'escalation_suggested';

/**
 * Before the verdict (awaiting_statement / judging), to anyone but the subject,
 * the reporter, judges and admins: only that a case exists. The type, the
 * accusation, the judge's note, the sentencing range and the escalation hint are
 * blanked; statement_at stays, so the UI can still say a statement was written.
 */
export interface PendingHiddenRecordView extends Omit<RecordItem, PendingHiddenField> {
  type: null;
  range: null;
  claim: null;
  claim_summary: null;
  note: null;
  escalation_suggested: false;
  redacted: true;
  pending_hidden: true;
}
```

`worker/types.ts` 里 `RecordItem` 本身（`type: ViolationType;`、`range: { min: number; max: number; base: number };`）**不改**：数据库读出来的记录永远完整，只有对外视图可空。

- [ ] **Step 6：改 `worker/case-reads.ts` 的 `redactRecord`**

把从 `/**\n * The case as \`viewer\` may see it` 开始、到 `redactRecord` 函数结束的整段：

```ts
/**
 * The case as `viewer` may see it — a new object; the input is left as it is.
 * A bonus's 'manual' verdict is only its label (no statement was ever read for
 * it), so it stays.
 */
export function redactRecord(record: RecordItem, viewer: User | null): RecordView {
  if (canReadPrivate(record, viewer)) return { ...record, redacted: false };
  const verdict =
    record.verdict && record.verdict.source !== 'manual'
      ? { ...record.verdict, headline: '', reasoning: '', factors: [] }
      : record.verdict;
  return { ...record, statement: null, appeal_reason: null, verdict, redacted: true };
}
```

替换为：

```ts
/** No verdict yet: the case is still an accusation, not an outcome. */
export function isPreVerdict(status: CaseStatus): boolean {
  return status === 'awaiting_statement' || status === 'judging';
}

/** A bonus's 'manual' verdict is only its label (no statement was ever read for it), so it stays. */
function blankVerdictWords(verdict: RecordItem['verdict']): RecordItem['verdict'] {
  return verdict && verdict.source !== 'manual'
    ? { ...verdict, headline: '', reasoning: '', factors: [] }
    : verdict;
}

/**
 * The case as `viewer` may see it — a new object; the input is left as it is.
 * An outsider never gets the statement, the appeal reason or the verdict's
 * words; before the verdict they get no accusation either (B1-1, spec §11 #3
 * tier b): no type, claim, summary, note, range or escalation hint — only that
 * a case is in progress. statement_at stays either way.
 */
export function redactRecord(record: RecordItem, viewer: User | null): RecordView {
  if (canReadPrivate(record, viewer)) return { ...record, redacted: false };
  const outsider = {
    ...record,
    statement: null,
    appeal_reason: null,
    verdict: blankVerdictWords(record.verdict),
    redacted: true as const,
  };
  if (!isPreVerdict(record.status)) return outsider;
  return {
    ...outsider,
    type: null,
    range: null,
    claim: null,
    claim_summary: null,
    note: null,
    escalation_suggested: false,
    pending_hidden: true,
  };
}
```

`CaseStatus` 已经在文件顶部的 `import { VIOLATION_MAP, type CaseStatus, … } from '../shared/scoring';` 里，不用加 import。`redactRecords`、`canReadPrivate` 不动。

- [ ] **Step 7：跑测试，确认通过；typecheck 三个工程**

```bash
npx vitest run --config vitest.config.ts tests/unit/record-privacy.test.ts
npx vitest run --config vitest.workers.config.ts tests/worker/record-privacy.test.ts
npm run typecheck
npm run test:worker 2>&1 | tail -5
```

期望：unit 文件 **13 passed (13)**；worker 文件 **19 passed (19)**；typecheck 通过（`worker/routes.ts`、`worker/routes-admin.ts` 里所有 `c.json({ record: redactRecord(…) })` 不用改；`server/tsconfig.json` 也过）；worker 全量 **15 个文件、W0 + 9 个用例**（预期 560 passed + 9 todo）全过（规划副本实测：现有 548 个用例在新规则下原样通过 → 557，没有别的测试依赖判决前对访客公开类型）。

- [ ] **Step 8：提交**

```bash
git add worker/types.ts worker/case-reads.ts tests/unit/record-privacy.test.ts tests/worker/record-privacy.test.ts
git commit -m "feat: 判决前对无关的人只透露有一起记录在处理中（redactRecord 档位 b）"
```

---

### Task 2：前端类型可空、`recordView` 文案助手、各调用点类型守卫（行为不变）

**Files:**
- Create: `tests/unit/record-view.test.ts`
- Create: `src/lib/recordView.ts`
- Modify: `src/types.ts`（`RecordItem` 的 `type`、`range`、`pending_hidden`）
- Modify: `src/components/VerdictCard.tsx`、`src/components/RecordsFeed.tsx`、`src/components/CaseActions.tsx`、`src/components/StatementDialog.tsx`、`src/components/AppealSheet.tsx`、`src/components/PendingBanner.tsx`（只加类型守卫）

本 Task 有两道「先失败」：先是 `record-view.test.ts` 找不到模块；类型改成可空之后，是 typecheck 列出的每一个调用点。界面行为一律不变，完整 dom 套件是回归网；脱敏形态的渲染在 Task 3。

- [ ] **Step 1：写失败的单测**

新建 `tests/unit/record-view.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  PENDING_HIDDEN_DELTA,
  PENDING_HIDDEN_LABEL,
  isPendingHidden,
  pendingHiddenSentence,
  violationDef,
  violationLabel,
} from '../../src/lib/recordView';
import { computeTrends } from '../../src/lib/feedStats';
import { computeWeekHighlights } from '../../src/lib/weekStars';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// B1-1 (spec §11 #3 tier b): before the verdict, the API tells an outsider only
// that a case exists. These helpers name such a case; the week's numbers never
// count it.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00';
const LAST_WEEK = '2026-10-25 15:00:00';

function rec(id: number, subjectId: string, type: ViolationType, delta: number, status: CaseStatus, created_at = IN_WEEK): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId, avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

/** What the API sends an outsider for a case still awaiting its verdict. */
function hidden(id: number, subjectId: string, status: CaseStatus = 'awaiting_statement'): RecordItem {
  return {
    ...rec(id, subjectId, 'no_show', 0, status),
    type: null,
    range: null,
    redacted: true,
    pending_hidden: true,
  };
}

describe('recordView — naming a case', () => {
  it('says 处理中 for a type the API hid, and the rules label otherwise', () => {
    expect(PENDING_HIDDEN_LABEL).toBe('处理中');
    expect(violationLabel(null)).toBe('处理中');
    expect(violationLabel('no_show')).toBe('放鸽子');
    expect(violationLabel('late_major')).toBe('大迟到');
  });

  it('falls back to the raw type a newer API might send', () => {
    expect(violationLabel('brand_new' as ViolationType)).toBe('brand_new');
    expect(violationDef('brand_new' as ViolationType)).toBeUndefined();
  });

  it('has no rules entry for a hidden type', () => {
    expect(violationDef(null)).toBeUndefined();
    expect(violationDef('no_show')?.kind).toBe('penalty');
  });

  it('tells who has a case in progress, and that the score waits for the verdict', () => {
    expect(pendingHiddenSentence('老王')).toBe('老王有一起记录在处理中，判决后公开。');
    expect(PENDING_HIDDEN_DELTA).toBe('分数变化：判决后公开');
  });

  it('reads the flag only when it is exactly true (an older API sends none)', () => {
    expect(isPendingHidden({ pending_hidden: true })).toBe(true);
    expect(isPendingHidden({ pending_hidden: false })).toBe(false);
    expect(isPendingHidden({})).toBe(false);
  });
});

describe('the week’s numbers ignore a hidden case', () => {
  const OLD = rec(1, '老王', 'organizer_bonus', 2, 'decided', LAST_WEEK);

  it('still finds the stars, and a hidden case of theirs takes nothing away', () => {
    const records = [hidden(9, '阿杰'), hidden(8, '阿杰', 'judging'), rec(3, '阿杰', 'on_time_bonus', 2, 'decided'), rec(2, '阿杰', 'on_time_bonus', 2, 'decided'), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({
      kind: 'stars',
      stars: [{ user: { id: '阿杰', username: '阿杰', avatar_url: null }, onTime: 2 }],
    });
  });

  it('never moves the week’s trend', () => {
    expect(computeTrends([hidden(9, '阿杰'), OLD], NEXT_RESET)).toEqual({});
  });
});
```

- [ ] **Step 2：跑单测，确认失败**

```bash
npx vitest run --config vitest.config.ts tests/unit/record-view.test.ts
```

期望：文件加载失败（`Failed to resolve import "../../src/lib/recordView"` 或同义的「找不到模块」），0 个用例运行。

- [ ] **Step 3：`src/types.ts` 加 `pending_hidden?`，`type`、`range` 改成可空**

锚点：`RecordItem` 里的

```ts
   * them and sets this. (Absent from an older API: nothing was hidden.)
   */
  redacted?: boolean;
}
```

替换为：

```ts
   * them and sets this. (Absent from an older API: nothing was hidden.)
   */
  redacted?: boolean;
  /**
   * B1-1: before the verdict, for anyone but the subject, the reporter, judges
   * and admins, the API also hides the type, the claim, its summary, the note
   * and the range (`type` and `range` are then null) — only that a case is in
   * progress. statement_at stays. (Absent from an older API.)
   */
  pending_hidden?: boolean;
}
```

锚点（`RecordItem` 内）：

```ts
  reporter: UserRef;
  type: ViolationType;
  delta: number; // signed, actually applied (0 until decided)
```

替换为：

```ts
  reporter: UserRef;
  /** null only when `pending_hidden`. */
  type: ViolationType | null;
  delta: number; // signed, actually applied (0 until decided)
```

锚点：

```ts
  verdict: Verdict | null;
  range: SentencingRange;
  created_at: string;
```

替换为：

```ts
  verdict: Verdict | null;
  /** null only when `pending_hidden`. */
  range: SentencingRange | null;
  created_at: string;
```

- [ ] **Step 4：新建 `src/lib/recordView.ts`**

```ts
// B1-1: how the UI names a case, including one the API hid before its verdict
// (`pending_hidden`: no type, claim, note or range — only that it exists).
// Pure — tests/unit/record-view.test.ts.
import { VIOLATION_MAP, type ViolationDef, type ViolationType } from '@shared/scoring';
import type { RecordItem } from '../types';

/** What stands in for the type of a case the API hid (spec §11 #3 tier b). */
export const PENDING_HIDDEN_LABEL = '处理中';
/** Where the delta would be: never a 0 (CONTRACT.md Frontend expectations). */
export const PENDING_HIDDEN_DELTA = '分数变化：判决后公开';

export function isPendingHidden(record: Pick<RecordItem, 'pending_hidden'>): boolean {
  return record.pending_hidden === true;
}

/** 「老王有一起记录在处理中，判决后公开。」 */
export function pendingHiddenSentence(username: string): string {
  return `${username}有一起记录在处理中，判决后公开。`;
}

/** The type's rules entry; undefined for a hidden case (null) or a type this bundle does not know. */
export function violationDef(type: ViolationType | null): ViolationDef | undefined {
  return type === null ? undefined : VIOLATION_MAP[type];
}

/** 「大迟到」; 「处理中」 when the API hid the type; the raw type if this bundle does not know it. */
export function violationLabel(type: ViolationType | null): string {
  if (type === null) return PENDING_HIDDEN_LABEL;
  return violationDef(type)?.label ?? type;
}
```

纯模块：只有 `@shared/scoring` 的值导入和 `../types` 的类型导入，不碰 `window`/`document`/storage，不导入 React（契约 §0：被 `tests/unit` 导入的 `src/lib` 模块必须是纯模块；`vitest.config.ts` 已配 `@shared` 别名）。

- [ ] **Step 5：跑单测，确认通过**

```bash
npx vitest run --config vitest.config.ts tests/unit/record-view.test.ts
```

期望：**7 passed (7)**。

- [ ] **Step 6：跑 typecheck，确认失败且只有这些位置**

```bash
npm run typecheck 2>&1 | grep "error TS"
```

期望正好这 12 条（行号可能因 P0 执行者的细微差异略有出入，文件和种类必须一致）：

```
src/components/AppealSheet.tsx(65,31): error TS2538: Type 'null' cannot be used as an index type.
src/components/CaseActions.tsx(125,16): error TS18047: 'record.range' is possibly 'null'.
src/components/CaseActions.tsx(125,37): error TS18047: 'record.range' is possibly 'null'.
src/components/CaseActions.tsx(130,16): error TS18047: 'record.range' is possibly 'null'.
src/components/CaseActions.tsx(131,16): error TS18047: 'record.range' is possibly 'null'.
src/components/PendingBanner.tsx(38,31): error TS2538: Type 'null' cannot be used as an index type.
src/components/RecordsFeed.tsx(87,31): error TS2538: Type 'null' cannot be used as an index type.
src/components/RecordsFeed.tsx(109,31): error TS2538: Type 'null' cannot be used as an index type.
src/components/StatementDialog.tsx(147,29): error TS2538: Type 'null' cannot be used as an index type.
src/components/StatementDialog.tsx(163,24): error TS2322: Type 'SentencingRange | null' is not assignable to type 'SentencingRange'.
src/components/VerdictCard.tsx(43,29): error TS2538: Type 'null' cannot be used as an index type.
src/components/VerdictCard.tsx(146,40): error TS2322: Type 'SentencingRange | null' is not assignable to type 'SentencingRange'.
```

（`npm run typecheck` 在第一个 tsconfig 失败就停，所以这里只看到前端工程 `tsconfig.json` 的错；`tests/unit/record-view.test.ts` 由 `tsconfig.worker.json` 检查，类型可空之后它没有错。）出现别的文件 → 停下核对，那是本计划没看到的消费者。

- [ ] **Step 7：VerdictCard 类型守卫**

`src/components/VerdictCard.tsx` 顶部：

```ts
import { VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem, VerdictSource } from '../types';
```

替换为：

```ts
import type { RecordItem, VerdictSource } from '../types';
import { violationDef } from '../lib/recordView';
```

函数体里：

```ts
  const def = VIOLATION_MAP[record.type];
```

替换为：

```ts
  const def = violationDef(record.type);
```

量刑尺那一行：

```tsx
          {!voided && <SentencingScale range={record.range} delta={record.delta} />}
```

替换为：

```tsx
          {!voided && record.range && <SentencingScale range={record.range} delta={record.delta} />}
```

- [ ] **Step 8：RecordsFeed 类型守卫**

`src/components/RecordsFeed.tsx`：

```ts
import { CASE_STATUS_LABEL, VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem } from '../types';
```

替换为：

```ts
import { CASE_STATUS_LABEL } from '@shared/scoring';
import type { RecordItem } from '../types';
import { violationDef, violationLabel } from '../lib/recordView';
```

`RecordRow` 里：

```ts
  const emoji = VIOLATION_MAP[record.type]?.emoji ?? '•';
```

替换为：

```ts
  const emoji = violationDef(record.type)?.emoji ?? '•';
```

`RecordLine` 里：

```ts
  const label = VIOLATION_MAP[record.type]?.label ?? record.type;
```

替换为：

```ts
  const label = violationLabel(record.type);
```

- [ ] **Step 9：CaseActions 类型守卫**

`src/components/CaseActions.tsx`：

```ts
import type { RecordItem, User } from '../types';
```

替换为：

```ts
import type { RecordItem, SentencingRange, User } from '../types';
```

`CaseActions` 里：

```tsx
  if (overriding) {
    return <OverrideForm record={record} onCancel={props.onCancelOverride} onSubmit={props.onOverride} />;
  }
```

替换为：

```tsx
  // Only an admin re-sentences, and an admin always gets the full case: range is null only for a hidden one.
  if (overriding && record.range) {
    return (
      <OverrideForm
        record={record}
        range={record.range}
        onCancel={props.onCancelOverride}
        onSubmit={props.onOverride}
      />
    );
  }
```

`OverrideFormProps`：

```ts
interface OverrideFormProps {
  record: RecordItem;
  onCancel: () => void;
```

替换为：

```ts
interface OverrideFormProps {
  record: RecordItem;
  range: SentencingRange;
  onCancel: () => void;
```

`OverrideForm` 签名：

```tsx
function OverrideForm({ record, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
```

替换为：

```tsx
function OverrideForm({ record, range, onCancel, onSubmit }: OverrideFormProps): JSX.Element {
```

`OverrideForm` 里三处 `record.range.` 换成 `range.`：

```tsx
          改判为（{record.range.min} ~ {record.range.max}）
```

→

```tsx
          改判为（{range.min} ~ {range.max}）
```

以及

```tsx
          min={record.range.min}
          max={record.range.max}
```

→

```tsx
          min={range.min}
          max={range.max}
```

- [ ] **Step 10：StatementDialog、AppealSheet、PendingBanner 类型守卫（文案不变）**

`src/components/StatementDialog.tsx`：

```ts
import { MAX_NARRATIVE_LEN, VIOLATION_MAP, affectsScore, clampScore } from '@shared/scoring';
```

→

```ts
import { MAX_NARRATIVE_LEN, affectsScore, clampScore } from '@shared/scoring';
```

在 `import { isBlankText, validateStatementDraft } from '../lib/draftShapes';` 下一行加：

```ts
import { violationLabel } from '../lib/recordView';
```

`StatementForm` 里删掉这一行：

```ts
  const def = VIOLATION_MAP[record.type];
```

```tsx
        {record.reporter.username} 给你记了一笔「{def?.label ?? record.type}」。
```

→

```tsx
        {record.reporter.username} 给你记了一笔「{violationLabel(record.type)}」。
```

```tsx
      <SentencingScale range={record.range} />
      <div className="sd__form">
```

→

```tsx
      {record.range && <SentencingScale range={record.range} />}
      <div className="sd__form">
```

`src/components/AppealSheet.tsx`：

```ts
import { APPEAL_MAX, VIOLATION_MAP } from '@shared/scoring';
```

→

```ts
import { APPEAL_MAX } from '@shared/scoring';
```

在 `import { isBlankText, validateAppealDraft } from '../lib/draftShapes';` 下一行加：

```ts
import { violationLabel } from '../lib/recordView';
```

`caseLine` 里：

```ts
  const label = VIOLATION_MAP[record.type]?.label ?? record.type;
```

→

```ts
  const label = violationLabel(record.type);
```

`src/components/PendingBanner.tsx`：

```ts
import { VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem } from '../types';
```

→

```ts
import type { RecordItem } from '../types';
import { violationLabel } from '../lib/recordView';
```

```tsx
          最早一起「{VIOLATION_MAP[next.type]?.label ?? next.type}」
```

→

```tsx
          最早一起「{violationLabel(next.type)}」
```

- [ ] **Step 11：typecheck 全绿，完整 unit + dom 回归**

```bash
npm run typecheck
grep -rn "VIOLATION_MAP\[" src   # 期望只剩 src/components/RollCallDialog.tsx（d.type 不是记录）和 src/lib/recordView.ts
npm run test:unit 2>&1 | tail -4
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
```

期望：typecheck 三个工程都过；unit **U0 文件 + 1、U0 用例 + 15**（预期 27 / 345）全过（Task 1 的 8 个 + 本 Task 的 7 个）；dom **D0** 原样全过（文件数、用例数都不变，`act(...)` 警告仍只有那 3 条）。

- [ ] **Step 12：提交**

```bash
git add src/types.ts src/lib/recordView.ts tests/unit/record-view.test.ts src/components/VerdictCard.tsx src/components/RecordsFeed.tsx src/components/CaseActions.tsx src/components/StatementDialog.tsx src/components/AppealSheet.tsx src/components/PendingBanner.tsx
git commit -m "feat: 前端案件类型允许为空，新增 recordView 文案助手和类型守卫"
```

---

### Task 3：VerdictCard 与动态流渲染判决前脱敏的案件

**Files:**
- Modify: `tests/dom/verdict-privacy.test.tsx`（import 行 + 末尾追加）
- Modify: `src/components/VerdictCard.tsx`（6 处锚点修改，见 Step 3）
- Modify: `src/components/verdict-card.css`（末尾追加）
- Modify: `src/components/RecordsFeed.tsx`

- [ ] **Step 1：写失败的 dom 测试**

`tests/dom/verdict-privacy.test.tsx` 顶部：

```ts
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerdictCard } from '../../src/components/VerdictCard';
```

替换为：

```ts
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { VerdictCard } from '../../src/components/VerdictCard';
```

**文件末尾**追加（原有 7 个用例不改；`record()` 是文件里已有的工厂函数，它的 subject 叫「选手」、reporter 叫「裁判」、id 7、type `no_show`）：

```tsx

// B1-1 (spec §11 #3 tier b): before the verdict, what the API sends anyone
// unrelated to the case — type, accusation, note and range are gone.
const pendingHidden = (over: Partial<RecordItem> = {}) =>
  record({
    type: null,
    range: null,
    delta: 0,
    note: null,
    claim: null,
    claim_summary: null,
    escalation_suggested: false,
    statement: null,
    statement_at: null,
    // 3.5 h ahead: the countdown reads 「还剩 3 小时 29 分」 (or 30 分 within the same millisecond) — never a bare 0.
    deadline_at: new Date(Date.now() + 3.5 * 3_600_000).toISOString(),
    status: 'awaiting_statement',
    verdict: null,
    redacted: true,
    pending_hidden: true,
    ...over,
  });

describe('VerdictCard, a case the API hid before its verdict', () => {
  it('only says a case is in progress, and that the score waits for the verdict — never a 0', () => {
    const { container } = render(<VerdictCard record={pendingHidden()} focused />);
    const card = container.querySelector('article')!;
    expect(card).toHaveAttribute('id', 'case-7');
    expect(card).toHaveClass('vc', 'vc--awaiting_statement', 'vc--focus');
    expect(screen.getByRole('heading', { name: '处理中' })).toBeInTheDocument();
    expect(screen.getByText('选手有一起记录在处理中，判决后公开。')).toBeInTheDocument();
    expect(screen.getByText('分数变化：判决后公开')).toBeInTheDocument();
    expect(screen.getByText(/裁判 裁判/)).toBeInTheDocument();
    expect(screen.getByText(/等待 选手 说明情况/)).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/\b0\b/);
    expect(screen.queryByText('立案经过')).not.toBeInTheDocument();
    expect(screen.queryByText('AI 归类')).not.toBeInTheDocument();
    expect(screen.queryByText(/放鸽子/)).not.toBeInTheDocument();
    expect(screen.queryByText(/团灭级/)).not.toBeInTheDocument();
    expect(card.querySelector('.vc__delta')).toBeNull();
    expect(card.querySelector('.scale')).toBeNull();
  });

  it('still says a statement was written (statement_at stays), never “in absence”', () => {
    render(<VerdictCard record={pendingHidden({ statement_at: '2026-10-26 10:00:00' })} />);
    expect(screen.getByText(/选手 写了说明 · 只有当事人、立案人、裁判和管理员能看/)).toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
  });

  it('says nothing about a statement when none was written yet', () => {
    render(<VerdictCard record={pendingHidden()} />);
    expect(screen.queryByText(/写了说明/)).not.toBeInTheDocument();
    expect(screen.queryByText(/按缺席裁决/)).not.toBeInTheDocument();
  });

  it('while the AI judges, says so', () => {
    render(<VerdictCard record={pendingHidden({ status: 'judging', deadline_at: null, statement_at: '2026-10-26 10:00:00' })} />);
    expect(screen.getByText(/AI 正在裁决/)).toBeInTheDocument();
    expect(screen.getByText('分数变化：判决后公开')).toBeInTheDocument();
    expect(screen.getByText(/选手 写了说明/)).toBeInTheDocument();
  });
});

describe('RecordsFeed, a case the API hid before its verdict', () => {
  it('is only a name and 处理中: no type, no summary, no status chip, no escalation chip', () => {
    const { container } = render(
      <RecordsFeed records={[pendingHidden({ claim_summary: 'LEAKEDSUMMARY', escalation_suggested: true })]} />,
    );
    const row = container.querySelector('.feed-row')!;
    expect(within(row as HTMLElement).getByText('选手')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('处理中')).toBeInTheDocument();
    expect(row.querySelector('.feed-row__status')).toBeNull();
    expect(row.textContent).not.toContain('待说明');
    expect(row.textContent).not.toContain('待确认升级');
    expect(row.textContent).not.toContain('放鸽子');
    expect(row.textContent).not.toContain('LEAKEDSUMMARY');
    expect(row.querySelector('.feed-row__delta')?.textContent).toBe('?');
  });

  it('leaves every other row as it was', () => {
    render(<RecordsFeed records={[record({ status: 'awaiting_statement', delta: 0, verdict: null })]} />);
    expect(screen.getByText('放鸽子')).toBeInTheDocument();
    expect(screen.getByText('待说明')).toBeInTheDocument();
  });
});
```

（截止时间用 3.5 小时而不是整 3 小时：`formatRemaining` 向下取整，造数据和渲染落在同一毫秒时整 3 小时会显示「还剩 3 小时 0 分」，`/\b0\b/` 断言偶发失败——P1-1 审查时 7 次全量 dom 碰到 2 次。3.5 小时显示「3 小时 29 分」或「3 小时 30 分」，都没有单独的 0。）

（`LEAKEDSUMMARY`、`escalation_suggested: true` 是故意塞进来的：后端已经置空，前端也不能把它们画出来——spec §10「不靠前端不渲染」说的是后端必须脱敏，前端守卫是第二道。）

- [ ] **Step 2：跑 dom 测试，确认失败**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/verdict-privacy.test.tsx
```

期望：**4 failed | 9 passed (13)**。失败的是 `only says a case is in progress …`、`still says a statement was written …`、`while the AI judges, says so`、`is only a name and 处理中 …`；通过的是原有 7 个，加上现在就成立的两个守卫型用例 `says nothing about a statement …` 和 `leaves every other row as it was`。

- [ ] **Step 3：逐段修改 `src/components/VerdictCard.tsx`（结果 = 下面的完整文件）**

非脱敏卡片的 DOM 与今天逐字节一致（`StatementWritten`、`TrialProgress` 只是把原来内联的两段 JSX 抽成函数，输出相同）；脱敏形态走 `PendingHiddenCard`，保留 `id="case-N"`、`tabIndex={-1}`、`vc vc--{status}`、`vc--focus`。

先核对上游这个文件和规划副本一致（Task 2 已提交，所以用 `git diff` 看工作区是空的，要和分支基点比）：

```bash
git show claude/p1-0-hosting:src/components/VerdictCard.tsx | shasum -a 256
# 规划副本：cc5eb4b9b8cb33a732201255642824d849d40e2c6a2c2cc10bda1cd6c45d96c7（178 行）
git diff claude/p1-0-hosting -- src/components/VerdictCard.tsx   # 期望：只有 Task 2 Step 7 的三处
```

哈希一致 → 下面 6 处改完，文件与后面的完整文件一致（至多差 `PRIVATE_TO` 后的一个空行；也可以直接整文件覆盖）。哈希不一致（P0 执行者有细微差异）→ **不要整文件覆盖**，只按锚点做这 6 处，保留差异。

**① import**：Task 2 加的

```ts
import { violationDef } from '../lib/recordView';
```

换成

```ts
import {
  PENDING_HIDDEN_DELTA,
  PENDING_HIDDEN_LABEL,
  isPendingHidden,
  pendingHiddenSentence,
  violationDef,
} from '../lib/recordView';
```

**② 在 `const PRIVATE_TO = '只有当事人、立案人、裁判和管理员能看';` 这一行下面**插入（从 `FALLBACK_EMOJI` 到 `PendingHiddenCard` 结束，原样照抄完整文件里这一段，即 `const PRIVATE_TO` 之后、`/**\n * A case, told as a story` 之前的全部内容）：`FALLBACK_EMOJI` 常量、`StatementWritten`、`TrialProgress`、`PendingHiddenCardProps`、`PendingHiddenCard`。

**③ `VerdictCard` 函数体第一行**：

```ts
  const def = violationDef(record.type);
```

换成

```ts
  if (isPendingHidden(record)) return <PendingHiddenCard record={record} actions={actions} focused={focused} />;
  const def = violationDef(record.type);
```

**④ emoji**：`{def?.emoji ?? '📝'}` → `{def?.emoji ?? FALLBACK_EMOJI}`。

**⑤「写了说明」**：

```tsx
      ) : hidden && trial && record.statement_at ? (
        <p className="vc__hidden">
          <span aria-hidden="true">🔒</span> {record.subject.username} 写了说明 · {PRIVATE_TO}
        </p>
      ) : (
```

换成

```tsx
      ) : hidden && trial && record.statement_at ? (
        <StatementWritten username={record.subject.username} />
      ) : (
```

**⑥ 等待说明 / AI 正在裁决**：

```tsx
      {pending && record.deadline_at && (
        <p className={`vc__pending${isUrgent(record.deadline_at) ? ' vc__pending--urgent' : ''}`}>
          <span aria-hidden="true">⏳</span> 等待 {record.subject.username} 说明情况 ·{' '}
          {formatRemaining(record.deadline_at)}
        </p>
      )}

      {judging && <p className="vc__pending">⚖️ AI 正在裁决…</p>}
```

换成

```tsx
      <TrialProgress record={record} />
```

（`pending`、`judging` 两个局部变量仍被 delta 和团灭提示用到，不删。）

改完后的完整文件（规划副本上逐段改出来的结果；与整文件覆盖相比至多差一个空行）：

```tsx
import type { RecordItem, VerdictSource } from '../types';
import {
  PENDING_HIDDEN_DELTA,
  PENDING_HIDDEN_LABEL,
  isPendingHidden,
  pendingHiddenSentence,
  violationDef,
} from '../lib/recordView';
import { formatRemaining, isUrgent, relativeTime } from '../lib/time';
import { SentencingScale } from './SentencingScale';
import './verdict-card.css';

interface VerdictCardProps {
  record: RecordItem;
  /** Rendered under the verdict — statement / appeal / revoke buttons. */
  actions?: React.ReactNode;
  /** Shown only to the filing judge / an admin while the hint is live. */
  escalation?: React.ReactNode;
  /** The case a link pointed at: marked, and focusable. */
  focused?: boolean;
}

const SOURCE_BADGE: Record<VerdictSource, { label: string; tone: string }> = {
  ai: { label: 'AI 裁决', tone: 'ai' },
  fallback: { label: '基准分（AI 未参与）', tone: 'fallback' },
  manual: { label: '直接记录', tone: 'manual' },
  admin_override: { label: '管理员改判', tone: 'override' },
};

/** 'AI 裁决' / '管理员改判' …, for places that name a verdict's source outside the card. */
export function verdictSourceLabel(source: VerdictSource): string {
  return SOURCE_BADGE[source].label;
}

const PRIVATE_TO = '只有当事人、立案人、裁判和管理员能看';
/** The emoji of a case whose type the API hid, or this bundle does not know. */
const FALLBACK_EMOJI = '📝';

/** 「X 写了说明 · 只有…能看」: the statement exists, its words are not for this viewer. */
function StatementWritten({ username }: { username: string }): JSX.Element {
  return (
    <p className="vc__hidden">
      <span aria-hidden="true">🔒</span> {username} 写了说明 · {PRIVATE_TO}
    </p>
  );
}

/** Before the verdict: who is being waited on, or that the AI is judging. */
function TrialProgress({ record }: { record: RecordItem }): JSX.Element | null {
  if (record.status === 'judging') return <p className="vc__pending">⚖️ AI 正在裁决…</p>;
  if (record.status !== 'awaiting_statement' || !record.deadline_at) return null;
  return (
    <p className={`vc__pending${isUrgent(record.deadline_at) ? ' vc__pending--urgent' : ''}`}>
      <span aria-hidden="true">⏳</span> 等待 {record.subject.username} 说明情况 ·{' '}
      {formatRemaining(record.deadline_at)}
    </p>
  );
}

type PendingHiddenCardProps = Pick<VerdictCardProps, 'record' | 'actions' | 'focused'>;

/**
 * B1-1 (spec §11 #3 tier b): a case the API hid before its verdict. Only that it
 * exists, who filed it and when; no type, claim, range or escalation — and never
 * a 0 where the delta would be. A written statement is still said to exist.
 */
function PendingHiddenCard({ record, actions, focused = false }: PendingHiddenCardProps): JSX.Element {
  return (
    <article id={`case-${record.id}`} tabIndex={-1} className={`vc vc--${record.status}${focused ? ' vc--focus' : ''}`}>
      <header className="vc__head">
        <span className="vc__emoji" aria-hidden="true">
          {FALLBACK_EMOJI}
        </span>
        <div className="vc__head-text">
          <h4 className="vc__type">{PENDING_HIDDEN_LABEL}</h4>
          <p className="vc__meta">
            裁判 {record.reporter.username}
            <span aria-hidden="true"> · </span>
            <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
          </p>
        </div>
      </header>
      <p className="vc__hidden">{pendingHiddenSentence(record.subject.username)}</p>
      <p className="vc__delta-hidden">{PENDING_HIDDEN_DELTA}</p>
      {record.statement_at && <StatementWritten username={record.subject.username} />}
      <TrialProgress record={record} />
      {actions && <div className="vc__actions">{actions}</div>}
    </article>
  );
}

/**
 * A case, told as a story: 案由 → 双方陈述 → 判词 → 量刑尺.
 *
 * The verdict text is the product, not a status line — this is the difference
 * between v1's bare "-15" and v2's "-11，因为你提前告知了，虽然晚了点".
 */
export function VerdictCard({
  record,
  actions,
  escalation,
  focused = false,
}: VerdictCardProps): JSX.Element {
  if (isPendingHidden(record)) return <PendingHiddenCard record={record} actions={actions} focused={focused} />;
  const def = violationDef(record.type);
  const { verdict, status } = record;
  const pending = status === 'awaiting_statement';
  const judging = status === 'judging';
  const voided = status === 'revoked' || status === 'withdrawn';
  const badge = verdict ? SOURCE_BADGE[verdict.source] : null;
  const hidden = record.redacted === true;
  // Only a trial's verdict has words to hide; a bonus's is just its label.
  const wordsHidden = hidden && verdict !== null && verdict.source !== 'manual';
  const trial = def?.kind === 'penalty';

  return (
    <article id={`case-${record.id}`} tabIndex={-1} className={`vc vc--${status}${focused ? ' vc--focus' : ''}`}>
      <header className="vc__head">
        <span className="vc__emoji" aria-hidden="true">
          {def?.emoji ?? FALLBACK_EMOJI}
        </span>
        <div className="vc__head-text">
          <h4 className="vc__type">
            {record.claim_summary ?? def?.label ?? record.type}
          </h4>
          <p className="vc__meta">
            <span className="vc__charge">{def?.label ?? record.type}</span>
            {record.classified_by === 'ai' && (
              <span className="vc__by" title="案由由 AI 从事实描述归类">AI 归类</span>
            )}
            {record.classified_by === 'derived' && (
              <span className="vc__by" title="案由由点名结果确定性推导">点名推导</span>
            )}
            <span aria-hidden="true"> · </span>
            裁判 {record.reporter.username}
            <span aria-hidden="true"> · </span>
            <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
          </p>
        </div>
        {!pending && !judging && (
          <span
            className={`vc__delta tabular ${
              record.delta > 0 ? 'vc__delta--up' : 'vc__delta--down'
            }${voided ? ' vc__delta--void' : ''}`}
          >
            {record.delta > 0 ? `+${record.delta}` : record.delta}
          </span>
        )}
      </header>

      {record.claim && (
        <blockquote className="vc__quote vc__quote--claim">
          <span className="vc__quote-who">立案经过</span>
          <p>{record.claim}</p>
        </blockquote>
      )}

      {record.statement ? (
        <blockquote className="vc__quote vc__quote--statement">
          <span className="vc__quote-who">{record.subject.username} 的说明</span>
          <p>{record.statement}</p>
        </blockquote>
      ) : hidden && trial && record.statement_at ? (
        <StatementWritten username={record.subject.username} />
      ) : (
        // A withdrawn case was never judged at all (M17): no "absent" either.
        !pending && status !== 'withdrawn' && trial && (
          <p className="vc__absent">该选手没有在期限内说明情况，按缺席裁决。</p>
        )
      )}

      <TrialProgress record={record} />

      {verdict && (
        <div className="vc__verdict">
          <div className="vc__verdict-head">
            {wordsHidden ? (
              <p className="vc__hidden">
                <span aria-hidden="true">🔒</span> 判词{PRIVATE_TO}
              </p>
            ) : (
              <h5 className="vc__headline">{verdict.headline}</h5>
            )}
            {badge && <span className={`vc__source vc__source--${badge.tone}`}>{badge.label}</span>}
          </div>
          {!wordsHidden && verdict.reasoning && <p className="vc__reason">{verdict.reasoning}</p>}
          {!wordsHidden && verdict.factors.length > 0 && (
            <ul className="vc__factors">
              {verdict.factors.map((f, i) => (
                <li
                  key={`${f.kind}-${i}`}
                  className={`vc__factor vc__factor--${f.kind}`}
                >
                  {f.kind === 'mitigating' ? '从轻' : '从重'}：{f.text}
                </li>
              ))}
            </ul>
          )}
          {!voided && record.range && <SentencingScale range={record.range} delta={record.delta} />}
        </div>
      )}

      {status === 'appealed' && (
        <>
          {!hidden && record.appeal_reason && (
            <blockquote className="vc__quote vc__quote--appeal">
              <span className="vc__quote-who">申诉理由</span>
              <p>{record.appeal_reason}</p>
            </blockquote>
          )}
          <p className="vc__flag vc__flag--appealed">
            该选手已申诉，等待管理员复核（分数暂不变动）。
          </p>
        </>
      )}
      {status === 'revoked' && <p className="vc__flag">这笔记录已被撤销，分数已还原。</p>}
      {status === 'withdrawn' && <p className="vc__flag">裁判已撤案，未产生任何扣分。</p>}

      {record.escalation_suggested && pending && (
        <div className="vc__escalate">
          <p className="vc__escalate-text">
            AI 认为这够得上「团灭级放鸽」。系统先按较轻的案由立案了 —— 要升级得由人确认。
          </p>
          {escalation && <div className="vc__escalate-actions">{escalation}</div>}
        </div>
      )}

      {actions && <div className="vc__actions">{actions}</div>}
    </article>
  );
}
```

文件约 231 行；新增的只有 `FALLBACK_EMOJI`、`StatementWritten`、`TrialProgress`、`PendingHiddenCard` 四个定义和 `VerdictCard` 第一行的早返回。`VerdictCard` 函数本身比今天短（原来就超过 50 行，本 PR 不再加长它；拆分留给后续 PR）；新增函数都在 30 行以内。

- [ ] **Step 4：`src/components/verdict-card.css` 末尾追加**

```css

/* --- B1-1: 判决前对无关的人只说「有一起记录在处理中」 ----------------------- */

/* Where the delta would be: never a 0 before the verdict. */
.vc__delta-hidden {
  font-size: var(--text-sm);
  color: var(--muted);
}
```

（不写断点、不写 hover、不写 `outline`，`css-conventions.test.ts` 无需关心；不往 `theme.css` 加 token。`.vc__hidden` 沿用已有样式。）

- [ ] **Step 5：RecordsFeed 脱敏行**

`src/components/RecordsFeed.tsx` 的 import（Task 2 之后的样子）：

```ts
import { violationDef, violationLabel } from '../lib/recordView';
```

→

```ts
import { isPendingHidden, violationDef, violationLabel } from '../lib/recordView';
```

`RecordLine` 开头：

```ts
  const label = violationLabel(record.type);
  const statusLabel = CASE_STATUS_LABEL[record.status];
```

→

```ts
  // B1-1: a case the API hid before its verdict is only a name and 「处理中」 — no status chip, no escalation chip.
  const hidden = isPendingHidden(record);
  const label = violationLabel(record.type);
  const statusLabel = hidden ? '' : CASE_STATUS_LABEL[record.status];
```

同一函数里：

```tsx
      {record.escalation_suggested && record.status === 'awaiting_statement' && (
```

→

```tsx
      {!hidden && record.escalation_suggested && record.status === 'awaiting_statement' && (
```

`RecordMeta` 里：

```tsx
      ) : (
        record.claim_summary && (
          <span className="feed-row__note">“{record.claim_summary}”</span>
        )
      )}
```

→

```tsx
      ) : (
        !isPendingHidden(record) &&
        record.claim_summary && (
          <span className="feed-row__note">“{record.claim_summary}”</span>
        )
      )}
```

`RecordDelta` 不改：判决前的行今天就显示「?」（不是 0，也不是区间），脱敏行同样是「?」。`.feed-row__status--escalate` 类名不变（P0-4 锁定）。

- [ ] **Step 6：跑 dom 测试，确认通过；回归**

```bash
npx vitest run --config vitest.dom.config.ts tests/dom/verdict-privacy.test.tsx tests/dom/wording.test.tsx
npm run typecheck
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:unit 2>&1 | tail -4
```

期望：`verdict-privacy` **13 passed (13)**、`wording` 原样全过（`:66-71` 的「待说明」不受影响；两个文件合计 19 passed）；typecheck 通过；dom **D0 文件、D0 用例 + 6**（预期 20 / 225）全过，`act(...)` 警告仍只有那 3 条；unit 不变（U0 + 1 文件、U0 + 15 用例）。

- [ ] **Step 7：提交**

```bash
git add src/components/VerdictCard.tsx src/components/verdict-card.css src/components/RecordsFeed.tsx tests/dom/verdict-privacy.test.tsx
git commit -m "feat: VerdictCard 和动态流渲染判决前脱敏的案件"
```

---

## 收尾

- [ ] **完整验证**

```bash
export PATH=$HOME/.nvm/versions/node/v24.22.0/bin:$PATH
npm run typecheck
npm run test:unit 2>&1 | tail -4
npm run test:dom 2>&1 | grep -E "Test Files|Tests |not wrapped in act" | sort | uniq -c
npm run test:worker 2>&1 | tail -4
npm run build
npm run build:pages
```

期望（相对 Task 0 记下的 U0 / D0 / W0）：

| 套件 | 文件 | 用例 | 新增来源 |
|---|---|---|---|
| unit | U0 + 1（= 27） | U0 + 15（预期 345） | `record-view.test.ts` 7、`record-privacy.test.ts` 8 |
| dom | D0（= 20） | D0 + 6（预期 225） | `verdict-privacy.test.tsx` 6 |
| worker | W0（= 15） | W0 + 9（预期 560 + 9 todo） | `record-privacy.test.ts` 9（10 → 19） |

规划时在 P0 全量副本的拷贝上单独实测（没有 P1-0）：unit 26/326 → 27/341，dom 20/219 → 20/225（`act` 警告 3 条不变），worker 15/548 → 15/557（+ 9 todo 不变）。跨 PR 合成（P1-0 → B1-1 → … → P1-4 依次套在同一个副本上，见 `README.md`「一致性检查记录」）里 B1-1 之后正是上表的 27/345、20/225、15/560 + 9 todo，typecheck、`npm run build`、`npm run build:pages` 都通过。

- [ ] **范围核对**

```bash
git diff --stat claude/p1-0-hosting -- server/ shared/ src/App.tsx src/components/PlayerDetail.tsx docs/   # 期望：无输出
git diff --stat claude/p1-0-hosting                                                                       # 期望：只有「文件结构」表里的 15 个文件（4 个后端/类型 + 7 个前端源码/CSS + 4 个测试）
grep -rn "redactRecord\|RecordView" server/src                                                           # 期望：无输出（bot 不经过脱敏）
git log --format=%B claude/p1-0-hosting..HEAD | grep -ciE "co-authored|generated with"                    # 期望：0
grep -rn "console.log" src/lib/recordView.ts src/components/VerdictCard.tsx src/components/RecordsFeed.tsx worker/case-reads.ts   # 期望：无输出
```

- [ ] **PG 套件**：本地不跑 `npm run test:pg`。`vitest.pg.config.ts` 的 `include` 有 `tests/worker/**/*.test.ts`，所以本 PR 新增的 9 个路由级用例会在 CI 上原样跑一遍 PostgreSQL（SQL 只用了 `datetime('now'[, '+1 day'])` 和普通 INSERT，都是现有 worker 测试用过、PG 适配层支持的写法）。`tests/pg/*` 里直接调 `fileCase`/`getRecordItemById` 的用例拿的是未脱敏的 `RecordItem`，不受影响。合并前看 CI 的 `test:pg`、`test:server`。

- [ ] **bot 不受影响的依据**（写进 PR 描述）：`server/src/discord/verdict.ts` 只 import `canReadPrivate`、`getRecordItemById`，判决卡由 `isPostable` 门控、只在判决后发；私信只发给当事人和裁判；`server/src/share/*` 不读记录。本 PR 不改 `canReadPrivate`。

- [ ] **手工检查（可选，领队做）**：在预览环境找一起「待说明」的案件，用未登录的无痕窗口打开大厅：动态流这一行是「名字 · 处理中 · ?」，没有「待说明」chip、没有立案摘要；`/?case=N` 落到选手页后这一起显示「处理中」「X有一起记录在处理中，判决后公开。」「分数变化：判决后公开」，没有任何 0、没有量刑尺；用当事人账号再看，一切照旧。（P1-1 合并之后，`/?case=N` 落地页的置顶 eyebrow 才是「案件 #N · 处理中」。）

- [ ] **给机主的 PR 描述要点**：档位 b 的依据（spec §11 第 3 条）；`note`、`range` 也一起隐藏（契约 §8 第 4 条）；下面「对契约的补充」第 1–5 条；CONTRACT.md 的措辞由 P1-4 补（契约 §4.10 末尾）。

## 对契约的补充

1. **`src/lib/recordView.ts` 多导出一个 `violationDef(type: ViolationType | null): ViolationDef | undefined`。** 契约 §4.10 只列了 `violationLabel`，但 VerdictCard 要 `emoji` 和 `kind`（判断是不是 penalty），RecordsFeed 要 `emoji`；`VIOLATION_MAP` 的类型是 `Record<string, ViolationDef>`，直接 `VIOLATION_MAP[null]` 是 TS2538。`violationLabel` 内部也用它。名字不和任何现有导出冲突（`shared/scoring.ts` 里叫 `VIOLATION_MAP`、`ViolationDef`，worker 里有个 `defFor`，不在前端）。
2. **VerdictCard 的脱敏形态是一个内部组件 `PendingHiddenCard` 的早返回，而不是在原来的大函数里加条件。** 契约写的是「把 `hidden && trial && statement_at` 改成 `hidden && (trial || pending_hidden) && statement_at`」；本计划的输出与之等价（脱敏形态 `statement_at` 有值就显示「写了说明 · 只有当事人、立案人、裁判和管理员能看」），但把「写了说明」和「等待 X 说明情况 / AI 正在裁决」两段抽成 `StatementWritten`、`TrialProgress` 两个内部组件供两种形态共用。理由：原来的 `VerdictCard` 已超过 50 行，往里再塞四五个 `pending_hidden` 分支会更长、更难读；早返回让「判决前对外人什么都不画」一目了然。非脱敏卡片 DOM 不变（verdict-privacy 原有 7 个、整个 dom 套件原样通过）。契约要求的 `id="case-N"`、`tabIndex`、`vc vc--{status}`、`vc--focus`、emoji `📝`、`h4.vc__type`「处理中」、meta 只留「裁判 X · 时间」、`.vc__hidden` 句子、`.vc__delta-hidden`、不渲染立案经过/量刑尺/团灭提示、不出现 0，全部照做；`actions` 照常渲染（无关的人本来就没有按钮），`escalation` 不渲染。
3. **RecordsFeed 脱敏行的分数列保留今天未判决行的「?」，meta 行保留「裁判 X · 时间」。** 契约只说「这一行只剩名字和『处理中』，不显示 claim_summary、状态 chip、待确认升级 chip」。「?」不是 0 也不是区间，不泄露任何东西，和非脱敏的未判决行一致、列宽不跳；「裁判 X · 时间」与 VerdictCard 脱敏形态保留的 meta 一致。`claim_summary` 和「待确认升级」在前端也守卫一次（后端已置空/置 false，这是第二道）。
4. **`worker/types.ts` 新增的名字**：`OpenRecordView`（带 `pending_hidden?: never`，保证非脱敏输出类型上就不可能带这个键）、`PendingHiddenRecordView`、`PendingHiddenField`；`worker/case-reads.ts` 新导出 `isPreVerdict(status)`，内部函数 `blankVerdictWords`。契约只写了「`RecordView` 改为两种形态的联合」，没给名字。`worker/types.ts` 的 `RecordItem`（数据库读出的完整记录）不改为可空。
5. **`src/components/records-feed.css` 不改**（契约允许追加，但脱敏行不需要新样式）；`verdict-card.css` 只追加 `.vc__delta-hidden` 一条。
6. **超出本 PR 范围、请机主知悉的观察**：`GET /api/sessions/:id` 的 `session.players[]` 对所有人公开 `attendance`（取值含 `'no_show'`、`'late'`）、`late_minutes`、`record_id`。点名推导（`classified_by: 'derived'`）的案件，访客从点名结果仍能猜出类型。这是约局点名数据，不经过 `redactRecord`，spec 没有要求隐藏，本 PR 不动；若机主认为也该在判决前隐藏，另开后端条目。
7. **跨 PR 风险（Task 0 已写）**：`tests/unit/source-hygiene.test.ts` 的 `SOURCE_DIRS` 原来含 `'functions'`；`plan-P1-0.md` 已把它去掉。万一 P1-0 没改到，unit 会因 ENOENT 失败。属于 P1-0，B1-1 只停下报告。
8. **`docs/CONTRACT.md` 的 `interface RecordItem`（约 140–172 行）**也写着 `type: ViolationType`、`range` 非空、`note` 公开。B1-1 不改文档（契约 §4.10），`plan-P1-4.md` 已把这一段和「Frontend expectations」一起改（`type`/`range` 可空、`pending_hidden?: true`），并 grep 本 PR 的 `pending_hidden` 和 `recordView.ts` 里的两句文案——本 PR 的写法都能命中。

## 自查

| spec / 契约条目 | 落在哪 |
|---|---|
| §8 B1-1：条件 = `canReadPrivate` 为假且状态 `awaiting_statement`/`judging` | Task 1 Step 6（`isPreVerdict`），Step 1/3 的 2×2 用例 |
| §8 B1-1 / §11 #3 (b)：`claim`、`claim_summary` 置空，`type` 置 null，`escalation_suggested` false，`pending_hidden: true` | Task 1 Step 6；Step 1 `toEqual` 逐键断言；Step 3 四条路由逐条断言 |
| 契约 §4.10 / §8 #4：`note`、`range` 也隐藏 | Task 1 Step 6；Step 1、Step 3 断言 `note: null`、`range: null` |
| 保留 `statement_at`（spec §8、§10 隐私行） | Task 1 Step 1 `keeps statement_at …`、Step 3 `statement_at` 非 null；Task 3 `still says a statement was written …` |
| 保留 `id`、`subject`、`reporter`、`delta`、`classified_by`、`session_id`、`deadline_at`、`status`、`verdict`、`created_at` | Task 1 Step 1 `toEqual({...pendingCase, …})`；Step 3 `toMatchObject` |
| 非脱敏输出不出现 `pending_hidden` 键；输入不被修改 | Task 1 Step 1 后三个用例；`OpenRecordView.pending_hidden?: never` |
| 现有 record-privacy 用例原样通过（spec §9 B1-1 验收） | Task 1 Step 2/4/7（原有 unit 5 个、worker 10 个不改） |
| 判决后（decided/appealed/revoked/withdrawn）不受影响 | Task 1 Step 1 `stops once there is a verdict …`；Step 3 `is decided case by case in one list …` |
| 两个引擎都检查（D1 worker 测试 + PG 套件） | Task 1 Step 3（`tests/worker/**` 被 `vitest.pg.config.ts` 包含）；收尾「PG 套件」 |
| bot 不受影响 | Task 0 Step 2 grep；收尾「范围核对」「bot 不受影响的依据」；不改 `server/**` |
| `RecordView` 的 `type` 在脱敏形态下可空；所有返回 `redactRecord` 的路由照常 typecheck | Task 1 Step 5、Step 7 |
| 前端类型 `type`/`range` 可空、`pending_hidden?` | Task 2 Step 3 |
| `src/lib/recordView.ts`（纯）：`PENDING_HIDDEN_LABEL`、`PENDING_HIDDEN_DELTA`、`isPendingHidden`、`pendingHiddenSentence`、`violationLabel` | Task 2 Step 4；Step 1 `record-view.test.ts` |
| VerdictCard：「处理中」、「X有一起记录在处理中，判决后公开。」、「分数变化：判决后公开」、写了说明、不出现 0、无立案经过/量刑尺/团灭提示、保留 id/focus | Task 3 Step 3；Step 1 四个用例 |
| verdict-privacy 新增「type 为 null 时渲染『有一起记录在处理中』」（spec §9 B1-1 验收） | Task 3 Step 1 |
| RecordsFeed：这一行只剩名字和「处理中」，无状态 chip、无「待确认升级」、无 claim_summary；其他行不变 | Task 3 Step 5；Step 1 两个用例；`wording.test.tsx` 回归 |
| CaseActions：`range === null` 不渲染改判表单 | Task 2 Step 9 |
| StatementDialog / AppealSheet / PendingBanner 只做类型守卫，文案不变 | Task 2 Step 10；dom 全量回归（`drafts`、`appeal-sheet`、`wording:91-98`） |
| WeekHighlights / weekStars / feedStats 不改，加断言锁住 | Task 2 Step 1 `the week’s numbers ignore a hidden case` |
| PlayerDetail eyebrow「案件 #N · 处理中」 | 契约 §3 指定 P1-1 做；本 PR 提供 `violationLabel(null) === '处理中'`（Task 2 Step 4） |
| 不改 CONTRACT.md（P1-4 补 `pending_hidden` 那句） | 收尾「范围核对」`docs/` 无改动 |
| 新 CSS 过 css-conventions；不加 theme token | Task 3 Step 4；unit 全量 |
| 机主规则：不可变（`redactRecord` 返回新对象）、文件 < 800 行、新函数 < 50 行、无 console.log、无魔法数（文案常量在 `recordView.ts`，`FALLBACK_EMOJI` 常量）、提交 `<type>: <中文>` 无署名 | 各 Task；收尾「范围核对」 |
| 分支：从 `claude/p1-0-hosting` 开 `claude/b1-1-redact`，不 rebase/push/PR | Task 0 Step 1 |
