/** Type definitions for the OrderCore Node.js SDK. */

export const DEFAULT_BASE_URL: string;
export const VERSION: string;

export interface OrderCoreOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  retryBaseMs?: number;
}

/** Options for `OrderCore.sandbox()` — the constructor options minus `apiKey`. */
export type SandboxOptions = Omit<OrderCoreOptions, 'apiKey'>;

export interface RequestOptions {
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface IdempotentWriteOptions {
  idempotencyKey?: string;
}

export interface OrderItemInput {
  sku_id: string;
  quantity: number;
}

export interface OrderCreateInput {
  customer_id: string;
  items: OrderItemInput[];
  external_id?: string;
  metadata?: Record<string, unknown>;
}

export declare class OrderCoreError extends Error {
  status: number | null;
  code: string | null;
  body: unknown;
  request: { method: string; path: string } | null;
}

export declare class OrderCore {
  constructor(options: OrderCoreOptions);

  /**
   * Create a ready-to-use client backed by a fresh READ-ONLY sandbox key — no
   * signup, no key of your own. Writes return 403; the key is short-lived and
   * strictly rate limited. For a full read/write key: https://ordercore.ai/bootstrap
   */
  static sandbox(options?: SandboxOptions): Promise<OrderCore>;

  apiKey: string;
  baseUrl: string;

  account: {
    auth(): Promise<any>;
    status(): Promise<any>;
    usage(): Promise<any>;
    readiness(): Promise<any>;
  };

  products: {
    list(params?: Record<string, unknown>): Promise<any>;
    get(productId: string): Promise<any>;
    create(body: Record<string, unknown>): Promise<any>;
    update(productId: string, body: Record<string, unknown>): Promise<any>;
    delete(productId: string): Promise<any>;
  };

  skus: { get(skuCode: string): Promise<any> };

  inventory: {
    list(params?: Record<string, unknown>): Promise<any>;
    adjust(body: Record<string, unknown>): Promise<any>;
    reserve(body: Record<string, unknown>): Promise<any>;
    release(body: Record<string, unknown>): Promise<any>;
  };

  prices: { list(params?: Record<string, unknown>): Promise<any> };

  orders: {
    create(body: OrderCreateInput, options?: IdempotentWriteOptions): Promise<any>;
    list(params?: Record<string, unknown>): Promise<any>;
    get(orderId: string): Promise<any>;
    confirm(orderId: string, options?: IdempotentWriteOptions): Promise<any>;
    cancel(orderId: string, options?: IdempotentWriteOptions): Promise<any>;
  };

  onboarding: { demoData(body?: Record<string, unknown>): Promise<any> };

  webhooks: {
    listEndpoints(): Promise<any>;
    createEndpoint(body: Record<string, unknown>): Promise<any>;
    deleteEndpoint(endpointId: string): Promise<any>;
  };

  checkout: {
    createSession(body: Record<string, unknown>, options?: RequestOptions): Promise<any>;
    updateSession(sessionId: string, body: Record<string, unknown>): Promise<any>;
    completeSession(sessionId: string, body?: Record<string, unknown>): Promise<any>;
  };

  request(method: string, path: string, options?: RequestOptions): Promise<any>;
}

export default OrderCore;
