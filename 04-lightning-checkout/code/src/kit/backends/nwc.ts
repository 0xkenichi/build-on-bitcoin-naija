// Nostr Wallet Connect (NIP-47) backend.
// Works with any NWC wallet: Alby Hub, Coinos, LNbits, Primal and others.
// Give the shop a connection that is limited to make_invoice + lookup_invoice.
import { NWCClient } from "@getalby/sdk/nwc";
import type { LightningBackend } from "../types.ts";

const NEEDED = ["make_invoice", "lookup_invoice"];
const RISKY = ["pay_invoice", "pay_keysend", "multi_pay_invoice", "multi_pay_keysend"];

export class NwcBackend implements LightningBackend {
  readonly name = "nwc";
  private client: NWCClient;
  private checked = false;

  constructor(connectionUrl: string, private opts: { allowSpendPermissions?: boolean } = {}) {
    if (!connectionUrl.startsWith("nostr+walletconnect://")) {
      throw new Error("MERCHANT_NWC_URL must start with nostr+walletconnect://");
    }
    this.client = new NWCClient({ nostrWalletConnectUrl: connectionUrl });
  }

  /** Least privilege check: refuse to run with a connection that can spend,
   *  unless the developer explicitly opts in (the free test faucet only
   *  issues full-permission wallets). */
  async checkPermissions(): Promise<{ methods: string[]; canSpend: boolean }> {
    const info = await this.client.getInfo();
    const methods: string[] = info.methods ?? [];
    const missing = NEEDED.filter((m) => !methods.includes(m));
    if (missing.length) throw new Error(`NWC connection is missing: ${missing.join(", ")}`);
    const canSpend = methods.some((m) => RISKY.includes(m));
    if (canSpend && !this.opts.allowSpendPermissions) {
      throw new Error(
        "This NWC connection can SPEND from the wallet. Create a receive-only connection " +
          "(make_invoice + lookup_invoice) or set ALLOW_SPEND_PERMISSIONS=1 for test wallets only.",
      );
    }
    this.checked = true;
    return { methods, canSpend };
  }

  async createInvoice(req: { sats: number; description: string; expirySeconds: number }) {
    if (!this.checked) await this.checkPermissions();
    const tx = await this.client.makeInvoice({
      amount: req.sats * 1000, // NWC uses millisats
      description: req.description,
      expiry: req.expirySeconds,
    });
    return { bolt11: tx.invoice, paymentHash: tx.payment_hash };
  }

  async lookupInvoice(paymentHash: string) {
    const tx = await this.client.lookupInvoice({ payment_hash: paymentHash });
    const settled = tx.state === "settled" || Boolean(tx.settled_at);
    return {
      settled,
      preimage: settled && tx.preimage ? tx.preimage : undefined,
      settledAt: tx.settled_at || undefined,
    };
  }

  close() {
    this.client.close();
  }
}
