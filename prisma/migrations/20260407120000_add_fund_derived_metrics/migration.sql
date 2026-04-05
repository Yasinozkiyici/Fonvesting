-- CreateTable
CREATE TABLE "FundDerivedMetrics" (
    "fundId" TEXT NOT NULL,
    "categoryCode" TEXT,
    "fundTypeCode" INTEGER,
    "latestPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "return1d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "return7d" DOUBLE PRECISION,
    "return30d" DOUBLE PRECISION,
    "return90d" DOUBLE PRECISION,
    "return180d" DOUBLE PRECISION,
    "return1y" DOUBLE PRECISION,
    "return2y" DOUBLE PRECISION,
    "volatility1y" DOUBLE PRECISION,
    "volatility2y" DOUBLE PRECISION,
    "maxDrawdown1y" DOUBLE PRECISION,
    "maxDrawdown2y" DOUBLE PRECISION,
    "annualizedReturn1y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sharpe1y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortino1y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReturn2y" DOUBLE PRECISION,
    "investorCount" INTEGER NOT NULL DEFAULT 0,
    "aum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "historySessions" INTEGER NOT NULL DEFAULT 0,
    "sparkline" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundDerivedMetrics_pkey" PRIMARY KEY ("fundId")
);

CREATE INDEX "FundDerivedMetrics_categoryCode_idx" ON "FundDerivedMetrics"("categoryCode");

CREATE INDEX "FundDerivedMetrics_categoryCode_return1y_idx" ON "FundDerivedMetrics"("categoryCode", "return1y" DESC NULLS LAST);

ALTER TABLE "FundDerivedMetrics" ADD CONSTRAINT "FundDerivedMetrics_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "Fund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
