# Build on Bitcoin, Naija

A free, open course for Nigerian web developers: add Bitcoin and Lightning payments to real apps. Each module has a short video, a written guide and working code that runs on signet.

## Modules (in progress)
1. **Bitcoin for web developers:** keys, addresses and transactions on signet with bitcoinjs-lib.
2. **Reading the chain:** watch for payments and confirmations with mempool.space's open-source API.
3. **Accepting payments:** a self-hosted BTCPay Server in a web app.
4. **Lightning for developers:** invoices, Lightning addresses and LNURL with phoenixd.
5. **Paying from users' own wallets:** WebLN and Nostr Wallet Connect.
6. **Shipping safely:** signet testing, payment states and refunds, and never holding users' money.

Each module lives in its own folder (`01-…` to `06-…`) with `README.md` (the guide), `code/` (a TypeScript starter you can run) and `video.md` (link and Pidgin subtitles).

## Workshops
Two hands-on build sessions in Lagos, one at the University of Lagos. You leave with a working payment flow in your own app.

## Status
- **Module 1 is up:** the guide, working code and an offline self-test, in [`01-bitcoin-for-web-devs`](01-bitcoin-for-web-devs/). Its video is next.
- **Modules 2–6** follow, with progress posted here every month.

## Run module 1
```bash
cd 01-bitcoin-for-web-devs/code
npm install
npm run selftest
```

## License
- **Code:** MIT
- **Lessons, guides and videos:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

## Contact
Kenichi · X [@0xKenichi](https://x.com/0xKenichi) · [0xkenichi.github.io](https://0xkenichi.github.io)
