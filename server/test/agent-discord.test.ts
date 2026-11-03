import { ChannelType, PermissionFlagsBits as P, Routes, type Client, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AgentDiscordError, createAgentDiscord, createAgentRest, extractAgentQuestion } from '../src/community/agent-discord';

const G='1114391825336250432', BOT='222222222222222222', USER='333333333333333333', TEXT='444444444444444444', MESSAGE='555555555555555555';
const ROLE='666666666666666666';
const BASE=P.ViewChannel|P.SendMessages|P.ReadMessageHistory;
function incoming(overrides:object={}) { return {id:MESSAGE,guildId:G,channelId:TEXT,channel:{type:ChannelType.GuildText},author:{id:USER,bot:false},webhookId:null,system:false,content:`<@${BOT}> 怎么使用社区房间？`,...overrides} as unknown as Message; }
function setup() {
  const roles=[{id:G,permissions:BASE.toString()},{id:ROLE,permissions:'0'}];
  const members=new Map([[BOT,{user:{id:BOT,bot:true},roles:[]}],[USER,{user:{id:USER,bot:false},roles:[ROLE]}]]);
  const channel={id:TEXT,guild_id:G,type:ChannelType.GuildText,permission_overwrites:[] as {id:string;type:number;allow:string;deny:string}[]};
  const get=vi.fn(async(path:string)=>{
    if(path===Routes.guild(G))return{id:G,owner_id:'999999999999999999'};
    if(path===Routes.guildRoles(G))return roles;
    if(path===Routes.channel(TEXT))return channel;
    const member=members.get(path.split('/').at(-1)!);if(member)return member;throw{status:404};
  });
  const post=vi.fn(async(_path:string,_options?:object)=>({id:MESSAGE})),patch=vi.fn(async()=>({})),remove=vi.fn(async()=>({}));
  const client={user:{id:BOT},isReady:()=>true,guilds:{cache:new Map([[G,{available:true}]])},rest:{get,post,patch,delete:remove}} as unknown as Client;
  return{api:createAgentDiscord(client,G,{rest:client.rest}),client,get,post,patch,remove,roles,members,channel};
}

describe('agent message admission',()=>{
  it('accepts only a literal direct mention and removes bot mentions and URL fragments',()=>{
    expect(extractAgentQuestion(incoming({content:`<@!${BOT}> 房间怎么用 https://example.org/private`}),G,BOT)).toEqual({discordUserId:USER,channelId:TEXT,messageId:MESSAGE,question:'房间怎么用'});
    expect(extractAgentQuestion(incoming({content:'普通聊天',mentions:{has:()=>true}}),G,BOT)).toBeNull();
    expect(extractAgentQuestion(incoming({content:`<@&${BOT}> 帮忙`}),G,BOT)).toBeNull();
  });
  it.each([{guildId:'999999999999999999'},{channel:{type:ChannelType.PublicThread}},{channel:{type:ChannelType.GuildAnnouncement}},{author:{id:USER,bot:true}},{webhookId:MESSAGE},{system:true}])('ignores unrelated or automated messages %j',overrides=>{
    expect(extractAgentQuestion(incoming(overrides),G,BOT)).toBeNull();
  });
  it('keeps only explicit text without reading attachment data and represents an empty question',()=>{
    const attachment=Object.defineProperty({},'url',{get(){throw new Error('must not inspect attachments')}});
    expect(extractAgentQuestion(incoming({attachments:[attachment],content:`<@${BOT}> https://example.org`}),G,BOT)?.question).toBe('');
    expect(extractAgentQuestion(incoming({content:`<@${BOT}> <https://example.org>`}),G,BOT)?.question).toBe('');
    expect(extractAgentQuestion(incoming({attachments:[attachment],content:`<@${BOT}> 附图之外，怎么查资料？`}),G,BOT)?.question).toBe('附图之外，怎么查资料？');
  });
});

