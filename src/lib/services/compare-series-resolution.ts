const DEFAULT_CODE_RE = /^[A-Z0-9]{2,12}$/;
const DEFAULT_MAX_CODES = 3;
const FILE_ONLY_MISS_REASONS = new Set(["file_missing", "file_empty", "file_parse_error"]);

export type CompareServingReadLike<TPayload> = {
  payload: TPayload | null;
  missReason?: string | null;
};

export type CompareServingReaderLike<TPayload> = (
  code: string,
  options?: { preferFileOnly?: boolean }
) => Promise<CompareServingReadLike<TPayload>>;

export function normalizeBaseCode(raw: string | null, codeRe: RegExp = DEFAULT_CODE_RE): string {
  const normalized = raw?.trim().toUpperCase() ?? "";
  return codeRe.test(normalized) ? normalized : "";
}

export function parseCompareCodes(
  raw: string | null,
  options?: { maxCodes?: number; codeRe?: RegExp }
): string[] {
  const codeRe = options?.codeRe ?? DEFAULT_CODE_RE;
  const maxCodes = options?.maxCodes ?? DEFAULT_MAX_CODES;
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => codeRe.test(x))
    ),
  ].slice(0, maxCodes);
}

export async function readServingPayloadForCompareSeries<TPayload>(
  code: string,
  readFn: CompareServingReaderLike<TPayload>
): Promise<CompareServingReadLike<TPayload>> {
  const fileOnlyRead = await readFn(code, { preferFileOnly: true });
  if (fileOnlyRead.payload) return fileOnlyRead;
  if (!FILE_ONLY_MISS_REASONS.has(fileOnlyRead.missReason ?? "")) return fileOnlyRead;
  const durableRead = await readFn(code, { preferFileOnly: false });
  return durableRead.payload ? durableRead : fileOnlyRead;
}
