-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "target_year_group_id" UUID,
    "applicant_user_id" UUID,
    "enrolled_pupil_id" UUID,
    "reference" VARCHAR(32) NOT NULL,
    "applicant_name" VARCHAR(160) NOT NULL,
    "applicant_email" VARCHAR(320) NOT NULL,
    "applicant_phone" VARCHAR(32) NOT NULL,
    "pupil_first_name" VARCHAR(100) NOT NULL,
    "pupil_last_name" VARCHAR(100) NOT NULL,
    "pupil_date_of_birth" DATE NOT NULL,
    "status" VARCHAR(24) NOT NULL DEFAULT 'submitted',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "from_status" VARCHAR(24),
    "to_status" VARCHAR(24) NOT NULL,
    "note" VARCHAR(1000),
    "actor_user_id" UUID,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "document_type" VARCHAR(40) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'requested',
    "file_name" VARCHAR(240),
    "storage_key" VARCHAR(500),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMPTZ(6),
    "requested_by_user_id" UUID,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'offered',
    "terms" TEXT NOT NULL,
    "offered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolment_handoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "pupil_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "year_group_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "verified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrolment_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "pupil_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "parent_user_id" UUID NOT NULL,
    "application_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "reference" VARCHAR(32) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'GBP',
    "total_amount" DECIMAL(10,2) NOT NULL,
    "due_at" DATE,
    "issued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "charge_id" UUID,
    "description" VARCHAR(240) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount" DECIMAL(10,2) NOT NULL,
    "line_amount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "initiated_by_user_id" UUID NOT NULL,
    "provider_name" VARCHAR(32) NOT NULL,
    "provider_reference" VARCHAR(160),
    "provider_intent_reference" VARCHAR(160),
    "idempotency_key" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "provider_reference" VARCHAR(160),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "payment_id" UUID,
    "provider_name" VARCHAR(32) NOT NULL,
    "external_event_id" VARCHAR(160) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_enrolled_pupil_key" ON "applications"("enrolled_pupil_id");

