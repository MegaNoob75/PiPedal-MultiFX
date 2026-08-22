# Configuring the Controller Layout

[← Back to main README](../README.md)

The Controller Settings screen is designed so the on-screen switch arrangement can resemble the physical foot-controller enclosure.

![Controller Layout](images/controller-settings.png)

## Grid Size

Use the **Columns** and **Rows** fields to define the controller grid.

For example:

```text
Columns: 4
Rows:    2
```

creates the common eight-switch 4×2 layout.

## Add a Switch

Select:

```text
+ ADD SWITCH
```

A new switch tile is added to the layout.

MultiFX supports up to 32 physical switch inputs.

## Repositioning Switches

Drag a switch tile to an empty grid cell to move it.

Drop a switch onto another switch to swap their physical positions.

This changes the visual/enclosure layout; it does not change PiPedal's bank or preset ordering.

## Editing a Switch

Select a switch tile. Its settings appear in the panel on the right.

Available settings include:

- **Label** — text displayed on the switch
- **Physical switch input** — hardware switch controlling it
- **Short press action**
- action-specific options such as Preset Slot number
- **Long press action**

The controller-wide **Long Press** value controls how long a physical switch must be held before its long-press action fires.

## Saving

After making changes, select:

```text
SAVE CONTROLLER
```

Use:

```text
RESTORE DEFAULT
```

to return to the default controller arrangement.

## Performance View Layout

![Performance View](images/performance-view.png)

The saved physical controller layout is used when the device's Performance layout is set to **Match Pedal**.

MultiFX also supports a per-browser/device custom Performance grid that can show more virtual preset tiles than the physical pedal contains. Changing that browser layout does not change the physical controller configuration.

See [MultiFX-UI Settings](MULTIFX_UI.md).
