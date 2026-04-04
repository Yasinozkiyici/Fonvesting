-- CreateTable
CREATE TABLE "public"."HistorySyncState" (
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "earliestHistoryDate" TIMESTAMP(3),
    "latestHistoryDate" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistorySyncState_pkey" PRIMARY KEY ("key")
);
