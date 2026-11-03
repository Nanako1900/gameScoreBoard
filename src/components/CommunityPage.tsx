import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommunityOperationView, CommunityOverview, CommunityResourceView, CommunityRoomView } from '@shared/community';
import { ApiError } from '../api';
import { communityApi, type CommunityRoles } from '../community-api';
import { saveWelcomeReturn } from '../lib/welcomeReturn';
import { Link } from './Link';
import { LoginLink } from './LoginLink';
import './community.css';
export type CommunityTab='rooms'|'roles'|'play';
export const operationLabels:Record<string,string>={queued:'已提交，等待机器人执行',running:'机器人正在处理',retry_wait:'暂时未完成，等待重试',succeeded:'已执行，请查看最新状态',failed:'执行失败',conflict:'状态已变化，请刷新后重试',canceled:'操作已取消或过期',needs_review:'执行结果待管理员对账'};
const terminal=new Set(['succeeded','failed','conflict','canceled','needs_review']);
const message=(error:unknown)=>error instanceof Error?error.message:'社区暂不可用，请重试';
const actionNames:Record<string,string>={
 'settings.apply':'应用社区设置','settings.save':'保存社区设置','resources.sync':'刷新服务器目录','panel.refresh':'刷新控制面板',
 'room.create':'创建语音房','room.join':'加入语音房','room.rename':'房间改名','room.limit':'调整房间人数','room.visibility':'调整房间访问',
 'room.grant':'允许成员加入','room.deny':'禁止成员加入','room.kick':'移出房间成员','room.transfer':'邀请接任房主','room.accept':'接受房主转让',
 'room.claim':'认领房间','room.dissolve':'解散空房','room.admin_delete':'关闭有人房间','room.cleanup':'回收空房','room.reconcile':'核对房间状态','room.managers':'更新固定房间管理员',
 'roles.set':'更新兴趣身份','welcome.send':'发送入服欢迎',
 'operation.review':'人工核对并取消旧任务','operation.cancel':'取消旧任务','settings.updated':'更新社区设置',
};
export function communityActionLabel(kind:string):string{return kind.startsWith('fun.')?'已下线互动（历史操作）':actionNames[kind]??'社区操作';}
export function OperationNotice({operation}:{operation:CommunityOperationView|null}) {
 if(!operation)return null;
 const reviewed=operation.status==='canceled'&&operation.result!==null&&typeof operation.result==='object'&&!Array.isArray(operation.result)&&operation.result.reviewed===true;
 return <div className={`community-notice${operation.status==='failed'||operation.status==='needs_review'?' community-notice--alert':''}`} role="status"><p>{communityActionLabel(operation.kind)}</p><strong>{reviewed?'旧任务已取消，已记录人工核对':operationLabels[operation.status]??'等待处理'}</strong>{reviewed&&<p>请以 Discord 中人工核对的实际状态为准。</p>}{operation.error&&<p>{operation.error}</p>}</div>;
}
export function useCommunityOperation(onDone:()=>void,options:{onUnavailable?:(error:ApiError)=>void}={}) {
 const [operation,setOperation]=useState<CommunityOperationView|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
 const done=useRef(onDone);done.current=onDone;const unavailable=useRef(options.onUnavailable);unavailable.current=options.onUnavailable;
 const generation=useRef(0);const submitting=useRef(false);
 const reset=useCallback(()=>{generation.current++;submitting.current=false;setOperation(null);setBusy(false);setError(null);},[]);
 useEffect(()=>()=>{generation.current++;},[]);
 const handleError=(cause:unknown)=>{
  if(cause instanceof ApiError&&[401,403,404].includes(cause.status)){reset();unavailable.current?.(cause);return;}
  setError(message(cause));
 };
 useEffect(()=>{
  if(!operation||terminal.has(operation.status))return;
  const abort=new AbortController();const epoch=generation.current;let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{const result=await communityApi.operation(operation.ref,abort.signal);if(abort.signal.aborted||generation.current!==epoch)return;setError(null);setOperation(result.operation);if(terminal.has(result.operation.status)){done.current();return;}}catch(cause){if(abort.signal.aborted||generation.current!==epoch)return;handleError(cause);if(generation.current===epoch)timer=setTimeout(()=>void poll(),5000);return;}timer=setTimeout(()=>void poll(),2000);};
  timer=setTimeout(()=>void poll(),2000);return()=>{abort.abort();clearTimeout(timer);};
 },[operation?.ref,operation?.status]);
 const submit=async(work:()=>Promise<{operation:CommunityOperationView}>)=>{
  if(submitting.current||operation&&!terminal.has(operation.status))return;
  const epoch=generation.current;submitting.current=true;setBusy(true);setError(null);
  try{const result=await work();if(generation.current!==epoch)return;setOperation(result.operation);if(terminal.has(result.operation.status))done.current();}
  catch(cause){if(generation.current===epoch)handleError(cause);}
  finally{if(generation.current===epoch){submitting.current=false;setBusy(false);}}
 };
 return {operation,busy:busy||!!operation&&!terminal.has(operation.status),error,submit,reset};
}
interface Data {overview:CommunityOverview;rooms:CommunityRoomView[];members:CommunityResourceView[];roles:CommunityRoles|null;featureErrors:Partial<Record<'rooms'|'roles',string>>}
export function CommunityPage(props:{tab:CommunityTab;accountKey?:string}) {
 if(props.tab==='play')return <section className="community-page"><Link className="community-back" to="/">← 首页</Link><h1>趣味工具已下线</h1><p>投票、分队、抽签、骰子、话题和旧 AI 灵感功能已停止提供。</p><p>你仍可使用语音房间和兴趣身份，与同好相聚。</p><div className="community-actions"><Link className="community-button" to="/community">前往语音房间</Link><Link className="community-button community-button--quiet" to="/community/roles">前往兴趣身份</Link></div></section>;
 return <CommunityContent key={props.accountKey??'guest'} tab={props.tab}/>;
}
function CommunityContent({tab}:{tab:'rooms'|'roles'}) {
 const [data,setData]=useState<Data|null>(null);const [error,setError]=useState<string|null>(null);const [status,setStatus]=useState(0);const [refresh,setRefresh]=useState(0);
 const authority=useRef<string|null>(null);const accessEpoch=useRef(0);
 const reload=useCallback(()=>setRefresh(v=>v+1),[]);
 const inaccessible=useCallback((cause:ApiError)=>{accessEpoch.current++;authority.current=null;setData(null);setStatus(cause.status);setError(message(cause));},[]);
 const op=useCommunityOperation(reload,{onUnavailable:inaccessible});
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')reload();},30000);window.addEventListener('focus',reload);return()=>{clearInterval(timer);window.removeEventListener('focus',reload);};},[reload]);
 useEffect(()=>{
  const abort=new AbortController();const epoch=accessEpoch.current;setError(null);
  void (async()=>{try{
   const overview=await communityApi.overview(abort.signal);if(abort.signal.aborted||accessEpoch.current!==epoch)return;
   const scope=JSON.stringify([overview.me.linked,overview.me.member?.ref,overview.me.isAdmin,overview.settings.enabled,overview.version,overview.runtime.ready]);
   const empty:Data={overview,rooms:[],members:[],roles:null,featureErrors:{}};
   if(authority.current!==scope){authority.current=scope;op.reset();setData(empty);}
   const personal=overview.me.linked&&!!overview.me.member;
   if(!personal&&!(overview.me.isAdmin&&tab==='rooms')||!overview.runtime.ready){setData(empty);return;}
   const featureErrors:Data['featureErrors']={};
   const feature=async<T,>(tab:'rooms'|'roles',read:()=>Promise<T>,fallback:T):Promise<T>=>{
    try{return await read();}catch(cause){
     if(cause instanceof ApiError&&[401,403].includes(cause.status))throw cause;
     featureErrors[tab]=cause instanceof ApiError&&cause.status===404?'unavailable':message(cause);return fallback;
    }
   };
   // Existing rooms and selected roles remain readable while new creation is paused.
   const [rooms,members,roles]=await Promise.all([
    feature('rooms',()=>communityApi.rooms(abort.signal),{rooms:[]}),
    communityApi.resources('member',false,abort.signal).catch(cause=>{if(cause instanceof ApiError&&[401,403].includes(cause.status))throw cause;return {resources:[]};}),
    personal?feature('roles',()=>communityApi.roles(abort.signal),null):Promise.resolve(null),
   ]);
   if(!abort.signal.aborted&&accessEpoch.current===epoch)setData({overview,rooms:rooms.rooms,members:members.resources,roles,featureErrors});
  }catch(e){if(!abort.signal.aborted&&accessEpoch.current===epoch){accessEpoch.current++;op.reset();authority.current=null;setStatus(e instanceof ApiError?e.status:500);setData(null);setError(message(e));}}})();return()=>abort.abort();
 },[refresh,tab]);
 if(error)return <div className="community-page"><Link to="/">← 首页</Link><h1>我的社区</h1><p role="alert">{status===404?'当前服务暂未提供社区功能':status===401?'登录后查看你的社区':error}</p>{status===401?<LoginLink>登录 Nanako</LoginLink>:status!==404&&<button onClick={reload}>重新加载</button>}</div>;
 if(!data)return <div className="community-page" aria-busy="true"><p role="status">社区加载中…</p></div>;
 const {overview}=data;const adminRooms=overview.me.isAdmin&&tab==='rooms';const ready=overview.runtime.ready&&overview.runtime.appliedVersion===overview.version;
 return <section className="community-page">
  <div className="community-heading"><div><Link to="/" className="community-back">← 首页</Link><p className="community-eyebrow">相聚，随时开始</p><h1>我的社区</h1><p>一间语音房，一群志趣相投的朋友。</p></div>{overview.me.isAdmin&&<Link className="community-button community-button--quiet" to="/settings/community">社区管理</Link>}</div>
  <nav className="community-tabs" aria-label="社区"><Link to="/community" aria-current={tab==='rooms'?'page':undefined}>语音房间</Link><Link to="/community/roles" aria-current={tab==='roles'?'page':undefined}>兴趣身份</Link></nav>
  {!overview.settings.enabled&&<div className="community-notice" role="status"><strong>社区已暂停新增功能</strong><p>已有房间仍可管理，已领取的身份仍可退出；暂不创建新房间或领取新身份。</p></div>}
  {!overview.me.linked&&!adminRooms?<div className="community-card"><h2>先绑定 Discord，再从网页管理社区</h2><p>在 Discord 内使用这些功能，无需绑定 Nanako 账号。</p><Link to="/welcome" onClick={()=>saveWelcomeReturn(window.location.pathname)}>前往绑定</Link></div>:!overview.me.member&&!adminRooms?<div className="community-card"><h2>需要当前 Discord 服务器成员身份</h2><p>加入服务器后刷新页面；账号绑定不会自动授予服务器权限。</p><button onClick={reload}>刷新成员状态</button></div>:<>
   {!ready&&<div className="community-notice" role="status"><strong>机器人尚未就绪</strong><p>{overview.runtime.problem??'同步完成后才能提交操作。'} 已保存配置 {overview.version}，已应用 {overview.runtime.appliedVersion}。</p></div>}
   <OperationNotice operation={op.operation}/>{op.error&&<p className="community-error" role="alert">{op.error}</p>}
   <div key={authority.current}>{data.featureErrors[tab]?<div className="community-empty" role={data.featureErrors[tab]==='unavailable'?'status':'alert'}>{data.featureErrors[tab]==='unavailable'?{rooms:'语音房间暂未开放。',roles:'自选身份暂未开放。'}[tab]:data.featureErrors[tab]}</div>:tab==='rooms'?<Rooms data={data} disabled={!ready||op.busy} submit={op.submit}/>:<Roles data={data.roles} disabled={!ready||op.busy} submit={op.submit}/>}</div>
  </>}
 </section>;
}
type Submit=(work:()=>Promise<{operation:CommunityOperationView}>)=>Promise<void>;
function Rooms({data,disabled,submit}:{data:Data;disabled:boolean;submit:Submit}) {
 const member=data.overview.me.member?.ref;const personal=data.overview.me.linked&&!!member;
 const enabled=data.overview.settings.enabled&&data.overview.settings.rooms.enabled;
 const rooms=data.rooms.filter(room=>room.status!=='closed'&&(data.overview.me.isAdmin||room.kind==='fixed'&&room.canManage||room.owner?.ref===member||room.members.some(person=>person.ref===member)||room.canClaim||room.transferTo?.ref===member));
 const seconds=data.overview.settings.rooms.emptyGraceSeconds;const grace=seconds%60===0?`${seconds/60} 分钟`:`${seconds} 秒`;
 return <><div className="community-card"><div><h2>{!personal?'社区房间管理':enabled?'进入语音，房间就准备好了':'已有房间仍可管理'}</h2>{!personal?<p>这里保留全部受管房间，方便管理员处理。成员日常建房和管理都在 Discord 完成。</p>:enabled?<ol className="community-room-steps"><li>进入服务器指定的「新建临时房间」语音频道。</li><li>机器人自动建房并把你移入，房内聊天会出现控制卡。</li><li>改名、调整人数和访问方式，都可以直接在房内控制卡完成。</li></ol>:<p>自助建房暂未开放，已有房间仍可使用下方的网页辅助管理。</p>}<p className="community-muted">临时房间无人后 {grace}自动删除；有人回来就停止计时。</p></div></div>
 <div className="community-section-title"><h2>{data.overview.me.isAdmin?'受管房间':'与你有关的房间'}</h2></div>
 {rooms.length===0?<div className="community-empty">{data.overview.me.isAdmin?'目前没有受管房间。':'目前没有与你有关的房间。建房和加入房间都直接在 Discord 完成。'}</div>:<div className="community-room-grid">{rooms.map(room=><RoomCard key={room.ref} room={room} data={data} disabled={disabled} submit={submit}/>)}</div>}</>;
}
function RoomCard({room,data,disabled,submit}:{room:CommunityRoomView;data:Data;disabled:boolean;submit:Submit}) {
 const [name,setName]=useState(room.name);const [member,setMember]=useState('');const [limit,setLimit]=useState(room.userLimit);const [confirm,setConfirm]=useState(false);
 useEffect(()=>{setName(room.name);setLimit(room.userLimit);setConfirm(false);setMember('');},[room.version,room.owner?.ref]);
 const action=(kind:string,fields:Record<string,unknown>={})=>void submit(()=>communityApi.roomAction(room,kind,fields));
 const mine=data.overview.me.member?.ref;const personal=data.overview.me.linked&&!!mine;
 const fixed=room.kind==='fixed';
 return <article className="community-card"><div className="community-room-title"><h3>{room.name}</h3><span className="community-pill">{{open:'公开',locked:'已锁门',hidden:'已隐藏'}[room.visibility]}</span></div>{fixed?<><p>固定房间 · 不会自动删除</p><p>房间管理员：{room.managers?.length?room.managers.map(manager=>manager.name).join('、'):'尚未分配'}</p><p>{room.members.length} 人{room.userLimit?` / ${room.userLimit} 人上限`:''}</p></>:<p>房主 {room.owner?.name??'等待认领'} · {room.members.length} 人{room.userLimit?` / ${room.userLimit} 人上限`:''}</p>}
  <p className="community-muted">{room.status==='active'?'房间已就绪':room.status==='needs_review'?'房间待管理员对账':room.status==='closed'?'已关闭':'正在处理'}</p>{room.members.length>0&&<p>{room.members.map(member=>member.name).join('、')}</p>}
  {room.panelProblem&&<p className="community-muted" role="status">{room.panelProblem}</p>}
  {!fixed&&room.cleanupAt&&<p>空房待回收：{new Date(room.cleanupAt).toLocaleTimeString('zh-CN')}</p>}
  {!fixed&&personal&&room.canClaim&&<button disabled={disabled} onClick={()=>action('claim')}>认领这个房间</button>}
  {!fixed&&personal&&room.transferTo?.ref===mine&&<div className="community-notice"><p>房主邀请你接管房间。接受后才会转让。</p><button disabled={disabled} onClick={()=>action('accept')}>接受房主转让</button></div>}
  {room.canManage&&room.status==='active'&&<details><summary>网页辅助管理</summary><div className="community-form">
   <label>修改名字<input maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={disabled||name===room.name||!name.trim()} onClick={()=>action('rename',{name})}>保存名字</button>
   <label>人数上限（0 为不限）<input type="number" min={0} max={data.overview.settings.rooms.maxUserLimit} value={limit} onChange={e=>setLimit(Number(e.target.value))}/></label><button disabled={disabled||limit===room.userLimit} onClick={()=>action('limit',{userLimit:limit})}>保存人数</button>
   <label>房间访问<select value={room.visibility} disabled={disabled} onChange={e=>action('visibility',{visibility:e.target.value})}><option value="open">公开可加入</option><option value="locked">锁门，允许的成员可加入</option><option value="hidden">隐藏，仅允许的成员可见</option></select></label>
   <label>选择成员<select value={member} onChange={e=>setMember(e.target.value)}><option value="">请选择</option>{data.members.filter(item=>item.ref!==room.owner?.ref).map(item=><option key={item.ref} value={item.ref}>{item.name}</option>)}</select></label>
   <div className="community-actions">{[['grant','允许加入'],['deny','禁止加入'],['kick','移出房间'],...(!fixed?[['transfer','邀请接任房主']]:[])].map(([kind,label])=><button key={kind} disabled={disabled||!member} onClick={()=>action(kind,{memberRef:member})}>{label}</button>)}</div>
   {!fixed&&<p className="community-muted">能查看此临时房间的社区成员均可管理。转让需要对方接受；房主离开宽限后，房内成员可主动认领。</p>}
   {!fixed&&(room.members.length===0?<button className="community-danger" disabled={disabled} onClick={()=>action('dissolve')}>解散空房</button>:<div className="community-danger-zone">{!confirm?<button disabled={disabled} onClick={()=>setConfirm(true)}>关闭有人房间…</button>:<><p>确认将全部成员移到已配置的等候区，再删除房间？有任何成员移动失败，房间都会保留。</p><button disabled={disabled} onClick={()=>{setConfirm(false);action('admin_delete',{confirm:true});}}>确认移动并关闭</button><button onClick={()=>setConfirm(false)}>取消</button></>}</div>)}
  </div></details>}
 </article>;
}
function Roles({data,disabled,submit}:{data:CommunityRoles|null;disabled:boolean;submit:Submit}) {
 const [selected,setSelected]=useState<string[]>(data?.selectedRefs??[]);
 const selectedKey=data?.selectedRefs.slice().sort().join(',')??'';
 useEffect(()=>setSelected(data?.selectedRefs??[]),[selectedKey]);
 if(!data||!data.enabled&&!data.selectedRefs.length)return <div className="community-empty">自选身份暂未开放。</div>;
 return <div className="community-card"><h2>找到你的同好</h2><p>选择你感兴趣的身份，最多 {data.maxChoices} 个。取消勾选即可退出。{!data.enabled&&' 当前暂停新增身份。'}</p><div className="community-choice-grid">{data.choices.map(role=><label key={role.ref} className="community-choice"><input type="checkbox" checked={selected.includes(role.ref)} disabled={disabled||(!selected.includes(role.ref)&&(!data.enabled||!role.available||selected.length>=data.maxChoices))} onChange={e=>setSelected(e.target.checked?[...selected,role.ref]:selected.filter(ref=>ref!==role.ref))}/><span>{role.name}{!role.available?'（已停用，可退出）':''}</span></label>)}</div><button className="community-button" disabled={disabled} onClick={()=>void submit(()=>communityApi.setRoles(selected))}>保存身份</button></div>;
}
