# OrderCore Agent-Commerce Demo (5 minutes)

Give an AI agent a working **catalog + idempotent checkout** without building a commerce
backend. This runs the exact sequence an agent performs through OrderCore's tools/MCP:

```
create_checkout_session  →  complete_checkout_session  (idempotent order)
```

It completes the **same** checkout session twice — the way a real agent retries after a
network hiccup — and proves you get **one order, not two**. That idempotency (Stripe wiring
+ order DB + retry-safe keys) is the part you'd otherwise build and secure yourself.

> Prefer a web walkthrough with JS + curl? See the
> [5-minute quickstart](https://ordercore.ai/agent-commerce-quickstart) or the
> [live demo page](https://ordercore.ai/agent-commerce-demo).

## Fastest check (one command)

```bash
bash verify.sh   # runs the demo in every runtime you have; exit 0 = idempotency held
```

## Run it (no key, no signup, offline)

Pick your language — both are dependency-free and behave identically.

```bash
# Node 18+ (built-in fetch)
node run.mjs          # mock mode: offline, no key, no signup
node run.mjs --help   # options and env vars

# or Python 3.8+ (standard library only)
python3 run.py        # mock mode: offline, no key, no signup
python3 run.py --help # options and env vars

# or via npm (Node)
npm start             # runs the mock demo
npm test              # same run; exit 0 = idempotency held
```

Expected output (mock mode):

```
OrderCore agent-commerce demo — MOCK (no key; set ORDERCORE_API_KEY for live)
▸ Agent tool: create_checkout_session      { "session_id": "sess_demo_1", ... }
▸ Agent tool: complete_checkout_session (attempt 1)   { "order": { "id": "ord_9F3K21" } }
▸ Agent tool: complete_checkout_session (retry, same session)   { "order": { "id": "ord_9F3K21" } }
✅ AHA: retry returned the SAME order (ord_9F3K21). No duplicate, no double charge.
```

Exit code `0` = idempotency held.

## Run it live

Get an API key at https://ordercore.ai/bootstrap (3-day trial), then:

```bash
ORDERCORE_API_KEY=oc_live_xxx node run.mjs     # or: python3 run.py
# optional: ORDERCORE_SKU_ID=<a real SKU UUID from your catalog>
```

Prefer a file? Copy `.env.example` to `.env` and fill it in (or `export` the same
vars). Live mode mints a short-lived public checkout token, then calls the real
`/ucp/public/checkout/sessions` endpoints on `https://api.ordercore.ai`.

## Plug it into Claude or GPT

The same tools are exposed as an MCP server — download the `ordercore-mcp`
binary and register it in one command (see [`../mcp/`](../mcp/) for
Claude Desktop / Cursor config):

```bash
claude mcp add ordercore --env ORDERCORE_API_KEY=oc_live_xxx -- /path/to/ordercore-mcp
```

Tool schemas for OpenAI / Claude / Gemini / DeepSeek / Grok are served live at
`https://api.ordercore.ai/direct-ai/tooling`. Quickstart: https://ordercore.ai/claude-quickstart

## What you skipped building

| Roll your own | With OrderCore |
| --- | --- |
| Stripe PaymentIntent lifecycle | one `create_payment_intent` call |
| Order DB + schema + migrations | orders created and stored for you |
| Idempotency keys + dedup on retry | idempotent per session, by default |
| Signed webhooks + retry delivery | built in |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `fetch is not defined` (Node) | Use Node 18+. `run.mjs` also prints a clear version error. |
| HTTP `401`/`403` (live) | `ORDERCORE_API_KEY` invalid or missing write/checkout scope. |
| HTTP `404` on a session (live) | `ORDERCORE_SKU_ID` is not a real SKU UUID from your catalog. |
| `network error reaching …` | Check connectivity / `ORDERCORE_BASE_URL`; verify `https://api.ordercore.ai/health`. |
| Want to test with no account | Leave `ORDERCORE_API_KEY` empty — the demo runs fully offline in mock mode. |
