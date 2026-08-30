#!/usr/bin/env python3
"""PiPedal MultiFX hardware + shared-state bridge.

Responsibilities are deliberately narrow:
  * translate the MultiFX USB-MIDI controller into ydotool key events;
  * send complete portable hardware configurations over private MIDI SysEx;
  * discover controller hardware capabilities and coordinate transient Learn;
  * expose the shared state and restricted PI-MULTIFX updater on port 8877.

Persistence contract
--------------------
Only user configuration is durable:
  * controllerConfig
  * presetAssignments (bank -> logical switch id -> native PiPedal preset id)
  * theme (the complete validated MultiFX theme shared by every display)
  * uiSettings (shared MultiFX interaction and timing preferences)

Those values are stored atomically in /var/lib/pipedal-multifx/state.json.
Snapshot Mode, per-preset snapshot selections, and Chain Bypass are transient
live-performance state and always start neutral when this service restarts.
Schema 3 is a clean unreleased-format break: incompatible state is reported and
then atomically replaced with the checked-in factory controller configuration.

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
import math
import os
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

try:
    import mido
except ImportError:
    print("ERROR: Python module 'mido' is not installed.", file=sys.stderr, flush=True)
    sys.exit(1)

ENCODER_CC = 30
PUSH_CC = 31
FIRST_SWITCH_CC = 40
MAX_FOOTSWITCHES = 12
MAX_ANALOG_CONTROLS = 16
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
MULTIFX_UPDATE_PATH = "/multifx-update"
PERSISTENT_STATE_FILE = "/var/lib/pipedal-multifx/state.json"
FACTORY_CONTROLLER_CONFIG_FILE = "/etc/pipedal/controller-config.json"
MULTIFX_INSTALLED_RELEASE_FILE = \
    "/var/lib/pipedal-multifx-installer/installed-release"
MULTIFX_UPDATE_JOB_FILE = \
    "/var/lib/pipedal-multifx-installer/ui-update-job.json"
MULTIFX_SETUP_COMMAND = "/usr/local/sbin/pipedal-multifx-setup"
MULTIFX_RELEASE_API = \
    "https://api.github.com/repos/MegaNoob75/PiPedal-MultiFX/releases/latest"
MULTIFX_UPDATE_UNIT = "pipedal-multifx-ui-update"
MULTIFX_RELEASE_PATTERN = re.compile(
    r"^multifx-v(\d+)\.(\d+)(?:\.(\d+))?([.-][A-Za-z0-9.-]+)?$"
)
MULTIFX_RELEASE_CACHE_SECONDS = 300
STATE_SCHEMA_VERSION = 3
RUNTIME_VERSION = 8
MAX_PRESET_SNAPSHOT_STATES = 512
MAX_SNAPSHOT_INDEX = 5

MFX_SYSEX_PREFIX = (0x7D, 0x4D, 0x46, 0x58)
CONTROLLER_PROTOCOL_VERSION = 2
CMD_CAPABILITY_REQUEST = 0x02
CMD_CAPABILITY_REPORT = 0x03
CMD_LEARN_START = 0x04
CMD_LEARN_CANCEL = 0x05
CMD_LEARN_RESULT = 0x06

# Protocol v4 extends the v3 atomic hardware transaction with a per-analog
# MIDI response threshold. The v1/v2 capability and Learn envelopes remain
# unchanged so discovery and learning stay backward compatible.
HARDWARE_PROTOCOL_VERSION = 4
CMD_PROFILE_REQUEST = 0x10
CMD_PROFILE_REPORT = 0x11
CMD_PROFILE_INPUT = 0x12
CMD_PROFILE_END = 0x13
CMD_CONFIG_BEGIN = 0x20
CMD_CONFIG_MODULE = 0x21
CMD_CONFIG_SWITCH = 0x22
CMD_CONFIG_ANALOG = 0x23
CMD_CONFIG_ENCODER = 0x24
CMD_CONFIG_COMMIT = 0x25
CMD_CONFIG_RESULT = 0x26
CMD_MODULE_SCAN = 0x30
CMD_MODULE_SCAN_RESULT = 0x31
PROFILE_FLAG_MODULE_SCAN = 0x20

CAPABILITY_DIGITAL = 0x01
CAPABILITY_ANALOG = 0x02
CAPABILITY_ENCODER = 0x08
CAPABILITY_ENCODER_PUSH = 0x10
SOURCE_GPIO = 0x00
SOURCE_MUX = 0x01
SOURCE_EXTERNAL_ADC = 0x02
SOURCE_GPIO_EXPANDER = 0x03
SOURCE_DESCRIPTOR_SIZE = 7

INPUT_AVAILABLE = 0x01
INPUT_RESERVED = 0x02
INPUT_ASSIGNED = 0x04
INPUT_CAUTION = 0x08
INPUT_RECOMMENDED = 0x10

CAPABILITY_OUTPUT = 0x04

DRIVER_HC4051 = 0x01
DRIVER_HC4067 = 0x02
DRIVER_MCP23017 = 0x03
DRIVER_ADS1015 = 0x04
DRIVER_ADS1115 = 0x05
DRIVER_IDS = {
    "hc4051": DRIVER_HC4051,
    "hc4067": DRIVER_HC4067,
    "mcp23017": DRIVER_MCP23017,
    "ads1015": DRIVER_ADS1015,
    "ads1115": DRIVER_ADS1115,
}
DRIVER_CATALOG = {
    DRIVER_HC4051: ("hc4051", "74HC4051"),
    DRIVER_HC4067: ("hc4067", "CD74HC4067"),
    DRIVER_MCP23017: ("mcp23017", "MCP23017"),
    DRIVER_ADS1015: ("ads1015", "ADS1015"),
    DRIVER_ADS1115: ("ads1115", "ADS1115"),
}

USAGE_NONE = 0x00
USAGE_SWITCH = 0x01
USAGE_ENCODER = 0x02
USAGE_ENCODER_PUSH = 0x03
USAGE_POT = 0x04
USAGE_USB = 0x05
USAGE_SYSTEM = 0x06

LEARN_STATUS_LEARNED = 0x00
LEARN_STATUS_TIMEOUT = 0x01
LEARN_STATUS_CANCELLED = 0x02
LEARN_STATUS_ERROR = 0x03
LEARN_STATUS_CONFLICT = 0x04

# Optional systemd override, e.g. MULTIFX_MIDI_DEVICE_HINT="PiPedal Control Surface".
MIDI_DEVICE_HINT = os.environ.get("MULTIFX_MIDI_DEVICE_HINT", "").strip().lower()

state_lock = threading.RLock()
multifx_update_lock = threading.RLock()
multifx_release_cache = {
    "checkedAt": 0.0,
    "release": None,
    "error": "",
}
state = {
    "version": RUNTIME_VERSION,
    "revision": 0,
    "instanceId": uuid.uuid4().hex,
    "snapshotMode": False,
    "snapshotModeBankId": None,
    "snapshotPresetId": None,
    "snapshotSessionInitialized": False,
    "presetSnapshotStates": {},
    "chainBypassed": False,
    "chainBypassBankId": None,
    "chainBypassPresetId": None,
    "chainBypassSnapshotIndex": None,
    "chainBypassWasPresetChanged": False,
    "chainBypassEnabledStates": {},
    "controllerConfig": None,
    "presetAssignments": {"version": 1, "banks": {}},
    "theme": None,
    "uiSettings": None,
    "controllerHardware": {
        "connected": False,
        "protocolVersion": None,
        "boardId": None,
        "boardName": None,
        "drivers": [],
        "moduleScanSupported": False,
        "limits": {"modules": 0, "analogControls": 0, "encoders": 0},
        "inputs": [],
        "apply": {
            "status": "idle",
            "token": None,
            "message": "",
        },
    },
    "controllerLearn": {
        "status": "idle",
        "token": None,
        "capability": None,
        "input": None,
        "message": "",
    },
    "controllerModuleScan": {
        "status": "idle",
        "token": None,
        "sdaPin": None,
        "sclPin": None,
        "devices": [],
        "message": "",
    },
}

midi_output_lock = threading.Lock()
midi_output_port = None
last_pushed_pin_signature = None
last_pushed_hardware_signature = None
next_controller_learn_token = 0
next_module_scan_token = 0
next_hardware_config_token = 0
physical_switch_lock = threading.Lock()
pressed_physical_switches = set()
profile_report_pending = None


def _deepcopy(value):
    return json.loads(json.dumps(value))


def _capability_names(flags):
    result = []
    if flags & CAPABILITY_DIGITAL:
        result.append("digital")
    if flags & CAPABILITY_ANALOG:
        result.append("analog")
    return result


def _module_id_for_instance(instance):
    """Resolve a transaction-local firmware module index to its durable ID."""
    with state_lock:
        controller = state.get("controllerConfig") or {}
        hardware = controller.get("hardware") or {}
        modules = hardware.get("modules") or []
        if 1 <= instance <= len(modules):
            module_id = modules[instance - 1].get("id")
            if isinstance(module_id, str) and module_id:
                return module_id
    return None


def _source_identity(source_type, instance, channel):
    """Return UI type, stable ID, label and optional durable module ID."""
    if source_type == SOURCE_GPIO:
        return "gpio", f"gpio:{channel}", f"GPIO {channel}", None
    module_id = _module_id_for_instance(instance)
    durable_id = module_id or f"module{instance}"
    if source_type == SOURCE_MUX:
        return "mux", f"module:{durable_id}:{channel}", f"{durable_id} · CH {channel}", module_id
    if source_type == SOURCE_EXTERNAL_ADC:
        return "externalAdc", f"module:{durable_id}:{channel}", f"{durable_id} · CH {channel}", module_id
    if source_type == SOURCE_GPIO_EXPANDER:
        return "gpioExpander", f"module:{durable_id}:{channel}", f"{durable_id} · CH {channel}", module_id
    return "other", f"other:{source_type}:{instance}:{channel}", f"Input {source_type}:{instance}:{channel}", module_id


def _usage_description(usage, usage_index):
    if usage == USAGE_SWITCH:
        return f"SW{usage_index}", f"Assigned to logical switch SW{usage_index}"
    if usage == USAGE_ENCODER:
        part = "A" if usage_index == 1 else "B" if usage_index == 2 else str(usage_index)
        return f"Encoder {part}", f"Reserved for encoder {part}"
    if usage == USAGE_ENCODER_PUSH:
        return "Encoder push", "Reserved for encoder push"
    if usage == USAGE_POT:
        return f"Pot {usage_index}", f"Reserved for Pot {usage_index}"
    if usage == USAGE_USB:
        return "USB MIDI", "Reserved for native USB MIDI"
    if usage == USAGE_SYSTEM:
        return "Controller system", "Reserved by the controller firmware"
    return None, None


def controller_input_descriptor(raw, reason_code=0):
    """Decode a compact firmware descriptor into browser-friendly metadata."""
    if len(raw) != SOURCE_DESCRIPTOR_SIZE:
        return None
    source_type, instance, channel, capability_flags, state_flags, usage, usage_index = raw
    capabilities = _capability_names(capability_flags)
    if not capabilities:
        return None
    input_type, stable_id, label, module_id = _source_identity(
        source_type, instance, channel
    )
    assigned_to, usage_reason = _usage_description(usage, usage_index)
    reserved = bool(state_flags & INPUT_RESERVED)
    assigned = bool(state_flags & INPUT_ASSIGNED)
    caution = bool(state_flags & INPUT_CAUTION)
    recommended = bool(state_flags & INPUT_RECOMMENDED)
    available = bool(state_flags & INPUT_AVAILABLE) and not reserved and not assigned
    reason = usage_reason
    if reason is None and reserved:
        reason = "Reserved by the controller profile"
    elif reason is None and assigned:
        reason = "Already assigned"
    elif reason is None and caution:
        reason = {
            1: "Boot-strapping pin; attached hardware must not force an unsafe boot level",
            2: "Connected to an onboard device on some board variants",
            3: "Normally used for serial logging",
        }.get(reason_code, "Usable with care on this board")

    return {
        "id": stable_id,
        "type": input_type,
        "instance": instance,
        "channel": channel,
        "moduleId": module_id,
        "capabilities": capabilities,
        "outputCapable": bool(capability_flags & CAPABILITY_OUTPUT),
        "label": label,
        "available": available,
        "reserved": reserved,
        "caution": caution,
        "recommended": recommended,
        "assignedTo": assigned_to,
        "reason": reason,
    }


def _valid_nonnegative_int(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _valid_snapshot_index(value):
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_SNAPSHOT_INDEX
    )


def _preset_snapshot_state_key(bank_id, preset_id):
    if not _valid_nonnegative_int(bank_id) or not _valid_nonnegative_int(preset_id):
        raise ValueError("preset snapshot bankId and presetId must be non-negative integers")
    return f"{bank_id}:{preset_id}"


def _normalize_preset_snapshot_states(value):
    """Validate and canonicalize the bounded transient per-preset snapshot map."""
    if not isinstance(value, dict):
        raise ValueError("presetSnapshotStates must be an object")
    if len(value) > MAX_PRESET_SNAPSHOT_STATES:
        raise ValueError("presetSnapshotStates has too many entries")

    result = {}
    for raw_key, raw_state in value.items():
        if not isinstance(raw_key, str) or not isinstance(raw_state, dict):
            raise ValueError("presetSnapshotStates contains an invalid entry")
        key_parts = raw_key.split(":")
        if len(key_parts) != 2 or any(not part.isdigit() for part in key_parts):
            raise ValueError("presetSnapshotStates contains an invalid key")
        bank_id, preset_id = (int(part) for part in key_parts)
        key = _preset_snapshot_state_key(bank_id, preset_id)
        if key != raw_key:
            raise ValueError("presetSnapshotStates keys must be canonical")
        if set(raw_state) != {"snapshotIndex", "enabled"}:
            raise ValueError("presetSnapshotStates contains an invalid value")
        snapshot_index = raw_state.get("snapshotIndex")
        enabled = raw_state.get("enabled")
        if not _valid_snapshot_index(snapshot_index) or not isinstance(enabled, bool):
            raise ValueError("presetSnapshotStates contains an invalid value")
        result[key] = {
            "snapshotIndex": snapshot_index,
            "enabled": enabled,
        }
    return result


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


DEFAULT_CONTROLLER_HARDWARE = {
    "version": 1,
    "boardProfile": "auto",
    "templateId": "esp32s3-reference",
    "modules": [],
    "analogControls": [
        {
            "id": f"pot{index + 1}",
            "label": f"POT {index + 1}",
            "style": "pot",
            "input": {"type": "gpio", "pin": pin},
            "midiCc": 10 + index,
            "calibrationMin": 0,
            "calibrationMax": 4095,
            "inverted": False,
            "filterShift": 4,
            "midiHysteresis": 2,
        }
        for index, pin in enumerate((8, 12, 13, 11))
    ],
    "encoders": [{
        "id": "encoder1",
        "label": "MAIN ENCODER",
        "aInput": {"type": "gpio", "pin": 18},
        "bInput": {"type": "gpio", "pin": 17},
        "buttonInput": {"type": "gpio", "pin": 21},
        "turnCc": 30,
        "buttonCc": 31,
        "stepsPerDetent": 4,
        "reversed": False,
    }],
}


def _validate_hardware_config(value, switch_inputs):
    """Validate topology and resource ownership before firmware transmission."""
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("controllerConfig.hardware must use version 1")
    if not isinstance(value.get("boardProfile"), str) or not value["boardProfile"].strip():
        raise ValueError("controller hardware boardProfile is invalid")
    if value.get("templateId") not in {"esp32s3-reference", "custom"}:
        raise ValueError("controller hardware templateId is invalid")
    modules = value.get("modules")
    analog_controls = value.get("analogControls")
    encoders = value.get("encoders")
    if not isinstance(modules, list) or len(modules) > 4:
        raise ValueError("controller hardware modules are invalid")
    if not isinstance(analog_controls, list) or len(analog_controls) > 16:
        raise ValueError("controller analog controls are invalid")
    if not isinstance(encoders, list) or len(encoders) > 4:
        raise ValueError("controller encoders are invalid")

    module_by_id = {}
    gpio_owners = {}
    i2c_pins = None
    i2c_addresses = set()

    def claim_gpio(pin, owner, shared_i2c=False):
        if not isinstance(pin, int) or isinstance(pin, bool) or not 0 <= pin <= 126:
            raise ValueError(f"{owner} has an invalid GPIO")
        previous = gpio_owners.get(pin)
        if previous is not None and not shared_i2c:
            raise ValueError(f"GPIO {pin} is used by both {previous} and {owner}")
        gpio_owners.setdefault(pin, owner)

    for module in modules:
        if not isinstance(module, dict):
            raise ValueError("controller module must be an object")
        module_id = module.get("id")
        label = module.get("label")
        driver = module.get("driver")
        if not isinstance(module_id, str) or not module_id or module_id in module_by_id:
            raise ValueError("controller module IDs must be unique")
        if not isinstance(label, str) or not label.strip() or driver not in DRIVER_IDS:
            raise ValueError(f"controller module {module_id} is invalid")
        module_by_id[module_id] = module
        if driver in {"hc4051", "hc4067"}:
            select_count = 3 if driver == "hc4051" else 4
            select_pins = module.get("selectPins")
            if not isinstance(select_pins, list) or len(select_pins) != select_count:
                raise ValueError(f"{label} select pins are invalid")
            claim_gpio(module.get("signalPin"), f"{label} signal")
            for index, pin in enumerate(select_pins):
                claim_gpio(pin, f"{label} S{index}")
            enable_pin = module.get("enablePin")
            if enable_pin is not None:
                claim_gpio(enable_pin, f"{label} enable")
        else:
            sda = module.get("sdaPin")
            scl = module.get("sclPin")
            if sda == scl:
                raise ValueError(f"{label} I2C pins are invalid")
            if i2c_pins is None:
                claim_gpio(sda, "I2C SDA")
                claim_gpio(scl, "I2C SCL")
                i2c_pins = (sda, scl)
            elif i2c_pins != (sda, scl):
                raise ValueError("all I2C modules must share SDA and SCL")
            address = module.get("address")
            address_range = range(0x20, 0x28) if driver == "mcp23017" else range(0x48, 0x4C)
            if address not in address_range or address in i2c_addresses:
                raise ValueError(f"{label} I2C address is invalid or duplicated")
            i2c_addresses.add(address)

    claimed_sources = set()

    def validate_source(source, capability, owner, optional=False):
        if source is None and optional:
            return None
        if not isinstance(source, dict):
            raise ValueError(f"{owner} input is invalid")
        if source.get("type") == "gpio":
            pin = source.get("pin")
            claim_gpio(pin, owner)
            key = f"gpio:{pin}"
        elif source.get("type") == "module":
            module = module_by_id.get(source.get("moduleId"))
            channel = source.get("channel")
            if module is None or not isinstance(channel, int) or isinstance(channel, bool):
                raise ValueError(f"{owner} module input is invalid")
            driver = module["driver"]
            channel_count = 8 if driver == "hc4051" else 16 if driver in {"hc4067", "mcp23017"} else 4
            supported = (
                driver in {"hc4051", "hc4067"}
                or capability == "digital" and driver == "mcp23017"
                or capability == "analog" and driver in {"ads1015", "ads1115"}
            )
            if not 0 <= channel < channel_count or not supported:
                raise ValueError(f"{owner} uses an incompatible module channel")
            key = f"module:{module['id']}:{channel}"
        else:
            raise ValueError(f"{owner} input type is invalid")
        if key in claimed_sources:
            raise ValueError(f"physical input {key} is assigned more than once")
        claimed_sources.add(key)
        return source

    for index, source in enumerate(switch_inputs):
        if source is not None:
            validate_source(source, "digital", f"SW{index + 1}")

    control_ids = set()
    midi_ccs = set()
    for control in analog_controls:
        if not isinstance(control, dict):
            raise ValueError("analog control must be an object")
        control_id = control.get("id")
        label = control.get("label")
        if not isinstance(control_id, str) or not control_id or control_id in control_ids:
            raise ValueError("analog control IDs must be unique")
        if not isinstance(label, str) or not label.strip() or control.get("style") not in {"pot", "slider", "expression"}:
            raise ValueError(f"analog control {control_id} is invalid")
        cc = control.get("midiCc")
        minimum = control.get("calibrationMin")
        maximum = control.get("calibrationMax")
        filter_shift = control.get("filterShift")
        midi_hysteresis = control.get("midiHysteresis")
        if not isinstance(cc, int) or isinstance(cc, bool) or not 0 <= cc <= 119 or cc in midi_ccs:
            raise ValueError(f"{label} MIDI CC is invalid or duplicated")
        if not isinstance(minimum, int) or not isinstance(maximum, int) or not 0 <= minimum < maximum <= 4095:
            raise ValueError(f"{label} calibration is invalid")
        if not isinstance(filter_shift, int) or isinstance(filter_shift, bool) or not 0 <= filter_shift <= 7:
            raise ValueError(f"{label} filter is invalid")
        if not isinstance(midi_hysteresis, int) or isinstance(midi_hysteresis, bool) or not 1 <= midi_hysteresis <= 4:
            raise ValueError(f"{label} analog response is invalid")
        if not isinstance(control.get("inverted"), bool):
            raise ValueError(f"{label} direction is invalid")
        source = control.get("input")
        if source is not None:
            validate_source(source, "analog", label)
        control_ids.add(control_id)
        midi_ccs.add(cc)

    for encoder in encoders:
        if not isinstance(encoder, dict):
            raise ValueError("encoder must be an object")
        encoder_id = encoder.get("id")
        label = encoder.get("label")
        if not isinstance(encoder_id, str) or not encoder_id or encoder_id in control_ids:
            raise ValueError("encoder IDs must be unique")
        if not isinstance(label, str) or not label.strip():
            raise ValueError(f"encoder {encoder_id} is invalid")
        validate_source(encoder.get("aInput"), "digital", f"{label} A")
        validate_source(encoder.get("bInput"), "digital", f"{label} B")
        validate_source(encoder.get("buttonInput"), "digital", f"{label} button", True)
        for field in ("turnCc", "buttonCc"):
            cc = encoder.get(field)
            if not isinstance(cc, int) or isinstance(cc, bool) or not 0 <= cc <= 119 or cc in midi_ccs:
                raise ValueError(f"{label} MIDI CC is invalid or duplicated")
            midi_ccs.add(cc)
        steps = encoder.get("stepsPerDetent")
        if not isinstance(steps, int) or isinstance(steps, bool) or not 1 <= steps <= 4:
            raise ValueError(f"{label} transitions per detent is invalid")
        if not isinstance(encoder.get("reversed"), bool):
            raise ValueError(f"{label} direction is invalid")
        control_ids.add(encoder_id)

    return _deepcopy(value)


def _validate_controller_config(value):
    """Validate the current unreleased controller schema without migration."""
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("schemaVersion") != STATE_SCHEMA_VERSION:
        raise ValueError("controllerConfig must use schemaVersion 3")
    switches = value.get("switches")
    if not isinstance(switches, list) or len(switches) > MAX_FOOTSWITCHES:
        raise ValueError("controllerConfig.switches is invalid")
    for item in switches:
        if not isinstance(item, dict):
            raise ValueError("controller switch must be an object")
        hardware = item.get("hardwareSwitch")
        source = item.get("input")
        if not isinstance(hardware, int) or isinstance(hardware, bool) or not 1 <= hardware <= MAX_FOOTSWITCHES:
            raise ValueError("controller switch hardwareSwitch is invalid")
        if source is not None and not isinstance(source, dict):
            raise ValueError("controller switch input is invalid")
    _validate_hardware_config(value.get("hardware"), [
        item.get("input") for item in switches
    ])
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
        "theme": state.get("theme"),
        "uiSettings": state.get("uiSettings"),
    }


def _validate_theme(value):
    """Accept a bounded current or legacy theme for cross-display sharing."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("theme must be an object")
    if value.get("version") not in {3, 4}:
        raise ValueError("theme must use version 3 or 4")
    if not isinstance(value.get("name"), str) or not value["name"].strip():
        raise ValueError("theme name is invalid")
    if not isinstance(value.get("colors"), dict) or not isinstance(value.get("appearance"), dict):
        raise ValueError("theme colors or appearance are invalid")
    if len(json.dumps(value, separators=(",", ":"))) > 200000:
        raise ValueError("theme is too large")
    return _deepcopy(value)


