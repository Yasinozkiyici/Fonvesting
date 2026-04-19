export const CRITICAL_API_CONTRACTS = [
  {
    id: "scores",
    label: "Scores BEST/Filtered",
    checks: [
      {
        id: "scores_best_unfiltered",
        path: "/api/funds/scores?mode=BEST&limit=300",
        expectedNonEmpty(payload) {
          return (
            Array.isArray(payload?.funds) &&
            payload.funds.length > 0 &&
            payload?.meta?.canonicalFreshness &&
            typeof payload.meta.canonicalFreshness.freshnessStatus === "string"
          );
        },
        degradedContract(payload) {
          return Array.isArray(payload?.funds) && typeof payload?.total === "number";
        },
        emptyAllowed(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length === 0 && payload?.source === "empty";
        },
      },
      {
        id: "scores_filtered",
        path: "/api/funds/scores?mode=BEST&category=HISSE&theme=technology&q=fon&limit=150",
        expectedNonEmpty(payload) {
          return (
            Array.isArray(payload?.funds) &&
            typeof payload?.matchedTotal === "number" &&
            payload?.meta?.discovery &&
            payload.meta.discovery.scope?.active === true
          );
        },
        degradedContract(payload) {
          return Array.isArray(payload?.funds) && typeof payload?.total === "number";
        },
        emptyAllowed(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length === 0 && typeof payload?.total === "number";
        },
      },
    ],
  },
  {
    id: "comparison",
    label: "Comparison Payloads",
    checks: [
      {
        id: "comparison_payload",
        path: "/api/funds/compare?codes=VGA,TI2,IPB",
        expectedNonEmpty(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length >= 2 && payload?.compare && typeof payload.compare === "object";
        },
        degradedContract(payload) {
          return Array.isArray(payload?.funds) && "compare" in payload;
        },
        emptyAllowed(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length === 0 && payload?.compare === null;
        },
      },
      {
        id: "fund_detail_comparison_subsystem",
        path: "/api/funds/comparison?code=VGA",
        expectedNonEmpty(payload) {
          return (
            typeof payload === "object" &&
            payload &&
            typeof payload.state === "string" &&
            payload.contract &&
            typeof payload.contract.reason === "string"
          );
        },
        degradedContract(payload) {
          return typeof payload?.state === "string" && typeof payload?.degradedReason !== "undefined";
        },
        emptyAllowed() {
          return false;
        },
      },
    ],
  },
  {
    id: "chart",
    label: "Primary Chart Payload",
    checks: [
      {
        id: "primary_chart_payload",
        path: "/api/funds/compare-series?base=VGA&codes=TI2",
        expectedNonEmpty(payload) {
          const fundSeries = Array.isArray(payload?.fundSeries) ? payload.fundSeries : [];
          const primary = fundSeries.find((item) => String(item?.key || "").startsWith("fund:VGA"));
          return Boolean(primary && Array.isArray(primary.series) && primary.series.length > 0);
        },
        degradedContract(payload) {
          return Array.isArray(payload?.fundSeries) && payload?.macroSeries && typeof payload.macroSeries === "object";
        },
        emptyAllowed() {
          return false;
        },
      },
    ],
  },
  {
    id: "alternatives",
    label: "Alternatives Payload (Proxy)",
    checks: [
      {
        id: "alternatives_payload_proxy",
        path: "/api/funds/compare?codes=VGA,TI2",
        expectedNonEmpty(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length >= 2;
        },
        degradedContract(payload) {
          return Array.isArray(payload?.funds);
        },
        emptyAllowed(payload) {
          return Array.isArray(payload?.funds) && payload.funds.length === 0 && payload?.compare === null;
        },
      },
    ],
  },
  {
    id: "freshness_state",
    label: "Freshness / Last Update",
    checks: [
      {
        id: "freshness_state",
        path: "/api/health?mode=light",
        expectedNonEmpty(payload) {
          return Boolean(
            payload?.freshnessTruth &&
              typeof payload.freshnessTruth.freshnessStatus === "string" &&
              "latestSuccessfulSyncAt" in payload.freshnessTruth
          );
        },
        degradedContract(payload) {
          return Boolean(payload?.freshnessTruth && typeof payload?.status === "string");
        },
        emptyAllowed() {
          return false;
        },
      },
    ],
  },
];

