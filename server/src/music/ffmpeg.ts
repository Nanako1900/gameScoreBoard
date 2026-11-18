// One ffmpeg child per played track: the downloaded audio goes in on stdin and
// Ogg/Opus comes out on stdout. The URL never reaches ffmpeg (input is pipe:0),
// so neither its arguments nor its stderr can leak it.
import { spawn as nodeSpawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { MUSIC_VOLUME_MAX } from '../../../shared/music';

export const FFMPEG_COMMAND = 'ffmpeg';
export const FFMPEG_BITRATE = '96k';
const STDERR_TAIL_CHARS = 300;
const MS_PER_SECOND = 1000;

export interface FfmpegPipeline {
  output: Readable;
  /** Stops the process without reporting; safe to call more than once. */
  kill(): void;
}

export type FfmpegDone = (error: Error | null) => void;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

export function buildFfmpegArgs(seekMs: number, volume: number): string[] {
  const seconds = (Math.floor(clamp(seekMs, 0, Number.MAX_SAFE_INTEGER)) / MS_PER_SECOND).toFixed(3);
  const gain = (clamp(volume, 0, MUSIC_VOLUME_MAX) / MUSIC_VOLUME_MAX).toFixed(2);
  return [
    '-hide_banner', '-loglevel', 'error',
    // Input option: the stdin input may only use the pipe protocol, so nothing
    // in the downloaded data can make ffmpeg open another URL or file.
    '-protocol_whitelist', 'pipe',
    '-i', 'pipe:0',
    '-ss', seconds,
    '-vn',
    '-af', `volume=${gain}`,
    '-c:a', 'libopus', '-b:a', FFMPEG_BITRATE,
    '-f', 'ogg', 'pipe:1',
  ];
}

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,40}$/;

function isEpipe(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'EPIPE';
}

/** Download errors may quote the audio URL: keep only a well-formed error code. */
function downloadError(error: Error): Error {
  const code = (error as { code?: unknown }).code;
  const suffix = typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? ` (${code})` : '';
  return new Error(`audio download failed${suffix}`);
}

/**
 * Starts the transcoder. `done` fires once when the process has exited:
 * null after a clean exit, an error after a failure; never after kill().
 */
export function startFfmpeg(
  input: Readable,
  options: { seekMs: number; volume: number; done: FfmpegDone },
  spawn: typeof nodeSpawn = nodeSpawn,
): FfmpegPipeline {
  const child = spawn(FFMPEG_COMMAND, buildFfmpegArgs(options.seekMs, options.volume), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let finished = false;
  let failure: Error | null = null;
  let stderrTail = '';

  const settle = (error: Error | null): void => {
    if (finished) return;
    finished = true;
    options.done(error);
  };
  const fail = (error: Error): void => {
    failure = failure ?? error;
    child.kill('SIGKILL');
  };
  const kill = (): void => {
    finished = true;
    input.unpipe(child.stdin);
    input.destroy();
    child.stdin.destroy();
    child.kill('SIGKILL');
  };

  input.on('error', (error) => fail(downloadError(error)));
  // EPIPE: ffmpeg stopped reading (finished or failed); its exit code tells which.
  child.stdin.on('error', (error) => { if (!isEpipe(error)) fail(error); });
  child.stdout.on('error', (error) => fail(error));
  child.stderr.on('data', (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS); });
  child.on('error', (error) => { failure = failure ?? error; settle(failure); });
  child.on('close', (code, signal) => {
    if (failure) return settle(failure);
    if (code === 0) return settle(null);
    settle(new Error(`ffmpeg exited with ${code ?? signal}: ${stderrTail.trim()}`));
  });
  input.pipe(child.stdin);
  return { output: child.stdout, kill };
}
