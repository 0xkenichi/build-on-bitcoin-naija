# Module 5: paying from the buyer's own wallet (WebLN and Nostr Wallet Connect)

In module 4 the buyer paid by scanning a QR code or tapping "Open wallet app". That works everywhere, but it means leaving your page. This module covers the two ways a page can ask the buyer's wallet to pay directly, and what you must never do while doing it.

The code is in module 4's checkout widget, [`04-lightning-checkout/code/src/browser/checkout.ts`](../04-lightning-checkout/code/src/browser/checkout.ts), so you can run everything from the same demo shop.

## Four ways to pay, in the order the widget offers them

| Way | How it works | Best for |
|---|---|---|
| **Open wallet app** | A `lightning:lnbc…` link. The phone opens whichever Lightning wallet is installed | Phones: most buyers |
| **QR code** | The same invoice as a QR. Uppercase, so the code is smaller and scans faster | Buyer on a laptop, wallet on a phone |
| **WebLN** | A browser extension (such as Alby) adds `window.webln`; the page calls `sendPayment(invoice)` and the extension asks the buyer to approve | Desktop buyers with a browser wallet |
| **Nostr Wallet Connect (NWC)** | The buyer pastes a connection string from their wallet; the page sends a signed "pay this invoice" request through a Nostr relay | Any browser, any phone, no extension |

## WebLN in five lines
```ts
if (window.webln) {
  await window.webln.enable();                 // the wallet asks the buyer for permission
  await window.webln.sendPayment(order.bolt11); // the wallet asks again for this payment
}
```
Only show the button when `window.webln` exists. Don't treat the returned preimage as proof of payment for the shop: the page is the buyer's, so the buyer controls it. The shop's server still checks the invoice itself (module 4, idea 3).

## Nostr Wallet Connect: what's in the string
`nostr+walletconnect://<wallet pubkey>?relay=wss://…&secret=<hex>`
- **wallet pubkey:** who to send requests to.
- **relay:** the Nostr relay that carries the messages, end-to-end encrypted.
- **secret:** a key that signs requests. **Whoever has it can spend up to the connection's budget.**

So the buyer side must treat that string like cash:
1. **Ask for a budget-limited connection.** Wallets such as Alby Hub let you set a budget on each connection, say ₦5,000 worth a month. The widget's help text says so.
2. **Keep it in memory only.** The widget reads it from a password field, uses it once, and clears the field. It never goes to `localStorage`, cookies, analytics or the shop's server.
3. **Load the NWC code only when asked.** It's 38 KB gzipped, more than double the whole shop page, so the widget fetches `nwc-pay.js` only when the buyer opens that option.
4. **Lock down the page.** A Content Security Policy with `script-src 'self'` and no inline scripts means an injected script can't read the field. Never put user text into `innerHTML`.

The paying code is short ([`nwc-pay.ts`](../04-lightning-checkout/code/src/browser/nwc-pay.ts)):
```ts
const client = new NWCClient({ nostrWalletConnectUrl: connectionUrl });
try { return (await client.payInvoice({ invoice: bolt11 })).preimage; }
finally { client.close(); }
```

## The shop side is NWC too, with fewer powers
The vendor's wallet is also connected over NWC, but with a very different connection: **make_invoice and lookup_invoice only**. The shop can ask "make me an invoice for 10,621 sats" and "has it been paid?", and nothing else. Module 4's `NwcBackend.checkPermissions()` refuses to start with a connection that can spend. Same protocol, opposite trust: the buyer's connection can pay but should have a small budget; the shop's connection can't pay at all.

## Try it
```bash
cd 04-lightning-checkout/code
npm run demo
```
1. Open the shop, add an item, press **Pay with ⚡ Lightning**.
2. Open **Pay with Nostr Wallet Connect**.
3. Paste the `BUYER_TEST_NWC_URL` value from your `.env` (a free test wallet from faucet.nwc.dev) and press **Pay now**.
4. Watch the status change to paid and the receipt check the proof on the page.

For WebLN, install the Alby browser extension, connect it to a faucet test wallet, and the **Pay with browser wallet** button appears.

## Exercises
1. Show the buyer's remaining NWC budget before paying (`get_budget` in NIP-47, if their wallet supports it).
2. Add a "Pay with Lightning address" option for buyers whose wallet only supports LNURL.
3. Make a receive-only connection in a real wallet and confirm the kit accepts it, then try one with "send" and confirm it refuses.

**Next:** module 6, shipping safely: payment states, refunds and testing before mainnet.
