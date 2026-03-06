-- ============================================================
-- 000_bootstrap.sql
-- Single-shot bootstrap for a fresh DB.
-- Safe to run on an empty project; mostly idempotent on re-run.
--
-- Includes:
--   - Extensions
--   - Tables + constraints + indexes
--   - Triggers
--   - Views
--   - Public RPCs
--   - Admin RPCs
--   - Grants
--   - RLS enablement (default deny)
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS extensions;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres, service_role;

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
  final_submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.juror_semester_auth (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  juror_id        uuid NOT NULL REFERENCES public.jurors(id)    ON DELETE CASCADE,
  semester_id     uuid NOT NULL REFERENCES public.semesters(id) ON DELETE CASCADE,
  pin_hash        text NOT NULL,
  pin_reveal_pending boolean NOT NULL DEFAULT false,
  pin_plain_once  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_seen_at    timestamptz,
  edit_enabled    boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  actor_type  text NOT NULL CHECK (actor_type IN ('admin', 'juror', 'system')),
  actor_id    uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  message     text NOT NULL,
  metadata    jsonb
);

-- Default setting for evaluation lock
INSERT INTO public.settings (key, value)
VALUES ('eval_lock_active_semester', 'false')
ON CONFLICT (key) DO NOTHING;

-- ── Schema upgrades / legacy cleanup (idempotent) ───────────
ALTER TABLE public.semesters ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.projects  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Enforce unique group numbers per semester (safety for concurrent inserts).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM projects
    GROUP BY semester_id, group_no
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'project_group_duplicate';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS projects_semester_group_no_key
  ON public.projects (semester_id, group_no);

-- Enforce unique semester names (case-insensitive) and dedupe existing rows.
-- Use a temp table so the dedupe set can be reused across multiple statements.
DROP TABLE IF EXISTS tmp_semester_dups;
CREATE TEMP TABLE tmp_semester_dups AS
WITH ranked AS (
  SELECT
    id,
    lower(trim(name)) AS lname,
    is_active,
    updated_at,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(name))
      ORDER BY
        is_active DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY lower(trim(name))
      ORDER BY
        is_active DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id ASC
    ) AS keep_id
  FROM public.semesters
  WHERE name IS NOT NULL AND trim(name) <> ''
)
SELECT id, keep_id
FROM ranked
WHERE rn > 1;

UPDATE public.projects p
SET semester_id = d.keep_id
FROM tmp_semester_dups d
WHERE p.semester_id = d.id;

UPDATE public.scores s
SET semester_id = d.keep_id
FROM tmp_semester_dups d
WHERE s.semester_id = d.id;

UPDATE public.juror_semester_auth jsa
SET semester_id = d.keep_id
FROM tmp_semester_dups d
WHERE jsa.semester_id = d.id;

UPDATE public.audit_logs al
SET entity_id = d.keep_id
FROM tmp_semester_dups d
WHERE al.entity_type = 'semester' AND al.entity_id = d.id;

DELETE FROM public.semesters s
USING tmp_semester_dups d
WHERE s.id = d.id;

CREATE UNIQUE INDEX IF NOT EXISTS semesters_name_ci_unique
  ON public.semesters (lower(trim(name)));
ALTER TABLE public.jurors    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.scores    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.scores    ADD COLUMN IF NOT EXISTS final_submitted_at timestamptz;
ALTER TABLE public.scores    DROP COLUMN IF EXISTS submitted_at;
ALTER TABLE public.juror_semester_auth ADD COLUMN IF NOT EXISTS edit_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.juror_semester_auth ADD COLUMN IF NOT EXISTS pin_reveal_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.juror_semester_auth ADD COLUMN IF NOT EXISTS pin_plain_once text;

-- Remove legacy columns if present
ALTER TABLE public.juror_semester_auth DROP COLUMN IF EXISTS edit_expires_at;
ALTER TABLE public.juror_semester_auth DROP COLUMN IF EXISTS final_submitted_at;

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

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_actor_action_idx
  ON public.audit_logs (actor_type, action, created_at DESC);

-- ── Realtime publication (Supabase) ───────────────────────
-- Ensure tables are added to supabase_realtime for live updates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'semesters'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.semesters;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'projects'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'jurors'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.jurors;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'juror_semester_auth'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.juror_semester_auth;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'scores'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.scores;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'settings'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'audit_logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
    END IF;
  END IF;
END;
$$;

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

-- updated_at should change ONLY when score content changes
CREATE OR REPLACE FUNCTION public.trg_scores_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF  NEW.technical IS DISTINCT FROM OLD.technical
   OR NEW.written   IS DISTINCT FROM OLD.written
   OR NEW.oral      IS DISTINCT FROM OLD.oral
   OR NEW.teamwork  IS DISTINCT FROM OLD.teamwork
   OR NEW.comment   IS DISTINCT FROM OLD.comment
  THEN
    NEW.updated_at := now();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scores_updated_at ON public.scores;
CREATE TRIGGER trg_scores_updated_at
  BEFORE UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_scores_set_updated_at();

-- audit logs should never be updated or deleted
CREATE OR REPLACE FUNCTION public.trg_audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs_immutable';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_logs_immutable();

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
       sc.final_submitted_at,
       sc.created_at,
       sc.updated_at
FROM scores sc
JOIN semesters sem ON sem.id = sc.semester_id
JOIN projects p ON p.id = sc.project_id
JOIN jurors j ON j.id = sc.juror_id
WHERE sem.is_active = true;

