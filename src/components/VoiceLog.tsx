import { useEffect, useId, useState, type ReactNode } from 'react';
import { boardTzLabel } from '@shared/boardTime';
import { VOICE_RETENTION_DAYS } from '@shared/voice';
import { firstAvailableVoiceDate, type VoiceDay, type VoiceGap } from '@shared/voiceDays';
import { VOICE_EMPTY_NOTICE, VOICE_GAP_EXPLANATION, VOICE_GAP_NOTICE, VOICE_MINUTE_NOTE,
  voiceDayLabel, voiceDaysRecentFirst, voiceDuration, voiceFirstJoinText, voiceHistoryPeriod, voiceInterval, voiceSegmentNotes, voiceTime } from '@shared/voicePresentation';
import type { VoiceDayResponse, VoiceHistoryResponse } from '@shared/voiceApi';
import { ApiError, getVoiceDay, getVoiceHistory } from '../api';
import { adminVoicePath } from '../lib/routes';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { Link } from './Link';
import { NotFound } from './NotFound';
import './voice-log.css';

interface VoiceLogProps {
  ownerId: string;
  userId: string | null;
  offsetHours: number;
  personPath?: (userId: string) => string;
  /** Embedded personal modules can replace the whole-route 404 presentation. */
  missingContent?: ReactNode;
}
type RangeDays = 7 | 14 | 31;
type ReadState =
  | { key: string; status: 'loading' | 'missing' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'day'; data: VoiceDayResponse }
  | { key: string; status: 'history'; data: VoiceHistoryResponse };
const DAY_MS = 86_400_000;
const utc = (now: number): string => new Date(now).toISOString().slice(0, 19).replace('T', ' ');
const boardToday = (now: number, offset: number): string => new Date(now + offset * 3_600_000).toISOString().slice(0, 10);
const daysBefore = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

function CoverageGaps({ gaps, offsetHours }: { gaps: readonly VoiceGap[]; offsetHours: number }): JSX.Element | null {
  if (gaps.length === 0) return null;
  return <aside className="voice-log__gaps" role="note" aria-label="未覆盖时段">
    <header className="voice-log__gap-heading"><h3>未覆盖时段</h3><p className="voice-log__gap-count">有 {gaps.length} 段未覆盖</p></header>
    <p>{VOICE_GAP_NOTICE}</p><p>{VOICE_GAP_EXPLANATION}</p>
    <details className="voice-log__gap-details"><summary>查看完整未覆盖时间</summary>
      <ul>{gaps.map((gap, index) => <li key={`${gap.from}:${gap.to}:${index}`}>
        <span className="voice-log__interval">{voiceInterval(gap.from, gap.to, offsetHours)}</span>
      </li>)}</ul>
    </details>
  </aside>;
}

