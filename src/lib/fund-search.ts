const TURKISH_ASCII_FOLD: Record<string, string> = {
  İ: "i",
  I: "i",
  ı: "i",
  Ğ: "g",
  ğ: "g",
  Ü: "u",
  ü: "u",
  Ş: "s",
  ş: "s",
  Ö: "o",
  ö: "o",
  Ç: "c",
  ç: "c",
};

export function normalizeFundSearchText(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const folded = raw.replace(/[İIıĞğÜüŞşÖöÇç]/g, (char) => TURKISH_ASCII_FOLD[char] ?? char);
  return folded
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fundSearchMatches(
  query: string | null | undefined,
  fields: Array<string | null | undefined>
): boolean {
  const needle = normalizeFundSearchText(query);
  if (!needle) return true;
  const haystack = normalizeFundSearchText(fields.filter(Boolean).join(" "));
  if (!haystack) return false;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}
