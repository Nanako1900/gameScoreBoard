import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityAdminPage } from '../../src/components/CommunityAdminPage';
import { defaultCommunitySettings } from '../../shared/community';
import type { User } from '../../src/types';
const ref='3265bc08-259a-439f-9882-451464413270';
const safeRole='43f9e27e-a4d6-4bc2-b2a8-afb3ccbe4f15';
const unsafeRole='485536fd-432c-4ac4-abcd-b25af5754e1b';
const admin={id:'admin',username:'管理员',is_admin:true} as User;
const operation={ref,kind:'settings.apply',status:'queued',error:null,result:null,roomRef:null,createdAt:'2026-10-28T00:00:00Z',finishedAt:null};
const resources=[{ref,name:'房间分类',kind:'category',available:true},{ref:safeRole,name:'游戏同好',kind:'role',available:true,safe:true},{ref:unsafeRole,name:'服务器管理',kind:'role',available:true,safe:false}];
let settings=defaultCommunitySettings();
beforeEach(()=>{
 settings=defaultCommunitySettings();
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);let result:unknown={settings,version:2,runtime:{ready:true,syncedAt:'2026-10-28T00:00:00Z',appliedVersion:2,problem:null}};
  if(path.endsWith('/resources'))result={resources};
  if(path.endsWith('/operations'))result={operations:[{...operation,status:'needs_review'}]};
  if(path.endsWith('/audit'))result={audit:[{ref,actor:'管理员',action:'settings.save',target:null,outcome:'queued',createdAt:'2026-10-28T00:00:00Z'}]};
  if(path.includes('/operations/'))result={operation:{...operation,status:'succeeded'}};
  if(init?.method==='POST')result={settings:JSON.parse(String(init.body)).settings??settings,version:3,runtime:{ready:true,appliedVersion:2,syncedAt:null,problem:null},operation};
  return Response.json(result,{status:init?.method==='POST'?202:200});
 }));
});
it('does not request or expose settings to visitors or non-administrators',()=>{
 const view=render(<CommunityAdminPage me={null}/>);expect(fetch).not.toHaveBeenCalled();
 view.rerender(<CommunityAdminPage me={{...admin,is_admin:false}}/>);expect(fetch).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'保存社区设置'})).not.toBeInTheDocument();
});
it('groups all configuration and shows safe resource names with opaque selections',async()=>{
 render(<CommunityAdminPage me={admin}/>);
 await screen.findByRole('button',{name:'保存社区设置'});expect(screen.getByRole('heading',{name:'社区管理'})).toBeInTheDocument();
 for(const name of ['语音房间','入服欢迎','兴趣身份','趣味互动与 AI','运行与日志'])expect(screen.getByRole('heading',{name})).toBeInTheDocument();
 expect(screen.getByRole('option',{name:'房间分类'})).toHaveValue(ref);
 expect(screen.getByRole('checkbox',{name:'游戏同好'})).toBeEnabled();expect(screen.getByRole('checkbox',{name:'服务器管理（不可自选）'})).toBeDisabled();
 expect(screen.getByRole('spinbutton',{name:'每人最多兴趣身份'})).toHaveAttribute('max','5');
 expect(screen.getByRole('link',{name:'管理模型与密钥'})).toHaveAttribute('href','/settings/ai');
 expect(screen.queryByText(/111111111111111111/)).not.toBeInTheDocument();
});
it('saves one versioned complete draft and distinguishes saved from applied',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.change(screen.getByRole('spinbutton',{name:'空房回收宽限（秒）'}),{target:{value:'180'}});
 fireEvent.change(screen.getByRole('textbox',{name:'社区 AI 提示词'}),{target:{value:'给出友好的短建议'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'游戏同好'}));fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));
 expect(await screen.findByText('已保存待应用')).toBeInTheDocument();expect(screen.getByText('已提交，等待机器人执行')).toBeInTheDocument();
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');const body=JSON.parse(String(post?.[1]?.body));
 expect(body).toMatchObject({expectedVersion:2,settings:{rooms:{emptyGraceSeconds:180},roles:{allowedRefs:[safeRole]},fun:{ai:{prompt:'给出友好的短建议'}}}});expect(body.requestKey).toMatch(/[a-f0-9-]{36}/);
 expect(screen.queryByText('已在 Discord 生效')).not.toBeInTheDocument();
});
it('previews welcoming text safely without a request or mentions',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.change(screen.getByRole('textbox',{name:'欢迎文案'}),{target:{value:'欢迎 {name} 来到 {server}，你是第 {memberCount} 位！@everyone <@123456789012345678> <img src=x onerror=alert(1)>'}});
 expect(screen.getByLabelText('欢迎预览').textContent).toContain('欢迎 新成员 来到 我们的社区，你是第 100 位');
 expect(screen.getByLabelText('欢迎预览').textContent).not.toMatch(/@everyone|<@|123456789012345678/);
 expect(document.querySelector('img')).toBeNull();expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});
