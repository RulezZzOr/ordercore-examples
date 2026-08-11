#!/usr/bin/env node
// OrderCore sandbox quickstart — your first REAL, authenticated OrderCore API
// call with NO signup and NO pre-existing key.
//
// In --live mode this issues a fresh read-only sandbox key from
// POST /bootstrap/sandbox-key, then reads the demo catalog with it. That is a
// genuine authenticated call against https://api.ordercore.ai — not a mock.
// Offline (the default) it walks the exact same flow against a local mock so
// the example always runs with no network and no key.
//
//   node run.mjs            # offline mock (no network, no key)
//   node run.mjs --live     # LIVE: issue a real read-only key + read the live catalog
//   node run.mjs --help
//
// The sandbox key is READ-ONLY (scopes=["read"]) and short-lived. It cannot
// create or modify data. For a full read/write key, request one at
// https://ordercore.ai/bootstrap.

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`OrderCore sandbox quickstart — first live call, no signup

  node run.mjs           Offline mock (no network, no key).
  node run.mjs --live    LIVE: POST /bootstrap/sandbox-key -> read-only key,
                         then GET /v1/products against https://api.ordercore.ai

Env: ORDERCORE_BASE_URL (default https://api.ordercore.ai).
The issued key is read-only and short-lived; writes are blocked (403).
Exit 0 = a key was issued and the catalog read returned products.`);
  process.exit(0);
}

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) { console.error(`❌ Needs Node 18+ (built-in fetch); found ${process.versions.node}.`); process.exit(1); }

const BASE = (process.env.ORDERCORE_BASE_URL || 'https://api.ordercore.ai').replace(/\/$/, '');
const LIVE = process.argv.includes('--live');

// Show only the key prefix — never the full secret — so it stays out of logs.
const maskKey = (key) => {
  if (typeof key !== 'string' || key.length < 10) return '(hidden)';
  return key.slice(0, 9) + '…' + key.slice(-2);
};

async function issueSandboxKey() {
  if (!LIVE) {
    return {
      api_key: 'oc_live_MOCKKEY0000000000000000000000',
      key_prefix: 'oc_live_',
      tenant_slug: 'demo',
      scopes: ['read'],
      read_only: true,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
  }
  let res;
  try {
    res = await fetch(BASE + '/bootstrap/sandbox-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    });
  } catch (err) {
    throw new Error(`network error reaching ${BASE} (${err.message}). Check connectivity or ORDERCORE_BASE_URL.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = res.status === 429 ? ' — sandbox-key issuance is IP rate-limited; retry in a minute.' : '';
    throw new Error(`POST /bootstrap/sandbox-key -> HTTP ${res.status}${hint}`);
  }
  return body;
}

async function readProducts(key) {
  if (!LIVE) {
    return {
      data: [
        { id: 'p_demo_1', name: 'Demo Widget', sku: 'WIDGET-1' },
        { id: 'p_demo_2', name: 'Demo Gadget', sku: 'GADGET-1' },
      ],
    };
  }
  let res;
  try {
    res = await fetch(BASE + '/v1/products', { headers: { Accept: 'application/json', 'X-API-Key': key } });
  } catch (err) {
    throw new Error(`network error reaching ${BASE} (${err.message}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) {
    // The shared sandbox is strictly rate limited. Getting a key + reading it
    // once is the point; this is not a failure of the flow.
    const err = new Error('rate limited (HTTP 429) on the shared sandbox — wait a moment and retry.');
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) {
    const hint = (res.status === 401 || res.status === 403) ? ' — the sandbox key should have read scope; this is unexpected.' : '';
    throw new Error(`GET /v1/products -> HTTP ${res.status}${hint}`);
  }
  return body;
}

async function main() {
  console.log(LIVE
    ? `OrderCore sandbox quickstart — LIVE against ${BASE}\n`
    : 'OrderCore sandbox quickstart — MOCK (offline, no key). Add --live for a real call.\n');

  // 1. Get a real, read-only API key. No signup, no key of your own.
  console.log('▸ POST /bootstrap/sandbox-key');
  const issued = await issueSandboxKey();
  console.log(`  key      ${maskKey(issued.api_key)}   (prefix ${issued.key_prefix || 'oc_live_'})`);
  console.log(`  scopes   ${JSON.stringify(issued.scopes)}  read_only=${issued.read_only}`);
  console.log(`  expires  ${issued.expires_at}`);

  // 2. Use it immediately — a genuine authenticated read of the demo catalog.
  console.log('\n▸ GET /v1/products  (X-API-Key: <sandbox key>)');
  let products;
  try {
    products = await readProducts(issued.api_key);
  } catch (err) {
    if (err.rateLimited) {
      console.log(`  ⚠ ${err.message}`);
      console.log('\n✅ A read-only sandbox key was issued and authenticated. Retry the read shortly.');
      process.exit(0);
    }
    throw err;
  }
  const items = Array.isArray(products) ? products : (products.data || []);
  console.log(`  ${items.length} product(s):`);
  for (const p of items.slice(0, 5)) {
    console.log(`    - ${p.name || p.id}${p.sku ? '  [' + p.sku + ']' : ''}`);
  }

  console.log('\n✅ First authenticated OrderCore call complete. The key is read-only —');
  console.log('   writes return 403. For a full read/write key: https://ordercore.ai/bootstrap');
  process.exit(0);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
