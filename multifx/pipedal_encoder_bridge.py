#!/usr/bin/env python3
"""
PiPedal MultiFX physical-controller bridge.

Footswitch transport:
    CC40..CC51 = logical SW1..SW12
    value >= 64 = down
    value < 64  = up

The CC numbers are neutral physical identities. They are not PiPedal preset,
bank or snapshot commands. The browser uses controller-config.json to decide
what each logical switch does.

Encoder transport is retained for the current hardware:
    CC30 = encoder rotation
    CC31 = encoder push

GPIO configuration:
    The browser saves gpioPin on each logical footswitch.
    The shared MultiFX runtime state receives that configuration.
    This bridge sends the GPIO map to the ESP32 over a private SysEx message.
    The ESP32 validates and stores the map in Preferences, so rewiring never
    requires recompiling the Arduino sketch.

Private SysEx payload (mido supplies F0/F7):
    7D 4D 46 58 01 COUNT [SW PIN]...

    7D       = educational/non-commercial manufacturer ID
    4D4658   = ASCII "MFX"
    01       = protocol version
    COUNT    = number of switch/pin pairs
    SW       = logical switch 1..12
    PIN      = GPIO 0..126, or 127 for disabled

This process also owns the MultiFX runtime-state service on TCP port 8877.
The same runtime state now carries the shared Performance View preset-tile map
so the Pi kiosk and desktop browser use one synchronized layout.
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import mido
except ImportError:
    print("ERROR: Python module 'mido' is not installed.", flush=True)
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

# Browser transport:
#   SW1..SW9 -> 1..9
#   SW10     -> 0
#   SW11..12 -> F1..F2
PHYSICAL_SWITCH_KEY_CODES = {
    1: 2,   # 1
    2: 3,   # 2
    3: 4,   # 3
    4: 5,   # 4
    5: 6,   # 5
    6: 7,   # 6
    7: 8,   # 7
    8: 9,   # 8
    9: 10,  # 9
    10: 11, # 0
    11: 59, # F1
    12: 60, # F2
}

ENCODER_DEBOUNCE_SECONDS = 0.020

RUNTIME_STATE_HOST = "0.0.0.0"
RUNTIME_STATE_PORT = 8877
RUNTIME_STATE_PATH = "/multifx-state"
RUNTIME_STATE_FILE = "/run/pipedal-multifx-runtime-state.json"

_RUNTIME_STATE_KEYS = {
    "mainView",
    "snapshotMode",
    "snapshotPresetId",
    "chainBypassed",
    "chainBypassPresetId",
    "chainBypassWasPresetChanged",
    "chainBypassEnabledStates",
    "controllerConfig",
    "presetTileStore",
}

runtime_state_lock = threading.Lock()
runtime_state = {
    "version": 1,
    "revision": 0,
    "mainView": "performance",
    "snapshotMode": False,
    "snapshotPresetId": None,
    "chainBypassed": False,
    "chainBypassPresetId": None,
    "chainBypassWasPresetChanged": False,
    "chainBypassEnabledStates": {},
}

midi_output_lock = threading.Lock()
midi_output_port = None
last_pushed_pin_signature = None

last_value = None
last_move_time = 0.0


def _normalize_runtime_state_patch(patch):
    normalized = {}

    if "mainView" in patch:
        normalized["mainView"] = (
            "default"
            if patch["mainView"] == "default"
            else "performance"
        )

    if "snapshotMode" in patch:
        normalized["snapshotMode"] = bool(patch["snapshotMode"])

    if "snapshotPresetId" in patch:
        value = patch["snapshotPresetId"]
        normalized["snapshotPresetId"] = (
            value if isinstance(value, int) and not isinstance(value, bool)
            else None
        )

    if "chainBypassed" in patch:
        normalized["chainBypassed"] = bool(patch["chainBypassed"])

    if "chainBypassPresetId" in patch:
        value = patch["chainBypassPresetId"]
        normalized["chainBypassPresetId"] = (
            value if isinstance(value, int) and not isinstance(value, bool)
            else None
        )

    if "chainBypassWasPresetChanged" in patch:
        normalized["chainBypassWasPresetChanged"] = bool(
            patch["chainBypassWasPresetChanged"]
        )

    if "chainBypassEnabledStates" in patch:
        value = patch["chainBypassEnabledStates"]
        enabled_states = {}
        if isinstance(value, dict):
            for instance_id, enabled in value.items():
                try:
                    normalized_id = str(int(instance_id))
                except (TypeError, ValueError):
                    continue
                enabled_states[normalized_id] = bool(enabled)
        normalized["chainBypassEnabledStates"] = enabled_states

    if "controllerConfig" in patch:
        value = patch["controllerConfig"]
        if value is None or isinstance(value, dict):
            normalized["controllerConfig"] = value

    if "presetTileStore" in patch:
        value = patch["presetTileStore"]
        if isinstance(value, dict):
            # Keep the runtime transport deliberately schema-light. The browser
            # owns detailed validation/normalization of the tile-store format.
            # Requiring the basic version/banks envelope prevents arbitrary
            # non-store objects from becoming shared state.
            if value.get("version") == 1 and isinstance(value.get("banks"), dict):
                normalized["presetTileStore"] = value

    return normalized


def _save_runtime_state_locked():
    directory = os.path.dirname(RUNTIME_STATE_FILE)
    if directory:
        os.makedirs(directory, exist_ok=True)

    temporary_path = f"{RUNTIME_STATE_FILE}.tmp"
    with open(temporary_path, "w", encoding="utf-8") as file:
        json.dump(runtime_state, file, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())

    os.replace(temporary_path, RUNTIME_STATE_FILE)


def load_runtime_state():
    if not os.path.exists(RUNTIME_STATE_FILE):
        return

    try:
        with open(RUNTIME_STATE_FILE, "r", encoding="utf-8") as file:
            saved = json.load(file)

        if not isinstance(saved, dict):
            return

        patch = {
            key: saved[key]
            for key in _RUNTIME_STATE_KEYS
            if key in saved
        }

        with runtime_state_lock:
            runtime_state.update(_normalize_runtime_state_patch(patch))
            revision = saved.get("revision", 0)
            runtime_state["revision"] = (
                revision if isinstance(revision, int) else 0
            )

        print("Restored MultiFX runtime state from /run.", flush=True)
    except Exception as error:
        print(
            f"Runtime state restore warning: {error}",
            file=sys.stderr,
            flush=True,
        )


def get_runtime_state():
    with runtime_state_lock:
        return json.loads(json.dumps(runtime_state))


def controller_pin_pairs(controller_config):
    """
    Convert a browser controller config into a complete SW1..SW12 GPIO map.

    Missing/disabled switches are transmitted as 127. Old configs without
    gpioPin use the original eight-switch wiring so upgrading is non-breaking.
    """
    default_pins = {
        1: 6,
        2: 7,
        3: 15,
        4: 16,
        5: 1,
        6: 2,
        7: 4,
        8: 5,
    }

    pins = {switch: 127 for switch in range(1, MAX_FOOTSWITCHES + 1)}

    if not isinstance(controller_config, dict):
        return [(switch, pins[switch]) for switch in pins]

    switches = controller_config.get("switches")
    if not isinstance(switches, list):
        return [(switch, pins[switch]) for switch in pins]

    for index, item in enumerate(switches):
        if not isinstance(item, dict):
            continue

        hardware_switch = item.get("hardwareSwitch", index + 1)
        if (
            not isinstance(hardware_switch, int)
            or isinstance(hardware_switch, bool)
            or hardware_switch < 1
            or hardware_switch > MAX_FOOTSWITCHES
        ):
            continue

        if "gpioPin" in item:
            gpio_pin = item.get("gpioPin")
            if isinstance(gpio_pin, int) and not isinstance(gpio_pin, bool):
                if 0 <= gpio_pin <= 126:
                    pins[hardware_switch] = gpio_pin
            else:
                pins[hardware_switch] = 127
        else:
            pins[hardware_switch] = default_pins.get(hardware_switch, 127)

    return [(switch, pins[switch]) for switch in range(1, MAX_FOOTSWITCHES + 1)]


def make_pin_config_sysex(controller_config):
    pairs = controller_pin_pairs(controller_config)

    # mido's sysex Message stores only data bytes; F0/F7 are added by backend.
    data = [
        0x7D,       # non-commercial manufacturer ID
        0x4D, 0x46, 0x58,  # "MFX"
        0x01,       # protocol version
        len(pairs),
    ]

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
            print(
                "ESP32 GPIO map -> "
                + ", ".join(
                    f"SW{sw}={'OFF' if pin == 127 else f'GPIO{pin}'}"
                    for sw, pin in signature
                ),
                flush=True,
            )
            return True
        except Exception as error:
            print(
                f"GPIO map send warning: {error}",
                file=sys.stderr,
                flush=True,
            )
            return False


def update_runtime_state(patch):
    normalized = _normalize_runtime_state_patch(patch)

    with runtime_state_lock:
        runtime_state.update(normalized)
        runtime_state["revision"] += 1
        _save_runtime_state_locked()
        result = json.loads(json.dumps(runtime_state))

    if "controllerConfig" in normalized and normalized["controllerConfig"] is not None:
        push_controller_pin_config(normalized["controllerConfig"])

    return result


class MultiFXRuntimeStateHandler(BaseHTTPRequestHandler):
    server_version = "PiPedalMultiFXRuntime/1.3"

    def log_message(self, format_string, *args):
        return

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _send_json(self, status_code, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status_code)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path != RUNTIME_STATE_PATH:
            self._send_json(404, {"error": "not found"})
            return
        self._send_json(200, get_runtime_state())

    def do_POST(self):
        if self.path != RUNTIME_STATE_PATH:
            self._send_json(404, {"error": "not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        if content_length <= 0 or content_length > 65536:
            self._send_json(400, {"error": "invalid request body"})
            return

        try:
            payload = json.loads(
                self.rfile.read(content_length).decode("utf-8")
            )
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON"})
            return

        if not isinstance(payload, dict):
            self._send_json(400, {"error": "JSON object required"})
            return

        self._send_json(200, update_runtime_state(payload))


def runtime_state_server_main():
    try:
        server = ThreadingHTTPServer(
            (RUNTIME_STATE_HOST, RUNTIME_STATE_PORT),
            MultiFXRuntimeStateHandler,
        )
        server.daemon_threads = True
        print(
            f"MultiFX runtime sync listening on TCP {RUNTIME_STATE_PORT}.",
            flush=True,
        )
        server.serve_forever()
    except Exception as error:
        print(
            f"Runtime state server error: {error}",
            file=sys.stderr,
            flush=True,
        )


def start_runtime_state_server():
    load_runtime_state()
    thread = threading.Thread(
        target=runtime_state_server_main,
        name="multifx-runtime-state",
        daemon=True,
    )
    thread.start()


def send_key(sequence):
    env = os.environ.copy()
    env["YDOTOOL_SOCKET"] = YDOTOOL_SOCKET

    subprocess.run(
        [YDOTOOL, "key"] + sequence,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def choose_input():
    names = mido.get_input_names()
    if not names:
        raise RuntimeError("No MIDI input ports were found.")

    print("Available MIDI inputs:", flush=True)
    for index, name in enumerate(names):
        print(f"  {index}: {name}", flush=True)

    preferred_words = (
        "control surface",
        "esp32",
        "usb midi",
        "midi",
    )

    for word in preferred_words:
        for name in names:
            if word in name.lower():
                print(f"Using MIDI input: {name}", flush=True)
                return name

    print(f"Using first MIDI input: {names[0]}", flush=True)
    return names[0]


def choose_output(input_name):
    names = mido.get_output_names()
    if not names:
        print(
            "No MIDI output port found; footswitch input remains active, "
            "but ESP32 GPIO-map sync is unavailable.",
            file=sys.stderr,
            flush=True,
        )
        return None

    print("Available MIDI outputs:", flush=True)
    for index, name in enumerate(names):
        print(f"  {index}: {name}", flush=True)

    input_lower = input_name.lower()
    for name in names:
        output_lower = name.lower()
        # Most ALSA names share the USB device label in both directions.
        significant = [
            word for word in ("control surface", "esp32", "usb midi")
            if word in input_lower
        ]
        if significant and any(word in output_lower for word in significant):
            print(f"Using MIDI output: {name}", flush=True)
            return name

    for word in ("control surface", "esp32", "usb midi", "midi"):
        for name in names:
            if word in name.lower():
                print(f"Using MIDI output: {name}", flush=True)
                return name

    print(f"Using first MIDI output: {names[0]}", flush=True)
    return names[0]


def signed_delta(old_value, new_value):
    delta = new_value - old_value
    if delta > 64:
        delta -= 128
    elif delta < -64:
        delta += 128
    return delta


def handle_encoder_value(value):
    global last_value
    global last_move_time

    if last_value is None:
        last_value = value
        print(f"Encoder initial value: {value}", flush=True)
        return

    delta = signed_delta(last_value, value)
    last_value = value

    if delta == 0:
        return

    now = time.monotonic()
    if now - last_move_time < ENCODER_DEBOUNCE_SECONDS:
        return
    last_move_time = now

    if delta > 0:
        send_key(KEY_DOWN)
        print(f"CC30 {value:3d} delta {delta:+d} -> DOWN", flush=True)
    else:
        send_key(KEY_UP)
        print(f"CC30 {value:3d} delta {delta:+d} -> UP", flush=True)


def handle_control_change(control, value):
    if control == ENCODER_CC:
        handle_encoder_value(value)
        return

    if control == PUSH_CC:
        if value >= 64:
            send_key(["28:1"])
            print("CC31 -> ENTER DOWN", flush=True)
        else:
            send_key(["28:0"])
            print("CC31 -> ENTER UP", flush=True)
        return

    if FIRST_SWITCH_CC <= control <= LAST_SWITCH_CC:
        physical_switch = control - FIRST_SWITCH_CC + 1
        key_code = PHYSICAL_SWITCH_KEY_CODES[physical_switch]
        pressed = value >= 64

        send_key([f"{key_code}:{1 if pressed else 0}"])
        print(
            f"CC{control} -> physical SW{physical_switch} "
            f"{'DOWN' if pressed else 'UP'}",
            flush=True,
        )


def main():
    global midi_output_port
    global last_pushed_pin_signature

    print("PiPedal MultiFX hardware bridge starting...", flush=True)
    start_runtime_state_server()

    while True:
        try:
            input_name = choose_input()
            output_name = choose_output(input_name)

            with mido.open_input(input_name) as input_port:
                output_port = None
                try:
                    if output_name is not None:
                        output_port = mido.open_output(output_name)

                    with midi_output_lock:
                        midi_output_port = output_port
                        last_pushed_pin_signature = None

                    state = get_runtime_state()
                    if (
                        output_port is not None
                        and state.get("controllerConfig") is not None
                    ):
                        push_controller_pin_config(
                            state["controllerConfig"],
                            force=True,
                        )

                    print("MultiFX hardware bridge running.", flush=True)

                    for message in input_port:
                        if message.type != "control_change":
                            continue
                        handle_control_change(
                            message.control,
                            message.value,
                        )
                finally:
                    with midi_output_lock:
                        midi_output_port = None
                    if output_port is not None:
                        output_port.close()

        except KeyboardInterrupt:
            return
        except Exception as error:
            print(
                f"Bridge error: {error}",
                file=sys.stderr,
                flush=True,
            )
            print(
                "Retrying in 2 seconds...",
                file=sys.stderr,
                flush=True,
            )
            time.sleep(2)

if __name__ == "__main__":
    main()
