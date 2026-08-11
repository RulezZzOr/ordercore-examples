# LangChain checkout agent

OrderCore commerce tools as plain LangChain `@tool` functions —
`search_products`, `create_checkout_session`, and the **idempotent**
`complete_checkout_session` — plus a complete agent loop. The agent shops,
checks out, retries the payment call, and gets the same order back instead of
charging twice.

```bash
pip install langchain-core   # the only hard dependency
python3 run.py               # offline: scripted model + mock commerce API, no keys
```

Exit code `0` = the retried completion returned the same order.

## Going live

```bash
pip install langchain-anthropic

# Live Claude (claude-opus-5) + mock commerce API:
ANTHROPIC_API_KEY=sk-ant-... python3 run.py

# Fully live — real model, real OrderCore (key: https://ordercore.ai/bootstrap):
ANTHROPIC_API_KEY=... ORDERCORE_API_KEY=oc_live_... python3 run.py
```

## Drop the tools into your own agent

The three `@tool` functions have no dependency on the loop in this file — bind
them to any LangChain chat model or LangGraph agent:

```python
from run import TOOLS

model = ChatAnthropic(model="claude-opus-5").bind_tools(TOOLS)
# or: create_react_agent(model, TOOLS) with LangGraph
```

The `complete_checkout_session` docstring tells the model retries are safe —
that promise holds because OrderCore returns the same order for the same
session. Details: https://ordercore.ai/idempotent-orders-for-ai-agents

Siblings: [Claude tool-use loop](../claude-checkout-agent/) ·
[OpenAI function calling](../openai-checkout-agent/) ·
[MCP server](https://ordercore.ai/what-is-an-mcp-commerce-server) (zero loop code)
