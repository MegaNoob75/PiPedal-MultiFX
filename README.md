# PiPedal MultiFX

**A performance-focused touchscreen and foot-controller interface for PiPedal.**

> **AI development notice**
>
> PiPedal MultiFX is coded through collaboration with **ChatGPT by OpenAI**. The project owner defines, tests, and directs behavior while ChatGPT is used to design, write, review, document, and troubleshoot code.

PiPedal MultiFX is an unofficial alternative interface for [PiPedal](https://github.com/rerdavies/pipedal), aimed at Raspberry Pi pedalboards where fast preset access, touchscreen use, physical footswitch control, and live-performance visibility matter most.

> **MultiFX does not replace the PiPedal audio engine.** PiPedal remains authoritative for audio processing, plugins, presets, banks, snapshots, and the underlying pedalboard model.

## Performance View

![PiPedal MultiFX Performance View](docs/images/performance-view.png)

Performance View shows the current real PiPedal bank, active preset, configured logical switches, and optional live status widgets. There is intentionally **no second preset-page system** inside a bank.

Each preset switch has one assignment for each PiPedal bank. If you need another related group of presets, create another bank—for example `Clean` and `Clean 2`. This keeps the live hierarchy identical to PiPedal's native bank model.

## Features

### Live Performance

- Touchscreen-first Performance View
- Real PiPedal banks and presets; no virtual preset pages
- Preset assignments keyed by **bank + logical switch ID**
- Duplicate preset assignments are supported
- Empty preset switches can be assigned or used to create a preset
- Grid and Freeform controller layouts
- Configurable dashboard/status elements
- Native CPU, XRun, temperature, frequency, governor and audio status
- Temporary Chain Bypass
- Native PiPedal Snapshot Mode
- Responsive interface designed around 1024×600 and larger displays

### Controller

- Up to **12 logical physical footswitches** in the current protocol
- SW1..SW12 use neutral MIDI CC identities; musical actions are assigned in MultiFX
- Optional runtime-configurable ESP32-S3 GPIO mapping
- Short-press and long-press actions
- Preset, Bank Up, Bank Down, Snapshot Mode, Chain Bypass and Unused actions
- Controller layout/configuration shared between the floor unit and desktop browser
- One strict current configuration schema; obsolete schemas are rejected rather than migrated

### Editing and Management

- Bank / Preset Manager
- Create, rename, delete, load and reorder banks/presets
- Clone/download/upload native PiPedal banks
- Cloning a bank also clones its Performance switch assignment pattern
- MultiFX Preset Editor and effect editor
- Snapshot Manager and Snapshot Editor
- Original PiPedal screens remain available

### State model

Shared musical/controller state:

- Native bank/preset selection
- Effect/control values
- Native snapshot selection
- MultiFX Snapshot Mode
- Chain Bypass
- Controller configuration
- Per-bank Performance preset assignments

Local browser presentation/navigation:

- Performance View vs Original PiPedal View
- MultiFX internal screen/menu/dialog navigation
- Theme
- Local focus/highlight state

Only durable user configuration is persisted by the MultiFX bridge. Temporary live modes are reset to neutral when the bridge restarts.

## Snapshots

MultiFX uses PiPedal's native six snapshot slots. Snapshot editing restores the saved base preset before persistence so snapshot-modified control values cannot accidentally become the base preset sound.

## Controller firmware

The canonical ESP32-S3 sketch is:

```text
multifx/esp32s3/PiPedal_MultiFX_Controller/PiPedal_MultiFX_Controller.ino
```

The current hardware mapping retains:

- Encoder A/B: GPIO 21 / GPIO 17
- Encoder push: GPIO 18
- Pots: GPIO 8 / 12 / 13 / 11
- Footswitch GPIOs are configured at runtime from Controller Settings

Protocol details are in `multifx/MULTIFX_CONTROLLER_PROTOCOL.txt`.

## Documentation

- [Installation and Updates](docs/INSTALLATION.md)
- [Snapshots and Snapshot Mode](docs/Snapshots.md)
- [Controller Setup](docs/CONTROLLER_SETUP.md)
- [Controller Layout](docs/LAYOUT_CONFIGURATION.md)
- [MultiFX UI Settings / Backup](docs/MULTIFX_UI.md)
- [Themes](docs/THEMES.md)

## Development

Development takes place on `dev`. Tested working states are merged into `main`; release/checkpoint tags are created from known-good commits.

For frontend development:

```bash
cd vite
npm run build
```

## Configuration compatibility during development

MultiFX currently uses a strict schema intentionally. An old controller configuration or old preset-tile/page store is **not migrated**. This avoids retaining compatibility code while the current design is being stabilized.

The current assignment model is:

```text
PiPedal bank ID + logical switch ID -> PiPedal preset ID (or empty)
```

Layout geometry never changes that musical mapping.

## About PiPedal

PiPedal MultiFX is built on the open-source [PiPedal](https://github.com/rerdavies/pipedal) project by Robin Davies. MultiFX uses PiPedal's native model and operations wherever possible instead of duplicating audio/preset behavior.

This project is **not an official PiPedal project**.

## License

See [LICENSE.md](LICENSE.md).
