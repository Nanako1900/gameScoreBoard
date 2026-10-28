import { render,screen,waitFor } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { CommunityEntry } from '../../src/components/CommunityEntry';
describe('one community home entry',()=>{
 it('shows one center link after supported backend detection',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({settings:{enabled:true},me:{isAdmin:true}})));
  render(<CommunityEntry accountKey="a"/>);
  expect(await screen.findByRole('link',{name:'进入社区'})).toHaveAttribute('href','/community');
  expect(screen.getByRole('link',{name:'社区管理'})).toHaveAttribute('href','/settings/community');
 });
 it('hides the feature on D1 and does not show a broken entry',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({error:'Not found'},{status:404}));vi.stubGlobal('fetch',fetcher);
  const {container}=render(<CommunityEntry accountKey="b"/>);await waitFor(()=>expect(fetcher).toHaveBeenCalled());expect(container).toBeEmptyDOMElement();
 });
});
