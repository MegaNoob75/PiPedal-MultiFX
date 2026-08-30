"""Regression tests for the restricted PI-MULTIFX UI updater."""

from __future__ import annotations

import pathlib
import sys
import types
import unittest
from unittest import mock


MULTIFX_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.modules.setdefault("mido", types.SimpleNamespace())
sys.path.insert(0, str(MULTIFX_DIR))

import pipedal_encoder_bridge as bridge  # noqa: E402


class MultiFXUpdateTests(unittest.TestCase):
    def test_release_versions_order_prerelease_before_stable(self):
        beta = bridge._multifx_version_key("multifx-v0.4.3-beta.1")
        stable = bridge._multifx_version_key("multifx-v0.4.3")
        newer = bridge._multifx_version_key("multifx-v0.5.0")
        self.assertLess(beta, stable)
        self.assertLess(stable, newer)
        self.assertIsNone(bridge._multifx_version_key("not-a-release"))

    def test_release_requires_package_and_matching_checksum(self):
        release = {
            "assets": [
                {"name": "PiPedal-MultiFX-RaspberryPi.zip"},
                {"name": "PiPedal-MultiFX-RaspberryPi.zip.sha256"},
            ]
        }
        self.assertTrue(bridge._release_has_installable_assets(release))
        release["assets"].pop()
        self.assertFalse(bridge._release_has_installable_assets(release))

    @mock.patch.object(bridge, "_read_multifx_update_job", return_value=None)
    @mock.patch.object(bridge, "_fetch_latest_multifx_release")
    @mock.patch.object(bridge, "_read_text_file")
    def test_status_reports_newer_stable_release(
        self,
        read_text,
        fetch_release,
        _read_job,
    ):
        read_text.return_value = "multifx-v0.4.2"
        fetch_release.return_value = ({
            "tag": "multifx-v0.4.3",
            "name": "PI-MULTIFX 0.4.3",
            "publishedAt": "2026-08-29T00:00:00Z",
            "url": "https://example.invalid/release",
        }, "")
        status = bridge.get_multifx_update_status(force_check=True)
        self.assertTrue(status["updateAvailable"])
        self.assertEqual(status["installedVersion"], "multifx-v0.4.2")
        self.assertEqual(status["latestVersion"], "multifx-v0.4.3")

    @mock.patch.object(bridge, "_write_multifx_update_job")
    @mock.patch.object(bridge.os.path, "isfile", return_value=True)
    @mock.patch.object(bridge, "get_multifx_update_status")
    @mock.patch.object(bridge.subprocess, "run")
    def test_start_uses_only_fixed_installer_action(
        self,
        run,
        get_status,
        _isfile,
        write_job,
    ):
        get_status.return_value = {
            "installedVersion": "multifx-v0.4.2",
            "latestVersion": "multifx-v0.4.3",
            "updateAvailable": True,
            "jobState": "idle",
            "message": "",
        }
        run.return_value = types.SimpleNamespace(
            returncode=0,
            stdout="",
            stderr="",
        )

        status = bridge.start_multifx_update()

        self.assertEqual(status["jobState"], "installing")
        write_job.assert_called_once()
        command = run.call_args_list[-1].args[0]
        self.assertEqual(command, [
            "systemd-run",
            "--unit", bridge.MULTIFX_UPDATE_UNIT,
            "--collect",
            "--no-block",
            "--property=Type=exec",
            bridge.MULTIFX_SETUP_COMMAND,
            "multifx",
            "--tag", "multifx-v0.4.3",
            "--yes",
            "--no-browser-refresh",
        ])

    @mock.patch.object(bridge.os, "unlink")
    @mock.patch.object(bridge, "_read_multifx_update_job")
    @mock.patch.object(bridge, "_fetch_latest_multifx_release")
    @mock.patch.object(bridge, "_read_text_file")
    def test_completed_update_status_remains_available_after_read(
        self,
        read_text,
        fetch_release,
        read_job,
        unlink,
    ):
        read_text.return_value = "multifx-v0.4.3"
        fetch_release.return_value = ({
            "tag": "multifx-v0.4.3",
            "name": "PI-MULTIFX 0.4.3",
            "publishedAt": "2026-08-29T00:00:00Z",
            "url": "https://example.invalid/release",
        }, "")
        read_job.return_value = {
            "targetVersion": "multifx-v0.4.3",
            "unit": bridge.MULTIFX_UPDATE_UNIT,
            "startedAt": 1,
        }

        status = bridge.get_multifx_update_status()

        self.assertEqual(status["jobState"], "complete")
        unlink.assert_not_called()


if __name__ == "__main__":
    unittest.main()
