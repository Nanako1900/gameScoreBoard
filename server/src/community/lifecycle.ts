import {Events,type Client,type Guild,type GuildMember,type PartialGuildMember,type VoiceState,type Role} from 'discord.js';
interface LifecycleDeps {
 guildId:string;
 engine:{start():Promise<void>;sync():Promise<boolean>;onVoice(memberId:string,channelId?:string|null):Promise<void>};
 membership:{welcome(memberId:string):Promise<void>};
 onUnavailable:()=>Promise<void>;
 onMemberRemoved:(memberId:string)=>Promise<void>;
 isReadOnly?:()=>boolean;
 onError?:(error:unknown)=>void;
}
/** Separate hooks/queue from the evidence recorder: community REST work never
 * delays the recorder's voice-state reconciliation or coverage heartbeat. */
export function wireCommunity(client:Client,deps:LifecycleDeps):()=>void {
 let active=true;
 const run=(work:()=>Promise<unknown>)=>{if(active)void Promise.resolve().then(()=>active?work():undefined).catch(error=>deps.onError?.(error));};
 const ready=()=>run(()=>deps.engine.start());
 const sync=()=>run(async()=>{await deps.onUnavailable();await deps.engine.sync();});
 const unavailable=()=>run(deps.onUnavailable);
 const available=(guild:Guild)=>{if(guild.id===deps.guildId&&guild.available)sync();};
 const voice=(_prev:VoiceState,next:VoiceState)=>{if(next.guild.id===deps.guildId)run(()=>deps.engine.onVoice(next.id,next.channelId));};
 const join=(member:GuildMember)=>{if(member.guild.id===deps.guildId&&!deps.isReadOnly?.())run(async()=>{await deps.engine.sync();if(active)await deps.membership.welcome(member.id);});};
 const leave=(member:GuildMember|PartialGuildMember)=>{if(member.guild.id===deps.guildId)run(async()=>{await deps.onUnavailable();await deps.onMemberRemoved(member.id);await deps.engine.sync();});};
 const memberUpdate=(_prev:GuildMember|PartialGuildMember,next:GuildMember)=>{if(next.guild.id===deps.guildId)sync();};
 const channel=(value:unknown)=>{const channel=value as {guild?:{id:string}}|null;if(channel?.guild?.id===deps.guildId)sync();};
 const channelUpdate=(_prev:unknown,next:unknown)=>channel(next);
 const role=(role:Role)=>{if(role.guild.id===deps.guildId)sync();};
 const roleUpdate=(_prev:unknown,next:Role)=>role(next);
 client.once(Events.ClientReady,ready);client.on(Events.GuildAvailable,available);client.on(Events.ShardResume,sync);client.on(Events.ShardDisconnect,unavailable);client.on(Events.ShardReconnecting,unavailable);
 client.on(Events.VoiceStateUpdate,voice);client.on(Events.GuildMemberAdd,join);client.on(Events.GuildMemberRemove,leave);client.on(Events.GuildMemberUpdate,memberUpdate);
 client.on(Events.ChannelCreate,channel);client.on(Events.ChannelDelete,channel);client.on(Events.ChannelUpdate,channelUpdate);
 client.on(Events.GuildRoleCreate,role);client.on(Events.GuildRoleDelete,role);client.on(Events.GuildRoleUpdate,roleUpdate);
 return ()=>{active=false;
  client.off(Events.ClientReady,ready);client.off(Events.GuildAvailable,available);client.off(Events.ShardResume,sync);client.off(Events.ShardDisconnect,unavailable);client.off(Events.ShardReconnecting,unavailable);
  client.off(Events.VoiceStateUpdate,voice);client.off(Events.GuildMemberAdd,join);client.off(Events.GuildMemberRemove,leave);client.off(Events.GuildMemberUpdate,memberUpdate);
  client.off(Events.ChannelCreate,channel);client.off(Events.ChannelDelete,channel);client.off(Events.ChannelUpdate,channelUpdate);
  client.off(Events.GuildRoleCreate,role);client.off(Events.GuildRoleDelete,role);client.off(Events.GuildRoleUpdate,roleUpdate);
 };
}
