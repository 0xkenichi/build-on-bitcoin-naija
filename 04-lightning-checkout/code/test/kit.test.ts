// Offline self-test: no network, no wallet. Run: npm run selftest
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Checkout, OrderStore, RateService, FakeBackend, PhoenixdBackend, priceCart, nairaToSats, verifyPreimage, checkoutRoutes, RateLimiter } from "../src/kit/index.ts";
import type { CatalogItem } from "../src/kit/index.ts";
import { paymentHashFromBolt11, fakeBolt11 } from "../src/kit/bolt11.ts";

const catalog: CatalogItem[] = [
  { id: "hat", name: "Hat", note: "", priceNaira: 2500, emoji: "" },
  { id: "jacket", name: "Jacket", note: "", priceNaira: 6500, emoji: "" },
];
const fixedRate = (n: number, src = "test") => ({ name: src, fetch: async () => n });
const rates = () => new RateService({ fallback: { nairaPerBtc: 85_000_000, asOf: "test" }, sources: [fixedRate(85_000_000)] });
const quiet = () => {};

test("naira to sats rounds up so the shop is never short", () => {
  assert.equal(nairaToSats(9000, 85_000_000), 10589); // 10588.23... -> 10589
  assert.throws(() => nairaToSats(0, 85_000_000));
});

test("cart: server prices win, unknown items and bad quantities are refused", () => {
  const { lines, totalNaira } = priceCart([{ id: "hat", qty: 2, priceNaira: 1 }, { id: "hat", qty: 1 }], catalog);
  assert.equal(totalNaira, 7500); // the fake priceNaira:1 from the browser is ignored
  assert.equal(lines[0].qty, 3);
  assert.throws(() => priceCart([], catalog), /empty/);
  assert.throws(() => priceCart([{ id: "laptop", qty: 1 }], catalog), /unknown item/);
  for (const qty of [0, -1, 1.5, 11, "2"]) assert.throws(() => priceCart([{ id: "hat", qty }], catalog), /quantity/);
  assert.throws(() => priceCart("hat", catalog));
});

test("rates: bad numbers and wild jumps are rejected, fallback is marked stale", async () => {
  const r = new RateService({ fallback: { nairaPerBtc: 85_000_000, asOf: "x" }, sources: [fixedRate(NaN), fixedRate(5), fixedRate(84_000_000, "ok")] });
  const a = await r.get();
  assert.equal(a.source, "ok");
  assert.equal(a.stale, false);
  const jumpy = new RateService({ ttlMs: 0, fallback: { nairaPerBtc: 1, asOf: "x" }, sources: [fixedRate(84_000_000)] });
  await jumpy.get();
  (jumpy as unknown as { opts: { sources: unknown[] } }).opts.sources = [fixedRate(200_000_000)]; // +138%: refuse
  const b = await jumpy.get();
  assert.equal(b.nairaPerBtc, 84_000_000);
  assert.equal(b.stale, true);
  const down = new RateService({ fallback: { nairaPerBtc: 85_000_000, asOf: "19 Nov" }, sources: [{ name: "x", fetch: async () => { throw new Error("offline"); } }] });
  const c = await down.get();
  assert.equal(c.stale, true);
  assert.match(c.source, /fallback/);
});

test("preimage check", async () => {
  const pre = "00".repeat(32);
  const hash = "66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925"; // sha256(32 zero bytes)
  assert.equal(await verifyPreimage(pre, hash), true);
  assert.equal(await verifyPreimage("11".repeat(32), hash), false);
  assert.equal(await verifyPreimage("nope", hash), false);
});

test("order flow: pending -> paid, with a locked price and verified proof", async () => {
  const backend = new FakeBackend();
  const co = new Checkout({ backend, rates: rates(), catalog, store: new OrderStore(), shopName: "Test", log: quiet });
  const o = await co.create([{ id: "jacket", qty: 1 }]);
  assert.equal(o.status, "pending");
  assert.equal(o.totalNaira, 6500);
  assert.equal(o.sats, nairaToSats(6500, 85_000_000));
  assert.equal(o.id.length, 32);
  assert.equal((await co.status(o.id)).status, "pending");
  backend.settle(o.paymentHash);
  await new Promise((r) => setTimeout(r, 2100)); // lookups are throttled to one per 2s
  const paid = await co.status(o.id);
  assert.equal(paid.status, "paid");
  assert.ok(await verifyPreimage(paid.preimage!, paid.paymentHash));
});

