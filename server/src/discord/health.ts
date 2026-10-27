import http from 'node:http';
import type { VoiceStatus } from '../voice/recorder';

export type GatewayState = 'ready' | 'connecting' | 'disabled';
const VOICE_FAILURE = '语音记录暂不可用，请查看机器人日志';
const EMPTY: VoiceStatus = { coverage_since: null, degraded: false, open_segments: 0, last_error: null };

/** Only public status fields leave the process; database errors may contain IDs. */
async function publicVoice(read: () => Promise<VoiceStatus>): Promise<VoiceStatus> {
  try {
    const value = await read();
    return {
      coverage_since: !value.degraded && value.coverage_since !== null && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.coverage_since)
        ? value.coverage_since : null,
      degraded: value.degraded === true,
      open_segments: value.open_segments !== null && Number.isSafeInteger(value.open_segments) && value.open_segments >= 0 ? value.open_segments : null,
      last_error: value.last_error === null ? null : VOICE_FAILURE,
    };
  } catch {
    return { coverage_since: null, degraded: true, open_segments: null, last_error: VOICE_FAILURE };
  }
}

/** Liveness never touches PostgreSQL; status keeps the existing gateway codes. */
export function createHealthServer(gateway: () => GatewayState, voice: () => Promise<VoiceStatus> = async () => EMPTY): http.Server {
  return http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
    } else if (path === '/status') {
      void publicVoice(voice).then((snapshot) => {
        const state = gateway();
        res.writeHead(state === 'ready' ? 200 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          .end(JSON.stringify({ gateway: state, voice: snapshot }));
      });
    } else {
      res.writeHead(404).end();
    }
  });
}
