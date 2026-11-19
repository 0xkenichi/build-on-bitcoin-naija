// Loaded only when a buyer chooses "Pay with Nostr Wallet Connect".
// Keeps the main checkout small for slow networks.
import { NWCClient } from "@getalby/sdk/nwc";

export async function payWithNwc(connectionUrl: string, bolt11: string): Promise<string> {
  const client = new NWCClient({ nostrWalletConnectUrl: connectionUrl });
  try {
    const r = await client.payInvoice({ invoice: bolt11 });
    return r.preimage;
  } finally {
    client.close();
  }
}
