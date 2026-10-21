#!/usr/bin/python3
"""Invoked by sudo only. stdout belongs exclusively to sudo, never to logs."""
import json
import os
import socket
import sys

def main():
    with socket.socket(socket.AF_UNIX) as connection:
        connection.connect(os.environ["DECKY_CODEX_AUTH_SOCKET"])
        connection.sendall((json.dumps({"role": "askpass", "token": os.environ["DECKY_CODEX_AUTH_TOKEN"]}) + "\n").encode())
        raw = bytearray()
        while not raw.endswith(b"\n") and len(raw) < 8192:
            part = connection.recv(1024)
            if not part:
                raise SystemExit(1)
            raw.extend(part)
        answer = json.loads(raw)
        if not answer.get("password"):
            raise SystemExit(1)
        sys.stdout.write(answer["password"] + "\n")
        sys.stdout.flush()

if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(1)
