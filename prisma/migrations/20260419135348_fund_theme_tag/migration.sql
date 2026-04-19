-- AlterTable
ALTER TABLE "public"."FundDerivedMetrics" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."fund_theme_tag" (
    "fund_code" TEXT NOT NULL,
    "theme_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'inferred_v1',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fund_theme_tag_pkey" PRIMARY KEY ("fund_code","theme_id")
);

-- CreateIndex
CREATE INDEX "fund_theme_tag_theme_id_idx" ON "public"."fund_theme_tag"("theme_id");

-- CreateIndex
CREATE INDEX "fund_theme_tag_fund_code_idx" ON "public"."fund_theme_tag"("fund_code");
