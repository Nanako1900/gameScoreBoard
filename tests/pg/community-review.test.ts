import { beforeEach, describe, expect, it } from 'vitest';
import { buildEnv } from '../../server/src/api';
import { createCommunityRoutes } from '../../server/src/community/routes';
import { CommunityService } from '../../server/src/community/service';
import { CommunityStore } from '../../server/src/community/store';
import { signSession } from '../../worker/session';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const G='111111111111111111',MEMBER='222222222222222222',SECRET='community-review-secret-0123456789012345',ORIGIN='https://score.example.com';
const store=new CommunityStore(pool,G),service=new CommunityService(store,env.DB);
const admin={source:'web',userId:'admin'} as const;
let memberRef:string;
beforeEach(async()=>{await seedUser({id:'admin',admin:true});await seedUser({id:'member'});memberRef=(await store.upsertResource('member',MEMBER,'成员',{metadata:{bot:false}})).ref;});
async function uncertain(kind='room.create',roomRef:string|null=null){
 const op=await store.enqueue(kind,roomRef,{source:'discord',memberRef},{},crypto.randomUUID());const claim=await store.claim();
 expect(claim?.ref).toBe(op.ref);await store.finish(op.ref,claim!.claimToken!,{status:'needs_review',error:'execution_uncertain'});return op;
}
function routes(readOnly=false){return createCommunityRoutes({store,db:env.DB,env:{...buildEnv({OAUTH_BASE_URL:'https://id.example.com',OAUTH_CLIENT_ID:'client',OAUTH_CLIENT_SECRET:'secret',SESSION_SECRET:SECRET,APP_URL:'https://api.example.com',FRONTEND_ORIGIN:ORIGIN},env.DB),...(readOnly?{READ_ONLY:'1'}:{})}})}
async function request(ref:string,user='admin',body:unknown={confirm:true,requestKey:'review-one'},origin=ORIGIN,readOnly=false){return routes(readOnly).fetch(new Request(`https://api.example.com/api/admin/community/operations/${ref}/review`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'edg_session='+await signSession({sub:user},SECRET)},body:JSON.stringify(body)}))}

describe('conservative administrator reconciliation',()=>{
 it('acknowledges only the uncertain operation, leaving the room frozen and recording one audit',async()=>{
  const room=await store.createRoom(memberRef,'待对账房');await store.patchRoom(room.ref,{status:'needs_review'},room.version);const op=await uncertain('room.create',room.ref);
  const result=await store.acknowledgeOperation(op.ref,admin);expect(result).toMatchObject({status:'canceled',result:{reviewed:true},claimToken:null,error:null});
  expect((await store.getRoom(room.ref))?.status).toBe('needs_review');const raw=(await pool.query('SELECT lease_until,claim_token FROM community_operations WHERE ref=$1',[op.ref])).rows[0];expect(raw).toEqual({lease_until:null,claim_token:null});
  expect(await store.audit()).toEqual([expect.objectContaining({action:'operation.review',target:op.ref,outcome:'canceled'})]);
 });
 it('is idempotent for repeated and concurrent acknowledgments without adding duplicate audit rows',async()=>{
  const op=await uncertain();const results=await Promise.all([store.acknowledgeOperation(op.ref,admin),store.acknowledgeOperation(op.ref,admin)]);expect(results[0]).toEqual(results[1]);
  expect(await store.acknowledgeOperation(op.ref,admin)).toEqual(results[0]);expect(await store.audit()).toHaveLength(1);
 });
 it('rechecks the current users row rather than trusting a former admin session',async()=>{
  const op=await uncertain();await pool.query("UPDATE users SET is_admin=0 WHERE id='admin'");
  await expect(store.acknowledgeOperation(op.ref,admin)).rejects.toMatchObject({status:403});
  await expect(store.acknowledgeOperation(op.ref,{source:'web',userId:'member'})).rejects.toMatchObject({status:403});expect((await store.getOperation(op.ref))?.status).toBe('needs_review');expect(await store.audit()).toHaveLength(0);
 });
 it('does not cancel queued, in-flight or ordinary terminal work',async()=>{
  for(const status of ['queued','running','succeeded','failed','conflict','canceled']){
   const op=await store.enqueue('roles.set',null,{source:'discord',memberRef},{roleRefs:[]},status);
   await pool.query('UPDATE community_operations SET status=$2 WHERE ref=$1',[op.ref,status]);
   await expect(store.acknowledgeOperation(op.ref,admin)).rejects.toMatchObject({status:409});expect((await store.getOperation(op.ref))?.status).toBe(status);
  }
 });
 it('requires explicit confirmation in the service and HTTP body before acknowledging',async()=>{
  const op=await uncertain();await expect(service.reviewOperation(op.ref,'admin',false)).rejects.toMatchObject({status:400});
  for(const body of [{requestKey:'a'},{confirm:false,requestKey:'b'},{confirm:true},{confirm:true,requestKey:'x',action:'retry'}])expect((await request(op.ref,'admin',body)).status).toBe(400);
  expect((await store.getOperation(op.ref))?.status).toBe('needs_review');
 });
 it('returns a safe successful review receipt and repeats it for a new request key',async()=>{
  const op=await uncertain();const first=await request(op.ref);expect(first.status).toBe(200);const body=await first.json();expect(body).toMatchObject({operation:{ref:op.ref,status:'canceled',result:{reviewed:true}}});
  const again=await request(op.ref,'admin',{confirm:true,requestKey:'review-two'});expect(again.status).toBe(200);expect(await again.json()).toEqual(body);expect(JSON.stringify(body)).not.toMatch(/claimToken|externalId|discord_|\b\d{17,20}\b/);
 });
 it('treats an uncertain welcome as sent for the cooldown, never queues another send during review',async()=>{
  const joined=new Date().toISOString();const op=await store.enqueueWelcome(memberRef,joined,24);expect(op).not.toBeNull();const claim=await store.claim();await store.finish(op!.ref,claim!.claimToken!,{status:'needs_review',error:'execution_uncertain'});
  await store.acknowledgeOperation(op!.ref,admin);const slot=(await pool.query('SELECT pending_ref,last_sent_at FROM community_welcomes WHERE guild_id=$1 AND member_ref=$2',[G,memberRef])).rows[0];expect(slot.pending_ref).toBeNull();expect(slot.last_sent_at).not.toBeNull();
  expect(await store.enqueueWelcome(memberRef,new Date(Date.now()+1000).toISOString(),24)).toBeNull();expect(await store.listOperations()).toHaveLength(1);expect(await store.claim()).toBeNull();
 });
 it('does not acknowledge an operation from another guild or a missing reference',async()=>{
  const op=await uncertain();await expect(new CommunityStore(pool,'333333333333333333').acknowledgeOperation(op.ref,admin)).rejects.toMatchObject({status:404});await expect(store.acknowledgeOperation(crypto.randomUUID(),admin)).rejects.toMatchObject({status:404});
 });
 it('preserves route administrator, origin and maintenance protections',async()=>{
  const op=await uncertain();expect((await request(op.ref,'member')).status).toBe(403);expect((await request(op.ref,'admin',{confirm:true,requestKey:'x'},'https://evil.example')).status).toBe(403);expect((await request(op.ref,'admin',{confirm:true,requestKey:'x'},ORIGIN,true)).status).toBe(503);expect((await store.getOperation(op.ref))?.status).toBe('needs_review');
 });
});
