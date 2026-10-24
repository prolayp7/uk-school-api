CREATE TABLE "staff_compliance_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "school_id" UUID NOT NULL,
  "staff_profile_id" UUID NOT NULL,
  "identity_verified_on" DATE,
  "right_to_work_verified_on" DATE,
  "dbs_check_status" VARCHAR(24) NOT NULL DEFAULT 'not_started',
  "dbs_checked_on" DATE,
  "barred_list_checked_on" DATE,
  "prohibition_checked_on" DATE,
  "qualifications_verified_on" DATE,
  "references_verified_on" DATE,
  "employment_history_verified_on" DATE,
  "safeguarding_training_completed_on" DATE,
  "updated_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "staff_compliance_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_compliance_records_dbs_status_check"
    CHECK ("dbs_check_status" IN ('not_started', 'in_progress', 'clear', 'review_required')),
  CONSTRAINT "staff_compliance_records_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_compliance_records_school_staff_fkey"
    FOREIGN KEY ("school_id", "staff_profile_id")
    REFERENCES "staff_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_compliance_records_updated_by_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "staff_compliance_records_school_id_key"
  ON "staff_compliance_records"("school_id", "id");
CREATE UNIQUE INDEX "staff_compliance_records_school_staff_key"
  ON "staff_compliance_records"("school_id", "staff_profile_id");
CREATE INDEX "staff_compliance_records_school_dbs_status_idx"
  ON "staff_compliance_records"("school_id", "dbs_check_status");

INSERT INTO "permissions" ("code", "description") VALUES
  ('census.manage', 'View statutory census readiness checks'),
  ('scr.manage', 'View and manage restricted staff compliance records')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "roles" ("school_id", "code", "name")
SELECT "id", 'SCR_ADMIN', 'Single Central Record administrator'
FROM "schools"
ON CONFLICT ("school_id", "code") DO NOTHING;

WITH defaults("role_code", "permission_code") AS (
  VALUES
    ('HEADTEACHER', 'census.manage'),
    ('HEADTEACHER', 'scr.manage'),
    ('SLT', 'census.manage'),
    ('SLT', 'scr.manage'),
    ('SCR_ADMIN', 'census.manage'),
    ('SCR_ADMIN', 'scr.manage')
)
INSERT INTO "role_permissions" ("school_id", "role_id", "permission_code")
SELECT "roles"."school_id", "roles"."id", "defaults"."permission_code"
FROM "defaults"
JOIN "roles" ON "roles"."code" = "defaults"."role_code"
JOIN "permissions" ON "permissions"."code" = "defaults"."permission_code"
ON CONFLICT ("school_id", "role_id", "permission_code") DO NOTHING;
