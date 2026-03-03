-- ============================================================
-- 003_rls.sql
-- Run AFTER 001 and 002.
--
-- Enables Row Level Security on all tables with a default-deny
-- policy. All reads and writes go through SECURITY DEFINER RPCs
-- which bypass RLS automatically.
--
-- The Supabase anon key (used by the React frontend) will be
-- denied all direct table access. The service_role key
-- (used internally by Supabase) bypasses RLS by default.
-- ============================================================

-- Enable RLS
ALTER TABLE public.semesters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jurors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_notes ENABLE ROW LEVEL SECURITY;

-- Drop any existing permissive policies (idempotent cleanup)
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
        'scores', 'settings', 'project_notes'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      rec.policyname, rec.schemaname, rec.tablename
    );
  END LOOP;
END;
$$;

-- No permissive policies are added here.
-- With RLS enabled and no USING (true) policies:
--   • SELECT → 0 rows returned (no error, just empty)
--   • INSERT / UPDATE / DELETE → permission denied error
--
-- To verify after running:
--   SET ROLE anon;
--   SELECT count(*) FROM public.scores;   -- should return 0
--   RESET ROLE;
