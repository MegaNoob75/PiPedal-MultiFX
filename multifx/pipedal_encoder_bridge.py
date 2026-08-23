#!/usr/bin/env python3
"""PiPedal MultiFX hardware + shared-state bridge.

Responsibilities are deliberately narrow:
  * translate the MultiFX USB-MIDI controller into ydotool key events;
  * send complete portable hardware configurations over private MIDI SysEx;
  * discover controller hardware capabilities and coordinate transient Learn;
  * expose one small HTTP state service on port 8877.

Persistence contract
--------------------
Only user configuration is durable:
  * controllerConfig
  * presetAssignments (bank -> logical switch id -> native PiPedal preset id)

Those values are stored atomically in /var/lib/pipedal-multifx/state.json.
Snapshot Mode and Chain Bypass are transient live-performance state and always
start neutral when this service restarts. Schema 2 contains one narrow
migration from the immediately preceding v0.2.0 controller schema. Obsolete
tile/page formats are still never migrated.

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
STATE_SCHEMA_VERSION = 2
RUNTIME_VERSION = 4

MFX_SYSEX_PREFIX = (0x7D, 0x4D, 0x46, 0x58)
CONTROLLER_PROTOCOL_VERSION = 2
CMD_CAPABILITY_REQUEST = 0x02
CMD_CAPABILITY_REPORT = 0x03
CMD_LEARN_START = 0x04
CMD_LEARN_CANCEL = 0x05
CMD_LEARN_RESULT = 0x06

# Protocol v3 adds firmware catalog discovery and an atomic multi-message
# hardware transaction without changing the known-good v1/v2 envelopes.
HARDWARE_PROTOCOL_VERSION = 3
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

CAPABILITY_DIGITAL = 0x01
CAPABILITY_ANALOG = 0x02
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
    "controllerHardware": {
        "connected": False,
        "protocolVersion": None,
        "boardId": None,
        "boardName": None,
        "drivers": [],
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
}

midi_output_lock = threading.Lock()
midi_output_port = None
last_pushed_pin_signature = None
last_pushed_hardware_signature = None
next_controller_learn_token = 0
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


def _migrate_controller_config(value):
    """Migrate only the immediately preceding schema-1 GPIO representation."""
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        return value
    switches = value.get("switches")
    if not isinstance(switches, list):
        return value
    migrated = _deepcopy(value)
    migrated["schemaVersion"] = 2
    migrated["hardware"] = _deepcopy(DEFAULT_CONTROLLER_HARDWARE)
    for item in migrated["switches"]:
        if not isinstance(item, dict):
            continue
        pin = item.pop("gpioPin", None)
        item["input"] = None if pin is None else {"type": "gpio", "pin": pin}
    return migrated


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
        if not isinstance(cc, int) or isinstance(cc, bool) or not 0 <= cc <= 119 or cc in midi_ccs:
            raise ValueError(f"{label} MIDI CC is invalid or duplicated")
        if not isinstance(minimum, int) or not isinstance(maximum, int) or not 0 <= minimum < maximum <= 4095:
            raise ValueError(f"{label} calibration is invalid")
        if not isinstance(filter_shift, int) or isinstance(filter_shift, bool) or not 0 <= filter_shift <= 7:
            raise ValueError(f"{label} filter is invalid")
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
    """Validate current config, accepting only the explicit v0.2 migration."""
    if value is None:
        return None
    value = _migrate_controller_config(value)
    if not isinstance(value, dict) or value.get("schemaVersion") != STATE_SCHEMA_VERSION:
        raise ValueError("controllerConfig must use schemaVersion 2")
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
    """Restore state and rewrite the one supported previous schema atomically."""
    if not os.path.exists(PERSISTENT_STATE_FILE):
        with state_lock:
            state["controllerConfig"] = _load_factory_controller_config()
            if state["controllerConfig"] is not None:
                _save_persistent_locked()
        return
    try:
        with open(PERSISTENT_STATE_FILE, "r", encoding="utf-8") as file:
            saved = json.load(file)
        if not isinstance(saved, dict) or saved.get("schemaVersion") not in {1, STATE_SCHEMA_VERSION}:
            raise ValueError("unsupported MultiFX state schema")
        migrated_state = saved.get("schemaVersion") == 1
        controller = _validate_controller_config(saved.get("controllerConfig"))
        assignments = _normalize_assignments(saved.get("presetAssignments", {"version": 1, "banks": {}}))
        with state_lock:
            state["controllerConfig"] = controller
            state["presetAssignments"] = assignments
            if migrated_state:
                _save_persistent_locked()
        print(f"Restored MultiFX state from {PERSISTENT_STATE_FILE}.", flush=True)
    except Exception as error:
        # Preserve unknown formats for inspection. Only schema 1 immediately
        # preceding this release has a defined migration above.
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
    global next_controller_learn_token
    if not isinstance(patch, dict):
        raise ValueError("JSON object required")

    persistent_changed = False
    controller_changed = False
    controller_command = None
    controller_command_kind = None
    release_switches_for_learn = False

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

        if "controllerLearnStart" in patch:
            op = patch["controllerLearnStart"]
            if not isinstance(op, dict) or op.get("capability") != "digital":
                raise ValueError("Phase 1 Learn requires capability 'digital'")
            hardware_switch = op.get("hardwareSwitch")
            if not isinstance(hardware_switch, int) or isinstance(hardware_switch, bool) or not 1 <= hardware_switch <= MAX_FOOTSWITCHES:
                raise ValueError("controllerLearnStart.hardwareSwitch is invalid")
            hardware = state["controllerHardware"]
            if not hardware["connected"]:
                raise ValueError("controller is not connected")
            if hardware["protocolVersion"] != CONTROLLER_PROTOCOL_VERSION:
                raise ValueError("connected controller does not support Learn")
            candidates = [
                item for item in hardware["inputs"]
                if "digital" in item.get("capabilities", [])
                and not item.get("reserved", False)
            ]
            if not candidates:
                raise ValueError("controller reported no learnable digital inputs")

            next_controller_learn_token = (next_controller_learn_token % 126) + 1
            token = next_controller_learn_token
            state["controllerLearn"] = {
                "status": "waiting",
                "token": token,
                "capability": "digital",
                "input": None,
                "message": "Waiting for switch press…",
            }
            controller_command = list(MFX_SYSEX_PREFIX) + [
                CONTROLLER_PROTOCOL_VERSION,
                CMD_LEARN_START,
                token,
                CAPABILITY_DIGITAL,
                hardware_switch,
            ]
            controller_command_kind = "start"
            release_switches_for_learn = True

        if "controllerLearnCancel" in patch:
            op = patch["controllerLearnCancel"]
            token = op.get("token") if isinstance(op, dict) else None
            if not isinstance(token, int) or isinstance(token, bool) or not 1 <= token <= 126:
                raise ValueError("controllerLearnCancel.token is invalid")
            current_learn = state["controllerLearn"]
            if current_learn.get("token") == token:
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
                        "capability": "digital",
                        "input": None,
                        "message": "Could not send Cancel. The controller will leave Learn when its timeout expires.",
                    }
                    state["revision"] += 1
            return get_state()
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
    """Serialize one validated controller config into a v3 transaction."""
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
    if len(data) != 8 + SOURCE_DESCRIPTOR_SIZE:
        return False
    token = data[6]
    result_code = data[7]
    descriptor = controller_input_descriptor(data[8:])
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
        message = "Learn timed out. No switch press was detected."
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
            "message": message,
        }
        state["revision"] += 1
    print(f"Controller Learn <- {message}", flush=True)
    return True


def _handle_profile_report(data):
    """Begin a chunked v3 board-profile report from the controller."""
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
        "limits": {
            "modules": data[settings_start],
            "analogControls": data[settings_start + 1],
            "encoders": data[settings_start + 2],
        },
        "inputs": [],
    }
    return True


def _handle_profile_input(data):
    """Append one source descriptor to the in-progress v3 profile report."""
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
        first_v3_report = (hardware.get("protocolVersion") or 0) < HARDWARE_PROTOCOL_VERSION
        hardware.update({
            "connected": True,
            "protocolVersion": HARDWARE_PROTOCOL_VERSION,
            "boardId": completed["boardId"],
            "boardName": completed["boardName"],
            "drivers": completed["drivers"],
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
    if first_v3_report and controller is not None:
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
        return False
    if data[4] != CONTROLLER_PROTOCOL_VERSION:
        return False
    command = data[5]
    if command == CMD_CAPABILITY_REPORT:
        return _handle_capability_report(data)
    if command == CMD_LEARN_RESULT:
        return _handle_learn_result(data)
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
    server_version = "PiPedalMultiFXRuntime/4.0"

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
