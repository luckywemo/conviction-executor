import { Request, Response } from "express";
import { z } from "zod";
import { getMarket, searchMarkets } from "./polymarket/gamma";
import { executeBuy, getBestAsk } from "./polymarket/executor";
import { checkOrder, getDailySpend, recordSpend } from "./safety";
import { config } from "./config";

// ---------- FREE: service info / discovery ----------

export function info(_req: Request, res: Response): void {
  res.json({
    name: "Conviction Executor",
    tagline: "Turns research and conviction into a filled prediction-market position.",
    description:
      "A2MCP Agent Service Provider for OKX.AI. Agents research mispriced odds; this service executes: " +
      "quote a market for free, then buy the YES/NO outcome with strict price and spend guards. " +
      "Orders are Fill-or-Kill: fully filled at or below your max price, or nothing happens.",
    endpoints: {
      "GET /info": "free — this document",
      "GET /quote?market=<slug|conditionId|search text>": "free — market lookup with live odds and cost preview",
      "POST /execute": `paid (${config.payments.executePrice} via x402 on X Layer) — execute a YES/NO buy`,
    },
    executeSchema: {
      market: "string — market slug or conditionId",
      outcome: "string — outcome to buy, e.g. 'Yes' or 'No'",
      amountUsdc: "number — USDC to spend",
      maxPrice: "number — worst acceptable price per share (0-1)",
    },
    safety: {
      perOrderCapUsdc: config.safety.maxOrderUsdc,
      dailyCapUsdc: config.safety.maxDailyUsdc,
      spentTodayUsdc: getDailySpend().totalUsdc,
      orderType: "FOK (fill-or-kill) at your maxPrice limit",
    },
  });
}

// ---------- FREE: quote ----------

export async function quote(req: Request, res: Response): Promise<void> {
  const query = String(req.query.market ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "missing ?market= (slug, conditionId, or search text)" });
    return;
  }

  try {
    let market = await getMarket(query);
    let alternatives: Awaited<ReturnType<typeof searchMarkets>> = [];
    if (!market) {
      alternatives = await searchMarkets(query, 5);
      market = alternatives[0] ?? null;
    }
    if (!market) {
      res.status(404).json({ error: `no active market found for '${query}'` });
      return;
    }

    const outcomes = market.outcomes.map((name, i) => ({
      outcome: name,
      price: market!.outcomePrices[i] ?? null,
      impliedProbability:
        market!.outcomePrices[i] != null ? `${(market!.outcomePrices[i] * 100).toFixed(1)}%` : null,
      tokenId: market!.clobTokenIds[i] ?? null,
    }));

    res.json({
      market: {
        question: market.question,
        slug: market.slug,
        conditionId: market.conditionId,
        endDate: market.endDate,
        liquidity: market.liquidity,
        volume24hr: market.volume24hr,
      },
      outcomes,
      execution: {
        endpoint: "POST /execute",
        price: config.payments.executePrice,
        example: {
          market: market.slug,
          outcome: outcomes[0]?.outcome ?? "Yes",
          amountUsdc: 10,
          maxPrice: outcomes[0]?.price != null ? Math.min(0.99, +(outcomes[0].price + 0.02).toFixed(2)) : 0.5,
        },
      },
      otherMatches: alternatives.slice(1).map((m) => ({ question: m.question, slug: m.slug })),
    });
  } catch (err) {
    res.status(502).json({ error: `market data unavailable: ${(err as Error).message}` });
  }
}

// ---------- PAID: execute ----------

const executeSchema = z.object({
  market: z.string().min(1),
  outcome: z.string().min(1),
  amountUsdc: z.number().positive(),
  maxPrice: z.number().gt(0).lt(1),
});

export async function execute(req: Request, res: Response): Promise<void> {
  const parsed = executeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid request body", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { market: marketQuery, outcome, amountUsdc, maxPrice } = parsed.data;

  const guard = checkOrder(amountUsdc, maxPrice);
  if (!guard.ok) {
    res.status(422).json({ error: `safety check failed: ${guard.reason}` });
    return;
  }

  try {
    const market = await getMarket(marketQuery);
    if (!market) {
      res.status(404).json({ error: `no active market found for '${marketQuery}'` });
      return;
    }
    if (market.closed || !market.active) {
      res.status(422).json({ error: "market is closed or inactive" });
      return;
    }

    const idx = market.outcomes.findIndex((o) => o.toLowerCase() === outcome.toLowerCase());
    if (idx === -1) {
      res.status(422).json({
        error: `outcome '${outcome}' not found`,
        availableOutcomes: market.outcomes,
      });
      return;
    }
    const tokenId = market.clobTokenIds[idx];
    if (!tokenId) {
      res.status(422).json({ error: "market has no tradeable CLOB token for that outcome" });
      return;
    }

    const bestAsk = await getBestAsk(tokenId);
    if (bestAsk > maxPrice) {
      res.status(422).json({
        error: "current ask exceeds maxPrice, order not placed",
        bestAsk,
        maxPrice,
      });
      return;
    }

    const result = await executeBuy({ tokenId, amountUsdc, maxPrice });
    if (!result.dryRun && (result.status === "matched" || result.status === "live")) {
      recordSpend(amountUsdc);
    }

    res.json({
      market: { question: market.question, slug: market.slug },
      outcome: market.outcomes[idx],
      bestAskAtExecution: bestAsk,
      result,
      dailySpend: getDailySpend(),
    });
  } catch (err) {
    res.status(502).json({ error: `execution failed: ${(err as Error).message}` });
  }
}
