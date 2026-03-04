-- ============================================================
-- 000_bootstrap.sql
-- Single-shot bootstrap for a fresh DB.
-- Safe to run on an empty project; mostly idempotent on re-run.
--
-- Includes:
--   • Extensions
--   • Tables + constraints + indexes
--   • Triggers
--   • Views
--   • Public RPCs
--   • Admin RPCs
--   • Grants
--   • RLS enablement (default deny)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.semesters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  starts_on  date,
  ends_on    date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id    uuid NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  group_no       integer NOT NULL,
  project_title  text NOT NULL,
  group_students text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jurors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  juror_name text NOT NULL,
  juror_inst text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id  uuid NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  juror_id     uuid NOT NULL REFERENCES public.jurors(id)    ON DELETE CASCADE,
  technical    integer,
  written      integer,
  oral         integer,
  teamwork     integer,
  total        integer,
  comment      text,
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Default setting for evaluation lock
INSERT INTO public.settings (key, value)
VALUES ('eval_lock_active_semester', 'false')
ON CONFLICT (key) DO NOTHING;

-- Ensure updated_at exists for mutable entities (safe if re-run)
ALTER TABLE public.semesters ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.projects  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.jurors    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.juror_semester_auth (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  juror_id        uuid NOT NULL REFERENCES public.jurors(id)    ON DELETE CASCADE,
  semester_id     uuid NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  pin_hash        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_seen_at    timestamptz
);

ALTER TABLE public.juror_semester_auth
  ADD COLUMN IF NOT EXISTS edit_enabled boolean NOT NULL DEFAULT false;

-- Remove legacy plaintext PIN storage if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'juror_semester_auth'
      AND column_name = 'pin_plain_once'
  ) THEN
    ALTER TABLE public.juror_semester_auth
      DROP COLUMN pin_plain_once;
  END IF;
END;
$$;

-- Remove legacy edit window column if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'juror_semester_auth'
      AND column_name = 'edit_expires_at'
  ) THEN
    ALTER TABLE public.juror_semester_auth
      DROP COLUMN edit_expires_at;
  END IF;
END;
$$;


-- ── Constraints / indexes (idempotent) ───────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_unique_eval'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_unique_eval
      UNIQUE (semester_id, project_id, juror_id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_technical_range'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_technical_range
        CHECK (technical IS NULL OR (technical >= 0 AND technical <= 30));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_written_range'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_written_range
        CHECK (written IS NULL OR (written >= 0 AND written <= 30));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_oral_range'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_oral_range
        CHECK (oral IS NULL OR (oral >= 0 AND oral <= 30));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_teamwork_range'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_teamwork_range
        CHECK (teamwork IS NULL OR (teamwork >= 0 AND teamwork <= 10));
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scores_total_range'
  ) THEN
    ALTER TABLE public.scores
      ADD CONSTRAINT scores_total_range
        CHECK (total IS NULL OR (total >= 0 AND total <= 100));
  END IF;
