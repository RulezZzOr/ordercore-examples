import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { OrderCore, OrderCoreError } from './index.mjs';

// ---- mock OrderCore API -----------------------------------------------------

const state = {
  requests: [],
  ordersByKey: new Map(),
  failuresRemaining: 0,
};

const server = http.createServer((req, res) => {
  let bodyText = '';
  req.on('data', (chunk) => (bodyText += chunk));
  req.on('end', () => {
    const record = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: bodyText ? JSON.parse(bodyText) : null,
    };
    state.requests.push(record);

    const respond = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (state.failuresRemaining > 0) {
      state.failuresRemaining--;
      return respond(503, { error: 'temporarily unavailable' });
    }

    if (req.method === 'POST' && req.url === '/bootstrap/sandbox-key') {
      return respond(201, {
        api_key: 'oc_live_sandboxmock',
        key_prefix: 'oc_live_',
        tenant_slug: 'demo',
        scopes: ['read'],
        read_only: true,
      });
    }
    if (req.method === 'GET' && req.url === '/v1/account/auth') {
      return respond(200, { tenant_slug: 'mock', api_key_scopes: ['read', 'write'] });
    }
    if (req.method === 'GET' && req.url.startsWith('/v1/products')) {
      return respond(200, { products: [{ id: 'prod_1', name: 'Mock product' }] });
    }
    if (req.method === 'POST' && req.url === '/v1/orders') {
      const key = req.headers['idempotency-key'];
      if (!key) return respond(400, { error: 'missing idempotency key' });
      const existing = state.ordersByKey.get(key);
      if (existing) {
        if (JSON.stringify(existing.payload) !== bodyText) {
          return respond(409, { error: 'conflict', message: 'idempotency key reused with a different payload' });
        }
        return respond(200, existing.order);
      }
      const order = { id: `order_${state.ordersByKey.size + 1}`, status: 'pending' };
      state.ordersByKey.set(key, { payload: JSON.parse(bodyText), order });
      return respond(201, order);
    }
    return respond(404, { error: `no mock for ${req.method} ${req.url}` });
  });
});

let client;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  client = new OrderCore({
    apiKey: 'oc_test_mock',
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    retryBaseMs: 1,
  });
});

after(() => server.close());

// ---- tests ------------------------------------------------------------------

test('OrderCore.sandbox() issues a read-only key and returns a ready client', async () => {
  state.requests.length = 0;
  const oc = await OrderCore.sandbox({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  // issued the sandbox key with an unauthenticated POST
  const issue = state.requests.at(-1);
  assert.equal(issue.method, 'POST');
  assert.equal(issue.url, '/bootstrap/sandbox-key');
  assert.equal(issue.headers['x-api-key'], undefined);
  // the returned client is authenticated with the issued key
  assert.equal(oc.apiKey, 'oc_live_sandboxmock');
  await oc.products.list();
  assert.equal(state.requests.at(-1).headers['x-api-key'], 'oc_live_sandboxmock');
});

test('sends X-API-Key and SDK user agent', async () => {
  state.requests.length = 0;
  const auth = await client.account.auth();
  assert.equal(auth.tenant_slug, 'mock');
  const req = state.requests.at(-1);
  assert.equal(req.headers['x-api-key'], 'oc_test_mock');
  assert.match(req.headers['user-agent'], /^ordercore-sdk-node\//);
});

test('orders.create auto-generates an Idempotency-Key', async () => {
  state.requests.length = 0;
  await client.orders.create({ customer_id: 'c1', items: [{ sku_id: 's1', quantity: 1 }] });
  const req = state.requests.at(-1);
  assert.ok(req.headers['idempotency-key'], 'expected auto-generated Idempotency-Key header');
});

test('replaying the same key + payload returns the same order', async () => {
  const body = { customer_id: 'c1', items: [{ sku_id: 's1', quantity: 2 }] };
  const first = await client.orders.create(body, { idempotencyKey: 'replay-key' });
  const second = await client.orders.create(body, { idempotencyKey: 'replay-key' });
  assert.equal(first.id, second.id);
});

test('same key + different payload surfaces 409 with code', async () => {
  await client.orders.create(
    { customer_id: 'c1', items: [{ sku_id: 's1', quantity: 1 }] },
    { idempotencyKey: 'conflict-key' },
  );
  await assert.rejects(
    client.orders.create(
      { customer_id: 'c1', items: [{ sku_id: 's1', quantity: 99 }] },
      { idempotencyKey: 'conflict-key' },
    ),
    (error) => {
      assert.ok(error instanceof OrderCoreError);
      assert.equal(error.status, 409);
      // Real API returns {"error":"conflict","message":...}; the SDK surfaces the
      // `error` value as OrderCoreError.code.
      assert.equal(error.code, 'conflict');
      return true;
    },
  );
});

test('retries idempotency-keyed writes through transient 503s', async () => {
  state.failuresRemaining = 2;
  const order = await client.orders.create(
    { customer_id: 'c1', items: [{ sku_id: 's1', quantity: 3 }] },
    { idempotencyKey: 'retry-key' },
  );
  assert.ok(order.id);
});

test('does not retry un-keyed writes', async () => {
  state.failuresRemaining = 1;
  state.requests.length = 0;
  await assert.rejects(
    client.request('POST', '/v1/products', { body: { name: 'x' } }),
    (error) => error instanceof OrderCoreError && error.status === 503,
  );
  assert.equal(state.requests.length, 1, 'un-keyed POST must not be retried');
  state.failuresRemaining = 0;
});

test('GET retries then succeeds', async () => {
  state.failuresRemaining = 1;
  const products = await client.products.list();
  assert.equal(products.products.length, 1);
});

test('non-retryable error includes body and request context', async () => {
  await assert.rejects(client.request('GET', '/nope'), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.request.path, '/nope');
    assert.ok(error.body.error.includes('no mock'));
    return true;
  });
});
