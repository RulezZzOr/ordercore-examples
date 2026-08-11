#!/usr/bin/env python3
"""OrderCore agent-commerce demo (Python): catalog + idempotent checkout for an AI agent.

Runs in MOCK mode by default (no key, offline). Set ORDERCORE_API_KEY for LIVE mode.

    python3 run.py                                 # mock mode, offline, no signup
    ORDERCORE_API_KEY=oc_live_x python3 run.py     # live against api.ordercore.ai
    python3 run.py --help                          # options

This is the exact sequence an AI agent performs via OrderCore's tools/MCP:
    create_checkout_session -> complete_checkout_session (idempotent order).
We complete the same session twice to prove retries never double-charge.

Standard library only (urllib) — no pip install.
"""
import json
import os
import sys
import urllib.error
import urllib.request

HELP = """OrderCore agent-commerce demo (Python)

  python3 run.py                 Mock mode (offline, no key, no signup).
  ORDERCORE_API_KEY=oc_... \\
    python3 run.py               Live mode against https://api.ordercore.ai

Env vars:
  ORDERCORE_API_KEY   Live key from https://ordercore.ai/bootstrap (3-day trial). Unset = mock.
  ORDERCORE_BASE_URL  Override API base (default https://api.ordercore.ai).
  ORDERCORE_SKU_ID    A real SKU UUID from your catalog (live mode only).

Exit code 0 = the retried checkout returned the same order (idempotency held)."""

if "--help" in sys.argv or "-h" in sys.argv:
    print(HELP)
    sys.exit(0)

BASE_URL = os.environ.get("ORDERCORE_BASE_URL", "https://api.ordercore.ai").rstrip("/")
API_KEY = os.environ.get("ORDERCORE_API_KEY", "").strip()
LIVE = bool(API_KEY)
SKU_ID = os.environ.get("ORDERCORE_SKU_ID", "00000000-0000-0000-0000-000000000001")

_mock_state = {}


def _mock(path, body):
    if path.endswith("/checkout-access-tokens"):
        return {"token": "mock_checkout_token"}
    if path.endswith("/checkout/sessions"):
        _mock_state["sess_demo_1"] = {"order_id": None}
        return {"id": "gid://ordercore.ai/Checkout/sess_demo_1", "status": "open", "currency": body["currency"]}
    sid = path.split("/checkout/sessions/")[1].split("/")[0]
    state = _mock_state[sid]
    if path.endswith("/complete"):
        if not state["order_id"]:
            state["order_id"] = "ord_9F3K21"  # created once; reused on retry
        return {"session_id": sid, "status": "completed", "order": {"id": state["order_id"], "idempotent": True}}
    return {"session_id": sid, "status": "open"}


def call(step, path, body=None, token=None):
    if not LIVE:
        return _mock(path, body)
    headers = {"Content-Type": "application/json"}
    headers["X-Checkout-Token" if token else "X-API-Key"] = token or API_KEY
    data = json.dumps(body).encode() if body is not None else b"{}"
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        hint = {
            401: " — check ORDERCORE_API_KEY is valid and has write/checkout scope.",
            403: " — check ORDERCORE_API_KEY is valid and has write/checkout scope.",
            404: " — session/endpoint not found; check ORDERCORE_SKU_ID and ORDERCORE_BASE_URL.",
        }.get(e.code, "")
        raise SystemExit(f"\n❌ [{step}] OrderCore returned HTTP {e.code}{hint}\n   {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        raise SystemExit(f"\n❌ [{step}] network error reaching {BASE_URL} ({e.reason}). Check connectivity or ORDERCORE_BASE_URL.")


def log(label, data):
    print(f"\n▸ {label}\n{json.dumps(data, indent=2)}")


def order_of(r):
    return (r.get("order") or {}).get("id") or r.get("order_id") or r.get("id")


def main():
    print(
        f"OrderCore agent-commerce demo (Python) — LIVE against {BASE_URL}"
        if LIVE else
        "OrderCore agent-commerce demo (Python) — MOCK (offline, no key). Set ORDERCORE_API_KEY for live; --help for options."
    )
    token = call("token", "/v1/account/checkout-access-tokens").get("token") if LIVE else None

    session = call("create_checkout_session", "/ucp/public/checkout/sessions",
                   {"line_items": [{"item": {"id": SKU_ID}, "quantity": 2}], "currency": "USD"}, token)
    log("Agent tool: create_checkout_session", session)
    sid = session["id"].split("/Checkout/")[-1]

    pay = {"session_id": sid, "payment_data": {"handler_id": "card", "payment_intent_id": "pi_demo_confirmed"}}
    first = call("complete_checkout_session", f"/ucp/public/checkout/sessions/{sid}/complete", pay, token)
    log("Agent tool: complete_checkout_session (attempt 1)", first)

    # Retry the SAME session — network hiccup, agent re-runs the tool. One order, not two.
    retry = call("complete_checkout_session", f"/ucp/public/checkout/sessions/{sid}/complete", pay, token)
    log("Agent tool: complete_checkout_session (retry, same session)", retry)

    idempotent = order_of(first) and order_of(first) == order_of(retry)
    print("\n" + "─" * 60)
    if idempotent:
        print(f"✅ AHA: retry returned the SAME order ({order_of(first)}). No duplicate, no double charge.")
    else:
        print(f"⚠️  Orders differed on retry: {order_of(first)} vs {order_of(retry)} — idempotency did not hold.")
    print("This is the part you would otherwise build by hand: Stripe wiring + order DB + idempotency keys.")
    sys.exit(0 if idempotent else 1)


if __name__ == "__main__":
    main()
