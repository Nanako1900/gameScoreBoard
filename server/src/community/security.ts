import type { CommunityJson, CommunityPublicSettings, CommunitySettings, CommunityVisibility } from '../../../shared/community';

export interface CommunityReader { memberRef: string | null; isAdmin: boolean; memberAvailable: boolean }
export function canReadRoom(actor: CommunityReader, room: { ownerRef: string | null; visibility: CommunityVisibility },
  access: readonly { memberRef: string; allowed: boolean; blocked: boolean; present: boolean }[]): boolean {
  if (actor.isAdmin) return true;
  if (!actor.memberAvailable || !actor.memberRef) return false;
  const mine = access.find(item => item.memberRef === actor.memberRef);
  if (mine?.blocked) return false;
  return room.ownerRef === actor.memberRef || room.visibility !== 'hidden' || !!(mine?.allowed || mine?.present);
}
export function safeCommunityText(value: string): string {
  return value.replace(/<[@#][!&]?\d+>/g, '［隐藏提及］').replace(/\b\d{17,20}\b/g, '［隐藏］');
}
export function publicCommunityJson(value: CommunityJson, depth = 0): CommunityJson {
  if (depth > 20) return null;
  if (typeof value === 'string') return safeCommunityText(value);
  if (Array.isArray(value)) return value.map(item => publicCommunityJson(item, depth + 1));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:discord|token|secret|external.?id|channel.?id|member.?id|role.?id|user.?id|claim.?token|payload)/i.test(key))
    .map(([key, item]) => [key, publicCommunityJson(item, depth + 1)]));
  return value;
}
export function publicCommunitySettings(settings: CommunitySettings): CommunityPublicSettings {
  const { enabled, rooms, roles, fun } = settings;
  return { enabled, rooms: { enabled: rooms.enabled, visibility: rooms.visibility, maxPerMember: rooms.maxPerMember,
    maxRooms: rooms.maxRooms, cooldownSeconds: rooms.cooldownSeconds, emptyGraceSeconds: rooms.emptyGraceSeconds,
    ownerGraceSeconds: rooms.ownerGraceSeconds, userLimit: rooms.userLimit, maxUserLimit: rooms.maxUserLimit },
  roles: { enabled: roles.enabled, maxChoices: roles.maxChoices },
  fun: { enabled: fun.enabled, enabledTools: [...fun.enabledTools], cooldownSeconds: fun.cooldownSeconds,
    pollMaxHours: fun.pollMaxHours, pollMaxOptions: fun.pollMaxOptions, maxParticipants: fun.maxParticipants,
    maxDiceCount: fun.maxDiceCount, maxDiceSides: fun.maxDiceSides,
    tags: [...new Set(fun.topics.flatMap(topic => topic.tags.map(safeCommunityText)))],
    ai: { enabled: fun.ai.enabled, userDailyLimit: fun.ai.userDailyLimit, guildDailyLimit: fun.ai.guildDailyLimit } } };
}
