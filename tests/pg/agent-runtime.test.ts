import { EventEmitter } from 'node:events';
import { ChannelType, type Client, type Message } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAgentSettings, type AgentDocument } from '../../shared/community-agent';
import type { AgentAnswer, answerAgentQuestion } from '../../server/src/community/agent-answer';
import { createCommunityAgentRuntime } from '../../server/src/community/agent-runtime';
import { CommunityAgentStore } from '../../server/src/community/agent-store';
import { CommunityStore } from '../../server/src/community/store';
import { noAiEnv, seedUser } from '../worker/helpers';
import { env as pgEnv, pool } from './cloudflare-test';

const GUILD='111111111111111111',MEMBER='222222222222222222',CHANNEL='333333333333333333';
const BOT='444444444444444444',SOURCE='555555555555555555',REPLY='666666666666666666';
const QUESTION='房间如何创建，问题标记question_marker？',ANSWER='从入口进入即可创建房间，回答标记answer_marker。';
let store:CommunityAgentStore,document:AgentDocument;
beforeEach(async()=>{
  await seedUser({id:'alice'});await seedUser({id:'admin',admin:true});
  const community=new CommunityStore(pool,GUILD);
  await community.upsertResource('member',MEMBER,'Alice',{metadata:{bot:false}});
  const channel=(await community.upsertResource('text',CHANNEL,'问答')).ref;
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice')",[MEMBER]);
  store=new CommunityAgentStore(pool,GUILD);
  await store.saveSettings({...defaultAgentSettings(),enabled:true,channelRefs:[channel],cooldownSeconds:0},0,'admin');
  document=await store.saveDocument({title:'房间指南',content:'进入创建入口，即可创建临时房间。',published:true,expectedVersion:0},'admin');
});
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};}
const sourceMessage=()=>({id:SOURCE,guildId:GUILD,channelId:CHANNEL,channel:{type:ChannelType.GuildText},author:{id:MEMBER,bot:false},webhookId:null,system:false,content:`<@${BOT}> ${QUESTION}`}) as unknown as Message;
function setup() {
  const discord={authorize:vi.fn(async()=>true),send:vi.fn(async()=>({id:REPLY})),edit:vi.fn(async()=>{}),remove:vi.fn(async()=>{})};
  const answer=vi.fn<typeof answerAgentQuestion>(async()=>({answer:ANSWER,sourceRefs:[document.ref],insufficient:false}));
  const onError=vi.fn();
  const client=Object.assign(new EventEmitter(),{user:{id:BOT},isReady:()=>true}) as unknown as Client;
  // No store, retrieval or configuration mocks: production code goes through
  // the same PostgreSQL pool and D1 facade as the API and bot.
  const runtime=createCommunityAgentRuntime({pool,db:pgEnv.DB,client,guildId:GUILD,frontendUrl:'https://community.example',
    env:noAiEnv({AI_BASE_URL:'https://provider.example/v1',AI_MODEL:'fake-agent-model',AI_API_KEY:'test-provider-key'}),
    isReadOnly:()=>false,onError,dependencies:{discord,answer}});
  return{runtime,discord,answer,onError};
}
async function requestRow() {return (await pool.query('SELECT * FROM community_agent_requests WHERE guild_id=$1',[GUILD])).rows[0];}
async function waitForModel(started:Promise<void>,work:Promise<void>) {
  await Promise.race([started,work.then(()=>{throw new Error('Request finished before reaching its model call');})]);
}

