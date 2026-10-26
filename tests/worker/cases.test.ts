import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIOLATION_MAP, WEEKLY_BONUS_CAP } from '../../shared/scoring';
import {
  appealCase,
  fileCase,
  getRecordItemById,
  judgeAndDecide,
  listRecords,
  overrideCase,
  pendingCounts,
  revokeCase,
  submitStatement,
  sweepDueCases,
  withdrawCase,
} from '../../worker/cases';
import { ApiError } from '../../worker/errors';
import { MAX_CASES_PER_SUBJECT_24H } from '../../worker/case-limits';
import {
  OFFSET_HOURS,
  expireDeadline,
  noAiEnv,
  scoreEventCount,
  scoreOf,
  seedUser,
  statusOf,
} from './helpers';

const OPTS = { offsetHours: OFFSET_HOURS };

afterEach(() => {
  vi.unstubAllGlobals();
});
const CLAIM = '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。';

async function judgeAndSubject() {
  const judge = await seedUser({ id: 'judge', judge: true });
  const subject = await seedUser({ id: 'subject', score: 100 });
  return { judge, subject };
}

describe('fileCase — penalties open a trial', () => {
  it('opens the case without moving any points', async () => {
    const { judge, subject } = await judgeAndSubject();
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );

    expect(record.status).toBe('awaiting_statement');
    expect(record.delta).toBe(0);
    expect(record.deadline_at).not.toBeNull();
    expect(record.claim).toBe(CLAIM);
    // The whole point of the待审制: filing costs the subject nothing yet.
    expect(await scoreOf(subject.id)).toBe(100);
    expect(await scoreEventCount(subject.id)).toBe(0);
  });

  it('exposes the sentencing range so the UI can draw the scale', async () => {
    const { judge, subject } = await judgeAndSubject();
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    expect(record.range).toEqual({
      min: VIOLATION_MAP.no_show.min,
      max: VIOLATION_MAP.no_show.max,
      base: VIOLATION_MAP.no_show.base,
    });
  });

  it('demands a real account of the facts', async () => {
    const { judge, subject } = await judgeAndSubject();
    await expect(
      fileCase(
        env.DB,
        judge,
        { subject_id: subject.id, type: 'no_show', claim: '鸽了' },
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(ApiError);
  });

  it('rejects non-judges, self-reports and non-participants', async () => {
    const { judge, subject } = await judgeAndSubject();
    const bystander = await seedUser({ id: 'bystander' });
    const guest = await seedUser({ id: 'guest', participant: false });

    await expect(
      fileCase(
        env.DB,
        bystander,
        { subject_id: subject.id, type: 'no_show', claim: CLAIM },
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/裁判/);

    await expect(
      fileCase(
        env.DB,
        judge,
        { subject_id: judge.id, type: 'no_show', claim: CLAIM },
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/自己/);

    await expect(
      fileCase(
        env.DB,
        judge,
        { subject_id: guest.id, type: 'no_show', claim: CLAIM },
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/上榜/);
  });

  it('rejects an unknown violation type', async () => {
    const { judge, subject } = await judgeAndSubject();
    await expect(
      fileCase(
        env.DB,
        judge,
        { subject_id: subject.id, type: 'delete_everything', claim: CLAIM },
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/类型/);
  });
});

describe('fileCase — bonuses settle immediately', () => {
  it('applies the base bonus with no statement window', async () => {
    const { judge, subject } = await judgeAndSubject();
    await seedUser({ id: 'x' });
    await env.DB.prepare('UPDATE users SET score = 90 WHERE id = ?').bind(subject.id).run();

    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'on_time_bonus' },
      OPTS,
      noAiEnv(),
    );
    expect(record.status).toBe('decided');
    expect(record.delta).toBe(VIOLATION_MAP.on_time_bonus.base);
    expect(await scoreOf(subject.id)).toBe(90 + VIOLATION_MAP.on_time_bonus.base);
  });

  it('enforces the weekly bonus cap', async () => {
    const { judge, subject } = await judgeAndSubject();
    await env.DB.prepare('UPDATE users SET score = 50 WHERE id = ?').bind(subject.id).run();

    const per = VIOLATION_MAP.on_time_bonus.base;
    const allowed = Math.floor(WEEKLY_BONUS_CAP / per);
    for (let i = 0; i < allowed; i += 1) {
      await fileCase(
        env.DB,
        judge,
        { subject_id: subject.id, type: 'on_time_bonus' },
        OPTS,
        noAiEnv(),
      );
    }
    await expect(
      fileCase(env.DB, judge, { subject_id: subject.id, type: 'on_time_bonus' }, OPTS, noAiEnv()),
    ).rejects.toThrow(/上限/);
  });

  it('records the clamped delta when the score is already at 100', async () => {
    const { judge, subject } = await judgeAndSubject(); // score 100
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'on_time_bonus' },
      OPTS,
      noAiEnv(),
    );
    // Nothing could be added, so the stored delta must be 0 — otherwise a later
    // revoke would subtract points that were never granted.
    expect(record.delta).toBe(0);
    expect(await scoreOf(subject.id)).toBe(100);
  });
});

describe('submitStatement → verdict', () => {
  it('decides the case and applies the base sentence when AI is off', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );

    const decided = await submitStatement(
      env.DB,
      subject,
      filed.id,
      '公司临时通宵发版，手机落在会议室了。',
      noAiEnv(),
    );

    expect(decided.status).toBe('decided');
    expect(decided.delta).toBe(VIOLATION_MAP.no_show.base);
    expect(decided.verdict?.source).toBe('fallback');
    expect(decided.statement).toContain('通宵发版');
    expect(await scoreOf(subject.id)).toBe(100 + VIOLATION_MAP.no_show.base);
  });

  it('lets only the subject speak, and only once', async () => {
    const { judge, subject } = await judgeAndSubject();
    const other = await seedUser({ id: 'other' });
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'afk', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );

    await expect(
      submitStatement(env.DB, other, filed.id, '我替他说', noAiEnv()),
    ).rejects.toThrow(/自己/);

    await submitStatement(env.DB, subject, filed.id, '第一次说明', noAiEnv());
    await expect(
      submitStatement(env.DB, subject, filed.id, '我改主意了', noAiEnv()),
    ).rejects.toThrow(/陈述阶段/);
  });

  it('writes exactly one audit row and one score event per verdict', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'late_minor', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await submitStatement(env.DB, subject, filed.id, '路上堵车', noAiEnv());

    const verdicts = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM ai_verdicts WHERE record_id = ?',
    )
      .bind(filed.id)
      .first<{ n: number }>();
    expect(verdicts?.n).toBe(1);
    expect(await scoreEventCount(subject.id)).toBe(1);
  });

  it('decides the case even when the model asks for an absurd delta', async () => {
    // A prompt-injected -1e20 must be clamped, not crash the verdict write:
    // PostgreSQL's bigint column cannot hold it, and a failed batch would leave
    // the case in 'judging' forever.
    vi.stubGlobal('fetch', async () =>
      Response.json({
        choices: [{ message: { content: JSON.stringify({ delta: -1e20, headline: '重判', reasoning: '照办' }) } }],
      }),
    );
    const aiEnv = noAiEnv({ AI_ENABLED: 'true', AI_API_KEY: 'sk-test', AI_BASE_URL: 'https://ai.test/v1', AI_MODEL: 'm' });
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'no_show', claim: CLAIM }, OPTS, aiEnv);

    const decided = await submitStatement(env.DB, subject, filed.id, '我服', aiEnv);

    expect(decided.status).toBe('decided');
    expect(decided.verdict?.source).toBe('ai');
    expect(decided.delta).toBe(VIOLATION_MAP.no_show.min);
    const audit = await env.DB.prepare('SELECT parsed_delta, clamped FROM ai_verdicts WHERE record_id = ?')
      .bind(filed.id)
      .first<{ parsed_delta: number | null; clamped: number }>();
    expect(audit).toEqual({ parsed_delta: null, clamped: 1 });
  });
});

