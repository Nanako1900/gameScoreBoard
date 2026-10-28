import { beforeEach, describe, expect, it } from 'vitest';
import { CommunityService } from '../../server/src/community/service';
import { CommunityStore } from '../../server/src/community/store';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const G='111111111111111111', A='222222222222222222', B='333333333333333333';
const store=new CommunityStore(pool,G),service=new CommunityService(store,env.DB);
let memberRef:string,otherRef:string;
beforeEach(async()=>{
 await seedUser({id:'alice'});await seedUser({id:'admin',admin:true});
 memberRef=(await store.upsertResource('member',A,'Alice',{metadata:{bot:false}})).ref;
 otherRef=(await store.upsertResource('member',B,'Other',{metadata:{bot:false}})).ref;
 await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice')",[A]);
 await store.setRuntime({ready:true});
});
async function operation(kind='fun.create',roomRef:string|null=null){
 const op=await store.enqueue(kind,roomRef,{source:'web',userId:'alice',memberRef},{kind:'ai'},'privacy-'+kind);
 const claimed=await store.claim();await store.finish(op.ref,claimed!.claimToken!,{status:'succeeded',result:{item:{title:'仅原成员可见的主题',kind:'ai'}}});return op;
}
describe('community operation receipts follow current identity and access',()=>{
 it('does not reveal a roomless AI result after unlinking, despite the same Nanako user id',async()=>{
  const op=await operation();expect((await service.operation(op.ref,'alice')).status).toBe('succeeded');
  await pool.query("DELETE FROM discord_links WHERE user_id='alice'");
  await expect(service.operation(op.ref,'alice')).rejects.toMatchObject({status:404});
 });
 it('does not transfer a previous identity result to a newly bound Discord member',async()=>{
  const op=await operation();await pool.query("UPDATE discord_links SET discord_user_id=$1 WHERE user_id='alice'",[B]);
  await expect(service.operation(op.ref,'alice')).rejects.toMatchObject({status:404});
 });
 it('does not show privileged operation payloads after administrator access is revoked',async()=>{
  for(const kind of ['settings.apply','resources.sync','panel.refresh','room.admin_delete']){
   const op=await store.enqueue(kind,null,{source:'web',userId:'admin'},{},kind);
   await pool.query("UPDATE users SET is_admin=0 WHERE id='admin'");
   await expect(service.operation(op.ref,'admin')).rejects.toMatchObject({status:404});
   await pool.query("UPDATE users SET is_admin=1 WHERE id='admin'");
  }
 });
 it('lets the original owner read a successful dissolve receipt after the room is closed',async()=>{
  const room=await store.createRoom(memberRef,'私密名称',{visibility:'hidden'});const active=await store.patchRoom(room.ref,{status:'active'},room.version);
  const op=await operation('room.dissolve',room.ref);await store.patchRoom(room.ref,{status:'closed'},active.version);
  const receipt=await service.operation(op.ref,'alice');expect(receipt.status).toBe('succeeded');expect(JSON.stringify(receipt)).not.toContain('私密名称');expect(JSON.stringify(receipt)).not.toContain('仅原成员可见的主题');
 });
 it('keeps a closed hidden-room receipt private after access is withdrawn',async()=>{
  const room=await store.createRoom(otherRef,'隐藏房',{visibility:'hidden'});await store.setRoomAccess(room.ref,memberRef,{allowed:true});
  const op=await operation('room.rename',room.ref);await store.patchRoom(room.ref,{status:'closed'},room.version);await store.setRoomAccess(room.ref,memberRef,{blocked:true});
  await expect(service.operation(op.ref,'alice')).rejects.toMatchObject({status:404});
 });
 it('requires current membership even while a link remains stored',async()=>{
  const op=await operation();await store.upsertResource('member',A,'Alice',{available:false,metadata:{bot:false}});
  await expect(service.operation(op.ref,'alice')).rejects.toMatchObject({status:404});
 });
 it('still permits a current administrator to review operation receipts',async()=>{
  const op=await operation();expect((await service.operation(op.ref,'admin')).status).toBe('succeeded');
 });
});
