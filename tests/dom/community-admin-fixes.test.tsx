import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CommunityAdminPage } from '../../src/components/CommunityAdminPage';
import { defaultCommunitySettings } from '../../shared/community';
import type { User } from '../../src/types';

const admin={id:'admin',username:'管理员',is_admin:true} as User;
const categoryRef='43f9e27e-a4d6-4bc2-b2a8-afb3ccbe4f15';
const roomRef='3265bc08-259a-439f-9882-451464413270';
const memberRef='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const stamp='2026-10-29T00:00:00Z';
let settings=defaultCommunitySettings();let version=2;let legacy=false;let operationStatus='succeeded';let diagnosticsStatus=200;let serverErrors:unknown[]= [];
let rooms:unknown[]=[];
const operation=()=>({ref:roomRef,kind:'settings.apply',status:operationStatus,error:null,result:null,roomRef:null,createdAt:stamp,finishedAt:stamp});
function posts(){return vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST');}
function openGroup(title:string){const heading=screen.getByRole('heading',{name:title});const details=heading.closest('details');if(details&&!details.open)fireEvent.click(heading);}
function errorSummary(){return screen.getByRole('alert',{name:'社区设置需要修改'});}
beforeEach(()=>{
 settings=defaultCommunitySettings();version=2;legacy=false;operationStatus='succeeded';diagnosticsStatus=200;serverErrors=[];rooms=[];
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);const raw=structuredClone(settings);if(legacy)delete raw.rooms.fixedCategoryRefs;
  let body:unknown={settings:raw,version,runtime:{ready:true,appliedVersion:version,syncedAt:stamp,problem:null}};let status=200;
  if(path.endsWith('/resources'))body={resources:[{ref:categoryRef,name:'固定房间分类',kind:'category',available:true}]};
  if(path.endsWith('/rooms'))body={rooms};
  if(path.endsWith('/operations')){body=diagnosticsStatus===200?{operations:[]}:{error:'记录暂不可用'};status=diagnosticsStatus;}
  if(path.endsWith('/audit')){body=diagnosticsStatus===200?{audit:[]}:{error:'记录暂不可用'};status=diagnosticsStatus;}
  if(path.includes('/operations/'))body={operation:operation()};
  if(init?.method==='POST'){
   if(path==='/api/admin/community'&&serverErrors.length)return Response.json({error:'请检查标出的社区设置',fieldErrors:serverErrors},{status:400});
   const input=JSON.parse(String(init.body));if(path==='/api/admin/community'){settings=input.settings;version++;}
   body={settings,version,runtime:{ready:true,appliedVersion:version,syncedAt:stamp,problem:null},operation:operation()};status=202;
  }
  return Response.json(body,{status});
 }));
});

it('keeps an emptied zero-capable number blank and focuses an associated required error without posting',async()=>{
 settings.rooms.userLimit=6;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const field=screen.getByRole('spinbutton',{name:'默认人数限制（0 为不限）'});fireEvent.change(field,{target:{value:''}});expect(field).toHaveValue(null);
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(posts()).toHaveLength(0);expect(errorSummary()).toBeInTheDocument();expect(field).toHaveAttribute('aria-invalid','true');expect(field).toHaveFocus();
 const description=field.getAttribute('aria-describedby');expect(description).toBeTruthy();expect(document.getElementById(description!)).toHaveTextContent('默认人数');
});

it('opens folded advanced settings and focuses the invalid number instead of silently blocking native submit',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});const summary=screen.getByText('高级房间设置');fireEvent.click(summary);
 const field=screen.getByRole('spinbutton',{name:'全服最多房间'});fireEvent.change(field,{target:{value:''}});fireEvent.click(summary);expect(summary.closest('details')).not.toHaveAttribute('open');
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(posts()).toHaveLength(0);expect(summary.closest('details')).toHaveAttribute('open');expect(field).toHaveFocus();expect(field).toHaveAttribute('name','rooms.maxRooms');
});

it('expands the correct group and identifies the new empty topic even while fun is disabled',async()=>{
 settings.fun.enabled=false;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});openGroup('趣味互动与 AI');fireEvent.click(screen.getByRole('button',{name:'添加话题'}));
 const field=screen.getByRole('textbox',{name:'话题正文 3'});const section=field.closest('#community-fun')!;const details=section.tagName==='DETAILS'?section:section.closest('details');if(details)fireEvent.click(screen.getByRole('heading',{name:'趣味互动与 AI'}));
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(posts()).toHaveLength(0);expect(field).toHaveFocus();expect(field).toHaveAttribute('data-setting-path','fun.topics.2.text');expect(field).toHaveAttribute('aria-invalid','true');expect(field).toBeVisible();
});

it('collects independent validation errors and makes summary links focus their actual fields',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});openGroup('入服欢迎');openGroup('趣味互动与 AI');
 const welcome=screen.getByRole('textbox',{name:'欢迎文案'});fireEvent.change(welcome,{target:{value:'欢迎 {unsupported}'}});fireEvent.change(screen.getByRole('textbox',{name:'话题标签 1'}),{target:{value:Array.from({length:11},(_,i)=>'标签'+i).join(',')}});
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(posts()).toHaveLength(0);const links=within(errorSummary()).getAllByRole('link');expect(links.length).toBeGreaterThanOrEqual(2);expect(welcome).toHaveAttribute('aria-invalid','true');
 fireEvent.click(links.find(link=>link.getAttribute('href')?.includes('fun-topics'))!);expect(screen.getByRole('textbox',{name:'话题标签 1'})).toHaveFocus();
});

