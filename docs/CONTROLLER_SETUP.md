# Controller Setup

[← Back to main README](../README.md)

PiPedal MultiFX supports a physical MIDI foot controller and can expose up to **32 physical switch inputs** to the user interface.

![Controller Settings](images/controller-settings.png)

## Opening Controller Settings

Open:

```text
MFX
→ Settings
→ Controller
```

The Controller Settings screen lets you build a visual switch layout that matches the physical enclosure while keeping hardware input assignments independent from screen position.

## Physical Switch Inputs

Each on-screen switch can be mapped to one physical switch input.

For the MultiFX 32-switch MIDI protocol, switches use consecutive MIDI Control Change numbers:

```text
SW1  = CC 40
SW2  = CC 41
...
SW32 = CC 71
```

A value of **64 or higher** is treated as a press. A value below 64 is treated as a release.

## Short Press and Long Press

Each hardware switch can have:

- a **Short press action**
- an optional **Long press action**

The controller-wide long-press threshold is configurable in milliseconds.

Current action types include:

- Preset Slot
- Bank Up
- Bank Down
- Snapshot Mode
- Chain Bypass
- Unused

The Performance View shows configured long-press functions using a small `HOLD:` label so alternate footswitch functions remain visible during use.

### Snapshot Mode Behavior

When Snapshot Mode is open, the preset tiles are replaced by the six native PiPedal snapshot slots.

A normal short press of a switch whose regular action is **Bank Up** or **Bank Down** returns to Performance View instead of changing banks. Any recalled snapshot remains active.

## Browser Transport

The controller bridge translates switch events so they can reach the browser interface.

The browser-key mapping is:

```text
SW1–SW9    → keys 1–9
SW10       → key 0
SW11–SW32  → F1–F22
```

The key is only a physical-switch identity. The saved controller configuration determines the action performed by that switch.

## Controller Configuration

The controller configuration is stored at:

```text
/etc/pipedal/controller-config.json
```

The MultiFX installer preserves an existing controller configuration during normal updates.

## Testing the Controller Bridge

Check the service:

```bash
systemctl status pipedal-encoder.service --no-pager
```

For recent log output:

```bash
journalctl -u pipedal-encoder.service -n 50 --no-pager
```

A healthy service should be active and should report the MIDI input it selected.

## No Controller?

A physical MIDI controller is optional. MultiFX can still be operated from the touchscreen.
