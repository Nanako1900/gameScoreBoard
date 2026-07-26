// Case reads and row→JSON mapping.
//
// Split out of cases.ts purely for size: that file owns the write lifecycle
// (file → statement → verdict → appeal), this one owns "how a case is read and
// shaped for the API". Everything here is side-effect free apart from SELECTs.

import {
  VIOLATION_MAP,
  type CaseStatus,
  type VerdictSource,
  type ViolationDef,
  type ViolationType,
} from '../shared/scoring';
import type { RecordItem, RecordJoinRow, RecordRow, User, VerdictFactor } from './types';
import { ApiError } from './errors';
import type { ClassifiedBy } from './ai/classify';

/** Statuses in which the case's delta is reflected in the subject's score. */
export const SCORED_STATUSES = "('decided', 'appealed')";

const RECORD_SELECT = `
SELECT r.id AS id, r.type AS type, r.delta AS delta, r.note AS note,
       r.claim AS claim, r.claim_summary AS claim_summary,
       r.classified_by AS classified_by, r.escalation_suggested AS escalation_suggested,
       r.session_id AS session_id,
       r.statement AS statement, r.statement_at AS statement_at,
       r.appeal_reason AS appeal_reason, r.deadline_at AS deadline_at,
       r.verdict_source AS verdict_source, r.verdict_headline AS verdict_headline,
       r.verdict_reason AS verdict_reason, r.verdict_factors AS verdict_factors,
       r.status AS status, r.created_at AS created_at,
       s.id AS s_id, COALESCE(s.display_name, s.username) AS s_username, s.avatar_url AS s_avatar,
       p.id AS p_id, COALESCE(p.display_name, p.username) AS p_username, p.avatar_url AS p_avatar
FROM records r
JOIN users s ON s.id = r.subject_id
JOIN users p ON p.id = r.reporter_id`;

function parseFactors(raw: string | null): VerdictFactor[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is VerdictFactor =>
        typeof f === 'object' &&
        f !== null &&
        (('kind' in f && (f.kind === 'mitigating' || f.kind === 'aggravating')) as boolean) &&
        typeof (f as VerdictFactor).text === 'string',
    );
  } catch {
    return [];
  }
}

export function defFor(type: string): ViolationDef {
  const def = VIOLATION_MAP[type];
  if (!def) throw new ApiError(500, `未知的记录类型: ${type}`);
  return def;
}

function toRecordItem(row: RecordJoinRow): RecordItem {
  const def = VIOLATION_MAP[row.type];
  return {
    id: row.id,
    subject: { id: row.s_id, username: row.s_username, avatar_url: row.s_avatar },
    reporter: { id: row.p_id, username: row.p_username, avatar_url: row.p_avatar },
    type: row.type as ViolationType,
    delta: row.delta,
    note: row.note,
    claim: row.claim,
    claim_summary: row.claim_summary,
    // Rows written before v3 really were human-classified, so say so rather than
    // leaving the field null and making the UI guess.
    classified_by: (row.classified_by ?? 'human') as ClassifiedBy,
    escalation_suggested: row.escalation_suggested === 1,
    session_id: row.session_id,
    statement: row.statement,
    statement_at: row.statement_at,
    appeal_reason: row.appeal_reason,
    deadline_at: row.deadline_at,
    status: row.status as CaseStatus,
    verdict: row.verdict_source
      ? {
          source: row.verdict_source as VerdictSource,
          headline: row.verdict_headline ?? '',
          reasoning: row.verdict_reason ?? '',
          factors: parseFactors(row.verdict_factors),
        }
      : null,
    range: def
      ? { min: def.min, max: def.max, base: def.base }
      : { min: 0, max: 0, base: 0 },
    created_at: row.created_at,
  };
}

// --- Reads -------------------------------------------------------------------

export interface ListRecordsFilters {
  limit?: number;
  subject?: string;
  status?: string;
  session?: number;
  /** Only cases this user still has to answer for. */
  pendingFor?: string;
}

export async function listRecords(
  db: D1Database,
  filters: ListRecordsFilters,
): Promise<RecordItem[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filters.subject) {
    clauses.push('r.subject_id = ?');
    binds.push(filters.subject);
  }
  if (filters.status) {
    clauses.push('r.status = ?');
    binds.push(filters.status);
  }
  if (filters.session !== undefined) {
    clauses.push('r.session_id = ?');
    binds.push(filters.session);
  }
  if (filters.pendingFor) {
    clauses.push("r.subject_id = ? AND r.status = 'awaiting_statement'");
    binds.push(filters.pendingFor);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  binds.push(limit);
  const sql = `${RECORD_SELECT}${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`;
  const rows = await db
    .prepare(sql)
    .bind(...binds)
    .all<RecordJoinRow>();
  return rows.results.map(toRecordItem);
}

export async function getRecordItemById(
  db: D1Database,
  id: number,
): Promise<RecordItem | null> {
  const row = await db
    .prepare(`${RECORD_SELECT} WHERE r.id = ?`)
    .bind(id)
    .first<RecordJoinRow>();
  return row ? toRecordItem(row) : null;
}

export async function loadRecordItem(db: D1Database, id: number): Promise<RecordItem> {
  const item = await getRecordItemById(db, id);
  if (!item) throw new ApiError(500, '读取记录失败');
  return item;
}

export async function getRecordRow(db: D1Database, id: number): Promise<RecordRow> {
  const rec = await db.prepare('SELECT * FROM records WHERE id = ?').bind(id).first<RecordRow>();
  if (!rec) throw new ApiError(404, '记录不存在');
  return rec;
}

export interface PendingCounts {
  statements: number;
  appeals: number;
}

/** Badge counts for /api/me: cases awaiting my statement, appeals awaiting review. */
export async function pendingCounts(
  db: D1Database,
  user: User,
): Promise<PendingCounts> {
  const mine = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM records WHERE subject_id = ? AND status = 'awaiting_statement'",
    )
    .bind(user.id)
    .first<{ n: number }>();
  let appeals = 0;
  if (user.is_admin) {
    const row = await db
      .prepare("SELECT COUNT(*) AS n FROM records WHERE status = 'appealed'")
      .first<{ n: number }>();
    appeals = row?.n ?? 0;
  }
  return { statements: mine?.n ?? 0, appeals };
}
