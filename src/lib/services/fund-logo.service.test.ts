import test from "node:test";
import assert from "node:assert/strict";
import { getFundLogoUrlForUi, resolveFundLogoUrl } from "@/lib/services/fund-logo.service";

test("fund logo resolver ignores internal proxy paths and prefers known portfolio rules", () => {
  const tera = getFundLogoUrlForUi("id-1", "TP2", "/api/fund-logo?id=stale", "TERA PORTFÖY PARA PİYASASI (TL) FONU");
  assert.ok(typeof tera === "string" && tera.startsWith("/api/fund-logo?"));
  assert.ok((tera ?? "").includes("TERA+PORTF"));

  const vga = getFundLogoUrlForUi(
    "id-2",
    "VGA",
    "https://www.turkiyehayatemeklilik.com.tr/content/images/favicon/apple-touch-icon.png",
    "TÜRKİYE HAYAT VE EMEKLİLİK A.Ş. ALTIN KATILIM EMEKLİLİK YATIRIM FONU"
  );
  assert.ok(typeof vga === "string" && vga.startsWith("/api/fund-logo?"));
  assert.ok((vga ?? "").includes("turkiyehayatemeklilik.com.tr"));

  assert.equal(
    resolveFundLogoUrl("/api/fund-logo?id=broken", "İŞ PORTFÖY PARA PİYASASI (TL) FONU"),
    "https://www.isportfoy.com.tr/_assets/images/favicon/apple-icon-180x180.png"
  );
});
