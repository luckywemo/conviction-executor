import { config } from "../config";

export interface MarketSummary {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  active: boolean;
  closed: boolean;
  endDate: string | null;
  liquidity: number;
  volume24hr: number;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
}

interface GammaMarketRaw {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  liquidityNum?: number;
  volume24hr?: number;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
}

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toSummary(m: GammaMarketRaw): MarketSummary {
  return {
    id: m.id,
    question: m.question,
    slug: m.slug,
    conditionId: m.conditionId,
    active: m.active,
    closed: m.closed,
    endDate: m.endDate ?? null,
    liquidity: m.liquidityNum ?? 0,
    volume24hr: m.volume24hr ?? 0,
    outcomes: parseJsonArray(m.outcomes),
    outcomePrices: parseJsonArray(m.outcomePrices).map(Number),
    clobTokenIds: parseJsonArray(m.clobTokenIds),
  };
}

async function gammaGet(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, config.polymarket.gammaApiUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Gamma API ${path} failed: HTTP ${res.status}`);
  }
  return res.json();
}

/** Search active markets by free-text query. */
export async function searchMarkets(query: string, limit = 10): Promise<MarketSummary[]> {
  const data = (await gammaGet("/markets", {
    active: "true",
    closed: "false",
    limit: String(limit),
    order: "volume24hr",
    ascending: "false",
    // Gamma supports a text search param on the public endpoint
    // fall back to client-side filter below in case it is ignored
    _q: query,
  })) as GammaMarketRaw[];

  const markets = data.map(toSummary);
  const q = query.toLowerCase();
  const filtered = markets.filter(
    (m) => m.question.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q)
  );
  return (filtered.length > 0 ? filtered : markets).slice(0, limit);
}

/** Look up a single market by slug or condition id. */
export async function getMarket(idOrSlug: string): Promise<MarketSummary | null> {
  const bySlug = (await gammaGet("/markets", { slug: idOrSlug, limit: "1" })) as GammaMarketRaw[];
  if (bySlug.length > 0) return toSummary(bySlug[0]);

  const byCondition = (await gammaGet("/markets", {
    condition_ids: idOrSlug,
    limit: "1",
  })) as GammaMarketRaw[];
  if (byCondition.length > 0) return toSummary(byCondition[0]);

  return null;
}
