import { EventEmitter } from 'node:events';
import { ChannelType, Events, type Client, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { defaultAgentSettings } from '../../shared/community-agent';
import type { AiConfig } from '../../worker/ai/config';
import { AgentDiscordError, type AgentDiscord } from '../src/community/agent-discord';
import { createCommunityAgentRuntime, type AgentRuntimeStore } from '../src/community/agent-runtime';

const G='1114391825336250432',BOT='222222222222222222',USER='333333333333333333',CHANNEL='444444444444444444',MESSAGE='555555555555555555',REPLY='555555555555555556';
const DOC={ref:'guide',title:'房间指南',content:'房间从创建入口加入',version:2,updatedAt:'2026-11-03T00:00:00Z',published:true};
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}};
const message=(content=`<@${BOT}> 房间怎么用`,id=MESSAGE)=>({id,guildId:G,channelId:CHANNEL,channel:{type:ChannelType.GuildText},author:{id:USER,bot:false},webhookId:null,system:false,content}) as unknown as Message;
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function setup() {
  const settings={...defaultAgentSettings(),enabled:true};let sequence=0;
  const claim=(ref:string)=>({ref,claimToken:'lease-'+ref,discordUserId:USER,channelId:CHANNEL,messageId:MESSAGE,userId:'nanako',bindingId:'generation',settingsVersion:1,knowledgeVersion:2,settings,documents:[DOC]});
  const beforeWrite=vi.fn(async()=>{});
  const finish=vi.fn(async()=>{}),check=vi.fn(async()=>true),guard=vi.fn(async(_key:unknown,work:(beforeWrite:()=>Promise<void>)=>Promise<unknown>)=>{
    try{return{kind:'delivered',value:await work(beforeWrite)}}catch(error){const e=error as {uncertain?:boolean;code?:string};return{kind:e.uncertain===false?['authorization_changed','lease_expired'].includes(e.code??'')?'canceled':'failed':'isolated'}}
  });
  const store={allowsChannel:vi.fn(async()=>true),reserve:vi.fn(async()=>({kind:'accepted',request:{ref:'request-'+(++sequence)}})),claim:vi.fn(async(ref:string)=>claim(ref)),check,
    withDeliveryGuard:guard,withChannelGuard:vi.fn(async(_channel:string,work:(beforeWrite:()=>Promise<void>)=>Promise<unknown>)=>({kind:'delivered',value:await work(beforeWrite)})),finish,recoverExpired:vi.fn(async()=>{})};
  const discord={authorize:vi.fn(async()=>true),send:vi.fn(async()=>({id:REPLY})),edit:vi.fn(async()=>{}),remove:vi.fn(async()=>{})};
  const answer=vi.fn(async(_input:{signal?:AbortSignal})=>({answer:'从创建入口进入房间。',sourceRefs:['guide'],insufficient:false}));
  const config={enabled:false,configuredEnabled:false,baseUrl:'https://provider.example/v1',model:'agent-model',apiKey:'secret-key',apiKeyError:null,promptVersion:'judicial-version'} as AiConfig;
  const loadConfig=vi.fn(async()=>config),selectSources=vi.fn(()=>[DOC]);const onError=vi.fn();
  const client=Object.assign(new EventEmitter(),{user:{id:BOT},isReady:()=>true}) as unknown as Client;
  const runtime=createCommunityAgentRuntime({pool:{} as never,db:{} as never,client,guildId:G,frontendUrl:'https://community.example',env:{} as never,isReadOnly:()=>false,onError,
    dependencies:{store:store as unknown as AgentRuntimeStore,discord:discord as AgentDiscord,answer,selectSources,loadConfig}});
  return{runtime,store,discord,answer,loadConfig,selectSources,finish,check,guard,onError,config,client,beforeWrite};
}

