// The checkout itself: turn a cart into a locked-price Lightning invoice,
// then watch it until it's paid or expired. The server is the only source of
// truth for prices and for "paid". The browser never decides either.
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { CatalogItem, LightningBackend, Order, OrderLine, PublicOrder } from "./types.ts";
import { RateService, nairaToSats } from "./rates.ts";

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

export function verifyPreimage(preimageHex: string, paymentHashHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(preimageHex) || !/^[0-9a-f]{64}$/i.test(paymentHashHex)) return false;
  const h = createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex");
  return h === paymentHashHex.toLowerCase();
}

/** Tiny order store: a Map, saved to a JSON file so a restart doesn't lose
 *  paid orders. Holds no names, phones or addresses: there is nothing
 *  personal to leak. Swap for your own database in production. */
export class OrderStore {
  private orders = new Map<string, Order>();
  constructor(private file?: string) {
    if (file && existsSync(file)) {
      for (const o of JSON.parse(readFileSync(file, "utf8")) as Order[]) this.orders.set(o.id, o);
    }
  }
  get(id: string) {
    return this.orders.get(id);
  }
  put(o: Order) {
    this.orders.set(o.id, o);
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify([...this.orders.values()], null, 1));
    renameSync(tmp, this.file); // atomic replace
  }
}

export interface CheckoutOptions {
  backend: LightningBackend;
  rates: RateService;
  catalog: CatalogItem[];
  store: OrderStore;
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
    const id = randomBytes(16).toString("hex"); // unguessable order id
    const inv = await this.o.backend.createInvoice({
      sats,
      description: `${this.o.shopName} order ${id.slice(0, 8)}`,
      expirySeconds: expiry,
    });
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
        // A wallet's word isn't enough: the preimage must hash to our payment hash.
        if (r.preimage && !verifyPreimage(r.preimage, order.paymentHash)) {
          this.log("preimage_mismatch", { order: id });
          throw new CheckoutError("payment proof did not verify", 502);
        }
        order.status = "paid";
        order.preimage = r.preimage;
        order.paidAt = r.settledAt ? r.settledAt * 1000 : Date.now();
        this.o.store.put(order);
        this.log("order_paid", { order: id, sats: order.sats });
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
  const { id, createdAt, expiresAt, status, lines, totalNaira, sats, rate, bolt11, paymentHash, preimage, paidAt } = o;
  return { id, createdAt, expiresAt, status, lines, totalNaira, sats, rate, bolt11, paymentHash, preimage, paidAt };
}
