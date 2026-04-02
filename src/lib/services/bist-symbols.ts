export const DEFAULT_BIST_SYMBOLS = [
  "THYAO",
  "EREGL",
  "SASA",
  "GARAN",
  "AKBNK",
  "YKBNK",
  "KCHOL",
  "SAHOL",
  "ASELS",
  "SISE",
  "TUPRS",
  "FROTO",
  "TOASO",
  "TCELL",
  "BIMAS",
] as const;

const TO_YAHOO_ALIAS: Record<string, string> = {
  KOZAA: "TRMET",
  KOZAL: "TRALT",
};

const FROM_YAHOO_ALIAS: Record<string, string> = {
  TRMET: "KOZAA",
  TRALT: "KOZAL",
};

export function toBistYahooSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase().replace(/\.IS$/, "");
  return `${TO_YAHOO_ALIAS[clean] ?? clean}.IS`;
}

export function toBistBaseSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase().replace(/\.IS$/, "");
  return FROM_YAHOO_ALIAS[clean] ?? clean;
}

export function buildBistYahooSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map(toBistYahooSymbol))];
}
