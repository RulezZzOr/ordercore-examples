# Vercel AI SDK checkout agent

OrderCore commerce tools as standard AI SDK `tool()` definitions —
`search_products`, `create_checkout_session`, and the **idempotent**
`complete_checkout_session` — driven by a single `generateText` call with
`stopWhen: stepCountIs(10)`. The agent shops, checks out, retries the payment
call, and gets the same order back instead of charging twice.

```bash
npm install          # ai + zod
node run.mjs         # offline: MockLanguageModelV3 (ships with `ai`) + mock commerce API — no keys
```

Exit code `0` = the retried completion returned the same order.

## Going live

```bash
npm install @ai-sdk/anthropic

# Live Claude (claude-opus-5) + mock commerce API:
ANTHROPIC_API_KEY=sk-ant-... node run.mjs

# Fully live — real model, real OrderCore (key: https://ordercore.ai/bootstrap):
ANTHROPIC_API_KEY=... ORDERCORE_API_KEY=oc_live_... node run.mjs
```

Works with any AI SDK provider — swap `anthropic(...)` for `openai(...)`,
`google(...)`, etc.

## Drop the tools into your own app

`orderCoreTools` is exported and has no dependency on the loop in this file —
spread it into any `generateText` / `streamText` / `useChat` route:

```js
import { orderCoreTools } from './run.mjs';

const result = await streamText({ model, tools: orderCoreTools, ... });
```

The `complete_checkout_session` description tells the model retries are safe —
that promise holds because OrderCore returns the same order for the same
session. Details: https://ordercore.ai/idempotent-orders-for-ai-agents

Siblings: [Claude tool-use loop](../claude-checkout-agent/) ·
[OpenAI function calling](../openai-checkout-agent/) ·
[LangChain](../langchain-checkout-agent/) ·
[MCP server](https://ordercore.ai/what-is-an-mcp-commerce-server) (zero loop code)
