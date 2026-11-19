// Free test wallets from the NWC Faucet (https://faucet.nwc.dev).
// "Balances are not real and exist only inside the NWC Faucet": no real money.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export async function makeFaucetWallet(balanceSats = 20000): Promise<string> {
  const res = await fetch(`https://faucet.nwc.dev?balance=${balanceSats}`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
  });
  const url = (await res.text()).trim();
  if (!res.ok || !url.startsWith("nostr+walletconnect://")) throw new Error(`faucet failed: HTTP ${res.status}`);
  return url;
}

/** First run of `npm run demo`: no .env yet, so make two test wallets
 *  (shop + buyer) and write a demo .env. */
export async function ensureDemoEnv(file = ".env"): Promise<boolean> {
  if (existsSync(file)) return false;
  console.log("No .env found. Creating two free TEST wallets on faucet.nwc.dev (not real money)...");
  const [merchant, buyer] = await Promise.all([makeFaucetWallet(1000), makeFaucetWallet(100000)]);
  const tpl = existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
  const env = tpl
    .replace(/^MERCHANT_NWC_URL=.*$/m, `MERCHANT_NWC_URL=${merchant}`)
    .replace(/^ALLOW_SPEND_PERMISSIONS=.*$/m, "ALLOW_SPEND_PERMISSIONS=1")
    .replace(/^DEMO_MODE=.*$/m, "DEMO_MODE=1")
    .replace(/^BUYER_TEST_NWC_URL=.*$/m, `BUYER_TEST_NWC_URL=${buyer}`);
  writeFileSync(file, env, { mode: 0o600 }); // readable by you only
  console.log("Wrote .env with a test shop wallet and a test buyer wallet (100,000 test sats).");
  return true;
}
