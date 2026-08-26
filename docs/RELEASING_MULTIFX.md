# Publishing a PiPedal MultiFX Release

[← Back to installation](INSTALLATION.md)

The all-in-one installer updates MultiFX from permanent assets attached to a
published GitHub Release. A Git tag by itself and a temporary Actions artifact
are not enough.

Each published release must contain these two files:

```text
PiPedal-MultiFX-vX.Y.Z-RaspberryPi.zip
PiPedal-MultiFX-vX.Y.Z-RaspberryPi.zip.sha256
```

The ZIP contains the built frontend, controller bridge, factory configuration,
systemd units, compatibility installers, PiPedal package-verification key,
release version, installation guide, project/font license notices, and the
all-in-one setup utility. The checksum allows the installer to reject a damaged
or incomplete download before extracting it.

## One-Time Repository Setting

The workflow uses the repository's built-in `GITHUB_TOKEN` to attach files to
the release. In the GitHub repository, open:

```text
Settings → Actions → General → Workflow permissions
```

Select:

```text
Read and write permissions
```

Save the setting. The workflow file also requests `contents: write`, but the
repository setting must permit that access.

## Normal Release Procedure

1. Finish testing the `dev` branch.
2. Commit and push the completed changes.
3. Merge or synchronize the tested commit into `main`.
4. On GitHub, open the repository's **Releases** page.
5. Select **Draft a new release**.
6. Create a new tag targeting the tested `main` commit. Use a semantic version
   such as `multifx-v0.4.0`.
7. Enter the release title and notes.
8. Mark it as a prerelease only when it should not be selected by the normal
   **Install / change MultiFX version** menu option.
9. Select **Publish release**.

Publishing the release starts the **Build MultiFX Raspberry Pi Package**
workflow. The workflow checks out the release tag for the UI/bridge and the
current `main` branch for installer tooling, installs exact frontend
dependencies with `npm ci`, builds the UI, assembles the Raspberry Pi package,
checks the shell scripts and required files, creates the SHA-256 checksum, and
attaches both permanent assets to the release.

The release page initially appears without the generated files. Refresh it
after the workflow completes to see the ZIP and `.sha256` assets.

## Verify the Workflow

Open:

```text
GitHub repository → Actions → Build MultiFX Raspberry Pi Package
```

The release is ready when every step is green and the release page lists both
files. If the final upload step reports a permission error, recheck the
one-time **Workflow permissions** setting above.

## Test Packaging or Backfill an Older Release

The workflow can also be started manually from its Actions page. It asks for:

- **source_ref** — branch, tag or commit containing the MultiFX version
- **version** — version used in the package filename
- **release_tag** — optional existing GitHub Release that should receive it

Leave `release_tag` blank for a temporary test artifact. To make an older
version available in the installer's downgrade list, enter its tag as both
`source_ref` and `release_tag`, enter its numeric version, and run the workflow.
The permanent ZIP/checksum assets are attached to that existing Release.

Backfilled packages use the selected older UI/bridge source but the current
installer from `main`. This prevents downgrading the management and safety code
when the user downgrades MultiFX itself.

## How End-User Updates Work

When the user chooses **Install / change MultiFX version**, the setup utility:

1. Queries the repository's latest stable GitHub Release.
2. Finds the Raspberry Pi ZIP and matching `.sha256` asset.
3. Downloads both into a temporary directory.
4. Calculates the ZIP's SHA-256 value and compares it with the published value.
5. Validates the ZIP structure and rejects unsafe paths.
6. Preserves the stock PiPedal frontend and MultiFX user state.
7. Installs the new frontend, bridge, and service definitions.
8. Restarts and checks the controller bridge.
9. Installs the latest copy of the setup utility for future updates.

The version selector includes stable releases and packaged prereleases, clearly
labels prereleases, and defaults to the latest stable release. Advanced users
can also explicitly install the newest published release from the command line:

```bash
sudo pipedal-multifx-setup multifx --latest-release
```
