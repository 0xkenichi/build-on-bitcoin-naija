// Shared types for Naija Checkout.

/** What any Lightning backend must do for a shop. Two methods, nothing more.
 *  Note what is NOT here: no "pay", no "send". The shop can receive money
 *  but cannot spend it, so a leaked shop key can't drain the wallet. */
export interface LightningBackend {
  readonly name: string;
  createInvoice(req: { sats: number; description: string; expirySeconds: number }): Promise<{
    bolt11: string;
    paymentHash: string;
  }>;
  lookupInvoice(paymentHash: string): Promise<{
    settled: boolean;
    preimage?: string;
    settledAt?: number; // unix seconds
  }>;
}

export interface CatalogItem {
  id: string;
  name: string;
  note: string;
  priceNaira: number; // whole naira
  emoji: string;
}

export type OrderStatus = "pending" | "paid" | "expired";

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  priceNaira: number;
}

export interface Order {
  id: string;
  createdAt: number; // unix ms
  expiresAt: number; // unix ms
  status: OrderStatus;
  lines: OrderLine[];
  totalNaira: number;
  sats: number;
  rate: { nairaPerBtc: number; source: string; fetchedAt: number; stale: boolean };
  bolt11: string;
  paymentHash: string;
  preimage?: string;
  /** true when the wallet returned a preimage whose SHA-256 is the invoice's payment hash */
  proofVerified?: boolean;
  paidAt?: number; // unix ms
}

/** What the browser is allowed to see. Same as Order today, but kept separate
 *  so adding a private field later doesn't leak it by accident. */
export type PublicOrder = Pick<
  Order,
  | "id" | "createdAt" | "expiresAt" | "status" | "lines" | "totalNaira" | "sats"
  | "rate" | "bolt11" | "paymentHash" | "preimage" | "proofVerified" | "paidAt"
>;
