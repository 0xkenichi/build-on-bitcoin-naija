// phoenixd backend: ACINQ's self-hosted Lightning node with a small HTTP API.
// Docs: https://phoenix.acinq.co/server/api
// Status: written against the documented API and tested with a mock server in
// test/; not yet run against a live phoenixd. Use the limited-access password
// (http-password-limited-access), which cannot send payments.
import type { LightningBackend } from "../types.ts";

export class PhoenixdBackend implements LightningBackend {
  readonly name = "phoenixd";
  private auth: string;

  constructor(private baseUrl: string, password: string, private fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.auth = "Basic " + btoa(":" + password);
  }

  async createInvoice(req: { sats: number; description: string; expirySeconds: number }) {
    const body = new URLSearchParams({
      amountSat: String(req.sats),
      description: req.description,
      expirySeconds: String(req.expirySeconds),
    });
    const res = await this.fetchImpl(`${this.baseUrl}/createinvoice`, {
      method: "POST",
      headers: { Authorization: this.auth, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`phoenixd createinvoice failed: HTTP ${res.status}`);
    const j = (await res.json()) as { serialized: string; paymentHash: string };
    return { bolt11: j.serialized, paymentHash: j.paymentHash };
  }

  async lookupInvoice(paymentHash: string) {
    if (!/^[0-9a-f]{64}$/.test(paymentHash)) throw new Error("bad payment hash");
    const res = await this.fetchImpl(`${this.baseUrl}/payments/incoming/${paymentHash}`, {
      headers: { Authorization: this.auth },
    });
    if (res.status === 404) return { settled: false };
    if (!res.ok) throw new Error(`phoenixd lookup failed: HTTP ${res.status}`);
    const j = (await res.json()) as { isPaid: boolean; preimage?: string; completedAt?: number };
    return {
      settled: Boolean(j.isPaid),
      preimage: j.isPaid ? j.preimage : undefined,
      settledAt: j.completedAt ? Math.floor(j.completedAt / 1000) : undefined,
    };
  }
}
