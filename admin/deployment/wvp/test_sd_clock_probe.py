import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('clock_probe', Path(__file__).with_name('sd-clock-probe.py'))
probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
D = '34020000001320000005'; C = '34020000001320000006'


def xml(device=D, stamp=None):
    stamp = stamp or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%dT%H:%M:%S')
    return ('<Response><CmdType>DeviceStatus</CmdType><SN>1234</SN><DeviceID>'+device+'</DeviceID><Result>OK</Result><Online>ONLINE</Online><Status>OK</Status><DeviceTime>'+stamp+'</DeviceTime></Response>').encode()


class ClockProbeTests(unittest.TestCase):
    def test_identity_date_and_xml_validation(self):
        self.assertIn('+08:00', probe.parse_status(xml(), D)['source'])
        for raw in [xml(device=C), xml(stamp='2026-02-30T12:00:00'), xml().replace(b'</Response>', b'<DeviceTime>2026-01-01T00:00:00</DeviceTime></Response>'), b'<!DOCTYPE x>'+xml()]:
            with self.assertRaises(ValueError): probe.parse_status(raw, D)

    def observer(self, folder, replies=1, rotate=False, change_epoch=False):
        log=Path(folder)/'wvp-test.log'; log.write_bytes(xml(stamp='2020-01-01T00:00:00'))
        obj=probe.Observer({'devices':[D+'/'+C]}, folder); count=0
        def request(path, params=None):
            nonlocal count
            if path.endswith('/channels'): return {'list':[{'deviceId':C,'status':'ON'}]}
            if path.endswith('/status'):
                if rotate: log.unlink(); log.write_bytes(b'')
                with log.open('ab') as f:
                    for _ in range(replies): f.write(xml())
                return 'ONLINE'
            count+=1
            return {'deviceId':D,'onLine':True,'registerTimeStamp':1 if count==1 or not change_epoch else 2}
        obj.request=request
        return obj

    def device(self, **changes):
        value = {'deviceId': D, 'onLine': True, 'registerTimeStamp': 1, 'manufacturer': 'M', 'model': 'X', 'firmware': '1', 'transport': 'UDP', 'mediaServerId': 'zlm'}
        value.update(changes)
        return value

    def test_fresh_reply_ignores_old_payload_and_has_namespaced_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            result=self.observer(folder).sample(D,C)
            self.assertEqual(result['identityKind'],'gb28181-registration')
            self.assertEqual(result['identityVersion'],2)
            self.assertEqual(len(result['serialHash']),64)

    def test_no_fresh_or_ambiguous_reply_fails_closed(self):
        for number in [0,2]:
            with tempfile.TemporaryDirectory() as folder:
                with self.assertRaises(ValueError): self.observer(folder,replies=number).sample(D,C)

    def test_changed_registration_and_nonallowlisted_device_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): self.observer(folder,change_epoch=True).sample(D,C)
            with self.assertRaises(ValueError): self.observer(folder).sample(C,C)

    def test_registration_identity_ignores_registration_epoch(self):
        channels=[{'deviceId':C,'status':'ON'}]
        first=probe.registration(self.device(registerTimeStamp=1),C,channels)
        self.assertEqual(first,probe.registration(self.device(registerTimeStamp=987654321),C,channels))
        for field,value in [('deviceId','34020000001320000007'),('manufacturer','N'),('model','Y'),('firmware','2'),('transport','TCP'),('mediaServerId','other')]:
            self.assertNotEqual(first,probe.registration(self.device(**{field:value}),C,channels))
        other='34020000001320000008'
        self.assertNotEqual(first,probe.registration(self.device(),other,[{'deviceId':other,'status':'ON'}]))

    def test_registration_requires_a_live_positive_integer_epoch(self):
        channels=[{'deviceId':C,'status':'ON'}]
        for value in [0,-1,None,'1',True]:
            device=self.device()
            if value is None:
                device.pop('registerTimeStamp')
            else:
                device['registerTimeStamp']=value
            with self.assertRaises(ValueError):
                probe.registration(device,C,channels)


if __name__=='__main__': unittest.main()
