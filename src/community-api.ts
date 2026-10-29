import { ApiError } from './api';
import type { CommunityAuditView, CommunityFunView, CommunityOperationView, CommunityOverview, CommunityResourceView, CommunityRoomView, CommunityRuntimeView, CommunitySettings, CommunitySettingsIssue, CommunityTool } from '@shared/community';
const base=(import.meta.env.VITE_API_BASE??'').replace(/\/$/,'');
export interface CommunityBackendCapabilities {fixedRooms:boolean}
/** Read the server's actual response before normalizing with newer defaults. */
export function communityBackendCapabilities(settings:unknown):CommunityBackendCapabilities {
 const rooms=settings&&typeof settings==='object'&&!Array.isArray(settings)?(settings as Record<string,unknown>).rooms:null;
 return {fixedRooms:!!rooms&&typeof rooms==='object'&&!Array.isArray(rooms)&&Object.hasOwn(rooms,'fixedCategoryRefs')};
}
export class CommunitySettingsApiError extends ApiError {
 constructor(message:string,status:number,readonly fieldErrors:CommunitySettingsIssue[]){super(message,status);this.name='CommunitySettingsApiError';}
}
function fieldIssues(value:unknown):CommunitySettingsIssue[] {
 if(!Array.isArray(value))return [];
 const clean=(text:string)=>text.replace(/\b\d{17,20}\b/g,'[已隐藏]').replace(/[\u0000-\u001f\u007f]/g,' ');
 return value.slice(0,200).filter((item):item is CommunitySettingsIssue=>!!item&&typeof item==='object'&&!Array.isArray(item)
  &&typeof item.path==='string'&&/^(?:|root|enabled|(?:rooms|welcome|roles|fun)(?:\.(?:[a-zA-Z][a-zA-Z0-9]*|\d{1,3}))*)$/.test(item.path)
  &&typeof item.label==='string'&&!!item.label.trim()&&item.label.length<=100&&typeof item.message==='string'&&!!item.message.trim()&&item.message.length<=500)
  .map(({path,label,message})=>({path,label:clean(label),message:clean(message)}));
}
export async function communityRequest<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
 const response=await fetch(base+path,{credentials:'include',signal,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});
 let raw:unknown;try{raw=await response.json();}catch{throw new ApiError('社区响应暂不可用',response.status);}
 const value=raw!==null&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
 if(!response.ok){
  const fields=response.status===400?fieldIssues(value?.fieldErrors):[];
  if(fields.length)throw new CommunitySettingsApiError('请检查标出的社区设置',response.status,fields);
  const message=value?.error==='社区设置格式或范围无效'?'社区设置未保存。请检查字段，并确认后端已更新。':typeof value?.error==='string'?value.error:'社区请求未成功';
  throw new ApiError(message,response.status);
 }
 return raw as T;
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
 save:(settings:CommunitySettings,version:number,capabilities:CommunityBackendCapabilities={fixedRooms:true})=>{
  let payload=settings;
  if(!capabilities.fixedRooms){
   const fixed=settings.rooms.fixedCategoryRefs;
   if(fixed!==undefined&&(!Array.isArray(fixed)||fixed.length))return Promise.reject(new CommunitySettingsApiError('当前后端尚未支持固定房间设置，请更新后端后保存。',409,[{path:'rooms.fixedCategoryRefs',label:'固定房间分类',message:'当前后端不支持此项，不能丢弃你的固定房选择；请先更新后端。'}]));
   const {fixedCategoryRefs:_fixed,...rooms}=settings.rooms;payload={...settings,rooms};
  }
  return communityRequest<CommunityAdminData&{operation:CommunityOperationView}>('/api/admin/community',{settings:payload,expectedVersion:version,requestKey:crypto.randomUUID()});
 },
 operations:(signal?:AbortSignal)=>communityRequest<{operations:CommunityOperationView[]}>('/api/admin/community/operations',undefined,signal),
 review:(ref:string)=>communityRequest<{operation:CommunityOperationView}>(`/api/admin/community/operations/${encodeURIComponent(ref)}/review`,{confirm:true,requestKey:crypto.randomUUID()}),
 audit:(signal?:AbortSignal)=>communityRequest<{audit:CommunityAuditView[]}>('/api/admin/community/audit',undefined,signal),
 sync:(kind:'resources.sync'|'panel.refresh'='resources.sync')=>communityRequest<{operation:CommunityOperationView}>('/api/admin/community/sync',{kind,requestKey:crypto.randomUUID()})
};
