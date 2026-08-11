# Give your AI agent a checkout tool — retries never double-charge

[![examples run offline](https://img.shields.io/badge/examples-run%20offline-22c55e)](#try-it-in-30-seconds)
[![no signup](https://img.shields.io/badge/signup-not%20required-22c55e)](#try-it-in-30-seconds)
[![MCP server](https://img.shields.io/badge/MCP-server-f97316)](https://ordercore.ai/what-is-an-mcp-commerce-server)
[![OpenAPI 3.1](https://img.shields.io/badge/OpenAPI-3.1-38bdf8)](https://ordercore.ai/openapi.yaml)
[![license MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**An agent is a retry machine pointed at your API.** It retries on a timeout, on
a rate limit, when its own loop restarts. If your checkout isn't idempotent,
that retry is a second order and a second charge on a real person's card.

These are runnable examples for [OrderCore](https://ordercore.ai) — the commerce
API and MCP server for AI agents: catalog, prices, inventory, and **idempotent
checkout**. Every one of them deliberately retries the payment call and exits `0`
only if **one** order came back.

## Try it in 30 seconds

No API key. No signup. No dependencies to install.

```bash
git clone https://github.com/RulezZzOr/ordercore-examples.git
cd ordercore-examples/agent-commerce-demo

node run.mjs        # Node 18+
python3 run.py      # or Python 3.8+
```

```
→ complete_checkout_session({"session_id":"cs_sku_espresso"})
  {"order_id":"order_1","status":"confirmed"}
→ complete_checkout_session({"session_id":"cs_sku_espresso"})   ← the retry
  {"order_id":"order_1","status":"confirmed"}                   ← same order

✅ 2 completion calls -> 1 order. Idempotency held.
```

Exit code `0` means the retried checkout returned the **same order, not two**.

## Wire it into your agent in one command

```bash
claude mcp add ordercore --env ORDERCORE_API_KEY=oc_live_xxx -- /path/to/ordercore-mcp
```

Binaries for macOS/Linux/Windows: [ordercore.ai/downloads](https://ordercore.ai/downloads) ·
Claude Desktop / Cursor config: [`mcp/`](mcp/)

## What's here

| Example | What it shows |
| --- | --- |
| [`agent-commerce-demo/`](agent-commerce-demo/) | The core flow: create a checkout session → complete it → retry → same order. Node + Python. |
| [`sandbox-quickstart/`](sandbox-quickstart/) | First **real, authenticated** call with **no signup, no key** — issue a read-only sandbox key from `POST /bootstrap/sandbox-key`, then read the live catalog. Run `node run.mjs --live`. |
| [`catalog-read/`](catalog-read/) | The "shop" phase: `search_products`, `get_product`, `get_prices`, `get_inventory` as plain REST GETs. |
| [`idempotent-orders/`](idempotent-orders/) | `Idempotency-Key` on `POST /v1/orders`: 201 new / 200 replay / 409 conflict. |
| [`claude-checkout-agent/`](claude-checkout-agent/) | **Full Claude agentic loop** — tool_use → execute → tool_result; the agent retries checkout and gets the same order. Offline scripted-model mode or live with `ANTHROPIC_API_KEY`. |
| [`openai-checkout-agent/`](openai-checkout-agent/) | **GPT function-calling loop** over the same tools (raw fetch, zero deps). Offline or live with `OPENAI_API_KEY`. |
| [`langchain-checkout-agent/`](langchain-checkout-agent/) | **LangChain `@tool` functions** + agent loop; drop `TOOLS` into any LangChain/LangGraph agent. |
| [`vercel-ai-checkout-agent/`](vercel-ai-checkout-agent/) | **Vercel AI SDK `tool()` definitions** + one `generateText` call; offline via `MockLanguageModelV3`. |
| [`mcp/`](mcp/) | Register the `ordercore-mcp` server with Claude Code, Claude Desktop, or Cursor. |

## Go live

1. Get an API key at [ordercore.ai/bootstrap](https://ordercore.ai/bootstrap) — two fields, no payment.
2. Re-run any example with `ORDERCORE_API_KEY=oc_live_xxx`.
3. Wire the same tools into your agent:
   - **MCP**: [`mcp/`](mcp/) — one command for Claude Code
   - **OpenAPI 3.1**: [`ordercore.ai/openapi.yaml`](https://ordercore.ai/openapi.yaml) — import into GPT Actions, Postman, or a codegen
   - **Ready-made tool schemas** for OpenAI / Claude / Gemini / DeepSeek / Grok: [`api.ordercore.ai/direct-ai/tooling`](https://api.ordercore.ai/direct-ai/tooling)

## Why idempotency matters for agents

Agents retry. Networks fail mid-checkout. Without idempotency, a retried
`complete_checkout` charges twice; with OrderCore the same completion call always
returns the same order, and the same `Idempotency-Key` with a *different* payload
returns `409` instead of silently creating a second order.
[Full write-up](https://ordercore.ai/idempotent-orders-for-ai-agents).

## Links

- Docs: https://ordercore.ai/docs
- Browser demo (no signup): https://ordercore.ai/agent-commerce-demo
- MCP guide: https://ordercore.ai/what-is-an-mcp-commerce-server
- OrderCore vs Stripe Agent Toolkit: https://ordercore.ai/ordercore-vs-stripe-agent-toolkit

## License

MIT — see [LICENSE](LICENSE). (The OrderCore service and backend are proprietary;
these examples and docs are free to copy into your own agent.)
