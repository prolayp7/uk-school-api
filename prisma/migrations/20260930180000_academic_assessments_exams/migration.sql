-- CreateTable
CREATE TABLE "curriculum_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "year_group_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "overview" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',

    CONSTRAINT "curriculum_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schemes_of_work" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "curriculum_plan_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "starts_on" DATE,
    "ends_on" DATE,
    "status" VARCHAR(16) NOT NULL DEFAULT 'planned',

    CONSTRAINT "schemes_of_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timetable_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "class_group_id" UUID NOT NULL,
    "teacher_staff_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "starts_at" TIME(0) NOT NULL,
    "ends_at" TIME(0) NOT NULL,
    "room" VARCHAR(40),
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,

    CONSTRAINT "timetable_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "scale_type" VARCHAR(24) NOT NULL,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "grade_scale_id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "min_score" DECIMAL(8,2) NOT NULL,
    "max_score" DECIMAL(8,2) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "class_group_id" UUID NOT NULL,
    "grade_scale_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "assessment_type" VARCHAR(24) NOT NULL,
    "max_score" DECIMAL(8,2) NOT NULL,
    "assessed_on" DATE NOT NULL,
    "source" VARCHAR(24) NOT NULL DEFAULT 'teacher',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "grade_code" VARCHAR(24),
    "comments" VARCHAR(1000),
    "source" VARCHAR(24) NOT NULL,
    "entered_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_result_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "score" DECIMAL(8,2) NOT NULL,
    "grade_code" VARCHAR(24),
    "comments" VARCHAR(1000),
    "source" VARCHAR(24) NOT NULL,
    "revision" INTEGER NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_result_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pupil_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "subject_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "target_grade" VARCHAR(24),
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,

    CONSTRAINT "pupil_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "awarding_body" VARCHAR(80) NOT NULL,
    "qualification" VARCHAR(80) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'planned',

    CONSTRAINT "exam_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_series_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "venue" VARCHAR(120),

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_series_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "candidate_number" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'entered',
    "entered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "grade" VARCHAR(24) NOT NULL,
    "score" DECIMAL(8,2),
    "source" VARCHAR(24) NOT NULL,
    "entered_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "exam_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_result_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "exam_result_id" UUID NOT NULL,
    "grade" VARCHAR(24) NOT NULL,
    "score" DECIMAL(8,2),
    "source" VARCHAR(24) NOT NULL,
    "revision" INTEGER NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_result_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_plans_year_group_idx" ON "curriculum_plans"("school_id", "academic_year_id", "year_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_plans_school_id_key" ON "curriculum_plans"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_plans_school_year_group_subject_key" ON "curriculum_plans"("school_id", "academic_year_id", "year_group_id", "subject_id");

