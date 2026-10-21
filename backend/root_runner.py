"""One-shot privileged runner, passed as a sealed memfd. No persistent daemon."""
import json
import os
import signal
import socket
import subprocess
import sys
import threading


def descendants(pid):
    result = []
    try:
        children = open(f"/proc/{pid}/task/{pid}/children").read().split()
        for child in children:
            result.extend(descendants(int(child)))
            result.append(int(child))
    except OSError:
        pass
    return result


def main():
    if os.geteuid() != 0:
        return 126
    connection = socket.socket(socket.AF_UNIX)
    connection.connect(sys.argv[1])
    connection.sendall((json.dumps({"role": "runner", "token": sys.argv[2]}) + "\n").encode())
    file = connection.makefile("rb")
    request = json.loads(file.readline(65536))
    if not request.get("authorized"):
        return 126
    child = subprocess.Popen(request["argv"], cwd=request["cwd"], env=request["env"])

    def stop(*_):
        for pid in descendants(child.pid) + [child.pid]:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    def watch():
        # Losing the supervising UI/backend connection revokes this job.
        try:
            file.readline(1024)
        finally:
            stop()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=watch, daemon=True).start()
    result = child.wait()
    connection.close()
    return result

if __name__ == "__main__":
    raise SystemExit(main())
