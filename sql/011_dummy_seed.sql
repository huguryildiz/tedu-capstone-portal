-- ============================================================
-- 001_seed_dummy.sql
-- Seed realistic dummy data for Jury Portal (run AFTER 000_bootstrap.sql)
-- Includes:
--   - Admin password bootstrap (12345678)
--   - 4 single-day semesters (2025 Spring active)
--   - 15–20 jurors (mixed Turkish + international) with "University / Department"
--   - 10–15 projects per semester (creative, globally-unique titles)
--   - group_students as "Name Surname; Name Surname; ..."
--   - juror_semester_auth (12–16 jurors per semester, overlap ensured)
--   - scores (all assigned jurors per project, avg total ~75–90, 4% one criterion NULL)
-- ============================================================

BEGIN;

-- deterministic-ish randomness
SELECT setseed(0.424242);

-- ensure pgcrypto functions are resolvable
SET search_path = public, extensions;

-- ------------------------------------------------------------
-- DEV RESET (safe order)
-- ------------------------------------------------------------
TRUNCATE TABLE
  public.scores,
  public.juror_semester_auth,
  public.projects,
  public.jurors,
  public.semesters
RESTART IDENTITY CASCADE;

-- ------------------------------------------------------------
-- 0) Admin password bootstrap
-- ------------------------------------------------------------
INSERT INTO public.settings (key, value)
VALUES ('admin_password_hash', crypt('12345678', gen_salt('bf')))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.settings (key, value)
VALUES ('eval_lock_active_semester', 'false')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 1) Semesters (exactly 4, single-day) - 2025 Spring active
-- ------------------------------------------------------------
INSERT INTO public.semesters (name, is_active, starts_on, ends_on)
VALUES
  ('2024 Summer', false, DATE '2024-07-15', DATE '2024-07-15'),
  ('2025 Spring', true,  DATE '2025-04-15', DATE '2025-04-15'),
  ('2025 Summer', false, DATE '2025-07-15', DATE '2025-07-15'),
  ('2025 Fall',   false, DATE '2025-11-15', DATE '2025-11-15');

-- enforce exactly one active (defensive)
UPDATE public.semesters
SET is_active = (name = '2025 Spring');

-- ------------------------------------------------------------
-- 2) Jurors (18 total) - mixed Turkish + international
--    juror_inst format: "University / Department"
-- ------------------------------------------------------------
INSERT INTO public.jurors (juror_name, juror_inst)
SELECT * FROM (VALUES
  -- international
  ('Emma Thompson',        'University of Oxford / Computer Science'),
  ('Liam O''Connor',       'University of Cambridge / Engineering'),
  ('Sofia Rossi',          'ETH Zürich / Robotics'),
  ('Noah Müller',          'EPFL / Electrical Engineering'),
  ('Isabella García',      'Imperial College London / Aeronautics'),
  ('Lucas Martin',         'UC Berkeley / Electrical Engineering'),
  ('Chloé Dubois',         'Carnegie Mellon University / Machine Learning'),
  ('Oliver Smith',         'Stanford University / AI Lab'),
  ('Ava Johnson',          'Harvard University / Applied Physics'),
  ('Mateo Fernández',      'MIT / Aerospace Engineering'),
  -- Turkish
  ('Elif Yılmaz',          'Hacettepe University / EE'),
  ('Mehmet Kaya',          'Bilkent University / Computer Engineering'),
  ('Ayşe Demir',           'Middle East Technical University / Electrical Engineering'),
  ('Caner Şahin',          'Istanbul Technical University / Aeronautics'),
  ('Zeynep Arslan',        'Boğaziçi University / Computer Engineering'),
  ('Kerem Öztürk',         'Koç University / Robotics'),
  ('Ece Kılıç',            'Sabancı University / Data Science'),
  ('Deniz Aydın',          'Ankara University / Software Engineering')
) AS v(juror_name, juror_inst);

-- ------------------------------------------------------------
-- 3) Projects (10–15 per semester)
--    - group_no sequential from 1
--    - project_title globally unique and creative
--    - group_students uses '; ' delimiter (2–4 students)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sem record;
  v_project_count int;
  v_group_no int;

  v_students text;
  v_student_count int;

  -- name pools (mixed)
  v_first text[];
  v_last  text[];

  -- creative title pools
  v_domain text[];
  v_artifact text[];
  v_method text[];
  v_signature text[];
  v_niche text[];
  v_template int;

  v_title text;
  v_sem_tag text;
  v_used_titles text[] := ARRAY[]::text[];
