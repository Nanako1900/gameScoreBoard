import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { RouteView } from '../../src/components/RouteView';
import type { Config, RecordItem, User } from '../../src/types';

const ADMIN: User = { id: 'admin', username: '管理', oauth_username: '管理', avatar_url: null, is_admin: true,
  is_judge: false, is_participant: false, score: 100, created_at: '' };
const RECORD: RecordItem = { id: 7, subject: { id: 'p', username: '当事人', avatar_url: null }, reporter: ADMIN,
  type: 'no_show', delta: -10, note: null, claim: '只有旧管理员应该读到的案情', claim_summary: null,
  classified_by: 'human', escalation_suggested: false, session_id: null, statement: null, statement_at: null,
  appeal_reason: null, deadline_at: null, status: 'decided', verdict: null, range: { min: -20, max: -10, base: -15 }, created_at: '' };
const CONFIG = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12, aiEnabled: false,
  maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' } as Config;
const props = { location: { pathname: '/players/p/cases/7', search: '', hash: '', route: { name: 'playerCase', userId: 'p', caseId: 7 } } as const,
  layout: 'page' as const, config: CONFIG, pinned: null, playerRefreshKey: 0, onPinned: vi.fn(), onChanged: vi.fn(), onOpenStatement: vi.fn() };
afterEach(() => vi.restoreAllMocks());
describe('case lookups by viewer scope', () => {
  it('reads the same case again on a role change instead of retaining the old privileged lookup', async () => {
    vi.spyOn(api, 'getRecord').mockResolvedValue({ record: RECORD });
    vi.spyOn(api, 'getUserDetail').mockResolvedValue({ user: { ...ADMIN, id: 'p', username: '当事人' }, records: [RECORD], history: [] });
    const view = render(<RouteView {...props} me={ADMIN} />);
    await waitFor(() => expect(api.getUserDetail).toHaveBeenCalledOnce());
    vi.mocked(api.getRecord).mockReturnValue(new Promise(() => {}));
    view.rerender(<RouteView {...props} me={{ ...ADMIN, is_admin: false }} />);
    await waitFor(() => expect(api.getRecord).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).not.toContain(RECORD.claim);
  });
});