it('keeps legacy backends usable for ordinary saves while clearly disabling unsupported fixed-room controls',async()=>{
 legacy=true;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));
 expect(screen.getByText('当前后端尚不支持固定房间，请更新后端后使用。')).toBeInTheDocument();expect(screen.getByRole('checkbox',{name:'固定房间分类'})).toBeDisabled();
 fireEvent.change(screen.getByRole('spinbutton',{name:'默认人数限制（0 为不限）'}),{target:{value:'4'}});fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await waitFor(()=>expect(posts()).toHaveLength(1));const body=JSON.parse(String(posts()[0][1]?.body));expect(body.settings.rooms).not.toHaveProperty('fixedCategoryRefs');expect(body.settings.rooms.userLimit).toBe(4);
});

it('does not silently discard unsaved fixed selections after the backend loses the capability',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByRole('checkbox',{name:'固定房间分类'}));legacy=true;fireEvent.focus(window);
 await screen.findByText('当前后端尚不支持固定房间，请更新后端后使用。');fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(posts()).toHaveLength(0);expect(errorSummary()).toHaveTextContent('固定房间');expect(screen.getByRole('checkbox',{name:'固定房间分类'})).toBeChecked();
});

it('maps a safe server validation error to its folded field without losing the draft',async()=>{
 serverErrors=[{path:'rooms.maxRooms',label:'全服最多房间',message:'全服最多房间应为 1–100 之间的整数'}];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(await screen.findByRole('alert',{name:'社区设置需要修改'})).toHaveTextContent('全服最多房间');const field=screen.getByRole('spinbutton',{name:'全服最多房间'});expect(field).toHaveFocus();expect(field.closest('details')).toHaveAttribute('open');expect(field).toHaveValue(25);
});

it('loads settings when diagnostics fail and preserves the draft on diagnostic retry',async()=>{
 diagnosticsStatus=503;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});openGroup('趣味互动与 AI');fireEvent.change(screen.getByRole('textbox',{name:'社区 AI 提示词'}),{target:{value:'保留正在编辑的提示词'}});fireEvent.click(screen.getByText('查看运行与日志'));
 expect(screen.getByText('操作记录暂不可用，请重试。')).toBeInTheDocument();expect(screen.getByText('管理记录暂不可用，请重试。')).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'重试运行记录'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(call=>String(call[0])==='/api/admin/community')).toHaveLength(2));expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue('保留正在编辑的提示词');
});

it('still clears private state when an optional diagnostic read returns forbidden',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});diagnosticsStatus=403;fireEvent.focus(window);await waitFor(()=>expect(screen.queryByRole('button',{name:'保存社区设置'})).not.toBeInTheDocument());expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument();
});

it('keeps fixed-manager submission independent from an invalid settings draft',async()=>{
 rooms=[{ref:roomRef,name:'独立管理员操作的固定房',owner:null,kind:'fixed',managers:[{ref:memberRef,name:'已有管理员'}],members:[],status:'active',visibility:'hidden',userLimit:0,version:7,canManage:true,canClaim:false,transferTo:null,cleanupAt:null,createdAt:stamp,updatedAt:stamp}];
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.change(screen.getByRole('spinbutton',{name:'默认人数限制（0 为不限）'}),{target:{value:''}});fireEvent.click(screen.getByText('固定房间控制卡'));fireEvent.click(screen.getByText('独立管理员操作的固定房'));
 const input=screen.getByRole('textbox',{name:'房间管理员 Discord 用户 ID'});fireEvent.change(input,{target:{value:'1114391825336250432'}});fireEvent.click(screen.getByRole('button',{name:'保存房间管理员'}));await waitFor(()=>expect(posts()).toHaveLength(1));expect(String(posts()[0][0])).toBe(`/api/community/rooms/${roomRef}/actions`);expect(input).toHaveValue('');expect(screen.queryByRole('alert',{name:'社区设置需要修改'})).not.toBeInTheDocument();expect(document.querySelectorAll('form form')).toHaveLength(0);
});

it('summarizes changed groups and clears the previous save receipt when editing again',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});openGroup('入服欢迎');fireEvent.change(screen.getByRole('textbox',{name:'欢迎文案'}),{target:{value:'欢迎 {name}，玩得开心！'}});fireEvent.change(screen.getByRole('spinbutton',{name:'默认人数限制（0 为不限）'}),{target:{value:'4'}});
 expect(screen.getByLabelText('待保存分组')).toHaveTextContent('语音房间');expect(screen.getByLabelText('待保存分组')).toHaveTextContent('入服欢迎');fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(await screen.findByLabelText('最近保存结果')).toHaveTextContent('已保存');
 fireEvent.change(screen.getByRole('spinbutton',{name:'默认人数限制（0 为不限）'}),{target:{value:'5'}});expect(screen.queryByLabelText('最近保存结果')).not.toBeInTheDocument();expect(screen.getByLabelText('待保存分组')).toHaveTextContent('语音房间');
});
