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

Download the current setup utility directly to the Raspberry Pi user's home folder:

```bash
cd ~
curl -fL https://raw.githubusercontent.com/MegaNoob75/PiPedal-MultiFX/main/vite/mfxinstaller.sh -o mfxinstaller.sh
chmod +x mfxinstaller.sh
sudo ./mfxinstaller.sh
```

If `curl` is unavailable, replace the download line with:

```bash
wget -O mfxinstaller.sh https://raw.githubusercontent.com/MegaNoob75/PiPedal-MultiFX/main/vite/mfxinstaller.sh
```

After a successful installation or update, MultiFX keeps this home-folder copy
current and also installs `sudo pipedal-multifx-setup` as the system management
command. Every invocation first downloads and validates the authoritative
installer from the default branch, updates both local copies, and continues the
requested action with that version. This also applies to updates started from
the MultiFX interface.

## Option A — Add MultiFX to an Existing PiPedal Installation

From the home folder:

```bash
sudo ./mfxinstaller.sh
```

Choose **Install / change MultiFX version**. `install-multifx.sh` remains available as
a compatibility shortcut and calls the same consolidated setup utility.

The installer:

- verifies that PiPedal is already present
- installs the MultiFX runtime dependencies; it checks configured APT
  repositories first and, only when needed on Debian 13/Trixie, automatically
  enables official `trixie-backports` to install `ydotool`
- reversibly masks Debian's conflicting per-user `ydotool` service while
  MultiFX's system-level input daemon is installed
- backs up the current PiPedal frontend the first time MultiFX is installed
- installs the prebuilt MultiFX frontend
- preserves an existing controller configuration during normal updates
- installs the MultiFX controller bridge
- installs/restarts the required systemd services
- refreshes the browser when the touchscreen refresh service is available

PiPedal's audio engine and preset storage remain PiPedal-owned. MultiFX does
not modify PiPedal's audio-device settings. Configure and test the interface
in PiPedal itself; 48000 Hz is the recommended starting sample rate.

## Option B — All-in-One Setup Menu

The package also includes:

```bash
sudo ./mfxinstaller.sh
```

The menu provides:

```text
1) Install / change PiPedal version
2) Install / change MultiFX version
3) Complete setup: PiPedal + MultiFX + touchscreen
4) Create full backup
5) Restore backup
6) Completely remove MultiFX
7) Completely remove PiPedal + MultiFX
8) Set up touchscreen display
9) Raspberry Pi performance optimizations
10) Status and diagnostics
11) Exit
```

The setup script checks GitHub instead of relying on hard-coded versions. It
lists published PiPedal packages matching the machine's `arm64` or `amd64`
architecture and MultiFX releases that have a verified Raspberry Pi ZIP. The
newest stable choice is first and marked **Latest**. Selecting an older version
performs an intentional downgrade.

Before a downgrade, the installer offers to create a backup. For MultiFX it
also offers to reset controller/runtime data to the older package defaults,
because an older bridge may not understand state written by a newer release.

All menus support Up/Down, Enter and numbered choices. Long version lists
scroll inside the terminal instead of overflowing the display.

MultiFX is downloaded from the selected PiPedal MultiFX GitHub Release. Both
the release ZIP and its `.sha256` file must be attached to that release. The
checksum is verified before the ZIP is extracted.

The optional touchscreen action automatically detects the normal login user
and configures the same display mode used by the project: console auto-login,
Labwc, maximized Chromium app mode, and MultiFX's custom on-screen keyboard.
Chromium's strict `--kiosk` mode is deliberately not used.

