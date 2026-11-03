import {Hono} from 'hono';
import {describe,expect,it} from 'vitest';
import {createApiHost,isCommunityPath} from '../src/api-host';
import {createClient} from '../src/discord/gateway';
import {GatewayIntentBits} from 'discord.js';
describe('community host integration',()=>{
 it('routes exact and encoded community prefixes before the Worker',async()=>{
  const links=new Hono();links.all('*',c=>c.text('links'));
  const community=new Hono();community.all('*',c=>c.text('community'));
  const fetch=createApiHost({linkRoutes:links,communityRoutes:community,workerFetch:async()=>new Response('worker')});
  for(const path of ['/api/community','/api/community/rooms','/api/admin/community','/api/%63ommunity/rooms']){
   expect(isCommunityPath('https://api.test'+path)).toBe(true);expect(await(await fetch(new Request('https://api.test'+path))).text()).toBe('community');
  }
  expect(await(await fetch(new Request('https://api.test/api/communityish'))).text()).toBe('worker');
 });
 it('requests community member and message events without content or presence privileges',async()=>{
  const ordinary=createClient();const community=createClient({community:true});
  try{expect(ordinary.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);expect(ordinary.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(false);expect(community.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(true);expect(community.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);expect(community.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);expect(community.options.intents.has(GatewayIntentBits.GuildPresences)).toBe(false);}finally{await ordinary.destroy();await community.destroy();}
 });
});
