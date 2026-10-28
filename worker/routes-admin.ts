// Admin-only endpoints, split out of routes.ts for size. Every handler here
// begins with requireAdmin — there is no other gate, so keeping them in one file
// makes that easy to audit at a glance.

import type { Hono } from 'hono';
import { VIOLATION_MAP } from '../shared/scoring';
import type { AppEnv, UserRow } from './types';
import { ApiError } from './errors';
import { adminUpdateUser } from './db';
import { overrideCase, redactRecord } from './cases';
import { regenerateReport } from './report';
import {
  AI_SETTING_KEYS,
  aiDisabledReason,
  loadAiConfig,
  normalizeBaseUrl,
  readSettings,
  resolveAiConfig,
  writeSetting,
} from './ai/config';
import { judgeCase } from './ai/provider';
import { resetOffsetHours } from './time';
import {
  isRecordObject,
  optBool,
  optNumber,
  optString,
  parseId,
  readJsonBody,
  requireAdmin,
  requireString,
} from './http';

export function registerAdminRoutes(app: Hono<AppEnv>): void {
  // --- Admin ---------------------------------------------------------------
  app.get('/api/admin/users', async (c) => {
    c.header('Cache-Control', 'private, no-store');
    requireAdmin(c.get('user'));
    type Row = Pick<UserRow, 'id' | 'username' | 'avatar_url' | 'is_participant' | 'is_judge' | 'is_admin' | 'score' | 'created_at'>;
    // One extra row distinguishes an exact 500 from a truncated response.
    // Explicit fields keep email, OAuth account details and Discord data out.
    const rows = await c.env.DB.prepare(`SELECT id, COALESCE(display_name, username) AS username,
      avatar_url, is_participant, is_judge, is_admin, score, created_at
      FROM users ORDER BY created_at DESC, id ASC LIMIT 501`).all<Row>();
    const users = rows.results.slice(0, 500).map((row) => ({
      id: row.id, username: row.username, avatar_url: row.avatar_url,
      is_participant: row.is_participant === 1, is_judge: row.is_judge === 1, is_admin: row.is_admin === 1,
      score: row.score, created_at: row.created_at,
    }));
    return c.json({ users, truncated: rows.results.length > 500 });
  });

  app.post('/api/admin/report/:week/regenerate', async (c) => {
    requireAdmin(c.get('user'));
    const report = await regenerateReport(
      c.env.DB,
      c.env,
      c.req.param('week'),
      resetOffsetHours(c.env.RESET_TZ_OFFSET),
    );
    return c.json({ report });
  });

  app.post('/api/admin/users/:id', async (c) => {
    requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    await adminUpdateUser(c.env.DB, c.req.param('id'), {
      is_participant: optBool(body.is_participant),
      is_judge: optBool(body.is_judge),
      is_admin: optBool(body.is_admin),
      score: optNumber(body.score),
      delete: optBool(body.delete),
    });
    return c.json({ ok: true });
  });

  app.post('/api/admin/records/:id/override', async (c) => {
    const caller = requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const delta = optNumber(body.delta);
    if (delta === undefined) throw new ApiError(400, '缺少 delta');
    const record = await overrideCase(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      delta,
      requireString(body.reason, 'reason'),
    );
    return c.json({ record: redactRecord(record, caller) });
  });

  app.get('/api/admin/ai-config', async (c) => {
    requireAdmin(c.get('user'));
    const settings = await readSettings(c.env.DB);
    const cfg = await resolveAiConfig(settings, c.env);
    const stats = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks,
                SUM(clamped) AS clamps,
                AVG(latency_ms) AS avg_latency
           FROM ai_verdicts
          WHERE created_at >= datetime('now', '-7 days') AND kind = 'sentence'`,
      )
      .first<{ total: number; fallbacks: number; clamps: number; avg_latency: number | null }>();
    const total = stats?.total ?? 0;
    return c.json({
      enabled: cfg.enabled,
      base_url: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      prompt: cfg.prompt,
      classify_prompt: cfg.classifyPrompt,
      report_prompt: cfg.reportPrompt,
      prompt_version: cfg.promptVersion,
      has_api_key: cfg.apiKey.length > 0,
      disabled_reason: aiDisabledReason(cfg),
      recent: {
        total,
        fallbackRate: total > 0 ? (stats?.fallbacks ?? 0) / total : 0,
        clampRate: total > 0 ? (stats?.clamps ?? 0) / total : 0,
        avgLatencyMs: Math.round(stats?.avg_latency ?? 0),
      },
    });
  });

  app.post('/api/admin/ai-config', async (c) => {
    const caller = requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    if (body.api_key !== undefined) {
      throw new ApiError(
        400,
        'API Key 不存数据库，请用 `wrangler secret put AI_API_KEY` 设置',
      );
    }
    const writes: Promise<void>[] = [];
    if (body.enabled !== undefined) {
      const enabled = optBool(body.enabled);
      if (enabled === undefined) throw new ApiError(400, 'enabled 必须是布尔值');
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.enabled, String(enabled), caller.id));
    }
    if (body.base_url !== undefined) {
      const url = normalizeBaseUrl(requireString(body.base_url, 'base_url'));
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ApiError(400, 'base_url 不是合法的 URL');
      }
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        throw new ApiError(400, 'base_url 必须是 https（本地调试可用 localhost）');
      }
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.baseUrl, url, caller.id));
    }
    if (body.model !== undefined) {
      writes.push(
        writeSetting(c.env.DB, AI_SETTING_KEYS.model, requireString(body.model, 'model').trim(), caller.id),
      );
    }
    if (body.temperature !== undefined) {
      const t = optNumber(body.temperature);
      if (t === undefined || t < 0 || t > 2) throw new ApiError(400, 'temperature 需在 0–2 之间');
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.temperature, String(t), caller.id));
    }
    for (const [field, key] of [
      ['prompt', AI_SETTING_KEYS.prompt],
      ['classify_prompt', AI_SETTING_KEYS.classifyPrompt],
      ['report_prompt', AI_SETTING_KEYS.reportPrompt],
    ] as const) {
      if (body[field] === undefined) continue;
      const prompt = requireString(body[field], field);
      if (prompt.length > 8000) throw new ApiError(400, '提示词最多 8000 字');
      writes.push(writeSetting(c.env.DB, key, prompt, caller.id));
    }
    await Promise.all(writes);
    const cfg = await loadAiConfig(c.env.DB, c.env);
    return c.json({ ok: true, enabled: cfg.enabled, prompt_version: cfg.promptVersion });
  });

  // Dry run against a sample case: writes nothing, touches nobody's score.
  app.post('/api/admin/ai-config/test', async (c) => {
    requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const cfg = await loadAiConfig(c.env.DB, c.env);
    const def = VIOLATION_MAP.no_show;
    const started = Date.now();
    const outcome = await judgeCase(cfg, {
      def,
      subject: { name: '测试选手', score: 72, tier: '基本靠谱' },
      priors: { sameType30d: 1, penalties30d: 2 },
      claim:
        optString(body.claim) ??
        '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。',
      statement:
        optString(body.statement) ??
        '公司临时通宵发版，手机落在会议室了，第二天才看到消息，已经给大家发了红包。',
      sessionContext: null,
    });
    return c.json({
      ok: outcome.source === 'ai',
      source: outcome.source,
      verdict: {
        delta: outcome.delta,
        headline: outcome.headline,
        reasoning: outcome.reasoning,
        factors: outcome.factors,
      },
      error: outcome.audit.error,
      clamped: outcome.audit.clamped,
      parsed_delta: outcome.audit.parsedDelta,
      latency_ms: outcome.audit.latencyMs || Date.now() - started,
      raw: outcome.audit.rawResponse,
    });
  });

}