describe('community agent runtime',()=>{
  it('ignores other channels and ordinary chat without reading member data or reserving quota',async()=>{
    const s=setup();await s.runtime.handle(message('普通聊天'));s.store.allowsChannel.mockResolvedValue(false);await s.runtime.handle(message());
    expect(s.discord.authorize).not.toHaveBeenCalled();expect(s.store.reserve).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('only sends the fixed binding guide for unbound callers and spends no model call',async()=>{
    const s=setup();s.store.reserve.mockResolvedValue({kind:'unbound'} as never);await s.runtime.handle(message());
    expect(s.discord.send).toHaveBeenCalledWith(CHANNEL,expect.stringContaining('/link'),MESSAGE);expect(s.answer).not.toHaveBeenCalled();expect(s.store.claim).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('prompts for an explicit question without reserving quota for empty, URL-only or excessive text',async()=>{
    const s=setup();await s.runtime.handle(message(`<@${BOT}> https://example.org`));await s.runtime.handle(message(`<@${BOT}> ${'字'.repeat(2001)}`));
    expect(s.store.reserve).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();expect(s.discord.send).toHaveBeenCalledTimes(2);await s.runtime.stop();
  });
  it('sends one progress reply, then edits that exact message with trusted source titles',async()=>{
    const s=setup();await s.runtime.handle(message());
    expect(s.discord.send).toHaveBeenCalledTimes(1);expect(s.discord.edit).toHaveBeenCalledWith(CHANNEL,REPLY,'从创建入口进入房间。\n\n来源：房间指南（v2）');
    expect(s.guard).toHaveBeenCalledTimes(2);expect(s.check).toHaveBeenCalled();expect(s.discord.authorize.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(s.finish).toHaveBeenLastCalledWith('request-1','lease-request-1',expect.objectContaining({status:'succeeded'}));await s.runtime.stop();
  });
  it('does not duplicate a message that was already admitted',async()=>{
    const s=setup();s.store.reserve.mockResolvedValue({kind:'duplicate'} as never);await s.runtime.handle(message());expect(s.discord.send).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('does not generate another POST after the reservation guard cancels the first response',async()=>{
    const s=setup();s.guard.mockResolvedValueOnce({kind:'canceled'} as never);await s.runtime.handle(message());expect(s.discord.send).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('clears known progress if the final write guard rejects a completed answer',async()=>{
    const s=setup();s.guard.mockImplementationOnce(async(_claim,work)=>({kind:'delivered',value:await work(s.beforeWrite)})).mockResolvedValueOnce({kind:'canceled'} as never);await s.runtime.handle(message());
    expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledWith(CHANNEL,REPLY);await s.runtime.stop();
  });
  it.each(['rate_limited','busy'] as const)('uses a fixed %s notice without claiming work',async kind=>{
    const s=setup();s.store.reserve.mockResolvedValue({kind} as never);await s.runtime.handle(message());expect(s.store.claim).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();expect(s.discord.send).toHaveBeenCalledTimes(1);await s.runtime.stop();
  });
  it('does not call the provider or load credentials when retrieval has no public sources',async()=>{
    const s=setup();s.selectSources.mockReturnValue([]);await s.runtime.handle(message());expect(s.loadConfig).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();
    expect(s.discord.edit).toHaveBeenCalledWith(CHANNEL,REPLY,expect.stringContaining('没有足够信息'));await s.runtime.stop();
  });
  it('runs its own worker serially instead of calling two models at once',async()=>{
    const s=setup(),started=deferred<void>(),release=deferred<{answer:string;sourceRefs:string[];insufficient:boolean}>();
    s.answer.mockImplementationOnce(async()=>{started.resolve();return release.promise});const first=s.runtime.handle(message());await started.promise;const second=s.runtime.handle(message(`<@${BOT}> 房间怎么用`,'555555555555555557'));await flush();
    expect(s.answer).toHaveBeenCalledTimes(1);expect(s.store.claim).toHaveBeenCalledTimes(1);release.resolve({answer:'好',sourceRefs:['guide'],insufficient:false});await Promise.all([first,second]);expect(s.answer).toHaveBeenCalledTimes(2);await s.runtime.stop();
  });
  it('cancels a changed binding or library before calling the model and clears known progress',async()=>{
    const s=setup();s.check.mockResolvedValue(false);await s.runtime.handle(message());expect(s.answer).not.toHaveBeenCalled();expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledWith(CHANNEL,REPLY);await s.runtime.stop();
  });
  it('rechecks membership after the progress acknowledgement and cancels before the model',async()=>{
    const s=setup();s.discord.authorize.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);await s.runtime.handle(message());
    expect(s.answer).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledWith(CHANNEL,REPLY);await s.runtime.stop();
  });
  it('discards the old answer when authorization changes while the model is in flight',async()=>{
    const s=setup();s.answer.mockImplementationOnce(async()=>{s.check.mockResolvedValue(false);return{answer:'old answer',sourceRefs:['guide'],insufficient:false}});await s.runtime.handle(message());
    expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledWith(CHANNEL,REPLY);expect(s.finish).toHaveBeenLastCalledWith('request-1','lease-request-1',expect.objectContaining({status:'canceled'}));await s.runtime.stop();
  });
  it('never replays an uncertain first POST or invokes the model after losing its acknowledgement',async()=>{
    const s=setup();s.discord.send.mockRejectedValue(new AgentDiscordError('discord_error',true));await s.runtime.handle(message());expect(s.discord.send).toHaveBeenCalledTimes(1);expect(s.discord.edit).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('does not rebuild a response removed before the final PATCH',async()=>{
    const s=setup();s.discord.edit.mockRejectedValue(new AgentDiscordError('not_found',false));await s.runtime.handle(message());expect(s.discord.send).toHaveBeenCalledTimes(1);expect(s.discord.edit).toHaveBeenCalledTimes(1);expect(s.finish).toHaveBeenLastCalledWith('request-1','lease-request-1',expect.objectContaining({status:'failed'}));await s.runtime.stop();
  });
  it('uses a fixed public failure text and never leaks provider diagnostics',async()=>{
    const s=setup();s.answer.mockRejectedValue(new Error('secret-key upstream sensitive body'));await s.runtime.handle(message());
    expect(s.discord.edit).toHaveBeenCalledWith(CHANNEL,REPLY,'暂时无法回答，请稍后再试。');expect(JSON.stringify(s.onError.mock.calls)).not.toContain('secret-key');await s.runtime.stop();
  });
  it('preserves citations for emoji-heavy answers and scrubs the active credential from trusted titles',async()=>{
    const s=setup();s.selectSources.mockReturnValue([{...DOC,title:'secret-\u0001key 房间指南'}]);s.answer.mockResolvedValue({answer:'😀'.repeat(1200),sourceRefs:['guide'],insufficient:false});await s.runtime.handle(message());
    const content=(s.discord.edit.mock.calls[0] as unknown as [string,string,string])[2];expect(content.length).toBeLessThanOrEqual(1950);expect(content).toContain('来源：');expect(content).not.toContain('secret-key');await s.runtime.stop();
  });
  it('does not write if the final lease check fails after live authorization',async()=>{
    const s=setup();s.beforeWrite.mockRejectedValue(new Error('lease expired'));await s.runtime.handle(message());expect(s.discord.send).not.toHaveBeenCalled();expect(s.answer).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('stop aborts and awaits the active task without publishing a late answer',async()=>{
    const s=setup(),started=deferred<void>();s.answer.mockImplementationOnce(async({signal})=>{started.resolve();return new Promise<never>((_,reject)=>signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
    const work=s.runtime.handle(message());await started.promise;await s.runtime.stop();await work;expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledWith(CHANNEL,REPLY);await s.runtime.handle(message());expect(s.discord.send).toHaveBeenCalledTimes(1);
  });
  it('stop cancels the in-memory waiting question and does not start its model',async()=>{
    const s=setup(),started=deferred<void>();s.answer.mockImplementationOnce(async({signal})=>{started.resolve();return new Promise<never>((_,reject)=>signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))});
    const first=s.runtime.handle(message());await started.promise;const second=s.runtime.handle(message(`<@${BOT}> 房间怎么用`,'555555555555555557'));await flush();await s.runtime.stop();await Promise.all([first,second]);expect(s.answer).toHaveBeenCalledTimes(1);expect(s.discord.send).toHaveBeenCalledTimes(1);
  });
  it('recovers abandoned metadata once without replaying questions',async()=>{
    const s=setup();expect(s.store.recoverExpired).not.toHaveBeenCalled();(s.client as unknown as EventEmitter).emit(Events.ClientReady,s.client);await flush();await s.runtime.handle(message('普通聊天'));expect(s.store.recoverExpired).toHaveBeenCalledTimes(1);expect(s.store.claim).not.toHaveBeenCalled();await s.runtime.stop();
  });
  it('accepts a later request after a temporary startup database failure',async()=>{
    const s=setup();s.store.recoverExpired.mockRejectedValueOnce(new Error('temporary database failure'));(s.client as unknown as EventEmitter).emit(Events.ClientReady,s.client);await flush();await s.runtime.handle(message());
    expect(s.store.recoverExpired).toHaveBeenCalledTimes(2);expect(s.answer).toHaveBeenCalledTimes(1);expect(s.discord.edit).toHaveBeenCalledTimes(1);await s.runtime.stop();
  });
  it('maintains metadata retention without traffic and stops that timer on shutdown',async()=>{
    vi.useFakeTimers();
    try {
      const s=setup();(s.client as unknown as EventEmitter).emit(Events.ClientReady,s.client);await flush();await vi.advanceTimersByTimeAsync(3_600_000);
      expect(s.store.recoverExpired).toHaveBeenCalledTimes(2);expect(s.store.claim).not.toHaveBeenCalled();await s.runtime.stop();await vi.advanceTimersByTimeAsync(3_600_000);expect(s.store.recoverExpired).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
});
