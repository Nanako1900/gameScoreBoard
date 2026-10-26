// Filing a case: single, batch, and the human overrides on the AI's category.
//
// Split from cases.ts (which owns statement → verdict → appeal) because filing is
// where the AI classifier lives, and that has its own security story — see the
// header of worker/ai/classify.ts for why classification happens HERE, at filing
// time, and not alongside sentencing.

import {
  MAX_NARRATIVE_LEN,
  MIN_CLAIM_LEN,
  isValidViolationType,
  needsTrial,
  type ViolationType,
} from '../shared/scoring';
import type { Env, RecordItem, User } from './types';
import { ApiError } from './errors';
import { appliedDeltaSql, requireParticipant, scoreMutation } from './db';
import { defFor, getRecordRow, loadRecordItem } from './case-reads';
import {
  assertRateLimits,
  assertWeeklyBonusCap,
  BonusCapReached,
  bonusCapGuard,
  normalizeNarrative,
  normalizeNote,
  statementWindowHours,
} from './case-limits';
import { loadAiConfig } from './ai/config';
import {
  ESCALATION_ONLY,
  classifyClaim,
  summaryFromClaim,
  type Classification,
  type ClassifiedBy,
} from './ai/classify';
import { sqlNowPlusHours } from './time';

// --- Filing ------------------------------------------------------------------

export interface FileCaseInput {
  subject_id: string;
  /**
   * Omit to let the AI classify from `claim` (the default 记一笔 path). Supply it
   * when the type is already known deterministically — roll-call settlement, or a
   * bonus, which the classifier is never allowed to produce.
   */
  type?: string;
  claim?: string;
  /** Short judge note. Returned publicly like every other record field. */
  note?: string;
  session_id?: number;
}

export interface FileCaseOptions {
  offsetHours: number;
  /** Set when a session organizer files within their own session (see sessions.ts). */
  skipJudgeCheck?: boolean;
  /** Skip the per-day limits for organizer roll-call settlement (already bounded). */
  skipRateLimit?: boolean;
  /** Provenance when `type` is supplied rather than classified. */
  classifiedBy?: ClassifiedBy;
}

/**
 * Open a case. Penalties enter `awaiting_statement` with delta 0 — no score
 * moves until the subject has had their say (or the window lapses). Bonuses
 * settle on the spot at their base value.
 */
