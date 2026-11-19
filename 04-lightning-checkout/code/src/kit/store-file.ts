// File-backed order store for Node: a Map saved to JSON so a restart
// doesn't lose paid orders. Fine for one small shop; use a database beyond that.
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Store } from "./checkout.ts";
import type { Order } from "./types.ts";

export class OrderStore implements Store {
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
    writeFileSync(tmp, JSON.stringify([...this.orders.values()], null, 1), { mode: 0o600 });
    renameSync(tmp, this.file); // atomic replace
  }
}
