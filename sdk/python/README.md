# ordercore

Stdlib-only Python client for [OrderCore](https://ordercore.ai) — the commerce
API for AI agents. Catalog, checkout sessions, and **idempotent orders**: agent
retries never double-charge.

> **Not on PyPI yet.** `pip install ordercore` does **not** work today.
> Until the release lands, vendor the client directly — it is a single
> stdlib-only module with zero dependencies (Python 3.8+):

```bash
# from the repo root
cp -r sdk/python/ordercore /path/to/your/project/
```

### Try it with no signup

`OrderCore.sandbox()` issues a fresh **read-only** key on the demo tenant and
returns a ready client — no signup, no key of your own:

```python
from ordercore import OrderCore

oc = OrderCore.sandbox()             # read-only demo key, issued for you
products = oc.products.list()        # live demo catalog
print(len(products["data"]), "products")
```

The sandbox key is read-only (writes return `403`), strictly rate limited, and
short lived. For a full read/write key: <https://ordercore.ai/bootstrap>.

### With your own key

```python
from ordercore import OrderCore

oc = OrderCore(api_key="oc_live_...")

# Seed a demo catalog (idempotent), then create a retry-safe order.
seed = oc.onboarding.demo_data()
order = oc.orders.create(
    {"customer_id": seed["sample_customer_id"],
     "items": [{"sku_id": seed["sample_order_item"]["sku_id"], "quantity": 1}]},
    idempotency_key="first-order-001",
)
print(order["id"], order["status"])
```

## Why this client is agent-safe

- `orders.create` / `confirm` / `cancel` **always** send an `Idempotency-Key`
  (auto-generated if you don't pass one). Replaying a key returns the original
  order; the same key with a different payload raises `OrderCoreError` with
  `status=409` and `error: "conflict"` in the body (the raised error's `.code`
  is populated from that `error` field) instead of double-ordering.
- GETs and idempotency-keyed writes retry on 408/429/5xx and network errors
  with exponential backoff. Un-keyed writes are never retried.

## Surface

`account.{auth,status,usage,readiness}` · `products.{list,get,create,update,delete}` ·
`skus.get` · `inventory.{list,adjust,reserve,release}` · `prices.list` ·
`orders.{create,list,get,confirm,cancel}` · `onboarding.demo_data` ·
`webhooks.{list_endpoints,create_endpoint,delete_endpoint}` ·
`checkout.{create_session,update_session,complete_session}` ·
`request(method, path, ...)` for anything else.

## Links

- Get an API key (2 fields, no payment): https://ordercore.ai/bootstrap
- Full API guide: https://ordercore.ai/docs.md · OpenAPI: https://ordercore.ai/openapi.yaml
- MCP server (same tools for Claude/Cursor): https://ordercore.ai/what-is-an-mcp-commerce-server

MIT © Cloudpeakify s.r.o.
