import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { ApiError } from '../../src/api';
import { communityApi, communityBackendCapabilities, communityRequest, CommunitySettingsApiError } from '../../src/community-api';

afterEach(() => vi.unstubAllGlobals());
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'Content-Type':'application/json'}});

describe('community settings transport compatibility and errors', () => {
  it('detects fixed-room support from the actual GET shape rather than frontend defaults', () => {
    const current = defaultCommunitySettings(), old = structuredClone(current); delete old.rooms.fixedCategoryRefs;
    expect(communityBackendCapabilities(current)).toEqual({fixedRooms:true});
    expect(communityBackendCapabilities(old)).toEqual({fixedRooms:false});
    expect(communityBackendCapabilities(null)).toEqual({fixedRooms:false});
  });
  it('saves ordinary changes to a legacy strict backend without sending the new empty field', async () => {
    const settings=defaultCommunitySettings(); settings.welcome.template='修改欢迎';
    const fetch=vi.fn(async (_url:unknown, init?:RequestInit) => {
      const body=JSON.parse(String(init?.body));
      if(Object.hasOwn(body.settings.rooms,'fixedCategoryRefs'))return reply(400,{error:'社区设置格式或范围无效'});
      return reply(202,{settings:body.settings,version:2,runtime:{},operation:{ref:'op'}});
    });vi.stubGlobal('fetch',fetch);
    await expect(communityApi.save(settings,1,{fixedRooms:false})).resolves.toMatchObject({version:2});
    expect(fetch).toHaveBeenCalledTimes(1);expect(settings.rooms.fixedCategoryRefs).toEqual([]);
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({settings:{welcome:{template:'修改欢迎'}},expectedVersion:1});
  });
  it('preserves modern fixed-room selections and does not mutate the original settings', async () => {
    const settings=defaultCommunitySettings();settings.rooms.fixedCategoryRefs=['a0b09b51-03b8-4944-9615-5ad03ba7a944'];
    const fetch=vi.fn(async()=>reply(202,{settings,version:2,operation:{ref:'op'}}));vi.stubGlobal('fetch',fetch);
    await communityApi.save(settings,1,{fixedRooms:true});
    const body=JSON.parse(String((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body));expect(body.settings.rooms.fixedCategoryRefs).toEqual(settings.rooms.fixedCategoryRefs);
  });
  it('refuses to silently drop nonempty fixed settings when an older backend is detected', async () => {
    const settings=defaultCommunitySettings();settings.rooms.fixedCategoryRefs=['a0b09b51-03b8-4944-9615-5ad03ba7a944'];
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    await expect(communityApi.save(settings,1,{fixedRooms:false})).rejects.toMatchObject({fieldErrors:[expect.objectContaining({path:'rooms.fixedCategoryRefs'})]});expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps safe structured input errors for field positioning', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>reply(400,{error:'请检查标出的社区设置',fieldErrors:[{path:'rooms.maxRooms',label:'全服最多房间',message:'全服最多房间须为1至100的整数'}]})));
    try {await communityRequest('/api/admin/community',{});throw new Error('expected rejection');}catch(error){expect(error).toBeInstanceOf(ApiError);expect(error).toBeInstanceOf(CommunitySettingsApiError);expect((error as CommunitySettingsApiError).fieldErrors).toEqual([expect.objectContaining({path:'rooms.maxRooms'})]);}
  });
  it('does not attach malformed issues or private-status details to generic failures', async () => {
    for(const [status,fieldErrors] of [[400,[{path:'__proto__.secret',label:'bad',message:'bad'}]],[403,[{path:'rooms.maxRooms',label:'label',message:'private'}]]] as const){
      vi.stubGlobal('fetch',vi.fn(async()=>reply(status,{error:'请求未成功',fieldErrors})));
      await expect(communityRequest('/api/admin/community',{})).rejects.not.toBeInstanceOf(CommunitySettingsApiError);
    }
  });
  it('does not blindly retry or remove fields after a generic server 400', async () => {
    const fetch=vi.fn(async()=>reply(400,{error:'社区设置格式或范围无效'}));vi.stubGlobal('fetch',fetch);
    await expect(communityApi.save(defaultCommunitySettings(),1,{fixedRooms:true})).rejects.toBeInstanceOf(ApiError);expect(fetch).toHaveBeenCalledTimes(1);
  });
});