function DailyHistory({ day, offsetHours }: { day: VoiceDay; offsetHours: number }): JSX.Element {
  const dateLabel = voiceDayLabel(day.date);
  if (day.segments.length === 0) return <article className="voice-log__day voice-log__day--empty" aria-label={dateLabel}>
    <h4><time dateTime={day.date}>{dateLabel}</time></h4><p className="voice-log__empty">无保存记录</p>
  </article>;
  return <article className="voice-log__day" aria-label={dateLabel}>
    <header className="voice-log__day-head"><h4><time dateTime={day.date}>{dateLabel}</time></h4>
      <p className="voice-log__total">累计 {voiceDuration(day.total_min)}</p></header>
    <p className="voice-log__first">{voiceFirstJoinText(day, offsetHours)}</p>
    <ul className="voice-log__segments">{day.segments.map((segment, index) => {
        // The interval already labels an open endpoint. Keep the estimate and
        // all other evidence qualifications alongside the corresponding row.
        const notes = voiceSegmentNotes(segment).filter(note => note !== '尚未记录离开');
        return <li key={`${segment.joined_at}:${index}`}>
          <strong className="voice-log__channel">{segment.channel_name}</strong>
          <p className="voice-log__interval">{voiceInterval(segment.joined_at, segment.left_at, offsetHours, day.date)}</p>
          {notes.length > 0 && <ul className="voice-log__notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>}
        </li>;
      })}</ul>
  </article>;
}

/** The request key hides old evidence in the first render after any scope change. */
export function VoiceLog({ ownerId, userId, offsetHours, personPath = adminVoicePath, missingContent }: VoiceLogProps): JSX.Element {
  const dateId = useId(); const rangeId = useId();
  const now = Date.now();
  const today = boardToday(now, offsetHours);
  const min = firstAvailableVoiceDate(utc(now), offsetHours);
  const [date, setDate] = useState(today);
  const [range, setRange] = useState<RangeDays>(7);
  const [retry, setRetry] = useState(0);
  const from = daysBefore(today, range - 1);
  const key = JSON.stringify([ownerId, userId, userId === null ? date : from, today, offsetHours, retry]);
  const [read, setRead] = useState<ReadState>({ key, status: 'loading' });

  useEffect(() => {
    let current = true;
    setRead({ key, status: 'loading' });
    const request = userId === null
      ? getVoiceDay(date).then((data): ReadState => ({ key, status: 'day', data }))
      : getVoiceHistory(userId, from, today).then((data): ReadState => ({ key, status: 'history', data }));
    void request.then((result) => { if (current) setRead(result); }, (error: unknown) => {
      if (!current) return;
      setRead(error instanceof ApiError && error.status === 404 ? { key, status: 'missing' }
        : { key, status: 'error', message: error instanceof ApiError ? error.message : '读取语音记录失败，请稍后重试' });
    });
    return () => { current = false; };
  }, [key]);

  const visible: ReadState = read.key === key ? read : { key, status: 'loading' };
  if (visible.status === 'missing') return missingContent === undefined ? <NotFound title={NOT_FOUND_TITLE} /> : <>{missingContent}</>;
  return <div className="voice-log">
    <h3>{visible.status === 'history' ? `${visible.data.user.username}的语音记录` : userId === null ? '当天语音记录' : '个人语音记录'}</h3>
    <p className="voice-log__hint">记录保留 {visible.status === 'day' || visible.status === 'history' ? visible.data.retention_days : VOICE_RETENTION_DAYS} 天 · {boardTzLabel(offsetHours)}</p>
    {userId === null ? <div className="voice-log__controls"><label htmlFor={dateId}>日期</label>
      <input id={dateId} type="date" min={min} value={date} onChange={(event) => setDate(event.target.value)} /></div>
      : <div className="voice-log__controls"><label htmlFor={rangeId}>查询范围</label>
        <select id={rangeId} value={range} onChange={(event) => {
          const next = Number(event.target.value); if (next === 7 || next === 14 || next === 31) setRange(next);
        }}><option value={7}>最近 7 天</option><option value={14}>最近 14 天</option><option value={31}>最近 31 天</option></select>
        <p>{visible.status === 'history' ? voiceHistoryPeriod(visible.data.days) : `${from} — ${today}`}</p></div>}
    {visible.status === 'loading' && <p role="status">正在读取语音记录…</p>}
    {visible.status === 'error' && <div><p role="alert">{visible.message}</p>
      <button type="button" className="btn btn--ghost" onClick={() => setRetry((value) => value + 1)}>重新读取</button></div>}
    {visible.status === 'day' && <>
      <p className="voice-log__hint">{VOICE_MINUTE_NOTE}</p>
      <CoverageGaps gaps={visible.data.gaps} offsetHours={offsetHours} />
      {visible.data.users.length === 0 ? <p className="voice-log__empty">{VOICE_EMPTY_NOTICE}</p>
        : <ul className="voice-log__people">{visible.data.users.map((person) => <li key={person.user.id}>
          <Link to={personPath(person.user.id)} className="voice-log__person">
            <strong className="voice-log__person-name">{person.user.username}</strong>
            <span className="voice-log__total">累计 {voiceDuration(person.total_min)}</span>
            <span className="voice-log__person-first">{person.first_join === null ? '首次进入时间未记录' : `首次进入 ${voiceTime(person.first_join, offsetHours, false, true)}`}</span>
            {(person.in_voice_now || person.has_open_segment) && <span className="voice-log__person-notes">{person.in_voice_now ? <span className="voice-log__presence">在语音里</span>
              : person.has_open_segment ? <span className="voice-log__uncertain">尚未记录离开</span> : null}
              {person.has_open_segment && <span className="voice-log__uncertain">时长按查询时刻估算</span>}</span>}
          </Link>
        </li>)}</ul>}
    </>}
    {visible.status === 'history' && <>
      <p className="voice-log__hint">{VOICE_MINUTE_NOTE}</p>
      <CoverageGaps gaps={visible.data.gaps} offsetHours={offsetHours} />
      {visible.data.days.some(day => day.segments.length === 0) && <p className="voice-log__empty">{VOICE_EMPTY_NOTICE}</p>}
      <div className="voice-log__days">{voiceDaysRecentFirst(visible.data.days).map((day) => <DailyHistory key={day.date} day={day} offsetHours={offsetHours} />)}</div>
    </>}
  </div>;
}
