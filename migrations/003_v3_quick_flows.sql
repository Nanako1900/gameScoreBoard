-- ============================================================================
-- EDG 信誉分 — v2 → v3 迁移：多人立案 / AI 归类 / 极简组局 / 每周周报
--
--   wrangler d1 execute edg-credit --local  --file=./migrations/003_v3_quick_flows.sql
--   wrangler d1 execute edg-credit --remote --file=./migrations/003_v3_quick_flows.sql
--
-- 全新部署请直接用 schema.sql（已含全部 v3 结构），不要跑这个文件。
--
-- SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重复执行会对每条 ALTER 报
-- "duplicate column name" —— 这是预期的，代表迁移已经做过了。其余语句
-- （CREATE TABLE IF NOT EXISTS 与几条 UPDATE）本身幂等，重跑不会损坏数据。
-- ============================================================================

-- --- records: AI 归类的产物 --------------------------------------------------
-- claim_summary        AI 把裁判那段话压成的一句话，动态流里当标题用
-- classified_by        ai | fallback | human | derived
--                        derived = 点名结算推导出来的，根本没过 AI
-- escalation_suggested AI 认为够得上团灭级，已降级处理，等裁判一键确认
ALTER TABLE records ADD COLUMN claim_summary        TEXT;
ALTER TABLE records ADD COLUMN classified_by        TEXT;
ALTER TABLE records ADD COLUMN escalation_suggested INTEGER NOT NULL DEFAULT 0;

-- v2 的案由全是人选的，如实标注。
UPDATE records SET classified_by = 'human' WHERE classified_by IS NULL;

-- --- ai_verdicts: 区分归类调用与量刑调用 --------------------------------------
-- 归类比量刑简单，回退率理应更低；若归类回退率反而高，说明提示词或模型有问题。
ALTER TABLE ai_verdicts ADD COLUMN kind TEXT NOT NULL DEFAULT 'sentence';

-- --- 每周周报 ---------------------------------------------------------------
-- 与 weekly_heals 同一套幂等模式：主键就是那一周，写进去了就不再生成。
-- stats_json 是 SQL 算出来的原始数字（AI 一个数都不许算），narrative 是 AI 写的散文。
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_start TEXT PRIMARY KEY,
  stats_json TEXT NOT NULL,
  narrative  TEXT NOT NULL,
  source     TEXT NOT NULL,              -- ai | fallback
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_records_escalation ON records(escalation_suggested, status);
CREATE INDEX IF NOT EXISTS idx_verdicts_kind      ON ai_verdicts(kind, created_at DESC);

-- --- session_players.rsvp 新增 'invited' 态 ----------------------------------
-- 组局者勾选的人初始就是 invited（未回应），不占 capacity 名额，并在首页收到
-- 一键「来 / 不来」的邀请横幅。rsvp 是自由文本列，无需改结构；这里只是留档说明。
-- 既有数据不动：v2 没有 invited，所有历史行保持原值。
