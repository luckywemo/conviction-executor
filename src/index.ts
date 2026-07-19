import express from "express";
import path from "path";
import { config, assertProductionConfig } from "./config";
import { info, quote, execute } from "./routes";

async function buildApp(): Promise<express.Express> {
  const app = express();
  app.use(express.json());

  // ---- Free endpoints (HTTP 200, no payment) ----
  app.use(express.static(path.join(__dirname, "..", "public")));
  app.get("/info", info);
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/quote", quote);

  // ---- Paid endpoint (x402 on X Layer) ----
  if (config.payments.enabled) {
    const { paymentMiddleware, x402ResourceServer } = await import("@okxweb3/x402-express");
    const { ExactEvmScheme } = await import("@okxweb3/x402-evm/exact/server");
    const { OKXFacilitatorClient } = await import("@okxweb3/x402-core");

    const facilitatorClient = new OKXFacilitatorClient({
      apiKey: config.payments.okxApiKey,
      secretKey: config.payments.okxSecretKey,
      passphrase: config.payments.okxPassphrase,
    });
    const resourceServer = new x402ResourceServer(facilitatorClient);
    resourceServer.register(config.payments.network, new ExactEvmScheme());

    app.use(
      paymentMiddleware(
        {
          "POST /execute": {
            accepts: [
              {
                scheme: "exact",
                network: config.payments.network,
                payTo: config.payments.payTo,
                price: config.payments.executePrice,
              },
            ],
            description:
              "Execute a prediction-market position: buys the requested YES/NO outcome on Polymarket " +
              "as a fill-or-kill order at or below your max price, with per-order and daily spend caps.",
            mimeType: "application/json",
          },
        },
        resourceServer
      )
    );
  } else {
    console.warn("[WARN] PAYMENTS_ENABLED=false — /execute is FREE. Do not deploy like this.");
  }

  app.post("/execute", execute);
  return app;
}

async function main(): Promise<void> {
  const problems = assertProductionConfig();
  for (const p of problems) console.warn(`[CONFIG] ${p}`);

  const app = await buildApp();
  app.listen(config.port, () => {
    console.log(`Conviction Executor ASP listening on http://localhost:${config.port}`);
    console.log(`  free : GET  /info, GET /quote?market=...`);
    console.log(`  paid : POST /execute (${config.payments.enabled ? config.payments.executePrice + " x402" : "payments disabled"})`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
