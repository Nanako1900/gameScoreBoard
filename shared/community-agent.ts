import { isCommunityRef } from './community';

/** Independent from the retired fun configuration and the judicial AI switch. */
export interface AgentSettings {
  enabled: boolean;
  channelRefs: string[];
  userDailyLimit: number;
  guildDailyLimit: number;
  cooldownSeconds: number;
}
export interface AgentDocument {
  ref: string;
  title: string;
  content: string;
  published: boolean;
  version: number;
  updatedAt: string;
}
export interface AgentDocumentInput {
  ref?: string;
  title: string;
  content: string;
  published: boolean;
  expectedVersion: number;
}
export interface AgentSettingsInput { settings: AgentSettings; expectedVersion: number }
export type AgentRequestStatus = 'queued' | 'running' | 'sending' | 'succeeded' | 'failed' | 'canceled' | 'isolated';
export type AgentErrorCode = 'provider_unavailable' | 'provider_failed' | 'no_sources' | 'authorization_changed' |
  'configuration_changed' | 'knowledge_changed' | 'lease_expired' | 'delivery_failed' | 'delivery_unknown' | 'interrupted';
export interface AgentRequestView {
  status: AgentRequestStatus;
  createdAt: string;
  finishedAt: string | null;
  errorCode: AgentErrorCode | null;
}
export interface AgentAdminData {
  settings: AgentSettings;
  version: number;
  knowledgeVersion: number;
  documents: AgentDocument[];
  usage: { day: string; total: number };
  requests: AgentRequestView[];
  provider: { ready: boolean; reason: string | null };
}

export function defaultAgentSettings(): AgentSettings {
  return { enabled: false, channelRefs: [], userDailyLimit: 20, guildDailyLimit: 200, cooldownSeconds: 10 };
}
export class AgentValidationError extends Error {
  constructor(message = '问答设置格式或范围无效') { super(message); this.name = 'AgentValidationError'; }
}
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new AgentValidationError();
  return input as Record<string, unknown>;
}
function integer(input: unknown, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) throw new AgentValidationError();
  return input;
}
export function parseAgentSettings(input: unknown): AgentSettings {
  const value = object(input, ['enabled', 'channelRefs', 'userDailyLimit', 'guildDailyLimit', 'cooldownSeconds']);
  if (typeof value.enabled !== 'boolean' || !Array.isArray(value.channelRefs) || value.channelRefs.length > 10 || value.channelRefs.some(ref => !isCommunityRef(ref))) throw new AgentValidationError();
  return { enabled: value.enabled, channelRefs: [...new Set(value.channelRefs as string[])],
    userDailyLimit: integer(value.userDailyLimit, 1, 100), guildDailyLimit: integer(value.guildDailyLimit, 1, 1000), cooldownSeconds: integer(value.cooldownSeconds, 0, 3600) };
}

/** Free text can be published to Discord. Keep identifiers and credential-like
 * strings out even when an administrator accidentally pastes them in a guide. */
export function safeAgentText(input: string): string {
  return input
    .replace(/https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/[^\s<>"')]+/gi, '［频道链接已隐藏］')
    .replace(/<[@#][!&]?\d+>/g, '［隐藏提及］')
    .replace(/\b\d{17,20}\b/g, '［隐藏］')
    .replace(/\b(?:sk|rk|pk)[-_][a-z0-9_-]{8,}\b/gi, '［凭据已隐藏］')
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, 'Bearer ［凭据已隐藏］')
    .replace(/\b(?:api[_-]?key|access[_-]?token|authorization|client[_-]?secret|token)["']?\s*[:=]\s*["']?[^\s,"';}]+["']?/gi, '［凭据已隐藏］')
    .replace(/\b[a-z0-9_-]{20,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{20,}\b/gi, '［凭据已隐藏］')
    .replace(/@(everyone|here)\b/gi, '［隐藏提及］')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}
export function parseAgentDocumentInput(input: unknown): AgentDocumentInput {
  const value = object(input, ['ref', 'title', 'content', 'published', 'expectedVersion']);
  if (value.ref !== undefined && !isCommunityRef(value.ref)) throw new AgentValidationError('资料引用无效');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 || value.title.includes('\u0000') ||
      typeof value.content !== 'string' || !value.content.trim() || value.content.length > 8000 || value.content.includes('\u0000') || typeof value.published !== 'boolean') throw new AgentValidationError('资料需要 1–100 字标题、1–8000 字正文和明确的发布状态');
  const title = safeAgentText(value.title.trim()).slice(0, 100), content = safeAgentText(value.content.trim()).slice(0, 8000);
  if (!title.trim() || !content.trim()) throw new AgentValidationError('资料标题和正文不能为空');
  return { ...(value.ref === undefined ? {} : { ref: value.ref as string }), title, content,
    published: value.published, expectedVersion: integer(value.expectedVersion, 0, Number.MAX_SAFE_INTEGER) };
}
