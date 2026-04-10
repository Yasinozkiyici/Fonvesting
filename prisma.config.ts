import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

const cwd = process.cwd();

// Prisma CLI, Next.js runtime ile aynı env önceliğini kullansın.
loadDotenv({ path: path.join(cwd, ".env.local"), override: false, quiet: true });
loadDotenv({ path: path.join(cwd, ".env"), override: false, quiet: true });

if ((process.env.DATABASE_URL ?? "").trim().startsWith("file:")) {
  // Eski SQLite URI repo içinde kaldığında Prisma komutları kırılıyordu.
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/fonvesting";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
