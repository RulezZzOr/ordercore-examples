# OrderCore Catalog-Read Demo (the "shop" phase)

Before an AI agent checks out, it **shops**: browse the catalog, look up a product,
check prices and stock. This demo exercises the read tools OrderCore's MCP exposes —
`search_products`, `get_product`, `get_prices`, `get_inventory` — as plain REST GETs.

All read-only: no writes, no orders, no checkout tokens. Pairs with the
[agent-commerce demo](../agent-commerce-demo/) (the checkout phase).

## Run it (no key, no signup, offline)

Node 18+ (built-in `fetch`), no dependencies.

```bash
node run.mjs          # mock mode: offline, no key
node run.mjs --help   # options and env vars
```

Expected output (mock mode) walks four reads:

```
▸ search_products  → GET /v1/products        { "data": [ { "id": "p_demo_1", ... } ], "meta": {} }
▸ get_product      → GET /v1/products/p_demo_1 { "id": "p_demo_1", ... }
▸ get_prices       → GET /v1/prices          { "data": [ { "sku": "WIDGET-1", "amount": 1999 } ], "meta": {} }
▸ get_inventory    → GET /v1/inventory       { "data": [ { "sku": "WIDGET-1", "available": 42 } ], "meta": {} }
✅ Catalog read complete. This is the "shop" phase...
```

The list endpoints (`/v1/products`, `/v1/prices`, `/v1/inventory`) return a
`{ "data": [...], "meta": {...} }` envelope; the array of records is under `data`.
The single-product detail read (`/v1/products/{id}`) returns the record object directly.

Exit code `0` = all four reads returned a payload.

## Run it live

Get an API key at https://ordercore.ai/bootstrap (3-day trial), then:

```bash
ORDERCORE_API_KEY=oc_live_xxx node run.mjs
```

Live mode issues real `GET` requests with `X-API-Key` against `https://api.ordercore.ai`.

## How it maps to the MCP tools

| This demo (REST) | MCP tool | Endpoint |
| --- | --- | --- |
| search products | `search_products` | `GET /v1/products` |
| product detail | `get_product` | `GET /v1/products/{id}` |
| prices | `get_prices` | `GET /v1/prices` |
| stock | `get_inventory` | `GET /v1/inventory` |

Then the agent moves to checkout: `create_checkout_session` → `complete_checkout_session`
(idempotent). See [../agent-commerce-demo](../agent-commerce-demo/) and
[what an MCP commerce server is](https://ordercore.ai/what-is-an-mcp-commerce-server).
