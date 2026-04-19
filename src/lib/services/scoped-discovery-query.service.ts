/**
 * Faz 3: Keşif kapsamı (tema / kategori / metin) sunucuda önce daraltılır, sonra sıralama ve satır limiti uygulanır.
 * Geniş payload çekip bellekte süzme (wide-fetch + post-filter) kanonik davranış değildir.
 */
import { Prisma } from "@prisma/client";
import type { RankingMode } from "@/lib/scoring";
import { fundSearchMatches } from "@/lib/fund-search";
import type { FundThemeId } from "@/lib/fund-themes";
import { fundTypeForApi } from "@/lib/fund-type-display";
import { getFundLogoUrlForUi } from "@/lib/services/fund-logo.service";
import type { ScoredFundRow, ScoresApiPayload } from "@/lib/services/fund-scores-types";
import { createScoresPayload } from "@/lib/services/fund-scores-semantics";
import { attachThemeTagsToScoredRows } from "@/lib/services/fund-theme-tags.repository";
import { fundRowMatchesCanonicalTheme } from "@/lib/services/fund-theme-classification";
import { prisma } from "@/lib/prisma";
import type { ServingDiscoveryRow, ServingListRow } from "@/lib/data-platform/read-side-serving";
import {
  DEFAULT_SCOPED_DISCOVERY_LIMIT,
  MAX_SCOPED_DISCOVERY_API_LIMIT,
} from "@/lib/contracts/discovery-limits";

function isRelationMissingError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

type SnapshotScoreKey =
  | "finalScoreBest"
  | "finalScoreLowRisk"
  | "finalScoreHighReturn"
  | "finalScoreStable";

function snapshotScoreField(mode: RankingMode): SnapshotScoreKey {
  if (mode === "LOW_RISK") return "finalScoreLowRisk";
  if (mode === "HIGH_RETURN") return "finalScoreHighReturn";
  if (mode === "STABLE") return "finalScoreStable";
  return "finalScoreBest";
}

function snapshotOrderBy(
  mode: RankingMode
): Prisma.FundDailySnapshotOrderByWithRelationInput[] {
  const key = snapshotScoreField(mode);
  return [{ [key]: "desc" }, { code: "asc" }];
}

/**
 * Tema veya metin süzgeci varken istemci limit göndermese bile dar pencere kullanılır (geniş çekim yok).
 * Yalnızca kategori veya filtresiz evren: snapshot’tan tam liste (limit isteğe bağlı).
 */
export function resolveEffectiveScoresLimit(params: {
  requested: number | null;
  theme: FundThemeId | null;
  queryTrim: string;
}): number | null {
  if (params.requested != null && params.requested > 0) {
    return Math.min(params.requested, MAX_SCOPED_DISCOVERY_API_LIMIT);
  }
  if (params.theme || params.queryTrim.trim()) {
    return DEFAULT_SCOPED_DISCOVERY_LIMIT;
  }
  return null;
}

export type ScopedDailySnapshotParams = {
  mode: RankingMode;
  categoryKey: string;
  theme: FundThemeId | null;
  queryTrim: string;
  /** Uygulanacak satır üst sınırı (sıralama sonrası dilim). */
  resultLimit: number;
};

/**
 * Günlük snapshot üzerinde kapsam önce daraltılır; tema `FundThemeTag` + satır etiketleri ile uyumludur.
 */