describe('sweepDueCases — judgment in absentia', () => {
  it('judges a case whose window lapsed and leaves fresh ones alone', async () => {
    const { judge, subject } = await judgeAndSubject();
    const stale = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const fresh = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'afk', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await expireDeadline(stale.id);

    const result = await sweepDueCases(env.DB, noAiEnv());

    expect(result.judged).toBe(1);
    expect(await statusOf(stale.id)).toBe('decided');
    expect(await statusOf(fresh.id)).toBe('awaiting_statement');
  });

  it('is idempotent — a second sweep does not double-charge', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await expireDeadline(filed.id);

    await sweepDueCases(env.DB, noAiEnv());
    const afterFirst = await scoreOf(subject.id);
    const second = await sweepDueCases(env.DB, noAiEnv());

    expect(second.judged).toBe(0);
    expect(await scoreOf(subject.id)).toBe(afterFirst);
    expect(await scoreEventCount(subject.id)).toBe(1);
  });

  it('honours the per-sweep batch cap', async () => {
    const { judge, subject } = await judgeAndSubject();
    const extra = await seedUser({ id: 'extra' });
    for (const target of [subject, subject, extra, extra]) {
      const r = await fileCase(
        env.DB,
        judge,
        { subject_id: target.id, type: 'afk', claim: CLAIM },
        OPTS,
        noAiEnv(),
      );
      await expireDeadline(r.id);
    }
    const result = await sweepDueCases(env.DB, noAiEnv(), 2);
    expect(result.judged).toBe(2);
  });

  it('recovers a case abandoned mid-judging', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    // Simulate a request that claimed the case and then died.
    await env.DB.prepare(
      "UPDATE records SET status = 'judging', judging_started_at = datetime('now', '-30 minutes') WHERE id = ?",
    )
      .bind(filed.id)
      .run();

    const result = await sweepDueCases(env.DB, noAiEnv());
    expect(result.judged).toBe(1);
    expect(await statusOf(filed.id)).toBe('decided');
  });
});

