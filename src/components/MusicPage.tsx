import type { ReactNode } from 'react';
import { musicQueueCapacity, type MusicSessionView, type MusicView } from '@shared/music';
import { MUSIC_END_REASON_TEXT } from '../lib/musicFormat';
import { Link } from './Link';
import { LoginLink } from './LoginLink';
import { MusicConnecting, MusicInvite } from './MusicInvite';
import { MusicLogin } from './MusicLogin';
import { MusicPlayer } from './MusicPlayer';
import { MusicQueue } from './MusicQueue';
import { MusicSearch } from './MusicSearch';
import { useMusicCommands } from './useMusicCommands';
import { useMusicView, type MusicProblem, type MusicViewHandle } from './useMusicView';
import './community.css';
import './music.css';

const UNAUTHENTICATED = 401;
const OFFLINE_BANNER = 'Music 机器人离线，暂时无法控制播放';
const GONE_MESSAGE = '房间不存在或你无权查看';

function BackLink(): JSX.Element {
  return <Link to="/community" className="community-back">← 我的社区</Link>;
}

function MusicUnavailable({ problem, reload }: { problem: MusicProblem | null; reload: () => void }): JSX.Element {
  if (!problem) {
    return (
      <section className="community-page music-page" aria-busy="true">
        <p role="status">音乐播放器加载中…</p>
      </section>
    );
  }
  const gone = problem.status === 403 || problem.status === 404;
  return (
    <section className="community-page music-page">
      <BackLink />
      <h1>音乐播放器</h1>
      <p role="alert">{problem.status === UNAUTHENTICATED ? '登录后使用音乐播放器' : gone ? GONE_MESSAGE : problem.message}</p>
      {problem.status === UNAUTHENTICATED && <LoginLink>登录 Nanako</LoginLink>}
      {!gone && problem.status !== UNAUTHENTICATED && <button type="button" onClick={reload}>重新加载</button>}
    </section>
  );
}

/** A session that has ended counts as no session: the page goes back to the invite. */
function liveSession(view: MusicView): MusicSessionView | null {
  return view.session && view.session.status !== 'ended' ? view.session : null;
}

interface RoomProps {
  roomRef: string;
  view: MusicView;
  handle: MusicViewHandle;
}

/** Left column: control and discovery. Right column: what is queued and whose account is in use. */
function ActiveLayout({ roomRef, view, handle, session, account }: RoomProps & { session: MusicSessionView; account: ReactNode }): JSX.Element {
  const feed = { version: session.version, seq: handle.seq, lastError: view.myLastError, offline: !view.bot.online };
  const commands = useMusicCommands(roomRef, feed, handle.fail, handle.reload);
  const capacity = musicQueueCapacity(session.state);
  return (
    <>
      <div className="music-col">
        {commands.error && <p className="community-error" role="alert">{commands.error}</p>}
        <MusicPlayer state={session.state} commands={commands} clockOffsetMs={handle.clockOffsetMs} />
        <MusicSearch commands={commands} fail={handle.fail} capacity={capacity} />
      </div>
      <div className="music-col">
        <MusicQueue queue={session.state.queue} capacity={capacity} commands={commands} />
        {account}
      </div>
    </>
  );
}

function EndedNotice({ view }: { view: MusicView }): JSX.Element | null {
  if (!view.lastEnded) return null;
  return <p className="community-notice music-notice-block" role="status">{MUSIC_END_REASON_TEXT[view.lastEnded.reason]}</p>;
}

function MusicRoom({ roomRef, view, handle }: RoomProps): JSX.Element {
  const session = liveSession(view);
  const login = (
    <MusicLogin roomRef={roomRef} view={view} reload={handle.reload} applyView={handle.applyView} fail={handle.fail} />
  );
  return (
    <section className="community-page music-page">
      <BackLink />
      <div className="community-heading">
        <div>
          <p className="community-eyebrow">一起听歌</p>
          <h1>{view.room.name}</h1>
          <p>房间里的每个人共用同一套播放控制。</p>
        </div>
      </div>
      {handle.problem && <p className="music-hint" role="status">与服务器的连接不稳定，正在重试…</p>}
      {session && !view.bot.online && <p className="community-notice music-notice-block" role="status">{OFFLINE_BANNER}</p>}
      <div className="music-layout">
        {session?.status === 'active' ? (
          <ActiveLayout roomRef={roomRef} view={view} handle={handle} session={session} account={login} />
        ) : (
          <>
            <div className="music-col">
              {!session && <EndedNotice view={view} />}
              {session ? <MusicConnecting /> : <MusicInvite roomRef={roomRef} view={view} applyView={handle.applyView} fail={handle.fail} />}
            </div>
            <div className="music-col">{login}</div>
          </>
        )}
      </div>
    </section>
  );
}

export function MusicPage({ roomRef }: { roomRef: string }): JSX.Element {
  const handle = useMusicView(roomRef);
  if (!handle.view) return <MusicUnavailable problem={handle.problem} reload={handle.reload} />;
  return <MusicRoom roomRef={roomRef} view={handle.view} handle={handle} />;
}
