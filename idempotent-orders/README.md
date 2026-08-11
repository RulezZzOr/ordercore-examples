# OrderCore Idempotency-Key Demo (`POST /v1/orders`)

The **other** idempotency model in OrderCore. The [agent-commerce demo](../agent-commerce-demo/)
shows session-scoped checkout idempotency; this one shows the **idempotency key** on direct
order creation — the model you use when your agent (or backend) calls `POST /v1/orders`.

It proves three behaviors an autonomous agent depends on:

| Call | Result |
| --- | --- |
| new `Idempotency-Key` + payload | `201 Created` — order created |
| same key + **same** payload (a retry) | `200 OK` — the **same** order, replayed |
| same key + **different** payload | `409 Conflict` — never a silent duplicate |

## Run it (no key, no signup, offline)

Node 18+ (built-in `fetch`), no dependencies.

```bash
node run.mjs          # mock mode: offline, no key
node run.mjs --help   # options and env vars
```

Expected output (mock mode):

```
▸ 1) new key + payload         -> HTTP 201  order ord_demo-order-key-001
▸ 2) same key + same payload    -> HTTP 200  order ord_demo-order-key-001
▸ 3) same key + DIFFERENT payload -> HTTP 409  conflict
✅ Idempotency held: retry returned the SAME order; a different payload on the same key was rejected (409).
```

Exit code `0` = all three behaviors held.

## Run it live

Get an API key at https://ordercore.ai/bootstrap (3-day trial). Live mode needs a real
customer ID and SKU UUID from your tenant:

```bash
ORDERCORE_API_KEY=oc_live_xxx \
ORDERCORE_CUSTOMER_ID=<customer-uuid> \
ORDERCORE_SKU_ID=<sku-uuid> \
node run.mjs
```

Live mode sends `POST /v1/orders` with an `Idempotency-Key` header and body
`{ "customer_id": ..., "items": [{ "sku_id": ..., "quantity": 1 }] }`.

## How it maps to the API

- Header: `Idempotency-Key: <your-key>` (or `idempotency_key` in the body).
- Same key + same request → the stored order is returned. The replay is signaled purely
  by the HTTP status (`201 Created` on first create vs `200 OK` on replay); the response
  body is the same top-level order object (`id`, `status`, `created_at`, `order_number`) —
  there is no `created` / `idempotent_replay` flag and no `order` wrapper.
- Same key + different request → `409 Conflict`.

Learn more: [idempotent orders for AI agents](https://ordercore.ai/idempotent-orders-for-ai-agents).
