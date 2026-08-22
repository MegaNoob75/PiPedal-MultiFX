# MultiFX-UI Settings and Backup / Restore

[← Back to main README](../README.md)

MultiFX-UI Settings controls MultiFX-only interface behavior and backup/restore options.

![MultiFX-UI Settings](images/multifx-ui-settings.png)

Open:

```text
MFX
→ Settings
→ MultiFX-UI
```

## Backup / Restore

MultiFX can export and restore MultiFX-only configuration.

This is intended for controller/UI configuration and does **not** include PiPedal presets, banks, audio, MIDI, Wi-Fi, or system settings.

Use:

```text
BACKUP MULTIFX SETTINGS
RESTORE MULTIFX SETTINGS
```

to move or restore MultiFX configuration.

## Per-Device Performance Layout

The Performance layout can be local to each browser/device.

### Match Pedal

`MATCH PEDAL` makes the Performance tile arrangement follow the saved physical controller grid.

### Custom Virtual Layout

A device can use a larger virtual preset grid than the physical pedal. This is useful on a desktop browser or larger touchscreen.

Changing this setting does not rewrite the physical controller configuration.

## Shared and Local State

MultiFX intentionally separates musical/controller state from presentation/navigation state.

Typical shared state includes:

- Bank / Preset
- Effect Parameters
- Snapshot Selection
- Snapshot Mode
- Chain Bypass
- Controller Assignments

Typical local state includes:

- Current screen / menus
- Theme selection
- Per-device Performance layout
- UI scale / presentation preferences

This allows a floor unit and a desktop browser to control the same PiPedal instance without forcing both devices to use the same visual layout.

## Reset MultiFX

`RESET MULTIFX SETTINGS` clears MultiFX-only layout and presentation/controller configuration.

It is not intended to delete PiPedal presets or alter PiPedal audio/system configuration.