export async function fileCase(
  db: D1Database,
  reporter: User,
  input: FileCaseInput,
  opts: FileCaseOptions,
  env: Env,
): Promise<RecordItem> {
  if (!opts.skipJudgeCheck && !reporter.is_judge) {
    throw new ApiError(403, '需要裁判权限');
  }
  // v3: `type` is optional. Omitted means "let the AI read the facts and decide",
  // which is the default path from the 记一笔 dialog. Supplied means the caller
  // already knows the type deterministically — roll-call settlement, or a judge
  // correcting a misclassification.
  const explicitType = input.type !== undefined;
  if (explicitType && !isValidViolationType(input.type as string)) {
    throw new ApiError(400, '无效的记录类型');
  }
  if (input.subject_id === reporter.id) {
    throw new ApiError(400, '不能记录自己');
  }
  const subject = await requireParticipant(db, input.subject_id);
  // Again on the row actually found, in case the input and the id it
  // resolved to ever differ.
  if (subject.id === reporter.id) {
    throw new ApiError(400, '不能记录自己');
  }
  const note = normalizeNote(input.note);

  if (!opts.skipRateLimit) {
    await assertRateLimits(db, reporter.id, subject.id);
  }

  // Bonuses must always be named explicitly — the AI classifier only ever
  // returns penalties, so points can never be conjured through it.
  if (!explicitType && (input.claim ?? '').trim().length < MIN_CLAIM_LEN) {
    throw new ApiError(400, `请把发生了什么写清楚，至少 ${MIN_CLAIM_LEN} 个字`);
  }

  let classification: Classification | null = null;
  let resolvedType: ViolationType;
  if (explicitType) {
    resolvedType = input.type as ViolationType;
  } else {
    const cfg = await loadAiConfig(db, env);
    classification = await classifyClaim(cfg, input.claim ?? '');
    resolvedType = classification.type;
  }
  const def = defFor(resolvedType);

  // --- Bonus: no trial, settle now ------------------------------------------
  if (!needsTrial(def)) {
    await assertWeeklyBonusCap(db, subject.id, def.base, opts.offsetHours);
    const claim = input.claim ? input.claim.trim().slice(0, MAX_NARRATIVE_LEN) : null;
    const insert = await db
      .prepare(
        `INSERT INTO records
           (subject_id, reporter_id, type, delta, note, claim, claim_summary,
            classified_by, session_id, verdict_source, verdict_headline,
            verdict_reason, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, '', 'decided')`,
      )
      .bind(
        subject.id,
        reporter.id,
        resolvedType,
        0, // patched below with the clamped applied delta
        note,
        claim,
        def.label,
        opts.classifiedBy ?? 'human',
        input.session_id ?? null,
        def.label,
      )
      .run();
    const recordId = Number(insert.meta?.last_row_id);
    if (!recordId) throw new ApiError(500, '创建记录失败');

    const reason = `record:${recordId}`;
    const applied = appliedDeltaSql(subject.id, reason);
    const results = await db.batch([
      // The cap once more, inside the write (see bonusCapGuard).
      ...scoreMutation(db, subject.id, def.base, reason, bonusCapGuard(subject.id, def.base, opts.offsetHours)),
      // What actually landed after clamping, read back from the event just written.
      db.prepare(`UPDATE records SET delta = ${applied.sql} WHERE id = ?`).bind(...applied.binds, recordId),
    ]);
    if ((results[1]?.meta?.changes ?? 0) === 0) {
      // Another bonus for this player took the week's last points meanwhile.
      await db.prepare('DELETE FROM records WHERE id = ?').bind(recordId).run();
      throw new BonusCapReached();
    }
    return loadRecordItem(db, recordId);
  }

  // --- Penalty: open the trial ----------------------------------------------
  const claim = normalizeNarrative(input.claim ?? '', '事实描述', MIN_CLAIM_LEN);
  const deadline = sqlNowPlusHours(statementWindowHours(env));
  const summary = classification?.summary ?? summaryFromClaim(claim);
  const classifiedBy: ClassifiedBy =
    classification?.classifiedBy ?? opts.classifiedBy ?? 'human';

  const insert = await db
    .prepare(
      `INSERT INTO records
         (subject_id, reporter_id, type, delta, note, claim, claim_summary,
          classified_by, escalation_suggested, session_id, deadline_at, status)
       VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'awaiting_statement')`,
    )
    .bind(
      subject.id,
      reporter.id,
      resolvedType,
      note,
      claim,
      summary,
      classifiedBy,
      classification?.escalationSuggested ? 1 : 0,
      input.session_id ?? null,
      deadline,
    )
    .run();
  const recordId = Number(insert.meta?.last_row_id);
  if (!recordId) throw new ApiError(500, '创建记录失败');

  if (classification) {
    await recordClassifyAudit(db, recordId, classification);
  }
  return loadRecordItem(db, recordId);
}

