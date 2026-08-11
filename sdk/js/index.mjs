/**
 * OrderCore SDK for Node.js — zero-dependency client for the OrderCore API.
 *
 * const oc = new OrderCore({ apiKey: 'oc_live_...' });
 * const order = await oc.orders.create(
 *   { customer_id: 'cust_1', items: [{ sku_id: 'sku_1', quantity: 1 }] },
 *   { idempotencyKey: 'first-order-001' },
 * );
 *
 * Design goals:
 * - Node 18+ (global fetch), ESM, no dependencies.
 * - Idempotency by default: order creation always sends an Idempotency-Key
 *   (auto-generated when not provided) so agent retries never double-order.
 * - Safe retries: GETs and idempotency-keyed POSTs retry on 408/429/5xx and
 *   network errors with exponential backoff.
 *
 * Full API guide: https://ordercore.ai/docs.md
 * OpenAPI spec:   https://ordercore.ai/openapi.yaml
 */

import { randomUUID } from 'node:crypto';

export const DEFAULT_BASE_URL = 'https://api.ordercore.ai';
export const VERSION = '0.1.0';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class OrderCoreError extends Error {
  constructor(message, { status, code, body, request } = {}) {
    super(message);
    this.name = 'OrderCoreError';
    this.status = status ?? null;
    this.code = code ?? null;
    this.body = body ?? null;
    this.request = request ?? null;
  }
}

