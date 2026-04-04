/** TEFAS çekmeden yalnızca kategori + logo DB pass (hızlı). */
import { config } from "dotenv";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { runTefasMetadataPass } from "../src/lib/services/tefas-metadata.service";

config({ path: path.join(process.cwd(), ".env"), quiet: true });
config({ path: path.join(process.cwd(), ".env.local"), override: true, quiet: true });

runTefasMetadataPass(prisma)
  .then((m) => {
    console.log(JSON.stringify(m, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
