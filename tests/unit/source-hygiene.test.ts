// A raw NUL byte in a source file makes git classify the whole file as binary,
// which hides every later change to it from `git diff` and from PR review.
// worker/ai/config.ts carried two from ca73f92 until they became `\u0000`
// escapes — same string at runtime, reviewable in git.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILED_DM_GRACE_MS } from '../../shared/scoring';

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_DIRS = ['worker', 'shared', 'src', 'tests', 'migrations'];
const ROOT_FILES = ['schema.sql', 'index.html', 'wrangler.toml'];
const SOURCE_EXT = /\.(ts|tsx|js|css|sql)$/;
const MINUTE_MS = 60_000;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return SOURCE_EXT.test(entry.name) ? [full] : [];
  });
}

describe('source files', () => {
  it('contain no raw NUL bytes', () => {
    const files = [
      ...SOURCE_DIRS.flatMap((d) => sourceFiles(path.join(ROOT, d))),
      ...ROOT_FILES.map((f) => path.join(ROOT, f)),
    ];
    const offenders = files
      .filter((file) => readFileSync(file).includes(0))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

// H8 (spec §6.1): Vite emits CSS in import order. theme.css must come first so
// component stylesheets override its base rules — imported after App it silently
// beat them (modal shadow, .dlink__bind blue, .pd__revoke-btn red, pill radii).
describe('src/main.tsx', () => {
  it('imports theme.css before App', () => {
    const main = readFileSync(path.join(ROOT, 'src/main.tsx'), 'utf8');
    const themeAt = main.indexOf("import './theme.css';");
    const appAt = main.indexOf("from './App';");
    expect(themeAt).toBeGreaterThanOrEqual(0);
    expect(appAt).toBeGreaterThanOrEqual(0);
    expect(themeAt).toBeLessThan(appAt);
  });
});

describe('shared constants that SQL repeats', () => {
  it('FILED_DM_GRACE_MS equals the filing DM delay in 0004_dm.sql', () => {
    const sql = readFileSync(path.join(ROOT, 'server/migrations/0004_dm.sql'), 'utf8');
    // The interval on the dm.filed outbox_emit call (0004_dm.sql:103-104). Not
    // 0005_sessions.sql's 3-minute reschedule merge: that is a different rule.
    const filed = /outbox_emit\('dm\.filed'[^;]*?interval '(\d+) minutes'/.exec(sql);
    expect(filed, "dm.filed's interval not found in 0004_dm.sql").not.toBeNull();
    expect(Number(filed?.[1]) * MINUTE_MS).toBe(FILED_DM_GRACE_MS);
  });
});

// P1-1 (contract §6.5): src/lib/router.ts is the only module that drives
// window.history — anything else writing an entry would break 返回 and the idx marks.
describe('history API', () => {
  const HISTORY_USE = /history\.(?:pushState|replaceState|back\(|go\(|forward\(|state\b)/;
  const ROUTER = path.join('src', 'lib', 'router.ts');

  it('is used only by src/lib/router.ts', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src'))
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => path.relative(ROOT, file))
      .filter((file) => file !== ROUTER)
      .filter((file) => HISTORY_USE.test(readFileSync(path.join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('still sees the router itself (the scan is not vacuous)', () => {
    expect(HISTORY_USE.test(readFileSync(path.join(ROOT, ROUTER), 'utf8'))).toBe(true);
  });
});
