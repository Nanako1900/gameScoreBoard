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
import { VOICE_RANGE_MAX_DAYS, VOICE_RETENTION_DAYS } from '../../shared/voice';

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

/** Table shape may evolve; only the path cell identifies a route. */
function routeRow(document: string, route: string): string {
  const row = document.split('\n').find((line) => line.trimStart().startsWith('|')
    && line.split('|')[1]?.includes('`' + route + '`'));
  expect(row, `${route} route is missing from the documentation table`).toBeDefined();
  return row ?? '';
}

const normalized = (value: string): string => value.replace(/\s+/g, ' ');

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
    const fallback = readme.split('\n').find(line => line.startsWith('| 其他任何路径 |'));
    expect(fallback).toContain('「这页不存在」');
    expect(fallback).toContain(`「${BACK_HOME}」`);
  });
});


// S2: document the new entry flow and its existing-backend compatibility rules.
describe('welcome and guide documentation', () => {
  it('documents welcome and guide as full pages with server-derived completion', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const frontend = contract.split('## Frontend expectations')[1] ?? '';
    expect(frontend).toContain('| Path | Page at every viewport |');
    expect(routeRow(frontend, '/welcome')).toContain('five-step onboarding');
    expect(routeRow(frontend, '/guide')).toContain('shared bot guide');
    expect(contract).toContain('notify_dm');
    expect(contract).toContain('dm_ok');
    expect(normalized(contract)).toContain('Step 2 requires a binding; step 3 requires both `notify_dm` and `dm_ok`');
    expect(normalized(contract)).toContain('step 4 requires `is_participant` or `is_judge`');
    expect(contract).toContain('Drafts never mark a step complete');
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
    const notice = contract.split('- The home onboarding hint')[1]?.split('\n- ')[0] ?? '';
    expect(normalized(notice)).toContain('neither a todo badge count nor an attention dot');
    expect(normalized(notice)).toContain('account, timestamp and missing step IDs');
    expect(normalized(notice)).toContain('newly missing step makes it reappear');
    expect(notice).toContain('never proves completion');
  });
});


