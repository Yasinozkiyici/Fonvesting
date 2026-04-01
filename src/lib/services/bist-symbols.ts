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

export function toBistYahooSymbol(symbol: string): string {
  const clean = symbol.trim().toUpperCase().replace(/\.IS$/, "");
  return `${clean}.IS`;
}

export function toBistBaseSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\.IS$/, "");
}

export function buildBistYahooSymbols(symbols: readonly string[]): string[] {
  return [...new Set(symbols.map(toBistYahooSymbol))];
}
