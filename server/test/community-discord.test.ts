import { ChannelType, EmbedType, PermissionFlagsBits as P, Routes, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { createCommunityDiscord, type CommunityDiscord } from '../src/community/discord';
import { renderRoomPanel, type CommunityRoomPanelMessage } from '../src/community/room-panel';

const G='1114391825336250432', SELF='222222222222222222', OWNER='333333333333333333', OTHER='444444444444444444';
const PARENT='555555555555555555', ROOM='666666666666666666', TEXT='777777777777777777';
const BOTROLE='888888888888888888', FUN='888888888888888881', ADMIN='888888888888888882', HIGH='888888888888888883', MANAGED='888888888888888884';
const OP='de52a9a3-56a7-4c35-a145-ed3a207bf206';
const BASE=P.ViewChannel|P.Connect|P.Speak|P.SendMessages|P.EmbedLinks;
const BOT=BASE|P.ManageChannels|P.ManageRoles|P.MoveMembers|P.ViewAuditLog;
const rawMember=(id:string,roles:string[]=[],bot=false)=>({user:{id,username:'name-'+id.slice(-3),bot},nick:null,roles,joined_at:'2026-10-28T00:00:00.000Z'});
const rawChannel=(id=ROOM,type:number=ChannelType.GuildVoice)=>({id,type,guild_id:G,name:'游戏房',parent_id:PARENT,user_limit:0,permission_overwrites:[] as Array<{id:string;type:number;allow:string;deny:string}>});
const audit=(id:string,target=ROOM,actor=SELF,reason=`community-room:${OP}`)=>({id,target_id:target,user_id:actor,action_type:10,reason,changes:[{key:'type',new_value:2}]});
const aid=(n:number)=>String(999999999999999999n+BigInt(n));
function setup(){
  let ready=true, available=true, botPermissions=BOT;
  const roles=[{id:G,name:'@everyone',position:0,permissions:BASE.toString(),managed:false},
    {id:BOTROLE,name:'Bot',position:10,permissions:BOT.toString(),managed:true},
    {id:FUN,name:'游戏',position:2,permissions:'0',managed:false},
    {id:ADMIN,name:'管理',position:3,permissions:P.ManageGuild.toString(),managed:false},
    {id:HIGH,name:'高层',position:11,permissions:'0',managed:false},
    {id:MANAGED,name:'托管',position:2,permissions:'0',managed:true}];
  const members=new Map([[SELF,rawMember(SELF,[BOTROLE],true)],[OWNER,rawMember(OWNER,[FUN])],[OTHER,rawMember(OTHER)]]);
  const channels=new Map([[PARENT,rawChannel(PARENT,ChannelType.GuildCategory)],[ROOM,rawChannel()],[TEXT,rawChannel(TEXT,ChannelType.GuildText)]]);
  const voices=new Map([[OWNER,{id:OWNER,channelId:ROOM}],[OTHER,{id:OTHER,channelId:ROOM}]]);
  const guild={id:G,name:'社区',ownerId:'999999999999999998',get available(){return available},voiceStates:{cache:voices},members:{cache:new Map()}};
  const pages:unknown[]=[];const memberPages:unknown[]=[];
  const get=vi.fn(async(route:string,options?:{query?:URLSearchParams})=>{
    if(route===Routes.guild(G))return{id:G,name:'社区',owner_id:guild.ownerId};
    if(route===Routes.guildRoles(G))return roles.map(r=>r.id===BOTROLE?{...r,permissions:botPermissions.toString()}:r);
    if(route===Routes.guildChannels(G))return[...channels.values()];
    if(route===Routes.guildMembers(G))return memberPages.length?memberPages.shift():[...members.values()];
    if(route===Routes.guildAuditLog(G))return pages.length?pages.shift():{audit_log_entries:[]};
    if(route.startsWith(`/guilds/${G}/members/`)){const m=members.get(route.slice(route.lastIndexOf('/')+1));if(!m)throw{status:404,code:10007};return m}
    if(route.startsWith('/channels/')){const c=channels.get(route.split('/')[2]);if(!c)throw{status:404,code:10003};return c}
    throw new Error('Unexpected GET '+route);
  });
  const post=vi.fn(async(route:string,options:{body:Record<string,unknown>;reason?:string})=>route===Routes.guildChannels(G)?{...rawChannel(),...options.body,id:ROOM}:{id:'900000000000000001'});
  const patch=vi.fn(async(_route:string,_options?:{body?:object})=>({}));const put=vi.fn(async()=>({}));const del=vi.fn(async()=>({}));
  const client={user:{id:SELF},isReady:()=>ready,guilds:{cache:new Map([[G,guild]])},rest:{get,post,patch,put,delete:del}} as unknown as Client;
  const api=createCommunityDiscord(client,G);
  return{api,client,guild,roles,members,channels,voices,pages,memberPages,get,post,patch,put,del,setReady:(x:boolean)=>ready=x,setAvailable:(x:boolean)=>available=x,setBotPermissions:(x:bigint)=>botPermissions=x};
}

describe('community Discord resource adapter',()=>{
  it('marks text resources public only when everyone can effectively view them',async()=>{
    const s=setup();expect((await s.api.snapshot()).resources.find(r=>r.id===TEXT)?.metadata?.publicView).toBe(true);
    s.channels.get(TEXT)!.permission_overwrites.push({id:G,type:0,allow:'0',deny:P.ViewChannel.toString()});
    expect((await s.api.snapshot()).resources.find(r=>r.id===TEXT)?.metadata?.publicView).toBe(false);
  });
  it('reads a complete REST member directory rather than the intentionally empty member cache',async()=>{
    const s=setup();const data=await s.api.snapshot();expect(data.ready).toBe(true);expect(data.guildName).toBe('社区');expect(data.selfId).toBe(SELF);
    expect(data.members.map(m=>m.id)).toContain(OWNER);expect(data.resources).toEqual(expect.arrayContaining([expect.objectContaining({id:PARENT,kind:'category'}),expect.objectContaining({id:ROOM,kind:'voice'}),expect.objectContaining({id:TEXT,kind:'text'})]));
    expect(data.resources.find(r=>r.id===FUN)?.safe).toBe(true);
    for(const id of[G,BOTROLE,ADMIN,HIGH,MANAGED])expect(data.resources.find(r=>r.id===id)?.safe).toBe(false);
    expect(s.guild.members.cache.size).toBe(0);
  });
  it('projects exact viewable members only for voice rooms in the selected fixed categories', async () => {
    const s = setup(); s.channels.get(ROOM)!.permission_overwrites = [
      { id: G, type: 0, allow: '0', deny: P.ViewChannel.toString() },
      { id: FUN, type: 0, allow: P.ViewChannel.toString(), deny: '0' },
      { id: SELF, type: 1, allow: P.ViewChannel.toString(), deny: '0' },
    ];
    const unselected = rawChannel('666666666666666667'); unselected.parent_id = '555555555555555556'; s.channels.set(unselected.id, unselected);
    const data = await s.api.snapshot([PARENT]);
    expect(data.resources.find(item => item.id === ROOM)?.metadata).toMatchObject({
      viewableMemberIds: [SELF, OWNER], presentMemberIds: [OWNER, OTHER], defaultVisibility: 'hidden', userLimit: 0,
    });
    expect(data.resources.find(item => item.id === TEXT)?.metadata?.viewableMemberIds).toBeUndefined();
    expect(data.resources.find(item => item.id === unselected.id)?.metadata?.viewableMemberIds).toBeUndefined();
    expect((await s.api.snapshot()).resources.find(item => item.id === ROOM)?.metadata?.viewableMemberIds).toBeUndefined();
  });
  it('calculates fixed-room access with roles read after the full member directory', async () => {
    const s = setup(); s.roles.find(role => role.id === G)!.permissions = (BASE & ~P.ViewChannel).toString();
    s.roles.find(role => role.id === FUN)!.permissions = P.ViewChannel.toString();
    const get = s.get.getMockImplementation()!;
    s.get.mockImplementation(async (route, options) => {
      const value = await get(route, options);
      if (route === Routes.guildMembers(G)) s.roles.find(role => role.id === FUN)!.permissions = '0';
      return value;
    });
    const data = await s.api.snapshot([PARENT]);
    expect(data.resources.find(item => item.id === ROOM)?.metadata?.viewableMemberIds).toEqual([SELF]);
  });
  it('does not invent an unlimited fixed room from an incomplete actual limit', async () => {
    const s = setup(); delete (s.channels.get(ROOM)! as { user_limit?: number }).user_limit;
    await expect(s.api.snapshot([PARENT])).rejects.toThrow();
  });
  it('paginates more than a thousand members with an increasing member cursor',async()=>{
    const s=setup();const first=Array.from({length:1000},(_,i)=>rawMember(aid(i+1)));s.memberPages.push(first,[rawMember(aid(1001))]);
    const result=await s.api.snapshot();expect(result.members).toHaveLength(1001);
    const calls=s.get.mock.calls.filter(c=>c[0]===Routes.guildMembers(G));expect(calls[1][1]?.query?.get('after')).toBe(aid(1000));
  });
  it('does not publish an incomplete or malformed member snapshot',async()=>{
    const s=setup();s.memberPages.push([{user:{id:OWNER},roles:[]}]);await expect(s.api.snapshot()).rejects.toThrow();
  });
  it('returns an explicitly unready snapshot and unknown voice presence while gateway is unavailable',async()=>{
    const s=setup();s.setAvailable(false);expect((await s.api.snapshot()).ready).toBe(false);expect(s.api.occupants(ROOM)).toBeNull();expect(s.api.channelOf(OWNER)).toBeUndefined();expect(s.get).not.toHaveBeenCalled();
  });
  it('reads occupants and current channel from voice state cache, preserving disconnected versus unknown',()=>{
    const s=setup();expect(s.api.occupants(ROOM)).toEqual([OWNER,OTHER]);expect(s.api.channelOf(OWNER)).toBe(ROOM);expect(s.api.channelOf('999999999999999997')).toBeNull();s.setReady(false);expect(s.api.channelOf(OWNER)).toBeUndefined();
  });
  it('fetches current membership afresh and represents departed members as null',async()=>{
    const s=setup();expect((await s.api.member(OWNER))?.roleIds).toEqual([FUN]);s.members.delete(OWNER);expect(await s.api.member(OWNER)).toBeNull();
  });
  it('checks effective channel access, including member overwrites and roles',async()=>{
    const s=setup();s.channels.get(ROOM)!.permission_overwrites=[{id:G,type:0,allow:'0',deny:(P.ViewChannel|P.Connect).toString()},{id:OWNER,type:1,allow:(P.ViewChannel|P.Connect).toString(),deny:'0'}];
    expect(await s.api.canView(OWNER,ROOM)).toBe(true);expect(await s.api.canConnect(OWNER,ROOM)).toBe(true);expect(await s.api.canView(OTHER,ROOM)).toBe(false);expect(await s.api.canConnect(OTHER,ROOM)).toBe(false);
  });
  it('creates rooms with explicit owner and bot access, without granting owner management power',async()=>{
    const s=setup();expect(await s.api.createVoice(PARENT,'我的房间',OWNER,'hidden',6,OP)).toBe(ROOM);
    const call=s.post.mock.calls.find(c=>c[0]===Routes.guildChannels(G))!;expect(call[1].reason).toBe(`community-room:${OP}`);
    const body=call[1].body;expect(body).toMatchObject({name:'我的房间',type:ChannelType.GuildVoice,parent_id:PARENT,user_limit:6});
    const overwrites=body.permission_overwrites as Array<{id:string;allow:string;deny:string}>;
    const bot=overwrites.find(o=>o.id===SELF)!;const owner=overwrites.find(o=>o.id===OWNER)!;const everyone=overwrites.find(o=>o.id===G)!;
    expect(BigInt(bot.allow)&(P.ViewChannel|P.Connect)).toBe(P.ViewChannel|P.Connect);expect(BigInt(owner.allow)&(P.ManageChannels|P.ManageRoles|P.Administrator)).toBe(0n);expect(BigInt(everyone.deny)&P.ViewChannel).toBe(P.ViewChannel);
  });
  it('preserves message permissions granted to the bot only in the destination category', async () => {
    const s = setup(), chat = P.SendMessages | P.ReadMessageHistory | P.EmbedLinks;
    s.roles.find(role => role.id === G)!.permissions = (BASE & ~chat).toString(); s.setBotPermissions(BOT & ~chat);
    s.channels.get(PARENT)!.permission_overwrites.push({ id: SELF, type: 1, allow: chat.toString(), deny: '0' });
    await s.api.createVoice(PARENT, '我的房间', OWNER, 'hidden', 6, OP);
    const overwrites = s.post.mock.calls.find(([route]) => route === Routes.guildChannels(G))![1].body.permission_overwrites as Array<{ id: string; allow: string; deny: string }>;
    expect(BigInt(overwrites.find(item => item.id === SELF)!.allow)).toBe(P.ViewChannel | P.Connect | chat);
    expect(BigInt(overwrites.find(item => item.id === OWNER)!.allow)).toBe(P.ViewChannel | P.Connect);
    expect(BigInt(overwrites.find(item => item.id === G)!.allow) & chat).toBe(0n);
  });
  it('copies only message permissions the bot effectively has in the category', async () => {
    const s = setup(), chat = P.SendMessages | P.ReadMessageHistory | P.EmbedLinks;
    s.roles.find(role => role.id === G)!.permissions = (BASE & ~chat).toString(); s.setBotPermissions(BOT & ~chat);
    s.channels.get(PARENT)!.permission_overwrites.push({ id: SELF, type: 1, allow: P.SendMessages.toString(), deny: (P.ReadMessageHistory | P.EmbedLinks).toString() });
    await s.api.createVoice(PARENT, '我的房间', OWNER, 'open', 0, OP);
    const overwrites = s.post.mock.calls.find(([route]) => route === Routes.guildChannels(G))![1].body.permission_overwrites as Array<{ id: string; allow: string }>;
    expect(BigInt(overwrites.find(item => item.id === SELF)!.allow) & chat).toBe(P.SendMessages);
  });
  it('reads the directory before one fresh context instead of fetching the same context twice', async () => {
    const s = setup(); await s.api.snapshot();
    expect(s.get.mock.calls.filter(([route]) => route === Routes.guildRoles(G))).toHaveLength(1);
    expect(s.get.mock.calls.filter(([route]) => route === Routes.guild(G))).toHaveLength(1);
    expect(s.get.mock.calls.filter(([route]) => route === Routes.guildMember(G, SELF))).toHaveLength(1);
    expect(s.get).toHaveBeenCalledTimes(5);
  });
  it.each(['member', 'managed', 'access'] as const)('starts independent %s reads while context is still in flight', async kind => {
    const s = setup(), get = s.get.getMockImplementation()!;
    let release!: () => void; const pendingContext = new Promise<void>(resolve => { release = resolve; });
    s.get.mockImplementation(async (route, options) => { if (route === Routes.guild(G)) await pendingContext; return get(route, options); });
    const work = kind === 'member' ? s.api.member(OWNER) : kind === 'managed' ? s.api.rename(ROOM, '新名字') : s.api.canConnect(OWNER, ROOM);
    try {
      if (kind !== 'managed') expect(s.get.mock.calls.some(([route]) => route === Routes.guildMember(G, OWNER))).toBe(true);
      if (kind !== 'member') expect(s.get.mock.calls.some(([route]) => route === Routes.channel(ROOM))).toBe(true);
    } finally { release(); await work; }
    expect(s.get).toHaveBeenCalledTimes(kind === 'access' ? 5 : 4);
  });
  it('refuses creation after fresh permission loss, with no Discord write',async()=>{
    const s=setup();s.setBotPermissions(BASE);await expect(s.api.createVoice(PARENT,'房间',OWNER,'open',0,OP)).rejects.toMatchObject({status:403});expect(s.post).not.toHaveBeenCalled();
  });
  it('preserves member grants and bot access when locking a room',async()=>{
    const s=setup();s.channels.get(ROOM)!.permission_overwrites=[{id:OTHER,type:1,allow:(P.ViewChannel|P.Connect).toString(),deny:'0'}];
    await s.api.setVisibility(ROOM,OWNER,'locked');const body=(s.patch.mock.calls[0] as unknown[])[1] as {body:{permission_overwrites:Array<{id:string;allow:string;deny:string}>}};
    expect(body.body.permission_overwrites).toContainEqual(expect.objectContaining({id:OTHER,allow:(P.ViewChannel|P.Connect).toString()}));
    expect(body.body.permission_overwrites.find(o=>o.id===SELF)?.allow).toBe((P.ViewChannel|P.Connect).toString());
    expect(BigInt(body.body.permission_overwrites.find(o=>o.id===G)!.deny)&P.Connect).toBe(P.Connect);
  });
  it('rejects role overwrites that would bypass a lock rather than modifying manual role access',async()=>{
    const s=setup();s.channels.get(ROOM)!.permission_overwrites=[{id:FUN,type:0,allow:P.Connect.toString(),deny:'0'}];await expect(s.api.setVisibility(ROOM,OWNER,'locked')).rejects.toMatchObject({status:409});expect(s.patch).not.toHaveBeenCalled();
  });
  it('grants and denies only a current guild member’s view/connect access',async()=>{
    const s=setup();await s.api.grant(ROOM,OTHER);await s.api.deny(ROOM,OTHER);expect(s.put).toHaveBeenCalledTimes(2);
    expect((s.put.mock.calls[0] as unknown[])[1]).toMatchObject({body:{type:1,allow:(P.ViewChannel|P.Connect).toString()}});
    s.members.delete(OTHER);await expect(s.api.grant(ROOM,OTHER)).rejects.toMatchObject({status:404});expect(s.put).toHaveBeenCalledTimes(2);
  });
  it('does not move a disconnected member back into voice',async()=>{
    const s=setup();s.voices.delete(OWNER);await expect(s.api.move(OWNER,ROOM)).rejects.toMatchObject({status:409});expect(s.patch).not.toHaveBeenCalled();
  });
  it('will not move a member into a channel they cannot access',async()=>{
    const s=setup();s.channels.get(ROOM)!.permission_overwrites=[{id:G,type:0,allow:'0',deny:P.Connect.toString()}];await expect(s.api.move(OWNER,ROOM)).rejects.toMatchObject({status:403});expect(s.patch).not.toHaveBeenCalled();
  });
  it('rechecks occupied status after asynchronous checks before deleting and rejects unknown presence',async()=>{
    const s=setup();await expect(s.api.delete(ROOM)).rejects.toMatchObject({status:409});s.voices.clear();s.setAvailable(false);await expect(s.api.delete(ROOM)).rejects.toMatchObject({status:503});expect(s.del).not.toHaveBeenCalled();
  });
  it('rejects unsafe or newly elevated roles at execution, for add and removal',async()=>{
    const s=setup();await expect(s.api.addRole(OWNER,ADMIN)).rejects.toMatchObject({status:403});await expect(s.api.removeRole(OWNER,HIGH)).rejects.toMatchObject({status:403});expect(s.put).not.toHaveBeenCalled();expect(s.del).not.toHaveBeenCalled();
    await s.api.addRole(OWNER,FUN);s.roles.find(r=>r.id===FUN)!.permissions=P.Administrator.toString();await expect(s.api.addRole(OWNER,FUN)).rejects.toMatchObject({status:403});expect(s.put).toHaveBeenCalledTimes(1);
  });
  it('refuses welcome delivery when the channel became private after a directory snapshot',async()=>{
    const s=setup();await s.api.snapshot();
    s.channels.get(TEXT)!.permission_overwrites.push({id:G,type:0,allow:'0',deny:P.ViewChannel.toString()},{id:SELF,type:1,allow:P.ViewChannel.toString(),deny:'0'});
    await expect(s.api.sendText(TEXT,'欢迎')).rejects.toMatchObject({status:403});expect(s.post).not.toHaveBeenCalled();
  });
  it('never pings from welcome text or the fixed community panel',async()=>{
    const s=setup();await s.api.sendText(TEXT,'欢迎 @everyone');await s.api.sendPanel(TEXT);
    for(const [,options]of s.post.mock.calls)expect(options.body.allowed_mentions).toEqual({parse:[]});
    const panel=s.post.mock.calls[1][1].body;const serialized=JSON.stringify(panel);expect(serialized).toContain('v1:community:room');expect(serialized).toContain('v1:community:roles');expect(serialized).toContain('v1:community:play');
  });
  it('edits an existing panel only when it is a message authored by this bot',async()=>{
    const s=setup();
    const original=s.get.getMockImplementation()!;
    s.get.mockImplementation(async(route,options)=>route===Routes.channelMessage(TEXT,'900000000000000001')?{id:'900000000000000001',author:{id:OTHER}}:original(route,options));
    await expect(s.api.sendPanel(TEXT,'900000000000000001')).rejects.toMatchObject({status:409});expect(s.patch).not.toHaveBeenCalled();
  });
});

describe('voice-room persistent panel messages', () => {
  const MID = '900000000000000001', NEXT = '900000000000000002';
  const panel = () => renderRoomPanel({ roomRef: OP, name: '游戏房', ownerName: 'Nanako', occupantCount: 2,
    userLimit: 6, visibility: 'open', cleanupAt: null, emptyGraceSeconds: 120, claimable: false, transferPending: false });
  const message = (messageId = MID, body: CommunityRoomPanelMessage = panel(), author = SELF) => ({ id: messageId, author: { id: author }, ...body });
  function roomPanelSetup() {
    const s = setup(); s.setBotPermissions(BOT | P.ReadMessageHistory);
    const history: unknown[] = [], messages = new Map<string, unknown>();
    const original = s.get.getMockImplementation()!;
    s.get.mockImplementation(async (route, options) => {
      if (route === Routes.channelMessages(ROOM)) return history.length ? history.shift() : [];
      if (route.startsWith(`${Routes.channelMessages(ROOM)}/`)) {
        const value = messages.get(route.split('/').at(-1)!); if (!value) throw { status: 404 }; return value;
      }
      return original(route, options);
    });
    return { ...s, history, messages };
  }
  it('sends the first card in the voice channel only after a complete fresh history check', async () => {
    const s = roomPanelSetup(), body = panel();
    expect(await s.api.syncRoomPanel!(ROOM, OP, null, body, PARENT)).toBe(MID);
    expect(s.get.mock.calls.some(([route]) => route === Routes.channelMessages(ROOM))).toBe(true);
    expect(s.post).toHaveBeenCalledWith(Routes.channelMessages(ROOM), { body });
    expect(s.get.mock.calls.filter(([route]) => route === Routes.guildRoles(G)).length).toBeGreaterThanOrEqual(2);
  });
  it('uses one fresh context before and after history without an immediately duplicated check', async () => {
    const s = roomPanelSetup(); await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT);
    expect(s.get.mock.calls.filter(([route]) => route === Routes.guildRoles(G))).toHaveLength(2);
    expect(s.get).toHaveBeenCalledTimes(9);
    expect(s.post).toHaveBeenCalledTimes(1);
  });
  it('edits the previously recorded message and never posts a second card', async () => {
    const s = roomPanelSetup(); s.messages.set(MID, message());
    const body = renderRoomPanel({ roomRef: OP, name: '新名字', ownerName: 'Nanako', occupantCount: 1,
      userLimit: 4, visibility: 'locked', cleanupAt: null, emptyGraceSeconds: 120, claimable: false, transferPending: false });
    expect(await s.api.syncRoomPanel!(ROOM, OP, MID, body, PARENT)).toBe(MID);
    expect(s.patch).toHaveBeenCalledWith(Routes.channelMessage(ROOM, MID), { body });
    expect(s.post).not.toHaveBeenCalled();
    expect(s.get.mock.calls.some(([route]) => route === Routes.channelMessages(ROOM))).toBe(false);
  });
  it('does not edit an unchanged card, including Discord-added default fields', async () => {
    const s = roomPanelSetup(), existing = message();
    existing.embeds[0] = { ...existing.embeds[0], type: EmbedType.Rich };
    s.messages.set(MID, existing);
    expect(await s.api.syncRoomPanel!(ROOM, OP, MID, panel(), PARENT)).toBe(MID);
    expect(s.patch).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled();
  });
  it('recovers a posted card after losing the database writeback', async () => {
    const s = roomPanelSetup(); s.history.push([message()]);
    expect(await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).toBe(MID);
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
  });
  it('searches after a deleted message and replaces it only when complete history has no own marker', async () => {
    const s = roomPanelSetup();
    expect(await s.api.syncRoomPanel!(ROOM, OP, NEXT, panel(), PARENT)).toBe(MID);
    expect(s.get.mock.calls.some(([route]) => route === Routes.channelMessage(ROOM, NEXT))).toBe(true);
    expect(s.post).toHaveBeenCalledTimes(1);
  });
  it('ignores another author and another room marker while scanning', async () => {
    const s = roomPanelSetup(), otherRoom = panel();
    for (const button of otherRoom.components[0].components) if ('custom_id' in button) {
      button.custom_id = button.custom_id.replace(OP, 'a004e6b9-9251-4d11-bbce-521b358fd53e');
    }
    s.history.push([message(NEXT, panel(), OTHER), message(MID, otherRoom)]);
    await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT); expect(s.post).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite a recorded message with the wrong author or marker', async () => {
    for (const body of [message(MID, panel(), OTHER), { ...message(), components: [] }]) {
      const s = roomPanelSetup(); s.messages.set(MID, body);
      await expect(s.api.syncRoomPanel!(ROOM, OP, MID, panel(), PARENT)).rejects.toMatchObject({ status: 409 });
      expect(s.patch).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled();
    }
  });
  it('does not choose between two matching cards or post a third', async () => {
    const s = roomPanelSetup(); s.history.push([message(NEXT), message(MID)]);
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 409 });
    expect(s.patch).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled();
  });
  it.each([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks])('requires each effective message permission: %s', async bit => {
    const s = roomPanelSetup(); s.channels.get(ROOM)!.permission_overwrites.push({ id: SELF, type: 1, allow: '0', deny: bit.toString() });
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 403 });
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
  });
  it('rejects text/category targets and keeps welcome delivery restricted to text channels', async () => {
    const s = roomPanelSetup();
    for (const target of [TEXT, PARENT]) await expect(s.api.syncRoomPanel!(target, OP, null, panel(), PARENT)).rejects.toThrow();
    await expect(s.api.sendText(ROOM, '欢迎')).rejects.toMatchObject({ status: 404 });
    expect(s.post).not.toHaveBeenCalled();
  });
  it('rejects a malformed intended marker before any network request', async () => {
    const s = roomPanelSetup(), body = panel(); body.components = [];
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, body, PARENT)).rejects.toMatchObject({ status: 400 });
    expect(s.get).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled();
  });
  it('recovers by the stable control component even when the visible footer text changes', async () => {
    const s = roomPanelSetup(), previous = message(); previous.embeds[0].footer = { text: '旧提示' };
    s.history.push([previous]);
    expect(await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).toBe(MID);
    expect(s.patch).toHaveBeenCalledWith(Routes.channelMessage(ROOM, MID), { body: panel() });
    expect(s.post).not.toHaveBeenCalled();
  });
  it('requires every intended action to address the same room instead of trusting only its marker', async () => {
    const s = roomPanelSetup(), body = panel(), first = body.components[0].components[0];
    if ('custom_id' in first) first.custom_id = first.custom_id.replace(OP, 'a004e6b9-9251-4d11-bbce-521b358fd53e');
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, body, PARENT)).rejects.toMatchObject({ status: 400 });
    expect(s.get).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled();
  });
  it('does not inspect other members’ message bodies, embeds or control components during recovery', async () => {
    const s = roomPanelSetup(), other = { id: MID, author: { id: OTHER } };
    for (const field of ['content', 'embeds', 'components']) Object.defineProperty(other, field, { get: () => { throw new Error('ordinary chat must not be inspected'); } });
    s.history.push([other]);
    await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT);
    expect(s.post).toHaveBeenCalledTimes(1);
  });
  it('does not mistake permission revocation during an empty scan for proof that no card exists', async () => {
    const s = roomPanelSetup(), get = s.get.getMockImplementation()!;
    s.get.mockImplementation(async (route, options) => {
      if (route === Routes.channelMessages(ROOM)) { s.setBotPermissions(BOT); return []; }
      return get(route, options);
    });
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 403 });
    expect(s.post).not.toHaveBeenCalled();
  });
  it('uses a decreasing cursor and completes every page before accepting a unique match', async () => {
    const s = roomPanelSetup();
    s.history.push(Array.from({ length: 100 }, (_, index) => message(aid(200 - index), panel(), OTHER)), [message(aid(100))]);
    expect(await s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).toBe(aid(100));
    const calls = s.get.mock.calls.filter(([route]) => route === Routes.channelMessages(ROOM));
    expect(calls[1][1]?.query?.get('before')).toBe(aid(101)); expect(s.post).not.toHaveBeenCalled();
  });
  it('rejects malformed, unordered or interrupted history without sending', async () => {
    for (const page of [null, [message(MID), message(NEXT)], [{ id: 'bad', author: { id: SELF } }]]) {
      const s = roomPanelSetup(); s.history.push(page);
      await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toThrow(); expect(s.post).not.toHaveBeenCalled();
    }
    const s = roomPanelSetup(), get = s.get.getMockImplementation()!;
    s.get.mockImplementation(async (route, options) => { if (route === Routes.channelMessages(ROOM)) throw { status: 503 }; return get(route, options); });
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 503 }); expect(s.post).not.toHaveBeenCalled();
  });
  it('does not immediately recreate when the card disappears during its edit', async () => {
    const s = roomPanelSetup(); s.messages.set(MID, { ...message(), content: '旧内容' });
    s.patch.mockRejectedValue({ status: 404 });
    await expect(s.api.syncRoomPanel!(ROOM, OP, MID, panel(), PARENT)).rejects.toMatchObject({ status: 404 }); expect(s.post).not.toHaveBeenCalled();
  });
  it('does no network work while the Gateway is unavailable', async () => {
    const s = roomPanelSetup(); s.setAvailable(false);
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 503 }); expect(s.get).not.toHaveBeenCalled();
  });
  it('does not publish in a room already moved out of its managed category', async () => {
    const s = roomPanelSetup(); s.channels.get(ROOM)!.parent_id = TEXT;
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 409 });
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
    expect(s.get.mock.calls.some(([route]) => route === Routes.channelMessages(ROOM))).toBe(false);
  });
  it('rechecks the category after scanning history instead of trusting the initial room location', async () => {
    const s = roomPanelSetup(), get = s.get.getMockImplementation()!;
    s.get.mockImplementation(async (route, options) => {
      if (route === Routes.channelMessages(ROOM)) s.channels.get(ROOM)!.parent_id = TEXT;
      return get(route, options);
    });
    await expect(s.api.syncRoomPanel!(ROOM, OP, null, panel(), PARENT)).rejects.toMatchObject({ status: 409 });
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
  });
  it('rechecks the category before editing a recorded message after a human moves its room', async () => {
    const s = roomPanelSetup(), get = s.get.getMockImplementation()!;
    s.messages.set(MID, { ...message(), content: '旧内容' });
    s.get.mockImplementation(async (route, options) => {
      if (route === Routes.channelMessage(ROOM, MID)) s.channels.get(ROOM)!.parent_id = TEXT;
      return get(route, options);
    });
    await expect(s.api.syncRoomPanel!(ROOM, OP, MID, panel(), PARENT)).rejects.toMatchObject({ status: 409 });
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
  });
  it.each([false, true])('checks fresh database authority before a panel write (existing: %s)', async existing => {
    const s = roomPanelSetup(), beforeWrite = vi.fn(async () => { throw new Error('room or read-only state changed'); });
    if (existing) s.messages.set(MID, { ...message(), content: '旧内容' });
    await expect(s.api.syncRoomPanel!(ROOM, OP, existing ? MID : null, panel(), PARENT, beforeWrite))
      .rejects.toThrow('room or read-only state changed');
    expect(beforeWrite).toHaveBeenCalledTimes(1);
    expect(s.post).not.toHaveBeenCalled(); expect(s.patch).not.toHaveBeenCalled();
  });
});

