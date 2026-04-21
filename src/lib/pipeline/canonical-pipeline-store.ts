import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CanonicalRawIngestRecord = {
  runId: string;
  triggerType: string;
  sourceEffectiveDate: string | null;
  fetchedRows: number;
  writtenRows: number;
  fetchSucceeded: boolean;
  writeSucceeded: boolean;
  isNoop: boolean;
  stageStatus: "success" | "failed";
  stageReason: string | null;
};

export type CanonicalSnapshotRecord = {
  runId: string;
  snapshotDate: string | null;
  rowsWritten: number;
  stageStatus: "success" | "failed";
  stageReason: string | null;
};

export type CanonicalServingPublishRecord = {
  runId: string;
  buildId: string | null;
  snapshotDate: string | null;
  listRows: number;
  detailRows: number;
  compareRows: number;
  discoveryRows: number;
  stageStatus: "success" | "failed";
  stageReason: string | null;
};

export type CanonicalChartPublishRecord = {
  runId: string;
  buildId: string | null;
  snapshotDate: string | null;
  chartRows: number;
  stageStatus: "success" | "failed";
  stageReason: string | null;
};

export type CanonicalComparisonPublishRecord = {
  runId: string;
  buildId: string | null;
  snapshotDate: string | null;
  comparisonRows: number;
  stageStatus: "success" | "failed";
  stageReason: string | null;
};

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

export async function recordCanonicalRawIngest(input: CanonicalRawIngestRecord): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO canonical_raw_ingest_runs
      (run_id, trigger_type, source_effective_date, fetched_rows, written_rows, fetch_succeeded, write_succeeded, is_noop, stage_status, stage_reason)
      VALUES
      (${input.runId}, ${input.triggerType}, ${toDate(input.sourceEffectiveDate)}, ${input.fetchedRows}, ${input.writtenRows}, ${input.fetchSucceeded}, ${input.writeSucceeded}, ${input.isNoop}, ${input.stageStatus}, ${input.stageReason})
      ON CONFLICT (run_id) DO UPDATE SET
        trigger_type = EXCLUDED.trigger_type,
        source_effective_date = EXCLUDED.source_effective_date,
        fetched_rows = EXCLUDED.fetched_rows,
        written_rows = EXCLUDED.written_rows,
        fetch_succeeded = EXCLUDED.fetch_succeeded,
        write_succeeded = EXCLUDED.write_succeeded,
        is_noop = EXCLUDED.is_noop,
        stage_status = EXCLUDED.stage_status,
        stage_reason = EXCLUDED.stage_reason,
        updated_at = now()
    `
  );
}

export async function recordCanonicalSnapshot(input: CanonicalSnapshotRecord): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO canonical_snapshot_runs
      (run_id, snapshot_date, rows_written, stage_status, stage_reason)
      VALUES
      (${input.runId}, ${toDate(input.snapshotDate)}, ${input.rowsWritten}, ${input.stageStatus}, ${input.stageReason})
      ON CONFLICT (run_id) DO UPDATE SET
        snapshot_date = EXCLUDED.snapshot_date,
        rows_written = EXCLUDED.rows_written,
        stage_status = EXCLUDED.stage_status,
        stage_reason = EXCLUDED.stage_reason,
        updated_at = now()
    `
  );
}

export async function recordCanonicalServingPublish(input: CanonicalServingPublishRecord): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO canonical_serving_publish_runs
      (run_id, build_id, snapshot_date, list_rows, detail_rows, compare_rows, discovery_rows, stage_status, stage_reason)
      VALUES
      (${input.runId}, ${input.buildId}, ${toDate(input.snapshotDate)}, ${input.listRows}, ${input.detailRows}, ${input.compareRows}, ${input.discoveryRows}, ${input.stageStatus}, ${input.stageReason})
      ON CONFLICT (run_id) DO UPDATE SET
        build_id = EXCLUDED.build_id,
        snapshot_date = EXCLUDED.snapshot_date,
        list_rows = EXCLUDED.list_rows,
        detail_rows = EXCLUDED.detail_rows,
        compare_rows = EXCLUDED.compare_rows,
        discovery_rows = EXCLUDED.discovery_rows,
        stage_status = EXCLUDED.stage_status,
        stage_reason = EXCLUDED.stage_reason,
        updated_at = now()
    `
  );
}

export async function readLatestCanonicalSnapshotDate(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date | null }>>(
    Prisma.sql`
      SELECT snapshot_date
      FROM canonical_snapshot_runs
      WHERE stage_status = 'success'
      ORDER BY snapshot_date DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `
  );
  return rows[0]?.snapshot_date?.toISOString() ?? null;
}

export async function readLatestCanonicalServingSnapshotDate(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date | null }>>(
    Prisma.sql`
      SELECT snapshot_date
      FROM canonical_serving_publish_runs
      WHERE stage_status = 'success'
      ORDER BY snapshot_date DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `
  );
  return rows[0]?.snapshot_date?.toISOString() ?? null;
}

export async function recordCanonicalChartPublish(input: CanonicalChartPublishRecord): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO canonical_chart_publish_runs
      (run_id, build_id, snapshot_date, chart_rows, stage_status, stage_reason)
      VALUES
      (${input.runId}, ${input.buildId}, ${toDate(input.snapshotDate)}, ${input.chartRows}, ${input.stageStatus}, ${input.stageReason})
      ON CONFLICT (run_id) DO UPDATE SET
        build_id = EXCLUDED.build_id,
        snapshot_date = EXCLUDED.snapshot_date,
        chart_rows = EXCLUDED.chart_rows,
        stage_status = EXCLUDED.stage_status,
        stage_reason = EXCLUDED.stage_reason,
        updated_at = now()
    `
  );
}

export async function recordCanonicalComparisonPublish(input: CanonicalComparisonPublishRecord): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO canonical_comparison_publish_runs
      (run_id, build_id, snapshot_date, comparison_rows, stage_status, stage_reason)
      VALUES
      (${input.runId}, ${input.buildId}, ${toDate(input.snapshotDate)}, ${input.comparisonRows}, ${input.stageStatus}, ${input.stageReason})
      ON CONFLICT (run_id) DO UPDATE SET
        build_id = EXCLUDED.build_id,
        snapshot_date = EXCLUDED.snapshot_date,
        comparison_rows = EXCLUDED.comparison_rows,
        stage_status = EXCLUDED.stage_status,
        stage_reason = EXCLUDED.stage_reason,
        updated_at = now()
    `
  );
}

export async function readLatestCanonicalChartSnapshotDate(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date | null }>>(
    Prisma.sql`
      SELECT snapshot_date
      FROM canonical_chart_publish_runs
      WHERE stage_status = 'success'
      ORDER BY snapshot_date DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `
  );
  return rows[0]?.snapshot_date?.toISOString() ?? null;
}

export async function readLatestCanonicalComparisonSnapshotDate(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ snapshot_date: Date | null }>>(
    Prisma.sql`
      SELECT snapshot_date
      FROM canonical_comparison_publish_runs
      WHERE stage_status = 'success'
      ORDER BY snapshot_date DESC NULLS LAST, updated_at DESC
      LIMIT 1
    `
  );
  return rows[0]?.snapshot_date?.toISOString() ?? null;
}
