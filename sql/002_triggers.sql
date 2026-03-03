-- ============================================================
-- 002_triggers.sql
-- Run AFTER 001_constraints_and_notes.sql.
--
-- Triggers:
--   1. trg_scores_total      — auto-compute total on scores upsert
--   2. trg_scores_submitted  — auto-set submitted_at when all 4 criteria filled
--   3. trg_notes_updated_at  — keep project_notes.updated_at current
-- ============================================================

-- ── 1. Compute total ──────────────────────────────────────────
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

-- ── 2. Set submitted_at ───────────────────────────────────────
-- Rules:
--   • All 4 criteria non-null  AND  previously any was null → set now()
--   • Any criterion is null                                  → clear to NULL
--   • All 4 already non-null and still non-null              → keep existing submitted_at
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
    -- First time all 4 are filled, or re-filling after a partial clear
    IF  OLD.submitted_at IS NULL
     OR OLD.technical IS NULL
     OR OLD.written   IS NULL
     OR OLD.oral      IS NULL
     OR OLD.teamwork  IS NULL
    THEN
      NEW.submitted_at := now();
    END IF;
    -- else: all 4 were already filled — keep the original submitted_at
  ELSE
    -- Partial save: clear submitted_at (juror is still editing)
    NEW.submitted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scores_submitted_at ON public.scores;
CREATE TRIGGER trg_scores_submitted_at
  BEFORE INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_scores_submitted_at();

-- ── 3. project_notes.updated_at ──────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_project_notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_notes_updated_at ON public.project_notes;
CREATE TRIGGER trg_project_notes_updated_at
  BEFORE UPDATE ON public.project_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_project_notes_updated_at();
