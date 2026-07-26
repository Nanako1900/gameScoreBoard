// Case lifecycle: file → statement → AI verdict → decided, plus withdraw /
// appeal / revoke / admin override and the lazy sweep that judges overdue cases.
//
// A "case" is a row in `records`. Penalties run the full trial; bonuses settle
// immediately at their base value because nobody contests being given points.

import {
  MAX_NARRATIVE_LEN,
  MIN_CLAIM_LEN,
  STATEMENT_WINDOW_HOURS,
  VIOLATION_MAP,
  WEEKLY_BONUS_CAP,
  clampScore,
  clampVerdictDelta,
  isValidViolationType,
  needsTrial,
  tierFor,
  type CaseStatus,
  type VerdictSource,
  type ViolationDef,
  type ViolationType,
} from '../shared/scoring';
import type {
  Env,
  RecordItem,
  RecordJoinRow,
  RecordRow,
  User,
  VerdictFactor,
} from './types';
import { ApiError } from './errors';
import { normalizeNarrative } from './case-limits';
import { statementWindowHours } from './case-limits';
export {
  MAX_BATCH_SUBJECTS,
  confirmEscalation,
  dismissEscalation,
  fileCase,
  fileCases,
  reclassifyCase,
  type BatchAccusation,
  type BatchFailure,
  type BatchResult,
  type FileCaseInput,
  type FileCaseOptions,
} from './case-filing';
export { MAX_CASES_PER_REPORTER_24H, MAX_CASES_PER_SUBJECT_24H } from './case-limits';
import {
  SCORED_STATUSES,
  defFor,
  getRecordRow,
  loadRecordItem,
} from './case-reads';
export {
  getRecordItemById,
  listRecords,
  pendingCounts,
  type ListRecordsFilters,
  type PendingCounts,
} from './case-reads';
import {
  getUserById,
  requireParticipant,
  scoreMutation,
  type ScoreMutation,
} from './db';
import { loadAiConfig } from './ai/config';
import { judgeCase } from './ai/provider';
import type { JudgeRequest } from './ai/prompt';
import {
  ESCALATION_ONLY,
  classifyClaim,
  summaryFromClaim,
  type Classification,
  type ClassifiedBy,
} from './ai/classify';
import {
  parseSqlUtc,
  sqlNow,
  sqlNowMinusMinutes,
  sqlNowPlusHours,
  weekStartUtcSql,
} from './time';

// --- Tunables ----------------------------------------------------------------

/** A `judging` row older than this is treated as abandoned and re-claimed. */
export const JUDGING_STALE_MINUTES = 2;
/** Cases judged per lazy sweep — bounds AI spend on a single page load. */
export const SWEEP_BATCH = 5;
/** Reporter self-revoke window for instantly-settled (bonus) records. */
const REVOKE_WINDOW_MS = 15 * 60 * 1000;
const PRIORS_WINDOW_DAYS = 30;

// --- Mapping -----------------------------------------------------------------

// --- Guarded score writes ----------------------------------------------------

/**
 * Score statements that fire ONLY while the case is still in `expectedStatus`.
 *
 * Without this guard, a batch whose record-UPDATE matched zero rows — because a
 * concurrent path (a re-claiming sweep, a double-clicked revoke) already moved
 * the case on — would still apply its delta, charging the player twice. The
 * record-UPDATE must therefore be batched AFTER these statements, or the status
 * would already have changed by the time the EXISTS check runs.
 */
