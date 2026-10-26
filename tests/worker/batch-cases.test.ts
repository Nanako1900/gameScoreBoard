import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import {
  MAX_BATCH_SUBJECTS,
  confirmEscalation,
  dismissEscalation,
  fileCase,
  fileCases,
  listRecords,
  reclassifyCase,
  submitStatement,
} from '../../worker/cases';
import { ApiError } from '../../worker/errors';
import { OFFSET_HOURS, noAiEnv, scoreEventCount, scoreOf, seedUser } from './helpers';

const OPTS = { offsetHours: OFFSET_HOURS };
const CLAIM = '说好八点五排，等到八点四十你们都没上线，微信也不回，最后散了。';

async function judgeAnd(n: number) {
  const judge = await seedUser({ id: 'judge', judge: true });
  const players = [];
  for (let i = 0; i < n; i += 1) {
    players.push(await seedUser({ id: `p${i}`, username: `选手${i}` }));
  }
  return { judge, players };
}

describe('fileCases — one narrative, many defendants', () => {
  it('opens one case per person and charges nobody yet', async () => {
    const { judge, players } = await judgeAnd(3);
    const res = await fileCases(
      env.DB,
      judge,
      players.map((p) => ({ subject_id: p.id })),
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );

    expect(res.records).toHaveLength(3);
    expect(res.failed).toHaveLength(0);
    for (const p of players) {
      expect(await scoreOf(p.id)).toBe(100);
      expect(await scoreEventCount(p.id)).toBe(0);
    }
    for (const r of res.records) {
      expect(r.status).toBe('awaiting_statement');
      expect(r.delta).toBe(0);
      expect(r.claim).toContain('说好八点');
    }
  });

  it('appends the per-person addendum to that person only', async () => {
    const { judge, players } = await judgeAnd(2);
    const res = await fileCases(
      env.DB,
      judge,
      [
        { subject_id: players[0].id, extra: '而且你把我拉黑了' },
        { subject_id: players[1].id },
      ],
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );

    const first = res.records.find((r) => r.subject.id === players[0].id);
    const second = res.records.find((r) => r.subject.id === players[1].id);
    expect(first?.claim).toContain('拉黑');
    expect(first?.claim).toContain('补充');
    expect(second?.claim).not.toContain('拉黑');
  });

  it('records one case per person even at the batch limit', async () => {
    const { judge, players } = await judgeAnd(MAX_BATCH_SUBJECTS);
    const res = await fileCases(
      env.DB,
      judge,
      players.map((p) => ({ subject_id: p.id })),
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );
    expect(res.records).toHaveLength(MAX_BATCH_SUBJECTS);
  });

  it('rejects an over-large batch and an empty one', async () => {
    const { judge, players } = await judgeAnd(2);
    await expect(
      fileCases(env.DB, judge, [], CLAIM, undefined, OPTS, noAiEnv()),
    ).rejects.toThrow(/至少选择/);

    const tooMany = Array.from({ length: MAX_BATCH_SUBJECTS + 1 }, (_, i) => ({
      subject_id: `x${i}`,
    }));
    await expect(
      fileCases(env.DB, judge, tooMany, CLAIM, undefined, OPTS, noAiEnv()),
    ).rejects.toThrow(/最多记/);
    expect(players).toHaveLength(2);
  });

  it('rejects the same person twice in one batch', async () => {
    const { judge, players } = await judgeAnd(1);
    await expect(
      fileCases(
        env.DB,
        judge,
        [{ subject_id: players[0].id }, { subject_id: players[0].id }],
        CLAIM,
        undefined,
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/重复/);
  });

  // The designed behaviour: a judge should never lose everything they typed
  // because one name in the list was invalid.
  it('isolates failures — the rest are still filed', async () => {
    const { judge, players } = await judgeAnd(2);
    const guest = await seedUser({ id: 'guest', participant: false });

    const res = await fileCases(
      env.DB,
      judge,
      [
        { subject_id: players[0].id },
        { subject_id: guest.id }, // not on the board
        { subject_id: 'ghost' }, // does not exist
        { subject_id: players[1].id },
      ],
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );

    expect(res.records).toHaveLength(2);
    expect(res.failed).toHaveLength(2);
    expect(res.failed.map((f) => f.subject_id).sort()).toEqual(['ghost', 'guest']);
    for (const f of res.failed) expect(f.error.length).toBeGreaterThan(0);
  });

  it('skips the judge themselves rather than failing the batch outright', async () => {
    const { judge, players } = await judgeAnd(1);
    const res = await fileCases(
      env.DB,
      judge,
      [{ subject_id: players[0].id }, { subject_id: judge.id }],
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );
    expect(res.records).toHaveLength(1);
    expect(res.failed[0].subject_id).toBe(judge.id);
    expect(res.failed[0].error).toMatch(/自己/);
  });

  // A missing role is about the caller, not about any one name in the list, so it
  // must be a 403 rather than a 200 carrying an all-failed list.
  it('rejects a non-judge outright instead of per subject', async () => {
    const { players } = await judgeAnd(1);
    const nobody = await seedUser({ id: 'nobody' });
    await expect(
      fileCases(env.DB, nobody, [{ subject_id: players[0].id }], CLAIM, undefined, OPTS, noAiEnv()),
    ).rejects.toThrow(/裁判/);
  });

  // Likewise the shared narrative is one input — report it once, not N times.
  it('rejects a too-short narrative outright', async () => {
    const { judge, players } = await judgeAnd(2);
    await expect(
      fileCases(
        env.DB,
        judge,
        players.map((p) => ({ subject_id: p.id })),
        '鸽了',
        undefined,
        OPTS,
        noAiEnv(),
      ),
    ).rejects.toThrow(/至少/);
  });
});

describe('classification provenance', () => {
  it('marks AI-less filings as fallback and lands them on `other`', async () => {
    const { judge, players } = await judgeAnd(1);
    const res = await fileCases(
      env.DB,
      judge,
      [{ subject_id: players[0].id }],
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );
    const r = res.records[0];
    expect(r.classified_by).toBe('fallback');
    expect(r.type).toBe('other');
    // `other` is the softest band — a classification failure must not punish.
    expect(r.range.max).toBe(VIOLATION_MAP.other.max);
    expect(r.claim_summary).not.toBeNull();
  });

  it('marks an explicitly typed filing as human', async () => {
    const { judge, players } = await judgeAnd(1);
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: players[0].id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    expect(record.classified_by).toBe('human');
    expect(record.type).toBe('no_show');
  });

  it('writes one classify audit row per case, tagged separately from sentencing', async () => {
    const { judge, players } = await judgeAnd(2);
    await fileCases(
      env.DB,
      judge,
      players.map((p) => ({ subject_id: p.id })),
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );
    const rows = await env.DB.prepare(
      "SELECT kind, COUNT(*) AS n FROM ai_verdicts GROUP BY kind",
    ).all<{ kind: string; n: number }>();
    const byKind = Object.fromEntries(rows.results.map((r) => [r.kind, r.n]));
    expect(byKind.classify).toBe(2);
    expect(byKind.sentence).toBeUndefined();
  });
});

describe('escalation co-signing', () => {
  /** Simulate what the classifier does when it points at the group-wipe charge. */
  async function withSuggestion() {
    const { judge, players } = await judgeAnd(1);
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: players[0].id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await env.DB.prepare('UPDATE records SET escalation_suggested = 1 WHERE id = ?')
      .bind(record.id)
      .run();
    return { judge, subject: players[0], id: record.id };
  }

  it('promotes the charge only when a human confirms', async () => {
    const { judge, id } = await withSuggestion();
    const out = await confirmEscalation(env.DB, judge, id);
    expect(out.type).toBe('no_show_group');
    expect(out.escalation_suggested).toBe(false);
    // Provenance flips to human: a person owns this charge now.
    expect(out.classified_by).toBe('human');
  });

  it('dismissing keeps the lesser charge', async () => {
    const { judge, id } = await withSuggestion();
    const out = await dismissEscalation(env.DB, judge, id);
    expect(out.type).toBe('no_show');
    expect(out.escalation_suggested).toBe(false);
  });

  it('only the filing judge or an admin may act', async () => {
    const { id, subject } = await withSuggestion();
    await expect(confirmEscalation(env.DB, subject, id)).rejects.toThrow(/裁判或管理员/);

    const admin = await seedUser({ id: 'admin', admin: true });
    await expect(confirmEscalation(env.DB, admin, id)).resolves.toBeDefined();
  });

  it('refuses once the case has been judged', async () => {
    const { judge, subject, id } = await withSuggestion();
    await submitStatement(env.DB, subject, id, '临时加班', noAiEnv());
    await expect(confirmEscalation(env.DB, judge, id)).rejects.toThrow(/已进入裁决/);
  });

  it('refuses when there is no suggestion pending', async () => {
    const { judge, players } = await judgeAnd(1);
    const record = await fileCase(
      env.DB,
      judge,
      { subject_id: players[0].id, type: 'no_show', claim: CLAIM },
      OPTS,
      noAiEnv(),
    );
    await expect(confirmEscalation(env.DB, judge, record.id)).rejects.toThrow(/没有待确认/);
  });
});

describe('reclassifyCase', () => {
  async function pending() {
    const { judge, players } = await judgeAnd(1);
    const res = await fileCases(
      env.DB,
      judge,
      [{ subject_id: players[0].id }],
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );
    return { judge, subject: players[0], id: res.records[0].id };
  }

  it('lets the judge override the category before any verdict', async () => {
    const { judge, id } = await pending();
    const out = await reclassifyCase(env.DB, judge, id, 'no_show');
    expect(out.type).toBe('no_show');
    expect(out.classified_by).toBe('human');
    expect(out.range.base).toBe(VIOLATION_MAP.no_show.base);
  });

  it('refuses to turn a penalty into a bonus', async () => {
    const { judge, id } = await pending();
    await expect(reclassifyCase(env.DB, judge, id, 'on_time_bonus')).rejects.toThrow(/加分/);
  });

  it('refuses an unknown type', async () => {
    const { judge, id } = await pending();
    await expect(reclassifyCase(env.DB, judge, id, 'nope')).rejects.toThrow(ApiError);
  });

  it('refuses after the verdict — that would need re-arguing the case', async () => {
    const { judge, subject, id } = await pending();
    await submitStatement(env.DB, subject, id, '加班', noAiEnv());
    await expect(reclassifyCase(env.DB, judge, id, 'no_show')).rejects.toThrow(/已进入裁决/);
  });

  it('is not open to the defendant', async () => {
    const { subject, id } = await pending();
    await expect(reclassifyCase(env.DB, subject, id, 'other')).rejects.toThrow(/裁判或管理员/);
  });
});

describe('batch filing feeds the normal trial flow', () => {
  it('each case sentences independently after its own statement', async () => {
    const { judge, players } = await judgeAnd(2);
    const res = await fileCases(
      env.DB,
      judge,
      players.map((p) => ({ subject_id: p.id })),
      CLAIM,
      undefined,
      OPTS,
      noAiEnv(),
    );

    const first = await submitStatement(env.DB, players[0], res.records[0].id, '加班', noAiEnv());
    expect(first.status).toBe('decided');
    expect(first.delta).toBe(VIOLATION_MAP.other.base);
    expect(await scoreOf(players[0].id)).toBe(100 + VIOLATION_MAP.other.base);

    // The second case is untouched — batching does not couple outcomes.
    const still = await listRecords(env.DB, { subject: players[1].id });
    expect(still[0].status).toBe('awaiting_statement');
    expect(await scoreOf(players[1].id)).toBe(100);
  });
});

describe('reclassify needs a judge', () => {
  it('refuses the reporter of a roll-call case who is not a judge', async () => {
    const organizer = await seedUser({ id: 'org' });
    await seedUser({ id: 'v' });
    // A roll-call case: filed by the session's organizer, who is no judge.
    const row = await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, claim, status, classified_by, deadline_at)
       VALUES ('v', 'org', 'late_minor', '迟到了一分钟迟到了一分钟', 'awaiting_statement', 'derived', datetime('now', '+1 day'))`,
    ).run();
    const id = Number(row.meta.last_row_id);
    await expect(reclassifyCase(env.DB, organizer, id, 'no_show_group')).rejects.toMatchObject({ status: 403 });
  });

  it('an organizer who is a judge still cannot re-type a roll-call case past the roll call', async () => {
    const organizer = await seedUser({ id: 'org', judge: true });
    const admin = await seedUser({ id: 'adm', admin: true });
    await seedUser({ id: 'v' });
    const late = await rollCallCase('late_minor');
    await expect(reclassifyCase(env.DB, organizer, late, 'no_show_group')).rejects.toThrow(/点名/);
    await expect(reclassifyCase(env.DB, organizer, late, 'late_major')).rejects.toThrow(/点名/);
    // Between 放鸽子 and 团灭级放鸽 — what settling allows — it can.
    const absent = await rollCallCase('no_show');
    await expect(reclassifyCase(env.DB, organizer, absent, 'no_show_group')).resolves.toMatchObject({ type: 'no_show_group' });
    await expect(reclassifyCase(env.DB, organizer, absent, 'no_show')).resolves.toMatchObject({ type: 'no_show' });
    // An admin is not bound by it.
    await expect(reclassifyCase(env.DB, admin, late, 'late_major')).resolves.toMatchObject({ type: 'late_major' });
  });

  it('only the judge who filed it: another judge cannot re-type it', async () => {
    const { judge, players } = await judgeAnd(1);
    const other = await seedUser({ id: 'j2', judge: true });
    const filed = await fileCase(env.DB, judge, { subject_id: players[0].id, type: 'late_minor', claim: CLAIM }, OPTS, noAiEnv());
    await expect(reclassifyCase(env.DB, other, filed.id, 'late_major')).rejects.toMatchObject({ status: 403 });
    await expect(reclassifyCase(env.DB, judge, filed.id, 'late_major')).resolves.toMatchObject({ type: 'late_major' });
  });

  it('a judge who has stepped down can no longer confirm or dismiss an escalation', async () => {
    const { judge, players } = await judgeAnd(1);
    const filed = await fileCase(env.DB, judge, { subject_id: players[0].id, type: 'no_show', claim: CLAIM }, OPTS, noAiEnv());
    await env.DB.prepare('UPDATE records SET escalation_suggested = 1 WHERE id = ?').bind(filed.id).run();
    const former = { ...judge, is_judge: false };
    await expect(confirmEscalation(env.DB, former, filed.id)).rejects.toMatchObject({ status: 403 });
    await expect(dismissEscalation(env.DB, former, filed.id)).rejects.toMatchObject({ status: 403 });
    await expect(dismissEscalation(env.DB, judge, filed.id)).resolves.toMatchObject({ escalation_suggested: false });
  });
});

/** A case as a roll call files it: by the organizer, its charge derived from the roll call. */
async function rollCallCase(type: string): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, claim, status, classified_by, deadline_at)
     VALUES ('v', 'org', ?, '点名记的迟到点名记的迟到', 'awaiting_statement', 'derived', datetime('now', '+1 day'))`,
  )
    .bind(type)
    .run();
  return Number(row.meta.last_row_id);
}
