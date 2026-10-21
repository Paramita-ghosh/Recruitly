-- Recruitly schema. All timestamps are timestamptz (stored as UTC instants).
-- Drive-local wall-clock times are converted using recruitment_drives.timezone.

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Identity ─────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('candidate','interviewer','coordinator','company')),
  password_hash text,
  google_id     text UNIQUE,
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));

CREATE TABLE user_profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone      text,
  avatar_url text,
  bio        text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'company' CHECK (kind IN ('company','college')),
  description text,
  website     text,
  industry    text,
  location    text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_companies_name ON companies (lower(name));

CREATE TABLE company_memberships (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title      text
);
CREATE INDEX ix_company_memberships_company ON company_memberships (company_id);

CREATE TABLE candidate_profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reg_no     text UNIQUE,
  department text,
  branch     text,
  grad_year  int CHECK (grad_year BETWEEN 2000 AND 2100),
  cgpa       numeric(4,2) CHECK (cgpa BETWEEN 0 AND 10)
);

CREATE TABLE skills (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE interviewer_profiles (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  company_id        uuid REFERENCES companies(id) ON DELETE SET NULL,
  title             text,
  daily_capacity    int NOT NULL DEFAULT 6 CHECK (daily_capacity BETWEEN 1 AND 30),
  min_break_minutes int NOT NULL DEFAULT 0 CHECK (min_break_minutes BETWEEN 0 AND 120),
  modes             text NOT NULL DEFAULT 'both_prefer_offline'
                    CHECK (modes IN ('offline_only','online_only','both_prefer_offline','both_prefer_online'))
);

CREATE TABLE interviewer_skills (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id int  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose    text NOT NULL DEFAULT 'reset' CHECK (purpose IN ('reset','invite')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Drives ─────────────
CREATE TABLE recruitment_drives (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  description              text,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','collecting_availability','ready_to_schedule','schedule_generated','published','in_progress','completed','cancelled')),
  approval_status          text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','rejected')),
  timezone                 text NOT NULL DEFAULT 'Asia/Kolkata',
  start_date               date NOT NULL,
  end_date                 date NOT NULL,
  day_start                time NOT NULL DEFAULT '09:00',
  day_end                  time NOT NULL DEFAULT '17:00',
  slot_minutes             int  NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 120),
  default_duration_minutes int  NOT NULL DEFAULT 30 CHECK (default_duration_minutes BETWEEN 5 AND 240),
  buffer_minutes           int  NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  mode_policy              text NOT NULL DEFAULT 'any' CHECK (mode_policy IN ('any','offline_only','online_only')),
  self_booking_enabled     boolean NOT NULL DEFAULT true,
  booking_deadline         timestamptz,
  reschedule_deadline      timestamptz,
  eligibility              jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_demo                  boolean NOT NULL DEFAULT false,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (day_end > day_start)
);
CREATE INDEX ix_drives_company ON recruitment_drives (company_id);

CREATE TABLE interview_rounds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id              uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  position              int  NOT NULL CHECK (position >= 1),
  name                  text NOT NULL,
  duration_minutes      int  NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240),
  panel_size            int  NOT NULL DEFAULT 1 CHECK (panel_size BETWEEN 1 AND 5),
  allowed_modes         text[] NOT NULL DEFAULT ARRAY['offline','online'],
  min_room_capacity     int  CHECK (min_room_capacity >= 1),
  required_equipment    text[] NOT NULL DEFAULT ARRAY[]::text[],
  pass_threshold        numeric(5,2) NOT NULL DEFAULT 60 CHECK (pass_threshold BETWEEN 0 AND 100),
  requires_review       boolean NOT NULL DEFAULT false,
  booking_policy        text NOT NULL DEFAULT 'self_book' CHECK (booking_policy IN ('auto','self_book')),
  prerequisite_round_id uuid REFERENCES interview_rounds(id) ON DELETE SET NULL,
  UNIQUE (drive_id, position),
  CHECK (allowed_modes <@ ARRAY['offline','online']::text[] AND cardinality(allowed_modes) >= 1)
);

CREATE TABLE round_required_skills (
  round_id uuid NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  skill_id int  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (round_id, skill_id)
);

CREATE TABLE round_panel_requirements (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id  uuid NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  skill_id  int  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  min_count int  NOT NULL DEFAULT 1 CHECK (min_count >= 1),
  UNIQUE (round_id, skill_id)
);

