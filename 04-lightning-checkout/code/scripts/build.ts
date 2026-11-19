// Bundle the browser code with esbuild. Prints the size a phone downloads.
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";

await build({
  entryPoints: { shop: "src/browser/shop.ts", hosted: "src/browser/hosted.ts", "naija-checkout": "src/browser/checkout.ts", "nwc-pay": "src/browser/nwc-pay.ts" },
  outdir: "public/dist",
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022", "chrome92", "safari15"],
  logLevel: "warning",
});
const kb = (f: string) => (gzipSync(readFileSync(f)).length / 1024).toFixed(1) + " KB gzipped";
for (const f of ["public/dist/shop.js", "public/shop.css", "public/naija-checkout.css", "public/index.html", "public/dist/nwc-pay.js", "public/dist/hosted.js"]) {
  statSync(f);
  console.log(`  ${f.padEnd(26)} ${kb(f)}${f.includes("nwc") ? "  (only loaded if the buyer picks NWC)" : ""}`);
}
