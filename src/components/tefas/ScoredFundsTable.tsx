"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  SlidersHorizontal,
  ArrowDownWideNarrow,
} from "@/components/icons";
import type { RankingMode } from "@/lib/scoring";
import type { ScoredFund, ScoredResponse } from "@/types/scored-funds";
import { FundRowMobile, FundDataTableRow } from "@/components/ds/FundRow";
import { CompareListEntry } from "@/components/compare/CompareListEntry";
import { MobileBottomSheet } from "@/components/ds/MobileBottomSheet";
import {
  fetchNormalizedJson,
  fetchNormalizedJsonWithMeta,
  normalizeCategoryOptions,
  normalizeFundListResponse,
  normalizeScoredResponse,
} from "@/lib/client-data";
import { readScoresUniverseTotal } from "@/lib/scores-response-counts";
import { shouldStopBootstrapRetries } from "@/lib/scored-funds-bootstrap";
import { DEFAULT_SCOPED_DISCOVERY_LIMIT } from "@/lib/contracts/discovery-limits";
import { fundRowMatchesCanonicalTheme } from "@/lib/services/fund-theme-classification";
import { getFundTheme, type FundThemeId } from "@/lib/fund-themes";
import { fundTypeSortKey } from "@/lib/fund-type-display";
import {
  getFundIntent,
  resolveFundIntentCategory,
  type FundIntentId,
} from "@/lib/fund-intents";
import { fundSearchMatches, normalizeFundSearchText } from "@/lib/fund-search";
import {
  deriveDiscoverySurfaceState,
  type DiscoverySurfaceState,
} from "@/lib/contracts/discovery-surface-state";
import {
  resolveHomepageRegisteredTotal,
} from "@/lib/data-flow/homepage-discovery-surface";

export type { ScoredFund, ScoredResponse };

type SortField = "portfolioSize" | "dailyReturn" | "investorCount" | "lastPrice" | "fundType" | "finalScore";

type SortDir = "asc" | "desc";
const DEFAULT_SORT_FIELD: SortField = "portfolioSize";
const DEFAULT_SORT_DIR: SortDir = "desc";
const SCORES_FETCH_TIMEOUT_MS_DEFAULT = 22_000;
const SCORES_FETCH_TIMEOUT_MS_HIGH_RETURN = 24_000;
const SCORES_BOOTSTRAP_RETRY_MS = 3_500;
const SCORES_BOOTSTRAP_MAX_RETRY = 3;
const SCORES_CORE_ROWS_FALLBACK_TIMEOUT_MS = 6_500;
const SCORES_CORE_ROWS_FALLBACK_PAGE_SIZE = 120;
const SCORES_LAST_GOOD_STORAGE_KEY = "scores-table:last-good:v1";

type BootstrapSource = "ssr" | "last_good" | "bootstrap_fallback" | "valid_empty";
type StoredLastGoodPayload = { payload: ScoredResponse; scopeKey: string | null };

function buildScoresScopeKey(
  mode: RankingMode,
  category: string,
  theme: FundThemeId | null,
  query = ""
): string {
  const normalizedCategory = category.trim().toUpperCase();
  const normalizedQuery = normalizeFundSearchText(query);
  return `${mode}|${normalizedCategory || "all"}|${theme ?? "none"}|q:${normalizedQuery || "none"}`;
}

/** Aynı mod / kategori / tema iken yalnızca arama metni (q) değişti mi — geçişte boş ekran / iskelet flaşı önlemek için. */
function stripScoresScopeQuerySuffix(scopeKey: string): string {
  const idx = scopeKey.lastIndexOf("|q:");
  if (idx === -1) return scopeKey;
  return scopeKey.slice(0, idx);
}

function rankingModeLabel(mode: RankingMode): string {
  if (mode === "LOW_RISK") return "Düşük Risk";
  if (mode === "HIGH_RETURN") return "Yüksek Getiri";
  if (mode === "STABLE") return "Stabil";
  return "En İyi";
}

export function formatHomepageCountCaption(input: {
  shown: number;
  registeredTotal: number | null;
  loadedCount: number;
  hasFilters: boolean;
  filteredHint: string | null;
}): string {
  const shownStr = input.shown.toLocaleString("tr-TR");
  if (input.registeredTotal == null) {
    if (input.hasFilters) {
      return `${shownStr} fon · ${input.filteredHint ?? "filtre"} (tam evren bilinmiyor)`;
    }
    return `Önizleme: ${shownStr} · Tam evren bilinmiyor`;
  }
  const regStr = input.registeredTotal.toLocaleString("tr-TR");
  const fullUniverse = input.shown === input.registeredTotal;
  if (input.hasFilters) {
    if (fullUniverse) return `${shownStr} fon · ${input.filteredHint ?? "filtre"}`;
    return `${shownStr} fon · ${input.filteredHint ?? "filtre"} (evren ${regStr})`;
  }
  if (fullUniverse) return `${shownStr} fon · tam evren`;
  // Homepage integrity guard: preview satır sayısını tam evren gibi göstermeyelim.
  if (input.loadedCount < input.registeredTotal || input.registeredTotal > input.shown) {
    return `Önizleme: ${shownStr} · Evren: ${regStr}`;
  }
  return `${shownStr} fon listeleniyor`;
}

function headerValue(headers: Headers, key: string): string {
  return (headers.get(key) ?? "").trim();
}

function isDegradedEmptyResponse(headers: Headers, payload: ScoredResponse): boolean {
  if (payload.funds.length > 0) return false;
  const degraded = headerValue(headers, "x-scores-degraded");
  const source = headerValue(headers, "x-scores-source");
  const emptyResult = headerValue(headers, "x-scores-empty-result");
  if (emptyResult === "degraded") return true;
  if (degraded) return true;
  if (source === "empty") return true;
  return false;
}

function isValidBusinessEmptyResponse(headers: Headers, payload: ScoredResponse): boolean {
  if (payload.funds.length > 0) return false;
  const emptyResult = headerValue(headers, "x-scores-empty-result");
  return emptyResult === "valid";
}

function scoresFetchTimeoutForMode(mode: RankingMode): number {
  if (mode === "HIGH_RETURN") return SCORES_FETCH_TIMEOUT_MS_HIGH_RETURN;
  return SCORES_FETCH_TIMEOUT_MS_DEFAULT;
}

function isTimeoutLikeClientError(cause: unknown): boolean {
  if (cause instanceof DOMException && cause.name === "AbortError") return true;
  if (!(cause instanceof Error)) return false;
  const message = cause.message.toLowerCase();
  return message.includes("zaman aşımına uğradı") || message.includes("timeout");
}

function mapFundsPayloadToScoredResponse(
  mode: RankingMode,
  payload: {
  items: Array<{
    id: string;
    code: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
    portfolioSize: number;
    lastPrice: number;
    dailyReturn: number;
    investorCount: number;
    category: { code: string; name: string; color: string | null } | null;
    fundType: { code: number; name: string } | null;
  }>;
    total: number;
  }
): ScoredResponse {
  const funds = payload.items.map((item) => ({
      fundId: item.id,
      code: item.code,
      name: item.name,
      shortName: item.shortName,
      logoUrl: item.logoUrl,
      lastPrice: item.lastPrice,
      dailyReturn: item.dailyReturn,
      portfolioSize: item.portfolioSize,
      investorCount: item.investorCount,
      category: item.category ? { code: item.category.code, name: item.category.name } : null,
      fundType: item.fundType ? { code: item.fundType.code, name: item.fundType.name } : null,
      finalScore: null,
    }));
  const returnedCount = funds.length;
  const universeTotal = payload.total;
  return {
    mode,
    total: universeTotal,
    universeTotal,
    matchedTotal: universeTotal,
    returnedCount,
    funds,
  };
}

function readStoredLastGoodPayload(): StoredLastGoodPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SCORES_LAST_GOOD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    let payloadInput: unknown = parsed;
    let scopeKey: string | null = null;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "payload" in parsed
    ) {
      const record = parsed as { payload?: unknown; scopeKey?: unknown };
      payloadInput = record.payload;
      if (typeof record.scopeKey === "string" && record.scopeKey.trim()) {
        scopeKey = record.scopeKey.trim();
      }
    }
    const payload = normalizeScoredResponse(payloadInput);
    if (!payload) return null;
    return { payload, scopeKey: scopeKey ?? buildScoresScopeKey(payload.mode, "", null) };
  } catch {
    return null;
  }
}

function persistStoredLastGoodPayload(payload: ScoredResponse, scopeKey: string): void {
  if (typeof window === "undefined") return;
  if (!Array.isArray(payload.funds) || payload.funds.length === 0) return;
  try {
    window.sessionStorage.setItem(
      SCORES_LAST_GOOD_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        scopeKey,
        payload,
      })
    );
  } catch {
    // sessionStorage quota / privacy mode vb. durumlarda sessiz geç.
  }
}

