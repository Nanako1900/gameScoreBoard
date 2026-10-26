import { describe, expect, it } from 'vitest';
import { dmStillRelevant, renderDm } from '../src/discord/dm';
import { parseCaseButton, parseCaseModal, toModal } from '../src/discord/case-actions';
import type { RecordItem } from '../../worker/types';

const FUTURE = '2099-01-01 00:00:00';
const PAST = '2000-01-01 00:00:00';

function record(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 7,
    subject: { id: 'u1', username: '被告', avatar_url: null },
    reporter: { id: 'u2', username: '裁判', avatar_url: null },
    type: 'no_show',
    delta: -15,
    note: null,
    claim: '[写陈述](https://evil.example) @everyone 说好八点没来',
    claim_summary: null,
    classified_by: 'judge',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: FUTURE,
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -20, max: -8, base: -15 },
    created_at: '2026-10-20 12:00:00',
    ...over,
  } as RecordItem;
}

const json = (v: unknown) => JSON.stringify(v);
const decided = { status: 'decided' as const, verdict: { source: 'ai' as const, headline: '缺席', reasoning: '你没来', factors: [] } };

describe('renderDm', () => {
  it('shows the accusation to the accused, defanged', () => {
    const m = renderDm('dm.filed', record(), 'https://score.example')!;
    const desc = m.embeds[0].description ?? '';
    expect(desc).toContain('说好八点没来');
    expect(desc).not.toContain('](');
    expect(desc).not.toContain('https://');
    expect(desc).not.toMatch(/@everyone/);
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(json(m.components)).toContain('v1:stmt:7');
  });

  it('offers 申诉 only on a decided case, with the full verdict', () => {
    const m = renderDm('dm.decided', record(decided), 'https://score.example')!;
    expect(json(m)).toContain('你没来');
    expect(json(m.components)).toContain('v1:appeal:7');
    const appealed = renderDm('dm.decided', record({ ...decided, status: 'appealed' }), 'https://score.example')!;
    expect(json(appealed.components)).not.toContain('v1:appeal:');
  });

  it('a withdrawal leaves no button to press', () => {
    const m = renderDm('dm.withdrawn', record({ status: 'withdrawn' }), 'https://score.example')!;
    expect(m.components).toEqual([]);
  });
});

describe('dmStillRelevant', () => {
  it('asks for a statement only while one can still be written', () => {
    expect(dmStillRelevant('dm.filed', record())).toBe(true);
    expect(dmStillRelevant('dm.deadline', record())).toBe(true);
    expect(dmStillRelevant('dm.filed', record({ deadline_at: PAST }))).toBe(false);
    expect(dmStillRelevant('dm.deadline', record({ status: 'judging' }))).toBe(false);
    expect(dmStillRelevant('dm.decided', record(decided))).toBe(true);
    expect(dmStillRelevant('dm.decided', record({ status: 'revoked' }))).toBe(false);
    expect(dmStillRelevant('dm.revoked', record({ status: 'revoked' }))).toBe(true);
  });
});

describe('case buttons and modals', () => {
  it('parses their ids and nothing else', () => {
    expect(parseCaseButton('v1:stmt:12')).toEqual({ action: 'statement', recordId: 12 });
    expect(parseCaseButton('v1:appeal:12')).toEqual({ action: 'appeal', recordId: 12 });
    expect(parseCaseModal('v1:stmtm:12')).toEqual({ action: 'statement', recordId: 12 });
    for (const id of ['v1:stmt:', 'v1:stmt:1x', 'v1:verdict:1', 'v1:stmtm:12', 'v1:stmt:1234567890123456']) {
      expect(parseCaseButton(id)).toBeNull();
    }
  });

  it('builds a modal Discord accepts: one paragraph field within the limits', () => {
    const modal = toModal({
      customId: 'v1:stmtm:1',
      title: '陈述：'.padEnd(80, '长'),
      field: { label: '你的陈述'.padEnd(60, '长'), placeholder: 'x'.repeat(150), required: true, maxLength: 1000 },
    });
    expect(modal.title.length).toBeLessThanOrEqual(45);
    const input = (modal.components[0] as unknown as { components: Array<Record<string, unknown>> }).components[0];
    expect(input).toMatchObject({ custom_id: 'text', style: 2, required: true, min_length: 1, max_length: 1000 });
    expect(String(input.label).length).toBeLessThanOrEqual(45);
    expect(String(input.placeholder).length).toBeLessThanOrEqual(100);
  });
});
