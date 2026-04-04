import { publicFundLogoUrlFromManifest } from "@/lib/fund-logos-manifest";

/**
 * Fon adındaki portföy yönetim şirketi → doğrulanmış logo URL’i (SVG/PNG, mümkün olduğunca yüksek çözünürlük).
 * Öncelik: DB’deki logoUrl doluysa aynen kullanılır.
 *
 * Not: Google s2/favicons birçok .com.tr sitesinde 16px döndüğü için kullanılmıyor.
 */

type LogoRule = { needle: string; logoUrl: string };

/**
 * İlk eşleşen kazanır. Daha spesifik ifadeler (ör. DENİZBANK PORTFÖY) üstte olmalı.
 */
const PORTFOLIO_COMPANY_RULES: LogoRule[] = [
  { needle: "KUVEYT TÜRK PORTFÖY", logoUrl: "https://www.kuveytturkportfoy.com.tr/Content/images/favicon/apple-touch-icon.png" },
  { needle: "KUVEYT TURK PORTFOY", logoUrl: "https://www.kuveytturkportfoy.com.tr/Content/images/favicon/apple-touch-icon.png" },
  { needle: "KUVEYT TÜRK", logoUrl: "https://www.kuveytturkportfoy.com.tr/Content/images/favicon/apple-touch-icon.png" },
  { needle: "KUVEYT TURK", logoUrl: "https://www.kuveytturkportfoy.com.tr/Content/images/favicon/apple-touch-icon.png" },
  { needle: "PUSULA PORTFÖY", logoUrl: "https://www.pusulaportfoy.com.tr/Content/images/logo/pusula-logo-2026-2.png" },
  { needle: "PUSULA PORTFOY", logoUrl: "https://www.pusulaportfoy.com.tr/Content/images/logo/pusula-logo-2026-2.png" },

  { needle: "DENİZBANK PORTFÖY", logoUrl: "https://www.denizportfoy.com/asset/img/denizportfoy-header-logo.png" },
  { needle: "DENIZBANK PORTFOY", logoUrl: "https://www.denizportfoy.com/asset/img/denizportfoy-header-logo.png" },
  { needle: "DENİZ PORTFÖY", logoUrl: "https://www.denizportfoy.com/asset/img/denizportfoy-header-logo.png" },
  { needle: "DENIZ PORTFOY", logoUrl: "https://www.denizportfoy.com/asset/img/denizportfoy-header-logo.png" },

  { needle: "STANDARD CHARTERED", logoUrl: "https://www.google.com/s2/favicons?domain=standardchartered.co.uk&sz=256" },
  { needle: "SCHRODERS", logoUrl: "https://www.google.com/s2/favicons?domain=schroders.com&sz=256" },
  { needle: "ALLIANZ", logoUrl: "https://www.google.com/s2/favicons?domain=allianz.com&sz=256" },
  { needle: "UNİCREDİT", logoUrl: "https://www.google.com/s2/favicons?domain=unicreditgroup.eu&sz=256" },
  { needle: "UNICREDIT", logoUrl: "https://www.google.com/s2/favicons?domain=unicreditgroup.eu&sz=256" },
  { needle: "HSBC", logoUrl: "https://www.hsbc.com/apple-touch-icon.png" },

  { needle: "ING PORTFÖY", logoUrl: "https://www.ing.com.tr/documents/IngBank/assets/icons/favicon114.png" },
  { needle: "ING PORTFOY", logoUrl: "https://www.ing.com.tr/documents/IngBank/assets/icons/favicon114.png" },

  { needle: "YAPI KREDİ PORTFÖY", logoUrl: "https://assets.yapikredi.com.tr/WebSite/_assets/img/apple-touch-icon.png?v=3" },
  { needle: "YAPI KREDI PORTFOY", logoUrl: "https://assets.yapikredi.com.tr/WebSite/_assets/img/apple-touch-icon.png?v=3" },

  { needle: "GARANTİ PORTFÖY", logoUrl: "https://www.garantibbva.com.tr/apple-touch-icon-180x180.png" },
  { needle: "GARANTI PORTFOY", logoUrl: "https://www.garantibbva.com.tr/apple-touch-icon-180x180.png" },

  { needle: "İŞ PORTFÖY", logoUrl: "https://www.isportfoy.com.tr/_assets/images/favicon/apple-icon-180x180.png" },
  { needle: "IŞ PORTFÖY", logoUrl: "https://www.isportfoy.com.tr/_assets/images/favicon/apple-icon-180x180.png" },
  { needle: "IS PORTFOY", logoUrl: "https://www.isportfoy.com.tr/_assets/images/favicon/apple-icon-180x180.png" },

  { needle: "AK PORTFÖY", logoUrl: "https://www.akportfoy.com.tr/images/logo.svg" },
  { needle: "AK PORTFOY", logoUrl: "https://www.akportfoy.com.tr/images/logo.svg" },

  { needle: "ZİRAAT PORTFÖY", logoUrl: "https://www.ziraatportfoy.com.tr/lib/ziraat-tmp/assets/images/logo.png" },
  { needle: "ZIRAAT PORTFOY", logoUrl: "https://www.ziraatportfoy.com.tr/lib/ziraat-tmp/assets/images/logo.png" },

  { needle: "VAKIF PORTFÖY", logoUrl: "https://vbassets.vakifbank.com.tr/bankamiz/bankamiz-350x323.png" },
  { needle: "VAKIF PORTFOY", logoUrl: "https://vbassets.vakifbank.com.tr/bankamiz/bankamiz-350x323.png" },

  { needle: "HALK PORTFÖY", logoUrl: "https://www.halkbank.com.tr/etc.clientlibs/corporate-website/clientlibs/clientlib-site/resources/images/touch-icons/halkbank-180x180.png" },
  { needle: "HALK PORTFOY", logoUrl: "https://www.halkbank.com.tr/etc.clientlibs/corporate-website/clientlibs/clientlib-site/resources/images/touch-icons/halkbank-180x180.png" },

  { needle: "QNB PORTFÖY", logoUrl: "https://www.qnbportfoy.com.tr/assets/favicon/apple-icon-180x180.png" },
  { needle: "QNB PORTFOY", logoUrl: "https://www.qnbportfoy.com.tr/assets/favicon/apple-icon-180x180.png" },
  { needle: "FİNANS PORTFÖY", logoUrl: "https://www.qnbportfoy.com.tr/assets/favicon/apple-icon-180x180.png" },
  { needle: "FINANS PORTFOY", logoUrl: "https://www.qnbportfoy.com.tr/assets/favicon/apple-icon-180x180.png" },

  { needle: "TEB PORTFÖY", logoUrl: "https://www.tebportfoy.com.tr/_assets/img/logo.svg" },
  { needle: "TEB PORTFOY", logoUrl: "https://www.tebportfoy.com.tr/_assets/img/logo.svg" },

  { needle: "FİBA PORTFÖY", logoUrl: "https://cdn.fibabanka.com.tr/ResourcePackages/Fibabanka/assets/img/fb-logo.png" },
  { needle: "FIBA PORTFOY", logoUrl: "https://cdn.fibabanka.com.tr/ResourcePackages/Fibabanka/assets/img/fb-logo.png" },

  { needle: "ANADOLUBANK PORTFÖY", logoUrl: "https://www.anadolubank.com.tr/favicon.png" },
  { needle: "ANADOLUBANK PORTFOY", logoUrl: "https://www.anadolubank.com.tr/favicon.png" },

  { needle: "ATA PORTFÖY", logoUrl: "https://www.ataholding.com.tr/Content/images/logo.svg" },
  { needle: "ATA PORTFOY", logoUrl: "https://www.ataholding.com.tr/Content/images/logo.svg" },

  { needle: "OYAK PORTFÖY", logoUrl: "https://prodwww.mncdn.com/img/oyak-logo.svg" },
  { needle: "OYAK PORTFOY", logoUrl: "https://prodwww.mncdn.com/img/oyak-logo.svg" },

  { needle: "İSTANBUL PORTFÖY", logoUrl: "https://www.istanbulportfoy.com/assets/img/logo_black.svg" },
  { needle: "ISTANBUL PORTFOY", logoUrl: "https://www.istanbulportfoy.com/assets/img/logo_black.svg" },

  { needle: "NUROL PORTFÖY", logoUrl: "https://www.nurolportfoy.com.tr/favicon.png" },
  { needle: "NUROL PORTFOY", logoUrl: "https://www.nurolportfoy.com.tr/favicon.png" },

  { needle: "BURGAN PORTFÖY", logoUrl: "https://www.burgan.com.tr/assets/img/favicons/apple-icon-180x180.png" },
  { needle: "BURGAN PORTFOY", logoUrl: "https://www.burgan.com.tr/assets/img/favicons/apple-icon-180x180.png" },

  { needle: "ICBC", logoUrl: "https://www.google.com/s2/favicons?domain=icbc.com.cn&sz=256" },

  { needle: "ALBARAKA PORTFÖY", logoUrl: "https://www.albarakaportfoy.com.tr/Content/assets/images/logos/albaraka.svg" },
  { needle: "ALBARAKA PORTFOY", logoUrl: "https://www.albarakaportfoy.com.tr/Content/assets/images/logos/albaraka.svg" },

  { needle: "İNFO PORTFÖY", logoUrl: "https://www.infoyatirim.com/assets/img/logo-transparent.svg" },
  { needle: "INFO PORTFÖY", logoUrl: "https://www.infoyatirim.com/assets/img/logo-transparent.svg" },
  { needle: "INFO PORTFOY", logoUrl: "https://www.infoyatirim.com/assets/img/logo-transparent.svg" },
];

