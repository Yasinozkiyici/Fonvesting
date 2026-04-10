/**
 * /api/funds/scores önbelleğini doldurur.
 *
 * Öncelik: shell’deki DATABASE_URL > .env.local > .env
 * Böylece `pnpm db:docker:warm` ile Docker DB hedeflenirken .env’deki Supabase ezilmez diye değil,
 * tam tersi: komut satırından verilen URL her zaman kazanır.
 *
 * Kullanım:
 *   pnpm warm:scores
 *   pnpm db:docker:warm   (migrate + Docker URL ile warm)
 */
import "./load-env";
import { Prisma } from "@prisma/client";
import { warmAllScoresApiCaches } from "../src/lib/services/fund-scores-cache.service";

const databaseUrlFromShell = process.env.DATABASE_URL;

if (databaseUrlFromShell !== undefined && databaseUrlFromShell !== "") {
  process.env.DATABASE_URL = databaseUrlFromShell;
}

function isMissingScoresTable(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2021" &&
    typeof e.meta?.modelName === "string" &&
    e.meta.modelName === "ScoresApiCache"
  );
}

warmAllScoresApiCaches()
  .then((r) => {
    console.log(JSON.stringify({ ok: true, ...r }));
    process.exit(0);
  })
  .catch((e) => {
    if (isMissingScoresTable(e)) {
      console.error(`
[warm:scores] ScoresApiCache tablosu bu veritabanında yok.

  Aynı DATABASE_URL ile şemayı güncelleyin:
    pnpm exec prisma migrate deploy

  Yerel Docker kullanıyorsanız tek seferde:
    pnpm db:docker:warm

  Not: .env içindeki DATABASE_URL ile migrate’i çalıştırdığınız adres aynı olmalı.
`);
    } else {
      console.error(e);
    }
    process.exit(1);
  });
