import type { ScoresApiSurfaceState } from "@/app/api/funds/scores/contract";

/**
 * Keşif yüzeyi durumu — tablo, özet ve spotlight aynı enum’u kullanır.
 */
export type DiscoverySurfaceState =
  | "loading_initial"
  | "loading_refresh"
  | "ready"
  | "empty_scoped"
  | "degraded_scoped"
  | "error";

export function deriveDiscoverySurfaceState(input: {
  loading: boolean;
  error: boolean;
  /** İlk anlamlı payload veya önbellek satırı görüldü mü */
  hasRenderableRows: boolean;
  /** Sunucu yüzey durumu (meta.surfaceState) */
  surfaceState: ScoresApiSurfaceState | null;
  degradedHeader: boolean;
}): DiscoverySurfaceState {
  if (input.error) return "error";
  if (input.loading && !input.hasRenderableRows) return "loading_initial";
  if (input.loading) return "loading_refresh";
  if (input.degradedHeader || input.surfaceState === "degraded_empty") return "degraded_scoped";
  if (input.surfaceState === "valid_empty") return "empty_scoped";
  if (input.surfaceState === "ready" || input.hasRenderableRows) return "ready";
  return "empty_scoped";
}
