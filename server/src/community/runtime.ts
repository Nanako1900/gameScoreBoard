import type {Client,Interaction} from 'discord.js';
import type pg from 'pg';
import type {Env} from '../../../worker/types';
import {resetOffsetHours} from '../../../worker/time';
import {CommunityStore} from './store';
import {CommunityService} from './service';
import {CommunityMembershipService} from './membership';
import {CommunityFunService} from './fun-service';
import {createCommunityDiscord} from './discord';
import {CommunityEngine} from './engine';
import {CommunityRoomPanels} from './room-panels';
import {executeCommunityExtra} from './extra';
import {wireCommunity} from './lifecycle';
import {COMMUNITY_COMMANDS} from './commands';
import {handleCommunityInteraction} from './interactions';
export function createCommunityRuntime(options:{pool:pg.Pool;db:D1Database;client:Client;guildId:string;frontendUrl:string;env:Env;isReadOnly:()=>boolean;onError:(error:unknown)=>void}) {
 const {pool,db,client,guildId,env}=options;
 const store=new CommunityStore(pool,guildId);const service=new CommunityService(store,db);const discord=createCommunityDiscord(client,guildId);
 const membership=new CommunityMembershipService(store,discord);
 const fun=new CommunityFunService(store,{db,env,offsetHours:resetOffsetHours(env.RESET_TZ_OFFSET)});
 const panels=new CommunityRoomPanels(store,discord,{isReadOnly:options.isReadOnly,onError:options.onError});
 const engine=new CommunityEngine(store,discord,{authorize:actor=>service.actorForExecution(actor),isReadOnly:options.isReadOnly,onError:options.onError,
  syncPanels:()=>panels.sync(),
  executeExtra:(op,actor,guard)=>executeCommunityExtra({membership,fun},op,actor,guard)});
 const unwire=wireCommunity(client,{guildId,engine,membership,isReadOnly:options.isReadOnly,onError:options.onError,
  onUnavailable:()=>store.setRuntime({ready:false,problem:'bot_offline'}),
  onMemberRemoved:async memberId=>{const resource=await store.resourceByExternal('member',memberId);if(resource)await store.upsertResource('member',memberId,resource.name,{available:false,metadata:resource.metadata});}});
 return {
  accepts(interaction:Interaction):boolean {
   return interaction.isChatInputCommand()?COMMUNITY_COMMANDS.some(command=>command.name===interaction.commandName)
    :'customId' in interaction&&interaction.customId.startsWith('v1:community:');
  },
  async handle(interaction:Interaction):Promise<void>{await handleCommunityInteraction(interaction,{guildId,frontendUrl:options.frontendUrl,service,discord,membership,fun,wake:()=>engine.tick()});},
  async stop(){unwire();await engine.stop();},
 };
}
