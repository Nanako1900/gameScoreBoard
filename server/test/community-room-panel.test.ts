import { describe, expect, it } from 'vitest';
import { renderRoomPanel, type CommunityRoomPanelState } from '../src/community/room-panel';

const REF = 'de52a9a3-56a7-4c35-a145-ed3a207bf206';
const state: CommunityRoomPanelState = {
  roomRef: REF, name: 'Nanako 的房间', ownerName: 'Nanako', occupantCount: 3,
  userLimit: 6, visibility: 'open', cleanupAt: null, emptyGraceSeconds: 120,
  claimable: false, transferPending: false,
};

describe('persistent room control card', () => {
  it('renders one shared card with four direct actions and a stable recovery marker', () => {
    const card = renderRoomPanel(state);
    expect(card.allowed_mentions).toEqual({ parse: [] });
    expect(card.embeds[0].title).toBe('Nanako 的房间');
    expect(card.embeds[0].footer?.text).toBe('房间状态自动更新');
    expect(JSON.stringify(card.embeds)).not.toContain(REF);
    expect(card.embeds[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '房主', value: 'Nanako' }),
      expect.objectContaining({ name: '人数', value: '3 / 6' }),
      expect.objectContaining({ name: '访问', value: '公开' }),
    ]));
    const buttons = card.components.flatMap(row => row.components);
    expect(buttons.map(button => 'label' in button ? button.label : '')).toEqual(['修改名称', '人数上限', '访问方式', '更多操作']);
    expect(buttons.map(button => 'custom_id' in button ? button.custom_id : '')).toEqual(
      ['rename', 'limit', 'visibility', 'more'].map(action => `v1:community:panel:${action}:${REF}`));
    expect(JSON.stringify(card)).not.toContain('你是房主');
    expect(card.embeds[0].description).toContain('无人后 2 分钟自动删除');
  });

  it('keeps unknown occupancy separate from an empty room and supports unlimited capacity', () => {
    const card = renderRoomPanel({ ...state, occupantCount: null, userLimit: 0 });
    expect(card.embeds[0].fields).toContainEqual(expect.objectContaining({ name: '人数', value: '状态暂不可用 / 不限' }));
    expect(card.embeds[0].description).not.toContain('即将删除');
  });

  it('updates access, ownership notices and a server-supported relative cleanup deadline', () => {
    const card = renderRoomPanel({ ...state, ownerName: null, occupantCount: 0, visibility: 'hidden',
      cleanupAt: '2026-10-29T12:02:00.000Z', claimable: true, transferPending: true });
    expect(card.embeds[0].fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '房主', value: '暂无房主' }), expect.objectContaining({ name: '访问', value: '隐藏' }),
    ]));
    expect(card.embeds[0].description).toContain('<t:');
    expect(card.embeds[0].description).toContain(':R>');
    expect(card.embeds[0].description).toContain('认领');
    expect(card.embeds[0].description).toContain('转让');
  });

  it('does not display stale cleanup deadlines once occupancy is unknown or positive', () => {
    for (const occupantCount of [null, 1]) {
      const card = renderRoomPanel({ ...state, occupantCount, cleanupAt: '2026-10-29T12:02:00Z' });
      expect(card.embeds[0].description).not.toContain('<t:');
    }
  });

  it('sanitizes labels and rejects malformed room references or numeric state', () => {
    const card = renderRoomPanel({ ...state, name: '<#666666666666666666>\n@everyone', ownerName: '<@333333333333333333>' });
    expect(JSON.stringify(card)).not.toContain('666666666666666666');
    expect(JSON.stringify(card)).not.toContain('333333333333333333');
    expect(card.embeds[0].title).not.toContain('\n');
    expect(() => renderRoomPanel({ ...state, roomRef: '666666666666666666' })).toThrow();
    expect(() => renderRoomPanel({ ...state, occupantCount: -1 })).toThrow();
    expect(() => renderRoomPanel({ ...state, userLimit: 100 })).toThrow();
  });

  it('uses seconds for a non-minute setting without rounding its deletion policy', () => {
    expect(renderRoomPanel({ ...state, emptyGraceSeconds: 90 }).embeds[0].description).toContain('90 秒');
  });
  it('shows fixed room managers without a temporary owner or automatic deletion policy', () => {
    const card = renderRoomPanel({ ...state, kind: 'fixed', managerNames: ['Nanako', '成员二'],
      ownerName: null, cleanupAt: '2026-10-29T12:02:00Z', occupantCount: 0, claimable: true, transferPending: true });
    expect(card.embeds[0].fields).toContainEqual(expect.objectContaining({ name: '管理者', value: 'Nanako、成员二' }));
    expect(card.embeds[0].fields?.some(field => field.name === '房主')).toBe(false);
    expect(card.embeds[0].description).toContain('固定语音房');
    for (const word of ['自动删除', '认领', '转让', '<t:']) expect(card.embeds[0].description).not.toContain(word);
    expect(card.components[0].components).toHaveLength(4);
  });
  it('uses a friendly unassigned-manager label for fixed rooms and sanitizes manager names', () => {
    expect(renderRoomPanel({ ...state, kind: 'fixed', managerNames: [] }).embeds[0].fields)
      .toContainEqual(expect.objectContaining({ name: '管理者', value: '未分配管理员' }));
    expect(JSON.stringify(renderRoomPanel({ ...state, kind: 'fixed', managerNames: ['<#666666666666666666>'] }).embeds))
      .not.toContain('666666666666666666');
  });
});
