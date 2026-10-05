ALTER TABLE pupil_contacts
  ADD COLUMN starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN ends_on date,
  ADD CONSTRAINT pupil_contacts_effective_dates_check
    CHECK (ends_on IS NULL OR ends_on >= starts_on);

DROP INDEX attendance_sessions_school_date_type_key;

ALTER TABLE attendance_sessions
  ADD COLUMN session_key varchar(100) NOT NULL DEFAULT 'registration',
  ADD COLUMN class_group_id uuid,
  ADD COLUMN lesson_period varchar(32),
  ADD CONSTRAINT attendance_sessions_lesson_details_check
    CHECK (
      (session_type = 'lesson' AND class_group_id IS NOT NULL AND lesson_period IS NOT NULL)
      OR (session_type IN ('morning', 'afternoon') AND class_group_id IS NULL AND lesson_period IS NULL)
    ),
  ADD CONSTRAINT attendance_sessions_school_date_type_key
    UNIQUE (school_id, session_date, session_type, session_key),
  ADD CONSTRAINT attendance_sessions_class_group_fkey
    FOREIGN KEY (school_id, class_group_id) REFERENCES class_groups(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE attendance_sessions
  ADD CONSTRAINT attendance_sessions_type_check
  CHECK (session_type IN ('morning', 'afternoon', 'lesson'));

ALTER TABLE attendance_records
  ADD COLUMN reason varchar(200),
  ADD COLUMN note varchar(1000),
  ADD COLUMN authorization_status varchar(16) NOT NULL DEFAULT 'not_required',
  ADD COLUMN marked_by_user_id uuid,
  ADD CONSTRAINT attendance_records_authorization_status_check
    CHECK (authorization_status IN ('not_required', 'pending', 'authorized', 'unauthorized')),
  ADD CONSTRAINT attendance_records_marked_by_user_fkey
    FOREIGN KEY (marked_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE attendance_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  attendance_record_id uuid NOT NULL,
  author_user_id uuid,
  body varchar(1000) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT attendance_notes_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_notes_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_notes_record_fkey FOREIGN KEY (school_id, attendance_record_id) REFERENCES attendance_records(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_notes_author_fkey FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX attendance_notes_record_idx ON attendance_notes (school_id, attendance_record_id, created_at);

CREATE TABLE attendance_record_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  attendance_record_id uuid NOT NULL,
  attendance_code varchar(4) NOT NULL,
  reason varchar(200),
  note varchar(1000),
  authorization_status varchar(16) NOT NULL,
  changed_by_user_id uuid,
  changed_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT attendance_record_revisions_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_record_revisions_authorization_status_check CHECK (authorization_status IN ('not_required', 'pending', 'authorized', 'unauthorized')),
  CONSTRAINT attendance_record_revisions_school_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_record_revisions_record_fkey FOREIGN KEY (school_id, attendance_record_id) REFERENCES attendance_records(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_record_revisions_code_fkey FOREIGN KEY (school_id, attendance_code) REFERENCES attendance_codes(school_id, code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_record_revisions_actor_fkey FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX attendance_revisions_record_idx ON attendance_record_revisions (school_id, attendance_record_id, changed_at DESC);

CREATE TABLE attendance_interventions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  reason varchar(240) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open',
  review_note varchar(1000),
  created_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT attendance_interventions_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_interventions_school_id_key UNIQUE (school_id, id),
  CONSTRAINT attendance_interventions_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT attendance_interventions_status_check CHECK (status IN ('open', 'monitoring', 'closed')),
  CONSTRAINT attendance_interventions_school_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_interventions_pupil_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT attendance_interventions_actor_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX attendance_interventions_pupil_idx ON attendance_interventions (school_id, pupil_id, starts_on);

CREATE TABLE outbox_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  event_type varchar(120) NOT NULL,
  aggregate_type varchar(80) NOT NULL,
  aggregate_id uuid NOT NULL,
  idempotency_key varchar(180) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  processed_at timestamptz(6),
  attempts integer NOT NULL DEFAULT 0,
  CONSTRAINT outbox_events_pkey PRIMARY KEY (id),
  CONSTRAINT outbox_events_school_idempotency_key UNIQUE (school_id, idempotency_key),
  CONSTRAINT outbox_events_school_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX outbox_events_pending_idx ON outbox_events (processed_at, occurred_at);
