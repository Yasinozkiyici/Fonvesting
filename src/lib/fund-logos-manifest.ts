import fs from "node:fs";
import path from "node:path";

const MANIFEST_NAME = "manifest.json";
const IMAGE_EXT = /\.(png|webp|svg|jpg|jpeg)$/i;

let cacheFiles: Set<string> | null = null;
let cacheMtime = 0;

function fundLogosDir(): string {
  return path.join(process.cwd(), "public", "fund-logos");
}

/**
 * `public/fund-logos/manifest.json` içindeki dosya adlarını okur (mtime ile önbellek).
 * İndirme script’i veya `--manifest-only` ile manifest güncellenir.
 */
export function getFundLogoManifestFiles(): Set<string> {
  const manifestPath = path.join(fundLogosDir(), MANIFEST_NAME);
  try {
    const st = fs.statSync(manifestPath);
    if (cacheFiles !== null && st.mtimeMs === cacheMtime) {
      return cacheFiles;
    }
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as { files?: string[] };
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((f) => typeof f === "string" && IMAGE_EXT.test(f))
      : [];
    cacheFiles = new Set(files);
    cacheMtime = st.mtimeMs;
    return cacheFiles;
  } catch {
    cacheFiles = new Set();
    cacheMtime = 0;
    return cacheFiles;
  }
}

/** Yerel yüksek çözünürlüklü logo varsa statik yol (`/fund-logos/...`), yoksa null. */
export function publicFundLogoUrlFromManifest(code: string): string | null {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  const files = getFundLogoManifestFiles();
  for (const ext of ["png", "webp", "svg", "jpg", "jpeg"]) {
    const name = `${c}.${ext}`;
    if (files.has(name)) return `/fund-logos/${name}`;
  }
  return null;
}

/** Klasördeki görüntüleri tarar ve manifest.json yazar (indirme sonrası veya elle çalıştırma). */
export function rebuildFundLogosManifest(): void {
  const dir = fundLogosDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const all = fs.readdirSync(dir);
  const files = all
    .filter((f) => f !== MANIFEST_NAME && IMAGE_EXT.test(f))
    .sort();
  fs.writeFileSync(
    path.join(dir, MANIFEST_NAME),
    `${JSON.stringify({ files }, null, 2)}\n`,
    "utf8"
  );
  cacheFiles = null;
  cacheMtime = 0;
}
