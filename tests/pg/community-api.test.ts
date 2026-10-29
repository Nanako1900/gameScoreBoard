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
  it('allows every visible current member to control temporary rooms and still requires a room version',async()=>{
    await enableRooms();const room=await liveRoom();const body={action:'rename',name:'新名',expectedVersion:room.version,requestKey:'rename-1'};
    expect((await req('/api/community/rooms/'+room.ref+'/actions','bob',body)).status).toBe(202);
    expect((await req('/api/community/rooms/'+room.ref+'/actions','alice',{...body,expectedVersion:undefined})).status).toBe(400);
    const response=await req('/api/community/rooms/'+room.ref+'/actions','alice',body);expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({operation:{kind:'room.rename',status:'queued',roomRef:room.ref}});
    expect(await store.listOperations()).toHaveLength(2);
  });
  it('limits fixed room controls to assigned managers and Nanako administrators',async()=>{
    let room=await liveRoom();room=await store.patchRoom(room.ref,{ownerRef:null,metadata:{kind:'fixed',managerRefs:[alice]}},room.version);
    await store.setRoomAccess(room.ref,alice,{allowed:true});await store.setRoomAccess(room.ref,bob,{allowed:true});
    expect(await service.room(room.ref,'alice')).toMatchObject({kind:'fixed',owner:null,managers:[{ref:alice,name:'Alice'}],canManage:true,canClaim:false,cleanupAt:null});
    expect(await service.room(room.ref,'bob')).toMatchObject({canManage:false});
    const body={action:'rename',name:'固定房新名',expectedVersion:room.version,requestKey:'fixed-rename'};
    expect((await req('/api/community/rooms/'+room.ref+'/actions','bob',body)).status).toBe(403);
    expect((await req('/api/community/rooms/'+room.ref+'/actions','alice',body)).status).toBe(202);
  });
  it('does not expose fixed rooms through a flattened open visibility without the fresh ACL projection',async()=>{
    const room=await liveRoom();await store.patchRoom(room.ref,{ownerRef:null,metadata:{kind:'fixed',managerRefs:[]}},room.version);
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(404);
    expect((await req('/api/community/rooms/'+room.ref,'admin')).status).toBe(200);
    await store.setRoomAccess(room.ref,bob,{present:true,allowed:false});
    expect((await req('/api/community/rooms/'+room.ref,'bob')).status).toBe(404);
  });
  it('accepts administrator-entered manager IDs only for fixed rooms without echoing those IDs',async()=>{
    let room=await liveRoom();room=await store.patchRoom(room.ref,{ownerRef:null,metadata:{kind:'fixed',managerRefs:[]}},room.version);
    const body={action:'managers',discordIds:[ALICE,BOB],expectedVersion:room.version,requestKey:'assign-managers'};
    const response=await req('/api/community/rooms/'+room.ref+'/actions','admin',body);expect(response.status).toBe(202);expect(await response.text()).not.toMatch(/\b\d{17,20}\b/);
    await store.setRoomAccess(room.ref,alice,{allowed:true});expect((await req('/api/community/rooms/'+room.ref+'/actions','alice',body)).status).toBe(403);
    for(const action of ['cleanup','dissolve','admin_delete','transfer','claim','accept'])expect((await req('/api/community/rooms/'+room.ref+'/actions','admin',{action,expectedVersion:room.version,requestKey:action,confirm:true})).status).toBeGreaterThanOrEqual(400);
  });
  it('lets an ordinary temporary-room operator read their safe-close receipt',async()=>{
    const room=await liveRoom();const op=await store.enqueue('room.admin_delete',room.ref,{source:'web',userId:'bob',memberRef:bob},{confirm:true},'shared-close',room.version);
    expect((await req('/api/community/operations/'+op.ref,'bob')).status).toBe(200);
  });
  it('preserves fixed categories when an older client saves settings without the new field',async()=>{
    const category=await store.upsertResource('category','777777777777777777','私人房间');
    const settings=defaultCommunitySettings();settings.rooms.fixedCategoryRefs=[category.ref];await store.saveSettings(settings,0);
    const old=JSON.parse(JSON.stringify(settings));delete old.rooms.fixedCategoryRefs;old.welcome.template='旧客户端修改欢迎';
    const response=await req('/api/admin/community','admin',{settings:old,expectedVersion:1,requestKey:'old-client'});expect(response.status).toBe(202);
    expect((await store.settings()).settings.rooms.fixedCategoryRefs).toEqual([category.ref]);
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
  it('returns all safe field errors for invalid input without saving settings or queuing work', async () => {
    const settings = defaultCommunitySettings(); settings.rooms.emptyGraceSeconds = 14; settings.fun.ai.prompt = '';
    settings.fun.topics[0].text = ''; settings.roles.allowedRefs = [ALICE];
    const response = await req('/api/admin/community', 'admin', { settings, expectedVersion: 0, requestKey: 'invalid-fields' });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string; fieldErrors: Array<{ path: string; label: string; message: string }> };
    expect(body.error).toBe('请检查标出的社区设置');
    expect(body.fieldErrors.map(issue => issue.path)).toEqual(expect.arrayContaining(['rooms.emptyGraceSeconds', 'fun.ai.prompt', 'fun.topics.0.text', 'roles.allowedRefs.0']));
    expect(JSON.stringify(body)).not.toContain(ALICE);
    expect((await store.settings()).version).toBe(0); expect(await store.listOperations()).toEqual([]);
  });
  it('never exposes field errors before authorization or for invalid stored settings', async () => {
    const settings = defaultCommunitySettings(); settings.fun.ai.prompt = '';
    const denied = await req('/api/admin/community', 'alice', { settings, expectedVersion: 0, requestKey: 'denied-fields' });
    expect(denied.status).toBe(403); expect(await denied.json()).not.toHaveProperty('fieldErrors');
    await pool.query('UPDATE community_settings SET settings=$2 WHERE guild_id=$1', [GUILD, JSON.stringify(settings)]);
    const stored = await req('/api/admin/community', 'admin');
    expect(stored.status).toBe(500); expect(await stored.json()).toEqual({ error: '社区服务暂不可用', code: 'internal_error' });
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
