import {describe,expect,it,vi} from 'vitest';
import {executeCommunityExtra} from '../src/community/extra';
import type {StoredOperation} from '../src/community/store';
const actor={memberRef:'ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb',isAdmin:false};
function deps(){return {membership:{setRoles:vi.fn().mockResolvedValue({selectedRefs:[]}),sendWelcome:vi.fn().mockResolvedValue({sent:true})},fun:{create:vi.fn().mockResolvedValue({ref:'ref',kind:'roll',data:{total:3}}),vote:vi.fn(),close:vi.fn(),redraw:vi.fn()}};}
const op=(kind:string,payload:unknown={},source='web')=>({kind,payload,actor:{source},claimToken:'claim'}) as StoredOperation;
describe('community extra job dispatch',()=>{
 it('passes the lease and current identity to self-role execution',async()=>{const d=deps();const job=op('roles.set',{roleRefs:[]});await executeCommunityExtra(d,job,actor);expect(d.membership.setRoles).toHaveBeenCalledWith(actor.memberRef,[],job,undefined);});
 it('does not allow ordinary queued requests to masquerade as welcome events',async()=>{const d=deps();await expect(executeCommunityExtra(d,op('welcome.send'),actor)).rejects.toThrow();expect(d.membership.sendWelcome).not.toHaveBeenCalled();});
 it('returns a safe result item without doing anything to room names automatically',async()=>{const d=deps();expect(await executeCommunityExtra(d,op('fun.create',{kind:'roll',input:{count:1,sides:6}}),actor)).toEqual({item:{ref:'ref',kind:'roll',data:{total:3}}});expect(d.fun.create).toHaveBeenCalledWith('roll',{count:1,sides:6},actor,null);});
});
