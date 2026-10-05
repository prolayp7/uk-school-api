CREATE TABLE schools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL,
  name varchar(200) NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Europe/London',
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT schools_pkey PRIMARY KEY (id),
  CONSTRAINT schools_code_key UNIQUE (code),
  CONSTRAINT schools_status_check CHECK (status IN ('active', 'suspended'))
);

CREATE TABLE users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email_normalized varchar(320) NOT NULL,
  password_hash varchar(255) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_email_normalized_key UNIQUE (email_normalized),
  CONSTRAINT users_email_normalized_lowercase_check CHECK (email_normalized = lower(email_normalized)),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'locked', 'disabled'))
);
CREATE INDEX users_status_idx ON users (status);

CREATE TABLE school_memberships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'invited',
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT school_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT school_memberships_school_user_key UNIQUE (school_id, user_id),
  CONSTRAINT school_memberships_school_id_key UNIQUE (school_id, id),
  CONSTRAINT school_memberships_status_check CHECK (status IN ('invited', 'active', 'suspended', 'ended')),
  CONSTRAINT school_memberships_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT school_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX school_memberships_user_status_idx ON school_memberships (user_id, status);

CREATE TABLE roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT roles_pkey PRIMARY KEY (id),
  CONSTRAINT roles_school_code_key UNIQUE (school_id, code),
  CONSTRAINT roles_school_id_key UNIQUE (school_id, id),
  CONSTRAINT roles_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE permissions (
  code varchar(120) NOT NULL,
  description varchar(240) NOT NULL,
  CONSTRAINT permissions_pkey PRIMARY KEY (code)
);

CREATE TABLE membership_roles (
  school_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT membership_roles_pkey PRIMARY KEY (school_id, membership_id, role_id),
  CONSTRAINT membership_roles_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT membership_roles_school_id_membership_id_fkey FOREIGN KEY (school_id, membership_id) REFERENCES school_memberships(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT membership_roles_school_id_role_id_fkey FOREIGN KEY (school_id, role_id) REFERENCES roles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX membership_roles_role_idx ON membership_roles (school_id, role_id);

CREATE TABLE role_permissions (
  school_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_code varchar(120) NOT NULL,
  granted_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_pkey PRIMARY KEY (school_id, role_id, permission_code),
  CONSTRAINT role_permissions_school_id_role_id_fkey FOREIGN KEY (school_id, role_id) REFERENCES roles(school_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT role_permissions_permission_fkey FOREIGN KEY (permission_code) REFERENCES permissions(code) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX role_permissions_permission_idx ON role_permissions (permission_code);

CREATE TABLE persons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL,
  user_id uuid,
  legal_first_name varchar(100) NOT NULL,
  preferred_name varchar(100),
  last_name varchar(100) NOT NULL,
  date_of_birth date,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT persons_pkey PRIMARY KEY (id),
  CONSTRAINT persons_school_id_key UNIQUE (school_id, id),
  CONSTRAINT persons_school_user_key UNIQUE (school_id, user_id),
  CONSTRAINT persons_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT persons_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX persons_school_name_idx ON persons (school_id, last_name, legal_first_name);
CREATE INDEX persons_user_idx ON persons (user_id);

CREATE TABLE audit_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  school_id uuid,
  actor_user_id uuid,
  action varchar(100) NOT NULL,
  entity_type varchar(100) NOT NULL,
  entity_id uuid,
  occurred_at timestamptz(6) NOT NULL DEFAULT now(),
  request_id varchar(100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_events_pkey PRIMARY KEY (id),
  CONSTRAINT audit_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX audit_events_school_time_idx ON audit_events (school_id, occurred_at DESC);
CREATE INDEX audit_events_actor_time_idx ON audit_events (actor_user_id, occurred_at DESC);
CREATE INDEX audit_events_entity_time_idx ON audit_events (entity_type, entity_id, occurred_at DESC);

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
  RETURN NULL;
END;
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

INSERT INTO permissions (code, description) VALUES
  ('school.read', 'Read school profile'),
  ('school.members.read', 'Read school memberships'),
  ('school.members.manage', 'Create and update school memberships'),
  ('school.roles.manage', 'Manage school role assignments'),
  ('audit.read', 'Read authorized audit events')
ON CONFLICT (code) DO NOTHING;
