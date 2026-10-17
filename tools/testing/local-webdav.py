#!/usr/bin/env python3
"""隔离的本机 HTTPS WebDAV 验收服务。"""

import argparse
import os
import signal
from pathlib import Path

from cheroot.ssl.builtin import BuiltinSSLAdapter
from cheroot.wsgi import Server
from wsgidav.wsgidav_app import WsgiDAVApp

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", required=True, type=Path)
parser.add_argument("--certificate", required=True)
parser.add_argument("--key", required=True)
parser.add_argument("--port", default=9443, type=int)
args = parser.parse_args()
args.root.mkdir(parents=True, exist_ok=True)
password = os.environ["FOLIO_LOCAL_DAV_PASSWORD"]
app = WsgiDAVApp({
    "provider_mapping": {"/": str(args.root.resolve())},
    "http_authenticator": {"accept_basic": True, "accept_digest": False, "default_to_digest": False},
    "simple_dc": {"user_mapping": {"*": {"folio": {"password": password}}}},
    "verbose": 1,
    "logging": {"enable": False},
    "dir_browser": {"enable": False},
})
server = Server(("127.0.0.1", args.port), app)
server.ssl_adapter = BuiltinSSLAdapter(args.certificate, args.key)


def stop(_signal, _frame):
    # 由主线程收束监听与工作线程。
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
try:
    print(f"HTTPS WebDAV ready on 127.0.0.1:{args.port}", flush=True)
    server.start()
except KeyboardInterrupt:
    pass
finally:
    server.stop()