test("order flow: unpaid order expires, with one last check first", async () => {
  const backend = new FakeBackend();
  const co = new Checkout({ backend, rates: rates(), catalog, store: new OrderStore(), shopName: "Test", invoiceExpirySeconds: 1, log: quiet });
  const o = await co.create([{ id: "hat", qty: 1 }]);
  await co.status(o.id);
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await co.status(o.id)).status, "expired");

  const o2 = await co.create([{ id: "hat", qty: 1 }]);
  await co.status(o2.id);
  backend.settle(o2.paymentHash); // paid right at the deadline
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal((await co.status(o2.id)).status, "paid");
});

test("a wallet that lies about payment is caught", async () => {
  const liar = { name: "liar", createInvoice: async () => ({ bolt11: fakeBolt11("ab".repeat(32)), paymentHash: "ab".repeat(32) }), lookupInvoice: async () => ({ settled: true, preimage: "cd".repeat(32) }) };
  const co = new Checkout({ backend: liar, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  const o = await co.create([{ id: "hat", qty: 1 }]);
  await assert.rejects(co.status(o.id), /did not verify/);
});

test("logs never contain invoices or preimages", async () => {
  const lines: string[] = [];
  const backend = new FakeBackend();
  const co = new Checkout({ backend, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: (e, f) => lines.push(e + JSON.stringify(f)) });
  const o = await co.create([{ id: "hat", qty: 1 }]);
  backend.settle(o.paymentHash);
  await new Promise((r) => setTimeout(r, 2100));
  const paid = await co.status(o.id);
  const all = lines.join("\n");
  assert.ok(lines.length >= 2);
  assert.ok(!all.includes(o.bolt11) && !all.includes(paid.preimage!) && !all.includes(o.paymentHash));
});

test("bad order ids are refused before touching storage", async () => {
  const co = new Checkout({ backend: new FakeBackend(), rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  await assert.rejects(co.status("../../etc/passwd"), /bad order id/);
  await assert.rejects(co.status("a".repeat(32)), /not found/);
});

test("rate limiter", () => {
  const l = new RateLimiter(2, 60_000);
  assert.equal(l.allow("ip"), true);
  assert.equal(l.allow("ip"), true);
  assert.equal(l.allow("ip"), false);
  assert.equal(l.allow("other"), true);
});

test("HTTP routes: JSON only, size limit, errors don't leak internals", async () => {
  const broken = { name: "down", createInvoice: async () => { throw new Error("relay secret details"); }, lookupInvoice: async () => ({ settled: false }) };
  const co = new Checkout({ backend: broken, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  const routes = checkoutRoutes(co, catalog);
  const srv = createServer(async (req, res) => { if (!(await routes(req, res))) res.writeHead(404).end(); });
  const origErr = console.error; console.error = quiet;
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST", body: "{}" })).status, 415);
    const big = await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart: "x".repeat(20000) }) });
    assert.equal(big.status, 413);
    const down = await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart: [{ id: "hat", qty: 1 }] }) });
    assert.equal(down.status, 503);
    assert.ok(!(await down.text()).includes("secret"));
  } finally {
    console.error = origErr;
    srv.close();
  }
});

