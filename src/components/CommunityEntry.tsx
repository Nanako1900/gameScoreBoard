import { useEffect,useState } from 'react';
import { communityApi } from '../community-api';
import { Link } from './Link';
import './community.css';
export function CommunityEntry({accountKey}:{accountKey:string}) {return <Entry key={accountKey}/>;}
function Entry(){
 const [value,setValue]=useState<{enabled:boolean;admin:boolean}|null>(null);
 useEffect(()=>{const abort=new AbortController();void communityApi.overview(abort.signal).then(data=>{if(!abort.signal.aborted)setValue({enabled:data.settings.enabled,admin:data.me.isAdmin});}).catch(()=>{});return()=>abort.abort();},[]);
 if(!value||!value.enabled&&!value.admin)return null;
 return <aside className="community-entry" aria-label="社区中心"><div><strong>相聚，从这里开始</strong><p>语音房间、兴趣身份和一点新灵感。</p></div><div className="community-actions"><Link to="/community">进入社区</Link>{value.admin&&<Link to="/settings/community">社区管理</Link>}</div></aside>;
}
