import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { runTefasMetadataPass } from "@/lib/services/tefas-metadata.service";

function resolvePythonBin(root: string): string {
  const fromEnv = process.env.TEFAS_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  const venvUnix = path.join(root, "scripts", ".venv", "bin", "python3");
  const venvWin = path.join(root, "scripts", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvUnix)) return venvUnix;
  if (fs.existsSync(venvWin)) return venvWin;
  return process.platform === "win32" ? "python" : "python3";
}

export type TefasSyncResult = {
  ok: boolean;
  skipped: boolean;
  updated: number;
  message?: string;
};

type ExportRow = {
  code: string;
  name: string;
  shortName?: string | null;
  lastPrice: number;
  previousPrice: number;
  dailyReturn: number;
  portfolioSize: number;
  investorCount: number;
  shareCount: number;
};

type ExportPayload =
  | { ok: false; error: string }
  | { ok: true; empty: true; date: string; fundTypeCode: number }
  | { ok: true; empty?: false; date: string; fundTypeCode: number; rows: ExportRow[] };

function projectRoot(): string {
  return process.cwd();
}

/** TEFAS günlük getiri: API sütunu → satır fiyatları → önceki gün history → DB son kapanış */
function computeFundDailyMetrics(input: {
  apiDailyReturn: number;
  lastPrice: number;
  rowPreviousPrice: number;
  dbPreviousClose: number;
  historyPreviousPrice: number;
}): { dailyReturn: number; previousPrice: number } {
  const { apiDailyReturn, lastPrice, rowPreviousPrice, dbPreviousClose, historyPreviousPrice } =
    input;

  const clampReturn = (x: number): number => {
    if (!Number.isFinite(x) || Math.abs(x) > 50) return 0;
    return x;
  };

  const pct = (prev: number, curr: number) => ((curr - prev) / prev) * 100;

  let dailyReturn = 0;
  if (apiDailyReturn !== 0 && Number.isFinite(apiDailyReturn)) {
    dailyReturn = clampReturn(apiDailyReturn);
  } else if (rowPreviousPrice > 0 && lastPrice > 0) {
    dailyReturn = clampReturn(pct(rowPreviousPrice, lastPrice));
  } else if (historyPreviousPrice > 0 && lastPrice > 0) {
    dailyReturn = clampReturn(pct(historyPreviousPrice, lastPrice));
  } else if (dbPreviousClose > 0 && lastPrice > 0) {
    dailyReturn = clampReturn(pct(dbPreviousClose, lastPrice));
  }

  let previousPrice = lastPrice;
  if (rowPreviousPrice > 0) previousPrice = rowPreviousPrice;
  else if (historyPreviousPrice > 0) previousPrice = historyPreviousPrice;
  else if (dbPreviousClose > 0) previousPrice = dbPreviousClose;

  return { dailyReturn, previousPrice };
}

async function ensureFundTypes(fundTypeCode: number): Promise<string> {
  const names: Record<number, string> = {
    0: "Yatırım Fonları",
    1: "Emeklilik Fonları (BES)",
  };
  const row = await prisma.fundType.upsert({
    where: { code: fundTypeCode },
    create: {
      code: fundTypeCode,
      name: names[fundTypeCode] ?? `Tür ${fundTypeCode}`,
    },
    update: { name: names[fundTypeCode] ?? `Tür ${fundTypeCode}` },
  });
  return row.id;
}

