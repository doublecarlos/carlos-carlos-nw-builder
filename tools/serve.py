"""Static dev server for the builder, with caching disabled.

`python -m http.server` sends `Last-Modified`, and browsers happily reuse a cached script even
after you edit it -- which silently makes you test stale code. This sends `Cache-Control:
no-store` on everything, so a reload always reflects what is on disk.

The app itself needs no server at all (classic scripts, no fetch, no modules -- `index.html`
opens straight from the filesystem). This exists only so browser automation, which cannot read
`file://` URLs, can reach the test pages.

Usage:
    ./venv/Scripts/python.exe tools/serve.py [--port 8000]
"""

import argparse
import functools
import http.server
import os
import socketserver
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nwtools import REPO_ROOT      # noqa: E402


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Only surface problems; a page load is ~10 requests and drowns the console.
        status = args[1] if len(args) > 1 else ''
        if not str(status).startswith('2'):
            super().log_message(fmt, *args)


class ReusableServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--port', type=int, default=8000)
    args = ap.parse_args()

    handler = functools.partial(NoCacheHandler, directory=REPO_ROOT)
    with ReusableServer(('127.0.0.1', args.port), handler) as httpd:
        print(f'serving {REPO_ROOT} at http://localhost:{args.port}/  (no-store)')
        print(f'  tests   http://localhost:{args.port}/tests.html')
        print(f'  differ  http://localhost:{args.port}/tests/differ.html')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
