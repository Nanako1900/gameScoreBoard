// Environment of the music process. Like readBotConfig, every problem is
// reported at once and the token is never echoed.
import { envFlag } from '../env';

export interface MusicConfig {
  token: string;
  guildId: string;
  databaseUrl: string;
  frontendUrl: string;
  masterKey: string | undefined;
  readOnly: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;
const POSTGRES_URL = /^postgres(ql)?:\/\//;

function httpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/** False when the process should idle: no token, or MUSIC_ENABLED is off or not a yes/no value. */
export function musicWanted(
  env: Record<string, string | undefined>,
  warn: (line: string) => void = console.warn,
): boolean {
  const enabled = envFlag(env.MUSIC_ENABLED, false, 'MUSIC_ENABLED', warn);
  return enabled && (env.MUSIC_DISCORD_TOKEN ?? '').trim() !== '';
}

export function readMusicConfig(env: Record<string, string | undefined>): MusicConfig {
  const get = (name: string): string => (env[name] ?? '').trim();
  const problems: string[] = [];
  const token = get('MUSIC_DISCORD_TOKEN');
  if (!token) problems.push('MUSIC_DISCORD_TOKEN is missing');
  else if (/\s/.test(token)) problems.push("MUSIC_DISCORD_TOKEN must be the bare token (no 'Bot ' prefix, no spaces)");
  const guildId = get('GUILD_ID');
  if (!SNOWFLAKE.test(guildId)) problems.push(`GUILD_ID must be a Discord id (17–20 digits), got "${guildId}"`);
  const databaseUrl = get('DATABASE_URL');
  if (!POSTGRES_URL.test(databaseUrl)) problems.push('DATABASE_URL must be a postgres:// URL');
  const frontendUrl = httpUrl(get('FRONTEND_URL'));
  if (!frontendUrl) problems.push(`FRONTEND_URL must be an http(s) URL, got "${get('FRONTEND_URL')}"`);
  if (problems.length > 0) throw new Error(`music configuration is invalid:\n- ${problems.join('\n- ')}`);
  return {
    token,
    guildId,
    databaseUrl,
    frontendUrl: frontendUrl!,
    masterKey: get('AI_CONFIG_MASTER_KEY') || undefined,
    readOnly: envFlag(env.READ_ONLY, false, 'READ_ONLY'),
  };
}

export function musicPlayerUrl(frontendUrl: string, roomRef: string): string {
  return `${frontendUrl}/community/music/${encodeURIComponent(roomRef)}`;
}
