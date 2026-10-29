import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunityAuditView, CommunityOperationView, CommunityResourceKind, CommunityResourceView, CommunitySettings } from '@shared/community';
import { COMMUNITY_TOOLS, parseCommunitySettings } from '@shared/community';
import { ApiError } from '../api';
import { communityApi, type CommunityAdminData } from '../community-api';
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
function previewWelcome(value:string):string {
 return value.replace(/\{name\}/g,'新成员').replace(/\{server\}/g,'我们的社区').replace(/\{memberCount\}/g,'100')
  .replace(/<[@#][^>]*>/g,'[已隐藏]').replace(/@everyone|@here/gi,'大家').replace(/\b\d{17,20}\b/g,'[已隐藏]');
}
export function CommunityAdminPage({me}:{me:User|null}) {
 if(!me?.is_admin)return <NotFound title={NOT_FOUND_TITLE}/>;
 return <CommunityAdminContent key={`${me.id}:${me.is_admin}`} />;
}
interface AdminState extends CommunityAdminData {resources:CommunityResourceView[];operations:CommunityOperationView[];audit:CommunityAuditView[]}
function CommunityAdminContent() {
 const [data,setData]=useState<AdminState|null>(null);const [draft,setDraft]=useState<CommunitySettings|null>(null);
 const [reviewRef,setReviewRef]=useState<string|null>(null);
 const [diagnosticsOpen,setDiagnosticsOpen]=useState(false);
 const [tagDraft,setTagDraft]=useState<Record<string,string>>({});
 const [error,setError]=useState<string|null>(null);const [status,setStatus]=useState(0);const [refresh,setRefresh]=useState(0);const [saved,setSaved]=useState(false);
 const accessEpoch=useRef(0);const baseline=useRef<{json:string;version:number}|null>(null);const dirtyRef=useRef(false);
 const [newVersion,setNewVersion]=useState<number|null>(null);const [discardConfirm,setDiscardConfirm]=useState(false);
 const [departing,setDeparting]=useState(false);
 const dirty=draft!==null&&(JSON.stringify(draft)!==baseline.current?.json||Object.entries(tagDraft).some(([ref,text])=>text!==(draft.fun.topics.find(topic=>topic.ref===ref)?.tags.join(', ')??'')));
 dirtyRef.current=dirty;
 const reload=useCallback(()=>setRefresh(value=>value+1),[]);
 const inaccessible=useCallback((cause:ApiError)=>{accessEpoch.current++;baseline.current=null;dirtyRef.current=false;setNewVersion(null);setDiscardConfirm(false);setData(null);setDraft(null);setTagDraft({});setReviewRef(null);setSaved(false);setStatus(cause.status);setError(errorMessage(cause));},[]);
 const op=useCommunityOperation(reload,{onUnavailable:inaccessible});
 const guard=usePageLeaveGuard(dirty&&!departing&&![401,403,404].includes(status),{onLeave:()=>{
  accessEpoch.current++;baseline.current=null;dirtyRef.current=false;op.reset();
  setData(null);setDraft(null);setTagDraft({});setReviewRef(null);setNewVersion(null);setDiscardConfirm(false);setSaved(false);setDeparting(true);
 }});
 useEffect(()=>{if(departing)return;window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);},[reload,departing]);
 useEffect(()=>{
  if(departing)return;
  const abort=new AbortController();const epoch=accessEpoch.current;setError(null);
  void Promise.all([communityApi.admin(abort.signal),communityApi.resources('',true,abort.signal),communityApi.operations(abort.signal),communityApi.audit(abort.signal)])
   .then(([admin,resources,operations,audit])=>{if(abort.signal.aborted||accessEpoch.current!==epoch)return;setStatus(0);setData({...admin,resources:resources.resources,operations:operations.operations,audit:audit.audit});if(!dirtyRef.current){baseline.current={json:JSON.stringify(admin.settings),version:admin.version};setDraft(structuredClone(admin.settings));setTagDraft({});setNewVersion(null);}else if(baseline.current?.version!==admin.version)setNewVersion(admin.version);})
   .catch(cause=>{if(!abort.signal.aborted){if(cause instanceof ApiError&&[401,403,404].includes(cause.status)){op.reset();inaccessible(cause);}else{setError(errorMessage(cause));setStatus(cause instanceof ApiError?cause.status:500);}}});
  return()=>abort.abort();
 },[refresh,departing]);
 if(departing)return <p role="status">正在离开…</p>;
 if(status===403||status===401)return <NotFound title={NOT_FOUND_TITLE}/>;
 if(!data||!draft)return <section className="community-page"><Link to="/settings">← 设置</Link><h1>社区管理</h1>{error?<><p role="alert">{status===404?'当前服务暂未提供社区管理':error}</p>{status!==404&&<button onClick={reload}>重新加载</button>}</>:<p role="status">管理设置加载中…</p>}</section>;
 const change=<K extends keyof CommunitySettings>(group:K,values:Partial<CommunitySettings[K]>)=>setDraft(current=>current?{...current,[group]:{...current[group] as object,...values}}:current);
 const save=()=>void op.submit(async()=>{
  const validated=parseCommunitySettings(draft);
  const epoch=accessEpoch.current;const result=await communityApi.save(validated,baseline.current?.version??data.version);
  if(accessEpoch.current!==epoch)return result;
  baseline.current={json:JSON.stringify(result.settings),version:result.version};dirtyRef.current=false;setNewVersion(null);setDiscardConfirm(false);setData(current=>current?{...current,...result}:current);setDraft(structuredClone(result.settings));setTagDraft({});setSaved(true);return result;
 });
 const restoreLatest=()=>{baseline.current={json:JSON.stringify(data.settings),version:data.version};dirtyRef.current=false;setDraft(structuredClone(data.settings));setTagDraft({});setNewVersion(null);setDiscardConfirm(false);op.reset();};
 const ready=data.runtime.ready&&data.runtime.appliedVersion===data.version;
 return <section className="community-page community-admin">
  <div className="community-heading"><div><Link className="community-back" to="/settings">← 设置</Link><p className="community-eyebrow">让社区自然运转</p><h1>社区管理</h1><p>频道、欢迎、身份和互动，都在这里统一设置。</p></div><Link className="community-button community-button--quiet" to="/community">查看社区与房间</Link></div>
  {guard.confirming&&<ConfirmInline question="还有未保存的社区设置" cancelLabel="继续编辑" confirmLabel="放弃修改并离开" onCancel={guard.stay} onConfirm={guard.leave}>尚未提交的修改不会保存；已经开始的保存仍可能完成。</ConfirmInline>}
  <nav className="community-tabs community-admin-nav" aria-label="社区管理分组"><a href="#community-rooms">语音房间</a><a href="#community-welcome">入服欢迎</a><a href="#community-roles">兴趣身份</a><a href="#community-fun">趣味互动</a><a href="#community-runtime" onClick={()=>setDiagnosticsOpen(true)}>运行与日志</a></nav>
  <div className="community-notice" role="status"><strong>{ready?'机器人已就绪':'配置尚未应用完成'}</strong>{data.runtime.problem&&<p>{data.runtime.problem}</p>}{saved&&!ready&&<p>已保存待应用</p>}</div>
  {data.operations.some(operation=>operation.status==='needs_review')&&<div className="community-notice community-notice--alert" role="status"><strong>有 {data.operations.filter(operation=>operation.status==='needs_review').length} 项操作需要管理员核对</strong><p>先核对 Discord 实际状态，再处理旧任务。</p><a className="community-button community-button--quiet" href="#community-runtime" onClick={()=>setDiagnosticsOpen(true)}>查看待处理操作</a></div>}
  {newVersion!==null&&<div className="community-notice community-notice--alert" role="status"><strong>已有新的社区设置版本</strong><p>当前服务器为版本 {newVersion}；你的修改仍保留在版本 {baseline.current?.version}。保存时会检查原版本，避免覆盖其他管理员的更新。</p>{!discardConfirm?<button disabled={op.busy} onClick={()=>setDiscardConfirm(true)}>载入最新设置</button>:<div className="community-actions"><button disabled={op.busy} onClick={restoreLatest}>确认放弃修改并载入</button><button onClick={()=>setDiscardConfirm(false)}>保留当前编辑</button></div>}</div>}
  <OperationNotice operation={op.operation}/>{(error||op.error)&&<p className="community-error" role="alert">{op.error??error}</p>}
  <form onSubmit={event=>{event.preventDefault();save();}}>
   <fieldset className="community-admin-fields" disabled={op.busy}>
    <div className="community-card community-admin-section"><Toggle label="启用社区中心" checked={draft.enabled} onChange={enabled=>setDraft({...draft,enabled})}/><p className="community-muted">暂停新操作时，机器人会继续安全处理已登记房间的恢复与回收。</p></div>
    <section className="community-card community-admin-section" id="community-rooms" aria-labelledby="community-rooms-title"><h2 id="community-rooms-title">语音房间</h2><p>成员进入建房入口，机器人自动建房并移入。控制卡就在新房间自带的文字聊天里，房间无人后按设置时间删除。</p><div className="community-setting-grid">
     <Toggle label="开放自助语音房" checked={draft.rooms.enabled} onChange={enabled=>change('rooms',{enabled})}/>
     <ResourceSelect label="创建房间入口" kind="voice" value={draft.rooms.creatorRef} resources={data.resources} onChange={creatorRef=>change('rooms',{creatorRef})}/>
     <ResourceSelect label="临时房间分类" kind="category" value={draft.rooms.categoryRef} resources={data.resources} onChange={categoryRef=>change('rooms',{categoryRef})}/>
     <MinuteField seconds={draft.rooms.emptyGraceSeconds} onChange={emptyGraceSeconds=>change('rooms',{emptyGraceSeconds})}/>
     <NumberField label="默认人数限制（0 为不限）" value={draft.rooms.userLimit} min={0} max={draft.rooms.maxUserLimit} onChange={userLimit=>change('rooms',{userLimit})}/>
    </div><details className="community-room-advanced"><summary>高级房间设置</summary><div className="community-setting-grid">
     <ResourceSelect label="管理员关闭时的等候区" kind="voice" value={draft.rooms.waitingRef} resources={data.resources} onChange={waitingRef=>change('rooms',{waitingRef})}/>
     <ResourceSelect label="旧全局入口频道（可选）" kind="text" value={draft.rooms.panelRef} resources={data.resources} onChange={panelRef=>change('rooms',{panelRef})}/>
     <label>默认访问模式<select value={draft.rooms.visibility} onChange={e=>change('rooms',{visibility:e.target.value as CommunitySettings['rooms']['visibility']})}><option value="open">公开可加入</option><option value="locked">锁门，仅允许的成员可加入</option><option value="hidden">隐藏，仅允许的成员可见</option></select></label>
     <NumberField label="每人最多房间" value={draft.rooms.maxPerMember} min={1} max={1} onChange={maxPerMember=>change('rooms',{maxPerMember})}/>
     <NumberField label="全服最多房间" value={draft.rooms.maxRooms} min={1} max={100} onChange={maxRooms=>change('rooms',{maxRooms})}/>
     <NumberField label="建房冷却（秒）" value={draft.rooms.cooldownSeconds} min={0} max={3600} onChange={cooldownSeconds=>change('rooms',{cooldownSeconds})}/>
     <NumberField label="房主离开宽限（秒）" value={draft.rooms.ownerGraceSeconds} min={15} max={86400} onChange={ownerGraceSeconds=>change('rooms',{ownerGraceSeconds})}/>
     <NumberField label="房主可设人数上限" value={draft.rooms.maxUserLimit} min={1} max={99} onChange={maxUserLimit=>change('rooms',{maxUserLimit})}/>
    </div><p className="community-muted">旧全局入口只用于集中打开社区工具，房内控制卡不需要单独配置频道。有人房间需前往房间管理，确认移动成员后再关闭；缺少等候区时不会强行删除。</p></details></section>
    <section className="community-card community-admin-section" id="community-welcome" aria-labelledby="community-welcome-title"><h2 id="community-welcome-title">入服欢迎</h2><div className="community-setting-grid">
     <Toggle label="启用入服欢迎" checked={draft.welcome.enabled} onChange={enabled=>change('welcome',{enabled})}/>
     <ResourceSelect label="欢迎频道" kind="text" value={draft.welcome.channelRef} resources={data.resources} onChange={channelRef=>change('welcome',{channelRef})}/>
     <NumberField label="重入欢迎冷却（小时）" value={draft.welcome.rejoinCooldownHours} min={1} max={720} onChange={rejoinCooldownHours=>change('welcome',{rejoinCooldownHours})}/>
     <label className="community-full">欢迎文案<textarea aria-label="欢迎文案" rows={4} maxLength={1500} required value={draft.welcome.template} onChange={e=>change('welcome',{template:e.target.value})}/><small>支持 {'{name}'}、{'{server}'}、{'{memberCount}'}，不会触发成员或全服提及。</small></label>
     <div className="community-admin-preview community-full" aria-label="欢迎预览"><strong>欢迎预览</strong><p>{previewWelcome(draft.welcome.template)}</p><small>仅预览，不会发送消息。</small></div>
    </div></section>
    <section className="community-card community-admin-section" id="community-roles" aria-labelledby="community-roles-title"><h2 id="community-roles-title">兴趣身份</h2><p>只开放明确允许、且机器人可以安全授予的身份。</p><div className="community-setting-grid">
     <Toggle label="启用自选兴趣身份" checked={draft.roles.enabled} onChange={enabled=>change('roles',{enabled})}/>
     <NumberField label="每人最多兴趣身份" value={draft.roles.maxChoices} min={1} max={5} onChange={maxChoices=>change('roles',{maxChoices})}/>
    </div><div className="community-choice-grid">{data.resources.filter(resource=>resource.kind==='role').map(role=>{
     const safe=role.safe===true&&role.available;const selected=draft.roles.allowedRefs.includes(role.ref);
     return <div key={role.ref}><Toggle label={`${role.name}${!safe?'（不可自选）':''}`} checked={selected} disabled={!safe} onChange={checked=>change('roles',{allowedRefs:checked?[...draft.roles.allowedRefs,role.ref]:draft.roles.allowedRefs.filter(ref=>ref!==role.ref)})}/>{selected&&!safe&&<button type="button" onClick={()=>change('roles',{allowedRefs:draft.roles.allowedRefs.filter(ref=>ref!==role.ref)})}>移除不可用身份 {role.name}</button>}</div>;
    })}</div>{draft.roles.allowedRefs.filter(ref=>!data.resources.some(resource=>resource.kind==='role'&&resource.ref===ref)).map((ref,index)=><p key={ref}>已失效身份 {index+1} <button type="button" onClick={()=>change('roles',{allowedRefs:draft.roles.allowedRefs.filter(value=>value!==ref)})}>移除已失效身份 {index+1}</button></p>)}{!data.resources.some(resource=>resource.kind==='role')&&<p className="community-muted">暂无身份目录，请在下方刷新。</p>}</section>
    <section className="community-card community-admin-section" id="community-fun" aria-labelledby="community-fun-title"><h2 id="community-fun-title">趣味互动与 AI</h2><p>投票、分队和灵感只服务社区互动，不影响信誉分。</p><Toggle label="开放趣味工具" checked={draft.fun.enabled} onChange={enabled=>change('fun',{enabled})}/><div className="community-choice-grid">{COMMUNITY_TOOLS.map(tool=><Toggle key={tool} label={toolNames[tool]} checked={draft.fun.enabledTools.includes(tool)} onChange={checked=>change('fun',{enabledTools:checked?[...draft.fun.enabledTools,tool]:draft.fun.enabledTools.filter(item=>item!==tool)})}/>)}</div>
     <div className="community-setting-grid">
      <NumberField label="互动冷却（秒）" value={draft.fun.cooldownSeconds} min={0} max={3600} onChange={cooldownSeconds=>change('fun',{cooldownSeconds})}/>
      <NumberField label="投票最长时间（小时）" value={draft.fun.pollMaxHours} min={1} max={720} onChange={pollMaxHours=>change('fun',{pollMaxHours})}/>
      <NumberField label="投票最多选项" value={draft.fun.pollMaxOptions} min={2} max={10} onChange={pollMaxOptions=>change('fun',{pollMaxOptions})}/>
      <NumberField label="分队与抽签最多人数" value={draft.fun.maxParticipants} min={2} max={100} onChange={maxParticipants=>change('fun',{maxParticipants})}/>
      <NumberField label="一次最多骰子" value={draft.fun.maxDiceCount} min={1} max={100} onChange={maxDiceCount=>change('fun',{maxDiceCount})}/>
      <NumberField label="骰子最多面数" value={draft.fun.maxDiceSides} min={2} max={1000000} onChange={maxDiceSides=>change('fun',{maxDiceSides})}/>
     </div><h3 className="community-admin-subheading">话题题库</h3><p className="community-muted">标签用逗号分隔；普通话题卡从此题库选择，AI 暂不可用时也会使用安全题库。</p><div className="community-topic-list">{draft.fun.topics.map((topic,index)=><div className="community-topic-editor" key={topic.ref}><label>话题正文 {index+1}<textarea required maxLength={500} rows={2} value={topic.text} onChange={e=>change('fun',{topics:draft.fun.topics.map(item=>item.ref===topic.ref?{...item,text:e.target.value}:item)})}/></label><label>话题标签 {index+1}<input maxLength={309} value={tagDraft[topic.ref]??topic.tags.join(', ')} onChange={e=>{setTagDraft(current=>({...current,[topic.ref]:e.target.value}));change('fun',{topics:draft.fun.topics.map(item=>item.ref===topic.ref?{...item,tags:e.target.value.split(/[,，]/).map(value=>value.trim()).filter(Boolean)}:item)});}}/></label><button type="button" onClick={()=>change('fun',{topics:draft.fun.topics.filter(item=>item.ref!==topic.ref)})}>删除话题 {index+1}</button></div>)}</div><button type="button" disabled={draft.fun.topics.length>=200} onClick={()=>change('fun',{topics:[...draft.fun.topics,{ref:crypto.randomUUID(),text:'',tags:[]}]})}>添加话题</button>
     <div className="community-admin-ai"><h3>社区 AI 灵感</h3><p>社区开关、提示词与配额独立设置。只使用成员主动输入的主题，结果需人工确认。<Link to="/settings/ai">管理模型与密钥</Link></p><div className="community-setting-grid">
      <Toggle label="启用社区 AI" checked={draft.fun.ai.enabled} onChange={enabled=>change('fun',{ai:{...draft.fun.ai,enabled}})}/>
      <NumberField label="每人每日 AI 配额" value={draft.fun.ai.userDailyLimit} min={1} max={1000} onChange={userDailyLimit=>change('fun',{ai:{...draft.fun.ai,userDailyLimit}})}/>
      <NumberField label="全服每日 AI 配额" value={draft.fun.ai.guildDailyLimit} min={1} max={10000} onChange={guildDailyLimit=>change('fun',{ai:{...draft.fun.ai,guildDailyLimit}})}/>
      <label className="community-full">社区 AI 提示词<textarea rows={4} required maxLength={4000} value={draft.fun.ai.prompt} onChange={e=>change('fun',{ai:{...draft.fun.ai,prompt:e.target.value}})}/></label>
     </div></div>
    </section>
   </fieldset><div className="community-save-bar"><button className="community-button" type="submit" disabled={op.busy}>保存社区设置</button><p>{op.busy?'等待机器人回执；请勿重复提交。':dirty?'有未保存的修改。保存失败和状态刷新会保留当前编辑。':'一次保存全部分组。'}</p></div>
  </form>
  <section className="community-card community-admin-section" id="community-runtime" aria-labelledby="community-runtime-title"><div className="community-section-title"><h2 id="community-runtime-title">运行与日志</h2></div><details open={diagnosticsOpen} onToggle={event=>setDiagnosticsOpen(event.currentTarget.open)}><summary>查看运行与日志</summary><p>已保存版本 {data.version} · 机器人已应用版本 {data.runtime.appliedVersion} · 最近同步 {time(data.runtime.syncedAt)}</p><div className="community-actions"><button disabled={op.busy} onClick={()=>void op.submit(()=>communityApi.sync('resources.sync'))}>刷新服务器目录</button><button disabled={op.busy} onClick={()=>void op.submit(()=>communityApi.sync('panel.refresh'))}>刷新控制面板</button></div><p>服务器目录与控制面板分别刷新。提交后请等待机器人执行回执。</p><p className="community-muted">待对账表示不能确定 Discord 执行结果，系统已停止自动重复执行。请先在 Discord 检查实际状态，再由管理员处理。</p><h3>最近操作</h3>{!data.operations.length?<p>暂无操作。</p>:<ul className="community-admin-log">{data.operations.map(operation=><li key={operation.ref}><strong>{operationLabels[operation.status]??operation.status}</strong><span>{communityActionLabel(operation.kind)} · {time(operation.createdAt)}</span>{operation.error&&<p>{operation.error}</p>}{operation.status==='needs_review'&&(reviewRef===operation.ref?<div className="community-danger-zone"><p>先在 Discord 检查此任务是否已经建房、发送消息或改变权限；如有重复或残留，请先人工处理。</p><p>确认后只会取消旧任务并保留核对记录，不会重试任务，也不会自动恢复 Discord 的状态。</p><div className="community-actions"><button disabled={op.busy} onClick={()=>void op.submit(async()=>{const result=await communityApi.review(operation.ref);setReviewRef(null);return result;})}>确认已人工核对，取消旧任务</button><button disabled={op.busy} onClick={()=>setReviewRef(null)}>暂不取消旧任务</button></div></div>:<button disabled={op.busy} onClick={()=>setReviewRef(operation.ref)}>人工核对并取消旧任务</button>)}</li>)}</ul>}<h3>管理记录</h3>{!data.audit.length?<p>暂无管理记录。</p>:<ul className="community-admin-log">{data.audit.map(item=><li key={item.ref}><strong>{item.actor} · {communityActionLabel(item.action)}</strong><span>{operationLabels[item.outcome]??'已记录'} · {time(item.createdAt)}</span>{item.target&&!/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(item.target)&&<p>{item.target}</p>}</li>)}</ul>}<button onClick={reload} disabled={op.busy}>刷新运行状态</button></details></section>
 </section>;
}
function Toggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}) {
 return <label className="community-choice"><input type="checkbox" checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>;
}
function NumberField({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(value:number)=>void}) {
 return <label>{label}<input type="number" required min={min} max={max} step={1} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function MinuteField({seconds,onChange}:{seconds:number;onChange:(value:number)=>void}) {
 const [value,setValue]=useState(String(seconds/60));
 const lastSeconds=useRef(seconds);
 useEffect(()=>{if(!Object.is(seconds,lastSeconds.current)){lastSeconds.current=seconds;setValue(String(seconds/60));}},[seconds]);
 return <div><label>空房多久删除（分钟）<input type="number" required min={0.25} max={1440} step="any" aria-describedby="community-empty-grace-help" value={value} onChange={event=>{const text=event.target.value;setValue(text);const next=text===''?NaN:Math.round(Number(text)*60);lastSeconds.current=next;onChange(next);}}/></label><small id="community-empty-grace-help">最少 15 秒；修改后按秒保存。有人回来会取消回收。</small></div>;
}
function ResourceSelect({label,kind,value,resources,onChange}:{label:string;kind:CommunityResourceKind;value:string|null;resources:CommunityResourceView[];onChange:(value:string|null)=>void}) {
 const choices=resources.filter(resource=>resource.kind===kind);const missing=value&&!choices.some(resource=>resource.ref===value);
 return <label>{label}<select value={value??''} onChange={e=>onChange(e.target.value||null)}><option value="">暂不设置</option>{missing&&<option value={value} disabled>原配置已不可用，请重新选择</option>}{choices.map(resource=><option key={resource.ref} value={resource.ref} disabled={!resource.available}>{resource.name}{!resource.available?'（不可用）':''}</option>)}</select></label>;
}
