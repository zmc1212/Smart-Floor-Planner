"""Read-only service acceptance. Never print passwords, tokens or response bodies."""
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def request(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.loads(response.read(2097152))
    except urllib.error.HTTPError as exc:
        return exc.code, {}


def require(ok, label):
    if not ok:
        raise RuntimeError(label)
    print(json.dumps({"check": label, "passed": True}), flush=True)


def main():
    base = "http://wvp:18080"
    status, body = request(base + "/api/device/query/devices?page=1&count=1")
    require(status in (401, 403) or (status == 200 and body.get("code") not in (None, 0)),
            "WVP anonymous API denied")
    password = hashlib.md5(os.environ["WVP_ADMIN_PASSWORD"].encode()).hexdigest()
    query = urllib.parse.urlencode({"username": "admin", "password": password})
    status, body = request(base + "/api/user/login?" + query)
    token = body.get("data", {}).get("accessToken")
    require(status == 200 and body.get("code") == 0 and bool(token), "WVP admin login")
    headers = {"access-token": token}
    status, body = request(base + "/api/device/query/devices?page=1&count=1", headers)
    require(status == 200 and body.get("code") == 0, "WVP authenticated device read")
    status, body = request(base + "/api/server/media_server/list", headers)
    nodes = body.get("data", []) if isinstance(body, dict) else []
    require(status == 200 and body.get("code") == 0 and
            any(node.get("id") == "wvp-zlm-01" and node.get("status") is True
                for node in nodes), "WVP media node online")
    media = "http://zlm:" + os.environ["MEDIA_HTTP_PORT"]
    status, body = request(media + "/index/api/getThreadsLoad")
    require(status in (401, 403) or body.get("code") not in (None, 0),
            "ZLM anonymous control denied")
    secret = urllib.parse.urlencode({"secret": os.environ["ZLM_SECRET"]})
    status, body = request(media + "/index/api/getThreadsLoad?" + secret)
    require(status == 200 and body.get("code") == 0, "ZLM authenticated control read")
    status, _ = request("http://storage:18082/storage")
    require(status == 401, "Storage anonymous metrics denied")
    status, body = request("http://storage:18082/storage",
                           {"Authorization": "Bearer " + os.environ["STORAGE_TOKEN"]})
    require(status == 200 and body.get("node") == "wvp-zlm-01" and
            int(body.get("totalBytes", "0")) > 0, "Storage authenticated capacity")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # HTTP exception strings can contain credential-bearing query strings.
        print(json.dumps({"passed": False, "errorType": type(exc).__name__,
                          "check": str(exc) if isinstance(exc, RuntimeError) else "Service check unavailable"}))
        sys.exit(1)
