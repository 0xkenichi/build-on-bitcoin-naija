// Live happy path against a running demo shop (npm run demo in another tab):
// create an order over HTTP, pay it from the test buyer wallet over NWC,
// wait for "paid", then check the proof. Test sats only.
import { NWCClient } from "@getalby/sdk/nwc";
import { createHash } from "node:crypto";
import { loadEnv } from "./env.ts";
import { paymentHashFromBolt11 } from "../src/kit/bolt11.ts";

loadEnv();
const base = process.env.SHOP_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
if (!process.env.BUYER_TEST_NWC_URL) throw new Error("No BUYER_TEST_NWC_URL in .env. Run `npm run demo` once first.");
const step = (s: string) => console.log("  " + s);
const t0 = Date.now();

const r = await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart: [{ id: "ankara-hat", qty: 1 }, { id: "beads", qty: 2 }] }) });
const order = await r.json();
if (!r.ok) throw new Error(order.error);
step(`1. order ${order.id.slice(0, 8)}: ₦${order.totalNaira.toLocaleString()} = ${order.sats} sats (rate from ${order.rate.source})`);

const buyer = new NWCClient({ nostrWalletConnectUrl: process.env.BUYER_TEST_NWC_URL });
const invoiceHash = paymentHashFromBolt11(order.bolt11);
if (invoiceHash !== order.paymentHash) throw new Error("invoice hash doesn't match what the shop reported");
const { preimage } = await buyer.payInvoice({ invoice: order.bolt11 });
buyer.close();
step("2. buyer wallet paid the invoice over Nostr Wallet Connect");

let o = order;
for (let i = 0; i < 20 && o.status === "pending"; i++) {
  await new Promise((res) => setTimeout(res, 1500));
  o = await (await fetch(`${base}/api/orders/${order.id}`)).json();
}
if (o.status !== "paid") throw new Error(`order is ${o.status}, expected paid`);
const sha = (h: string) => createHash("sha256").update(Buffer.from(h, "hex")).digest("hex");
const buyerOk = sha(preimage) === invoiceHash; // the buyer's own proof, hash decoded from the invoice
const shopOk = o.proofVerified === true && sha(o.preimage) === invoiceHash;
const ok = buyerOk && shopOk;
step(`3. shop says PAID; buyer's proof ${buyerOk ? "verified" : "FAILED"}, shop's proof ${shopOk ? "verified" : "FAILED"} (sha256(preimage) == invoice hash)`);
console.log(`\n  E2E ${ok ? "PASSED" : "FAILED"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
