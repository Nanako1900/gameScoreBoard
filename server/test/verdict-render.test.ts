import { describe, expect, it } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import { isPostable, parseVerdictButton, verdictButtonId, verdictPost } from '../src/discord/verdict';
import type { RecordItem } from '../../worker/types';

const EVIL = '[写陈述](https://evil.example) @everyone <@123456789012345678>';

function record(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 42,
    subject: { id: 'u1', username: '被告', avatar_url: null },
    reporter: { id: 'u2', username: '裁判', avatar_url: null },
    type: 'no_show',
    delta: -15,
    note: 'NOTE',
    claim: 'CLAIM',
    claim_summary: 'SUMMARY',
    classified_by: 'judge',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: 'APPEAL',
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'fallback', headline: 'HEADLINE', reasoning: 'REASONING', factors: [{ kind: 'aggravating', text: 'FACTOR' }] },
    range: { min: -20, max: -8, base: -15 },
    created_at: '2026-10-20 12:00:00',
    ...over,
  } as RecordItem;
}

const text = (r: RecordItem) => JSON.stringify(verdictPost(r, 'https://score.example'));

describe('verdictPost', () => {
  it('carries the fixed fields and nothing anyone wrote', () => {
    const out = text(record());
    for (const secret of ['NOTE', 'CLAIM', 'SUMMARY', 'APPEAL', 'HEADLINE', 'REASONING', 'FACTOR']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('被告');
    expect(out).toContain(VIOLATION_MAP.no_show.label);
    expect(out).toContain('-15 分');
    expect(out).toContain('缺席判决');
  });

  it('can never ping or link through a hostile display name', () => {
    const post = verdictPost(record({ subject: { id: 'u1', username: EVIL, avatar_url: null } }), 'https://score.example');
    expect(post.allowed_mentions).toEqual({ parse: [] });
    const title = post.embeds[0].title ?? '';
    expect(title).not.toContain('](');
    expect(title).not.toContain('https://');
    expect(title).not.toMatch(/@everyone/);
    expect(title).not.toContain('<@');
  });

  it('says how the case was decided', () => {
    expect(text(record({ statement: '我有话说' }))).toContain('当庭判决');
    expect(
      text(record({ verdict: { source: 'admin_override', headline: 'x', reasoning: 'y', factors: [] } })),
    ).toContain('管理员改判');
  });

  it('strikes the points through once revoked', () => {
    const out = text(record({ status: 'revoked' }));
    expect(out).toContain('判决已撤销');
    expect(out).toContain('~~-15 分~~ 已退回');
  });

  it('has a 看判词 button for this case and a link to the web', () => {
    const post = verdictPost(record(), 'https://score.example/');
    const [action, link] = post.components[0].components as unknown as Array<Record<string, unknown>>;
    expect(action).toMatchObject({ custom_id: 'v1:verdict:42', label: '看判词' });
    expect(link).toMatchObject({ url: 'https://score.example/?case=42', label: '在网页查看' });
  });
});

describe('isPostable', () => {
  it('only judged penalties go to the channel', () => {
    expect(isPostable(record())).toBe(true);
    expect(isPostable(record({ status: 'appealed' }))).toBe(true);
    expect(isPostable(record({ status: 'revoked' }))).toBe(true);
    for (const status of ['awaiting_statement', 'judging', 'withdrawn'] as const) {
      expect(isPostable(record({ status }))).toBe(false);
    }
    expect(isPostable(record({ type: 'on_time_bonus' }))).toBe(false);
    expect(isPostable(record({ type: 'constructor' as RecordItem['type'] }))).toBe(false);
  });
});

describe('the button id', () => {
  it('round-trips and rejects anything else', () => {
    expect(parseVerdictButton(verdictButtonId(7))).toBe(7);
    for (const id of ['v1:verdict:', 'v1:verdict:-1', 'v1:verdict:1e3', 'v2:verdict:1', 'v1:verdict:1:x', 'v1:verdict:1234567890123456']) {
      expect(parseVerdictButton(id)).toBeNull();
    }
  });
});
