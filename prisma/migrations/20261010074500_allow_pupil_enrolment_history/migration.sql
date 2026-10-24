DROP INDEX "pupil_enrolments_school_pupil_year_key";

CREATE INDEX "pupil_enrolments_school_pupil_year_idx"
ON "pupil_enrolments"("school_id", "pupil_id", "academic_year_id");
