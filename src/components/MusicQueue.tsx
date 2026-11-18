import { MUSIC_QUEUE_LIMIT, type MusicQueueItem } from '@shared/music';
import { formatArtists, formatClock } from '../lib/musicFormat';
import { MusicCover } from './MusicCover';
import type { MusicCommands } from './useMusicCommands';

const PENDING_LABEL = '处理中';

interface QueueRowProps {
  item: MusicQueueItem;
  commands: MusicCommands;
}

function QueueRow({ item, commands }: QueueRowProps): JSX.Element {
  const titleId = `music-queue-${item.key}`;
  const nextId = `next:${item.key}`;
  const removeId = `remove:${item.key}`;
  return (
    <li className="music-row">
      <MusicCover url={item.track.coverUrl} size="small" />
      <div className="music-row__text">
        <strong id={titleId}>{item.track.title}</strong>
        <span className="community-muted">{formatArtists(item.track)}</span>
        {item.unplayable && <span className="music-hint">无法播放：{item.unplayable}</span>}
      </div>
      <span className="music-time">{formatClock(item.track.durationMs)}</span>
      <div className="music-row__actions">
        <button
          type="button"
          aria-describedby={titleId}
          disabled={commands.busy}
          onClick={() => void commands.send(nextId, { kind: 'move_next', key: item.key })}
        >
          {commands.isPending(nextId) ? PENDING_LABEL : '下一首播放'}
        </button>
        <button
          type="button"
          aria-describedby={titleId}
          disabled={commands.busy}
          onClick={() => void commands.send(removeId, { kind: 'remove', key: item.key })}
        >
          {commands.isPending(removeId) ? PENDING_LABEL : '移除'}
        </button>
      </div>
    </li>
  );
}

interface MusicQueueProps {
  queue: MusicQueueItem[];
  /** Free places left; the playing track already counts against the limit. */
  capacity: number;
  commands: MusicCommands;
}

export function MusicQueue({ queue, capacity, commands }: MusicQueueProps): JSX.Element {
  const used = MUSIC_QUEUE_LIMIT - capacity;
  return (
    <section className="community-card music-queue" aria-labelledby="music-queue-title">
      <div className="music-queue__head">
        <h2 id="music-queue-title">播放队列</h2>
        <span className="community-muted" aria-label={`队列（含正在播放）共 ${used} 首，上限 ${MUSIC_QUEUE_LIMIT} 首`}>
          {used} / {MUSIC_QUEUE_LIMIT}
        </span>
        <button
          type="button"
          disabled={commands.busy || queue.length === 0}
          onClick={() => void commands.send('clear', { kind: 'clear' })}
        >
          {commands.isPending('clear') ? PENDING_LABEL : '清空队列'}
        </button>
      </div>
      {queue.length === 0 ? (
        <p className="community-muted">接下来没有歌曲了。</p>
      ) : (
        <ol className="music-list">
          {queue.map((item) => <QueueRow key={item.key} item={item} commands={commands} />)}
        </ol>
      )}
    </section>
  );
}