-- CreateIndex
CREATE INDEX "schemes_of_work_plan_status_idx" ON "schemes_of_work"("school_id", "curriculum_plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "schemes_of_work_school_id_key" ON "schemes_of_work"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "schemes_of_work_plan_sequence_key" ON "schemes_of_work"("school_id", "curriculum_plan_id", "sequence");

-- CreateIndex
CREATE INDEX "timetable_slots_class_schedule_idx" ON "timetable_slots"("school_id", "class_group_id", "day_of_week", "effective_from");

-- CreateIndex
CREATE INDEX "timetable_slots_teacher_schedule_idx" ON "timetable_slots"("school_id", "teacher_staff_id", "day_of_week", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_school_id_key" ON "timetable_slots"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_school_id_key" ON "grade_scales"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_school_code_key" ON "grade_scales"("school_id", "code");

-- CreateIndex
CREATE INDEX "grade_bands_scale_range_idx" ON "grade_bands"("school_id", "grade_scale_id", "min_score", "max_score");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_school_id_key" ON "grade_bands"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_scale_code_key" ON "grade_bands"("school_id", "grade_scale_id", "code");

-- CreateIndex
CREATE INDEX "assessments_class_date_idx" ON "assessments"("school_id", "class_group_id", "assessed_on");

-- CreateIndex
CREATE UNIQUE INDEX "assessments_school_id_key" ON "assessments"("school_id", "id");

-- CreateIndex
CREATE INDEX "assessment_results_pupil_time_idx" ON "assessment_results"("school_id", "pupil_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_school_id_key" ON "assessment_results"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_assessment_pupil_key" ON "assessment_results"("school_id", "assessment_id", "pupil_id");

-- CreateIndex
CREATE INDEX "assessment_result_revisions_result_idx" ON "assessment_result_revisions"("school_id", "result_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_result_revisions_school_id_key" ON "assessment_result_revisions"("school_id", "id");

-- CreateIndex
CREATE INDEX "pupil_targets_pupil_status_idx" ON "pupil_targets"("school_id", "pupil_id", "status", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "pupil_targets_school_id_key" ON "pupil_targets"("school_id", "id");

-- CreateIndex
CREATE INDEX "exam_series_school_date_idx" ON "exam_series"("school_id", "starts_on", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_series_school_id_key" ON "exam_series"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_series_school_code_key" ON "exam_series"("school_id", "code");

-- CreateIndex
CREATE INDEX "exam_sessions_series_time_idx" ON "exam_sessions"("school_id", "exam_series_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_school_id_key" ON "exam_sessions"("school_id", "id");

-- CreateIndex
CREATE INDEX "exam_candidates_series_subject_idx" ON "exam_candidates"("school_id", "exam_series_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_school_id_key" ON "exam_candidates"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_series_pupil_subject_key" ON "exam_candidates"("school_id", "exam_series_id", "pupil_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_candidates_series_number_key" ON "exam_candidates"("school_id", "exam_series_id", "candidate_number");

-- CreateIndex
CREATE INDEX "exam_results_candidate_time_idx" ON "exam_results"("school_id", "candidate_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_school_id_key" ON "exam_results"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_results_candidate_key" ON "exam_results"("school_id", "candidate_id");

-- CreateIndex
CREATE INDEX "exam_result_revisions_result_idx" ON "exam_result_revisions"("school_id", "exam_result_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "exam_result_revisions_school_id_key" ON "exam_result_revisions"("school_id", "id");

-- AddForeignKey
ALTER TABLE "curriculum_plans" ADD CONSTRAINT "curriculum_plans_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_plans" ADD CONSTRAINT "curriculum_plans_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_plans" ADD CONSTRAINT "curriculum_plans_school_id_year_group_id_fkey" FOREIGN KEY ("school_id", "year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_plans" ADD CONSTRAINT "curriculum_plans_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes_of_work" ADD CONSTRAINT "schemes_of_work_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes_of_work" ADD CONSTRAINT "schemes_of_work_school_id_curriculum_plan_id_fkey" FOREIGN KEY ("school_id", "curriculum_plan_id") REFERENCES "curriculum_plans"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schemes_of_work" ADD CONSTRAINT "schemes_of_work_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_school_id_class_group_id_fkey" FOREIGN KEY ("school_id", "class_group_id") REFERENCES "class_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_school_id_teacher_staff_id_fkey" FOREIGN KEY ("school_id", "teacher_staff_id") REFERENCES "staff_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_scales" ADD CONSTRAINT "grade_scales_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_school_id_grade_scale_id_fkey" FOREIGN KEY ("school_id", "grade_scale_id") REFERENCES "grade_scales"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_class_group_id_fkey" FOREIGN KEY ("school_id", "class_group_id") REFERENCES "class_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_school_id_grade_scale_id_fkey" FOREIGN KEY ("school_id", "grade_scale_id") REFERENCES "grade_scales"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_school_id_assessment_id_fkey" FOREIGN KEY ("school_id", "assessment_id") REFERENCES "assessments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_results" ADD CONSTRAINT "assessment_results_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_result_revisions" ADD CONSTRAINT "assessment_result_revisions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_result_revisions" ADD CONSTRAINT "assessment_result_revisions_school_id_result_id_fkey" FOREIGN KEY ("school_id", "result_id") REFERENCES "assessment_results"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_result_revisions" ADD CONSTRAINT "assessment_result_revisions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_targets" ADD CONSTRAINT "pupil_targets_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_targets" ADD CONSTRAINT "pupil_targets_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_targets" ADD CONSTRAINT "pupil_targets_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pupil_targets" ADD CONSTRAINT "pupil_targets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_series" ADD CONSTRAINT "exam_series_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_school_id_exam_series_id_fkey" FOREIGN KEY ("school_id", "exam_series_id") REFERENCES "exam_series"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_school_id_exam_series_id_fkey" FOREIGN KEY ("school_id", "exam_series_id") REFERENCES "exam_series"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_candidates" ADD CONSTRAINT "exam_candidates_school_id_subject_id_fkey" FOREIGN KEY ("school_id", "subject_id") REFERENCES "subjects"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_school_id_candidate_id_fkey" FOREIGN KEY ("school_id", "candidate_id") REFERENCES "exam_candidates"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_results" ADD CONSTRAINT "exam_results_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_result_revisions" ADD CONSTRAINT "exam_result_revisions_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_result_revisions" ADD CONSTRAINT "exam_result_revisions_school_id_exam_result_id_fkey" FOREIGN KEY ("school_id", "exam_result_id") REFERENCES "exam_results"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_result_revisions" ADD CONSTRAINT "exam_result_revisions_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE grade_bands
    ADD CONSTRAINT grade_bands_score_range_check CHECK (min_score <= max_score);
ALTER TABLE timetable_slots
    ADD CONSTRAINT timetable_slots_day_check CHECK (day_of_week BETWEEN 1 AND 7),
    ADD CONSTRAINT timetable_slots_time_range_check CHECK (starts_at < ends_at),
    ADD CONSTRAINT timetable_slots_effective_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE assessments
    ADD CONSTRAINT assessments_type_check CHECK (assessment_type IN ('formative', 'summative', 'benchmark', 'mock', 'other')),
    ADD CONSTRAINT assessments_max_score_check CHECK (max_score > 0);
ALTER TABLE assessment_results
    ADD CONSTRAINT assessment_results_score_check CHECK (score >= 0),
    ADD CONSTRAINT assessment_results_revision_check CHECK (revision > 0);
ALTER TABLE assessment_result_revisions
    ADD CONSTRAINT assessment_result_revisions_score_check CHECK (score >= 0),
    ADD CONSTRAINT assessment_result_revisions_revision_check CHECK (revision > 0);
ALTER TABLE pupil_targets
    ADD CONSTRAINT pupil_targets_status_check CHECK (status IN ('active', 'achieved', 'closed')),
    ADD CONSTRAINT pupil_targets_dates_check CHECK (ends_on IS NULL OR ends_on >= starts_on);
ALTER TABLE exam_series
    ADD CONSTRAINT exam_series_status_check CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    ADD CONSTRAINT exam_series_dates_check CHECK (ends_on >= starts_on);
ALTER TABLE exam_sessions
    ADD CONSTRAINT exam_sessions_time_range_check CHECK (ends_at > starts_at);
ALTER TABLE exam_candidates
    ADD CONSTRAINT exam_candidates_status_check CHECK (status IN ('entered', 'withdrawn', 'eligible'));
ALTER TABLE exam_results
    ADD CONSTRAINT exam_results_score_check CHECK (score IS NULL OR score >= 0),
    ADD CONSTRAINT exam_results_revision_check CHECK (revision > 0);