interface ScoredFundsTableProps {
  enableCategoryFilter?: boolean;
  defaultMode?: RankingMode;
  initialData?: ScoredResponse | null;
  initialDataIsPartial?: boolean;
  initialCategories?: Array<{ code: string; name: string }>;
  initialMode?: RankingMode;
  initialQuery?: string;
  initialCategory?: string;
  initialIntent?: FundIntentId | null;
  initialTheme?: FundThemeId | null;
  /** Ana sayfa hızlı başlangıç ile tablo üstü bağlam çubuğu */
  quickStartActive?: boolean;
  quickStartLabel?: string | null;
  quickStartUniverseHint?: string | null;
  quickStartOnClear?: () => void;
  /**
   * Kanonik keşif evreni toplamı (SSR veya güvenilir client yanıtı).
   * null ise satır sayısı / payload.total ile asla doldurulmaz.
   */
  referenceUniverseTotal?: number | null;
  /** Keşif: tablo ile aynı `/api/funds/scores` yanıtını öne çıkan üçlü vb. ile paylaşır. */
  onDiscoveryPayloadReady?: (payload: ScoredResponse) => void;
}

export default function ScoredFundsTable({
  enableCategoryFilter = true,
  defaultMode = "BEST",
  initialData = null,
  initialDataIsPartial = false,
  initialCategories = [],
  initialMode = defaultMode,
  initialQuery = "",
  initialCategory = "",
  initialIntent = null,
  initialTheme = null,
  quickStartActive = false,
  quickStartLabel = null,
  quickStartUniverseHint = null,
  quickStartOnClear,
  referenceUniverseTotal = null,
  onDiscoveryPayloadReady,
}: ScoredFundsTableProps) {
  const seededInitialData = normalizeScoredResponse(initialData);
  const seededInitialDataLooksPartial = Boolean(
    seededInitialData &&
      seededInitialData.funds.length > 0 &&
      readScoresUniverseTotal(seededInitialData) > seededInitialData.funds.length
  );
  const seededCategories = normalizeCategoryOptions(initialCategories);
  const initialScopeKey = buildScoresScopeKey(
    initialMode,
    enableCategoryFilter ? initialCategory : "",
    initialTheme,
    initialQuery
  );
  const [rankingMode, setRankingMode] = useState<RankingMode>(initialMode);
  const [modePayloads, setModePayloads] = useState<Partial<Record<RankingMode, ScoredResponse>>>(() =>
    seededInitialData ? { [initialMode]: seededInitialData } : {}
  );
  const [modePayloadScopes, setModePayloadScopes] = useState<Partial<Record<RankingMode, string>>>(() =>
    seededInitialData ? { [initialMode]: initialScopeKey } : {}
  );
  const modePayloadsRef = useRef(modePayloads);
  modePayloadsRef.current = modePayloads;
  const modePayloadScopesRef = useRef(modePayloadScopes);
  modePayloadScopesRef.current = modePayloadScopes;

  const hasInitialForCurrentMode = Boolean(seededInitialData && rankingMode === initialMode);
  const [loading, setLoading] = useState(!hasInitialForCurrentMode);
  const [error, setError] = useState<string | null>(null);
  const [degradedNotice, setDegradedNotice] = useState<string | null>(null);
  const [lastGoodPayload, setLastGoodPayload] = useState<ScoredResponse | null>(() => {
    if (seededInitialData && seededInitialData.funds.length > 0) return seededInitialData;
    return null;
  });
  const [lastGoodScopeKey, setLastGoodScopeKey] = useState<string | null>(() => {
    if (seededInitialData && seededInitialData.funds.length > 0) return initialScopeKey;
    return null;
  });
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [bootstrapFallbackActive, setBootstrapFallbackActive] = useState(false);
  const [bootstrapAttemptCount, setBootstrapAttemptCount] = useState(0);
  const [bootstrapRetryTick, setBootstrapRetryTick] = useState(0);
  const firstRowsProbeRef = useRef<{ mode: RankingMode; startedAt: number; logged: boolean } | null>(null);
  const initialScopeRefreshDoneRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const [lastScoresMeta, setLastScoresMeta] = useState<{
    degraded: string;
    source: string;
    emptyResult: string;
  }>({
    degraded: "",
    source: "",
    emptyResult: "",
  });
  const [lastDiscoveryHealth, setLastDiscoveryHealth] = useState({
    overall: "unknown",
    scope: "unknown",
    completeness: "unknown",
    freshness: "unknown",
    request: "unknown",
  });
  const [lastFreshnessState, setLastFreshnessState] = useState<"fresh" | "stale_ok" | "degraded_outdated" | "unknown">("unknown");
  const [lastFreshnessReason, setLastFreshnessReason] = useState<string>("none");
  const [bootstrapSource, setBootstrapSource] = useState<BootstrapSource>(() => {
    if (seededInitialData && seededInitialData.funds.length > 0) return "ssr";
    return "bootstrap_fallback";
  });
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>(DEFAULT_SORT_FIELD);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT_DIR);
  const [search, setSearch] = useState(initialQuery);
  const [category, setCategory] = useState(enableCategoryFilter ? initialCategory : "");
  const [activeIntent, setActiveIntent] = useState<FundIntentId | null>(initialIntent);
  const [activeTheme, setActiveTheme] = useState<FundThemeId | null>(initialTheme);
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>(seededCategories);
  const [mobileSheet, setMobileSheet] = useState<null | "filters" | "sort">(null);
  const prevRankingModeRef = useRef<RankingMode | null>(null);
  /** Arama metninde useDeferredValue kullanma: bir kare gecikmede q:none kapsamı + boş deferred filtre, kod aramasında (ör. ZP8) satırın kaybolmasına yol açıyor. */
  const activeQuery = search.trim();
  const pageSize = 50;
  const currentFetchScopeKey = buildScoresScopeKey(
    rankingMode,
    enableCategoryFilter ? category : "",
    activeTheme,
    activeQuery
  );
  const payloadScopeKeyForCurrentMode = modePayloadScopes[rankingMode] ?? null;
  const payloadForCurrentMode = modePayloads[rankingMode] ?? null;
  const payloadForCurrentScope =
    payloadForCurrentMode && payloadScopeKeyForCurrentMode === currentFetchScopeKey
      ? payloadForCurrentMode
      : null;
  const lastGoodMatchesScope = lastGoodScopeKey != null && lastGoodScopeKey === currentFetchScopeKey;
  const displayPayload =
    payloadForCurrentScope ??
    (lastGoodMatchesScope ? lastGoodPayload : null);

  useEffect(() => {
    setRankingMode(initialMode);
    setCategory(enableCategoryFilter ? initialCategory : "");
    setSearch(initialQuery);
    setActiveIntent(initialIntent);
    setActiveTheme(initialTheme);
    setPage(1);
  }, [enableCategoryFilter, initialCategory, initialIntent, initialMode, initialQuery, initialTheme]);

  const prevInitialSnapshotRef = useRef(initialData);
  useEffect(() => {
    if (prevInitialSnapshotRef.current === initialData) return;
    prevInitialSnapshotRef.current = initialData;
    const seeded = normalizeScoredResponse(initialData);
    if (!seeded) return;
    setModePayloads((prev) => ({ ...prev, [initialMode]: seeded }));
    setModePayloadScopes((prev) => ({ ...prev, [initialMode]: initialScopeKey }));
    setLastGoodPayload(seeded);
    setLastGoodScopeKey(initialScopeKey);
    if (seeded.funds.length > 0) persistStoredLastGoodPayload(seeded, initialScopeKey);
  }, [initialData, initialMode, initialScopeKey]);

  useEffect(() => {
    if (!bootstrapFallbackActive) return;
    // Retry ceiling prevents completed-empty flows from looking like endless loading.
    if (shouldStopBootstrapRetries(bootstrapAttemptCount, SCORES_BOOTSTRAP_MAX_RETRY)) {
      const visibleRows =
        (modePayloadsRef.current[rankingMode]?.funds.length ?? 0) +
        (lastGoodPayload?.funds.length ?? 0);
      setBootstrapFallbackActive(false);
      if (visibleRows === 0) {
        setError("Fon listesi geçici olarak yüklenemedi. Lütfen kısa süre sonra tekrar deneyin.");
        setDegradedNotice("Skor verisi hazır değil. Güvenli boş sonuç gösteriliyor.");
        setLastScoresMeta((prev) => ({
          ...prev,
          degraded: prev.degraded || "bootstrap_retry_exhausted",
          emptyResult: prev.emptyResult || "degraded",
        }));
      }
      return;
    }
    const timer = window.setTimeout(() => {
      setBootstrapAttemptCount((value) => value + 1);
      setBootstrapRetryTick((value) => value + 1);
    }, SCORES_BOOTSTRAP_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [bootstrapAttemptCount, bootstrapFallbackActive, lastGoodPayload, rankingMode]);

  useEffect(() => {
    if (seededCategories.length > 0) return;
    fetchNormalizedJson("/api/categories", "Kategori API", normalizeCategoryOptions)
      .then(setCategories)
      .catch(console.error);
  }, [seededCategories.length]);

  useEffect(() => {
    if (storageHydrated) return;
    if (!lastGoodPayload || lastGoodPayload.funds.length === 0) {
      const stored = readStoredLastGoodPayload();
      if (stored?.payload && stored.payload.funds.length > 0) {
        setLastGoodPayload(stored.payload);
        setLastGoodScopeKey(stored.scopeKey);
      }
    }
    setStorageHydrated(true);
  }, [lastGoodPayload, storageHydrated]);

  useEffect(() => {
    if (!seededInitialData || seededInitialData.funds.length === 0) return;
    persistStoredLastGoodPayload(seededInitialData, initialScopeKey);
  }, [initialScopeKey, seededInitialData]);

  const syncUrlState = useCallback((next: {
    mode?: RankingMode;
    intent?: FundIntentId | null;
    theme?: FundThemeId | null;
    category?: string;
    query?: string;
  }) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const before = `${url.pathname}${url.search}${url.hash}`;
    const mode = next.mode ?? rankingMode;
    const intent = next.intent !== undefined ? next.intent : activeIntent;
    const theme = next.theme !== undefined ? next.theme : activeTheme;
    const nextCategory = next.category !== undefined ? next.category : category;
    const query = next.query !== undefined ? next.query : search;

    if (mode === "BEST") url.searchParams.delete("mode");
    else url.searchParams.set("mode", mode);

    if (intent) url.searchParams.set("intent", intent);
    else url.searchParams.delete("intent");

    if (theme) url.searchParams.set("theme", theme);
    else url.searchParams.delete("theme");

    if (nextCategory) {
      url.searchParams.set("sector", nextCategory);
    } else {
      url.searchParams.delete("sector");
      url.searchParams.delete("category");
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery) url.searchParams.set("q", trimmedQuery);
    else {
      url.searchParams.delete("q");
      url.searchParams.delete("query");
    }

    const after = `${url.pathname}${url.search}${url.hash}`;
    if (after !== before) {
      window.history.replaceState({}, "", after);
    }
  }, [activeIntent, activeTheme, category, rankingMode, search]);

  useEffect(() => {
    if (!activeIntent) return;
    const intent = getFundIntent(activeIntent);
    if (!intent) return;

    if (rankingMode !== intent.preferredMode) {
      setRankingMode(intent.preferredMode);
    }

    if (enableCategoryFilter) {
      const nextCategory = resolveFundIntentCategory(activeIntent, categories);
      if (category !== nextCategory) {
        setCategory(nextCategory);
      }
    }

    if (sortField !== "finalScore" || sortDir !== "desc") {
      setSortField("finalScore");
      setSortDir("desc");
    }
    setPage(1);
    if (activeTheme) setActiveTheme(null);
    // intent aktifken arama metnini temizleyerek görünümü netleştir.
    if (search) setSearch("");
    syncUrlState({
      intent: activeIntent,
      theme: null,
      mode: intent.preferredMode,
      category: enableCategoryFilter ? resolveFundIntentCategory(activeIntent, categories) : "",
      query: "",
    });
  }, [
    activeIntent,
    activeTheme,
    categories,
    category,
    enableCategoryFilter,
    rankingMode,
    search,
    sortDir,
    sortField,
    syncUrlState,
  ]);

  useEffect(() => {
    if (!storageHydrated) return;
    const cached = modePayloadsRef.current[rankingMode];
    const cachedScope = modePayloadScopesRef.current[rankingMode] ?? null;
    const cachedMatchesScope = Boolean(cached && cachedScope === currentFetchScopeKey);
    const needsInitialRefresh =
      (initialDataIsPartial || seededInitialDataLooksPartial) &&
      rankingMode === initialMode &&
      cached === seededInitialData &&
      currentFetchScopeKey === initialScopeKey &&
      cachedMatchesScope;
    const needsInitialScopeRefresh =
      !initialScopeRefreshDoneRef.current &&
      rankingMode === initialMode &&
      currentFetchScopeKey === initialScopeKey &&
      cachedMatchesScope;
    if (cachedMatchesScope && !needsInitialRefresh && !needsInitialScopeRefresh) {
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const isLatestRequest = (): boolean => latestRequestIdRef.current === requestId;
    if (!cachedMatchesScope) setLoading(true);
    setError(null);
    setBootstrapFallbackActive(false);
    setBootstrapAttemptCount(0);
    setDegradedNotice(null);
    const timeoutMs = scoresFetchTimeoutForMode(rankingMode);
    // Tema veya metin süzgeci: sunucu scope-first dar pencere (geniş çekim + istemci süzme yok).
    const scopeNeedsDefaultLimit = Boolean(activeTheme) || Boolean(activeQuery);
    const modeLimitParam = scopeNeedsDefaultLimit
      ? `&limit=${DEFAULT_SCOPED_DISCOVERY_LIMIT}`
      : rankingMode === "HIGH_RETURN"
        ? "&limit=300"
        : "";
    const categoryParam =
      enableCategoryFilter && category.trim()
        ? `&category=${encodeURIComponent(category.trim())}`
        : "";
    const themeParam = activeTheme ? `&theme=${encodeURIComponent(activeTheme)}` : "";
    const queryParam = activeQuery ? `&q=${encodeURIComponent(activeQuery)}` : "";
    const requestUrl = `/api/funds/scores?mode=${rankingMode}${categoryParam}${themeParam}${queryParam}${modeLimitParam}`;
    const startedAt = Date.now();
    const previousRowsBeforeFetch = modePayloadsRef.current[rankingMode]?.funds.length ?? 0;
    const fallbackRowsBeforeFetch = lastGoodPayload?.funds.length ?? 0;
    const bootstrapWithoutRows = previousRowsBeforeFetch === 0 && fallbackRowsBeforeFetch === 0;
    if (bootstrapWithoutRows) {
      firstRowsProbeRef.current = { mode: rankingMode, startedAt, logged: false };
    }
    const markFirstRowsVisible = (source: "scores" | "core_rows_fallback", rows: number): void => {
      if (rows <= 0) return;
      const probe = firstRowsProbeRef.current;
      if (!probe || probe.logged || probe.mode !== rankingMode) return;
      probe.logged = true;
      const elapsed = Date.now() - probe.startedAt;
      console.info(
        `[funds_table_first_rows_ms] mode=${rankingMode} source=${source} ms=${elapsed} rows=${rows}`
      );
    };
    console.info(
      `[scores-table] transition_requested mode=${rankingMode} category=${category || "all"} q=${activeQuery ? "1" : "0"} ` +
        `intent=${activeIntent ?? "none"} theme=${activeTheme ?? "none"} timeout_ms=${timeoutMs} url=${requestUrl}`
    );
    console.info(
      `[discover-filter-input] mode=${rankingMode} category=${category || "all"} theme=${activeTheme ?? "none"} ` +
        `intent=${activeIntent ?? "none"} q=${activeQuery ? "1" : "0"} server_url=${requestUrl}`
    );

    let scoresResolved = false;
    if (false && bootstrapWithoutRows) {
      const coreRowsUrl = `/api/funds?page=1&pageSize=${SCORES_CORE_ROWS_FALLBACK_PAGE_SIZE}&sort=portfolioSize:desc&light=1`;
      void fetchNormalizedJsonWithMeta(
        coreRowsUrl,
        "Fon Liste API",
        normalizeFundListResponse,
        { signal: controller.signal },
        SCORES_CORE_ROWS_FALLBACK_TIMEOUT_MS
      )
        .then(({ data }) => {
          if (controller.signal.aborted || scoresResolved || !isLatestRequest()) return;
          if (!data || !Array.isArray(data.items) || data.items.length === 0) return;
          const corePayload = mapFundsPayloadToScoredResponse(rankingMode, data);
          setModePayloads((previous) => {
            const existing = previous[rankingMode];
            const existingScope = modePayloadScopesRef.current[rankingMode] ?? null;
            if (existing && existing.funds.length > 0 && existingScope === currentFetchScopeKey) return previous;
            return { ...previous, [rankingMode]: corePayload };
          });
          setModePayloadScopes((previous) => ({ ...previous, [rankingMode]: currentFetchScopeKey }));
          setLastGoodPayload((previous) => {
            if (previous && previous.funds.length > 0 && lastGoodScopeKey === currentFetchScopeKey) return previous;
            return corePayload;
          });
          setLastGoodScopeKey(currentFetchScopeKey);
          persistStoredLastGoodPayload(corePayload, currentFetchScopeKey);
          setBootstrapFallbackActive(false);
          setBootstrapAttemptCount(0);
          setBootstrapSource("bootstrap_fallback");
          setDegradedNotice("Skorlar hazırlanıyor. Temel fon listesi gösteriliyor.");
          setLoading(false);
          console.info(
            `[funds_table_core_loaded] mode=${rankingMode} rows=${corePayload.funds.length} source=api_funds`
          );
          markFirstRowsVisible("core_rows_fallback", corePayload.funds.length);
        })
        .catch((coreError) => {
          if (controller.signal.aborted) return;
          console.warn(
            `[funds_table_core_loaded] mode=${rankingMode} rows=0 source=api_funds error=1 message=${
              coreError instanceof Error ? coreError.message : "unknown"
            }`
          );
        });
    }

    fetchNormalizedJsonWithMeta(
      requestUrl,
      "Fon API",
      normalizeScoredResponse,
      { signal: controller.signal },
      timeoutMs
    )
      .then(({ data: json, headers, status, rawBytes }) => {
        if (!isLatestRequest()) {
          console.info(
            `[scores-table] stale_response_discarded mode=${rankingMode} request_id=${requestId} latest_request_id=${latestRequestIdRef.current}`
          );
          return;
        }
        scoresResolved = true;
        const previousRows = modePayloadsRef.current[rankingMode]?.funds.length ?? 0;
        const fallbackRows = lastGoodPayload?.funds.length ?? 0;
        const hadRows = previousRows > 0 || fallbackRows > 0;
        const fundsCount = json.funds.length;
        const degradedHeader = headerValue(headers, "x-scores-degraded");
        const sourceHeader = headerValue(headers, "x-scores-source");
        const emptyResultHeader = headerValue(headers, "x-scores-empty-result");
        const discoverServerCount = headerValue(headers, "x-discover-server-result-count");
        const discoverUniverseTotal = headerValue(headers, "x-discover-universe-total");
        const responseRequestKey = headerValue(headers, "x-discovery-request-key");
        if (responseRequestKey && responseRequestKey !== currentFetchScopeKey) {
          console.info(
            `[scores-table] scope_mismatch_discarded mode=${rankingMode} request_key=${responseRequestKey} expected=${currentFetchScopeKey}`
          );
          return;
        }
        setLastDiscoveryHealth({
          overall: headerValue(headers, "x-discovery-overall-health") || "unknown",
          scope: headerValue(headers, "x-discovery-scope-health") || "unknown",
          completeness: headerValue(headers, "x-discovery-completeness-health") || "unknown",
          freshness: headerValue(headers, "x-discovery-freshness-health") || "unknown",
          request: headerValue(headers, "x-discovery-request-health") || "unknown",
        });
        const freshnessStateHeader = headerValue(headers, "x-data-freshness-state");
        const freshnessReasonHeader = headerValue(headers, "x-data-freshness-degraded-reason");
        setLastFreshnessState(
          freshnessStateHeader === "fresh" ||
            freshnessStateHeader === "stale_ok" ||
            freshnessStateHeader === "degraded_outdated"
            ? freshnessStateHeader
            : "unknown"
        );
        setLastFreshnessReason(freshnessReasonHeader || "none");
        setLastScoresMeta({
          degraded: degradedHeader,
          source: sourceHeader,
          emptyResult: emptyResultHeader,
        });
        const degradedEmpty = isDegradedEmptyResponse(headers, json);
        const validBusinessEmpty = isValidBusinessEmptyResponse(headers, json);
        const cachedScopeForMode = modePayloadScopesRef.current[rankingMode] ?? null;
        const modePayloadScopeMatchesFetch = cachedScopeForMode === currentFetchScopeKey;

        let uiAction:
          | "replace_rows"
          | "keep_previous_rows"
          | "keep_last_good_rows"
          | "show_bootstrap_fallback"
          | "show_valid_empty" = "replace_rows";
        if (degradedEmpty && previousRows > 0 && modePayloadScopeMatchesFetch) {
          uiAction = "keep_previous_rows";
          setDegradedNotice("Skor verisi geçici olarak alınamadı. Son başarılı tablo gösteriliyor.");
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=degraded_empty action=keep_previous_rows funds=${fundsCount} source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"}`
          );
        } else if (degradedEmpty && previousRows > 0 && !modePayloadScopeMatchesFetch) {
          uiAction = "replace_rows";
          setDegradedNotice(
            "Skor verisi geçici olarak alınamadı. Yeni arama/filtre için sonuç güncellenemedi; lütfen kısa süre sonra tekrar deneyin."
          );
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=degraded_empty action=replace_stale_scope funds=${fundsCount} source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"} cached_scope=${cachedScopeForMode ?? "none"} expected=${currentFetchScopeKey}`
          );
        } else if (degradedEmpty && previousRows === 0 && fallbackRows > 0 && lastGoodScopeKey === currentFetchScopeKey) {
          uiAction = "keep_last_good_rows";
          setDegradedNotice("Skor verisi geçici olarak alınamadı. Son başarılı liste korunuyor.");
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=degraded_empty action=keep_last_good_rows funds=${fundsCount} source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"}`
          );
        } else if (degradedEmpty && previousRows === 0 && fallbackRows > 0 && lastGoodScopeKey !== currentFetchScopeKey) {
          uiAction = "replace_rows";
          setDegradedNotice(
            "Skor verisi geçici olarak alınamadı. Yeni arama/filtre için sonuç güncellenemedi; lütfen kısa süre sonra tekrar deneyin."
          );
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=degraded_empty action=replace_stale_last_good funds=${fundsCount} source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"} last_good_scope=${lastGoodScopeKey ?? "none"} expected=${currentFetchScopeKey}`
          );
        } else if (degradedEmpty) {
          uiAction = "show_bootstrap_fallback";
          setBootstrapFallbackActive(!hadRows);
          setBootstrapSource("bootstrap_fallback");
          setDegradedNotice("Skor verisi geçici olarak alınamadı. İlk liste yeniden deneniyor.");
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=degraded_empty action=show_bootstrap_fallback funds=${fundsCount} source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"}`
          );
        } else if (json.funds.length === 0 && !validBusinessEmpty) {
          uiAction = "show_bootstrap_fallback";
          setBootstrapFallbackActive(!hadRows);
          setBootstrapSource("bootstrap_fallback");
          setDegradedNotice("Skor verisi henüz hazır değil. İlk liste yeniden deneniyor.");
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=unknown_empty action=show_bootstrap_fallback funds=0 source=${
              sourceHeader || "none"
            } degraded=${degradedHeader || "none"}`
          );
        } else if (validBusinessEmpty && !hadRows) {
          uiAction = "show_valid_empty";
          setBootstrapSource("valid_empty");
          setBootstrapFallbackActive(false);
          setBootstrapAttemptCount(0);
          setDegradedNotice(null);
        } else {
          if (json.funds.length > 0) {
            setBootstrapSource("ssr");
          }
          setBootstrapFallbackActive(false);
          setDegradedNotice(null);
        }

        if (uiAction === "replace_rows" || uiAction === "show_valid_empty") {
          setModePayloads((previous) => ({ ...previous, [rankingMode]: json }));
          setModePayloadScopes((previous) => ({ ...previous, [rankingMode]: currentFetchScopeKey }));
          if (json.funds.length > 0) {
            setLastGoodPayload(json);
            setLastGoodScopeKey(currentFetchScopeKey);
            persistStoredLastGoodPayload(json, currentFetchScopeKey);
            setBootstrapSource("last_good");
            markFirstRowsVisible("scores", json.funds.length);
          }
          onDiscoveryPayloadReady?.(json);
        }
        setError(null);

        const bootstrapSourceForLog: BootstrapSource =
          previousRows > 0 ? "ssr" : fallbackRows > 0 ? "last_good" : uiAction === "show_valid_empty" ? "valid_empty" : "bootstrap_fallback";
        const bootstrapAction =
          previousRows > 0
            ? "keep_ssr"
            : fallbackRows > 0
              ? "keep_last_good"
              : uiAction === "show_valid_empty"
                ? "show_valid_empty"
                : uiAction === "show_bootstrap_fallback"
                  ? "show_bootstrap_fallback"
                  : "keep_ssr";
        console.info(
          `[scores-table] transition_response mode=${rankingMode} status=${status} funds=${fundsCount} ` +
            `degraded=${degradedHeader || "0"} source=${sourceHeader || "none"} empty_result=${emptyResultHeader || "none"} ` +
            `action=${uiAction} prev_rows=${previousRows} fallback_rows=${fallbackRows} payload_bytes=${rawBytes} ` +
            `bootstrap_source=${bootstrapSourceForLog} bootstrap_action=${bootstrapAction} ` +
            `discover_server_count=${discoverServerCount || "unknown"} discover_universe_total=${discoverUniverseTotal || "unknown"} ` +
            `ms=${Date.now() - startedAt}`
        );
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!isLatestRequest()) return;
        scoresResolved = true;
        const previousRows = modePayloadsRef.current[rankingMode]?.funds.length ?? 0;
        const fallbackRows = lastGoodPayload?.funds.length ?? 0;
        const timeoutLike = isTimeoutLikeClientError(cause);
        const keepRows = previousRows > 0 || fallbackRows > 0;
        if (timeoutLike && keepRows) {
          setError(null);
          setBootstrapFallbackActive(false);
          setBootstrapAttemptCount(0);
          setDegradedNotice("Skor verisi gecikti. Son başarılı tablo korunuyor.");
          console.warn(
            `[scores-table] transition_timeout_keep_previous mode=${rankingMode} prev_rows=${previousRows} fallback_rows=${fallbackRows} timeout_ms=${timeoutMs}`
          );
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=client_timeout_keep_rows action=keep_previous_rows timeout_ms=${timeoutMs}`
          );
          return;
        }
        if (timeoutLike && !keepRows) {
          setError(null);
          setBootstrapFallbackActive(true);
          setBootstrapSource("bootstrap_fallback");
          setDegradedNotice("İlk liste gecikti. Geçici bekleme ekranı gösteriliyor, yeniden deneniyor.");
          console.warn(
            `[scores-table] bootstrap_timeout mode=${rankingMode} prev_rows=${previousRows} fallback_rows=${fallbackRows} timeout_ms=${timeoutMs} ` +
              `bootstrap_source=bootstrap_fallback bootstrap_action=show_bootstrap_fallback`
          );
          console.warn(
            `[funds_table_scores_degraded] mode=${rankingMode} reason=client_timeout_no_rows action=show_bootstrap_fallback timeout_ms=${timeoutMs}`
          );
          return;
        }
        if (!keepRows) {
          setError(null);
          setBootstrapFallbackActive(true);
          setBootstrapSource("bootstrap_fallback");
          setDegradedNotice("İlk liste geçici olarak alınamadı. Otomatik yeniden deniyoruz.");
          console.warn(
            `[scores-table] bootstrap_error mode=${rankingMode} prev_rows=${previousRows} fallback_rows=${fallbackRows} ` +
              `bootstrap_source=bootstrap_fallback bootstrap_action=show_bootstrap_fallback`
          );
          return;
        }
        setBootstrapFallbackActive(false);
        setBootstrapAttemptCount(0);
        setError(cause instanceof Error ? cause.message : "Veri yüklenemedi");
        console.error(
          `[scores-table] transition_failed mode=${rankingMode} category=${category || "all"} q=${activeQuery ? "1" : "0"} ` +
            `timeout_like=${timeoutLike ? 1 : 0} prev_rows=${previousRows} fallback_rows=${fallbackRows}`,
          cause
        );
      })
      .finally(() => {
        if (!isLatestRequest()) return;
        if (!controller.signal.aborted) {
          if (needsInitialScopeRefresh) initialScopeRefreshDoneRef.current = true;
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    activeIntent,
    activeTheme,
    bootstrapRetryTick,
    category,
    currentFetchScopeKey,
    activeQuery,
    enableCategoryFilter,
    initialDataIsPartial,
    initialMode,
    initialScopeKey,
    lastGoodScopeKey,
    lastGoodPayload,
    rankingMode,
    seededInitialData,
    seededInitialDataLooksPartial,
    storageHydrated,
    onDiscoveryPayloadReady,
  ]);

  useEffect(() => {
    if (prevRankingModeRef.current === null) {
      prevRankingModeRef.current = rankingMode;
      return;
    }
    if (prevRankingModeRef.current === rankingMode) return;
    prevRankingModeRef.current = rankingMode;
    if (!activeIntent) {
      setSortField(DEFAULT_SORT_FIELD);
      setSortDir(DEFAULT_SORT_DIR);
    }
    setPage(1);
  }, [activeIntent, rankingMode]);

  useEffect(() => {
    console.info(
      `[scores-table] filter_state mode=${rankingMode} category=${category || "all"} q=${search.trim() ? "1" : "0"} ` +
        `intent=${activeIntent ?? "none"} theme=${activeTheme ?? "none"} rows=${displayPayload?.funds.length ?? 0} ` +
        `mode_rows=${payloadForCurrentScope?.funds.length ?? 0} fallback_rows=${
          lastGoodMatchesScope ? lastGoodPayload?.funds.length ?? 0 : 0
        } scope_match=${payloadForCurrentScope ? 1 : 0}`
    );
  }, [
    activeIntent,
    activeTheme,
    category,
    displayPayload?.funds.length,
    lastGoodMatchesScope,
    lastGoodPayload?.funds.length,
    payloadForCurrentScope?.funds.length,
    rankingMode,
    search,
  ]);

  const handleRankingModeChange = (next: RankingMode) => {
    setRankingMode(next);
    setActiveIntent(null);
    startTransition(() => {
      setPage(1);
    });
    syncUrlState({ mode: next, intent: null });
  };

  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setActiveIntent(null);
    setActiveTheme(null);
    setPage(1);
    syncUrlState({ query: "", category: "", intent: null, theme: null });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
      return;
    }
    setSortField(field);
    setSortDir("desc");
  };

  const serverScopedByTheme = Boolean(
    activeTheme &&
      payloadForCurrentScope &&
      payloadScopeKeyForCurrentMode === currentFetchScopeKey
  );

  const themeScopedFunds = useMemo(() => {
    const funds = displayPayload?.funds ?? [];
    // Sunucu /api/funds/scores?theme=... ile daralttıysa istemcide ikinci kez daraltma false-empty üretebilir.
    if (!activeTheme || serverScopedByTheme) return funds;
    return funds.filter((fund) => fundRowMatchesCanonicalTheme(fund, activeTheme));
  }, [activeTheme, displayPayload, serverScopedByTheme]);

  /** Keşif modunda URL/şerit ile uyumlu satır sayısı (arama metni hariç). */
  const routeScopedMatchCount = useMemo(() => {
    let list = themeScopedFunds;
    if (enableCategoryFilter && category) {
      list = list.filter((fund) => fund.category?.code === category);
    }
    return list.length;
  }, [category, enableCategoryFilter, themeScopedFunds]);

  const availableCategories = useMemo(() => {
    if (!enableCategoryFilter) return [];
    if (!activeTheme) return categories;

    const counts = new Map<string, number>();
    for (const fund of themeScopedFunds) {
      const code = fund.category?.code;
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }

    return categories
      .filter((item) => counts.has(item.code))
      .sort((a, b) => {
        const countDiff = (counts.get(b.code) ?? 0) - (counts.get(a.code) ?? 0);
        if (countDiff !== 0) return countDiff;
        return a.name.localeCompare(b.name, "tr");
      });
  }, [activeTheme, categories, enableCategoryFilter, themeScopedFunds]);

  useEffect(() => {
    if (!enableCategoryFilter || !category) return;
    if (categories.length === 0) return;
    if (activeTheme && !payloadForCurrentScope) return;
    if (availableCategories.some((item) => item.code === category)) return;
    setCategory("");
    setPage(1);
    syncUrlState({ category: "" });
  }, [activeTheme, availableCategories, categories.length, category, enableCategoryFilter, payloadForCurrentScope, syncUrlState]);

  const serverScopedByCategory = Boolean(
    enableCategoryFilter &&
      category &&
      payloadForCurrentScope &&
      payloadScopeKeyForCurrentMode === currentFetchScopeKey
  );

  const filteredFunds = useMemo(() => {
    const list = themeScopedFunds.filter((fund) => {
      if (
        enableCategoryFilter &&
        category &&
        !serverScopedByCategory &&
        fund.category?.code !== category
      )
        return false;
      return fundSearchMatches(activeQuery, [fund.code, fund.name, fund.shortName ?? null]);
    });

    return [...list].sort((a, b) => {
      if (sortField === "fundType") {
        const cmp = fundTypeSortKey(a.fundType).localeCompare(fundTypeSortKey(b.fundType), "tr");
        return sortDir === "desc" ? -cmp : cmp;
      }

      let aVal: number;
      let bVal: number;

      switch (sortField) {
        case "portfolioSize":
          aVal = a.portfolioSize;
          bVal = b.portfolioSize;
          break;
        case "dailyReturn":
          aVal = a.dailyReturn;
          bVal = b.dailyReturn;
          break;
        case "investorCount":
          aVal = a.investorCount;
          bVal = b.investorCount;
          break;
        case "lastPrice":
          aVal = a.lastPrice;
          bVal = b.lastPrice;
          break;
        case "finalScore":
        default: {
          const na = a.finalScore;
          const nb = b.finalScore;
          const aMissing = na == null || !Number.isFinite(na);
          const bMissing = nb == null || !Number.isFinite(nb);
          if (sortField === "finalScore") {
            if (aMissing && bMissing) return a.code.localeCompare(b.code, "tr");
            if (aMissing) return 1;
            if (bMissing) return -1;
            const cmp = na - nb;
            return sortDir === "desc" ? -cmp : cmp;
          }
          aVal = na ?? 0;
          bVal = nb ?? 0;
        }
      }

      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [
    category,
    activeQuery,
    enableCategoryFilter,
    serverScopedByCategory,
    sortDir,
    sortField,
    themeScopedFunds,
  ]);

  const totalPages = Math.max(1, Math.ceil(filteredFunds.length / pageSize));
  const paginatedFunds = filteredFunds.slice((page - 1) * pageSize, page * pageSize);
  const hasFilters = Boolean(search || (enableCategoryFilter && category) || activeIntent || activeTheme);
  const discoverySurfaceState: DiscoverySurfaceState = useMemo(
    () =>
      deriveDiscoverySurfaceState({
        loading: loading || bootstrapFallbackActive,
        error: Boolean(error),
        hasRenderableRows: paginatedFunds.length > 0,
        surfaceState: displayPayload?.scoresSurfaceState ?? null,
        degradedHeader:
          lastScoresMeta.emptyResult === "degraded" ||
          Boolean(lastScoresMeta.degraded),
      }),
    [
      bootstrapFallbackActive,
      error,
      displayPayload?.scoresSurfaceState,
      lastScoresMeta.degraded,
      lastScoresMeta.emptyResult,
      loading,
      paginatedFunds.length,
    ]
  );
  const showTableLoadingSkeleton = discoverySurfaceState === "loading_initial";
  const showRefreshingNotice = discoverySurfaceState === "loading_refresh";
  const showDegradedScoped = discoverySurfaceState === "degraded_scoped";
  const degradedScopedMessage =
    lastFreshnessReason === "source_unavailable"
      ? "Kaynak erişimi doğrulanamadı. Bu kapsam için liste geçici olarak üretilemedi."
      : lastFreshnessReason === "serving_lagging_raw"
        ? "Serving verisi ham içe aktarmanın gerisinde. Bu kapsam geçici olarak üretilemedi."
        : lastFreshnessReason === "scoped_snapshot_unavailable"
          ? "Scoped snapshot şu an alınamadı. Liste kısa süre sonra yeniden denenecek."
          : lastFreshnessReason === "sync_meta_malformed"
            ? "Günlük senkron meta kaydı doğrulanamadı. Tazelik doğrusu geçici olarak düşürüldü."
            : "Bu kapsam için skor kaynağı şu an kararsız. Liste geçici olarak üretilemedi; lütfen kısa süre sonra tekrar deneyin.";
  useEffect(() => {
    console.info(
      `[discover-client-filter] mode=${rankingMode} category=${category || "all"} theme=${activeTheme ?? "none"} ` +
        `server_rows=${displayPayload?.funds.length ?? 0} theme_scoped_rows=${themeScopedFunds.length} ` +
        `route_scoped_rows=${routeScopedMatchCount} client_filtered_count=${filteredFunds.length} q=${activeQuery ? "1" : "0"}`
    );
  }, [
    activeTheme,
    category,
    activeQuery,
    displayPayload?.funds.length,
    filteredFunds.length,
    rankingMode,
    routeScopedMatchCount,
    themeScopedFunds.length,
  ]);
  useEffect(() => {
    console.info(
      `[discover-visible-rows] mode=${rankingMode} category=${category || "all"} theme=${activeTheme ?? "none"} ` +
        `visible_rows=${paginatedFunds.length} filtered_total=${filteredFunds.length} page=${page}/${totalPages} ` +
        `universe_total=${referenceUniverseTotal ?? "unknown"} payload_universe=${displayPayload ? readScoresUniverseTotal(displayPayload) : "none"}`
    );
  }, [
    activeTheme,
    category,
    displayPayload ? readScoresUniverseTotal(displayPayload) : null,
    filteredFunds.length,
    page,
    paginatedFunds.length,
    rankingMode,
    referenceUniverseTotal,
    totalPages,
  ]);
  const lastEmptyReasonRef = useRef<string>("");
  useEffect(() => {
    if (loading || bootstrapFallbackActive || paginatedFunds.length > 0) return;
    let reason = "none";
    if (error) reason = "error";
    else if (lastScoresMeta.emptyResult === "degraded" || Boolean(lastScoresMeta.degraded)) reason = "degraded_empty";
    else if (lastScoresMeta.emptyResult === "valid") reason = "valid_empty";
    else if (hasFilters) reason = "filtered_empty";
    else reason = "unknown_empty";
    const logKey = `${reason}|${rankingMode}|${category || "all"}|${activeQuery ? "1" : "0"}`;
    if (lastEmptyReasonRef.current === logKey) return;
    lastEmptyReasonRef.current = logKey;
    console.info(
      `[funds_table_empty_reason] mode=${rankingMode} reason=${reason} filters=${hasFilters ? 1 : 0} ` +
        `empty_result=${lastScoresMeta.emptyResult || "none"} source=${lastScoresMeta.source || "none"} degraded=${
          lastScoresMeta.degraded || "none"
        }`
    );
  }, [
    bootstrapFallbackActive,
    category,
    activeQuery,
    error,
    hasFilters,
    lastScoresMeta.degraded,
    lastScoresMeta.emptyResult,
    lastScoresMeta.source,
    loading,
    paginatedFunds.length,
    rankingMode,
  ]);
  useEffect(() => {
    if (paginatedFunds.length === 0) return;
    console.info(
      `[funds_table_core_loaded] mode=${rankingMode} loaded=1 rows=${paginatedFunds.length} loading=${loading ? 1 : 0}`
    );
  }, [loading, paginatedFunds.length, rankingMode]);
  useEffect(() => {
    const homepageRowsSource = (() => {
      if (payloadForCurrentMode && payloadForCurrentMode.funds.length > 0) {
        if (rankingMode === initialMode && seededInitialData && payloadForCurrentMode === seededInitialData) return "ssr";
        if (lastScoresMeta.source) return `scores_${lastScoresMeta.source}`;
        return "scores";
      }
      if (lastGoodPayload && lastGoodPayload.funds.length > 0) return "last_good";
      if (bootstrapFallbackActive) return "bootstrap_fallback";
      return "none";
    })();
    console.info(
      `[homepage_rows] mode=${rankingMode} homepage_rows_source=${homepageRowsSource} homepage_rows_count=${paginatedFunds.length}`
    );
  }, [
    bootstrapFallbackActive,
    initialMode,
    lastGoodPayload,
    lastScoresMeta.source,
    paginatedFunds.length,
    payloadForCurrentMode,
    rankingMode,
    seededInitialData,
  ]);
  const activeIntentDef = useMemo(() => getFundIntent(activeIntent), [activeIntent]);
  const activeThemeDef = useMemo(() => getFundTheme(activeTheme), [activeTheme]);
  const activeCategoryLabel = useMemo(
    () => categories.find((item) => item.code === category)?.name ?? "",
    [categories, category]
  );
  const emptyListMessage = useMemo(() => {
    if (hasFilters) {
      const parts: string[] = [];
      if (search.trim()) parts.push(`arama: "${search.trim()}"`);
      if (enableCategoryFilter && category) parts.push(`kategori: ${activeCategoryLabel || category}`);
      if (activeIntentDef) parts.push(`görünüm: ${activeIntentDef.label}`);
      if (activeThemeDef) parts.push(`tema: ${activeThemeDef.label}`);
      return `Bu kriterlere uygun fon yok. ${parts.length > 0 ? `(${parts.join(" · ")})` : ""} Filtreleri gevşetmeyi veya temizlemeyi deneyin.`;
    }
    return `Bu sıralama modunda (${rankingModeLabel(rankingMode)}) listelenecek fon bulunamadı.`;
  }, [
    activeCategoryLabel,
    activeIntentDef,
    activeThemeDef,
    category,
    enableCategoryFilter,
    hasFilters,
    rankingMode,
    search,
  ]);
  const mobileFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (search.trim()) {
      chips.push({
        key: "search",
        label: `Ara: ${search.trim()}`,
        onRemove: () => {
          setSearch("");
          setPage(1);
          syncUrlState({ query: "" });
        },
      });
    }
    if (activeIntentDef) {
      chips.push({
        key: `intent-${activeIntentDef.id}`,
        label: activeIntentDef.label,
        onRemove: () => {
          setActiveIntent(null);
          setPage(1);
          syncUrlState({ intent: null });
        },
      });
    }
    if (activeThemeDef) {
      chips.push({
        key: `theme-${activeThemeDef.id}`,
        label: activeThemeDef.label,
        onRemove: () => {
          setActiveTheme(null);
          setPage(1);
          syncUrlState({ theme: null });
        },
      });
    }
    if (enableCategoryFilter && activeCategoryLabel) {
      chips.push({
        key: `category-${category}`,
        label: activeCategoryLabel,
        onRemove: () => {
          setCategory("");
          setPage(1);
          syncUrlState({ category: "" });
        },
      });
    }
    return chips;
  }, [activeCategoryLabel, activeIntentDef, activeThemeDef, category, enableCategoryFilter, search, syncUrlState]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const activeViewLabel = quickStartActive && quickStartLabel ? quickStartLabel : null;

  const discoveryTableSummary = useMemo(() => {
    if (!quickStartActive || !quickStartLabel) return null;
    const shown = filteredFunds.length;
    const shownStr = shown.toLocaleString("tr-TR");
    const registeredTotal = resolveHomepageRegisteredTotal({
      hasFilters,
      canonicalUniverseTotal: referenceUniverseTotal,
      scopedPayload: payloadForCurrentScope ?? null,
    });
    const regStr = registeredTotal != null ? registeredTotal.toLocaleString("tr-TR") : "—";
    return { shownStr, contextLabel: quickStartLabel, universeStr: regStr };
  }, [filteredFunds.length, hasFilters, payloadForCurrentScope, quickStartActive, quickStartLabel, referenceUniverseTotal]);

  const resultCountCaption = useMemo(() => {
    const shown = filteredFunds.length;
    const payload = displayPayload;
    const loadedCount = payload?.funds.length ?? shown;
    const registeredTotal = resolveHomepageRegisteredTotal({
      hasFilters,
      canonicalUniverseTotal: referenceUniverseTotal,
      scopedPayload: payloadForCurrentScope ?? null,
    });
    if (quickStartActive && quickStartLabel) {
      return null;
    }
    const filteredHint = (() => {
      if (!hasFilters) return null;
      const parts: string[] = [];
      if (activeQuery) parts.push("arama");
      if (enableCategoryFilter && category) parts.push("kategori");
      if (activeIntentDef) parts.push("görünüm");
      if (activeThemeDef) parts.push("tema");
      return parts.length ? parts.join(", ") : "filtre";
    })();
    return formatHomepageCountCaption({
      shown,
      registeredTotal,
      loadedCount,
      hasFilters,
      filteredHint,
    });
  }, [
    activeIntentDef,
    activeThemeDef,
    category,
    activeQuery,
    enableCategoryFilter,
    filteredFunds.length,
    hasFilters,
    displayPayload,
    payloadForCurrentScope,
    quickStartActive,
    quickStartLabel,
    referenceUniverseTotal,
  ]);

  return (
    <section
      className="table-container ds-surface-glass scored-funds-table-module overflow-hidden rounded-xl border"
      data-discovery-result-list="true"
      data-discovery-scope={currentFetchScopeKey}
      data-discovery-mode={rankingMode}
      data-discovery-category={category || "all"}
      data-discovery-theme={activeTheme ?? "none"}
      data-discovery-visible-count={filteredFunds.length}
      data-discovery-overall-health={lastDiscoveryHealth.overall}
      data-discovery-scope-health={lastDiscoveryHealth.scope}
      data-discovery-completeness-health={lastDiscoveryHealth.completeness}
      data-discovery-freshness-health={lastDiscoveryHealth.freshness}
      data-discovery-request-health={lastDiscoveryHealth.request}
      data-discovery-table-surface-state={discoverySurfaceState}
      data-surface-state={discoverySurfaceState}
      data-surface-reason={showDegradedScoped ? "degraded_scoped" : error ? "error" : "none"}
    >
      <header
        className="fund-table-chrome border-b px-3 py-2 sm:px-4 sm:py-2.5 md:py-2.5"
        style={{
          borderColor: "var(--border-subtle)",
          background: "color-mix(in srgb, var(--card-bg) 97%, var(--bg-muted))",
        }}
      >
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-x-5 md:gap-y-2 md:gap-3">
          <div className="min-w-0 md:min-w-[12rem] md:flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <h2 className="text-[15px] font-semibold leading-tight tracking-[-0.035em] sm:text-base" style={{ color: "var(--text-primary)" }}>
                Fonlar
              </h2>
              {!loading && !error && discoveryTableSummary ? (
                <p
                  className="table-quickstart-caption flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px] font-medium leading-snug tabular-nums sm:gap-x-2 sm:text-[11.5px]"
                  aria-live="polite"
                >
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {discoveryTableSummary.shownStr}
                    </strong>
                    <span className="table-quickstart-meta ml-1">sonuç</span>
                  </span>
                  <span className="table-quickstart-meta shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  <span
                    className="min-w-0 max-w-[min(100%,15rem)] truncate font-semibold sm:max-w-[22rem]"
                    style={{ color: "var(--text-primary)" }}
                    title={discoveryTableSummary.contextLabel}
                  >
                    {discoveryTableSummary.contextLabel}
                  </span>
                  <span className="table-quickstart-meta shrink-0 select-none" aria-hidden>
                    ·
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {discoveryTableSummary.universeStr}
                    </strong>
                    <span className="table-quickstart-meta ml-1">fon evreni</span>
                  </span>
                </p>
              ) : null}
              {!loading && !error && lastFreshnessState !== "unknown" ? (
                <span
                  className="mt-0.5 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    color:
                      lastFreshnessState === "fresh"
                        ? "var(--success-muted)"
                        : lastFreshnessState === "stale_ok"
                          ? "var(--text-secondary)"
                          : "var(--danger-muted)",
                    borderColor: "color-mix(in srgb, var(--border-subtle) 82%, transparent)",
                    background: "color-mix(in srgb, var(--card-bg) 96%, var(--bg-muted))",
                  }}
                >
                  {lastFreshnessState === "fresh"
                    ? "Fresh data"
                    : lastFreshnessState === "stale_ok"
                      ? "Slightly stale"
                      : "Data outdated"}
                </span>
              ) : null}
              {!loading && !error && lastFreshnessState !== "fresh" && lastFreshnessReason !== "none" ? (
                <span
                  className="mt-0.5 block w-full text-[10.5px] font-medium leading-snug sm:mt-0 sm:inline sm:w-auto sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-live="polite"
                >
                  {lastFreshnessReason === "source_unavailable"
                    ? "Kaynak erişimi doğrulanamadı."
                    : lastFreshnessReason === "serving_lagging_raw"
                      ? "Serving ham verinin gerisinde."
                      : lastFreshnessReason === "scoped_snapshot_unavailable"
                        ? "Scoped snapshot geçici olarak alınamıyor."
                        : lastFreshnessReason === "sync_meta_malformed"
                          ? "Sync meta doğrulaması geçici olarak bozuk."
                          : "Veri güncelliği düşmüş olabilir."}
                </span>
              ) : null}
              {!loading && !error && resultCountCaption ? (
                <span
                  className="mt-0.5 block w-full text-[10.5px] font-medium leading-snug tabular-nums sm:mt-0 sm:inline sm:w-auto sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-live="polite"
                >
                  {resultCountCaption}
                </span>
              ) : null}
              {!loading && !error && degradedNotice ? (
                <span
                  className="mt-0.5 block w-full text-[10.5px] font-medium leading-snug sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-live="polite"
                >
                  {degradedNotice}
                </span>
              ) : null}
              {showRefreshingNotice ? (
                <span
                  className="mt-0.5 block w-full text-[10.5px] font-medium leading-snug sm:text-[11px]"
                  style={{ color: "var(--text-tertiary)" }}
                  aria-live="polite"
                >
                  Liste güncelleniyor, mevcut sonuçlar korunuyor.
                </span>
              ) : null}
            </div>
            <div className="flex justify-end pt-1 md:hidden">
              <CompareListEntry />
            </div>
            <p className="sr-only">Tabloda arama, kategori, sıralama ve karşılaştırma kullanılabilir.</p>
            {quickStartActive ? (
              <div className="mt-1.5 hidden flex-wrap items-center gap-1.5 sm:flex">
                {activeViewLabel ? (
                  <span
                    className="inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-medium"
                    style={{ borderColor: "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))", color: "var(--text-secondary)", background: "color-mix(in srgb, var(--accent-blue) 5%, var(--card-bg))" }}
                  >
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                      {activeViewLabel}
                    </span>
                  </span>
                ) : null}
                {quickStartUniverseHint ? (
                  <span
                    className="hidden max-w-[11rem] truncate text-[9px] font-medium sm:inline"
                    style={{ color: "var(--text-tertiary)" }}
                    title={quickStartUniverseHint}
                  >
                    {quickStartUniverseHint}
                  </span>
                ) : null}
                {quickStartOnClear ? (
                  <button
                    type="button"
                    onClick={quickStartOnClear}
                    className="text-[9.5px] font-medium transition-colors hover:text-[var(--text-primary)]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hidden w-full min-w-0 flex-col gap-2 md:flex md:w-auto md:max-w-[min(100%,22rem)] lg:max-w-[min(100%,26rem)] xl:max-w-[min(100%,30rem)] md:flex-shrink-0 md:flex-row md:flex-wrap md:items-center md:justify-end md:gap-2">
            <div className="relative min-w-0 w-full md:min-w-[10.5rem] md:flex-1 md:max-w-[14rem]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-[13px] w-[13px] -translate-y-1/2 opacity-[0.78]"
                style={{ color: "var(--text-tertiary)" }}
                strokeWidth={2}
                aria-hidden
              />
              <input
                type="search"
                enterKeyHint="search"
                placeholder="Kod veya unvan ara…"
                value={search}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearch(next);
                  setActiveIntent(null);
                  setPage(1);
                  syncUrlState({ query: next, intent: null });
                }}
                className="research-search w-full"
                autoComplete="off"
                aria-label="Fon ara"
              />
            </div>
            {enableCategoryFilter ? (
              <div className="research-select-wrap min-w-0 w-full md:w-[min(100%,12rem)] md:max-w-[13rem] md:flex-shrink-0">
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategory(next);
                    setActiveIntent(null);
                    setPage(1);
                    syncUrlState({ category: next, intent: null });
                  }}
                  className="research-select"
                  aria-label="Kategori filtresi"
                >
                  <option value="">Tüm kategoriler</option>
                  {availableCategories.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="research-select-chevron h-3 w-3" strokeWidth={2} aria-hidden />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
              {hasFilters ? (
                <button type="button" onClick={resetFilters} className="screener-clear-btn shrink-0">
                  <X className="h-3 w-3" strokeWidth={2} aria-hidden />
                  Temizle
                </button>
              ) : null}
              <CompareListEntry />
            </div>
          </div>
        </div>
      </header>

      {/* Mobil: arama + filtre + sırala — header altında sticky; masaüstünde bu blok yok */}
      <div
        className="home-funds-mobile-toolbar md:hidden"
        style={{
          position: "sticky",
          top: "calc(3.375rem + env(safe-area-inset-top, 0px))",
          zIndex: 35,
          borderBottom: "1px solid color-mix(in srgb, var(--border-subtle) 72%, transparent)",
          background: "color-mix(in srgb, var(--card-bg) 88%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-[15px] w-[15px] -translate-y-1/2 opacity-[0.78]"
              style={{ color: "var(--text-tertiary)" }}
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="search"
              enterKeyHint="search"
              placeholder="Fon ara…"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setActiveIntent(null);
                setPage(1);
                syncUrlState({ query: next, intent: null });
              }}
              className="research-search research-search--home-sticky w-full min-w-0"
              autoComplete="off"
              aria-label="Fon ara"
            />
          </div>
          <button
            type="button"
            onClick={() => setMobileSheet("filters")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] border transition-[opacity,background-color] active:opacity-90"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
            aria-label="Filtreler ve sıralama modu"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setMobileSheet("sort")}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.85rem] border transition-[opacity,background-color] active:opacity-90"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface)",
              color: "var(--text-primary)",
            }}
            aria-label="Listeyi sırala"
          >
            <ArrowDownWideNarrow className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
        {mobileFilterChips.length > 0 || (quickStartActive && activeViewLabel) ? (
          <div
            className="flex gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ borderTop: "1px solid color-mix(in srgb, var(--border-subtle) 55%, transparent)" }}
          >
            {quickStartActive && activeViewLabel ? (
              <div
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))",
                  background: "color-mix(in srgb, var(--accent-blue) 5%, var(--card-bg))",
                }}
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-tertiary)" }}>
                  Rota
                </span>
                <span className="max-w-[11rem] truncate text-[11px] font-semibold" style={{ color: "var(--text-primary)" }} title={activeViewLabel}>
                  {activeViewLabel}
                </span>
                {quickStartOnClear ? (
                  <button
                    type="button"
                    onClick={quickStartOnClear}
                    className="shrink-0 rounded-md px-1 py-0.5 text-[10px] font-semibold"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Sıfırla
                  </button>
                ) : null}
              </div>
            ) : null}
            {mobileFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium"
                style={{
                  borderColor: "color-mix(in srgb, var(--border-subtle) 86%, transparent)",
                  background: "color-mix(in srgb, var(--card-bg) 95%, var(--bg-muted))",
                  color: "var(--text-secondary)",
                }}
              >
                <span className="max-w-[10rem] truncate">{chip.label}</span>
                <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              </button>
            ))}
            {hasFilters && mobileFilterChips.length > 0 ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex shrink-0 items-center rounded-full border px-2.5 py-1.5 text-[11px] font-semibold"
                style={{
                  borderColor: "var(--border-subtle)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                }}
              >
                Tümünü temizle
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {showTableLoadingSkeleton ? (
        <p
          className="px-3 pt-1 text-[11px] font-medium md:px-4"
          style={{ color: "var(--text-tertiary)" }}
          role="status"
          aria-live="polite"
        >
          Liste ve skorlar yükleniyor…
        </p>
      ) : null}

      <div className="md:hidden space-y-1.5 px-3 py-1.5">
        {showTableLoadingSkeleton ? (
          [...Array(8)].map((_, i) => (
            <div key={i} className="mobile-fund-card mobile-fund-card--scan min-h-[4.5rem] animate-pulse">
              <div className="flex items-start gap-2.5 px-0 py-0">
                <div className="h-9 w-9 shrink-0 rounded-[0.85rem]" style={{ background: "var(--bg-muted)" }} />
                <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                  <div className="h-3 w-16 rounded" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-4 w-full max-w-[14rem] rounded" style={{ background: "var(--bg-muted)" }} />
                  <div className="h-3 w-[72%] rounded" style={{ background: "var(--bg-muted)" }} />
                </div>
              </div>
            </div>
          ))
        ) : discoverySurfaceState === "error" && paginatedFunds.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="error">
            {error}
          </p>
        ) : showDegradedScoped && paginatedFunds.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="degraded_scoped">
            {degradedScopedMessage}
          </p>
        ) : paginatedFunds.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="empty_scoped">
            {emptyListMessage}
          </p>
        ) : (
          paginatedFunds.map((fund) => <FundRowMobile key={fund.fundId} fund={fund} />)
        )}
      </div>

      <div className="hidden md:block overflow-x-auto tefas-table-touch-scroll">
        <table className="fund-data-table min-w-[736px] w-full text-left">
          <colgroup>
            <col className="fund-col-name" />
            <col className="fund-col-gutter" />
            <col className="fund-col-type" />
            <col className="fund-col-price" />
            <col className="fund-col-1d" />
            <col className="fund-col-inv" />
            <col className="fund-col-aum" />
            <col className="fund-col-compare" />
          </colgroup>
          <thead>
            <tr className="table-header-row">
              <th className="fund-th fund-th-name" scope="col">
                <span className="scored-th-label">Fon</span>
              </th>
              <th className="fund-th fund-th-gutter" scope="col" aria-hidden="true" />
              <th className="fund-th fund-th-type" scope="col">
                <SortableHeader
                  label="Fon türü"
                  field="fundType"
                  align="left"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("fundType")}
                />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader
                  label="Son fiyat"
                  field="lastPrice"
                  currentField={sortField}
                  currentDir={sortDir}
                  onClick={() => handleSort("lastPrice")}
                />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="1G" field="dailyReturn" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("dailyReturn")} />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="Yatırımcı" field="investorCount" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("investorCount")} />
              </th>
              <th className="fund-th fund-th-num fund-th-metric table-num" scope="col">
                <SortableHeader label="Portföy" field="portfolioSize" currentField={sortField} currentDir={sortDir} onClick={() => handleSort("portfolioSize")} />
              </th>
              <th className="fund-th fund-th-compare table-num" scope="col">
                <span className="sr-only">Karşılaştırma</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {showTableLoadingSkeleton ? (
              [...Array(10)].map((_, i) => (
                <tr key={i} className="table-row">
                  <td colSpan={8} className="px-6 py-3">
                    <div className="h-10 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
                  </td>
                </tr>
              ))
            ) : discoverySurfaceState === "error" && paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="error">
                  {error}
                </td>
              </tr>
            ) : showDegradedScoped && paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="degraded_scoped">
                  {degradedScopedMessage}
                </td>
              </tr>
            ) : paginatedFunds.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-14 text-center text-sm" style={{ color: "var(--text-muted)" }} data-discovery-empty-state="empty_scoped">
                  {emptyListMessage}
                </td>
              </tr>
            ) : (
              paginatedFunds.map((fund) => <FundDataTableRow key={fund.fundId} fund={fund} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div
          className="flex items-center justify-between border-t px-4 py-3 sm:px-6"
          style={{ borderColor: "var(--border-subtle)", background: "var(--table-footer-bg)" }}
        >
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            <strong className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {filteredFunds.length}
            </strong>{" "}
            fon
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn btn-secondary touch-manipulation flex h-11 w-11 items-center justify-center rounded-lg p-0 disabled:opacity-40 md:h-9 md:w-9"
            >
              <ChevronLeft className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
            </button>
            <span className="px-2 text-xs font-medium tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="btn btn-secondary touch-manipulation flex h-11 w-11 items-center justify-center rounded-lg p-0 disabled:opacity-40 md:h-9 md:w-9"
            >
              <ChevronRight className="h-4 w-4" style={{ color: "var(--text-secondary)" }} />
            </button>
          </div>
        </div>
      )}

      <MobileBottomSheet
        open={mobileSheet === "filters"}
        title="Filtreler"
        onClose={() => setMobileSheet(null)}
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetFilters();
                setMobileSheet(null);
              }}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[0.95rem] border px-3 text-sm font-semibold"
              style={{
                borderColor: "var(--border-default)",
                background: "transparent",
                color: "var(--text-secondary)",
              }}
            >
              Temizle
            </button>
            <button
              type="button"
              onClick={() => setMobileSheet(null)}
              className="inline-flex min-h-11 flex-[1.2] items-center justify-center rounded-[0.95rem] px-3 text-sm font-semibold"
              style={{
                background: "var(--text-primary)",
                color: "var(--card-bg)",
              }}
            >
              Uygula
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Arama
            </label>
            <input
              type="search"
              enterKeyHint="search"
              placeholder="Kod veya unvan"
              value={search}
              onChange={(e) => {
                const next = e.target.value;
                setSearch(next);
                setActiveIntent(null);
                setPage(1);
                syncUrlState({ query: next, intent: null });
              }}
              className="h-11 w-full rounded-[0.95rem] border px-3 text-sm"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-surface)",
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Sıralama modu
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["BEST", "En İyi"],
                ["LOW_RISK", "Düşük Risk"],
                ["HIGH_RETURN", "Yüksek Getiri"],
                ["STABLE", "Stabil"],
              ] as Array<[RankingMode, string]>).map(([value, label]) => {
                const active = rankingMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => handleRankingModeChange(value)}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {enableCategoryFilter ? (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
                Kategori
              </label>
              <div className="research-select-wrap">
                <select
                  value={category}
                  onChange={(e) => {
                    const next = e.target.value;
                    setCategory(next);
                    setActiveIntent(null);
                    setPage(1);
                    syncUrlState({ category: next, intent: null });
                  }}
                  className="research-select min-h-11 text-sm"
                  aria-label="Kategori filtresi"
                >
                  <option value="">Tüm kategoriler</option>
                  {availableCategories.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="research-select-chevron h-4 w-4" strokeWidth={2} aria-hidden />
              </div>
            </div>
          ) : null}
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={mobileSheet === "sort"}
        title="Sırala"
        onClose={() => setMobileSheet(null)}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Alan
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["portfolioSize", "Portföy"],
                ["finalScore", "Skor"],
                ["dailyReturn", "1G"],
                ["lastPrice", "Son fiyat"],
                ["fundType", "Fon türü"],
                ["investorCount", "Yatırımcı"],
              ] as Array<[SortField, string]>).map(([value, label]) => {
                const active = sortField === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortField(value);
                      setPage(1);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
              Yön
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["desc", "Azalan"],
                ["asc", "Artan"],
              ] as Array<[SortDir, string]>).map(([value, label]) => {
                const active = sortDir === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setSortDir(value);
                      setPage(1);
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-[0.95rem] border px-3 text-[12px] font-semibold"
                    style={{
                      borderColor: active ? "var(--segment-active-border)" : "var(--border-default)",
                      background: active ? "color-mix(in srgb, var(--accent-blue) 7%, var(--card-bg))" : "var(--bg-surface)",
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </MobileBottomSheet>
    </section>
  );
}

function SortableHeader({
  label,
  field,
  currentField,
  currentDir,
  onClick,
  align = "right",
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  const isActive = currentField === field;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`sortable-th-btn table-num text-[10px] font-semibold uppercase tracking-[0.12em] ${align === "left" ? "sortable-th-btn--left" : ""}`}
      style={{ color: isActive ? "var(--accent-blue)" : "var(--text-secondary)" }}
    >
      <span className="sort-th-label">{label}</span>
      <span className="sort-icon-slot" aria-hidden>
        {isActive ? (
          currentDir === "desc" ? (
            <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
          ) : (
            <ChevronUp className="h-3 w-3" strokeWidth={1.75} />
          )
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 opacity-[0.48]" strokeWidth={1.75} />
        )}
      </span>
    </button>
  );
}
