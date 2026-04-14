"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FundDetailSectionStates } from "@/lib/fund-detail-section-status";

const AUTO_REFRESH_DELAY_MS = 2_500;
const AUTO_REFRESH_COOLDOWN_MS = 20_000;
const AUTO_REFRESH_MAX_ATTEMPTS = 1;

export function FundDetailAutoRecover({
  fundCode,
  degraded,
  sectionStates,
  suppressAutoRefresh = false,
}: {
  fundCode: string;
  degraded: boolean;
  sectionStates: FundDetailSectionStates;
  suppressAutoRefresh?: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (suppressAutoRefresh) return;

    const key = `fund-detail:auto-refresh:${fundCode}`;
    const countKey = `${key}:count`;
    // Launch freeze: partial/no_data section state'leri tek başına otomatik refresh sebebi değildir.
    const hasNoDataSection = Object.values(sectionStates).some((state) => state === "no_data");
    const hasCriticalNoDataSection =
      sectionStates.performance === "no_data" ||
      sectionStates.trends === "no_data" ||
      sectionStates.risk === "no_data";
    const upgradePending = degraded && hasCriticalNoDataSection;
    if (process.env.NODE_ENV === "development") {
      console.info(
        `[fund-detail-upgrade-check] code=${fundCode} degraded=${degraded ? 1 : 0} hasNoDataSection=${hasNoDataSection ? 1 : 0} ` +
          `hasCriticalNoDataSection=${hasCriticalNoDataSection ? 1 : 0} suppress=${suppressAutoRefresh ? 1 : 0} states=${JSON.stringify(sectionStates)}`
      );
    }
    if (!upgradePending) {
      window.sessionStorage.removeItem(key);
      window.sessionStorage.removeItem(countKey);
      return;
    }

    const countRaw = window.sessionStorage.getItem(countKey);
    const count = countRaw ? Number(countRaw) : 0;
    if (Number.isFinite(count) && count >= AUTO_REFRESH_MAX_ATTEMPTS) {
      return;
    }
    const lastRaw = window.sessionStorage.getItem(key);
    const lastAttemptAt = lastRaw ? Number(lastRaw) : 0;
    if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < AUTO_REFRESH_COOLDOWN_MS) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(key, String(Date.now()));
      window.sessionStorage.setItem(countKey, String((Number.isFinite(count) ? count : 0) + 1));
      console.info(
        `[fund-detail-upgrade] code=${fundCode} action=refresh attempt=${(Number.isFinite(count) ? count : 0) + 1} ` +
          `reason=${degraded ? "degraded" : "section_partial"} states=${JSON.stringify(sectionStates)}`
      );
      router.refresh();
    }, AUTO_REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [degraded, fundCode, router, sectionStates, suppressAutoRefresh]);

  return null;
}
