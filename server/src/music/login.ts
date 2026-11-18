// NetEase QR login and logout. The cookie returned on success is confirmed
// with an account lookup, sealed with the master key and stored; it never
// reaches a response, a log line or an error message.
import { MUSIC_ACCOUNT_DAYS, type MusicAccountView, type MusicQrStatus } from '../../../shared/music';
import { safeCommunityText } from '../community/security';
import type { NeteaseClient } from './netease/client';
import { fail } from './http';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import { sealMusicSecret } from './secrets';
import type { MusicService } from './service';

const DAY_MS = 86_400_000;
const QR_CREATE_WINDOW_MS = 5_000;
/** At most one upstream status check per user per interval; faster polls get the last answer. */
const QR_CHECK_INTERVAL_MS = 1_000;
const QR_TTL_MS = 10 * 60_000;
const MAX_PENDING_QR = 2_000;
const QR_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const READ_ONLY_MESSAGE = '系统维护中（只读），请稍后再试';
const KEY_MISSING_MESSAGE = '服务器未配置主密钥，暂时无法登录网易云';

export type MusicQrResult =
  | { status: Exclude<MusicQrStatus, 'done'> }
  | { status: 'done'; account: MusicAccountView };

interface PendingQr {
  userId: string;
  createdAt: number;
  /** What NetEase last answered for this key. */
  status: Exclude<MusicQrStatus, 'done'>;
  /** Kept once NetEase confirmed the scan, so a failed account lookup can be retried. */
  cookie: string | null;
}

export class MusicLogin {
  private readonly qrLimiter: RateLimiter;
  /** Last upstream check per user, across all of their QR keys. */
  private readonly lastCheck = new Map<string, number>();
  /** Which member created each QR key, so nobody else can complete that login. */
  private readonly pending = new Map<string, PendingQr>();

  constructor(private readonly service: MusicService, private readonly now: () => number = Date.now) {
    this.qrLimiter = createRateLimiter(QR_CREATE_WINDOW_MS, now);
  }

  private masterKey(): string {
    return this.service.deps.masterKey || fail(503, 'feature_disabled', KEY_MISSING_MESSAGE);
  }

  private remember(key: string, userId: string): void {
    const at = this.now();
    for (const [pendingKey, entry] of this.pending) {
      if (at - entry.createdAt >= QR_TTL_MS || this.pending.size >= MAX_PENDING_QR) this.pending.delete(pendingKey);
    }
    for (const [id, checkedAt] of this.lastCheck) if (at - checkedAt >= QR_CHECK_INTERVAL_MS) this.lastCheck.delete(id);
    this.pending.set(key, { userId, createdAt: at, status: 'waiting', cookie: null });
  }

  private owned(key: string, userId: string): PendingQr | null {
    const entry = this.pending.get(key);
    return entry && entry.userId === userId && this.now() - entry.createdAt < QR_TTL_MS ? entry : null;
  }

  /** True when this user may reach NetEase now; records the attempt. */
  private takeCheck(userId: string): boolean {
    const at = this.now();
    const previous = this.lastCheck.get(userId);
    if (previous !== undefined && at - previous < QR_CHECK_INTERVAL_MS) return false;
    this.lastCheck.delete(userId);
    this.lastCheck.set(userId, at);
    return true;
  }

  async start(userId: string): Promise<{ key: string; url: string }> {
    await this.service.member(userId);
    this.masterKey();
    this.qrLimiter.take(userId);
    const client = await this.service.deps.netease();
    const qr = await client.qrKey();
    this.remember(qr.key, userId);
    return { key: qr.key, url: qr.url };
  }

  async check(userId: string, key: string): Promise<MusicQrResult> {
    const actor = await this.service.member(userId);
    const masterKey = this.masterKey();
    if (!QR_KEY_PATTERN.test(key)) fail(400, 'invalid_input', '二维码标识无效');
    const entry = this.owned(key, userId);
    if (!entry) return { status: 'expired' };
    if (!this.takeCheck(userId)) return { status: entry.status };
    const client = await this.service.deps.netease();
    const cookie = entry.cookie ?? (await this.upstreamCookie(client, key, entry));
    if (cookie === null) return { status: this.pending.get(key)?.status ?? 'expired' };
    if (this.service.deps.isReadOnly?.()) fail(503, 'read_only', READ_ONLY_MESSAGE);
    return this.confirm(client, key, actor.memberRef, cookie, masterKey);
  }

  /** Asks NetEase about the key; remembers the answer and, once scanned and approved, the cookie. */
  private async upstreamCookie(client: NeteaseClient, key: string, entry: PendingQr): Promise<string | null> {
    const result = await client.qrCheck(key);
    const done = result.status === 'done';
    this.pending.set(key, { ...entry, status: done ? 'scanned' : result.status, cookie: done ? result.cookie : null });
    return done ? result.cookie : null;
  }

  /** The key is released only after the account lookup answered; a transient failure keeps it for the next poll. */
  private async confirm(client: NeteaseClient, key: string, memberRef: string, cookie: string, masterKey: string): Promise<MusicQrResult> {
    let result: MusicQrResult;
    try {
      result = await this.saveLogin(client, memberRef, cookie, masterKey);
    } catch (error) {
      this.service.deps.onError?.('music QR login confirmation failed', error);
      return { status: 'scanned' };
    }
    this.pending.delete(key);
    return result;
  }

  private async saveLogin(
    client: NeteaseClient,
    memberRef: string,
    cookie: string,
    masterKey: string,
  ): Promise<MusicQrResult> {
    const account = await client.account(cookie);
    if (!account) return { status: 'expired' };
    const expiresAt = new Date(this.now() + MUSIC_ACCOUNT_DAYS * DAY_MS);
    const cookieEncrypted = await sealMusicSecret(cookie, masterKey, 'cookie');
    await this.service.deps.store.saveAccount(memberRef, {
      cookieEncrypted, nickname: account.nickname, vip: account.vip, expiresAt,
    });
    return {
      status: 'done',
      account: { nickname: safeCommunityText(account.nickname), vip: account.vip, expiresAt: expiresAt.toISOString() },
    };
  }

  /** Works for anyone still linked to a member, even one who has left the server,
   * so a saved login never outlives the ability to remove it. */
  async logout(userId: string): Promise<{ ok: true }> {
    const actor = await this.service.deps.community.actorFromWeb(userId);
    if (actor.memberRef) await this.service.deps.store.deleteAccount(actor.memberRef);
    return { ok: true };
  }
}
