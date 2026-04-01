const SECTOR_BY_SYMBOL: Record<string, string> = {
  // Bankacilik
  AKBNK: "XBANK",
  ALBRK: "XBANK",
  GARAN: "XBANK",
  HALKB: "XBANK",
  ISCTR: "XBANK",
  SKBNK: "XBANK",
  TSKB: "XBANK",
  VAKBN: "XBANK",
  YKBNK: "XBANK",

  // Holding ve yatirim
  AGHOL: "XHOLD",
  ALARK: "XHOLD",
  DOHOL: "XHOLD",
  ENKAI: "XHOLD",
  GLYHO: "XHOLD",
  KCHOL: "XHOLD",
  NTHOL: "XHOLD",
  SAHOL: "XHOLD",

  // Gida icecek
  AEFES: "XGIDA",
  BIMAS: "XGIDA",
  CCOLA: "XGIDA",
  MGROS: "XGIDA",
  SOKM: "XGIDA",
  TABGD: "XGIDA",
  ULKER: "XGIDA",
  BANVT: "XGIDA",

  // Iletisim
  TCELL: "XILTM",
  TTKOM: "XILTM",

  // Ulastirma
  THYAO: "XULAS",
  PGSUS: "XULAS",
  TAVHL: "XULAS",
  PASEU: "XULAS",
  CLEBI: "XULAS",

  // Spor
  BJKAS: "XSPOR",
  FENER: "XSPOR",
  GSRAY: "XSPOR",
  TSPOR: "XSPOR",

  // Elektrik
  AKSEN: "XELKT",
  AYDEM: "XELKT",
  ENERY: "XELKT",
  ENJSA: "XELKT",
  EUPWR: "XELKT",
  GWIND: "XELKT",
  ODAS: "XELKT",
  ZOREN: "XELKT",
  AKENR: "XELKT",

  // Kimya petrol plastik
  AHGAZ: "XKMYA",
  AKSA: "XKMYA",
  GUBRF: "XKMYA",
  HEKTS: "XKMYA",
  PETKM: "XKMYA",
  SASA: "XKMYA",
  TUPRS: "XKMYA",

  // Metal esya makina
  ARCLK: "XMESY",
  ASELS: "XMESY",
  ASTOR: "XMESY",
  BRSAN: "XMESY",
  CEMTS: "XMESY",
  DOAS: "XMESY",
  EGEEN: "XMESY",
  FROTO: "XMESY",
  GOODY: "XMESY",
  KARSN: "XMESY",
  KCAER: "XMESY",
  KONTR: "XMESY",
  KORDS: "XMESY",
  OTKAR: "XMESY",
  REEDR: "XMESY",
  TOASO: "XMESY",
  TTRAK: "XMESY",
  VESBE: "XMESY",
  VESTL: "XMESY",
  YEOTK: "XMESY",

  // Metal ana
  EREGL: "XMANA",
  ISDMR: "XMANA",
  KRDMA: "XMANA",
  KRDMB: "XMANA",
  KRDMD: "XMANA",

  // Gayrimenkul Y.O
  TRGYO: "XGMYO",
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
  [["BANK", "KATILIM BANKASI"], "XBANK"],
  [["MENKUL", "ARACI KURUM", "PORTFOY", "YATIRIM MENKUL"], "XAKUR"],
  [["SIGORTA", "EMEKLILIK"], "XSGRT"],
  [["HOLDING", "YATIRIM HOLDING"], "XHOLD"],
  [["GAYRIMENKUL", "GYO", "EMLAK", "REIT"], "XGMYO"],
  [["TELEKOM", "ILETISIM"], "XILTM"],
  [["BILISIM", "YAZILIM", "TEKNOLOJI", "INTERNET", "VERI MERKEZI"], "XBLSM"],
  [["ELEKTRIK URETIM", "ELEKTRIK", "ENERJI URETIM", "DAGITIM"], "XELKT"],
  [["KIMYA", "PETROL", "PLASTIK", "KAUCUK", "GAZ"], "XKMYA"],
  [["GIDA", "ICECEK", "SUT", "MARKET", "MAGAZA", "TUTUN"], "XGIDA"],
  [["TEKSTIL", "DERI", "IPLIK", "KONFEKSIYON"], "XTEKS"],
  [["ORMAN", "KAGIT", "BASIM", "AMBALAJ"], "XKAGT"],
  [["TURIZM", "OTEL"], "XTRZM"],
  [["SPOR"], "XSPOR"],
  [["HAVA", "LOJISTIK", "ULASTIRMA", "TASIMACILIK", "HAVALIMANI", "LIMAN"], "XULAS"],
  [["MADEN", "ALTIN", "KROM", "NIKEL"], "XMADN"],
  [["INSAAT", "TAAHHUT"], "XINSA"],
  [["TAS", "TOPRAK", "CIMENTO", "SERAMIK", "CAM"], "XTAST"],
  [["OTOMOTIV", "SAVUNMA", "MAKINA", "ELEKTRONIK", "BEYAZ ESYA"], "XMESY"],
  [["DEMIR", "CELIK", "METAL"], "XMANA"],
  [["TICARET", "PERAKENDE"], "XTRCT"],
];

export function getSectorCodeForCompany(symbol: string, companyName: string): string {
  if (Object.prototype.hasOwnProperty.call(SECTOR_BY_SYMBOL, symbol)) {
    return SECTOR_BY_SYMBOL[symbol];
  }

  const n = normalize(companyName);
  for (const [keywords, sectorCode] of KEYWORD_TO_SECTOR) {
    if (keywords.some((keyword) => n.includes(keyword))) {
      return sectorCode;
    }
  }

  return "XUSIN";
}
