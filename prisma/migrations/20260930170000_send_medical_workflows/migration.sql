ALTER TABLE pupil_medical_conditions
  ADD COLUMN starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN ends_on date,
  ADD COLUMN parent_visible boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT pupil_medical_conditions_effective_dates_check
    CHECK (ends_on IS NULL OR ends_on >= starts_on);

CREATE TABLE support_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  summary text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  parent_visible boolean NOT NULL DEFAULT false,
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT support_plans_pkey PRIMARY KEY (id),
  CONSTRAINT support_plans_school_id_key UNIQUE (school_id, id),
  CONSTRAINT support_plans_status_check CHECK (status IN ('active', 'review', 'closed')),
  CONSTRAINT support_plans_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT support_plans_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT support_plans_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX support_plans_pupil_status_idx ON support_plans (school_id, pupil_id, status, starts_on);

CREATE TABLE send_targets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  support_plan_id uuid NOT NULL,
  title varchar(160) NOT NULL,
  description text NOT NULL,
  success_criteria varchar(500) NOT NULL,
  starts_on date NOT NULL,
  review_due date,
  status varchar(16) NOT NULL DEFAULT 'active',
  parent_visible boolean NOT NULL DEFAULT false,
  CONSTRAINT send_targets_pkey PRIMARY KEY (id),
  CONSTRAINT send_targets_school_id_key UNIQUE (school_id, id),
  CONSTRAINT send_targets_status_check CHECK (status IN ('active', 'achieved', 'on_track', 'partially_met', 'not_met', 'closed')),
  CONSTRAINT send_targets_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT send_targets_school_id_support_plan_id_fkey FOREIGN KEY (school_id, support_plan_id) REFERENCES support_plans(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX send_targets_plan_status_idx ON send_targets (school_id, support_plan_id, status);

CREATE TABLE send_target_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  target_id uuid NOT NULL,
  outcome varchar(24) NOT NULL,
  note text NOT NULL,
  reviewed_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT send_target_reviews_pkey PRIMARY KEY (id),
  CONSTRAINT send_target_reviews_school_id_key UNIQUE (school_id, id),
  CONSTRAINT send_target_reviews_outcome_check CHECK (outcome IN ('achieved', 'on_track', 'partially_met', 'not_met')),
  CONSTRAINT send_target_reviews_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT send_target_reviews_school_id_target_id_fkey FOREIGN KEY (school_id, target_id) REFERENCES send_targets(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX send_target_reviews_target_time_idx ON send_target_reviews (school_id, target_id, reviewed_at DESC);

CREATE TABLE send_interventions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  support_plan_id uuid,
  intervention_type varchar(40) NOT NULL,
  description text NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  outcome text,
  CONSTRAINT send_interventions_pkey PRIMARY KEY (id),
  CONSTRAINT send_interventions_school_id_key UNIQUE (school_id, id),
  CONSTRAINT send_interventions_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT send_interventions_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT send_interventions_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT send_interventions_school_id_support_plan_id_fkey FOREIGN KEY (school_id, support_plan_id) REFERENCES support_plans(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX send_interventions_pupil_idx ON send_interventions (school_id, pupil_id, starts_on);

CREATE TABLE provision_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  support_plan_id uuid,
  provision_type varchar(40) NOT NULL,
  description text NOT NULL,
  frequency varchar(80) NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  CONSTRAINT provision_records_pkey PRIMARY KEY (id),
  CONSTRAINT provision_records_school_id_key UNIQUE (school_id, id),
  CONSTRAINT provision_records_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT provision_records_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT provision_records_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT provision_records_school_id_support_plan_id_fkey FOREIGN KEY (school_id, support_plan_id) REFERENCES support_plans(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX provision_records_pupil_idx ON provision_records (school_id, pupil_id, starts_on);

CREATE TABLE medications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  code varchar(32) NOT NULL,
  name varchar(120) NOT NULL,
  strength varchar(80),
  form varchar(40),
  CONSTRAINT medications_pkey PRIMARY KEY (id),
  CONSTRAINT medications_school_id_key UNIQUE (school_id, id),
  CONSTRAINT medications_school_code_key UNIQUE (school_id, code),
  CONSTRAINT medications_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE medication_authorizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  medication_id uuid NOT NULL,
  guardian_person_id uuid,
  authorized_by_user_id uuid NOT NULL,
  dosage_instructions varchar(500) NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT medication_authorizations_pkey PRIMARY KEY (id),
  CONSTRAINT medication_authorizations_school_id_key UNIQUE (school_id, id),
  CONSTRAINT medication_authorizations_status_check CHECK (status IN ('active', 'suspended', 'expired')),
  CONSTRAINT medication_authorizations_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT medication_authorizations_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_authorizations_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_authorizations_school_id_medication_id_fkey FOREIGN KEY (school_id, medication_id) REFERENCES medications(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_authorizations_school_id_guardian_person_id_fkey FOREIGN KEY (school_id, guardian_person_id) REFERENCES parent_carer_profiles(school_id, person_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_authorizations_authorized_by_user_id_fkey FOREIGN KEY (authorized_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX medication_authorizations_pupil_status_idx ON medication_authorizations (school_id, pupil_id, status, starts_on);

CREATE TABLE medication_administrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  authorization_id uuid NOT NULL,
  administered_by_user_id uuid NOT NULL,
  administered_at timestamptz(6) NOT NULL,
  dose_given varchar(120) NOT NULL,
  status varchar(20) NOT NULL,
  note varchar(1000),
  correction_of_id uuid,
  correction_reason varchar(500),
  recorded_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT medication_administrations_pkey PRIMARY KEY (id),
  CONSTRAINT medication_administrations_school_id_key UNIQUE (school_id, id),
  CONSTRAINT medication_administrations_status_check CHECK (status IN ('administered', 'refused', 'not_available')),
  CONSTRAINT medication_administrations_correction_check CHECK ((correction_of_id IS NULL AND correction_reason IS NULL) OR (correction_of_id IS NOT NULL AND correction_reason IS NOT NULL)),
  CONSTRAINT medication_administrations_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_administrations_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_administrations_school_id_authorization_id_fkey FOREIGN KEY (school_id, authorization_id) REFERENCES medication_authorizations(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_administrations_school_id_correction_of_id_fkey FOREIGN KEY (school_id, correction_of_id) REFERENCES medication_administrations(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medication_administrations_administered_by_user_id_fkey FOREIGN KEY (administered_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX medication_administrations_pupil_time_idx ON medication_administrations (school_id, pupil_id, administered_at DESC);

CREATE OR REPLACE FUNCTION prevent_medication_administration_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Medication administration records are append-only; create a correction record instead.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER medication_administrations_append_only
  BEFORE UPDATE OR DELETE ON medication_administrations
  FOR EACH ROW EXECUTE FUNCTION prevent_medication_administration_mutation();

CREATE TABLE healthcare_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  instructions text NOT NULL,
  emergency_actions text NOT NULL,
  starts_on date NOT NULL,
  review_due date,
  status varchar(16) NOT NULL DEFAULT 'active',
  CONSTRAINT healthcare_plans_pkey PRIMARY KEY (id),
  CONSTRAINT healthcare_plans_school_id_key UNIQUE (school_id, id),
  CONSTRAINT healthcare_plans_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT healthcare_plans_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT healthcare_plans_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX healthcare_plans_pupil_status_idx ON healthcare_plans (school_id, pupil_id, status);

CREATE TABLE medical_incidents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  pupil_id uuid NOT NULL,
  incident_type varchar(32) NOT NULL,
  details text NOT NULL,
  action_taken text NOT NULL,
  follow_up_required boolean NOT NULL DEFAULT false,
  occurred_at timestamptz(6) NOT NULL,
  reported_by_user_id uuid NOT NULL,
  reported_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT medical_incidents_pkey PRIMARY KEY (id),
  CONSTRAINT medical_incidents_school_id_key UNIQUE (school_id, id),
  CONSTRAINT medical_incidents_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medical_incidents_school_id_pupil_id_fkey FOREIGN KEY (school_id, pupil_id) REFERENCES pupil_profiles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT medical_incidents_reported_by_user_id_fkey FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX medical_incidents_pupil_time_idx ON medical_incidents (school_id, pupil_id, occurred_at DESC);
