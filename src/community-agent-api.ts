import type { AgentAdminData, AgentSettings } from '@shared/community-agent';
import { communityRequest } from './community-api';

export interface AgentDocumentSave { ref?: string; title: string; content: string; published: boolean; expectedVersion: number }
const path = '/api/admin/community/agent';
export const communityAgentApi = {
  read: (signal?: AbortSignal) => communityRequest<AgentAdminData>(path, undefined, signal),
  save: (settings: AgentSettings, expectedVersion: number) => communityRequest<AgentAdminData>(path, { settings, expectedVersion }),
  saveDocument: (document: AgentDocumentSave) => communityRequest<AgentAdminData>(`${path}/documents`, document),
  deleteDocument: (ref: string, expectedVersion: number) => communityRequest<AgentAdminData>(`${path}/documents/${encodeURIComponent(ref)}/delete`, { expectedVersion }),
};
