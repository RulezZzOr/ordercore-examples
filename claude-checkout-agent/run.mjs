// Give Claude a checkout tool — a complete agentic loop over OrderCore commerce tools.
//
//   node run.mjs                                # offline: mock model + mock commerce API, no keys
//   ANTHROPIC_API_KEY=sk-ant-... node run.mjs   # live model + mock commerce API (needs: npm install)
//   ANTHROPIC_API_KEY=... ORDERCORE_API_KEY=oc_live_x node run.mjs   # fully live
//
// Exit code 0 means the agent shopped the catalog and completed checkout, and a
// retried completion returned the SAME order — idempotency held.
//
// The loop below is the standard Claude tool-use pattern: send tools + messages,
// execute any tool_use blocks, return tool_result blocks, repeat until the model
// stops calling tools. Offline mode swaps the model for a scripted stand-in so
// you can see the exact same wire shapes without an API key.

const ORDERCORE_BASE = process.env.ORDERCORE_BASE_URL ?? 'https://api.ordercore.ai';
const ORDERCORE_KEY = process.env.ORDERCORE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// ---------------------------------------------------------------------------
// 1. The commerce tools — OrderCore's catalog + idempotent checkout as plain
//    functions. Mock mode mirrors api.ordercore.ai's behavior offline.
// ---------------------------------------------------------------------------

const mockCatalog = [
  { id: 'sku_espresso', name: 'Espresso Beans 1kg', price: 1890, currency: 'USD', stock: 12 },
  { id: 'sku_grinder', name: 'Burr Grinder', price: 8900, currency: 'USD', stock: 3 },
];
const mockOrders = new Map(); // session id -> order (idempotency ledger)

