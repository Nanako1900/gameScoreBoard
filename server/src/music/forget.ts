// Removes a member's saved music login when their Discord binding goes away.
// Runs in the Node backend only (PostgreSQL through the D1-shaped adapter).

const DELETE_BY_DISCORD_ID = `DELETE FROM music_accounts
  WHERE member_ref IN (
    SELECT ref FROM community_resources WHERE kind = 'member' AND external_id = ?
  )`;

/**
 * After an unlink the web can no longer identify this member, so they could not
 * log out themselves: the saved login is deleted here instead. A session still
 * playing with it notices the missing account and falls back to anonymous
 * playback. Failure is reported, never thrown: unlinking has already succeeded.
 */
export async function forgetMusicAccount(
  db: D1Database,
  discordUserId: string,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await db.prepare(DELETE_BY_DISCORD_ID).bind(discordUserId).run();
  } catch (error) {
    onError(error);
  }
}
