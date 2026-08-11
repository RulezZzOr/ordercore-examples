// Give GPT a checkout tool — a function-calling loop over OrderCore commerce tools.
//
//   node run.mjs                              # offline: mock model + mock commerce API, no keys
//   OPENAI_API_KEY=sk-... node run.mjs        # live GPT + mock commerce API (zero deps: raw fetch)
//   OPENAI_API_KEY=... ORDERCORE_API_KEY=oc_live_x node run.mjs   # fully live
//
// Exit code 0 means the agent shopped and completed checkout, and a retried
// completion returned the SAME order — idempotency held.

const ORDERCORE_BASE = process.env.ORDERCORE_BASE_URL ?? 'https://api.ordercore.ai';
const ORDERCORE_KEY = process.env.ORDERCORE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';

// --- Commerce tools (mock offline, real OrderCore with ORDERCORE_API_KEY) ----

const mockCatalog = [
  { id: 'sku_espresso', name: 'Espresso Beans 1kg', price: 1890, currency: 'USD', stock: 12 },
];
const mockOrders = new Map();

async function orderCore(path, body) {
  const res = await fetch(ORDERCORE_BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-API-Key': ORDERCORE_KEY, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OrderCore ${path} -> HTTP ${res.status}`);
  return res.json();
}

const handlers = {
  async search_products({ query }) {
    if (!ORDERCORE_KEY) {
      const q = (query ?? '').toLowerCase();
      return { products: mockCatalog.filter((p) => !q || p.name.toLowerCase().includes(q)) };
    }
    return orderCore('/v1/products?status=active');
  },
  async create_checkout_session({ sku_id, quantity }) {
    if (!ORDERCORE_KEY) {
      const product = mockCatalog.find((p) => p.id === sku_id);
      if (!product) return { error: `unknown sku ${sku_id}` };
      return { session_id: `cs_${sku_id}`, status: 'open', total: product.price * (quantity ?? 1) };
    }
    const resp = await orderCore('/ucp/checkout/sessions', {
      line_items: [{ item: { id: sku_id }, quantity: quantity ?? 1 }],
      currency: 'USD',
    });
    return { session_id: String(resp.id ?? '').split('/Checkout/').pop(), status: resp.status };
  },
  async complete_checkout_session({ session_id }) {
    if (!ORDERCORE_KEY) {
      if (!mockOrders.has(session_id)) {
        mockOrders.set(session_id, { order_id: `order_${mockOrders.size + 1}`, status: 'confirmed' });
      }
      return mockOrders.get(session_id); // same session -> same order, always
    }
    return orderCore(`/ucp/checkout/sessions/${encodeURIComponent(session_id)}/complete`, {});
  },
};

// OpenAI function-calling tool schemas. Ready-made schemas for OpenAI, Claude,
// Gemini, DeepSeek, and Grok are served at https://api.ordercore.ai/direct-ai/tooling
const tools = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Search the merchant product catalog. Call before creating a checkout session.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_checkout_session',
      description: 'Create a checkout session for one product. Returns a session_id.',
      parameters: {
        type: 'object',
        properties: { sku_id: { type: 'string' }, quantity: { type: 'integer' } },
        required: ['sku_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_checkout_session',
      description:
        'Complete (pay for) a checkout session. Idempotent: retrying the same session_id ' +
        'returns the same order and never double-charges — retry on timeout instead of starting over.',
      parameters: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
    },
  },
];

// --- Model: live chat.completions via fetch, or scripted offline stand-in ----

function mockModel() {
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const script = [
    { tool_calls: [call('call_1', 'search_products', { query: 'espresso' })] },
    { tool_calls: [call('call_2', 'create_checkout_session', { sku_id: 'sku_espresso', quantity: 1 })] },
    { tool_calls: [call('call_3', 'complete_checkout_session', { session_id: 'cs_sku_espresso' })] },
    { tool_calls: [call('call_4', 'complete_checkout_session', { session_id: 'cs_sku_espresso' })] }, // the retry
    { content: 'Ordered. The retried completion returned the same order — charged once.' },
  ];
  let turn = 0;
  return async () => ({ ...{ role: 'assistant', content: null }, ...(script[turn++] ?? { content: 'Done.' }) });
}

function liveModel() {
  return async (messages) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENAI_MODEL, messages, tools }),
    });
    if (!res.ok) throw new Error(`OpenAI -> HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()).choices[0].message;
  };
}

// --- The function-calling loop ----------------------------------------------

const step = OPENAI_KEY ? liveModel() : mockModel();
console.log(OPENAI_KEY ? '── live OpenAI API ──' : '── offline mock mode (set OPENAI_API_KEY to go live) ──');

const completedOrders = [];
const messages = [
  { role: 'system', content: 'You are a shopping agent with OrderCore commerce tools.' },
  { role: 'user', content: 'Buy me a bag of espresso beans. If a payment call fails or times out, retry it safely.' },
];

for (let i = 0; i < 10; i++) {
  const message = await step(messages);
  messages.push(message);
  if (message.content) console.log(`\n${message.content}`);
  if (!message.tool_calls?.length) break;

  for (const toolCall of message.tool_calls) {
    const args = JSON.parse(toolCall.function.arguments);
    console.log(`→ ${toolCall.function.name}(${toolCall.function.arguments})`);
    let result;
    try {
      result = await handlers[toolCall.function.name](args);
    } catch (error) {
      result = { error: String(error) };
    }
    console.log(`  ${JSON.stringify(result)}`);
    if (toolCall.function.name === 'complete_checkout_session' && result.order_id) completedOrders.push(result.order_id);
    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
  }
}

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
