// A missing Gateway snapshot is unknown occupancy, never an empty channel.
export interface RoomMaintenanceState {
  status: string; ownerLeftAt: number | null; emptySince: number | null; cleanupAt: number | null;
}
export interface RoomMaintenancePlan {
  patch: Partial<Pick<RoomMaintenanceState, 'ownerLeftAt' | 'emptySince' | 'cleanupAt'>>;
  remove: boolean; claimable: boolean;
}
export function planRoomMaintenance(room: RoomMaintenanceState,
  presence: { count: number; ownerPresent: boolean } | null,
  policy: { emptyGraceSeconds: number; ownerGraceSeconds: number }, now: number): RoomMaintenancePlan {
  const result: RoomMaintenancePlan = { patch: {}, remove: false, claimable: false };
  if (!presence || room.status !== 'active' || !Number.isFinite(now) || presence.count < 0) return result;
  const ownerLeftAt = presence.ownerPresent ? null : room.ownerLeftAt ?? now;
  if (ownerLeftAt !== room.ownerLeftAt) result.patch.ownerLeftAt = ownerLeftAt;
  if (presence.count > 0) {
    if (room.emptySince !== null) result.patch.emptySince = null;
    if (room.cleanupAt !== null) result.patch.cleanupAt = null;
    result.claimable = !presence.ownerPresent && ownerLeftAt !== null && now >= ownerLeftAt + policy.ownerGraceSeconds * 1000;
    return result;
  }
  const emptySince = room.emptySince ?? now;
  const cleanupAt = room.cleanupAt ?? emptySince + policy.emptyGraceSeconds * 1000;
  if (room.emptySince === null) result.patch.emptySince = emptySince;
  if (room.cleanupAt === null) result.patch.cleanupAt = cleanupAt;
  result.remove = now >= cleanupAt;
  return result;
}
