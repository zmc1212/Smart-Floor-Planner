import copy
import hashlib
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

import deploy


class DeploymentBoundaries(unittest.TestCase):
    def test_undersized_rtp_pool_is_rejected_before_docker(self):
        for maximum in (20009, 20034):
            with self.subTest(maximum=maximum), patch.object(deploy, "run") as docker:
                with self.assertRaisesRegex(RuntimeError, "at least 36 ports"):
                    deploy.preflight({"rtpMin": 20000, "rtpMax": maximum})
                docker.assert_not_called()

    def test_manifest_rejects_corrupt_payload_before_docker(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "images.tar").write_bytes(b"corrupted")
            (root / "SHA256SUMS").write_text(hashlib.sha256(b"expected").hexdigest() + "  images.tar\n")
            with patch.object(deploy, "ROOT", root), patch.object(deploy, "run") as docker:
                with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                    deploy.verify_package()
                docker.assert_not_called()

    def test_foreign_installation_is_not_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            owner = {"installId": "own"}
            (Path(directory) / ".sfp-wvp-owner.json").write_text(json.dumps(owner))
            state = {"settings": {"dataRoot": directory, "project": "sfp-wvp"}, "owner": owner}
            foreign = [{"Config": {"Labels": {"com.smartfloor.wvp.install": "other"}}}]
            with patch.object(deploy, "project_containers", return_value=foreign):
                with self.assertRaisesRegex(RuntimeError, "another installation"):
                    deploy.assert_owner(state)

    def test_occupied_port_is_detected_without_stopping_owner(self):
        with socket.socket() as listener:
            listener.bind(("0.0.0.0", 0))
            listener.listen()
            settings = {"sipPort": listener.getsockname()[1], "httpPort": 18080,
                        "mediaPort": 8080, "storagePort": 18082, "rtpMin": 30000, "rtpMax": 30000}
            with patch.object(deploy, "run") as docker:
                with self.assertRaisesRegex(RuntimeError, "Port is occupied"):
                    deploy.check_ports(settings)
                docker.assert_not_called()
            self.assertGreater(listener.fileno(), -1)

    def test_compose_keeps_secrets_internal_and_recording_paths_shared(self):
        manifest = deploy.read_json(Path(__file__).parent / "images.json")
        state = {"settings": {"dataRoot": "/datas/sfp-wvp-data", "project": "sfp-wvp",
                             "publicIp": "203.0.113.10", "sipPort": 25060, "httpPort": 28080,
                             "mediaPort": 28081, "storagePort": 28082, "rtpMin": 32000, "rtpMax": 32035},
                 "credentials": {key: "a" * 48 for key in deploy.SECRET_KEYS},
                 "owner": {"installId": "unit-test"}}
        original = copy.deepcopy(state)
        services = deploy.make_compose(state, manifest)["services"]
        self.assertEqual(state, original)
        for name in ("mysql", "redis"):
            self.assertNotIn("ports", services[name])
        self.assertTrue(services["storage"]["ports"][0].startswith("127.0.0.1:"))
        media_source = next(item["source"] for item in services["zlm"]["volumes"] if item["target"] == "/opt/media/www")
        probe_mount = services["storage"]["volumes"][0]
        self.assertEqual(media_source, probe_mount["source"])
        self.assertTrue(probe_mount["read_only"])
        self.assertEqual(services["wvp"]["environment"]["RTP_MIN"], "32000")
        self.assertEqual(services["zlm"]["environment"]["RTP_MIN"], "32000")
        self.assertEqual(services["zlm"]["environment"]["RTP_MAX"], "32035")
        self.assertIn("32000-32035:32000-32035/tcp", services["zlm"]["ports"])
        self.assertNotIn("MYSQL_ROOT_PASSWORD", services["wvp"]["environment"])


if __name__ == "__main__":
    unittest.main()
