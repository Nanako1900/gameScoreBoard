import { describe, expect, it } from 'vitest';
import {
  VOICE_BOT_DAYS_MAX, VOICE_HEARTBEAT_MS, VOICE_RANGE_MAX_DAYS, VOICE_RETENTION_DAYS,
  VOICE_UNKNOWN_CHANNEL, voiceNotice,
} from '../../shared/voice';
import { voiceDays, voiceRangeBounds, type CoverageRow, type VoiceSegmentRow } from '../../shared/voiceDays';

const FROM = '2026-10-26';
const TO = '2026-10-27';
const NOW = '2026-10-28 00:00:00';
const segment = (joined_at: string, left_at: string | null, channel_name = '开黑一号'): VoiceSegmentRow => ({
  channel_name, joined_at, left_at, start_reason: 'joined', end_reason: left_at === null ? null : 'left',
});
function compute(segments: readonly VoiceSegmentRow[] = [], coverage: readonly CoverageRow[] = [], options: {
  from?: string; to?: string; offsetHours?: number; now?: string;
} = {}) {
  return voiceDays({ segments, coverage, from: FROM, to: TO, offsetHours: 0, now: NOW, ...options });
}

describe('voice evidence constants and disclosure', () => {
  it('keeps one retention period and the fixed notice shared by every entry', () => {
    expect(VOICE_RETENTION_DAYS).toBe(90);
    expect(VOICE_RANGE_MAX_DAYS).toBe(31);
    expect(VOICE_BOT_DAYS_MAX).toBe(14);
    expect(VOICE_HEARTBEAT_MS).toBe(60_000);
    expect(VOICE_UNKNOWN_CHANNEL).toBe('未知频道');
    expect(voiceNotice()).toBe(`绑定后，你在本服务器语音频道的进出时间会被记录，保存 ${VOICE_RETENTION_DAYS} 天，供裁判处理迟到、缺席时参考。只有裁判、管理员和你自己能看到。`);
  });
});

