"""Regression tests for portable controller validation and SysEx encoding."""

from __future__ import annotations

import json
import pathlib
import sys
import types
import unittest


MULTIFX_DIR = pathlib.Path(__file__).resolve().parents[1]
# The production bridge exits early when mido is unavailable. These tests only
# exercise pure validation/serialization helpers, so a placeholder module keeps
# them independent of the host's ALSA/Windows MIDI installation.
sys.modules.setdefault("mido", types.SimpleNamespace())
sys.path.insert(0, str(MULTIFX_DIR))

import pipedal_encoder_bridge as bridge  # noqa: E402


class ControllerHardwareConfigTests(unittest.TestCase):
    """Protect the schema upgrade and firmware transaction contract."""

    def factory_config(self):
        """Load a fresh copy of the deployed factory controller JSON."""
        with (MULTIFX_DIR / "controller-config.json").open(
            "r", encoding="utf-8"
        ) as source:
            return json.load(source)

    def test_factory_config_validates(self):
        """The checked-in reference template must pass bridge validation."""
        validated = bridge._validate_controller_config(self.factory_config())
        self.assertEqual(validated["schemaVersion"], 2)
        self.assertEqual(len(validated["hardware"]["analogControls"]), 4)

    def test_v02_gpio_switch_migrates_once(self):
        """Only the immediately previous gpioPin field becomes a source."""
        old = {
            "schemaVersion": 1,
            "switches": [{"hardwareSwitch": 1, "gpioPin": 6}],
        }
        migrated = bridge._migrate_controller_config(old)
        self.assertEqual(migrated["schemaVersion"], 2)
        self.assertEqual(
            migrated["switches"][0]["input"],
            {"type": "gpio", "pin": 6},
        )
        self.assertIn("hardware", migrated)

    def test_duplicate_gpio_is_rejected(self):
        """A pot cannot silently share a pin already owned by a switch."""
        config = self.factory_config()
        config["hardware"]["analogControls"][0]["input"]["pin"] = 6
        with self.assertRaisesRegex(ValueError, "assigned more than once|used by"):
            bridge._validate_controller_config(config)

    def test_factory_transaction_is_midi_safe_and_complete(self):
        """Every emitted data byte is seven-bit and all record sizes agree."""
        config = bridge._validate_controller_config(self.factory_config())
        messages = bridge.make_hardware_config_messages(config, token=7)
        self.assertEqual(len(messages), 19)
        self.assertEqual(len(messages[0]), 11)
        self.assertEqual(len(messages[-1]), 7)
        self.assertEqual(messages[0][5], bridge.CMD_CONFIG_BEGIN)
        self.assertEqual(messages[-1][5], bridge.CMD_CONFIG_COMMIT)
        self.assertTrue(all(
            0 <= byte < 128 for message in messages for byte in message
        ))

    def test_mux_source_encodes_with_transaction_module_index(self):
        """Durable module IDs become compact indexes only on the MIDI wire."""
        config = self.factory_config()
        config["hardware"]["modules"] = [{
            "id": "mux1",
            "label": "PEDAL MUX",
            "driver": "hc4067",
            "signalPin": 10,
            "selectPins": [39, 40, 41, 42],
            "enablePin": None,
        }]
        config["switches"][0]["input"] = {
            "type": "module", "moduleId": "mux1", "channel": 6
        }
        # Free the original switch GPIO and every newly claimed module pin.
        config["switches"][6]["input"] = None
        config["switches"][7]["input"] = None
        validated = bridge._validate_controller_config(config)
        messages = bridge.make_hardware_config_messages(validated, token=9)
        switch_record = next(
            message for message in messages
            if message[5] == bridge.CMD_CONFIG_SWITCH and message[7] == 1
        )
        self.assertEqual(
            switch_record[8:11],
            [bridge.SOURCE_MUX, 1, 6],
        )


if __name__ == "__main__":
    unittest.main()