describe('community voice creation audit recovery',()=>{
  it('matches only this bot’s exact operation reason and validates the channel',async()=>{
    const s=setup();s.pages.push({audit_log_entries:[audit(aid(5),ROOM,OTHER),audit(aid(4),ROOM,SELF,'other'),audit(aid(3))]});expect(await s.api.findCreatedVoice(OP)).toBe(ROOM);
  });
  it('returns null only after a complete scan and fresh permission recheck',async()=>{
    const s=setup();expect(await s.api.findCreatedVoice(OP)).toBeNull();expect(s.get.mock.calls.filter(c=>c[0]===Routes.guildRoles(G))).toHaveLength(2);
  });
  it('continues through a full audit page using a strictly decreasing before cursor',async()=>{
    const s=setup();const first=Array.from({length:100},(_,i)=>audit(aid(200-i),ROOM,SELF,'unrelated'));s.pages.push({audit_log_entries:first},{audit_log_entries:[audit(aid(100))]});expect(await s.api.findCreatedVoice(OP)).toBe(ROOM);
    const calls=s.get.mock.calls.filter(c=>c[0]===Routes.guildAuditLog(G));expect(calls[1][1]?.query?.get('before')).toBe(aid(101));
  });
  it('does not guess when two creates carry the operation marker',async()=>{
    const s=setup();s.pages.push({audit_log_entries:[audit(aid(2)),audit(aid(1),'666666666666666667')]});await expect(s.api.findCreatedVoice(OP)).rejects.toMatchObject({status:409});
  });
  it('does not mistake a missing audit permission for no matching room',async()=>{
    const s=setup();s.setBotPermissions(BOT&~P.ViewAuditLog);await expect(s.api.findCreatedVoice(OP)).rejects.toMatchObject({status:403});expect(s.get.mock.calls.some(c=>c[0]===Routes.guildAuditLog(G))).toBe(false);
  });
  it('fails on malformed pages, wrong order or interrupted pagination',async()=>{
    for(const entries of[null,[audit(aid(1)),audit(aid(2))],[{id:'bad'}]]){const s=setup();s.pages.push({audit_log_entries:entries});await expect(s.api.findCreatedVoice(OP)).rejects.toThrow()}
    const s=setup();const get=s.get.getMockImplementation()!;s.get.mockImplementation(async(route,options)=>{if(route===Routes.guildAuditLog(G))throw new Error('network down');return get(route,options)});await expect(s.api.findCreatedVoice(OP)).rejects.toThrow();
  });
  it('fails if audit permission is revoked during the scan',async()=>{
    const s=setup();const get=s.get.getMockImplementation()!;s.get.mockImplementation(async(route,options)=>{if(route===Routes.guildAuditLog(G)){s.setBotPermissions(BOT&~P.ViewAuditLog);return{audit_log_entries:[]}}return get(route,options)});await expect(s.api.findCreatedVoice(OP)).rejects.toMatchObject({status:403});
  });
});

