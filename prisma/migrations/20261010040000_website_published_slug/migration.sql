-- Add a separate live slug so draft slug changes cannot shadow published URLs.
ALTER TABLE "website_pages" ADD COLUMN "published_slug" VARCHAR(180);

CREATE UNIQUE INDEX "website_pages_school_published_slug_key"
ON "website_pages"("school_id", "content_type", "published_slug");
