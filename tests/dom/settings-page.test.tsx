import {fireEvent,render,screen} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {SettingsPage} from '../../src/components/SettingsPage';
import {AccountMenu} from '../../src/components/AccountMenu';
import type {User} from '../../src/types';
const me:User={id:'a',username:'小明',oauth_username:'小明',avatar_url:null,is_participant:true,is_judge:false,is_admin:true,score:100,created_at:''};
describe('central settings entry',()=>{
 it('reaches one settings address from the account menu',()=>{render(<AccountMenu me={me} myPath="/players/a" onOpenOnboarding={()=>{}} onLogout={()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'小明'}));expect(screen.getByRole('link',{name:'设置'})).toHaveAttribute('href','/settings');});
 it('groups identity, Discord and administration in one page without demanding onboarding completion',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({settings:{enabled:true},me:{isAdmin:true}})));
  render(<SettingsPage me={me} discord={{value:null,loading:false}} onDiscordChanged={()=>{}} onSaved={()=>{}}/>);
  expect(screen.getByRole('heading',{name:'设置'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'名字与身份'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Discord 与通知'})).toBeInTheDocument();expect(await screen.findByRole('link',{name:'社区管理'})).toHaveAttribute('href','/settings/community');
 });
});
