// Naira <-> sats. Live rate from free public APIs, a short cache, a sanity
// check, and a last-resort fallback so checkout never breaks because a rate
// API is down on a bad network day.

export interface Rate {
  nairaPerBtc: number;
  source: string;
  fetchedAt: number; // unix ms
  stale: boolean; // true when we're using an old or fallback number
}

type Source = { name: string; fetch: (f: typeof fetch) => Promise<number> };

export const SOURCES: Source[] = [
  {
    name: "coingecko",
    fetch: async (f) => {
      const r = await f("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=ngn", {
        signal: AbortSignal.timeout(4000),
      });
      const j = (await r.json()) as { bitcoin?: { ngn?: number } };
      return Number(j.bitcoin?.ngn);
    },
  },
  {
    name: "yadio",
    fetch: async (f) => {
      const r = await f("https://api.yadio.io/convert/1/BTC/NGN", { signal: AbortSignal.timeout(4000) });
      const j = (await r.json()) as { result?: number };
      return Number(j.result);
    },
  },
];

const SANE_MIN = 1_000_000; // ₦1m per BTC: far below any real rate
const SANE_MAX = 10_000_000_000; // ₦10bn per BTC: far above
const MAX_JUMP = 0.25; // reject a new rate that moves >25% from the last good one

export class RateService {
  private last?: Rate;

  constructor(
    private opts: {
      ttlMs?: number;
      fallback: { nairaPerBtc: number; asOf: string };
      sources?: Source[];
      fetchImpl?: typeof fetch;
    },
  ) {}

  async get(): Promise<Rate> {
    const ttl = this.opts.ttlMs ?? 60_000;
    if (this.last && !this.last.stale && Date.now() - this.last.fetchedAt < ttl) return this.last;

    for (const src of this.opts.sources ?? SOURCES) {
      try {
        const n = await src.fetch(this.opts.fetchImpl ?? fetch);
        if (!Number.isFinite(n) || n < SANE_MIN || n > SANE_MAX) continue;
        if (this.last && !this.last.stale && Math.abs(n - this.last.nairaPerBtc) / this.last.nairaPerBtc > MAX_JUMP) continue;
        this.last = { nairaPerBtc: n, source: src.name, fetchedAt: Date.now(), stale: false };
        return this.last;
      } catch {
        // try the next source
      }
    }
    // Every source failed: reuse the last good rate, else the shipped fallback.
    if (this.last) return { ...this.last, stale: true };
    return {
      nairaPerBtc: this.opts.fallback.nairaPerBtc,
      source: `fallback (${this.opts.fallback.asOf})`,
      fetchedAt: Date.now(),
      stale: true,
    };
  }
}

/** Naira to sats, always rounded UP so the shop is never short. */
export function nairaToSats(naira: number, nairaPerBtc: number): number {
  if (!Number.isFinite(naira) || naira <= 0) throw new Error("amount must be positive");
  return Math.ceil((naira / nairaPerBtc) * 100_000_000);
}

export function formatNaira(n: number): string {
  return "₦" + Math.round(n).toLocaleString("en-NG");
}
