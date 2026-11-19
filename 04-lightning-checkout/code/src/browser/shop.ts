// Demo shop, server version: catalog and config come from the kit's server.
import { startShop, type Item } from "./shop-ui.ts";

const [catalog, config] = await Promise.all([
  fetch("/api/catalog").then((r) => r.json() as Promise<Item[]>),
  fetch("/api/config").then((r) => r.json() as Promise<{ shopName: string; demo: boolean }>),
]);
startShop(catalog, config);
