import type { CommunityJson } from '../../../shared/community';
import type { CommunityMembershipService } from './membership';
import {CommunityStoreError,type StoredOperation} from './store';
interface ExtraDeps {membership:Pick<CommunityMembershipService,'setRoles'|'sendWelcome'>}
export async function executeCommunityExtra(deps:ExtraDeps,op:StoredOperation,actor:{memberRef:string|null;isAdmin:boolean},beforeEffect?:()=>Promise<void>):Promise<CommunityJson> {
 if(op.kind.startsWith('fun.'))throw new CommunityStoreError(410,'feature_retired','趣味工具已下线');
 const payload=op.payload&&typeof op.payload==='object'&&!Array.isArray(op.payload)?op.payload:{};
 if(op.kind==='welcome.send') {
  if(op.actor.source!=='system')throw new CommunityStoreError(403,'forbidden','欢迎消息只由入服事件触发');
  return deps.membership.sendWelcome(op);
 }
 if(!actor.memberRef)throw new CommunityStoreError(403,'membership_required','需要当前服务器成员身份');
 if(op.kind==='roles.set')return deps.membership.setRoles(actor.memberRef,payload.roleRefs as string[],op,beforeEffect);
 throw new CommunityStoreError(400,'invalid_input','不支持此社区操作');
}
