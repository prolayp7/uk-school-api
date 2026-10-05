ALTER TABLE "parent_carer_profiles"
  ADD COLUMN "external_id" VARCHAR(80),
  ADD COLUMN "title" VARCHAR(32),
  ADD COLUMN "landline" VARCHAR(32),
  ADD COLUMN "residential_address" VARCHAR(500),
  ADD COLUMN "photo_storage_path" VARCHAR(500);

CREATE UNIQUE INDEX "parent_carer_profiles_school_external_id_key"
  ON "parent_carer_profiles"("school_id", "external_id");

UPDATE "parent_carer_profiles" AS profile
SET "external_id" = contact_ids.external_id
FROM "persons" AS person
JOIN (VALUES
  ('parent:PAR0001', 'sarah-turner'),
  ('parent:PAR0002', 'mark-turner'),
  ('parent:PAR0003', 'priya-kapoor'),
  ('parent:PAR0004', 'marcus-sinclair'),
  ('parent:PAR0005', 'tariq-al-mansoor'),
  ('parent:PAR0006', 'claire-robinson'),
  ('parent:PAR0007', 'julia-green'),
  ('parent:PAR0008', 'gillian-vance'),
  ('parent:PAR0009', 'helen-turner'),
  ('parent:PAR0010', 'david-kapoor')
) AS contact_ids(seed_key, external_id)
  ON person."seed_key" = contact_ids.seed_key
WHERE profile."school_id" = person."school_id"
  AND profile."person_id" = person."id";