// S3: readers must be able to distinguish private evidence from missing coverage.
describe('voice evidence documentation', () => {
  it('documents both private APIs, their public DTOs and authorization order', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const voice = contract.split('### Voice evidence (D1 and PostgreSQL)')[1]?.split('\n### ')[0] ?? '';
    expect(voice).toContain('`GET /api/voice?user=&from=&to=`');
    expect(voice).toContain('`GET /api/voice/day?date=`');
    expect(voice).toContain('401');
    expect(voice).toContain('404');
    expect(voice).toContain('before date validation or target lookup');
    expect(voice).toContain('private, no-store');
    expect(voice).toContain('`shared/voiceApi.ts`');
    for (const field of ['user', 'days', 'gaps', 'retention_days', 'first_join', 'total_min', 'in_voice_now', 'has_open_segment']) {
      expect(voice).toContain('`' + field + '`');
    }
    expect(voice).toContain('no Discord account IDs or channel IDs');
  });

  it('explains daily arithmetic, retention rejection and strictly persisted coverage', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const voice = contract.split('### Voice evidence (D1 and PostgreSQL)')[1]?.split('\n### ')[0] ?? '';
    expect(voice).toContain('default last 7 days');
    expect(voice).toContain(`at most ${VOICE_RANGE_MAX_DAYS} inclusive board dates`);
    expect(voice).toContain(`rolling ${VOICE_RETENTION_DAYS}-day cutoff`);
    expect(voice).toContain('400');
    expect(voice).toContain('`firstAvailableVoiceDate`');
    expect(voice).toContain('sum seconds for each day, then floor once to minutes');
    expect(voice).toContain('`continued`');
    expect(voice).toContain('persisted `[started_at, last_seen_at]`');
    expect(voice).toContain('never extend coverage to the query time');
    expect(voice).toContain('before and after the segment read');
    expect(voice).toContain('intersection');
    expect(voice).toContain('second-resolution UTC');
    expect(voice).toContain('尚未记录离开');
    expect(voice).toContain('没有保存的语音记录，不代表没来');
  });

  it('documents the two evidence tables and the implemented admin routes', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    for (const table of ['voice_sessions', 'voice_coverage']) expect(contract).toContain('`' + table + '`');
    expect(contract).toContain('partial unique index');
    expect(contract).toContain('`ON DELETE CASCADE`');
    expect(contract).toContain('`worker/voice.ts`');
    expect(contract).toContain('atomically withdraws coverage');
    const frontend = contract.split('## Frontend expectations')[1] ?? '';
    expect(frontend).toContain('| Path | Page at every viewport |');
    for (const route of ['/admin', '/admin/voice']) {
      expect(routeRow(frontend, route)).toContain('current voice tool');
      expect(routeRow(frontend, route)).toContain('staff gate retained');
    }
    for (const route of ['/admin/ai', '/admin/members']) {
      expect(routeRow(frontend, route)).toContain('current members / AI settings');
      expect(routeRow(frontend, route)).toContain('admins only');
    }
    expect(routeRow(frontend, '/tools/voice')).toContain('judge/admin voice evidence');
    expect(contract).toContain('`target="_blank" rel="noopener"`');
    expect(contract).toContain('`voiceNotice()`');
    expect(contract).not.toContain('S2 does not yet add voice recording');
  });

  it('describes voice intents, visibility and sanitized operational status', () => {
    const deploy = readFileSync(path.join(ROOT, 'docs/DEPLOY-DISCORD.md'), 'utf8');
    expect(deploy).toContain('Guilds + GuildVoiceStates');
    expect(deploy).toContain('非特权');
    expect(deploy).toContain('看不见的频道不会被记录');
    expect(deploy).toContain('包括私密频道');
    for (const field of ['coverage_since', 'degraded', 'open_segments', 'last_error']) expect(deploy).toContain('`' + field + '`');
    expect(deploy).toContain('HTTP 200');
    expect(deploy).toContain('不代表语音记录健康');
    expect(deploy).toContain('同一事务');
    expect(deploy).toContain('同一时段所有人的覆盖提示');
    expect(deploy).toContain('`open_segments: null`');
    expect(deploy).toContain('语音记录暂不可用，请查看机器人日志');
    expect(deploy).toContain('`0010_voice.sql`');
    expect(deploy).toContain('机主在服务器里发一条公告');
    expect(deploy).not.toContain('本期没有 `/voice`');
    expect(deploy).not.toContain('S2 尚不含语音记录');
  });

  it('documents local and owner-run D1 migrations without advertising future voice work', () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    for (const suffix of ['local', 'remote']) {
      expect(readme).toContain('`npm run db:migrate5:' + suffix + '`');
    }
    expect(readme).toContain('`migrations/005_voice.sql`');
    expect(readme).toContain('已有 D1');
    expect(readme).toContain('由机主');
    expect(readme).toMatch(/手机(?:、|和)桌面(?:均|都).*整页/);
    expect(routeRow(readme, '/admin/voice')).toContain('兼容旧地址');
    expect(routeRow(readme, '/tools/voice')).toContain('裁判或管理员');
    expect(readme).not.toContain('后续语音、信息板与管理路由');
  });
});


