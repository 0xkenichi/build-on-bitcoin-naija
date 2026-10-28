// Step 3: send signet coins to another address.
// Usage: npm run send -- <to-address> <amount-in-sats> [--dry-run]
import { Psbt, address as btcAddress } from "bitcoinjs-lib";
import {
  DUST_SATS,
  ECPair,
  EXPLORER,
  NETWORK,
  broadcast,
  estimateVbytes,
  getFeeRate,
  getUtxos,
  loadWallet,
  run,
  sats,
} from "./lib.js";

run(async () => {
  const [to, amountArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry-run");

  if (!to || !amountArg) throw new Error("Usage: npm run send -- <to-address> <amount-in-sats> [--dry-run]");
  try {
    btcAddress.toOutputScript(to, NETWORK);
  } catch {
    throw new Error(`${to} is not a valid signet address (they start with tb1).`);
  }
  const amount = BigInt(amountArg);
  if (amount < DUST_SATS) throw new Error(`Send at least ${sats(DUST_SATS)}; smaller outputs are dust.`);

  const { key, address } = loadWallet();
  const myScript = btcAddress.toOutputScript(address, NETWORK);
  const feeRate = await getFeeRate();

  // Coin selection: spend the biggest confirmed coins first until amount + fee is covered.
  const utxos = (await getUtxos(address)).filter((u) => u.status.confirmed).sort((a, b) => b.value - a.value);
  const picked: typeof utxos = [];
  let total = 0n;
  let fee = BigInt(estimateVbytes(1, 2) * feeRate);
  for (const u of utxos) {
    picked.push(u);
    total += BigInt(u.value);
    fee = BigInt(estimateVbytes(picked.length, 2) * feeRate);
    if (total >= amount + fee) break;
  }
  if (total < amount + fee) {
    throw new Error(`Not enough confirmed coins: you have ${sats(total)} but need ${sats(amount + fee)} including the fee.`);
  }

  const psbt = new Psbt({ network: NETWORK });
  for (const u of picked) {
    // For segwit inputs we only need the coin's script and value, not the whole previous transaction.
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: myScript, value: BigInt(u.value) } });
  }
  psbt.addOutput({ address: to, value: amount });

  // Whatever you don't send back to yourself goes to miners as the fee. Always add change.
  let change = total - amount - fee;
  if (change >= DUST_SATS) {
    psbt.addOutput({ address, value: change });
  } else {
    fee += change; // too small to keep, so it joins the fee
    change = 0n;
  }

  psbt.signAllInputs(key);
  const valid = psbt.validateSignaturesOfAllInputs((pubkey, hash, sig) => ECPair.fromPublicKey(pubkey).verify(hash, sig));
  if (!valid) throw new Error("Signature check failed; not broadcasting.");
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  console.log(`Sending ${sats(amount)} to ${to}`);
  console.log(`Fee: ${sats(fee)} at ${feeRate} sat/vB · change back to you: ${sats(change)}`);

  if (dryRun) {
    console.log("\n--dry-run: signed but not broadcast.\nRaw transaction:", tx.toHex());
  } else {
    const txid = await broadcast(tx.toHex());
    console.log(`\nBroadcast! ${EXPLORER}/tx/${txid}`);
  }
});