def _validate_ui_settings(value):
    """Validate shared, non-audio MultiFX interaction/timing preferences."""
    if value is None:
        return None
    if not isinstance(value, dict) or isinstance(value, list):
        raise ValueError("uiSettings must be an object")
    expected = {
        "version",
        "physicalControlPopout",
        "touchControlPopout",
        "controlPopoutDurationMs",
        "controlPopoutScale",
        "parameterFeedbackEnabled",
        "statusToastDurationMs",
    }
    if set(value) != expected or value.get("version") != 1:
        raise ValueError("uiSettings must use the complete version 1 schema")
    for field in (
        "physicalControlPopout",
        "touchControlPopout",
        "parameterFeedbackEnabled",
    ):
        if not isinstance(value.get(field), bool):
            raise ValueError(f"uiSettings.{field} must be boolean")

    def bounded_number(field, minimum, maximum):
        setting = value.get(field)
        if (not isinstance(setting, (int, float))
                or isinstance(setting, bool)
                or not math.isfinite(setting)
                or not minimum <= setting <= maximum):
            raise ValueError(f"uiSettings.{field} is out of range")

    bounded_number("controlPopoutDurationMs", 500, 10000)
    bounded_number("controlPopoutScale", 1.2, 2.5)
    bounded_number("statusToastDurationMs", 500, 10000)
    return _deepcopy(value)


