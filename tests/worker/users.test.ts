// Pins the CURRENT observable behaviour of the user layer in worker/db.ts on D1,
// so the PostgreSQL port cannot silently change it: 0/1 → boolean mapping,
// SQLite `datetime('now')` timestamp format, upsert semantics on re-login,
// admin grants, leaderboard ordering (incl. byte-wise name collation), profile
// history ordering and the exact JSON shapes callers receive.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BASE_SCORE, MAX_SCORE } from '../../shared/scoring';
import {
  adminGrantVia,
  avatarUrlExists,
  getLeaderboard,
  getUserById,
  getUserProfile,
  requireParticipant,
  scoreMutation,
  toPublicUser,
  toUser,
  updateDisplayName,
  updateRoles,
  upsertUser,
  type AdminGrants,
  type RolePatch,
} from '../../worker/db';
import { ApiError } from '../../worker/errors';
import type { OAuthProfile } from '../../worker/oauth';
import type { UserRow } from '../../worker/types';
import { scoreEventCount, scoreOf, seedUser } from './helpers';

/** SQLite `datetime('now')`: UTC, space separator, no 'T', no zone, no millis. */
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const OLD_STAMP = '2024-01-02 03:04:05';

const NO_GRANTS: AdminGrants = { subjectIds: [], usernames: [] };

const USER_KEYS = [
  'avatar_url',
  'created_at',
  'id',
  'is_admin',
  'is_judge',
  'is_participant',
  'oauth_username',
  'score',
  'username',
];
const PUBLIC_USER_KEYS = [
  'avatar_url',
  'created_at',
  'id',
  'is_judge',
  'is_participant',
  'score',
  'username',
];

function profile(overrides: Partial<OAuthProfile> = {}): OAuthProfile {
  return {
    id: 'sub-1',
    username: 'nanako',
    avatar_url: 'https://cdn.example.org/avatars/nanako.png',
    email: 'nanako@example.org',
    ...overrides,
  };
}

async function rawUser(id: string): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

async function userCount(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? -1;
}

async function exec(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql)
    .bind(...binds)
    .run();
}

/** Backdate both timestamps so a later write is observable at second resolution. */
async function backdate(id: string): Promise<void> {
  await exec('UPDATE users SET created_at = ?, updated_at = ? WHERE id = ?', OLD_STAMP, OLD_STAMP, id);
}

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'u1',
    username: 'oauth-name',
    display_name: null,
    avatar_url: null,
    email: 'secret@example.org',
    is_participant: 0,
    is_judge: 0,
    is_admin: 0,
    score: 100,
    created_at: OLD_STAMP,
    updated_at: OLD_STAMP,
    ...overrides,
  };
}

