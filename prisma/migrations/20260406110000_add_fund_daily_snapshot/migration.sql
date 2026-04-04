-- CreateTable
CREATE TABLE "public"."FundDailySnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fundId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "logoUrl" TEXT,
    "categoryCode" TEXT,
    "categoryName" TEXT,
    "fundTypeCode" INTEGER,
    "fundTypeName" TEXT,
    "riskLevel" TEXT NOT NULL,
    "lastPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yearlyReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "portfolioSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    "alpha" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sparkline" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "finalScoreBest" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalScoreLowRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalScoreHighReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalScoreStable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundDailySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundDailySnapshot_date_idx" ON "public"."FundDailySnapshot"("date" DESC);

-- CreateIndex
CREATE INDEX "FundDailySnapshot_date_categoryCode_idx" ON "public"."FundDailySnapshot"("date" DESC, "categoryCode");

-- CreateIndex
CREATE INDEX "FundDailySnapshot_date_finalScoreBest_idx" ON "public"."FundDailySnapshot"("date" DESC, "finalScoreBest" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FundDailySnapshot_fundId_date_key" ON "public"."FundDailySnapshot"("fundId", "date");

-- AddForeignKey
ALTER TABLE "public"."FundDailySnapshot" ADD CONSTRAINT "FundDailySnapshot_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "public"."Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
