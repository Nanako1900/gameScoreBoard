import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { CommunityStore } from '../../server/src/community/store';
import { CommunityFunService } from '../../server/src/community/fun-service';
import { pool, env } from './cloudflare-test';

const GUILD='111111111111111111';
let store:CommunityStore;
let clock:number;
beforeEach(async()=>{
  await pool.query('TRUNCATE community_settings,community_resources,community_rooms,community_room_access,community_operations,community_audit,community_fun,community_poll_votes,community_ai_usage,community_role_choices,community_welcomes CASCADE');
  store=new CommunityStore(pool,GUILD);clock=Date.now();
  const settings=defaultCommunitySettings();settings.enabled=true;settings.fun.cooldownSeconds=0;settings.fun.ai.enabled=true;
  await store.saveSettings(settings,0);
});
async function member(id='222222222222222222',name='成员'){return store.upsertResource('member',id,name)}
function service(options:ConstructorParameters<typeof CommunityFunService>[1]={}){return new CommunityFunService(store,{db:env.DB,now:()=>clock,...options})}
async function configure(change:(settings:ReturnType<typeof defaultCommunitySettings>)=>void){const value=await store.settings();change(value.settings);await store.saveSettings(value.settings,value.version)}
async function privateRoom(){const owner=await member();const room=await store.createRoom(owner.ref,'秘密房',{visibility:'hidden'});return {owner,room}}