BEGIN
  v_first := ARRAY[
    -- international
    'Olivia','James','Sophia','Benjamin','Mia','William','Charlotte','Henry','Amelia','Alexander',
    'Isla','Ethan','Grace','Leo','Emily','Jack','Lily','Noah','Chloe','Daniel',
    'Lucia','Marco','Hannah','Felix','Nora','Arthur','Eva','Jonas','Irene','Mateo',
    -- Turkish
    'Ahmet','Mehmet','Ayşe','Fatma','Ali','Elif','Can','Deniz','Zeynep','Kerem',
    'Ece','Mert','Seda','Emre','Selin','Hakan','Buse','Burak','Derya','Onur'
  ];

  v_last := ARRAY[
    -- international
    'Anderson','Brown','Clark','Davis','Evans','Garcia','Harris','Johnson','Lee','Martinez',
    'Miller','Robinson','Smith','Taylor','Walker','White','Young','Wilson','Moore','King',
    'Dubois','Rossi','Müller','Novak','Silva','Kowalski','Lindström','Ibrahim','Khan','Petrov',
    -- Turkish
    'Yılmaz','Kaya','Demir','Şahin','Çelik','Yıldız','Aydın','Arslan','Öztürk','Koç',
    'Polat','Aksoy','Eren','Kurt','Güneş','Şimşek','Taş','Karaca','Özdemir','Yavuz'
  ];

  v_domain := ARRAY[
    'AUV Fleet Operations','Mine Countermeasure Field Trials','Harbor Surveillance','Port Logistics',
    'Smart Campus Energy','Smart Grid Reliability','Wildfire Early Warning','Flood Forecasting',
    'Medical Triage Workflow','Wearable Health Monitoring','Drone Corridor Safety','Autonomous Inspection',
    'Indoor Positioning','Real-Time SLAM','Underwater Localization','Acoustic Telemetry',
    'Satellite Backhaul','HAPS Relay Networking','Industrial Vision QA','Micro-Mobility Safety'
  ];

  v_artifact := ARRAY[
    'Digital Twin','Anomaly Radar','Routing Fabric','Decision Engine','Copilot','Orchestrator',
    'Benchmark Suite','Reliability Layer','Knowledge Graph','Risk Ledger','Service Mesh',
    'Diagnostics Toolkit','Navigation Stack','Optimization Pipeline','Consensus Engine',
    'Edge Gateway','Simulation Workbench','Audit Trail','Model Registry','Incident Console'
  ];

  v_method := ARRAY[
    'Self-Healing','Privacy-Preserving','Fault-Tolerant','Human-Centered','Context-Aware','Bio-Inspired',
    'Federated','Carbon-Aware','Adversarial-Resistant','Multi-Modal','Explainable','Event-Driven',
    'Resource-Frugal','Latency-Sensitive','Uncertainty-Aware','Swarm-Enabled','Zero-Trust',
    'Topology-Adaptive','Spectrum-Aware','Energy-Proportional'
  ];

  v_signature := ARRAY[
    'with Drift Monitoring','under Intermittent Connectivity','for Low-SNR Acoustic Channels',
    'with Human-in-the-Loop Review','with Safety Guarantees','via Lightweight Cryptography',
    'using Self-Supervised Signals','with Fairness Constraints','with On-Device Personalization',
    'with Digital Twin Feedback','with Robustness Audits','using Incremental Updates'
  ];

  v_niche := ARRAY[
    'in Harsh Marine Environments','for Rapid Prototyping','at the Edge','in Resource-Constrained Nodes',
    'for Real-Time Decisions','for Transparent Reporting','for Cross-Team Collaboration',
    'for Long-Term Autonomy','for Secure Data Sharing','for High-Noise Sensors'
  ];

  FOR v_sem IN
    SELECT id, name FROM public.semesters ORDER BY starts_on
  LOOP
    v_project_count := 10 + floor(random() * 6)::int; -- 10..15
    v_group_no := 1;
    v_sem_tag := replace(lower(v_sem.name), ' ', '-');

    WHILE v_group_no <= v_project_count LOOP
      -- students: 2..4 joined by '; '
      v_student_count := 2 + floor(random() * 3)::int;
      v_students := '';
      FOR i IN 1..v_student_count LOOP
        IF i > 1 THEN
          v_students := v_students || '; ';
        END IF;
        v_students := v_students ||
          v_first[1 + floor(random() * array_length(v_first,1))::int] || ' ' ||
          v_last[1 + floor(random() * array_length(v_last,1))::int];
      END LOOP;

      -- title templates to reduce repetition (ensure global uniqueness without suffix)
      LOOP
        v_template := 1 + floor(random() * 4)::int;

        IF v_template = 1 THEN
          v_title :=
            v_domain[1 + floor(random()*array_length(v_domain,1))::int] || ': ' ||
            v_method[1 + floor(random()*array_length(v_method,1))::int] || ' ' ||
            v_artifact[1 + floor(random()*array_length(v_artifact,1))::int] || ' ' ||
            v_signature[1 + floor(random()*array_length(v_signature,1))::int];
        ELSIF v_template = 2 THEN
          v_title :=
            v_method[1 + floor(random()*array_length(v_method,1))::int] || ' ' ||
            v_artifact[1 + floor(random()*array_length(v_artifact,1))::int] || ' for ' ||
            v_domain[1 + floor(random()*array_length(v_domain,1))::int] || ' ' ||
            v_niche[1 + floor(random()*array_length(v_niche,1))::int];
        ELSIF v_template = 3 THEN
          v_title :=
            'From Sensors to Decisions: ' ||
            v_artifact[1 + floor(random()*array_length(v_artifact,1))::int] || ' ' ||
            v_signature[1 + floor(random()*array_length(v_signature,1))::int] || ' in ' ||
            v_domain[1 + floor(random()*array_length(v_domain,1))::int];
        ELSE
          v_title :=
            v_domain[1 + floor(random()*array_length(v_domain,1))::int] || ' — ' ||
            v_artifact[1 + floor(random()*array_length(v_artifact,1))::int] || ' (' ||
            v_method[1 + floor(random()*array_length(v_method,1))::int] || ', ' ||
            v_signature[1 + floor(random()*array_length(v_signature,1))::int] || ')';
        END IF;

        EXIT WHEN NOT (v_title = ANY(v_used_titles));
      END LOOP;

      v_used_titles := array_append(v_used_titles, v_title);

      INSERT INTO public.projects (semester_id, group_no, project_title, group_students)
      VALUES (v_sem.id, v_group_no, v_title, v_students);

      v_group_no := v_group_no + 1;
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) juror_semester_auth
--    - 12–16 jurors per semester
--    - overlap naturally + extra forced overlap set
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sem record;
  v_pick_count int;
  v_pin text;
  v_hash text;
  v_jid uuid;
