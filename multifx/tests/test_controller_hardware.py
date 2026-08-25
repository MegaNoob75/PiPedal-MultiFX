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
        self.assertEqual(validated["schemaVersion"], 3)
        self.assertEqual(len(validated["hardware"]["analogControls"]), 4)
        self.assertEqual(
            validated["hardware"]["analogControls"][0]["midiHysteresis"],
            2,
        )

    def test_incomplete_current_schema_is_rejected(self):
        """The clean schema break must not silently invent missing fields."""
        config = self.factory_config()
        for control in config["hardware"]["analogControls"]:
            control.pop("midiHysteresis")
        with self.assertRaisesRegex(ValueError, "analog response"):
            bridge._validate_controller_config(config)

    def test_old_controller_schema_is_rejected(self):
        """Unreleased legacy configs cannot be partially restored."""
        old = {"schemaVersion": 2, "switches": []}
        with self.assertRaisesRegex(ValueError, "schemaVersion 3"):
            bridge._validate_controller_config(old)

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

    def test_theme_update_is_validated_persisted_and_returned(self):
        """One saved theme becomes the durable source shared by all displays."""
        original_state = bridge._deepcopy(bridge.state)
        theme = {
            "version": 4,
            "name": "Stage Test",
            "colors": {"accent": "#33ddff"},
            "appearance": {"controls": {"switchStyle": "footswitch"}},
            "typography": {"heading": {"family": "system", "size": 100}},
        }
        try:
            with mock.patch.object(bridge, "_save_persistent_locked") as save:
                result = bridge.update_state({"theme": theme})
            self.assertEqual(result["theme"], theme)
            self.assertEqual(bridge._persistent_payload_locked()["theme"], theme)
            save.assert_called_once_with()

            # The bridge must own a copy so an HTTP request object cannot alter
            # persisted state after update_state returns.
            theme["name"] = "Mutated request"
            self.assertEqual(bridge.state["theme"]["name"], "Stage Test")
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)

    def test_invalid_theme_update_does_not_replace_saved_theme(self):
        """Malformed browser data must not desynchronize the saved theme."""
        original_state = bridge._deepcopy(bridge.state)
        bridge.state["theme"] = {
            "version": 3,
            "name": "Known Good",
            "colors": {},
            "appearance": {},
        }
        try:
            with mock.patch.object(bridge, "_save_persistent_locked") as save:
                with self.assertRaisesRegex(ValueError, "version 3 or 4"):
                    bridge.update_state({
                        "theme": {
                            "version": 2,
                            "name": "Old",
                            "colors": {},
                            "appearance": {},
                        }
                    })
            self.assertEqual(bridge.state["theme"]["name"], "Known Good")
            save.assert_not_called()
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)

    def test_ui_interaction_settings_are_strict_and_persistent(self):
        """Shared timing/preferences reject partial records before saving."""
        original_state = bridge._deepcopy(bridge.state)
        settings = {
            "version": 1,
            "physicalControlPopout": True,
            "touchControlPopout": True,
            "controlPopoutDurationMs": 2200,
            "controlPopoutScale": 1.65,
            "parameterFeedbackEnabled": True,
            "statusToastDurationMs": 1800,
        }
        try:
            with mock.patch.object(bridge, "_save_persistent_locked") as save:
                result = bridge.update_state({"uiSettings": settings})
            self.assertEqual(result["uiSettings"], settings)
            save.assert_called_once_with()
            with self.assertRaisesRegex(ValueError, "complete version 1"):
                bridge._validate_ui_settings({"version": 1})
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)

    def test_i2c_module_scan_request_and_results_are_correlated(self):
        """Discovery sends selected pins and accepts only its matching token."""
        original_state = bridge._deepcopy(bridge.state)
        original_token = bridge.next_module_scan_token
        sent = []
        try:
            bridge.state["controllerHardware"] = {
                "connected": True,
                "protocolVersion": bridge.HARDWARE_PROTOCOL_VERSION,
                "boardId": "test",
                "boardName": "Test controller",
                "drivers": [],
                "moduleScanSupported": True,
                "limits": {"modules": 4, "analogControls": 16, "encoders": 4},
                "inputs": [
                    {
                        "type": "gpio", "channel": 9,
                        "outputCapable": True, "reserved": False,
                    },
                    {
                        "type": "gpio", "channel": 10,
                        "outputCapable": True, "reserved": False,
                    },
                ],
                "apply": {"status": "idle", "message": "", "token": None},
            }
            with mock.patch.object(
                bridge,
                "send_controller_sysex",
                side_effect=lambda message, _label: sent.append(message) or True,
            ):
                result = bridge.update_state({
                    "controllerModuleScanStart": {"sdaPin": 9, "sclPin": 10}
                })
            token = result["controllerModuleScan"]["token"]
            self.assertEqual(sent[0][-3:], [token, 9, 10])

            found = list(bridge.MFX_SYSEX_PREFIX) + [
                bridge.HARDWARE_PROTOCOL_VERSION,
                bridge.CMD_MODULE_SCAN_RESULT,
                token, 0, 0x20, 1,
            ]
            complete = list(bridge.MFX_SYSEX_PREFIX) + [
                bridge.HARDWARE_PROTOCOL_VERSION,
                bridge.CMD_MODULE_SCAN_RESULT,
                token, 1, 0, 0,
            ]
            self.assertTrue(bridge._handle_module_scan_result(found))
            self.assertTrue(bridge._handle_module_scan_result(complete))
            scan = bridge.state["controllerModuleScan"]
            self.assertEqual(scan["status"], "complete")
            self.assertEqual(scan["devices"], [{
                "address": 0x20, "family": "mcp23017"
            }])
        finally:
            bridge.state.clear()
            bridge.state.update(original_state)
            bridge.next_module_scan_token = original_token


if __name__ == "__main__":
    unittest.main()