function guardedScoreMutation(
  db: D1Database,
  userId: string,
  oldScore: number,
  delta: number,
  reason: string,
  recordId: number,
  expectedStatus: CaseStatus,
): ScoreMutation {
  const newScore = clampScore(oldScore + delta);
  const applied = newScore - oldScore;
  const guard = 'EXISTS (SELECT 1 FROM records WHERE id = ? AND status = ?)';
  return {
    applied,
    newScore,
    statements: [
      db
        .prepare(
          `UPDATE users SET score = ?, updated_at = datetime('now')
            WHERE id = ? AND ${guard}`,
        )
        .bind(newScore, userId, recordId, expectedStatus),
      db
        .prepare(
          `INSERT INTO score_events (user_id, delta, reason, resulting_score)
           SELECT ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(userId, applied, reason, newScore, recordId, expectedStatus),
    ],
  };
}

// --- Statement ---------------------------------------------------------------

/**
 * The subject's one and only statement. Submitting it immediately closes the
 * window and runs the verdict synchronously — waiting a few seconds to read the
 * judgment is the point of the feature, not a cost.
 */
export async function submitStatement(
  db: D1Database,
  caller: User,
  id: number,
  rawStatement: string,
  env: Env,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (rec.subject_id !== caller.id) throw new ApiError(403, '只能为自己的案件陈述');
  if (rec.status !== 'awaiting_statement') {
    throw new ApiError(400, '该案件已经不在陈述阶段了');
  }
  const statement = normalizeNarrative(rawStatement, '情况说明', 1);

  // Atomic claim: writing the statement and taking the case for judging in one
  // conditional update means a double-submit cannot trigger two AI calls.
  const claimed = await db
    .prepare(
      `UPDATE records
          SET statement = ?, statement_at = datetime('now'),
              status = 'judging', judging_started_at = datetime('now')
        WHERE id = ? AND status = 'awaiting_statement'`,
    )
    .bind(statement, id)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    throw new ApiError(409, '该案件已经在裁决中了');
  }

  // The statement is already safely stored, so a failure from here on must not
  // surface as "提交失败" — that would invite a resubmit which can only 409. Let
  // the case sit in `judging`; the sweep picks it up within JUDGING_STALE_MINUTES
  // and the UI shows "AI 正在裁决…" meanwhile.
  try {
    await judgeAndDecide(db, env, id);
  } catch (err) {
    console.error(`inline judging of case ${id} failed; leaving it to the sweep`, err);
  }
  return loadRecordItem(db, id);
}

// --- Judging -----------------------------------------------------------------

async function buildJudgeRequest(
  db: D1Database,
  rec: RecordRow,
  def: ViolationDef,
): Promise<JudgeRequest> {
  const subject = await getUserById(db, rec.subject_id);
  if (!subject) throw new ApiError(404, '选手不存在');
  const since = sqlNowMinusMinutes(PRIORS_WINDOW_DAYS * 24 * 60);

  const sameType = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM records
        WHERE subject_id = ? AND type = ? AND id != ? AND status IN ${SCORED_STATUSES}
          AND created_at >= ?`,
    )
    .bind(rec.subject_id, rec.type, rec.id, since)
    .first<{ n: number }>();
  const penalties = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM records
        WHERE subject_id = ? AND delta < 0 AND id != ? AND status IN ${SCORED_STATUSES}
          AND created_at >= ?`,
    )
    .bind(rec.subject_id, rec.id, since)
    .first<{ n: number }>();

  let sessionContext: string | null = null;
  if (rec.session_id !== null) {
    const s = await db
      .prepare(
        `SELECT g.title AS title, g.starts_at AS starts_at,
                (SELECT COUNT(*) FROM session_players sp
                  WHERE sp.session_id = g.id AND sp.rsvp = 'going') AS going
           FROM game_sessions g WHERE g.id = ?`,
      )
      .bind(rec.session_id)
      .first<{ title: string; starts_at: string; going: number }>();
    if (s) {
      sessionContext = `「${s.title}」约定 ${s.starts_at}，共 ${s.going} 人报名`;
    }
  }

  const displayName = subject.display_name ?? subject.username;
  return {
    def,
    subject: { name: displayName, score: subject.score, tier: tierFor(subject.score).name },
    priors: { sameType30d: sameType?.n ?? 0, penalties30d: penalties?.n ?? 0 },
    claim: rec.claim ?? '',
    statement: rec.statement,
    sessionContext,
  };
}

/**
 * Run the verdict for a case already in `judging` and write the outcome.
 * Never leaves the case in `judging`: on any AI failure the base sentence is
 * applied with `verdict_source='fallback'`, because a stuck case means a
 * player's score is indefinitely in limbo.
 */
export async function judgeAndDecide(db: D1Database, env: Env, id: number): Promise<void> {
  const rec = await getRecordRow(db, id);
  if (rec.status !== 'judging') return; // someone else finished it first
  const def = defFor(rec.type);

  const [request, cfg] = await Promise.all([
    buildJudgeRequest(db, rec, def),
    loadAiConfig(db, env),
  ]);
  const outcome = await judgeCase(cfg, request);

  const subject = await getUserById(db, rec.subject_id);
  if (!subject) throw new ApiError(404, '选手不存在');

  // Belt and braces: provider.ts already clamped, clamp again at the write edge
  // so no future call path can slip an unbounded delta into the database.
  const verdictDelta = clampVerdictDelta(def, outcome.delta);
  const mutation = guardedScoreMutation(
    db,
    subject.id,
    subject.score,
    verdictDelta,
    `record:${id}`,
    id,
    'judging',
  );

  // Score first, record second: the guard reads the status the record-UPDATE is
  // about to change. The AI call above is seconds long, so a stale-reclaiming
  // sweep really can be running the same case concurrently.
  await db.batch([
    ...mutation.statements,
    db
      .prepare(
        `UPDATE records
            SET delta = ?, status = 'decided', verdict_source = ?,
                verdict_headline = ?, verdict_reason = ?, verdict_factors = ?,
                judging_started_at = NULL
          WHERE id = ? AND status = 'judging'`,
      )
      .bind(
        mutation.applied,
        outcome.source,
        outcome.headline,
        outcome.reasoning,
        JSON.stringify(outcome.factors),
        id,
      ),
    db
      .prepare(
        `INSERT INTO ai_verdicts
           (record_id, kind, provider, model, prompt_version, raw_response, parsed_delta,
            applied_delta, clamped, confidence, latency_ms, error)
         VALUES (?, 'sentence', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        outcome.audit.provider,
        outcome.audit.model,
        outcome.audit.promptVersion,
        outcome.audit.rawResponse,
        outcome.audit.parsedDelta,
        mutation.applied,
        outcome.audit.clamped ? 1 : 0,
        outcome.audit.confidence,
        outcome.audit.latencyMs,
        outcome.audit.error,
      ),
  ]);
}

