// Pay any invoice from your TEST buyer wallet: npm run pay -- <bolt11>
import { NWCClient } from "@getalby/sdk/nwc";
import { loadEnv } from "./env.ts";
loadEnv();
const invoice = process.argv[2];
if (!invoice?.startsWith("ln")) throw new Error("usage: npm run pay -- <bolt11 invoice>");
if (!process.env.BUYER_TEST_NWC_URL) throw new Error("No BUYER_TEST_NWC_URL in .env");
const c = new NWCClient({ nostrWalletConnectUrl: process.env.BUYER_TEST_NWC_URL });
const r = await c.payInvoice({ invoice });
console.log("paid. preimage:", r.preimage);
c.close();
process.exit(0);
