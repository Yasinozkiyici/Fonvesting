CREATE INDEX IF NOT EXISTS "Fund_isActive_portfolioSize_idx"
ON public."Fund" ("isActive", "portfolioSize" DESC);

CREATE INDEX IF NOT EXISTS "Fund_isActive_dailyReturn_idx"
ON public."Fund" ("isActive", "dailyReturn" DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_code_date_idx"
ON public."FundDailySnapshot" (code, date DESC);

CREATE INDEX IF NOT EXISTS "FundDailySnapshot_date_categoryCode_portfolioSize_idx"
ON public."FundDailySnapshot" (date DESC, "categoryCode", "portfolioSize" DESC);
