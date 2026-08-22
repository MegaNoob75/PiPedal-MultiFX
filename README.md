# PiPedal MultiFX

**A performance-focused touchscreen and foot-controller interface for PiPedal.**

> **AI development notice**
>
> PiPedal MultiFX is coded entirely through collaboration with **ChatGPT by OpenAI**. The project owner defines, tests, and directs the features and behavior, while ChatGPT is used to design, write, review, document, and troubleshoot the project code.
>
> This notice is included so users and contributors clearly understand how the project is developed.

PiPedal MultiFX is an unofficial alternative interface for [PiPedal](https://github.com/rerdavies/pipedal), designed for Raspberry Pi pedalboards where fast preset access, touchscreen use, physical footswitch control, and live-performance visibility matter most.

> **PiPedal MultiFX does not replace the PiPedal audio engine.**  
> MultiFX is a presentation and controller layer built around PiPedal. PiPedal remains responsible for audio processing, plugins, presets, snapshots, and the underlying pedalboard model.

[![Latest Release](https://img.shields.io/github/v/release/MegaNoob75/PiPedal-MultiFX?display_name=tag&label=release)](https://github.com/MegaNoob75/PiPedal-MultiFX/releases/latest)
[![License](https://img.shields.io/badge/license-see%20LICENSE.md-808080)](LICENSE.md)

## Performance View

![PiPedal MultiFX Performance View](docs/images/performance-view.png)

Performance View is the main live screen. It keeps the current bank, active preset, virtual preset page, hardware assignments, long-press functions, and state LEDs visible at a glance.

Preset tiles can span multiple virtual pages inside one real PiPedal bank, so a small physical controller can access more presets without changing the underlying PiPedal bank structure.

## Features

### Live Performance

- Touchscreen-first **Performance View**
- Real PiPedal banks and presets with MultiFX virtual preset pages
- Drag-and-drop preset tile placement
- Empty preset tiles for creating or assigning presets
- Current bank and active preset dropdowns
- Active preset LED state:
  - **Green** — clean base preset
  - **Flashing yellow** — unsaved base-preset change
  - **Blue** — native PiPedal snapshot active
  - **Red** — temporary chain bypass
- Quick access to the original PiPedal interface
- Responsive interface designed around **1024×600 and larger displays**

### Snapshots

- Native PiPedal snapshot support
- Six snapshot slots per preset
- Dedicated **Snapshot Mode** for live recall
- Snapshot Mode keeps snapshot selection separate from base-preset editing
- Dedicated **Snapshot Editor** with the preset chain locked
- Create, edit, recall, rename, recolor, and delete snapshots
- Snapshot changes are persisted without promoting snapshot sound into the base preset
- Returning to Performance can leave the recalled snapshot active
- In Snapshot Mode, normal Bank Up / Bank Down short presses act as a return to Performance instead of changing banks

### Controller

- Up to **32 physical footswitch inputs**
- MIDI CC switch protocol
- Drag-and-drop visual controller layout
- Configurable rows and columns
- Assign hardware inputs independently from on-screen position
- Short-press and long-press actions
- Configurable long-press time
- Preset Slot, Bank Up, Bank Down, Snapshot Mode, Chain Bypass, and Unused actions
- Controller configuration preserved during normal MultiFX updates

### Editing and Management

- Bank / Preset Manager
- Create, rename, delete, load, and reorder banks and presets
- MultiFX Preset Editor
- Effect editor using PiPedal plugin controls
- Preset chain editing
- Snapshot access directly from the Preset Editor
- Original PiPedal system/settings screens remain accessible

### Appearance and Device Settings

- Built-in Theme Manager
- Large built-in theme library
- Custom theme editing
- Theme import/export
- Per-device Performance layout
- Match the physical pedal layout or use a larger virtual preset grid
- MultiFX settings backup and restore
- Reset MultiFX-only settings without altering PiPedal presets or audio configuration
- Musical/controller state can remain shared while presentation/navigation settings stay local to each browser/device

## Screenshots

### Snapshot Mode

![PiPedal MultiFX Snapshot Mode](docs/images/snapshot-mode.png)

Snapshot Mode replaces the preset tiles with six native PiPedal snapshot slots while keeping the current bank and preset visible.

### Snapshot Editor

![PiPedal MultiFX Snapshot Editor](docs/images/snapshot-editor.png)

Snapshot Editor edits snapshot sound only. The preset chain is locked so a snapshot cannot accidentally become a different pedalboard structure or replace the base preset.

### Bank / Preset Manager

![PiPedal MultiFX Bank and Preset Manager](docs/images/bank-preset-manager.png)

Manage real PiPedal banks and presets from the MultiFX shell.

### Preset Editor

![PiPedal MultiFX Preset Editor](docs/images/preset-editor.png)

Build and arrange the pedalboard while retaining a touchscreen-friendly MultiFX shell.

### Effect Editor

![PiPedal MultiFX Effect Editor](docs/images/effect-editor.png)

Edit PiPedal plugin controls directly from the MultiFX interface.

### Settings

![PiPedal MultiFX Settings](docs/images/settings-hub.png)

Settings are split into Controller, Theme, MultiFX-UI, and PiPedal / System areas.

### Controller Settings

![PiPedal MultiFX Controller Settings](docs/images/controller-settings.png)

Arrange the on-screen controller to match the physical enclosure and configure hardware, short-press, and long-press actions.

### Theme Manager

![PiPedal MultiFX Theme Manager](docs/images/theme-manager.png)

Preview built-in themes, customize colors, save custom themes, and import/export theme data.

### MultiFX-UI Settings

![PiPedal MultiFX UI Settings](docs/images/multifx-ui-settings.png)

Back up MultiFX settings, choose a per-device Performance layout, review shared/local state behavior, or reset only MultiFX configuration.

## Documentation

- [Installation and Updates](docs/INSTALLATION.md)
- [Snapshots and Snapshot Mode](docs/SNAPSHOTS.md)
- [Controller Setup](docs/CONTROLLER_SETUP.md)
- [Configuring the Controller Layout](docs/LAYOUT_CONFIGURATION.md)
- [MultiFX-UI Settings and Backup / Restore](docs/MULTIFX_UI.md)
- [Themes](docs/THEMES.md)

## Recommended Hardware

PiPedal MultiFX is primarily aimed at Raspberry Pi-based floor units.

Recommended setup:

- Raspberry Pi 5
- Raspberry Pi OS
- PiPedal
- 7-inch or larger touchscreen
- 1024×600 or higher display resolution
- USB audio interface or compatible Raspberry Pi audio hardware
- Optional USB MIDI foot controller

A physical controller is not required; MultiFX can be used entirely from the touchscreen.

The original PiPedal project supports additional platforms and hardware. See the [official PiPedal project](https://github.com/rerdavies/pipedal) for PiPedal's full system requirements and audio-engine documentation.

## Installation

For the easiest setup, download the latest Raspberry Pi package from:

**[PiPedal MultiFX Releases](https://github.com/MegaNoob75/PiPedal-MultiFX/releases/latest)**

Then follow the [Installation Guide](docs/INSTALLATION.md).

The MultiFX installer adds the alternate frontend and controller services to an existing PiPedal installation. It preserves supported MultiFX configuration during updates and maintains a backup of the frontend that was present before MultiFX was first installed so the uninstaller can restore it.

## Basic Use

After installation:

1. Open PiPedal MultiFX in the kiosk or browser.
2. Use **Performance View** for normal live operation.
3. Tap or trigger a preset tile to load a preset.
4. Hold the configured Snapshot Mode switch, or enter Snapshot Mode through the configured action, to access the six native snapshot slots.
5. Use **MFX → Settings** for controller, theme, per-device UI, and PiPedal/system configuration.
6. Use **MFX → Banks / Presets** to manage banks and presets.
7. Use the preset editor when you need to change the base pedalboard.
8. Switch to the original PiPedal interface whenever you need native PiPedal screens that MultiFX does not replace.

See the linked documentation above for detailed setup and behavior.

## About PiPedal

PiPedal MultiFX is built on top of the excellent open-source [PiPedal](https://github.com/rerdavies/pipedal) project by Robin Davies.

PiPedal provides the low-latency audio engine, LV2 hosting, preset system, native snapshots, NAM support, device configuration, and the application model used by MultiFX.

MultiFX intentionally uses PiPedal's native model and operations wherever possible instead of duplicating PiPedal functionality.

This project is **not an official PiPedal project**.

## Development

Development takes place on the `dev` branch. Stable tested versions are merged to `main`.

Tagged checkpoints use names such as:

```text
multifx-v1.007
```

Release downloads are available from the GitHub [Releases](https://github.com/MegaNoob75/PiPedal-MultiFX/releases) page.

## License

See [LICENSE.md](LICENSE.md) for the licenses that apply to this repository and the upstream PiPedal code on which it is based.
