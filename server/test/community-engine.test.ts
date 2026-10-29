import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { CommunityEngine } from '../src/community/engine';
import { CommunityDiscordError, type CommunityDiscord } from '../src/community/discord';
import { CommunityStoreError, type CommunityStore, type StoredOperation, type StoredResource, type StoredRoom } from '../src/community/store';

function setup() {
  let now=Date.parse('2026-10-28T12:00:00Z'); const owner=randomUUID(), other=randomUUID(), category=randomUUID(), creator=randomUUID(), waiting=randomUUID(), channel=randomUUID();
  const settings=defaultCommunitySettings();settings.enabled=true;settings.rooms.enabled=true;Object.assign(settings.rooms,{categoryRef:category,creatorRef:creator,waitingRef:waiting,cooldownSeconds:0});
  const resources=new Map<string,StoredResource>();
  const add=(ref:string,kind:StoredResource['kind'],externalId:string)=>{const value={ref,kind,externalId,name:kind==='member'?externalId:kind,available:true,safe:true,metadata:{},seenAt:new Date(now).toISOString()};resources.set(ref,value);return value};
  add(owner,'member','owner');add(other,'member','other');add(category,'category','category');add(creator,'voice','creator');add(waiting,'voice','waiting');add(channel,'voice','channel');
  const rooms:StoredRoom[]=[];const operations:StoredOperation[]=[];const accesses=new Map<string,Array<{memberRef:string;allowed:boolean;blocked:boolean;present:boolean}>>();
  const store={guildId:'guild',pool:{query:vi.fn(async()=>({rows:[],rowCount:0}))},settings:vi.fn(async()=>({settings,version:1,runtime:{ready:true,appliedVersion:1,syncedAt:new Date(now).toISOString(),problem:null}})),runtime:vi.fn(async()=>({ready:true})),setRuntime:vi.fn(async()=>{}),
    resource:vi.fn(async(ref:string,kind?:string)=>{const r=resources.get(ref);return r&&(!kind||r.kind===kind)?r:null}),resourceByExternal:vi.fn(async(kind:string,id:string)=>[...resources.values()].find(r=>r.kind===kind&&r.externalId===id)??null),storedResources:vi.fn(async(kind?:string)=>[...resources.values()].filter(r=>!kind||r.kind===kind)),
    upsertResource:vi.fn(async(kind:StoredResource['kind'],id:string,name:string,options:object={})=>{let r=[...resources.values()].find(r=>r.kind===kind&&r.externalId===id);if(!r)r=add(randomUUID(),kind,id);Object.assign(r,{name},options);return r}),
    listRooms:vi.fn(async(options?:{includeClosed?:boolean})=>rooms.filter(r=>options?.includeClosed||r.status!=='closed')),getRoom:vi.fn(async(ref:string)=>rooms.find(r=>r.ref===ref)??null),
    createRoom:vi.fn(async(ownerRef:string,name:string,options:object)=>{if(rooms.some(r=>r.ownerRef===ownerRef&&r.status!=='closed'))throw new CommunityStoreError(409,'room_exists','exists');const r={ref:randomUUID(),ownerRef,channelRef:null,name,status:'creating',visibility:'open',userLimit:0,version:1,transferToRef:null,transferExpiresAt:null,ownerLeftAt:null,emptySince:null,cleanupAt:null,metadata:{},createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),...options} as StoredRoom;rooms.push(r);return r}),
    patchRoom:vi.fn(async(ref:string,patch:object,version:number)=>{const r=rooms.find(r=>r.ref===ref)!;if(r.version!==version)throw new CommunityStoreError(409,'version_conflict','changed');Object.assign(r,patch,{version:r.version+1});return r}),
    roomAccess:vi.fn(async(ref:string)=>accesses.get(ref)??[]),setRoomAccess:vi.fn(async(ref:string,memberRef:string,patch:object)=>{const list=accesses.get(ref)??[];let a=list.find(a=>a.memberRef===memberRef);if(!a){a={memberRef,allowed:false,blocked:false,present:false};list.push(a)}Object.assign(a,patch);accesses.set(ref,list);return a}),
    enqueue:vi.fn(async(kind:string,roomRef:string|null,actor:StoredOperation['actor'],payload:StoredOperation['payload'],requestKey:string,expectedVersion?:number)=>{const existing=operations.find(o=>o.requestKey===requestKey);if(existing)return existing;const op={ref:randomUUID(),kind,roomRef,actor,payload,requestKey,expectedVersion:expectedVersion??null,status:'queued',claimToken:null,attempts:0,createdAt:new Date(now).toISOString(),finishedAt:null,error:null,result:null,expiresAt:new Date(now+300000).toISOString(),availableAt:new Date(now).toISOString(),errorCode:null} as StoredOperation;operations.push(op);return op}),
    recoverExpired:vi.fn(async()=>{}),claim:vi.fn(async()=>{const op=operations.find(o=>o.status==='queued');if(!op)return null;op.status='running';op.claimToken=randomUUID();return op}),renew:vi.fn(async()=>true),
    finish:vi.fn(async(ref:string,token:string,outcome:object)=>{const op=operations.find(o=>o.ref===ref)!;Object.assign(op,outcome);return true}),getOperation:vi.fn(async(ref:string)=>operations.find(o=>o.ref===ref)??null),resolveRecoveredOperation:vi.fn(async(ref:string,result:object)=>{Object.assign(operations.find(o=>o.ref===ref)!,{status:'succeeded',result});return true}),addAudit:vi.fn(async()=>{})} as unknown as CommunityStore;
  let present:string[]|null=['owner'];let position:string|null|undefined='creator';
  const discord={snapshot:vi.fn(async()=>({ready:true,guildName:'社区',selfId:'bot',resources:[...resources.values()].map(r=>({id:r.externalId,kind:r.kind,name:r.name,available:true,safe:true})),members:[{id:'owner',name:'owner',bot:false,protected:false,roleIds:[],joinedAt:null},{id:'other',name:'other',bot:false,protected:false,roleIds:[],joinedAt:null}]})),member:vi.fn(async(id:string)=>id==='gone'?null:{id,name:id,bot:false,protected:false,roleIds:[],joinedAt:null}),channel:vi.fn(async(id:string)=>({id,name:id,kind:id==='category'?'category':'voice',parentId:id==='category'?null:'category'})),canView:vi.fn(async()=>true),canConnect:vi.fn(async()=>true),occupants:vi.fn(()=>present),channelOf:vi.fn(()=>position),createVoice:vi.fn(async()=> 'channel'),findCreatedVoice:vi.fn(async()=>null),move:vi.fn(async()=>{}),rename:vi.fn(async()=>{}),setLimit:vi.fn(async()=>{}),setVisibility:vi.fn(async()=>{}),grant:vi.fn(async()=>{}),deny:vi.fn(async()=>{}),delete:vi.fn(async()=>{}),sendPanel:vi.fn(async()=> 'message')} as unknown as CommunityDiscord;
  const authorize=vi.fn(async(actor:StoredOperation['actor'])=>({memberRef:actor.memberRef??null,isAdmin:false}));
  const engine=new CommunityEngine(store,discord,{authorize,now:()=>now});
  const enqueue=(kind:string,roomRef:string|null=null,payload:StoredOperation['payload']={},expectedVersion?:number,actor:StoredOperation['actor']={source:'discord',memberRef:owner})=>store.enqueue(kind,roomRef,actor,payload,randomUUID(),expectedVersion);
  const room=async()=>{const r=await store.createRoom(owner,'小屋',{channelRef:channel,status:'active'} as never);r.status='active';return r};
  return {engine,store,discord,authorize,resources,rooms,operations,owner,other,category,creator,waiting,channel,settings,enqueue,room,setNow:(n:number)=>{now=n},now:()=>now,setPresent:(p:string[]|null)=>{present=p},setPosition:(p:string|null|undefined)=>{position=p}};
}

