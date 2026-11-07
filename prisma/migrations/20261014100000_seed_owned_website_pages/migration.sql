ALTER TABLE "website_pages"
ADD COLUMN "seed_key" VARCHAR(100);

CREATE UNIQUE INDEX "website_pages_school_seed_key"
ON "website_pages"("school_id", "seed_key");