// Regression guards for the score-first + EXISTS-guarded batch writes: a batch
// whose record-UPDATE matches zero rows must not move the score either.
describe('concurrency guards', () => {
  it('a sweep that loses the claim race does not charge the player again', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    // The subject speaks and the case is judged normally.
    await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());
    const afterVerdict = await scoreOf(subject.id);

    // Now replay what a stranded, slow request would do: judge a case that has
    // already left `judging`.
    await judgeAndDecide(env.DB, noAiEnv(), filed.id);

    expect(await scoreOf(subject.id)).toBe(afterVerdict);
    expect(await scoreEventCount(subject.id)).toBe(1);
  });

  it('two revokes of the same case refund only once', async () => {
    const { judge, subject } = await judgeAndSubject();
    const admin = await seedUser({ id: 'admin', admin: true });
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());

    await revokeCase(env.DB, admin, filed.id);
    expect(await scoreOf(subject.id)).toBe(100);
    await expect(revokeCase(env.DB, admin, filed.id)).rejects.toThrow(/已撤销/);
    expect(await scoreOf(subject.id)).toBe(100);
  });
});

describe('post-verdict actions', () => {
  async function decidedCase() {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const decided = await submitStatement(env.DB, subject, filed.id, '临时加班', noAiEnv());
    return { judge, subject, record: decided };
  }

  it('withdraw drops a pre-verdict case without touching the score', async () => {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const out = await withdrawCase(env.DB, judge, filed.id);
    expect(out.status).toBe('withdrawn');
    expect(await scoreOf(subject.id)).toBe(100);
    expect(await scoreEventCount(subject.id)).toBe(0);
  });

  it('withdraw is refused once a verdict exists', async () => {
    const { judge, record } = await decidedCase();
    await expect(withdrawCase(env.DB, judge, record.id)).rejects.toThrow(/撤销/);
  });

  it('appeal freezes the case without refunding points', async () => {
    const { subject, record } = await decidedCase();
    const before = await scoreOf(subject.id);
    const out = await appealCase(env.DB, subject, record.id, '我提前说了');
    expect(out.status).toBe('appealed');
    expect(await scoreOf(subject.id)).toBe(before);
  });

  it('returns the appeal reason — the admin reviewing it needs to read it', async () => {
    const { subject, record } = await decidedCase();
    await appealCase(env.DB, subject, record.id, '我提前两小时在群里说了，有截图');
    const reloaded = await getRecordItemById(env.DB, record.id);
    expect(reloaded?.appeal_reason).toContain('提前两小时');

    // …and it also survives into list queries, not just the single fetch.
    const listed = await listRecords(env.DB, { subject: subject.id });
    expect(listed.find((r) => r.id === record.id)?.appeal_reason).toContain('截图');
  });

  it('stores no appeal reason when none was given', async () => {
    const { subject, record } = await decidedCase();
    const out = await appealCase(env.DB, subject, record.id, '   ');
    expect(out.appeal_reason).toBeNull();
  });

  it('only the subject may appeal', async () => {
    const { judge, record } = await decidedCase();
    await expect(appealCase(env.DB, judge, record.id, 'nope')).rejects.toThrow(/自己/);
  });

  it('revoke restores exactly the delta that was applied', async () => {
    const { judge, subject, record } = await decidedCase();
    const admin = await seedUser({ id: 'admin', admin: true });
    const afterVerdict = await scoreOf(subject.id);
    expect(afterVerdict).toBe(100 + record.delta);

    const out = await revokeCase(env.DB, admin, record.id);
    expect(out.status).toBe('revoked');
    expect(await scoreOf(subject.id)).toBe(100);
    expect(judge.id).toBe('judge');
  });

  // The subtlest arithmetic in the module: when the 0..100 floor swallowed part
  // of a penalty, the record must store what was ACTUALLY taken, so that
  // reversing it restores the original score rather than inventing points.
  it('revoke restores the original score when the penalty hit the 0 floor', async () => {
    const { judge, subject } = await judgeAndSubject();
    const admin = await seedUser({ id: 'admin', admin: true });
    await env.DB.prepare('UPDATE users SET score = 10 WHERE id = ?').bind(subject.id).run();

    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM }, // base -15
      OPTS,
      noAiEnv(),
    );
    const decided = await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());

    expect(await scoreOf(subject.id)).toBe(0);
    expect(decided.delta).toBe(-10); // only 10 points existed to take

    await revokeCase(env.DB, admin, decided.id);
    expect(await scoreOf(subject.id)).toBe(10);
  });

  it('override lands on the exact new delta even after a clamped verdict', async () => {
    const { judge, subject } = await judgeAndSubject();
    const admin = await seedUser({ id: 'admin', admin: true });
    await env.DB.prepare('UPDATE users SET score = 10 WHERE id = ?').bind(subject.id).run();

    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const decided = await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());
    expect(decided.delta).toBe(-10); // clamped by the floor

    const out = await overrideCase(env.DB, admin, decided.id, -9, '从轻');
    expect(out.delta).toBe(-9);
    expect(await scoreOf(subject.id)).toBe(1); // 10 - 9
  });

  it('refuses to revoke twice', async () => {
    const { record } = await decidedCase();
    const admin = await seedUser({ id: 'admin', admin: true });
    await revokeCase(env.DB, admin, record.id);
    await expect(revokeCase(env.DB, admin, record.id)).rejects.toThrow(/已撤销/);
  });

  it('refuses to revoke a case that has not been judged', async () => {
    const { judge, subject } = await judgeAndSubject();
    const admin = await seedUser({ id: 'admin', admin: true });
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await expect(revokeCase(env.DB, admin, filed.id)).rejects.toThrow(/撤案/);
  });
});

