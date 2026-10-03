"""Authenticated local HTTP adapter for rembg; no paid image APIs."""
import base64
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from PIL.Image import DecompressionBombError as ImageError

from processor import MAX_IMAGE_BYTES, cutout_png


def authorized(header: str, supabase_url: str, anon_key: str) -> bool:
    if not header.startswith("Bearer ") or len(header) > 8192:
        return False
    request = Request(
        f"{supabase_url.rstrip('/')}/auth/v1/user",
        headers={"Authorization": header, "apikey": anon_key},
    )
    try:
        with urlopen(request, timeout=10) as response:
            return bool(json.load(response).get("id"))
    except (HTTPError, URLError, TimeoutError, ValueError):
        return False


def make_handler(supabase_url, anon_key, session, remove):
    inference_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            # Never log user photos, tokens or request headers.
            pass

        def respond(self, status, body):
            value = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(value)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(value)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, {"ok": True})
            else:
                self.respond(404, {"error": "Not found"})

        def do_POST(self):
            if self.path != "/v1/wardrobe/cutout":
                self.respond(404, {"error": "Not found"})
                return
            if not authorized(
                self.headers.get("Authorization", ""), supabase_url, anon_key
            ):
                self.respond(401, {"error": "Unauthorized"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if not 0 < length <= MAX_IMAGE_BYTES:
                self.respond(413, {"error": "Invalid image size"})
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "image/jpeg":
                self.respond(415, {"error": "Expected normalized JPEG"})
                return
            if not inference_lock.acquire(blocking=False):
                self.respond(503, {"error": "Processor busy; retry later"})
                return
            try:
                self.connection.settimeout(20)
                data = self.rfile.read(length)
                if len(data) != length:
                    raise ValueError("Incomplete image")
                png = cutout_png(data, session, remove)
                self.respond(200, {"pngBase64": base64.b64encode(png).decode("ascii")})
            except (ValueError, OSError, ImageError):
                self.respond(422, {"error": "Image could not be processed"})
            except Exception:
                self.respond(500, {"error": "Background removal failed"})
            finally:
                inference_lock.release()

    return Handler


def main():
    from rembg import new_session, remove

    supabase_url = os.environ["SUPABASE_URL"]
    anon_key = os.environ["SUPABASE_ANON_KEY"]
    if not supabase_url.startswith("https://"):
        raise ValueError("SUPABASE_URL must use HTTPS")
    model = os.environ.get("WARDROBE_CUTOUT_MODEL", "u2netp")
    if model not in {"u2netp", "u2net"}:
        raise ValueError("Only local U2-Net models are supported")
    session = new_session(model, providers=["CPUExecutionProvider"])
    handler = make_handler(supabase_url, anon_key, session, remove)
    server = ThreadingHTTPServer(
        (os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PORT", "7010"))),
        handler,
    )
    print("Wardrobe cutout CPU service ready", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