def _save_persistent_locked():
    os.makedirs(os.path.dirname(PERSISTENT_STATE_FILE), exist_ok=True)
    temp = f"{PERSISTENT_STATE_FILE}.tmp"
    with open(temp, "w", encoding="utf-8") as file:
        json.dump(_persistent_payload_locked(), file, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())
    os.replace(temp, PERSISTENT_STATE_FILE)


def load_persistent_state():
    """Restore current state or atomically replace incompatible unreleased data."""
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
        raw_controller = saved.get("controllerConfig")
        controller = _validate_controller_config(raw_controller)
        assignments = _normalize_assignments(saved.get("presetAssignments", {"version": 1, "banks": {}}))
        theme = _validate_theme(saved.get("theme"))
        ui_settings = _validate_ui_settings(saved.get("uiSettings"))
        with state_lock:
            state["controllerConfig"] = controller
            state["presetAssignments"] = assignments
            state["theme"] = theme
            state["uiSettings"] = ui_settings
        print(f"Restored MultiFX state from {PERSISTENT_STATE_FILE}.", flush=True)
    except Exception as error:
        # This feature is not released, so partial migration is riskier than a
        # deliberate factory reset of only MultiFX controller/assignment data.
        print(f"Ignoring incompatible MultiFX state: {error}", file=sys.stderr, flush=True)
        with state_lock:
            state["controllerConfig"] = _load_factory_controller_config()
            state["presetAssignments"] = {"version": 1, "banks": {}}
            state["theme"] = None
            state["uiSettings"] = None
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


