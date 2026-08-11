# Claude checkout agent — full agentic loop

A complete, runnable agentic loop giving Claude three OrderCore commerce tools:
`search_products`, `create_checkout_session`, and the **idempotent**
`complete_checkout_session`. The agent shops, checks out, then *retries the
payment call* — and gets the same order back instead of charging twice.

```bash
node run.mjs        # offline: scripted model + mock commerce API — no keys, no install
```

Exit code `0` = the retried completion returned the same order.

## Going live

```bash
npm install @anthropic-ai/sdk

# Live Claude (claude-opus-5) + mock commerce API:
ANTHROPIC_API_KEY=sk-ant-... node run.mjs

# Fully live — real Claude, real OrderCore (get a key at https://ordercore.ai/bootstrap):
ANTHROPIC_API_KEY=sk-ant-... ORDERCORE_API_KEY=oc_live_... node run.mjs
```

The loop code is identical in both modes — offline mode swaps the model for a
scripted stand-in that emits the same `tool_use` / `stop_reason` shapes, so you
can study the exact wire format without an API key.

## What the example teaches

1. **The standard Claude tool-use loop**: send `tools` + `messages`, execute
   `tool_use` blocks, return **all** `tool_result` blocks in one user message,
   repeat until `stop_reason !== "tool_use"`.
2. **Why the checkout tool must be idempotent**: the tool description tells the
   model "if a call times out, retry it" — that is only safe because OrderCore
   returns the same order for the same session.
3. **Refusal handling**: `stop_reason === "refusal"` is checked before reading
   content (required on current Claude models).

Prefer not to hand-write the loop? The same tools work with the SDK's tool
runner (`client.beta.messages.toolRunner`) or via the
[OrderCore MCP server](https://ordercore.ai/what-is-an-mcp-commerce-server) —
zero loop code with Claude Desktop / Claude Code / Cursor.
