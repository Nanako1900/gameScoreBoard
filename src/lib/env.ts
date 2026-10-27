// Build-time settings read from import.meta.env (DOM project only — the unit
// suite type-checks without Vite's types, so pure modules must not import this).
import { parseInviteUrl } from './inviteUrl';

/** The Discord share page for 加入服务器; null hides the row. */
export const DISCORD_INVITE_URL: string | null = parseInviteUrl(
  import.meta.env.VITE_DISCORD_INVITE_URL,
);
