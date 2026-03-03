-- ============================================================
-- 006_rpc_admin_list_jurors.sql
-- Run AFTER 001–005.
--
-- Returns all jurors in the system so the admin panel can
-- display jurors who haven't submitted any scores yet.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_list_jurors(
  p_semester_id    uuid,
  p_admin_password text
)
RETURNS TABLE (juror_id uuid, juror_name text, juror_inst text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public._verify_admin_password(p_admin_password) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0401';
  END IF;

  RETURN QUERY
    SELECT id, juror_name, juror_inst
    FROM jurors
    ORDER BY juror_name;
END;
$$;