def _expire_module_scan(token):
    """Release a scan UI if its terminal SysEx packet is ever lost."""
    with state_lock:
        scan = state["controllerModuleScan"]
        if scan.get("token") != token or scan.get("status") != "scanning":
            return
        scan["status"] = "error"
        scan["message"] = "I2C discovery timed out. Check the bus pins and try again."
        state["revision"] += 1


def update_state(patch):
    global next_controller_learn_token, next_module_scan_token
    if not isinstance(patch, dict):
        raise ValueError("JSON object required")

    persistent_changed = False
    controller_changed = False
    controller_command = None
    controller_command_kind = None
    controller_command_capability = None
    release_switches_for_learn = False

    with state_lock:
        if "snapshotMode" in patch:
            state["snapshotMode"] = bool(patch["snapshotMode"])
        if "snapshotModeBankId" in patch:
            value = patch["snapshotModeBankId"]
            if value is not None and not _valid_nonnegative_int(value):
                raise ValueError("snapshotModeBankId must be a non-negative integer or null")
            state["snapshotModeBankId"] = value
        if "snapshotPresetId" in patch:
            value = patch["snapshotPresetId"]
            state["snapshotPresetId"] = value if _valid_nonnegative_int(value) else None
        if "snapshotSessionInitialized" in patch:
            value = patch["snapshotSessionInitialized"]
            if not isinstance(value, bool):
                raise ValueError("snapshotSessionInitialized must be boolean")
            state["snapshotSessionInitialized"] = value
        if "presetSnapshotStateUpdate" in patch:
            op = patch["presetSnapshotStateUpdate"]
            if not isinstance(op, dict) or set(op) != {
                    "bankId", "presetId", "snapshotIndex", "enabled"}:
                raise ValueError("presetSnapshotStateUpdate must use the complete schema")
            bank_id = op.get("bankId")
            preset_id = op.get("presetId")
            snapshot_index = op.get("snapshotIndex")
            enabled = op.get("enabled")
            key = _preset_snapshot_state_key(bank_id, preset_id)
            if not isinstance(enabled, bool):
                raise ValueError("presetSnapshotStateUpdate.enabled must be boolean")
            if snapshot_index is None:
                state["presetSnapshotStates"].pop(key, None)
            else:
                if not _valid_snapshot_index(snapshot_index):
                    raise ValueError(
                        "presetSnapshotStateUpdate.snapshotIndex must be between 0 and 5"
                    )
                # Treat insertion order as a lightweight LRU. A long-running UI
                # session therefore stays bounded without making a valid update
                # fail merely because many banks and presets were visited.
                state["presetSnapshotStates"].pop(key, None)
                while len(state["presetSnapshotStates"]) >= MAX_PRESET_SNAPSHOT_STATES:
                    state["presetSnapshotStates"].pop(
                        next(iter(state["presetSnapshotStates"]))
                    )
                state["presetSnapshotStates"][key] = {
                    "snapshotIndex": snapshot_index,
                    "enabled": enabled,
                }
            state["presetSnapshotStates"] = _normalize_preset_snapshot_states(
                state["presetSnapshotStates"]
            )
        if "resetPresetSnapshotStates" in patch:
            value = patch["resetPresetSnapshotStates"]
            if not isinstance(value, bool):
                raise ValueError("resetPresetSnapshotStates must be boolean")
            if value:
                state["presetSnapshotStates"] = {}
        if "chainBypassed" in patch:
            state["chainBypassed"] = bool(patch["chainBypassed"])
        if "chainBypassBankId" in patch:
            value = patch["chainBypassBankId"]
            if value is not None and not _valid_nonnegative_int(value):
                raise ValueError("chainBypassBankId must be a non-negative integer or null")
            state["chainBypassBankId"] = value
        if "chainBypassPresetId" in patch:
            value = patch["chainBypassPresetId"]
            state["chainBypassPresetId"] = value if _valid_nonnegative_int(value) else None
        if "chainBypassSnapshotIndex" in patch:
            value = patch["chainBypassSnapshotIndex"]
            if value is not None and not _valid_snapshot_index(value):
                raise ValueError("chainBypassSnapshotIndex must be between 0 and 5 or null")
            state["chainBypassSnapshotIndex"] = value
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

        if "theme" in patch:
            state["theme"] = _validate_theme(patch["theme"])
            persistent_changed = True

        if "uiSettings" in patch:
            state["uiSettings"] = _validate_ui_settings(patch["uiSettings"])
            persistent_changed = True

        if "controllerModuleScanStart" in patch:
            op = patch["controllerModuleScanStart"]
            if not isinstance(op, dict):
                raise ValueError("controllerModuleScanStart must be an object")
            sda_pin = op.get("sdaPin")
            scl_pin = op.get("sclPin")
            if (not isinstance(sda_pin, int) or isinstance(sda_pin, bool)
                    or not 0 <= sda_pin <= 126
                    or not isinstance(scl_pin, int) or isinstance(scl_pin, bool)
                    or not 0 <= scl_pin <= 126 or sda_pin == scl_pin):
                raise ValueError("I2C scan pins are invalid")
            hardware = state["controllerHardware"]
            if not hardware["connected"] or not hardware.get("moduleScanSupported"):
                raise ValueError("connected controller does not support I2C discovery")
            output_pins = {
                item.get("channel") for item in hardware.get("inputs", [])
                if item.get("type") == "gpio" and item.get("outputCapable")
                and not item.get("reserved")
            }
            if sda_pin not in output_pins or scl_pin not in output_pins:
                raise ValueError("I2C scan pins are not available output-capable GPIOs")
            next_module_scan_token = (next_module_scan_token % 126) + 1
            token = next_module_scan_token
            state["controllerModuleScan"] = {
                "status": "scanning",
                "token": token,
                "sdaPin": sda_pin,
                "sclPin": scl_pin,
                "devices": [],
                "message": "Scanning the selected I2C bus…",
            }
            controller_command = list(MFX_SYSEX_PREFIX) + [
                HARDWARE_PROTOCOL_VERSION,
                CMD_MODULE_SCAN,
                token,
                sda_pin,
                scl_pin,
            ]
            controller_command_kind = "moduleScan"

        if "controllerLearnStart" in patch:
            op = patch["controllerLearnStart"]
            capability = op.get("capability") if isinstance(op, dict) else None
            if capability not in {"digital", "analog", "encoder", "encoderPush"}:
                raise ValueError("Learn capability is invalid")
            target_index = op.get("hardwareSwitch")
            maximum_target = (
                MAX_FOOTSWITCHES if capability == "digital"
                else 4 if capability in {"encoder", "encoderPush"}
                else MAX_ANALOG_CONTROLS
            )
            if not isinstance(target_index, int) or isinstance(target_index, bool) or not 1 <= target_index <= maximum_target:
                raise ValueError("controllerLearnStart target index is invalid")
            hardware = state["controllerHardware"]
            if not hardware["connected"]:
                raise ValueError("controller is not connected")
            # Hardware protocol v3 retains the v2 Learn command envelope.
            if (hardware["protocolVersion"] or 0) < CONTROLLER_PROTOCOL_VERSION:
                raise ValueError("connected controller does not support Learn")
            candidates = [
                item for item in hardware["inputs"]
                if ("digital" if capability in {"encoder", "encoderPush"} else capability)
                in item.get("capabilities", [])
                and not item.get("reserved", False)
            ]
            if not candidates:
                raise ValueError(f"controller reported no learnable {capability} inputs")

            next_controller_learn_token = (next_controller_learn_token % 126) + 1
            token = next_controller_learn_token
            state["controllerLearn"] = {
                "status": "waiting",
                "token": token,
                "capability": capability,
                "input": None,
                "message": (
                    "Waiting for switch press…"
                    if capability == "digital"
                    else "Turn the encoder through several clicks…"
                    if capability == "encoder"
                    else "Press the encoder push button…"
                    if capability == "encoderPush"
                    else "Move the pot, slider, or expression control steadily…"
                ),
            }
            controller_command = list(MFX_SYSEX_PREFIX) + [
                CONTROLLER_PROTOCOL_VERSION,
                CMD_LEARN_START,
                token,
                CAPABILITY_DIGITAL if capability == "digital"
                else CAPABILITY_ENCODER if capability == "encoder"
                else CAPABILITY_ENCODER_PUSH if capability == "encoderPush"
                else CAPABILITY_ANALOG,
                target_index,
            ]
            controller_command_kind = "start"
            controller_command_capability = capability
            release_switches_for_learn = capability == "digital"

        if "controllerLearnCancel" in patch:
            op = patch["controllerLearnCancel"]
            token = op.get("token") if isinstance(op, dict) else None
            if not isinstance(token, int) or isinstance(token, bool) or not 1 <= token <= 126:
                raise ValueError("controllerLearnCancel.token is invalid")
            current_learn = state["controllerLearn"]
            if current_learn.get("token") == token:
                controller_command_capability = current_learn.get("capability")
                if current_learn.get("status") == "waiting":
                    controller_command = list(MFX_SYSEX_PREFIX) + [
                        CONTROLLER_PROTOCOL_VERSION,
                        CMD_LEARN_CANCEL,
                        token,
                    ]
                    controller_command_kind = "cancel"
                state["controllerLearn"] = {
                    "status": "idle",
                    "token": None,
                    "capability": None,
                    "input": None,
                    "message": "",
                }

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
        if (result["controllerHardware"].get("protocolVersion") or 0) >= HARDWARE_PROTOCOL_VERSION:
            push_controller_hardware_config(result["controllerConfig"])
        else:
            # Old firmware continues to receive the compatible direct-GPIO map.
            push_controller_pin_config(result["controllerConfig"])
    if release_switches_for_learn:
        release_pressed_physical_switches()
    if controller_command is not None:
        if not send_controller_sysex(controller_command, "controller command"):
            with state_lock:
                current_learn = state["controllerLearn"]
                if controller_command_kind == "start" and current_learn.get("status") == "waiting":
                    state["controllerLearn"] = {
                        "status": "error",
                        "token": current_learn.get("token"),
                        "capability": current_learn.get("capability"),
                        "input": None,
                        "message": "Could not send Learn command to the controller.",
                    }
                    state["revision"] += 1
                elif controller_command_kind == "cancel":
                    state["controllerLearn"] = {
                        "status": "error",
                        "token": token,
                        "capability": controller_command_capability,
                        "input": None,
                        "message": "Could not send Cancel. The controller will leave Learn when its timeout expires.",
                    }
                    state["revision"] += 1
                elif controller_command_kind == "moduleScan":
                    state["controllerModuleScan"] = {
                        "status": "error",
                        "token": token,
                        "sdaPin": state["controllerModuleScan"].get("sdaPin"),
                        "sclPin": state["controllerModuleScan"].get("sclPin"),
                        "devices": [],
                        "message": "Could not send the I2C discovery command.",
                    }
                    state["revision"] += 1
            return get_state()
        if controller_command_kind == "moduleScan":
            timeout = threading.Timer(4.0, _expire_module_scan, args=(token,))
            timeout.daemon = True
            timeout.start()
    return get_state() if controller_command is not None else result


