"""Deterministic test double; never accesses the host or a model."""
import json
import sys
for line in sys.stdin:
    message = json.loads(line)
    if "id" not in message or "method" not in message:
        continue
    method = message["method"]
    if method == "challenge":
        print(json.dumps({"id": "server-question", "method": "test/question", "params": {}}), flush=True)
    if method == "malformed":
        print("not json", flush=True)
        continue
    print(json.dumps({"id": message["id"], "result": {"method": method}}), flush=True)
