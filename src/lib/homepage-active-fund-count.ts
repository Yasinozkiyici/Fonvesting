import { prisma } from "@/lib/prisma";

/**
 * Ana sayfa keşif evreni: market özeti / skor payload belirsiz kaldığında tek satırlık kanonik üst sınır.
 * `Fund.isActive` ile `/api/funds` toplamına hizalıdır; sahte skor total’i yerine geçmez.
 */
export async function countActiveFundsWithTimeout(timeoutMs: number): Promise<number | null> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 200) return null;
  try {
    const n = await Promise.race([
      prisma.fund.count({ where: { isActive: true } }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("fund_count_timeout")), timeoutMs);
      }),
    ]);
    return typeof n === "number" && n > 0 ? n : null;
  } catch {
    return null;
  }
}
