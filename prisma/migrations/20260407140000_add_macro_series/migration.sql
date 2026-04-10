CREATE TABLE "public"."MacroSeries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceSymbol" TEXT,
    "frequency" TEXT NOT NULL,
    "unit" TEXT,
    "currency" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MacroObservation" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MacroSyncState" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "earliestHistoryDate" TIMESTAMP(3),
    "latestHistoryDate" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroSyncState_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "MacroSeries_code_key" ON "public"."MacroSeries"("code");
CREATE INDEX "MacroSeries_source_idx" ON "public"."MacroSeries"("source");
CREATE INDEX "MacroObservation_date_idx" ON "public"."MacroObservation"("date" DESC);
CREATE INDEX "MacroObservation_seriesId_date_idx" ON "public"."MacroObservation"("seriesId", "date" DESC);
CREATE UNIQUE INDEX "MacroObservation_seriesId_date_key" ON "public"."MacroObservation"("seriesId", "date");

ALTER TABLE "public"."MacroObservation"
ADD CONSTRAINT "MacroObservation_seriesId_fkey"
FOREIGN KEY ("seriesId") REFERENCES "public"."MacroSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
