# @ordercore/mcp

Zero-config MCP server for [OrderCore](https://ordercore.ai) — give an AI agent a
commerce **catalog + idempotent checkout**. No signup required to try it.

```bash
# Zero-config: runs a READ-ONLY sandbox on the demo catalog (no API key)
npx @ordercore/mcp

# Full read/write (checkout enabled)
ORDERCORE_API_KEY=oc_live_xxx npx @ordercore/mcp   # key: https://ordercore.ai/bootstrap
```

Register with Claude Code:

```bash
claude mcp add ordercore -- npx -y @ordercore/mcp                       # sandbox
claude mcp add ordercore --env ORDERCORE_API_KEY=oc_live_xxx -- npx -y @ordercore/mcp
```

Or Claude Desktop / Cursor:

```json
{ "mcpServers": { "ordercore": { "command": "npx", "args": ["-y", "@ordercore/mcp"] } } }
```

## How it works

On first run this launcher fetches the native `ordercore-mcp` binary for your
platform from <https://ordercore.ai/downloads>, verifies its published SHA-256,
caches it under `~/.cache/ordercore-mcp/`, and runs it over the MCP stdio
transport. No build step, no runtime dependencies.

## Tools

Read: `search_products`, `get_product`, `get_prices`, `get_inventory`,
`get_order_trace`. Checkout (needs a full key): `create_checkout_session`,
`update_checkout_session`, `complete_checkout_session`. In sandbox mode the
write tools are hidden until you set `ORDERCORE_API_KEY`.

## Environment

- `ORDERCORE_API_KEY` — optional; omit for the read-only sandbox, set a full key
  from <https://ordercore.ai/bootstrap> for checkout.
- `ORDERCORE_BASE_URL` — optional; defaults to `https://api.ordercore.ai`.

MIT licensed.
