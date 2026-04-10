/**
 * tsx ile çalışan scriptlerde, `../src/lib` altındaki modüllerden önce tek satır:
 *   import "./load-env";
 * (ES modülünde ilk yan etkili içe aktarma olarak konumlandırın.)
 */
import { config } from "dotenv";
import path from "node:path";

const cwd = process.cwd();
config({ path: path.join(cwd, ".env.local"), quiet: true });
config({ path: path.join(cwd, ".env"), quiet: true });
