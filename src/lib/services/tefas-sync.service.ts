import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

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

export async function runTefasSync(options?: { fundTypeCode?: number }): Promise<TefasSyncResult> {
  const fundTypeCode = options?.fundTypeCode ?? 0;
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

  await prisma.$transaction(async (tx) => {
    for (const r of payload.rows) {
      const existing = await tx.fund.findUnique({
        where: { code: r.code },
        select: { id: true, lastPrice: true },
      });
      const prevClose = existing?.lastPrice ?? 0;
      const canCalc = prevClose > 0 && r.lastPrice > 0;
      let dailyReturn =
        r.dailyReturn !== 0 && Number.isFinite(r.dailyReturn)
          ? r.dailyReturn
          : canCalc
            ? ((r.lastPrice - prevClose) / prevClose) * 100
            : 0;
      if (!Number.isFinite(dailyReturn) || Math.abs(dailyReturn) > 50) {
        dailyReturn = 0;
      }
      const previousPrice = canCalc ? prevClose : r.previousPrice > 0 ? r.previousPrice : r.lastPrice;

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
  });

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

  console.log(`[tefas-sync] Tamam: ${created} yeni, ${updatedRows} güncelleme.`);
  return { ok: true, skipped: false, updated: payload.rows.length };
}
