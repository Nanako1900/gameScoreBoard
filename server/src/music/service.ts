// Business rules for the music player page: who may see a room's player,
// invite the bot, submit commands and lend a saved account. The music process
// owns playback; this side only validates and records requests.
import { MUSIC_END_REASONS, type MusicAccountView, type MusicEndReason, type MusicSessionView, type MusicView } from '../../../shared/music';
import { isCommunityRef } from '../../../shared/community';
import type { CommunityService, CommunityWebActor } from '../community/service';
import { canReadRoom, safeCommunityText } from '../community/security';
import { CommunityStoreError, type StoredRoom } from '../community/store';
import { fail, type MusicBody } from './http';
import type { NeteaseFactory } from './outbound';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import type { StoredMusicAccount, StoredMusicSession, MusicStore } from './store';
import { parseMusicCommand } from './validation';

export const MUSIC_ONLINE_MAX_AGE_MS = 20_000;
/** A live session whose music process has been silent this long is ended as `offline`. */
export const MUSIC_STALE_SESSION_MS = 90_000;
/** How long the page keeps saying why Music left the room. */
export const MUSIC_LAST_ENDED_WINDOW_MS = 5 * 60_000;
/** How long a member's failed command stays reported to them. */
export const MUSIC_COMMAND_ERROR_WINDOW_MS = 30_000;
/** At most one command per member per interval (4 per second). */
export const MUSIC_COMMAND_INTERVAL_MS = 250;

const BLOCKED_OFFLINE = '音乐机器人当前离线，请稍后再试';
const BLOCKED_BUSY = '音乐机器人正在其他房间使用';
const BLOCKED_ROOM = '房间当前不可用';
const BLOCKED_EMPTY = '房间里还没有人，请先进入语音房再邀请';
const BLOCKED_HERE = '音乐机器人已在这个房间';
const NO_SESSION = '音乐机器人不在这个房间，请先邀请';
const COMMAND_FAILED = '操作未能完成，请重试';
const UNKNOWN_END_REASON: MusicEndReason = 'disconnected';

export interface MusicServiceDeps {
  community: CommunityService;
  store: MusicStore;
  db: D1Database;
  masterKey: string | undefined;
  netease: NeteaseFactory;
  /** Lets the main bot open a temporary room for the music account, on behalf of the inviting member. */
  requestRoomAccess?: (memberRef: string, roomRef: string, requestKey: string) => Promise<void>;
  onError?: (context: string, error: unknown) => void;
  /** Maintenance mode: GET routes that would write (QR completion) refuse too. */
  isReadOnly?: () => boolean;
  now?: () => number;
}

export interface MusicMember extends CommunityWebActor { memberRef: string }

interface RoomContext { actor: MusicMember; room: StoredRoom }

const missing = (): never => fail(404, 'not_found', '内容不存在');

function accountView(account: StoredMusicAccount): MusicAccountView {
  return { nickname: safeCommunityText(account.nickname), vip: account.vip, expiresAt: account.expiresAt };
}

function endReason(value: string | null): MusicEndReason {
  return (MUSIC_END_REASONS as readonly string[]).includes(value ?? '') ? value as MusicEndReason : UNKNOWN_END_REASON;
}

export class MusicService {
  private readonly commandLimiter: RateLimiter;