describe('community room state inspection',()=>{
  const ACCESS=P.ViewChannel|P.Connect;
  function roomAccess(s:ReturnType<typeof setup>,visibility:'open'|'locked'|'hidden'){
    s.channels.get(ROOM)!.permission_overwrites=[
      {id:G,type:0,allow:(visibility==='open'?ACCESS:visibility==='locked'?P.ViewChannel:0n).toString(),deny:(visibility==='hidden'?ACCESS:visibility==='locked'?P.Connect:0n).toString()},
      {id:SELF,type:1,allow:ACCESS.toString(),deny:'0'},
      {id:OWNER,type:1,allow:ACCESS.toString(),deny:'0'},
    ];
  }
  it.each(['open','locked','hidden'] as const)('reconstructs %s from fresh channel state rather than a cached room model',async visibility=>{
    const s=setup();roomAccess(s,visibility);s.channels.get(ROOM)!.name='人工改过的房名';s.channels.get(ROOM)!.user_limit=7;
    expect(await s.api.inspectRoom(ROOM,OWNER)).toEqual({name:'人工改过的房名',userLimit:7,visibility,allowedMemberIds:[],blockedMemberIds:[]});
    expect(s.get.mock.calls.some(c=>c[0]===Routes.channel(ROOM))).toBe(true);
    expect(s.get.mock.calls.some(c=>c[0]===Routes.guildMember(G,OWNER))).toBe(true);
    expect(s.guild.members.cache.size).toBe(0);
    expect(s.post).not.toHaveBeenCalled();expect(s.patch).not.toHaveBeenCalled();expect(s.put).not.toHaveBeenCalled();expect(s.del).not.toHaveBeenCalled();
  });
  it('preserves effective everyone inheritance when there is no everyone overwrite',async()=>{
    const s=setup();expect(await s.api.inspectRoom(ROOM,OWNER)).toMatchObject({visibility:'open',userLimit:0});
  });
  it('reconstructs ordinary member access from ACCESS bits only and excludes bot and owner',async()=>{
    const s=setup();roomAccess(s,'hidden');const blocked='444444444444444445';
    s.channels.get(ROOM)!.permission_overwrites.push(
      {id:OTHER,type:1,allow:(ACCESS|P.Speak).toString(),deny:P.SendMessages.toString()},
      {id:blocked,type:1,allow:P.Speak.toString(),deny:ACCESS.toString()},
    );
    expect(await s.api.inspectRoom(ROOM,OWNER)).toEqual({name:'游戏房',userLimit:0,visibility:'hidden',allowedMemberIds:[OTHER],blockedMemberIds:[blocked]});
  });
  it('does not turn unrelated member or role overrides into access grants',async()=>{
    const s=setup();roomAccess(s,'locked');s.channels.get(ROOM)!.permission_overwrites.push(
      {id:OTHER,type:1,allow:P.Speak.toString(),deny:P.SendMessages.toString()},
      {id:FUN,type:0,allow:P.Speak.toString(),deny:P.SendMessages.toString()},
    );
    expect(await s.api.inspectRoom(ROOM,OWNER)).toMatchObject({visibility:'locked',allowedMemberIds:[],blockedMemberIds:[]});
  });
  it.each([
    ['locked',P.Connect,0n],['hidden',P.ViewChannel,0n],['open',0n,P.Connect],['open',0n,P.ViewChannel],
  ] as const)('does not flatten a %s room with conflicting role access into the member ACL model',async(visibility,allow,deny)=>{
    const s=setup();roomAccess(s,visibility);s.channels.get(ROOM)!.permission_overwrites.push({id:FUN,type:0,allow:allow.toString(),deny:deny.toString()});
    expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it.each([
    [P.ViewChannel,0n],[0n,P.Connect],[ACCESS,ACCESS],
  ] as const)('leaves partial or contradictory member access for manual review',async(allow,deny)=>{
    const s=setup();roomAccess(s,'locked');s.channels.get(ROOM)!.permission_overwrites.push({id:OTHER,type:1,allow:allow.toString(),deny:deny.toString()});
    expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it('accepts a role overwrite only when it preserves the same default access model',async()=>{
    const s=setup();roomAccess(s,'locked');s.channels.get(ROOM)!.permission_overwrites.push({id:FUN,type:0,allow:P.ViewChannel.toString(),deny:P.Connect.toString()});
    expect(await s.api.inspectRoom(ROOM,OWNER)).toMatchObject({visibility:'locked',allowedMemberIds:[],blockedMemberIds:[]});
  });
  it('does not overlook inherited role access when everyone alone cannot view the room',async()=>{
    const s=setup();s.roles.find(role=>role.id===G)!.permissions=P.Connect.toString();s.roles.find(role=>role.id===FUN)!.permissions=P.ViewChannel.toString();
    expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it.each(['   ','x'.repeat(101)])('rejects an invalid room name instead of recovering incomplete metadata',async name=>{
    const s=setup();s.channels.get(ROOM)!.name=name;await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:502});
  });
  it('does not recover access through a role missing from the fresh role directory',async()=>{
    const s=setup();roomAccess(s,'locked');s.channels.get(ROOM)!.permission_overwrites.push({id:'888888888888888889',type:0,allow:ACCESS.toString(),deny:'0'});
    expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it('rejects duplicate overwrite identities rather than choosing an arbitrary ACL',async()=>{
    const s=setup();roomAccess(s,'open');s.channels.get(ROOM)!.permission_overwrites.push({id:G,type:0,allow:'0',deny:ACCESS.toString()});
    expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it('returns null for a missing or non-voice channel',async()=>{
    const s=setup();s.channels.delete(ROOM);expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
    expect(await s.api.inspectRoom(TEXT,OWNER)).toBeNull();expect(await s.api.inspectRoom(PARENT,OWNER)).toBeNull();
  });
  it('returns null for a departed or bot owner',async()=>{
    const s=setup();s.members.delete(OWNER);expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
    s.members.set(OWNER,rawMember(OWNER,[],true));expect(await s.api.inspectRoom(ROOM,OWNER)).toBeNull();
  });
  it('does not infer an ordinary room when the owner can no longer view and connect',async()=>{
    const s=setup();roomAccess(s,'hidden');s.channels.get(ROOM)!.permission_overwrites=s.channels.get(ROOM)!.permission_overwrites.filter(o=>o.id!==OWNER);
    await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:403});
  });
  it('does not infer an ordinary room when the bot can no longer view and connect',async()=>{
    const s=setup();roomAccess(s,'hidden');s.channels.get(ROOM)!.permission_overwrites=s.channels.get(ROOM)!.permission_overwrites.filter(o=>o.id!==SELF);
    await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:403});
  });
  it('refuses a channel belonging to another guild',async()=>{
    const s=setup();s.channels.get(ROOM)!.guild_id='1114391825336250433';await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:403});
  });
  it('rejects unavailable gateway state and interrupted REST reads',async()=>{
    const s=setup();s.setAvailable(false);await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:503});expect(s.get).not.toHaveBeenCalled();
    s.setAvailable(true);const get=s.get.getMockImplementation()!;s.get.mockImplementation(async(route,options)=>{if(route===Routes.channel(ROOM))throw new Error('network down');return get(route,options)});
    await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:503});
  });
  it.each([undefined,'7',-1,1.5,100])('does not turn an unknown or invalid limit %s into an unlimited room',async limit=>{
    const s=setup();(s.channels.get(ROOM)! as unknown as {user_limit:unknown}).user_limit=limit;
    await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:502});
  });
  it('rechecks fresh permissions after reading the channel instead of trusting an earlier role response',async()=>{
    const s=setup();const get=s.get.getMockImplementation()!;
    s.get.mockImplementation(async(route,options)=>{const result=await get(route,options);if(route===Routes.channel(ROOM)){s.roles.find(role=>role.id===G)!.permissions=P.Speak.toString();s.setBotPermissions(BOT&~ACCESS)}return result});
    await expect(s.api.inspectRoom(ROOM,OWNER)).rejects.toMatchObject({status:403});
  });
});
