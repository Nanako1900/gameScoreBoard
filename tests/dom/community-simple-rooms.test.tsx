import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CommunityPage } from '../../src/components/CommunityPage';
import { CommunityAdminPage } from '../../src/components/CommunityAdminPage';
import { defaultCommunitySettings, type CommunityRoomView } from '../../shared/community';
import type { User } from '../../src/types';

const memberRef='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const otherRef='b10ebd61-dbd4-4804-aa54-021b345821c1';
const operationRef='3265bc08-259a-439f-9882-451464413270';
const admin={id:'admin',username:'管理员',is_admin:true} as User;
let settings=defaultCommunitySettings();
let rooms:CommunityRoomView[]=[];
const operation={ref:operationRef,kind:'settings.apply',status:'queued',error:null,result:null,roomRef:null,createdAt:'2026-10-29T00:00:00Z',finishedAt:null};
function room(ref:string,name:string,overrides:Partial<CommunityRoomView>={}):CommunityRoomView {
 return {ref,name,owner:{ref:otherRef,name:'另一位'},members:[],status:'active',visibility:'open',userLimit:0,version:1,canManage:false,canClaim:false,transferTo:null,cleanupAt:null,createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z',...overrides};
}
beforeEach(()=>{
 settings=defaultCommunitySettings();settings.enabled=true;settings.rooms.enabled=true;settings.rooms.categoryRef=otherRef;settings.rooms.creatorRef=operationRef;rooms=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);const runtime={ready:true,appliedVersion:2,syncedAt:'2026-10-29T00:00:00Z',problem:null};
  let body:unknown={settings,version:2,runtime,me:{linked:true,member:{ref:memberRef,name:'小明'},isAdmin:false,needsMembership:false}};
  if(path.endsWith('/rooms'))body={rooms};
  if(path.includes('/resources'))body={resources:[]};
  if(path.endsWith('/roles'))body={choices:[],selectedRefs:[],maxChoices:5,enabled:true};
  if(path.endsWith('/fun'))body={items:[]};
  if(path.endsWith('/operations'))body={operations:[{...operation,status:'needs_review'}]};
  if(path.endsWith('/audit'))body={audit:[]};
  if(path.includes('/operations/'))body={operation:{...operation,status:'succeeded'}};
  if(init?.method==='POST')body={settings:JSON.parse(String(init.body)).settings??settings,version:3,runtime:{...runtime,appliedVersion:2},operation};
  return Response.json(body,{status:init?.method==='POST'?202:200});
 }));
});

it('explains the automatic Discord flow without a website creation form or join controls',async()=>{
 render(<CommunityPage tab="rooms" accountKey="member"/>);
 expect(await screen.findByRole('heading',{name:'进入语音，房间就准备好了'})).toBeInTheDocument();
 expect(screen.getByText('进入服务器指定的「新建临时房间」语音频道。')).toBeInTheDocument();
 expect(screen.getByText('机器人自动建房并把你移入，房内聊天会出现控制卡。')).toBeInTheDocument();
 expect(screen.getByText('改名、调整人数和访问方式，都可以直接在房内控制卡完成。')).toBeInTheDocument();
 expect(screen.getByText('临时房间无人后 2 分钟自动删除；有人回来就停止计时。')).toBeInTheDocument();
 expect(screen.queryByRole('textbox',{name:'房间名字'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'创建语音房'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'加入语音房'})).not.toBeInTheDocument();
 expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});

it('shows only my owned, occupied, claimable or invited rooms and keeps web management folded',async()=>{
 rooms=[room('0','其他可见房间'),room('1','我的房间',{owner:{ref:memberRef,name:'小明'},canManage:true}),room('2','我正在的房间',{members:[{ref:memberRef,name:'小明'}]}),room('3','可认领的房间',{canClaim:true}),room('4','待接任的房间',{transferTo:{ref:memberRef,name:'小明'}})];
 render(<CommunityPage tab="rooms" accountKey="member"/>);
 await screen.findByText('我的房间');
 for(const name of ['我正在的房间','可认领的房间','待接任的房间'])expect(screen.getByText(name)).toBeInTheDocument();
 expect(screen.queryByText('其他可见房间')).not.toBeInTheDocument();
 expect(screen.getByText('网页辅助管理').closest('details')).not.toHaveAttribute('open');
 expect(screen.getByRole('textbox',{name:'修改名字'})).not.toBeVisible();
 expect(screen.getByRole('button',{name:'认领这个房间'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'接受房主转让'})).toBeInTheDocument();
 fireEvent.click(screen.getByText('网页辅助管理'));
 expect(screen.getByRole('textbox',{name:'修改名字'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'加入语音房'})).not.toBeInTheDocument();
});

it('keeps five everyday room settings visible and folds advanced policy and optional legacy panel',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const area=within(screen.getByRole('region',{name:'语音房间'}));
 for(const label of ['开放自助语音房','创建房间入口','临时房间分类','空房多久删除（分钟）','默认人数限制（0 为不限）'])expect(area.getByLabelText(label)).toBeVisible();
 expect(area.getByRole('spinbutton',{name:'空房多久删除（分钟）'})).toHaveValue(2);
 expect(area.getByRole('spinbutton',{name:'建房冷却（秒）'})).not.toBeVisible();
 expect(area.getByText('高级房间设置').closest('details')).not.toHaveAttribute('open');
 fireEvent.click(area.getByText('高级房间设置'));
 expect(area.getByRole('spinbutton',{name:'建房冷却（秒）'})).toBeInTheDocument();
 expect(area.getByRole('combobox',{name:'旧全局入口频道（可选）'})).toBeInTheDocument();
});

it('converts decimal minutes to whole seconds without changing an untouched legacy seconds value',async()=>{
 settings.rooms.emptyGraceSeconds=47;
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const input=screen.getByRole('spinbutton',{name:'空房多久删除（分钟）'});
 expect(input).toHaveAttribute('min','0.25');expect(input).toHaveAttribute('max','1440');
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 const first=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(first?.[1]?.body)).settings.rooms.emptyGraceSeconds).toBe(47);
 await waitFor(()=>expect(screen.getByRole('button',{name:'保存社区设置'})).toBeEnabled(),{timeout:3500});
 fireEvent.change(screen.getByRole('spinbutton',{name:'空房多久删除（分钟）'}),{target:{value:'2.333'}});fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(2));
 const posts=vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST');expect(JSON.parse(String(posts[1][1]?.body)).settings.rooms.emptyGraceSeconds).toBe(140);
});

it('keeps an actionable review warning visible while diagnostic details start folded',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 expect(screen.getByText('有 1 项操作需要管理员核对')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'人工核对并取消旧任务'})).not.toBeVisible();
 expect(screen.getByText('查看运行与日志').closest('details')).not.toHaveAttribute('open');
 const link=screen.getByRole('link',{name:'查看待处理操作'});expect(link).toHaveAttribute('href','#community-runtime');fireEvent.click(link);
 expect(screen.getByRole('button',{name:'人工核对并取消旧任务'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'刷新服务器目录'})).toBeInTheDocument();
});

it('lets administrators edit minutes naturally and rejects an empty or out-of-range value before saving',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const input=screen.getByRole('spinbutton',{name:'空房多久删除（分钟）'});
 fireEvent.change(input,{target:{value:'2.333'}});expect(input).toHaveValue(2.333);
 for(const value of ['', '0.2', '1441']) {
  fireEvent.change(input,{target:{value}});expect(input).toBeInvalid();fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));
 }
 expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});