async function insertRecord(
  subjectId: string,
  reporterId: string,
  createdAt: string,
  status = 'decided',
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, status, claim, created_at)
     VALUES (?, ?, 'no_show', -15, ?, '说好八点五排，结果人没来。', ?)`,
  )
    .bind(subjectId, reporterId, status, createdAt)
    .run();
  return Number(res.meta.last_row_id);
}

async function insertEvent(
  userId: string,
  delta: number,
  resultingScore: number,
  createdAt: string,
): Promise<void> {
  await exec(
    `INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at)
     VALUES (?, ?, 'admin_adjust', ?, ?)`,
    userId,
    delta,
    resultingScore,
    createdAt,
  );
}

// ---------------------------------------------------------------------------

describe('adminGrantVia (pure)', () => {
  it('grants by subject id when ADMIN_SUBJECT_IDS lists profile.id', () => {
    expect(adminGrantVia({ subjectIds: ['x', 'sub-1'], usernames: [] }, profile())).toBe('subject');
  });

  it('prefers the subject rule even when the username also matches', () => {
    expect(
      adminGrantVia({ subjectIds: ['sub-1'], usernames: ['nanako'] }, profile()),
    ).toBe('subject');
  });

  it('ignores ADMIN_USERNAMES entirely once any subject id is configured', () => {
    expect(
      adminGrantVia({ subjectIds: ['someone-else'], usernames: ['nanako'] }, profile()),
    ).toBeNull();
  });

  it('falls back to the username rule only while subjectIds is empty', () => {
    expect(adminGrantVia({ subjectIds: [], usernames: ['nanako'] }, profile())).toBe('username');
  });

  it('returns null when neither list matches, or both are empty', () => {
    expect(adminGrantVia(NO_GRANTS, profile())).toBeNull();
    expect(adminGrantVia({ subjectIds: [], usernames: ['other'] }, profile())).toBeNull();
  });

  it('matches exactly: case-sensitive, untrimmed, no substring', () => {
    expect(adminGrantVia({ subjectIds: [], usernames: ['Nanako'] }, profile())).toBeNull();
    expect(adminGrantVia({ subjectIds: [], usernames: ['nana'] }, profile())).toBeNull();
    expect(adminGrantVia({ subjectIds: [' sub-1'], usernames: [] }, profile())).toBeNull();
    expect(adminGrantVia({ subjectIds: ['SUB-1'], usernames: [] }, profile())).toBeNull();
  });

  it('never cross-matches the two fields', () => {
    // A subject list holding the username, or a username list holding the id.
    expect(adminGrantVia({ subjectIds: ['nanako'], usernames: [] }, profile())).toBeNull();
    expect(adminGrantVia({ subjectIds: [], usernames: ['sub-1'] }, profile())).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('upsertUser — first login', () => {
  it('inserts a fresh, unprivileged row and reports isNew', async () => {
    const result = await upsertUser(env.DB, profile(), NO_GRANTS);

    expect(result.isNew).toBe(true);
    expect(Object.keys(result.user).sort()).toEqual(USER_KEYS);
    expect(result.user).toEqual({
      id: 'sub-1',
      username: 'nanako',
      oauth_username: 'nanako',
      avatar_url: 'https://cdn.example.org/avatars/nanako.png',
      is_participant: false,
      is_judge: false,
      is_admin: false,
      score: 100,
      created_at: expect.stringMatching(SQLITE_DATETIME),
    });
  });

  it('stores the email and leaves display_name NULL, with 0/1 role columns', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    const stored = await rawUser('sub-1');
    expect(stored).toEqual({
      id: 'sub-1',
      username: 'nanako',
      display_name: null,
      avatar_url: 'https://cdn.example.org/avatars/nanako.png',
      email: 'nanako@example.org',
      is_participant: 0,
      is_judge: 0,
      is_admin: 0,
      score: 100,
      created_at: expect.stringMatching(SQLITE_DATETIME),
      updated_at: expect.stringMatching(SQLITE_DATETIME),
    });
    expect(stored?.created_at).toBe(stored?.updated_at);
  });

  it('never exposes the email on the returned User', async () => {
    const { user } = await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(user).not.toHaveProperty('email');
    expect(JSON.stringify(user)).not.toContain('nanako@example.org');
  });

  it('accepts a profile with no avatar and no email', async () => {
    const { user } = await upsertUser(
      env.DB,
      profile({ avatar_url: null, email: null }),
      NO_GRANTS,
    );
    expect(user.avatar_url).toBeNull();
    const stored = await rawUser('sub-1');
    expect(stored?.avatar_url).toBeNull();
    expect(stored?.email).toBeNull();
  });

  it('writes no score_events — a new user starts at the schema default', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(await scoreEventCount('sub-1')).toBe(0);
    expect(await scoreOf('sub-1')).toBe(BASE_SCORE);
  });

  it('grants admin on insert via ADMIN_SUBJECT_IDS', async () => {
    const { user } = await upsertUser(
      env.DB,
      profile(),
      { subjectIds: ['sub-1'], usernames: [] },
    );
    expect(user.is_admin).toBe(true);
    expect((await rawUser('sub-1'))?.is_admin).toBe(1);
  });

  it('grants admin on insert via ADMIN_USERNAMES while no subject ids are set', async () => {
    const { user } = await upsertUser(env.DB, profile(), { subjectIds: [], usernames: ['nanako'] });
    expect(user.is_admin).toBe(true);
    expect((await rawUser('sub-1'))?.is_admin).toBe(1);
  });

  it('does not grant admin by username once subject ids are configured', async () => {
    const { user } = await upsertUser(
      env.DB,
      profile(),
      { subjectIds: ['someone-else'], usernames: ['nanako'] },
    );
    expect(user.is_admin).toBe(false);
    expect((await rawUser('sub-1'))?.is_admin).toBe(0);
  });

  it('only creates the one row', async () => {
    await seedUser({ id: 'bystander' });
    await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(await userCount()).toBe(2);
  });
});

describe('upsertUser — later logins', () => {
  it('refreshes username/avatar/email but keeps display_name, roles, score and created_at', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    await exec(
      `UPDATE users SET display_name = '小七', is_participant = 1, is_judge = 1, score = 37
       WHERE id = 'sub-1'`,
    );
    await backdate('sub-1');

    const result = await upsertUser(
      env.DB,
      profile({
        username: 'nanako-renamed',
        avatar_url: 'https://cdn.example.org/avatars/v2.png',
        email: 'new@example.org',
      }),
      NO_GRANTS,
    );

    expect(result.isNew).toBe(false);
    expect(result.user).toEqual({
      id: 'sub-1',
      username: '小七',
      oauth_username: 'nanako-renamed',
      avatar_url: 'https://cdn.example.org/avatars/v2.png',
      is_participant: true,
      is_judge: true,
      is_admin: false,
      score: 37,
      created_at: OLD_STAMP,
    });

    const stored = await rawUser('sub-1');
    expect(stored?.email).toBe('new@example.org');
    expect(stored?.display_name).toBe('小七');
    expect(stored?.created_at).toBe(OLD_STAMP);
    expect(stored?.updated_at).toMatch(SQLITE_DATETIME);
    expect(stored?.updated_at).not.toBe(OLD_STAMP);
  });

  it('without a custom name, the refreshed OAuth username is what callers and the board see', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    await updateRoles(env.DB, 'sub-1', { is_participant: true });
    const { user } = await upsertUser(env.DB, profile({ username: 'idp-renamed' }), NO_GRANTS);
    expect(user.username).toBe('idp-renamed');
    expect(user.oauth_username).toBe('idp-renamed');
    expect((await rawUser('sub-1'))?.display_name).toBeNull();
    expect((await getLeaderboard(env.DB)).map((p) => p.username)).toEqual(['idp-renamed']);
  });

  it('overwrites avatar and email with NULL when the provider stops sending them', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    const { user } = await upsertUser(
      env.DB,
      profile({ avatar_url: null, email: null }),
      NO_GRANTS,
    );
    expect(user.avatar_url).toBeNull();
    const stored = await rawUser('sub-1');
    expect(stored?.avatar_url).toBeNull();
    expect(stored?.email).toBeNull();
  });

  it('is idempotent: same profile twice → same user, one row, no score events', async () => {
    const first = await upsertUser(env.DB, profile(), NO_GRANTS);
    const second = await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(second.isNew).toBe(false);
    expect(second.user).toEqual(first.user);
    expect(await userCount()).toBe(1);
    expect(await scoreEventCount('sub-1')).toBe(0);
  });

  it('keys on the subject id, not the username', async () => {
    await upsertUser(env.DB, profile({ id: 'sub-1', username: 'same' }), NO_GRANTS);
    const other = await upsertUser(env.DB, profile({ id: 'sub-2', username: 'same' }), NO_GRANTS);
    expect(other.isNew).toBe(true);
    expect(await userCount()).toBe(2);
  });

  it('promotes an existing non-admin listed in ADMIN_SUBJECT_IDS', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    const { user, isNew } = await upsertUser(env.DB, profile(), {
      subjectIds: ['sub-1'],
      usernames: [],
    });
    expect(isNew).toBe(false);
    expect(user.is_admin).toBe(true);
    expect((await rawUser('sub-1'))?.is_admin).toBe(1);
  });

  it('promotes an existing user who now carries a listed username (subjectIds empty)', async () => {
    await upsertUser(env.DB, profile({ username: 'plain' }), { subjectIds: [], usernames: ['boss'] });
    expect((await rawUser('sub-1'))?.is_admin).toBe(0);
    const { user } = await upsertUser(env.DB, profile({ username: 'boss' }), {
      subjectIds: [],
      usernames: ['boss'],
    });
    expect(user.is_admin).toBe(true);
  });

  it('never revokes an existing admin, whatever the grant lists say', async () => {
    await upsertUser(env.DB, profile(), { subjectIds: ['sub-1'], usernames: [] });

    const unlisted = await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(unlisted.user.is_admin).toBe(true);

    const otherSubject = await upsertUser(env.DB, profile(), {
      subjectIds: ['someone-else'],
      usernames: [],
    });
    expect(otherSubject.user.is_admin).toBe(true);
    expect((await rawUser('sub-1'))?.is_admin).toBe(1);
  });

  it('keeps an admin flag set out-of-band (e.g. by another admin)', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    await exec("UPDATE users SET is_admin = 1 WHERE id = 'sub-1'");
    const { user } = await upsertUser(env.DB, profile(), NO_GRANTS);
    expect(user.is_admin).toBe(true);
  });

  it('does not touch other users', async () => {
    await seedUser({ id: 'bystander', username: 'bystander', score: 55, judge: true });
    await upsertUser(env.DB, profile(), NO_GRANTS);
    await upsertUser(env.DB, profile({ username: 'changed' }), { subjectIds: ['sub-1'], usernames: [] });
    const other = await rawUser('bystander');
    expect(other?.username).toBe('bystander');
    expect(other?.score).toBe(55);
    expect(other?.is_admin).toBe(0);
    expect(other?.is_judge).toBe(1);
  });

  // Verified on D1: Promise.all of two first logins → one fulfils (isNew), the
  // other rejects with a plain Error "D1_ERROR: UNIQUE constraint failed: users.id",
  // not an ApiError. An INSERT ... ON CONFLICT(id) DO UPDATE would close it.
  it.todo(
    'BUG: two concurrent first logins for the same sub race the SELECT-then-INSERT; the loser gets a raw UNIQUE constraint error (500) instead of being treated as a re-login (worker/db.ts:174-184)',
  );
});

// ---------------------------------------------------------------------------

describe('toUser / toPublicUser mapping', () => {
  it('turns 0/1 integers into real booleans', () => {
    const none = toUser(row());
    expect(none.is_participant).toBe(false);
    expect(none.is_judge).toBe(false);
    expect(none.is_admin).toBe(false);

    const all = toUser(row({ is_participant: 1, is_judge: 1, is_admin: 1 }));
    expect(all.is_participant).toBe(true);
    expect(all.is_judge).toBe(true);
    expect(all.is_admin).toBe(true);
  });

  it('uses display_name as username when set, keeping the OAuth name separately', () => {
    expect(toUser(row({ display_name: '小七' }))).toEqual({
      id: 'u1',
      username: '小七',
      oauth_username: 'oauth-name',
      avatar_url: null,
      is_participant: false,
      is_judge: false,
      is_admin: false,
      score: 100,
      created_at: OLD_STAMP,
    });
    expect(toUser(row()).username).toBe('oauth-name');
  });

  it('keeps an empty-string display_name (only NULL falls back)', () => {
    expect(toUser(row({ display_name: '' })).username).toBe('');
  });

  it('User never carries email, display_name or updated_at', () => {
    const u = toUser(row({ display_name: 'x', avatar_url: 'https://a/b.png' }));
    expect(Object.keys(u).sort()).toEqual(USER_KEYS);
  });

  it('PublicUser additionally drops is_admin and oauth_username', () => {
    const pub = toPublicUser(row({ is_admin: 1, is_judge: 1, display_name: '小七' }));
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_USER_KEYS);
    expect(pub).toEqual({
      id: 'u1',
      username: '小七',
      avatar_url: null,
      is_participant: false,
      is_judge: true,
      score: 100,
      created_at: OLD_STAMP,
    });
  });

  it('maps a row read back from D1 the same way', async () => {
    await seedUser({ id: 'rt', participant: true, judge: false, admin: true, score: 42 });
    const stored = await rawUser('rt');
    expect(stored).not.toBeNull();
    const u = toUser(stored as UserRow);
    expect(u.is_participant).toBe(true);
    expect(u.is_judge).toBe(false);
    expect(u.is_admin).toBe(true);
    expect(u.score).toBe(42);
    expect(typeof u.score).toBe('number');
  });
});

// ---------------------------------------------------------------------------

describe('getUserById / requireParticipant', () => {
  it('getUserById returns null (not undefined) for an unknown id', async () => {
    await seedUser({ id: 'someone' });
    const missing = await getUserById(env.DB, 'ghost');
    expect(missing).toBeNull();
  });

  it('requireParticipant returns the raw row, 0/1 integers included', async () => {
    await seedUser({ id: 'p', judge: true, score: 64 });
    const r = await requireParticipant(env.DB, 'p');
    expect(r).toMatchObject({ id: 'p', is_participant: 1, is_judge: 1, is_admin: 0, score: 64 });
    expect(r.updated_at).toMatch(SQLITE_DATETIME);
  });

  it('400 选手不存在 for an unknown id', async () => {
    await expect(requireParticipant(env.DB, 'ghost')).rejects.toMatchObject({
      status: 400,
      message: '选手不存在',
    });
    await expect(requireParticipant(env.DB, 'ghost')).rejects.toThrow(ApiError);
  });

  it('400 该用户不是上榜选手 for a non-participant, even a judge or admin', async () => {
    await seedUser({ id: 'ref', participant: false, judge: true, admin: true });
    await expect(requireParticipant(env.DB, 'ref')).rejects.toMatchObject({
      status: 400,
      message: '该用户不是上榜选手',
    });
  });
});

// ---------------------------------------------------------------------------

describe('scoreMutation', () => {
  interface EventRow {
    delta: number;
    reason: string;
    resulting_score: number;
  }

  async function eventsOf(userId: string): Promise<EventRow[]> {
    const rows = await env.DB.prepare(
      'SELECT delta, reason, resulting_score FROM score_events WHERE user_id = ? ORDER BY id',
    )
      .bind(userId)
      .all<EventRow>();
    return rows.results;
  }

  it('writes nothing until the caller runs the statements (so they can be batched atomically)', async () => {
    await seedUser({ id: 'u', score: 70 });
    const m = scoreMutation(env.DB, 'u', 70, -15, 'record:7');
    expect(m.applied).toBe(-15);
    expect(m.newScore).toBe(55);
    expect(await scoreOf('u')).toBe(70);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('applies an in-range delta, logs it and bumps updated_at — for that user only', async () => {
    await seedUser({ id: 'u', score: 70 });
    await seedUser({ id: 'bystander', score: 70 });
    await backdate('u');
    const m = scoreMutation(env.DB, 'u', 70, -15, 'record:7');
    await env.DB.batch(m.statements);

    expect(await scoreOf('u')).toBe(55);
    expect(await eventsOf('u')).toEqual([{ delta: -15, reason: 'record:7', resulting_score: 55 }]);
    const stored = await rawUser('u');
    expect(stored?.updated_at).toMatch(SQLITE_DATETIME);
    expect(stored?.updated_at).not.toBe(OLD_STAMP);
    expect(stored?.created_at).toBe(OLD_STAMP);
    expect(await scoreOf('bystander')).toBe(70);
    expect(await scoreEventCount('bystander')).toBe(0);
  });

  it('clamps at MAX_SCORE and logs only the part of the delta that landed', async () => {
    await seedUser({ id: 'u', score: 95 });
    const m = scoreMutation(env.DB, 'u', 95, 10, 'record:1');
    expect(m.applied).toBe(5);
    expect(m.newScore).toBe(MAX_SCORE);
    await env.DB.batch(m.statements);
    expect(await scoreOf('u')).toBe(100);
    expect(await eventsOf('u')).toEqual([{ delta: 5, reason: 'record:1', resulting_score: 100 }]);
  });

  it('clamps at 0', async () => {
    await seedUser({ id: 'u', score: 10 });
    const m = scoreMutation(env.DB, 'u', 10, -30, 'record:2');
    expect(m.applied).toBe(-10);
    expect(m.newScore).toBe(0);
    await env.DB.batch(m.statements);
    expect(await scoreOf('u')).toBe(0);
    expect(await eventsOf('u')).toEqual([{ delta: -10, reason: 'record:2', resulting_score: 0 }]);
  });

  it('still logs a zero-delta audit event when already at the cap', async () => {
    await seedUser({ id: 'u', score: 100 });
    const m = scoreMutation(env.DB, 'u', 100, 5, 'record:3');
    expect(m.applied).toBe(0);
    await env.DB.batch(m.statements);
    expect(await scoreOf('u')).toBe(100);
    expect(await eventsOf('u')).toEqual([{ delta: 0, reason: 'record:3', resulting_score: 100 }]);
  });
});

// ---------------------------------------------------------------------------

describe('updateRoles', () => {
  it('sets both flags and returns the full User with booleans', async () => {
    await seedUser({ id: 'u', participant: false });
    const user = await updateRoles(env.DB, 'u', { is_participant: true, is_judge: true });
    expect(user).toEqual({
      id: 'u',
      username: 'u',
      oauth_username: 'u',
      avatar_url: null,
      is_participant: true,
      is_judge: true,
      is_admin: false,
      score: 100,
      created_at: expect.stringMatching(SQLITE_DATETIME),
    });
    const stored = await rawUser('u');
    expect(stored?.is_participant).toBe(1);
    expect(stored?.is_judge).toBe(1);
  });

  it('touches only the flags present in the patch', async () => {
    await seedUser({ id: 'u', participant: true, judge: false });
    const judged = await updateRoles(env.DB, 'u', { is_judge: true });
    expect(judged.is_participant).toBe(true);
    expect(judged.is_judge).toBe(true);

    const benched = await updateRoles(env.DB, 'u', { is_participant: false });
    expect(benched.is_participant).toBe(false);
    expect(benched.is_judge).toBe(true);
  });

  it('dropping out keeps the score; rejoining restores it, with no score events', async () => {
    await seedUser({ id: 'u', participant: true, score: 63 });
    await updateRoles(env.DB, 'u', { is_participant: false });
    expect(await scoreOf('u')).toBe(63);
    expect((await getLeaderboard(env.DB)).map((p) => p.id)).toEqual([]);

    const back = await updateRoles(env.DB, 'u', { is_participant: true });
    expect(back.score).toBe(63);
    expect((await getLeaderboard(env.DB)).map((p) => p.id)).toEqual(['u']);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('bumps updated_at on a real change', async () => {
    await seedUser({ id: 'u' });
    await backdate('u');
    await updateRoles(env.DB, 'u', { is_judge: true });
    const stored = await rawUser('u');
    expect(stored?.updated_at).toMatch(SQLITE_DATETIME);
    expect(stored?.updated_at).not.toBe(OLD_STAMP);
    expect(stored?.created_at).toBe(OLD_STAMP);
  });

  it('an empty patch writes nothing and returns the current user', async () => {
    await seedUser({ id: 'u', judge: true, score: 80 });
    await backdate('u');
    const user = await updateRoles(env.DB, 'u', {});
    expect(user.is_judge).toBe(true);
    expect(user.score).toBe(80);
    expect((await rawUser('u'))?.updated_at).toBe(OLD_STAMP);
  });

  it('cannot be used to self-grant admin (unknown keys are ignored)', async () => {
    await seedUser({ id: 'u' });
    const sneaky = { is_admin: true, score: 999 } as unknown as RolePatch;
    const user = await updateRoles(env.DB, 'u', sneaky);
    expect(user.is_admin).toBe(false);
    expect(user.score).toBe(100);
    expect((await rawUser('u'))?.is_admin).toBe(0);
  });

  it('404s for an unknown user, with or without a patch, and creates nothing', async () => {
    await expect(updateRoles(env.DB, 'ghost', { is_judge: true })).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    await expect(updateRoles(env.DB, 'ghost', {})).rejects.toThrow(ApiError);
    expect(await userCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('updateDisplayName', () => {
  it('sets a trimmed custom name; oauth_username is untouched', async () => {
    await seedUser({ id: 'u', username: 'oauth-u' });
    const user = await updateDisplayName(env.DB, 'u', '  小七 号  ');
    expect(user.username).toBe('小七 号');
    expect(user.oauth_username).toBe('oauth-u');
    expect((await rawUser('u'))?.display_name).toBe('小七 号');
    expect((await rawUser('u'))?.username).toBe('oauth-u');
  });

  it('null clears the custom name back to the OAuth name', async () => {
    await seedUser({ id: 'u', username: 'oauth-u' });
    await updateDisplayName(env.DB, 'u', '小七');
    const user = await updateDisplayName(env.DB, 'u', null);
    expect(user.username).toBe('oauth-u');
    expect((await rawUser('u'))?.display_name).toBeNull();
  });

  it('null on a user without a custom name is a harmless no-op', async () => {
    await seedUser({ id: 'u', username: 'oauth-u' });
    const user = await updateDisplayName(env.DB, 'u', null);
    expect(user.username).toBe('oauth-u');
  });

  it('rejects empty and whitespace-only names (incl. ideographic space) with 400', async () => {
    await seedUser({ id: 'u', username: 'oauth-u' });
    await updateDisplayName(env.DB, 'u', '原名');
    for (const blank of ['', '   ', '\t\n', '　　']) {
      await expect(updateDisplayName(env.DB, 'u', blank)).rejects.toMatchObject({
        status: 400,
        message: '显示名字不能为空',
      });
    }
    // A rejected update leaves the previous name in place.
    expect((await rawUser('u'))?.display_name).toBe('原名');
  });

  it('allows exactly 24 characters after trimming, rejects 25', async () => {
    await seedUser({ id: 'u' });
    const max = '信'.repeat(24);
    expect((await updateDisplayName(env.DB, 'u', `  ${max}  `)).username).toBe(max);

    await expect(updateDisplayName(env.DB, 'u', '信'.repeat(25))).rejects.toMatchObject({
      status: 400,
      message: '显示名字最多 24 个字符',
    });
    await expect(updateDisplayName(env.DB, 'u', 'a'.repeat(25))).rejects.toThrow(/24/);
    expect((await rawUser('u'))?.display_name).toBe(max);
  });

  it('trims the ideographic space U+3000 like ASCII whitespace', async () => {
    await seedUser({ id: 'u' });
    const user = await updateDisplayName(env.DB, 'u', '　名字　');
    expect(user.username).toBe('名字');
  });

  it('validates before checking the user exists', async () => {
    await expect(updateDisplayName(env.DB, 'ghost', '   ')).rejects.toMatchObject({ status: 400 });
    await expect(updateDisplayName(env.DB, 'ghost', '好名字')).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    await expect(updateDisplayName(env.DB, 'ghost', null)).rejects.toMatchObject({ status: 404 });
    expect(await userCount()).toBe(0);
  });

  it('bumps updated_at and leaves created_at, roles and score alone', async () => {
    await seedUser({ id: 'u', judge: true, score: 71 });
    await backdate('u');
    const user = await updateDisplayName(env.DB, 'u', '新名');
    expect(user.is_judge).toBe(true);
    expect(user.score).toBe(71);
    expect(user.created_at).toBe(OLD_STAMP);
    expect((await rawUser('u'))?.updated_at).not.toBe(OLD_STAMP);
  });

  it('survives a later login (display_name is not overwritten by the OAuth refresh)', async () => {
    await upsertUser(env.DB, profile(), NO_GRANTS);
    await updateDisplayName(env.DB, 'sub-1', '自定义');
    const { user } = await upsertUser(env.DB, profile({ username: 'idp-new' }), NO_GRANTS);
    expect(user.username).toBe('自定义');
    expect(user.oauth_username).toBe('idp-new');
  });
});

// ---------------------------------------------------------------------------

describe('getLeaderboard', () => {
  it('is empty when nobody participates', async () => {
    await seedUser({ id: 'watcher', participant: false });
    expect(await getLeaderboard(env.DB)).toEqual([]);
  });

  it('includes every participant (judges and admins too) and nobody else', async () => {
    await seedUser({ id: 'player' });
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'admin-player', admin: true });
    await seedUser({ id: 'admin-only', admin: true, participant: false });
    await seedUser({ id: 'judge-only', judge: true, participant: false });
    await seedUser({ id: 'zero', score: 0 });

    const ids = (await getLeaderboard(env.DB)).map((p) => p.id).sort();
    expect(ids).toEqual(['admin-player', 'judge', 'player', 'zero']);
  });

  it('orders by score DESC, then effective name ASC', async () => {
    await seedUser({ id: 'u1', username: 'carol', score: 80 });
    await seedUser({ id: 'u2', username: 'bob', score: 95 });
    await seedUser({ id: 'u3', username: 'alice', score: 80 });
    await seedUser({ id: 'u4', username: 'dave', score: 0 });
    await seedUser({ id: 'u5', username: 'erin', score: 100 });

    const board = await getLeaderboard(env.DB);
    expect(board.map((p) => [p.username, p.score])).toEqual([
      ['erin', 100],
      ['bob', 95],
      ['alice', 80],
      ['carol', 80],
      ['dave', 0],
    ]);
  });

  it('breaks score ties on display_name when set, falling back to username', async () => {
    await seedUser({ id: 'u1', username: 'zzz', score: 90 });
    await seedUser({ id: 'u2', username: 'mmm', score: 90 });
    await seedUser({ id: 'u3', username: 'aaa', score: 90 });
    await updateDisplayName(env.DB, 'u1', 'abc'); // zzz → abc sorts second
    await updateDisplayName(env.DB, 'u3', 'yyy'); // aaa → yyy sorts last

    const board = await getLeaderboard(env.DB);
    expect(board.map((p) => p.id)).toEqual(['u1', 'u2', 'u3']);
    expect(board.map((p) => p.username)).toEqual(['abc', 'mmm', 'yyy']);
  });

  it('compares names byte-wise (SQLite BINARY): uppercase < lowercase < CJK', async () => {
    // A locale-aware collation (PG default) would put 'amy' before 'Zed'.
    await seedUser({ id: 'u1', username: 'amy', score: 50 });
    await seedUser({ id: 'u2', username: 'Zed', score: 50 });
    await seedUser({ id: 'u3', username: '阿七', score: 50 });
    await seedUser({ id: 'u4', username: '_under', score: 50 });
    await seedUser({ id: 'u5', username: '9lives', score: 50 });

    const names = (await getLeaderboard(env.DB)).map((p) => p.username);
    expect(names).toEqual(['9lives', 'Zed', '_under', 'amy', '阿七']);
  });

  it('returns PublicUser rows: no is_admin / email / oauth name, real booleans and numbers', async () => {
    await upsertUser(env.DB, profile(), { subjectIds: ['sub-1'], usernames: [] });
    await updateRoles(env.DB, 'sub-1', { is_participant: true, is_judge: true });
    await updateDisplayName(env.DB, 'sub-1', '小七');

    const [entry] = await getLeaderboard(env.DB);
    expect(Object.keys(entry).sort()).toEqual(PUBLIC_USER_KEYS);
    expect(entry).toEqual({
      id: 'sub-1',
      username: '小七',
      avatar_url: 'https://cdn.example.org/avatars/nanako.png',
      is_participant: true,
      is_judge: true,
      score: 100,
      created_at: expect.stringMatching(SQLITE_DATETIME),
    });
    expect(JSON.stringify(entry)).not.toContain('nanako@example.org');
  });

  it.todo(
    'BUG: no final tie-break — two participants with the same score and same effective name come back in unspecified order, so the board can reshuffle between requests (worker/db.ts:73; add `, id ASC`)',
  );
});

// ---------------------------------------------------------------------------

describe('avatarUrlExists', () => {
  const URL_A = 'https://cdn.example.org/avatars/A.png?v=2';

  it('is true only for an exact stored avatar URL', async () => {
    await upsertUser(env.DB, profile({ avatar_url: URL_A }), NO_GRANTS);

    expect(await avatarUrlExists(env.DB, URL_A)).toBe(true);
    expect(await avatarUrlExists(env.DB, 'https://cdn.example.org/avatars/A.png')).toBe(false);
    expect(await avatarUrlExists(env.DB, `${URL_A}&x=1`)).toBe(false);
    expect(await avatarUrlExists(env.DB, 'https://cdn.example.org/avatars/a.png?v=2')).toBe(false);
    expect(await avatarUrlExists(env.DB, `${URL_A} `)).toBe(false);
  });

  it('does not treat LIKE wildcards as patterns', async () => {
    await upsertUser(env.DB, profile({ avatar_url: URL_A }), NO_GRANTS);
    expect(await avatarUrlExists(env.DB, '%')).toBe(false);
    expect(await avatarUrlExists(env.DB, 'https://cdn.example.org/%')).toBe(false);
    expect(await avatarUrlExists(env.DB, 'https://cdn.example.org/avatars/A.pn_?v=2')).toBe(false);
  });

  it('is false on an empty table, for an empty string and for the text "null"', async () => {
    expect(await avatarUrlExists(env.DB, URL_A)).toBe(false);
    await upsertUser(env.DB, profile({ avatar_url: null }), NO_GRANTS);
    expect(await avatarUrlExists(env.DB, '')).toBe(false);
    expect(await avatarUrlExists(env.DB, 'null')).toBe(false);
  });

  it('counts any user’s avatar, participant or not', async () => {
    await upsertUser(env.DB, profile({ id: 'watcher', avatar_url: URL_A }), NO_GRANTS);
    expect((await rawUser('watcher'))?.is_participant).toBe(0);
    expect(await avatarUrlExists(env.DB, URL_A)).toBe(true);
  });

  it('stops matching once the avatar is refreshed away, and matches the new one', async () => {
    const next = 'https://cdn.example.org/avatars/B.png';
    await upsertUser(env.DB, profile({ avatar_url: URL_A }), NO_GRANTS);
    await upsertUser(env.DB, profile({ avatar_url: next }), NO_GRANTS);
    expect(await avatarUrlExists(env.DB, URL_A)).toBe(false);
    expect(await avatarUrlExists(env.DB, next)).toBe(true);
  });

  it('returns a boolean even when several users share the URL', async () => {
    await upsertUser(env.DB, profile({ id: 'a', avatar_url: URL_A }), NO_GRANTS);
    await upsertUser(env.DB, profile({ id: 'b', avatar_url: URL_A }), NO_GRANTS);
    expect(await avatarUrlExists(env.DB, URL_A)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('getUserProfile', () => {
  it('404s for an unknown id', async () => {
    await expect(getUserProfile(env.DB, 'ghost')).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    await expect(getUserProfile(env.DB, 'ghost')).rejects.toThrow(ApiError);
  });

  it('returns { user, records, history } with a PublicUser and a single base point when idle', async () => {
    await upsertUser(env.DB, profile(), { subjectIds: ['sub-1'], usernames: [] });
    await backdate('sub-1');

    const p = await getUserProfile(env.DB, 'sub-1');
    expect(Object.keys(p).sort()).toEqual(['history', 'records', 'user']);
    expect(p.user).toEqual({
      id: 'sub-1',
      username: 'nanako',
      avatar_url: 'https://cdn.example.org/avatars/nanako.png',
      is_participant: false,
      is_judge: false,
      score: 100,
      created_at: OLD_STAMP,
    });
    expect(p.user).not.toHaveProperty('is_admin');
    expect(p.records).toEqual([]);
    expect(p.history).toEqual([{ at: OLD_STAMP, score: BASE_SCORE }]);
  });

  it('serves non-participants too', async () => {
    await seedUser({ id: 'watcher', participant: false, score: 40 });
    const p = await getUserProfile(env.DB, 'watcher');
    expect(p.user.id).toBe('watcher');
    expect(p.user.is_participant).toBe(false);
    expect(p.user.score).toBe(40);
    expect(p.history).toEqual([{ at: expect.stringMatching(SQLITE_DATETIME), score: BASE_SCORE }]);
  });

  it('history starts at BASE_SCORE on created_at, then follows score_events by created_at, id', async () => {
    await seedUser({ id: 'u', score: 70 });
    await seedUser({ id: 'other' });
    await backdate('u');
    // Inserted out of chronological order; two share a timestamp (id breaks the tie).
    await insertEvent('u', -10, 90, '2025-01-03 00:00:00');
    await insertEvent('u', -20, 80, '2025-01-02 00:00:00');
    await insertEvent('other', -50, 50, '2025-01-01 00:00:00');
    await insertEvent('u', -20, 70, '2025-01-03 00:00:00');

    const { history } = await getUserProfile(env.DB, 'u');
    expect(history).toEqual([
      { at: OLD_STAMP, score: 100 },
      { at: '2025-01-02 00:00:00', score: 80 },
      { at: '2025-01-03 00:00:00', score: 90 },
      { at: '2025-01-03 00:00:00', score: 70 },
    ]);
  });

  it('history timestamps use the SQLite datetime format when defaulted', async () => {
    await seedUser({ id: 'u' });
    await exec(
      "INSERT INTO score_events (user_id, delta, reason, resulting_score) VALUES ('u', -3, 'record:1', 97)",
    );
    const { history } = await getUserProfile(env.DB, 'u');
    expect(history).toHaveLength(2);
    for (const point of history) expect(point.at).toMatch(SQLITE_DATETIME);
    expect(history[1].score).toBe(97);
    expect(typeof history[1].score).toBe('number');
  });

  it('lists only cases where the user is the subject, newest first, any status', async () => {
    await seedUser({ id: 'u', username: 'u-oauth' });
    await seedUser({ id: 'judge', judge: true });
    await updateDisplayName(env.DB, 'u', '被告');
    const oldest = await insertRecord('u', 'judge', '2025-01-01 00:00:00', 'withdrawn');
    const tieLow = await insertRecord('u', 'judge', '2025-01-02 00:00:00', 'awaiting_statement');
    const tieHigh = await insertRecord('u', 'judge', '2025-01-02 00:00:00', 'decided');
    await insertRecord('judge', 'u', '2025-01-05 00:00:00'); // u as reporter: excluded

    const { records } = await getUserProfile(env.DB, 'u');
    expect(records.map((r) => r.id)).toEqual([tieHigh, tieLow, oldest]);
    expect(records.map((r) => r.status)).toEqual(['decided', 'awaiting_statement', 'withdrawn']);
    expect(records[0].subject).toEqual({ id: 'u', username: '被告', avatar_url: null });
    expect(records[0].reporter).toEqual({ id: 'judge', username: 'judge', avatar_url: null });
  });

  it('caps the case list at 200, dropping the oldest', async () => {
    await seedUser({ id: 'u' });
    await seedUser({ id: 'judge', judge: true });
    const stmts = Array.from({ length: 201 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO records (subject_id, reporter_id, type, delta, status, created_at)
         VALUES ('u', 'judge', 'late_minor', -3, 'decided', ?)`,
      ).bind(`2025-01-01 00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`),
    );
    await env.DB.batch(stmts);

    const { records } = await getUserProfile(env.DB, 'u');
    expect(records).toHaveLength(200);
    expect(records[0].created_at).toBe('2025-01-01 00:03:20');
    expect(records[199].created_at).toBe('2025-01-01 00:00:01');
  });
});
