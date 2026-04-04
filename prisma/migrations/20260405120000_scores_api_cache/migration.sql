-- CreateTable
CREATE TABLE "ScoresApiCache" (
    "cacheKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoresApiCache_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateIndex
CREATE INDEX "Fund_categoryId_idx" ON "Fund"("categoryId");
