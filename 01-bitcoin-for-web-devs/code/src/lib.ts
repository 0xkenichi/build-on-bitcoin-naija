// Shared setup for module 1: signet network, key handling, and the mempool.space signet API.
import * as ecc from "@bitcoinerlab/secp256k1";
import { initEccLib, networks, payments } from "bitcoinjs-lib";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

initEccLib(ecc);
export const ECPair = ECPairFactory(ecc);

// Signet uses the same address format and key prefixes as testnet (addresses start with tb1).
export const NETWORK = networks.testnet;
export const API = "https://mempool.space/signet/api";
export const EXPLORER = "https://mempool.space/signet";
export const WALLET_FILE = "wallet.signet.json";

// Below this, a P2WPKH output costs more to spend than it's worth, and nodes won't relay it.
export const DUST_SATS = 294n;

export type Wallet = { wif: string; address: string };

export function addressFor(key: ECPairInterface): string {
  const { address } = payments.p2wpkh({ pubkey: key.publicKey, network: NETWORK });
  if (!address) throw new Error("Could not derive an address from this key");
  return address;
}

export function loadWallet(): { key: ECPairInterface; address: string } {
  if (!existsSync(WALLET_FILE)) {
    throw new Error(`No ${WALLET_FILE} yet. Run: npm run new-wallet`);
  }
  const saved: Wallet = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
  const key = ECPair.fromWIF(saved.wif, NETWORK);
  return { key, address: addressFor(key) };
}

export function saveWallet(wallet: Wallet): void {
  writeFileSync(WALLET_FILE, JSON.stringify(wallet, null, 2) + "\n", { mode: 0o600 });
}

export type Utxo = {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
};

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${res.status} from ${API + path}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function getUtxos(address: string): Promise<Utxo[]> {
  return getJson<Utxo[]>(`/address/${address}/utxo`);
}

export async function getFeeRate(): Promise<number> {
  const fees = await getJson<{ halfHourFee: number }>("/v1/fees/recommended");
  return Math.max(1, fees.halfHourFee);
}

export async function broadcast(hex: string): Promise<string> {
  const res = await fetch(API + "/tx", { method: "POST", body: hex });
  const body = await res.text();
  if (!res.ok) throw new Error(`Broadcast failed (${res.status}): ${body}`);
  return body.trim();
}

// Rough virtual size of a transaction that spends P2WPKH inputs: header + inputs + outputs.
export function estimateVbytes(inputs: number, outputs: number): number {
  return Math.ceil(10.5 + inputs * 68 + outputs * 31);
}

export const sats = (n: bigint | number) => `${n.toLocaleString("en-US")} sats`;

// Run a script and print a plain error message instead of a stack trace.
export function run(main: () => Promise<void> | void): void {
  Promise.resolve()
    .then(main)
    .catch((err: unknown) => {
      console.error("Error:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
