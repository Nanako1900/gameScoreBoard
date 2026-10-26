import { describe, expect, it } from 'vitest';
import { parseEscalationButton, renderEscalationClosed, renderEscalationDm } from '../src/discord/escalation';
import type { RecordItem } from '../../worker/types';

function record(over: Partial<RecordItem> = {}): RecordItem {
  return {
    id: 7,
    subject: { id: 's', username: '被告 @everyone', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'no_show',
    delta: 0,
    note: null,
    claim: '[写陈述](https://evil.example) 八点没来，全队散了',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: true,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: '2026-10-27 12:00:00',
    status: 'awaiting_statement',
    verdict: null,
    range: { min: -20, max: -10, base: -15 },
    created_at: '2026-10-26 12:00:00',
    ...over,
  };
}

describe('the escalation DM', () => {
  it('offers the two choices as buttons of their own, and the case’s page', () => {
    const m = renderEscalationDm(record(), 'https://score.example');
    const buttons = m.components.flatMap((row) => row.components) as unknown as Array<Record<string, unknown>>;
    expect(buttons.map((b) => b.custom_id ?? b.url)).toEqual(['v1:esc:7:ok', 'v1:esc:7:no', 'https://score.example/?case=7']);
    expect(buttons[0].style).toBe(4); // danger
    expect(m.allowed_mentions).toEqual({ parse: [] });
    const out = JSON.stringify(m.embeds);
    expect(out).not.toContain('](https://evil');
    expect(out).not.toMatch(/@everyone/);
  });

  it('once settled says how, with nothing left to press', () => {
    expect(renderEscalationClosed(record({ type: 'no_show_group', escalation_suggested: false })).components).toEqual([]);
    expect(JSON.stringify(renderEscalationClosed(record({ type: 'no_show_group' })))).toContain('已升级');
    expect(JSON.stringify(renderEscalationClosed(record({ escalation_suggested: false })))).toContain('维持原案由');
    expect(JSON.stringify(renderEscalationClosed(record({ status: 'withdrawn' })))).toContain('撤回');
    expect(JSON.stringify(renderEscalationClosed(record({ status: 'decided' })))).toContain('已进入裁决');
  });
});

describe('parseEscalationButton', () => {
  it('reads only its own ids', () => {
    expect(parseEscalationButton('v1:esc:7:ok')).toEqual({ recordId: 7, choice: 'ok' });
    expect(parseEscalationButton('v1:esc:7:no')).toEqual({ recordId: 7, choice: 'no' });
    for (const id of ['v1:esc:7:yes', 'v1:esc:7:ok:1', 'v1:esc:1234567890123456:ok', 'v1:esc:x:ok', 'v1:stmt:7']) {
      expect(parseEscalationButton(id)).toBeNull();
    }
  });
});
