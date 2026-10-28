import {useEffect,useRef,useState} from 'react';
import type {User} from '../types';
import type {DiscordLinkRead,DiscordLinkValue} from '../lib/discordLinkState';
import {setDiscordNotify,resendWelcome} from '../api';
import {IdentityForm,type IdentityFormHandle} from './IdentityForm';
import {DiscordLinkCard} from './DiscordLinkCard';
import {CommunityEntry} from './CommunityEntry';
import {Link} from './Link';
import {LoginLink} from './LoginLink';
import {saveWelcomeReturn} from '../lib/welcomeReturn';
import './community.css';
interface SettingsProps {me:User|null;discord:DiscordLinkRead;onDiscordChanged:(value:DiscordLinkValue)=>void;onSaved:(user:User)=>void}
export function SettingsPage(props:SettingsProps){return <SettingsContent key={props.me?.id??'guest'} {...props}/>;}
function SettingsContent({me,discord,onDiscordChanged,onSaved}:SettingsProps){
 const identity=useRef<IdentityFormHandle>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [notice,setNotice]=useState<string|null>(null);const active=useRef(true);
 useEffect(()=>()=>{active.current=false;},[]);
 const bound=typeof discord.value==='object'&&discord.value!==null?discord.value:null;
 const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError(null);setNotice(null);try{await action();}catch(e){if(active.current)setError(e instanceof Error?e.message:'设置暂未保存，请重试');}finally{if(active.current)setBusy(false);}};
 return <section className="community-page"><Link className="community-back" to="/">← 首页</Link><p className="community-eyebrow">按你的方式参与</p><h1>设置</h1><p>账号、通知和社区管理，集中在这里。</p>{!me?<LoginLink returnTo="/settings">登录后管理设置</LoginLink>:<>
  <section className="community-card community-admin-section"><h2>名字与身份</h2><IdentityForm ref={identity} me={me} onSaved={onSaved}/></section>
  <section className="community-card community-admin-section"><h2>Discord 与通知</h2><DiscordLinkCard linkState={discord} onChanged={onDiscordChanged} onBeforeBind={()=>{identity.current?.saveBeforeBind();saveWelcomeReturn('/settings');}}/>
   {bound&&<><p>私信通知由你选择。入服的公开欢迎和这里的私信设置各自独立。</p><button type="button" role="switch" aria-label="私信通知" aria-checked={bound.notify_dm===true} disabled={busy} onClick={()=>void run(async()=>{const next=await setDiscordNotify(bound.notify_dm!==true);if(active.current&&next!==undefined)onDiscordChanged(next);})}>私信通知：{bound.notify_dm===true?'开启':'关闭'}</button>{bound.notify_dm&&<button disabled={busy} onClick={()=>void run(async()=>{await resendWelcome();if(active.current)setNotice('已安排重发欢迎私信，请到 Discord 查看。');})}>重发欢迎私信</button>}</>}
   {error&&<p role="alert" className="community-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </section>
  <CommunityEntry accountKey={`${me.id}:${me.is_admin}`}/>
  {(me.is_admin||me.is_judge)&&<section className="community-card community-admin-section"><h2>管理工具</h2><div className="community-actions"><Link className="community-button community-button--quiet" to="/admin/voice">语音记录</Link>{me.is_admin&&<><Link className="community-button community-button--quiet" to="/admin/ai">AI 提供商与裁判配置</Link><Link className="community-button community-button--quiet" to="/admin/members">成员权限</Link></>}</div></section>}
 </>}</section>;
}
