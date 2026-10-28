// Offline check that keys, addresses and signing work, using a made-up coin. Nothing touches the network.
import assert from "node:assert/strict";
import { Psbt, Transaction, address as btcAddress } from "bitcoinjs-lib";
import { ECPair, NETWORK, addressFor, estimateVbytes } from "./lib.js";

const alice = ECPair.makeRandom({ network: NETWORK });
const bob = ECPair.makeRandom({ network: NETWORK });
const aliceAddr = addressFor(alice);
const bobAddr = addressFor(bob);
assert.match(aliceAddr, /^tb1q[0-9a-z]{38}$/, "signet P2WPKH addresses start with tb1q");

// WIF round trip: the saved text form of a key gives back the same address.
assert.equal(addressFor(ECPair.fromWIF(alice.toWIF(), NETWORK)), aliceAddr);

// Pretend Alice received 50,000 sats in some earlier transaction.
const fakeTxid = "aa".repeat(32);
const coin = 50_000n;
const send = 20_000n;
const fee = BigInt(estimateVbytes(1, 2) * 2);
const change = coin - send - fee;

const psbt = new Psbt({ network: NETWORK });
psbt.addInput({
  hash: fakeTxid,
  index: 0,
  witnessUtxo: { script: btcAddress.toOutputScript(aliceAddr, NETWORK), value: coin },
});
psbt.addOutput({ address: bobAddr, value: send });
psbt.addOutput({ address: aliceAddr, value: change });
psbt.signAllInputs(alice);
assert.ok(psbt.validateSignaturesOfAllInputs((p, h, s) => ECPair.fromPublicKey(p).verify(h, s)));

// Bob's key can't sign for Alice's coin.
const wrong = Psbt.fromBase64(psbt.toBase64());
assert.throws(() => wrong.signInput(0, bob), "signing someone else's coin must fail");

psbt.finalizeAllInputs();
const tx: Transaction = psbt.extractTransaction();
assert.equal(tx.ins.length, 1);
assert.equal(tx.outs.length, 2);
assert.equal(tx.outs[0].value + tx.outs[1].value + fee, coin, "inputs = outputs + fee");
assert.ok(tx.virtualSize() <= estimateVbytes(1, 2) + 1, "fee estimate covers the real size");

console.log("selftest passed");
console.log(`  address:  ${aliceAddr}`);
console.log(`  tx size:  ${tx.virtualSize()} vbytes, fee ${fee} sats, txid ${tx.getId()}`);
