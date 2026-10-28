// Step 2: list the coins (UTXOs) your address holds, straight from a public signet explorer.
// Usage: npm run balance            (your wallet)
//        npm run balance -- <address>  (any signet address)
import { EXPLORER, getUtxos, loadWallet, run, sats } from "./lib.js";

run(async () => {
  const address = process.argv[2] ?? loadWallet().address;
  const utxos = await getUtxos(address);

  if (utxos.length === 0) {
    console.log(`No coins at ${address} yet. Use a signet faucet, wait a minute, and try again.`);
    return;
  }

  let confirmed = 0;
  let pending = 0;
  for (const u of utxos) {
    if (u.status.confirmed) confirmed += u.value;
    else pending += u.value;
    const state = u.status.confirmed ? `confirmed in block ${u.status.block_height}` : "waiting for a block";
    console.log(`- ${sats(u.value)} from ${u.txid}:${u.vout} (${state})`);
  }

  console.log(`\nConfirmed: ${sats(confirmed)}`);
  if (pending) console.log(`Pending:   ${sats(pending)}`);
  console.log(`Explorer:  ${EXPLORER}/address/${address}`);
});
