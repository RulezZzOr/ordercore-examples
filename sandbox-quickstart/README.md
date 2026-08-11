# sandbox-quickstart

Your **first real, authenticated OrderCore API call** — no signup, no key of your own.

In `--live` mode this issues a fresh **read-only** sandbox key from
`POST /bootstrap/sandbox-key`, then reads the live demo catalog with it against
`https://api.ordercore.ai`. Offline (the default) it walks the identical flow
against a local mock, so the example always runs with no network and no key.

```bash
# Node 18+
node run.mjs           # offline mock (no network, no key)
node run.mjs --live     # LIVE: real read-only key + live catalog read
node run.mjs --help
```

## What it does

1. `POST /bootstrap/sandbox-key` → a short-lived, **read-only** key (`scopes: ["read"]`)
   on the demo tenant. The key is returned in the response — no email round-trip.
2. `GET /v1/products` with `X-API-Key: <that key>` → the demo catalog.

Exit code `0` means a key was issued and the catalog read returned products.

## The one-liner, if you prefer curl

```bash
KEY=$(curl -s -X POST https://api.ordercore.ai/bootstrap/sandbox-key \
  -H 'Content-Type: application/json' -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["api_key"])')
curl -s -H "X-API-Key: $KEY" https://api.ordercore.ai/v1/products
```

## Notes

- The sandbox key is **read-only**. Write calls (e.g. `POST /v1/orders`) return `403`.
- It is **strictly rate limited** — issuing a key and making a read is the point;
  rapid repeated reads may see `429`. Wait a moment and retry.
- The key **expires** (short TTL). For a full **read/write** key, request one at
  <https://ordercore.ai/bootstrap> — email-verified, scoped, and auditable.
