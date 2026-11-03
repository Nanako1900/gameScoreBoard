import type { CommandDefinition } from '../discord/commands';
/** Only active commands are registered; cached retired commands are still
 * recognized by the runtime so they receive a safe retirement notice. */
export const COMMUNITY_COMMANDS: readonly CommandDefinition[] = [
  { type: 1, name: 'room', description: '创建、加入和管理自己的社区语音房' },
  { type: 1, name: 'roles', description: '自选或退出管理员开放的兴趣身份' },
];

export const RETIRED_COMMUNITY_COMMAND_NAMES: readonly string[] = ['poll', 'teams', 'draw', 'roll', 'topic', 'room_ai'];
const retiredComponents = new Set(['play', 'tool', 'toolsubmit', 'teams', 'fun', 'funselect', 'vote', 'close', 'redraw', 'aiapply']);
export function isRetiredCommunityComponentId(customId: string): boolean {
  return customId.startsWith('v1:community:') && retiredComponents.has(customId.split(':')[2]);
}