// --- Lazy sweep --------------------------------------------------------------

export interface SweepResult {
  judged: number;
  failed: number;
}

/**
 * Judge cases whose statement window has lapsed, plus any `judging` row
 * abandoned by a crashed request. Runs from `/api/config` via `waitUntil` (the
 * same lazy pattern as the weekly heal), so no Cron Trigger is required.
 */
export async function sweepDueCases(
  db: D1Database,
  env: Env,
  limit = SWEEP_BATCH,
): Promise<SweepResult> {
  const stale = sqlNowMinusMinutes(JUDGING_STALE_MINUTES);
  const due = await db
    .prepare(
      `SELECT id FROM records
        WHERE (status = 'awaiting_statement' AND deadline_at IS NOT NULL AND deadline_at <= ?)
           OR (status = 'judging' AND (judging_started_at IS NULL OR judging_started_at <= ?))
        ORDER BY id ASC LIMIT ?`,
    )
    .bind(sqlNow(), stale, limit)
    .all<{ id: number }>();

  let judged = 0;
  let failed = 0;
  for (const { id } of due.results) {
    try {
      // Conditional claim — if another request got here first, changes = 0.
      const claimed = await db
        .prepare(
          `UPDATE records
              SET status = 'judging', judging_started_at = datetime('now')
            WHERE id = ?
              AND ((status = 'awaiting_statement' AND deadline_at IS NOT NULL AND deadline_at <= ?)
                OR (status = 'judging' AND (judging_started_at IS NULL OR judging_started_at <= ?)))`,
        )
        .bind(id, sqlNow(), stale)
        .run();
      if ((claimed.meta?.changes ?? 0) === 0) continue;
      await judgeAndDecide(db, env, id);
      judged += 1;
    } catch (err) {
      failed += 1;
      console.error(`judging case ${id} failed`, err);
    }
  }
  return { judged, failed };
}

// --- Post-verdict actions ----------------------------------------------------

