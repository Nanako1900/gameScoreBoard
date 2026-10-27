// One public board: explicitly project fixed public fields at the DB boundary.
// Pending cases contribute only a count. No case free text or Discord account
// reference is part of BoardData, and names are inert before reaching Discord.
import { ButtonStyle, ComponentType } from 'discord.js';
import { competitionRanks } from '../../../shared/rank';
import { VIOLATION_MAP } from '../../../shared/scoring';
import { listRecords } from '../../../worker/case-reads';
import { getLeaderboard } from '../../../worker/db';
import { getLatestReport } from '../../../worker/report';
import { toEmbed } from './client';
import { reportEmbed } from './report';
import { GOLD, RED, clampEmbed, clampReply, discordTime, fitLines, formatDelta, joinUrl, linkButton, safeLine, webUrl } from './render';
import type { BotEmbed } from './types';
import type { ChannelMessage } from './verdict';

const TOP_COUNT = 15;
const RECENT_COUNT = 5;
const NAME_MAX = 64;
const LABEL_MAX = 64;
const REPORT_MAX = 160;
// Reserve space for all three sections before the aggregate clamp. Keeping
// complete lines avoids cutting an inline URL or Discord timestamp in half.
const TOP_BUDGET = 1600;
const RECENT_BUDGET = 3000;
const REPORT_BUDGET = 800;

export interface BoardData {
  top: { rank: number; name: string; score: number }[];
  recent: { id: number; subject: string; typeLabel: string; delta: number; at: string }[];
  pending: number;
  report: { weekStart: string; line: string } | null;
  updatedAt: number;
}

export async function loadBoardData(db: D1Database): Promise<BoardData> {
  const updatedAt = Date.now();
  const [participants, records, pending, report] = await Promise.all([
    getLeaderboard(db),
    listRecords(db, { status: 'decided', penaltyOnly: true, limit: RECENT_COUNT }),
    db.prepare("SELECT COUNT(*) AS n FROM records WHERE status IN ('awaiting_statement', 'judging')").first<{ n: number }>(),
    getLatestReport(db),
  ]);
  const top = participants.slice(0, TOP_COUNT);
  const ranks = competitionRanks(top.map((person) => person.score));
  return {
    top: top.map((person, index) => ({ rank: ranks[index], name: person.username, score: person.score })),
    recent: records.map((record) => ({ id: record.id, subject: record.subject.username,
      typeLabel: VIOLATION_MAP[record.type].label, delta: record.delta, at: record.created_at })),
    pending: pending?.n ?? 0,
    // The existing report title is a short, public line; narrative and award
    // names are not needed on the board and never enter this projection.
    report: report ? { weekStart: report.week_start, line: reportEmbed(report).title ?? '' } : null,
    updatedAt,
  };
}

export function boardMessage(data: BoardData, frontendUrl: string): ChannelMessage {
  const top = data.top.slice(0, TOP_COUNT).map((person) =>
    `${person.rank}\\. ${safeLine(person.name, NAME_MAX) || '未命名玩家'} — ${person.score} 分`);
  const recent = data.recent.slice(0, RECENT_COUNT).map((record) =>
    `${safeLine(record.subject, NAME_MAX) || '未命名玩家'} · ${safeLine(record.typeLabel, LABEL_MAX)} · ${formatDelta(record.delta)} · ${discordTime(record.at, 'R')} · [查看](${webUrl(frontendUrl, { case: record.id })})`);
  const dynamic = [data.pending === 0 ? '目前没有处理中的记录' : `目前有 ${data.pending} 起记录在处理中`];
  if (data.report) {
    const line = `${safeLine(data.report.line, REPORT_MAX)} · [查看战报](${joinUrl(frontendUrl, '/board/report')})`;
    dynamic.push(fitLines([line], REPORT_BUDGET, () => '最新战报请打开网页查看'));
  }
  const updated = Number.isFinite(data.updatedAt) ? `<t:${Math.floor(data.updatedAt / 1000)}:R>` : '—';
  dynamic.push(`更新于 ${updated}`);
  const embeds: BotEmbed[] = [
    { title: '信誉榜', description: top.length ? fitLines(top, TOP_BUDGET) : '榜上还没有选手。', color: GOLD },
    { title: '最近判决', description: recent.length ? fitLines(recent, RECENT_BUDGET, (n) => `…还有 ${n} 起判决`) : '最近没有已判决的扣分记录。', color: RED },
    { title: '动态', description: dynamic.join('\n'), color: GOLD },
  ].map(clampEmbed);
  const web = linkButton('打开网页', webUrl(frontendUrl));
  return {
    // clampEmbed alone does not enforce the 6000-character message total.
    embeds: (clampReply({ ephemeral: false, embeds }).embeds ?? []).map(toEmbed),
    components: [{ type: ComponentType.ActionRow, components: [
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '我的情况', custom_id: 'v1:board:me' },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: '语音记录', custom_id: 'v1:board:voice' },
      { type: ComponentType.Button, style: ButtonStyle.Link, label: web.label, url: web.url },
    ] }],
    allowed_mentions: { parse: [] },
  };
}
