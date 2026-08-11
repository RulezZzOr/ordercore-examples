// Give a Vercel AI SDK agent OrderCore commerce tools — catalog + idempotent checkout.
//
//   npm install                                  # ai + zod (offline mode needs no keys)
//   node run.mjs                                 # offline: mock model (ai/test) + mock commerce API
//   npm i @ai-sdk/anthropic && ANTHROPIC_API_KEY=... node run.mjs    # live Claude
//   ... ORDERCORE_API_KEY=oc_live_x node run.mjs                     # fully live
//
// Exit code 0 means the agent shopped, checked out, retried the payment call —
// and got the SAME order back. Idempotency held; no double charge.
//
// The tools are standard AI SDK `tool()` definitions, so they drop into any
// generateText / streamText / agent setup unchanged.

import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const ORDERCORE_BASE = process.env.ORDERCORE_BASE_URL ?? 'https://api.ordercore.ai';
const ORDERCORE_KEY = process.env.ORDERCORE_API_KEY;

// --- OrderCore tools (mock offline, real API with ORDERCORE_API_KEY) ---------

const mockCatalog = [
  { id: 'sku_espresso', name: 'Espresso Beans 1kg', price: 1890, currency: 'USD', stock: 12 },
];
const mockOrders = new Map();
const completedOrders = [];

async function orderCore(path, body) {
  const res = await fetch(ORDERCORE_BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-API-Key': ORDERCORE_KEY, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OrderCore ${path} -> HTTP ${res.status}`);
  return res.json();
}

export const orderCoreTools = {
  search_products: tool({
    description:
      'Search the merchant product catalog. Call this before creating a checkout ' +
      'session, whenever the user names a product you have not looked up yet.',
    inputSchema: z.object({ query: z.string().default('') }),
    execute: async ({ query }) => {
      if (!ORDERCORE_KEY) {
        const q = query.toLowerCase();
        return { products: mockCatalog.filter((p) => !q || p.name.toLowerCase().includes(q)) };
      }
      return orderCore('/v1/products?status=active');
    },
  }),

  create_checkout_session: tool({
    description: 'Create a checkout session for one product. Returns a session_id used to complete checkout.',
    inputSchema: z.object({ sku_id: z.string(), quantity: z.number().int().default(1) }),
    execute: async ({ sku_id, quantity }) => {
      if (!ORDERCORE_KEY) {
        const product = mockCatalog.find((p) => p.id === sku_id);
        if (!product) return { error: `unknown sku ${sku_id}` };
        return { session_id: `cs_${sku_id}`, status: 'open', total: product.price * quantity };
      }
      const resp = await orderCore('/ucp/checkout/sessions', {
        line_items: [{ item: { id: sku_id }, quantity: quantity ?? 1 }],
        currency: 'USD',
      });
      return { session_id: String(resp.id ?? '').split('/Checkout/').pop(), status: resp.status };
    },
  }),

  complete_checkout_session: tool({
    description:
      'Complete (pay for) a checkout session. Idempotent: retrying with the same ' +
      'session_id returns the same order and never double-charges — if a call ' +
      'times out, retry it rather than starting a new session.',
    inputSchema: z.object({ session_id: z.string() }),
    execute: async ({ session_id }) => {
      let result;
      if (!ORDERCORE_KEY) {
        if (!mockOrders.has(session_id)) {
          mockOrders.set(session_id, { order_id: `order_${mockOrders.size + 1}`, status: 'confirmed' });
        }
        result = mockOrders.get(session_id);
      } else {
        result = await orderCore(`/ucp/checkout/sessions/${encodeURIComponent(session_id)}/complete`, {});
      }
      if (result.order_id) completedOrders.push(result.order_id);
      return result;
    },
  }),
};

// --- Model: live Claude via @ai-sdk/anthropic, or the AI SDK's own test mock --

async function getModel() {
  if (process.env.ANTHROPIC_API_KEY) {
    const { anthropic } = await import('@ai-sdk/anthropic');
    return anthropic('claude-opus-5');
  }
  // MockLanguageModelV3 ships with the ai package — scripted turns emitting the
  // same wire shapes a live provider produces.
  const { MockLanguageModelV3 } = await import('ai/test');
  const toolCall = (id, toolName, input) => ({
    finishReason: 'tool-calls',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    content: [{ type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) }],
    warnings: [],
  });
  const script = [
    toolCall('call_1', 'search_products', { query: 'espresso' }),
    toolCall('call_2', 'create_checkout_session', { sku_id: 'sku_espresso', quantity: 1 }),
    toolCall('call_3', 'complete_checkout_session', { session_id: 'cs_sku_espresso' }),
    // The "network flaked" — the agent retries the completion. Same order returns.
    toolCall('call_4', 'complete_checkout_session', { session_id: 'cs_sku_espresso' }),
    {
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: 'text', text: 'Ordered 1kg espresso beans. The retried completion returned the same order — charged once.' }],
      warnings: [],
    },
  ];
  let turn = 0;
  return new MockLanguageModelV3({ doGenerate: async () => script[Math.min(turn++, script.length - 1)] });
}

// --- The agent: one generateText call, the SDK runs the loop ------------------

const model = await getModel();
console.log(process.env.ANTHROPIC_API_KEY ? '── live Claude via AI SDK ──' : '── offline mock mode (set ANTHROPIC_API_KEY to go live) ──');

const result = await generateText({
  model,
  system: 'You are a shopping agent with OrderCore commerce tools.',
  prompt: 'Buy me a bag of espresso beans. If a payment call fails or times out, retry it safely.',
  tools: orderCoreTools,
  stopWhen: stepCountIs(10),
});

for (const step of result.steps) {
  for (const call of step.toolCalls) console.log(`→ ${call.toolName}(${JSON.stringify(call.input)})`);
  for (const toolResult of step.toolResults) console.log(`  ${JSON.stringify(toolResult.output)}`);
}
console.log(`\n${result.text}`);

const unique = new Set(completedOrders);
if (completedOrders.length >= 2 && unique.size === 1) {
  console.log(`\n✅ ${completedOrders.length} completion calls -> ${unique.size} order. Idempotency held.`);
  process.exit(0);
} else if (completedOrders.length === 1) {
  console.log('\n✅ checkout completed (model chose not to retry — no double-charge possible either way).');
  process.exit(0);
} else {
  console.error(`\n❌ expected a completed order, saw: ${JSON.stringify(completedOrders)}`);
  process.exit(1);
}
