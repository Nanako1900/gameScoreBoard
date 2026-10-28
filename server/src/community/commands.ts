import type { CommandDefinition } from '../discord/commands';
/** Community commands are available to every current guild member. Binding and
 * reputation roles are deliberately absent from command registration. */
export const COMMUNITY_COMMANDS: readonly CommandDefinition[] = [
  { type: 1, name: 'room', description: '创建、加入和管理自己的社区语音房' },
  { type: 1, name: 'roles', description: '自选或退出管理员开放的兴趣身份' },
  { type: 1, name: 'poll', description: '发起一个投票，截止前可以改票', options: [
    { type: 3, name: 'question', description: '投票问题', required: true },
    { type: 3, name: 'options', description: '每个选项用分号隔开，至少两个', required: true },
    { type: 4, name: 'hours', description: '持续小时数（默认 24）', min_value: 1, max_value: 720 },
  ] },
  { type: 1, name: 'teams', description: '选择参与成员后随机分队', options: [
    { type: 4, name: 'count', description: '分成几队（默认 2）', min_value: 2, max_value: 25 },
  ] },
  { type: 1, name: 'draw', description: '从候选内容中不重复抽签', options: [
    { type: 3, name: 'items', description: '候选内容，每项用分号隔开', required: true },
    { type: 4, name: 'count', description: '抽取数量（默认 1）', min_value: 1, max_value: 100 },
  ] },
  { type: 1, name: 'roll', description: '掷骰子', options: [
    { type: 4, name: 'count', description: '骰子数量（默认 1）', min_value: 1, max_value: 100 },
    { type: 4, name: 'sides', description: '骰子面数（默认 6）', min_value: 2, max_value: 1000000 },
  ] },
  { type: 1, name: 'topic', description: '从社区题库抽一张话题卡', options: [
    { type: 3, name: 'tag', description: '可选的话题标签' },
  ] },
  { type: 1, name: 'room_ai', description: '主动请求房间名或话题建议，确认后才应用', options: [
    { type: 3, name: 'theme', description: '本次明确提供的主题', required: true },
    { type: 3, name: 'purpose', description: '建议类型', choices: [{ name: '房间名', value: 'room_name' }, { name: '讨论话题', value: 'topic' }] },
  ] },
];