/** Kurallardaki ve Google s2 çıkış hostları — proxy yalnızca bunlara (veya güvenli DB URL’sine) gider. */
const CURATED_LOGO_HOSTS = new Set<string>();
for (const { logoUrl } of PORTFOLIO_COMPANY_RULES) {
  try {
    CURATED_LOGO_HOSTS.add(new URL(logoUrl).hostname.toLowerCase());
  } catch {
    /* ignore */
  }
}

/** Örn. harici CDN: `FUND_LOGO_FETCH_EXTRA_HOSTS=cdn.ornek.com,images.ornek.com` */
const EXTRA_FETCH_HOSTS = new Set<string>();
for (const part of (process.env.FUND_LOGO_FETCH_EXTRA_HOSTS ?? "").split(",")) {
  const h = part.trim().toLowerCase();
  if (h) EXTRA_FETCH_HOSTS.add(h);
}

function isSafePublicHttps(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 0) || (a === 169 && b === 254)) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

/** Proxy’nin SSRF olmadan hangi adresi çekebileceği. */
export function isResolvedLogoFetchAllowed(target: string, storedUrl: string | null | undefined): boolean {
  const storedTrim = storedUrl?.trim() ?? "";
  const usedDbOnly = Boolean(storedTrim) && target === storedTrim;
  try {
    const host = new URL(target).hostname.toLowerCase();
    if (CURATED_LOGO_HOSTS.has(host)) return true;
    if (EXTRA_FETCH_HOSTS.has(host)) return true;
    if (usedDbOnly && isSafePublicHttps(target)) return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Logo proxy URL’si — **fon id** ile (uzun TEFAS adı / encoding sorunu olmaz).
 */
export function fundLogoProxyUrlForFundId(
  fundId: string,
  storedUrl: string | null | undefined,
  fundName: string
): string | null {
  if (!resolveFundLogoUrl(storedUrl, fundName)) return null;
  return `/api/fund-logo?id=${encodeURIComponent(fundId)}`;
}

/**
 * Arayüz için logo adresi: önce `public/fund-logos` + manifest (yüksek çözünürlük),
 * yoksa mevcut proxy / portföy şirketi çözümlemesi.
 */
export function getFundLogoUrlForUi(
  fundId: string,
  code: string,
  storedUrl: string | null | undefined,
  fundName: string
): string | null {
  const local = publicFundLogoUrlFromManifest(code);
  if (local) return local;
  return fundLogoProxyUrlForFundId(fundId, storedUrl, fundName);
}

/** Eski `n`+`s` sorgu parametreli yol (yedek / doğrudan test). */
export function fundLogoProxyPathLegacy(
  storedUrl: string | null | undefined,
  fundName: string
): string | null {
  if (!resolveFundLogoUrl(storedUrl, fundName)) return null;
  const q = new URLSearchParams();
  q.set("n", fundName);
  q.set("s", storedUrl?.trim() ?? "");
  return `/api/fund-logo?${q.toString()}`;
}

export function resolveFundLogoUrl(
  storedUrl: string | null | undefined,
  fundName: string
): string | null {
  const t = storedUrl?.trim();
  if (t) return t;
  const haystack = fundName.toLocaleUpperCase("tr-TR");
  for (const { needle, logoUrl } of PORTFOLIO_COMPANY_RULES) {
    if (haystack.includes(needle)) return logoUrl;
  }
  return null;
}
