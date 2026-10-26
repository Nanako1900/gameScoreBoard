// Text that reaches Discord must be inert: no markdown, no masked links, no
// auto-linked URLs, no mentions — whatever a display name, a claim or the AI
// narrative contains. These are the escapes every handler relies on.

import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  clampEmbed,
  clampReply,
  discordTime,
  ephemeralReply,
  fitLines,
  formatDelta,
  joinUrl,
  linkButton,
  parseTimestamp,
  publicReply,
  safeLine,
  safeText,
  truncate,
  webUrl,
} from '../src/discord/render';

const ZWSP = '\u200b';

describe('safeText / safeLine', () => {
  it('escapes every markdown character', () => {
    expect(safeLine('**粗体** _斜体_ ~~删除~~ `代码` ||剧透|| > 引用 # 标题 - 列表 (括号) \\'))
      .toBe('\\*\\*粗体\\*\\* \\_斜体\\_ \\~\\~删除\\~\\~ \\`代码\\` \\|\\|剧透\\|\\| \\> 引用 \\# 标题 \\- 列表 \\(括号\\) \\\\');
  });

  it('turns [ ] into full-width so nothing can pose as a masked link', () => {
    const out = safeLine('[写陈述](https://evil.example/steal)');
    expect(out).not.toContain('[');
    expect(out).not.toContain(']');
    expect(out).not.toContain('](');
    expect(out).not.toContain('://');
    expect(out.startsWith('［写陈述］\\(https:')).toBe(true);
  });

  it('defangs URLs of any scheme so they never auto-link', () => {
    for (const url of ['https://evil.example', 'HTTP://evil.example', 'discord://-/channels', '<https://x.example>']) {
      expect(safeLine(url)).not.toMatch(/:\/\//);
    }
    expect(safeLine('see https://a.example and http://b.example')).toBe(
      `see https:${ZWSP}//a.example and http:${ZWSP}//b.example`,
    );
  });

  it('neutralises @everyone and @here', () => {
    for (const text of ['@everyone', 'hi @here!', '@Everyone', '@@everyone']) {
      const out = safeLine(text);
      expect(out.toLowerCase()).not.toContain('@everyone');
      expect(out.toLowerCase()).not.toContain('@here');
    }
    expect(safeLine('@everyone')).toBe(`@${ZWSP}everyone`);
  });

  it('neutralises <@…>, <@&…>, <#…>, <t:…> and custom emoji syntax', () => {
    for (const text of ['<@123456789012345678>', '<@!123>', '<@&42>', '<#42>', '<t:0:R>', '<:pepe:42>', '</cmd:1>']) {
      expect(safeLine(text)).not.toMatch(/<[@#:/t!&]/);
    }
    // '>' is escaped too: at a line start it would open a quote.
    expect(safeLine('<@123>')).toBe(`<${ZWSP}@123\\>`);
  });

  it('keeps ordered-list syntax from forming at a line start', () => {
    expect(safeText('1. 第一\n2. 第二')).toBe('1\\. 第一\n2\\. 第二');
  });

  it('collapses newlines in single-line text but keeps them in multi-line text', () => {
    expect(safeLine('第一行\n\n  第二行\r\n第三行')).toBe('第一行 第二行 第三行');
    expect(safeText('第一段\r\n第二段')).toBe('第一段\n第二段');
  });

  it('drops control characters and bidi overrides', () => {
    expect(safeLine('a\u0000b\u202ec\u2066d\u0007')).toBe('abcd');
    expect(safeLine('a\tb')).toBe('a b');
  });

  it('treats null and undefined as empty', () => {
    expect(safeLine(null)).toBe('');
    expect(safeText(undefined)).toBe('');
  });

  it('leaves ordinary Chinese text and emoji alone', () => {
    expect(safeLine('今晚八点开黑 🎮，不见不散！')).toBe('今晚八点开黑 🎮，不见不散！');
  });

  it('truncates after escaping, so the escaped text is what fits', () => {
    const out = safeLine('*'.repeat(100), 11);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out.endsWith('…')).toBe(true);
    // Never ends in a lone escape backslash that would swallow the ellipsis.
    expect(out).toBe('\\*\\*\\*\\*\\*…');
  });
});

describe('truncate', () => {
  it('leaves text within the limit untouched', () => {
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('cuts to exactly the limit, ellipsis included', () => {
    const out = truncate('a'.repeat(5000), LIMITS.embedDescription);
    expect(out).toHaveLength(LIMITS.embedDescription);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const out = truncate('😀😀😀', 4);
    expect(out).toBe('😀…');
    expect(/[\ud800-\udbff]…$/.test(out)).toBe(false);
  });

  it('handles tiny limits', () => {
    expect(truncate('abcdef', 1)).toBe('…');
    expect(truncate('abcdef', 0)).toBe('');
  });

  it('meets the Discord limits for title, field value and description', () => {
    const long = '名'.repeat(10_000);
    expect(safeLine(long, LIMITS.embedTitle)).toHaveLength(256);
    expect(safeLine(long, LIMITS.fieldValue)).toHaveLength(1024);
    expect(safeText(long, LIMITS.embedDescription)).toHaveLength(4096);
  });
});

describe('fitLines', () => {
  it('keeps every line when they fit', () => {
    expect(fitLines(['a', 'b'], 100)).toBe('a\nb');
  });

  it('drops whole lines and says how many were left out', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `第 ${i} 项 ${'x'.repeat(30)}`);
    const out = fitLines(lines, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toMatch(/…还有 \d+ 项$/);
    for (const line of out.split('\n').slice(0, -1)) expect(lines).toContain(line);
  });
});

describe('helpers', () => {
  it('formats deltas like the web', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-5)).toBe('-5');
    expect(formatDelta(0)).toBe('0');
  });

  it('parses SQLite and ISO timestamps as UTC', () => {
    expect(parseTimestamp('2026-10-19 12:00:00')).toBe(Date.UTC(2026, 9, 19, 12));
    expect(parseTimestamp('2026-10-19T12:00:00.000Z')).toBe(Date.UTC(2026, 9, 19, 12));
    expect(Number.isNaN(parseTimestamp('nope'))).toBe(true);
    expect(Number.isNaN(parseTimestamp(null))).toBe(true);
  });

  it('renders Discord timestamps, or a dash when unparseable', () => {
    expect(discordTime('2026-10-19 12:00:00', 'd')).toBe(`<t:${Date.UTC(2026, 9, 19, 12) / 1000}:d>`);
    expect(discordTime('garbage', 'R')).toBe('—');
  });

  it('joins URLs without doubled slashes', () => {
    expect(joinUrl('https://api.example/', '/link/discord')).toBe('https://api.example/link/discord');
    expect(joinUrl('https://score.example', '/')).toBe('https://score.example/');
  });

  it('links straight to a case or a session in the web app, by id only', () => {
    expect(webUrl('https://score.example')).toBe('https://score.example/');
    expect(webUrl('https://score.example/', { case: 7 })).toBe('https://score.example/?case=7');
    expect(webUrl('https://edg.example/score', { session: 3 })).toBe('https://edg.example/score/?session=3');
    for (const id of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
      expect(() => webUrl('https://score.example', { case: id })).toThrow();
    }
  });

  it('accepts only http(s) link buttons', () => {
    expect(linkButton('绑定', 'https://api.example/link/discord')).toEqual({
      label: '绑定',
      url: 'https://api.example/link/discord',
    });
    expect(() => linkButton('x', 'javascript:alert(1)')).toThrow();
    expect(() => linkButton('x', 'not a url')).toThrow();
  });
});