export async function runTefasSync(options?: {
  fundTypeCode?: number;
  /** true: kategori/logo pass atlanır (runFullTefasSync son turda bir kez çalıştırır). */
  skipMetadata?: boolean;
}): Promise<TefasSyncResult> {
  const fundTypeCode = options?.fundTypeCode ?? 0;
  const skipMetadata = options?.skipMetadata ?? false;
  const started = Date.now();
  const root = projectRoot();
  const script = path.join(root, "scripts", "tefas_export.py");

  let payload: ExportPayload;
  try {
    const py = resolvePythonBin(root);
    const out = execFileSync(py, [script, "--fund-type", String(fundTypeCode)], {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    payload = JSON.parse(out.trim()) as ExportPayload;
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: Buffer; message?: string };
    const msg =
      err.stderr?.toString().trim() ||
      (e instanceof Error ? e.message : String(e)) ||
      "python çalıştırılamadı";
    console.error("[tefas-sync] TEFAS çekilemedi, mevcut veri korunuyor:", msg);
    await prisma.syncLog.create({
      data: {
        syncType: "TEFAS",
        status: "FAILED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: msg.slice(0, 2000),
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });
    return { ok: false, skipped: true, updated: 0, message: msg };
  }

  if (!payload.ok) {
    const msg = "error" in payload ? payload.error : "bilinmeyen";
    console.error("[tefas-sync] Payload hata:", msg);
    await prisma.syncLog.create({
      data: {
        syncType: "TEFAS",
        status: "FAILED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: msg,
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });
    return { ok: false, skipped: true, updated: 0, message: msg };
  }

  if ("empty" in payload && payload.empty) {
    console.warn("[tefas-sync] TEFAS boş döndü, mevcut veri korunuyor.");
    await prisma.syncLog.create({
      data: {
        syncType: "TEFAS",
        status: "SKIPPED",
        fundsUpdated: 0,
        fundsCreated: 0,
        errorMessage: "empty_response",
        startedAt: new Date(started),
        completedAt: new Date(),
        durationMs: Date.now() - started,
      },
    });
    return { ok: true, skipped: true, updated: 0, message: "empty" };
  }

  if (!payload.rows?.length) {
    return { ok: true, skipped: true, updated: 0, message: "no_rows" };
  }

  const typeId = await ensureFundTypes(payload.fundTypeCode ?? fundTypeCode);
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  let created = 0;
  let updatedRows = 0;

  const rows = payload.rows;
  const CHUNK = 100;
  const txOpts = { maxWait: 60_000, timeout: 180_000 };

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const r of slice) {
        const existing = await tx.fund.findUnique({
          where: { code: r.code },
          select: { id: true, lastPrice: true },
        });
        const dbPreviousClose = existing?.lastPrice ?? 0;

        let historyPreviousPrice = 0;
        if (existing?.id) {
          const h = await tx.fundPriceHistory.findFirst({
            where: { fundId: existing.id, date: { lt: dayStart } },
            orderBy: { date: "desc" },
            select: { price: true },
          });
          historyPreviousPrice = h && h.price > 0 ? h.price : 0;
        }

        const { dailyReturn, previousPrice } = computeFundDailyMetrics({
          apiDailyReturn: r.dailyReturn,
          lastPrice: r.lastPrice,
          rowPreviousPrice: r.previousPrice,
          dbPreviousClose,
          historyPreviousPrice,
        });

        const fund = await tx.fund.upsert({
          where: { code: r.code },
          create: {
            code: r.code,
            name: r.name,
            shortName: r.shortName ?? r.code,
            lastPrice: r.lastPrice,
            previousPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
            shareCount: r.shareCount,
            fundTypeId: typeId,
            lastUpdatedAt: now,
          },
          update: {
            name: r.name,
            shortName: r.shortName ?? r.code,
            lastPrice: r.lastPrice,
            previousPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
            shareCount: r.shareCount,
            fundTypeId: typeId,
            lastUpdatedAt: now,
          },
        });
        if (existing) updatedRows += 1;
        else created += 1;

        await tx.fundPriceHistory.upsert({
          where: { fundId_date: { fundId: fund.id, date: dayStart } },
          create: {
            fundId: fund.id,
            date: dayStart,
            price: r.lastPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
          },
          update: {
            price: r.lastPrice,
            dailyReturn,
            portfolioSize: r.portfolioSize,
            investorCount: r.investorCount,
          },
        });
      }
    }, txOpts);
  }

  await prisma.$transaction(async (tx) => {
    const all = await tx.fund.findMany({
      where: { isActive: true },
      select: { dailyReturn: true, portfolioSize: true, investorCount: true },
    });
    const adv = all.filter((f) => f.dailyReturn > 0).length;
    const dec = all.filter((f) => f.dailyReturn < 0).length;
    const unch = Math.max(0, all.length - adv - dec);
    const rets = all.map((f) => f.dailyReturn).filter((x) => x !== 0);
    const avg = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;

    await tx.marketSnapshot.upsert({
      where: { date: dayStart },
      create: {
        date: dayStart,
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((s, f) => s + f.portfolioSize, 0),
        totalInvestorCount: all.reduce((s, f) => s + f.investorCount, 0),
        avgDailyReturn: avg,
        advancers: adv,
        decliners: dec,
        unchanged: unch,
      },
      update: {
        totalFundCount: all.length,
        totalPortfolioSize: all.reduce((s, f) => s + f.portfolioSize, 0),
        totalInvestorCount: all.reduce((s, f) => s + f.investorCount, 0),
        avgDailyReturn: avg,
        advancers: adv,
        decliners: dec,
        unchanged: unch,
      },
    });
  }, txOpts);

  let metadataNote = "";
  if (!skipMetadata) {
    try {
      const meta = await runTefasMetadataPass(prisma);
      metadataNote = ` | kategori+logo: ${JSON.stringify(meta)}`;
      console.log("[tefas-sync] Kategori/logo pass:", meta);
    } catch (e) {
      console.error("[tefas-sync] Kategori/logo pass hatası:", e);
      metadataNote = " | metadata_hata";
    }
  }

  await prisma.syncLog.create({
    data: {
      syncType: "TEFAS",
      status: "SUCCESS",
      fundsUpdated: updatedRows + created,
      fundsCreated: created,
      startedAt: new Date(started),
      completedAt: new Date(),
      durationMs: Date.now() - started,
    },
  });

  console.log(`[tefas-sync] Tamam: ${created} yeni, ${updatedRows} güncelleme.${metadataNote}`);
  return { ok: true, skipped: false, updated: payload.rows.length };
}

/** Yatırım (0) + BES (1) TEFAS çekimi; her turdan sonra kategori/logo pass. */
export async function runFullTefasSync(): Promise<TefasSyncResult & { types?: number[] }> {
  const types = [0, 1];
  let totalRows = 0;
  let lastError: string | undefined;
  for (const fundTypeCode of types) {
    const r = await runTefasSync({ fundTypeCode, skipMetadata: true });
    totalRows += r.updated;
    if (!r.ok && !r.skipped) {
      return { ok: false, skipped: false, updated: totalRows, message: r.message, types };
    }
    if (!r.ok && r.skipped) lastError = r.message;
  }
  if (lastError && totalRows === 0) {
    return { ok: false, skipped: true, updated: 0, message: lastError, types };
  }

  try {
    const meta = await runTefasMetadataPass(prisma);
    console.log("[tefas-sync] full sync metadata:", meta);
  } catch (e) {
    console.error("[tefas-sync] full sync metadata:", e);
  }

  return { ok: true, skipped: false, updated: totalRows, types };
}
