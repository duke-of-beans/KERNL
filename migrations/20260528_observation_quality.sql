-- KERNL brain.db migration: observation quality scoring
-- Sprint: PROMETHEUS-W1 Observation Quality Model
-- Date: 2026-05-28
--
-- Adds three columns to observations for quality-weighted RRF retrieval:
--   quality_score      -- 0-1 weighted combination of 5 factors, NULL until scored
--   surprisal          -- 0-1 information content (k=5 NN distance), NULL until scored
--   compression_ratio  -- 0-1 structural density per token, NULL until scored
--
-- Partial index supports both write-time quality lookup (brain_remember) and
-- Pass 15 backfill scan (NIGHTSHIFT). Only active rows indexed.
--
-- Quality is ALWAYS a re-ranker, never a gate. No observation is excluded
-- from retrieval based on quality_score. National Razor enforced.
--
-- Apply: sqlite3 D:\Meta\brain.db < migrations/20260528_observation_quality.sql

BEGIN;

ALTER TABLE observations ADD COLUMN quality_score REAL DEFAULT NULL;
ALTER TABLE observations ADD COLUMN surprisal REAL DEFAULT NULL;
ALTER TABLE observations ADD COLUMN compression_ratio REAL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_obs_quality
  ON observations(quality_score)
  WHERE status = 'active';

COMMIT;
