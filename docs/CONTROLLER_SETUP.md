# Controller Setup

The current MultiFX controller protocol supports **12 logical footswitches**.

Each footswitch sends a neutral physical identity (SW1..SW12 / CC40..CC51). Controller Settings decides what that switch does. The ESP32 does not contain preset, bank or snapshot logic.

## Current ESP32-S3 hardware

- Encoder A: GPIO 18
- Encoder B: GPIO 17
- Encoder push: GPIO 21
- Pots: GPIO 8, 12, 13, 11
- Footswitch GPIO mapping: sent at runtime by the MultiFX bridge and stored in ESP32 Preferences

The canonical firmware is:

```text
multifx/esp32s3/PiPedal_MultiFX_Controller/PiPedal_MultiFX_Controller.ino
```

The canonical protocol description is:

```text
multifx/MULTIFX_CONTROLLER_PROTOCOL.txt
```

A physical controller is optional. Logical switches with `gpioPin: null` remain usable with touch/mouse.

## Capability discovery and switch Learn

The controller firmware reports its board name and usable input capabilities to the MultiFX bridge. Controller Settings uses that report for its GPIO choices instead of treating an ESP32 pin list as universal hardware knowledge.

For a physical switch, select the logical switch and press **Learn** beside the GPIO field. While Controller Settings shows **Waiting for switch press…**, press the desired footswitch. The learned GPIO is placed only in the unsaved draft; press **Save** to persist and activate the new map.

Learn can be cancelled and times out after 30 seconds. Switch action events are suppressed while Learn is active. An input already assigned to another logical switch is reported as a conflict and is not stolen.

The version-2 capability descriptor distinguishes direct GPIO from future multiplexer and external-ADC sources. Phase 1 implements direct digital switch Learn only; pots and encoders remain fixed as documented above.

## MIDI device selection

The bridge deliberately refuses to bind to an arbitrary first MIDI device. It looks for a recognized controller name. If your ALSA device name is unusual, set `MULTIFX_MIDI_DEVICE_HINT` in a systemd override for `pipedal-encoder.service`.
