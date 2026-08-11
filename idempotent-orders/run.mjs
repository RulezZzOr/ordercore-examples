#!/usr/bin/env node
// OrderCore idempotency-key demo: the OTHER idempotency model — direct POST /v1/orders.
// Runs in MOCK mode by default (no key, offline). Set ORDERCORE_API_KEY for LIVE mode.
//
//   node run.mjs                                # mock mode, offline, no signup
//   ORDERCORE_API_KEY=oc_live_x node run.mjs    # live against api.ordercore.ai
//   node run.mjs --help
//
// Proves three behaviors an autonomous agent depends on when creating orders directly:
//   1. new Idempotency-Key + payload            -> 201 Created  (order created)
//   2. SAME key + SAME payload (a retry)        -> 200 OK       (same order, replay)
//   3. SAME key + DIFFERENT payload             -> 409 Conflict (never a divergent order)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`OrderCore idempotency-key demo (POST /v1/orders)

  node run.mjs                 Mock mode (offline, no key).
  ORDERCORE_API_KEY=oc_... node run.mjs   Live against https://api.ordercore.ai

Env: ORDERCORE_API_KEY (unset = mock), ORDERCORE_BASE_URL,
     ORDERCORE_CUSTOMER_ID + ORDERCORE_SKU_ID (real IDs, live mode only).
Exit 0 = create + replay + conflict all behaved correctly.`);
  process.exit(0);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error(`❌ Needs Node 18+ (built-in fetch); found ${process.versions.node}.`); process.exit(1); }

const BASE = (process.env.ORDERCORE_BASE_URL || 'https://api.ordercore.ai').replace(/\/$/, '');
const KEY = (process.env.ORDERCORE_API_KEY || '').trim();
const LIVE = KEY.length > 0;
const CUSTOMER = process.env.ORDERCORE_CUSTOMER_ID || '00000000-0000-0000-0000-0000000000c1';
const SKU = process.env.ORDERCORE_SKU_ID || '00000000-0000-0000-0000-000000000001';

// POST /v1/orders with an Idempotency-Key. Returns { status, body }.
async function createOrder(idempotencyKey, items) {
  if (!LIVE) return mock(idempotencyKey, items);
  let res;
  try {
    res = await fetch(BASE + '/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ customer_id: CUSTOMER, items }),
    });
  } catch (err) {
    throw new Error(`network error reaching ${BASE} (${err.message}). Check connectivity or ORDERCORE_BASE_URL.`);
  }
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// Deterministic mock of the server's idempotency contract, so the behavior is visible offline.
const store = new Map(); // key -> { hash, order }
function mock(key, items) {
  const hash = JSON.stringify(items);
  const seen = store.get(key);
  if (!seen) {
    const order = { id: 'ord_' + key, customer_id: CUSTOMER, items };
    store.set(key, { hash, order });
    return { status: 201, body: { order, created: true } };
  }
  if (seen.hash === hash) return { status: 200, body: { order: seen.order, created: false, idempotent_replay: true } };
  return { status: 409, body: { error: 'conflict', message: 'idempotency key already used with a different payload' } };
}

const orderId = (r) => r.body?.order?.id || r.body?.id;

async function main() {
  console.log(LIVE ? `OrderCore idempotency-key demo — LIVE against ${BASE}`
                   : 'OrderCore idempotency-key demo — MOCK (offline, no key). --help for options.');
  const KEY_A = 'demo-order-key-001';
  const itemsA = [{ sku_id: SKU, quantity: 1 }];
  const itemsB = [{ sku_id: SKU, quantity: 5 }]; // same key, different payload

  const first = await createOrder(KEY_A, itemsA);
  console.log(`\n▸ 1) new key + payload         -> HTTP ${first.status}  order ${orderId(first)}`);

  const retry = await createOrder(KEY_A, itemsA);
  console.log(`▸ 2) same key + same payload    -> HTTP ${retry.status}  order ${orderId(retry)}`);

  const conflict = await createOrder(KEY_A, itemsB);
  console.log(`▸ 3) same key + DIFFERENT payload -> HTTP ${conflict.status}  ${conflict.body?.error || ''}`);

  const created = first.status === 201 || first.status === 200;
  const replayed = created && orderId(retry) && orderId(retry) === orderId(first);
  const conflicted = conflict.status === 409;
  const ok = created && replayed && conflicted;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(ok
    ? `✅ Idempotency held: retry returned the SAME order (${orderId(first)}); a different payload on the same key was rejected (409).`
    : `⚠️  Unexpected: created=${created} replayed=${replayed} conflicted=${conflicted}`);
  console.log('Same key + same payload = one order. Same key + different payload = 409, never a silent duplicate.');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  if (LIVE) console.error('   (Live mode needs real ORDERCORE_CUSTOMER_ID + ORDERCORE_SKU_ID. Unset ORDERCORE_API_KEY to run offline.)');
  process.exit(1);
});
