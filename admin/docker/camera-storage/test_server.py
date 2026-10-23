import importlib.util
import os
import types
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("camera_storage_probe", Path(__file__).with_name("server.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class CapacityProbeTests(unittest.TestCase):
    def test_actual_capacity_uses_available_blocks_and_never_writes(self):
        usage = types.SimpleNamespace(f_blocks=100, f_frsize=4096, f_bavail=15,
                                      f_bfree=20, f_files=300, f_favail=100)
        with patch.dict(os.environ, {"STORAGE_NODE_ID": "synthetic-only"}), \
             patch.object(probe.os.path, "ismount", return_value=True), \
             patch.object(probe.os.path, "isdir", return_value=True), \
             patch.object(probe.os, "statvfs", return_value=usage, create=True) as stat:
            value = probe.sample()
        self.assertEqual(value["availableBytes"], str(15 * 4096))
        self.assertEqual(value["freeBytes"], str(20 * 4096))
        self.assertEqual(value["availableFiles"], "100")
        self.assertEqual(value["node"], "synthetic-only")
        stat.assert_called_once_with(os.path.join("/media", "record"))

    def test_missing_media_mount_cannot_report_the_container_root_as_healthy(self):
        with patch.object(probe.os.path, "ismount", return_value=False), \
             patch.object(probe.os, "statvfs", create=True) as stat:
            with self.assertRaises(OSError):
                probe.sample()
        stat.assert_not_called()

    def test_windows_bind_does_not_treat_synthetic_inode_totals_as_real_capacity(self):
        usage = types.SimpleNamespace(f_blocks=100, f_frsize=4096, f_bavail=15,
                                      f_bfree=20, f_files=999, f_favail=1000000)
        with patch.dict(os.environ, {"STORAGE_NODE_ID": "synthetic-only",
                                     "STORAGE_INODE_MODE": "unavailable"}), \
             patch.object(probe.os.path, "ismount", return_value=True), \
             patch.object(probe.os.path, "isdir", return_value=True), \
             patch.object(probe.os, "statvfs", return_value=usage, create=True):
            value = probe.sample()
        self.assertEqual(value["files"], "0")
        self.assertEqual(value["availableFiles"], "0")
        self.assertEqual(value["availableBytes"], str(15 * 4096))


if __name__ == "__main__":
    unittest.main()
