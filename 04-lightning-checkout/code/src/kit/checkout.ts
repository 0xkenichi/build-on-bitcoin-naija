// The checkout itself: turn a cart into a locked-price Lightning invoice,
// then watch it until it's paid or expired. The server is the only source of
// truth for prices and for "paid". The browser never decides either.
// Runs in Node 20+ and in browsers: only Web Crypto and fetch, no Node modules.
import type { CatalogItem, LightningBackend, Order, OrderLine, PublicOrder } from "./types.ts";
import { RateService, nairaToSats } from "./rates.ts";
import { paymentHashFromBolt11 } from "./bolt11.ts";

export const MAX_QTY = 10;
export const MAX_LINES = 20;

export class CheckoutError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Validate a cart from the browser against the catalog. Only ids and
 *  quantities are accepted; names and prices always come from the server. */
export function priceCart(input: unknown, catalog: CatalogItem[]): { lines: OrderLine[]; totalNaira: number } {
  if (!Array.isArray(input) || input.length === 0) throw new CheckoutError("cart is empty");
  if (input.length > MAX_LINES) throw new CheckoutError("too many items");
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const merged = new Map<string, number>();
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) throw new CheckoutError("bad cart line");
    const { id, qty } = raw as { id?: unknown; qty?: unknown };
    if (typeof id !== "string" || !byId.has(id)) throw new CheckoutError("unknown item");
    if (!Number.isInteger(qty) || (qty as number) < 1 || (qty as number) > MAX_QTY) throw new CheckoutError("bad quantity");
    merged.set(id, Math.min(MAX_QTY, (merged.get(id) ?? 0) + (qty as number)));
  }
  const lines = [...merged].map(([id, qty]) => {
    const item = byId.get(id)!;
    return { id, name: item.name, qty, priceNaira: item.priceNaira };
  });
  const totalNaira = lines.reduce((s, l) => s + l.qty * l.priceNaira, 0);
  return { lines, totalNaira };
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const randomHex = (bytes: number) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256Hex(hex: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", fromHex(hex))));
}

/** The preimage is the receipt: only a completed payment reveals it,
 *  and its SHA-256 must equal the invoice's payment hash. */
export async function verifyPreimage(preimageHex: string, paymentHashHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(preimageHex) || !/^[0-9a-f]{64}$/i.test(paymentHashHex)) return false;
  return (await sha256Hex(preimageHex.toLowerCase())) === paymentHashHex.toLowerCase();
}

/** Where orders live. The kit ships a file store for Node (store-file.ts)
 *  and a memory store; swap in your own database. Orders hold no names,
 *  phones or addresses: there is nothing personal to leak. */
export interface Store {
  get(id: string): Order | undefined;
  put(o: Order): void;
}
export class MemoryStore implements Store {
  private orders = new Map<string, Order>();
  get(id: string) {
    return this.orders.get(id);
  }
  put(o: Order) {
    this.orders.set(o.id, o);
  }
}

export interface CheckoutOptions {
  backend: LightningBackend;
  rates: RateService;
  catalog: CatalogItem[];
  store: Store;
  shopName: string;
  invoiceExpirySeconds?: number; // also the price lock
  log?: (event: string, fields: Record<string, string | number>) => void;
}

export class Checkout {
  private lastLookup = new Map<string, number>();
  constructor(private o: CheckoutOptions) {}

  private log(event: string, fields: Record<string, string | number>) {
    // Only order ids, states and amounts. Never invoices, preimages or IPs.
    (this.o.log ?? ((e, f) => console.log(JSON.stringify({ t: new Date().toISOString(), e, ...f }))))(event, fields);
  }

  async create(cart: unknown): Promise<PublicOrder> {
    const { lines, totalNaira } = priceCart(cart, this.o.catalog);
    const rate = await this.o.rates.get();
    const sats = nairaToSats(totalNaira, rate.nairaPerBtc);
    const expiry = this.o.invoiceExpirySeconds ?? 600;
    const id = randomHex(16); // unguessable order id
    const inv = await this.o.backend.createInvoice({
      sats,
      description: `${this.o.shopName} order ${id.slice(0, 8)}`,
      expirySeconds: expiry,
    });
    // Trust the invoice, not the backend's word: the hash inside the bolt11
    // is what the buyer's wallet will pay against.
    if (paymentHashFromBolt11(inv.bolt11) !== inv.paymentHash.toLowerCase()) {
      throw new CheckoutError("wallet returned an invoice that doesn't match its payment hash", 502);
    }
    const now = Date.now();
    const order: Order = {
      id,
      createdAt: now,
      expiresAt: now + expiry * 1000,
      status: "pending",
      lines,
      totalNaira,
      sats,
      rate,
      bolt11: inv.bolt11,
      paymentHash: inv.paymentHash,
    };
    this.o.store.put(order);
    this.log("order_created", { order: id, naira: totalNaira, sats, rate_source: rate.source });
    return toPublic(order);
  }

  /** Current state of an order. Asks the backend at most once every 2s per
   *  order, however many browsers are polling. */
  async status(id: string): Promise<PublicOrder> {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new CheckoutError("bad order id");
    const order = this.o.store.get(id);
    if (!order) throw new CheckoutError("order not found", 404);
    if (order.status !== "pending") return toPublic(order);

    const last = this.lastLookup.get(id) ?? 0;
    const pastExpiry = Date.now() > order.expiresAt; // always do a final check before calling it expired
    if (pastExpiry || Date.now() - last >= 2000) {
      this.lastLookup.set(id, Date.now());
      const r = await this.o.backend.lookupInvoice(order.paymentHash);
      if (r.settled) {
        // Check the wallet's preimage against the invoice's payment hash. This
        // catches a buggy or misconfigured backend. It can't catch a dishonest
        // receiver (the receiving wallet always knows its own preimage), which
        // is why the buyer's phone also checks the preimage *its own* wallet got.
        let proofVerified = false;
        if (r.preimage) {
          if (!(await verifyPreimage(r.preimage, order.paymentHash))) {
            this.log("preimage_mismatch", { order: id });
            throw new CheckoutError("payment proof did not verify", 502);
          }
          proofVerified = true;
        }
        order.status = "paid";
        order.preimage = r.preimage;
        order.proofVerified = proofVerified;
        order.paidAt = r.settledAt ? r.settledAt * 1000 : Date.now();
        this.o.store.put(order);
        this.log("order_paid", { order: id, sats: order.sats, proof: proofVerified ? "verified" : "none_from_wallet" });
        return toPublic(order);
      }
    }
    if (Date.now() > order.expiresAt) {
      order.status = "expired";
      this.o.store.put(order);
      this.log("order_expired", { order: id });
    }
    return toPublic(order);
  }
}

function toPublic(o: Order): PublicOrder {
  const { id, createdAt, expiresAt, status, lines, totalNaira, sats, rate, bolt11, paymentHash, preimage, proofVerified, paidAt } = o;
  return { id, createdAt, expiresAt, status, lines, totalNaira, sats, rate, bolt11, paymentHash, preimage, proofVerified, paidAt };
}
