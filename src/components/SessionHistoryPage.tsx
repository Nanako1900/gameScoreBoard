import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTENDANCE_MAP, ATTENDANCES, SESSION_HISTORY_PAGE, SESSION_STATUS_LABEL } from '@shared/attendance';
import { getSessionHistory } from '../api';
import type { HistorySessionItem } from '../types';
import { goBack } from '../lib/router';
import { sessionPath } from '../lib/routes';
import { clockOn, parseTimestamp } from '../lib/time';
import { Link } from './Link';
import { Modal } from './Modal';
import { PageBar } from './PageBar';
import './session-history.css';

const HOUR_MS = 3_600_000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function historyTime(value: string, offset?: number): string {
  const ms = parseTimestamp(value);
  const d = new Date(ms + (offset ?? 0) * HOUR_MS);
  const month = offset === undefined ? d.getMonth() + 1 : d.getUTCMonth() + 1;
  const day = offset === undefined ? d.getDate() : d.getUTCDate();
  const weekday = offset === undefined ? d.getDay() : d.getUTCDay();
  return `${month}/${day} ${WEEKDAYS[weekday]} ${clockOn(ms, offset)}`;
}
function HistoryRow({ session: s, offset }: { session: HistorySessionItem; offset?: number }): JSX.Element {
  const attendance = s.status === 'settled' ? ATTENDANCES.filter((kind) => s.attendance_summary[kind] > 0)
    .map((kind) => `${ATTENDANCE_MAP[kind].label} ${s.attendance_summary[kind]}`).join(' · ') : '';
  return <li><Link className={`shist__row shist__row--${s.status}`} to={sessionPath(s.id)}>
    <span>{historyTime(s.starts_at, offset)} · {s.title || s.game} · {SESSION_STATUS_LABEL[s.status]}{attendance && ` · ${attendance}`}</span>
    {s.status === 'cancelled' && s.cancel_reason && <span className="shist__reason">{s.organizer.username}：{s.cancel_reason}</span>}
  </Link></li>;
}
function useHistoryRows() {
  const [rows, setRows] = useState<HistorySessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mounted = useRef(false);
  const cursor = useRef<number | undefined>(undefined);
  const load = useCallback(async (before?: number): Promise<void> => {
    cursor.current = before; setLoading(true);
    try {
      const page = await getSessionHistory(before);
      if (!mounted.current) return;
      setUnsupported(page === undefined); setFailed(false);
      if (page) setRows((old) => before === undefined ? page : [...old, ...page]);
      setMore(page?.length === SESSION_HISTORY_PAGE); setLoaded(true);
    } catch { if (mounted.current) setFailed(true); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);
  return { rows, loading, failed, unsupported, more, loaded, load, retry: () => load(cursor.current) };
}
export function SessionHistoryPage({ boardTzOffsetHours }: { boardTzOffsetHours?: number }): JSX.Element {
  const data = useHistoryRows();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (data.loaded) title.current?.focus(); }, [data.loaded]);
  return <Modal open variant="page" labelledBy="history-page-title" onClose={goBack}>
    <PageBar backLabel="返回" onBack={goBack} />
    <section className="shist"><h2 id="history-page-title" ref={title} tabIndex={-1}>约局历史</h2>
      {data.failed && <p role="status">这块没加载出来，你的操作没丢。<button type="button" className="btn btn--ghost" onClick={() => void data.retry()}>重试</button></p>}
      {data.unsupported ? <p>这个服务器还不支持约局历史。</p> : <>
        <ul>{data.rows.map((s) => <HistoryRow key={s.id} session={s} offset={boardTzOffsetHours} />)}</ul>
        {data.loading ? <p>加载中…</p> : !data.failed && data.rows.length === 0 && <p>还没有开过的局。</p>}
        {data.more && <button type="button" className="btn btn--ghost" disabled={data.loading}
          onClick={() => void data.load(data.rows[data.rows.length - 1].id)}>{data.loading ? '加载中…' : '加载更多'}</button>}
      </>}
    </section>
  </Modal>;
}
