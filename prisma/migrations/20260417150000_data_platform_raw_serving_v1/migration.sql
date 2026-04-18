-- Data platform v1: raw archive + serving materializations + fund_health_daily
-- Parallel-run: mevcut tablolara dokunulmaz.

CREATE TYPE "RawPayloadParseStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

CREATE TABLE "raw_market_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "parse_status" "RawPayloadParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_market_payloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raw_fund_metadata_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "parse_status" "RawPayloadParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_fund_metadata_payloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raw_investor_counts_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "parse_status" "RawPayloadParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_investor_counts_payloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raw_prices_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "parse_status" "RawPayloadParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_prices_payloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "raw_portfolio_breakdowns_payloads" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_date" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "parse_status" "RawPayloadParseStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "raw_portfolio_breakdowns_payloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fund_health_daily" (
    "id" TEXT NOT NULL,
    "fund_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "completeness_score" DOUBLE PRECISION,
    "missing_fields" JSONB,
    "diagnostics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fund_health_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "serving_fund_list" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "snapshot_as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serving_fund_list_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "serving_fund_detail" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "fund_code" TEXT NOT NULL,
    "snapshot_as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serving_fund_detail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "serving_compare_inputs" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "snapshot_as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serving_compare_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "serving_discovery_index" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "snapshot_as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serving_discovery_index_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "serving_system_status" (
    "id" TEXT NOT NULL,
    "build_id" TEXT NOT NULL,
    "snapshot_as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "payload" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "serving_system_status_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "raw_market_payloads_source_fetched_at_idx" ON "raw_market_payloads"("source", "fetched_at" DESC);
CREATE INDEX "raw_market_payloads_checksum_idx" ON "raw_market_payloads"("checksum");
CREATE INDEX "raw_market_payloads_effective_date_idx" ON "raw_market_payloads"("effective_date");

CREATE INDEX "raw_fund_metadata_payloads_source_fetched_at_idx" ON "raw_fund_metadata_payloads"("source", "fetched_at" DESC);
CREATE INDEX "raw_fund_metadata_payloads_checksum_idx" ON "raw_fund_metadata_payloads"("checksum");
CREATE INDEX "raw_fund_metadata_payloads_effective_date_idx" ON "raw_fund_metadata_payloads"("effective_date");

CREATE INDEX "raw_investor_counts_payloads_source_fetched_at_idx" ON "raw_investor_counts_payloads"("source", "fetched_at" DESC);
CREATE INDEX "raw_investor_counts_payloads_checksum_idx" ON "raw_investor_counts_payloads"("checksum");
CREATE INDEX "raw_investor_counts_payloads_effective_date_idx" ON "raw_investor_counts_payloads"("effective_date");

CREATE INDEX "raw_prices_payloads_source_fetched_at_idx" ON "raw_prices_payloads"("source", "fetched_at" DESC);
CREATE INDEX "raw_prices_payloads_checksum_idx" ON "raw_prices_payloads"("checksum");
CREATE INDEX "raw_prices_payloads_effective_date_idx" ON "raw_prices_payloads"("effective_date");

CREATE INDEX "raw_portfolio_breakdowns_payloads_source_fetched_at_idx" ON "raw_portfolio_breakdowns_payloads"("source", "fetched_at" DESC);
CREATE INDEX "raw_portfolio_breakdowns_payloads_checksum_idx" ON "raw_portfolio_breakdowns_payloads"("checksum");
CREATE INDEX "raw_portfolio_breakdowns_payloads_effective_date_idx" ON "raw_portfolio_breakdowns_payloads"("effective_date");

CREATE UNIQUE INDEX "fund_health_daily_fund_id_date_key" ON "fund_health_daily"("fund_id", "date");
CREATE INDEX "fund_health_daily_date_idx" ON "fund_health_daily"("date" DESC);

CREATE UNIQUE INDEX "serving_fund_list_build_id_key" ON "serving_fund_list"("build_id");
CREATE INDEX "serving_fund_list_snapshot_as_of_idx" ON "serving_fund_list"("snapshot_as_of" DESC);

CREATE UNIQUE INDEX "serving_fund_detail_build_id_fund_code_key" ON "serving_fund_detail"("build_id", "fund_code");
CREATE INDEX "serving_fund_detail_fund_code_snapshot_as_of_idx" ON "serving_fund_detail"("fund_code", "snapshot_as_of" DESC);

CREATE UNIQUE INDEX "serving_compare_inputs_build_id_key" ON "serving_compare_inputs"("build_id");
CREATE INDEX "serving_compare_inputs_snapshot_as_of_idx" ON "serving_compare_inputs"("snapshot_as_of" DESC);

CREATE UNIQUE INDEX "serving_discovery_index_build_id_key" ON "serving_discovery_index"("build_id");
CREATE INDEX "serving_discovery_index_snapshot_as_of_idx" ON "serving_discovery_index"("snapshot_as_of" DESC);

CREATE UNIQUE INDEX "serving_system_status_build_id_key" ON "serving_system_status"("build_id");
CREATE INDEX "serving_system_status_snapshot_as_of_idx" ON "serving_system_status"("snapshot_as_of" DESC);

ALTER TABLE "fund_health_daily" ADD CONSTRAINT "fund_health_daily_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
