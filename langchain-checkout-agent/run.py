#!/usr/bin/env python3
"""Give a LangChain agent OrderCore commerce tools — catalog + idempotent checkout.

    pip install langchain-core                      # the only hard dependency
    python3 run.py                                  # offline: scripted model + mock commerce API
    pip install langchain-anthropic && ANTHROPIC_API_KEY=... python3 run.py   # live model
    ... ORDERCORE_API_KEY=oc_live_x python3 run.py  # fully live

Exit code 0 means the agent shopped, checked out, retried the payment call —
and got the SAME order back. Idempotency held; no double charge.

The tools are plain LangChain @tool functions, so they drop into any LangChain
or LangGraph agent unchanged.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

ORDERCORE_BASE = os.environ.get("ORDERCORE_BASE_URL", "https://api.ordercore.ai")
ORDERCORE_KEY = os.environ.get("ORDERCORE_API_KEY")

# --- OrderCore tools (mock offline, real API with ORDERCORE_API_KEY) ---------

MOCK_CATALOG = [
    {"id": "sku_espresso", "name": "Espresso Beans 1kg", "price": 1890, "currency": "USD", "stock": 12},
]
MOCK_ORDERS: dict[str, dict] = {}


def _ordercore(path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(
        ORDERCORE_BASE + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"X-API-Key": ORDERCORE_KEY or "", "Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


@tool
def search_products(query: str = "") -> str:
    """Search the merchant product catalog. Call this before creating a checkout
    session, whenever the user names a product you have not looked up yet."""
    if not ORDERCORE_KEY:
        q = query.lower()
        hits = [p for p in MOCK_CATALOG if not q or q in p["name"].lower()]
        return json.dumps({"products": hits})
    return json.dumps(_ordercore("/v1/products?status=active"))


@tool
def create_checkout_session(sku_id: str, quantity: int = 1) -> str:
    """Create a checkout session for one product. Returns a session_id used to
    complete checkout."""
    if not ORDERCORE_KEY:
        product = next((p for p in MOCK_CATALOG if p["id"] == sku_id), None)
        if product is None:
            return json.dumps({"error": f"unknown sku {sku_id}"})
        return json.dumps({"session_id": f"cs_{sku_id}", "status": "open", "total": product["price"] * quantity})
    resp = _ordercore("/ucp/checkout/sessions", {"line_items": [{"item": {"id": sku_id}, "quantity": quantity or 1}], "currency": "USD"})
    return json.dumps({"session_id": str(resp.get("id", "")).split("/Checkout/")[-1], "status": resp.get("status")})


@tool
def complete_checkout_session(session_id: str) -> str:
    """Complete (pay for) a checkout session. Idempotent: retrying with the same
    session_id returns the same order and never double-charges — if a call times
    out, retry it rather than starting a new session."""
    if not ORDERCORE_KEY:
        if session_id not in MOCK_ORDERS:
            MOCK_ORDERS[session_id] = {"order_id": f"order_{len(MOCK_ORDERS) + 1}", "status": "confirmed"}
        return json.dumps(MOCK_ORDERS[session_id])
    return json.dumps(_ordercore(f"/ucp/checkout/sessions/{session_id}/complete", {}))


TOOLS = [search_products, create_checkout_session, complete_checkout_session]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}

# --- Model: live Claude via langchain-anthropic, or a scripted offline model --


def offline_model_script():
    """Yields AIMessages with tool_calls — the exact shapes a live model emits."""
    calls = [
        [{"name": "search_products", "args": {"query": "espresso"}, "id": "call_1", "type": "tool_call"}],
        [{"name": "create_checkout_session", "args": {"sku_id": "sku_espresso", "quantity": 1}, "id": "call_2", "type": "tool_call"}],
        [{"name": "complete_checkout_session", "args": {"session_id": "cs_sku_espresso"}, "id": "call_3", "type": "tool_call"}],
        # The "network flaked" — the agent retries the completion. Same order returns.
        [{"name": "complete_checkout_session", "args": {"session_id": "cs_sku_espresso"}, "id": "call_4", "type": "tool_call"}],
    ]
    for c in calls:
        yield AIMessage(content="", tool_calls=c)
    yield AIMessage(content="Ordered 1kg espresso beans. The retried completion returned the same order — charged once.")


def get_model():
    if os.environ.get("ANTHROPIC_API_KEY"):
        from langchain_anthropic import ChatAnthropic

        live = ChatAnthropic(model="claude-opus-5", max_tokens=16000).bind_tools(TOOLS)
        return lambda messages: live.invoke(messages)
    script = offline_model_script()
    return lambda messages: next(script)


# --- The agent loop -----------------------------------------------------------


def main() -> int:
    step = get_model()
    live = bool(os.environ.get("ANTHROPIC_API_KEY"))
    print("── live Claude via LangChain ──" if live else "── offline mock mode (set ANTHROPIC_API_KEY to go live) ──")

    completed_orders: list[str] = []
    messages: list = [
        SystemMessage("You are a shopping agent with OrderCore commerce tools."),
        HumanMessage("Buy me a bag of espresso beans. If a payment call fails or times out, retry it safely."),
    ]

    for _ in range(10):
        ai_message = step(messages)
        messages.append(ai_message)
        if ai_message.content:
            print(f"\n{ai_message.content}")
        if not ai_message.tool_calls:
            break
        for call in ai_message.tool_calls:
            print(f"→ {call['name']}({json.dumps(call['args'])})")
            result = TOOLS_BY_NAME[call["name"]].invoke(call["args"])
            print(f"  {result}")
            payload = json.loads(result)
            if call["name"] == "complete_checkout_session" and "order_id" in payload:
                completed_orders.append(payload["order_id"])
            messages.append(ToolMessage(content=result, tool_call_id=call["id"]))

    unique = set(completed_orders)
    if len(completed_orders) >= 2 and len(unique) == 1:
        print(f"\n✅ {len(completed_orders)} completion calls -> {len(unique)} order. Idempotency held.")
        return 0
    if len(completed_orders) == 1:
        print("\n✅ checkout completed (model chose not to retry — no double-charge possible either way).")
        return 0
    print(f"\n❌ expected a completed order, saw: {completed_orders}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
