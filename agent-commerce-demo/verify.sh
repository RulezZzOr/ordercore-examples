#!/usr/bin/env bash
# Verify the agent-commerce demo runs and idempotency holds, in every available runtime.
# Offline mock mode — no key, no signup, no network. Exit 0 = all good.
set -u
cd "$(dirname "$0")"

pass=0; fail=0
check() {  # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  ✅ $label"; pass=$((pass+1))
  else
    echo "  ❌ $label (exit $?)"; fail=$((fail+1))
  fi
}

echo "Verifying OrderCore agent-commerce demo (offline mock mode)..."

if command -v node >/dev/null 2>&1; then
  check "node run.mjs (exit 0 = idempotency held)" node run.mjs
else
  echo "  ⏭️  node not found — skipping Node demo"
fi

if command -v python3 >/dev/null 2>&1; then
  check "python3 run.py (exit 0 = idempotency held)" python3 run.py
else
  echo "  ⏭️  python3 not found — skipping Python demo"
fi

echo ""
if [ "$fail" -eq 0 ] && [ "$pass" -gt 0 ]; then
  echo "All $pass check(s) passed. Next: get a key at https://ordercore.ai/bootstrap and re-run with ORDERCORE_API_KEY set."
  exit 0
else
  echo "$fail check(s) failed, $pass passed."
  exit 1
fi