The Raspberry Pi optimization menu offers a recommended reversible Pi 5 audio
profile and separate optional changes. The recommended profile removes safe
network-online/cloud-init boot waits after provisioning, selects the CPU
performance governor, supplies PiPedal real-time resource limits, disables
Wi-Fi power saving, and lowers swapping pressure without removing zram/swap.
Optional actions can disable Bluetooth or detected unused service groups
without removing packages. Available groups cover printing, cellular modem
management, PackageKit, desktop location/color management, Samba/NFS sharing,
and graphical remote-desktop servers. A separate text-free display option
installs a black Plymouth screen with stacked PiPedal and Pi-MultiFX branding
for normal boot, reboot and shutdown,
hides the cursor and routine kernel/systemd status output, and keeps those
details available in `journalctl`. Catastrophic failures that occur before the
splash starts may still use the console. Each service group has its own warning so users
do not disable hardware or sharing features they rely on. SSH, NetworkManager,
Ethernet, Wi-Fi configuration, Avahi, users, passwords, and SSH keys are
preserved. A restore action returns every installer-managed setting to its
recorded prior state.

The installer saves itself as:

```bash
sudo pipedal-multifx-setup
```

Every installer action refreshes both the system management command and the
normal user's `~/mfxinstaller.sh` copy before performing any other work.

PiPedal and PI-MULTIFX can be checked by opening **PiPedal / System** in
PI-MULTIFX Settings and selecting **Check for updates**. A newer stable
PI-MULTIFX release can be installed directly from the same screen. The runtime
bridge starts the existing setup utility as an independent systemd job, so it
can safely restart the controller bridge and interface during installation.
The normal verified Raspberry Pi ZIP and matching SHA-256 release assets are
required. PiPedal can also be updated from the setup utility:

```bash
sudo pipedal-multifx-setup pipedal
```

The update installs PiPedal's complete official server and stock frontend.
MultiFX controller configuration, layouts and runtime state are retained, but
the MultiFX frontend and services are not held over the new PiPedal release.
Reinstall MultiFX with `sudo pipedal-multifx-setup multifx` only after confirming
that the selected MultiFX release supports the new PiPedal version.

Advanced examples:

```bash
# Install a particular published PiPedal release.
sudo pipedal-multifx-setup pipedal --pipedal-tag v2.0.108

# Install a particular published MultiFX release.
sudo pipedal-multifx-setup multifx --tag multifx-v0.4.0

# Install the newest published release, including a prerelease.
sudo pipedal-multifx-setup multifx --latest-release

# Install an already extracted Raspberry Pi release package.
sudo pipedal-multifx-setup multifx --local /path/to/package

# Select a particular login user only when automatic detection is unsuitable.
sudo pipedal-multifx-setup display --user pi
```

## Backup and Restore

Choose **Create full backup**, or run:

```bash
sudo pipedal-multifx-setup backup
```

Backups are named `mfxbackup-YYYYMMDD-HHMMSS.tar.gz` and saved under the
detected login user's `~/mfxbackups` directory. A backup includes:

- `/etc/pipedal` configuration and the installed frontend
- `/var/pipedal` banks, presets, plugin presets, NAM models, IRs and uploads
- MultiFX bridge, controller configuration, layouts, themes and runtime state
- MultiFX systemd service definitions
- standard system, architecture-specific, local and user LV2 directories
- touchscreen/Labwc configuration created by this installer

Choose **Restore backup**, or run `sudo pipedal-multifx-setup restore`, to pick
a backup using the same keyboard menu. Restore warns when the backup's PiPedal
version differs from the installed version because PiPedal may need to migrate
presets between releases. After a complete removal, install the desired
PiPedal version first and then restore the backup.

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

The uninstaller first offers to create a backup. It restores the frontend that
was backed up before MultiFX was installed, then removes the MultiFX bridge,
controller configuration, services, runtime state and installer restore data.
Only the installed setup tool and `~/mfxbackups` are deliberately retained.

If compatible services existed before MultiFX was installed, their previous service definitions are restored as well.

PiPedal itself is **not** removed.

The main menu also has **Completely remove PiPedal + MultiFX**. That action
offers a backup, purges the PiPedal package, removes PiPedal/MultiFX data and
configuration, restores the previous touchscreen startup files, and removes
PiPedal's bundled TooB plugin directory. Independently installed third-party
LV2 plugins are backed up but are not deleted.

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
