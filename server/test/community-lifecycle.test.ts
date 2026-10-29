import {EventEmitter} from 'node:events';
import {Events,type Client} from 'discord.js';
import {describe,expect,it,vi} from 'vitest';
import {wireCommunity} from '../src/community/lifecycle';
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));};
function fixture(){const client=new EventEmitter();const engine={start:vi.fn(async()=>{}),sync:vi.fn(async()=>true),invalidateSnapshot:vi.fn(),onVoice:vi.fn(async()=>{})};const membership={welcome:vi.fn(async()=>{})};const unavailable=vi.fn(async()=>{});const removed=vi.fn(async()=>{});return {client,engine,membership,unavailable,removed,stop:wireCommunity(client as unknown as Client,{guildId:'guild',engine,membership,onUnavailable:unavailable,onMemberRemoved:removed})};}
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve};};
const drain=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
describe('community gateway lifecycle stays independent of evidence',()=>{
 it('ignores same-channel mute events and carries both sides of a real voice move',async()=>{
  const f=fixture();f.client.emit(Events.VoiceStateUpdate,{channelId:'voice'},{guild:{id:'guild'},id:'yes',channelId:'voice',selfMute:true});
  await drain();expect(f.engine.onVoice).not.toHaveBeenCalled();
  f.client.emit(Events.VoiceStateUpdate,{channelId:'voice'},{guild:{id:'guild'},id:'yes',channelId:null});await drain();
  expect(f.engine.onVoice).toHaveBeenCalledExactlyOnceWith('yes',null,'voice');f.stop();
 });
 it('coalesces a resource burst and admits only one follow-up census while the first is pending',async()=>{
  const f=fixture(),first=deferred<boolean>(),second=deferred<boolean>(),started=deferred<void>(),restarted=deferred<void>();
  f.engine.sync.mockImplementationOnce(()=>{started.resolve();return first.promise;}).mockImplementationOnce(()=>{restarted.resolve();return second.promise;});
  for(let index=0;index<20;index++)f.client.emit(Events.ChannelCreate,{guild:{id:'guild'}});
  await started.promise;expect(f.engine.sync).toHaveBeenCalledOnce();expect(f.unavailable).toHaveBeenCalledOnce();
  for(let index=0;index<20;index++)f.client.emit(Events.GuildRoleUpdate,{}, {guild:{id:'guild'}});
  await drain();expect(f.engine.sync).toHaveBeenCalledOnce();expect(f.unavailable).toHaveBeenCalledTimes(2);
  expect(f.engine.invalidateSnapshot).toHaveBeenCalled();
  first.resolve(true);await restarted.promise;expect(f.engine.sync).toHaveBeenCalledTimes(2);
  second.resolve(true);await drain();expect(f.engine.sync).toHaveBeenCalledTimes(2);f.stop();
 });
 it('invalidates a resource change before allowing its queued census to run',async()=>{
  const f=fixture(),invalidation=deferred<void>();f.unavailable.mockReturnValue(invalidation.promise);
  f.client.emit(Events.ChannelUpdate,{}, {guild:{id:'guild'}});await drain();
  expect(f.engine.invalidateSnapshot).toHaveBeenCalled();expect(f.unavailable).toHaveBeenCalledOnce();expect(f.engine.sync).not.toHaveBeenCalled();
  invalidation.resolve();await drain();expect(f.engine.sync).toHaveBeenCalledOnce();f.stop();
 });
 it('preserves a departure and a disconnect while a coalesced census is pending',async()=>{
  const f=fixture(),pending=deferred<boolean>(),started=deferred<void>();
  f.engine.sync.mockImplementationOnce(()=>{started.resolve();return pending.promise;});
  f.client.emit(Events.ChannelCreate,{guild:{id:'guild'}});await started.promise;
  f.client.emit(Events.GuildMemberRemove,{guild:{id:'guild'},id:'left'});f.client.emit(Events.ShardDisconnect);
  await drain();expect(f.removed).toHaveBeenCalledExactlyOnceWith('left');expect(f.unavailable).toHaveBeenCalledTimes(2);
  expect(f.engine.sync).toHaveBeenCalledOnce();pending.resolve(false);await drain();expect(f.engine.sync).toHaveBeenCalledTimes(2);f.stop();
 });
 it('does not welcome a joined member after shutdown during the shared census',async()=>{
  const f=fixture(),pending=deferred<boolean>(),started=deferred<void>();
  f.engine.sync.mockImplementationOnce(()=>{started.resolve();return pending.promise;});
  f.client.emit(Events.GuildMemberAdd,{guild:{id:'guild'},id:'new'});await started.promise;f.stop();pending.resolve(true);await drain();
  expect(f.membership.welcome).not.toHaveBeenCalled();
 });
 it('starts the census without welcoming the whole existing member list',async()=>{const f=fixture();f.client.emit(Events.ClientReady);await flush();expect(f.engine.start).toHaveBeenCalledOnce();expect(f.membership.welcome).not.toHaveBeenCalled();f.stop();});
 it('only welcomes a target-guild join after syncing current membership',async()=>{const f=fixture();f.client.emit(Events.GuildMemberAdd,{guild:{id:'other'},id:'no'});f.client.emit(Events.GuildMemberAdd,{guild:{id:'guild'},id:'yes'});await flush();expect(f.membership.welcome).toHaveBeenCalledExactlyOnceWith('yes');expect(f.engine.sync).toHaveBeenCalled();f.stop();});
 it('invalidates current authorization on departures and disconnects',async()=>{const f=fixture();f.client.emit(Events.GuildMemberRemove,{guild:{id:'guild'},id:'left'});f.client.emit(Events.ShardDisconnect);await flush();expect(f.removed).toHaveBeenCalledWith('left');expect(f.unavailable).toHaveBeenCalled();f.stop();});
 it('ignores unrelated voice events and unregisters all hooks on shutdown',async()=>{const f=fixture();f.client.emit(Events.VoiceStateUpdate,{}, {guild:{id:'guild'},id:'yes',channelId:'voice'});f.client.emit(Events.VoiceStateUpdate,{}, {guild:{id:'other'},id:'no',channelId:'voice'});await flush();expect(f.engine.onVoice).toHaveBeenCalledExactlyOnceWith('yes','voice',undefined);f.stop();f.client.emit(Events.ClientReady);expect(f.engine.start).not.toHaveBeenCalled();});
});
