import { chromium } from "playwright";
import {
  asReleaseVerificationError,
  buildPreviewAuthBlocker,
  emitReleaseClassification,
  isAuthBlockedStatus,
  ReleaseClassification,
  ReleaseDecision,
  ReleaseVerificationError,
} from "./release-verification-common.mjs";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_UI_TIMEOUT_MS || 45_000);
const locale = "tr-TR";
const comparisonCompanions = ["TI1", "ZP8", "VGA"];

function fail(message) {
  throw new Error(`[smoke:ui-functional] ${message}`);
}

function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase(locale);
}

async function waitForTableRows(page, minRows = 1) {
  await page.waitForFunction(
    (count) => document.querySelectorAll("tbody tr").length >= count,
    minRows,
    { timeout: timeoutMs }
  );
}

async function waitForLoadingToSettle(page) {
  await page.waitForTimeout(400);
}

async function visibleText(page) {
  await page.waitForSelector("body", { timeout: timeoutMs });
  return page.evaluate(() => document.body.innerText);
}

async function fetchJson(page, path) {
  const response = await page.request.get(`${baseUrl}${path}`, { timeout: timeoutMs });
  if (isAuthBlockedStatus(response.status())) {
    throw buildPreviewAuthBlocker(response.status(), `${baseUrl}${path}`);
  }
  if (!response.ok()) {
    throw new ReleaseVerificationError(`${path} status ${response.status()}`, {
      classification: ReleaseClassification.ENV_CONFIG_BLOCKER,
      decision: ReleaseDecision.RELEASE_BLOCKED,
      code: "upstream_http_failure",
      details: path,
    });
  }
  return response.json();
}

async function getHomepageRows(page) {
  await waitForTableRows(page, 1);
  await waitForLoadingToSettle(page);
  return page.locator("tbody tr");
}

async function getNoResultVisible(page) {
  const body = await visibleText(page).catch(() => "");
  return normalizeText(body).includes("bu kriterlere uygun fon yok");
}

