// The demo storefront: a list, a cart, and one call to the checkout widget.
import { open } from "./checkout.ts";

type Item = { id: string; name: string; note: string; priceNaira: number; emoji: string };
const naira = (n: number) => "₦" + n.toLocaleString("en-NG");
const $ = (id: string) => document.getElementById(id)!;
const cart = new Map<string, number>();

const [catalog, config] = await Promise.all([
  fetch("/api/catalog").then((r) => r.json() as Promise<Item[]>),
  fetch("/api/config").then((r) => r.json() as Promise<{ shopName: string; demo: boolean }>),
]);
$("shop-name").textContent = config.shopName;

function renderCart() {
  const count = [...cart.values()].reduce((a, b) => a + b, 0);
  const total = catalog.reduce((s, i) => s + (cart.get(i.id) ?? 0) * i.priceNaira, 0);
  $("cart").hidden = count === 0;
  $("cart-count").textContent = `${count} item${count === 1 ? "" : "s"}`;
  $("cart-total").textContent = naira(total);
}

for (const item of catalog) {
  const li = document.createElement("li");
  li.className = "product";
  const pic = document.createElement("div"); pic.className = "pic"; pic.textContent = item.emoji; pic.setAttribute("aria-hidden", "true");
  const info = document.createElement("div"); info.className = "info";
  const h = document.createElement("h2"); h.textContent = item.name;
  const n = document.createElement("p"); n.className = "note"; n.textContent = item.note;
  const p = document.createElement("p"); p.className = "price"; p.textContent = naira(item.priceNaira);
  info.append(h, n, p);
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "add"; btn.textContent = "Add";
  btn.setAttribute("aria-label", `Add ${item.name}`);
  btn.addEventListener("click", () => {
    cart.set(item.id, Math.min(10, (cart.get(item.id) ?? 0) + 1));
    btn.textContent = `In cart · ${cart.get(item.id)}`;
    btn.classList.add("in");
    renderCart();
  });
  li.append(pic, info, btn);
  $("products").append(li);
}

$("pay").addEventListener("click", () => {
  open({
    cart: [...cart].map(([id, qty]) => ({ id, qty })),
    shopName: config.shopName,
    demo: config.demo,
    onPaid: () => {
      cart.clear();
      document.querySelectorAll<HTMLButtonElement>(".add").forEach((b) => { b.textContent = "Add"; b.classList.remove("in"); });
      renderCart();
    },
  });
});