describe('community room execution and reconciliation',()=>{
  it('does not wait for a slow control card before creating a room',async()=>{const s=setup();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});const engine=new CommunityEngine(s.store,s.discord,{authorize:s.authorize,now:s.now,syncPanels:()=>pending});const work=engine.onVoice('owner','creator');try{await vi.waitFor(()=>expect(s.discord.createVoice).toHaveBeenCalled(),{timeout:100,interval:5});}finally{release();await work;}});
  it('returns an owner entering the creator to their existing active room without creating again',async()=>{const s=setup();const r=await s.room();await s.engine.onVoice('owner','creator');expect(s.discord.createVoice).not.toHaveBeenCalled();expect(s.discord.move).toHaveBeenCalledWith('owner','channel');expect(s.operations[0]).toMatchObject({kind:'room.join',roomRef:r.ref,payload:{creatorOnly:true}})});
  it('does not execute a delayed return after the owner leaves the creator',async()=>{const s=setup();const r=await s.room();s.setPosition('waiting');const op=await s.enqueue('room.join',r.ref,{creatorOnly:true},r.version);await s.engine.runOne();expect(op.status).toBe('conflict');expect(s.discord.move).not.toHaveBeenCalled()});
  it('does not return a former owner after the room has been transferred',async()=>{const s=setup();const r=await s.room();r.ownerRef=s.other;const op=await s.enqueue('room.join',r.ref,{creatorOnly:true},r.version);await s.engine.runOne();expect(op.status).toBe('failed');expect(s.discord.move).not.toHaveBeenCalled()});
  it('leaves an uncertain existing room alone when its owner enters the creator',async()=>{const s=setup();const r=await s.room();r.status='needs_review';await s.engine.onVoice('owner','creator');expect(s.discord.createVoice).not.toHaveBeenCalled();expect(s.discord.move).not.toHaveBeenCalled()});
  it('isolates panel refresh failure from successful creation',async()=>{const s=setup();const refresh=vi.fn(async()=>{throw new Error('panel unavailable')});const errors=vi.fn();const engine=new CommunityEngine(s.store,s.discord,{authorize:s.authorize,now:s.now,syncPanels:refresh,onError:errors});const op=await s.enqueue('room.create');await engine.runOne();expect(refresh).toHaveBeenCalled();expect(op.status).toBe('succeeded');expect(s.rooms[0].status).toBe('active');expect(s.discord.createVoice).toHaveBeenCalledTimes(1);await vi.waitFor(()=>expect(errors).toHaveBeenCalled())});
  it('persists a create intention before Discord and adopts only its returned managed channel',async()=>{const s=setup();const op=await s.enqueue('room.create');await s.engine.runOne();expect(op.status).toBe('succeeded');expect(s.rooms[0].status).toBe('active');expect(s.rooms[0].metadata.operationRef).toBe(op.ref);expect(s.discord.createVoice).toHaveBeenCalledWith('category','owner 的房间','owner','open',0,op.ref);expect(s.discord.move).toHaveBeenCalledWith('owner','channel')});
  it('requires live voice connection and current non-bot membership before creating',async()=>{const s=setup();s.setPosition(null);const op=await s.enqueue('room.create');await s.engine.runOne();expect(op.status).toBe('failed');expect(s.discord.createVoice).not.toHaveBeenCalled()});
  it('does not drag someone back when they leave during channel creation',async()=>{const s=setup();vi.mocked(s.discord.createVoice).mockImplementation(async()=>{s.setPosition(null);return 'channel'});await s.enqueue('room.create');await s.engine.runOne();expect(s.discord.move).not.toHaveBeenCalled();expect(s.rooms[0].status).toBe('active')});
  it('quarantines ambiguous creation and never retries it as a new create',async()=>{const s=setup();vi.mocked(s.discord.createVoice).mockRejectedValue(new CommunityDiscordError(503,'unknown',true));const op=await s.enqueue('room.create');await s.engine.runOne();expect(op.status).toBe('needs_review');expect(s.rooms[0].status).toBe('needs_review');await s.engine.sync();expect(s.discord.createVoice).toHaveBeenCalledTimes(1);expect(s.rooms[0].status).toBe('needs_review')});
  it('recovers a unique audit marker, but only within the configured managed category',async()=>{const s=setup();const op=await s.enqueue('room.create');op.status='needs_review';const room=await s.store.createRoom(s.owner,'小屋',{metadata:{operationRef:op.ref}});room.status='needs_review';vi.mocked(s.discord.findCreatedVoice).mockResolvedValue('channel');await s.engine.sync();expect(room.status).toBe('active');expect(op.status).toBe('succeeded');expect(s.discord.createVoice).not.toHaveBeenCalled()});
  it('does not destroy stale state or schedule cleanup from unavailable Gateway presence',async()=>{const s=setup();const room=await s.room();s.setPresent(null);await s.engine.tick();expect(room.emptySince).toBeNull();expect(s.discord.delete).not.toHaveBeenCalled()});
  it('rechecks queue identity after web rebinding and performs no Discord write',async()=>{const s=setup();const room=await s.room();s.authorize.mockResolvedValue({memberRef:s.other,isAdmin:false});const op=await s.enqueue('room.rename',room.ref,{name:'新名'},room.version,{source:'web',userId:'u',memberRef:s.owner});await s.engine.runOne();expect(op.status).toBe('conflict');expect(s.discord.rename).not.toHaveBeenCalled()});
  it('rejects stale room versions and old owners at execution time',async()=>{const s=setup();const room=await s.room();const op=await s.enqueue('room.rename',room.ref,{name:'新名'},0);await s.engine.runOne();expect(op.status).toBe('conflict');expect(s.discord.rename).not.toHaveBeenCalled()});
  it('fails closed when the claimed lease cannot be renewed',async()=>{const s=setup();vi.mocked(s.store.renew).mockResolvedValue(false);const op=await s.enqueue('room.create');await s.engine.runOne();expect(s.discord.createVoice).not.toHaveBeenCalled();expect(op.status).not.toBe('succeeded')});
  it('allows an accessible off-room member to receive a pending transfer, then requires acceptance',async()=>{const s=setup();const room=await s.room();let op=await s.enqueue('room.transfer',room.ref,{memberRef:s.other},room.version);await s.engine.runOne();expect(op.status).toBe('succeeded');expect(room.ownerRef).toBe(s.owner);expect(room.transferToRef).toBe(s.other);op=await s.enqueue('room.accept',room.ref,{},room.version,{source:'discord',memberRef:s.other});await s.engine.runOne();expect(op.status).toBe('succeeded');expect(room.ownerRef).toBe(s.other)});
  it('does not use a transfer invitation to expose a hidden room',async()=>{const s=setup();const room=await s.room();vi.mocked(s.discord.canView).mockResolvedValue(false);const op=await s.enqueue('room.transfer',room.ref,{memberRef:s.other},room.version);await s.engine.runOne();expect(op.status).toBe('failed');expect(room.transferToRef).toBeNull()});
  it('owner dissolve cannot delete an occupied room',async()=>{const s=setup();const room=await s.room();const op=await s.enqueue('room.dissolve',room.ref,{},room.version);await s.engine.runOne();expect(op.status).toBe('conflict');expect(s.discord.delete).not.toHaveBeenCalled()});
  it('admin force deletion stops if any waiting-room move fails',async()=>{const s=setup();const room=await s.room();s.authorize.mockResolvedValue({memberRef:s.owner,isAdmin:true});vi.mocked(s.discord.move).mockRejectedValue(new Error('move failed'));const op=await s.enqueue('room.admin_delete',room.ref,{confirm:true},room.version);await s.engine.runOne();expect(op.status).not.toBe('succeeded');expect(s.discord.delete).not.toHaveBeenCalled()});
  it('marks manually moved channels for review instead of editing or deleting them',async()=>{const s=setup();const room=await s.room();vi.mocked(s.discord.channel).mockResolvedValue({id:'channel',kind:'voice',name:'小屋',parentId:'elsewhere'});const op=await s.enqueue('room.rename',room.ref,{name:'新名'},room.version);await s.engine.runOne();expect(op.status).not.toBe('succeeded');expect(room.status).toBe('needs_review');expect(s.discord.rename).not.toHaveBeenCalled()});
  it('does not execute ordinary operations in maintenance mode',async()=>{const s=setup();const engine=new CommunityEngine(s.store,s.discord,{authorize:s.authorize,isReadOnly:()=>true});await s.enqueue('room.create');await engine.runOne();expect(s.discord.createVoice).not.toHaveBeenCalled()});
  it('stops further force-close effects if admin privileges are revoked mid-operation',async()=>{
    const s=setup();const room=await s.room();s.setPresent(['owner','other']);
    s.authorize.mockResolvedValue({memberRef:s.owner,isAdmin:true});
    vi.mocked(s.discord.move).mockImplementation(async()=>{s.authorize.mockResolvedValue({memberRef:s.owner,isAdmin:false});});
    const op=await s.enqueue('room.admin_delete',room.ref,{confirm:true},room.version);await s.engine.runOne();
    expect(s.discord.move).toHaveBeenCalledTimes(1);expect(s.discord.delete).not.toHaveBeenCalled();expect(op.status).toBe('needs_review');
  });
  it('marks an operation uncertain after a successful Discord change and a version failure',async()=>{
    const s=setup();const room=await s.room();vi.mocked(s.store.patchRoom).mockRejectedValue(new CommunityStoreError(409,'version_conflict','changed'));
    const op=await s.enqueue('room.rename',room.ref,{name:'新名'},room.version);await s.engine.runOne();expect(s.discord.rename).toHaveBeenCalled();expect(op.status).toBe('needs_review');
  });
  it('bumps the room version after member access changes',async()=>{
    const s=setup();const room=await s.room();const version=room.version;await s.enqueue('room.grant',room.ref,{memberRef:s.other},version);await s.engine.runOne();expect(room.version).toBeGreaterThan(version);
  });
  it('does not permanently reuse a failed voice-create event key',async()=>{
    const s=setup();s.resources.get(s.category)!.available=false;
    await s.engine.onVoice('owner','creator');expect(s.operations[0].status).toBe('failed');
    s.resources.get(s.category)!.available=true;await s.engine.onVoice('owner','creator');
    expect(s.discord.createVoice).toHaveBeenCalledTimes(1);expect(s.operations).toHaveLength(2);
  });
  it('joins a visible room only from an existing voice connection',async()=>{
    const s=setup();const room=await s.room();s.setPosition('creator');const op=await s.enqueue('room.join',room.ref,{},room.version,{source:'discord',memberRef:s.other});await s.engine.runOne();expect(op.status).toBe('succeeded');expect(s.discord.move).toHaveBeenCalledWith('other','channel');
  });

  it('preserves the bot-owned panel message marker across full snapshots',async()=>{
    const s=setup();s.resources.get(s.creator)!.metadata.panelMessageId='saved-panel';await s.engine.sync();expect(s.resources.get(s.creator)!.metadata.panelMessageId).toBe('saved-panel');
  });
  it('releases a room only after a fresh channel lookup proves manual deletion',async()=>{
    const s=setup();const room=await s.room();vi.mocked(s.discord.channel).mockResolvedValue(null);await s.engine.tick();expect(room.status).toBe('closed');expect(s.discord.delete).not.toHaveBeenCalled();
  });
  it('rechecks occupancy after permission reads and cancels deletion on a late rejoin',async()=>{
    const s=setup();const room=await s.room();s.setPresent([]);
    vi.mocked(s.discord.member).mockImplementation(async(id:string)=>{s.setPresent(['other']);return {id,name:id,bot:false,protected:false,roleIds:[],joinedAt:null};});
    const op=await s.enqueue('room.dissolve',room.ref,{},room.version);await s.engine.runOne();expect(op.status).not.toBe('succeeded');expect(s.discord.delete).not.toHaveBeenCalled();
  });

  it('does not move the creator after another administrator has closed the newly created room',async()=>{
    const s=setup();const original=vi.mocked(s.store.patchRoom).getMockImplementation()!;
    vi.mocked(s.store.patchRoom).mockImplementation(async(ref,patch,version)=>{const room=await original(ref,patch,version);if(patch.status==='active'){room.status='closed';room.version+=1;}return room;});
    const op=await s.enqueue('room.create');await s.engine.runOne();expect(s.discord.move).not.toHaveBeenCalled();expect(s.rooms[0].status).toBe('closed');expect(op.status).toBe('needs_review');
  });

  it('restores a reviewed tracked room from verified current access without replaying its old mutation',async()=>{
    const s=setup();const room=await s.room();room.status='needs_review';
    Object.assign(s.discord,{inspectRoom:vi.fn(async()=>({name:'实际名字',userLimit:6,visibility:'hidden',allowedMemberIds:['other'],blockedMemberIds:[]}))});
    await s.engine.sync();expect(room.status).toBe('active');expect(room.name).toBe('实际名字');expect(room.visibility).toBe('hidden');expect(s.discord.rename).not.toHaveBeenCalled();
    expect((await s.store.roomAccess(room.ref)).some(item=>item.memberRef===s.other&&item.allowed)).toBe(true);
  });
  it('does not restore a room whose old execution still awaits human review',async()=>{
    const s=setup();const room=await s.room();room.status='needs_review';
    Object.assign(s.discord,{inspectRoom:vi.fn(async()=>({name:'实际',userLimit:0,visibility:'open',allowedMemberIds:[],blockedMemberIds:[]}))});
    vi.mocked(s.store.pool.query).mockImplementation(async()=>({rows:[{ref:'pending'}],rowCount:1}) as never);
    await s.engine.sync();expect(room.status).toBe('needs_review');
  });
  it('starts a new empty-room grace after a gap instead of treating offline time as continuous emptiness',async()=>{
    const s=setup();const room=await s.room();room.emptySince=new Date(s.now()-600000).toISOString();room.cleanupAt=new Date(s.now()-480000).toISOString();s.setPresent([]);
    await s.engine.tick();expect(s.discord.delete).not.toHaveBeenCalled();expect(Date.parse(room.cleanupAt!)).toBeGreaterThan(s.now());
  });

  it('passes freshly checked administrator privileges to the extra executor',async()=>{
    const s=setup();const extra=vi.fn(async(_op:unknown,_actor:{isAdmin:boolean})=>({done:true}));
    let checks=0;s.authorize.mockImplementation(async actor=>({memberRef:actor.memberRef??null,isAdmin:checks++===0}));
    const engine=new CommunityEngine(s.store,s.discord,{authorize:s.authorize,executeExtra:extra,now:s.now});await s.enqueue('fun.close',null,{ref:s.other});await engine.runOne();expect(extra).toHaveBeenCalled();expect(extra.mock.calls[0][1].isAdmin).toBe(false);
  });

  it('keeps reviewed rooms quarantined when a member ACL cannot be fully mapped',async()=>{
    const s=setup();const room=await s.room();room.status='needs_review';
    Object.assign(s.discord,{inspectRoom:vi.fn(async()=>({name:'实际',userLimit:0,visibility:'hidden',allowedMemberIds:[],blockedMemberIds:['unknown-member']}))});
    await s.engine.sync();expect(room.status).toBe('needs_review');
  });

  it('keeps healthy periodic refreshes from transiently revoking the current member session',async()=>{
    const s=setup();await s.engine.sync();vi.mocked(s.store.setRuntime).mockClear();await s.engine.sync();
    expect(vi.mocked(s.store.setRuntime).mock.calls.some(([patch])=>patch.ready===false)).toBe(false);
  });

});
