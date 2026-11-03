// Local only: real engine/adapter, stateful fake Discord REST and memory store.
// Run: node --import tsx scripts/benchmark-room-creation.ts --base ed05342
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommunityEngine } from '../server/src/community/engine';
import type { createCommunityDiscord } from '../server/src/community/discord';
import { creationFixture, creationIds, type CreationFixtureOptions } from '../server/test/community-creation-latency.fixture';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name); if (index < 0) return undefined;
  const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing ${name} value`); return value;
};
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--trace') continue;
  if (!['--base', '--delays'].includes(args[index])) throw new Error('Supported arguments: --base REV --delays 0,100,400 --trace');
  index += 1;
}
const delays = (option('--delays') ?? '0,100,400').split(',').map(value => Number(value));
if (!delays.length || delays.some(value => !Number.isFinite(value) || value < 0)) throw new Error('REST delays must be nonnegative numbers');
const baseline = option('--base');
let snapshot: string | undefined;

function extract(ref: string): { root: string; revision: string } {
  const revision = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  snapshot = mkdtempSync(join(tmpdir(), 'edg-c8-room-base-'));
  writeFileSync(join(snapshot, 'package.json'), '{"type":"module"}\n');
  symlinkSync(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', 'server/src/community', 'server/src/db/d1.ts', 'shared'],
    { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const path of paths) {
    const target = join(snapshot, path); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root }));
  }
  return { root: snapshot, revision };
}

async function measure(label: string, implementations: Pick<CreationFixtureOptions, 'engine' | 'adapter'> = {}) {
  for (const administrator of [false, true]) for (const delayMs of delays) {
    const fixture = creationFixture({ delayMs, administrator, ...implementations });
    await fixture.clock.run(fixture.enter);
    const result = fixture.summary();
    if (result.outcome !== 'succeeded' || result.creates !== 1 || result.moves !== 1 ||
      fixture.voices.get(creationIds.owner)?.channelId !== creationIds.created) throw new Error('Local benchmark did not complete one correct room creation and move');
    console.log(JSON.stringify({ version: label, administrator,
      model: 'warm ready snapshot with complete member mapping; uniform REST delay; immediate memory store; no network or rate-limit model', ...result,
      ...(args.includes('--trace') ? { trace: fixture.clock.trace } : {}) }));
  }
}

try {
  if (baseline) {
    const source = extract(baseline);
    const engine = await import(pathToFileURL(join(source.root, 'server/src/community/engine.ts')).href) as { CommunityEngine: typeof CommunityEngine };
    const discord = await import(pathToFileURL(join(source.root, 'server/src/community/discord.ts')).href) as { createCommunityDiscord: typeof createCommunityDiscord };
    await measure(source.revision, { engine: engine.CommunityEngine, adapter: discord.createCommunityDiscord });
  }
  await measure('working-tree');
} finally { if (snapshot) rmSync(snapshot, { recursive: true, force: true }); }
