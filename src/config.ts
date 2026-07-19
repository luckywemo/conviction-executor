import "dotenv/config";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Invalid number for env ${name}: ${v}`);
  return n;
}

export const config = {
  port: num("PORT", 4000),

  payments: {
    enabled: (process.env.PAYMENTS_ENABLED ?? "true").toLowerCase() !== "false",
    okxApiKey: process.env.OKX_API_KEY ?? "",
    okxSecretKey: process.env.OKX_SECRET_KEY ?? "",
    okxPassphrase: process.env.OKX_PASSPHRASE ?? "",
    payTo: process.env.PAY_TO_ADDRESS ?? "",
    executePrice: process.env.EXECUTE_PRICE_USD ?? "$0.50",
    network: "eip155:196" as const, // X Layer
  },

  polymarket: {
    privateKey: process.env.POLYMARKET_PRIVATE_KEY ?? "",
    clobApiUrl: process.env.CLOB_API_URL ?? "https://clob.polymarket.com",
    gammaApiUrl: "https://gamma-api.polymarket.com",
    chainId: num("CHAIN_ID", 137),
    funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? "",
    signatureType: num("POLYMARKET_SIGNATURE_TYPE", 0),
  },

  safety: {
    maxOrderUsdc: num("MAX_ORDER_USDC", 100),
    maxDailyUsdc: num("MAX_DAILY_USDC", 500),
  },
};

export function assertProductionConfig(): string[] {
  const problems: string[] = [];
  if (config.payments.enabled) {
    if (!config.payments.okxApiKey) problems.push("OKX_API_KEY is not set");
    if (!config.payments.okxSecretKey) problems.push("OKX_SECRET_KEY is not set");
    if (!config.payments.okxPassphrase) problems.push("OKX_PASSPHRASE is not set");
    if (!config.payments.payTo) problems.push("PAY_TO_ADDRESS is not set");
  }
  if (!config.polymarket.privateKey) {
    problems.push("POLYMARKET_PRIVATE_KEY is not set (execution endpoint will run in dry-run mode)");
  }
  return problems;
}
