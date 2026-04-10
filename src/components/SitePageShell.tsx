import type { ReactNode } from "react";

/**
 * Stoklar / sektörler sayfalarıyla aynı sabit zemin ve katman sırası (z-0 mesh, z-10 içerik).
 * Ana sayfa ve fon detayında mesh eksik kaldığında “sadece metin” hissi oluşabiliyordu.
 */
export function SitePageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <div className="gradient-mesh" aria-hidden>
        <div className="mesh-layer-1" />
        <div className="mesh-layer-2" />
        <div className="mesh-layer-3" />
        <div className="noise" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
    </div>
  );
}
