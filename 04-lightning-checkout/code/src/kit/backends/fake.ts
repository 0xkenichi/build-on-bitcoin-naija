// Offline backend for tests and for learning the flow without any network.
// Invoices are NOT real and can't be paid by a wallet; call settle() to simulate.
import { createHash, randomBytes } from "node:crypto";
import type { LightningBackend } from "../types.ts";

export class FakeBackend implements LightningBackend {
  readonly name = "fake";
  private invoices = new Map<string, { preimage: string; settledAt?: number }>();

  async createInvoice(req: { sats: number; description: string; expirySeconds: number }) {
    const preimage = randomBytes(32).toString("hex");
    const paymentHash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
    this.invoices.set(paymentHash, { preimage });
    return { bolt11: `lntbfake${req.sats}n1${paymentHash.slice(0, 40)}`, paymentHash };
  }

  async lookupInvoice(paymentHash: string) {
    const inv = this.invoices.get(paymentHash);
    if (!inv?.settledAt) return { settled: false };
    return { settled: true, preimage: inv.preimage, settledAt: inv.settledAt };
  }

  /** Test helper: pretend the buyer paid. */
  settle(paymentHash: string) {
    const inv = this.invoices.get(paymentHash);
    if (!inv) throw new Error("unknown invoice");
    inv.settledAt = Math.floor(Date.now() / 1000);
  }
}