BEGIN
  -- first pass: random 12..16 per semester
  FOR v_sem IN SELECT id, name FROM public.semesters ORDER BY starts_on LOOP
    v_pick_count := 12 + floor(random() * 5)::int; -- 12..16

    FOR v_jid IN
      SELECT id FROM public.jurors ORDER BY random() LIMIT v_pick_count
    LOOP
      v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
      v_hash := crypt(v_pin, gen_salt('bf'));

      INSERT INTO public.juror_semester_auth
        (juror_id, semester_id, pin_hash, failed_attempts, locked_until, last_seen_at)
      VALUES
        (v_jid, v_sem.id, v_hash, 0, NULL, NULL)
      ON CONFLICT (juror_id, semester_id) DO UPDATE
        SET pin_hash = EXCLUDED.pin_hash,
            failed_attempts = 0,
            locked_until = NULL,
            last_seen_at = NULL;
    END LOOP;
  END LOOP;

  -- second pass: force overlap (same core jurors in all semesters)
  FOR v_jid IN
    SELECT id FROM public.jurors ORDER BY id LIMIT 6
  LOOP
    FOR v_sem IN SELECT id FROM public.semesters LOOP
      v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
      v_hash := crypt(v_pin, gen_salt('bf'));

      INSERT INTO public.juror_semester_auth
        (juror_id, semester_id, pin_hash, failed_attempts, locked_until, last_seen_at)
      VALUES
        (v_jid, v_sem.id, v_hash, 0, NULL, NULL)
      ON CONFLICT (juror_id, semester_id) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5) Scores
--    - every assigned juror scores every project (at least 1 criterion)
--    - avg total mostly 75..90
--    - 4% chance exactly one criterion NULL
--    - optional comments (~25%)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_sem record;
  v_proj record;

  v_juror uuid;

  v_tech int;
  v_writ int;
  v_oral int;
  v_team int;

  v_missing boolean;
  v_missing_pick int;

  v_comment text;
  v_comments text[];
  v_day_offset int;
  v_submit_date date;
  v_submit_hour int;
  v_submit_min int;
  v_submitted_at timestamptz;
