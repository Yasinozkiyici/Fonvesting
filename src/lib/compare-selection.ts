/** Tarayıcıda seçili fon kodları; karşılaştırma sayfası bu listeyi okur. */

export const COMPARE_STORAGE_KEY = "fonvesting_compare_codes_v1";
/** Aynı sekmede liste güncellemesini dinlemek için (storage yalnızca diğer sekmelerde tetiklenir). */
export const COMPARE_CODES_CHANGED_EVENT = "fonvesting_compare_codes_changed";
const STORAGE_KEY = COMPARE_STORAGE_KEY;
const MAX_CODES = 4;

function normalizeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().toUpperCase())
    .filter((c, i, a) => a.indexOf(c) === i)
    .slice(0, MAX_CODES);
}

export function readCompareCodes(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCompareCodes(codes: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeList(codes)));
    window.dispatchEvent(new Event(COMPARE_CODES_CHANGED_EVENT));
  } catch {
    /* ignore quota */
  }
}

/** En yenisi başta; en fazla 4 kod. */
export function addCompareCode(code: string): string[] {
  const u = code.trim().toUpperCase();
  if (!u) return readCompareCodes();
  const rest = readCompareCodes().filter((c) => c !== u);
  const next = [u, ...rest].slice(0, MAX_CODES);
  writeCompareCodes(next);
  return next;
}

export function removeCompareCode(code: string): string[] {
  const u = code.trim().toUpperCase();
  const next = readCompareCodes().filter((c) => c !== u);
  writeCompareCodes(next);
  return next;
}

export function isInCompareList(code: string): boolean {
  const u = code.trim().toUpperCase();
  return readCompareCodes().includes(u);
}

export const COMPARE_MAX_CODES = MAX_CODES;
