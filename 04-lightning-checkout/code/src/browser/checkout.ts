// Naija Checkout widget: a drop-in payment sheet for any website.
//   NaijaCheckout.open({ cart: [{ id: "denim-jacket", qty: 1 }], shopName: "My Shop" })
// No framework. Holds no secrets. The server decides price and "paid".
import qrcode from "qrcode-generator";

type Line = { id: string; name: string; qty: number; priceNaira: number };
type Order = {
  id: string; createdAt: number; expiresAt: number; status: "pending" | "paid" | "expired";
  lines: Line[]; totalNaira: number; sats: number;
  rate: { nairaPerBtc: number; source: string; fetchedAt: number; stale: boolean };
  bolt11: string; paymentHash: string; preimage?: string; paidAt?: number;
};
export type OpenOptions = {
  cart: { id: string; qty: number }[];
  shopName: string;
  apiBase?: string;
  demo?: boolean; // show the "demo buyer wallet" button (test sats only)
  onPaid?: (order: Order) => void;
  onClose?: () => void;
};
declare global {
  interface Window { webln?: { enable(): Promise<void>; sendPayment(pr: string): Promise<{ preimage: string }> } }
}

const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");
const sats = (n: number) => n.toLocaleString("en-NG") + " sats";
const time = (ms: number) => new Date(ms).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string | null)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k !== null) e.append(k); // text goes in as text, never as HTML
  return e;
}

