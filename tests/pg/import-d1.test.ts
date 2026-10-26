// The D1 → PostgreSQL import (server/src/import-d1.ts). PostgreSQL-only: it
// runs in the PG suite against the same migrated schema production uses.

import { describe, expect, it } from 'vitest';
import { importD1, ImportError, type Export } from '../../server/src/import-d1';
import { env, pool } from './cloudflare-test';

const T = '2026-10-20 12:00:00';

/** A small but complete export, shaped like scripts/d1-export.mjs output. */
function exportFixture(): Export {
  return {
    users: [
      { id: 'org', username: 'org', display_name: '组织者', avatar_url: null, email: null, is_participant: 1, is_judge: 1, is_admin: 1, score: 88, created_at: T, updated_at: T },
      { id: 'p1', username: 'p1', display_name: null, avatar_url: 'https://nanako.org/a.png', email: 'p1@example.com', is_participant: 1, is_judge: 0, is_admin: 0, score: 70, created_at: T, updated_at: T },
    ],
    game_sessions: [
      { id: 7, organizer_id: 'org', title: '周五 20:00 开黑', game: null, starts_at: '2026-10-23T12:00:00.000Z', duration_min: null, capacity: null, note: null, status: 'settled', settled_at: T, settled_by: 'org', created_at: T },
    ],
    records: [
      { id: 3, subject_id: 'p1', reporter_id: 'org', type: 'no_show', delta: -15, note: null, claim: '说好八点开黑，结果一直没上线', claim_summary: '放鸽子', classified_by: 'ai', escalation_suggested: 0, session_id: 7, statement: null, statement_at: null, appeal_reason: null, deadline_at: T, judging_started_at: null, verdict_source: 'fallback', verdict_headline: 'AI 裁判暂时不可用', verdict_reason: '按基准分', verdict_factors: '[]', status: 'decided', created_at: T },
      { id: 9, subject_id: 'org', reporter_id: 'org', type: 'organizer_bonus', delta: 2, note: null, claim: '组织了约局', claim_summary: null, classified_by: null, escalation_suggested: 0, session_id: 7, statement: null, statement_at: null, appeal_reason: null, deadline_at: null, judging_started_at: null, verdict_source: 'manual', verdict_headline: '组局召集', verdict_reason: '结算时由系统自动发放。', verdict_factors: null, status: 'decided', created_at: T },
    ],
    session_players: [
      { session_id: 7, user_id: 'org', rsvp: 'going', rsvp_at: T, attendance: 'on_time', late_minutes: null, attendance_note: null, record_id: null },
      { session_id: 7, user_id: 'p1', rsvp: 'going', rsvp_at: T, attendance: 'no_show', late_minutes: null, attendance_note: null, record_id: 3 },
    ],
    score_events: [
      { id: 11, user_id: 'p1', delta: -15, reason: 'record:3', resulting_score: 70, created_at: T },
      { id: 12, user_id: 'org', delta: 2, reason: 'record:9', resulting_score: 88, created_at: T },
    ],
    ai_verdicts: [
      { id: 5, record_id: 3, kind: 'sentence', provider: 'api.openai.com', model: 'gpt-4o-mini', prompt_version: 'abc123', raw_response: null, parsed_delta: null, applied_delta: -15, clamped: 0, confidence: 0.85, latency_ms: 1234, error: 'timeout', created_at: T },
    ],
    weekly_heals: [{ week_start: '2026-10-19', applied_at: T, affected: 2 }],
    weekly_reports: [{ week_start: '2026-10-12', stats_json: '{"cases":1}', narrative: '本周一共开了 1 局。', source: 'fallback', created_at: T }],
    app_settings: [{ key: 'ai.model', value: 'gpt-4o-mini', updated_by: 'org', updated_at: T }],
  };
}

async function count(table: string): Promise<number> {
  const res = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return res.rows[0].n;
}

describe('importD1', () => {
  it('imports every table with its ids and verifies the read-back', async () => {
    const result = await importD1(pool, exportFixture());
    expect(result.preflight.rows).toMatchObject({ users: 2, records: 2, score_events: 2, session_players: 2 });
    expect(Object.keys(result.checksums)).toHaveLength(9);

    // Through the same adapter the API uses: exactly what D1 held.
    const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(3).first();
    expect(rec).toMatchObject({ id: 3, delta: -15, session_id: 7, created_at: T, verdict_factors: '[]' });
    const verdict = await env.DB.prepare('SELECT confidence, latency_ms FROM ai_verdicts WHERE id = 5').first();
    expect(verdict).toEqual({ confidence: 0.85, latency_ms: 1234 });
  });

  it('continues identities above both max(id) and sqlite_sequence', async () => {
    // sqlite_sequence says record 20 once existed (deleted since): never reuse it.
    const result = await importD1(pool, exportFixture(), { records: 20, score_events: 12 });
    expect(result.sequences).toMatchObject({ records: 21, score_events: 13, game_sessions: 8 });
    const next = await env.DB.prepare(
      "INSERT INTO records (subject_id, reporter_id, type) VALUES ('p1', 'org', 'other')",
    ).run();
    expect(next.meta.last_row_id).toBe(21);
  });

  it('drops U+0000 — which PostgreSQL text cannot hold — and counts it', async () => {
    const data = exportFixture();
    data.records[0].claim = 'before\u0000after';
    const result = await importD1(pool, data);
    expect(result.preflight.nul).toEqual({ records: 1 });
    const row = await env.DB.prepare('SELECT claim FROM records WHERE id = 3').first<{ claim: string }>();
    expect(row?.claim).toBe('beforeafter');
  });

  it('refuses dangling foreign keys and leaves the database untouched', async () => {
    const data = exportFixture();
    data.score_events.push({ id: 13, user_id: 'ghost', delta: 1, reason: 'x', resulting_score: 1, created_at: T });
    await expect(importD1(pool, data)).rejects.toThrow(/dangling.*score_events\.user_id=ghost/);
    expect(await count('users')).toBe(0);
  });

  it('refuses columns or tables this schema does not know', async () => {
    const data = exportFixture();
    data.users[0].nickname = 'x';
    await expect(importD1(pool, data)).rejects.toThrow(/users\.nickname/);
    const extra = { ...exportFixture(), legacy_table: [] };
    await expect(importD1(pool, extra)).rejects.toThrow(/legacy_table/);
  });

  it('refuses a database that already has data', async () => {
    await importD1(pool, exportFixture());
    await expect(importD1(pool, exportFixture())).rejects.toBeInstanceOf(ImportError);
    expect(await count('records')).toBe(2);
  });

  it('rolls back everything when a later table fails to insert', async () => {
    const data = exportFixture();
    data.app_settings.push({ key: 'ai.model', value: 'duplicate', updated_by: null, updated_at: T });
    await expect(importD1(pool, data)).rejects.toThrow();
    for (const table of ['users', 'records', 'weekly_heals']) expect(await count(table)).toBe(0);
  });
});
