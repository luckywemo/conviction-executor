import { Wallet } from "@ethersproject/wallet";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { config } from "../config";

export interface ExecutionRequest {
  /** CLOB token id of the outcome to buy (YES or NO token). */
  tokenId: string;
  /** USDC amount to spend. */
  amountUsdc: number;
  /** Worst acceptable price per share (0-1). Order is rejected above this. */
  maxPrice: number;
}

export interface ExecutionResult {
  dryRun: boolean;
  orderId: string | null;
  status: string;
  tokenId: string;
  spentUsdc: number;
  limitPrice: number;
  transactionHashes: string[];
}

let client: ClobClient | null = null;

async function getClient(): Promise<ClobClient> {
  if (client) return client;
  const { privateKey, clobApiUrl, chainId, funderAddress, signatureType } = config.polymarket;
  if (!privateKey) throw new Error("POLYMARKET_PRIVATE_KEY not configured");

  const signer = new Wallet(privateKey);
  // L1 auth client used once to derive an API key, then full L2 client
  const bootstrap = new ClobClient(clobApiUrl, chainId, signer);
  const creds = await bootstrap.createOrDeriveApiKey();
  client = new ClobClient(
    clobApiUrl,
    chainId,
    signer,
    creds,
    signatureType as 0 | 1 | 2,
    funderAddress || undefined
  );
  return client;
}

/** Fetch current best ask for a token from the CLOB midpoint/price API. */
export async function getBestAsk(tokenId: string): Promise<number> {
  const url = `${config.polymarket.clobApiUrl}/price?token_id=${encodeURIComponent(tokenId)}&side=buy`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CLOB price lookup failed: HTTP ${res.status}`);
  const data = (await res.json()) as { price?: string };
  const price = Number(data.price);
  if (!price || Number.isNaN(price)) throw new Error("CLOB returned no price for token");
  return price;
}

/**
 * Execute a market buy as a Fill-or-Kill limit order at maxPrice.
 * FOK guarantees: either fully filled at <= maxPrice, or nothing happens.
 */
export async function executeBuy(req: ExecutionRequest): Promise<ExecutionResult> {
  if (!config.polymarket.privateKey) {
    // Dry-run mode: validate inputs and report what would happen.
    const ask = await getBestAsk(req.tokenId);
    return {
      dryRun: true,
      orderId: null,
      status: ask <= req.maxPrice ? "would_fill" : "would_reject_price_above_max",
      tokenId: req.tokenId,
      spentUsdc: req.amountUsdc,
      limitPrice: req.maxPrice,
      transactionHashes: [],
    };
  }

  const clob = await getClient();
  const order = await clob.createMarketOrder({
    tokenID: req.tokenId,
    side: Side.BUY,
    amount: req.amountUsdc,
    price: req.maxPrice,
    orderType: OrderType.FOK,
  });
  const resp = await clob.postOrder(order, OrderType.FOK);

  return {
    dryRun: false,
    orderId: resp.orderID ?? null,
    status: resp.status ?? (resp.success ? "matched" : "failed"),
    tokenId: req.tokenId,
    spentUsdc: req.amountUsdc,
    limitPrice: req.maxPrice,
    transactionHashes: resp.transactionsHashes ?? [],
  };
}