def controller_pin_pairs(controller_config):
    """Build the legacy direct-GPIO map for v1-only controller firmware."""
    pins = {switch: 127 for switch in range(1, MAX_FOOTSWITCHES + 1)}
    if not isinstance(controller_config, dict):
        return [(switch, pins[switch]) for switch in pins]
    for item in controller_config.get("switches", []):
        hardware = item["hardwareSwitch"]
        source = item.get("input")
        pins[hardware] = source["pin"] if isinstance(source, dict) and source.get("type") == "gpio" else 127
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
            print("Legacy GPIO map -> " + ", ".join(
                f"SW{sw}={'OFF' if pin == 127 else f'GPIO{pin}'}" for sw, pin in signature
            ), flush=True)
            return True
        except Exception as error:
            print(f"Legacy GPIO map send warning: {error}", file=sys.stderr, flush=True)
            return False


def _split_14bit(value):
    """Encode a 0..16383 integer as two MIDI-safe seven-bit bytes."""
    return [value & 0x7F, (value >> 7) & 0x7F]


def _wire_source(source, module_indexes, module_by_id):
    """Encode a durable JSON source as TYPE, INSTANCE, CHANNEL bytes."""
    if source is None:
        return [127, 0, 0]
    if source["type"] == "gpio":
        return [SOURCE_GPIO, 0, source["pin"]]
    module_id = source["moduleId"]
    module = module_by_id[module_id]
    driver = module["driver"]
    source_type = (
        SOURCE_MUX if driver in {"hc4051", "hc4067"}
        else SOURCE_GPIO_EXPANDER if driver == "mcp23017"
        else SOURCE_EXTERNAL_ADC
    )
    return [source_type, module_indexes[module_id], source["channel"]]


def make_hardware_config_messages(controller_config, token):
    """Serialize one validated controller config into a v4 transaction."""
    hardware = controller_config["hardware"]
    modules = hardware["modules"]
    module_indexes = {
        module["id"]: index + 1 for index, module in enumerate(modules)
    }
    module_by_id = {module["id"]: module for module in modules}
    active_analogs = [
        control for control in hardware["analogControls"]
        if control.get("input") is not None
    ]
    encoders = hardware["encoders"]
    messages = [list(MFX_SYSEX_PREFIX) + [
        HARDWARE_PROTOCOL_VERSION,
        CMD_CONFIG_BEGIN,
        token,
        len(modules),
        MAX_FOOTSWITCHES,
        len(active_analogs),
        len(encoders),
    ]]

    for index, module in enumerate(modules, 1):
        pins = [127] * 6
        address = 0
        if module["driver"] in {"hc4051", "hc4067"}:
            pins[0] = module["signalPin"]
            for select_index, pin in enumerate(module["selectPins"]):
                pins[1 + select_index] = pin
            pins[5] = 127 if module.get("enablePin") is None else module["enablePin"]
        else:
            address = module["address"]
            pins[0] = module["sdaPin"]
            pins[1] = module["sclPin"]
        messages.append(list(MFX_SYSEX_PREFIX) + [
            HARDWARE_PROTOCOL_VERSION,
            CMD_CONFIG_MODULE,
            token,
            index,
            DRIVER_IDS[module["driver"]],
            address,
            *pins,
        ])

    switch_by_number = {
        item["hardwareSwitch"]: item for item in controller_config["switches"]
    }
    for switch_number in range(1, MAX_FOOTSWITCHES + 1):
        item = switch_by_number.get(switch_number)
        source = None if item is None else item.get("input")
        messages.append(list(MFX_SYSEX_PREFIX) + [
            HARDWARE_PROTOCOL_VERSION,
            CMD_CONFIG_SWITCH,
            token,
            switch_number,
            *_wire_source(source, module_indexes, module_by_id),
            0x03,  # Active-low input with an internal pull-up when supported.
        ])

    for index, control in enumerate(active_analogs, 1):
        flags = 0x01 if control["inverted"] else 0
        messages.append(list(MFX_SYSEX_PREFIX) + [
            HARDWARE_PROTOCOL_VERSION,
            CMD_CONFIG_ANALOG,
            token,
            index,
            *_wire_source(control["input"], module_indexes, module_by_id),
            control["midiCc"],
            control["filterShift"],
            *_split_14bit(control["calibrationMin"]),
            *_split_14bit(control["calibrationMax"]),
            flags,
            control["midiHysteresis"],
        ])

    for index, encoder in enumerate(encoders, 1):
        flags = 0x01 if encoder["reversed"] else 0
        messages.append(list(MFX_SYSEX_PREFIX) + [
            HARDWARE_PROTOCOL_VERSION,
            CMD_CONFIG_ENCODER,
            token,
            index,
            *_wire_source(encoder["aInput"], module_indexes, module_by_id),
            *_wire_source(encoder["bInput"], module_indexes, module_by_id),
            *_wire_source(encoder.get("buttonInput"), module_indexes, module_by_id),
            encoder["turnCc"],
            encoder["buttonCc"],
            encoder["stepsPerDetent"],
            flags,
        ])

    messages.append(list(MFX_SYSEX_PREFIX) + [
        HARDWARE_PROTOCOL_VERSION,
        CMD_CONFIG_COMMIT,
        token,
    ])
    return messages