describe('board-date voice range bounds', () => {
  it('includes both board dates and returns an exclusive UTC end', () => {
    expect(voiceRangeBounds(FROM, TO, 8)).toEqual({ start: '2026-10-25 16:00:00', end: '2026-10-27 16:00:00' });
    expect(voiceRangeBounds(FROM, FROM, 0)).toEqual({ start: '2026-10-26 00:00:00', end: '2026-10-27 00:00:00' });
  });
  it.each([
    [5.5, '2026-10-25 18:30:00', '2026-10-26 18:30:00'],
    [-3.5, '2026-10-26 03:30:00', '2026-10-27 03:30:00'],
  ])('supports the existing fractional board offset %s', (offset, start, end) => {
    expect(voiceRangeBounds(FROM, FROM, offset)).toEqual({ start, end });
  });
  it.each(['2026-2-01', '2026-02-30', '2026-13-01', '2026-10-00', '2026-10-26T00:00:00Z', 'bad'])('rejects an invalid calendar date %s', (date) => {
    expect(() => voiceRangeBounds(date, TO, 8)).toThrow(RangeError);
  });
  it('rejects reverse ranges, more than 31 inclusive days and nonfinite offsets', () => {
    expect(() => voiceRangeBounds(TO, FROM, 8)).toThrow(RangeError);
    expect(() => voiceRangeBounds('2026-10-01', '2026-11-01', 8)).toThrow(RangeError);
    expect(voiceRangeBounds('2026-10-01', '2026-10-31', 8)).toEqual({ start: '2026-09-30 16:00:00', end: '2026-10-31 16:00:00' });
    for (const offset of [NaN, Infinity, -Infinity]) expect(() => voiceRangeBounds(FROM, TO, offset)).toThrow(RangeError);
  });
  it('does not depend on the host timezone', () => {
    const original = process.env.TZ;
    try {
      for (const zone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
        process.env.TZ = zone;
        expect(voiceRangeBounds(FROM, TO, 8)).toEqual({ start: '2026-10-25 16:00:00', end: '2026-10-27 16:00:00' });
      }
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });
});

describe('voice days', () => {
  it('includes a crossing segment on both days, accumulating only each day overlap', () => {
    const row = segment('2026-10-26 23:30:00', '2026-10-27 00:30:00');
    const { days } = compute([row]);
    expect(days).toEqual([
      { date: FROM, first_join: row.joined_at, total_min: 30, segments: [{ ...row, continued: false }] },
      { date: TO, first_join: null, total_min: 30, segments: [{ ...row, continued: true }] },
    ]);
  });
  it('retains a segment that began before the requested range as continued', () => {
    const row = segment('2026-10-26 23:30:00', '2026-10-27 00:30:00');
    expect(compute([row], [], { from: TO }).days).toEqual([
      { date: TO, first_join: null, total_min: 30, segments: [{ ...row, continued: true }] },
    ]);
  });
  it('takes first_join only from segments actually begun on the day', () => {
    const continued = segment('2026-10-26 23:30:00', '2026-10-27 00:30:00');
    const begun = segment('2026-10-27 01:00:00', '2026-10-27 01:20:00');
    expect(compute([begun, continued], [], { from: TO }).days[0]).toMatchObject({
      first_join: begun.joined_at, total_min: 50, segments: [{ continued: true }, { continued: false }],
    });
  });
  it('uses now for open segments without inventing an end timestamp', () => {
    const row = segment('2026-10-27 10:00:00', null);
    expect(compute([row], [], { from: TO, now: '2026-10-27 10:45:30' }).days).toEqual([
      { date: TO, first_join: row.joined_at, total_min: 45, segments: [{ ...row, continued: false }] },
    ]);
  });
  it.each([null, '2026-10-27 10:00:02'])('ignores a segment that starts after the fixed read snapshot: left=%s', (left) => {
    const row = segment('2026-10-27 10:00:01', left);
    expect(compute([row], [], { from: TO, now: '2026-10-27 10:00:00' }).days[0])
      .toEqual({ date: TO, first_join: null, total_min: 0, segments: [] });
  });
  it('caps a newly closed segment at the fixed read snapshot while preserving the stored fields', () => {
    const row = segment('2026-10-27 09:58:30', '2026-10-27 10:02:00');
    expect(compute([row], [], { from: TO, now: '2026-10-27 10:00:00' }).days[0])
      .toEqual({ date: TO, first_join: row.joined_at, total_min: 1, segments: [{ ...row, continued: false }] });
  });
  it('still refuses a persisted closed segment whose real end precedes its start', () => {
    const row = segment('2026-10-27 10:00:02', '2026-10-27 10:00:01');
    expect(() => compute([row], [], { from: TO, now: '2026-10-27 10:00:00' })).toThrow(RangeError);
  });
  it('sums all daily seconds before rounding down once to minutes', () => {
    const rows = [segment('2026-10-27 11:00:00', '2026-10-27 11:00:40'), segment('2026-10-27 10:00:10', '2026-10-27 10:00:50')];
    const day = compute(rows, [], { from: TO }).days[0];
    expect(day.total_min).toBe(1);
    expect(day.first_join).toBe('2026-10-27 10:00:10');
    expect(day.segments.map((row) => row.joined_at)).toEqual(['2026-10-27 10:00:10', '2026-10-27 11:00:00']);
  });
  it('splits at the +8 board midnight rather than UTC midnight', () => {
    const row = segment('2026-10-26 15:30:00', '2026-10-26 16:30:00');
    const { days } = compute([row], [], { offsetHours: 8 });
    expect(days[0]).toMatchObject({ date: FROM, first_join: row.joined_at, total_min: 30 });
    expect(days[1]).toMatchObject({ date: TO, first_join: null, total_min: 30, segments: [{ continued: true }] });
  });
  it('does not duplicate a segment that ends exactly at midnight', () => {
    const row = segment('2026-10-26 23:30:00', '2026-10-27 00:00:00');
    const { days } = compute([row]);
    expect(days[0].total_min).toBe(30);
    expect(days[1]).toEqual({ date: TO, first_join: null, total_min: 0, segments: [] });
  });
  it('keeps second-resolution zero-length visits inside a day as evidence', () => {
    const row = segment('2026-10-27 10:00:00', '2026-10-27 10:00:00');
    expect(compute([row], [], { from: TO }).days[0]).toEqual({ date: TO, first_join: row.joined_at, total_min: 0, segments: [{ ...row, continued: false }] });
  });
  it('outputs every requested day, including empty days', () => {
    expect(compute().days).toEqual([
      { date: FROM, first_join: null, total_min: 0, segments: [] },
      { date: TO, first_join: null, total_min: 0, segments: [] },
    ]);
  });
  it('projects declared public segment fields and never mutates the input', () => {
    const row = Object.freeze({ ...segment('2026-10-27 10:00:00', '2026-10-27 10:01:00'), discord_user_id: 'private-account', channel_id: 'private-channel' });
    const rows = Object.freeze([row]);
    const result = compute(rows, [], { from: TO });
    expect(Object.keys(result.days[0].segments[0]).sort()).toEqual(['channel_name', 'continued', 'end_reason', 'joined_at', 'left_at', 'start_reason']);
    expect(JSON.stringify(result)).not.toMatch(/private-account|private-channel|discord_|channel_id/);
    expect(row).not.toHaveProperty('continued');
  });
});

describe('persisted voice coverage gaps', () => {
  it('reports the whole observed range when no coverage exists', () => {
    expect(compute().gaps).toEqual([{ from: '2026-10-26 00:00:00', to: '2026-10-28 00:00:00' }]);
  });
  it('merges unordered, overlapping and adjacent rows before subtracting coverage', () => {
    const coverage = [
      { started_at: '2026-10-27 11:00:00', last_seen_at: '2026-10-27 13:00:00' },
      { started_at: '2026-10-27 10:00:00', last_seen_at: '2026-10-27 12:00:00' },
      { started_at: '2026-10-27 13:00:00', last_seen_at: '2026-10-27 14:00:00' },
    ];
    const original = JSON.stringify(coverage);
    expect(compute([], coverage, { from: TO }).gaps).toEqual([
      { from: '2026-10-27 00:00:00', to: '2026-10-27 10:00:00' },
      { from: '2026-10-27 14:00:00', to: '2026-10-28 00:00:00' },
    ]);
    expect(JSON.stringify(coverage)).toBe(original);
  });
  it('shows an internal gap and clips coverage to the requested observed period', () => {
    expect(compute([], [
      { started_at: '2026-10-26 23:00:00', last_seen_at: '2026-10-27 10:00:00' },
      { started_at: '2026-10-27 11:00:00', last_seen_at: '2026-10-28 02:00:00' },
    ], { from: TO }).gaps).toEqual([{ from: '2026-10-27 10:00:00', to: '2026-10-27 11:00:00' }]);
  });
  it('does not extend a fresh heartbeat to now, even within the former 120-second grace', () => {
    expect(compute([], [{ started_at: '2026-10-27 00:00:00', last_seen_at: '2026-10-27 10:00:00' }],
      { from: TO, now: '2026-10-27 10:00:20' }).gaps).toEqual([{ from: '2026-10-27 10:00:00', to: '2026-10-27 10:00:20' }]);
  });
  it('does not infer coverage across midnight from a fresh previous-day heartbeat', () => {
    expect(compute([], [{ started_at: '2026-10-26 23:00:00', last_seen_at: '2026-10-26 23:59:30' }],
      { from: TO, now: '2026-10-27 00:00:30' }).gaps).toEqual([{ from: '2026-10-27 00:00:00', to: '2026-10-27 00:00:30' }]);
  });
  it('stops gaps at now and does not label future time as observed', () => {
    expect(compute([], [], { from: TO, now: '2026-10-27 10:00:00' }).gaps).toEqual([{ from: '2026-10-27 00:00:00', to: '2026-10-27 10:00:00' }]);
    expect(compute([], [], { from: TO, now: '2026-10-26 23:00:00' }).gaps).toEqual([]);
  });
});