describe('reply builders', () => {
  it('sets the ephemeral flag', () => {
    expect(ephemeralReply('嗨').ephemeral).toBe(true);
    expect(publicReply('嗨').ephemeral).toBe(false);
  });

  it('clamps each part of an embed to its own limit', () => {
    const embed = clampEmbed({
      title: 't'.repeat(300),
      description: 'd'.repeat(5000),
      fields: Array.from({ length: 30 }, () => ({ name: '', value: 'v'.repeat(2000) })),
      footer: { text: 'f'.repeat(3000) },
    });
    expect(embed.title).toHaveLength(LIMITS.embedTitle);
    expect(embed.description).toHaveLength(LIMITS.embedDescription);
    expect(embed.fields).toHaveLength(LIMITS.embedFields);
    expect(embed.fields?.[0].name).toBe('—');
    expect(embed.fields?.[0].value).toHaveLength(LIMITS.fieldValue);
    expect(embed.footer?.text).toHaveLength(LIMITS.footer);
  });

  it('clamps content, the number of embeds and buttons of a reply', () => {
    const reply = clampReply({
      content: 'x'.repeat(3000),
      embeds: Array.from({ length: 12 }, (_, i) => ({ title: `第 ${i} 个` })),
      buttons: Array.from({ length: 7 }, () => ({ label: 'b', url: 'https://x.example' })),
      ephemeral: false,
    });
    expect(reply.content).toHaveLength(LIMITS.content);
    expect(reply.embeds).toHaveLength(LIMITS.embeds);
    expect(reply.buttons).toHaveLength(LIMITS.buttons);
  });

  it('never produces an empty reply', () => {
    expect(ephemeralReply('').content).toBeTruthy();
  });

  it('keeps all embeds of a message within the shared 6000-character total', () => {
    const total = (r: ReturnType<typeof clampReply>): number =>
      (r.embeds ?? []).reduce(
        (n, e) =>
          n +
          (e.title?.length ?? 0) +
          (e.description?.length ?? 0) +
          (e.footer?.text.length ?? 0) +
          (e.fields ?? []).reduce((m, f) => m + f.name.length + f.value.length, 0),
        0,
      );
    const big = { title: '战报', description: 'd'.repeat(4096), fields: [{ name: '开局', value: '4 局' }] };
    const reply = clampReply({ embeds: [big, big], ephemeral: false });
    expect(total(reply)).toBeLessThanOrEqual(LIMITS.embedTotal);
    // The first embed is untouched; the last one's description gave way.
    expect(reply.embeds?.[0]).toEqual(big);
    expect(reply.embeds?.[1].title).toBe('战报');
    expect(reply.embeds?.[1].description?.endsWith('…')).toBe(true);
    expect(reply.embeds?.[1].fields).toEqual(big.fields);

    // Even embeds made only of fields and footers end up within the total.
    const wide = {
      title: 't'.repeat(256),
      fields: Array.from({ length: 25 }, () => ({ name: 'n'.repeat(256), value: 'v'.repeat(1024) })),
      footer: { text: 'f'.repeat(2048) },
    };
    expect(total(clampReply({ embeds: [wide, wide, wide], ephemeral: false }))).toBeLessThanOrEqual(LIMITS.embedTotal);
  });

  it('drops empty footers and embeds with no text left', () => {
    const reply = clampReply({ embeds: [{ title: '标题', footer: { text: '' } }, { color: 1 }], ephemeral: true });
    expect(reply.embeds).toEqual([{ title: '标题' }]);
  });
});
