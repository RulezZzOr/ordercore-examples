# GPT function-calling checkout agent

The OpenAI twin of [`../claude-checkout-agent/`](../claude-checkout-agent/):
a complete `chat.completions` function-calling loop over OrderCore's
`search_products` / `create_checkout_session` / **idempotent**
`complete_checkout_session` tools. The agent shops, checks out, retries the
payment call — and gets the same order back instead of charging twice.

```bash
node run.mjs                          # offline: scripted model + mock API — no keys, no install
OPENAI_API_KEY=sk-... node run.mjs    # live GPT (raw fetch — still zero dependencies)
OPENAI_API_KEY=... ORDERCORE_API_KEY=oc_live_... node run.mjs   # fully live
```

Exit code `0` = the retried completion returned the same order.

Ready-made tool schemas for OpenAI, Claude, Gemini, DeepSeek, and Grok are
served at `https://api.ordercore.ai/direct-ai/tooling`. Get an OrderCore key
(2 fields, no payment) at https://ordercore.ai/bootstrap.

Longer write-up: https://ordercore.ai/gpt-function-calling-idempotent-checkout
