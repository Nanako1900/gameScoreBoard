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
