"""
Load a pg_dump --inserts SQL file into a Neon database over Neon's SQL-over-HTTP
endpoint (https://<host>/sql). Used when raw TCP postgres (port 5432) isn't reachable
from the current network (e.g. an egress-restricted sandbox) but HTTPS is.

Run: python scripts/load_neon_http.py <dump.sql> <neon_connection_string>
"""
from __future__ import annotations
import re
import sys
import urllib.request
import json
from urllib.parse import urlparse

BATCH_SIZE = 20


def parse_statements(path):
    with open(path) as f:
        text = f.read()
    # strip psql meta-commands (\restrict, \unrestrict) and comment lines
    lines = [l for l in text.splitlines()
             if not l.startswith("\\") and not l.startswith("--")]
    text = "\n".join(lines)
    # naive split on ';' at end of statement (dump has no semicolons inside string literals
    # for this dataset's text columns beyond simple content; good enough here)
    stmts = [s.strip() for s in text.split(";\n") if s.strip()]
    return stmts


def post_batch(url, conn_str, stmts):
    body = json.dumps({"queries": [{"query": s} for s in stmts]}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Neon-Connection-String": conn_str,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def main():
    dump_path, conn_str = sys.argv[1], sys.argv[2]
    host = urlparse(conn_str.replace("postgresql://", "http://")).hostname
    url = f"https://{host}/sql"

    stmts = parse_statements(dump_path)
    print(f"{len(stmts)} statements to load")

    for i in range(0, len(stmts), BATCH_SIZE):
        batch = stmts[i:i + BATCH_SIZE]
        try:
            post_batch(url, conn_str, batch)
        except Exception as e:
            body = getattr(e, "read", lambda: b"")()
            print(f"FAILED batch {i}-{i+len(batch)}: {e} {body}")
            # retry one-by-one to isolate the bad statement
            for j, s in enumerate(batch):
                try:
                    post_batch(url, conn_str, [s])
                except Exception as e2:
                    body2 = getattr(e2, "read", lambda: b"")()
                    print(f"  stmt {i+j} FAILED: {s[:120]}... -> {e2} {body2}")
            continue
        print(f"loaded {i+len(batch)}/{len(stmts)}")

    print("done")


if __name__ == "__main__":
    main()
