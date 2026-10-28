import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityPage } from '../../src/components/CommunityPage';
import { defaultCommunitySettings } from '../../shared/community';
const memberRef='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const roleRef='b10ebd61-dbd4-4804-aa54-021b345821c1';
const settings=defaultCommunitySettings();settings.enabled=true;settings.rooms.enabled=true;settings.roles.enabled=true;
const overview={settings:{...settings,fun:{...settings.fun,tags:['游戏']}},version:1,runtime:{ready:true,appliedVersion:1,syncedAt:new Date().toISOString(),problem:null},me:{linked:true,member:{ref:memberRef,name:'小明'},isAdmin:false,needsMembership:false}};
beforeEach(()=>{
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);let body:unknown=overview;
  if(path.endsWith('/rooms')) body={rooms:[]};
  if(path.endsWith('/roles')) body={choices:[{ref:roleRef,name:'一起玩游戏',available:true}],selectedRefs:[],maxChoices:5,enabled:true};
  if(path.endsWith('/resources?kind=member'))body={resources:[]};
  if(path.endsWith('/fun'))body={items:[]};
  if(init?.method==='POST')body={operation:{ref:roleRef,kind:'roles.set',status:'queued',error:null,result:null}};
  return Response.json(body);
 }));
});
describe('community member center',()=>{
 it('shows one clear room entry and the pending execution state',async()=>{
  render(<CommunityPage tab="rooms" accountKey="member" />);
  expect(await screen.findByRole('heading',{name:'我的社区'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'创建语音房'}));
  expect(await screen.findByText('已提交，等待机器人执行')).toBeInTheDocument();
  expect(screen.queryByText('创建成功')).not.toBeInTheDocument();
 });
 it('allows selecting self roles but requires explicit save',async()=>{
  render(<CommunityPage tab="roles" accountKey="member" />);
  fireEvent.click(await screen.findByRole('checkbox',{name:'一起玩游戏'}));
  const fetchMock=vi.mocked(fetch);expect(fetchMock.mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'保存身份'}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(call=>call[1]?.method==='POST')).toBe(true));
 });
 it('hides all controls when old backend returns 404',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'Not found'},{status:404})));
  render(<CommunityPage tab="rooms" accountKey="member" />);
  expect(await screen.findByText('当前服务暂未提供社区功能')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();
 });
 it('requires binding before website controls and does not leak cached private contents on account change',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({...overview,me:{linked:false,member:null,isAdmin:false,needsMembership:false}})));
  render(<CommunityPage tab="rooms" accountKey="other" />);
  expect(await screen.findByText('先绑定 Discord，再从网页管理社区')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();
 });
});
it('keeps rooms usable when fun is disabled and its endpoint is absent',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/community'?Promise.resolve(Response.json({...overview,settings:{...overview.settings,fun:{...overview.settings.fun,enabled:false}}})):String(input).endsWith('/fun')?Promise.resolve(Response.json({error:'互动未启用'},{status:404})):original(input,init));
 render(<CommunityPage tab="rooms" accountKey="member"/>);expect(await screen.findByRole('button',{name:'创建语音房'})).toBeInTheDocument();
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).endsWith('/fun'))).toBe(false);
});
it('isolates missing individual features and does not hide the entire community',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/fun')?Promise.resolve(Response.json({error:'互动未提供'},{status:404})):original(input,init));
 const view=render(<CommunityPage tab="rooms" accountKey="member"/>);expect(await screen.findByRole('button',{name:'创建语音房'})).toBeInTheDocument();
 view.rerender(<CommunityPage tab="play" accountKey="member"/>);expect(await screen.findByText('趣味工具暂未开放。')).toBeInTheDocument();
});
it('clears previous operations and private rooms after the same account loses its binding',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/rooms')&&init?.method!=='POST'?Promise.resolve(Response.json({rooms:[{ref:roleRef,name:'只有成员可见的旧房间',owner:{ref:roleRef,name:'另一位'},members:[],status:'active',visibility:'hidden',userLimit:0,version:1,canManage:false,canClaim:false,transferTo:null,cleanupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]})):original(input,init));
 render(<CommunityPage tab="rooms" accountKey="same"/>);fireEvent.click(await screen.findByRole('button',{name:'创建语音房'}));await screen.findByText('已提交，等待机器人执行');await screen.findByText('只有成员可见的旧房间');
 vi.mocked(fetch).mockResolvedValue(Response.json({...overview,me:{linked:false,member:null,isAdmin:false,needsMembership:false}}));fireEvent.focus(window);
 expect(await screen.findByText('先绑定 Discord，再从网页管理社区')).toBeInTheDocument();
 expect(screen.queryByText('已提交，等待机器人执行')).not.toBeInTheDocument();expect(screen.queryByText('只有成员可见的旧房间')).not.toBeInTheDocument();
 vi.mocked(fetch).mockImplementation(async(input)=>String(input)==='/api/community'?Response.json(overview):String(input).endsWith('/rooms')?Response.json({rooms:[]}):String(input).includes('/resources')?Response.json({resources:[]}):String(input).endsWith('/roles')?Response.json({choices:[],selectedRefs:[],enabled:true,maxChoices:5}):Response.json({items:[]}));fireEvent.focus(window);
 expect(await screen.findByRole('button',{name:'创建语音房'})).toBeEnabled();expect(screen.queryByText('已提交，等待机器人执行')).not.toBeInTheDocument();
});
it('drops cached member controls immediately when a write returns forbidden',async()=>{
 render(<CommunityPage tab="rooms" accountKey="same"/>);await screen.findByRole('button',{name:'创建语音房'});
 vi.mocked(fetch).mockResolvedValue(Response.json({error:'需要当前服务器成员身份'},{status:403}));fireEvent.click(screen.getByRole('button',{name:'创建语音房'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('需要当前服务器成员身份');expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();
});
it('labels roomless AI as private and keeps ordinary tool results community-visible',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/community'?Promise.resolve(Response.json({...overview,settings:{...overview.settings,fun:{...overview.settings.fun,ai:{...overview.settings.fun.ai,enabled:true}}}})):original(input,init));
 render(<CommunityPage tab="play" accountKey="member"/>);fireEvent.click(await screen.findByRole('button',{name:'AI 灵感'}));
 expect(screen.getByRole('option',{name:'仅自己和管理员可见'})).toBeInTheDocument();expect(screen.queryByRole('option',{name:'社区成员可见'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'骰子'}));expect(screen.getByRole('option',{name:'社区成员可见'})).toBeInTheDocument();
});

it('ignores a late queued response from before the same account binding changed',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;let finish!:(response:Response)=>void;
 vi.mocked(fetch).mockImplementation((input,init)=>init?.method==='POST'?new Promise(resolve=>{finish=resolve}):original(input,init));
 render(<CommunityPage tab="rooms" accountKey="same"/>);fireEvent.click(await screen.findByRole('button',{name:'创建语音房'}));
 vi.mocked(fetch).mockResolvedValue(Response.json({...overview,me:{linked:false,member:null,isAdmin:false,needsMembership:false}}));fireEvent.focus(window);await screen.findByText('先绑定 Discord，再从网页管理社区');
 vi.mocked(fetch).mockImplementation(original);fireEvent.focus(window);await screen.findByRole('button',{name:'创建语音房'});
 finish(Response.json({operation:{ref:roleRef,kind:'room.create',status:'queued',error:null,result:null}}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'创建语音房'})).toBeEnabled());expect(screen.queryByText('已提交，等待机器人执行')).not.toBeInTheDocument();
});
it('queues joining an active visible room with its version and asks for an existing voice connection',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 const room={ref:roleRef,name:'周末闲聊',owner:{ref:roleRef,name:'另一位'},members:[],status:'active',visibility:'open',userLimit:0,version:7,canManage:false,canClaim:false,transferTo:null,cleanupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/rooms')&&init?.method!=='POST'?Promise.resolve(Response.json({rooms:[room,{...room,ref:memberRef,name:'旧房间',status:'closed'}]})):original(input,init));
 render(<CommunityPage tab="rooms" accountKey="member"/>);await screen.findByText('周末闲聊');
 expect(screen.getAllByRole('button',{name:'加入语音房'})).toHaveLength(1);expect(screen.getByText('先连接服务器内的语音频道，再加入此房间。')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'加入语音房'}));await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(String(post?.[0])).toBe(`/api/community/rooms/${roleRef}/actions`);expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({action:'join',expectedVersion:7});
 expect(screen.queryByText('已加入语音房')).not.toBeInTheDocument();
});
it('keeps existing rooms and role exits available while the whole community is paused',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 const paused={...overview,settings:{...overview.settings,enabled:false}};
 const room={ref:roleRef,name:'暂停时仍保留的房间',owner:{ref:memberRef,name:'小明'},members:[],status:'active',visibility:'open',userLimit:0,version:2,canManage:true,canClaim:false,transferTo:null,cleanupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/community'?Promise.resolve(Response.json(paused)):String(input).endsWith('/rooms')&&init?.method!=='POST'?Promise.resolve(Response.json({rooms:[room]})):String(input).endsWith('/roles')&&init?.method!=='POST'?Promise.resolve(Response.json({choices:[{ref:roleRef,name:'已领取的兴趣身份',available:false}],selectedRefs:[roleRef],maxChoices:5,enabled:false})):original(input,init));
 const view=render(<CommunityPage tab="rooms" accountKey="member"/>);expect(await screen.findByText('暂停时仍保留的房间')).toBeInTheDocument();expect(screen.getByText('社区已暂停新增功能')).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();fireEvent.click(screen.getByText('管理房间'));expect(screen.getByRole('button',{name:'解散空房'})).toBeEnabled();
 view.rerender(<CommunityPage tab="roles" accountKey="member"/>);const choice=await screen.findByRole('checkbox',{name:'已领取的兴趣身份（已停用，可退出）'});expect(choice).toBeEnabled();fireEvent.click(choice);fireEvent.click(screen.getByRole('button',{name:'保存身份'}));
 await screen.findByText('已提交，等待机器人执行');const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({roleRefs:[]});
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).endsWith('/fun'))).toBe(false);
});
it('keeps an unsaved role choice across same-membership status refreshes',async()=>{
 render(<CommunityPage tab="roles" accountKey="same"/>);const choice=await screen.findByRole('checkbox',{name:'一起玩游戏'});fireEvent.click(choice);expect(choice).toBeChecked();fireEvent.focus(window);
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(call=>String(call[0])==='/api/community')).toHaveLength(2));expect(screen.getByRole('checkbox',{name:'一起玩游戏'})).toBeChecked();
});
it('lets an unbound administrator manage existing rooms while personal actions stay unavailable',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;const room={ref:roleRef,name:'管理员需处理的房间',owner:{ref:memberRef,name:'房主'},members:[{ref:memberRef,name:'房主'}],status:'active',visibility:'hidden',userLimit:4,version:7,canManage:true,canClaim:false,transferTo:null,cleanupAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/community'?Promise.resolve(Response.json({...overview,me:{linked:false,member:null,isAdmin:true,needsMembership:false}})):String(input).endsWith('/rooms')&&init?.method!=='POST'?Promise.resolve(Response.json({rooms:[room]})):original(input,init));
 const view=render(<CommunityPage tab="rooms" accountKey="unbound-admin"/>);await screen.findByText('管理员需处理的房间');expect(screen.queryByRole('button',{name:'加入语音房'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'接受房主转让'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('管理房间'));expect(screen.getByRole('textbox',{name:'修改名字'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'关闭有人房间…'}));expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'确认移动并关闭'}));await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({action:'admin_delete',confirm:true,expectedVersion:7});
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).endsWith('/roles')||String(call[0]).endsWith('/fun'))).toBe(false);
 view.rerender(<CommunityPage tab="play" accountKey="unbound-admin"/>);expect(await screen.findByText('先绑定 Discord，再从网页管理社区')).toBeInTheDocument();expect(screen.queryByText('最近一起玩的')).not.toBeInTheDocument();
});