function qrSvg(text: string): SVGSVGElement {
  const q = qrcode(0, "L");
  q.addData(text.toUpperCase(), "Alphanumeric"); // uppercase bolt11 makes a smaller QR
  q.make();
  const n = q.getModuleCount(), pad = 2, size = n + pad * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + pad} ${r + pad}h1v1h-1z`;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "nc-qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Lightning invoice QR code");
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", String(size)); bg.setAttribute("height", String(size)); bg.setAttribute("fill", "#fff");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", d); p.setAttribute("fill", "#111");
  svg.append(bg, p);
  return svg;
}

async function sha256Hex(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function open(opts: OpenOptions) {
  const api = (opts.apiBase ?? "") + "/api";
  const dialog = el("dialog", { class: "nc-sheet", "aria-label": "Pay with Bitcoin Lightning" });
  const body = el("div", { class: "nc-body", "aria-live": "polite" });
  const close = el("button", { class: "nc-close", type: "button", "aria-label": "Close" }, "×");
  dialog.append(close, body);
  document.body.append(dialog);
  dialog.showModal();

  let order: Order | undefined;
  let timer: number | undefined;
  let tick: number | undefined;
  let failures = 0;
  let closed = false;

  const stop = () => { clearTimeout(timer); clearInterval(tick); };
  const finish = () => { closed = true; stop(); dialog.close(); dialog.remove(); opts.onClose?.(); };
  close.addEventListener("click", finish);
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(); });

  const show = (...kids: Node[]) => body.replaceChildren(...kids);
  const status = el("p", { class: "nc-status" });

  async function create() {
    show(el("p", { class: "nc-loading" }, "Getting today's price…"));
    try {
      const r = await fetch(`${api}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cart: opts.cart }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not start checkout");
      order = j as Order;
      renderPending(order);
      poll();
    } catch (e) {
      const retry = el("button", { class: "nc-btn", type: "button" }, "Try again");
      retry.addEventListener("click", create);
      show(el("p", { class: "nc-error" }, `${(e as Error).message}. Check your connection.`), retry);
    }
  }

  function poll() {
    if (closed || !order) return;
    // Slow down when the tab is hidden or the network is failing: saves data.
    const delay = document.hidden ? 8000 : Math.min(2500 * 2 ** failures, 15000);
    timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`${api}/orders/${order!.id}`, { cache: "no-store" });
        if (r.status === 404) throw new Error("order not found");
        if (!r.ok) throw new Error("busy");
        const o = (await r.json()) as Order;
        failures = 0;
        status.textContent = "Waiting for payment…";
        if (o.status === "paid") return renderPaid(o);
        if (o.status === "expired") return renderExpired();
      } catch {
        failures = Math.min(failures + 1, 3);
        status.textContent = navigator.onLine ? "Still checking…" : "You're offline. We'll keep checking when you're back.";
      }
      poll();
    }, delay);
  }

  function renderPending(o: Order) {
    const lock = el("span", { class: "nc-lock" });
    const updateLock = () => {
      const s = Math.max(0, Math.round((o.expiresAt - Date.now()) / 1000));
      lock.textContent = `Price locked for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };
    updateLock();
    tick = window.setInterval(updateLock, 1000);

    const link = el("a", { class: "nc-btn nc-primary", href: `lightning:${o.bolt11}` }, "Open wallet app");
    const copy = el("button", { class: "nc-btn", type: "button" }, "Copy invoice");
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(o.bolt11); copy.textContent = "Copied ✓"; }
      catch { copy.textContent = "Couldn't copy: long-press the QR instead"; }
    });
    const actions = el("div", { class: "nc-actions" }, link);

    if (window.webln) {
      const b = el("button", { class: "nc-btn", type: "button" }, "Pay with browser wallet");
      b.addEventListener("click", async () => {
        b.setAttribute("disabled", "");
        try { await window.webln!.enable(); await window.webln!.sendPayment(o.bolt11); status.textContent = "Payment sent. Confirming…"; failures = 0; }
        catch (e) { status.textContent = `Wallet said: ${(e as Error).message}`; b.removeAttribute("disabled"); }
      });
      actions.append(b);
    }

    // Nostr Wallet Connect: the buyer pastes a connection from their own wallet.
    // It stays in this tab's memory only, is never sent to the shop, never saved.
    const nwcBox = el("details", { class: "nc-nwc" },
      el("summary", {}, "Pay with Nostr Wallet Connect"),
    );
    const nwcInput = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: "nostr+walletconnect://…", "aria-label": "NWC connection string" }) as HTMLInputElement;
    const nwcPay = el("button", { class: "nc-btn", type: "button" }, "Pay now");
    const nwcNote = el("p", { class: "nc-fine" }, "Use a connection with a small budget. It stays in this tab and is never sent to the shop.");
    nwcPay.addEventListener("click", async () => {
      const url = nwcInput.value.trim();
      if (!url.startsWith("nostr+walletconnect://")) { nwcNote.textContent = "That doesn't look like an NWC connection."; return; }
      nwcPay.setAttribute("disabled", ""); nwcPay.textContent = "Paying…";
      try {
        const mod = await import(new URL("./nwc-pay.js", import.meta.url).href); // loaded only when needed
        await mod.payWithNwc(url, o.bolt11);
        nwcInput.value = "";
        status.textContent = "Payment sent. Confirming…"; failures = 0;
      } catch (e) {
        nwcNote.textContent = `Wallet said: ${(e as Error).message}`;
        nwcPay.removeAttribute("disabled"); nwcPay.textContent = "Pay now";
      }
    });
    nwcBox.append(nwcInput, nwcPay, nwcNote);

    let demoBtn: HTMLElement | null = null;
    if (opts.demo) {
      demoBtn = el("button", { class: "nc-btn nc-demo", type: "button" }, "Demo: pay from test buyer wallet");
      demoBtn.addEventListener("click", async () => {
        demoBtn!.setAttribute("disabled", "");
        const r = await fetch(`/demo/pay/${o.id}`, { method: "POST" });
        status.textContent = r.ok ? "Test payment sent. Confirming…" : "Demo payment failed";
        failures = 0;
      });
    }

    status.textContent = "Waiting for payment…";
    show(
      el("p", { class: "nc-shop" }, opts.shopName),
      el("p", { class: "nc-total" }, naira(o.totalNaira)),
      el("p", { class: "nc-sats" }, `${sats(o.sats)} · Bitcoin Lightning`),
      el("a", { class: "nc-qrlink", href: `lightning:${o.bolt11}`, "aria-label": "Open in wallet" }, qrSvg(`lightning:${o.bolt11}`)),
      lock,
      actions,
      copy,
      nwcBox,
      demoBtn ?? el("span"),
      status,
      el("p", { class: "nc-fine" },
        `Rate: 1 BTC = ${naira(o.rate.nairaPerBtc)} (${o.rate.source}${o.rate.stale ? ", may be out of date" : ""}). `,
        "The shop never holds your money or your wallet keys."),
    );
  }

  async function renderPaid(o: Order) {
    stop();
    order = o;
    const proof = el("p", { class: "nc-proof" }, "Checking payment proof…");
    const shortId = o.id.slice(0, 8).toUpperCase();
    const text = [
      `${opts.shopName}: receipt ${shortId}`,
      ...o.lines.map((l) => `${l.qty} × ${l.name}: ${naira(l.qty * l.priceNaira)}`),
      `Total: ${naira(o.totalNaira)} (${sats(o.sats)})`,
      `Rate: 1 BTC = ${naira(o.rate.nairaPerBtc)} (${o.rate.source})`,
      `Paid: ${time(o.paidAt ?? Date.now())} by Bitcoin Lightning`,
      `Payment hash: ${o.paymentHash}`,
      `Proof (preimage): ${o.preimage ?? "n/a"}`,
    ].join("\n");
    const wa = el("a", { class: "nc-btn nc-primary", href: `https://wa.me/?text=${encodeURIComponent(text)}`, target: "_blank", rel: "noopener" }, "Send receipt on WhatsApp");
    const save = el("button", { class: "nc-btn", type: "button" }, "Save receipt");
    save.addEventListener("click", () => {
      const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: `receipt-${shortId}.txt` });
      a.click();
    });
    const done = el("button", { class: "nc-btn", type: "button" }, "Done");
    done.addEventListener("click", finish);
    show(
      el("div", { class: "nc-tick", "aria-hidden": "true" }, "✓"),
      el("h2", { class: "nc-paid" }, "Paid. Thank you!"),
      el("p", { class: "nc-shop" }, `${opts.shopName} · receipt ${shortId}`),
      el("ul", { class: "nc-lines" }, ...o.lines.map((l) => el("li", {}, el("span", {}, `${l.qty} × ${l.name}`), el("span", {}, naira(l.qty * l.priceNaira))))),
      el("p", { class: "nc-receipt-total" }, el("span", {}, "Total"), el("span", {}, naira(o.totalNaira))),
      el("p", { class: "nc-fine" }, `${sats(o.sats)} at 1 BTC = ${naira(o.rate.nairaPerBtc)} · paid ${time(o.paidAt ?? Date.now())}`),
      proof,
      el("div", { class: "nc-actions" }, wa, save),
      done,
    );
    // Anyone can check this: the preimage is only revealed when the payment
    // completes, and its SHA-256 must equal the invoice's payment hash.
    if (o.preimage && (await sha256Hex(o.preimage)) === o.paymentHash) proof.textContent = "✓ Payment proof verified on this phone";
    else proof.textContent = "Payment confirmed by the shop's wallet";
    opts.onPaid?.(o);
  }

  function renderExpired() {
    stop();
    const again = el("button", { class: "nc-btn nc-primary", type: "button" }, "Get a new price");
    again.addEventListener("click", create);
    show(el("h2", {}, "Price lock ran out"), el("p", {}, "Nothing was charged. Bitcoin's naira price moves, so we lock it for 10 minutes at a time."), again);
  }

  create();
  return { close: finish };
}

(window as unknown as { NaijaCheckout: unknown }).NaijaCheckout = { open };
