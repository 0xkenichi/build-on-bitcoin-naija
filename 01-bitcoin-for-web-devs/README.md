# Module 1: Bitcoin for web developers

You'll build a tiny Bitcoin wallet in TypeScript. In three short scripts it makes a key and an address, checks the balance, and sends coins. It runs on **signet**, a test network where coins are free and worthless, so you can make every mistake safely.

**You need:** Node.js 20 or newer, a terminal, and about an hour. No Bitcoin knowledge.

## Four ideas before you write any code

**1. A private key is the money.** It's a random 32-byte number. Whoever knows it can spend the coins, and nobody can reverse that or "reset your password". Exchanges hold keys for you, and that's why they can freeze you.

**2. An address is where people pay you.** It comes from your key's public half. Signet addresses start with `tb1q`; real ones start with `bc1q`. You can share an address freely; you never share the key.

**3. Bitcoin doesn't store a balance. It stores coins (UTXOs).** Think of cash. If you have one ₦2,000 note and you buy something for ₦1,500, you don't tear the note. You hand over the whole note and get ₦500 back. Bitcoin works the same way:
- Every payment you receive is a separate "note", called an unspent transaction output (UTXO).
- Your balance is just the sum of your notes.
- To pay, you spend whole notes and send yourself the change.

**4. A transaction spends notes and creates new ones.**
- **Inputs:** the notes you're spending.
- **Outputs:** who gets what. That's the person you're paying, plus change back to you.
- **The fee:** whatever's left over goes to miners. There's no "fee" field: if you forget the change output, the miners keep it all.

## Run it

```bash
cd 01-bitcoin-for-web-devs/code
npm install
npm run selftest      # offline check: keys, addresses and signing all work
```

### Step 1: make a wallet
```bash
npm run new-wallet
```
This prints a `tb1q…` address and saves the key in `wallet.signet.json`. That file is in `.gitignore` so you don't commit it by accident. Get used to that habit now.

### Step 2: get free coins and check your balance
Paste your address into a signet faucet such as [signetfaucet.com](https://signetfaucet.com). Some faucets ask you to solve a CAPTCHA. Wait a few minutes for the next block, then:
```bash
npm run balance
```
You'll see each coin (UTXO) separately, with the transaction it came from. Open the explorer link and find the same coin there.

### Step 3: send some back
Try a dry run first. It builds and signs the transaction but doesn't send it:
```bash
npm run send -- <someone-else's tb1 address> 5000 --dry-run
```
When the numbers look right, drop `--dry-run`. You get a link to your transaction on the explorer.

## What `3-send.ts` is doing

1. **Pick coins.** It takes your biggest confirmed coins until they cover the amount plus the fee. (This is called coin selection, and real wallets do it more carefully.)
2. **Work out the fee.** Fees are priced per virtual byte of transaction size, not per naira sent. A transaction with more inputs is bigger, so it costs more, even if it moves less money.
3. **Build a PSBT** (a Partially Signed Bitcoin Transaction). It's a standard "draft transaction" format that wallets and hardware devices pass around before signing.
4. **Add outputs:** the payment, then change back to your own address. If the change would be tiny ("dust", under 294 sats here), it's cheaper to let it go to the fee.
5. **Sign, check the signatures, finalise.** Only after that does it broadcast through the public explorer's API.

## Mistakes worth making on signet, not mainnet

- **Forgetting change.** Send 5,000 sats from a 100,000-sat coin with no change output, and you've paid a 95,000-sat fee.
- **Committing your key.** Bots scan public GitHub for keys within minutes. Keep keys out of code and out of git.
- **Using unconfirmed coins as if they're final.** For a shop, wait for confirmations before you hand over goods.
- **Copying a mainnet address into signet code, or the other way round.** The `tb1`/`bc1` prefix is there to stop exactly this, so check it.

## Try this

1. Send yourself a payment from your own wallet. How many coins do you have afterwards, and why?
2. Receive two faucet payments, then send an amount bigger than either one. Look at the transaction on the explorer: how many inputs does it have?
3. In `3-send.ts`, replace `await getFeeRate()` with `5` (5 sat/vB) and send again with `--dry-run`. How much did the fee change?

## Next module
Module 2 watches the chain for incoming payments and confirmations, which you need before you can build a checkout.

---
*Code: MIT. This guide: CC BY 4.0. Part of [Build on Bitcoin, Naija](../README.md).*
