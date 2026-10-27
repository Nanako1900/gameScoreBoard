// Guide copy shared by the web, /help and the welcome DM. Data only.
export const GUIDE_INTRO = '日常开黑在 Discord 里联系；网页用来看信誉榜和案件，也能写说明、提申诉。';

export const GUIDE_COMMANDS = [
  { name: '/score', text: '查自己的信誉分和段位；查别人时只显示名字和分数。' },
  { name: '/top', text: '查看信誉榜前 10 名。' },
  { name: '/verdicts', text: '查看最近 5 次判决，判词和说明到网页查看。' },
  { name: '/todo', text: '查看待写陈述；管理员还能查看待复核的申诉。' },
  { name: '/report', text: '查看最新一期战报。' },
  { name: '/notify', text: '用 /notify 开 或 /notify 关切换私信提醒。' },
  { name: '/link', text: '绑定你的 Nanako 账号。' },
  { name: '/unlink', text: '解除 Discord 与 Nanako 账号的绑定。' },
  { name: '/help', text: '随时查看这份指南，只有你自己能看到。' },
  { name: '/voice', text: '查看最近 7 天的语音记录，最多 14 天；裁判和管理员可指定查看别人。' },
] as const;

export const GUIDE_TIPS = [
  '绑定并开启私信后，被记了一笔会收到提醒；按私信里的按钮写陈述，也可以到网页写说明。',
  '私信收不到：在 Discord 隐私设置里允许服务器成员私信你，再到网页检查通知开关。',
  '陈述和申诉只给当事人、立案人、裁判和管理员看；自己的段位只给自己看。',
] as const;
