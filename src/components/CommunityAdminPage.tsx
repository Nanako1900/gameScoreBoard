import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CommunityAuditView, CommunityOperationView, CommunityResourceKind, CommunityResourceView, CommunityRoomView, CommunitySettings, CommunitySettingsIssue } from '@shared/community';
import { COMMUNITY_TOOLS, communitySettingsIssues, parseCommunitySettings } from '@shared/community';
import { ApiError } from '../api';
import { communityApi, communityBackendCapabilities, CommunitySettingsApiError, type CommunityAdminData, type CommunityBackendCapabilities } from '../community-api';
import type { User } from '../types';
import { NOT_FOUND_TITLE } from '../lib/routeCopy';
import { usePageLeaveGuard } from '../lib/usePageLeaveGuard';
import { ConfirmInline } from './ConfirmInline';
import { Link } from './Link';
import { NotFound } from './NotFound';
import { OperationNotice, operationLabels, communityActionLabel, toolNames, useCommunityOperation } from './CommunityPage';
import './community.css';
import './community-admin.css';

const errorMessage=(error:unknown)=>error instanceof Error?error.message:'社区管理暂不可用，请重试';
const time=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN'):'尚未同步';
const groups={enabled:'社区总开关',rooms:'语音房间',welcome:'入服欢迎',roles:'兴趣身份',fun:'趣味互动与 AI'} as const;
const idFor=(path:string)=>path===''?'community-admin-main':Object.hasOwn(groups,path)&&path!=='enabled'?`community-${path}`:`community-setting-${path.replace(/\./g,'-')}`;
function fieldPath(path:string):string {
 return path.replace(/^(rooms\.fixedCategoryRefs|roles\.allowedRefs|fun\.enabledTools)\.\d+$/, '$1').replace(/^(fun\.topics\.\d+\.tags)\.\d+$/, '$1');
}
function revealSetting(path:string):void {
 const candidates=[...document.querySelectorAll<HTMLElement>('[data-setting-path]')];
 const target=candidates.find(element=>element.dataset.settingPath===path)
  ?? candidates.filter(element=>element.dataset.settingPath&&path.startsWith(element.dataset.settingPath+'.')).sort((a,b)=>(b.dataset.settingPath?.length??0)-(a.dataset.settingPath?.length??0))[0]
  ?? document.getElementById('community-admin-main');
 if(!target)return;
 let ancestor:HTMLElement|null=target;
 while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}
 target.focus();target.scrollIntoView?.({block:'center'});
}
function previewWelcome(value:string):string {
 return value.replace(/\{name\}/g,'新成员').replace(/\{server\}/g,'我们的社区').replace(/\{memberCount\}/g,'100')
  .replace(/<[@#][^>]*>/g,'[已隐藏]').replace(/@everyone|@here/gi,'大家').replace(/\b\d{17,20}\b/g,'[已隐藏]');
}
function candidateSettings(draft:CommunitySettings,numbers:Record<string,string>):unknown {
 const result=structuredClone(draft) as unknown as Record<string,unknown>;
 for(const [path,text] of Object.entries(numbers)){
  const parts=path.split('.');let target=result;
  for(const part of parts.slice(0,-1))target=target[part] as Record<string,unknown>;
  target[parts[parts.length-1]]=text.trim()===''?undefined:path==='rooms.emptyGraceSeconds'?Math.round(Number(text)*60):Number(text);
 }
 return result;
}
function validateDraft(draft:CommunitySettings,numbers:Record<string,string>,capabilities:CommunityBackendCapabilities):CommunitySettingsIssue[] {
 const issues=communitySettingsIssues(candidateSettings(draft,numbers));
 const minutes=numbers['rooms.emptyGraceSeconds'];
 if(minutes!==undefined&&minutes.trim()!==''&&(!Number.isFinite(Number(minutes))||Number(minutes)<0.25||Number(minutes)>1440)){
  const index=issues.findIndex(issue=>issue.path==='rooms.emptyGraceSeconds');if(index>=0)issues.splice(index,1);
  issues.push({path:'rooms.emptyGraceSeconds',label:'空房多久删除（分钟）',message:'空房多久删除应为 0.25–1440 分钟。'});
 }
 if(!capabilities.fixedRooms&&(draft.rooms.fixedCategoryRefs?.length??0)>0)issues.push({path:'rooms.fixedCategoryRefs',label:'固定房间分类',message:'当前后端不支持固定房间，请先更新后端；你的选择已保留。'});
 return issues;
}
interface FieldsContextValue {issues:CommunitySettingsIssue[];numbers:Record<string,string>;number:(path:string,raw:string,apply:(value:number)=>void)=>void}
const FieldsContext=createContext<FieldsContextValue>({issues:[],numbers:{},number:()=>undefined});
function useField(path?:string){
 const context=useContext(FieldsContext);const issue=path?context.issues.find(item=>fieldPath(item.path)===path):undefined;
 const id=path?idFor(path):undefined;
 return {context,issue,id,attributes:path?{id,name:path,'data-setting-path':path,'aria-invalid':issue?true:undefined,'aria-describedby':issue?`${id}-error`:undefined}:{}};
}
function FieldError({path}:{path:string}){const {issue,id}=useField(path);return issue?<p id={`${id}-error`} className="community-field-error">{issue.message}</p>:null;}
function FieldGroup({path,children}:{path:string;children:React.ReactNode}){
 const field=useField(path);return <div id={field.id} data-setting-path={path} tabIndex={-1} aria-invalid={field.issue?true:undefined} aria-describedby={field.issue?`${field.id}-error`:undefined}>{children}<FieldError path={path}/></div>;
}
function SettingsErrors({issues}:{issues:CommunitySettingsIssue[]}){
 if(!issues.length)return null;
 return <div className="community-error-summary" role="alert" aria-label="社区设置需要修改"><strong>有 {issues.length} 项设置需要修改</strong><p>点击下面的说明，前往对应设置。</p><ul>{issues.map((issue,index)=><li key={`${issue.path}:${index}`}><a href={`#${idFor(fieldPath(issue.path))}`} onClick={event=>{event.preventDefault();revealSetting(fieldPath(issue.path));}}>{issue.message}</a></li>)}</ul></div>;
}
export function CommunityAdminPage({me}:{me:User|null}) {
 if(!me?.is_admin)return <NotFound title={NOT_FOUND_TITLE}/>;
 return <CommunityAdminContent key={`${me.id}:${me.is_admin}`} />;
}
interface AdminState extends CommunityAdminData {
 resources:CommunityResourceView[];operations:CommunityOperationView[];audit:CommunityAuditView[];rooms:CommunityRoomView[];
 roomsProblem:string|null;operationsProblem:string|null;auditProblem:string|null;capabilities:CommunityBackendCapabilities;
}
function CommunityAdminContent() {
 const [data,setData]=useState<AdminState|null>(null);const [draft,setDraft]=useState<CommunitySettings|null>(null);
 const [reviewRef,setReviewRef]=useState<string|null>(null);const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
 const [tagDraft,setTagDraft]=useState<Record<string,string>>({});const [numbers,setNumbers]=useState<Record<string,string>>({});const [issues,setIssues]=useState<CommunitySettingsIssue[]>([]);
 const [error,setError]=useState<string|null>(null);const [status,setStatus]=useState(0);const [refresh,setRefresh]=useState(0);const [savedVersion,setSavedVersion]=useState<number|null>(null);
 const accessEpoch=useRef(0);const baseline=useRef<{json:string;version:number}|null>(null);const dirtyRef=useRef(false);
 const [newVersion,setNewVersion]=useState<number|null>(null);const [discardConfirm,setDiscardConfirm]=useState(false);const [departing,setDeparting]=useState(false);
 const previous=baseline.current?JSON.parse(baseline.current.json) as CommunitySettings:null;
 const invalidNumberGroups=Object.entries(numbers).filter(([path,value])=>value.trim()===''||!Number.isFinite(Number(value))||path==='rooms.emptyGraceSeconds'&&(Number(value)<0.25||Number(value)>1440)).map(([path])=>path.split('.')[0]);
 const changedGroups=draft&&previous?(Object.keys(groups) as Array<keyof typeof groups>).filter(key=>JSON.stringify(draft[key])!==JSON.stringify(previous[key])||invalidNumberGroups.includes(key)||key==='fun'&&Object.entries(tagDraft).some(([ref,text])=>text!==(draft.fun.topics.find(topic=>topic.ref===ref)?.tags.join(', ')??''))):[];
 const dirty=changedGroups.length>0;dirtyRef.current=dirty;
 const reload=useCallback(()=>setRefresh(value=>value+1),[]);
 const inaccessible=useCallback((cause:ApiError)=>{accessEpoch.current++;baseline.current=null;dirtyRef.current=false;setNewVersion(null);setDiscardConfirm(false);setData(null);setDraft(null);setTagDraft({});setNumbers({});setIssues([]);setReviewRef(null);setSavedVersion(null);setStatus(cause.status);setError(errorMessage(cause));},[]);
 const op=useCommunityOperation(reload,{onUnavailable:inaccessible});
 const pendingFocus=useRef<string|null>(null);
 useEffect(()=>{if(pendingFocus.current!==null&&!op.busy){revealSetting(pendingFocus.current);pendingFocus.current=null;}},[issues,op.busy]);
 const guard=usePageLeaveGuard(dirty&&!departing&&![401,403,404].includes(status),{onLeave:()=>{
  accessEpoch.current++;baseline.current=null;dirtyRef.current=false;op.reset();setData(null);setDraft(null);setTagDraft({});setNumbers({});setIssues([]);setReviewRef(null);setNewVersion(null);setDiscardConfirm(false);setSavedVersion(null);setDeparting(true);
 }});
 useEffect(()=>{if(departing)return;window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);},[reload,departing]);
 useEffect(()=>{
  if(departing)return;
  const abort=new AbortController();const epoch=accessEpoch.current;setError(null);
  const active=()=>!abort.signal.aborted&&accessEpoch.current===epoch;
  const checked=async<T,>(read:()=>Promise<T>,main=false):Promise<T>=>{
   try{return await read();}catch(cause){
    if(active()&&cause instanceof ApiError&&([401,403].includes(cause.status)||main&&cause.status===404)){op.reset();inaccessible(cause);}
    throw cause;
   }
  };
  let diagnostics={operations:[] as CommunityOperationView[],audit:[] as CommunityAuditView[],rooms:[] as CommunityRoomView[],operationsProblem:'正在读取操作记录…' as string|null,auditProblem:'正在读取管理记录…' as string|null,roomsProblem:'正在读取固定房间…' as string|null};
  const optional=async<T,>(read:()=>Promise<T>,apply:(value:T)=>Partial<typeof diagnostics>,fallback:Partial<typeof diagnostics>)=>{
   let patch:Partial<typeof diagnostics>;
   try{patch=apply(await checked(read));}catch{patch=fallback;}
   if(!active())return;
   diagnostics={...diagnostics,...patch};setData(current=>current?{...current,...patch}:current);
  };
  void optional(()=>communityApi.operations(abort.signal),value=>({operations:value.operations,operationsProblem:null}),{operations:[],operationsProblem:'操作记录暂不可用，请重试。'});
  void optional(()=>communityApi.audit(abort.signal),value=>({audit:value.audit,auditProblem:null}),{audit:[],auditProblem:'管理记录暂不可用，请重试。'});
  void optional(()=>communityApi.rooms(abort.signal),value=>({rooms:Array.isArray(value.rooms)?value.rooms:[],roomsProblem:null}),{rooms:[],roomsProblem:'固定房间列表暂不可用，请刷新后重试。'});
  void Promise.all([checked(()=>communityApi.admin(abort.signal),true),checked(()=>communityApi.resources('',true,abort.signal))])
   .then(([admin,resources])=>{
    if(!active())return;
    if(baseline.current&&admin.version<baseline.current.version)return;
    setStatus(0);setData({...admin,resources:resources.resources,...diagnostics,capabilities:communityBackendCapabilities(admin.settings)});
    if(!dirtyRef.current){baseline.current={json:JSON.stringify(admin.settings),version:admin.version};setDraft(structuredClone(admin.settings));setTagDraft({});setNumbers({});setIssues([]);setNewVersion(null);}else if(baseline.current?.version!==admin.version)setNewVersion(admin.version);
   })
   .catch(cause=>{if(active()){setError(errorMessage(cause));setStatus(cause instanceof ApiError?cause.status:500);}});
  return()=>abort.abort();
 },[refresh,departing]);
 const edited=()=>{setSavedVersion(null);setError(null);if(!op.busy)op.reset();};
 const updateDraft=(next:CommunitySettings,nextNumbers=numbers)=>{
  setDraft(next);edited();if(issues.length&&data)setIssues(validateDraft(next,nextNumbers,data.capabilities));
 };
 const change=<K extends keyof CommunitySettings>(group:K,values:Partial<CommunitySettings[K]>)=>{if(draft)updateDraft({...draft,[group]:{...draft[group] as object,...values}});};
 const number=(path:string,raw:string,apply:(value:number)=>void)=>{
  const next={...numbers,[path]:raw};setNumbers(next);edited();
  if(raw.trim()!==''&&Number.isFinite(Number(raw)))apply(path==='rooms.emptyGraceSeconds'?Math.round(Number(raw)*60):Number(raw));
  if(issues.length&&draft&&data)setIssues(validateDraft(draft,next,data.capabilities));
 };
 const showIssues=(problems:CommunitySettingsIssue[])=>{pendingFocus.current=problems.length?fieldPath(problems[0].path):null;setIssues(problems);};
 const save=()=>{
  if(!draft||!data||op.busy)return;
  const problems=validateDraft(draft,numbers,data.capabilities);if(problems.length){showIssues(problems);return;}
  const validated=parseCommunitySettings(candidateSettings(draft,numbers));setIssues([]);
  void op.submit(async()=>{
   const epoch=accessEpoch.current;
   try{
    const result=await communityApi.save(validated,baseline.current?.version??data.version,data.capabilities);
    if(accessEpoch.current!==epoch)return result;
    baseline.current={json:JSON.stringify(result.settings),version:result.version};dirtyRef.current=false;setNewVersion(null);setDiscardConfirm(false);setData(current=>current?{...current,...result}:current);setDraft(structuredClone(result.settings));setTagDraft({});setNumbers({});setSavedVersion(result.version);return result;
   }catch(cause){if(accessEpoch.current===epoch&&cause instanceof CommunitySettingsApiError)showIssues(cause.fieldErrors);throw cause;}
  });
 };
 const restoreLatest=()=>{if(!data)return;baseline.current={json:JSON.stringify(data.settings),version:data.version};dirtyRef.current=false;setDraft(structuredClone(data.settings));setTagDraft({});setNumbers({});setIssues([]);setNewVersion(null);setDiscardConfirm(false);setSavedVersion(null);op.reset();};
 if(departing)return <p role="status">正在离开…</p>;
 if(status===403||status===401)return <NotFound title={NOT_FOUND_TITLE}/>;
 if(!data||!draft)return <section className="community-page"><Link to="/settings">← 设置</Link><h1>社区管理</h1>{error?<><p role="alert">{status===404?'当前服务暂未提供社区管理':error}</p>{status!==404&&<button onClick={reload}>重新加载</button>}</>:<p role="status">管理设置加载中…</p>}</section>;
 const ready=data.runtime.ready&&data.runtime.appliedVersion===data.version;
 const openGroup=(path:string)=>revealSetting(path);
 return <section className="community-page community-admin" id="community-admin-main" data-setting-path="" tabIndex={-1}>
  <div className="community-heading"><div><Link className="community-back" to="/settings">← 设置</Link><p className="community-eyebrow">让社区自然运转</p><h1>社区管理</h1><p>按分组编辑，最后一次保存全部设置。</p></div><Link className="community-button community-button--quiet" to="/community">查看社区与房间</Link></div>
  {guard.confirming&&<ConfirmInline question="还有未保存的社区设置" cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={guard.stay} onConfirm={guard.leave}>尚未提交的修改不会保存；已经开始的保存仍可能完成。</ConfirmInline>}
  <nav className="community-tabs community-admin-nav" aria-label="社区管理分组">{(['rooms','welcome','roles','fun'] as const).map(group=><a key={group} href={`#community-${group}`} onClick={event=>{event.preventDefault();openGroup(group);}}>{groups[group]}</a>)}<a href="#community-runtime" onClick={()=>setDiagnosticsOpen(true)}>运行与日志</a></nav>
  <div className="community-notice" role="status"><strong>{ready?'机器人已就绪':'配置尚未应用完成'}</strong>{data.runtime.problem&&<p>{data.runtime.problem}</p>}{savedVersion!==null&&!ready&&<p>已保存待应用</p>}</div>
  {data.operations.some(operation=>operation.status==='needs_review')&&<div className="community-notice community-notice--alert" role="status"><strong>有 {data.operations.filter(operation=>operation.status==='needs_review').length} 项操作需要管理员核对</strong><p>先核对 Discord 实际状态，再处理旧任务。</p><a className="community-button community-button--quiet" href="#community-runtime" onClick={()=>setDiagnosticsOpen(true)}>查看待处理操作</a></div>}
  {newVersion!==null&&<div className="community-notice community-notice--alert" role="status"><strong>已有新的社区设置版本</strong><p>当前服务器为版本 {newVersion}；你的修改仍保留在版本 {baseline.current?.version}。保存时会检查原版本，避免覆盖其他管理员的更新。</p>{!discardConfirm?<button disabled={op.busy} onClick={()=>setDiscardConfirm(true)}>载入最新设置</button>:<div className="community-actions"><button disabled={op.busy} onClick={restoreLatest}>确认放弃修改并载入</button><button onClick={()=>setDiscardConfirm(false)}>保留当前编辑</button></div>}</div>}
  <OperationNotice operation={op.operation}/>{(error||op.error)&&!issues.length&&<p className="community-error" role="alert">{op.error??error}</p>}
  <SettingsErrors issues={issues}/>
  <FieldsContext.Provider value={{issues,numbers,number}}>
  <form noValidate onSubmit={event=>{event.preventDefault();save();}}>
   <fieldset className="community-admin-fields" disabled={op.busy}>
    <div className="community-card community-admin-section"><Toggle path="enabled" label="启用社区中心" checked={draft.enabled} onChange={enabled=>updateDraft({...draft,enabled})}/><p className="community-muted">暂停新操作时，机器人会继续安全处理已登记房间的恢复与回收。</p></div>
    <section className="community-card community-admin-section" id="community-rooms" data-setting-path="rooms" tabIndex={-1} aria-labelledby="community-rooms-title"><h2 id="community-rooms-title">语音房间</h2><FieldError path="rooms"/><p>成员进入建房入口，机器人自动建房并移入；临时房无人后按设置时间删除。</p><div className="community-setting-grid">
     <Toggle path="rooms.enabled" label="开放自助语音房" checked={draft.rooms.enabled} onChange={enabled=>change('rooms',{enabled})}/>
     <ResourceSelect path="rooms.creatorRef" label="创建房间入口" kind="voice" value={draft.rooms.creatorRef} resources={data.resources} onChange={creatorRef=>change('rooms',{creatorRef})}/>
     <ResourceSelect path="rooms.categoryRef" label="临时房间分类" kind="category" value={draft.rooms.categoryRef} resources={data.resources} onChange={categoryRef=>change('rooms',{categoryRef})}/>
     <MinuteField seconds={draft.rooms.emptyGraceSeconds} onChange={emptyGraceSeconds=>change('rooms',{emptyGraceSeconds})}/>
     <NumberField path="rooms.userLimit" label="默认人数限制（0 为不限）" value={draft.rooms.userLimit} min={0} max={draft.rooms.maxUserLimit} onChange={userLimit=>change('rooms',{userLimit})}/>
    </div><details className="community-room-advanced"><summary>高级房间设置</summary><div className="community-setting-grid">
     <ResourceSelect path="rooms.waitingRef" label="管理员关闭时的等候区" kind="voice" value={draft.rooms.waitingRef} resources={data.resources} onChange={waitingRef=>change('rooms',{waitingRef})}/>
     <ResourceSelect path="rooms.panelRef" label="旧全局入口频道（可选）" kind="text" value={draft.rooms.panelRef} resources={data.resources} onChange={panelRef=>change('rooms',{panelRef})}/>
     <AccessField value={draft.rooms.visibility} onChange={visibility=>change('rooms',{visibility})}/>
     <FieldGroup path="rooms.maxPerMember"><p className="community-muted">每位成员最多保留 1 间临时房。</p></FieldGroup>
     <NumberField path="rooms.maxRooms" label="全服最多房间" value={draft.rooms.maxRooms} min={1} max={100} onChange={maxRooms=>change('rooms',{maxRooms})}/>
     <NumberField path="rooms.cooldownSeconds" label="建房冷却（秒）" value={draft.rooms.cooldownSeconds} min={0} max={3600} onChange={cooldownSeconds=>change('rooms',{cooldownSeconds})}/>
     <NumberField path="rooms.ownerGraceSeconds" label="房主离开宽限（秒）" value={draft.rooms.ownerGraceSeconds} min={15} max={86400} onChange={ownerGraceSeconds=>change('rooms',{ownerGraceSeconds})}/>
     <NumberField path="rooms.maxUserLimit" label="房主可设人数上限" value={draft.rooms.maxUserLimit} min={1} max={99} onChange={maxUserLimit=>change('rooms',{maxUserLimit})}/>
    </div><p className="community-muted">旧全局入口只用于集中打开社区工具，房内控制卡不需要单独配置频道。有人房间需确认移动成员后再关闭；缺少等候区时不会强行删除。</p></details>
    <details className="community-room-advanced"><summary>固定房间控制卡</summary>{!data.capabilities.fixedRooms&&<p className="community-notice">当前后端尚不支持固定房间，请更新后端后使用。</p>}<p>选择已有私人房间所在的分类。保存后，机器人会登记其中的语音房并补上控制卡；固定房间不会自动删除。</p>
    <FieldGroup path="rooms.fixedCategoryRefs"><div className="community-choice-grid">{data.resources.filter(resource=>resource.kind==='category').map(category=>{
     const selected=draft.rooms.fixedCategoryRefs?.includes(category.ref)??false;
     return <Toggle key={category.ref} label={`${category.name}${category.available?'':'（不可用）'}`} checked={selected} disabled={!data.capabilities.fixedRooms||!category.available&&!selected} onChange={checked=>change('rooms',{fixedCategoryRefs:checked?[...(draft.rooms.fixedCategoryRefs??[]),category.ref]:(draft.rooms.fixedCategoryRefs??[]).filter(ref=>ref!==category.ref)})}/>;
    })}</div>{(draft.rooms.fixedCategoryRefs??[]).filter(ref=>!data.resources.some(resource=>resource.kind==='category'&&resource.ref===ref)).map((ref,index)=><p key={ref}>已失效固定房间分类 {index+1} <button type="button" disabled={!data.capabilities.fixedRooms} onClick={()=>change('rooms',{fixedCategoryRefs:(draft.rooms.fixedCategoryRefs??[]).filter(value=>value!==ref)})}>移除已失效分类 {index+1}</button></p>)}</FieldGroup>
    <h3>房间管理员</h3><p className="community-muted">分配不会额外授予频道查看或连接权限。用户 ID 仅用于本次校验，提交后清空。</p>{data.roomsProblem?<p role="alert">{data.roomsProblem}</p>:data.rooms.filter(room=>room.kind==='fixed').length?data.rooms.filter(room=>room.kind==='fixed').map(room=><FixedRoomManagers key={`${room.ref}:${room.version}`} room={room} disabled={!data.capabilities.fixedRooms||!ready||op.busy||room.status!=='active'} submit={op.submit}/>):<p className="community-muted">尚未登记固定房间。选择分类保存后，等待机器人同步即可。</p>}
    </details></section>
    <details className="community-card community-admin-section community-config-group" id="community-welcome" data-setting-path="welcome" tabIndex={-1}><summary><h2>入服欢迎</h2></summary><FieldError path="welcome"/><div className="community-setting-grid">
     <Toggle path="welcome.enabled" label="启用入服欢迎" checked={draft.welcome.enabled} onChange={enabled=>change('welcome',{enabled})}/>
     <ResourceSelect path="welcome.channelRef" label="欢迎频道" kind="text" value={draft.welcome.channelRef} resources={data.resources} onChange={channelRef=>change('welcome',{channelRef})}/>
     <NumberField path="welcome.rejoinCooldownHours" label="重入欢迎冷却（小时）" value={draft.welcome.rejoinCooldownHours} min={1} max={720} onChange={rejoinCooldownHours=>change('welcome',{rejoinCooldownHours})}/>
     <TextField path="welcome.template" label="欢迎文案" multiline rows={4} maxLength={1500} value={draft.welcome.template} onChange={template=>change('welcome',{template})}/>
     <p className="community-muted community-full">支持 {'{name}'}、{'{server}'}、{'{memberCount}'}，不会触发成员或全服提及。关闭欢迎后仍保留并校验文案。</p>
     <div className="community-admin-preview community-full" aria-label="欢迎预览"><strong>欢迎预览</strong><p>{previewWelcome(draft.welcome.template)}</p><small>仅预览，不会发送消息。</small></div>
    </div></details>
    <details className="community-card community-admin-section community-config-group" id="community-roles" data-setting-path="roles" tabIndex={-1}><summary><h2>兴趣身份</h2></summary><FieldError path="roles"/><p>只开放明确允许、且机器人可以安全授予的身份。</p><div className="community-setting-grid">
     <Toggle path="roles.enabled" label="启用自选兴趣身份" checked={draft.roles.enabled} onChange={enabled=>change('roles',{enabled})}/>
     <NumberField path="roles.maxChoices" label="每人最多兴趣身份" value={draft.roles.maxChoices} min={1} max={5} onChange={maxChoices=>change('roles',{maxChoices})}/>
    </div><FieldGroup path="roles.allowedRefs"><div className="community-choice-grid">{data.resources.filter(resource=>resource.kind==='role').map(role=>{
     const safe=role.safe===true&&role.available;const selected=draft.roles.allowedRefs.includes(role.ref);
     return <div key={role.ref}><Toggle label={`${role.name}${!safe?'（不可自选）':''}`} checked={selected} disabled={!safe} onChange={checked=>change('roles',{allowedRefs:checked?[...draft.roles.allowedRefs,role.ref]:draft.roles.allowedRefs.filter(ref=>ref!==role.ref)})}/>{selected&&!safe&&<button type="button" onClick={()=>change('roles',{allowedRefs:draft.roles.allowedRefs.filter(ref=>ref!==role.ref)})}>移除不可用身份 {role.name}</button>}</div>;
    })}</div>{draft.roles.allowedRefs.filter(ref=>!data.resources.some(resource=>resource.kind==='role'&&resource.ref===ref)).map((ref,index)=><p key={ref}>已失效身份 {index+1} <button type="button" onClick={()=>change('roles',{allowedRefs:draft.roles.allowedRefs.filter(value=>value!==ref)})}>移除已失效身份 {index+1}</button></p>)}{!data.resources.some(resource=>resource.kind==='role')&&<p className="community-muted">暂无身份目录，请在下方刷新。</p>}</FieldGroup></details>
    <details className="community-card community-admin-section community-config-group" id="community-fun" data-setting-path="fun" tabIndex={-1}><summary><h2>趣味互动与 AI</h2></summary><FieldError path="fun"/><p>投票、分队和灵感只服务社区互动，不影响信誉分。</p><Toggle path="fun.enabled" label="开放趣味工具" checked={draft.fun.enabled} onChange={enabled=>change('fun',{enabled})}/>
     <FieldGroup path="fun.enabledTools"><div className="community-choice-grid">{COMMUNITY_TOOLS.map(tool=><Toggle key={tool} label={toolNames[tool]} checked={draft.fun.enabledTools.includes(tool)} onChange={checked=>change('fun',{enabledTools:checked?[...draft.fun.enabledTools,tool]:draft.fun.enabledTools.filter(item=>item!==tool)})}/>)}</div></FieldGroup>
     <div className="community-setting-grid">
      <NumberField path="fun.cooldownSeconds" label="互动冷却（秒）" value={draft.fun.cooldownSeconds} min={0} max={3600} onChange={cooldownSeconds=>change('fun',{cooldownSeconds})}/>
      <NumberField path="fun.pollMaxHours" label="投票最长时间（小时）" value={draft.fun.pollMaxHours} min={1} max={720} onChange={pollMaxHours=>change('fun',{pollMaxHours})}/>
      <NumberField path="fun.pollMaxOptions" label="投票最多选项" value={draft.fun.pollMaxOptions} min={2} max={10} onChange={pollMaxOptions=>change('fun',{pollMaxOptions})}/>
      <NumberField path="fun.maxParticipants" label="分队与抽签最多人数" value={draft.fun.maxParticipants} min={2} max={100} onChange={maxParticipants=>change('fun',{maxParticipants})}/>
      <NumberField path="fun.maxDiceCount" label="一次最多骰子" value={draft.fun.maxDiceCount} min={1} max={100} onChange={maxDiceCount=>change('fun',{maxDiceCount})}/>
      <NumberField path="fun.maxDiceSides" label="骰子最多面数" value={draft.fun.maxDiceSides} min={2} max={1000000} onChange={maxDiceSides=>change('fun',{maxDiceSides})}/>
     </div><h3 className="community-admin-subheading">话题题库</h3><p className="community-muted">标签用逗号分隔，每个最多 30 字，最多 10 个。关闭趣味工具仍保留并校验题库。</p><FieldGroup path="fun.topics"><div className="community-topic-list">{draft.fun.topics.map((topic,index)=><div className="community-topic-editor" key={topic.ref}>
      <TextField path={`fun.topics.${index}.text`} label={`话题正文 ${index+1}`} multiline rows={2} maxLength={500} value={topic.text} onChange={text=>change('fun',{topics:draft.fun.topics.map(item=>item.ref===topic.ref?{...item,text}:item)})}/>
      <TextField path={`fun.topics.${index}.tags`} label={`话题标签 ${index+1}`} required={false} maxLength={318} value={tagDraft[topic.ref]??topic.tags.join(', ')} onChange={text=>{setTagDraft(current=>({...current,[topic.ref]:text}));change('fun',{topics:draft.fun.topics.map(item=>item.ref===topic.ref?{...item,tags:text.split(/[,，]/).map(value=>value.trim()).filter(Boolean)}:item)});}}/>
      <button type="button" onClick={()=>change('fun',{topics:draft.fun.topics.filter(item=>item.ref!==topic.ref)})}>删除话题 {index+1}</button>
     </div>)}</div><button type="button" disabled={draft.fun.topics.length>=200} onClick={()=>change('fun',{topics:[...draft.fun.topics,{ref:crypto.randomUUID(),text:'',tags:[]}]})}>添加话题</button></FieldGroup>
     <div className="community-admin-ai" id={idFor('fun.ai')} data-setting-path="fun.ai" tabIndex={-1}><h3>社区 AI 灵感</h3><FieldError path="fun.ai"/><p>只使用主动输入的主题，结果需人工确认。<Link to="/settings/ai">管理模型与密钥</Link></p><div className="community-setting-grid">
      <Toggle path="fun.ai.enabled" label="启用社区 AI" checked={draft.fun.ai.enabled} onChange={enabled=>change('fun',{ai:{...draft.fun.ai,enabled}})}/>
      <NumberField path="fun.ai.userDailyLimit" label="每人每日 AI 配额" value={draft.fun.ai.userDailyLimit} min={1} max={1000} onChange={userDailyLimit=>change('fun',{ai:{...draft.fun.ai,userDailyLimit}})}/>
      <NumberField path="fun.ai.guildDailyLimit" label="全服每日 AI 配额" value={draft.fun.ai.guildDailyLimit} min={1} max={10000} onChange={guildDailyLimit=>change('fun',{ai:{...draft.fun.ai,guildDailyLimit}})}/>
      <TextField path="fun.ai.prompt" label="社区 AI 提示词" multiline rows={4} maxLength={4000} value={draft.fun.ai.prompt} onChange={prompt=>change('fun',{ai:{...draft.fun.ai,prompt}})}/>
     </div></div>
    </details>
   </fieldset><div className="community-save-bar"><button className="community-button" type="submit" disabled={op.busy}>保存社区设置</button><div><p aria-label="待保存分组">{op.busy?'等待机器人回执；请勿重复提交。':dirty?`待保存：${changedGroups.map(key=>groups[key]).join('、')}`:'没有未保存的修改。一次保存全部分组。'}</p>{savedVersion!==null&&<p aria-label="最近保存结果">已保存版本 {savedVersion}，{ready?'机器人已应用。':'等待机器人应用。'}</p>}{issues.length>0&&<p>有 {issues.length} 项错误，请按上方说明修改后保存。</p>}</div></div>
  </form>
  </FieldsContext.Provider>
  <section className="community-card community-admin-section" id="community-runtime" aria-labelledby="community-runtime-title"><h2 id="community-runtime-title">运行与日志</h2><details open={diagnosticsOpen} onToggle={event=>setDiagnosticsOpen(event.currentTarget.open)}><summary>查看运行与日志</summary><p>已保存版本 {data.version} · 机器人已应用版本 {data.runtime.appliedVersion} · 最近同步 {time(data.runtime.syncedAt)}</p><div className="community-actions"><button disabled={op.busy} onClick={()=>void op.submit(()=>communityApi.sync('resources.sync'))}>刷新服务器目录</button><button disabled={op.busy} onClick={()=>void op.submit(()=>communityApi.sync('panel.refresh'))}>刷新控制面板</button></div><p>目录与控制卡分别刷新。提交后请等待机器人执行回执。</p><p className="community-muted">待对账表示不能确定 Discord 执行结果，系统已停止自动重复执行。请先在 Discord 检查实际状态，再由管理员处理。</p>
   <h3>最近操作</h3>{data.operationsProblem?<p role="status">{data.operationsProblem}</p>:!data.operations.length?<p>暂无操作。</p>:<ul className="community-admin-log">{data.operations.map(operation=><li key={operation.ref}><strong>{operationLabels[operation.status]??operation.status}</strong><span>{communityActionLabel(operation.kind)} · {time(operation.createdAt)}</span>{operation.error&&<p>{operation.error}</p>}{operation.status==='needs_review'&&(reviewRef===operation.ref?<div className="community-danger-zone"><p>先在 Discord 检查此任务是否已经建房、发送消息或改变权限；如有重复或残留，请先人工处理。</p><p>确认后只会取消旧任务并保留核对记录，不会重试任务，也不会自动恢复 Discord 的状态。</p><div className="community-actions"><button disabled={op.busy} onClick={()=>void op.submit(async()=>{const result=await communityApi.review(operation.ref);setReviewRef(null);return result;})}>确认已人工核对，取消旧任务</button><button disabled={op.busy} onClick={()=>setReviewRef(null)}>暂不取消旧任务</button></div></div>:<button disabled={op.busy} onClick={()=>setReviewRef(operation.ref)}>人工核对并取消旧任务</button>)}</li>)}</ul>}
   <h3>管理记录</h3>{data.auditProblem?<p role="status">{data.auditProblem}</p>:!data.audit.length?<p>暂无管理记录。</p>:<ul className="community-admin-log">{data.audit.map(item=><li key={item.ref}><strong>{item.actor} · {communityActionLabel(item.action)}</strong><span>{operationLabels[item.outcome]??'已记录'} · {time(item.createdAt)}</span>{item.target&&!/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(item.target)&&<p>{item.target}</p>}</li>)}</ul>}
   {(data.operationsProblem||data.auditProblem)&&<button onClick={reload} disabled={op.busy}>重试运行记录</button>}<button onClick={reload} disabled={op.busy}>刷新运行状态</button>
  </details></section>
 </section>;
}
function Toggle({label,checked,onChange,disabled=false,path}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean;path?:string}) {
 const field=useField(path);return <div className="community-setting-field"><label className="community-choice"><input {...field.attributes} type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><span>{label}</span></label>{path&&<FieldError path={path}/>}</div>;
}
function NumberField({label,value,min,max,onChange,path}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void;path?:string}) {
 const field=useField(path);const raw=path?field.context.numbers[path]:undefined;
 return <div className="community-setting-field"><label htmlFor={field.id}>{label}</label><input {...field.attributes} type="number" required min={min} max={max} step={1} value={raw??String(value)} onChange={event=>path?field.context.number(path,event.target.value,onChange):onChange(Number(event.target.value))}/>{path&&<FieldError path={path}/>}</div>;
}
function MinuteField({seconds,onChange}:{seconds:number;onChange:(value:number)=>void}) {
 const field=useField('rooms.emptyGraceSeconds');const raw=field.context.numbers['rooms.emptyGraceSeconds'];
 return <div className="community-setting-field"><label htmlFor={field.id}>空房多久删除（分钟）</label><input {...field.attributes} type="number" required min={0.25} max={1440} step="any" aria-describedby={field.issue?`${field.id}-error`:'community-empty-grace-help'} value={raw??String(seconds/60)} onChange={event=>field.context.number('rooms.emptyGraceSeconds',event.target.value,onChange)}/><small id="community-empty-grace-help">最少 15 秒；修改后按秒保存。有人回来会取消回收。</small><FieldError path="rooms.emptyGraceSeconds"/></div>;
}
function ResourceSelect({label,kind,value,resources,onChange,path}:{label:string;kind:CommunityResourceKind;value:string|null;resources:CommunityResourceView[];onChange:(value:string|null)=>void;path?:string}) {
 const field=useField(path);const choices=resources.filter(resource=>resource.kind===kind);const missing=value&&!choices.some(resource=>resource.ref===value);
 return <div className="community-setting-field"><label htmlFor={field.id}>{label}</label><select {...field.attributes} value={value??''} onChange={event=>onChange(event.target.value||null)}><option value="">暂不设置</option>{missing&&<option value={value} disabled>原配置已不可用，请重新选择</option>}{choices.map(resource=><option key={resource.ref} value={resource.ref} disabled={!resource.available}>{resource.name}{!resource.available?'（不可用）':''}</option>)}</select>{path&&<FieldError path={path}/>}</div>;
}
function TextField({path,label,value,onChange,multiline=false,rows=2,maxLength,required=true}:{path:string;label:string;value:string;onChange:(value:string)=>void;multiline?:boolean;rows?:number;maxLength:number;required?:boolean}) {
 const field=useField(path);const attributes={...field.attributes,required,maxLength,value,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.target.value)};
 return <div className={`community-setting-field${multiline?' community-full':''}`}><label htmlFor={field.id}>{label}</label>{multiline?<textarea {...attributes} rows={rows}/>:<input {...attributes}/>}<FieldError path={path}/></div>;
}
function AccessField({value,onChange}:{value:CommunitySettings['rooms']['visibility'];onChange:(value:CommunitySettings['rooms']['visibility'])=>void}){
 const field=useField('rooms.visibility');return <div className="community-setting-field"><label htmlFor={field.id}>默认访问模式</label><select {...field.attributes} value={value} onChange={event=>onChange(event.target.value as CommunitySettings['rooms']['visibility'])}><option value="open">公开可加入</option><option value="locked">锁门，仅允许的成员可加入</option><option value="hidden">隐藏，仅允许的成员可见</option></select><FieldError path="rooms.visibility"/></div>;
}
function FixedRoomManagers({room,disabled,submit}:{room:CommunityRoomView;disabled:boolean;submit:(work:()=>Promise<{operation:CommunityOperationView}>)=>Promise<void>}) {
 const [ids,setIds]=useState('');const [error,setError]=useState<string|null>(null);const [confirmClear,setConfirmClear]=useState(false);
 const apply=(discordIds:string[])=>{if(disabled)return;setIds('');setError(null);setConfirmClear(false);void submit(()=>communityApi.roomAction(room,'managers',{discordIds}));};
 const save=()=>{
  if(disabled)return;const values=[...new Set(ids.split(/[\s,，;；]+/).filter(Boolean))];
  if(values.length>20){setError('每次最多分配 20 位房间管理员。');setConfirmClear(false);return;}
  if(values.some(value=>!/^\d{17,20}$/.test(value))){setError('请输入有效的 Discord 用户 ID；多个 ID 用换行或逗号分隔。');setConfirmClear(false);return;}
  setError(null);if(!values.length){setConfirmClear(true);return;}apply(values);
 };
 return <details className="community-fixed-room"><summary>{room.name}</summary><p>当前管理员：{room.managers?.length?room.managers.map(manager=>manager.name).join('、'):'尚未分配'}</p><p className="community-muted">固定房间不会自动删除。一次最多 20 位，提交会替换完整管理员名单；留空可清空分配，Nanako 管理员仍可管理。</p>{room.panelProblem&&<p role="status">{room.panelProblem}</p>}<label>房间管理员 Discord 用户 ID<textarea autoComplete="off" rows={3} maxLength={2200} value={ids} disabled={disabled} onChange={event=>{setIds(event.target.value);setError(null);setConfirmClear(false);}}/></label>{error&&<p role="alert">{error}</p>}{confirmClear?<div className="community-danger-zone"><p>确认清空这个固定房间的管理员名单？</p><div className="community-actions"><button type="button" disabled={disabled} onClick={()=>apply([])}>确认清空管理员</button><button type="button" onClick={()=>setConfirmClear(false)}>保留当前管理员</button></div></div>:<button type="button" disabled={disabled||(!ids.trim()&&!room.managers?.length)} onClick={save}>保存房间管理员</button>}</details>;
}
