import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe,expect,it } from 'vitest';
import worker from '../../worker/index';
import { noAiEnv } from './helpers';
describe('community is absent on the legacy D1 backend',()=>{
 it.each(['/api/community','/api/community/rooms','/api/community/roles','/api/community/fun','/api/admin/community','/api/admin/community/resources'])('%s returns a JSON404 without reading PostgreSQL tables',async path=>{
  const ctx=createExecutionContext();const response=await worker.fetch(new Request('https://score.example.com'+path),noAiEnv(),ctx);await waitOnExecutionContext(ctx);
  expect(response.status).toBe(404);expect(await response.json()).toEqual({error:'Not found'});
 });
});
