# @ordercore/sdk

Zero-dependency Node.js client for [OrderCore](https://ordercore.ai) — the
commerce API for AI agents. Catalog, checkout sessions, and **idempotent
orders**: agent retries never double-charge.

```bash
npm install @ordercore/sdk   # Node 18+
```

### Try it with no signup

`OrderCore.sandbox()` issues a fresh **read-only** key on the demo tenant and
returns a ready client — no signup, no key of your own:

```js
import OrderCore from '@ordercore/sdk';

const oc = await OrderCore.sandbox();          // read-only demo key, issued for you
const { data } = await oc.products.list();     // live demo catalog
console.log(data.length, 'products');
```

The sandbox key is read-only (writes return `403`), strictly rate limited, and
short lived. For a full read/write key: <https://ordercore.ai/bootstrap>.

### With your own key

```js
import OrderCore from '@ordercore/sdk';

const oc = new OrderCore({ apiKey: process.env.ORDERCORE_API_KEY });

// Seed a demo catalog (idempotent), then create a retry-safe order.
const seed = await oc.onboarding.demoData();
const order = await oc.orders.create(
  { customer_id: seed.sample_customer_id, items: [{ sku_id: seed.sample_order_item.sku_id, quantity: 1 }] },
  { idempotencyKey: 'first-order-001' },
);
console.log(order.id, order.status);
```

## Why this client is agent-safe

- `orders.create` / `confirm` / `cancel` **always** send an `Idempotency-Key`
  (auto-generated if you don't pass one). Replaying a key returns the original
  order; the same key with a different payload throws a `409 OrderCoreError`
  with `error: "conflict"` (the thrown error's `.code` is populated from that
  `error` field) instead of silently double-ordering.
- GETs and idempotency-keyed writes retry on 408/429/5xx and network errors
  with exponential backoff. Un-keyed writes are never retried.

## Surface

`account.{auth,status,usage,readiness}` · `products.{list,get,create,update,delete}` ·
`skus.get` · `inventory.{list,adjust,reserve,release}` · `prices.list` ·
`orders.{create,list,get,confirm,cancel}` · `onboarding.demoData` ·
`webhooks.{listEndpoints,createEndpoint,deleteEndpoint}` ·
`checkout.{createSession,updateSession,completeSession}` ·
`request(method, path, opts)` for anything else.

Errors are `OrderCoreError` with `status`, `code`, `body`, `request`.

## Links

- Get an API key (2 fields, no payment): https://ordercore.ai/bootstrap
- Full API guide: https://ordercore.ai/docs.md · OpenAPI: https://ordercore.ai/openapi.yaml
- MCP server (same tools for Claude/Cursor): https://ordercore.ai/what-is-an-mcp-commerce-server

MIT © Cloudpeakify s.r.o.
