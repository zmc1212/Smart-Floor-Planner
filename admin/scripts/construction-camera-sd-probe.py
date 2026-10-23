"""Authorized local SD capability probe; formatting requires explicit --format-sd.

Example (from admin/): python scripts/construction-camera-sd-probe.py
  --wvp-root G:/workspace/<workspace>/wvp
  --credentials ../tmp/cloud-camera-sd/credentials.private.json --reboot
Credentials use the existing onboarding Camera constructor keys. Evidence never
contains them. This is a development probe, not the product recording service.
"""

import argparse
import datetime as dt
import hashlib
import ipaddress
import json
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wvp-root", required=True, type=Path)
    parser.add_argument("--credentials", required=True, type=Path)
    parser.add_argument("--reboot", action="store_true")
    parser.add_argument("--format-sd", action="store_true", help="ERASE the authorized camera's SD card using the firmware FormatList:[1] operation, then reboot")
    parser.add_argument("--camera-ip", help="Management IP observed after DHCP re-registration; serial identity is still enforced")
    parser.add_argument("--wvp-only", action="store_true", help="Use GB28181 if the device HTTP service is unavailable")
    parser.add_argument("--record-seconds", type=int, default=0, help="Create a bounded manual SD test recording, then send StopRecord")
    parser.add_argument("--device-id", default="34020000001320000003")
    parser.add_argument("--channel-id", default="34020000001320000004")
    args = parser.parse_args()
    if args.record_seconds and not 5 <= args.record_seconds <= 60:
        parser.error("--record-seconds must be between 5 and 60")
    if args.wvp_only and (args.reboot or args.format_sd):
        parser.error("--wvp-only cannot be combined with device reboot/formatting")
    if (args.device_id, args.channel_id) != ("34020000001320000003", "34020000001320000004"):
        parser.error("This probe is scoped to the authorized test device and channel")
    root = Path(__file__).resolve().parents[2]
    output = root / "tmp/cloud-camera-sd"
    output.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now(dt.timezone.utc)
    report = {"started": started.isoformat(), "timezone": "Asia/Shanghai",
              "scope": "Local authorized test camera; SD recognition and WVP device recordings",
              "wvpSourceCommit": "3fcd3ae80c30c95aeb82ef830af439a835257067",
              "cardInstalledReportedByUser": True, "checks": [],
              "sourceSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "cleanup": {"cardFormatted": False, "recordingPlanChanged": False,
                          "factoryReset": False, "playbackSessionCreated": False}}
    sys.path.insert(0, str(args.wvp_root / "onboarding"))
    from core import Camera  # Reuse the verified X-Digest/firmware adapter.
    credentials = json.loads(args.credentials.read_text(encoding="utf-8-sig"))
    if args.camera_ip:
        credentials["ip"] = args.camera_ip
    address = ipaddress.ip_address(credentials["ip"])
    if not isinstance(address, ipaddress.IPv4Address) or not address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified:
        raise ValueError("Camera management must use a reachable private IPv4 address")
    report["target"] = {"cameraManagementIp": credentials["ip"],
                        "deviceId": args.device_id, "channelId": args.channel_id}
    cam = Camera(**credentials)

    def check(name, callback):
        began = time.monotonic()
        try:
            result = callback()
            report["checks"].append({"name": name, "passed": True, "result": result,
                                     "elapsedMs": round((time.monotonic()-began)*1000)})
            print(name + ": " + json.dumps(result, ensure_ascii=False), flush=True)
            return result
        except Exception as error:
            # The reused adapter deliberately emits credential-free messages.
            report["checks"].append({"name": name, "passed": False, "error": str(error)})
            print(name + ": " + str(error), flush=True)
            return None

    def storage():
        identity = cam.login()
        if identity.get("SerialNumber") != "0383000200efd453afbc":
            raise ValueError("Camera identity differs from the authorized test camera; no device write is permitted")
        return {"identityVerified": True, "clock": cam.call("frmDeviceTimeCtrl"),
                "sd": cam.call("frmIotRecordCfg")}

    try:
        before = None if args.wvp_only else check("storage_before", storage)
        reboot = args.reboot
        if args.format_sd:
            if not before:
                raise ValueError("Cannot format without verifying the authorized camera identity")
            # Exact operation from this camera's CVSubStorage.Format handler.
            # Never use frmDeviceRestore or format internal device storage.
            check("sd_format", lambda: cam.call("frmHDFormat", {"FormatList": [1]}, 1))
            accepted = report["checks"][-1]["passed"]
            report["cleanup"]["sdFormatAccepted"] = accepted
            report["cleanup"]["cardFormatted"] = "accepted_verification_pending" if accepted else False
            reboot = reboot or accepted
        if reboot:
            if not before:
                raise ValueError("Cannot reboot without verifying the authorized camera identity")
            check("device_reboot", lambda: cam.call("frmDeviceReboot"))
            # Allow shutdown before checking that the same camera is reachable.
            time.sleep(8)
            deadline = time.monotonic() + 150
            while time.monotonic() < deadline:
                try:
                    cam.login()
                    after = storage()
                    report["storageAfterReboot"] = after
                    print("storage_after_reboot: " + json.dumps(after, ensure_ascii=False), flush=True)
                    break
                except Exception as error:
                    report["lastRecoveryError"] = str(error)
                    time.sleep(3)
            else:
                report["rebootRecovery"] = "not_reachable_within_150s"
        current = report.get("storageAfterReboot") or before or {}
        sd = current.get("sd", {})
        report["sdRecognized"] = (sd.get("SDStatus", -1) >= 0 and sd.get("SDInfo", 0) > 0) if sd else None
        environment = {}
        for line in (args.wvp_root / ".env").read_text(encoding="utf-8-sig").splitlines():
            if "=" in line and not line.startswith("#"):
                key, value = line.split("=", 1)
                environment[key] = value.strip().strip("\"'")
        origin = "http://127.0.0.1:18080"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, params=None, token=None):
            url = origin + path + ("?" + urllib.parse.urlencode(params) if params else "")
            req = urllib.request.Request(url, headers={"access-token": token} if token else {})
            with opener.open(req, timeout=35) as response:
                result = json.loads(response.read(2 * 1024 * 1024))
            if result.get("code") != 0:
                raise RuntimeError("WVP operation failed: " + str(result.get("code")))
            return result.get("data")

        login = request("/api/user/login", {"username": "admin", "password": hashlib.md5(
            environment["WVP_ADMIN_PASSWORD"].encode()).hexdigest()})
        token = login["accessToken"]
        if args.record_seconds:
            record_params = {"deviceId": args.device_id, "channelId": args.channel_id,
                             "recordCmdStr": "Record"}
            try:
                check("gb_manual_record_start", lambda: {"acknowledged": True, "data": request(
                    "/api/device/control/record", record_params, token)})
                time.sleep(args.record_seconds)
            finally:
                record_params["recordCmdStr"] = "StopRecord"
                check("gb_manual_record_stop", lambda: {"acknowledged": True, "data": request(
                    "/api/device/control/record", record_params, token)})
                report["cleanup"]["manualRecordStopAcknowledged"] = report["checks"][-1]["passed"]
            report["cleanup"]["boundedManualRecordSeconds"] = args.record_seconds
            time.sleep(5)
        day = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d")
        records = check("wvp_device_recordings", lambda: request(
            "/api/gb_record/query/" + args.device_id + "/" + args.channel_id,
            {"startTime": day + " 00:00:00", "endTime": day + " 23:59:59"}, token))
        report["recordCount"] = (records or {}).get("sumNum", 0)
        report["sdPlaybackThroughWvp"] = "unverified_requires_nonempty_recording_and_decoded_playback"
    finally:
        report["finished"] = dt.datetime.now(dt.timezone.utc).isoformat()
        file = output / ("probe-" + started.strftime("%Y%m%dT%H%M%SZ") + ".json")
        file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Evidence: " + str(file), flush=True)


if __name__ == "__main__":
    main()
