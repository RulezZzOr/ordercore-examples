#!/usr/bin/env node
// OrderCore catalog-read demo: the "shop" phase an AI agent does before checkout.
// Exercises the read tools OrderCore's MCP exposes (search_products, get_product,
// get_prices, get_inventory) as plain REST GETs. These are read-only — no writes,
// no orders, no checkout tokens.
//
//   node run.mjs                                 # mock mode, offline, no signup
//   ORDERCORE_API_KEY=oc_live_x node run.mjs     # live GETs against api.ordercore.ai
//   node run.mjs --help

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`OrderCore catalog-read demo (read-only)

  node run.mjs                 Mock mode (offline, no key).
  ORDERCORE_API_KEY=oc_... node run.mjs   Live GETs against https://api.ordercore.ai

Env: ORDERCORE_API_KEY (unset = mock), ORDERCORE_BASE_URL.
Read-only: GET /v1/products, /v1/products/{id}, /v1/prices, /v1/inventory.
Exit 0 = all four reads returned a payload.`);
  process.exit(0);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error(`❌ Needs Node 18+ (built-in fetch); found ${process.versions.node}.`); process.exit(1); }

const BASE = (process.env.ORDERCORE_BASE_URL || 'https://api.ordercore.ai').replace(/\/$/, '');
const KEY = (process.env.ORDERCORE_API_KEY || '').trim();
const LIVE = KEY.length > 0;

async function get(step, path) {
  if (!LIVE) return mock(path);
  let res;
  try {
    res = await fetch(BASE + path, { headers: { Accept: 'application/json', 'X-API-Key': KEY } });
  } catch (err) {
    throw new Error(`[${step}] network error reaching ${BASE} (${err.message}). Check connectivity or ORDERCORE_BASE_URL.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = (res.status === 401 || res.status === 403) ? ' — check ORDERCORE_API_KEY has read scope.' : '';
    throw new Error(`[${step}] HTTP ${res.status}${hint}`);
  }
  return body;
}

// Deterministic offline mock of the read endpoints.
function mock(path) {
  if (path === '/v1/products') return { data: [{ id: 'p_demo_1', name: 'Demo Widget', sku: 'WIDGET-1' }], meta: {} };
  if (path.startsWith('/v1/products/')) return { id: path.split('/').pop(), name: 'Demo Widget', sku: 'WIDGET-1' };
  if (path === '/v1/prices') return { data: [{ sku: 'WIDGET-1', currency: 'USD', amount: 1999 }], meta: {} };
  if (path === '/v1/inventory') return { data: [{ sku: 'WIDGET-1', available: 42 }], meta: {} };
  return {};
}

const firstProductId = (r) => (r.data && r.data[0] && r.data[0].id) || 'p_demo_1';
const show = (label, data) => console.log(`\n▸ ${label}\n${JSON.stringify(data, null, 2)}`);

async function main() {
  console.log(LIVE ? `OrderCore catalog-read demo — LIVE against ${BASE}`
                   : 'OrderCore catalog-read demo — MOCK (offline, no key). --help for options.');

  const products = await get('search_products', '/v1/products');
  show('search_products  → GET /v1/products', products);

  const pid = firstProductId(products);
  const product = await get('get_product', `/v1/products/${encodeURIComponent(pid)}`);
  show(`get_product      → GET /v1/products/${pid}`, product);

  const prices = await get('get_prices', '/v1/prices');
  show('get_prices       → GET /v1/prices', prices);

  const inventory = await get('get_inventory', '/v1/inventory');
  show('get_inventory    → GET /v1/inventory', inventory);

  const ok = [products, product, prices, inventory].every((r) => r && Object.keys(r).length > 0);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(ok
    ? '✅ Catalog read complete. This is the "shop" phase — the agent now has products, prices, and stock to build a checkout.'
    : '⚠️  One or more reads returned empty.');
  console.log('Next: create_checkout_session with a chosen SKU → complete_checkout_session (see ../agent-commerce-demo).');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  if (LIVE) console.error('   (Running live. Unset ORDERCORE_API_KEY to run offline in mock mode.)');
  process.exit(1);
});
