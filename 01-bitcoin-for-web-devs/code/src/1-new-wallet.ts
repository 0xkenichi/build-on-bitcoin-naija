// Step 1: make a new signet key and address, and save it to wallet.signet.json.
import { existsSync } from "node:fs";
import { ECPair, NETWORK, WALLET_FILE, addressFor, run, saveWallet } from "./lib.js";

run(() => {
  const force = process.argv.includes("--force");
  if (existsSync(WALLET_FILE) && !force) {
    throw new Error(`${WALLET_FILE} already exists. Use --force to replace it (you'll lose any test coins in it).`);
  }

  // A private key is just a random 32-byte number. Whoever knows it can spend the coins.
  const key = ECPair.makeRandom({ network: NETWORK });
  const address = addressFor(key);

  saveWallet({ wif: key.toWIF(), address });

  console.log("New signet wallet saved to", WALLET_FILE);
  console.log("Address:", address);
  console.log("\nNext: get free signet coins from a faucet, e.g. https://signetfaucet.com, then run: npm run balance");
  console.log("This key is for signet only. Never put a real (mainnet) key in a file like this.");
});
