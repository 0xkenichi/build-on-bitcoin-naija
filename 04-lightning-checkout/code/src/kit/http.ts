// Mount the checkout on any Node http server (or adapt to Express/Fastify).
// Two routes: POST /api/orders and GET /api/orders/:id.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Checkout, CheckoutError } from "./checkout.ts";
import type { CatalogItem } from "./types.ts";

/** Simple per-IP limit on new orders, so nobody can flood your wallet with invoices. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 60_000) {}
  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // keep memory bounded
    return true;
  }
}

async function readJson(req: IncomingMessage, limit = 8 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw new CheckoutError("request too large", 413);
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CheckoutError("invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

export function checkoutRoutes(checkout: Checkout, catalog: CatalogItem[], limiter = new RateLimiter()) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (req.method === "GET" && url.pathname === "/api/catalog") {
        send(res, 200, catalog);
        return true;
      }
      if (req.method === "POST" && url.pathname === "/api/orders") {
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new CheckoutError("send JSON", 415);
        if (!limiter.allow(req.socket.remoteAddress ?? "?")) throw new CheckoutError("too many orders, try again in a minute", 429);
        const body = (await readJson(req)) as { cart?: unknown };
        send(res, 201, await checkout.create(body?.cart));
        return true;
      }
      const m = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (req.method === "GET" && m) {
        send(res, 200, await checkout.status(m[1]));
        return true;
      }
      return false;
    } catch (e) {
      if (e instanceof CheckoutError) send(res, e.status, { error: e.message });
      else {
        // Unknown failure (wallet offline, relay down). Don't echo internals to the browser.
        console.error(JSON.stringify({ t: new Date().toISOString(), e: "server_error", msg: String((e as Error).message).slice(0, 200) }));
        send(res, 503, { error: "payment service is busy, please try again" });
      }
      return true;
    }
  };
}
