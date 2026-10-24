-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "bucket_key" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(6),

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("bucket_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_expiry_idx" ON "auth_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_expiry_idx" ON "password_reset_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "auth_rate_limits_locked_until_idx" ON "auth_rate_limits"("locked_until");

-- RenameForeignKey
ALTER TABLE "attendance_interventions" RENAME CONSTRAINT "attendance_interventions_actor_fkey" TO "attendance_interventions_created_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_interventions" RENAME CONSTRAINT "attendance_interventions_pupil_fkey" TO "attendance_interventions_school_id_pupil_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_interventions" RENAME CONSTRAINT "attendance_interventions_school_fkey" TO "attendance_interventions_school_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_notes" RENAME CONSTRAINT "attendance_notes_author_fkey" TO "attendance_notes_author_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_notes" RENAME CONSTRAINT "attendance_notes_record_fkey" TO "attendance_notes_school_id_attendance_record_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_record_revisions" RENAME CONSTRAINT "attendance_record_revisions_actor_fkey" TO "attendance_record_revisions_changed_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_record_revisions" RENAME CONSTRAINT "attendance_record_revisions_code_fkey" TO "attendance_record_revisions_school_id_attendance_code_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_record_revisions" RENAME CONSTRAINT "attendance_record_revisions_record_fkey" TO "attendance_record_revisions_school_id_attendance_record_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_record_revisions" RENAME CONSTRAINT "attendance_record_revisions_school_fkey" TO "attendance_record_revisions_school_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_records" RENAME CONSTRAINT "attendance_records_marked_by_user_fkey" TO "attendance_records_marked_by_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "attendance_sessions" RENAME CONSTRAINT "attendance_sessions_class_group_fkey" TO "attendance_sessions_school_id_class_group_id_fkey";

-- RenameForeignKey
ALTER TABLE "outbox_events" RENAME CONSTRAINT "outbox_events_school_fkey" TO "outbox_events_school_id_fkey";

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
