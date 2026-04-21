-- Canonical publish stage records for CUTOVER PHASE 4

CREATE TABLE "canonical_chart_publish_runs" (
  "run_id" TEXT NOT NULL,
  "build_id" TEXT,
  "snapshot_date" TIMESTAMP(3),
  "chart_rows" INTEGER NOT NULL DEFAULT 0,
  "stage_status" TEXT NOT NULL,
  "stage_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canonical_chart_publish_runs_pkey" PRIMARY KEY ("run_id")
);

CREATE INDEX "canonical_chart_publish_runs_snapshot_date_idx"
  ON "canonical_chart_publish_runs"("snapshot_date" DESC);
CREATE INDEX "canonical_chart_publish_runs_build_id_idx"
  ON "canonical_chart_publish_runs"("build_id");
CREATE INDEX "canonical_chart_publish_runs_updated_at_idx"
  ON "canonical_chart_publish_runs"("updated_at" DESC);

CREATE TABLE "canonical_comparison_publish_runs" (
  "run_id" TEXT NOT NULL,
  "build_id" TEXT,
  "snapshot_date" TIMESTAMP(3),
  "comparison_rows" INTEGER NOT NULL DEFAULT 0,
  "stage_status" TEXT NOT NULL,
  "stage_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canonical_comparison_publish_runs_pkey" PRIMARY KEY ("run_id")
);

CREATE INDEX "canonical_comparison_publish_runs_snapshot_date_idx"
  ON "canonical_comparison_publish_runs"("snapshot_date" DESC);
CREATE INDEX "canonical_comparison_publish_runs_build_id_idx"
  ON "canonical_comparison_publish_runs"("build_id");
CREATE INDEX "canonical_comparison_publish_runs_updated_at_idx"
  ON "canonical_comparison_publish_runs"("updated_at" DESC);