-- ── RLS (default deny) ──────────────────────────────────────

ALTER TABLE public.semesters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.juror_semester_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;

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
        'scores', 'settings', 'juror_semester_auth', 'audit_logs'
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
  ends_on    date,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT id, name, is_active, starts_on, ends_on, updated_at
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
SET search_path = public, extensions
AS $$
  SELECT id, name, is_active, starts_on, ends_on
  FROM semesters
  WHERE is_active = true
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.rpc_list_projects(uuid, uuid);
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
  updated_at     timestamptz,
  final_submitted_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
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
    s.updated_at,
    s.final_submitted_at
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

DROP FUNCTION IF EXISTS public.rpc_upsert_score(uuid, uuid, uuid, integer, integer, integer, integer, text);
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
SET search_path = public, extensions
AS $$
DECLARE
  v_total integer;
  v_prev scores%ROWTYPE;
  v_had_any boolean := false;
  v_had_complete boolean := false;
  v_now_any boolean := false;
  v_now_complete boolean := false;
  v_completed_before integer := 0;
  v_completed_after integer := 0;
  v_total_projects integer := 0;
  v_before_all boolean := false;
  v_after_all boolean := false;
  v_group_no integer;
  v_project_title text;
  v_juror_name text;
  v_sem_name text;
  v_new_comment text;
  v_new_tech integer;
  v_new_writ integer;
  v_new_oral integer;
  v_new_team integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RAISE EXCEPTION 'semester_inactive';
  END IF;

  SELECT group_no, project_title
    INTO v_group_no, v_project_title
  FROM projects
  WHERE id = p_project_id;

  SELECT juror_name INTO v_juror_name
  FROM jurors
  WHERE id = p_juror_id;

  SELECT name INTO v_sem_name
  FROM semesters
  WHERE id = p_semester_id;

  SELECT * INTO v_prev
  FROM scores
  WHERE semester_id = p_semester_id
    AND project_id  = p_project_id
    AND juror_id    = p_juror_id;

  IF FOUND THEN
    v_had_any := (
      v_prev.technical IS NOT NULL
      OR v_prev.written IS NOT NULL
      OR v_prev.oral IS NOT NULL
      OR v_prev.teamwork IS NOT NULL
      OR NULLIF(trim(coalesce(v_prev.comment, '')), '') IS NOT NULL
    );
    v_had_complete := (
      v_prev.technical IS NOT NULL
      AND v_prev.written IS NOT NULL
      AND v_prev.oral IS NOT NULL
      AND v_prev.teamwork IS NOT NULL
    );
  END IF;

  SELECT COUNT(*)::int INTO v_total_projects
  FROM projects
  WHERE semester_id = p_semester_id;

  SELECT COUNT(*)::int INTO v_completed_before
  FROM scores sc
  WHERE sc.semester_id = p_semester_id
    AND sc.juror_id = p_juror_id
    AND sc.technical IS NOT NULL
    AND sc.written   IS NOT NULL
    AND sc.oral      IS NOT NULL
    AND sc.teamwork  IS NOT NULL;

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

  SELECT technical, written, oral, teamwork, comment
    INTO v_new_tech, v_new_writ, v_new_oral, v_new_team, v_new_comment
  FROM scores
  WHERE semester_id = p_semester_id
    AND project_id  = p_project_id
    AND juror_id    = p_juror_id;

  v_now_any := (
    v_new_tech IS NOT NULL
    OR v_new_writ IS NOT NULL
    OR v_new_oral IS NOT NULL
    OR v_new_team IS NOT NULL
    OR NULLIF(trim(coalesce(v_new_comment, '')), '') IS NOT NULL
  );
  v_now_complete := (
    v_new_tech IS NOT NULL
    AND v_new_writ IS NOT NULL
    AND v_new_oral IS NOT NULL
    AND v_new_team IS NOT NULL
  );

  SELECT COUNT(*)::int INTO v_completed_after
  FROM scores sc
  WHERE sc.semester_id = p_semester_id
    AND sc.juror_id = p_juror_id
    AND sc.technical IS NOT NULL
    AND sc.written   IS NOT NULL
    AND sc.oral      IS NOT NULL
    AND sc.teamwork  IS NOT NULL;

  v_before_all := (v_total_projects > 0 AND v_completed_before = v_total_projects);
  v_after_all := (v_total_projects > 0 AND v_completed_after = v_total_projects);

  IF (NOT v_had_any) AND v_now_any THEN
    PERFORM public._audit_log(
      'juror',
      p_juror_id,
      'juror_group_started',
      'project',
      p_project_id,
      format(
        'Juror %s started evaluating Group %s (%s)',
        COALESCE(v_juror_name, p_juror_id::text),
        COALESCE(v_group_no::text, '?'),
        COALESCE(v_sem_name, p_semester_id::text)
      ),
      jsonb_build_object(
        'semester_id', p_semester_id,
        'semester_name', v_sem_name,
        'group_no', v_group_no,
        'project_title', v_project_title
      )
    );
  END IF;

  IF (NOT v_had_complete) AND v_now_complete THEN
    PERFORM public._audit_log(
      'juror',
      p_juror_id,
      'juror_group_completed',
      'project',
      p_project_id,
      format(
        'Juror %s completed evaluation for Group %s (%s)',
        COALESCE(v_juror_name, p_juror_id::text),
        COALESCE(v_group_no::text, '?'),
        COALESCE(v_sem_name, p_semester_id::text)
      ),
      jsonb_build_object(
        'semester_id', p_semester_id,
        'semester_name', v_sem_name,
        'group_no', v_group_no,
        'project_title', v_project_title
      )
    );
  END IF;

  IF (NOT v_before_all) AND v_after_all THEN
    PERFORM public._audit_log(
      'juror',
      p_juror_id,
      'juror_all_completed',
      'semester',
      p_semester_id,
      format(
        'Juror %s completed all project evaluations (%s)',
        COALESCE(v_juror_name, p_juror_id::text),
        COALESCE(v_sem_name, p_semester_id::text)
      ),
      jsonb_build_object(
        'semester_id', p_semester_id,
        'semester_name', v_sem_name,
        'completed_projects', v_completed_after,
        'total_projects', v_total_projects
      )
    );
  END IF;

  RETURN v_total;
