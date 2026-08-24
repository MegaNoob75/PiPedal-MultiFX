# MultiFX controller hardware architecture

## Purpose

MultiFX controller firmware must describe and operate the hardware that is
actually connected. The Pi and browser must not contain a second, competing
pinout for a particular microcontroller. This design keeps the current
ESP32-S3 pedal working while allowing the same firmware source tree to support
other board profiles and common input-expansion modules.

The ownership chain is:

```
board profile + compiled drivers
        -> firmware capability report
        -> Python bridge runtime state
        -> Controller / Controller Hardware settings
```

PiPedal remains authoritative for audio, banks, presets, snapshots, and pedal
boards. The controller reports physical events only; it never assigns musical
meaning to a footswitch.

## Configuration split

Controller configuration schema 3 contains three related sections:

- `switches` describe logical footswitch actions and their optional physical
  input sources.
- `hardware` describes the board template, expansion modules, analog controls,
  and encoders.
- `performanceLayout` and `layoutDefaults` describe the on-screen arrangement
  of logical switches, status elements and physical pots, sliders, expression
  pedals, encoders and encoder buttons. Performance widgets use stable control
  IDs, so changing a GPIO does not move the on-screen control.

Each logical switch contains an optional board-neutral input source instead of
an ESP32-only GPIO number. Schema 3 is a clean unreleased-format break; old
controller records are reset instead of migrated.

An input source is either a direct board pin or a channel on a configured
module:

```json
{ "type": "gpio", "pin": 11 }
{ "type": "module", "moduleId": "mux1", "channel": 6 }
```

Module IDs are user-config stable. The bridge assigns compact one-byte module
indexes only while sending a configuration to the firmware.

## First supported drivers

The first driver catalog intentionally covers the two primary expansion needs
without requiring a firmware edit:

| Driver | Channels | Uses | Typical purpose |
| --- | ---: | --- | --- |
| 74HC4051 | 8 | signal + 3 select GPIOs | pots, sliders, or switches |
| CD74HC4067 | 16 | signal + 4 select GPIOs | pots, sliders, or switches |
| MCP23017 | 16 | I2C | switches and buttons |
| ADS1015 | 4 | I2C | external 12-bit analog inputs |
| ADS1115 | 4 | I2C | external 16-bit analog inputs |

Identifiable I2C addresses can be discovered explicitly from Hardware Setup.
The scan is deliberately limited to MCP23017 (`0x20`-`0x27`) and ADS1x15
(`0x48`-`0x4B`) ranges. ADS1015 and ADS1115 share the same basic address and
register protocol, so discovery reports the family and the UI requires the user
to choose the exact model. Passive analog multiplexers cannot be auto-detected.

Drivers are compiled into the firmware and selected at runtime. The firmware
reports its driver catalog, so the UI never offers a driver that the connected
binary cannot operate.

## Board profiles

A board profile describes capability, not a single permitted build layout.
Each profile identifies:

- pins that can be digital inputs;
- pins that can be analog inputs;
- pins that can drive module address/select signals;
- pins that are unavoidably reserved by flash, PSRAM, or the selected USB
  transport;
- caution pins (for example boot-strapping or onboard-device pins);
- the recommended factory template.

A caution is shown to the user but is not an artificial prohibition. A hard
reservation is rejected by both the bridge and firmware. GPIO ownership is
validated across switches, pots, encoders, and module wiring before anything
is applied.

The current ESP32-S3 DevKitC-1 wiring is the first recommended template:

- switches: GPIO 6, 7, 15, 16, 1, 2, 4, 5;
- pots: GPIO 8, 12, 13, 11, MIDI CC 10..13;
- encoder: A GPIO 18, B GPIO 17, push GPIO 21, MIDI CC 30/31;
- native USB MIDI reserves GPIO 19 and 20.

This template is a safe starting point, not a rule for other users.

## Atomic apply and recovery

Protocol version 3 sends a hardware configuration as a transaction:

1. `CONFIG_BEGIN` declares all record counts and a correlation token.
2. Individual module, switch, analog-control, and encoder records fill a
   temporary configuration.
3. `CONFIG_COMMIT` asks the firmware to validate the complete temporary
   configuration.
4. The firmware either applies and stores the whole configuration or rejects
   it without changing the running configuration.

The firmware stores only a validated configuration and retains a built-in
factory template. Invalid or corrupt stored data therefore falls back safely
without requiring a reflash. The version-1 direct-GPIO switch-map message and
version-2 capability/Learn messages remain supported during the transition.

## Portability boundary

“One firmware” means one shared source tree with board-specific builds. An
ESP32-S3 binary cannot execute on an RP2040 or Teensy because those devices use
different processors and USB/storage implementations. Board profiles and the
small platform storage layer are the only intended board-specific portions;
the protocol, configuration model, module drivers, scanning, filtering, and
MIDI behavior remain shared.

