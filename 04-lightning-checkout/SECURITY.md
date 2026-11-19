# Naija Checkout: threat model

**What we protect:** the vendor's money, the buyer's money, the vendor's wallet credentials, and the buyer's privacy.
**Who we defend against:** a buyer who edits the page, a bot that floods the shop, a stranger who finds the server's logs or backups, a misbehaving rate API or wallet, and a careless developer (including us).

## Design choices
1. **No custody.** Money goes from the buyer's wallet straight to the vendor's wallet. The kit never holds funds, so there's nothing to steal from the kit and no licence question for the developer.
2. **Least privilege.** The shop's wallet connection needs two permissions: create invoices and look them up. `NwcBackend.checkPermissions()` refuses any NWC connection that can also pay (`pay_invoice`, `pay_keysend`, `multi_pay_*`). The only override is `ALLOW_SPEND_PERMISSIONS=1`, meant for the free test faucet, whose wallets always have full permissions. For phoenixd, use the limited-access password, which can't send.
3. **Secrets only on the server.** Wallet credentials live in `.env` (file mode 600, git-ignored). The browser bundle contains no secrets; the buyer's own NWC string, if they use one, stays in that tab's memory, is never sent to the shop, and is cleared after paying.
4. **Proven libraries, few of them.** One runtime dependency on the server (`@getalby/sdk` for NIP-47), plus `qrcode-generator` bundled into the page. Hashing uses Node's `crypto` and the browser's Web Crypto.

## Threats and mitigations

| # | Threat | Mitigation | Where | Tested |
|---|---|---|---|---|
| 1 | Buyer edits the page to pay ₦9 instead of ₦9,000 | Browser sends only item ids and quantities; prices come from the server catalog; quantity 1–10, at most 20 lines | `priceCart` in `checkout.ts` | ✓ |
| 2 | Buyer fakes the success screen | "Paid" is set only by the server after asking the vendor's wallet | `Checkout.status` | ✓ |
| 3 | A buggy or misconfigured wallet backend says "paid" when it wasn't, or hands back an invoice that doesn't match | Server reads the payment hash out of the bolt11 itself and refuses a mismatch; when the wallet returns a preimage, the server checks SHA-256(preimage) = that hash, otherwise the order is marked `proofVerified: false`. This can't catch a dishonest *receiver* (the receiving wallet always knows its preimage), so the buyer's phone checks the preimage **its own wallet** returned against the hash decoded from the invoice it paid | `bolt11.ts`, `verifyPreimage`, `checkout.ts` (browser) | ✓ |
| 4 | Shop credentials leak (stolen server, committed `.env`) | Receive-only permissions: an attacker can create invoices but can't move the vendor's money. `.env` is git-ignored and written with mode 600 | `nwc.ts`, `faucet.ts` | ✓ (permission check) |
| 5 | Bot floods the shop with orders (spams the vendor's wallet with invoices) | 10 new orders per IP per minute; request body capped at 8 KB; JSON only | `http.ts` | ✓ |
| 6 | Polling storms hammer the wallet | At most one wallet lookup per order every 2 s, whatever the number of pollers; clients back off on errors | `Checkout.status`, browser `poll()` | ✓ |
| 7 | Rate API returns garbage or is down; buyer pays far too little or too much | Two sources, sanity bounds (₦1m–₦10bn per BTC), refuses a >25% jump from the last good rate, falls back to the last good rate or a shipped fallback and labels it "may be out of date". Rounding always goes up by under 1 sat | `rates.ts` | ✓ |
| 8 | Buyer pays an old invoice after the price moved | Invoice expiry = price lock (10 min default). Expired orders need a new price. A payment right at the deadline is still caught by a final check | `Checkout.status` | ✓ |
| 9 | Guessing other people's orders or receipts | Order ids are 128-bit random; ids are format-checked before any lookup | `Checkout.create/status` | ✓ |
| 10 | Cross-site scripting steals the buyer's NWC string | Strict CSP (`script-src 'self'`, no inline scripts or styles), all text added as DOM text, never `innerHTML`; `frame-ancestors 'none'`, `nosniff`, `no-referrer` | `server.ts`, `checkout.ts` | manual |
| 11 | Error messages leak internals | Unknown errors return a generic 503; details go to the server log, cut to 200 characters | `http.ts` | ✓ |
| 12 | Personal data exposure | The kit asks for no name, phone or address. Logs hold only order id, state, naira and sats: never invoices, payment hashes, preimages or IP addresses | `Checkout.log` | ✓ |
| 13 | Path traversal on the demo's static file server | Paths are normalised and must stay inside `public/`; only listed file types are served | `server.ts` | manual |
| 14 | Demo payment button left on in production | Off unless `DEMO_MODE=1` and a test buyer wallet are both set; only pays pending orders this server created | `server.ts` | manual |

"✓" means covered by `npm run selftest` (16 offline tests) or `npm run e2e`.

## Known gaps
- **Refunds are manual** (the vendor pays the buyer back from their own wallet). Module 6 adds refund states.
- **NWC depends on Nostr relays.** If the relay is down, checkout shows "payment service is busy" and the buyer can retry. The vendor can run their own relay or use phoenixd.
- **In-memory rate limiting** resets on restart and doesn't share state across servers. Put a reverse proxy limit in front for real traffic.
- **No HTTPS in the demo** (localhost). A real deployment must use HTTPS: Web Crypto and clipboard access need it, and the NWC string must never cross plain HTTP.
- **Not audited.** This is teaching code. Read it before you trust it with a vendor's money, and start with small amounts.