END;
$$;

-- ── Audit helper ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._audit_log(
  p_actor_type  text,
  p_actor_id    uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_message     text,
  p_metadata    jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO audit_logs (
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    message,
    metadata
  )
  VALUES (
    COALESCE(NULLIF(trim(p_actor_type), ''), 'system'),
    p_actor_id,
    COALESCE(NULLIF(trim(p_action), ''), 'unknown'),
    COALESCE(NULLIF(trim(p_entity_type), ''), 'unknown'),
    p_entity_id,
    COALESCE(NULLIF(trim(p_message), ''), 'Audit event'),
    p_metadata
  );
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
SET search_path = public, extensions
AS $$
DECLARE
  v_ok boolean;
BEGIN
  v_ok := public._verify_admin_password(p_password);
  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public._verify_delete_password(p_password text)
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
  WHERE key = 'delete_password_hash';

  IF v_hash IS NULL THEN
    RETURN false;
  END IF;

  RETURN crypt(p_password, v_hash) = v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_delete_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
  FROM settings
  WHERE key = 'delete_password_hash';

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'delete_password_missing' USING ERRCODE = 'P0401';
  END IF;

  IF crypt(p_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'incorrect_delete_password' USING ERRCODE = 'P0401';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_change_delete_password(
  p_current_password text,
  p_new_password text,
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

  PERFORM public._assert_delete_password(p_current_password);

  INSERT INTO settings (key, value)
  VALUES ('delete_password_hash', crypt(p_new_password, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'delete_password_change',
    'settings',
    null::uuid,
    'Admin changed delete password',
    null
  );

  RETURN true;
END;
$$;

-- ── Backup Password ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assert_backup_password(p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
  FROM settings
  WHERE key = 'backup_password_hash';

  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'backup_password_missing' USING ERRCODE = 'P0401';
  END IF;

  IF crypt(p_password, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'incorrect_backup_password' USING ERRCODE = 'P0401';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_change_backup_password(
  p_current_password text,
  p_new_password     text,
  p_admin_password   text
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

  PERFORM public._assert_backup_password(p_current_password);

  INSERT INTO settings (key, value)
  VALUES ('backup_password_hash', crypt(p_new_password, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'backup_password_change',
    'settings',
    null::uuid,
    'Admin changed backup password',
    null
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_full_export(
  p_backup_password text,
  p_admin_password  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  PERFORM public._assert_backup_password(p_backup_password);

  RETURN jsonb_build_object(
    'exported_at',     now(),
    'schema_version',  1,
    'semesters',       COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM semesters s),           '[]'::jsonb),
    'jurors',          COALESCE((SELECT jsonb_agg(row_to_json(j)) FROM jurors j),              '[]'::jsonb),
    'projects',        COALESCE((SELECT jsonb_agg(row_to_json(p)) FROM projects p),            '[]'::jsonb),
    'scores',          COALESCE((SELECT jsonb_agg(row_to_json(sc)) FROM scores sc),            '[]'::jsonb),
    'juror_semester_auth', COALESCE((SELECT jsonb_agg(row_to_json(a)) FROM juror_semester_auth a), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_full_import(
  p_backup_password text,
  p_admin_password  text,
  p_data            jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r jsonb;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  PERFORM public._assert_backup_password(p_backup_password);

  -- 1. Semesters (no FK deps)
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_data->'semesters', '[]'::jsonb)) LOOP
    INSERT INTO semesters (id, name, is_active, starts_on, ends_on, created_at, updated_at)
    VALUES (
      (r->>'id')::uuid,
      r->>'name',
      COALESCE((r->>'is_active')::boolean, false),
      (r->>'starts_on')::date,
      (r->>'ends_on')::date,
      COALESCE((r->>'created_at')::timestamptz, now()),
      COALESCE((r->>'updated_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      name       = EXCLUDED.name,
      is_active  = EXCLUDED.is_active,
      starts_on  = EXCLUDED.starts_on,
      ends_on    = EXCLUDED.ends_on,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  -- 2. Jurors (no FK deps)
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_data->'jurors', '[]'::jsonb)) LOOP
    INSERT INTO jurors (id, juror_name, juror_inst, created_at, updated_at)
    VALUES (
      (r->>'id')::uuid,
      r->>'juror_name',
      r->>'juror_inst',
      COALESCE((r->>'created_at')::timestamptz, now()),
      COALESCE((r->>'updated_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      juror_name = EXCLUDED.juror_name,
      juror_inst = EXCLUDED.juror_inst,
      updated_at = EXCLUDED.updated_at;
  END LOOP;

  -- 3. Juror semester auth (deps: jurors, semesters)
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_data->'juror_semester_auth', '[]'::jsonb)) LOOP
    INSERT INTO juror_semester_auth (
      id, juror_id, semester_id, pin_hash, pin_reveal_pending, pin_plain_once,
      created_at, failed_attempts, locked_until, last_seen_at, edit_enabled
    )
    VALUES (
      (r->>'id')::uuid,
      (r->>'juror_id')::uuid,
      (r->>'semester_id')::uuid,
      r->>'pin_hash',
      COALESCE((r->>'pin_reveal_pending')::boolean, false),
      r->>'pin_plain_once',
      COALESCE((r->>'created_at')::timestamptz, now()),
      COALESCE((r->>'failed_attempts')::integer, 0),
      (r->>'locked_until')::timestamptz,
      (r->>'last_seen_at')::timestamptz,
      COALESCE((r->>'edit_enabled')::boolean, false)
    )
    ON CONFLICT (juror_id, semester_id) DO UPDATE SET
      pin_hash           = EXCLUDED.pin_hash,
      pin_reveal_pending = EXCLUDED.pin_reveal_pending,
      pin_plain_once     = EXCLUDED.pin_plain_once,
      failed_attempts    = EXCLUDED.failed_attempts,
      locked_until       = EXCLUDED.locked_until,
      last_seen_at       = EXCLUDED.last_seen_at,
      edit_enabled       = EXCLUDED.edit_enabled;
  END LOOP;

  -- 4. Projects (deps: semesters)
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_data->'projects', '[]'::jsonb)) LOOP
    INSERT INTO projects (id, semester_id, group_no, project_title, group_students, created_at, updated_at)
    VALUES (
      (r->>'id')::uuid,
      (r->>'semester_id')::uuid,
      (r->>'group_no')::integer,
      r->>'project_title',
      COALESCE(r->>'group_students', ''),
      COALESCE((r->>'created_at')::timestamptz, now()),
      COALESCE((r->>'updated_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      semester_id    = EXCLUDED.semester_id,
      group_no       = EXCLUDED.group_no,
      project_title  = EXCLUDED.project_title,
      group_students = EXCLUDED.group_students,
      updated_at     = EXCLUDED.updated_at;
  END LOOP;

  -- 5. Scores (deps: jurors, projects, semesters)
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_data->'scores', '[]'::jsonb)) LOOP
    INSERT INTO scores (
      id, semester_id, project_id, juror_id,
      technical, written, oral, teamwork, total, comment,
      final_submitted_at, created_at, updated_at
    )
    VALUES (
      (r->>'id')::uuid,
      (r->>'semester_id')::uuid,
      (r->>'project_id')::uuid,
      (r->>'juror_id')::uuid,
      (r->>'technical')::integer,
      (r->>'written')::integer,
      (r->>'oral')::integer,
      (r->>'teamwork')::integer,
      (r->>'total')::integer,
      r->>'comment',
      (r->>'final_submitted_at')::timestamptz,
      COALESCE((r->>'created_at')::timestamptz, now()),
      COALESCE((r->>'updated_at')::timestamptz, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      technical          = EXCLUDED.technical,
      written            = EXCLUDED.written,
      oral               = EXCLUDED.oral,
      teamwork           = EXCLUDED.teamwork,
      total              = EXCLUDED.total,
      comment            = EXCLUDED.comment,
      final_submitted_at = EXCLUDED.final_submitted_at,
      updated_at         = EXCLUDED.updated_at;
  END LOOP;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'db_import',
    'settings',
    null::uuid,
    'Admin restored database from backup',
    null
  );

  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_bootstrap_backup_password(
  p_new_password   text,
  p_admin_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  SELECT value INTO v_hash FROM settings WHERE key = 'backup_password_hash';
  IF v_hash IS NOT NULL THEN
    RAISE EXCEPTION 'already_initialized';
  END IF;

  INSERT INTO settings (key, value)
  VALUES ('backup_password_hash', crypt(p_new_password, gen_salt('bf')))
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  PERFORM public._audit_log(
    'admin', null::uuid, 'backup_password_change', 'settings', null::uuid,
    'Admin initialized backup password', null
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public._assert_backup_password(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_bootstrap_backup_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_backup_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_full_export(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_full_import(text, text, jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.rpc_admin_list_audit_logs(text, timestamptz, timestamptz, text, text, integer);
CREATE OR REPLACE FUNCTION public.rpc_admin_list_audit_logs(
  p_admin_password text,
  p_start_at       timestamptz DEFAULT NULL,
  p_end_at         timestamptz DEFAULT NULL,
  p_actor_types    text[] DEFAULT NULL,
  p_actions        text[] DEFAULT NULL,
  p_limit          integer DEFAULT 100
)
RETURNS TABLE (
  id          uuid,
  created_at  timestamptz,
  actor_type  text,
  actor_id    uuid,
  action      text,
  entity_type text,
  entity_id   uuid,
  message     text,
  metadata    jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_limit integer;
  v_actor_types text[];
  v_actions text[];
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_actor_types := array_remove(p_actor_types, '');
  v_actions := array_remove(p_actions, '');
  IF v_actor_types IS NOT NULL AND array_length(v_actor_types, 1) IS NULL THEN
    v_actor_types := NULL;
  END IF;
  IF v_actions IS NOT NULL AND array_length(v_actions, 1) IS NULL THEN
    v_actions := NULL;
  END IF;

  RETURN QUERY
    SELECT
      a.id,
      a.created_at,
      a.actor_type,
      a.actor_id,
      a.action,
      a.entity_type,
      a.entity_id,
      a.message,
      a.metadata
    FROM audit_logs a
    WHERE (p_start_at IS NULL OR a.created_at >= p_start_at)
      AND (p_end_at IS NULL OR a.created_at <= p_end_at)
      AND (v_actor_types IS NULL OR a.actor_type = ANY(v_actor_types))
      AND (v_actions IS NULL OR a.action = ANY(v_actions))
    ORDER BY a.created_at DESC
    LIMIT v_limit;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_get_scores(uuid, text);
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
  updated_at    timestamptz,
  final_submitted_at timestamptz,
  status        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
      s.updated_at,
      s.final_submitted_at,
      CASE
        WHEN s.technical IS NOT NULL
         AND s.written   IS NOT NULL
         AND s.oral      IS NOT NULL
         AND s.teamwork  IS NOT NULL
        THEN 'submitted'::text
        WHEN s.technical IS NULL
         AND s.written   IS NULL
         AND s.oral      IS NULL
         AND s.teamwork  IS NULL
         AND NULLIF(trim(coalesce(s.comment, '')), '') IS NULL
        THEN 'not_started'::text
        ELSE 'in_progress'::text
      END AS status
    FROM scores s
    JOIN jurors   j ON j.id = s.juror_id
    JOIN projects p ON p.id = s.project_id
    WHERE s.semester_id = p_semester_id
    ORDER BY j.juror_name, p.group_no;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_project_summary(uuid, text);
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
SET search_path = public, extensions
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
      AND s.final_submitted_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM juror_semester_auth a
        WHERE a.juror_id = s.juror_id
          AND a.semester_id = s.semester_id
          AND COALESCE(a.edit_enabled, false) = false
      )
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
DECLARE
  v_name text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  SELECT name INTO v_name FROM semesters WHERE id = p_semester_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'semester_not_found';
  END IF;

  UPDATE semesters
  SET is_active = false
  WHERE id <> p_semester_id;

  UPDATE semesters
  SET is_active = true
  WHERE id = p_semester_id;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'set_active_semester',
    'semester',
    p_semester_id,
    format('Admin set active semester to %s', COALESCE(v_name, p_semester_id::text)),
    null
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_create_semester(text, date, date, text);
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
DECLARE
  v_id uuid;
  v_name text;
  v_active boolean;
  v_starts_on date;
  v_ends_on date;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  v_name := trim(p_name);
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'semester_name_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM semesters s
    WHERE lower(trim(s.name)) = lower(v_name)
  ) THEN
    RAISE EXCEPTION 'semester_name_exists';
  END IF;

  INSERT INTO semesters (name, is_active, starts_on, ends_on)
  VALUES (v_name, false, p_starts_on, p_ends_on)
  RETURNING semesters.id, semesters.name, semesters.is_active, semesters.starts_on, semesters.ends_on
    INTO v_id, v_name, v_active, v_starts_on, v_ends_on;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'semester_create',
    'semester',
    v_id,
    format('Admin created semester %s', v_name),
    jsonb_build_object('starts_on', v_starts_on, 'ends_on', v_ends_on)
  );

  RETURN QUERY SELECT v_id, v_name, v_active, v_starts_on, v_ends_on;
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
DECLARE
  v_name text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  IF p_starts_on > p_ends_on THEN
    RAISE EXCEPTION 'invalid_dates';
  END IF;

  v_name := trim(p_name);
  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'semester_name_required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM semesters s
    WHERE lower(trim(s.name)) = lower(v_name)
      AND s.id <> p_semester_id
  ) THEN
    RAISE EXCEPTION 'semester_name_exists';
  END IF;

  UPDATE semesters
  SET name = v_name,
      starts_on = p_starts_on,
      ends_on = p_ends_on
  WHERE id = p_semester_id;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'semester_update',
    'semester',
    p_semester_id,
    format('Admin updated semester %s', v_name),
    null
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_semester(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_semester(
  p_semester_id uuid,
  p_delete_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name text;
BEGIN
  PERFORM public._assert_delete_password(p_delete_password);

  SELECT name INTO v_name FROM semesters WHERE id = p_semester_id;

  DELETE FROM semesters WHERE id = p_semester_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'semester_not_found';
  END IF;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'semester_delete',
    'semester',
    p_semester_id,
    format('Admin deleted semester %s', COALESCE(v_name, p_semester_id::text)),
    null
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_list_projects(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_list_projects(
  p_semester_id uuid,
  p_admin_password text
)
RETURNS TABLE (
  id uuid,
  semester_id uuid,
  group_no integer,
  project_title text,
  group_students text,
  updated_at timestamptz
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
    SELECT p.id, p.semester_id, p.group_no, p.project_title, p.group_students, p.updated_at
    FROM projects p
    WHERE p.semester_id = p_semester_id
    ORDER BY p.group_no ASC;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_create_project(uuid, integer, text, text, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_create_project(
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

  IF EXISTS (
    SELECT 1
    FROM projects
    WHERE semester_id = p_semester_id
      AND group_no = p_group_no
  ) THEN
    RAISE EXCEPTION 'project_group_exists';
  END IF;

  INSERT INTO projects (semester_id, group_no, project_title, group_students)
  VALUES (p_semester_id, p_group_no, p_project_title, p_group_students)
  RETURNING id INTO v_id;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'project_create',
    'project',
    v_id,
    format('Admin created project Group %s — %s', p_group_no, p_project_title),
    jsonb_build_object('semester_id', p_semester_id, 'group_no', p_group_no)
  );

  RETURN QUERY SELECT v_id;
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
  v_created boolean := false;
  v_action text;
  v_message text;
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
    v_created := true;
  ELSE
    UPDATE projects
    SET project_title = p_project_title,
        group_students = p_group_students
    WHERE id = v_id;
  END IF;

  v_action := CASE WHEN v_created THEN 'project_create' ELSE 'project_update' END;
  v_message := CASE
    WHEN v_created THEN format('Admin created project Group %s — %s', p_group_no, p_project_title)
    ELSE format('Admin updated project Group %s — %s', p_group_no, p_project_title)
  END;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    v_action,
    'project',
    v_id,
    v_message,
    jsonb_build_object('semester_id', p_semester_id, 'group_no', p_group_no)
  );

  RETURN QUERY SELECT v_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_project(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_project(
  p_project_id uuid,
  p_delete_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_title text;
  v_group integer;
  v_semester_id uuid;
BEGIN
  PERFORM public._assert_delete_password(p_delete_password);

  SELECT project_title, group_no, semester_id
    INTO v_title, v_group, v_semester_id
  FROM projects
  WHERE id = p_project_id;

  DELETE FROM projects WHERE id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project_not_found';
  END IF;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'project_delete',
    'project',
    p_project_id,
    format(
      'Admin deleted project Group %s — %s',
      COALESCE(v_group::text, '?'),
      COALESCE(v_title, p_project_id::text)
    ),
    jsonb_build_object(
      'group_no', v_group,
      'semester_id', v_semester_id
    )
  );

  RETURN true;
END;
$$;

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
  v_created boolean := false;
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

  IF v_id IS NOT NULL THEN
    RAISE EXCEPTION 'juror_exists';
  END IF;

  INSERT INTO jurors (juror_name, juror_inst)
  VALUES (trim(p_juror_name), trim(p_juror_inst))
  RETURNING jurors.id, jurors.juror_name, jurors.juror_inst
  INTO v_id, v_name, v_inst;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'juror_create',
    'juror',
    v_id,
    format(
      'Admin created juror %s%s',
      COALESCE(v_name, ''),
      CASE
        WHEN COALESCE(NULLIF(trim(v_inst), ''), '') = '' THEN ''
        ELSE format(' (%s)', v_inst)
      END
    ),
    null
  );

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

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'juror_update',
    'juror',
    p_juror_id,
    format('Admin updated juror %s', trim(p_juror_name)),
    null
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_juror(uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_juror(
  p_juror_id uuid,
  p_delete_password text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name text;
BEGIN
  PERFORM public._assert_delete_password(p_delete_password);

  SELECT juror_name INTO v_name FROM jurors WHERE id = p_juror_id;

  DELETE FROM jurors WHERE id = p_juror_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'juror_not_found';
  END IF;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'juror_delete',
    'juror',
    p_juror_id,
    format('Admin deleted juror %s', COALESCE(v_name, p_juror_id::text)),
    null
  );

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_admin_delete_counts(text, uuid, text);
CREATE OR REPLACE FUNCTION public.rpc_admin_delete_counts(
  p_type text,
  p_id   uuid,
  p_admin_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_projects    bigint := 0;
  v_scores      bigint := 0;
  v_juror_auths bigint := 0;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  IF p_type = 'semester' THEN
    SELECT COUNT(*) INTO v_projects    FROM projects           WHERE semester_id = p_id;
    SELECT COUNT(*) INTO v_scores      FROM scores             WHERE semester_id = p_id;
    SELECT COUNT(*) INTO v_juror_auths FROM juror_semester_auth WHERE semester_id = p_id;
    RETURN jsonb_build_object('projects', v_projects, 'scores', v_scores, 'juror_auths', v_juror_auths);

  ELSIF p_type = 'project' THEN
    SELECT COUNT(*) INTO v_scores FROM scores WHERE project_id = p_id;
    RETURN jsonb_build_object('scores', v_scores);

  ELSIF p_type = 'juror' THEN
    SELECT COUNT(*) INTO v_scores      FROM scores             WHERE juror_id = p_id;
    SELECT COUNT(*) INTO v_juror_auths FROM juror_semester_auth WHERE juror_id = p_id;
    RETURN jsonb_build_object('scores', v_scores, 'juror_auths', v_juror_auths);

  ELSE
    RAISE EXCEPTION 'unsupported_type';
  END IF;
END;
$$;

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
  v_juror_name text;
  v_juror_inst text;
  v_label text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  v_pin := lpad((floor(random() * 10000))::text, 4, '0');
  v_hash := crypt(v_pin, gen_salt('bf'));

  SELECT juror_name, juror_inst
    INTO v_juror_name, v_juror_inst
  FROM jurors
  WHERE id = p_juror_id;

  v_label := COALESCE(NULLIF(trim(v_juror_name), ''), p_juror_id::text);
  IF COALESCE(NULLIF(trim(v_juror_inst), ''), '') <> '' THEN
    v_label := v_label || format(' (%s)', v_juror_inst);
  END IF;

  INSERT INTO juror_semester_auth (juror_id, semester_id, pin_hash, pin_reveal_pending, pin_plain_once, failed_attempts, locked_until)
  VALUES (p_juror_id, p_semester_id, v_hash, true, v_pin, 0, null)
  ON CONFLICT (juror_id, semester_id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        pin_reveal_pending = true,
        pin_plain_once = EXCLUDED.pin_plain_once,
        last_seen_at = null;

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'juror_pin_reset',
    'juror',
    p_juror_id,
    format('Admin reset PIN for juror %s', v_label),
    jsonb_build_object('semester_id', p_semester_id)
  );

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
DECLARE
  v_prev text;
  v_is_lock boolean;
  v_sem_id uuid;
  v_sem_name text;
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  SELECT value INTO v_prev
  FROM settings
  WHERE key = p_key;

  INSERT INTO settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();

  IF p_key = 'eval_lock_active_semester' AND v_prev IS DISTINCT FROM p_value THEN
    v_is_lock := (p_value = 'true');
    SELECT id, name
      INTO v_sem_id, v_sem_name
    FROM semesters
    WHERE is_active = true
    LIMIT 1;

    PERFORM public._audit_log(
      'admin',
      null::uuid,
      'eval_lock_toggle',
      'settings',
      null::uuid,
      format(
        'Admin turned evaluation lock %s (active semester)',
        CASE WHEN v_is_lock THEN 'ON' ELSE 'OFF' END
      ),
      jsonb_build_object(
        'semester_id', v_sem_id,
        'semester_name', v_sem_name,
        'enabled', v_is_lock
      )
    );
  END IF;

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
  last_seen_at timestamptz,
  is_locked boolean,
  is_assigned boolean,
  scored_semesters text[],
  edit_enabled boolean,
  final_submitted_at timestamptz,
  last_activity_at timestamptz,
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
      a.last_seen_at,
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
      fs.final_submitted_at,
      la.last_activity_at,
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
      SELECT MAX(sc.final_submitted_at) AS final_submitted_at
      FROM scores sc
      WHERE sc.juror_id = j.id
        AND sc.semester_id = p_semester_id
    ) AS fs ON true
    LEFT JOIN LATERAL (
      SELECT GREATEST(MAX(sc.updated_at), MAX(sc.final_submitted_at)) AS last_activity_at
      FROM scores sc
      WHERE sc.juror_id = j.id
        AND sc.semester_id = p_semester_id
    ) AS la ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(x.name ORDER BY x.starts_on DESC) AS scored_semesters
      FROM (
        SELECT DISTINCT s.id, s.name, s.starts_on
        FROM scores sc
        JOIN semesters s ON s.id = sc.semester_id
        WHERE sc.juror_id = j.id
          AND sc.final_submitted_at IS NOT NULL
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
DECLARE
  v_name text;
  v_sem_name text;
  v_total_projects integer := 0;
  v_completed_projects integer := 0;
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

  IF COALESCE(p_enabled, false) = false THEN
    SELECT COUNT(*)::int INTO v_total_projects
    FROM projects p
    WHERE p.semester_id = p_semester_id;

    SELECT COUNT(*)::int INTO v_completed_projects
    FROM scores sc
    WHERE sc.semester_id = p_semester_id
      AND sc.juror_id = p_juror_id
      AND sc.technical IS NOT NULL
      AND sc.written   IS NOT NULL
      AND sc.oral      IS NOT NULL
      AND sc.teamwork  IS NOT NULL;

    IF v_total_projects > 0 AND v_completed_projects < v_total_projects THEN
      RAISE EXCEPTION 'final_submit_required';
    END IF;
  END IF;

  UPDATE juror_semester_auth
  SET edit_enabled = COALESCE(p_enabled, false)
  WHERE juror_id = p_juror_id
    AND semester_id = p_semester_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_pin';
  END IF;

  SELECT juror_name INTO v_name FROM jurors WHERE id = p_juror_id;
  SELECT name INTO v_sem_name FROM semesters WHERE id = p_semester_id;
  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'admin_juror_edit_toggle',
    'juror',
    p_juror_id,
    format(
      'Admin %s edit mode for Juror %s (%s)',
      CASE WHEN COALESCE(p_enabled, false) THEN 'enabled' ELSE 'disabled' END,
      COALESCE(v_name, p_juror_id::text),
      COALESCE(v_sem_name, p_semester_id::text)
    ),
    jsonb_build_object('semester_id', p_semester_id, 'enabled', COALESCE(p_enabled, false))
  );

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
  v_now timestamptz := now();
  v_juror_name text;
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

  -- Stamp final submission time for all score rows (server time)
  UPDATE scores
  SET final_submitted_at = v_now
  WHERE juror_id = p_juror_id
    AND semester_id = p_semester_id;

  SELECT juror_name INTO v_juror_name FROM jurors WHERE id = p_juror_id;
  PERFORM public._audit_log(
    'juror',
    p_juror_id,
    'juror_finalize_submission',
    'semester',
    p_semester_id,
    format('Juror %s finalized submission', COALESCE(v_juror_name, p_juror_id::text)),
    null
  );

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

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'admin_password_change',
    'settings',
    null::uuid,
    'Admin changed admin password',
    null
  );

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

  PERFORM public._audit_log(
    'admin',
    null::uuid,
    'admin_password_change',
    'settings',
    null::uuid,
    'Admin changed admin password',
    null
  );

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
  v_pin_plain_once text;
  v_reveal_pending boolean := false;
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
    SELECT a.locked_until, a.failed_attempts, a.pin_plain_once, a.pin_reveal_pending
      INTO v_locked_until, v_failed_attempts, v_pin_plain_once, v_reveal_pending
    FROM juror_semester_auth a
    WHERE a.juror_id = v_juror_id
      AND a.semester_id = p_semester_id
    LIMIT 1;

    IF v_reveal_pending THEN
      IF v_pin_plain_once IS NULL THEN
        v_pin := lpad((floor(random() * 10000))::text, 4, '0');
        v_pin_hash := crypt(v_pin, gen_salt('bf'::text));
        v_pin_plain_once := v_pin;
        UPDATE juror_semester_auth
        SET pin_hash = v_pin_hash,
            failed_attempts = 0,
            locked_until = null,
            pin_reveal_pending = false,
            pin_plain_once = null
        WHERE juror_id = v_juror_id
          AND semester_id = p_semester_id;
      ELSE
        UPDATE juror_semester_auth
        SET failed_attempts = 0,
            locked_until = null,
            pin_reveal_pending = false,
            pin_plain_once = null
        WHERE juror_id = v_juror_id
          AND semester_id = p_semester_id;
      END IF;

      RETURN QUERY SELECT v_juror_id, v_juror_name, v_juror_inst, false, v_pin_plain_once,
        null::timestamptz, 0;
      RETURN;
    END IF;

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

DROP FUNCTION IF EXISTS public.rpc_verify_juror_pin(uuid, text, text, text);
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
  failed_attempts integer,
  pin_plain_once  text
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
  v_sem_name text;
  v_pin_plain_once text;
BEGIN
  v_norm_name := lower(regexp_replace(trim(coalesce(p_juror_name, '')), '\\s+', ' ', 'g'));
  v_norm_inst := lower(regexp_replace(trim(coalesce(p_juror_inst, '')), '\\s+', ' ', 'g'));
  v_pin := regexp_replace(coalesce(p_pin, ''), '\\s+', '', 'g');

  IF NOT EXISTS (
    SELECT 1 FROM semesters s
    WHERE s.id = p_semester_id
      AND s.is_active = true
  ) THEN
    RETURN QUERY SELECT false, null::uuid, null::text, null::text, 'semester_inactive', null::timestamptz, 0, null::text;
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
    RETURN QUERY SELECT false, null::uuid, null::text, null::text, 'not_found', null::timestamptz, 0, null::text;
    RETURN;
  END IF;

  SELECT *
    INTO v_auth
  FROM juror_semester_auth a
  WHERE a.juror_id = v_juror_id
    AND a.semester_id = p_semester_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'no_pin', null::timestamptz, 0, null::text;
    RETURN;
  END IF;

  IF v_auth.locked_until IS NOT NULL AND v_auth.locked_until > v_now THEN
    RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'locked', v_auth.locked_until, v_auth.failed_attempts, null::text;
    RETURN;
  END IF;

  IF crypt(v_pin, v_auth.pin_hash) = v_auth.pin_hash THEN
    v_pin_plain_once := CASE WHEN v_auth.pin_reveal_pending THEN v_auth.pin_plain_once ELSE null::text END;
    UPDATE juror_semester_auth
    SET last_seen_at = v_now,
        failed_attempts = 0,
        locked_until = null,
        pin_reveal_pending = false,
        pin_plain_once = null
    WHERE id = v_auth.id;

    RETURN QUERY SELECT true, v_juror_id, v_juror_name, v_juror_inst, null::text, null::timestamptz, 0, v_pin_plain_once;
    RETURN;
  END IF;

  v_failed := v_auth.failed_attempts + 1;
  v_locked := null;
  IF v_failed >= 3 THEN
    v_locked := v_now + interval '15 minutes';
  END IF;

  UPDATE juror_semester_auth
  SET failed_attempts = v_failed,
      locked_until = v_locked
  WHERE id = v_auth.id;

  IF v_locked IS NOT NULL THEN
    SELECT name INTO v_sem_name FROM semesters WHERE id = p_semester_id;
    PERFORM public._audit_log(
      'juror',
      v_juror_id,
      'juror_pin_locked',
      'juror',
      v_juror_id,
      format(
        'Juror %s PIN locked after too many failed attempts',
        COALESCE(v_juror_name, v_juror_id::text)
      ),
      jsonb_build_object(
        'juror_name', v_juror_name,
        'juror_inst', v_juror_inst,
        'semester_id', p_semester_id,
        'semester_name', v_sem_name,
        'failed_attempts', v_failed,
        'locked_until', v_locked
      )
    );
  END IF;

  IF v_locked IS NOT NULL THEN
    RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'locked', v_locked, v_failed, null::text;
  END IF;

  RETURN QUERY SELECT false, v_juror_id, v_juror_name, v_juror_inst, 'invalid', v_locked, v_failed, null::text;
END;
$$;

-- ── Grants ──────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.rpc_list_semesters() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_active_semester() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_projects(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_upsert_score(uuid, uuid, uuid, integer, integer, integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_or_get_juror_and_issue_pin(uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_verify_juror_pin(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_juror_edit_state(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_finalize_juror_submission(uuid, uuid) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_admin_login(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_scores(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_project_summary(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_active_semester(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_semester(text, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_semester(uuid, text, date, date, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_projects(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_project(uuid, integer, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_upsert_project(uuid, integer, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_project(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_counts(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_juror(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_update_juror(uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_juror(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_reset_juror_pin(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_get_settings(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_setting(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_audit_logs(text, timestamptz, timestamptz, text[], text[], integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_jurors(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_set_juror_edit_mode(uuid, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_password(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_bootstrap_password(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_change_delete_password(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_delete_semester(uuid, text) TO anon, authenticated;