describe('admin override', () => {
  async function appealedCase() {
    const { judge, subject } = await judgeAndSubject();
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const decided = await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());
    await appealCase(env.DB, subject, decided.id, '不服');
    const admin = await seedUser({ id: 'admin', admin: true });
    return { admin, subject, record: decided };
  }

  it('re-sentences and moves the score by exactly the difference', async () => {
    const { admin, subject, record } = await appealedCase();
    expect(await scoreOf(subject.id)).toBe(100 + VIOLATION_MAP.no_show.base); // 85

    const out = await overrideCase(env.DB, admin, record.id, -9, '申诉属实');
    expect(out.status).toBe('decided');
    expect(out.delta).toBe(-9);
    expect(out.verdict?.source).toBe('admin_override');
    expect(await scoreOf(subject.id)).toBe(91);
  });

  it('clamps an out-of-range override to the violation range', async () => {
    const { admin, record } = await appealedCase();
    const out = await overrideCase(env.DB, admin, record.id, 999, '手滑');
    expect(out.delta).toBeLessThanOrEqual(VIOLATION_MAP.no_show.max);
    expect(out.delta).toBeGreaterThanOrEqual(VIOLATION_MAP.no_show.min);
  });

  it('requires admin rights and a written reason', async () => {
    const { record } = await appealedCase();
    const nobody = await seedUser({ id: 'nobody' });
    await expect(overrideCase(env.DB, nobody, record.id, -9, '因为')).rejects.toThrow(/管理员/);

    const admin = await seedUser({ id: 'admin2', admin: true });
    await expect(overrideCase(env.DB, admin, record.id, -9, '   ')).rejects.toThrow(/理由/);
  });
});

