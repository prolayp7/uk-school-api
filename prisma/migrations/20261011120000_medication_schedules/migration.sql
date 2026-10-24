CREATE TABLE medication_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  dose_instructions varchar(120) NOT NULL,
  scheduled_time varchar(5) NOT NULL,
  days_of_week integer[] NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT medication_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT medication_schedules_school_id_key UNIQUE (school_id, id),
  CONSTRAINT medication_schedules_status_check CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT medication_schedules_time_check CHECK (scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT medication_schedules_days_check CHECK (
    cardinality(days_of_week) BETWEEN 1 AND 7
    AND days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
  ),
  CONSTRAINT medication_schedules_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT medication_schedules_school_id_fkey
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_schedules_school_id_pupil_id_fkey
    FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_schedules_school_id_authorization_id_fkey
    FOREIGN KEY (school_id, authorization_id) REFERENCES medication_authorizations(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX medication_schedules_pupil_status_idx
  ON medication_schedules (school_id, pupil_id, status, starts_on);

ALTER TABLE medication_administrations
  ADD COLUMN schedule_id uuid,
  ADD CONSTRAINT medication_administrations_school_id_schedule_id_fkey
    FOREIGN KEY (school_id, schedule_id) REFERENCES medication_schedules(school_id, id)
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX medication_administrations_schedule_time_idx
  ON medication_administrations (school_id, schedule_id, administered_at DESC);
