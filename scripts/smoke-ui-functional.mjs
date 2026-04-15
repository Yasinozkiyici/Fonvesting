import { chromium } from "playwright";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const timeoutMs = Number(process.env.SMOKE_UI_TIMEOUT_MS || 45_000);

function fail(message) {
  throw new Error(`[smoke:ui-functional] ${message}`);
}

async function waitForTableRows(page, minRows = 1) {
  await page.waitForFunction(
    (count) => document.querySelectorAll("tbody tr").length >= count,
    minRows,
    { timeout: timeoutMs }
  );
}

async function visibleText(page) {
  await page.waitForSelector("body", { timeout: timeoutMs });
  return page.evaluate(() => document.body.innerText);
}

async function assertDetailUsable(page, code) {
  const response = await page.goto(`${baseUrl}/fund/${code}`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response || response.status() >= 400) fail(`/fund/${code} status ${response?.status() ?? "none"}`);
  await page.waitForSelector("text=Getiri karşılaştırması", { timeout: timeoutMs });

  const body = await visibleText(page);
  if (!body.includes("Karşılaştırma")) fail(`/fund/${code} missing comparison UI`);
  if (body.includes("0 geçti •0 geride •0 başa baş") && body.includes("Veri yetersiz")) {
    fail(`/fund/${code} comparison rendered only product-useless rows`);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(250);
  const expandedBody = await visibleText(page);
  if (!/alternatifler/i.test(expandedBody.toLocaleLowerCase("tr-TR"))) {
    fail(`/fund/${code} missing alternatives section`);
  }
  const alternativeLinks = await page.locator('section#fund-detail-alternatives a[href^="/fund/"]').count();
  if (alternativeLinks < 1) fail(`/fund/${code} alternatives section has no fund links`);
}

async function assertHomepageDiscovery(page) {
  const response = await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: timeoutMs });
  if (!response || response.status() >= 400) fail(`/ status ${response?.status() ?? "none"}`);

  const growth = page.getByRole("button", { name: /^Büyüme\b/ }).first();
  await growth.click({ timeout: timeoutMs });
  await waitForTableRows(page, 1);
  let body = await visibleText(page);
  if (body.includes("Bu kriterlere uygun fon yok")) fail("growth discovery produced empty state");

  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: timeoutMs });
  const input = page.locator('input[placeholder="Kod veya unvan ara…"]').first();
  await input.fill("is portfoy para");
  await page.waitForFunction(() => document.body.innerText.includes("TI1"), null, { timeout: timeoutMs });
  body = await visibleText(page);
  if (body.includes("Bu kriterlere uygun fon yok")) fail("ASCII Turkish name search produced empty state");

  await input.fill("ZP8");
  await page.waitForFunction(() => document.body.innerText.includes("ZP8"), null, { timeout: timeoutMs });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

try {
  for (const code of ["VGA", "TI1", "ZP8"]) {
    await assertDetailUsable(page, code);
    console.log(`[smoke:ui-functional] /fund/${code} ok`);
  }
  await assertHomepageDiscovery(page);
  console.log("[smoke:ui-functional] / discovery/search ok");
} finally {
  await browser.close();
}
