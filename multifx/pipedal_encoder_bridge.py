#!/usr/bin/env python3
"""PiPedal MultiFX hardware + shared-state bridge.

Responsibilities are deliberately narrow:
  * translate the MultiFX USB-MIDI controller into ydotool key events;
  * send the current GPIO map to the ESP32 over the private SysEx protocol;
  * expose one small HTTP state service on port 8877.

Persistence contract
--------------------
Only user configuration is durable:
  * controllerConfig
  * presetAssignments (bank -> logical switch id -> native PiPedal preset id)

Those values are stored atomically in /var/lib/pipedal-multifx/state.json.
Snapshot Mode and Chain Bypass are transient live-performance state and always
start neutral when this service restarts. There is intentionally no migration
of old tile/page/config formats in this version.

Encoder transport
-----------------
CC30 uses 7-bit two's-complement RELATIVE MIDI CC:
  1..63   = positive movement
  65..127 = negative movement (-63..-1)
  0       = no movement
  64      = -64 (not normally emitted by the encoder)

Positive movement maps to Arrow Down and negative movement maps to Arrow Up.
Using a relative encoder removes the old 0..127 endpoint limit of
CCAbsoluteEncoder, so the physical encoder can turn indefinitely.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

try:
    import mido
except ImportError:
    print("ERROR: Python module 'mido' is not installed.", file=sys.stderr, flush=True)
    sys.exit(1)

ENCODER_CC = 30
PUSH_CC = 31
FIRST_SWITCH_CC = 40
MAX_FOOTSWITCHES = 12
LAST_SWITCH_CC = FIRST_SWITCH_CC + MAX_FOOTSWITCHES - 1

YDOTOOL = "/usr/bin/ydotool"
YDOTOOL_SOCKET = "/tmp/.ydotool_socket"
KEY_UP = ["103:1", "103:0"]
KEY_DOWN = ["108:1", "108:0"]

# SW1..SW10 -> keyboard 1..0, SW11..SW12 -> F1..F2.
PHYSICAL_SWITCH_KEY_CODES = {
    1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7,
    7: 8, 8: 9, 9: 10, 10: 11, 11: 59, 12: 60,
}

RUNTIME_STATE_HOST = "0.0.0.0"
RUNTIME_STATE_PORT = 8877
RUNTIME_STATE_PATH = "/multifx-state"
PERSISTENT_STATE_FILE = "/var/lib/pipedal-multifx/state.json"
FACTORY_CONTROLLER_CONFIG_FILE = "/etc/pipedal/controller-config.json"
STATE_SCHEMA_VERSION = 1
RUNTIME_VERSION = 3

# Optional systemd override, e.g. MULTIFX_MIDI_DEVICE_HINT="PiPedal Control Surface".
MIDI_DEVICE_HINT = os.environ.get("MULTIFX_MIDI_DEVICE_HINT", "").strip().lower()

state_lock = threading.RLock()
state = {
    "version": RUNTIME_VERSION,
    "revision": 0,
    "instanceId": uuid.uuid4().hex,
    "snapshotMode": False,
    "snapshotPresetId": None,
    "chainBypassed": False,
    "chainBypassPresetId": None,
    "chainBypassWasPresetChanged": False,
    "chainBypassEnabledStates": {},
    "controllerConfig": None,
    "presetAssignments": {"version": 1, "banks": {}},
}

midi_output_lock = threading.Lock()
midi_output_port = None
last_pushed_pin_signature = None


def _deepcopy(value):
    return json.loads(json.dumps(value))


def _valid_nonnegative_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _normalize_enabled_states(value):
    result = {}
    if not isinstance(value, dict):
        return result
    for key, enabled in value.items():
        try:
            instance_id = int(key)
        except (TypeError, ValueError):
            continue
        if instance_id >= 0:
            result[str(instance_id)] = bool(enabled)
    return result


def _normalize_assignments(value):
    """Validate the *current* assignment schema. No legacy conversion."""
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("presetAssignments must use schema version 1")
    banks = value.get("banks")
    if not isinstance(banks, dict):
        raise ValueError("presetAssignments.banks must be an object")

    normalized_banks = {}
    for raw_bank_id, raw_bank in banks.items():
        try:
            bank_id = int(raw_bank_id)
        except (TypeError, ValueError):
            raise ValueError("invalid preset-assignment bank id")
        if bank_id < 0 or not isinstance(raw_bank, dict):
            raise ValueError("invalid preset-assignment bank")

        normalized_bank = {}
        for switch_id, preset_id in raw_bank.items():
            if not isinstance(switch_id, str) or not switch_id.strip():
                raise ValueError("invalid preset-assignment switch id")
            if preset_id is not None and not _valid_nonnegative_int(preset_id):
                raise ValueError("invalid preset-assignment preset id")
            normalized_bank[switch_id] = preset_id
        normalized_banks[str(bank_id)] = normalized_bank

    return {"version": 1, "banks": normalized_banks}


def _validate_controller_config(value):
    """Reject obsolete controller formats; detailed UI validation stays in TS."""
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("schemaVersion") != STATE_SCHEMA_VERSION:
        raise ValueError("controllerConfig must use schemaVersion 1")
    switches = value.get("switches")
    if not isinstance(switches, list) or len(switches) > MAX_FOOTSWITCHES:
        raise ValueError("controllerConfig.switches is invalid")
    for item in switches:
        if not isinstance(item, dict):
            raise ValueError("controller switch must be an object")
        hardware = item.get("hardwareSwitch")
        gpio_pin = item.get("gpioPin")
        if not isinstance(hardware, int) or isinstance(hardware, bool) or not 1 <= hardware <= MAX_FOOTSWITCHES:
            raise ValueError("controller switch hardwareSwitch is invalid")
        if gpio_pin is not None and (not isinstance(gpio_pin, int) or isinstance(gpio_pin, bool) or not 0 <= gpio_pin <= 126):
            raise ValueError("controller switch gpioPin is invalid")
    return _deepcopy(value)


def _load_factory_controller_config():
    try:
        with open(FACTORY_CONTROLLER_CONFIG_FILE, "r", encoding="utf-8") as file:
            return _validate_controller_config(json.load(file))
    except Exception as error:
        print(
            f"Factory controller config unavailable: {error}",
            file=sys.stderr,
            flush=True,
        )
        return None


def _persistent_payload_locked():
    return {
        "schemaVersion": STATE_SCHEMA_VERSION,
        "controllerConfig": state.get("controllerConfig"),
        "presetAssignments": state.get("presetAssignments"),
    }


def _save_persistent_locked():
    os.makedirs(os.path.dirname(PERSISTENT_STATE_FILE), exist_ok=True)
    temp = f"{PERSISTENT_STATE_FILE}.tmp"
    with open(temp, "w", encoding="utf-8") as file:
        json.dump(_persistent_payload_locked(), file, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())
    os.replace(temp, PERSISTENT_STATE_FILE)


def load_persistent_state():
    if not os.path.exists(PERSISTENT_STATE_FILE):
        with state_lock:
            state["controllerConfig"] = _load_factory_controller_config()
            if state["controllerConfig"] is not None:
                _save_persistent_locked()
        return
    try:
        with open(PERSISTENT_STATE_FILE, "r", encoding="utf-8") as file:
            saved = json.load(file)
        if not isinstance(saved, dict) or saved.get("schemaVersion") != STATE_SCHEMA_VERSION:
            raise ValueError("unsupported MultiFX state schema")
        controller = _validate_controller_config(saved.get("controllerConfig"))
        assignments = _normalize_assignments(saved.get("presetAssignments", {"version": 1, "banks": {}}))
        with state_lock:
            state["controllerConfig"] = controller
            state["presetAssignments"] = assignments
        print(f"Restored MultiFX state from {PERSISTENT_STATE_FILE}.", flush=True)
    except Exception as error:
        # Deliberately do not migrate an old format. Preserve the file for manual
        # inspection and start with clean current-schema defaults.
        print(f"Ignoring incompatible MultiFX state: {error}", file=sys.stderr, flush=True)
        with state_lock:
            state["controllerConfig"] = _load_factory_controller_config()
            state["presetAssignments"] = {"version": 1, "banks": {}}
            if state["controllerConfig"] is not None:
                _save_persistent_locked()


def get_state():
    with state_lock:
        return _deepcopy(state)


def _assignment_bank_locked(bank_id, create=False):
    banks = state["presetAssignments"]["banks"]
    key = str(bank_id)
    if create:
        return banks.setdefault(key, {})
    return banks.get(key)


def update_state(patch):
    if not isinstance(patch, dict):
        raise ValueError("JSON object required")

    persistent_changed = False
    controller_changed = False

    with state_lock:
        if "snapshotMode" in patch:
            state["snapshotMode"] = bool(patch["snapshotMode"])
        if "snapshotPresetId" in patch:
            value = patch["snapshotPresetId"]
            state["snapshotPresetId"] = value if _valid_nonnegative_int(value) else None
        if "chainBypassed" in patch:
            state["chainBypassed"] = bool(patch["chainBypassed"])
        if "chainBypassPresetId" in patch:
            value = patch["chainBypassPresetId"]
            state["chainBypassPresetId"] = value if _valid_nonnegative_int(value) else None
        if "chainBypassWasPresetChanged" in patch:
            state["chainBypassWasPresetChanged"] = bool(patch["chainBypassWasPresetChanged"])
        if "chainBypassEnabledStates" in patch:
            state["chainBypassEnabledStates"] = _normalize_enabled_states(patch["chainBypassEnabledStates"])

        if "controllerConfig" in patch:
            requested_controller = patch["controllerConfig"]
            state["controllerConfig"] = (
                _load_factory_controller_config()
                if requested_controller is None
                else _validate_controller_config(requested_controller)
            )
            persistent_changed = True
            controller_changed = True

        if "presetAssignmentUpdate" in patch:
            op = patch["presetAssignmentUpdate"]
            if not isinstance(op, dict):
                raise ValueError("presetAssignmentUpdate must be an object")
            bank_id = op.get("bankId")
            switch_id = op.get("switchId")
            preset_id = op.get("presetId")
            if not _valid_nonnegative_int(bank_id) or not isinstance(switch_id, str) or not switch_id.strip():
                raise ValueError("invalid presetAssignmentUpdate")
            if preset_id is not None and not _valid_nonnegative_int(preset_id):
                raise ValueError("invalid presetAssignmentUpdate presetId")
            _assignment_bank_locked(bank_id, True)[switch_id] = preset_id
            persistent_changed = True

        if "presetAssignmentSwap" in patch:
            op = patch["presetAssignmentSwap"]
            if not isinstance(op, dict):
                raise ValueError("presetAssignmentSwap must be an object")
            bank_id = op.get("bankId")
            left = op.get("leftSwitchId")
            right = op.get("rightSwitchId")
            if not _valid_nonnegative_int(bank_id) or not isinstance(left, str) or not left.strip() or not isinstance(right, str) or not right.strip():
                raise ValueError("invalid presetAssignmentSwap")
            bank = _assignment_bank_locked(bank_id, True)
            left_value = bank.get(left)
            right_value = bank.get(right)
            bank[left] = right_value
            bank[right] = left_value
            persistent_changed = True

        if "replacePresetAssignments" in patch:
            state["presetAssignments"] = _normalize_assignments(patch["replacePresetAssignments"])
            persistent_changed = True

        if patch.get("resetPresetAssignments") is True:
            state["presetAssignments"] = {"version": 1, "banks": {}}
            persistent_changed = True

        if "deletePresetAssignmentsBank" in patch:
            bank_id = patch["deletePresetAssignmentsBank"]
            if not _valid_nonnegative_int(bank_id):
                raise ValueError("invalid deletePresetAssignmentsBank")
            state["presetAssignments"]["banks"].pop(str(bank_id), None)
            persistent_changed = True

        if "deletePresetAssignmentsPreset" in patch:
            op = patch["deletePresetAssignmentsPreset"]
            if not isinstance(op, dict) or not _valid_nonnegative_int(op.get("bankId")) or not _valid_nonnegative_int(op.get("presetId")):
                raise ValueError("invalid deletePresetAssignmentsPreset")
            bank = _assignment_bank_locked(op["bankId"])
            if bank is not None:
                preset_id = op["presetId"]
                for switch_id in list(bank):
                    if bank[switch_id] == preset_id:
                        bank[switch_id] = None
                persistent_changed = True

        state["revision"] += 1
        if persistent_changed:
            _save_persistent_locked()
        result = _deepcopy(state)

    if controller_changed and result.get("controllerConfig") is not None:
        push_controller_pin_config(result["controllerConfig"])
    return result


def controller_pin_pairs(controller_config):
    pins = {switch: 127 for switch in range(1, MAX_FOOTSWITCHES + 1)}
    if not isinstance(controller_config, dict) or controller_config.get("schemaVersion") != 1:
        return [(switch, pins[switch]) for switch in pins]
    for item in controller_config.get("switches", []):
        hardware = item["hardwareSwitch"]
        gpio_pin = item["gpioPin"]
        pins[hardware] = 127 if gpio_pin is None else gpio_pin
    return [(switch, pins[switch]) for switch in range(1, MAX_FOOTSWITCHES + 1)]


def make_pin_config_sysex(controller_config):
    pairs = controller_pin_pairs(controller_config)
    data = [0x7D, 0x4D, 0x46, 0x58, 0x01, len(pairs)]
    for logical_switch, gpio_pin in pairs:
        data.extend([logical_switch, gpio_pin])
    return mido.Message("sysex", data=data), tuple(pairs)


def push_controller_pin_config(controller_config, force=False):
    global last_pushed_pin_signature
    message, signature = make_pin_config_sysex(controller_config)
    with midi_output_lock:
        if midi_output_port is None:
            return False
        if not force and signature == last_pushed_pin_signature:
            return True
        try:
            midi_output_port.send(message)
            last_pushed_pin_signature = signature
            print("ESP32 GPIO map -> " + ", ".join(
                f"SW{sw}={'OFF' if pin == 127 else f'GPIO{pin}'}" for sw, pin in signature
            ), flush=True)
            return True
        except Exception as error:
            print(f"GPIO map send warning: {error}", file=sys.stderr, flush=True)
            return False


def _origin_allowed(handler):
    origin = handler.headers.get("Origin")
    if not origin:
        return None
    try:
        parsed = urlparse(origin)
        origin_host = (parsed.hostname or "").lower()
        request_host = handler.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        local_names = {"localhost", "127.0.0.1", "::1", socket.gethostname().lower()}
        if origin_host == request_host or (origin_host in local_names and request_host in local_names):
            return origin
    except Exception:
        pass
    return ""


class RuntimeHandler(BaseHTTPRequestHandler):
    server_version = "PiPedalMultiFXRuntime/3.0"

    def log_message(self, _format, *_args):
        return

    def _cors(self):
        allowed = _origin_allowed(self)
        if allowed:
            self.send_header("Access-Control-Allow-Origin", allowed)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if _origin_allowed(self) == "":
            self._json(403, {"error": "origin not allowed"})
            return
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path != RUNTIME_STATE_PATH:
            self._json(404, {"error": "not found"})
            return
        if _origin_allowed(self) == "":
            self._json(403, {"error": "origin not allowed"})
            return
        self._json(200, get_state())

    def do_POST(self):
        if self.path != RUNTIME_STATE_PATH:
            self._json(404, {"error": "not found"})
            return
        if _origin_allowed(self) == "":
            self._json(403, {"error": "origin not allowed"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 262144:
            self._json(400, {"error": "invalid request body"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = update_state(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError) as error:
            self._json(400, {"error": str(error)})
            return
        except Exception as error:
            print(f"Runtime update error: {error}", file=sys.stderr, flush=True)
            self._json(500, {"error": "runtime update failed"})
            return
        self._json(200, result)


def runtime_server_main():
    server = ThreadingHTTPServer((RUNTIME_STATE_HOST, RUNTIME_STATE_PORT), RuntimeHandler)
    server.daemon_threads = True
    print(f"MultiFX runtime sync listening on TCP {RUNTIME_STATE_PORT}.", flush=True)
    server.serve_forever()


def start_runtime_server():
    load_persistent_state()
    threading.Thread(target=runtime_server_main, name="multifx-runtime", daemon=True).start()


def send_key(sequence):
    env = os.environ.copy()
    env["YDOTOOL_SOCKET"] = YDOTOOL_SOCKET
    subprocess.run([YDOTOOL, "key"] + sequence, env=env,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


def _score_port_name(name):
    lower = name.lower()
    if MIDI_DEVICE_HINT:
        return 100 if MIDI_DEVICE_HINT in lower else -1
    # Intentionally strong matches only. Never bind to a generic/first MIDI port.
    if "pipedal" in lower and "control" in lower:
        return 90
    if "control surface" in lower:
        return 80
    if "esp32" in lower:
        return 70
    if "usb midi" in lower:
        return 60
    return -1


def choose_port(names, direction):
    if not names:
        raise RuntimeError(f"No MIDI {direction} ports were found.")
    ranked = sorted(((_score_port_name(name), name) for name in names), reverse=True)
    score, name = ranked[0]
    if score < 0:
        hint = f" matching MULTIFX_MIDI_DEVICE_HINT={MIDI_DEVICE_HINT!r}" if MIDI_DEVICE_HINT else " with a recognized MultiFX controller name"
        raise RuntimeError(f"No MIDI {direction} port{hint}. Refusing to use an unrelated MIDI device.")
    print(f"Using MIDI {direction}: {name}", flush=True)
    return name


def relative_cc_delta(value):
    """Decode Control Surface's default 7-bit two's-complement relative CC."""
    if not 0 <= value <= 127:
        return 0
    return value if value < 64 else value - 128


def handle_encoder_value(value):
    delta = relative_cc_delta(value)
    if delta == 0:
        return

    key_sequence = KEY_DOWN if delta > 0 else KEY_UP

    # RelativeCCSender can combine fast motion into a delta larger than one.
    # Preserve every encoder step while using one ydotool process.
    send_key(key_sequence * abs(delta))


def handle_control_change(control, value):
    if control == ENCODER_CC:
        handle_encoder_value(value)
        return
    if control == PUSH_CC:
        send_key([f"28:{1 if value >= 64 else 0}"])
        return
    if FIRST_SWITCH_CC <= control <= LAST_SWITCH_CC:
        switch = control - FIRST_SWITCH_CC + 1
        send_key([f"{PHYSICAL_SWITCH_KEY_CODES[switch]}:{1 if value >= 64 else 0}"])


def main():
    global midi_output_port, last_pushed_pin_signature
    print("PiPedal MultiFX hardware bridge starting...", flush=True)
    start_runtime_server()

    while True:
        try:
            input_name = choose_port(mido.get_input_names(), "input")
            output_name = choose_port(mido.get_output_names(), "output")
            with mido.open_input(input_name) as input_port, mido.open_output(output_name) as output_port:
                with midi_output_lock:
                    midi_output_port = output_port
                    last_pushed_pin_signature = None
                current = get_state()
                if current.get("controllerConfig") is not None:
                    push_controller_pin_config(current["controllerConfig"], force=True)
                print("MultiFX hardware bridge running.", flush=True)
                for message in input_port:
                    if message.type == "control_change":
                        handle_control_change(message.control, message.value)
        except KeyboardInterrupt:
            return
        except Exception as error:
            with midi_output_lock:
                midi_output_port = None
            print(f"Bridge error: {error}", file=sys.stderr, flush=True)
            print("Retrying in 2 seconds...", file=sys.stderr, flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main()