it('supports topic text and tags without editing raw JSON',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'添加话题'}));const topics=screen.getAllByRole('textbox',{name:/话题正文/});
 fireEvent.change(topics[topics.length-1],{target:{value:'今晚想玩什么？'}});const tags=screen.getAllByRole('textbox',{name:/话题标签/});fireEvent.change(tags[tags.length-1],{target:{value:'游戏, 晚间'}});
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');const body=JSON.parse(String(post?.[1]?.body));expect(body.settings.fun.topics.at(-1)).toMatchObject({text:'今晚想玩什么？',tags:['游戏','晚间']});
});
it('shows reconciliation cases and sends refresh as a queued operation',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 expect(screen.getByText('执行结果待管理员对账')).toBeInTheDocument();expect(screen.getByText(/不能确定 Discord 执行结果/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'刷新服务器目录'}));await screen.findByText('已提交，等待机器人执行');
 expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).endsWith('/sync')&&call[1]?.method==='POST')).toBe(true);
});
it('reports backend failure without claiming a saved or applied version',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 vi.mocked(fetch).mockResolvedValue(Response.json({error:'设置已被其他管理员修改，请刷新'},{status:409}));
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));expect(await screen.findByRole('alert')).toHaveTextContent('设置已被其他管理员修改');expect(screen.queryByText('已保存待应用')).not.toBeInTheDocument();
});
it('drops an old administrator request after changing accounts',async()=>{
 let complete!:(response:Response)=>void;vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{complete=resolve}));
 const view=render(<CommunityAdminPage me={admin}/>);view.rerender(<CommunityAdminPage me={null}/>);complete(Response.json({settings,version:1,runtime:{ready:true}}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument());
});

it('polls queued saves until an actual execution receipt arrives',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(call=>String(call[0]).endsWith('/operations/'+ref))).toBe(true),{timeout:3500});
 expect(await screen.findByText('已执行，请查看最新状态')).toBeInTheDocument();
});
it('removes private admin configuration immediately after a forbidden save',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 vi.mocked(fetch).mockResolvedValue(Response.json({error:'需要管理员权限'},{status:403}));fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument());expect(screen.queryByRole('button',{name:'保存社区设置'})).not.toBeInTheDocument();
});
it('removes private admin configuration if a queued operation becomes inaccessible',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 vi.mocked(fetch).mockResolvedValue(Response.json({error:'记录不存在'},{status:404}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument(),{timeout:3500});
 expect(screen.queryByText('已提交，等待机器人执行')).not.toBeInTheDocument();
});
it('offers removal of configured roles that have disappeared from the resource directory',async()=>{
 settings.roles.allowedRefs=[ref];render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'移除已失效身份 1'}));fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('已保存待应用');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body)).settings.roles.allowedRefs).toEqual([]);
});

it('clears a loaded private configuration when a later refresh returns not found',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 vi.mocked(fetch).mockResolvedValue(Response.json({error:'当前服务未提供管理'},{status:404}));fireEvent.focus(window);
 expect(await screen.findByText('当前服务暂未提供社区管理')).toBeInTheDocument();expect(screen.queryByRole('textbox',{name:'社区 AI 提示词'})).not.toBeInTheDocument();
});

