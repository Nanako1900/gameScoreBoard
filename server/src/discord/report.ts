// The weekly report in Discord: `/report`'s reply and, since P8, the post in
// the verdict channel when a week's report is written. One rendering for both.
// Names go through safeLine and the AI's paragraph through safeText, so a name
// or a sentence cannot ping anyone or turn into a link.

import { ButtonStyle, ComponentType } from 'discord.js';
import type { WeeklyReport } from '../../../worker/report';
import { toEmbed } from './client';
import { GOLD, LIMITS, clampEmbed, formatDelta, linkButton, safeLine, safeText, webUrl } from './render';
import type { BotEmbed, BotEmbedField } from './types';
import type { ChannelMessage } from './verdict';

const NAME_MAX = 64;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOnly(value: string | null | undefined): string {
  return value && DATE.test(value) ? value : '—';
}

export function reportEmbed(report: WeeklyReport): BotEmbed {
  const s = report.stats;
  const fields: BotEmbedField[] = [
    { name: '开局', value: `${s.sessionsPlayed} 局`, inline: true },
    { name: '立案', value: `${s.casesFiled} 起`, inline: true },
    { name: '合计扣分', value: String(s.totalPenalty), inline: true },
    {
      name: '出勤率',
      value: s.attendanceRate === null ? '—' : `${Math.round(s.attendanceRate * 100)}%`,
      inline: true,
    },
  ];
  if (s.star) {
    fields.push({ name: '🏆 本周之星', value: `${safeLine(s.star.name, NAME_MAX)}（${formatDelta(s.star.delta)}）`, inline: true });
  }
  if (s.pigeon) {
    fields.push({ name: '🕊️ 本周鸽王', value: `${safeLine(s.pigeon.name, NAME_MAX)}（${formatDelta(s.pigeon.delta)}）`, inline: true });
  }
  return {
    title: `📰 周报 · ${dateOnly(report.week_start)} – ${dateOnly(s.weekEnd)}`,
    description: safeText(report.narrative, LIMITS.embedDescription),
    color: GOLD,
    fields,
    footer: { text: report.source === 'ai' ? '数字由系统统计，文字由 AI 撰写' : '数字由系统统计' },
  };
}

/** The post in the verdict channel, as Discord's REST API takes it. Pings nobody. */
export function reportPost(report: WeeklyReport, frontendUrl: string): ChannelMessage {
  const web = linkButton('在网页查看', webUrl(frontendUrl));
  return {
    embeds: [toEmbed(clampEmbed(reportEmbed(report)))],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: web.label, url: web.url }],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
