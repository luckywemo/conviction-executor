# Conviction Executor — OKX.AI ASP (A2MCP)

**Turns research and conviction into a filled prediction-market position.**

OKX.AI already has agents surfacing mispriced odds. What was missing was execution — an ASP that
turns a research signal into an actual YES/NO buy without a manual hop to the market. This is that ASP.

Built for the OKX AI Genesis Hackathon. Payments settle per-call via **x402 on X Layer** (`eip155:196`).

## Endpoints

| Endpoint | Type | Description |
|---|---|---|
| `GET /info` | free | Service description, schema, live safety limits |
| `GET /quote?market=<slug\|conditionId\|text>` | free | Market lookup with live odds, implied probability, and a ready-to-send execute example |
| `POST /execute` | **paid (x402)** | Buys the requested outcome as a fill-or-kill order at or below `maxPrice` |

### `POST /execute` body

```json
{
  "market": "will-x-happen-by-2027",
  "outcome": "Yes",
  "amountUsdc": 10,
  "maxPrice": 0.45
}
```

## Safety Rails
- **Fill-or-Kill** orders only: fully filled at or below `maxPrice`, or nothing happens.
- **Pre-trade ask check**: rejects before payment of gas/fees if the live ask exceeds `maxPrice`.
- **Per-order cap** (`MAX_ORDER_USDC`) and **daily cap** (`MAX_DAILY_USDC`).
- **Dry-run mode**: without `POLYMARKET_PRIVATE_KEY`, `/execute` validates and simulates instead of trading.

## Setup

```bash
npm install
cp .env.example .env   # fill in credentials
npm run dev            # local dev
npm run build && npm start
```

### Required credentials (`.env`)
- **OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE** — for the x402 facilitator (OKX Payment SDK)
- **PAY_TO_ADDRESS** — your X Layer wallet receiving USDT0 payments
- **POLYMARKET_PRIVATE_KEY** — Polygon wallet holding USDC that executes trades

## Compliance self-check (before ASP listing)

```bash
# free endpoint -> expect HTTP 200
curl -i "https://<domain>/quote?market=bitcoin"

# paid endpoint without payment header -> expect HTTP 402 + PAYMENT-REQUIRED
curl -i -X POST "https://<domain>/execute"
```

## Architecture

```
Agent (buyer) ──x402 payment (X Layer)──> POST /execute
                                            │ 1. resolve market (Polymarket Gamma API)
                                            │ 2. safety checks (caps, price guard)
                                            │ 3. live ask check (CLOB price API)
                                            │ 4. FOK buy (Polymarket CLOB)
                                            └─> receipt: order id, fill status, tx hashes
```
