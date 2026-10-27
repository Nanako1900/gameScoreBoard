import type { DiscordLinkInfo } from '../api';

/** The caller's private read, with unsupported distinct from loading and failure. */
export type DiscordLinkValue = DiscordLinkInfo | null | undefined | 'error';
export interface DiscordLinkRead {
  value: DiscordLinkValue;
  loading: boolean;
  error?: string;
}
