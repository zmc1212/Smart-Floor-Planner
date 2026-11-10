"""Private read-only WVP DeviceStatus clock observer. No SIP stack/device writes.

The pinned WVP logs the XML before returning only Online to its authenticated
status caller. Observe only bytes appended by that call, never an old log time.
"""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def gb(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{20}', value):
        raise ValueError('device')
    return value


def device_time(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}', value):
        raise ValueError('clock')
    parsed = dt.datetime.fromisoformat(value).replace(tzinfo=dt.timezone(dt.timedelta(hours=8)))
    return parsed.isoformat()


def parse_status(raw, device):
    # XML is device-controlled. Reject DTDs/entities and incomplete/duplicate
    # mandatory elements. Do not return or log the raw payload.
    if len(raw) > 32768 or b'<!' in raw.upper():
        raise ValueError('xml')
    root = ET.fromstring(raw)
    if root.tag != 'Response':
        raise ValueError('xml')
    required = ['CmdType', 'DeviceID', 'SN', 'Result', 'Online', 'Status', 'DeviceTime']
    if any(len(root.findall(k)) != 1 for k in required):
        raise ValueError('xml')
    data = {k: root.findtext(k) for k in required}
    if data['CmdType'] != 'DeviceStatus' or data['DeviceID'] != device or not re.fullmatch(r'\d{1,10}', data['SN'] or ''):
        raise ValueError('identity')
    if (data['Result'], data['Online'], data['Status']) != ('OK', 'ONLINE', 'OK'):
        raise ValueError('status')
    return {'source': device_time(data['DeviceTime']), 'sn': data['SN']}


IDENTITY_VERSION = 2


def registration(device, channel, channels):
    if device.get('deviceId') != gb(device.get('deviceId')) or device.get('onLine') is not True:
        raise ValueError('identity')
    if not any(c.get('deviceId') == channel and c.get('status') in ('ON', 1) for c in channels):
        raise ValueError('channel')
    epoch = device.get('registerTimeStamp')
    if type(epoch) is not int or epoch <= 0:
        raise ValueError('registration')
    # Stable binding identity: the registration epoch proves a live
    # registration but is deliberately excluded, so re-registration keeps the
    # same verified history. A registration change during one sample is still
    # rejected by sample(); a physical device change alters these fields.
    fields = {k: device.get(k) for k in ['deviceId', 'manufacturer', 'model', 'firmware', 'transport', 'mediaServerId']}
    fields['channelId'] = channel
    return hashlib.sha256((f'gb28181-registration-v{IDENTITY_VERSION}:' + json.dumps(fields, sort_keys=True)).encode()).hexdigest()


class Observer:
    def __init__(self, config, logs):
        self.config, self.logs = config, Path(logs)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.token = ''
        self.lock = threading.Lock()

    def request(self, path, params=None, authenticated=True):
        if authenticated and not self.token:
            login = self.request('/api/user/login', {'username': self.config['username'], 'password': hashlib.md5(self.config['password'].encode()).hexdigest()}, False)
            self.token = login['accessToken']
        url = self.config['wvpOrigin'] + path + ('?' + urllib.parse.urlencode(params) if params else '')
        headers = {'access-token': self.token} if authenticated else {}
        try:
            with self.opener.open(urllib.request.Request(url, headers=headers), timeout=8) as response:
                raw = response.read(2097153)
                if len(raw) > 2097152:
                    raise ValueError('response')
                result = json.loads(raw)
        except urllib.error.HTTPError as error:
            if error.code == 401:
                self.token = ''
            raise
        if result.get('code') != 0:
            raise ValueError('response')
        return result.get('data')

    def positions(self):
        return {p.name: (p.stat().st_ino, p.stat().st_size) for p in self.logs.glob('wvp-*.log') if p.is_file() and not p.is_symlink()}

    def appended(self, positions):
        chunks = []
        for p in self.logs.glob('wvp-*.log'):
            if not p.is_file() or p.is_symlink():
                continue
            stat = p.stat(); old = positions.get(p.name)
            start = old[1] if old and old[0] == stat.st_ino else 0
            if stat.st_size < start or stat.st_size - start > 2097152:
                raise ValueError('log')
            with p.open('rb') as stream:
                stream.seek(start); chunks.append(stream.read(2097153))
        return b'\n'.join(chunks)

    def sample(self, device, channel):
        key = gb(device) + '/' + gb(channel)
        if key not in self.config['devices']:
            raise ValueError('device')
        if not self.lock.acquire(timeout=1):
            raise ValueError('busy')
        try:
            before = self.request('/api/device/query/devices/' + device)
            if before.get('deviceId') != device:
                raise ValueError('identity')
            channels = self.request('/api/device/query/devices/' + device + '/channels', {'page': '1', 'count': '1000'})
            identity = registration(before, channel, channels['list'])
            epoch = before.get('registerTimeStamp')
            positions = self.positions(); began = time.monotonic()
            if self.request('/api/device/query/devices/' + device + '/status') != 'ONLINE':
                raise ValueError('status')
            # INFO writes may follow the request's return by a few milliseconds.
            found = []
            for _ in range(5):
                raw = self.appended(positions)
                matching = []
                for payload in re.findall(rb'<Response\b[^>]*>[\s\S]*?</Response>', raw):
                    if b'<CmdType>DeviceStatus</CmdType>' in payload:
                        if len(payload) > 32768 or b'<!' in payload.upper():
                            raise ValueError('xml')
                        try:
                            root = ET.fromstring(payload)
                        except ET.ParseError:
                            raise ValueError('xml')
                        if root.findtext('DeviceID') == device:
                            matching.append(parse_status(payload, device))
                found = matching
                if found:
                    break
                time.sleep(0.05)
            # Ambiguous concurrent replies are not guessed or replayed.
            if len(found) != 1 or time.monotonic() - began > 10:
                raise ValueError('freshness')
            after = self.request('/api/device/query/devices/' + device)
            if registration(after, channel, channels['list']) != identity or after.get('registerTimeStamp') != epoch:
                raise ValueError('registration')
            observed = dt.datetime.now(dt.timezone.utc)
            source = dt.datetime.fromisoformat(found[0]['source'])
            if abs((observed - source).total_seconds()) > 60:
                raise ValueError('skew')
            return {'source': found[0]['source'], 'serialHash': identity, 'identityKind': 'gb28181-registration', 'identityVersion': IDENTITY_VERSION, 'observedAt': observed.isoformat()}
        finally:
            self.lock.release()


def serve():
    config = json.loads(Path(os.environ['CLOCK_CONFIG']).read_text())
    observer = Observer(config, os.environ.get('CLOCK_LOGS', '/wvp-logs'))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + config['token']):
                self.send_error(401); return
            match = re.fullmatch(r'/clock/(\d{20})/(\d{20})', self.path)
            if not match:
                self.send_error(404); return
            try:
                value, status = observer.sample(*match.groups()), 200
            except Exception:
                value, status = {'error': 'camera_sd_clock_unavailable'}, 503
            raw = json.dumps(value).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

    ThreadingHTTPServer(('0.0.0.0', 18083), Handler).serve_forever()


if __name__ == '__main__':
    serve()