export const DEGRADED_SCENARIO_PROBES = [
  {
    id: "stale_snapshot_available",
    description: "Stale snapshot var, sistem degrade okuyabiliyor",
    requiredForGate: false,
    evidence(ctx) {
      const payload = ctx.byPath.get("/api/health?mode=full")?.payload;
      if (!payload) return { seen: false, pass: false, reason: "health_full_missing" };
      const days = Number(payload?.freshness?.daysSinceLatestFundSnapshot ?? -1);
      const staleIssue = Array.isArray(payload?.issues)
        ? payload.issues.some((issue) => String(issue?.code || "").includes("stale_fund_snapshot"))
        : false;
      const seen = days >= 1 || staleIssue;
      return {
        seen,
        pass: seen ? Boolean(payload?.freshness && typeof payload.freshness.latestFundSnapshotDate !== "undefined") : false,
        reason: seen ? "freshness_exposed" : "scenario_not_observed",
      };
    },
  },
  {
    id: "persisted_cache_available",
    description: "Persisted/light fallback cache yolu ulasilabilir",
    requiredForGate: true,
    evidence(ctx) {
      const probe = ctx.byPath.get("/api/funds?page=1&pageSize=5&light=1");
      const cache = probe?.headers?.get("x-funds-cache") || "none";
      const seen = cache !== "none";
      const pass = /(light|serving|stale|fallback|fast)/i.test(cache);
      return { seen, pass, reason: `x-funds-cache=${cache}` };
    },
  },
  {
    id: "live_query_slow_or_failing",
    description: "Canli query yavas/hatali iken degrade karar sinyali var",
    requiredForGate: false,
    evidence(ctx) {
      const probe = ctx.byPath.get("/api/funds?page=1&pageSize=5");
      const failureClass = probe?.headers?.get("x-db-failure-class") || "none";
      const degraded = probe?.headers?.get("x-funds-degraded") || "none";
      const seen = failureClass !== "none" || degraded !== "none";
      const pass = seen ? true : false;
      return { seen, pass, reason: `x-db-failure-class=${failureClass} x-funds-degraded=${degraded}` };
    },
  },
  {
    id: "yesterday_data_missing",
    description: "Dun verisi eksik/yetismedi sinyali health'te goruluyor",
    requiredForGate: false,
    evidence(ctx) {
      const payload = ctx.byPath.get("/api/health?mode=full")?.payload;
      if (!payload) return { seen: false, pass: false, reason: "health_full_missing" };
      const issues = Array.isArray(payload?.issues) ? payload.issues.map((i) => String(i?.code || "")) : [];
      const seen = issues.some((code) => code.includes("missed_sla") || code.includes("stale_fund_snapshot"));
      const pass = seen ? Boolean(payload?.freshness) : false;
      return { seen, pass, reason: seen ? issues.join(",") : "scenario_not_observed" };
    },
  },
  {
    id: "partial_module_failure",
    description: "Secondary module dusse de primary chart ayakta kalir",
    requiredForGate: true,
    evidence(ctx) {
      const payload = ctx.byPath.get("/api/funds/compare-series?base=VGA&codes=ZZZZ")?.payload;
      if (!payload) return { seen: false, pass: false, reason: "chart_probe_missing" };
      const fundSeries = Array.isArray(payload?.fundSeries) ? payload.fundSeries : [];
      const primary = fundSeries.find((item) => String(item?.key || "").startsWith("fund:VGA"));
      const seen = fundSeries.length >= 1;
      const pass = Boolean(primary && Array.isArray(primary?.series) && primary.series.length > 0);
      return { seen, pass, reason: `fund_series=${fundSeries.length}` };
    },
  },
];

export const SUPPORTING_PROBE_PATHS = [
  "/api/health?mode=full",
  "/api/funds/comparison?code=VGA",
  "/api/funds?page=1&pageSize=5",
  "/api/funds?page=1&pageSize=5&light=1",
  "/api/funds/compare-series?base=VGA&codes=ZZZZ",
];
