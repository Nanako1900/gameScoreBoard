// /api/community/music/* and /api/admin/community/music/*. Mounted inside the
// community app after its middleware, so CORS, the origin check, read-only
// refusal and session authentication already ran; errors map through the
// community app's handler.
import { Hono } from 'hono';
import { MusicCatalog } from './catalog';
import { exactFields, invalidInput, readBody, requestKey, userOf, type MusicRouteEnv } from './http';
import { MusicLogin } from './login';
import { MusicService, type MusicServiceDeps } from './service';

export type MusicRouteDeps = MusicServiceDeps;

const MUSIC = '/api/community/music';
const ADMIN_PROXY = '/api/admin/community/music/proxy';

function registerMemberRoutes(app: Hono<MusicRouteEnv>, catalog: MusicCatalog, login: MusicLogin): void {
  // Static paths first, so none of them is read as a room reference.
  app.get(`${MUSIC}/search`, async (c) => c.json(await catalog.search(userOf(c), c.req.query('q'))));
  app.get(`${MUSIC}/playlist`, async (c) => c.json(await catalog.playlist(userOf(c), c.req.query('link'))));
  app.post(`${MUSIC}/login/qr`, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey']);
    requestKey(input);
    return c.json(await login.start(userOf(c)));
  });
  app.get(`${MUSIC}/login/qr/:key`, async (c) => c.json(await login.check(userOf(c), c.req.param('key'))));
  app.post(`${MUSIC}/logout`, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey']);
    requestKey(input);
    return c.json(await login.logout(userOf(c)));
  });
}

function registerRoomRoutes(app: Hono<MusicRouteEnv>, service: MusicService): void {
  app.get(`${MUSIC}/:roomRef`, async (c) => c.json(await service.view(userOf(c), c.req.param('roomRef'))));
  app.post(`${MUSIC}/:roomRef/invite`, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey', 'useMyAccount']);
    const key = requestKey(input);
    if (input.useMyAccount !== undefined && typeof input.useMyAccount !== 'boolean') invalidInput();
    const view = await service.invite(userOf(c), c.req.param('roomRef'), input.useMyAccount === true, key);
    return c.json(view, 202);
  });
  app.post(`${MUSIC}/:roomRef/commands`, async (c) => {
    const input = await readBody(c);
    const key = requestKey(input);
    await service.command(userOf(c), c.req.param('roomRef'), input, key);
    return c.json({ accepted: true }, 202);
  });
  app.post(`${MUSIC}/:roomRef/account`, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey', 'action']);
    requestKey(input);
    return c.json(await service.account(userOf(c), c.req.param('roomRef'), input.action));
  });
}

function registerAdminRoutes(app: Hono<MusicRouteEnv>, catalog: MusicCatalog): void {
  app.get(ADMIN_PROXY, async (c) => c.json(await catalog.proxy(userOf(c))));
  app.post(ADMIN_PROXY, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey', 'url', 'audio']);
    requestKey(input);
    return c.json(await catalog.saveProxy(userOf(c), input.url, input.audio));
  });
  app.post(`${ADMIN_PROXY}/test`, async (c) => {
    const input = await readBody(c);
    exactFields(input, ['requestKey']);
    requestKey(input);
    return c.json(await catalog.testProxy(userOf(c)));
  });
}

export function createMusicRoutes(deps: MusicRouteDeps): Hono<MusicRouteEnv> {
  const service = new MusicService(deps);
  const catalog = new MusicCatalog(service, deps.now);
  const login = new MusicLogin(service, deps.now);
  const app = new Hono<MusicRouteEnv>();
  registerMemberRoutes(app, catalog, login);
  registerAdminRoutes(app, catalog);
  registerRoomRoutes(app, service);
  return app;
}