def push_controller_hardware_config(controller_config, force=False):
    """Send, track, and await one all-or-nothing firmware configuration."""
    global next_hardware_config_token, last_pushed_hardware_signature
    signature = json.dumps(controller_config, sort_keys=True, separators=(",", ":"))
    if not force and signature == last_pushed_hardware_signature:
        return True
    next_hardware_config_token = (next_hardware_config_token % 126) + 1
    token = next_hardware_config_token
    messages = make_hardware_config_messages(controller_config, token)
    with state_lock:
        state["controllerHardware"]["apply"] = {
            "status": "applying",
            "token": token,
            "message": "Sending and validating controller hardware…",
        }
        state["revision"] += 1
    for message in messages:
        if not send_controller_sysex(message, "hardware configuration"):
            with state_lock:
                state["controllerHardware"]["apply"] = {
                    "status": "error",
                    "token": token,
                    "message": "Could not send the complete hardware configuration.",
                }
                state["revision"] += 1
            return False
    last_pushed_hardware_signature = signature
    print(
        f"Controller hardware -> {len(messages)} transaction records (token {token}).",
        flush=True,
    )
    return True


def send_controller_sysex(data, description):
    try:
        message = mido.Message("sysex", data=data)
    except Exception as error:
        print(f"Invalid {description} SysEx: {error}", file=sys.stderr, flush=True)
        return False
    with midi_output_lock:
        if midi_output_port is None:
            return False
        try:
            midi_output_port.send(message)
            return True
        except Exception as error:
            print(f"{description} send warning: {error}", file=sys.stderr, flush=True)
            return False


def request_controller_capabilities():
    """Request the compatible v2 capability report used by Learn."""
    return send_controller_sysex(
        list(MFX_SYSEX_PREFIX) + [
            CONTROLLER_PROTOCOL_VERSION,
            CMD_CAPABILITY_REQUEST,
        ],
        "capability request",
    )


def request_controller_profile():
    """Request the chunked v3 board profile and compiled driver catalog."""
    return send_controller_sysex(
        list(MFX_SYSEX_PREFIX) + [
            HARDWARE_PROTOCOL_VERSION,
            CMD_PROFILE_REQUEST,
        ],
        "hardware profile request",
    )


def set_controller_connected(connected):
    """Reset transient discovery/apply state on MIDI connect or disconnect."""
    global profile_report_pending
    profile_report_pending = None
    with state_lock:
        state["controllerHardware"] = {
            "connected": bool(connected),
            "protocolVersion": None,
            "boardId": None,
            "boardName": None,
            "drivers": [],
            "moduleScanSupported": False,
            "limits": {"modules": 0, "analogControls": 0, "encoders": 0},
            "inputs": [],
            "apply": {
                "status": "idle",
                "token": None,
                "message": "",
            },
        }
        current_learn = state["controllerLearn"]
        if connected:
            state["controllerLearn"] = {
                "status": "idle",
                "token": None,
                "capability": None,
                "input": None,
                "message": "",
            }
        elif current_learn.get("status") == "waiting":
            state["controllerLearn"] = {
                "status": "error",
                "token": current_learn.get("token"),
                "capability": current_learn.get("capability"),
                "input": None,
                "message": "Controller disconnected during Learn.",
            }
        current_scan = state["controllerModuleScan"]
        state["controllerModuleScan"] = {
            "status": "idle" if connected else (
                "error" if current_scan.get("status") == "scanning"
                else current_scan.get("status", "idle")
            ),
            "token": None if connected else current_scan.get("token"),
            "sdaPin": current_scan.get("sdaPin"),
            "sclPin": current_scan.get("sclPin"),
            "devices": [] if connected else current_scan.get("devices", []),
            "message": "" if connected else (
                "Controller disconnected during I2C discovery."
                if current_scan.get("status") == "scanning"
                else current_scan.get("message", "")
            ),
        }
        state["revision"] += 1


def _handle_capability_report(data):
    if len(data) < 8:
        return False
    name_length = data[6]
    name_start = 7
    count_offset = name_start + name_length
    if count_offset >= len(data):
        return False
    source_count = data[count_offset]
    descriptor_start = count_offset + 1
    if len(data) != descriptor_start + source_count * SOURCE_DESCRIPTOR_SIZE:
        return False
    try:
        board_name = bytes(data[name_start:count_offset]).decode("ascii").strip()
    except UnicodeDecodeError:
        return False
    if not board_name:
        board_name = "MultiFX Controller"

    inputs = []
    for index in range(source_count):
        offset = descriptor_start + index * SOURCE_DESCRIPTOR_SIZE
        descriptor = controller_input_descriptor(
            data[offset:offset + SOURCE_DESCRIPTOR_SIZE]
        )
        if descriptor is not None:
            inputs.append(descriptor)

    with state_lock:
        hardware = state["controllerHardware"]
        hardware["connected"] = True
        hardware["protocolVersion"] = max(
            hardware.get("protocolVersion") or 0,
            CONTROLLER_PROTOCOL_VERSION,
        )
        hardware["boardName"] = board_name
        if hardware["protocolVersion"] < HARDWARE_PROTOCOL_VERSION:
            hardware["inputs"] = inputs
        state["revision"] += 1
    print(
        f"Controller capabilities <- {board_name}: {len(inputs)} inputs.",
        flush=True,
    )
    return True


def _handle_learn_result(data):
    if len(data) not in {
        8 + SOURCE_DESCRIPTOR_SIZE,
        8 + 2 * SOURCE_DESCRIPTOR_SIZE,
    }:
        return False
    token = data[6]
    result_code = data[7]
    if len(data) == 8 + 2 * SOURCE_DESCRIPTOR_SIZE:
        descriptor = controller_input_descriptor(data[8:8 + SOURCE_DESCRIPTOR_SIZE])
        secondary_descriptor = controller_input_descriptor(
            data[8 + SOURCE_DESCRIPTOR_SIZE:8 + 2 * SOURCE_DESCRIPTOR_SIZE]
        )
    else:
        descriptor = controller_input_descriptor(data[8:])
        secondary_descriptor = None
    statuses = {
        LEARN_STATUS_LEARNED: "learned",
        LEARN_STATUS_TIMEOUT: "timeout",
        LEARN_STATUS_CANCELLED: "cancelled",
        LEARN_STATUS_ERROR: "error",
        LEARN_STATUS_CONFLICT: "conflict",
    }
    status = statuses.get(result_code)
    if status is None:
        return False
    if status in {"learned", "conflict"} and descriptor is None:
        return False

    if status == "learned":
        message = f"Learned {descriptor['label']}."
    elif status == "conflict":
        usage = descriptor.get("assignedTo") or "another controller function"
        message = f"{descriptor['label']} is already assigned to {usage}."
    elif status == "timeout":
        message = "Learn timed out. No matching input activity was detected."
    elif status == "cancelled":
        message = "Learn cancelled."
    else:
        message = "The controller could not complete Learn."

    with state_lock:
        current = state["controllerLearn"]
        if current.get("status") != "waiting" or current.get("token") != token:
            return True
        state["controllerLearn"] = {
            "status": status,
            "token": token,
            "capability": current.get("capability"),
            "input": descriptor,
            "secondaryInput": secondary_descriptor,
            "message": message,
        }
        state["revision"] += 1
    print(f"Controller Learn <- {message}", flush=True)
    return True