export class OrderCore {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey    API key (oc_live_... / oc_test_...). Get one: https://ordercore.ai/bootstrap
   * @param {string} [opts.baseUrl] Defaults to https://api.ordercore.ai
   * @param {number} [opts.maxRetries]   Retry attempts for safe requests (default 2)
   * @param {number} [opts.timeoutMs]    Per-request timeout (default 30000)
   * @param {number} [opts.retryBaseMs]  Backoff base delay (default 500)
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, maxRetries = 2, timeoutMs = 30_000, retryBaseMs = 500 } = {}) {
    if (!apiKey) throw new OrderCoreError('apiKey is required (get one at https://ordercore.ai/bootstrap)');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    this.retryBaseMs = retryBaseMs;

    this.account = {
      auth: () => this.request('GET', '/v1/account/auth'),
      status: () => this.request('GET', '/v1/account/status'),
      usage: () => this.request('GET', '/v1/account/usage'),
      readiness: () => this.request('GET', '/v1/account/readiness'),
    };

    this.products = {
      list: (params) => this.request('GET', '/v1/products', { params }),
      get: (productId) => this.request('GET', `/v1/products/${encodeURIComponent(productId)}`),
      create: (body) => this.request('POST', '/v1/products', { body }),
      update: (productId, body) => this.request('PATCH', `/v1/products/${encodeURIComponent(productId)}`, { body }),
      delete: (productId) => this.request('DELETE', `/v1/products/${encodeURIComponent(productId)}`),
    };

    this.skus = {
      get: (skuCode) => this.request('GET', `/v1/skus/${encodeURIComponent(skuCode)}`),
    };

    this.inventory = {
      list: (params) => this.request('GET', '/v1/inventory', { params }),
      adjust: (body) => this.request('POST', '/v1/inventory/adjust', { body }),
      reserve: (body) => this.request('POST', '/v1/inventory/reserve', { body }),
      release: (body) => this.request('POST', '/v1/inventory/release', { body }),
    };

    this.prices = {
      list: (params) => this.request('GET', '/v1/prices', { params }),
    };

    this.orders = {
      /**
       * Create an order. Always idempotent: sends an Idempotency-Key header,
       * auto-generated when not supplied. Replaying the same key returns the
       * original order; the same key with a different payload returns 409.
       */
      create: (body, { idempotencyKey } = {}) =>
        this.request('POST', '/v1/orders', { body, idempotencyKey: idempotencyKey ?? randomUUID() }),
      list: (params) => this.request('GET', '/v1/orders', { params }),
      get: (orderId) => this.request('GET', `/v1/orders/${encodeURIComponent(orderId)}`),
      confirm: (orderId, { idempotencyKey } = {}) =>
        this.request('POST', `/v1/orders/${encodeURIComponent(orderId)}/confirm`, {
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
      cancel: (orderId, { idempotencyKey } = {}) =>
        this.request('POST', `/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
          idempotencyKey: idempotencyKey ?? randomUUID(),
        }),
    };

    this.onboarding = {
      demoData: (body = {}) => this.request('POST', '/v1/onboarding/demo-data', { body }),
    };

    this.webhooks = {
      listEndpoints: () => this.request('GET', '/v1/webhooks/endpoints'),
      createEndpoint: (body) => this.request('POST', '/v1/webhooks/endpoints', { body }),
      deleteEndpoint: (endpointId) =>
        this.request('DELETE', `/v1/webhooks/endpoints/${encodeURIComponent(endpointId)}`),
    };

    this.checkout = {
      createSession: (body, opts) => this.request('POST', '/ucp/checkout/sessions', { body, ...opts }),
      updateSession: (sessionId, body) =>
        this.request('PUT', `/ucp/checkout/sessions/${encodeURIComponent(sessionId)}`, { body }),
      completeSession: (sessionId, body = {}) =>
        this.request('POST', `/ucp/checkout/sessions/${encodeURIComponent(sessionId)}/complete`, { body }),
    };
  }

  /**
   * Create a ready-to-use client backed by a fresh READ-ONLY sandbox key — no
   * signup, no key of your own. Calls `POST /bootstrap/sandbox-key` on the demo
   * tenant and returns an OrderCore authenticated with the issued key.
   *
   *   const oc = await OrderCore.sandbox();
   *   const { data } = await oc.products.list();   // live demo catalog
   *
   * The key is read-only (writes return 403), strictly rate limited, and short
   * lived. For a full read/write key: https://ordercore.ai/bootstrap
   *
   * @param {object} [opts] Same options as the constructor, minus `apiKey`.
   * @returns {Promise<OrderCore>}
   */
  static async sandbox({ baseUrl = DEFAULT_BASE_URL, ...opts } = {}) {
    const base = baseUrl.replace(/\/+$/, '');
    let response;
    try {
      response = await fetch(base + '/bootstrap/sandbox-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `ordercore-sdk-node/${VERSION}` },
        body: '{}',
      });
    } catch (error) {
      throw new OrderCoreError(`network error issuing sandbox key: ${error.message}`, {
        request: { method: 'POST', path: '/bootstrap/sandbox-key' },
      });
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
    if (!response.ok || !data || !data.api_key) {
      throw new OrderCoreError(
        (data && (data.message || data.error)) || `sandbox key issuance failed (HTTP ${response.status})`,
        { status: response.status, body: data, request: { method: 'POST', path: '/bootstrap/sandbox-key' } },
      );
    }
    return new OrderCore({ apiKey: data.api_key, baseUrl, ...opts });
  }

  async request(method, path, { params, body, idempotencyKey, headers: extraHeaders } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers = {
      'X-API-Key': this.apiKey,
      'User-Agent': `ordercore-sdk-node/${VERSION}`,
      ...extraHeaders,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    // Retries are safe for GETs and for writes that carry an Idempotency-Key.
    const retryable = method === 'GET' || Boolean(idempotencyKey);
    const attempts = retryable ? this.maxRetries + 1 : 1;

    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryBaseMs * 2 ** (attempt - 1)));
      }
      let response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastError = new OrderCoreError(`network error: ${error.message}`, {
          request: { method, path },
        });
        continue;
      }

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (response.ok) return data;

      if (RETRYABLE_STATUS.has(response.status) && attempt < attempts - 1) {
        lastError = new OrderCoreError(`HTTP ${response.status}`, {
          status: response.status,
          body: data,
          request: { method, path },
        });
        continue;
      }

      throw new OrderCoreError(
        (data && typeof data === 'object' && (data.error || data.message)) || `HTTP ${response.status}`,
        {
          status: response.status,
          code: data && typeof data === 'object' ? (data.error ?? data.code ?? null) : null,
          body: data,
          request: { method, path },
        },
      );
    }
    throw lastError;
  }
}

export default OrderCore;