END;
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'juror_semester_auth_unique'
  ) THEN
    ALTER TABLE public.juror_semester_auth
      ADD CONSTRAINT juror_semester_auth_unique
      UNIQUE (juror_id, semester_id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS jurors_name_inst_norm_uniq
  ON public.jurors (
    lower(regexp_replace(trim(coalesce(juror_name, '')), '\\s+', ' ', 'g')),
    lower(regexp_replace(trim(coalesce(juror_inst, '')), '\\s+', ' ', 'g'))
  );

-- ── Triggers ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_semesters_updated_at ON public.semesters;
CREATE TRIGGER trg_semesters_updated_at
  BEFORE UPDATE ON public.semesters
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

DROP TRIGGER IF EXISTS trg_jurors_updated_at ON public.jurors;
CREATE TRIGGER trg_jurors_updated_at
  BEFORE UPDATE ON public.jurors
  FOR EACH ROW EXECUTE FUNCTION public.trg_set_updated_at();

CREATE OR REPLACE FUNCTION public.trg_scores_compute_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.total :=
    COALESCE(NEW.technical, 0) +
    COALESCE(NEW.written,   0) +
    COALESCE(NEW.oral,      0) +
    COALESCE(NEW.teamwork,  0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scores_total ON public.scores;
CREATE TRIGGER trg_scores_total
  BEFORE INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_scores_compute_total();

CREATE OR REPLACE FUNCTION public.trg_scores_submitted_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF  NEW.technical IS NOT NULL
  AND NEW.written   IS NOT NULL
  AND NEW.oral      IS NOT NULL
  AND NEW.teamwork  IS NOT NULL
  THEN
    IF  OLD.submitted_at IS NULL
     OR OLD.technical IS NULL
     OR OLD.written   IS NULL
     OR OLD.oral      IS NULL
     OR OLD.teamwork  IS NULL
    THEN
      NEW.submitted_at := now();
    END IF;
  ELSE
    NEW.submitted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scores_submitted_at ON public.scores;
CREATE TRIGGER trg_scores_submitted_at
  BEFORE INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_scores_submitted_at();


-- ── Views ───────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_active_scores;
CREATE VIEW public.v_active_scores AS
SELECT sc.id AS score_id,
       sem.id AS semester_id,
       sem.name AS semester_name,
       p.id AS project_id,
       p.group_no,
       p.project_title,
       p.group_students,
       j.id AS juror_id,
       j.juror_name,
       j.juror_inst,
       sc.technical,
       sc.written,
       sc.oral,
       sc.teamwork,
       sc.total,
       sc.comment,
       sc.submitted_at,
       sc.created_at
FROM scores sc
JOIN semesters sem ON sem.id = sc.semester_id
JOIN projects p ON p.id = sc.project_id
JOIN jurors j ON j.id = sc.juror_id
WHERE sem.is_active = true;

-- ── RLS (default deny) ──────────────────────────────────────

ALTER TABLE public.semesters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'semesters', 'projects', 'jurors',
        'scores', 'settings'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      rec.policyname, rec.schemaname, rec.tablename
    );
  END LOOP;
END;
$$;

-- ── Public RPCs ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.rpc_list_semesters();
CREATE OR REPLACE FUNCTION public.rpc_list_semesters()
RETURNS TABLE (
  id         uuid,
  name       text,
  is_active  boolean,
  starts_on  date,
  ends_on    date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, is_active, starts_on, ends_on
  FROM semesters
  ORDER BY starts_on DESC;
$$;

DROP FUNCTION IF EXISTS public.rpc_get_active_semester();
CREATE OR REPLACE FUNCTION public.rpc_get_active_semester()
RETURNS TABLE (
  id         uuid,
  name       text,
  is_active  boolean,
  starts_on  date,
  ends_on    date
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, is_active, starts_on, ends_on
  FROM semesters
  WHERE is_active = true
  LIMIT 1;
$$;

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
  JOIN semesters sem
    ON sem.id = p.semester_id
   AND sem.is_active = true
  LEFT JOIN scores s
    ON  s.project_id  = p.id
    AND s.semester_id = p_semester_id
    AND s.juror_id    = p_juror_id
  WHERE p.semester_id = p_semester_id
  ORDER BY p.group_no;
$$;

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

-- ── Admin RPCs ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._verify_admin_password(p_password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
      ''::text                      AS note
    FROM projects p
    LEFT JOIN scores s
      ON  s.project_id  = p.id
      AND s.semester_id = p_semester_id
      AND s.technical IS NOT NULL
      AND s.written   IS NOT NULL
      AND s.oral      IS NOT NULL
      AND s.teamwork  IS NOT NULL
    WHERE p.semester_id = p_semester_id
    GROUP BY p.id, p.group_no, p.project_title, p.group_students
    ORDER BY p.group_no;
END;
$$;

-- ── Admin manage RPCs ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_set_active_semester(
  p_semester_id uuid,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  UPDATE semesters
  SET is_active = false
  WHERE id <> p_semester_id;

  UPDATE semesters
  SET is_active = true
  WHERE id = p_semester_id;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_create_semester(text, text, date, date, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_create_semester(
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_admin_password text
)
RETURNS TABLE (
  id uuid,
  name text,
  is_active boolean,
  starts_on date,
  ends_on date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    INSERT INTO semesters (name, is_active, starts_on, ends_on)
    VALUES (p_name, false, p_starts_on, p_ends_on)
    RETURNING semesters.id, semesters.name, semesters.is_active, semesters.starts_on, semesters.ends_on;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_semester(
  p_semester_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  IF p_starts_on > p_ends_on THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  UPDATE semesters
  SET name = p_name,
      starts_on = p_starts_on,
      ends_on = p_ends_on
  WHERE id = p_semester_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_list_projects(
  p_semester_id uuid,
  p_admin_password text
)
RETURNS TABLE (
  id uuid,
  semester_id uuid,
  group_no integer,
  project_title text,
  group_students text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    SELECT p.id, p.semester_id, p.group_no, p.project_title, p.group_students
    FROM projects p
    WHERE p.semester_id = p_semester_id
    ORDER BY p.group_no ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_upsert_project(
  p_semester_id uuid,
  p_group_no integer,
  p_project_title text,
  p_group_students text,
  p_admin_password text
)
RETURNS TABLE (project_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  SELECT id INTO v_id
  FROM projects
  WHERE semester_id = p_semester_id
    AND group_no = p_group_no
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO projects (semester_id, group_no, project_title, group_students)
    VALUES (p_semester_id, p_group_no, p_project_title, p_group_students)
    RETURNING id INTO v_id;
  ELSE
    UPDATE projects
    SET project_title = p_project_title,
        group_students = p_group_students
    WHERE id = v_id;
  END IF;

  RETURN QUERY SELECT v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_project(uuid, text);

CREATE OR REPLACE FUNCTION public.rpc_admin_create_juror(
  p_juror_name text,
  p_juror_inst text,
  p_admin_password text
)
RETURNS TABLE (juror_id uuid, juror_name text, juror_inst text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_norm_name text;
  v_norm_inst text;
  v_id uuid;
  v_name text;
  v_inst text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  v_norm_name := lower(regexp_replace(trim(coalesce(p_juror_name, '')), '\\s+', ' ', 'g'));
  v_norm_inst := lower(regexp_replace(trim(coalesce(p_juror_inst, '')), '\\s+', ' ', 'g'));

  SELECT j.id, j.juror_name, j.juror_inst
    INTO v_id, v_name, v_inst
  FROM jurors j
  WHERE lower(regexp_replace(trim(coalesce(j.juror_name, '')), '\\s+', ' ', 'g')) = v_norm_name
    AND lower(regexp_replace(trim(coalesce(j.juror_inst, '')), '\\s+', ' ', 'g')) = v_norm_inst
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO jurors (juror_name, juror_inst)
    VALUES (trim(p_juror_name), trim(p_juror_inst))
    RETURNING jurors.id, jurors.juror_name, jurors.juror_inst
    INTO v_id, v_name, v_inst;
  END IF;

  RETURN QUERY SELECT v_id, v_name, v_inst;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_update_juror(
  p_juror_id uuid,
  p_juror_name text,
  p_juror_inst text,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  IF trim(coalesce(p_juror_name, '')) = '' OR trim(coalesce(p_juror_inst, '')) = '' THEN
    RAISE EXCEPTION 'invalid_juror';
  END IF;

  UPDATE jurors
  SET juror_name = trim(p_juror_name),
      juror_inst = trim(p_juror_inst)
  WHERE id = p_juror_id;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_juror(uuid, text);

CREATE OR REPLACE FUNCTION public.rpc_admin_reset_juror_pin(
  p_semester_id uuid,
  p_juror_id uuid,
  p_admin_password text
)
RETURNS TABLE (juror_id uuid, pin_plain_once text, failed_attempts integer, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_pin text;
  v_hash text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  v_pin := lpad((floor(random() * 10000))::text, 4, '0');
  v_hash := crypt(v_pin, gen_salt('bf'));

  INSERT INTO juror_semester_auth (juror_id, semester_id, pin_hash, failed_attempts, locked_until)
  VALUES (p_juror_id, p_semester_id, v_hash, 0, null)
  ON CONFLICT (juror_id, semester_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        last_seen_at = null;

  RETURN QUERY SELECT p_juror_id, v_pin, 0, null::timestamptz;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_get_settings(
  p_admin_password text
)
RETURNS TABLE (key text, value text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    SELECT s.key, s.value
    FROM settings s
    ORDER BY s.key ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_set_setting(
  p_key text,
  p_value text,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  INSERT INTO settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_list_jurors(text, uuid);
CREATE OR REPLACE FUNCTION public.rpc_admin_list_jurors(
  p_admin_password text,
  p_semester_id    uuid
)
RETURNS TABLE (
  juror_id uuid,
  juror_name text,
  juror_inst text,
  locked_until timestamptz,
  is_locked boolean,
  is_assigned boolean,
  scored_semesters text[],
  edit_enabled boolean,
  total_projects integer,
  completed_projects integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    WITH total AS (
      SELECT COUNT(*)::int AS total_projects
      FROM projects p
      WHERE p.semester_id = p_semester_id
    ),
    completed AS (
      SELECT sc.juror_id, COUNT(*)::int AS completed_projects
      FROM scores sc
      WHERE sc.semester_id = p_semester_id
        AND sc.technical IS NOT NULL
        AND sc.written   IS NOT NULL
        AND sc.oral      IS NOT NULL
        AND sc.teamwork  IS NOT NULL
      GROUP BY sc.juror_id
    )
    SELECT
      j.id,
      j.juror_name,
      j.juror_inst,
      a.locked_until,
      (a.locked_until IS NOT NULL AND a.locked_until > now()) AS is_locked,
      (
        a.juror_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM scores sc2
          WHERE sc2.semester_id = p_semester_id
            AND sc2.juror_id = j.id
        )
      ) AS is_assigned,
      COALESCE(ss.scored_semesters, ARRAY[]::text[]),
      COALESCE(a.edit_enabled, false) AS edit_enabled,
      COALESCE(t.total_projects, 0) AS total_projects,
      COALESCE(c.completed_projects, 0) AS completed_projects
    FROM jurors j
    LEFT JOIN juror_semester_auth a
      ON a.juror_id = j.id
     AND a.semester_id = p_semester_id
    LEFT JOIN total t ON true
    LEFT JOIN completed c
      ON c.juror_id = j.id
    LEFT JOIN LATERAL (
      SELECT array_agg(x.name ORDER BY x.starts_on DESC) AS scored_semesters
      FROM (
        SELECT DISTINCT s.id, s.name, s.starts_on
        FROM scores sc
        JOIN semesters s ON s.id = sc.semester_id
        WHERE sc.juror_id = j.id
          AND sc.submitted_at IS NOT NULL
      ) AS x
    ) AS ss ON true
    ORDER BY j.juror_name;
END;
$$;

-- ── Admin: toggle per-juror edit mode ───────────────────────

DROP FUNCTION IF EXISTS public.rpc_admin_set_juror_edit_mode(uuid, uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_set_juror_edit_mode(
  p_semester_id uuid,
  p_juror_id uuid,
  p_enabled boolean,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'semester_inactive';
  END IF;

  IF COALESCE(p_enabled, false) THEN
    UPDATE juror_semester_auth
    SET edit_enabled = true
    WHERE juror_id = p_juror_id
      AND semester_id = p_semester_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_pin';
    END IF;
  ELSE
    UPDATE juror_semester_auth
    SET edit_enabled = false
    WHERE juror_id = p_juror_id
      AND semester_id = p_semester_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_pin';
    END IF;
  END IF;

  RETURN true;
END;
$$;

-- ── Juror: read effective edit state ────────────────────────

DROP FUNCTION IF EXISTS public.rpc_get_juror_edit_state(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_get_juror_edit_state(
  p_semester_id uuid,
  p_juror_id uuid
)
RETURNS TABLE (
  edit_enabled boolean,
  edit_allowed boolean,
  lock_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lock boolean := false;
  v_enabled boolean := false;
BEGIN
  SELECT (value = 'true') INTO v_lock
  FROM settings
  WHERE key = 'eval_lock_active_semester';
  v_lock := COALESCE(v_lock, false);

  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RETURN QUERY SELECT false, false, v_lock;
    RETURN;
  END IF;

  SELECT a.edit_enabled
    INTO v_enabled
  FROM juror_semester_auth a
  WHERE a.juror_id = p_juror_id
    AND a.semester_id = p_semester_id;

  v_enabled := COALESCE(v_enabled, false);

  RETURN QUERY
    SELECT
      v_enabled,
      (v_enabled AND NOT v_lock),
      v_lock;
END;
$$;

-- ── Juror: finalize submission and auto-disable edit ────────

DROP FUNCTION IF EXISTS public.rpc_finalize_juror_submission(uuid, uuid);
CREATE OR REPLACE FUNCTION public.rpc_finalize_juror_submission(
  p_semester_id uuid,
  p_juror_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_total int := 0;
  v_completed int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'semester_inactive';
  END IF;

  SELECT COUNT(*)::int INTO v_total
  FROM projects p
  WHERE p.semester_id = p_semester_id;

  SELECT COUNT(*)::int INTO v_completed
  FROM scores sc
  WHERE sc.semester_id = p_semester_id
    AND sc.juror_id = p_juror_id
    AND sc.technical IS NOT NULL
    AND sc.written   IS NOT NULL
    AND sc.oral      IS NOT NULL
    AND sc.teamwork  IS NOT NULL;

  IF v_total = 0 OR v_completed < v_total THEN
    RETURN false;
  END IF;

  UPDATE juror_semester_auth
  SET edit_enabled = false
  WHERE juror_id = p_juror_id
    AND semester_id = p_semester_id;

  RETURN true;
END;
$$;

-- ── Admin password security ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_admin_change_password(
  p_current_password text,
  p_new_password text
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
  FROM settings
  WHERE key = 'admin_password_hash';

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'admin_password_hash_missing';
  END IF;

  IF crypt(p_current_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'incorrect_password';
  END IF;

  INSERT INTO settings (key, value)
  VALUES ('admin_password_hash', crypt(p_new_password, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN QUERY SELECT true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_bootstrap_password(
  p_new_password text
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
  FROM settings
  WHERE key = 'admin_password_hash';

  IF v_hash IS NOT NULL THEN
    RAISE EXCEPTION 'already_initialized';
  END IF;

  INSERT INTO settings (key, value)
  VALUES ('admin_password_hash', crypt(p_new_password, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  RETURN QUERY SELECT true;
END;
$$;

-- ── Juror auth RPCs ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_create_or_get_juror_and_issue_pin(
  p_semester_id uuid,
  p_juror_name text,
  p_juror_inst text
)
RETURNS TABLE (
  juror_id       uuid,
  juror_name     text,
  juror_inst     text,
  needs_pin      boolean,
  pin_plain_once text,
  locked_until   timestamptz,
  failed_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_norm_name text;
  v_norm_inst text;
  v_juror_id  uuid;
  v_juror_name text;
  v_juror_inst text;
  v_pin text;
  v_pin_hash text;
  v_exists boolean;
  v_constraint text;
  v_locked_until timestamptz;
  v_failed_attempts integer;
BEGIN
  v_norm_name := lower(regexp_replace(trim(coalesce(p_juror_name, '')), '\\s+', ' ', 'g'));
  v_norm_inst := lower(regexp_replace(trim(coalesce(p_juror_inst, '')), '\\s+', ' ', 'g'));

  PERFORM pg_advisory_xact_lock(hashtext(v_norm_name || '|' || v_norm_inst));

  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'semester_inactive';
  END IF;

  IF v_norm_name = '' OR v_norm_inst = '' THEN
    RAISE EXCEPTION 'invalid juror identity';
  END IF;

  SELECT j.id, j.juror_name, j.juror_inst
    INTO v_juror_id, v_juror_name, v_juror_inst
  FROM jurors j
  WHERE lower(regexp_replace(trim(coalesce(j.juror_name, '')), '\\s+', ' ', 'g')) = v_norm_name
    AND lower(regexp_replace(trim(coalesce(j.juror_inst, '')), '\\s+', ' ', 'g')) = v_norm_inst
  ORDER BY j.id
  LIMIT 1;

  IF v_juror_id IS NULL THEN
    BEGIN
      INSERT INTO jurors (juror_name, juror_inst)
      VALUES (trim(p_juror_name), trim(p_juror_inst))
      RETURNING id, juror_name, juror_inst
      INTO v_juror_id, v_juror_name, v_juror_inst;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'jurors_name_inst_norm_uniq' THEN
        SELECT j.id, j.juror_name, j.juror_inst
          INTO v_juror_id, v_juror_name, v_juror_inst
        FROM jurors j
        WHERE lower(regexp_replace(trim(coalesce(j.juror_name, '')), '\\s+', ' ', 'g')) = v_norm_name
          AND lower(regexp_replace(trim(coalesce(j.juror_inst, '')), '\\s+', ' ', 'g')) = v_norm_inst
        ORDER BY j.id
        LIMIT 1;
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  SELECT true INTO v_exists
  FROM juror_semester_auth a
  WHERE a.juror_id = v_juror_id
    AND a.semester_id = p_semester_id
  LIMIT 1;

  IF v_exists THEN
    SELECT a.locked_until, a.failed_attempts
      INTO v_locked_until, v_failed_attempts
    FROM juror_semester_auth a
    WHERE a.juror_id = v_juror_id
      AND a.semester_id = p_semester_id
    LIMIT 1;

    RETURN QUERY SELECT v_juror_id, v_juror_name, v_juror_inst, true, null::text,
      v_locked_until, coalesce(v_failed_attempts, 0);
    RETURN;
  END IF;

  v_pin := lpad((floor(random() * 10000))::text, 4, '0');
  v_pin_hash := crypt(v_pin, gen_salt('bf'::text));

  INSERT INTO juror_semester_auth (juror_id, semester_id, pin_hash)
  VALUES (v_juror_id, p_semester_id, v_pin_hash)
  ON CONFLICT (juror_id, semester_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_juror_id, v_juror_name, v_juror_inst, true, null::text,
      null::timestamptz, 0;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_juror_id, v_juror_name, v_juror_inst, false, v_pin,
    null::timestamptz, 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_verify_juror_pin(
  p_semester_id uuid,
  p_juror_name  text,
  p_juror_inst  text,
  p_pin         text
)
RETURNS TABLE (
  ok             boolean,
  juror_id       uuid,
  juror_name     text,
  juror_inst     text,
  error_code     text,
  locked_until   timestamptz,
  failed_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
#variable_conflict use_column
DECLARE
  v_norm_name text;
  v_norm_inst text;
  v_pin text;
  v_now timestamptz := now();
  v_juror_id uuid;
  v_juror_name text;
  v_juror_inst text;
  v_auth juror_semester_auth%ROWTYPE;
  v_failed integer;
  v_locked timestamptz;
BEGIN
  v_norm_name := lower(regexp_replace(trim(coalesce(p_juror_name, '')), '\\s+', ' ', 'g'));
  v_norm_inst := lower(regexp_replace(trim(coalesce(p_juror_inst, '')), '\\s+', ' ', 'g'));
  v_pin := regexp_replace(coalesce(p_pin, ''), '\\s+', '', 'g');

  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RETURN QUERY SELECT false, null::uuid, null::text, null::text, 'semester_inactive', null::timestamptz, 0;
    RETURN;
  END IF;

  SELECT j.id, j.juror_name, j.juror_inst
    INTO v_juror_id, v_juror_name, v_juror_inst
  FROM jurors j
  WHERE lower(regexp_replace(trim(coalesce(j.juror_name, '')), '\\s+', ' ', 'g')) = v_norm_name
    AND lower(regexp_replace(trim(coalesce(j.juror_inst, '')), '\\s+', ' ', 'g')) = v_norm_inst
  ORDER BY j.id
  LIMIT 1;

  IF v_juror_id IS NULL THEN
    RETURN QUERY SELECT false, null::uuid, null::text, null::text, 'not_found', null::timestamptz, 0;
    RETURN;
  END IF;

  SELECT *
    INTO v_auth
  FROM juror_semester_auth a
  WHERE a.juror_id = v_juror_id
    AND a.semester_id = p_semester_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'no_pin', null::timestamptz, 0;
    RETURN;
  END IF;

  IF v_auth.locked_until IS NOT NULL AND v_auth.locked_until > v_now THEN
    RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'locked', v_auth.locked_until, v_auth.failed_attempts;
    RETURN;
  END IF;

  IF crypt(v_pin, v_auth.pin_hash) = v_auth.pin_hash THEN
    UPDATE juror_semester_auth
    SET last_seen_at = v_now,
        failed_attempts = 0,
        locked_until = null
    WHERE id = v_auth.id;

    RETURN QUERY SELECT true, v_juror_id, v_juror_name, v_juror_inst, null::text, null::timestamptz, 0;
    RETURN;
  END IF;

  v_failed := v_auth.failed_attempts + 1;
  v_locked := null;
  IF v_failed >= 5 THEN
    v_locked := v_now + interval '15 minutes';
  END IF;

  UPDATE juror_semester_auth
  SET failed_attempts = v_failed,
      locked_until = v_locked
  WHERE id = v_auth.id;

  RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'invalid', v_locked, v_failed;
END;
$$;

-- ── Grants ──────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.rpc_list_semesters() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_active_semester() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_projects(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_score(uuid, uuid, uuid, integer, integer, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_or_get_juror_and_issue_pin(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_verify_juror_pin(uuid, text, text, text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_admin_login(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_scores(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_project_summary(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_active_semester(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_semester(text, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_semester(uuid, text, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_projects(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_project(uuid, integer, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_juror(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_juror(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_juror_pin(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_settings(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_setting(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_jurors(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_juror_edit_mode(uuid, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_bootstrap_password(text) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_get_juror_edit_state(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_juror_submission(uuid, uuid) TO anon, authenticated;
