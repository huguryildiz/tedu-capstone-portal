-- ============================================================
-- 005_rpcs_admin.sql
-- Run AFTER 001, 002, 003, 004.
--
-- Admin RPCs — the admin password is verified via pgcrypto
-- bcrypt on every call (no session tokens for MVP).
--
-- Initial password setup (run once in SQL editor, replace 'SIFRE'):
--
--   INSERT INTO public.settings (key, value)
--   VALUES ('admin_password_hash', crypt('SIFRE', gen_salt('bf')))
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
--     updated_at = now();
--
-- Error code P0401 = unauthorized (custom SQLSTATE).
-- ============================================================

-- ── Private helper: bcrypt password verification ─────────────
CREATE OR REPLACE FUNCTION public._verify_admin_password(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
  FROM settings
  WHERE key = 'admin_password_hash';

  IF v_hash IS NULL THEN
    RETURN false;
  END IF;

  RETURN crypt(p_password, v_hash) = v_hash;
END;
$$;

-- ── rpc_admin_login ───────────────────────────────────────────
-- Returns true if password correct, false otherwise.
-- Used by AdminPanel to verify credentials before fetching data.
CREATE OR REPLACE FUNCTION public.rpc_admin_login(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._verify_admin_password(p_password);
END;
$$;

-- ── rpc_admin_get_scores ──────────────────────────────────────
-- Returns all score rows for a semester joined with juror and
-- project info. Used by JurorsTab, MatrixTab, DetailsTab.
--
-- The status field is derived:
--   all 4 criteria non-null → 'submitted'
--   any criterion null      → 'in_progress'
CREATE OR REPLACE FUNCTION public.rpc_admin_get_scores(
  p_semester_id    uuid,
  p_admin_password text
)
RETURNS TABLE (
  juror_id      uuid,
  juror_name    text,
  juror_inst    text,
  project_id    uuid,
  group_no      integer,
  project_title text,
  technical     integer,
  written       integer,
  oral          integer,
  teamwork      integer,
  total         integer,
  comment       text,
  submitted_at  timestamptz,
  status        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    SELECT
      j.id              AS juror_id,
      j.juror_name,
      j.juror_inst,
      p.id              AS project_id,
      p.group_no,
      p.project_title,
      s.technical,
      s.written,
      s.oral,
      s.teamwork,
      s.total,
      s.comment,
      s.submitted_at,
      CASE
        WHEN s.technical IS NOT NULL
         AND s.written   IS NOT NULL
         AND s.oral      IS NOT NULL
         AND s.teamwork  IS NOT NULL
        THEN 'submitted'::text
        ELSE 'in_progress'::text
      END AS status
    FROM scores s
    JOIN jurors   j ON j.id = s.juror_id
    JOIN projects p ON p.id = s.project_id
    WHERE s.semester_id = p_semester_id
    ORDER BY j.juror_name, p.group_no;
END;
$$;

-- ── rpc_admin_project_summary ─────────────────────────────────
-- Returns per-project aggregates (only from fully submitted rows
-- where all 4 criteria are non-null) plus the project note.
CREATE OR REPLACE FUNCTION public.rpc_admin_project_summary(
  p_semester_id    uuid,
  p_admin_password text
)
RETURNS TABLE (
  project_id     uuid,
  group_no       integer,
  project_title  text,
  group_students text,
  juror_count    bigint,
  avg_technical  numeric,
  avg_written    numeric,
  avg_oral       numeric,
  avg_teamwork   numeric,
  avg_total      numeric,
  min_total      integer,
  max_total      integer,
  note           text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    SELECT
      p.id                          AS project_id,
      p.group_no,
      p.project_title,
      p.group_students,
      COUNT(s.juror_id)             AS juror_count,
      ROUND(AVG(s.technical), 2)    AS avg_technical,
      ROUND(AVG(s.written),   2)    AS avg_written,
      ROUND(AVG(s.oral),      2)    AS avg_oral,
      ROUND(AVG(s.teamwork),  2)    AS avg_teamwork,
      ROUND(AVG(s.total),     2)    AS avg_total,
      MIN(s.total)                  AS min_total,
      MAX(s.total)                  AS max_total,
      COALESCE(pn.note, '')         AS note
    FROM projects p
    LEFT JOIN scores s
      ON  s.project_id  = p.id
      AND s.semester_id = p_semester_id
      -- Only count fully submitted rows in aggregates
      AND s.technical IS NOT NULL
      AND s.written   IS NOT NULL
      AND s.oral      IS NOT NULL
      AND s.teamwork  IS NOT NULL
    LEFT JOIN project_notes pn
      ON  pn.project_id  = p.id
      AND pn.semester_id = p_semester_id
    WHERE p.semester_id = p_semester_id
    GROUP BY p.id, p.group_no, p.project_title, p.group_students, pn.note
    ORDER BY p.group_no;
END;
$$;

-- ── rpc_admin_get_project_note ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_get_project_note(
  p_semester_id    uuid,
  p_project_id     uuid,
  p_admin_password text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN (
    SELECT COALESCE(note, '')
    FROM project_notes
    WHERE semester_id = p_semester_id
      AND project_id  = p_project_id
  );
END;
$$;

-- ── rpc_admin_set_project_note ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_set_project_note(
  p_semester_id    uuid,
  p_project_id     uuid,
  p_note           text,
  p_admin_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  INSERT INTO project_notes (semester_id, project_id, note)
  VALUES (p_semester_id, p_project_id, p_note)
  ON CONFLICT (semester_id, project_id)
  DO UPDATE SET note = EXCLUDED.note;
END;
$$;
