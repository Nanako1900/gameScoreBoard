-- ============================================================================
-- EDG 信誉分 — v5 P2-3：邀请上下文 + 取消理由
--
--   wrangler d1 execute edg-credit --local  --file=./migrations/004_lobby.sql
--   wrangler d1 execute edg-credit --remote --file=./migrations/004_lobby.sql
--   （npm run db:migrate4:local / db:migrate4:remote）
--
-- 全新部署请直接用 schema.sql（已含这四列），不要跑这个文件。
--
-- SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重复执行会对每条 ALTER 报
-- "duplicate column name" —— 这是预期的，代表迁移已经做过了。
-- PostgreSQL 的同一改动在 server/migrations/0007_lobby.sql。
-- ============================================================================

-- 改期时记下这个人对旧时间的回答和旧时间（只给本人看，/api/me/invites）。
-- 回答过的人被改期重置为 invited 时写入；他重新回答时清空。
ALTER TABLE session_players ADD COLUMN prev_rsvp      TEXT;   -- going | maybe | out
ALTER TABLE session_players ADD COLUMN prev_starts_at TEXT;   -- ISO 8601 UTC，同 starts_at

-- 组织者取消时写的理由（trim 后最多 80 字，可空）和取消时间（datetime('now') 形状）。
ALTER TABLE game_sessions ADD COLUMN cancel_reason TEXT;
ALTER TABLE game_sessions ADD COLUMN cancelled_at  TEXT;
