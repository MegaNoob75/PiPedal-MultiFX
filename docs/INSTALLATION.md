# Installing PiPedal MultiFX

[← Back to main README](../README.md)

PiPedal MultiFX can be installed on top of an existing PiPedal installation,
or the included setup menu can install/update PiPedal, install MultiFX, and
optionally configure the fullscreen touchscreen display.

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
sudo ./install-pipedal-kiosk.sh
```

Choose **Install or update MultiFX**. `install-multifx.sh` remains available as
a compatibility shortcut and calls the same consolidated setup utility.

The installer:

- verifies that PiPedal is already present
- installs the MultiFX runtime dependencies
- backs up the current PiPedal frontend the first time MultiFX is installed
- installs the prebuilt MultiFX frontend
- preserves an existing controller configuration during normal updates
- installs the MultiFX controller bridge
- installs/restarts the required systemd services
- refreshes the browser when the touchscreen refresh service is available

PiPedal's audio engine and preset storage remain PiPedal-owned.

## Option B — All-in-One Setup Menu

The package also includes:

```bash
sudo ./install-pipedal-kiosk.sh
```

The menu provides:

```text
1) Install or update PiPedal
2) Install or update MultiFX
3) Remove MultiFX and restore original PiPedal
4) Set up touchscreen display
5) Complete setup: PiPedal + MultiFX + touchscreen
6) Status and diagnostics
7) Exit
```

The setup script checks GitHub for the latest stable official PiPedal release
instead of relying on a hard-coded version. It chooses the package matching the
machine's `arm64` or `amd64` architecture.

MultiFX is downloaded from the latest stable PiPedal MultiFX GitHub Release.
Both the release ZIP and its `.sha256` file must be attached to the release.
The checksum is verified before the ZIP is extracted.

The optional touchscreen action automatically detects the normal login user
and configures the same display mode used by the project: console auto-login,
Labwc, maximized Chromium app mode, and the Squeekboard keyboard. Chromium's
`--kiosk` mode is deliberately not used because it interferes with the
on-screen keyboard.

The installer saves itself as:

```bash
sudo pipedal-multifx-setup
```

Advanced examples:

```bash
# Install a particular published MultiFX release.
sudo pipedal-multifx-setup multifx --tag multifx-v0.4.0

# Install the newest published release, including a prerelease.
sudo pipedal-multifx-setup multifx --latest-release

# Install an already extracted Raspberry Pi release package.
sudo pipedal-multifx-setup multifx --local /path/to/package

# Select a particular login user only when automatic detection is unsuitable.
sudo pipedal-multifx-setup display --user pi
```

See [Publishing a MultiFX Release](RELEASING_MULTIFX.md) for the GitHub release
procedure that creates the downloadable ZIP and checksum.

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

The uninstaller restores the frontend that was backed up before MultiFX was first installed. MultiFX layouts, themes, controller assignments and runtime state are preserved so reinstalling MultiFX can recover them.

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

Installer restore data:
  /var/lib/pipedal-multifx-installer/

Touchscreen configuration backups:
  /var/lib/pipedal-touchscreen/
```

## After Installation

Open the PiPedal web interface in the configured touchscreen/browser.

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
