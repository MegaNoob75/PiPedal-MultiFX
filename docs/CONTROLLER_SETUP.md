# Controller Setup

The current MultiFX controller protocol supports **12 logical footswitches**.

Each footswitch sends a neutral physical identity (SW1..SW12 / CC40..CC51). Controller Settings decides what that switch does. The ESP32 does not contain preset, bank or snapshot logic.

## Reference ESP32-S3 hardware template

- Encoder A: GPIO 18
- Encoder B: GPIO 17
- Encoder push: GPIO 21
- Pots: GPIO 8, 12, 13, 11
- Footswitches: GPIO 6, 7, 15, 16, 1, 2, 4, 5

This is the factory template, not a fixed firmware pinout. Open **Settings →
Controller → Hardware Setup** to select compatible pins, add input modules, configure
pots/sliders/expression inputs, or move the encoder connections. The firmware
validates and stores the complete configuration atomically.

The canonical firmware is:

```text
multifx/esp32s3/PiPedal_MultiFX_Controller/PiPedal_MultiFX_Controller.ino
```

The canonical protocol description is:

```text
multifx/MULTIFX_CONTROLLER_PROTOCOL.txt
```

A physical controller is optional. Logical switches with `input: null` remain usable with touch/mouse.

## Capability discovery and control Learn

The controller firmware reports its board name, pin capabilities, cautions,
hard reservations, driver catalog, and configured module channels to the
MultiFX bridge. Controller Settings consumes that report instead of treating an
ESP32 pin list as universal hardware knowledge.

Learn is available for switches, analog controls, encoder rotation and encoder
buttons in Hardware Setup. Start Learn for the logical control, then press or
move the physical input you want to assign. The learned direct or module input
is placed only in the unsaved draft; press **Save** to persist and activate it.

Learn can be cancelled and times out after 30 seconds. Switch action events are suppressed while Learn is active. An input already assigned to another logical switch is reported as a conflict and is not stolen.

Protocol v3 adds runtime-selected 74HC4051, CD74HC4067, MCP23017, ADS1015,
and ADS1115 drivers. A hardware Save is sent as a multi-record transaction; the
firmware applies and stores it only after every module, source, calibration, and
pin-ownership rule passes. A bad configuration therefore leaves the running
last-known-good setup intact.

Hardware Setup can also scan a user-selected I2C SDA/SCL pair. MCP23017 devices
are identified directly; ADS1015/ADS1115 addresses are reported as ADS1x15 and
the user confirms the exact converter before adding it. Passive 74HC4051 and
CD74HC4067 multiplexers have no address or identity register, so they remain
manual additions. A scan briefly selects the requested bus and then restores
the active saved controller configuration.

Controller configuration schema 3 uses board-neutral sources such as
`{ "type": "gpio", "pin": 11 }` or
`{ "type": "module", "moduleId": "mux1", "channel": 6 }`. It also stores
freeform Performance geometry for physical controls separately from switch
actions and wiring. This unreleased schema is an intentional clean break: old
controller configurations are rejected and replaced by the current factory
configuration instead of being partially migrated.

## MIDI device selection

The bridge deliberately refuses to bind to an arbitrary first MIDI device. It looks for a recognized controller name. If your ALSA device name is unusual, set `MULTIFX_MIDI_DEVICE_HINT` in a systemd override for `pipedal-encoder.service`.