test("phoenixd adapter speaks the documented API", async () => {
  const calls: string[] = [];
  const mock = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url} ${(init?.headers as Record<string, string>).Authorization}`);
    if (url.endsWith("/createinvoice")) return new Response(JSON.stringify({ serialized: "lnbc1", paymentHash: "ab".repeat(32) }));
    return new Response(JSON.stringify({ isPaid: true, preimage: "cd".repeat(32), completedAt: 1_700_000_000_000 }));
  }) as typeof fetch;
  const p = new PhoenixdBackend("http://127.0.0.1:9740/", "pw", mock);
  const inv = await p.createInvoice({ sats: 100, description: "d", expirySeconds: 600 });
  assert.equal(inv.bolt11, "lnbc1");
  const l = await p.lookupInvoice(inv.paymentHash);
  assert.equal(l.settled, true);
  assert.equal(l.settledAt, 1_700_000_000);
  assert.match(calls[0], /^POST http:\/\/127\.0\.0\.1:9740\/createinvoice Basic /);
  await assert.rejects(p.lookupInvoice("../x"), /bad payment hash/);
});

test("NWC: a shop connection that can spend is refused (least privilege)", async () => {
  const { NwcBackend } = await import("../src/kit/backends/nwc.ts");
  const url = "nostr+walletconnect://" + "ab".repeat(32) + "?relay=wss://relay.example&secret=" + "cd".repeat(32);
  const stub = (methods: string[]) => ({ getInfo: async () => ({ methods }), close() {} });
  const strict = new NwcBackend(url);
  (strict as unknown as { client: unknown }).client = stub(["make_invoice", "lookup_invoice", "pay_invoice"]);
  await assert.rejects(strict.checkPermissions(), /can SPEND/);
  (strict as unknown as { client: unknown }).client = stub(["make_invoice", "lookup_invoice"]);
  assert.deepEqual((await strict.checkPermissions()).canSpend, false);
  (strict as unknown as { client: unknown }).client = stub(["lookup_invoice"]);
  await assert.rejects(strict.checkPermissions(), /missing: make_invoice/);
  const testOnly = new NwcBackend(url, { allowSpendPermissions: true });
  (testOnly as unknown as { client: unknown }).client = stub(["make_invoice", "lookup_invoice", "pay_invoice"]);
  assert.equal((await testOnly.checkPermissions()).canSpend, true);
  assert.throws(() => new NwcBackend("https://not-nwc"), /must start with/);
});

// A real invoice from an NWC Faucet test wallet (19 Nov 2026), with its payment hash.
const REAL = "lnbc106210n1p407w2rdp4t9skycfq2358y6txwssyxmmjdejhygr0wfjx2u3q8qurjvtzxpjnwnp4qwmtpr4p72ms7gnq3pkfk2876y2msvl33s3840dlp6xsv2w59dpscpp55dslvz7j96pjveg6jh8ylz3ken43k5q8kuqhxmv6g052c45a2ylqsp505djn2cewp4tmn9d9g35ulcck66hfk8qz08cjqrxq0dxey6t0nps9qyysgqcqzp2xqzjcvvz327rphj2u03469wqd4pv0v7shh2afltdzmu6xv86n08yfl374np57l99sxgx2cwgt62th4uycjmrvvms6mt0hvmz0456f4ak09yqq34r5d6";
const REAL_HASH = "a361f60bd22e8326651a95ce4f8a36cceb1b5007b701736d9a43e8ac569d513e";

test("bolt11: payment hash read from a real invoice; corrupted invoices are refused", () => {
  assert.equal(paymentHashFromBolt11(REAL), REAL_HASH);
  assert.equal(paymentHashFromBolt11("lightning:" + REAL.toUpperCase()), REAL_HASH);
  assert.throws(() => paymentHashFromBolt11(REAL.slice(0, -1) + (REAL.endsWith("q") ? "p" : "q")), /checksum/);
  assert.throws(() => paymentHashFromBolt11("hello"), /not a BOLT11/);
  const h = "12".repeat(32);
  assert.equal(paymentHashFromBolt11(fakeBolt11(h)), h);
});

test("a backend whose invoice doesn't match its payment hash is refused", async () => {
  const mixed = { name: "mixed", createInvoice: async () => ({ bolt11: fakeBolt11("ab".repeat(32)), paymentHash: "cd".repeat(32) }), lookupInvoice: async () => ({ settled: false }) };
  const co = new Checkout({ backend: mixed, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  await assert.rejects(co.create([{ id: "hat", qty: 1 }]), /doesn't match/);
});

test("paid without a preimage is marked paid but NOT proof-verified", async () => {
  let settled = false;
  const nopre = { name: "nopre", createInvoice: async () => ({ bolt11: fakeBolt11("ab".repeat(32)), paymentHash: "ab".repeat(32) }), lookupInvoice: async () => ({ settled }) };
  const co = new Checkout({ backend: nopre, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  const o = await co.create([{ id: "hat", qty: 1 }]);
  settled = true;
  const p = await co.status(o.id);
  assert.equal(p.status, "paid");
  assert.equal(p.proofVerified, false);
  const fb = new FakeBackend();
  const co2 = new Checkout({ backend: fb, rates: rates(), catalog, store: new OrderStore(), shopName: "T", log: quiet });
  const o2 = await co2.create([{ id: "hat", qty: 1 }]);
  fb.settle(o2.paymentHash);
  assert.equal((await co2.status(o2.id)).proofVerified, true);
});
