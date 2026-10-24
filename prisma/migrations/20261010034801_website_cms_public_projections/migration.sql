-- CreateTable
CREATE TABLE "website_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "current_version_number" INTEGER NOT NULL DEFAULT 1,
    "published_version_number" INTEGER,
    "published_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_page_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL,
    "seo_title" VARCHAR(200),
    "seo_description" VARCHAR(320),
    "created_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "scheduled_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "website_pages_cms_list_idx" ON "website_pages"("school_id", "status", "content_type", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "website_pages_public_idx" ON "website_pages"("school_id", "published_version_number", "content_type");

-- CreateIndex
CREATE UNIQUE INDEX "website_pages_school_id_key" ON "website_pages"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "website_pages_school_slug_key" ON "website_pages"("school_id", "slug");

-- CreateIndex
CREATE INDEX "website_page_versions_workflow_idx" ON "website_page_versions"("school_id", "page_id", "status");

-- CreateIndex
CREATE INDEX "website_page_versions_slug_idx" ON "website_page_versions"("school_id", "slug", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "website_page_versions_school_id_key" ON "website_page_versions"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "website_page_versions_page_version_key" ON "website_page_versions"("school_id", "page_id", "version_number");

-- AddForeignKey
ALTER TABLE "website_pages" ADD CONSTRAINT "website_pages_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_page_versions" ADD CONSTRAINT "website_page_versions_school_id_page_id_fkey" FOREIGN KEY ("school_id", "page_id") REFERENCES "website_pages"("school_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
