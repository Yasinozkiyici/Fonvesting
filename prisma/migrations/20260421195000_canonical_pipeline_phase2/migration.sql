-- Canonical phase-2 pipeline chain persistence
-- SOURCE FETCH -> RAW INGEST RECORD -> NORMALIZED DAILY SNAPSHOT -> SERVING PUBLISH

CREATE TABLE IF NOT EXISTS "canonical_raw_ingest_runs" (
  "run_id" TEXT PRIMARY KEY,
  "trigger_type" TEXT NOT NULL,
  "source_effective_date" TIMESTAMP(3),
  "fetched_rows" INTEGER NOT NULL DEFAULT 0,
  "written_rows" INTEGER NOT NULL DEFAULT 0,
  "fetch_succeeded" BOOLEAN NOT NULL DEFAULT false,
  "write_succeeded" BOOLEAN NOT NULL DEFAULT false,
  "is_noop" BOOLEAN NOT NULL DEFAULT false,
  "stage_status" TEXT NOT NULL,
  "stage_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "canonical_raw_ingest_runs_source_effective_date_idx"
ON "canonical_raw_ingest_runs" ("source_effective_date" DESC);

CREATE INDEX IF NOT EXISTS "canonical_raw_ingest_runs_updated_at_idx"
ON "canonical_raw_ingest_runs" ("updated_at" DESC);

CREATE TABLE IF NOT EXISTS "canonical_snapshot_runs" (
  "run_id" TEXT PRIMARY KEY,
  "snapshot_date" TIMESTAMP(3),
  "rows_written" INTEGER NOT NULL DEFAULT 0,
  "stage_status" TEXT NOT NULL,
  "stage_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "canonical_snapshot_runs_snapshot_date_idx"
ON "canonical_snapshot_runs" ("snapshot_date" DESC);

CREATE INDEX IF NOT EXISTS "canonical_snapshot_runs_updated_at_idx"
ON "canonical_snapshot_runs" ("updated_at" DESC);

CREATE TABLE IF NOT EXISTS "canonical_serving_publish_runs" (
  "run_id" TEXT PRIMARY KEY,
  "build_id" TEXT,
  "snapshot_date" TIMESTAMP(3),
  "list_rows" INTEGER NOT NULL DEFAULT 0,
  "detail_rows" INTEGER NOT NULL DEFAULT 0,
  "compare_rows" INTEGER NOT NULL DEFAULT 0,
  "discovery_rows" INTEGER NOT NULL DEFAULT 0,
  "stage_status" TEXT NOT NULL,
  "stage_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "canonical_serving_publish_runs_snapshot_date_idx"
ON "canonical_serving_publish_runs" ("snapshot_date" DESC);

CREATE INDEX IF NOT EXISTS "canonical_serving_publish_runs_build_id_idx"
ON "canonical_serving_publish_runs" ("build_id");

CREATE INDEX IF NOT EXISTS "canonical_serving_publish_runs_updated_at_idx"
ON "canonical_serving_publish_runs" ("updated_at" DESC);
