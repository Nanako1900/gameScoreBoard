import { useEffect, useState } from 'react';
import { musicPosition, MUSIC_VOLUME_MAX, type MusicQueueItem, type MusicState } from '@shared/music';
import { formatArtists, formatClock, MUSIC_MODE_LABELS, nextMusicMode } from '../lib/musicFormat';
import { CommitRange } from './CommitRange';
import { MusicCover } from './MusicCover';
import type { MusicCommands } from './useMusicCommands';

const PROGRESS_TICK_MS = 500;
const MS_PER_SECOND = 1000;
const PENDING_LABEL = '处理中';

/** A clock that only ticks while something is moving, so a paused player costs nothing. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

interface PlayerProps {
  state: MusicState;
  commands: MusicCommands;
  /** Added to the browser clock to get the server's. */
  clockOffsetMs: number;
}

function NowPlaying({ item }: { item: MusicQueueItem }): JSX.Element {
  return (
    <div className="music-now">
      <MusicCover url={item.track.coverUrl} size="large" />
      <div className="music-now__text">
        <h2 className="music-now__title">{item.track.title}</h2>
        <p className="community-muted">{formatArtists(item.track)}</p>
        {item.unplayable && <p className="music-hint">这首歌暂时无法播放：{item.unplayable}</p>}
      </div>
    </div>
  );
}

function Progress({ state, commands, clockOffsetMs }: PlayerProps): JSX.Element | null {
  const now = useNow(!state.paused && state.current !== null);
  if (!state.current) return null;
  const duration = state.current.track.durationMs;
  const position = musicPosition(state, now + clockOffsetMs);
  const clock = `${formatClock(position)} / ${formatClock(duration)}`;
  return (
    <div className="music-progress">
      <span className="music-time">{formatClock(position)}</span>
      <CommitRange
        className="music-range"
        label="播放进度"
        min={0}
        max={Math.max(1, Math.ceil(duration / MS_PER_SECOND))}
        value={Math.floor(position / MS_PER_SECOND)}
        valueText={() => clock}
        disabled={commands.busy || duration <= 0}
        holdWhile={commands.isPending('seek')}
        onCommit={(seconds) => void commands.send('seek', { kind: 'seek', positionMs: seconds * MS_PER_SECOND })}
      />
      <span className="music-time">{formatClock(duration)}</span>
    </div>
  );
}

function Transport({ state, commands }: { state: MusicState; commands: MusicCommands }): JSX.Element {
  const toggleKind = state.paused ? 'play' : 'pause';
  const mode = state.mode;
  const upcoming = MUSIC_MODE_LABELS[nextMusicMode(mode)];
  const label = (id: string, text: string): string => (commands.isPending(id) ? PENDING_LABEL : text);
  const hasCurrent = state.current !== null;
  return (
    <div className="music-transport">
      <button
        type="button"
        className="community-button"
        disabled={commands.busy || !hasCurrent}
        onClick={() => void commands.send('toggle', { kind: toggleKind })}
      >
        {label('toggle', state.paused ? '播放' : '暂停')}
      </button>
      <button type="button" disabled={commands.busy || !hasCurrent} onClick={() => void commands.send('skip', { kind: 'skip' })}>
        {label('skip', '下一首')}
      </button>
      <button
        type="button"
        aria-label={`播放模式：${MUSIC_MODE_LABELS[mode]}，点击切换为${upcoming}`}
        disabled={commands.busy}
        onClick={() => void commands.send('mode', { kind: 'mode', mode: nextMusicMode(mode) })}
      >
        {commands.isPending('mode') ? PENDING_LABEL : `模式：${MUSIC_MODE_LABELS[mode]}`}
      </button>
    </div>
  );
}

function Volume({ state, commands }: { state: MusicState; commands: MusicCommands }): JSX.Element {
  return (
    <div className="music-volume">
      <span className="music-volume__label" aria-hidden="true">音量</span>
      <CommitRange
        className="music-range"
        label="音量"
        min={0}
        max={MUSIC_VOLUME_MAX}
        value={state.volume}
        valueText={(value) => `音量 ${value}%`}
        disabled={commands.busy}
        holdWhile={commands.isPending('volume')}
        onCommit={(volume) => void commands.send('volume', { kind: 'volume', volume })}
      />
    </div>
  );
}

function LeaveControl({ commands }: { commands: MusicCommands }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return <button type="button" disabled={commands.busy} onClick={() => setConfirming(true)}>让 Music 离开</button>;
  }
  return (
    <div className="music-leave" role="group" aria-label="确认让 Music 离开">
      <p>让 Music 离开后，播放会停止，队列也会清空。</p>
      <div className="community-actions">
        <button
          type="button"
          className="community-danger"
          disabled={commands.busy}
          onClick={() => void commands.send('leave', { kind: 'leave' })}
        >
          {commands.isPending('leave') ? PENDING_LABEL : '确认离开'}
        </button>
        <button type="button" onClick={() => setConfirming(false)}>取消</button>
      </div>
    </div>
  );
}

export function MusicPlayer({ state, commands, clockOffsetMs }: PlayerProps): JSX.Element {
  return (
    <section className="community-card music-player" aria-label="播放器">
      {state.current ? (
        <NowPlaying item={state.current} />
      ) : (
        <p className="music-empty">队列是空的，搜一首歌开始吧</p>
      )}
      <Progress state={state} commands={commands} clockOffsetMs={clockOffsetMs} />
      {state.notice && <p className="music-notice" role="status">{state.notice}</p>}
      <Transport state={state} commands={commands} />
      <Volume state={state} commands={commands} />
      <LeaveControl commands={commands} />
    </section>
  );
}
