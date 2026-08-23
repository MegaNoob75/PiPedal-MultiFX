# MultiFX UI Settings and Backup / Restore

MultiFX separates shared musical/controller state from local browser navigation.

## Shared

- Bank and preset selection
- Effect values
- Snapshot selection and Snapshot Mode
- Chain Bypass
- Controller configuration/layout
- Per-bank Performance switch assignments

## Local

- Performance View vs Original PiPedal View
- MultiFX menus/screens/dialogs
- Theme
- Local focus/highlight state

## Persistence

The bridge stores only durable MultiFX configuration in:

```text
/var/lib/pipedal-multifx/state.json
```

Durable state is the current controller configuration and per-bank switch-to-preset assignments. Snapshot Mode and Chain Bypass are temporary runtime state and reset when the bridge restarts.

Browser localStorage is only a display cache. It never silently repopulates bridge authority.

## Backup / Restore

Backup creates one current-format JSON file. Restore accepts only the current backup format; obsolete backup/config formats are intentionally not migrated while MultiFX is being stabilized.

Reset restores current factory controller configuration and clears MultiFX Performance assignments/themes. Native PiPedal presets, banks and audio configuration are not deleted.