it('queues panel refreshing separately from directory synchronization',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'刷新控制面板'}));await screen.findByText('已提交，等待机器人执行');
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({kind:'panel.refresh'});
});
it('requires a separate human review confirmation and only cancels the old uncertain task',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;let reviewed=false;
 vi.mocked(fetch).mockImplementation((input,init)=>String(input).endsWith('/operations')&&reviewed?Promise.resolve(Response.json({operations:[{...operation,status:'canceled',result:{reviewed:true}}]})):String(input).endsWith(`/operations/${ref}/review`)?(reviewed=true,Promise.resolve(Response.json({operation:{...operation,status:'canceled',result:{reviewed:true}}}))):original(input,init));
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.click(screen.getByRole('button',{name:'人工核对并取消旧任务'}));expect(screen.getByText(/^先在 Discord 检查此任务/)).toBeInTheDocument();expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'确认已人工核对，取消旧任务'}));expect(await screen.findByText('旧任务已取消，已记录人工核对')).toBeInTheDocument();
 const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(String(post?.[0])).toBe(`/api/admin/community/operations/${ref}/review`);expect(JSON.parse(String(post?.[1]?.body))).toEqual({confirm:true,requestKey:expect.any(String)});
 expect(screen.queryByText('已恢复 Discord 状态')).not.toBeInTheDocument();expect(screen.queryByText('任务将自动重试')).not.toBeInTheDocument();
});
it('lets administrators back out of manual review without sending any mutation',async()=>{
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});fireEvent.click(screen.getByRole('button',{name:'人工核对并取消旧任务'}));fireEvent.click(screen.getByRole('button',{name:'暂不取消旧任务'}));
 expect(screen.queryByRole('button',{name:'确认已人工核对，取消旧任务'})).not.toBeInTheDocument();expect(vi.mocked(fetch).mock.calls.filter(call=>call[1]?.method==='POST')).toHaveLength(0);
});
it('keeps unsaved editing across focus refresh and failed saves',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 const prompt=screen.getByRole('textbox',{name:'社区 AI 提示词'});fireEvent.change(prompt,{target:{value:'编辑到一半的新提示词'}});fireEvent.focus(window);
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(call=>String(call[0])==='/api/admin/community')).toHaveLength(2));expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue('编辑到一半的新提示词');
 vi.mocked(fetch).mockImplementation((input,init)=>init?.method==='POST'?Promise.resolve(Response.json({error:'暂时无法保存'},{status:503})):original(input,init));fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('暂时无法保存');expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue('编辑到一半的新提示词');
});
it('retains the draft original version after a background update and requires explicit reload',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;render(<CommunityAdminPage me={admin}/>);await screen.findByRole('button',{name:'保存社区设置'});
 fireEvent.change(screen.getByRole('textbox',{name:'社区 AI 提示词'}),{target:{value:'我的未保存修改'}});
 vi.mocked(fetch).mockImplementation((input,init)=>String(input)==='/api/admin/community'&&init?.method!=='POST'?Promise.resolve(Response.json({settings,version:4,runtime:{ready:true,appliedVersion:4,syncedAt:null,problem:null}})):init?.method==='POST'?Promise.resolve(Response.json({error:'版本已更新'},{status:409})):original(input,init));fireEvent.focus(window);
 expect(await screen.findByText('已有新的社区设置版本')).toBeInTheDocument();expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue('我的未保存修改');
 fireEvent.click(screen.getByRole('button',{name:'保存社区设置'}));await screen.findByText('版本已更新');const post=vi.mocked(fetch).mock.calls.find(call=>call[1]?.method==='POST');expect(JSON.parse(String(post?.[1]?.body)).expectedVersion).toBe(2);
 fireEvent.click(screen.getByRole('button',{name:'载入最新设置'}));fireEvent.click(screen.getByRole('button',{name:'确认放弃修改并载入'}));expect(screen.getByRole('textbox',{name:'社区 AI 提示词'})).toHaveValue(settings.fun.ai.prompt);
});
