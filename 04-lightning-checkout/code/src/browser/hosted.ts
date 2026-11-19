// Hosted demo (GitHub Pages): no server to host for free, so the kit's
// server-side Checkout runs inside this page instead, against two throwaway
// test wallets made for this visit on faucet.nwc.dev ("Balances are not real").
// In a real shop this code runs on the server: see `npm run demo`.
import { NWCClient } from "@getalby/sdk/nwc";
import { Checkout, MemoryStore } from "../kit/checkout.ts";
import { RateService } from "../kit/rates.ts";
import { NwcBackend } from "../kit/backends/nwc.ts";
import catalog from "../demo/catalog.json" with { type: "json" };
import { startShop } from "./shop-ui.ts";
import type { Transport } from "./checkout.ts";

const note = document.getElementById("setup")!;
const say = (t: string) => (note.textContent = t);

async function faucetWallet(sats: number): Promise<string> {
  const r = await fetch(`https://faucet.nwc.dev?balance=${sats}`, { method: "POST" });
  const url = (await r.text()).trim();
  if (!r.ok || !url.startsWith("nostr+walletconnect://")) throw new Error("faucet unavailable");
  return url;
}

try {
  say("Setting up two free test wallets for this visit (shop + customer)…");
  const [merchantUrl, buyerUrl] = await Promise.all([faucetWallet(1000), faucetWallet(100000)]);
  const checkout = new Checkout({
    backend: new NwcBackend(merchantUrl, { allowSpendPermissions: true }), // faucet wallets always have full permissions
    rates: new RateService({ fallback: { nairaPerBtc: 85_000_000, asOf: "19 Nov 2026" } }),
    catalog,
    store: new MemoryStore(),
    shopName: "Yaba Thrift Corner",
    log: () => {},
  });
  const buyer = new NWCClient({ nostrWalletConnectUrl: buyerUrl });
  const transport: Transport = {
    create: (cart) => checkout.create(cart),
    get: (id) => checkout.status(id),
    demoPay: async (id) => {
      const o = await checkout.status(id);
      await buyer.payInvoice({ invoice: o.bolt11 });
    },
  };
  startShop(catalog, { shopName: "Yaba Thrift Corner", demo: true, transport });

  // Let testers try the real "Pay with Nostr Wallet Connect" path too.
  const box = document.getElementById("buyer-wallet") as HTMLDetailsElement;
  const copy = document.getElementById("copy-buyer") as HTMLButtonElement;
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(buyerUrl); copy.textContent = "Copied ✓ Paste it in “Pay with Nostr Wallet Connect”"; }
    catch { copy.textContent = "Couldn't copy on this browser"; }
  });
  box.hidden = false;
  say("Ready. Test wallets made: the customer has 100,000 test sats.");
} catch {
  say("The free test-wallet service didn't answer. Refresh in a minute, or watch the demo video.");
}