describe('listRecords and pending counts', () => {
  it('finds the cases a user still owes a statement for', async () => {
    const { judge, subject } = await judgeAndSubject();
    const other = await seedUser({ id: 'other' });
    await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await fileCase(
      env.DB,
      judge,
      { subject_id: other.id, type: 'afk', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );

    const mine = await listRecords(env.DB, { pendingFor: subject.id });
    expect(mine).toHaveLength(1);
    expect(mine[0].subject.id).toBe(subject.id);

    expect((await pendingCounts(env.DB, subject)).statements).toBe(1);
    expect((await pendingCounts(env.DB, judge)).statements).toBe(0);
  });

  it('surfaces the appeal queue to admins only', async () => {
    const { judge, subject } = await judgeAndSubject();
    const admin = await seedUser({ id: 'admin', admin: true });
    const filed = await fileCase(
      env.DB,
      judge,
      { subject_id: subject.id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    const decided = await submitStatement(env.DB, subject, filed.id, '加班', noAiEnv());
    await appealCase(env.DB, subject, decided.id, '不服');

    expect((await pendingCounts(env.DB, admin)).appeals).toBe(1);
    expect((await pendingCounts(env.DB, judge)).appeals).toBe(0);
  });
});

describe('rate limits', () => {
  it('counts withdrawn cases — filing and withdrawing is no way around the limit', async () => {
    const { judge, subject } = await judgeAndSubject();
    for (let i = 0; i < MAX_CASES_PER_SUBJECT_24H; i += 1) {
      const filed = await fileCase(env.DB, judge, { subject_id: subject.id, type: 'afk', claim: CLAIM }, OPTS, noAiEnv());
      await withdrawCase(env.DB, judge, filed.id);
    }
    await expect(
      fileCase(env.DB, judge, { subject_id: subject.id, type: 'afk', claim: CLAIM }, OPTS, noAiEnv()),
    ).rejects.toMatchObject({ status: 429 });
  });
});