def _handle_profile_report(data):
    """Begin a chunked portable board-profile report from the controller."""
    global profile_report_pending
    if len(data) < 11:
        return False
    name_length = data[6]
    name_start = 7
    settings_start = name_start + name_length
    if len(data) != settings_start + 4:
        return False
    try:
        board_name = bytes(data[name_start:settings_start]).decode("ascii").strip()
    except UnicodeDecodeError:
        return False
    if not board_name:
        board_name = "MultiFX Controller"
    driver_mask = data[settings_start + 3]
    drivers = [
        {"id": driver_id, "label": label}
        for numeric_id, (driver_id, label) in DRIVER_CATALOG.items()
        if driver_mask & (1 << (numeric_id - 1))
    ]
    board_id = "".join(
        character.lower() if character.isalnum() else "-"
        for character in board_name
    ).strip("-")
    while "--" in board_id:
        board_id = board_id.replace("--", "-")
    profile_report_pending = {
        "boardId": board_id or "multifx-controller",
        "boardName": board_name,
        "drivers": drivers,
        "moduleScanSupported": bool(driver_mask & PROFILE_FLAG_MODULE_SCAN),
        "limits": {
            "modules": data[settings_start],
            "analogControls": data[settings_start + 1],
            "encoders": data[settings_start + 2],
        },
        "inputs": [],
    }
    return True


def _handle_profile_input(data):
    """Append one source descriptor to the in-progress hardware profile."""
    global profile_report_pending
    if profile_report_pending is None or len(data) != 6 + SOURCE_DESCRIPTOR_SIZE + 1:
        return False
    descriptor = controller_input_descriptor(data[6:13], data[13])
    if descriptor is not None:
        profile_report_pending["inputs"].append(descriptor)
    return True


def _handle_profile_end(data):
    """Publish a complete profile, then apply the saved config on first discovery."""
    global profile_report_pending
    if len(data) != 6 or profile_report_pending is None:
        return False
    completed = profile_report_pending
    profile_report_pending = None
    with state_lock:
        hardware = state["controllerHardware"]
        first_hardware_report = (
            (hardware.get("protocolVersion") or 0)
            < HARDWARE_PROTOCOL_VERSION
        )
        hardware.update({
            "connected": True,
            "protocolVersion": HARDWARE_PROTOCOL_VERSION,
            "boardId": completed["boardId"],
            "boardName": completed["boardName"],
            "drivers": completed["drivers"],
            "moduleScanSupported": completed["moduleScanSupported"],
            "limits": completed["limits"],
            "inputs": completed["inputs"],
        })
        controller = _deepcopy(state.get("controllerConfig"))
        state["revision"] += 1
    print(
        f"Controller profile <- {completed['boardName']}: "
        f"{len(completed['inputs'])} inputs, {len(completed['drivers'])} drivers.",
        flush=True,
    )
    if first_hardware_report and controller is not None:
        push_controller_hardware_config(controller, force=True)
    return True


def _handle_config_result(data):
    """Publish the firmware's atomic apply acknowledgement or validation error."""
    if len(data) != 9:
        return False
    token, status_code, detail = data[6:9]
    messages = {
        0: "Controller hardware applied and stored as last-known-good.",
        1: "The hardware transaction was incomplete.",
        2: "A configured source is not compatible with this board or driver.",
        3: "Two controller functions attempt to own the same GPIO or channel.",
        4: "A module definition or bus address is invalid.",
        5: "The controller could not store the validated configuration.",
    }
    with state_lock:
        apply_state = state["controllerHardware"]["apply"]
        if apply_state.get("token") != token:
            return True
        applied = status_code == 0
        message = messages.get(
            status_code,
            f"Controller rejected the hardware configuration (error {status_code}, detail {detail}).",
        )
        state["controllerHardware"]["apply"] = {
            "status": "applied" if applied else "error",
            "token": token,
            "message": message,
        }
        state["revision"] += 1
    print(f"Controller hardware <- {message}", flush=True)
    if applied:
        request_controller_profile()
    return True


def _handle_module_scan_result(data):
    """Accumulate identifiable I2C devices and publish the terminal result."""
    if len(data) != 10:
        return False
    token, status_code, address, family_code = data[6:10]
    terminal_message = None
    with state_lock:
        scan = state["controllerModuleScan"]
        if scan.get("token") != token:
            return True
        if status_code == 0:
            family = (
                "mcp23017" if family_code == 1
                else "ads1x15" if family_code == 2
                else None
            )
            if family is not None and not any(
                item.get("address") == address
                for item in scan["devices"]
            ):
                scan["devices"].append({
                    "address": address,
                    "family": family,
                })
                scan["message"] = f"Found {len(scan['devices'])} I2C device(s)…"
        elif status_code == 1:
            count = len(scan["devices"])
            scan["status"] = "complete"
            scan["message"] = (
                f"Found {count} identifiable I2C expansion device(s)."
                if count else
                "No supported I2C expansion devices answered on these pins."
            )
            terminal_message = scan["message"]
        else:
            scan["status"] = "error"
            scan["message"] = "The controller rejected the I2C discovery pins."
            terminal_message = scan["message"]
        state["revision"] += 1
    if terminal_message:
        print(f"Controller I2C scan <- {terminal_message}", flush=True)
    return True


def handle_controller_sysex(raw_data):
    """Route private controller SysEx while ignoring unrelated MIDI devices."""
    data = list(raw_data)
    if len(data) < 6 or tuple(data[:4]) != MFX_SYSEX_PREFIX:
        return False
    if data[4] == HARDWARE_PROTOCOL_VERSION:
        command = data[5]
        if command == CMD_PROFILE_REPORT:
            return _handle_profile_report(data)
        if command == CMD_PROFILE_INPUT:
            return _handle_profile_input(data)
        if command == CMD_PROFILE_END:
            return _handle_profile_end(data)
        if command == CMD_CONFIG_RESULT:
            return _handle_config_result(data)
        if command == CMD_MODULE_SCAN_RESULT:
            return _handle_module_scan_result(data)
        return False
    if data[4] != CONTROLLER_PROTOCOL_VERSION:
        return False
    command = data[5]
    if command == CMD_CAPABILITY_REPORT:
        return _handle_capability_report(data)
    if command == CMD_LEARN_RESULT:
        return _handle_learn_result(data)
    return False


def _multifx_version_key(tag):
    """Return a sortable key for a validated PI-MULTIFX release tag."""
    match = MULTIFX_RELEASE_PATTERN.fullmatch(tag or "")
    if not match:
        return None
    suffix = match.group(4) or ""
    return (
        int(match.group(1)),
        int(match.group(2)),
        int(match.group(3) or 0),
        1 if not suffix else 0,
        suffix.lower(),
    )


def _read_text_file(path):
    try:
        with open(path, "r", encoding="utf-8") as source:
            return source.read().strip()
    except OSError:
        return ""


def _write_multifx_update_job(job):
    directory = os.path.dirname(MULTIFX_UPDATE_JOB_FILE)
    os.makedirs(directory, mode=0o755, exist_ok=True)
    temporary = MULTIFX_UPDATE_JOB_FILE + ".tmp"
    with open(temporary, "w", encoding="utf-8") as output:
        json.dump(job, output, separators=(",", ":"))
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, MULTIFX_UPDATE_JOB_FILE)


def _read_multifx_update_job():
    try:
        with open(MULTIFX_UPDATE_JOB_FILE, "r", encoding="utf-8") as source:
            job = json.load(source)
        if (
            isinstance(job, dict)
            and _multifx_version_key(job.get("targetVersion")) is not None
            and job.get("unit") == MULTIFX_UPDATE_UNIT
        ):
            return job
    except (OSError, ValueError, TypeError):
        pass
    return None


def _release_has_installable_assets(release):
    assets = release.get("assets") if isinstance(release, dict) else None
    if not isinstance(assets, list):
        return False
    packages = [
        asset for asset in assets
        if isinstance(asset, dict)
        and isinstance(asset.get("name"), str)
        and asset["name"].lower().endswith(".zip")
        and "multifx" in asset["name"].lower()
        and "raspberrypi" in asset["name"].lower()
    ]
    if not packages:
        return False
    package_name = packages[0]["name"]
    return any(
        isinstance(asset, dict)
        and asset.get("name") == package_name + ".sha256"
        for asset in assets
    )


