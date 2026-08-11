"""OrderCore SDK for Python — stdlib-only client for the OrderCore API.

    from ordercore import OrderCore

    oc = OrderCore(api_key="oc_live_...")
    order = oc.orders.create(
        {"customer_id": "cust_1", "items": [{"sku_id": "sku_1", "quantity": 1}]},
        idempotency_key="first-order-001",
    )

Design goals (mirrors @ordercore/sdk for Node):
- Python 3.8+, standard library only (urllib).
- Idempotency by default: order writes always send an Idempotency-Key
  (auto-generated when not provided) so agent retries never double-order.
- Safe retries: GETs and idempotency-keyed POSTs retry on 408/429/5xx and
  network errors with exponential backoff. Un-keyed writes are never retried.

Full API guide: https://ordercore.ai/docs.md
OpenAPI spec:   https://ordercore.ai/openapi.yaml
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, Optional

__all__ = ["OrderCore", "OrderCoreError", "DEFAULT_BASE_URL", "VERSION"]

DEFAULT_BASE_URL = "https://api.ordercore.ai"
VERSION = "0.1.0"

_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class OrderCoreError(Exception):
    """API error with status/code/body context."""

    def __init__(self, message: str, *, status: Optional[int] = None,
                 code: Optional[str] = None, body: Any = None,
                 request: Optional[Dict[str, str]] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body
        self.request = request


class _Namespace:
    def __init__(self, client: "OrderCore"):
        self._client = client


class _Account(_Namespace):
    def auth(self):
        return self._client.request("GET", "/v1/account/auth")

    def status(self):
        return self._client.request("GET", "/v1/account/status")

    def usage(self):
        return self._client.request("GET", "/v1/account/usage")

    def readiness(self):
        return self._client.request("GET", "/v1/account/readiness")


class _Products(_Namespace):
    def list(self, **params):
        return self._client.request("GET", "/v1/products", params=params)

    def get(self, product_id: str):
        return self._client.request("GET", f"/v1/products/{urllib.parse.quote(product_id, safe='')}")

    def create(self, body: Dict[str, Any]):
        return self._client.request("POST", "/v1/products", body=body)

    def update(self, product_id: str, body: Dict[str, Any]):
        return self._client.request("PATCH", f"/v1/products/{urllib.parse.quote(product_id, safe='')}", body=body)

    def delete(self, product_id: str):
        return self._client.request("DELETE", f"/v1/products/{urllib.parse.quote(product_id, safe='')}")


class _Skus(_Namespace):
    def get(self, sku_code: str):
        return self._client.request("GET", f"/v1/skus/{urllib.parse.quote(sku_code, safe='')}")


class _Inventory(_Namespace):
    def list(self, **params):
        return self._client.request("GET", "/v1/inventory", params=params)

    def adjust(self, body: Dict[str, Any]):
        return self._client.request("POST", "/v1/inventory/adjust", body=body)

    def reserve(self, body: Dict[str, Any]):
        return self._client.request("POST", "/v1/inventory/reserve", body=body)

    def release(self, body: Dict[str, Any]):
        return self._client.request("POST", "/v1/inventory/release", body=body)


class _Prices(_Namespace):
    def list(self, **params):
        return self._client.request("GET", "/v1/prices", params=params)


class _Orders(_Namespace):
    def create(self, body: Dict[str, Any], idempotency_key: Optional[str] = None):
        """Create an order. Always idempotent — see module docstring."""
        return self._client.request(
            "POST", "/v1/orders", body=body,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    def list(self, **params):
        return self._client.request("GET", "/v1/orders", params=params)

    def get(self, order_id: str):
        return self._client.request("GET", f"/v1/orders/{urllib.parse.quote(order_id, safe='')}")

    def confirm(self, order_id: str, idempotency_key: Optional[str] = None):
        return self._client.request(
            "POST", f"/v1/orders/{urllib.parse.quote(order_id, safe='')}/confirm",
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )

    def cancel(self, order_id: str, idempotency_key: Optional[str] = None):
        return self._client.request(
            "POST", f"/v1/orders/{urllib.parse.quote(order_id, safe='')}/cancel",
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )


class _Onboarding(_Namespace):
    def demo_data(self, body: Optional[Dict[str, Any]] = None):
        return self._client.request("POST", "/v1/onboarding/demo-data", body=body or {})


class _Webhooks(_Namespace):
    def list_endpoints(self):
        return self._client.request("GET", "/v1/webhooks/endpoints")

    def create_endpoint(self, body: Dict[str, Any]):
        return self._client.request("POST", "/v1/webhooks/endpoints", body=body)

    def delete_endpoint(self, endpoint_id: str):
        return self._client.request(
            "DELETE", f"/v1/webhooks/endpoints/{urllib.parse.quote(endpoint_id, safe='')}"
        )


class _Checkout(_Namespace):
    def create_session(self, body: Dict[str, Any], idempotency_key: Optional[str] = None):
        return self._client.request("POST", "/ucp/checkout/sessions", body=body,
                                    idempotency_key=idempotency_key)

    def update_session(self, session_id: str, body: Dict[str, Any]):
        return self._client.request(
            "PUT", f"/ucp/checkout/sessions/{urllib.parse.quote(session_id, safe='')}", body=body
        )

    def complete_session(self, session_id: str, body: Optional[Dict[str, Any]] = None):
        return self._client.request(
            "POST", f"/ucp/checkout/sessions/{urllib.parse.quote(session_id, safe='')}/complete",
            body=body or {},
        )


class OrderCore:
    """OrderCore API client. Get a key at https://ordercore.ai/bootstrap"""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, *,
                 max_retries: int = 2, timeout: float = 30.0, retry_base_delay: float = 0.5):
        if not api_key:
            raise OrderCoreError("api_key is required (get one at https://ordercore.ai/bootstrap)")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.timeout = timeout
        self.retry_base_delay = retry_base_delay

        self.account = _Account(self)
        self.products = _Products(self)
        self.skus = _Skus(self)
        self.inventory = _Inventory(self)
        self.prices = _Prices(self)
        self.orders = _Orders(self)
        self.onboarding = _Onboarding(self)
        self.webhooks = _Webhooks(self)
        self.checkout = _Checkout(self)

    @classmethod
    def sandbox(cls, base_url: str = DEFAULT_BASE_URL, *,
                max_retries: int = 2, timeout: float = 30.0,
                retry_base_delay: float = 0.5) -> "OrderCore":
        """Create a ready-to-use client backed by a fresh READ-ONLY sandbox key.

        No signup, no key of your own: calls POST /bootstrap/sandbox-key on the
        demo tenant and returns an OrderCore authenticated with the issued key::

            oc = OrderCore.sandbox()
            oc.products.list()          # live demo catalog

        The key is read-only (writes return 403), strictly rate limited, and
        short lived. For a full read/write key: https://ordercore.ai/bootstrap
        """
        base = base_url.rstrip("/")
        req = urllib.request.Request(
            base + "/bootstrap/sandbox-key",
            data=b"{}",
            headers={"Content-Type": "application/json",
                     "User-Agent": f"ordercore-sdk-python/{VERSION}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status, raw = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read()
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise OrderCoreError(
                f"network error issuing sandbox key: {error}",
                request={"method": "POST", "path": "/bootstrap/sandbox-key"},
            )
        data = cls._parse(raw) if raw else None
        if status >= 400 or not isinstance(data, dict) or not data.get("api_key"):
            msg = (data.get("message") or data.get("error")) if isinstance(data, dict) else None
            raise OrderCoreError(
                msg or f"sandbox key issuance failed (HTTP {status})",
                status=status, body=data,
                request={"method": "POST", "path": "/bootstrap/sandbox-key"},
            )
        return cls(data["api_key"], base_url=base_url, max_retries=max_retries,
                   timeout=timeout, retry_base_delay=retry_base_delay)

    def request(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
                body: Any = None, idempotency_key: Optional[str] = None,
                headers: Optional[Dict[str, str]] = None) -> Any:
        url = self.base_url + path
        query = {k: str(v) for k, v in (params or {}).items() if v is not None}
        if query:
            url += "?" + urllib.parse.urlencode(query)

        request_headers = {
            "X-API-Key": self.api_key,
            "User-Agent": f"ordercore-sdk-python/{VERSION}",
        }
        if headers:
            request_headers.update(headers)
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        if idempotency_key:
            request_headers["Idempotency-Key"] = idempotency_key

        # Retries are safe for GETs and for writes that carry an Idempotency-Key.
        retryable = method == "GET" or bool(idempotency_key)
        attempts = self.max_retries + 1 if retryable else 1

        last_error: Optional[OrderCoreError] = None
        for attempt in range(attempts):
            if attempt:
                time.sleep(self.retry_base_delay * (2 ** (attempt - 1)))
            req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as response:
                    return self._parse(response.read())
            except urllib.error.HTTPError as error:
                payload = self._parse(error.read())
                status = error.code
                if status in _RETRYABLE_STATUS and attempt < attempts - 1:
                    last_error = OrderCoreError(f"HTTP {status}", status=status, body=payload,
                                                request={"method": method, "path": path})
                    continue
                message = f"HTTP {status}"
                code = None
                if isinstance(payload, dict):
                    message = payload.get("error") or payload.get("message") or message
                    code = payload.get("error") or payload.get("code")
                raise OrderCoreError(message, status=status, code=code, body=payload,
                                     request={"method": method, "path": path}) from None
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                last_error = OrderCoreError(f"network error: {error}",
                                            request={"method": method, "path": path})
                continue
        assert last_error is not None
        raise last_error

    @staticmethod
    def _parse(raw: bytes) -> Any:
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return raw.decode("utf-8", errors="replace")
