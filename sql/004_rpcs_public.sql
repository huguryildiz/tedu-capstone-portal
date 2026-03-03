-- ============================================================
-- 004_rpcs_public.sql
-- Run AFTER 001, 002, 003.
--
-- Public RPCs callable with the anon key.
-- All are SECURITY DEFINER — they bypass RLS and run as the
-- function owner (postgres / service role), not as the caller.
--
-- Column name notes (matching actual DB schema from db.md):
--   semesters  : starts_on, ends_on
--   projects   : project_title, group_students, group_no
--   jurors     : juror_code, juror_name, juror_inst
--   scores     : technical, written, oral, teamwork, total, comment, submitted_at
-- ============================================================

-- ── rpc_list_semesters ────────────────────────────────────────
-- Returns all semesters ordered newest first.
CREATE OR REPLACE FUNCTION public.rpc_list_semesters()
RETURNS TABLE (
  id         uuid,
  code       text,
  name       text,
  is_active  boolean,
  starts_on  date,
  ends_on    date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, code, name, is_active, starts_on, ends_on
  FROM semesters
  ORDER BY starts_on DESC;
$$;

-- ── rpc_get_active_semester ───────────────────────────────────
-- Returns the single active semester row, or nothing if none.
CREATE OR REPLACE FUNCTION public.rpc_get_active_semester()
RETURNS TABLE (
  id         uuid,
  code       text,
  name       text,
  is_active  boolean,
  starts_on  date,
  ends_on    date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, code, name, is_active, starts_on, ends_on
  FROM semesters
  WHERE is_active = true
  LIMIT 1;
$$;

-- ── rpc_juror_login ───────────────────────────────────────────
-- Authenticates a juror by 4-digit juror_code.
-- Returns one row on success, empty on failure (no exception —
-- the frontend checks for an empty result).
CREATE OR REPLACE FUNCTION public.rpc_juror_login(pin text)
RETURNS TABLE (
  juror_id   uuid,
  juror_name text,
  juror_inst text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id        AS juror_id,
    juror_name,
    juror_inst
  FROM jurors
  WHERE juror_code = pin
  LIMIT 1;
$$;

-- ── rpc_list_projects ─────────────────────────────────────────
-- Returns all projects for a semester with the requesting
-- juror's existing scores merged in (NULLs if not yet scored).
-- Ordered by group_no ascending.
CREATE OR REPLACE FUNCTION public.rpc_list_projects(
  p_semester_id uuid,
  p_juror_id    uuid
)
RETURNS TABLE (
  project_id     uuid,
  group_no       integer,
  project_title  text,
  group_students text,
  technical      integer,
  written        integer,
  oral           integer,
  teamwork       integer,
  total          integer,
  comment        text,
  submitted_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id             AS project_id,
    p.group_no,
    p.project_title,
    p.group_students,
    s.technical,
    s.written,
    s.oral,
    s.teamwork,
    s.total,
    s.comment,
    s.submitted_at
  FROM projects p
  LEFT JOIN scores s
    ON  s.project_id  = p.id
    AND s.semester_id = p_semester_id
    AND s.juror_id    = p_juror_id
  WHERE p.semester_id = p_semester_id
  ORDER BY p.group_no;
$$;

-- ── rpc_upsert_score ──────────────────────────────────────────
-- Inserts or updates a single score row.
-- Criteria column names use DB naming (written/oral).
-- Field mapping (config.js → DB) happens in src/shared/api.js.
-- The total is computed by the trigger trg_scores_total.
-- Returns the computed total integer.
CREATE OR REPLACE FUNCTION public.rpc_upsert_score(
  p_semester_id uuid,
  p_project_id  uuid,
  p_juror_id    uuid,
  p_technical   integer,
  p_written     integer,
  p_oral        integer,
  p_teamwork    integer,
  p_comment     text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  INSERT INTO scores (
    semester_id, project_id, juror_id,
    technical, written, oral, teamwork, comment
  )
  VALUES (
    p_semester_id, p_project_id, p_juror_id,
    p_technical, p_written, p_oral, p_teamwork, p_comment
  )
  ON CONFLICT (semester_id, project_id, juror_id)
  DO UPDATE SET
    technical = EXCLUDED.technical,
    written   = EXCLUDED.written,
    oral      = EXCLUDED.oral,
    teamwork  = EXCLUDED.teamwork,
    comment   = EXCLUDED.comment
  RETURNING total INTO v_total;

  RETURN v_total;
END;
$$;
