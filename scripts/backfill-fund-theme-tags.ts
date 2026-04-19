/**
 * `FundThemeTag` tablosunu `Fund` kayıtlarından deterministik `inferThemeTagsFromFundFields`
 * ile doldurur veya yeniden yazar. Rebuild pipeline dışında tek başına çalıştırılabilir.
 *
 *   pnpm db:backfill:fund-theme-tags
 */
import "./load-env";
import { prisma } from "../src/lib/prisma";
import { inferThemeTagsFromFundFields } from "../src/lib/services/fund-theme-classification";
import { replaceAllFundThemeTags } from "../src/lib/services/fund-theme-tags.repository";

async function main(): Promise<void> {
  const funds = await prisma.fund.findMany({
    select: { code: true, name: true, shortName: true },
  });
  const tagRows = funds.flatMap((f) =>
    inferThemeTagsFromFundFields(f.name, f.shortName).map((themeId) => ({
      fundCode: f.code.trim().toUpperCase(),
      themeId,
    }))
  );
  const { written } = await replaceAllFundThemeTags(tagRows);
  console.log(
    JSON.stringify({
      ok: true,
      fundRows: funds.length,
      tagPairRowsWritten: written,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
