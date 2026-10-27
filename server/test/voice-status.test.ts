import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createHealthServer, type GatewayState } from '../src/discord/health';
import type { VoiceStatus } from '../src/voice/recorder';
async function serve(state: GatewayState, voice: () => Promise<VoiceStatus>, work: (url: string) => Promise<void>) {
  const server = createHealthServer(() => state, voice); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const GOOD: VoiceStatus = { coverage_since: '2026-10-27 10:00:00', degraded: false, open_segments: 2, last_error: null };
describe('voice health status', () => {
  it('adds the current voice snapshot without changing healthy gateway status', async () => {
    await serve('ready', async () => GOOD, async (url) => {
      const result = await fetch(url + '/status?check=1'); expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ gateway: 'ready', voice: GOOD });
      expect(result.headers.get('cache-control')).toBe('no-store');
    });
  });
  it.each(['connecting', 'disabled'] as const)('retains 503 for gateway state %s', async (state) => {
    await serve(state, async () => ({ ...GOOD, coverage_since: null, open_segments: 0 }), async (url) => {
      expect((await fetch(url + '/status')).status).toBe(503);
    });
  });
  it('keeps liveness and unknown paths independent of PostgreSQL or recorder readiness', async () => {
    const status = vi.fn(async () => { throw new Error('database offline'); });
    await serve('connecting', status, async (url) => {
      const response = await fetch(url + '/healthz'); expect(response.status).toBe(200); expect(await response.text()).toBe('ok');
      expect((await fetch(url + '/missing')).status).toBe(404); expect(status).not.toHaveBeenCalled();
    });
  });
  it('projects known fields and masks failure details that may contain account or channel IDs', async () => {
    const raw = { ...GOOD, degraded: true, last_error: 'SQL Discord 123456789012345678 channel 987654321098765432', discord_user_id: '123456789012345678', channel_id: '987654321098765432' };
    await serve('ready', async () => raw, async (url) => {
      const body = await (await fetch(url + '/status')).json() as { voice: VoiceStatus };
      expect(body.voice).toMatchObject({ degraded: true, coverage_since: null, open_segments: 2, last_error: expect.any(String) });
      expect(JSON.stringify(body)).not.toMatch(/123456789012345678|987654321098765432|discord_user_id|channel_id|SQL/);
    });
  });
  it('reports unknown voice state safely when its snapshot read rejects', async () => {
    await serve('ready', async () => { throw new Error('SQL private-channel'); }, async (url) => {
      const body = await (await fetch(url + '/status')).json() as { voice: VoiceStatus };
      expect(body.voice).toMatchObject({ degraded: true, coverage_since: null, open_segments: null, last_error: expect.any(String) });
      expect(JSON.stringify(body)).not.toContain('private-channel');
    });
  });
  it('serves disabled status without constructing a recorder or connecting to PostgreSQL', async () => {
    const server = createHealthServer(() => 'disabled'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      expect(await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/status`)).json())
        .toEqual({ gateway: 'disabled', voice: { coverage_since: null, degraded: false, open_segments: 0, last_error: null } });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
