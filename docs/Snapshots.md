# Snapshots and Snapshot Mode

[← Back to main README](../README.md)

PiPedal MultiFX uses **PiPedal's native snapshot system**. MultiFX provides a performance-focused view and editor around that system rather than maintaining a second snapshot model.

![Snapshot Mode](images/snapshot-mode.png)

## Snapshot Mode

Snapshot Mode replaces the normal preset tiles with the six snapshot slots belonging to the currently loaded PiPedal preset.

A snapshot can be recalled from the touchscreen or from a configured preset footswitch while Snapshot Mode is open.

The top title changes to:

```text
SNAPSHOTS
```

so it is clear that the controller is currently operating the six snapshot slots.

## Returning to Performance

The touchscreen Back button returns to Performance View.

While Snapshot Mode is open, a normal short press of **Bank Up** or **Bank Down** also returns to Performance instead of changing the bank.

Returning to Performance does **not** automatically cancel the recalled snapshot. The snapshot can remain active and continue sounding.

## Active Preset LED

Performance View uses the active preset LED to distinguish important states:

```text
Green            clean base preset
Flashing yellow  unsaved base-preset change
Blue             native PiPedal snapshot selected
Red              temporary chain bypass
```

## Returning to the Base Preset

When a snapshot is active, selecting the already-active preset returns to the saved base preset.

MultiFX performs a real PiPedal preset load for this operation. Clearing snapshot selection alone is not treated as equivalent to restoring the base sound.

## Snapshot Editor

![Snapshot Editor](images/snapshot-editor.png)

The Snapshot Editor allows effect values and bypass states to be edited while the preset chain remains structurally locked.

The editor intentionally does not expose plugin-chain add/remove/reorder operations.

## Snapshot Save Safety

A snapshot must never become the base preset.

MultiFX follows this rule when persisting snapshot data:

1. capture the edited snapshot sound
2. reload the saved base preset
3. attach the captured snapshot data to that clean base
4. save the preset while base controls are live
5. recall the saved snapshot

This is necessary because PiPedal stores snapshot data inside the preset. Saving the preset is required to make newly created or edited snapshot data survive switching away and back, but the save must occur while true base controls are live.

## Snapshot Operations

Snapshot-related screens support operations such as:

- recall
- create
- edit/update
- rename
- color
- delete

Snapshot changes are persisted using PiPedal's own model operations.

## Snapshot vs Preset Editing

Use **Preset Editor** when you want to change the base sound or pedalboard structure.

Use **Snapshot Editor** when you want to store alternate effect states within the same preset topology.

A snapshot is performance state, not a replacement preset.