CREATE TABLE drive_candidates (
  drive_id          uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  candidate_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_status   text NOT NULL DEFAULT 'eligible' CHECK (pipeline_status IN
    ('eligible','awaiting_booking','scheduled','in_progress','evaluation_pending','passed','failed','needs_rebooking','completed')),
  current_round_id  uuid REFERENCES interview_rounds(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (drive_id, candidate_id)
);
CREATE INDEX ix_drive_candidates_candidate ON drive_candidates (candidate_id);

CREATE TABLE drive_interviewers (
  drive_id       uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (drive_id, interviewer_id)
);
CREATE INDEX ix_drive_interviewers_interviewer ON drive_interviewers (interviewer_id);

-- ───────────── Availability ─────────────
-- Recurring weekly windows in the drive's local wall-clock time. weekday: 0=Sunday..6=Saturday.
CREATE TABLE availability_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday    int  NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time   time NOT NULL,
  kind       text NOT NULL DEFAULT 'available' CHECK (kind IN ('available','preferred')),
  CHECK (end_time > start_time)
);
CREATE INDEX ix_avail_rules_user ON availability_rules (user_id);

-- Date specific overrides. NULL start/end means the whole day.
CREATE TABLE availability_exceptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       date NOT NULL,
  start_time time,
  end_time   time,
  kind       text NOT NULL CHECK (kind IN ('available','unavailable')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time))
);
CREATE INDEX ix_avail_exc_user_date ON availability_exceptions (user_id, date);

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id   uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  name       text NOT NULL,
  location   text,
  capacity   int  NOT NULL DEFAULT 4 CHECK (capacity >= 1),
  equipment  text[] NOT NULL DEFAULT ARRAY[]::text[],
  accessible boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (drive_id, name)
);

-- Windows during which a room is NOT usable (lunch, maintenance, other event)
CREATE TABLE room_availability (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at   timestamptz NOT NULL,
  reason    text,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ix_room_blocks_room ON room_availability (room_id);

-- ───────────── Interviews ─────────────
CREATE TABLE interview_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id         uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  round_id         uuid NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  candidate_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  during           tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  mode             text NOT NULL CHECK (mode IN ('online','offline')),
  room_id          uuid REFERENCES rooms(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'scheduled' CHECK (status IN
    ('scheduled','in_progress','completed','cancelled','needs_rebooking','no_show')),
  published        boolean NOT NULL DEFAULT false,
  confirmed_at     timestamptz,
  source           text NOT NULL DEFAULT 'solver' CHECK (source IN ('solver','booking','override','reschedule','manual')),
  result_status    text NOT NULL DEFAULT 'pending' CHECK (result_status IN
    ('pending','provisional_pass','provisional_fail','passed','failed')),
  final_score      numeric(5,2),
  result_published boolean NOT NULL DEFAULT false,
  finalized_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  finalized_at     timestamptz,
  result_note      text,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (status IN ('cancelled','needs_rebooking')
         OR (mode = 'offline' AND room_id IS NOT NULL)
         OR (mode = 'online'  AND room_id IS NULL)),
  -- A candidate can never attend two overlapping interviews.
  CONSTRAINT ex_session_candidate EXCLUDE USING gist (candidate_id WITH =, during WITH &&)
    WHERE (status IN ('scheduled','in_progress','completed','no_show')) DEFERRABLE INITIALLY IMMEDIATE,
  -- A room can never host two overlapping interviews.
  CONSTRAINT ex_session_room EXCLUDE USING gist (room_id WITH =, during WITH &&)
    WHERE (room_id IS NOT NULL AND status IN ('scheduled','in_progress','completed','no_show')) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX ux_session_candidate_round ON interview_sessions (candidate_id, round_id)
  WHERE status IN ('scheduled','in_progress','completed','no_show','needs_rebooking');
CREATE INDEX ix_sessions_drive ON interview_sessions (drive_id, round_id);
CREATE INDEX ix_sessions_start ON interview_sessions (starts_at);

CREATE TABLE interview_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  during         tstzrange NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, interviewer_id),
  -- An interviewer can never conduct two overlapping interviews.
  CONSTRAINT ex_assignment_interviewer EXCLUDE USING gist (interviewer_id WITH =, during WITH &&)
    WHERE (active) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX ix_assignments_interviewer ON interview_assignments (interviewer_id);

-- Keep assignment windows/active flag in lock-step with their session.
CREATE OR REPLACE FUNCTION sync_assignments_from_session() RETURNS trigger AS $$
BEGIN
  UPDATE interview_assignments
     SET during = NEW.during,
         active = (NEW.status IN ('scheduled','in_progress','completed','no_show'))
   WHERE session_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_assignments
AFTER UPDATE OF starts_at, ends_at, status ON interview_sessions
FOR EACH ROW EXECUTE FUNCTION sync_assignments_from_session();

CREATE TABLE booking_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  candidate_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_id     uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  round_id     uuid NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_booking_tokens_active ON booking_tokens (candidate_id, drive_id, round_id) WHERE revoked_at IS NULL;

-- ───────────── Evaluations ─────────────
CREATE TABLE evaluation_rubrics (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id  uuid NOT NULL UNIQUE REFERENCES interview_rounds(id) ON DELETE CASCADE,
  name      text NOT NULL,
  scale_min int NOT NULL DEFAULT 1,
  scale_max int NOT NULL DEFAULT 5,
  CHECK (scale_max > scale_min)
);

CREATE TABLE rubric_criteria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id   uuid NOT NULL REFERENCES evaluation_rubrics(id) ON DELETE CASCADE,
  position    int  NOT NULL DEFAULT 1,
  name        text NOT NULL,
  description text,
  weight      numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100)
);
CREATE INDEX ix_rubric_criteria_rubric ON rubric_criteria (rubric_id);

