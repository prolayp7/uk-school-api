/*
  Warnings:

  - A unique constraint covering the columns `[school_id,seed_key]` on the table `persons` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "address_line_1" VARCHAR(160),
ADD COLUMN     "address_line_2" VARCHAR(160),
ADD COLUMN     "phone_number" VARCHAR(32),
ADD COLUMN     "postcode" VARCHAR(16),
ADD COLUMN     "seed_key" VARCHAR(80),
ADD COLUMN     "town" VARCHAR(100);

-- CreateTable
CREATE TABLE "pupil_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "upn" VARCHAR(13),
    "admission_number" VARCHAR(32) NOT NULL,
    "gender" VARCHAR(32) NOT NULL DEFAULT 'not_recorded',
    "admission_date" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'enrolled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pupil_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "department_id" UUID,
    "staff_number" VARCHAR(32) NOT NULL,
    "staff_type" VARCHAR(32) NOT NULL,
    "job_title" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "start_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parent_carer_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_carer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "key_stage" VARCHAR(8) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "year_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "year_group_id" UUID NOT NULL,
    "tutor_staff_id" UUID,
    "code" VARCHAR(24) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "houses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(64) NOT NULL,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "department_id" UUID,
    "code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pupil_contacts" (
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "guardian_person_id" UUID NOT NULL,
    "relationship" VARCHAR(32) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "can_collect" BOOLEAN NOT NULL DEFAULT false,
    "has_parental_responsibility" BOOLEAN NOT NULL DEFAULT false,
    "can_view_portal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pupil_contacts_pkey" PRIMARY KEY ("school_id","pupil_id","guardian_person_id")
);

-- CreateTable
CREATE TABLE "pupil_enrolments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "year_group_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "house_id" UUID,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',

    CONSTRAINT "pupil_enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "year_group_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_staff_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,

    CONSTRAINT "class_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_memberships" (
    "school_id" UUID NOT NULL,
    "class_group_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "joined_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_memberships_pkey" PRIMARY KEY ("school_id","class_group_id","pupil_id")
);

-- CreateTable
CREATE TABLE "attendance_codes" (
    "school_id" UUID NOT NULL,
    "code" VARCHAR(4) NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "mark_type" VARCHAR(24) NOT NULL,
    "counts_as_present" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "attendance_codes_pkey" PRIMARY KEY ("school_id","code")
);

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "session_date" DATE NOT NULL,
    "session_type" VARCHAR(16) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "attendance_session_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "attendance_code" VARCHAR(4) NOT NULL,
    "marked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "primary_need" VARCHAR(64) NOT NULL,
    "support_level" VARCHAR(24) NOT NULL,
    "review_due" DATE,

    CONSTRAINT "send_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_conditions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(24) NOT NULL,

    CONSTRAINT "medical_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pupil_medical_conditions" (
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "medical_condition_id" UUID NOT NULL,
    "severity" VARCHAR(24) NOT NULL,
    "care_note" VARCHAR(240) NOT NULL,

    CONSTRAINT "pupil_medical_conditions_pkey" PRIMARY KEY ("school_id","pupil_id","medical_condition_id")
);

-- CreateTable
CREATE TABLE "behaviour_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "seed_key" VARCHAR(80) NOT NULL,
    "category" VARCHAR(24) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "details" VARCHAR(240) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "parent_visible" BOOLEAN NOT NULL DEFAULT false,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "behaviour_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pupil_profiles_school_status_idx" ON "pupil_profiles"("school_id", "status", "admission_date");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_profiles_school_id_key" ON "pupil_profiles"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_profiles_school_person_key" ON "pupil_profiles"("school_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_profiles_school_admission_key" ON "pupil_profiles"("school_id", "admission_number");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_profiles_school_upn_key" ON "pupil_profiles"("school_id", "upn");

-- CreateIndex
CREATE INDEX "staff_profiles_school_type_idx" ON "staff_profiles"("school_id", "staff_type");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_school_id_key" ON "staff_profiles"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_school_person_key" ON "staff_profiles"("school_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_school_number_key" ON "staff_profiles"("school_id", "staff_number");

-- CreateIndex
CREATE UNIQUE INDEX "parent_carer_profiles_school_id_key" ON "parent_carer_profiles"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "parent_carer_profiles_school_person_key" ON "parent_carer_profiles"("school_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_id_key" ON "academic_years"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_school_code_key" ON "academic_years"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "terms_school_year_code_key" ON "terms"("school_id", "academic_year_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "year_groups_school_id_key" ON "year_groups"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "year_groups_school_code_key" ON "year_groups"("school_id", "code");

-- CreateIndex
CREATE INDEX "forms_school_year_group_idx" ON "forms"("school_id", "year_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "forms_school_id_key" ON "forms"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "forms_school_year_id_key" ON "forms"("school_id", "year_group_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "forms_school_code_key" ON "forms"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "houses_school_id_key" ON "houses"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "houses_school_code_key" ON "houses"("school_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_school_id_key" ON "departments"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_school_code_key" ON "departments"("school_id", "code");

-- CreateIndex
CREATE INDEX "subjects_school_department_idx" ON "subjects"("school_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_id_key" ON "subjects"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_school_code_key" ON "subjects"("school_id", "code");

-- CreateIndex
CREATE INDEX "pupil_contacts_guardian_idx" ON "pupil_contacts"("school_id", "guardian_person_id");

-- CreateIndex
CREATE INDEX "pupil_enrolments_school_form_idx" ON "pupil_enrolments"("school_id", "year_group_id", "form_id");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_enrolments_school_id_key" ON "pupil_enrolments"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_enrolments_school_pupil_year_key" ON "pupil_enrolments"("school_id", "pupil_id", "academic_year_id");

-- CreateIndex
CREATE INDEX "class_groups_school_teacher_idx" ON "class_groups"("school_id", "teacher_staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_groups_school_id_key" ON "class_groups"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "class_groups_school_year_subject_key" ON "class_groups"("school_id", "academic_year_id", "year_group_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_groups_school_code_key" ON "class_groups"("school_id", "code");

-- CreateIndex
CREATE INDEX "class_memberships_school_pupil_idx" ON "class_memberships"("school_id", "pupil_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_school_id_key" ON "attendance_sessions"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_school_date_type_key" ON "attendance_sessions"("school_id", "session_date", "session_type");

-- CreateIndex
CREATE INDEX "attendance_records_school_pupil_session_idx" ON "attendance_records"("school_id", "pupil_id", "attendance_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_school_id_key" ON "attendance_records"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_school_session_pupil_key" ON "attendance_records"("school_id", "attendance_session_id", "pupil_id");

-- CreateIndex
CREATE UNIQUE INDEX "send_profiles_school_pupil_key" ON "send_profiles"("school_id", "pupil_id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_conditions_school_id_key" ON "medical_conditions"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_conditions_school_code_key" ON "medical_conditions"("school_id", "code");

-- CreateIndex
CREATE INDEX "behaviour_incidents_school_pupil_time_idx" ON "behaviour_incidents"("school_id", "pupil_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "behaviour_incidents_school_seed_key" ON "behaviour_incidents"("school_id", "seed_key");

-- CreateIndex
CREATE UNIQUE INDEX "persons_school_seed_key" ON "persons"("school_id", "seed_key");

-- AddForeignKey
ALTER TABLE "pupil_profiles" ADD CONSTRAINT "pupil_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_profiles" ADD CONSTRAINT "pupil_profiles_school_id_person_id_fkey" FOREIGN KEY ("school_id", "person_id") REFERENCES "persons"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_school_id_person_id_fkey" FOREIGN KEY ("school_id", "person_id") REFERENCES "persons"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_school_id_department_id_fkey" FOREIGN KEY ("school_id", "department_id") REFERENCES "departments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_carer_profiles" ADD CONSTRAINT "parent_carer_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_carer_profiles" ADD CONSTRAINT "parent_carer_profiles_school_id_person_id_fkey" FOREIGN KEY ("school_id", "person_id") REFERENCES "persons"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_years" ADD CONSTRAINT "academic_years_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_groups" ADD CONSTRAINT "year_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_school_id_year_group_id_fkey" FOREIGN KEY ("school_id", "year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_school_id_tutor_staff_id_fkey" FOREIGN KEY ("school_id", "tutor_staff_id") REFERENCES "staff_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "houses" ADD CONSTRAINT "houses_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_department_id_fkey" FOREIGN KEY ("school_id", "department_id") REFERENCES "departments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_contacts" ADD CONSTRAINT "pupil_contacts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_contacts" ADD CONSTRAINT "pupil_contacts_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_contacts" ADD CONSTRAINT "pupil_contacts_school_id_guardian_person_id_fkey" FOREIGN KEY ("school_id", "guardian_person_id") REFERENCES "parent_carer_profiles"("school_id", "person_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_year_group_id_fkey" FOREIGN KEY ("school_id", "year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_year_group_id_form_id_fkey" FOREIGN KEY ("school_id", "year_group_id", "form_id") REFERENCES "forms"("school_id", "year_group_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_enrolments" ADD CONSTRAINT "pupil_enrolments_school_id_house_id_fkey" FOREIGN KEY ("school_id", "house_id") REFERENCES "houses"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_year_group_id_fkey" FOREIGN KEY ("school_id", "year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_groups" ADD CONSTRAINT "class_groups_school_id_teacher_staff_id_fkey" FOREIGN KEY ("school_id", "teacher_staff_id") REFERENCES "staff_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_school_id_class_group_id_fkey" FOREIGN KEY ("school_id", "class_group_id") REFERENCES "class_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_codes" ADD CONSTRAINT "attendance_codes_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_attendance_session_id_fkey" FOREIGN KEY ("school_id", "attendance_session_id") REFERENCES "attendance_sessions"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_attendance_code_fkey" FOREIGN KEY ("school_id", "attendance_code") REFERENCES "attendance_codes"("school_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_profiles" ADD CONSTRAINT "send_profiles_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_profiles" ADD CONSTRAINT "send_profiles_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_conditions" ADD CONSTRAINT "medical_conditions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_medical_conditions" ADD CONSTRAINT "pupil_medical_conditions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_medical_conditions" ADD CONSTRAINT "pupil_medical_conditions_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_medical_conditions" ADD CONSTRAINT "pupil_medical_conditions_school_id_medical_condition_id_fkey" FOREIGN KEY ("school_id", "medical_condition_id") REFERENCES "medical_conditions"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_incidents" ADD CONSTRAINT "behaviour_incidents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_incidents" ADD CONSTRAINT "behaviour_incidents_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
