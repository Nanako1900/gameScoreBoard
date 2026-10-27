/**
 * VITE_DISCORD_INVITE_URL is build-time config, so it is checked here before it
 * becomes an href: only an absolute https: URL without credentials is used.
 * Anything else (unset, blank, http:, javascript:, a bare discord.gg code)
 * hides the 加入服务器 row instead of rendering a broken or unsafe link.
 */
export function parseInviteUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
