import { beforeEach, describe, expect, it } from 'vitest';
import { buildEnv } from '../../server/src/api';
import { CommunityStore } from '../../server/src/community/store';
import { CommunityService } from '../../server/src/community/service';
import { createCommunityRoutes } from '../../server/src/community/routes';
import { signSession } from '../../worker/session';
import { defaultCommunitySettings } from '../../shared/community';
import { seedUser } from '../worker/helpers';
import { env as pgEnv, pool } from './cloudflare-test';

const API='https://api.example.com';const SPA='https://score.example.com';const SECRET='community-test-session-secret-0123456789';
const GUILD='111111111111111111';const ALICE='222222222222222222';const BOB='333333333333333333';
const store=new CommunityStore(pool,GUILD);const service=new CommunityService(store,pgEnv.DB);
const environment=()=>buildEnv({OAUTH_BASE_URL:'https://idp.example.com',OAUTH_CLIENT_ID:'client',OAUTH_CLIENT_SECRET:'secret',SESSION_SECRET:SECRET,APP_URL:API,FRONTEND_ORIGIN:SPA},pgEnv.DB);
let app:ReturnType<typeof createCommunityRoutes>;
let alice:string;let bob:string;
beforeEach(async()=>{
  await seedUser({id:'alice'});await seedUser({id:'bob'});await seedUser({id:'judge',judge:true});await seedUser({id:'admin',admin:true});
  alice=(await store.upsertResource('member',ALICE,'Alice',{available:true,metadata:{bot:false}})).ref;
  bob=(await store.upsertResource('member',BOB,'Bob',{available:true,metadata:{bot:false}})).ref;
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice'),($2,'bob','Bob')",[ALICE,BOB]);
  await store.setRuntime({ready:true,syncedAt:new Date().toISOString()});
  app=createCommunityRoutes({store,db:pgEnv.DB,env:environment(),onError:()=>undefined});
});
async function req(path:string,user:string|null='alice',body?:unknown,origin=SPA,method=body===undefined?'GET':'POST'){
  const headers:Record<string,string>={Origin:origin};if(user)headers.Cookie='edg_session='+await signSession({sub:user},SECRET);
  if(body!==undefined)headers['Content-Type']='application/json';
  return app.fetch(new Request(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}));
}
async function liveRoom(visibility:'open'|'hidden'='open'){
  const created=await store.createRoom(alice,'朋友房',{visibility});
  return store.patchRoom(created.ref,{status:'active'},created.version);
}
async function enableRooms(){
  const category=await store.upsertResource('category','444444444444444444','语音分类');
  const creator=await store.upsertResource('voice','555555555555555555','创建房间',{metadata:{parentId:category.externalId}});
  const settings=defaultCommunitySettings();settings.enabled=true;settings.rooms.enabled=true;settings.rooms.categoryRef=category.ref;settings.rooms.creatorRef=creator.ref;
  await store.saveSettings(settings,0);
}
describe('community Node API and authority',()=>{
  it('requires a real session, never caches private responses, and rejects removed users',async()=>{
    const anon=await req('/api/community',null);expect(anon.status).toBe(401);expect(anon.headers.get('Cache-Control')).toBe('no-store');
    await pool.query("DELETE FROM users WHERE id='judge'");expect((await req('/api/community','judge')).status).toBe(401);
  });
  it('allows onboarding overview while showing an unbound caller no membership',async()=>{
    const response=await req('/api/community','judge');expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({me:{linked:false,member:null,isAdmin:false,needsMembership:false}});
  });
  it('uses Nanako admin authority without granting judges or arbitrary Discord roles administration',async()=>{
    expect((await req('/api/admin/community','admin')).status).toBe(200);
    expect((await req('/api/admin/community','judge')).status).toBe(403);
    expect((await req('/api/admin/community','alice')).status).toBe(403);
  });
  it('keeps a hidden room indistinguishable from a missing room until access is granted',async()=>{
    const room=await liveRoom('hidden');
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(404);
    expect(await (await req('/api/community/rooms','bob')).json()).toEqual({rooms:[]});
    await store.setRoomAccess(room.ref,bob,{allowed:true});
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(200);
    await store.setRoomAccess(room.ref,bob,{blocked:true});
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(404);
    expect((await req('/api/community/rooms/'+room.ref,'admin')).status).toBe(200);
  });
  it('denies bound nonmembers and treats stale membership as unavailable',async()=>{
    const room=await liveRoom();await store.upsertResource('member',BOB,'Bob',{available:false});
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(404);
    expect(await service.actorFromWeb('bob')).toMatchObject({linked:true,memberAvailable:false});
    await pool.query("UPDATE community_settings SET runtime_updated_at=now()-interval '3 minutes' WHERE guild_id=$1",[GUILD]);
    expect(await service.actorFromWeb('alice')).toMatchObject({memberAvailable:false});
  });
  it('returns only safe references and names in room, resource, settings, audit and operation views',async()=>{
    const room=await liveRoom();await store.setRoomAccess(room.ref,bob,{present:true});
    await store.upsertResource('voice','666666666666666666','频道 <#666666666666666666>');
    await store.addAudit({source:'web',userId:'admin'},'room.created',room.ref,'succeeded');
    const queued=await store.enqueue('room.rename',room.ref,{source:'web',userId:'alice',memberRef:alice},{name:'x'},'one');
    const paths=['/api/community','/api/community/rooms','/api/admin/community/resources','/api/admin/community','/api/admin/community/audit','/api/community/operations/'+queued.ref];
    for(const path of paths){const response=await req(path,path.includes('/admin/')?'admin':'alice');expect(response.status).toBe(200);const text=await response.text();expect(text).not.toMatch(/\b\d{17,20}\b/);expect(text).not.toMatch(/externalId|external_id|discord_|claimToken|requestKey/);}
  });
  it('shows ordinary members only current member names and the safe role allowlist',async()=>{
    const safe=await store.upsertResource('role','777777777777777777','游戏',{safe:true});await store.upsertResource('role','888888888888888888','管理员',{safe:false});
    const settings=defaultCommunitySettings();settings.roles.allowedRefs=[safe.ref];await store.saveSettings(settings,0);
    const response=await req('/api/community/resources');const body=await response.json() as {resources:{kind:string;ref:string}[]};
    expect(body.resources.filter(r=>r.kind==='role').map(r=>r.ref)).toEqual([safe.ref]);expect(body.resources.every(r=>['member','role'].includes(r.kind))).toBe(true);
    expect((await req('/api/community/resources?kind=voice')).status).toBe(403);
  });
  it('authorizes the owner before queueing and requires an optimistic room version',async()=>{
    await enableRooms();const room=await liveRoom();const body={action:'rename',name:'新名',expectedVersion:room.version,requestKey:'rename-1'};
    expect((await req('/api/community/rooms/'+room.ref+'/actions','bob',body)).status).toBe(403);
    expect((await req('/api/community/rooms/'+room.ref+'/actions','alice',{...body,expectedVersion:undefined})).status).toBe(400);
    const response=await req('/api/community/rooms/'+room.ref+'/actions','alice',body);expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({operation:{kind:'room.rename',status:'queued',roomRef:room.ref}});
    expect(await store.listOperations()).toHaveLength(1);
  });
  it('preserves idempotence and reports stale versions without writing another operation',async()=>{
    await enableRooms();const room=await liveRoom();const body={action:'rename',name:'新名',expectedVersion:room.version,requestKey:'same'};
    const first=await (await req('/api/community/rooms/'+room.ref+'/actions','alice',body)).json();
    expect(await (await req('/api/community/rooms/'+room.ref+'/actions','alice',body)).json()).toEqual(first);
    await store.patchRoom(room.ref,{name:'已变'},room.version);
    expect((await req('/api/community/rooms/'+room.ref+'/actions','alice',{...body,requestKey:'next'})).status).toBe(409);
    expect(await store.listOperations()).toHaveLength(1);
  });
  it('rechecks binding and Nanako authority for execution instead of trusting queued roles',async()=>{
    const actor={source:'web',userId:'alice',memberRef:alice} as const;
    expect(await service.actorForExecution(actor)).toMatchObject({memberRef:alice,memberAvailable:true,isAdmin:false});
    await pool.query("DELETE FROM discord_links WHERE user_id='alice'");
    expect(await service.actorForExecution(actor)).toMatchObject({memberRef:null,memberAvailable:false,linked:false});
    await pool.query("UPDATE users SET is_admin=0 WHERE id='admin'");expect((await service.actorForExecution({source:'web',userId:'admin'})).isAdmin).toBe(false);
  });
  it('does not expose somebody else’s operation or a hidden room operation',async()=>{
    const room=await liveRoom('hidden');const queued=await store.enqueue('room.rename',room.ref,{source:'web',userId:'alice',memberRef:alice},{},'private');
    expect((await req('/api/community/operations/'+queued.ref,'bob')).status).toBe(404);
    expect((await req('/api/community/operations/'+queued.ref,'alice')).status).toBe(200);
  });
  it('saves admin settings with its apply job in one atomic idempotent request',async()=>{
    const body={settings:defaultCommunitySettings(),expectedVersion:0,requestKey:'settings-1'};
    const response=await req('/api/admin/community','admin',body);expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({version:1,runtime:{appliedVersion:0},operation:{kind:'settings.apply',status:'queued'}});
    expect((await req('/api/admin/community','admin',body)).status).toBe(202);expect((await store.settings()).version).toBe(1);
  });
  it('rejects unsafe role settings and raw IDs instead of accepting them as references',async()=>{
    const bad=await store.upsertResource('role','888888888888888888','管理员',{safe:false});const settings=defaultCommunitySettings();settings.roles.allowedRefs=[bad.ref];
    expect((await req('/api/admin/community','admin',{settings,expectedVersion:0,requestKey:'unsafe'})).status).toBe(400);
    settings.roles.allowedRefs=[ALICE];expect((await req('/api/admin/community','admin',{settings,expectedVersion:0,requestKey:'raw'})).status).toBe(400);
    expect((await store.settings()).version).toBe(0);
  });
  it('rejects absent or foreign origins on every mutation including JSON, and allows configured credentialed CORS',async()=>{
    const body={requestKey:'sync'};
    expect((await req('/api/admin/community/sync','admin',body,'https://evil.example')).status).toBe(403);
    expect((await req('/api/admin/community/sync','admin',body,'')).status).toBe(403);
    const response=await req('/api/admin/community/sync','admin',body);expect(response.status).toBe(202);expect(response.headers.get('Access-Control-Allow-Origin')).toBe(SPA);expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
  it('refuses writes in maintenance and enforces exact method/path and input fields',async()=>{
    app=createCommunityRoutes({store,db:pgEnv.DB,env:{...environment(),READ_ONLY:'1'},onError:()=>undefined});
    expect((await req('/api/admin/community/sync','admin',{requestKey:'sync'})).status).toBe(503);
    expect((await req('/api/admin/community','admin')).status).toBe(200);
    expect((await req('/api/community/unknown','admin')).status).toBe(404);
    app=createCommunityRoutes({store,db:pgEnv.DB,env:environment(),onError:()=>undefined});
    expect((await req('/api/admin/community/sync','admin',{requestKey:'sync',channelId:ALICE})).status).toBe(400);
  });
});
