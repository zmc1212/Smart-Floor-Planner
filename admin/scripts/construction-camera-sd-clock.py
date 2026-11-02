"""Private read-only clock/card adapter. No device writes or credential output."""
import datetime as dt
import hashlib
import json
import os
import pathlib
import sys


def main():
    device, channel = sys.argv[1:3]
    mapping = json.loads(pathlib.Path(os.environ['CAMERA_SD_DEVICES_FILE']).read_text(encoding='utf-8-sig'))
    target = mapping[device + '/' + channel]
    sys.path.insert(0, os.environ['CAMERA_SD_VENDOR_ADAPTER'])
    from core import Camera
    camera = Camera(ip=target['ip'], port=target['port'], username=target['username'], password=target['password'])
    serial = camera.login().get('SerialNumber')
    if not serial or serial != target['serial']:
        raise ValueError('identity')
    storage = camera.call('frmIotRecordCfg')
    if storage.get('SDStatus') != 1 or storage.get('SDInfo', 0) <= 0 or storage.get('RecordMode') != 3:
        raise ValueError('continuous_card')
    parts = camera.call('frmDeviceTimeCtrl')['Time']
    if not isinstance(parts, list) or len(parts) != 6 or any(type(x) is not int for x in parts):
        raise ValueError('clock')
    stamp = dt.datetime(*parts, tzinfo=dt.timezone(dt.timedelta(hours=8)))
    print(json.dumps({'source': stamp.isoformat(), 'serialHash': hashlib.sha256(serial.encode()).hexdigest()}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Vendor exceptions may contain addresses or credentials. Keep them private.
        print('{"error":"camera_sd_clock_unavailable"}')
        sys.exit(1)
