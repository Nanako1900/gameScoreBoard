import { describe,expect,it } from 'vitest';
import { formatRoute,parseRoute,routeCoversHome } from '../../src/lib/routes';
describe('community route addresses',()=>{
 it.each([['/community','rooms'],['/community/roles','roles'],['/community/play','play']])('opens %s as a full page',(path,tab)=>{
  const route=parseRoute(path);expect(route).toEqual({name:'community',tab});expect(routeCoversHome(route,'drawer')).toBe(true);expect(formatRoute(route as never)).toBe(path);
 });
 it('concentrates management under settings while retaining admin alias',()=>{
  expect(parseRoute('/settings/community')).toEqual({name:'communityAdmin'});
  expect(parseRoute('/admin/community')).toEqual({name:'communityAdmin'});
  expect(formatRoute({name:'communityAdmin'} as never)).toBe('/settings/community');
 });
});

describe('community within the four primary destinations',()=>{
 it('keeps member community under home and community management under settings',async()=>{
  const {primaryNavigationKey}=await import('../../src/lib/navigation');
  expect(primaryNavigationKey(parseRoute('/community/play'))).toBe('home');
  expect(primaryNavigationKey(parseRoute('/settings/community'))).toBe('settings');
 });
});

describe('community music route',()=>{
 const ref='ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
 it('round-trips a room reference',()=>{
  const route=parseRoute(`/community/music/${ref}`);
  expect(route).toEqual({name:'communityMusic',roomRef:ref});
  expect(formatRoute(route as never)).toBe(`/community/music/${ref}`);
  expect(routeCoversHome(route,'page')).toBe(true);
  expect(parseRoute(`/community/music/${ref}/`)).toEqual(route);
 });
 it.each(['/community/music','/community/music/abc','/community/music/123','/community/music/not-a-uuid-at-all-not-a-uuid-at-all!','/community/music/'+ref+'/x'])('sends %s to not found',path=>{
  expect(parseRoute(path)).toEqual({name:'notFound'});
 });
 it('highlights the same primary item as community',async()=>{
  const {primaryNavigationKey}=await import('../../src/lib/navigation');
  expect(primaryNavigationKey(parseRoute(`/community/music/${ref}`))).toBe('home');
 });
});
