import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { CommunityMembershipService } from '../src/community/membership';
import type { CommunityStore } from '../src/community/store';
import type { CommunityDiscord } from '../src/community/discord';
const memberRef='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const roleRef='b10ebd61-dbd4-4804-aa54-021b345821c1';
function fixture() {
 const settings=defaultCommunitySettings(); settings.enabled=true;settings.roles.enabled=true;settings.roles.allowedRefs=[roleRef];
 const resource={ref:memberRef,kind:'member',externalId:'1114391825336250432',available:true,name:'成员',metadata:{}};
 const role={ref:roleRef,kind:'role',externalId:'1114391825336250433',available:true,safe:true,name:'游戏',metadata:{}};
 const query=vi.fn().mockResolvedValue({rows:[],rowCount:0});
 const store={guildId:'guild',settings:async()=>({settings}),resource:async(ref:string)=>ref===memberRef?resource:ref===roleRef?role:null,
  storedResources:async()=>[role],pool:{query},addAudit:vi.fn()};
 const discord={member:vi.fn().mockResolvedValue({id:resource.externalId,name:'成员',roleIds:[],bot:false}),snapshot:vi.fn().mockResolvedValue({ready:true,resources:[{id:role.externalId,kind:'role',safe:true,available:true}],members:[]}),addRole:vi.fn(),removeRole:vi.fn()};
 return {settings,store,discord,query,service:new CommunityMembershipService(store as unknown as CommunityStore,discord as unknown as CommunityDiscord)};
}
describe('community self-service roles',()=>{
 it('uses the allowlist and freshly verified safe roles, never an arbitrary role',async()=>{
  const f=fixture();await f.service.setRoles(memberRef,[roleRef]);expect(f.discord.addRole).toHaveBeenCalledWith('1114391825336250432','1114391825336250433');
  await expect(f.service.setRoles(memberRef,['c2845d73-47cc-4037-966c-61ce46e26777'])).rejects.toThrow();
 });
 it('rejects roles which became privileged after configuration',async()=>{
  const f=fixture();f.discord.snapshot.mockResolvedValue({ready:true,resources:[{id:'1114391825336250433',kind:'role',safe:false,available:true}],members:[]});
  await expect(f.service.setRoles(memberRef,[roleRef])).rejects.toThrow();expect(f.discord.addRole).not.toHaveBeenCalled();
 });
 it('requires current server membership and enforces choice limits',async()=>{
  const f=fixture();f.discord.member.mockResolvedValue(null);
  await expect(f.service.setRoles(memberRef,[roleRef])).rejects.toThrow();expect(f.discord.addRole).not.toHaveBeenCalled();
 });
 it('does not remove a role the bot did not assign when selecting an empty list',async()=>{
  const f=fixture();f.discord.member.mockResolvedValue({id:'1114391825336250432',name:'成员',roleIds:['1114391825336250433'],bot:false});
  await f.service.setRoles(memberRef,[]);expect(f.discord.removeRole).not.toHaveBeenCalled();
 });
});
