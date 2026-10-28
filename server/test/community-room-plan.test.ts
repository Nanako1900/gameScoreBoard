import { describe, expect, it } from 'vitest';
import { planRoomMaintenance } from '../src/community/room-plan';

const policy = { emptyGraceSeconds: 120, ownerGraceSeconds: 120 };
const active = { status: 'active', ownerLeftAt: null as number | null, emptySince: null as number | null, cleanupAt: null as number | null };

describe('temporary room maintenance', () => {
  it('does nothing when the guild snapshot is not trustworthy', () => {
    expect(planRoomMaintenance(active, null, policy, 500_000)).toEqual({ patch: {}, remove: false, claimable: false });
  });
  it('starts the empty-room grace once and never deletes before it expires', () => {
    const first = planRoomMaintenance(active, { count: 0, ownerPresent: false }, policy, 1000);
    expect(first).toMatchObject({ remove: false, claimable: false, patch: { emptySince: 1000, cleanupAt: 121000, ownerLeftAt: 1000 } });
    expect(planRoomMaintenance({ ...active, ...first.patch }, { count: 0, ownerPresent: false }, policy, 120999).remove).toBe(false);
    expect(planRoomMaintenance({ ...active, ...first.patch }, { count: 0, ownerPresent: false }, policy, 121000).remove).toBe(true);
  });
  it('cancels pending cleanup when somebody rejoins, even exactly at the deadline', () => {
    expect(planRoomMaintenance({ ...active, emptySince: 1000, cleanupAt: 121000 }, { count: 1, ownerPresent: false }, policy, 121000))
      .toMatchObject({ patch: { emptySince: null, cleanupAt: null }, remove: false });
  });
  it('allows a present member to claim only after the owner grace and stops on owner return', () => {
    const away = { ...active, ownerLeftAt: 1000 };
    expect(planRoomMaintenance(away, { count: 2, ownerPresent: false }, policy, 120999).claimable).toBe(false);
    expect(planRoomMaintenance(away, { count: 2, ownerPresent: false }, policy, 121000).claimable).toBe(true);
    expect(planRoomMaintenance(away, { count: 2, ownerPresent: true }, policy, 121000))
      .toMatchObject({ patch: { ownerLeftAt: null }, claimable: false });
  });
  it('never recycles a creating, unknown or closed room as an empty active room', () => {
    for (const status of ['creating', 'needs_review', 'closed', 'failed']) {
      expect(planRoomMaintenance({ ...active, status, cleanupAt: 1000 }, { count: 0, ownerPresent: false }, policy, 999999).remove).toBe(false);
    }
  });
});
