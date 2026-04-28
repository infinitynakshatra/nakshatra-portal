#!/usr/bin/env python3
"""
Relay collection POSTs from the Nakshatra portal to Google Apps Script.

Use when the browser shows "Failed to fetch" to https://script.google.com/...
(common on locked-down networks: the same machine can still reach Google via Python).

1. Set APPS_SCRIPT_POST_URL to your full Web App URL (…/macros/s/…/exec).
2. Run from the Nakshatra folder:
     Windows PowerShell:
       $env:APPS_SCRIPT_POST_URL="https://script.google.com/macros/s/YOUR_ID/exec"
       python scripts/collection_proxy.py
3. In infinity_nakshatra_dashboard.html set:
     const COLLECTION_API_URL = "http://127.0.0.1:8765";
4. Serve the portal over http://127.0.0.1 (same PC). If the portal is https,
   the browser will block http://127.0.0.1 (mixed content) — use http for local dev.

Default bind: 127.0.0.1 only (not exposed on LAN). Override with COLLECTION_PROXY_HOST / COLLECTION_PROXY_PORT.
"""

from __future__ import annotations

import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TARGET = os.environ.get("APPS_SCRIPT_POST_URL", "").strip()
HOST = os.environ.get("COLLECTION_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLECTION_PROXY_PORT", "8765"))


class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/" or self.path.startswith("/?"):
            msg = (
                "Nakshatra collection proxy OK. POST the same JSON body the portal would send to Apps Script; "
                "it is forwarded to APPS_SCRIPT_POST_URL. Target configured: "
                + ("yes" if TARGET else "NO — set APPS_SCRIPT_POST_URL")
            ).encode("utf-8")
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        self.send_response(404)
        self._cors_headers()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"not found")

    def do_POST(self) -> None:
        if not TARGET:
            b = b"Set environment variable APPS_SCRIPT_POST_URL to your Web App /exec URL."
            self.send_response(500)
            self._cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            n = 0
        body = self.rfile.read(n) if n else b""
        ct = self.headers.get("Content-Type") or "text/plain"
        req = Request(TARGET, data=body, method="POST", headers={"Content-Type": ct})
        try:
            with urlopen(req, timeout=120) as resp:
                code = resp.getcode()
                out = resp.read()
                out_ct = resp.headers.get("Content-Type", "application/json; charset=utf-8")
        except HTTPError as e:
            code = e.code
            out = e.read() or b""
            out_ct = (
                e.headers.get("Content-Type", "application/json; charset=utf-8")
                if e.headers
                else "text/plain; charset=utf-8"
            )
        except URLError as e:
            err = str(e).encode("utf-8", errors="replace")
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            self.wfile.write(err)
            return
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", out_ct)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    if not TARGET:
        print(
            "Warning: APPS_SCRIPT_POST_URL is not set. POST will return 500 until you export it.",
            file=sys.stderr,
        )
    print(
        f"Nakshatra collection proxy listening http://{HOST}:{PORT} -> {TARGET or '(not set)'}",
        file=sys.stderr,
    )
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
