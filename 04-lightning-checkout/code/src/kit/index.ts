// Naija Checkout: public entry point.
export { Checkout, CheckoutError, MemoryStore, priceCart, verifyPreimage } from "./checkout.ts";
export type { Store } from "./checkout.ts";
export { OrderStore } from "./store-file.ts";
export { paymentHashFromBolt11 } from "./bolt11.ts";
export { RateService, nairaToSats, formatNaira } from "./rates.ts";
export { checkoutRoutes, RateLimiter } from "./http.ts";
export { NwcBackend } from "./backends/nwc.ts";
export { PhoenixdBackend } from "./backends/phoenixd.ts";
export { FakeBackend } from "./backends/fake.ts";
export type * from "./types.ts";

import { NwcBackend } from "./backends/nwc.ts";
import { PhoenixdBackend } from "./backends/phoenixd.ts";
import { FakeBackend } from "./backends/fake.ts";
import type { LightningBackend } from "./types.ts";

/** Pick a backend from environment variables. Secrets stay on the server. */
export function backendFromEnv(env = process.env): LightningBackend {
  const kind = env.LN_BACKEND ?? "nwc";
  if (kind === "nwc") {
    if (!env.MERCHANT_NWC_URL) throw new Error("Set MERCHANT_NWC_URL in .env (see .env.example)");
    return new NwcBackend(env.MERCHANT_NWC_URL, { allowSpendPermissions: env.ALLOW_SPEND_PERMISSIONS === "1" });
  }
  if (kind === "phoenixd") {
    if (!env.PHOENIXD_URL || !env.PHOENIXD_PASSWORD) throw new Error("Set PHOENIXD_URL and PHOENIXD_PASSWORD");
    return new PhoenixdBackend(env.PHOENIXD_URL, env.PHOENIXD_PASSWORD);
  }
  if (kind === "fake") return new FakeBackend();
  throw new Error(`Unknown LN_BACKEND: ${kind}`);
}
