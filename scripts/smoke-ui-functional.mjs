import { chromium } from "playwright";

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
  if (!response.ok()) fail(`${path} status ${response.status()}`);
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
      fail(`query "${query}" API returned ${apiCount} rows but UI did not surface "${expectedText}"`);
    }
    console.warn(
      `[smoke:ui-functional] query "${query}" had no UI/API matches in this environment; skipped strict expectation`
    );
    return;
  }
  if (await getNoResultVisible(page)) {
    fail(`query "${query}" rendered empty-state unexpectedly`);
  }
}

async function assertDetailUsable(page, code) {
  const companion = comparisonCompanions.find((item) => item !== code) || "TI1";
  const altCompanion = comparisonCompanions.find((item) => item !== code && item !== companion) || "ZP8";
  const comparePayload = await fetchJson(page, `/api/funds/compare?codes=${code},${companion}`);
  const compareFunds = Array.isArray(comparePayload?.funds) ? comparePayload.funds.length : 0;
  if (compareFunds < 2) fail(`/api/funds/compare for ${code} returned <2 funds`);

  const response = await page.goto(`${baseUrl}/fund/${code}`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response || response.status() >= 400) fail(`/fund/${code} status ${response?.status() ?? "none"}`);
  await page.waitForFunction(
    () => document.body.innerText.toLocaleLowerCase("tr-TR").includes("getiri karşılaştırması"),
    null,
    { timeout: timeoutMs }
  );
  await waitForLoadingToSettle(page);

  const body = await visibleText(page);
  const normalizedBody = normalizeText(body);
  if (!normalizedBody.includes("karşılaştırma")) fail(`/fund/${code} missing comparison UI`);
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

async function assertHomepageDiscovery(page) {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response || response.status() >= 400) fail(`/ status ${response?.status() ?? "none"}`);
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

try {
  for (const code of ["VGA", "TI1", "ZP8"]) {
    await assertDetailUsable(page, code);
    console.log(`[smoke:ui-functional] /fund/${code} ok`);
  }
  await assertHomepageDiscovery(page);
  console.log("[smoke:ui-functional] homepage discovery/search/filter ok");
} finally {
  await browser.close();
}
