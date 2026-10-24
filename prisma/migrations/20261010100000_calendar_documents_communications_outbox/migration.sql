-- DropIndex
DROP INDEX "outbox_events_pending_idx";

-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dead_lettered_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_error" VARCHAR(120),
ADD COLUMN     "locked_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID,
    "created_by_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000),
    "location" VARCHAR(240),
    "audience" VARCHAR(16) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID,
    "uploaded_by_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "storage_key" VARCHAR(512),
    "status" VARCHAR(20) NOT NULL DEFAULT 'upload_pending',
    "audience" VARCHAR(16) NOT NULL DEFAULT 'staff',
    "upload_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_download_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_download_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "subject" VARCHAR(180) NOT NULL,
    "body" VARCHAR(8000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "message_id" UUID,
    "title" VARCHAR(180) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "sent_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_audience_start_idx" ON "calendar_events"("school_id", "audience", "starts_at");

-- CreateIndex
CREATE INDEX "calendar_events_pupil_start_idx" ON "calendar_events"("school_id", "pupil_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_school_id_key" ON "calendar_events"("school_id", "id");

-- CreateIndex
CREATE INDEX "school_documents_pupil_created_idx" ON "school_documents"("school_id", "pupil_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "school_documents_school_id_key" ON "school_documents"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_download_grants_token_hash_key" ON "document_download_grants"("token_hash");

-- CreateIndex
CREATE INDEX "document_download_grants_expiry_idx" ON "document_download_grants"("expires_at");

-- CreateIndex
CREATE INDEX "communication_messages_pupil_created_idx" ON "communication_messages"("school_id", "pupil_id", "created_at");

-- CreateIndex
CREATE INDEX "communication_messages_recipient_idx" ON "communication_messages"("school_id", "recipient_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "communication_messages_school_id_key" ON "communication_messages"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_message_id_key" ON "notifications"("message_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_created_idx" ON "notifications"("school_id", "recipient_user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_school_id_key" ON "notifications"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_school_message_id_key" ON "notifications"("school_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_key" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries"("school_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_school_notification_key" ON "notification_deliveries"("school_id", "notification_id");

-- CreateIndex
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events"("processed_at", "available_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_documents" ADD CONSTRAINT "school_documents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_documents" ADD CONSTRAINT "school_documents_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_documents" ADD CONSTRAINT "school_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_download_grants" ADD CONSTRAINT "document_download_grants_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_download_grants" ADD CONSTRAINT "document_download_grants_school_id_document_id_fkey" FOREIGN KEY ("school_id", "document_id") REFERENCES "school_documents"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_message_id_fkey" FOREIGN KEY ("school_id", "message_id") REFERENCES "communication_messages"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_school_id_notification_id_fkey" FOREIGN KEY ("school_id", "notification_id") REFERENCES "notifications"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
