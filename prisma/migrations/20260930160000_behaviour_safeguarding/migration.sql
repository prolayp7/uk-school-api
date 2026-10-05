CREATE TABLE behaviour_rewards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  seed_key varchar(80),
  category varchar(24) NOT NULL,
  title varchar(120) NOT NULL,
  details varchar(240) NOT NULL,
  points integer NOT NULL DEFAULT 1,
  parent_visible boolean NOT NULL DEFAULT true,
  occurred_at timestamptz(6) NOT NULL,
  CONSTRAINT behaviour_rewards_pkey PRIMARY KEY (id),
  CONSTRAINT behaviour_rewards_school_id_key UNIQUE (school_id, id),
  CONSTRAINT behaviour_rewards_school_seed_key UNIQUE (school_id, seed_key),
  CONSTRAINT behaviour_rewards_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT behaviour_rewards_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX behaviour_rewards_school_pupil_time_idx ON behaviour_rewards (school_id, pupil_id, occurred_at DESC);

INSERT INTO behaviour_rewards (id, school_id, pupil_id, seed_key, category, title, details, points, parent_visible, occurred_at)
SELECT id, school_id, pupil_id, seed_key, category, title, details, GREATEST(points, 1), parent_visible, occurred_at
FROM behaviour_incidents
WHERE category IN ('positive', 'achievement', 'reward');
DELETE FROM behaviour_incidents WHERE category IN ('positive', 'achievement', 'reward');

ALTER TABLE behaviour_incidents
  ADD CONSTRAINT behaviour_incidents_school_id_key UNIQUE (school_id, id);

CREATE TABLE behaviour_sanctions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  sanction_type varchar(32) NOT NULL,
  details varchar(500),
  status varchar(16) NOT NULL DEFAULT 'assigned',
  parent_visible boolean NOT NULL DEFAULT false,
  due_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT behaviour_sanctions_pkey PRIMARY KEY (id),
  CONSTRAINT behaviour_sanctions_school_id_key UNIQUE (school_id, id),
  CONSTRAINT behaviour_sanctions_status_check CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT behaviour_sanctions_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT behaviour_sanctions_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT behaviour_sanctions_school_id_incident_id_fkey FOREIGN KEY (school_id, incident_id) REFERENCES behaviour_incidents(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX behaviour_sanctions_school_pupil_time_idx ON behaviour_sanctions (school_id, pupil_id, created_at DESC);

CREATE TABLE detentions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  sanction_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  scheduled_at timestamptz(6) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'scheduled',
  note varchar(500),
  CONSTRAINT detentions_pkey PRIMARY KEY (id),
  CONSTRAINT detentions_sanction_key UNIQUE (sanction_id),
  CONSTRAINT detentions_school_id_key UNIQUE (school_id, id),
  CONSTRAINT detentions_school_sanction_key UNIQUE (school_id, sanction_id),
  CONSTRAINT detentions_status_check CHECK (status IN ('scheduled', 'served', 'missed', 'cancelled')),
  CONSTRAINT detentions_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT detentions_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT detentions_school_id_sanction_id_fkey FOREIGN KEY (school_id, sanction_id) REFERENCES behaviour_sanctions(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX detentions_school_pupil_schedule_idx ON detentions (school_id, pupil_id, scheduled_at);

CREATE TABLE safeguarding_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  opened_at timestamptz(6) NOT NULL DEFAULT now(),
  closed_at timestamptz(6),
  CONSTRAINT safeguarding_cases_pkey PRIMARY KEY (id),
  CONSTRAINT safeguarding_cases_school_id_key UNIQUE (school_id, id),
  CONSTRAINT safeguarding_cases_status_check CHECK (status IN ('open', 'under_review', 'closed')),
  CONSTRAINT safeguarding_cases_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_cases_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX safeguarding_cases_school_pupil_time_idx ON safeguarding_cases (school_id, pupil_id, opened_at DESC);

CREATE TABLE safeguarding_concerns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  case_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  category varchar(32) NOT NULL,
  details text NOT NULL,
  occurred_at timestamptz(6),
  reported_by_user_id uuid NOT NULL,
  reported_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT safeguarding_concerns_pkey PRIMARY KEY (id),
  CONSTRAINT safeguarding_concerns_school_id_key UNIQUE (school_id, id),
  CONSTRAINT safeguarding_concerns_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_concerns_school_id_case_id_fkey FOREIGN KEY (school_id, case_id) REFERENCES safeguarding_cases(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_concerns_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_concerns_reported_by_user_id_fkey FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX safeguarding_concerns_case_time_idx ON safeguarding_concerns (school_id, case_id, reported_at DESC);

CREATE TABLE safeguarding_case_access (
  school_id uuid NOT NULL,
  case_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by_user_id uuid NOT NULL,
  granted_at timestamptz(6) NOT NULL DEFAULT now(),
  revoked_at timestamptz(6),
  reason varchar(240) NOT NULL,
  CONSTRAINT safeguarding_case_access_pkey PRIMARY KEY (school_id, case_id, user_id),
  CONSTRAINT safeguarding_case_access_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_case_access_school_id_case_id_fkey FOREIGN KEY (school_id, case_id) REFERENCES safeguarding_cases(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_case_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_case_access_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX safeguarding_case_access_user_idx ON safeguarding_case_access (school_id, user_id, revoked_at);

CREATE TABLE safeguarding_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  case_id uuid NOT NULL,
  action_type varchar(32) NOT NULL,
  details text NOT NULL,
  due_at timestamptz(6),
  completed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT safeguarding_actions_pkey PRIMARY KEY (id),
  CONSTRAINT safeguarding_actions_school_id_key UNIQUE (school_id, id),
  CONSTRAINT safeguarding_actions_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_actions_school_id_case_id_fkey FOREIGN KEY (school_id, case_id) REFERENCES safeguarding_cases(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX safeguarding_actions_case_time_idx ON safeguarding_actions (school_id, case_id, created_at);

CREATE TABLE safeguarding_meetings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  case_id uuid NOT NULL,
  meeting_type varchar(32) NOT NULL,
  scheduled_at timestamptz(6) NOT NULL,
  details text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT safeguarding_meetings_pkey PRIMARY KEY (id),
  CONSTRAINT safeguarding_meetings_school_id_key UNIQUE (school_id, id),
  CONSTRAINT safeguarding_meetings_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT safeguarding_meetings_school_id_case_id_fkey FOREIGN KEY (school_id, case_id) REFERENCES safeguarding_cases(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX safeguarding_meetings_case_schedule_idx ON safeguarding_meetings (school_id, case_id, scheduled_at);
