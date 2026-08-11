# gemini-checkout-agent

A **Google Gemini** function-calling loop over OrderCore commerce tools, in one
zero-dependency file (raw `fetch`). The agent searches the catalog, opens a
checkout session, completes it, then retries the completion — and gets the
**same order**, proving idempotency.

## Run

```bash
node run.mjs                                        # offline: mock model + mock commerce API, no keys
GEMINI_API_KEY=... node run.mjs                     # live Gemini + mock commerce API
GEMINI_API_KEY=... ORDERCORE_API_KEY=oc_live_x node run.mjs   # fully live
```

Offline mode uses a scripted stand-in model and an in-memory catalog, so it runs
with no signup. Exit code `0` means checkout completed and a retried completion
returned the same order.

## How it maps to Gemini

- Tools are declared as `functionDeclarations` on the `generateContent` request.
- The model replies with `content.parts[].functionCall { name, args }`; the loop
  executes each and appends a `{ role: "function", parts: [{ functionResponse }] }`
  turn, then calls the model again until it returns text.
- `create_checkout_session` sends the real UCP body
  `{ line_items: [{ item: { id }, quantity }], currency }` and reads the session
  id back from `id`; `complete_checkout_session` is idempotent — retrying the same
  session returns the same order (a different payload under the same key returns
  `409 conflict`).

Ready-made tool schemas for OpenAI, Claude, Gemini, DeepSeek, and Grok are served
at <https://api.ordercore.ai/direct-ai/tooling>.