/** Audit the classification call alongside the sentencing calls, tagged `classify`. */
async function recordClassifyAudit(
  db: D1Database,
  recordId: number,
  c: Classification,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_verdicts
         (record_id, kind, provider, model, prompt_version, raw_response,
          parsed_delta, applied_delta, clamped, confidence, latency_ms, error)
       VALUES (?, 'classify', ?, ?, ?, ?, NULL, 0, ?, NULL, ?, ?)`,
    )
    .bind(
      recordId,
      c.audit.provider,
      c.audit.model,
      c.audit.promptVersion,
      c.audit.rawResponse,
      // `clamped` doubles as "the model asked for something we refused" — for a
      // classification that means an invalid or bonus type, or a forced
      // de-escalation from the group-wipe charge.
      c.classifiedBy === 'fallback' || c.escalationSuggested ? 1 : 0,
      c.audit.latencyMs,
      c.audit.error,
    )
    .run();
}

export interface BatchAccusation {
  subject_id: string;
  /** Per-subject addendum appended to the shared claim. */
  extra?: string;
}

export interface BatchFailure {
  subject_id: string;
  error: string;
}

export interface BatchResult {
  records: RecordItem[];
  failed: BatchFailure[];
}

export const MAX_BATCH_SUBJECTS = 8;

/**
 * File one case per subject from a shared narrative.
 *
 * Deliberately NOT atomic: if one of eight subjects is not on the board or has
 * hit their daily cap, the other seven should still be recorded rather than the
 * judge losing everything they typed. Failures come back per subject so the UI
 * can say exactly who was skipped and why.
 *
 * Each accusation is classified by its OWN AI call. Batching them into one
 * request would let text aimed at A steer B's category — a lateral influence
 * channel that does not need to exist.
 */
export async function fileCases(
  db: D1Database,
  reporter: User,
  accusations: BatchAccusation[],
  sharedClaim: string,
  note: string | undefined,
  opts: FileCaseOptions,
  env: Env,
): Promise<BatchResult> {
  if (accusations.length === 0) throw new ApiError(400, '请至少选择一位选手');
  if (accusations.length > MAX_BATCH_SUBJECTS) {
    throw new ApiError(400, `一次最多记 ${MAX_BATCH_SUBJECTS} 人`);
  }
  const seen = new Set<string>();
  for (const a of accusations) {
    if (seen.has(a.subject_id)) throw new ApiError(400, '同一位选手不能重复出现');
    seen.add(a.subject_id);
  }
  // Check the role ONCE, up front. Letting it fail per-subject would answer 200
  // with an all-failed list, which reads as "some names were bad" rather than
  // "you are not allowed to do this at all".
  if (!opts.skipJudgeCheck && !reporter.is_judge) {
    throw new ApiError(403, '需要裁判权限');
  }
  // Same for the shared narrative: it is one input, so reject it once rather than
  // reporting the identical error N times.
  const claim = normalizeNarrative(sharedClaim, '事实描述', MIN_CLAIM_LEN);

  const records: RecordItem[] = [];
  const failed: BatchFailure[] = [];
  for (const a of accusations) {
    const extra = a.extra?.trim();
    const full = extra ? `${claim}\n补充：${extra}` : claim;
    try {
      records.push(
        await fileCase(
          db,
          reporter,
          { subject_id: a.subject_id, claim: full.slice(0, MAX_NARRATIVE_LEN), note },
          opts,
          env,
        ),
      );
    } catch (err) {
      failed.push({
        subject_id: a.subject_id,
        error: err instanceof ApiError ? err.message : '立案失败',
      });
    }
  }
  return { records, failed };
}

/**
 * The judge co-signs the group-wipe charge the AI only hinted at.
 *
 * Allowed while the case is still pre-verdict: re-sentencing after the fact would
 * mean re-running the trial, and the subject argued their case against the lesser
 * charge. Post-verdict escalation is an admin override instead.
 */
/**
 * An admin, or the judge who filed the case. Being its reporter is not enough:
 * a session organizer files roll-call cases without being a judge, and must not
 * then re-type them (a 小迟到 into a 团灭级放鸽) past the roll call's own rules.
 */
function isFilingJudge(caller: User, reporterId: string): boolean {
  return caller.is_admin || (caller.is_judge && reporterId === caller.id);
}

export async function confirmEscalation(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (!isFilingJudge(caller, rec.reporter_id)) {
    throw new ApiError(403, '只有立案的裁判或管理员可以确认升级');
  }
  if (rec.escalation_suggested !== 1) {
    throw new ApiError(400, '该案件没有待确认的升级');
  }
  if (rec.status !== 'awaiting_statement') {
    throw new ApiError(400, '案件已进入裁决，升级请走管理员改判');
  }
  const res = await db
    .prepare(
      `UPDATE records
          SET type = ?, escalation_suggested = 0, classified_by = 'human'
        WHERE id = ? AND status = 'awaiting_statement' AND escalation_suggested = 1`,
    )
    .bind(ESCALATION_ONLY, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) throw new ApiError(409, '记录状态已变化，请刷新后重试');
  return loadRecordItem(db, id);
}

/** Dismiss the AI's escalation hint and keep the lesser charge. */
export async function dismissEscalation(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (!isFilingJudge(caller, rec.reporter_id)) {
    throw new ApiError(403, '只有立案的裁判或管理员可以处理升级建议');
  }
  await db
    .prepare('UPDATE records SET escalation_suggested = 0 WHERE id = ?')
    .bind(id)
    .run();
  return loadRecordItem(db, id);
}

/**
 * A judge overrides the AI's category before any verdict exists. The subject has
 * not spoken yet, so nothing has to be re-argued.
 */
export async function reclassifyCase(
  db: D1Database,
  caller: User,
  id: number,
  type: string,
): Promise<RecordItem> {
  const rec = await getRecordRow(db, id);
  if (!isFilingJudge(caller, rec.reporter_id)) {
    throw new ApiError(403, '只有立案的裁判或管理员可以改案由');
  }
  if (rec.status !== 'awaiting_statement') {
    throw new ApiError(400, '案件已进入裁决，改判请走管理员改判');
  }
  if (!isValidViolationType(type)) throw new ApiError(400, '无效的记录类型');
  const def = defFor(type);
  if (def.kind !== 'penalty') throw new ApiError(400, '不能把违约改成加分');

  const res = await db
    .prepare(
      `UPDATE records SET type = ?, classified_by = 'human', escalation_suggested = 0
        WHERE id = ? AND status = 'awaiting_statement'`,
    )
    .bind(def.type, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) throw new ApiError(409, '记录状态已变化，请刷新后重试');
  return loadRecordItem(db, id);
}

