/** TEFAS çekmeden yalnızca kategori + logo DB pass (hızlı). */
import "./load-env";
import { prisma } from "../src/lib/prisma";
import { runTefasMetadataPass } from "../src/lib/services/tefas-metadata.service";

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
