const SECTOR_BY_SYMBOL: Record<string, string> = {
  // Mali Endeks (XUMAL): banka, holding, sigorta, gyo
  AKBNK: "XUMAL",
  ALBRK: "XUMAL",
  GARAN: "XUMAL",
  HALKB: "XUMAL",
  ISCTR: "XUMAL",
  SKBNK: "XUMAL",
  TSKB: "XUMAL",
  VAKBN: "XUMAL",
  YKBNK: "XUMAL",
  AGHOL: "XUMAL",
  ALARK: "XUMAL",
  DOHOL: "XUMAL",
  ENKAI: "XUMAL",
  GLYHO: "XUMAL",
  KCHOL: "XUMAL",
  NTHOL: "XUMAL",
  SAHOL: "XUMAL",
  TRGYO: "XUMAL",
  EKGYO: "XUMAL",
  ISGYO: "XUMAL",
  AKGRT: "XUMAL",
  ANSGR: "XUMAL",
  TURSG: "XUMAL",

  // Hizmetler Endeksi (XUHIZ): perakende, ulastirma, turizm, telekom
  BIMAS: "XUHIZ",
  MGROS: "XUHIZ",
  SOKM: "XUHIZ",
  BIZIM: "XUHIZ",
  AEFES: "XUHIZ",
  CCOLA: "XUHIZ",
  TABGD: "XUHIZ",
  ULKER: "XUHIZ",
  THYAO: "XUHIZ",
  PGSUS: "XUHIZ",
  TAVHL: "XUHIZ",
  PASEU: "XUHIZ",
  CLEBI: "XUHIZ",
  TCELL: "XUHIZ",
  TTKOM: "XUHIZ",

  // Teknoloji Endeksi (XUTEK): yazilim ve bilisim
  ARDYZ: "XUTEK",
  DESPC: "XUTEK",
  FONET: "XUTEK",
  INDES: "XUTEK",
  KFEIN: "XUTEK",
  LINK: "XUTEK",
  LOGO: "XUTEK",
  NETAS: "XUTEK",
  PAPIL: "XUTEK",
  PKART: "XUTEK",

  // Sinai Endeks (XUSIN): uretim, enerji, kimya
  AKSEN: "XUSIN",
  AYDEM: "XUSIN",
  ENERY: "XUSIN",
  ENJSA: "XUSIN",
  EUPWR: "XUSIN",
  GWIND: "XUSIN",
  ODAS: "XUSIN",
  ZOREN: "XUSIN",
  AKENR: "XUSIN",
  AHGAZ: "XUSIN",
  AKSA: "XUSIN",
  GUBRF: "XUSIN",
  HEKTS: "XUSIN",
  PETKM: "XUSIN",
  SASA: "XUSIN",
  TUPRS: "XUSIN",
  ARCLK: "XUSIN",
  ASELS: "XUSIN",
  ASTOR: "XUSIN",
  BRSAN: "XUSIN",
  CEMTS: "XUSIN",
  DOAS: "XUSIN",
  EGEEN: "XUSIN",
  EREGL: "XUSIN",
  FROTO: "XUSIN",
  GOODY: "XUSIN",
  ISDMR: "XUSIN",
  KARSN: "XUSIN",
  KCAER: "XUSIN",
  KONTR: "XUSIN",
  KORDS: "XUSIN",
  OTKAR: "XUSIN",
  REEDR: "XUSIN",
  TOASO: "XUSIN",
  TTRAK: "XUSIN",
  VESBE: "XUSIN",
  VESTL: "XUSIN",
  YEOTK: "XUSIN",
  KRDMA: "XUSIN",
  KRDMB: "XUSIN",
  KRDMD: "XUSIN",
};

export function getSectorCodeForSymbol(symbol: string): string {
  return SECTOR_BY_SYMBOL[symbol] ?? "XUSIN";
}

function normalize(value: string): string {
  return value
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C");
}

const KEYWORD_TO_SECTOR: Array<[string[], string]> = [
  [["BILISIM", "YAZILIM", "TEKNOLOJI", "INTERNET", "VERI MERKEZI"], "XUTEK"],
  [["BANK", "KATILIM BANKASI", "MENKUL", "SIGORTA", "EMEKLILIK", "HOLDING", "GYO", "GAYRIMENKUL"], "XUMAL"],
  [["PERAKENDE", "TICARET", "MARKET", "MAGAZA", "TELEKOM", "ILETISIM", "HAVA", "ULASTIRMA", "TASIMACILIK", "LOJISTIK", "TURIZM", "OTEL"], "XUHIZ"],
  [["URETIM", "SANAYI", "ENERJI", "ELEKTRIK", "KIMYA", "PETROL", "PLASTIK", "GAZ", "OTOMOTIV", "MAKINA", "DEMIR", "CELIK", "METAL", "CIMENTO", "TEKSTIL"], "XUSIN"],
];

export function getSectorCodeForCompany(symbol: string, companyName: string): string {
  if (Object.prototype.hasOwnProperty.call(SECTOR_BY_SYMBOL, symbol)) {
    return SECTOR_BY_SYMBOL[symbol]!;
  }

  const n = normalize(companyName);
  for (const [keywords, sectorCode] of KEYWORD_TO_SECTOR) {
    if (keywords.some((keyword) => n.includes(keyword))) {
      return sectorCode;
    }
  }

  return "XUSIN";
}