it('persists server-generated results and returns no Discord identifiers',async()=>{
 const m=await member();const fun=await service().create('roll',{count:2,sides:2},{memberRef:m.ref,isAdmin:false});
 expect(fun.kind).toBe('roll');expect(fun.status).toBe('closed');expect(fun.creator).toEqual({ref:m.ref,name:m.name});
 expect((await service().get(fun.ref,m.ref,false)).ref).toBe(fun.ref);
 const raw=JSON.stringify(fun);expect(raw).not.toContain(GUILD);expect(raw).not.toContain(m.externalId);expect(raw).not.toMatch(/externalId|discord_user_id|guild_id/);
 expect((await pool.query('SELECT count(*) FROM community_fun')).rows[0].count).toBe(1);
});
it('rejects unknown, unavailable and cross-server actors even for create',async()=>{
 const m=await member();await store.upsertResource('member',m.externalId,'成员',{available:false});
 await expect(service().create('roll',{}, {memberRef:m.ref,isAdmin:false})).rejects.toMatchObject({status:404});
 const other=await new CommunityStore(pool,'999999999999999999').upsertResource('member','333333333333333333','外服成员');
 await expect(service().create('roll',{}, {memberRef:other.ref,isAdmin:true})).rejects.toMatchObject({status:404});
});
it('hides private-room records from lists and lookups, including blocked members',async()=>{
 const {owner,room}=await privateRoom();const stranger=await member('333333333333333333','其他人');
 const fun=await service().create('draw',{items:['甲','乙'],count:1},{memberRef:owner.ref,isAdmin:false},room.ref);
 expect((await service().list(stranger.ref,false))).toEqual([]);
 await expect(service().get(fun.ref,stranger.ref,false)).rejects.toMatchObject({status:404});
 await store.setRoomAccess(room.ref,stranger.ref,{allowed:true});expect(await service().list(stranger.ref,false)).toHaveLength(1);
 await store.setRoomAccess(room.ref,stranger.ref,{blocked:true});expect(await service().list(stranger.ref,false)).toHaveLength(0);
 expect(await service().list(null,true)).toHaveLength(1);
});
it('stops showing private history after membership becomes unavailable',async()=>{
 const {owner,room}=await privateRoom();const fun=await service().create('roll',{}, {memberRef:owner.ref,isAdmin:false},room.ref);
 await store.upsertResource('member',owner.externalId,'离服成员',{available:false});
 await expect(service().get(fun.ref,owner.ref,false)).rejects.toMatchObject({status:404});
 expect(await service().list(owner.ref,false)).toEqual([]);
});
it('allows historical results when only the individual tool is disabled, but respects the community and fun switches',async()=>{
 const m=await member();const fun=await service().create('roll',{}, {memberRef:m.ref,isAdmin:false});
 await configure(s=>{s.fun.enabledTools=['poll']});
 expect((await service().get(fun.ref,m.ref,false)).ref).toBe(fun.ref);
 await expect(service().create('roll',{}, {memberRef:m.ref,isAdmin:false})).rejects.toMatchObject({status:409});
 await configure(s=>{s.fun.enabled=false});await expect(service().get(fun.ref,m.ref,false)).rejects.toMatchObject({status:404});
});
it('atomically enforces persistent per-member cooldown under simultaneous creation',async()=>{
 const m=await member();await configure(s=>{s.fun.cooldownSeconds=5});const api=service();
 const results=await Promise.allSettled([api.create('roll',{}, {memberRef:m.ref,isAdmin:false}),api.create('draw',{items:['甲','乙']},{memberRef:m.ref,isAdmin:false})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:429});
 clock+=5001;await expect(api.create('roll',{}, {memberRef:m.ref,isAdmin:false})).resolves.toHaveProperty('ref');
});
it('persists poll votes once per member and replaces the vote before closing',async()=>{
 const a=await member();const b=await member('333333333333333333','另一位');const api=service();
 const poll=await api.create('poll',{question:'选一个',options:['甲','乙'],hours:1},{memberRef:a.ref,isAdmin:false});
 await api.vote(poll.ref,0,{memberRef:a.ref,isAdmin:false});await api.vote(poll.ref,1,{memberRef:a.ref,isAdmin:false});
 await api.vote(poll.ref,1,{memberRef:b.ref,isAdmin:false});
 expect((await api.get(poll.ref,a.ref,false)).data).toMatchObject({totals:[0,2],myChoice:1});
 expect((await pool.query('SELECT count(*) FROM community_poll_votes')).rows[0].count).toBe(2);
});
it('serializes concurrent changed votes without double counting a person',async()=>{
 const m=await member();const api=service();const poll=await api.create('poll',{question:'选一个',options:['甲','乙']},{memberRef:m.ref,isAdmin:false});
 await Promise.all([api.vote(poll.ref,0,{memberRef:m.ref,isAdmin:false}),api.vote(poll.ref,1,{memberRef:m.ref,isAdmin:false})]);
 const data=(await api.get(poll.ref,m.ref,false)).data as {totals:number[]};expect(data.totals.reduce((sum,v)=>sum+v,0)).toBe(1);
});
it('allows only the creator or an administrator to close polls and blocks voting after the deadline',async()=>{
 const a=await member();const b=await member('333333333333333333','其他人');const api=service();
 const poll=await api.create('poll',{question:'选一个',options:['甲','乙'],hours:1},{memberRef:a.ref,isAdmin:false});
 await expect(api.close(poll.ref,{memberRef:b.ref,isAdmin:false})).rejects.toMatchObject({status:403});
 clock+=3_600_000;await expect(api.vote(poll.ref,0,{memberRef:a.ref,isAdmin:false})).rejects.toMatchObject({status:409});
 expect((await api.get(poll.ref,a.ref,false)).status).toBe('closed');
 expect((await api.close(poll.ref,{memberRef:b.ref,isAdmin:true})).status).toBe('closed');
});
it('returns 404 for a hidden poll before revealing option validation',async()=>{
 const {owner,room}=await privateRoom();const stranger=await member('333333333333333333','其他人');const api=service();
 const poll=await api.create('poll',{question:'选一个',options:['甲','乙']},{memberRef:owner.ref,isAdmin:false},room.ref);
 await expect(api.vote(poll.ref,999,{memberRef:stranger.ref,isAdmin:false})).rejects.toMatchObject({status:404});
});
it('creates a distinct redraw with a previousRef while leaving the old draw immutable',async()=>{
 const m=await member();const api=service();const original=await api.create('draw',{items:['甲','乙','丙'],count:2},{memberRef:m.ref,isAdmin:false});
 const redrawn=await api.redraw(original.ref,{memberRef:m.ref,isAdmin:false});
 expect(redrawn.ref).not.toBe(original.ref);expect(redrawn.data).toMatchObject({previousRef:original.ref});
 expect(await api.get(original.ref,m.ref,false)).toEqual(original);
 expect((redrawn.data as {picked:string[]}).picked).toHaveLength(2);
});
it('reserves the AI personal quota atomically and counts failed upstream attempts',async()=>{
 const m=await member();const fetcher=vi.fn(async()=>new Response('provider failure',{status:500}));const api=service({fetcher,env:{AI_BASE_URL:'https://provider.example/v1',AI_MODEL:'community',AI_API_KEY:'private-key'}});
 const input={theme:'星空',purpose:'room_name'};
 const results=await Promise.allSettled(Array.from({length:7},()=>api.create('ai',input,{memberRef:m.ref,isAdmin:false})));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);expect(fetcher).toHaveBeenCalledTimes(5);
 expect((await pool.query('SELECT count FROM community_ai_usage WHERE member_ref=$1',[m.ref])).rows[0].count).toBe(5);
 expect(results.filter(r=>r.status==='rejected').every(r=>(r as PromiseRejectedResult).reason.status===429)).toBe(true);
});
it('reserves the guild AI quota across different members without overspending',async()=>{
 await configure(s=>{s.fun.ai.guildDailyLimit=2});const members=await Promise.all(['2','3','4'].map(n=>member(n.repeat(18),n)));
 const api=service({fetcher:vi.fn(async()=>new Response('',{status:500})),env:{AI_BASE_URL:'https://provider.example/v1',AI_MODEL:'m',AI_API_KEY:'private-key'}});
 const results=await Promise.allSettled(members.map(m=>api.create('ai',{theme:'星空',purpose:'topic'},{memberRef:m.ref,isAdmin:false})));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
 expect(Number((await pool.query('SELECT SUM(count) total FROM community_ai_usage')).rows[0].total)).toBe(2);
});
it('uses the configured board offset for AI quota day boundaries',async()=>{
 const m=await member();const api=service({offsetHours:8});clock=Date.parse('2026-10-28T15:59:59Z');
 await api.create('ai',{theme:'星空',purpose:'topic'},{memberRef:m.ref,isAdmin:false});clock+=2000;
 await api.create('ai',{theme:'星空',purpose:'topic'},{memberRef:m.ref,isAdmin:false});
 const rows=(await pool.query('SELECT day::text AS "day",count FROM community_ai_usage ORDER BY day')).rows;
 expect(rows).toEqual([{day:'2026-10-28',count:1},{day:'2026-10-29',count:1}]);
});

