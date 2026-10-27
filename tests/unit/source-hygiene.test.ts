// A raw NUL byte in a source file makes git classify the whole file as binary,
// which hides every later change to it from `git diff` and from PR review.
// worker/ai/config.ts carried two from ca73f92 until they became `\u0000`
// escapes — same string at runtime, reviewable in git.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILED_DM_GRACE_MS } from '../../shared/scoring';
import { COMMANDS } from '../../server/src/discord/commands';
import { BACK_HOME } from '../../src/lib/routeCopy';

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

describe('page sharing metadata', () => {
  it('describes the board and cases without advertising retired scheduling', () => {
    const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const descriptions = [...html.matchAll(/<meta (?:name="description"|property="og:description") content="([^"]+)"/g)]
      .map((match) => match[1]);
    expect(descriptions).toEqual(['EDG 信誉分：开黑守约、榜单与案件。', 'EDG 信誉分：开黑守约、榜单与案件。']);
  });
});

// S1: public setup and API documentation must not send readers to removed features.
describe('public documentation after sessions retire', () => {
  it('lists only existing Worker modules in the contract', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const modules = contract.split('## Worker modules')[1]?.split('\n## ')[0] ?? '';
    const files = [...modules.matchAll(/`(worker\/[^`]+\.ts)`/g)].map((match) => match[1]);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => !existsSync(path.join(ROOT, file)))).toEqual([]);
  });

  it('retires scheduling endpoints while documenting the permanent old URL landings', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    expect(contract).not.toMatch(/^- `(?:GET|POST|PATCH) \/api\/(?:sessions\b|me\/(?:invites|invitable)\b)/m);
    expect(contract).toContain('`/sessions/*`');
    expect(contract).toContain('约局功能已下线');
    expect(contract).toContain(`page 「这页不存在」 with a 「${BACK_HOME}」 link:`);
    expect(contract).toMatch(/`\/?\?session[^`]*`[^\n]*首页/);
  });

  it('keeps the Discord setup command table and count aligned with the bot', () => {
    const deploy = readFileSync(path.join(ROOT, 'docs/DEPLOY-DISCORD.md'), 'utf8');
    const names = [...deploy.matchAll(/^\| `\/([a-z]+)[^`]*` \|/gm)].map((match) => match[1]);
    expect(names).toEqual(COMMANDS.map((command) => command.name));
    expect(deploy).toContain(`registered ${COMMANDS.length} slash commands`);
    expect(deploy).not.toContain('DISCORD_SESSION_CHANNEL_ID');
    expect(deploy).toContain('`dm.welcome`');
    expect(deploy).toContain('`shared/guide.ts`');
    expect(deploy).toContain('`0009_welcome.sql`');
  });

  it('no longer advertises website scheduling and roll call in the README', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).not.toMatch(/^### 约局/m);
    expect(readme).not.toContain('还能站内**约局**');
    expect(readme).not.toContain('一键点名');
    expect(readme).not.toContain('SESSION_ORGANIZER_CAN_FILE');
    expect(readme).toContain(`| 其他任何路径 | 页面 | 「这页不存在」，附「${BACK_HOME}」 |`);
  });
});


// S2: document the new entry flow and its existing-backend compatibility rules.
describe('welcome and guide documentation', () => {
  it('documents welcome and guide as full pages with server-derived completion', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    for (const route of ['/welcome', '/guide']) {
      const row = contract.split('\n').find((line) => line.startsWith(`  | \`${route}\` |`));
      expect(row, `${route} route is missing from the contract table`).toBeDefined();
      expect(row).toContain('full page');
      expect(row).toContain('same full page');
    }
    expect(contract).toContain('notify_dm');
    expect(contract).toContain('dm_ok');
    expect(contract).toContain('404 never marks steps 2 or 3 complete');
    expect(contract).not.toContain('S1 retains `OnboardingDialog`');
  });

  it('documents the Node-only welcome retry endpoint and its rolling quota', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const start = contract.indexOf('- `POST /api/me/discord/welcome`');
    expect(start).toBeGreaterThanOrEqual(0);
    const endpoint = contract.slice(start).split('\n\n')[0];
    for (const status of ['401', '409', '429', '503']) expect(endpoint).toContain(status);
    expect(endpoint).toContain('24 hours');
    expect(endpoint).toContain('3 manual');
    expect(endpoint).toContain('{ ok: true }');
    expect(contract).toContain('Node-only');
  });

  it('documents deferred entry targets without retaining the first-login dialog', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(contract).toContain('`edg.welcome.return`');
    expect(contract).toContain('30 minutes');
    expect(contract).toContain('完成，去首页');
    expect(contract).toMatch(/`\?onboarding=1`[\s\S]{0,150}`\/welcome`/);
    expect(contract).toMatch(/`\?linked=discord`[\s\S]{0,150}`\/welcome`/);
    expect(contract).not.toContain('after the first-login dialog');
    expect(contract).not.toContain('dialog first; the case target');
    expect(readme).not.toContain('S1 继续使用现有身份弹窗');
    expect(readme).not.toContain('继续打开现有首登弹窗');
  });

  it('documents account-specific onboarding notice dismissal separately from completion', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    expect(contract).toContain('`edg.todo.onboarding-dismissed`');
    expect(contract).toContain('7 days');
    expect(contract).toContain('step IDs');
    expect(contract).toMatch(/onboarding card[^\n]*badge[^\n]*dot/);
  });
});
