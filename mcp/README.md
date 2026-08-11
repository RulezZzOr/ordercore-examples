# OrderCore MCP server — setup

`ordercore-mcp` is a single static binary that exposes 9 commerce tools to any
MCP client: `search_products`, `get_product`, `get_prices`, `get_inventory`,
`get_order_history`, `create_checkout_session`, `update_checkout_session`,
`create_payment_intent`, `complete_checkout_session`.

## 1. Download

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon) | https://ordercore.ai/downloads/ordercore-mcp-darwin-arm64.zip |
| macOS (Intel) | https://ordercore.ai/downloads/ordercore-mcp-darwin-amd64.zip |
| Linux (x86_64) | https://ordercore.ai/downloads/ordercore-mcp-linux-amd64.zip |
| Windows (x86_64) | https://ordercore.ai/downloads/ordercore-mcp-windows-amd64.zip |

SHA256: append `.sha256` to any URL. Unzip and (macOS/Linux) `chmod +x ordercore-mcp`.

## 2. Get an API key (optional)

**Zero-config:** you can skip this. If you register the server **without** an API
key, it auto-issues a **read-only sandbox key** on the demo catalog at startup, so
your agent can immediately `search_products` / `get_product` / `get_prices` /
`get_inventory` / `get_order_trace`. Checkout (write) tools are hidden until you
provide a full key.

For real, retry-safe orders, get a full read/write key at
https://ordercore.ai/bootstrap — two fields, no payment required.

## 3. Register with your client

**Claude Code**

```bash
# Zero-config read-only sandbox (no key):
claude mcp add ordercore -- /path/to/ordercore-mcp

# Full read/write (checkout enabled):
claude mcp add ordercore --env ORDERCORE_API_KEY=oc_live_xxx -- /path/to/ordercore-mcp
```

**Claude Desktop** (`claude_desktop_config.json`) / **Cursor** (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "ordercore": {
      "command": "/path/to/ordercore-mcp",
      "env": { "ORDERCORE_API_KEY": "oc_live_xxx" }
    }
  }
}
```

## 4. Try it

Ask your agent: *"Search the OrderCore catalog and place a test order for the
first product you find."* The checkout flow is idempotent — the agent can retry
`complete_checkout_session` safely and will get the same order back.

Optional env: `ORDERCORE_BASE_URL` (defaults to `https://api.ordercore.ai`).
