import fs from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = (process.env.PERF_BASE_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");
const runs = Number(process.env.PERF_RUNS || "7");
const outputPath = process.env.PERF_OUTPUT_PATH || ".cache/perf-critical-latest.json";
const pauseMs = Number(process.env.PERF_PAUSE_MS || "120");
/** `networkidle` can stall on long-polling; override e.g. `domcontentloaded` for local repeats. */
const pageWaitUntil = process.env.PERF_PAGE_WAIT_UNTIL || "networkidle";
/** Set to `1` to measure API timings only (no Playwright); same URLs/order as the full run loop. */
const apisOnly = process.env.PERF_APIS_ONLY === "1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function summarize(values) {
  if (values.length === 0) return { avg: 0, median: 0, p95: 0, min: 0, max: 0 };
  const total = values.reduce((sum, n) => sum + n, 0);
  return {
    avg: Math.round((total / values.length) * 100) / 100,
    median: percentile(values, 50),
    p95: percentile(values, 95),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function readServerTimingMs(headers, metricName) {
  const raw = headers["server-timing"];
  if (!raw) return null;
  const parts = String(raw).split(",");
  for (const part of parts) {
    const [name, ...params] = part.trim().split(";");
    if (name.trim() !== metricName) continue;
    for (const param of params) {
      const [k, v] = param.split("=");
      if (k?.trim() === "dur") return toNumber(v);
    }
  }
  return null;
}

async function measureApi(path) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const endedAt = performance.now();
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`API ${path} -> ${response.status}: ${body.slice(0, 220)}`);
  }
  const headers = Object.fromEntries(response.headers.entries());
  return {
    e2eMs: Math.round(endedAt - startedAt),
    contentLength: toNumber(headers["content-length"]),
    serverTimingTotalMs: readServerTimingMs(headers, "total"),
    headers,
  };
}

async function measurePage(page, path) {
  const nav = await page.goto(`${baseUrl}${path}`, { waitUntil: pageWaitUntil, timeout: 45_000 });
  if (!nav) throw new Error(`No navigation response for ${path}`);
  const navTiming = await page.evaluate(() => {
    const navEntry = performance.getEntriesByType("navigation")[0];
    if (!navEntry) return null;
    const ttfb = navEntry.responseStart - navEntry.requestStart;
    const dcl = navEntry.domContentLoadedEventEnd - navEntry.startTime;
    const load = navEntry.loadEventEnd - navEntry.startTime;
    return {
      ttfbMs: Math.round(ttfb),
      domContentLoadedMs: Math.round(dcl),
      loadEventMs: Math.round(load),
    };
  });
  if (!navTiming) throw new Error(`Navigation timing missing for ${path}`);
  return navTiming;
}

async function run() {
  const measures = {
    homepageInitialLoad: [],
    homepageFilterSearchUpdate: [],
    fundDetailOpen: [],
    compareModuleOpen: [],
    compareSeriesLoad: [],
    apiFunds: [],
    apiScores: [],
    apiCompare: [],
    apiCompareSeries: [],
  };

  if (apisOnly) {
    for (let i = 0; i < runs; i += 1) {
      measures.apiFunds.push(await measureApi("/api/funds?page=1&pageSize=50&sort=portfolioSize:desc"));
      measures.apiScores.push(await measureApi("/api/funds/scores?mode=BEST"));
      measures.apiCompare.push(await measureApi("/api/funds/compare?codes=VGA,TI1,ZP8"));
      measures.apiCompareSeries.push(await measureApi("/api/funds/compare-series?base=VGA&codes=TI1,ZP8"));
      measures.compareSeriesLoad.push(await measureApi("/api/funds/compare-series?base=VGA&codes=TI1,ZP8"));
      await sleep(pauseMs);
    }
  } else {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

    for (let i = 0; i < runs; i += 1) {
      measures.apiFunds.push(await measureApi("/api/funds?page=1&pageSize=50&sort=portfolioSize:desc"));
      measures.apiScores.push(await measureApi("/api/funds/scores?mode=BEST"));
      measures.apiCompare.push(await measureApi("/api/funds/compare?codes=VGA,TI1,ZP8"));
      measures.apiCompareSeries.push(await measureApi("/api/funds/compare-series?base=VGA&codes=TI1,ZP8"));

      measures.homepageInitialLoad.push(await measurePage(page, "/"));
      const searchStartedAt = performance.now();
      const input = page.locator("input.research-search.w-full:not(.research-search--home-sticky):visible").first();
      await input.fill("is portfoy para");
      await page.waitForResponse(
        (resp) => resp.url().includes("/api/funds/scores?") && resp.request().method() === "GET",
        { timeout: 25_000 }
      );
      const searchEndedAt = performance.now();
      measures.homepageFilterSearchUpdate.push({ e2eMs: Math.round(searchEndedAt - searchStartedAt) });

      measures.fundDetailOpen.push(await measurePage(page, "/fund/VGA"));
      measures.compareModuleOpen.push(await measurePage(page, "/compare?codes=VGA,TI1,ZP8"));
      measures.compareSeriesLoad.push(await measureApi("/api/funds/compare-series?base=VGA&codes=TI1,ZP8"));
      await sleep(pauseMs);
    }

    await browser.close();
  }

  const report = {
    baseUrl,
    runs,
    apisOnly,
    pageWaitUntil,
    generatedAt: new Date().toISOString(),
    raw: measures,
    summary: {
      homepageInitialLoad_domContentLoadedMs: summarize(measures.homepageInitialLoad.map((x) => x.domContentLoadedMs)),
      homepageInitialLoad_ttfbMs: summarize(measures.homepageInitialLoad.map((x) => x.ttfbMs)),
      homepageFilterSearchUpdate_e2eMs: summarize(measures.homepageFilterSearchUpdate.map((x) => x.e2eMs)),
      fundDetailOpen_domContentLoadedMs: summarize(measures.fundDetailOpen.map((x) => x.domContentLoadedMs)),
      compareModuleOpen_domContentLoadedMs: summarize(measures.compareModuleOpen.map((x) => x.domContentLoadedMs)),
      compareSeriesLoad_e2eMs: summarize(measures.compareSeriesLoad.map((x) => x.e2eMs)),
      apiFunds_e2eMs: summarize(measures.apiFunds.map((x) => x.e2eMs)),
      apiScores_e2eMs: summarize(measures.apiScores.map((x) => x.e2eMs)),
      apiCompare_e2eMs: summarize(measures.apiCompare.map((x) => x.e2eMs)),
      apiCompareSeries_e2eMs: summarize(measures.apiCompareSeries.map((x) => x.e2eMs)),
      apiCompareSeries_payloadBytes: summarize(measures.apiCompareSeries.map((x) => x.contentLength)),
    },
  };

  await fs.mkdir(outputPath.split("/").slice(0, -1).join("/"), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[perf-critical] wrote ${outputPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
}

run().catch((error) => {
  console.error("[perf-critical] failed", error);
  process.exit(1);
});