BEGIN
  v_comments := ARRAY[
    'Strong implementation; consider expanding the evaluation section.',
    'Excellent presentation and clear methodology.',
    'Promising prototype; scalability discussion would help.',
    'Well-structured report and convincing demo.',
    'Good technical depth; results could be compared to baselines.',
    'Nice idea and clean execution; add more ablation studies.',
    'Clear motivation and solid engineering trade-offs.',
    'Good progress; improve failure-case analysis.'
  ];

  FOR v_sem IN SELECT id, name, starts_on, ends_on FROM public.semesters ORDER BY starts_on LOOP
    FOR v_proj IN
      SELECT id, group_no
      FROM public.projects
      WHERE semester_id = v_sem.id
      ORDER BY group_no
    LOOP
      FOR v_juror IN
        SELECT a.juror_id
        FROM public.juror_semester_auth a
        WHERE a.semester_id = v_sem.id
        ORDER BY a.juror_id
      LOOP
        -- base (keeps totals generally high): 20..30 for 3 criteria, 6..10 teamwork
        v_tech := 20 + floor(random() * 11)::int; -- 20..30
        v_writ := 20 + floor(random() * 11)::int; -- 20..30
        v_oral := 20 + floor(random() * 11)::int; -- 20..30
        v_team :=  6 + floor(random() * 5)::int;  --  6..10

        -- occasional mild penalties to create spread but keep average ~75..90
        IF random() < 0.12 THEN v_tech := GREATEST(0, LEAST(30, v_tech - (1 + floor(random()*7))::int)); END IF;
        IF random() < 0.12 THEN v_writ := GREATEST(0, LEAST(30, v_writ - (1 + floor(random()*7))::int)); END IF;
        IF random() < 0.12 THEN v_oral := GREATEST(0, LEAST(30, v_oral - (1 + floor(random()*7))::int)); END IF;
        IF random() < 0.12 THEN v_team := GREATEST(0, LEAST(10, v_team - (1 + floor(random()*4))::int)); END IF;

        -- missing data rule: 4% probability -> exactly one criterion NULL
        v_missing := (random() < 0.04);
        IF v_missing THEN
          v_missing_pick := 1 + floor(random() * 4)::int; -- 1..4
          IF v_missing_pick = 1 THEN
            v_tech := NULL;
          ELSIF v_missing_pick = 2 THEN
            v_writ := NULL;
          ELSIF v_missing_pick = 3 THEN
            v_oral := NULL;
          ELSE
            v_team := NULL;
          END IF;
        END IF;

        -- submitted_at: pick a date within the semester, time between 13:00-16:00
        IF NOT v_missing THEN
          v_day_offset := floor(
            random() * (GREATEST(0, (v_sem.ends_on - v_sem.starts_on)) + 1)
          )::int;
          v_submit_date := v_sem.starts_on + v_day_offset;
          v_submit_hour := 13 + floor(random() * 4)::int; -- 13..16
          v_submit_min := floor(random() * 60)::int;
          IF v_submit_hour = 16 THEN
            v_submit_min := 0;
          END IF;
          v_submitted_at := (v_submit_date::timestamptz)
            + make_interval(hours => v_submit_hour, mins => v_submit_min);
        END IF;

        -- optional comment (~25%)
        IF random() < 0.25 THEN
          v_comment := v_comments[1 + floor(random()*array_length(v_comments,1))::int];
        ELSE
          v_comment := NULL;
        END IF;

        INSERT INTO public.scores
          (semester_id, project_id, juror_id, technical, written, oral, teamwork, comment)
        VALUES
          (v_sem.id, v_proj.id, v_juror, v_tech, v_writ, v_oral, v_team, v_comment)
        ON CONFLICT (semester_id, project_id, juror_id) DO UPDATE
          SET technical = EXCLUDED.technical,
              written   = EXCLUDED.written,
              oral      = EXCLUDED.oral,
              teamwork  = EXCLUDED.teamwork,
              comment   = EXCLUDED.comment;
        -- triggers compute total + submitted_at

        IF NOT v_missing THEN
          UPDATE public.scores
          SET submitted_at = v_submitted_at
          WHERE semester_id = v_sem.id
            AND project_id = v_proj.id
            AND juror_id = v_juror;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
