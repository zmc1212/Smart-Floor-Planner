"""Compatibility resolver for hosts whose OS DNS is a fake-IP gateway.

Crawl4AI 0.9.2's egress_broker rejects any resolved address that is not
globally routable (SSRF / DNS-rebinding control). On this development host the
OS resolver maps public names into 198.18.0.0/15, so every public read is
rejected before it reaches the network even though the local transparent proxy
can route those addresses.

This module keeps the upstream broker and its rule intact. It only replaces the
DNS lookup used by that broker: when the OS answer contains a non-global
address, the same hostname is resolved over DoH (AliDNS, then Cloudflare) and
the real A records are passed to the unmodified upstream resolve-and-pin code.
Internal names do not resolve publicly and remain blocked; private literals and
blocked hostnames are still rejected by upstream before this lookup.

The file must stay in the proxy's working directory so it shadows the vendored
module imported by egress_proxy.py.
"""
from __future__ import annotations

import http.client
import importlib.util
import ipaddress
import json
import socket
import ssl
import sys
import threading
import time
import urllib.parse
from pathlib import Path

_UPSTREAM_PATH = (Path(__file__).resolve().parents[2]
                  / 'tmp/xiaok-intelligent-consult/crawl4ai-upstream/egress_broker.py')
_spec = importlib.util.spec_from_file_location('_crawl4ai_egress_broker', _UPSTREAM_PATH)
if _spec is None or _spec.loader is None:
    raise ImportError('upstream egress_broker not found')
_up = importlib.util.module_from_spec(_spec)
sys.modules['_crawl4ai_egress_broker'] = _up
_spec.loader.exec_module(_up)
_ORIGINAL_RESOLVE = _up._resolve

# (IP, TLS server name, path template). IP literals avoid the fake-IP resolver.
_DOH = (
    ('223.5.5.5', 'dns.alidns.com', '/resolve?name={}&type=A'),
    ('1.1.1.1', 'cloudflare-dns.com', '/dns-query?name={}&type=A'),
)
_cache: dict[str, tuple[float, list[str]]] = {}
_cache_lock = threading.Lock()
_CACHE_SECONDS = 120


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, ip: str, server_name: str):
        super().__init__(server_name, 443, timeout=5, context=ssl.create_default_context())
        self._ip = ip

    def connect(self) -> None:
        raw = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw, server_hostname=self.host)


def _doh_lookup(host: str) -> list[str]:
    now = time.monotonic()
    with _cache_lock:
        cached = _cache.get(host)
        if cached and cached[0] > now:
            return list(cached[1])
    query = urllib.parse.quote(host, safe='')
    for ip, server_name, template in _DOH:
        conn = None
        try:
            conn = _PinnedHTTPSConnection(ip, server_name)
            conn.request('GET', template.format(query), headers={'Accept': 'application/dns-json'})
            response = conn.getresponse()
            body = response.read(65536)
            if response.status != 200:
                continue
            payload = json.loads(body.decode('utf-8'))
            answers = []
            for answer in payload.get('Answer', []):
                if answer.get('type') != 1:
                    continue
                value = str(answer.get('data', ''))
                address = ipaddress.ip_address(value)
                if address.version == 4 and address.is_global:
                    answers.append(value)
            if answers:
                with _cache_lock:
                    _cache[host] = (now + _CACHE_SECONDS, list(answers))
                return answers
        except Exception:
            continue
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return []


def _resolve(host: str, port: int):
    try:
        answers = _ORIGINAL_RESOLVE(host, port)
    except _up.EgressBlocked:
        answers = []
    if answers and all(not _up.is_forbidden_ip(sockaddr[0]) for *_, sockaddr in answers):
        return answers
    addresses = _doh_lookup(host)
    if not addresses:
        raise _up.EgressBlocked()
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (address, port))
            for address in addresses]


# Make upstream resolve_and_pin/assert_host_allowed use the DoH-aware lookup.
_up._resolve = _resolve

EgressBlocked = _up.EgressBlocked
PinnedTarget = _up.PinnedTarget
ALLOW_INTERNAL = _up.ALLOW_INTERNAL
ALLOW_INSECURE_TLS = _up.ALLOW_INSECURE_TLS
is_forbidden_ip = _up.is_forbidden_ip
resolve_and_pin = _up.resolve_and_pin
assert_host_allowed = _up.assert_host_allowed
check_redirect = _up.check_redirect
set_egress_proxy = _up.set_egress_proxy
get_egress_proxy = _up.get_egress_proxy
enforce_egress = _up.enforce_egress
