// Demo shop server: the kit mounted on plain node:http, plus static files.
// Run: npm run demo  ->  http://localhost:8787
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { NWCClient } from "@getalby/sdk/nwc";
import { Checkout, OrderStore, RateService, backendFromEnv, checkoutRoutes, NwcBackend } from "../kit/index.ts";
import type { CatalogItem } from "../kit/index.ts";
import { loadEnv } from "../../scripts/env.ts";
import { ensureDemoEnv } from "../../scripts/faucet.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
process.chdir(root);
await ensureDemoEnv();
loadEnv();

const catalog = JSON.parse(readFileSync("src/demo/catalog.json", "utf8")) as CatalogItem[];
const backend = await (async () => {
  try {
    const b = backendFromEnv();
    if (b instanceof NwcBackend) {
      const p = await b.checkPermissions();
      if (p.canSpend) console.warn("  WARNING: this NWC connection can spend. Fine for faucet test wallets, never for a real shop.");
    }
    return b;
  } catch (e) {
    console.error(`\n  ✖ Refusing to start: ${(e as Error).message}\n`);
    process.exit(1);
  }
})();
const shopName = process.env.SHOP_NAME ?? "Yaba Thrift Corner";
const checkout = new Checkout({
  backend,
  catalog,
  shopName,
  store: new OrderStore("data/orders.json"),
  invoiceExpirySeconds: Number(process.env.INVOICE_EXPIRY_SECONDS ?? 600),
  // Fallback if every rate API is down. Update when you deploy.
  rates: new RateService({ fallback: { nairaPerBtc: 85_000_000, asOf: "19 Nov 2026" } }),
});
const routes = checkoutRoutes(checkout, catalog);

const demo = process.env.DEMO_MODE === "1" && process.env.BUYER_TEST_NWC_URL;
const buyer = demo ? new NWCClient({ nostrWalletConnectUrl: process.env.BUYER_TEST_NWC_URL! }) : undefined;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
const SECURITY = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
const publicDir = join(root, "public");
const cache = new Map<string, { raw: Buffer; gz: Buffer; mtime: number }>();

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  if (await routes(req, res)) return;

  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/config") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ shopName, demo: Boolean(demo), backend: backend.name }));
    return;
  }
  // DEMO ONLY: pay an invoice from the test buyer wallet, standing in for the
  // customer's phone. Off unless DEMO_MODE=1. Only pays invoices for orders
  // this server created, and only once.
  const pay = url.pathname.match(/^\/demo\/pay\/([0-9a-f]{32})$/);
  if (req.method === "POST" && pay && buyer) {
    try {
      const order = await checkout.status(pay[1]);
      if (order.status !== "pending") throw new Error("order is not pending");
      await buyer.payInvoice({ invoice: order.bolt11 });
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String((e as Error).message).slice(0, 120) }));
    }
    return;
  }

  // Static files, no directory traversal.
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (path.endsWith("/")) path += "index.html";
  const file = join(publicDir, path);
  const type = TYPES[extname(file)];
  if (!file.startsWith(publicDir) || !type || req.method !== "GET") {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const mtime = statSync(file).mtimeMs;
    let c = cache.get(file);
    if (!c || c.mtime !== mtime) {
      const raw = readFileSync(file);
      c = { raw, gz: gzipSync(raw, { level: 9 }), mtime };
      cache.set(file, c);
    }
    const gz = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": path.startsWith("/dist/") ? "public, max-age=3600" : "no-cache",
      ...(gz ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}),
    });
    res.end(gz ? c.gz : c.raw);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, "127.0.0.1", () => {
  console.log(`\n  ${shopName} (demo shop) on http://localhost:${port}`);
  console.log(`  Lightning backend: ${backend.name}${demo ? " · demo buyer wallet ON (test sats)" : ""}\n`);
});