describe('agent Discord adapter',()=>{
  it('reads membership and effective permissions through REST and rejects departure',async()=>{
    const s=setup();expect(await s.api.authorize(USER,TEXT)).toBe(true);s.members.delete(USER);expect(await s.api.authorize(USER,TEXT)).toBe(false);
    expect(s.get).toHaveBeenCalledWith(Routes.guildMember(G,USER),expect.objectContaining({signal:expect.any(AbortSignal)}));
  });
  it('requires a standard guild text channel and both member and bot access',async()=>{
    const s=setup();s.channel.type=ChannelType.GuildAnnouncement;expect(await s.api.authorize(USER,TEXT)).toBe(false);
    s.channel.type=ChannelType.GuildText;s.channel.permission_overwrites=[{id:USER,type:1,allow:'0',deny:P.ViewChannel.toString()}];expect(await s.api.authorize(USER,TEXT)).toBe(false);
    s.channel.permission_overwrites=[{id:BOT,type:1,allow:'0',deny:P.SendMessages.toString()}];expect(await s.api.authorize(USER,TEXT)).toBe(false);
  });
  it('applies role and member overrides using fresh roles rather than cached permissions',async()=>{
    const s=setup();s.channel.permission_overwrites=[{id:G,type:0,allow:'0',deny:P.ViewChannel.toString()},{id:ROLE,type:0,allow:P.ViewChannel.toString(),deny:'0'},{id:BOT,type:1,allow:P.ViewChannel.toString(),deny:'0'}];
    expect(await s.api.authorize(USER,TEXT)).toBe(true);s.members.get(USER)!.roles=[];expect(await s.api.authorize(USER,TEXT)).toBe(false);
  });
  it('sends and edits the known response with all mentions disabled and stripped',async()=>{
    const s=setup();expect(await s.api.send(TEXT,`hello @everyone <@${USER}>`,MESSAGE)).toEqual({id:MESSAGE});await s.api.edit(TEXT,MESSAGE,'@here answer');
    expect(s.post).toHaveBeenCalledWith(Routes.channelMessages(TEXT),expect.objectContaining({body:{content:'hello [已隐藏] [已隐藏]',allowed_mentions:{parse:[],replied_user:false},message_reference:{message_id:MESSAGE,fail_if_not_exists:true},nonce:`qa:${MESSAGE}`,enforce_nonce:true}}));
    expect(s.patch).toHaveBeenCalledWith(Routes.channelMessage(TEXT,MESSAGE),expect.objectContaining({body:{content:'[已隐藏] answer',allowed_mentions:{parse:[],replied_user:false}}}));
  });
  it('classifies an unknown POST acknowledgement and a known missing response without exposing details',async()=>{
    const s=setup();s.post.mockRejectedValue(new Error('secret-key body'));await expect(s.api.send(TEXT,'progress',MESSAGE)).rejects.toMatchObject({uncertain:true,code:'discord_error',message:'discord_error'});
    s.patch.mockRejectedValue({status:404,code:10008});await expect(s.api.edit(TEXT,MESSAGE,'answer')).rejects.toMatchObject({uncertain:false,code:'not_found'});
    s.post.mockResolvedValue({id:'bad'});await expect(s.api.send(TEXT,'progress',MESSAGE)).rejects.toBeInstanceOf(AgentDiscordError);
  });
  it('uses a dedicated transport with zero unknown-write retries and no sweep timers',async()=>{
    const request=vi.fn(async()=>new Response('upstream',{status:502}));const rest=createAgentRest('bot-secret',request as unknown as Parameters<typeof createAgentRest>[1]);
    expect(rest.options.retries).toBe(0);expect(rest.options.timeout).toBe(10000);expect(rest.options.hashSweepInterval).toBe(0);expect(rest.options.handlerSweepInterval).toBe(0);
    await expect(rest.post(Routes.channelMessages(TEXT),{body:{content:'progress'}})).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
    rest.clearHashSweeper();rest.clearHandlerSweeper();
  });
  it('reads the login token lazily and does not change the shared Discord transport',async()=>{
    const s=setup(),createRest=vi.fn(()=>s.client.rest);const api=createAgentDiscord(s.client,G,{createRest});expect(createRest).not.toHaveBeenCalled();
    Object.assign(s.client,{token:'logged-in-token'});await api.send(TEXT,'progress',MESSAGE);expect(createRest).toHaveBeenCalledWith('logged-in-token');expect(s.post).toHaveBeenCalledTimes(1);
  });
  it('fits Discord UTF-16 limits without splitting an emoji',async()=>{
    const s=setup();await s.api.edit(TEXT,MESSAGE,'😀'.repeat(1500));const content=(s.patch.mock.calls[0] as unknown as [string,{body:{content:string}}])[1].body.content;
    expect(content.length).toBeLessThanOrEqual(1950);expect(content.endsWith('😀')).toBe(true);
  });
  it('aborts an outstanding transport call when the runtime stops',async()=>{
    const s=setup();let requestSignal:AbortSignal|undefined;
    s.post.mockImplementation(async(_path,options)=>{
      requestSignal=(options as {signal:AbortSignal}).signal;
      return new Promise<never>((_,reject)=>requestSignal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    });
    const work=s.api.send(TEXT,'progress',MESSAGE);await Promise.resolve();s.api.stop?.();await expect(work).rejects.toMatchObject({uncertain:true});expect(requestSignal?.aborted).toBe(true);
  });
});
