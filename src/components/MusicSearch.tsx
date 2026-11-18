import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MUSIC_QUEUE_LIMIT, type MusicTrack } from '@shared/music';
import { ApiError } from '../api';
import { formatArtists, formatClock } from '../lib/musicFormat';
import { musicApi, type MusicPlaylist } from '../music-api';
import { MusicCover } from './MusicCover';
import type { MusicCommands } from './useMusicCommands';
import type { FailHandler } from './useMusicView';

const REQUEST_COOLDOWN_MS = 1000;
const TOO_FAST = 429;
const TOO_FAST_FALLBACK = '搜得太快啦，请稍等一秒再试。';
const PENDING_LABEL = '处理中';

interface Problem {
  text: string;
  /** A rate limit is not a fault: it is shown as a gentle hint. */
  polite: boolean;
}

interface Cooldown {
  cooling: boolean;
  start: () => void;
}

function useCooldown(): Cooldown {
  const [cooling, setCooling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const start = (): void => {
    setCooling(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCooling(false), REQUEST_COOLDOWN_MS);
  };
  return { cooling, start };
}

function describe(cause: unknown, fail: FailHandler): Problem {
  const text = fail(cause, { notFoundIsGone: false });
  if (cause instanceof ApiError && cause.status === TOO_FAST) return { text: text || TOO_FAST_FALLBACK, polite: true };
  return { text, polite: false };
}

function ProblemLine({ problem }: { problem: Problem | null }): JSX.Element | null {
  if (!problem) return null;
  return problem.polite
    ? <p className="music-hint" role="status">{problem.text}</p>
    : <p className="community-error" role="alert">{problem.text}</p>;
}

interface ToolProps {
  cooldown: Cooldown;
  fail: FailHandler;
  commands: MusicCommands;
  /** Free places left in the queue. */
  capacity: number;
}

function ResultRow({ track, disabled, commands }: { track: MusicTrack; disabled: boolean; commands: MusicCommands }): JSX.Element {
  const titleId = `music-result-${track.id}`;
  const controlId = `enqueue:${track.id}`;
  return (
    <li className="music-row">
      <MusicCover url={track.coverUrl} size="small" />
      <div className="music-row__text">
        <strong id={titleId}>{track.title}</strong>
        <span className="community-muted">{formatArtists(track)}{track.album ? ` · ${track.album}` : ''}</span>
      </div>
      <span className="music-time">{formatClock(track.durationMs)}</span>
      <div className="music-row__actions">
        <button
          type="button"
          aria-describedby={titleId}
          disabled={disabled || commands.busy}
          onClick={() => void commands.send(controlId, { kind: 'enqueue', tracks: [track] })}
        >
          {commands.isPending(controlId) ? PENDING_LABEL : '加入队列'}
        </button>
      </div>
    </li>
  );
}

function SearchBox({ cooldown, fail, commands, capacity }: ToolProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicTrack[] | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const text = query.trim();
    if (!text || cooldown.cooling) return;
    abort.current?.abort();
    const mine = new AbortController();
    abort.current = mine;
    cooldown.start();
    setLoading(true);
    setProblem(null);
    try {
      const found = await musicApi.search(text, mine.signal);
      if (!mine.signal.aborted) setResults(found.tracks);
    } catch (cause) {
      if (!mine.signal.aborted) setProblem(describe(cause, fail));
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  };

  return (
    <div className="music-tool">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          搜索歌曲
          <input type="search" value={query} maxLength={100} placeholder="歌名或歌手" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="submit" className="community-button" disabled={!query.trim() || cooldown.cooling || loading}>
          {loading ? '搜索中…' : '搜索'}
        </button>
      </form>
      <ProblemLine problem={problem} />
      {results && results.length === 0 && <p className="community-muted" role="status">没有找到相关歌曲。</p>}
      {results && results.length > 0 && (
        <ul className="music-list" aria-label="搜索结果">
          {results.map((track) => (
            <ResultRow key={track.id} track={track} commands={commands} disabled={capacity === 0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function importNotice(total: number, taken: number): string {
  const base = `已提交 ${taken} 首，等待 Music 加入队列。`;
  return taken < total ? `${base}队列最多 ${MUSIC_QUEUE_LIMIT} 首，歌单里余下的 ${total - taken} 首没有加入。` : base;
}

function PlaylistImport({ cooldown, fail, commands, capacity }: ToolProps): JSX.Element {
  const [link, setLink] = useState('');
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const text = link.trim();
    if (!text || cooldown.cooling) return;
    cooldown.start();
    setLoading(true);
    setProblem(null);
    setNotice(null);
    try {
      setPlaylist(await musicApi.playlist(text));
    } catch (cause) {
      setProblem(describe(cause, fail));
    } finally {
      setLoading(false);
    }
  };

  const addAll = async (): Promise<void> => {
    if (!playlist) return;
    const taken = playlist.tracks.slice(0, capacity);
    if (await commands.send('enqueue:playlist', { kind: 'enqueue', tracks: taken })) {
      setNotice(importNotice(playlist.tracks.length, taken.length));
    }
  };

  return (
    <div className="music-tool">
      <form onSubmit={(event) => void load(event)}>
        <label>
          歌单链接或 ID
          <input type="text" value={link} maxLength={300} placeholder="粘贴网易云歌单链接或数字 ID" onChange={(event) => setLink(event.target.value)} />
        </label>
        <button type="submit" disabled={!link.trim() || cooldown.cooling || loading}>
          {loading ? '读取中…' : '读取歌单'}
        </button>
      </form>
      <ProblemLine problem={problem} />
      {playlist && (
        <div className="music-playlist">
          <p><strong>{playlist.name}</strong>，共 {playlist.tracks.length} 首</p>
          {capacity === 0 && <p className="music-hint">队列已满，请先移除一些歌曲。</p>}
          <button
            type="button"
            className="community-button"
            disabled={commands.busy || capacity === 0 || playlist.tracks.length === 0}
            onClick={() => void addAll()}
          >
            {commands.isPending('enqueue:playlist') ? PENDING_LABEL : '全部加入'}
          </button>
        </div>
      )}
      {notice && <p className="music-hint" role="status">{notice}</p>}
    </div>
  );
}

export function MusicSearch(props: Omit<ToolProps, 'cooldown'>): JSX.Element {
  const cooldown = useCooldown();
  return (
    <section className="community-card music-search" aria-labelledby="music-search-title">
      <h2 id="music-search-title">点歌</h2>
      <SearchBox {...props} cooldown={cooldown} />
      <h3 className="music-subtitle">导入网易云歌单</h3>
      <PlaylistImport {...props} cooldown={cooldown} />
    </section>
  );
}
