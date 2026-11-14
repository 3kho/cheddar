-- Names are about to become unique (ignoring case). Keep the oldest account's name and tag the
-- later duplicates with a short id suffix; they can change it on /profile.
UPDATE "users" u SET "name" = u."name" || ' #' || substr(u."id"::text, 1, 4)
FROM (
  SELECT "id", row_number() OVER (PARTITION BY lower("name") ORDER BY "created_at", "id") AS rn
  FROM "users" WHERE "name" IS NOT NULL
) d
WHERE u."id" = d."id" AND d.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "users_name_lower_uq" ON "users" USING btree (lower("name"));
