"""Private, read-only capacity probe for the actual ZLM media volume."""
import datetime
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def sample():
    mount = os.environ.get("STORAGE_MOUNT", "/media")
    root = os.path.join(mount, "record")
    if not os.path.ismount(mount) or not os.path.isdir(root):
        raise OSError("Media mount unavailable")
    usage = os.statvfs(root)
    inode_mode = os.environ.get("STORAGE_INODE_MODE", "reported")
    if inode_mode not in ("reported", "unavailable"):
        raise OSError("Unknown inode evidence mode")
    # Docker Desktop's Windows bind reports synthetic inode totals (999/1000000).
    # They are not filesystem capacity; bytes remain the native-drive evidence.
    files, available_files = (usage.f_files, usage.f_favail) if inode_mode == "reported" else (0, 0)
    return {
        "version": 1, "node": os.environ["STORAGE_NODE_ID"],
        "sampledAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "totalBytes": str(usage.f_blocks * usage.f_frsize),
        "availableBytes": str(usage.f_bavail * usage.f_frsize),
        "freeBytes": str(usage.f_bfree * usage.f_frsize),
        "files": str(files), "availableFiles": str(available_files),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log Authorization or arbitrary request content.

    def reply(self, status, value):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"service": "construction-camera-storage"})
        if self.path != "/storage":
            return self.reply(404, {"error": "not_found"})
        supplied = self.headers.get("Authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + os.environ["STORAGE_TOKEN"]).encode()):
            return self.reply(401, {"error": "unauthorized"})
        try:
            self.reply(200, sample())
        except OSError:
            self.reply(503, {"error": "storage_unavailable"})


if __name__ == "__main__":
    if len(os.environ.get("STORAGE_TOKEN", "")) < 32:
        raise SystemExit("Private STORAGE_TOKEN of at least 32 characters required")
    os.environ["STORAGE_NODE_ID"]  # Required; prevents ambiguous node identity.
    ThreadingHTTPServer(("0.0.0.0", 18082), Handler).serve_forever()
