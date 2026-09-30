import { copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits .ts → .js; non-code assets loaded at runtime must be copied
// into dist so the production image (which ships dist only) can read them.
const assets = ["catalog/indicators.json"];

for (const asset of assets) {
  const from = fileURLToPath(new URL(`../src/${asset}`, import.meta.url));
  const to = fileURLToPath(new URL(`../dist/${asset}`, import.meta.url));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
