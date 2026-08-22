# Installing PiPedal MultiFX

[← Back to main README](../README.md)

PiPedal MultiFX can be installed on top of an existing PiPedal installation, or the included setup menu can install/update PiPedal, configure a Chromium kiosk, and then install MultiFX.

## Before You Start

Recommended:

- Raspberry Pi 5
- Raspberry Pi OS
- Working internet connection
- PiPedal already installed if you only want to add MultiFX
- 7-inch or larger touchscreen
- 1024×600 or higher resolution

Download the latest Raspberry Pi ZIP from the [PiPedal MultiFX Releases](https://github.com/MegaNoob75/PiPedal-MultiFX/releases/latest) page and extract it on the Raspberry Pi.

## Option A — Add MultiFX to an Existing PiPedal Installation

From inside the extracted release folder:

```bash
sudo ./install-multifx.sh
```

The installer:

- verifies that PiPedal is already present
- installs the MultiFX runtime dependencies
- backs up the current PiPedal frontend the first time MultiFX is installed
- installs the prebuilt MultiFX frontend
- preserves an existing controller configuration during normal updates
- installs the MultiFX controller bridge
- installs/restarts the required systemd services
- refreshes the browser when the kiosk refresh service is available

PiPedal's audio engine and preset storage remain PiPedal-owned.

## Option B — PiPedal / Kiosk / MultiFX Setup Menu

The package also includes:

```bash
sudo ./install-pipedal-kiosk.sh
```

The menu provides:

```text
1) Install/update PiPedal + Chromium kiosk
2) Install/update PiPedal MultiFX UI
3) Uninstall PiPedal MultiFX UI
4) Install/update PiPedal + kiosk, then MultiFX
5) Exit
```

The setup script checks GitHub for the latest stable PiPedal release instead of relying on a hard-coded PiPedal version.

When MultiFX is installed from a standalone copy of the setup script, it can locate the latest PiPedal MultiFX GitHub release and download the Raspberry Pi package automatically.

## Updating MultiFX

Download and extract the newer release, then run:

```bash
sudo ./install-multifx.sh
```

Normal updates preserve MultiFX controller configuration and do not intentionally alter PiPedal presets, banks, uploaded models, IRs, audio configuration, or other PiPedal-owned musical data.

## Uninstalling MultiFX

From the release folder:

```bash
sudo ./uninstall-multifx.sh
```

After installation, a stable uninstaller is also installed at:

```bash
sudo /usr/local/sbin/uninstall-pipedal-multifx
```

The uninstaller restores the frontend that was backed up before MultiFX was first installed.

If compatible services existed before MultiFX was installed, their previous service definitions are restored as well.

PiPedal itself is **not** removed.

## Important Paths

```text
MultiFX frontend:
  /etc/pipedal/react/

Controller configuration:
  /etc/pipedal/controller-config.json

MultiFX controller bridge:
  /usr/local/lib/pipedal-multifx/pipedal_encoder_bridge.py

MultiFX backup/state:
  /var/lib/pipedal-multifx/
```

## After Installation

Open the PiPedal web interface in the configured kiosk/browser.

The normal workflow is:

```text
Performance View
→ select presets / banks
→ use Snapshot Mode for live snapshot recall
→ use Preset Editor for base-preset changes
→ use MFX → Settings for MultiFX and PiPedal configuration
```

See:

- [Snapshots and Snapshot Mode](SNAPSHOTS.md)
- [Controller Setup](CONTROLLER_SETUP.md)
- [MultiFX-UI Settings](MULTIFX_UI.md)

## Troubleshooting

Check the controller bridge:

```bash
systemctl status pipedal-encoder.service --no-pager
```

Check the input/refresh service:

```bash
systemctl status pipedal-ydotoold.service --no-pager
```

For recent controller bridge logs:

```bash
journalctl -u pipedal-encoder.service -n 50 --no-pager
```

The MultiFX controller bridge should normally run from:

```text
/usr/local/lib/pipedal-multifx/pipedal_encoder_bridge.py
```

If a MIDI controller is connected, the service log should show the available MIDI inputs and which input was selected.