describe('fixed-room interactive result visibility', () => {
 async function fixedRoom() {
  const owner = await member(), other = await member('333333333333333333', '其他人');
  const category = await store.upsertResource('category', '666666666666666666', '固定分类');
  const channel = await store.upsertResource('voice', '777777777777777777', '角色可见的房间');
  let room = await store.ensureFixedRoom(channel.ref, '角色可见的房间', { categoryRef: category.ref, managerRefs: [owner.ref] });
  room = await store.syncFixedRoomProjection(room.ref, room.version, { name: room.name, userLimit: 6, visibility: 'open',
   categoryRef: category.ref, visibleMemberRefs: [owner.ref], presentMemberRefs: [owner.ref] });
  const api = service(), actor = { memberRef: owner.ref, isAdmin: false };
  const poll = await api.create('poll', { question: '私房投票', options: ['甲', '乙'] }, actor, room.ref);
  const draw = await api.create('draw', { items: ['甲', '乙'], count: 1 }, actor, room.ref);
  return { room, owner, other, api, poll, draw };
 }
 it.each([
  ['active', 'none'], ['active', 'present'], ['closed', 'allowed'], ['needs_review', 'allowed'],
 ] as const)('hides list/get/vote/redraw when fixed status is %s with %s access', async (status, access) => {
  const s = await fixedRoom();
  const target = access === 'allowed' ? s.owner : s.other;
  if (access === 'present') await store.setRoomAccess(s.room.ref, target.ref, { allowed: false, present: true });
  if (status !== 'active') await store.patchRoom(s.room.ref, { status }, s.room.version);
  expect(await s.api.list(target.ref, false)).toEqual([]);
  await expect(s.api.get(s.poll.ref, target.ref, false)).rejects.toMatchObject({ status: 404 });
  await expect(s.api.vote(s.poll.ref, 999, { memberRef: target.ref, isAdmin: false })).rejects.toMatchObject({ status: 404 });
  await expect(s.api.redraw(s.draw.ref, { memberRef: target.ref, isAdmin: false })).rejects.toMatchObject({ status: 404 });
  await expect(s.api.close(s.poll.ref, { memberRef: target.ref, isAdmin: false })).rejects.toMatchObject({ status: 404 });
  await expect(s.api.create('roll', {}, { memberRef: target.ref, isAdmin: false }, s.room.ref)).rejects.toMatchObject({ status: 404 });
 });
 it('continues to allow projected fixed members and existing administrator inspection', async () => {
  const s = await fixedRoom();
  expect(await s.api.list(s.owner.ref, false)).toHaveLength(2);
  expect((await s.api.vote(s.poll.ref, 0, { memberRef: s.owner.ref, isAdmin: false })).data).toMatchObject({ myChoice: 0 });
  expect((await s.api.redraw(s.draw.ref, { memberRef: s.owner.ref, isAdmin: false })).ref).not.toBe(s.draw.ref);
  expect((await s.api.get(s.draw.ref, null, true)).ref).toBe(s.draw.ref);
 });
 it('keeps roomless AI suggestions private while other roomless tools remain public to members', async () => {
  const one = await member(), other = await member('333333333333333333', '其他人');
  const api = service({ env: {}, fetcher: vi.fn(async () => new Response('', { status: 500 })) });
  const ai = await api.create('ai', { theme: '星空', purpose: 'topic' }, { memberRef: one.ref, isAdmin: false });
  expect((await api.get(ai.ref, one.ref, false)).ref).toBe(ai.ref);
  await expect(api.get(ai.ref, other.ref, false)).rejects.toMatchObject({ status: 404 });
  expect(await api.list(other.ref, false)).toEqual([]);
  const roll = await api.create('roll', {}, { memberRef: one.ref, isAdmin: false });
  expect((await api.get(roll.ref, other.ref, false)).ref).toBe(roll.ref);
 });
});
