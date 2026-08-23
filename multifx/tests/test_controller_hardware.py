"""Regression tests for portable controller validation and SysEx encoding."""

from __future__ import annotations

import json
import pathlib
import sys
import types
import unittest
from unittest import mock


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
        self.assertEqual(
            validated["hardware"]["analogControls"][0]["midiHysteresis"],
            2,
        )

    def test_existing_schema_2_gets_balanced_analog_response(self):
        """Configs saved before v4 retain the two-step noise behavior."""
        config = self.factory_config()
        for control in config["hardware"]["analogControls"]:
            control.pop("midiHysteresis")
        validated = bridge._validate_controller_config(config)
        self.assertTrue(all(
            control["midiHysteresis"] == 2
            for control in validated["hardware"]["analogControls"]
        ))

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
        analog_records = [
            message for message in messages
            if message[5] == bridge.CMD_CONFIG_ANALOG
        ]
        self.assertTrue(all(len(message) == 19 for message in analog_records))
        self.assertTrue(all(message[-1] == 2 for message in analog_records))
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

    def test_analog_learn_is_sent_to_protocol_v3_controller(self):
        """Portable-hardware firmware retains the v2 Learn command envelope."""
        original_state = bridge._deepcopy(bridge.state)
        original_token = bridge.next_controller_learn_token
        sent = []
        try:
            bridge.state["controllerHardware"] = {
                "connected": True,
                "protocolVersion": bridge.HARDWARE_PROTOCOL_VERSION,
                "boardId": "test",
                "boardName": "Test controller",
                "drivers": [],
                "limits": {"modules": 0, "analogControls": 16, "encoders": 0},
                "inputs": [{
                    "type": "gpio",
                    "channel": 8,
                    "moduleId": None,
                    "label": "GPIO 8",
                    "capabilities": ["digital", "analog"],
                    "reserved": False,
                }],
                "apply": {"status": "idle", "message": "", "token": None},
            }
            with mock.patch.object(
                bridge,
                "send_controller_sysex",
                side_effect=lambda message, _label: sent.append(message) or True,
            ):
                result = bridge.update_state({
                    "controllerLearnStart": {
                        "capability": "analog",
                        "hardwareSwitch": 1,
                    }
                })
            self.assertEqual(result["controllerLearn"]["status"], "waiting")
            self.assertEqual(result["controllerLearn"]["capability"], "analog")
            self.assertEqual(sent[0][-2:], [bridge.CAPABILITY_ANALOG, 1])
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)
            bridge.next_controller_learn_token = original_token

    def test_encoder_learn_decodes_both_phase_inputs(self):
        """Encoder rotation Learn must preserve both returned descriptors."""
        original_state = bridge._deepcopy(bridge.state)
        try:
            bridge.state["controllerLearn"] = {
                "status": "waiting",
                "token": 9,
                "capability": "encoder",
                "input": None,
                "message": "",
            }
            descriptor_a = [
                bridge.SOURCE_GPIO, 0, 17,
                bridge.CAPABILITY_DIGITAL,
                bridge.INPUT_AVAILABLE,
                bridge.USAGE_NONE, 0,
            ]
            descriptor_b = [
                bridge.SOURCE_GPIO, 0, 18,
                bridge.CAPABILITY_DIGITAL,
                bridge.INPUT_AVAILABLE,
                bridge.USAGE_NONE, 0,
            ]
            message = list(bridge.MFX_SYSEX_PREFIX) + [
                bridge.CONTROLLER_PROTOCOL_VERSION,
                bridge.CMD_LEARN_RESULT,
                9,
                bridge.LEARN_STATUS_LEARNED,
            ] + descriptor_a + descriptor_b
            self.assertTrue(bridge._handle_learn_result(message))
            learned = bridge.state["controllerLearn"]
            self.assertEqual(learned["input"]["channel"], 17)
            self.assertEqual(learned["secondaryInput"]["channel"], 18)
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)


if __name__ == "__main__":
    unittest.main()
