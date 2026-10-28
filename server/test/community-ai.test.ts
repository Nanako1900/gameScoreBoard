import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { AI_SETTING_KEYS } from '../../worker/ai/config';
import { sealAiApiKey } from '../../worker/ai/secrets';
import { requestCommunitySuggestions } from '../src/community/fun-service';

const SECRET='provider-private-key';
const MASTER=Buffer.alloc(32,7).toString('base64');
function settings(){const s=defaultCommunitySettings();s.enabled=true;s.fun.ai.enabled=true;s.fun.ai.prompt='COMMUNITY_ONLY_PROMPT';return s}
function db(rows:Record<string,string>={}){return {prepare:()=>({all:async()=>({results:Object.entries(rows).map(([key,value])=>({key,value}))})})} as unknown as D1Database}
const env={AI_BASE_URL:'https://provider.example/v1',AI_MODEL:'community-model',AI_API_KEY:SECRET};
const reply=(content:string)=>new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200});

it('uses saved encrypted provider credentials while the judicial AI switch is off',async()=>{
 const sealed=await sealAiApiKey(SECRET,MASTER);
 const stored=db({[AI_SETTING_KEYS.enabled]:'false',[AI_SETTING_KEYS.baseUrl]:'https://saved.example/v1',[AI_SETTING_KEYS.model]:'saved-model',[AI_SETTING_KEYS.apiKeyEncrypted]:sealed,[AI_SETTING_KEYS.prompt]:'JUDICIAL_DO_NOT_SEND',[AI_SETTING_KEYS.classifyPrompt]:'CASE_DO_NOT_SEND'});
 const fetcher=vi.fn(async()=>reply('{"suggestions":["星光小屋","海边茶话室"]}'));
 const result=await requestCommunitySuggestions({theme:'星空',purpose:'room_name'},settings(),{db:stored,fetcher,env:{...env,AI_CONFIG_MASTER_KEY:MASTER}});
 expect(result).toEqual({source:'ai',suggestions:['星光小屋','海边茶话室']});
 const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://saved.example/v1/chat/completions');
 expect(request.headers).toMatchObject({Authorization:`Bearer ${SECRET}`});
 const payload=JSON.parse(request.body as string);expect(payload.model).toBe('saved-model');expect(payload.messages).toHaveLength(2);
 expect(payload.messages[0].content).toContain('COMMUNITY_ONLY_PROMPT');expect(payload.messages[1].content).toContain('星空');
 expect(JSON.stringify(payload)).not.toMatch(/JUDICIAL_DO_NOT_SEND|CASE_DO_NOT_SEND|voice_sessions|records/);
 expect(JSON.stringify(result)).not.toContain(SECRET);
});
it('never revives an environment key after the stored credential was cleared',async()=>{
 const fetcher=vi.fn();const cleared=db({[AI_SETTING_KEYS.apiKeyEncrypted]:JSON.stringify({v:1,state:'cleared'})});
 const result=await requestCommunitySuggestions({theme:'星空',purpose:'topic'},settings(),{db:cleared,fetcher,env});
 expect(result.source).toBe('fallback');expect(result.suggestions.length).toBeGreaterThan(0);expect(fetcher).not.toHaveBeenCalled();
});
it('redacts provider keys after decoding model JSON as well as before parsing it',async()=>{
 const fetcher=vi.fn(async()=>reply('{"suggestions":["provider-pri\\u0076ate-key","星光小屋"]}'));
 const result=await requestCommunitySuggestions({theme:'星空',purpose:'room_name'},settings(),{db:db(),fetcher,env});
 expect(result).toEqual({source:'ai',suggestions:['星光小屋']});expect(JSON.stringify(result)).not.toMatch(/provider|已隐藏/);
});
it.each(['http','json','empty','mentions'] as const)('falls back safely for %s provider failure without upstream details',async kind=>{
 const fetcher=vi.fn(async()=>kind==='http'?new Response(`upstream ${SECRET} channel 123456789012345678`,{status:500}):kind==='json'?new Response('not json',{status:200}):reply(kind==='empty'?'':'{"suggestions":["@everyone","https://example.com"]}'));
 const result=await requestCommunitySuggestions({theme:'星空',purpose:'topic'},settings(),{db:db(),fetcher,env});
 expect(result.source).toBe('fallback');expect(result.suggestions.length).toBeGreaterThan(0);
 expect(JSON.stringify(result)).not.toMatch(/upstream|provider-private|123456789012345678|@everyone|https/);
});
it('aborts a hanging provider and returns the administrator topic-bank fallback',async()=>{
 const s=settings();s.fun.topics=[{ref:'c2845d73-47cc-4037-966c-61ce46e26777',text:'推荐一款合作游戏？',tags:['游戏']}];
 let aborted=false;
 const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('secret error'))},{once:true})}));
 const result=await requestCommunitySuggestions({theme:'合作',purpose:'topic'},s,{db:db(),fetcher,env,timeoutMs:1});
 expect(aborted).toBe(true);expect(result).toEqual({source:'fallback',suggestions:['推荐一款合作游戏？']});
});
it('does not call a provider while the independent community AI feature is disabled',async()=>{
 const s=settings();s.fun.ai.enabled=false;const fetcher=vi.fn();
 await expect(requestCommunitySuggestions({theme:'星空',purpose:'topic'},s,{db:db(),fetcher,env})).rejects.toMatchObject({status:409});
 expect(fetcher).not.toHaveBeenCalled();
});
