import { ApiError } from './api';
import type { CommunityAuditView, CommunityFunView, CommunityOperationView, CommunityOverview, CommunityResourceView, CommunityRoomView, CommunityRuntimeView, CommunitySettings, CommunityTool } from '@shared/community';
const base=(import.meta.env.VITE_API_BASE??'').replace(/\/$/,'');
export async function communityRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
 const response=await fetch(base+path,{credentials:'include',signal,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 let value;try{value=await response.json();}catch{throw new ApiError('社区响应暂不可用',response.status);}
 if(!response.ok)throw new ApiError(typeof value?.error==='string'?value.error:'社区请求未成功',response.status);
 return value as T;
}
export interface CommunityRoles {choices:CommunityResourceView[];selectedRefs:string[];maxChoices:number;enabled:boolean}
export interface CommunityAdminData {settings:CommunitySettings;version:number;runtime:CommunityRuntimeView}
export const communityApi={
 overview:(signal?:AbortSignal)=>communityRequest<CommunityOverview>('/api/community',undefined,signal),
 rooms:(signal?:AbortSignal)=>communityRequest<{rooms:CommunityRoomView[]}>('/api/community/rooms',undefined,signal),
 resources:(kind='member',admin=false,signal?:AbortSignal)=>communityRequest<{resources:CommunityResourceView[]}>(`${admin?'/api/admin/community':'/api/community'}/resources${kind?`?kind=${encodeURIComponent(kind)}`:''}`,undefined,signal),
 roles:(signal?:AbortSignal)=>communityRequest<CommunityRoles>('/api/community/roles',undefined,signal),
 fun:(signal?:AbortSignal)=>communityRequest<{items:CommunityFunView[]}>('/api/community/fun',undefined,signal),
 operation:(ref:string,signal?:AbortSignal)=>communityRequest<{operation:CommunityOperationView}>(`/api/community/operations/${encodeURIComponent(ref)}`,undefined,signal),
 createRoom:(name:string)=>communityRequest<{operation:CommunityOperationView}>('/api/community/rooms',{name,requestKey:crypto.randomUUID()}),
 roomAction:(room:CommunityRoomView,action:string,fields:Record<string,unknown>={})=>communityRequest<{operation:CommunityOperationView}>(`/api/community/rooms/${room.ref}/actions`,{action,...fields,expectedVersion:room.version,requestKey:crypto.randomUUID()}),
 setRoles:(roleRefs:string[])=>communityRequest<{operation:CommunityOperationView}>('/api/community/roles',{roleRefs,requestKey:crypto.randomUUID()}),
 createFun:(kind:CommunityTool,input:unknown,roomRef:string|null)=>communityRequest<{operation:CommunityOperationView}>('/api/community/fun',{kind,input,roomRef,requestKey:crypto.randomUUID()}),
 funAction:(ref:string,action:string,fields:Record<string,unknown>={})=>communityRequest<{operation:CommunityOperationView}>(`/api/community/fun/${ref}/actions`,{action,...fields,requestKey:crypto.randomUUID()}),
 admin:(signal?:AbortSignal)=>communityRequest<CommunityAdminData>('/api/admin/community',undefined,signal),
 save:(settings:CommunitySettings,version:number)=>communityRequest<CommunityAdminData&{operation:CommunityOperationView}>('/api/admin/community',{settings,expectedVersion:version,requestKey:crypto.randomUUID()}),
 operations:(signal?:AbortSignal)=>communityRequest<{operations:CommunityOperationView[]}>('/api/admin/community/operations',undefined,signal),
 review:(ref:string)=>communityRequest<{operation:CommunityOperationView}>(`/api/admin/community/operations/${encodeURIComponent(ref)}/review`,{confirm:true,requestKey:crypto.randomUUID()}),
 audit:(signal?:AbortSignal)=>communityRequest<{audit:CommunityAuditView[]}>('/api/admin/community/audit',undefined,signal),
 sync:(kind:'resources.sync'|'panel.refresh'='resources.sync')=>communityRequest<{operation:CommunityOperationView}>('/api/admin/community/sync',{kind,requestKey:crypto.randomUUID()})
};