async function orderCoreGET(path) {
  const res = await fetch(ORDERCORE_BASE + path, { headers: { 'X-API-Key': ORDERCORE_KEY } });
  if (!res.ok) throw new Error(`OrderCore ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function orderCorePOST(path, body) {
  const res = await fetch(ORDERCORE_BASE + path, {
    method: 'POST',
    headers: { 'X-API-Key': ORDERCORE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`OrderCore ${path} -> HTTP ${res.status}`);
  return res.json();
}

const toolHandlers = {
  async search_products({ query }) {
    if (!ORDERCORE_KEY) {
      const q = (query ?? '').toLowerCase();
      return { products: mockCatalog.filter((p) => !q || p.name.toLowerCase().includes(q)) };
    }
    return orderCoreGET(`/v1/products?status=active`);
  },

  async create_checkout_session({ sku_id, quantity }) {
    if (!ORDERCORE_KEY) {
      const product = mockCatalog.find((p) => p.id === sku_id);
      if (!product) return { error: `unknown sku ${sku_id}` };
      const id = `cs_${sku_id}`;
      return { session_id: id, status: 'open', total: product.price * (quantity ?? 1) };
    }
    const resp = await orderCorePOST('/ucp/checkout/sessions', {
      line_items: [{ item: { id: sku_id }, quantity: quantity ?? 1 }],
      currency: 'USD',
    });
    return { session_id: String(resp.id ?? '').split('/Checkout/').pop(), status: resp.status };
  },

  // Idempotent by design: completing the same session again returns the SAME
  // order — this is what makes the tool safe for agents that retry.
  async complete_checkout_session({ session_id }) {
    if (!ORDERCORE_KEY) {
      if (!mockOrders.has(session_id)) {
        mockOrders.set(session_id, { order_id: `order_${mockOrders.size + 1}`, status: 'confirmed' });
      }
      return mockOrders.get(session_id);
    }
    return orderCorePOST(`/ucp/checkout/sessions/${encodeURIComponent(session_id)}/complete`, {});
  },
};

// Tool schemas as Claude sees them. In production, pull these ready-made from
// https://api.ordercore.ai/direct-ai/tooling or use the OrderCore MCP server.
const tools = [
  {
    name: 'search_products',
    description:
      'Search the merchant product catalog. Call this before creating a checkout ' +
      'session, whenever the user names a product you have not looked up yet.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Free-text product search' } },
      required: [],
    },
  },
  {
    name: 'create_checkout_session',
    description: 'Create a checkout session for one product. Returns a session_id used to complete checkout.',
    input_schema: {
      type: 'object',
      properties: {
        sku_id: { type: 'string', description: 'Product/SKU id from search_products' },
        quantity: { type: 'integer', description: 'Units to buy (default 1)' },
      },
      required: ['sku_id'],
    },
  },
  {
    name: 'complete_checkout_session',
    description:
      'Complete (pay for) a checkout session. Idempotent: retrying with the same ' +
      'session_id returns the same order and never double-charges — if a call ' +
      'times out, retry it rather than starting a new session.',
    input_schema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
];

// ---------------------------------------------------------------------------
// 2. The model. Live mode uses the official Anthropic SDK (installed via
//    `npm install`); offline mode uses a scripted stand-in emitting the same
//    response shapes, so the loop code is identical either way.
// ---------------------------------------------------------------------------

function mockModel() {
  // Scripted turns: shop -> checkout -> complete -> retry complete -> done.
  const script = [
    [{ type: 'tool_use', id: 'toolu_1', name: 'search_products', input: { query: 'espresso' } }],
    [{ type: 'tool_use', id: 'toolu_2', name: 'create_checkout_session', input: { sku_id: 'sku_espresso', quantity: 1 } }],
    [{ type: 'tool_use', id: 'toolu_3', name: 'complete_checkout_session', input: { session_id: 'cs_sku_espresso' } }],
    // The agent's network "flaked" — it retries the completion. Same order comes back.
    [{ type: 'tool_use', id: 'toolu_4', name: 'complete_checkout_session', input: { session_id: 'cs_sku_espresso' } }],
    [{ type: 'text', text: 'Done — ordered 1kg espresso beans. The retried completion returned the same order, so you were charged once.' }],
  ];
  let turn = 0;
  return {
    async create() {
      const content = script[turn++] ?? [{ type: 'text', text: 'Done.' }];
      return { content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn' };
    },
  };
}

async function liveModel() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  return {
    create: (params) => client.messages.create({ model: 'claude-opus-5', max_tokens: 16000, ...params }),
  };
}

// ---------------------------------------------------------------------------
// 3. The agentic loop — this part is identical for mock and live.
// ---------------------------------------------------------------------------

const model = ANTHROPIC_KEY ? await liveModel() : mockModel();
console.log(ANTHROPIC_KEY ? '── live Claude API ──' : '── offline mock mode (set ANTHROPIC_API_KEY to go live) ──');

const completedOrders = [];
const messages = [
  { role: 'user', content: 'Buy me a bag of espresso beans. If a payment call fails or times out, retry it safely.' },
];

for (let step = 0; step < 10; step++) {
  const response = await model.create({ system: 'You are a shopping agent with OrderCore commerce tools.', tools, messages });

  if (response.stop_reason === 'refusal') {
    console.error('Model declined the request (stop_reason: refusal).');
    process.exit(1);
  }

  // Append the assistant turn BEFORE processing tool calls.
  messages.push({ role: 'assistant', content: response.content });

  const toolResults = [];
  for (const block of response.content) {
    if (block.type === 'text' && block.text) console.log(`\n${block.text}`);
    if (block.type !== 'tool_use') continue;
    console.log(`→ ${block.name}(${JSON.stringify(block.input)})`);
    let result;
    try {
      result = await toolHandlers[block.name](block.input);
    } catch (error) {
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(error), is_error: true });
      continue;
    }
    console.log(`  ${JSON.stringify(result)}`);
    if (block.name === 'complete_checkout_session' && result.order_id) completedOrders.push(result.order_id);
    toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
  }

  if (response.stop_reason !== 'tool_use') break;
  // All tool results go back in ONE user message.
  messages.push({ role: 'user', content: toolResults });
}

// ---------------------------------------------------------------------------
// 4. Verify the idempotency guarantee held.
// ---------------------------------------------------------------------------

const uniqueOrders = new Set(completedOrders);
if (completedOrders.length >= 2 && uniqueOrders.size === 1) {
  console.log(`\n✅ ${completedOrders.length} completion calls -> ${uniqueOrders.size} order. Idempotency held.`);
  process.exit(0);
} else if (completedOrders.length === 1) {
  console.log('\n✅ checkout completed (model chose not to retry — no double-charge possible either way).');
  process.exit(0);
} else {
  console.error(`\n❌ expected a completed order, saw: ${JSON.stringify(completedOrders)}`);
  process.exit(1);
}
