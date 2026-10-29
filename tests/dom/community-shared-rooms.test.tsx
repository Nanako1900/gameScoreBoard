import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityPage } from '../../src/components/CommunityPage';
import { CommunityAdminPage } from '../../src/components/CommunityAdminPage';
import { defaultCommunitySettings, type CommunityRoomView } from '../../shared/community';
import type { User } from '../../src/types';

const memberRef='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const otherRef='b10ebd61-dbd4-4804-aa54-021b345821c1';
const roomRef='3265bc08-259a-439f-9882-451464413270';
const categoryRef='43f9e27e-a4d6-4bc2-b2a8-afb3ccbe4f15';
const discordId='1114391825336250432';
const admin={id:'admin',username:'管理员',is_admin:true} as User;
const stamp='2026-10-29T00:00:00Z';
let settings=defaultCommunitySettings();
let rooms:CommunityRoomView[]=[];
const operation={ref:roomRef,kind:'room.managers',status:'queued',error:null,result:null,roomRef,createdAt:stamp,finishedAt:null};
function fixed(overrides:Partial<CommunityRoomView>={}):CommunityRoomView {
 return {ref:roomRef,name:'固定私人房',owner:null,members:[],kind:'fixed',managers:[{ref:otherRef,name:'已分配的管理者'}],status:'active',visibility:'hidden',userLimit:4,version:7,canManage:true,canClaim:false,transferTo:null,cleanupAt:null,createdAt:stamp,updatedAt:stamp,...overrides};
}
beforeEach(()=>{
 settings=defaultCommunitySettings();rooms=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);const runtime={ready:true,appliedVersion:2,syncedAt:stamp,problem:null};
  let body:unknown={settings,version:2,runtime,me:{linked:true,member:{ref:memberRef,name:'小明'},isAdmin:false,needsMembership:false}};
  if(path.endsWith('/rooms'))body={rooms};
  if(path.includes('/resources'))body={resources:[{ref:categoryRef,name:'固定私人房间分类',kind:'category',available:true}]};
  if(path.endsWith('/roles'))body={choices:[],selectedRefs:[],maxChoices:5,enabled:true};
  if(path.endsWith('/fun'))body={items:[]};
  if(path.endsWith('/operations'))body={operations:[]};
  if(path.endsWith('/audit'))body={audit:[]};
  if(path.includes('/operations/'))body={operation:{...operation,status:'succeeded'}};
  if(init?.method==='POST')body={settings:JSON.parse(String(init.body)).settings??settings,version:3,runtime,operation};
  return Response.json(body,{status:init?.method==='POST'?202:200});
 }));
});

it('lets any authorized visible temporary-room member use all controls including confirmed occupied closure',async()=>{
 rooms=[fixed({kind:'temporary',name:'共享临时房',owner:{ref:otherRef,name:'创建者'},members:[{ref:otherRef,name:'创建者'}]})];
 render(<CommunityPage tab="rooms" accountKey="member"/>);await screen.findByText('共享临时房');
 fireEvent.click(screen.getByText('网页辅助管理'));expect(screen.getByRole('button',{name:'邀请接任房主'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'关闭有人房间…'}));expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'确认移动并关闭'}));await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({action:'admin_delete',confirm:true,expectedVersion:7});
});

it('shows fixed-room managers and excludes every ownership or deletion flow',async()=>{
 rooms=[fixed({canClaim:true,transferTo:{ref:memberRef,name:'小明'},cleanupAt:stamp,panelProblem:'控制卡缺少读取消息历史权限，请检查频道权限。'})];
 render(<CommunityPage tab="rooms" accountKey="member"/>);await screen.findByText('固定私人房');
 expect(screen.getByText('固定房间 · 不会自动删除')).toBeInTheDocument();expect(screen.getByText('房间管理员：已分配的管理者')).toBeInTheDocument();
 expect(screen.queryByText(/等待认领|空房待回收|房主/)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'认领这个房间'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'接受房主转让'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('网页辅助管理'));
 for(const name of ['邀请接任房主','解散空房','关闭有人房间…'])expect(screen.queryByRole('button',{name})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'保存名字'})).toBeInTheDocument();expect(screen.getByText('控制卡缺少读取消息历史权限，请检查频道权限。')).toBeInTheDocument();expect(screen.queryByText(/会自动修复/)).not.toBeInTheDocument();
});

it('keeps unassigned fixed-room viewers read-only even when currently inside',async()=>{
 rooms=[fixed({canManage:false,managers:[],members:[{ref:memberRef,name:'小明'}]})];
 render(<CommunityPage tab="rooms" accountKey="member"/>);await screen.findByText('固定私人房');
 expect(screen.getByText('房间管理员：尚未分配')).toBeInTheDocument();expect(screen.queryByText('网页辅助管理')).not.toBeInTheDocument();
});

