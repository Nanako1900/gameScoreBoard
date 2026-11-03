import { randomUUID } from 'node:crypto';
import { MessageFlags, type Interaction } from 'discord.js';
import { vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import type { StoredRoom, StoredOperation } from '../src/community/store';
import { type CommunityInteractionDependencies } from '../src/community/interactions';

export const memberRef=randomUUID(),roomRef=randomUUID(),funRef=randomUUID(),roleRef=randomUUID();
export function setup(kind:'command'|'button'|'select'|'user-select'|'modal'='command',name='room',source:'private'|'shared'|'none'=kind==='command'?'none':'shared'){
 const sourceMessage=source==='none'?null:{id:'source',flags:{has:(flag:number)=>flag===MessageFlags.Ephemeral&&source==='private'}};
 const getString=vi.fn(()=>null),getInteger=vi.fn(()=>null),getUser=vi.fn(()=>null),getTextInputValue=vi.fn(()=> '新的名字');
 const input={id:'interaction-'+randomUUID(),guildId:'guild',user:{id:'user'},commandName:name,customId:name,message:sourceMessage,values:[] as string[],deferred:false,replied:false,ephemeral:false,
  isChatInputCommand:()=>kind==='command',isButton:()=>kind==='button',isStringSelectMenu:()=>kind==='select',isUserSelectMenu:()=>kind==='user-select',isMessageComponent:()=>['button','select','user-select'].includes(kind),isFromMessage:()=>kind==='modal'&&source!=='none',isModalSubmit:()=>kind==='modal',isRepliable:()=>true,
  options:{getString,getInteger,getUser},fields:{getTextInputValue},
  reply:vi.fn(async()=>{input.replied=true}),deferReply:vi.fn(async()=>{input.deferred=true}),editReply:vi.fn(async(_out?:unknown)=>{}),deferUpdate:vi.fn(async()=>{input.deferred=true}),update:vi.fn(async(_out?:unknown)=>{input.replied=true}),followUp:vi.fn(async(_out?:unknown)=>{}),showModal:vi.fn(async()=>{})};
 const room:StoredRoom={ref:roomRef,name:'小屋',ownerRef:memberRef,channelRef:randomUUID(),status:'active',metadata:{},visibility:'open',version:2,userLimit:0,transferToRef:null,ownerLeftAt:null,transferExpiresAt:null,emptySince:null,cleanupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 const op={ref:randomUUID(),kind:'room.rename',status:'queued',roomRef,actor:{source:'discord',memberRef},result:null,error:null} as StoredOperation;
 const settings=defaultCommunitySettings();settings.enabled=true;settings.roles.enabled=true;
 const store={settings:vi.fn(async()=>({settings})),listRooms:vi.fn(async()=>[room]),getRoom:vi.fn(async()=>room),roomAccess:vi.fn(async()=>[]),resource:vi.fn(async(ref:string)=>({ref,kind:'voice',externalId:'channel',available:true,name:'小屋'})),resourceByExternal:vi.fn(async()=>({ref:memberRef,externalId:'user',available:true,metadata:{bot:false}})),getOperation:vi.fn(async():Promise<StoredOperation|null>=>op),upsertResource:vi.fn(async()=>({ref:memberRef}))};
 const legacyFun={get:vi.fn(async()=>{throw new Error('retired fun read')}),list:vi.fn(async()=>{throw new Error('retired fun list')})};
 const wait=vi.fn(async(_ms:number)=>{});
 const deps={operationPolling:{wait},guildId:'guild',frontendUrl:'https://example.test',service:{store,actorFromDiscord:vi.fn(async()=>({memberRef,isAdmin:false,memberAvailable:true,linked:false})),enqueueForActor:vi.fn(async()=>op)},discord:{member:vi.fn(async()=>({id:'user',name:'普通成员',bot:false,protected:false,roleIds:[],joinedAt:null})),canView:vi.fn(async()=>true),channelOf:vi.fn(()=> 'channel'),occupants:vi.fn(()=> ['user'])},membership:{readRoles:vi.fn(async()=>({choices:[{ref:roleRef,name:'游戏',available:true,safe:true}],selectedRefs:[],maxChoices:5,enabled:true}))},fun:legacyFun,wake:vi.fn(async()=>{})} as unknown as CommunityInteractionDependencies;
 return{legacyFun,wait,room,input,interaction:input as unknown as Interaction,deps,store,op,getString,getInteger,getUser,getTextInputValue};
}
