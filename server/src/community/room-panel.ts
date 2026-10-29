import type { APIActionRowComponent, APIComponentInMessageActionRow, APIEmbed } from 'discord.js';
import { isCommunityRef, type CommunityVisibility } from '../../../shared/community';
import { safeCommunityText } from './security';

/** This is a shared room card: it never contains caller-specific permissions,
 * raw Discord identifiers or an interaction token. */
export interface CommunityRoomPanelState {
  roomRef: string;
  name: string;
  ownerName: string | null;
  occupantCount: number | null;
  userLimit: number;
  visibility: CommunityVisibility;
  cleanupAt: string | null;
  emptyGraceSeconds: number;
  claimable: boolean;
  transferPending: boolean;
}
export interface CommunityRoomPanelMessage {
  content: string;
  embeds: APIEmbed[];
  components: APIActionRowComponent<APIComponentInMessageActionRow>[];
  allowed_mentions: { parse: [] };
}

export function roomPanelMarker(roomRef: string): string {
  if (!isCommunityRef(roomRef)) throw new Error('房间引用无效');
  return `community-room-panel:${roomRef}`;
}

function label(value: string): string {
  return safeCommunityText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100)
    .replace(/[\\`*_~|>]/g, '\\$&');
}

export function renderRoomPanel(state: CommunityRoomPanelState): CommunityRoomPanelMessage {
  const marker = roomPanelMarker(state.roomRef);
  if (state.occupantCount !== null && (!Number.isSafeInteger(state.occupantCount) || state.occupantCount < 0)
    || !Number.isInteger(state.userLimit) || state.userLimit < 0 || state.userLimit > 99
    || !Number.isInteger(state.emptyGraceSeconds) || state.emptyGraceSeconds < 15 || state.emptyGraceSeconds > 86_400
    || !['open', 'locked', 'hidden'].includes(state.visibility)) throw new Error('房间状态无效');
  const grace = state.emptyGraceSeconds % 60 === 0 ? `${state.emptyGraceSeconds / 60} 分钟` : `${state.emptyGraceSeconds} 秒`;
  const lines = [`无人后 ${grace}自动删除。`];
  const deadline = state.cleanupAt === null ? NaN : Date.parse(state.cleanupAt);
  if (state.occupantCount === 0 && Number.isFinite(deadline)) lines.push(`房间已空，将于 <t:${Math.floor(deadline / 1000)}:R> 删除；有人回来会取消。`);
  if (state.claimable) lines.push('房主暂离，房内成员可从更多操作认领。');
  if (state.transferPending) lines.push('有一项待接受的房主转让，可从更多操作查看。');
  return {
    content: '', allowed_mentions: { parse: [] },
    embeds: [{
      title: label(state.name) || '临时语音房', description: lines.join('\n'),
      fields: [
        { name: '房主', value: state.ownerName ? label(state.ownerName) || '社区成员' : '暂无房主', inline: true },
        { name: '人数', value: `${state.occupantCount === null ? '状态暂不可用' : state.occupantCount} / ${state.userLimit || '不限'}`, inline: true },
        { name: '访问', value: { open: '公开', locked: '锁门', hidden: '隐藏' }[state.visibility], inline: true },
      ],
      footer: { text: marker },
    }],
    components: [{ type: 1, components: [
      ['rename', '修改名称'], ['limit', '人数上限'], ['visibility', '访问方式'], ['more', '更多操作'],
    ].map(([action, name]) => ({ type: 2, style: 2, label: name, custom_id: `v1:community:panel:${action}:${state.roomRef}` })) }],
  };
}