-- CreateIndex
CREATE INDEX "applications_status_time_idx" ON "applications"("school_id", "status", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "applications_applicant_idx" ON "applications"("school_id", "applicant_user_id", "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "applications_school_id_key" ON "applications"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_school_reference_key" ON "applications"("school_id", "reference");

-- CreateIndex
CREATE INDEX "application_status_history_app_time_idx" ON "application_status_history"("school_id", "application_id", "changed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "application_status_history_school_id_key" ON "application_status_history"("school_id", "id");

-- CreateIndex
CREATE INDEX "application_documents_app_status_idx" ON "application_documents"("school_id", "application_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "application_documents_school_id_key" ON "application_documents"("school_id", "id");

-- CreateIndex
CREATE INDEX "offers_application_time_idx" ON "offers"("school_id", "application_id", "offered_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "offers_school_id_key" ON "offers"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_handoffs_application_key" ON "enrolment_handoffs"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_handoffs_pupil_key" ON "enrolment_handoffs"("pupil_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_handoffs_school_id_key" ON "enrolment_handoffs"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_handoffs_school_application_key" ON "enrolment_handoffs"("school_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolment_handoffs_school_pupil_key" ON "enrolment_handoffs"("school_id", "pupil_id");

-- CreateIndex
CREATE INDEX "charges_school_active_idx" ON "charges"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "charges_school_id_key" ON "charges"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "charges_school_code_key" ON "charges"("school_id", "code");

-- CreateIndex
CREATE INDEX "invoices_parent_status_idx" ON "invoices"("school_id", "parent_user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_school_id_key" ON "invoices"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_school_reference_key" ON "invoices"("school_id", "reference");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines"("school_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_school_id_key" ON "invoice_lines"("school_id", "id");

-- CreateIndex
CREATE INDEX "payments_invoice_status_idx" ON "payments"("school_id", "invoice_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_id_key" ON "payments"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_school_idempotency_key" ON "payments"("school_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_reference_key" ON "payments"("provider_name", "provider_reference");

-- CreateIndex
CREATE INDEX "refunds_payment_time_idx" ON "refunds"("school_id", "payment_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_school_id_key" ON "refunds"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_school_idempotency_key" ON "refunds"("school_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_provider_events_school_time_idx" ON "payment_provider_events"("school_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_event_key" ON "payment_provider_events"("provider_name", "external_event_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_school_id_target_year_group_id_fkey" FOREIGN KEY ("school_id", "target_year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_user_id_fkey" FOREIGN KEY ("applicant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_school_id_enrolled_pupil_id_fkey" FOREIGN KEY ("school_id", "enrolled_pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_school_id_application_id_fkey" FOREIGN KEY ("school_id", "application_id") REFERENCES "applications"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_school_id_application_id_fkey" FOREIGN KEY ("school_id", "application_id") REFERENCES "applications"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_school_id_application_id_fkey" FOREIGN KEY ("school_id", "application_id") REFERENCES "applications"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_application_id_fkey" FOREIGN KEY ("school_id", "application_id") REFERENCES "applications"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_academic_year_id_fkey" FOREIGN KEY ("school_id", "academic_year_id") REFERENCES "academic_years"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_year_group_id_fkey" FOREIGN KEY ("school_id", "year_group_id") REFERENCES "year_groups"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_school_id_year_group_id_form_id_fkey" FOREIGN KEY ("school_id", "year_group_id", "form_id") REFERENCES "forms"("school_id", "year_group_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolment_handoffs" ADD CONSTRAINT "enrolment_handoffs_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_school_id_pupil_id_fkey" FOREIGN KEY ("school_id", "pupil_id") REFERENCES "pupil_profiles"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_school_id_application_id_fkey" FOREIGN KEY ("school_id", "application_id") REFERENCES "applications"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_school_id_invoice_id_fkey" FOREIGN KEY ("school_id", "invoice_id") REFERENCES "invoices"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_school_id_charge_id_fkey" FOREIGN KEY ("school_id", "charge_id") REFERENCES "charges"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_school_id_invoice_id_fkey" FOREIGN KEY ("school_id", "invoice_id") REFERENCES "invoices"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_school_id_payment_id_fkey" FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_school_id_payment_id_fkey" FOREIGN KEY ("school_id", "payment_id") REFERENCES "payments"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE applications
    ADD CONSTRAINT applications_status_check CHECK (status IN ('submitted', 'reviewing', 'documents_requested', 'offered', 'waitlisted', 'declined', 'accepted', 'withdrawn', 'enrolled'));
ALTER TABLE application_status_history
    ADD CONSTRAINT application_status_history_to_status_check CHECK (to_status IN ('submitted', 'reviewing', 'documents_requested', 'offered', 'waitlisted', 'declined', 'accepted', 'withdrawn', 'enrolled'));
ALTER TABLE application_documents
    ADD CONSTRAINT application_documents_status_check CHECK (status IN ('requested', 'received', 'verified', 'rejected'));
ALTER TABLE offers
    ADD CONSTRAINT offers_status_check CHECK (status IN ('offered', 'accepted', 'declined', 'expired')),
    ADD CONSTRAINT offers_expiration_check CHECK (expires_at IS NULL OR expires_at > offered_at);
ALTER TABLE charges
    ADD CONSTRAINT charges_amount_check CHECK (amount > 0),
    ADD CONSTRAINT charges_currency_check CHECK (currency = 'GBP');
ALTER TABLE invoices
    ADD CONSTRAINT invoices_status_check CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void')),
    ADD CONSTRAINT invoices_total_check CHECK (total_amount >= 0),
    ADD CONSTRAINT invoices_currency_check CHECK (currency = 'GBP');
ALTER TABLE invoice_lines
    ADD CONSTRAINT invoice_lines_quantity_check CHECK (quantity > 0),
    ADD CONSTRAINT invoice_lines_amount_check CHECK (unit_amount >= 0 AND line_amount = unit_amount * quantity);
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled', 'refunded')),
    ADD CONSTRAINT payments_amount_check CHECK (amount > 0),
    ADD CONSTRAINT payments_currency_check CHECK (currency = 'GBP');
ALTER TABLE refunds
    ADD CONSTRAINT refunds_status_check CHECK (status IN ('pending', 'succeeded', 'failed')),
    ADD CONSTRAINT refunds_amount_check CHECK (amount > 0);
ALTER TABLE payment_provider_events
    ADD CONSTRAINT payment_provider_events_verified_check CHECK (signature_verified);