// S4: deployment docs must describe the implemented public board and recovery boundary.
describe('information board documentation', () => {
  it('documents the new queue entity, source triggers and unchanged D1 schema', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const board = contract.split('## Discord information board (S4)')[1]?.split('\n## ')[0] ?? '';
    for (const token of ['`board.refresh`', '`board`', '`0011_board.sql`', '`schedule_board_refresh()`', '`score_events`', '`records`', '`users`', '`weekly_reports`']) expect(board).toContain(token);
    expect(board).toContain('D1 needs no S4 migration');
    expect(board).toContain('BEFORE STATEMENT'); expect(board).toContain('AFTER STATEMENT');
  });
  it('documents public projection and private guild-bound board buttons', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const board = contract.split('## Discord information board (S4)')[1]?.split('\n## ')[0] ?? '';
    for (const token of ['15', '5', '`v1:board:me`', '`v1:board:voice`', 'ephemeral', 'no tiers', 'no Discord account IDs or channel IDs', 'count only']) expect(board).toContain(token);
  });
  it('documents strict recovery and the owner-run channel setup', () => {
    const deploy = readFileSync(path.join(ROOT, 'docs/DEPLOY-DISCORD.md'), 'utf8');
    for (const text of ['## S4 信息板', '`DISCORD_BOARD_CHANNEL_ID`', '读取消息历史', '机器人自己', '普通聊天正文', 'nonce', '10–40', '`0011_board.sql`']) expect(deploy).toContain(text);
    expect(deploy).toContain('权限'); expect(deploy).toContain('机主');
    expect(deploy).not.toContain('信息板频道在 S4 加入');
  });
  it('keeps welcome channel links private and stops advertising the board as future work', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    expect(contract).toContain('Only the welcome DM');
    expect(contract).toContain('`<#channelId>`');
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('S4'); expect(readme).toContain('`DISCORD_BOARD_CHANNEL_ID`');
    expect(readme).not.toContain('后续信息板与 AI / 成员管理路由');
  });
});


// S5: privileged management pages and their bounded private DTO are now available.
describe('admin management documentation', () => {
  it('documents the private account DTO, authorization and exact truncation boundary', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const admin = contract.split('### Admin (is_admin)')[1]?.split('\n## ')[0] ?? '';
    expect(admin).toContain('`GET /api/admin/users`');
    expect(admin).toContain('{ users: AdminUserRow[], truncated: boolean }');
    for (const field of ['id', 'username', 'avatar_url', 'is_participant', 'is_judge', 'is_admin', 'score', 'created_at']) {
      expect(admin).toContain('`' + field + '`');
    }
    for (const text of ['500', '501', 'created_at DESC, id ASC', 'private, no-store', '401', '403', 'unlisted accounts', 'no email, OAuth username or Discord fields']) expect(admin).toContain(text);
  });

  it('documents centralized settings, scoped tools, member search and limited UI actions', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    for (const text of ['「个人资料」「Discord 与通知」', '「成员与权限」「AI 模型与密钥」', 'client-side name search', 'self-dismissal', 'no delete, admin-grant or participant-toggle controls', '`/api/records?limit=50`']) expect(contract).toContain(text);
    expect(contract).not.toContain('still render NotFound until S5');
    expect(contract).not.toContain('AI dialog as 「AI 设置」 until S5');
    for (const route of ['/settings/members', '/settings/ai', '/tools/score']) {
      expect(routeRow(contract, route)).toContain('admins only');
      expect(routeRow(readme, route)).toContain('仅管理员');
    }
    for (const route of ['/admin/ai', '/admin/members']) expect(routeRow(readme, route)).toContain('兼容旧地址');
    expect(readme).toContain('设置 → AI 模型与密钥');
    expect(readme).toContain('最新 500 个账号');
    expect(readme).toContain('搜索只在当前列表内');
    expect(readme).toContain('不提供删除账号、授予管理员或切换他人上榜状态');
    expect(readme).not.toContain('后续 AI / 成员管理路由');
    expect(readme).not.toContain('**管理员 → AI 裁判配置**');
  });

  it('aligns both filing request shapes with judge-or-admin permissions', () => {
    const contract = readFileSync(path.join(ROOT, 'docs/CONTRACT.md'), 'utf8');
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    expect(contract).toContain('two shapes, both requiring `is_judge || is_admin`');
    expect(contract).toContain('`{ subject_ids: string[], claim, extras?, note? }`');
    expect(contract).toContain('`{ subject_id, type?, claim?, note? }`');
    expect(contract).not.toContain('two shapes, both requiring `is_judge`:');
    const adminRole = readme.split('\n').find(line => line.startsWith('| 管理员 (`is_admin`)'));
    expect(adminRole).toContain('立案');
    const judgeRole = readme.split('\n').find(line => line.startsWith('| 裁判 (`is_judge`)'));
    expect(judgeRole).toContain('立案');
    expect(readme).toContain('中途开溜由裁判或管理员记一笔');
    expect(readme).toContain('裁判或管理员勾 N 人');
    expect(readme).toContain('「设置 → 成员与权限」');
  });
});