/** Reporter (or admin) pulls a case before any score moved. */
export async function withdrawCase(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  const isReporter = rec.reporter_id === caller.id;
  if (!caller.is_admin && !isReporter) throw new ApiError(403, '无权撤案');
  const withdrawable: CaseStatus[] = caller.is_admin
    ? ['awaiting_statement', 'judging']
    : ['awaiting_statement'];
  if (!(withdrawable as string[]).includes(rec.status)) {
    throw new ApiError(400, '该案件已进入裁决结果，只能撤销不能撤案');
  }
  await db
    .prepare("UPDATE records SET status = 'withdrawn' WHERE id = ? AND status = ?")
    .bind(id, rec.status)
    .run();
  return loadRecordItem(db, id);
}

/** Subject contests a decided case. Score unchanged; an admin reviews it. */
export async function appealCase(
  db: D1Database,
  caller: User,
  id: number,
  reason: string | undefined,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (rec.subject_id !== caller.id) throw new ApiError(403, '只能对针对自己的记录提出异议');
  if (rec.status !== 'decided') {
    throw new ApiError(400, '只有已判决的案件可以申诉');
  }
  const text = reason?.trim().slice(0, MAX_NARRATIVE_LEN) ?? '';
  await db
    .prepare(
      "UPDATE records SET status = 'appealed', appeal_reason = ? WHERE id = ? AND status = 'decided'",
    )
    .bind(text.length > 0 ? text : null, id)
    .run();
  return loadRecordItem(db, id);
}

/** Reverse a decided case's delta. Admin anytime; reporter within 15 min. */
export async function revokeCase(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (rec.status === 'revoked') throw new ApiError(400, '记录已撤销');
  if (rec.status === 'withdrawn') throw new ApiError(400, '记录已撤案');
  if (rec.status === 'awaiting_statement' || rec.status === 'judging') {
    throw new ApiError(400, '案件尚未判决，请使用撤案');
  }

  const isReporter = rec.reporter_id === caller.id;
  const withinWindow = Date.now() - parseSqlUtc(rec.created_at) <= REVOKE_WINDOW_MS;
  if (!(caller.is_admin || (isReporter && withinWindow))) {
    throw new ApiError(403, '无权撤销此记录');
  }

  const subject = await getUserById(db, rec.subject_id);
  if (!subject) throw new ApiError(404, '选手不存在');
  const mutation = guardedScoreMutation(
    db,
    subject.id,
    subject.score,
    -rec.delta,
    `revoke:${id}`,
    id,
    rec.status as CaseStatus,
  );

  // Guarded + score-first, so a double-submitted revoke refunds only once.
  await db.batch([
    ...mutation.statements,
    db
      .prepare("UPDATE records SET status = 'revoked' WHERE id = ? AND status = ?")
      .bind(id, rec.status),
  ]);
  return loadRecordItem(db, id);
}

/** Admin re-sentences an appealed (or decided) case by hand. */
export async function overrideCase(
  db: D1Database,
  caller: User,
  id: number,
  delta: number,
  reason: string,
): Promise<RecordItem> {
  if (!caller.is_admin) throw new ApiError(403, '需要管理员权限');
  const rec = await getRecordRow(db, id);
  if (rec.status !== 'decided' && rec.status !== 'appealed') {
    throw new ApiError(400, '只有已判决 / 申诉中的案件可以改判');
  }
  const text = reason.trim();
  if (text.length === 0) throw new ApiError(400, '改判必须写明理由');

  const def = defFor(rec.type);
  const target = clampVerdictDelta(def, delta);
  const subject = await getUserById(db, rec.subject_id);
  if (!subject) throw new ApiError(404, '选手不存在');

  // Move the score by the difference so the record ends up worth exactly `target`.
  const mutation = guardedScoreMutation(
    db,
    subject.id,
    subject.score,
    target - rec.delta,
    `override:${id}`,
    id,
    rec.status as CaseStatus,
  );
  const finalDelta = rec.delta + mutation.applied;

  await db.batch([
    ...mutation.statements,
    db
      .prepare(
        `UPDATE records
            SET delta = ?, status = 'decided', verdict_source = 'admin_override',
                verdict_headline = '管理员改判', verdict_reason = ?, verdict_factors = '[]'
          WHERE id = ? AND status = ?`,
      )
      .bind(finalDelta, text.slice(0, MAX_NARRATIVE_LEN), id, rec.status),
  ]);
  return loadRecordItem(db, id);
}
