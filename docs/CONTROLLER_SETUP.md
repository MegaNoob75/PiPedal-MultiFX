# Controller Setup

The current MultiFX controller protocol supports **12 logical footswitches**.

Each footswitch sends a neutral physical identity (SW1..SW12 / CC40..CC51). Controller Settings decides what that switch does. The ESP32 does not contain preset, bank or snapshot logic.

## Current ESP32-S3 hardware

- Encoder A: GPIO 21
- Encoder B: GPIO 17
- Encoder push: GPIO 18
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

## MIDI device selection

The bridge deliberately refuses to bind to an arbitrary first MIDI device. It looks for a recognized controller name. If your ALSA device name is unusual, set `MULTIFX_MIDI_DEVICE_HINT` in a systemd override for `pipedal-encoder.service`.