  constructor(readonly deps: MusicServiceDeps) {
    this.commandLimiter = createRateLimiter(MUSIC_COMMAND_INTERVAL_MS, deps.now);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  async member(userId: string): Promise<MusicMember> {
    const actor = await this.deps.community.actorFromWeb(userId);
    if (!actor.memberAvailable || !actor.memberRef) {
      return fail(403, 'membership_required', actor.linked ? '需要当前服务器成员身份' : '请先绑定 Discord');
    }
    return { ...actor, memberRef: actor.memberRef };
  }

  async admin(userId: string): Promise<CommunityWebActor> {
    const actor = await this.deps.community.actorFromWeb(userId);
    if (!actor.isAdmin) fail(403, 'forbidden', '需要管理员权限');
    return actor;
  }

  private async roomContext(userId: string, roomRef: string): Promise<RoomContext> {
    const actor = await this.member(userId);
    if (!isCommunityRef(roomRef)) return missing();
    const communityStore = this.deps.community.store;
    const room = await communityStore.getRoom(roomRef);
    if (!room || room.status === 'closed') return missing();
    if (!canReadRoom(actor, room, await communityStore.roomAccess(room.ref))) return missing();
    return { actor, room };
  }

  private async humansPresent(roomRef: string): Promise<boolean> {
    const communityStore = this.deps.community.store;
    const present = (await communityStore.roomAccess(roomRef)).filter((item) => item.present);
    const members = await Promise.all(present.map((item) => communityStore.resource(item.memberRef, 'member')));
    return members.some((member) => member !== null && member.metadata.bot !== true);
  }

  private async sessionView(session: StoredMusicSession, actor: MusicMember): Promise<MusicSessionView> {
    const owner = session.accountOwner ? await this.deps.store.account(session.accountOwner) : null;
    return {
      ref: session.ref, status: session.status, version: session.version, state: session.state,
      account: owner
        ? { nickname: safeCommunityText(owner.nickname), vip: owner.vip, mine: owner.memberRef === actor.memberRef,
          canStop: owner.memberRef === actor.memberRef || actor.isAdmin }
        : null,
    };
  }

  private async inviteBlocked(room: StoredRoom, live: StoredMusicSession | null, online: boolean): Promise<string | null> {
    if (!online) return BLOCKED_OFFLINE;
    if (live && live.roomRef !== room.ref) return BLOCKED_BUSY;
    if (live) return BLOCKED_HERE;
    if (room.status !== 'active') return BLOCKED_ROOM;
    if (!(await this.humansPresent(room.ref))) return BLOCKED_EMPTY;
    return null;
  }

  /** The live session, after ending it as `offline` if the music process stopped reporting. */
  private async currentSession(): Promise<StoredMusicSession | null> {
    const { store } = this.deps;
    const live = await store.activeSession();
    if (!live || this.deps.isReadOnly?.() || (await store.online(MUSIC_STALE_SESSION_MS))) return live;
    return (await store.endStaleSession(live.ref, MUSIC_STALE_SESSION_MS)) ? store.activeSession() : live;
  }

  private async lastEnded(roomRef: string): Promise<MusicView['lastEnded']> {
    const last = await this.deps.store.lastEnded(roomRef, MUSIC_LAST_ENDED_WINDOW_MS);
    return last ? { reason: endReason(last.reason), endedAt: last.endedAt } : null;
  }

  private async myLastError(session: StoredMusicSession, actor: MusicMember): Promise<MusicView['myLastError']> {
    const failed = await this.deps.store.lastFailedCommand(session.ref, actor.memberRef, MUSIC_COMMAND_ERROR_WINDOW_MS);
    return failed ? { id: failed.id, message: safeCommunityText(failed.error ?? COMMAND_FAILED) } : null;
  }

  private async buildView({ actor, room }: RoomContext): Promise<MusicView> {
    const { store } = this.deps;
    const live = await this.currentSession();
    const here = live && live.roomRef === room.ref ? live : null;
    const mine = await store.account(actor.memberRef);
    const online = await store.online(MUSIC_ONLINE_MAX_AGE_MS);
    const blocked = await this.inviteBlocked(room, live, online);
    return {
      room: { ref: room.ref, name: safeCommunityText(room.name) },
      bot: { online, busyElsewhere: live !== null && here === null },
      session: here ? await this.sessionView(here, actor) : null,
      myAccount: mine ? accountView(mine) : null,
      loginAvailable: !!this.deps.masterKey,
      canInvite: blocked === null,
      inviteBlocked: blocked,
      serverNow: new Date(this.now()).toISOString(),
      lastEnded: here ? null : await this.lastEnded(room.ref),
      myLastError: here ? await this.myLastError(here, actor) : null,
    };
  }

  async view(userId: string, roomRef: string): Promise<MusicView> {
    return this.buildView(await this.roomContext(userId, roomRef));
  }

  async invite(userId: string, roomRef: string, useMyAccount: boolean, key: string): Promise<MusicView> {
    const context = await this.roomContext(userId, roomRef);
    const { store } = this.deps;
    const live = await this.currentSession();
    // A repeated invite for the room the bot already serves is a replay, not an error.
    if (live?.roomRef === context.room.ref) return this.buildView(context);
    const online = await store.online(MUSIC_ONLINE_MAX_AGE_MS);
    const blocked = await this.inviteBlocked(context.room, live, online);
    if (blocked === BLOCKED_BUSY) fail(409, 'music_busy', BLOCKED_BUSY);
    if (blocked !== null) fail(409, 'invite_unavailable', blocked);
    const owner = useMyAccount && (await store.account(context.actor.memberRef)) ? context.actor.memberRef : null;
    try {
      await store.createSession(context.room.ref, context.actor.memberRef, owner);
    } catch (error) {
      if (!(error instanceof CommunityStoreError) || error.code !== 'music_busy') throw error;
      if ((await store.activeSession())?.roomRef === context.room.ref) return this.buildView(context);
      fail(409, 'music_busy', BLOCKED_BUSY);
    }
    await this.requestAccess(context.actor.memberRef, context.room.ref, key);
    return this.buildView(context);
  }

  private async requestAccess(memberRef: string, roomRef: string, key: string): Promise<void> {
    if (!this.deps.requestRoomAccess) return;
    try {
      await this.deps.requestRoomAccess(memberRef, roomRef, key);
    } catch (error) {
      this.deps.onError?.('music room access request failed', error);
    }
  }

  private async liveSession(roomRef: string): Promise<StoredMusicSession> {
    const session = await this.deps.store.sessionForRoom(roomRef);
    return session ?? fail(409, 'session_ended', NO_SESSION);
  }

  private async requireOnline(): Promise<void> {
    if (!(await this.deps.store.online(MUSIC_ONLINE_MAX_AGE_MS))) fail(409, 'bot_offline', BLOCKED_OFFLINE);
  }

  async command(userId: string, roomRef: string, body: MusicBody, key: string): Promise<void> {
    const { actor, room } = await this.roomContext(userId, roomRef);
    await this.requireOnline();
    this.commandLimiter.take(actor.memberRef);
    const session = await this.liveSession(room.ref);
    const { kind, payload } = parseMusicCommand(body, session.state, actor.memberRef);
    await this.deps.store.addCommand(session.ref, actor.memberRef, kind, payload, key);
  }

  async account(userId: string, roomRef: string, action: unknown): Promise<MusicView> {
    if (action !== 'use' && action !== 'stop') fail(400, 'invalid_input', '账号操作无效');
    const context = await this.roomContext(userId, roomRef);
    const { actor } = context;
    await this.requireOnline();
    const session = await this.liveSession(context.room.ref);
    if (action === 'use') {
      if (!(await this.deps.store.account(actor.memberRef))) fail(409, 'account_missing', '请先扫码登录网易云');
      await this.deps.store.setAccountOwner(session.ref, actor.memberRef);
    } else if (session.accountOwner !== null) {
      if (session.accountOwner !== actor.memberRef && !actor.isAdmin) {
        fail(403, 'forbidden', '只有账号主人或管理员可以停止使用此账号');
      }
      await this.deps.store.setAccountOwner(session.ref, null);
    }
    return this.buildView(context);
  }
}
