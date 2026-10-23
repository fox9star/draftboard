"""Local server for Draftboard.

Serves this folder at http://127.0.0.1:8080 and tells the browser to check for
changes on every load, so updated files are picked up right away.

    python serve.py              # http://127.0.0.1:8080
    python serve.py --port 9000
"""
import argparse
import functools
import http.server
import os


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="Serve Draftboard locally.")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print(f"Draftboard: http://{args.bind}:{args.port}/  (Ctrl+C로 종료)", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
