import { describe, expect, it } from 'vitest';
import { VOICE_EMPTY_NOTICE, VOICE_GAP_NOTICE, VOICE_MINUTE_NOTE, voiceDaysRecentFirst, voiceDuration,
  voiceFirstJoinText, voiceHistoryPeriod, voiceInterval } from '../../shared/voicePresentation';
import type { VoiceDay, VoiceDaySegment } from '../../shared/voiceDays';
const segment: VoiceDaySegment = { channel_name: '语音', joined_at: '2026-10-27 12:14:05', left_at: '2026-10-27 12:14:25',
  start_reason: 'joined', end_reason: 'left', continued: false };
const day = (date = '2026-10-27'): VoiceDay => ({ date, first_join: segment.joined_at, total_min: 0, segments: [segment] });
describe('voice presentation shared by web and Discord', () => {
  it.each([[0,'0分钟'],[0.9,'0分钟'],[35,'35分钟'],[60,'1小时'],[65,'1小时5分钟'],[155,'2小时35分钟'],[-1,'—'],[NaN,'—'],[Infinity,'—']])('formats %s minutes without inventing precision', (value, expected) => {
    expect(voiceDuration(value as number)).toBe(expected);
  });
  it('preserves a short segment in seconds even when its daily minutes are zero', () => {
    expect(voiceInterval(segment.joined_at,segment.left_at,8,'2026-10-27')).toBe('20:14:05 – 20:14:25');
    expect(voiceFirstJoinText(day(),8)).toBe('首次进入 20:14:05');
    expect(VOICE_MINUTE_NOTE).toContain('向下取整');
  });
  it('keeps the original cross-midnight and cross-year endpoints', () => {
    expect(voiceInterval('2025-12-31 15:30:00','2025-12-31 16:30:00',8,'2026-01-01'))
      .toBe('12-31 23:30:00 – 00:30:00');
    expect(voiceInterval('2026-10-27 00:30:15','2026-10-27 01:30:25',-3.5,'2026-10-26'))
      .toBe('21:00:15 – 22:00:25');
  });
  it('retains both dates and seconds for gaps without a day context', () => {
    expect(voiceInterval('2026-10-27 02:00:10','2026-10-27 02:00:30',8))
      .toBe('10-27 10:00:10 – 10-27 10:00:30');
  });
  it('does not turn an unclosed segment into realtime presence', () => {
    expect(voiceInterval(segment.joined_at,null,8,'2026-10-27')).toBe('20:14:05 – 尚未记录离开');
  });
  it('distinguishes continuation and an unknown first join without inventing an arrival', () => {
    expect(voiceFirstJoinText({...day(),first_join:null,segments:[{...segment,continued:true}]},8)).toBe('接上一天');
    expect(voiceFirstJoinText({...day(),first_join:null},8)).toBe('首次进入时间未记录');
  });
  it('uses only valid full calendar dates in a period', () => {
    expect(voiceHistoryPeriod([day('2026-01-01'),day('2025-12-31')])).toBe('2025-12-31 — 2026-01-01');
    expect(voiceHistoryPeriod([day('@everyone'),day('2026-02-30')])).toBe('日期范围未知');
  });
  it('sorts latest dates first without mutating the server response or dropping empty dates', () => {
    const older=day('2026-10-26'); const empty={...day(),segments:[],first_join:null}; const input=[older,empty];
    expect(voiceDaysRecentFirst(input)).toEqual([empty,older]); expect(input).toEqual([older,empty]);
  });
  it('does not attribute every coverage gap to the bot being offline', () => {
    expect(VOICE_GAP_NOTICE).toBe('这些时段没有完整记录，没有记录不代表没来。');
    expect(VOICE_EMPTY_NOTICE).toBe('没有保存的语音记录，不代表没来');
  });
  it('rejects invalid endpoints instead of echoing them into a message', () => {
    expect(voiceInterval('@everyone','<@123>',8)).toBe('— – —');
  });
});