export async function getScopedScoresPayloadFromDailySnapshot(
  params: ScopedDailySnapshotParams
): Promise<ScoresApiPayload | null> {
  const category = String(params.categoryKey ?? "").trim();
  const q = params.queryTrim.trim();
  const theme = params.theme;
  const mode = params.mode;
  const resultLimit = Math.max(1, Math.min(params.resultLimit, MAX_SCOPED_DISCOVERY_API_LIMIT));

  let latest: { date: Date } | null = null;
  try {
    latest = await prisma.fundDailySnapshot.findFirst({
      orderBy: { date: "desc" },
      select: { date: true },
    });
  } catch (error) {
    if (isRelationMissingError(error)) return null;
    throw error;
  }
  if (!latest) return null;

  const date = latest.date;
  const universeWhere: Prisma.FundDailySnapshotWhereInput = {
    date,
    ...(category ? { categoryCode: category } : {}),
  };

  const orderBy = snapshotOrderBy(mode);
  const scoreKey = snapshotScoreField(mode);

  const select = {
    fundId: true,
    code: true,
    name: true,
    shortName: true,
    logoUrl: true,
    lastPrice: true,
    dailyReturn: true,
    portfolioSize: true,
    investorCount: true,
    categoryCode: true,
    categoryName: true,
    fundTypeCode: true,
    fundTypeName: true,
    finalScoreBest: true,
    finalScoreLowRisk: true,
    finalScoreHighReturn: true,
    finalScoreStable: true,
  } satisfies Prisma.FundDailySnapshotSelect;

  let themedCodes: string[] | null = null;
  if (theme) {
    try {
      const tagRows = await prisma.fundThemeTag.findMany({
        where: { themeId: theme },
        select: { fundCode: true },
      });
      themedCodes = [...new Set(tagRows.map((r) => r.fundCode.trim().toUpperCase()))];
    } catch (error) {
      if (isRelationMissingError(error)) return null;
      throw error;
    }
    if (themedCodes.length === 0) {
      try {
        const [uTotal] = await Promise.all([prisma.fundDailySnapshot.count({ where: universeWhere })]);
        return createScoresPayload({
          mode,
          funds: [],
          universeTotal: uTotal,
          matchedTotal: 0,
          ...(q ? { appliedQuery: q } : {}),
        });
      } catch (error) {
        if (isRelationMissingError(error)) return null;
        throw error;
      }
    }
  }

  const matchWhere: Prisma.FundDailySnapshotWhereInput = {
    ...universeWhere,
    ...(themedCodes ? { code: { in: themedCodes } } : {}),
  };

  let universeTotal: number;
  let matchedTotal: number;
  let funds: ScoredFundRow[];

  try {
    const [uCount, mCount, rawRows] = await Promise.all([
      prisma.fundDailySnapshot.count({ where: universeWhere }),
      prisma.fundDailySnapshot.count({ where: matchWhere }),
      prisma.fundDailySnapshot.findMany({
        where: matchWhere,
        orderBy,
        ...(q
          ? { take: Math.min(5000, Math.max(resultLimit * 40, 800)) }
          : { take: resultLimit }),
        select,
      }),
    ]);
    universeTotal = uCount;
    matchedTotal = mCount;

    let mapped: ScoredFundRow[] = rawRows.map((row) => ({
      fundId: row.fundId,
      code: row.code,
      name: row.name,
      shortName: row.shortName,
      logoUrl: getFundLogoUrlForUi(row.fundId, row.code, row.logoUrl, row.name),
      lastPrice: row.lastPrice,
      dailyReturn: row.dailyReturn,
      portfolioSize: row.portfolioSize,
      investorCount: row.investorCount,
      category: row.categoryCode && row.categoryName ? { code: row.categoryCode, name: row.categoryName } : null,
      fundType:
        row.fundTypeCode != null && row.fundTypeName
          ? fundTypeForApi({ code: row.fundTypeCode, name: row.fundTypeName })
          : null,
      finalScore: row[scoreKey],
    }));
    mapped = await attachThemeTagsToScoredRows(mapped);

    if (q) {
      const filtered = mapped.filter((f) => fundSearchMatches(q, [f.code, f.name, f.shortName]));
      matchedTotal = filtered.length;
      funds = filtered.slice(0, resultLimit);
    } else {
      funds = mapped;
    }
  } catch (error) {
    if (isRelationMissingError(error)) return null;
    throw error;
  }

  return createScoresPayload({
    mode,
    funds,
    universeTotal,
    matchedTotal,
    ...(q ? { appliedQuery: q } : {}),
  });
}

export type ServingScopeFirstParams = {
  mode: RankingMode;
  rankedRows: ServingDiscoveryRow[];
  fundsByCode: Map<string, ServingListRow>;
  categoryCode: string;
  theme: FundThemeId | null;
  queryTrim: string;
  universeTotal: number;
  resultLimit: number | null;
};

/**
 * Serving discovery sıralamasını koruyarak tema/metin süzmesini birleştirmeden önce uygular.
 */
export function materializeServingDiscoveryScopeFirst(input: ServingScopeFirstParams): ScoresApiPayload {
  const q = input.queryTrim.trim();
  const cat = input.categoryCode.trim();
  const limit =
    input.resultLimit != null && input.resultLimit > 0
      ? Math.min(Math.trunc(input.resultLimit), MAX_SCOPED_DISCOVERY_API_LIMIT)
      : null;

  const matched: ScoredFundRow[] = [];
  for (const row of input.rankedRows) {
    if (cat && row.categoryCode !== cat) continue;
    const fund = input.fundsByCode.get(row.code.trim().toUpperCase());
    if (!fund) continue;
    const scored: ScoredFundRow = {
      fundId: fund.code,
      code: fund.code,
      name: fund.name,
      shortName: fund.shortName,
      logoUrl: getFundLogoUrlForUi(fund.code, fund.code, null, fund.name),
      lastPrice: fund.lastPrice,
      dailyReturn: fund.dailyReturn,
      portfolioSize: fund.portfolioSize,
      investorCount: fund.investorCount,
      category: fund.categoryCode ? { code: fund.categoryCode, name: fund.categoryCode } : null,
      fundType: fund.fundTypeCode != null ? { code: fund.fundTypeCode, name: String(fund.fundTypeCode) } : null,
      finalScore: row.score,
      themeTags: fund.themeTags,
    };
    if (input.theme && !fundRowMatchesCanonicalTheme(scored, input.theme)) continue;
    if (q && !fundSearchMatches(q, [scored.code, scored.name, scored.shortName])) continue;
    matched.push(scored);
  }

  const sliced = limit != null ? matched.slice(0, limit) : matched;
  return createScoresPayload({
    mode: input.mode,
    funds: sliced,
    universeTotal: input.universeTotal,
    matchedTotal: matched.length,
    ...(q ? { appliedQuery: q } : {}),
  });
}