-- Rubric weights must total exactly 100 once the transaction commits.
CREATE OR REPLACE FUNCTION check_rubric_weights() RETURNS trigger AS $$
DECLARE rid uuid; total numeric; n int;
BEGIN
  rid := COALESCE(NEW.rubric_id, OLD.rubric_id);
  IF NOT EXISTS (SELECT 1 FROM evaluation_rubrics WHERE id = rid) THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(weight),0), COUNT(*) INTO total, n FROM rubric_criteria WHERE rubric_id = rid;
  IF n > 0 AND total <> 100 THEN
    RAISE EXCEPTION 'Rubric weights must total 100 (currently %)', total USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_rubric_weights
AFTER INSERT OR UPDATE OR DELETE ON rubric_criteria
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_rubric_weights();

CREATE TABLE evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comments       text,
  recommendation text CHECK (recommendation IN ('strong_yes','yes','no','strong_no')),
  weighted_score numeric(5,2),
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revision       int NOT NULL DEFAULT 1,
  UNIQUE (session_id, interviewer_id)
);

CREATE TABLE evaluation_scores (
  evaluation_id uuid NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  criterion_id  uuid NOT NULL REFERENCES rubric_criteria(id) ON DELETE CASCADE,
  score         numeric(4,2) NOT NULL CHECK (score >= 0),
  comment       text,
  PRIMARY KEY (evaluation_id, criterion_id)
);

-- ───────────── Notifications, email, calendar, audit ─────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   text NOT NULL,
  title      text NOT NULL,
  body       text,
  action_link text,
  dedupe_key text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE email_outbox (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email    text NOT NULL,
  subject     text NOT NULL,
  html        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','logged_only')),
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  dedupe_key  text UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX ix_outbox_status ON email_outbox (status, created_at);

CREATE TABLE calendar_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'google',
  account_email     text,
  refresh_token_enc text,
  access_token_enc  text,
  expiry_at         timestamptz,
  status            text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calendar_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('google','mock')),
  external_event_id text,
  meeting_url       text,
  conference_status text NOT NULL DEFAULT 'not_requested' CHECK (conference_status IN
    ('not_requested','pending','created','failed','mock')),
  sync_status       text NOT NULL DEFAULT 'pending' CHECK (sync_status IN
    ('pending','synced','failed','cancelled','mock','not_configured')),
  last_error        text,
  attempts          int NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, provider)
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_created ON audit_logs (created_at DESC);

-- ───────────── Scheduling runs ─────────────
CREATE TABLE schedule_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id     uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  round_id     uuid NOT NULL REFERENCES interview_rounds(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('complete','partial','infeasible','budget_exhausted')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  stats        jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality      jsonb,
  unscheduled  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_schedule_runs_drive ON schedule_runs (drive_id, created_at DESC);

CREATE TABLE reschedule_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id       uuid NOT NULL REFERENCES recruitment_drives(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start   timestamptz NOT NULL,
  window_end     timestamptz NOT NULL,
  reason         text,
  status         text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','approved','discarded','failed')),
  valid          boolean NOT NULL DEFAULT true,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  approved_at    timestamptz
);

CREATE TABLE reschedule_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES reschedule_runs(id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  change_type         text NOT NULL,
  before_state        jsonb NOT NULL,
  after_state         jsonb,
  reason              text,
  candidate_moved     boolean NOT NULL DEFAULT false,
  interviewer_changed boolean NOT NULL DEFAULT false,
  mode_changed        boolean NOT NULL DEFAULT false,
  room_changed        boolean NOT NULL DEFAULT false,
  needs_manual        boolean NOT NULL DEFAULT false,
  calendar_status     text NOT NULL DEFAULT 'not_applied',
  notification_status text NOT NULL DEFAULT 'not_applied',
  cost                numeric(8,2) NOT NULL DEFAULT 0
);
CREATE INDEX ix_reschedule_changes_run ON reschedule_changes (run_id);

INSERT INTO skills (name) VALUES
  ('DSA'),('Coding'),('Web Development'),('Machine Learning'),('System Design'),
  ('Backend'),('Frontend'),('HR'),('Behavioral'),('Database Systems');
