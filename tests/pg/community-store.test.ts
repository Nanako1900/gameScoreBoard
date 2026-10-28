import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultCommunitySettings, isCommunityRef } from '../../shared/community';
import { CommunityStore } from '../../server/src/community/store';
import { pool } from './cloudflare-test';

const GUILD = '111111111111111111';
const DISCORD_MEMBER = '222222222222222222';
const CHANNEL = '333333333333333333';
const store = new CommunityStore(pool, GUILD);
beforeEach(async () => {
  await pool.query(`TRUNCATE community_settings,community_resources,community_rooms,community_room_access,
    community_operations,community_audit,community_fun,community_poll_votes,community_ai_usage,
    community_role_choices,community_welcomes CASCADE`);
});
async function member(external = DISCORD_MEMBER) { return store.upsertResource('member', external, '成员'); }
async function room() { return store.createRoom((await member()).ref, '测试房间'); }
const actor = { source: 'web', userId: 'admin' } as const;

describe('community PostgreSQL foundation', () => {
  it('can execute its migration repeatedly and includes future community feature tables', async () => {
    const sql = readFileSync(new URL('../../server/migrations/0012_community.sql', import.meta.url), 'utf8');
    await pool.query(sql); await pool.query(sql);
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'community_%'")).rows.map(r=>r.tablename);
    for (const name of ['community_settings','community_resources','community_rooms','community_room_access','community_operations','community_audit','community_fun','community_poll_votes','community_ai_usage','community_role_choices','community_welcomes']) expect(tables).toContain(name);
  });
  it('starts disabled at version zero and reports unapplied runtime separately', async () => {
    expect(await store.settings()).toEqual({ settings: defaultCommunitySettings(), version: 0, runtime: { ready: false, syncedAt: null, appliedVersion: 0, problem: null } });
  });
  it('compares settings versions atomically under simultaneous writes', async () => {
    const settings = defaultCommunitySettings();
    const result = await Promise.allSettled([store.saveSettings(settings, 0),store.saveSettings(settings, 0)]);
    expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const rejected = result.find(r=>r.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: 'version_conflict' });
    expect((await store.settings()).version).toBe(1);
  });
  it('validates the entire settings document before saving', async () => {
    const settings = defaultCommunitySettings(); settings.rooms.maxPerMember=2;
    await expect(store.saveSettings(settings,0)).rejects.toMatchObject({ status:400,code:'invalid_input' });
    expect((await store.settings()).version).toBe(0);
  });
  it('atomically saves settings with one idempotent application operation', async () => {
    const settings=defaultCommunitySettings();settings.enabled=true;
    const saved=await store.saveSettingsAndEnqueue(settings,0,actor,'save-1');
    expect(saved.version).toBe(1);expect(saved.operation).toMatchObject({kind:'settings.apply',status:'queued',payload:{version:1,settings}});
    const replay=await store.saveSettingsAndEnqueue(settings,0,actor,'save-1');
    expect(replay.operation.ref).toBe(saved.operation.ref);expect(replay.version).toBe(1);
    const different=defaultCommunitySettings();
    await expect(store.saveSettingsAndEnqueue(different,0,actor,'save-1')).rejects.toMatchObject({status:409,code:'idempotency_conflict'});
    await expect(store.saveSettingsAndEnqueue(settings,0,actor,'save-2')).rejects.toMatchObject({status:409,code:'version_conflict'});
    expect(await store.listOperations()).toHaveLength(1);
  });
  it('does not confuse saved settings with Bot-applied configuration', async () => {
    await store.saveSettings(defaultCommunitySettings(),0);
    expect((await store.runtime()).appliedVersion).toBe(0);
    await store.setRuntime({ready:true,appliedVersion:1,syncedAt:'2026-10-28T10:00:00.000Z'});
    expect(await store.runtime()).toMatchObject({ready:true,appliedVersion:1,syncedAt:'2026-10-28T10:00:00.000Z'});
  });
  it('keeps resource references stable while names and availability change, without exposing IDs', async () => {
    const original=await store.upsertResource('voice',CHANNEL,'原名');
    const updated=await store.upsertResource('voice',CHANNEL,'新名',{available:false,metadata:{connected:3}});
    expect(isCommunityRef(original.ref)).toBe(true);expect(updated.ref).toBe(original.ref);
    expect(await store.resources()).toEqual([{ref:original.ref,name:'新名',kind:'voice',available:false,safe:false}]);
    expect(JSON.stringify(await store.resources())).not.toContain(CHANNEL);
    expect(await store.resource(original.ref,'category')).toBeNull();
    expect((await store.resourceByExternal('voice',CHANNEL))?.externalId).toBe(CHANNEL);
  });
  it('never resolves resources from a different configured server', async () => {
    const resource=await member();const other=new CommunityStore(pool,'444444444444444444');
    expect(await other.resource(resource.ref)).toBeNull();
    expect(await other.resourceByExternal('member',DISCORD_MEMBER)).toBeNull();
    expect((await other.upsertResource('member',DISCORD_MEMBER,'另一个服务器')).ref).not.toBe(resource.ref);
  });
  it('allows at most one live room per owner and permits a replacement after closure', async () => {
    const first=await room();
    await expect(store.createRoom(first.ownerRef!,'重复房')).rejects.toMatchObject({status:409,code:'room_exists'});
    await store.patchRoom(first.ref,{status:'closed'},first.version);
    expect((await store.createRoom(first.ownerRef!,'新房')).ref).not.toBe(first.ref);
  });
  it('atomically enforces the configured total room cap across different owners', async () => {
    const one=await member();const two=await member('555555555555555555');
    const results=await Promise.allSettled([store.createRoom(one.ref,'一',{maxRooms:1}),store.createRoom(two.ref,'二',{maxRooms:1})]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason).toMatchObject({status:409,code:'room_limit'});
  });
  it('compares room versions and rejects cross-server or wrong-kind resource references', async () => {
    const first=await room();
    const changed=await store.patchRoom(first.ref,{name:'改名',visibility:'locked'},first.version);
    expect(changed.version).toBe(first.version+1);
    await expect(store.patchRoom(first.ref,{name:'过时'},first.version)).rejects.toMatchObject({status:409,code:'version_conflict'});
    await expect(store.patchRoom(first.ref,{channelRef:first.ownerRef},changed.version)).rejects.toMatchObject({status:400,code:'invalid_resource'});
  });
  it('stores room access and presence without mixing Discord identifiers into the room', async () => {
    const first=await room();const friend=await member('555555555555555555');
    await store.setRoomAccess(first.ref,friend.ref,{allowed:true,present:true});
    expect(await store.roomAccess(first.ref)).toEqual([expect.objectContaining({memberRef:friend.ref,allowed:true,blocked:false,present:true})]);
    expect(JSON.stringify(await store.getRoom(first.ref))).not.toContain(DISCORD_MEMBER);
    expect(JSON.stringify(await store.getRoom(first.ref))).not.toContain('555555555555555555');
  });
  it('returns the original operation for an idempotent request with reordered payload keys', async () => {
    const first=await store.enqueue('resources.sync',null,actor,{b:2,a:1},'request-1');
    const again=await store.enqueue('resources.sync',null,actor,{a:1,b:2},'request-1');
    expect(again.ref).toBe(first.ref);
    await expect(store.enqueue('resources.sync',null,actor,{a:2},'request-1')).rejects.toMatchObject({status:409,code:'idempotency_conflict'});
    expect(await store.listOperations()).toHaveLength(1);
  });
  it('fences operation completion with its active claim token', async () => {
    const queued=await store.enqueue('resources.sync',null,actor,{},'request-1');
    const claimed=await store.claim();expect(claimed).toMatchObject({ref:queued.ref,status:'running',attempts:1});
    expect(await store.finish(queued.ref,'00000000-0000-4000-8000-000000000000',{status:'succeeded'})).toBe(false);
    expect(await store.finish(queued.ref,claimed!.claimToken!,{status:'succeeded',result:{ready:true}})).toBe(true);
    expect((await store.getOperation(queued.ref))?.status).toBe('succeeded');
    expect(await store.finish(queued.ref,claimed!.claimToken!,{status:'failed',error:'discord_error'})).toBe(false);
  });
  it('renews only a current unexpired execution lease', async () => {
    const queued=await store.enqueue('resources.sync',null,actor,{},'1');const claimed=await store.claim();
    expect(await store.renew(queued.ref,claimed!.claimToken!,300)).toBe(true);
    expect(await store.renew(queued.ref,'00000000-0000-4000-8000-000000000000')).toBe(false);
    await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1",[queued.ref]);
    expect(await store.renew(queued.ref,claimed!.claimToken!)).toBe(false);
  });
  it('serializes operations for one room even with concurrent claimers', async () => {
    const first=await room();await store.enqueue('room.rename',first.ref,actor,{name:'一'},'1');await store.enqueue('room.rename',first.ref,actor,{name:'二'},'2');
    const claimed=await Promise.all([store.claim(),store.claim()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
  });
  it('serializes role changes from web and Discord for the same member',async()=>{
    const m=await member();
    await store.enqueue('roles.set',null,{source:'web',userId:'admin',memberRef:m.ref},{roleRefs:[]},'web-role');
    await store.enqueue('roles.set',null,{source:'discord',memberRef:m.ref},{roleRefs:[]},'discord-role');
    const claimed=await Promise.all([store.claim(),store.claim()]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
  });
  it('does not blindly repeat an operation whose executor lease expired', async () => {
    const queued=await store.enqueue('room.create',null,actor,{},'1');await store.claim();
    await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 minute' WHERE ref=$1",[queued.ref]);
    expect(await store.claim()).toBeNull();
    expect((await store.getOperation(queued.ref))?.status).toBe('needs_review');
  });
  it('holds later actions in the same scope until uncertain execution has been reconciled', async () => {
    const first=await room();const queued=await store.enqueue('room.rename',first.ref,actor,{name:'一'},'1');await store.claim();
    await store.enqueue('room.rename',first.ref,actor,{name:'二'},'2');
    await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 minute' WHERE ref=$1",[queued.ref]);
    expect(await store.claim()).toBeNull();
    expect(await store.resolveRecoveredOperation(queued.ref,{roomRef:first.ref})).toBe(true);
    expect((await store.claim())?.requestKey).toBe('2');
    expect(await store.resolveRecoveredOperation(queued.ref,null)).toBe(false);
  });
  it('expires unstarted requests and exposes only a safe failure category', async () => {
    const queued=await store.enqueue('resources.sync',null,actor,{},'1',undefined,1);
    await pool.query("UPDATE community_operations SET expires_at=now()-interval '1 second' WHERE ref=$1",[queued.ref]);
    expect(await store.claim()).toBeNull();
    const op=await store.getOperation(queued.ref);expect(op).toMatchObject({status:'canceled',errorCode:'operation_expired'});
    const second=await store.enqueue('resources.sync',null,actor,{},'2');const claimed=await store.claim();
    await store.finish(second.ref,claimed!.claimToken!,{status:'failed',error:'Discord channel '+CHANNEL});
    expect(JSON.stringify(await store.listOperations())).not.toContain(CHANNEL);
  });
  it('queues at most one public welcome for simultaneous join events and keeps uncertainty pending', async () => {
    const target=await member();
    const joinedAt='2026-10-28T10:00:00.000Z';
    const results=await Promise.all([store.enqueueWelcome(target.ref,joinedAt,24),store.enqueueWelcome(target.ref,joinedAt,24)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.listOperations()).toEqual([expect.objectContaining({kind:'welcome.send',status:'queued'})]);
    expect(await store.enqueueWelcome(target.ref,joinedAt,24)).toBeNull();
    await pool.query('UPDATE community_welcomes SET pending_ref=NULL,last_sent_at=now() WHERE member_ref=$1',[target.ref]);
    expect(await store.enqueueWelcome(target.ref,joinedAt,24)).toBeNull();
    await pool.query("UPDATE community_welcomes SET last_sent_at=now()-interval '25 hours' WHERE member_ref=$1",[target.ref]);
    expect(await store.enqueueWelcome(target.ref,joinedAt,24)).not.toBeNull();
  });
  it('records bounded audit summaries with opaque targets', async () => {
    const first=await room();await store.addAudit(actor,'room.created',first.ref,'succeeded');
    expect(await store.audit()).toEqual([expect.objectContaining({actor:'admin',action:'room.created',target:first.ref,outcome:'succeeded'})]);
    expect(JSON.stringify(await store.audit())).not.toContain(GUILD);
  });
});
