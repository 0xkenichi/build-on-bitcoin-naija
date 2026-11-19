// Read the payment hash straight out of a BOLT11 invoice, with no library.
// Why: the buyer's wallet pays the *invoice*, so the hash inside the invoice
// is the one that matters, not a hash some server tells you.
//
// A BOLT11 invoice is bech32 text: "lnbc" + amount, then "1", then 5-bit
// words. After a 35-bit timestamp come tagged fields: tag (5 bits), length
// (10 bits) and data. Tag "p" (value 1) holds the 256-bit payment hash.
// The last 104 words are the signature and the last 6 a checksum.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk;
}

/** Returns the invoice's payment hash as hex. Throws if the text isn't a valid invoice. */
export function paymentHashFromBolt11(invoice: string): string {
  const s = invoice.trim().toLowerCase().replace(/^lightning:/, "");
  const sep = s.lastIndexOf("1");
  if (!s.startsWith("ln") || sep < 3 || s.length - sep < 8) throw new Error("not a BOLT11 invoice");
  const hrp = s.slice(0, sep);
  const words = [...s.slice(sep + 1)].map((c) => {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error("bad character in invoice");
    return v;
  });
  // Checksum: catches typos and truncated copy-pastes.
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (polymod([...hrpExpand, ...words]) !== 1) throw new Error("invoice checksum failed");

  const data = words.slice(0, -6 - 104); // drop checksum and signature
  let i = 7; // skip the timestamp
  while (i + 3 <= data.length) {
    const tag = data[i];
    const len = (data[i + 1] << 5) | data[i + 2];
    const field = data.slice(i + 3, i + 3 + len);
    if (tag === 1 && len === 52) {
      // 52 words x 5 bits = 260 bits; the hash is the first 256.
      let bits = "";
      for (const w of field) bits += w.toString(2).padStart(5, "0");
      return bits.slice(0, 256).match(/.{8}/g)!.map((b) => parseInt(b, 2).toString(16).padStart(2, "0")).join("");
    }
    i += 3 + len;
  }
  throw new Error("invoice has no payment hash");
}

/** Test helper: build a bech32 string shaped like a BOLT11 invoice (timestamp,
 *  "p" field, dummy signature, valid checksum). NOT payable: the signature is zeros. */
export function fakeBolt11(paymentHashHex: string, hrp = "lntbs"): string {
  const bits = [...paymentHashHex.match(/../g)!].map((b) => parseInt(b, 16).toString(2).padStart(8, "0")).join("") + "0000";
  const hashWords = bits.match(/.{5}/g)!.map((b) => parseInt(b, 2)); // 52 words
  const ts = Math.floor(Date.now() / 1000);
  const tsWords = Array.from({ length: 7 }, (_, i) => (ts >>> (5 * (6 - i))) & 31);
  const data = [...tsWords, 1, 52 >> 5, 52 & 31, ...hashWords, ...new Array(104).fill(0)];
  const hrpExpand = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod([...hrpExpand, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + "1" + [...data, ...checksum].map((v) => CHARSET[v]).join("");
}