def _fetch_latest_multifx_release(force=False):
    now = time.monotonic()
    with multifx_update_lock:
        cached = multifx_release_cache.get("release")
        cached_error = str(multifx_release_cache.get("error") or "")
        checked_at = float(multifx_release_cache.get("checkedAt") or 0)
        if not force and checked_at and now - checked_at < MULTIFX_RELEASE_CACHE_SECONDS:
            return cached, cached_error

    request = Request(
        MULTIFX_RELEASE_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "PiPedal-MultiFX-runtime",
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            release = json.loads(response.read(2 * 1024 * 1024).decode("utf-8"))
        if not isinstance(release, dict):
            raise ValueError("GitHub returned invalid release metadata.")
        tag = release.get("tag_name")
        if (
            release.get("draft")
            or release.get("prerelease")
            or _multifx_version_key(tag) is None
            or not _release_has_installable_assets(release)
        ):
            raise ValueError(
                "The latest release does not contain a verified Raspberry Pi package."
            )
        result = {
            "tag": tag,
            "name": release.get("name") or tag,
            "publishedAt": release.get("published_at") or "",
            "url": release.get("html_url") or "",
        }
        error = ""
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        result = None
        error = f"Could not check GitHub releases: {exc}"

    with multifx_update_lock:
        multifx_release_cache["checkedAt"] = now
        multifx_release_cache["release"] = result
        multifx_release_cache["error"] = error
    return result, error


def _multifx_update_unit_state():
    try:
        result = subprocess.run(
            ["systemctl", "is-active", MULTIFX_UPDATE_UNIT],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=3,
            check=False,
        )
        return result.stdout.strip().lower()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def get_multifx_update_status(force_check=False):
    installed = _read_text_file(MULTIFX_INSTALLED_RELEASE_FILE)
    release, release_error = _fetch_latest_multifx_release(force_check)
    latest = release["tag"] if release else ""
    installed_key = _multifx_version_key(installed)
    latest_key = _multifx_version_key(latest)
    update_available = bool(
        installed_key is not None
        and latest_key is not None
        and latest_key > installed_key
    )
    job = _read_multifx_update_job()
    job_state = "idle"
    message = ""

    if job:
        target = job["targetVersion"]
        if installed == target:
            job_state = "complete"
            message = f"PI-MULTIFX {target} was installed successfully."
        else:
            unit_state = _multifx_update_unit_state()
            started_at = job.get("startedAt")
            recently_started = (
                isinstance(started_at, int)
                and time.time() - started_at < 15
            )
            if (
                unit_state in {"active", "activating", "reloading"}
                or recently_started
            ):
                job_state = "installing"
                message = f"Installing PI-MULTIFX {target}..."
            else:
                job_state = "failed"
                message = (
                    f"PI-MULTIFX {target} was not installed. "
                    "Check the pipedal-multifx-ui-update journal for details."
                )

    if not installed:
        message = message or (
            "The installed PI-MULTIFX release is not recorded. "
            "Use the setup utility once to repair the installation."
        )

    return {
        "installedVersion": installed,
        "latestVersion": latest,
        "latestName": release["name"] if release else "",
        "releaseUrl": release["url"] if release else "",
        "updateAvailable": update_available,
        "jobState": job_state,
        "message": message,
        "error": release_error,
    }


def start_multifx_update():
    with multifx_update_lock:
        current = get_multifx_update_status(force_check=True)
        if current["jobState"] == "installing":
            return current
        if not current["updateAvailable"]:
            raise ValueError("No newer stable PI-MULTIFX release is available.")
        if not os.path.isfile(MULTIFX_SETUP_COMMAND):
            raise RuntimeError(
                "The PI-MULTIFX setup utility is missing. Run mfxinstaller.sh once to repair it."
            )

        target = current["latestVersion"]
        try:
            subprocess.run(
                ["systemctl", "reset-failed", MULTIFX_UPDATE_UNIT],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
                check=False,
            )
            _write_multifx_update_job({
                "targetVersion": target,
                "unit": MULTIFX_UPDATE_UNIT,
                "startedAt": int(time.time()),
            })
            result = subprocess.run(
                [
                    "systemd-run",
                    "--unit", MULTIFX_UPDATE_UNIT,
                    "--collect",
                    "--no-block",
                    "--property=Type=exec",
                    MULTIFX_SETUP_COMMAND,
                    "multifx",
                    "--tag", target,
                    "--yes",
                    "--no-browser-refresh",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise RuntimeError(f"Could not start the PI-MULTIFX updater: {exc}") from exc
        if result.returncode != 0:
            raise RuntimeError(
                "Could not start the PI-MULTIFX updater: "
                + (result.stderr.strip() or result.stdout.strip() or "systemd-run failed")
            )

        current["jobState"] = "installing"
        current["message"] = f"Installing PI-MULTIFX {target}..."
        return current


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
    server_version = "PiPedalMultiFXRuntime/5.0"

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
        parsed = urlparse(self.path)
        if parsed.path not in {RUNTIME_STATE_PATH, MULTIFX_UPDATE_PATH}:
            self._json(404, {"error": "not found"})
            return
        if _origin_allowed(self) == "":
            self._json(403, {"error": "origin not allowed"})
            return
        if parsed.path == RUNTIME_STATE_PATH:
            self._json(200, get_state())
            return
        try:
            force_check = parse_qs(parsed.query).get("refresh") == ["1"]
            self._json(200, get_multifx_update_status(force_check))
        except Exception as error:
            print(f"PI-MULTIFX update check error: {error}", file=sys.stderr, flush=True)
            self._json(500, {"error": "PI-MULTIFX update check failed"})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in {RUNTIME_STATE_PATH, MULTIFX_UPDATE_PATH}:
            self._json(404, {"error": "not found"})
            return
        allowed_origin = _origin_allowed(self)
        if allowed_origin == "":
            self._json(403, {"error": "origin not allowed"})
            return
        if parsed.path == MULTIFX_UPDATE_PATH and not allowed_origin:
            self._json(403, {"error": "browser origin required"})
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
            if parsed.path == MULTIFX_UPDATE_PATH:
                if payload != {"action": "installLatest"}:
                    raise ValueError("invalid update action")
                result = start_multifx_update()
            else:
                result = update_state(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError) as error:
            self._json(400, {"error": str(error)})
            return
        except Exception as error:
            print(f"Runtime request error: {error}", file=sys.stderr, flush=True)
            self._json(500, {"error": str(error)})
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


def release_pressed_physical_switches():
    with physical_switch_lock:
        pressed = sorted(pressed_physical_switches)
        pressed_physical_switches.clear()
    if pressed:
        send_key([
            f"{PHYSICAL_SWITCH_KEY_CODES[switch]}:0"
            for switch in pressed
        ])


def controller_learn_waiting():
    with state_lock:
        return state["controllerLearn"].get("status") == "waiting"


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


def controller_encoder_role(control):
    """Map a configured encoder CC to the bridge's navigation role."""
    with state_lock:
        controller = state.get("controllerConfig") or {}
        hardware = controller.get("hardware") or {}
        encoders = hardware.get("encoders") or []
        for encoder in encoders:
            if encoder.get("turnCc") == control:
                return "turn"
            if encoder.get("buttonCc") == control:
                return "button"
    # Preserve v0.2 behavior while no controller configuration is available.
    if control == ENCODER_CC:
        return "turn"
    if control == PUSH_CC:
        return "button"
    return None


def handle_control_change(control, value):
    """Translate configured navigation controls and logical switches to keys."""
    encoder_role = controller_encoder_role(control)
    if encoder_role == "turn":
        handle_encoder_value(value)
        return
    if encoder_role == "button":
        send_key([f"28:{1 if value >= 64 else 0}"])
        return
    if FIRST_SWITCH_CC <= control <= LAST_SWITCH_CC:
        switch = control - FIRST_SWITCH_CC + 1
        if controller_learn_waiting():
            return
        pressed = value >= 64
        with physical_switch_lock:
            if pressed:
                pressed_physical_switches.add(switch)
            else:
                pressed_physical_switches.discard(switch)
        send_key([f"{PHYSICAL_SWITCH_KEY_CODES[switch]}:{1 if pressed else 0}"])


def main():
    global midi_output_port, last_pushed_pin_signature, last_pushed_hardware_signature
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
                    last_pushed_hardware_signature = None
                set_controller_connected(True)
                current = get_state()
                if current.get("controllerConfig") is not None:
                    push_controller_pin_config(current["controllerConfig"], force=True)
                request_controller_capabilities()
                request_controller_profile()
                print("MultiFX hardware bridge running.", flush=True)
                for message in input_port:
                    if message.type == "control_change":
                        handle_control_change(message.control, message.value)
                    elif message.type == "sysex":
                        handle_controller_sysex(message.data)
                raise RuntimeError("MIDI input disconnected.")
        except KeyboardInterrupt:
            release_pressed_physical_switches()
            set_controller_connected(False)
            return
        except Exception as error:
            with midi_output_lock:
                midi_output_port = None
            release_pressed_physical_switches()
            set_controller_connected(False)
            print(f"Bridge error: {error}", file=sys.stderr, flush=True)
            print("Retrying in 2 seconds...", file=sys.stderr, flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main()