it('keeps fixed categories folded and saves only opaque category references',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const choice=screen.getByRole('checkbox',{name:'固定私人房间分类'});expect(choice).not.toBeVisible();
 fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body)).settings.rooms.fixedCategoryRefs).toEqual([categoryRef]);
 expect(String(post?.[1]?.body)).not.toContain(discordId);
});

it('submits a replacement fixed-room manager list without refilling raw IDs or saving them in configuration',async()=>{
 rooms=[fixed()];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 const input=screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'});fireEvent.change(input,{target:{value:`${discordId},\n${discordId}`}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));
 expect(input).toHaveValue('');await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(String(post?.[0])).toBe(`/api/community/rooms/${roomRef}/actions`);expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({action:'managers',discordIds:[discordId],expectedVersion:7});
 expect(document.body.textContent).not.toContain(discordId);expect(screen.getByText('当前管理员：已分配的管理者')).toBeInTheDocument();
});

it('requires explicit confirmation to clear fixed-room managers and keeps invalid IDs out of error text',async()=>{
 rooms=[fixed()];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 const input=screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'});fireEvent.change(input,{target:{value:'invalid-private-id'}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));
 expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 Discord 用户 ID');expect(screen.getByRole('alert')).not.toHaveTextContent('invalid-private-id');
 fireEvent.change(input,{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'确认清空管理员'}));await screen.findByText('已提交，等待机器人执行');const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({action:'managers',discordIds:[]});
});

it('forgets transient manager IDs after changing administrator accounts',async()=>{
 rooms=[fixed()];const view=render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 fireEvent.change(screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'}),{target:{value:discordId}});view.rerender(<CommunityAdminPage me={{...admin,id:'other-admin'}}/>);
 await waitFor(()=>expect(screen.queryByDisplayValue(discordId)).not.toBeInTheDocument());expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});

it('does not mix transient manager IDs into the full settings save and clears them on a room version change',async()=>{
 rooms=[fixed()];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 fireEvent.change(screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'}),{target:{value:discordId}});fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(String(post?.[1]?.body)).not.toContain(discordId);expect(String(post?.[0])).toBe('/api/admin/community');
 rooms=[fixed({version:8})];fireEvent.focus(window);await waitFor(()=>expect(screen.queryByDisplayValue(discordId)).not.toBeInTheDocument());
});

it('isolates a failed fixed-room read while preserving the unsaved configuration',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.change(screen.getByRole('textbox',{name:'社区 AI 提示词'}),{target:{value:'仍然保留的设置草稿'}});
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/rooms')?Promise.resolve(Response.json({error:'同步暂不可用'},{status:503})):original(input,init));fireEvent.focus(window);
 expect(await screen.findByText('固定房间列表暂不可用，请刷新后重试。')).toBeInTheDocument();expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue('仍然保留的设置草稿');expect(screen.getByRole('button',{name:'保存社区设置'})).toBeInTheDocument();
});

it('clears private configuration and transient IDs if the room read revokes administrator access',async()=>{
 rooms=[fixed()];const original=vi.mocked(fetch).getMockImplementation()!;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 fireEvent.change(screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'}),{target:{value:discordId}});
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/rooms')?Promise.resolve(Response.json({error:'无权访问'},{status:403})):original(input,init));fireEvent.focus(window);
 await waitFor(()=>expect(screen.queryByRole('button',{name:'保存社区设置'})).not.toBeInTheDocument());expect(screen.queryByDisplayValue(discordId)).not.toBeInTheDocument();expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument();
});

it('limits a fixed-room replacement to twenty managers and shows the safe panel diagnostic',async()=>{
 rooms=[fixed({panelProblem:'控制卡缺少发送消息或嵌入链接权限，请检查频道权限。'})];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('固定私人房'));
 const ids=Array.from({length:21},(_,index)=>(BigInt(discordId)+BigInt(index)).toString());
 const input=screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'});fireEvent.change(input,{target:{value:ids.join('\n')}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));
 expect(screen.getByRole('alert')).toHaveTextContent('每次最多分配 20 位房间管理员');expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
 fireEvent.change(input,{target:{value:ids.slice(0,20).join('\n')}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body)).discordIds).toHaveLength(20);expect(input).toHaveValue('');
 expect(screen.getByText('控制卡缺少发送消息或嵌入链接权限，请检查频道权限。')).toBeInTheDocument();
});
