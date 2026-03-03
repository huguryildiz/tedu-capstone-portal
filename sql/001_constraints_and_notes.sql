-- ============================================================
-- 001_constraints_and_notes.sql
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New Query).
--
-- Prerequisites: semesters, projects, jurors, scores, settings
-- tables already exist (initial schema applied separately).
--
-- This migration:
--   1. Enables pgcrypto (for admin bcrypt in migration 005)
--   2. Adds missing check constraints to existing tables
--   3. Creates the project_notes table
-- ============================================================

-- Enable pgcrypto extension (needed for bcrypt in 005_rpcs_admin.sql)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── jurors: enforce exactly 4-digit juror_code ────────────────
ALTER TABLE public.jurors
  ADD CONSTRAINT jurors_code_format
    CHECK (juror_code ~ '^\d{4}$');

-- ── scores: score range constraints ──────────────────────────
ALTER TABLE public.scores
  ADD CONSTRAINT scores_technical_range
    CHECK (technical IS NULL OR (technical >= 0 AND technical <= 30)),
  ADD CONSTRAINT scores_written_range
    CHECK (written   IS NULL OR (written   >= 0 AND written   <= 30)),
  ADD CONSTRAINT scores_oral_range
    CHECK (oral      IS NULL OR (oral      >= 0 AND oral      <= 30)),
  ADD CONSTRAINT scores_teamwork_range
    CHECK (teamwork  IS NULL OR (teamwork  >= 0 AND teamwork  <= 10));

-- ── scores: one row per (semester, project, juror) ───────────
-- Allows ON CONFLICT upsert from the frontend RPC.
ALTER TABLE public.scores
  ADD CONSTRAINT scores_unique_eval
    UNIQUE (semester_id, project_id, juror_id);

-- ── project_notes: admin-only notes, one per project/semester ─
CREATE TABLE IF NOT EXISTS public.project_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id uuid        NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  note        text        NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_notes_unique UNIQUE (semester_id, project_id)
);