describe('community agent runtime with PostgreSQL',()=>{
  it('reserves and claims once, persists its confirmed reply receipt and only stores metadata',async()=>{
    const s=setup();
    try {
      s.answer.mockImplementationOnce(async()=>{
        expect(await requestRow()).toMatchObject({status:'running',reply_message_id:REPLY});
        return{answer:ANSWER,sourceRefs:[document.ref],insufficient:false};
      });
      await s.runtime.handle(sourceMessage());
      expect(s.discord.send).toHaveBeenCalledTimes(1);expect(s.discord.send).toHaveBeenCalledWith(CHANNEL,expect.stringContaining('正在查找'),SOURCE);
      expect(s.discord.edit).toHaveBeenCalledExactlyOnceWith(CHANNEL,REPLY,`${ANSWER}\n\n来源：房间指南（v1）`);
      expect(s.answer).toHaveBeenCalledTimes(1);expect(s.onError).not.toHaveBeenCalled();
      const row=await requestRow();expect(row).toMatchObject({status:'succeeded',reply_message_id:REPLY,source_message_id:SOURCE,user_id:'alice'});
      expect(row.claim_token).toBeTruthy();expect(row.binding_id).toBeTruthy();
      expect((await store.diagnostics()).usage.total).toBe(1);
      const persisted=JSON.stringify((await pool.query('SELECT * FROM community_agent_requests')).rows);
      for(const text of[QUESTION,ANSWER,'question_marker','answer_marker','test-provider-key'])expect(persisted).not.toContain(text);
      const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='community_agent_requests'")).rows.map(row=>row.column_name);
      expect(columns).not.toContain('question');expect(columns).not.toContain('answer');
    } finally {await s.runtime.stop();}
  });

  it('allows unlinking while the model waits, then discards that old identity answer',async()=>{
    const s=setup(),started=deferred<void>(),release=deferred<AgentAnswer>();
    s.answer.mockImplementationOnce(async()=>{started.resolve();return release.promise;});
    const work=s.runtime.handle(sourceMessage());
    try {
      await waitForModel(started.promise,work);
      const writer=await pool.connect();
      try {
        await writer.query("SET lock_timeout='200ms'");
        // This would time out if the model held the delivery transaction open.
        expect((await writer.query('DELETE FROM discord_links WHERE discord_user_id=$1',[MEMBER])).rowCount).toBe(1);
      } finally {await writer.query('RESET lock_timeout');writer.release();}
      release.resolve({answer:ANSWER,sourceRefs:[document.ref],insufficient:false});await work;
      expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledExactlyOnceWith(CHANNEL,REPLY);
      expect(await requestRow()).toMatchObject({status:'canceled',error_code:'authorization_changed',reply_message_id:REPLY});
      expect(s.discord.send).toHaveBeenCalledTimes(1);expect((await store.diagnostics()).usage.total).toBe(1);
    } finally {release.resolve({answer:ANSWER,sourceRefs:[],insufficient:true});await s.runtime.stop();await work;}
  });

  it('withdraws published knowledge during generation and cancels the stale result',async()=>{
    const s=setup(),started=deferred<void>(),release=deferred<AgentAnswer>();
    s.answer.mockImplementationOnce(async()=>{started.resolve();return release.promise;});
    const work=s.runtime.handle(sourceMessage());
    try {
      await waitForModel(started.promise,work);
      await store.saveDocument({ref:document.ref,title:document.title,content:document.content,published:false,expectedVersion:document.version},'admin');
      expect(await store.publishedDocuments()).toEqual([]);
      release.resolve({answer:ANSWER,sourceRefs:[document.ref],insufficient:false});await work;
      expect(s.discord.edit).not.toHaveBeenCalled();expect(s.discord.remove).toHaveBeenCalledExactlyOnceWith(CHANNEL,REPLY);
      expect(await requestRow()).toMatchObject({status:'canceled',error_code:'knowledge_changed',reply_message_id:REPLY});
      expect(s.answer).toHaveBeenCalledTimes(1);expect(s.discord.send).toHaveBeenCalledTimes(1);
    } finally {release.resolve({answer:ANSWER,sourceRefs:[],insufficient:true});await s.runtime.stop();await work;}
  });

  it('deduplicates the same source during and after generation without a second POST, model or quota charge',async()=>{
    const s=setup(),started=deferred<void>(),release=deferred<AgentAnswer>();
    s.answer.mockImplementationOnce(async()=>{started.resolve();return release.promise;});
    const first=s.runtime.handle(sourceMessage());
    try {
      await waitForModel(started.promise,first);await s.runtime.handle(sourceMessage());
      release.resolve({answer:ANSWER,sourceRefs:[document.ref],insufficient:false});await first;await s.runtime.handle(sourceMessage());
      expect(s.discord.send).toHaveBeenCalledTimes(1);expect(s.discord.edit).toHaveBeenCalledTimes(1);expect(s.answer).toHaveBeenCalledTimes(1);
      expect(Number((await pool.query('SELECT count(*) AS count FROM community_agent_requests')).rows[0].count)).toBe(1);
      expect((await store.diagnostics()).usage.total).toBe(1);expect((await requestRow()).status).toBe('succeeded');
    } finally {release.resolve({answer:ANSWER,sourceRefs:[],insufficient:true});await s.runtime.stop();await first;}
  });
});
