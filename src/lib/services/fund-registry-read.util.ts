function quoteForRestIn(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

export function buildFundCodeInClause(codes: string[]): string {
  return `(${codes.map(quoteForRestIn).join(",")})`;
}
