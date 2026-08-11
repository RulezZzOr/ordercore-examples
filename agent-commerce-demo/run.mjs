#!/usr/bin/env node
// OrderCore agent-commerce demo: give an AI agent a catalog + idempotent checkout.
// Runs in MOCK mode by default (no key, offline). Set ORDERCORE_API_KEY for LIVE mode.
//
//   node run.mjs                                # mock mode, safe, offline, no signup
//   ORDERCORE_API_KEY=oc_live_x node run.mjs    # live against api.ordercore.ai
//   node run.mjs --help                         # show options
//
// This is the exact sequence an AI agent performs via OrderCore's tools/MCP:
//   create_checkout_session -> complete_checkout_session (idempotent order).
// We call complete twice on the same session to prove retries never double-charge.

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`OrderCore agent-commerce demo

  node run.mjs                 Mock mode (offline, no key, no signup).
  ORDERCORE_API_KEY=oc_... \\
    node run.mjs               Live mode against https://api.ordercore.ai

Env vars:
  ORDERCORE_API_KEY   Live key from https://ordercore.ai/bootstrap (3-day trial). Unset = mock.
  ORDERCORE_BASE_URL  Override API base (default https://api.ordercore.ai).
  ORDERCORE_SKU_ID    A real SKU UUID from your catalog (live mode only).

Exit code 0 = the retried checkout returned the same order (idempotency held).`);
  process.exit(0);
}

// fetch() is built in on Node 18+. Fail loudly instead of a confusing ReferenceError.
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`❌ Node ${process.versions.node} detected. This demo needs Node 18+ (built-in fetch). Upgrade and re-run.`);
  process.exit(1);
}

const BASE_URL = (process.env.ORDERCORE_BASE_URL || 'https://api.ordercore.ai').replace(/\/$/, '');
const API_KEY = (process.env.ORDERCORE_API_KEY || '').trim();
const LIVE = API_KEY.length > 0;
const SKU_ID = process.env.ORDERCORE_SKU_ID || '00000000-0000-0000-0000-000000000001';

const log = (label, data) => console.log(`\n▸ ${label}\n${JSON.stringify(data, null, 2)}`);

async function call(step, path, { body, token } = {}) {
  if (!LIVE) return mock(path, body);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Checkout-Token'] = token;
  else headers['X-API-Key'] = API_KEY;

  let res;
  try {
    res = await fetch(BASE_URL + path, { method: 'POST', headers, body: body && JSON.stringify(body) });
  } catch (err) {
    throw new Error(`[${step}] network error reaching ${BASE_URL} (${err.message}). Check connectivity or ORDERCORE_BASE_URL.`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403 ? ' — check ORDERCORE_API_KEY is valid and has write/checkout scope.'
      : res.status === 404 && path.includes('/sessions/') ? ' — session not found; ORDERCORE_SKU_ID may be invalid.'
      : res.status === 404 ? ' — endpoint not found; check ORDERCORE_BASE_URL.'
      : '';
    throw new Error(`[${step}] OrderCore returned HTTP ${res.status}${hint}\n   response: ${JSON.stringify(json)}`);
  }
  return json;
}

// Deterministic mock so the "aha" (same session -> same order) is visible without a key.
const mockState = new Map();
function mock(path, body) {
  if (path.endsWith('/checkout-access-tokens')) return { token: 'mock_checkout_token' };
  if (path.endsWith('/checkout/sessions')) {
    mockState.set('sess_demo_1', { order_id: null, currency: body.currency, items: body.line_items });
    return { id: 'gid://ordercore.ai/Checkout/sess_demo_1', status: 'open', currency: body.currency };
  }
  const id = path.split('/checkout/sessions/')[1].split('/')[0];
  const s = mockState.get(id);
  if (path.endsWith('/complete')) {
    if (!s.order_id) s.order_id = 'ord_9F3K21'; // created once; reused on retry
    return { session_id: id, status: 'completed', order: { id: s.order_id, idempotent: true } };
  }
  return { session_id: id, status: 'open' };
}

async function main() {
  console.log(LIVE
    ? `OrderCore agent-commerce demo — LIVE against ${BASE_URL}`
    : `OrderCore agent-commerce demo — MOCK (offline, no key). Set ORDERCORE_API_KEY for live mode; run with --help for options.`);

  // In live mode the MCP/agent flow uses a short-lived public checkout token.
  const { token } = LIVE ? await call('token', '/v1/account/checkout-access-tokens') : { token: null };

  const session = await call('create_checkout_session', '/ucp/public/checkout/sessions', {
    token, body: { line_items: [{ item: { id: SKU_ID }, quantity: 2 }], currency: 'USD' },
  });
  log('Agent tool: create_checkout_session', session);
  const sid = String(session.id ?? '').split('/Checkout/').pop();

  const pay = { session_id: sid, payment_data: { handler_id: 'card', payment_intent_id: 'pi_demo_confirmed' } };
  const first = await call('complete_checkout_session', `/ucp/public/checkout/sessions/${sid}/complete`, { token, body: pay });
  log('Agent tool: complete_checkout_session (attempt 1)', first);

  // Retry the SAME session — network hiccup, agent re-runs the tool. One order, not two.
  const retry = await call('complete_checkout_session', `/ucp/public/checkout/sessions/${sid}/complete`, { token, body: pay });
  log('Agent tool: complete_checkout_session (retry, same session)', retry);

  const orderOf = (r) => r.order?.id || r.order_id || r.id;
  const idempotent = orderOf(first) && orderOf(first) === orderOf(retry);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(idempotent
    ? `✅ AHA: retry returned the SAME order (${orderOf(first)}). No duplicate, no double charge.`
    : `⚠️  Orders differed on retry: ${orderOf(first)} vs ${orderOf(retry)} — idempotency did not hold.`);
  console.log('This is the part you would otherwise build by hand: Stripe wiring + order DB + idempotency keys.');
  process.exit(idempotent ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  if (LIVE) console.error('   (Running live. To reproduce offline with no key, unset ORDERCORE_API_KEY and re-run.)');
  process.exit(1);
});
