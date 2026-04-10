CREATE INDEX IF NOT EXISTS "FundPriceHistory_date_idx"
ON public."FundPriceHistory" ("date" DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_date_fundTypeCode_portfolioSize_idx"
ON public."FundDailySnapshot" ("date" DESC, "fundTypeCode", "portfolioSize" DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_date_finalScoreLowRisk_idx"
ON public."FundDailySnapshot" ("date" DESC, "finalScoreLowRisk" DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_date_finalScoreHighReturn_idx"
ON public."FundDailySnapshot" ("date" DESC, "finalScoreHighReturn" DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_date_finalScoreStable_idx"
ON public."FundDailySnapshot" ("date" DESC, "finalScoreStable" DESC);

CREATE INDEX IF NOT EXISTS "SyncLog_syncType_startedAt_idx"
ON public."SyncLog" ("syncType", "startedAt" DESC);
