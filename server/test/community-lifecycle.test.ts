import {EventEmitter} from 'node:events';
import {Events,type Client} from 'discord.js';
import {describe,expect,it,vi} from 'vitest';
import {wireCommunity} from '../src/community/lifecycle';
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));};
function fixture(){const client=new EventEmitter();const engine={start:vi.fn(async()=>{}),sync:vi.fn(async()=>true),onVoice:vi.fn(async()=>{})};const membership={welcome:vi.fn(async()=>{})};const unavailable=vi.fn(async()=>{});const removed=vi.fn(async()=>{});return {client,engine,membership,unavailable,removed,stop:wireCommunity(client as unknown as Client,{guildId:'guild',engine,membership,onUnavailable:unavailable,onMemberRemoved:removed})};}
describe('community gateway lifecycle stays independent of evidence',()=>{
 it('starts the census without welcoming the whole existing member list',async()=>{const f=fixture();f.client.emit(Events.ClientReady);await flush();expect(f.engine.start).toHaveBeenCalledOnce();expect(f.membership.welcome).not.toHaveBeenCalled();f.stop();});
 it('only welcomes a target-guild join after syncing current membership',async()=>{const f=fixture();f.client.emit(Events.GuildMemberAdd,{guild:{id:'other'},id:'no'});f.client.emit(Events.GuildMemberAdd,{guild:{id:'guild'},id:'yes'});await flush();expect(f.membership.welcome).toHaveBeenCalledExactlyOnceWith('yes');expect(f.engine.sync).toHaveBeenCalled();f.stop();});
 it('invalidates current authorization on departures and disconnects',async()=>{const f=fixture();f.client.emit(Events.GuildMemberRemove,{guild:{id:'guild'},id:'left'});f.client.emit(Events.ShardDisconnect);await flush();expect(f.removed).toHaveBeenCalledWith('left');expect(f.unavailable).toHaveBeenCalled();f.stop();});
 it('ignores unrelated voice events and unregisters all hooks on shutdown',async()=>{const f=fixture();f.client.emit(Events.VoiceStateUpdate,{}, {guild:{id:'guild'},id:'yes',channelId:'voice'});f.client.emit(Events.VoiceStateUpdate,{}, {guild:{id:'other'},id:'no',channelId:'voice'});await flush();expect(f.engine.onVoice).toHaveBeenCalledExactlyOnceWith('yes','voice');f.stop();f.client.emit(Events.ClientReady);expect(f.engine.start).not.toHaveBeenCalled();});
});
