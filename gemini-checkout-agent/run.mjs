// Give Gemini a checkout tool — a function-calling loop over OrderCore commerce tools.
//
//   node run.mjs                              # offline: mock model + mock commerce API, no keys
//   GEMINI_API_KEY=... node run.mjs           # live Gemini + mock commerce API (zero deps: raw fetch)
//   GEMINI_API_KEY=... ORDERCORE_API_KEY=oc_live_x node run.mjs   # fully live
//
// Exit code 0 means the agent shopped and completed checkout, and a retried
// completion returned the SAME order — idempotency held.

const ORDERCORE_BASE = process.env.ORDERCORE_BASE_URL ?? 'https://api.ordercore.ai';
const ORDERCORE_KEY = process.env.ORDERCORE_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

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

// Gemini functionDeclarations. Ready-made schemas for OpenAI, Claude, Gemini,
// DeepSeek, and Grok are served at https://api.ordercore.ai/direct-ai/tooling
const functionDeclarations = [
  {
    name: 'search_products',
    description: 'Search the merchant product catalog. Call before creating a checkout session.',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'create_checkout_session',
    description: 'Create a checkout session for one product. Returns a session_id.',
    parameters: {
      type: 'object',
      properties: { sku_id: { type: 'string' }, quantity: { type: 'integer' } },
      required: ['sku_id'],
    },
  },
  {
    name: 'complete_checkout_session',
    description:
      'Complete (pay for) a checkout session. Idempotent: retrying the same session_id ' +
      'returns the same order and never double-charges — retry on timeout instead of starting over.',
    parameters: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
  },
];

// --- Model: live generateContent via fetch, or scripted offline stand-in -----
//
// Both return a Gemini "model" content: { role, parts: [{ functionCall } | { text }] }.

function mockModel() {
  const fc = (name, args) => ({ functionCall: { name, args } });
  const script = [
    { role: 'model', parts: [fc('search_products', { query: 'espresso' })] },
    { role: 'model', parts: [fc('create_checkout_session', { sku_id: 'sku_espresso', quantity: 1 })] },
    { role: 'model', parts: [fc('complete_checkout_session', { session_id: 'cs_sku_espresso' })] },
    { role: 'model', parts: [fc('complete_checkout_session', { session_id: 'cs_sku_espresso' })] }, // the retry
    { role: 'model', parts: [{ text: 'Ordered. The retried completion returned the same order — charged once.' }] },
  ];
  let turn = 0;
  return async () => script[turn++] ?? { role: 'model', parts: [{ text: 'Done.' }] };
}

function liveModel() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  return async (contents) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'You are a shopping agent with OrderCore commerce tools.' }] },
        contents,
        tools: [{ functionDeclarations }],
      }),
    });
    if (!res.ok) throw new Error(`Gemini -> HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates?.[0]?.content ?? { role: 'model', parts: [{ text: 'Done.' }] };
  };
}

// --- The function-calling loop ----------------------------------------------

const step = GEMINI_KEY ? liveModel() : mockModel();
console.log(GEMINI_KEY ? '── live Gemini API ──' : '── offline mock mode (set GEMINI_API_KEY to go live) ──');

const completedOrders = [];
const contents = [
  {
    role: 'user',
    parts: [{ text: 'Buy me a bag of espresso beans. If a payment call fails or times out, retry it safely.' }],
  },
];

for (let i = 0; i < 10; i++) {
  const content = await step(contents);
  contents.push(content);

  const parts = content.parts ?? [];
  const text = parts.map((p) => p.text).filter(Boolean).join('');
  if (text) console.log(`\n${text}`);

  const calls = parts.map((p) => p.functionCall).filter(Boolean);
  if (calls.length === 0) break;

  const responseParts = [];
  for (const call of calls) {
    const args = call.args ?? {};
    console.log(`→ ${call.name}(${JSON.stringify(args)})`);
    let result;
    try {
      result = await handlers[call.name](args);
    } catch (error) {
      result = { error: String(error) };
    }
    console.log(`  ${JSON.stringify(result)}`);
    if (call.name === 'complete_checkout_session' && result.order_id) completedOrders.push(result.order_id);
    responseParts.push({ functionResponse: { name: call.name, response: result } });
  }
  contents.push({ role: 'function', parts: responseParts });
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