async function assertSearch(page, input, query, expectedText) {
  await input.fill(query);
  const expected = normalizeText(expectedText);
  await page.waitForFunction(
    (needle) => {
      const rows = Array.from(document.querySelectorAll("tbody tr"));
      return rows.some((row) => row.textContent?.trim().toLocaleLowerCase("tr-TR").includes(needle));
    },
    expected,
    { timeout: timeoutMs }
  ).catch(() => undefined);
  await waitForLoadingToSettle(page);
  const rows = await getHomepageRows(page);
  const rowCount = await rows.count();
  let matched = false;
  for (let index = 0; index < rowCount; index += 1) {
    const rowText = normalizeText(await rows.nth(index).innerText());
    if (rowText.includes(expected)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    const searchApiPayload = await fetchJson(page, `/api/funds/scores?mode=BEST&q=${encodeURIComponent(query)}`);
    const apiCount = Array.isArray(searchApiPayload?.funds) ? searchApiPayload.funds.length : 0;
    if (apiCount > 0) {
      await page.waitForTimeout(1500);
      const retryRows = await getHomepageRows(page);
      const retryCount = await retryRows.count();
      for (let index = 0; index < retryCount; index += 1) {
        const rowText = normalizeText(await retryRows.nth(index).innerText());
        if (rowText.includes(expected)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        fail(`query "${query}" API returned ${apiCount} rows but UI did not surface "${expectedText}"`);
      }
      return;
    }
    throw new ReleaseVerificationError(
      `query "${query}" had no UI/API matches; insufficient verification evidence for release`,
      {
        classification: ReleaseClassification.SHALLOW_VERIFICATION,
        decision: ReleaseDecision.NO_GO,
        code: "search_evidence_missing",
      }
    );
  }
  if (await getNoResultVisible(page)) {
    fail(`query "${query}" rendered empty-state unexpectedly`);
  }
}

async function assertDetailUsable(page, code) {
  const companion = comparisonCompanions.find((item) => item !== code) || "TI1";
  const altCompanion = comparisonCompanions.find((item) => item !== code && item !== companion) || "ZP8";
  const comparePayload = await fetchJson(page, `/api/funds/compare?codes=${code},${companion}`);
  const compareSurfaceState = comparePayload?.meta?.surfaceState?.kind || null;
  if (!compareSurfaceState) fail(`/api/funds/compare for ${code} missing meta.surfaceState.kind`);
  const compareFunds = Array.isArray(comparePayload?.funds) ? comparePayload.funds.length : 0;
  if (compareSurfaceState === "ready" && compareFunds < 2) {
    fail(`/api/funds/compare for ${code} state=ready but returned <2 funds`);
  }

  const response = await page.goto(`${baseUrl}/fund/${code}`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response) fail(`/fund/${code} status none`);
  if (isAuthBlockedStatus(response.status())) {
    throw buildPreviewAuthBlocker(response.status(), `${baseUrl}/fund/${code}`);
  }
  if (response.status() >= 400) fail(`/fund/${code} status ${response.status()}`);
  await page.waitForSelector("[data-detail-surface-state]", { timeout: timeoutMs });
  await waitForLoadingToSettle(page);

  const detailSurfaceState = await page
    .locator("[data-detail-surface-state]")
    .first()
    .getAttribute("data-detail-surface-state")
    .catch(() => null);
  if (!detailSurfaceState) {
    fail(`/fund/${code} missing data-detail-surface-state`);
  }
  const detailReady = detailSurfaceState === "ready";
  if (!detailReady) {
    const degradedPanelCount = await page
      .locator(`[data-detail-surface-state="${detailSurfaceState}"]`)
      .count()
      .catch(() => 0);
    if (degradedPanelCount < 1) {
      fail(`/fund/${code} detail degraded state=${detailSurfaceState} has no explicit surface marker`);
    }
    return;
  }

  await page.waitForFunction(
    () => document.body.innerText.toLocaleLowerCase("tr-TR").includes("getiri karşılaştırması"),
    null,
    { timeout: timeoutMs }
  );

  const body = await visibleText(page);
  const normalizedBody = normalizeText(body);
  if (!normalizedBody.includes("karşılaştırma")) fail(`/fund/${code} missing comparison UI`);
  const comparisonPanelState = await page
    .locator("[data-fund-detail-comparison-summary-state]")
    .first()
    .getAttribute("data-fund-detail-comparison-summary-state")
    .catch(() => null);
  if (!comparisonPanelState) {
    fail(`/fund/${code} missing data-fund-detail-comparison-summary-state (comparison panel contract)`);
  }

  if (comparisonPanelState === "ready") {
    if (!normalizedBody.includes("öncelikli net fark")) fail(`/fund/${code} missing comparison summary`);
    if (normalizedBody.includes("0 geçti •0 geride •0 başa baş") && normalizedBody.includes("veri yetersiz")) {
      fail(`/fund/${code} comparison rendered product-useless rows`);
    }
    const comparisonRowCount = await page
      .locator("span")
      .filter({ hasText: /^(Geçti|Geride|Başa baş|Veri yetersiz)$/ })
      .count()
      .catch(() => 0);
    if (comparisonRowCount < 1) fail(`/fund/${code} comparison rows missing`);
  } else {
    const degradedReason = await page
      .locator("[data-fund-detail-comparison-degraded-reason]")
      .first()
      .getAttribute("data-fund-detail-comparison-degraded-reason")
      .catch(() => null);
    if (!degradedReason || degradedReason === "ready") {
      fail(
        `/fund/${code} comparison panel state=${comparisonPanelState} expected typed degraded reason (data-fund-detail-comparison-degraded-reason)`
      );
    }
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await waitForLoadingToSettle(page);

  const alternativesApi = await fetchJson(page, `/api/funds/compare?codes=${code},${altCompanion}`);
  const alternativesApiHasData = Array.isArray(alternativesApi?.funds) && alternativesApi.funds.length > 1;

  await page
    .waitForFunction(
      () => document.querySelectorAll('section#fund-detail-alternatives a[href^="/fund/"]').length > 0,
      null,
      { timeout: timeoutMs }
    )
    .catch(() => fail(`/fund/${code} alternatives section has no fund links`));

  const expandedBody = await visibleText(page);
  if (!/alternatifler/i.test(expandedBody.toLocaleLowerCase(locale))) {
    fail(`/fund/${code} missing alternatives section`);
  }

  const alternativeLinks = await page.locator('section#fund-detail-alternatives a[href^="/fund/"]').count();
  if (alternativesApiHasData && alternativeLinks < 1) {
    fail(`/fund/${code} API had alternatives but UI rendered empty`);
  }
  if (alternativeLinks < 1) fail(`/fund/${code} alternatives section has no fund links`);
}

async function assertCompareSurface(page) {
  const codes = ["VGA", "TI1"];
  const compareReadyPayload = await fetchJson(page, `/api/funds/compare?codes=${codes.join(",")}`);
  const readyState = compareReadyPayload?.meta?.surfaceState?.kind || null;
  if (!readyState) fail("/api/funds/compare missing meta.surfaceState.kind");

  await page.goto(`${baseUrl}/compare`, { waitUntil: "networkidle", timeout: timeoutMs });
  await page.evaluate(
    (codesToStore) => {
      localStorage.setItem("fonvesting_compare_codes_v1", JSON.stringify(codesToStore));
      window.dispatchEvent(new Event("fonvesting_compare_codes_changed"));
    },
    codes
  );
  await page.reload({ waitUntil: "networkidle", timeout: timeoutMs });
  await page.waitForSelector("[data-compare-surface-state]", { timeout: timeoutMs });
  await waitForLoadingToSettle(page);
  const uiReadyState = await page
    .locator("[data-compare-surface-state]")
    .first()
    .getAttribute("data-compare-surface-state")
    .catch(() => null);
  if (!uiReadyState) fail("/compare missing data-compare-surface-state");
  if (readyState === "ready") {
    const readyMarkerCount = await page.locator("[data-compare-surface-ready='1']").count();
    if (readyMarkerCount < 1) fail("/compare ready state missing success surface marker");
  } else {
    const degradedMarkerCount = await page.locator("[data-compare-surface-degraded='1']").count();
    if (degradedMarkerCount < 1) fail(`/compare state=${uiReadyState} missing degraded surface marker`);
  }

  await page.evaluate(() => {
    localStorage.setItem("fonvesting_compare_codes_v1", JSON.stringify(["VGA"]));
    window.dispatchEvent(new Event("fonvesting_compare_codes_changed"));
  });
  await page.reload({ waitUntil: "networkidle", timeout: timeoutMs });
  await page.waitForSelector("[data-compare-surface-state]", { timeout: timeoutMs });
  const insufficientState = await page
    .locator("[data-compare-surface-state]")
    .first()
    .getAttribute("data-compare-surface-state")
    .catch(() => null);
  if (insufficientState !== "degraded_insufficient_funds") {
    fail(`/compare insufficient funds state mismatch: ${String(insufficientState)}`);
  }
  const readyMarkerWithOneCode = await page.locator("[data-compare-surface-ready='1']").count();
  if (readyMarkerWithOneCode > 0) {
    fail("/compare rendered success surface with insufficient funds");
  }
}

async function assertHomepageDiscovery(page) {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response) fail("/ status none");
  if (isAuthBlockedStatus(response.status())) {
    throw buildPreviewAuthBlocker(response.status(), `${baseUrl}/`);
  }
  if (response.status() >= 400) fail(`/ status ${response.status()}`);
  await waitForLoadingToSettle(page);

  const initialRows = await getHomepageRows(page);
  const initialCount = await initialRows.count();
  if (initialCount < 1) fail("homepage explore list is empty");
  const initialTopText = normalizeText(await initialRows.first().innerText());

  const input = page.locator("input.research-search.w-full:not(.research-search--home-sticky):visible").first();
  await assertSearch(page, input, "ZP8", "ZP8");
  await assertSearch(page, input, "is portfoy para", "TI1");
  await assertSearch(page, input, "  iS pOrTfOy pArA  ", "TI1");

  await input.fill("olmayan-fon-kodu");
  await page.waitForFunction(
    () => document.body.innerText.toLocaleLowerCase("tr-TR").includes("bu kriterlere uygun fon yok"),
    null,
    { timeout: timeoutMs }
  ).catch(() => undefined);
  await waitForLoadingToSettle(page);
  const noResultShown = await getNoResultVisible(page);
  if (!noResultShown) fail("no-result state did not render on explicit no-match");

  await input.fill("");
  await waitForLoadingToSettle(page);

  const growth = page.getByRole("button", { name: /^Büyüme\b/ }).first();
  await growth.click({ timeout: timeoutMs });
  await page.waitForFunction(
    (before) => {
      const firstRow = document.querySelector("tbody tr");
      if (!firstRow) return false;
      const current = firstRow.textContent?.trim().toLocaleLowerCase("tr-TR") ?? "";
      return window.location.search.includes("mode=HIGH_RETURN") && current !== before;
    },
    initialTopText,
    { timeout: timeoutMs }
  ).catch(() => undefined);
  const filteredRows = await getHomepageRows(page);
  const filteredCount = await filteredRows.count();
  const body = await visibleText(page);
  if (body.includes("Bu kriterlere uygun fon yok")) fail("growth discovery produced empty state");

  if (initialCount === filteredCount) {
    const filteredTop = normalizeText(await filteredRows.first().innerText());
    if (initialTopText === filteredTop) {
      fail("filter action did not produce meaningful list change");
    }
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const runtimeErrors = [];

page.on("pageerror", (error) => {
  runtimeErrors.push(`[pageerror] ${error.message}`);
});

page.on("response", async (response) => {
  const url = response.url();
  if (!/\.(js|css)(\?|$)/i.test(url)) return;
  if (response.status() >= 400) {
    runtimeErrors.push(`[asset-http] status=${response.status()} url=${url}`);
    return;
  }
  const contentType = String(response.headers()["content-type"] || "").toLowerCase();
  if (/\.js(\?|$)/i.test(url) && !contentType.includes("javascript")) {
    runtimeErrors.push(`[asset-mime] expected=javascript got=${contentType || "none"} url=${url}`);
  }
  if (/\.css(\?|$)/i.test(url) && !contentType.includes("text/css")) {
    runtimeErrors.push(`[asset-mime] expected=text/css got=${contentType || "none"} url=${url}`);
  }
});

try {
  for (const code of ["VGA", "TI1", "ZP8"]) {
    await assertDetailUsable(page, code);
    console.log(`[smoke:ui-functional] /fund/${code} ok`);
  }
  await assertCompareSurface(page);
  console.log("[smoke:ui-functional] /compare boundary surface contract ok");
  await assertHomepageDiscovery(page);
  if (runtimeErrors.length > 0) {
    throw new ReleaseVerificationError("runtime/client asset failures detected", {
      classification: ReleaseClassification.RUNTIME_CLIENT_ASSET_FAILURE,
      decision: ReleaseDecision.NO_GO,
      code: "runtime_asset_failure",
      details: runtimeErrors.slice(0, 6).join(" | "),
    });
  }
  emitReleaseClassification({
    step: "ui_functional",
    decision: ReleaseDecision.GO,
    classification: "NONE",
    code: "all_assertions_passed",
    reason: "UI-functional verification succeeded on target URL",
  });
  console.log("[smoke:ui-functional] homepage discovery/search/filter ok");
} catch (error) {
  const classified = asReleaseVerificationError(error);
  emitReleaseClassification({
    step: "ui_functional",
    decision: classified.decision,
    classification: classified.classification,
    code: classified.code,
    reason: classified.message,
    details: classified.details,
  });
  process.exitCode = classified.decision === ReleaseDecision.RELEASE_BLOCKED ? 2 : 1;
} finally {
  await browser.close();
}
