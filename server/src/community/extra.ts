import type { CommunityJson, CommunityTool } from '../../../shared/community';
import type { CommunityFunService } from './fun-service';
import type { CommunityMembershipService } from './membership';
import {CommunityStoreError,type StoredOperation} from './store';
import {publicCommunityJson} from './security';
interface ExtraDeps {membership:Pick<CommunityMembershipService,'setRoles'|'sendWelcome'>;fun:Pick<CommunityFunService,'create'|'vote'|'close'|'redraw'>}
export async function executeCommunityExtra(deps:ExtraDeps,op:StoredOperation,actor:{memberRef:string|null;isAdmin:boolean},beforeEffect?:()=>Promise<void>):Promise<CommunityJson> {
 const payload=op.payload&&typeof op.payload==='object'&&!Array.isArray(op.payload)?op.payload:{};
 if(op.kind==='welcome.send') {
  if(op.actor.source!=='system')throw new CommunityStoreError(403,'forbidden','欢迎消息只由入服事件触发');
  return deps.membership.sendWelcome(op);
 }
 if(!actor.memberRef)throw new CommunityStoreError(403,'membership_required','需要当前服务器成员身份');
 if(op.kind==='roles.set')return deps.membership.setRoles(actor.memberRef,payload.roleRefs as string[],op,beforeEffect);
 const current={memberRef:actor.memberRef,isAdmin:actor.isAdmin};
 const item=op.kind==='fun.create'?await deps.fun.create(payload.kind as CommunityTool,payload.input,current,typeof payload.roomRef==='string'?payload.roomRef:null)
  :op.kind==='fun.vote'?await deps.fun.vote(String(payload.ref),Number(payload.choice),current)
  :op.kind==='fun.close'?await deps.fun.close(String(payload.ref),current)
  :op.kind==='fun.redraw'?await deps.fun.redraw(String(payload.ref),current):null;
 if(!item)throw new CommunityStoreError(400,'invalid_input','不支持此社区操作');
 return {item:publicCommunityJson(item as unknown as CommunityJson)};
}
