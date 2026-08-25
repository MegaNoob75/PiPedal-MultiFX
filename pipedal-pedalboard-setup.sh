#!/usr/bin/env bash
set -Eeuo pipefail

# PiPedal MultiFX consolidated setup utility.
#
# Interactive:
#   sudo ./pipedal-pedalboard-setup.sh
#
# Scriptable examples:
#   sudo ./pipedal-pedalboard-setup.sh multifx --tag multifx-v0.3.2
#   sudo ./pipedal-pedalboard-setup.sh multifx --latest-stable
#   sudo ./pipedal-pedalboard-setup.sh multifx --local /path/to/extracted/package
#   sudo ./pipedal-pedalboard-setup.sh kiosk
#   sudo ./pipedal-pedalboard-setup.sh all --tag multifx-v0.3.2
#   sudo ./pipedal-pedalboard-setup.sh uninstall

MULTIFX_REPOSITORY="${MULTIFX_REPOSITORY:-MegaNoob75/PiPedal-MultiFX}"
MULTIFX_RELEASES_API="https://api.github.com/repos/${MULTIFX_REPOSITORY}/releases"
PIPEDAL_RELEASES_API="https://api.github.com/repos/rerdavies/pipedal/releases"

REACT_DIR="/etc/pipedal/react"
CONTROLLER_CONFIG="/etc/pipedal/controller-config.json"
MFX_LIB_DIR="/usr/local/lib/pipedal-multifx"
MFX_STATE_DIR="/var/lib/pipedal-multifx"
KIOSK_STATE_DIR="/var/lib/pipedal-kiosk"
SERVICE_DIR="/etc/systemd/system"
SETUP_COMMAND="/usr/local/sbin/pipedal-pedalboard-setup"
LEGACY_UNINSTALL_COMMAND="/usr/local/sbin/uninstall-pipedal-multifx"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_FILE="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"
INVOKED_AS="${0##*/}"

ACTION="menu"
SOURCE_MODE="auto"
REQUESTED_TAG=""
LOCAL_PACKAGE=""
TARGET_USER_OVERRIDE=""
RUN_FULL_UPGRADE=0
ASSUME_YES=0
APT_UPDATED=0
TEMP_DIRS=()

die() {
    echo "ERROR: $*" >&2
    exit 1
}

cleanup() {
    local directory
    for directory in "${TEMP_DIRS[@]:-}"; do
        case "${directory}" in
            /tmp/pipedal-install.*|/tmp/pipedal-multifx.*)
                [ ! -e "${directory}" ] || rm -rf -- "${directory}"
                ;;
        esac
    done
}
trap cleanup EXIT

make_temp_dir() {
    local pattern="$1"
    TEMP_DIR="$(mktemp -d "${pattern}")"
    TEMP_DIRS+=("${TEMP_DIR}")
}

require_root() {
    [ "$(id -u)" -eq 0 ] || die "Run this script with sudo."
}

usage() {
    cat <<'USAGE'
PiPedal MultiFX consolidated setup utility

Usage:
  sudo ./pipedal-pedalboard-setup.sh [action] [options]

Actions:
  menu        Show the interactive menu (default)
  multifx     Install or update MultiFX
  kiosk       Install or update PiPedal and configure the Chromium kiosk
  all         Install/update PiPedal + kiosk, then MultiFX
  uninstall   Remove MultiFX and restore the original PiPedal frontend

MultiFX source options (choose at most one):
  --tag TAG          Install a specific published GitHub release tag
  --latest-stable    Install GitHub's latest stable release
  --latest-release   Install the newest published release, including a beta
  --choose-release   Show published releases and choose interactively
  --local DIRECTORY  Install an already-extracted Raspberry Pi package

Other options:
  --full-upgrade     Run apt-get full-upgrade before kiosk installation
  --user USER        Configure kiosk login for this normal user
  -y, --yes          Accept the requested full system upgrade noninteractively
  -h, --help         Show this help

Examples:
  sudo ./pipedal-pedalboard-setup.sh multifx --tag multifx-v0.3.2
  sudo ./pipedal-pedalboard-setup.sh multifx --choose-release
  sudo ./pipedal-pedalboard-setup.sh all --latest-release
  sudo ./pipedal-pedalboard-setup.sh uninstall

Important: a Git tag alone is not installable. The tag must have a published
GitHub Release with the prebuilt PiPedal-MultiFX RaspberryPi ZIP attached.
USAGE
}

set_source_mode() {
    local new_mode="$1"
    if [ "${SOURCE_MODE}" != "auto" ]; then
        die "Use only one of --tag, --latest-stable, --latest-release, --choose-release, or --local."
    fi
    SOURCE_MODE="${new_mode}"
}

parse_arguments() {
    if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
        ACTION="$1"
        shift
    fi

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --tag)
                [ "$#" -ge 2 ] || die "--tag requires a tag name."
                set_source_mode tag
                REQUESTED_TAG="$2"
                shift 2
                ;;
            --latest-stable)
                set_source_mode latest-stable
                shift
                ;;
            --latest-release)
                set_source_mode latest-release
                shift
                ;;
            --choose-release)
                set_source_mode choose
                shift
                ;;
            --local)
                [ "$#" -ge 2 ] || die "--local requires a directory."
                set_source_mode local
                LOCAL_PACKAGE="$2"
                shift 2
                ;;
            --full-upgrade)
                RUN_FULL_UPGRADE=1
                shift
                ;;
            --user)
                [ "$#" -ge 2 ] || die "--user requires a username."
                TARGET_USER_OVERRIDE="$2"
                shift 2
                ;;
            -y|--yes)
                ASSUME_YES=1
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                die "Unknown option: $1"
                ;;
        esac
    done

    case "${ACTION}" in
        menu|multifx|kiosk|all|uninstall) ;;
        *) die "Unknown action: ${ACTION}" ;;
    esac
}

apt_update_once() {
    if [ "${APT_UPDATED}" -eq 0 ]; then
        apt-get update
        APT_UPDATED=1
    fi
}

install_download_tools() {
    apt_update_once
    apt-get install -y --no-install-recommends curl ca-certificates python3 unzip
}

github_api() {
    curl -fsSL \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "$1"
}

urlencode() {
    python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}

load_multifx_release_by_tag() {
    local encoded_tag
    encoded_tag="$(urlencode "$1")"
    if ! RELEASE_JSON="$(github_api "${MULTIFX_RELEASES_API}/tags/${encoded_tag}")"; then
        die "No published GitHub Release was found for tag '$1'. A Git tag alone is not enough; publish a release for the tag and attach the prebuilt Raspberry Pi ZIP."
    fi
}

load_latest_stable_multifx_release() {
    if ! RELEASE_JSON="$(github_api "${MULTIFX_RELEASES_API}/latest")"; then
        die "No latest stable MultiFX release is published. Publish a GitHub Release and attach the prebuilt Raspberry Pi ZIP."
    fi
}

load_latest_published_multifx_release() {
    local releases_json
    if ! releases_json="$(github_api "${MULTIFX_RELEASES_API}?per_page=100")"; then
        die "Could not read the MultiFX release list from GitHub."
    fi
    if ! RELEASE_JSON="$(printf '%s' "${releases_json}" | python3 -c '
import json,sys
releases=json.load(sys.stdin)
releases=[release for release in releases if not release.get("draft")]
if not releases:
    raise SystemExit("No published MultiFX releases were found.")
print(json.dumps(releases[0], separators=(",", ":")))
')"; then
        die "No published MultiFX releases were found."
    fi
}

choose_multifx_release() {
    local releases_json release_table row number choice
    local -a release_rows=()

    [ -t 0 ] || die "--choose-release requires an interactive terminal. Use --tag, --latest-stable, or --latest-release instead."
    if ! releases_json="$(github_api "${MULTIFX_RELEASES_API}?per_page=100")"; then
        die "Could not read the MultiFX release list from GitHub."
    fi
    if ! release_table="$(printf '%s' "${releases_json}" | python3 -c '
import json,sys
for release in json.load(sys.stdin):
    if release.get("draft"):
        continue
    kind="pre-release" if release.get("prerelease") else "stable"
    name=(release.get("name") or "").replace("\t", " ").replace("\n", " ")
    tag=release.get("tag_name", "?")
    print(f"{tag}\t{kind}\t{name}")
')"; then
        die "GitHub returned invalid release metadata."
    fi
    [ -n "${release_table}" ] || die "No published MultiFX releases were found."

    mapfile -t release_rows <<< "${release_table}"
    echo
    echo "Published PiPedal MultiFX releases:"
    number=1
    for row in "${release_rows[@]}"; do
        IFS=$'\t' read -r tag_name release_kind release_name <<< "${row}"
        printf '  %2d) %-24s %-11s %s\n' "${number}" "${tag_name}" "${release_kind}" "${release_name}"
        number=$((number + 1))
    done
    echo
    read -r -p "Choose a release [1-${#release_rows[@]}], or enter an exact tag: " choice
    [ -n "${choice}" ] || die "No release was selected."

    if [[ "${choice}" =~ ^[0-9]+$ ]]; then
        [ "${choice}" -ge 1 ] && [ "${choice}" -le "${#release_rows[@]}" ] || die "Invalid release number."
        row="${release_rows[$((choice - 1))]}"
        IFS=$'\t' read -r REQUESTED_TAG _ <<< "${row}"
    else
        REQUESTED_TAG="${choice}"
    fi
    load_multifx_release_by_tag "${REQUESTED_TAG}"
}

parse_multifx_release_asset() {
    local parsed
    if ! parsed="$(printf '%s' "${RELEASE_JSON}" | python3 -c '
import json,sys
release=json.load(sys.stdin)
assets=release.get("assets", [])
zips=[a for a in assets if a.get("name", "").lower().endswith(".zip")]
preferred=[a for a in zips if "raspberrypi" in a.get("name", "").lower() and "multifx" in a.get("name", "").lower()]
fallback=[a for a in zips if "multifx" in a.get("name", "").lower()]
matches=preferred or fallback
if not matches:
    raise SystemExit("No MultiFX Raspberry Pi ZIP asset is attached to this release.")
asset=matches[0]
print(release["tag_name"])
print(asset["name"])
print(asset["browser_download_url"])
')"; then
        die "The selected release has no usable MultiFX Raspberry Pi ZIP asset. Attach the package created by the build workflow to the release."
    fi

    MULTIFX_TAG="$(printf '%s\n' "${parsed}" | sed -n '1p')"
    MULTIFX_FILE="$(printf '%s\n' "${parsed}" | sed -n '2p')"
    MULTIFX_URL="$(printf '%s\n' "${parsed}" | sed -n '3p')"
    [ -n "${MULTIFX_TAG}" ] && [ -n "${MULTIFX_FILE}" ] && [ -n "${MULTIFX_URL}" ] || die "The selected release metadata is incomplete."
    [[ "${MULTIFX_FILE}" != */* && "${MULTIFX_FILE}" != *\\* ]] || die "Unsafe release asset name: ${MULTIFX_FILE}"
}

is_multifx_package_root() {
    local directory="$1"
    [ -f "${directory}/react/index.html" ] &&
        [ -f "${directory}/multifx/controller-config.json" ] &&
        [ -f "${directory}/multifx/pipedal_encoder_bridge.py" ] &&
        { [ -f "${directory}/systemd/system/pipedal-encoder.service" ] ||
          [ -f "${directory}/multifx/systemd/system/pipedal-encoder.service" ]; } &&
        { [ -f "${directory}/systemd/system/pipedal-ydotoold.service" ] ||
          [ -f "${directory}/multifx/systemd/system/pipedal-ydotoold.service" ]; }
}

find_multifx_package_root() {
    local search_dir="$1" index_file candidate
    if is_multifx_package_root "${search_dir}"; then
        PACKAGE_ROOT="${search_dir}"
        return
    fi

    while IFS= read -r index_file; do
        candidate="$(dirname -- "$(dirname -- "${index_file}")")"
        if is_multifx_package_root "${candidate}"; then
            PACKAGE_ROOT="${candidate}"
            return
        fi
    done < <(find "${search_dir}" -maxdepth 4 -type f -path '*/react/index.html' -print)
    die "No valid PiPedal MultiFX package was found under ${search_dir}."
}

install_setup_command() {
    if [ -f "${SCRIPT_FILE}" ]; then
        mkdir -p "$(dirname -- "${SETUP_COMMAND}")"
        if [ ! "${SCRIPT_FILE}" -ef "${SETUP_COMMAND}" ]; then
            install -m 0755 "${SCRIPT_FILE}" "${SETUP_COMMAND}"
        fi
    fi
}

install_multifx_payload() {
    local package_root="$1" release_label="$2" service source_file

    [ -d /etc/pipedal ] || die "PiPedal is not installed (/etc/pipedal is missing)."
    [ -d "${REACT_DIR}" ] || die "PiPedal frontend is missing: ${REACT_DIR}"
    is_multifx_package_root "${package_root}" || die "Invalid MultiFX package: ${package_root}"

    echo "Installing PiPedal MultiFX from ${release_label}..."
    apt_update_once
    apt-get install -y --no-install-recommends ydotool python3-mido python3-rtmidi
    mkdir -p "${MFX_STATE_DIR}" "${MFX_LIB_DIR}" "${MFX_STATE_DIR}/service-backups"

    if [ ! -d "${MFX_STATE_DIR}/original-react" ]; then
        mkdir -p "${MFX_STATE_DIR}/original-react"
        cp -a "${REACT_DIR}/." "${MFX_STATE_DIR}/original-react/"
    fi

    for service in pipedal-encoder.service pipedal-ydotoold.service; do
        if [ -f "${SERVICE_DIR}/${service}" ] && [ ! -f "${MFX_STATE_DIR}/service-backups/${service}" ]; then
            cp -a "${SERVICE_DIR}/${service}" "${MFX_STATE_DIR}/service-backups/${service}"
        fi
    done

    find "${REACT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    cp -a "${package_root}/react/." "${REACT_DIR}/"

    # This file supplies current factory defaults. Durable user controller,
    # assignment, theme, and UI state remains in MFX_STATE_DIR/state.json.
    if [ -f "${CONTROLLER_CONFIG}" ]; then
        cp -a "${CONTROLLER_CONFIG}" "${MFX_STATE_DIR}/controller-config.pre-current-schema.json"
    fi
    install -m 0644 "${package_root}/multifx/controller-config.json" "${CONTROLLER_CONFIG}"
    ln -sfn "${CONTROLLER_CONFIG}" "${REACT_DIR}/controller-config.json"

    install -m 0755 "${package_root}/multifx/pipedal_encoder_bridge.py" "${MFX_LIB_DIR}/pipedal_encoder_bridge.py"
    for service in pipedal-ydotoold.service pipedal-encoder.service; do
        source_file="${package_root}/systemd/system/${service}"
        [ -f "${source_file}" ] || source_file="${package_root}/multifx/systemd/system/${service}"
        [ -f "${source_file}" ] || die "The package is missing ${service}."
        install -m 0644 "${source_file}" "${SERVICE_DIR}/${service}"
    done

    printf '%s\n' "${release_label}" > "${MFX_STATE_DIR}/installed-release"
    install_setup_command
    ln -sfn "${SETUP_COMMAND}" "${LEGACY_UNINSTALL_COMMAND}"

    systemctl daemon-reload
    systemctl enable pipedal-ydotoold.service pipedal-encoder.service
    systemctl restart pipedal-ydotoold.service
    systemctl restart pipedal-encoder.service

    if command -v ydotool >/dev/null 2>&1 && [ -S /tmp/.ydotool_socket ]; then
        YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool key 29:1 19:1 19:0 29:0 || true
    fi

    echo "PiPedal MultiFX installation complete (${release_label})."
}

install_multifx_from_local() {
    local directory="$1"
    [ -d "${directory}" ] || die "Local package directory does not exist: ${directory}"
    find_multifx_package_root "${directory}"
    install_multifx_payload "${PACKAGE_ROOT}" "local package"
}

install_multifx_from_github() {
    install_download_tools
    case "${SOURCE_MODE}" in
        tag) load_multifx_release_by_tag "${REQUESTED_TAG}" ;;
        latest-stable) load_latest_stable_multifx_release ;;
        latest-release) load_latest_published_multifx_release ;;
        choose) choose_multifx_release ;;
        *) die "Internal error: invalid GitHub release selection mode '${SOURCE_MODE}'." ;;
    esac
    parse_multifx_release_asset

    echo "Selected MultiFX release: ${MULTIFX_TAG}"
    echo "Downloading: ${MULTIFX_FILE}"
    make_temp_dir /tmp/pipedal-multifx.XXXXXX
    local work_dir="${TEMP_DIR}"
    curl -fL "${MULTIFX_URL}" -o "${work_dir}/${MULTIFX_FILE}"
    unzip -tq "${work_dir}/${MULTIFX_FILE}" >/dev/null || die "The downloaded MultiFX ZIP is invalid."
    if unzip -Z1 "${work_dir}/${MULTIFX_FILE}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
        die "The downloaded ZIP contains an unsafe path."
    fi
    mkdir -p "${work_dir}/package"
    unzip -q "${work_dir}/${MULTIFX_FILE}" -d "${work_dir}/package"
    find_multifx_package_root "${work_dir}/package"
    install_multifx_payload "${PACKAGE_ROOT}" "${MULTIFX_TAG}"
}

run_multifx_install() {
    case "${SOURCE_MODE}" in
        local)
            install_multifx_from_local "${LOCAL_PACKAGE}"
            ;;
        tag|latest-stable|latest-release|choose)
            install_multifx_from_github
            ;;
        auto)
            if is_multifx_package_root "${SCRIPT_DIR}"; then
                install_multifx_payload "${SCRIPT_DIR}" "local package"
            elif [ -t 0 ]; then
                SOURCE_MODE="choose"
                install_multifx_from_github
            else
                SOURCE_MODE="latest-stable"
                install_multifx_from_github
            fi
            ;;
    esac
}

get_target_user() {
    if [ -n "${TARGET_USER_OVERRIDE}" ]; then
        TARGET_USER="${TARGET_USER_OVERRIDE}"
    elif [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        TARGET_USER="${SUDO_USER}"
    else
        TARGET_USER="$(awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}' /etc/passwd)"
    fi

    [ -n "${TARGET_USER:-}" ] || die "Could not determine the normal Pi user. Use --user USER."
    id "${TARGET_USER}" >/dev/null 2>&1 || die "User does not exist: ${TARGET_USER}"
    TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
    [ -d "${TARGET_HOME}" ] || die "Could not determine the home directory for ${TARGET_USER}."
    TARGET_GROUP="$(id -gn "${TARGET_USER}")"
}

get_latest_pipedal_release() {
    local release_json architecture parsed
    architecture="$(dpkg --print-architecture)"
    case "${architecture}" in
        arm64|amd64) ;;
        *) die "No supported PiPedal release package is expected for architecture '${architecture}'." ;;
    esac

    echo "Checking GitHub for the latest stable PiPedal release..."
    if ! release_json="$(github_api "${PIPEDAL_RELEASES_API}/latest")"; then
        die "Could not read the latest stable PiPedal release from GitHub."
    fi
    if ! parsed="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
release=json.load(sys.stdin)
arch=sys.argv[1]
suffix=f"_{arch}.deb"
for asset in release.get("assets", []):
    name=asset.get("name", "")
    if name.startswith("pipedal_") and name.endswith(suffix):
        print(release["tag_name"])
        print(name)
        print(asset["browser_download_url"])
        break
else:
    raise SystemExit(f"No PiPedal {arch} .deb asset was found.")
' "${architecture}")"; then
        die "The latest PiPedal release has no ${architecture} .deb package."
    fi

    PIPEDAL_TAG="$(printf '%s\n' "${parsed}" | sed -n '1p')"
    PIPEDAL_FILE="$(printf '%s\n' "${parsed}" | sed -n '2p')"
    PIPEDAL_URL="$(printf '%s\n' "${parsed}" | sed -n '3p')"
    PIPEDAL_VERSION="${PIPEDAL_TAG#v}"
    echo "Latest stable PiPedal release: ${PIPEDAL_TAG}"
}

install_or_update_pipedal() {
    local installed_version work_dir
    get_latest_pipedal_release

    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        installed_version="$(dpkg-query -W -f='${Version}' pipedal)"
        echo "Installed PiPedal version: ${installed_version}"
        if dpkg --compare-versions "${installed_version}" ge "${PIPEDAL_VERSION}"; then
            echo "PiPedal is already current or newer; skipping the package install."
            return
        fi
    fi

    make_temp_dir /tmp/pipedal-install.XXXXXX
    work_dir="${TEMP_DIR}"
    curl -fL "${PIPEDAL_URL}" -o "${work_dir}/${PIPEDAL_FILE}"
    apt-get install -y "${work_dir}/${PIPEDAL_FILE}"
}

backup_kiosk_file_once() {
    local source="$1" backup="$2"
    if [ -e "${source}" ] && [ ! -e "${backup}" ]; then
        mkdir -p "$(dirname -- "${backup}")"
        cp -a "${source}" "${backup}"
    fi
}

configure_kiosk() {
    get_target_user
    command -v raspi-config >/dev/null 2>&1 || die "raspi-config is required to enable console auto-login."

    echo "Configuring console auto-login for ${TARGET_USER}..."
    raspi-config nonint do_boot_behaviour B2

    mkdir -p "${KIOSK_STATE_DIR}" /etc/xdg/labwc
    backup_kiosk_file_once /etc/xdg/labwc/rc.xml "${KIOSK_STATE_DIR}/rc.xml.pre-pipedal-kiosk"
    backup_kiosk_file_once /etc/xdg/labwc/autostart "${KIOSK_STATE_DIR}/autostart.pre-pipedal-kiosk"
    backup_kiosk_file_once "${TARGET_HOME}/.bash_profile" "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk"

    cat > /etc/xdg/labwc/rc.xml <<'RCXML'
<?xml version="1.0"?>
<labwc_config>
  <windowRules>
    <windowRule identifier="*">
      <serverDecoration>no</serverDecoration>
    </windowRule>
  </windowRules>
</labwc_config>
RCXML

    cat > /etc/xdg/labwc/autostart <<'AUTOSTART'
#!/bin/bash
squeekboard &
exec /usr/bin/chromium \
    --ozone-platform=wayland \
    --start-maximized \
    --disable-features=WaylandWindowDecorations \
    --app=http://localhost \
    --password-store=basic
AUTOSTART
    chmod 0755 /etc/xdg/labwc/autostart

    cat > "${TARGET_HOME}/.bash_profile" <<'PROFILE'
# PiPedal kiosk login profile.
if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec labwc
fi
PROFILE
    chown "${TARGET_USER}:${TARGET_GROUP}" "${TARGET_HOME}/.bash_profile"
    if [ -f "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk" ]; then
        chown "${TARGET_USER}:${TARGET_GROUP}" "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk"
    fi
}

confirm_full_upgrade() {
    local answer
    [ "${RUN_FULL_UPGRADE}" -eq 1 ] || return 0
    [ "${ASSUME_YES}" -eq 1 ] && return 0
    [ -t 0 ] || die "--full-upgrade requires --yes when no interactive terminal is available."
    read -r -p "Run a full Raspberry Pi OS package upgrade now? [y/N]: " answer
    case "${answer}" in
        y|Y|yes|YES) ;;
        *) echo "Skipping the full system upgrade."; RUN_FULL_UPGRADE=0 ;;
    esac
}

install_pipedal_kiosk() {
    echo "=================================================="
    echo " PiPedal + Chromium Kiosk Setup"
    echo "=================================================="
    install_download_tools
    confirm_full_upgrade
    if [ "${RUN_FULL_UPGRADE}" -eq 1 ]; then
        apt-get full-upgrade -y
    fi
    apt-get install -y --no-install-recommends labwc chromium squeekboard
    install_or_update_pipedal
    configure_kiosk
    install_setup_command
    echo "PiPedal/kiosk setup is complete. Reboot to start the kiosk automatically."
}

uninstall_multifx() {
    local service backup
    cat <<'BANNER'
==================================================
 PiPedal MultiFX UI Uninstaller
==================================================
This removes MultiFX and restores the frontend that was
present before MultiFX was first installed.
PiPedal itself and the kiosk configuration are NOT removed.
BANNER

    systemctl disable --now pipedal-encoder.service 2>/dev/null || true
    systemctl disable --now pipedal-ydotoold.service 2>/dev/null || true

    for service in pipedal-encoder.service pipedal-ydotoold.service; do
        backup="${MFX_STATE_DIR}/service-backups/${service}"
        if [ -f "${backup}" ]; then
            echo "Restoring pre-existing ${service}..."
            cp -a "${backup}" "${SERVICE_DIR}/${service}"
        else
            rm -f "${SERVICE_DIR}/${service}"
        fi
    done

    rm -rf "${MFX_LIB_DIR}"
    rm -f "${LEGACY_UNINSTALL_COMMAND}"

    if [ -d "${MFX_STATE_DIR}/original-react" ]; then
        echo "Restoring the original PiPedal frontend..."
        mkdir -p "${REACT_DIR}"
        find "${REACT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
        cp -a "${MFX_STATE_DIR}/original-react/." "${REACT_DIR}/"
    else
        echo "WARNING: No original frontend backup was found."
        echo "The current ${REACT_DIR} was left unchanged."
    fi

    # Preserve /etc/pipedal/controller-config.json, matching the old uninstaller.
    systemctl daemon-reload
    for service in pipedal-ydotoold.service pipedal-encoder.service; do
        if [ -f "${MFX_STATE_DIR}/service-backups/${service}" ]; then
            systemctl enable "${service}" 2>/dev/null || true
            systemctl restart "${service}" 2>/dev/null || true
        fi
    done

    if command -v ydotool >/dev/null 2>&1 && [ -S /tmp/.ydotool_socket ]; then
        YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool key 29:1 19:1 19:0 29:0 || true
    fi

    rm -rf "${MFX_STATE_DIR}"
    echo "PiPedal MultiFX was removed and the original frontend was restored."
}

ask_about_full_upgrade() {
    local answer
    read -r -p "Also run a full Raspberry Pi OS upgrade? [y/N]: " answer
    case "${answer}" in
        y|Y|yes|YES) RUN_FULL_UPGRADE=1; ASSUME_YES=1 ;;
        *) RUN_FULL_UPGRADE=0 ;;
    esac
}

show_menu() {
    local choice
    echo
    echo "=================================================="
    echo " PiPedal Pedalboard Setup"
    echo "=================================================="
    echo "1) Install/update MultiFX from a GitHub release"
    echo "2) Install/update MultiFX from this extracted package"
    echo "3) Install/update PiPedal + Chromium kiosk"
    echo "4) Install/update PiPedal + kiosk, then MultiFX"
    echo "5) Uninstall MultiFX and restore the original UI"
    echo "6) Exit"
    echo "=================================================="
    read -r -p "Choose an option [1-6]: " choice

    case "${choice}" in
        1)
            SOURCE_MODE="choose"
            install_multifx_from_github
            ;;
        2)
            is_multifx_package_root "${SCRIPT_DIR}" || die "This script is not inside an extracted MultiFX Raspberry Pi package."
            install_multifx_payload "${SCRIPT_DIR}" "local package"
            ;;
        3)
            ask_about_full_upgrade
            install_pipedal_kiosk
            ;;
        4)
            ask_about_full_upgrade
            install_pipedal_kiosk
            SOURCE_MODE="auto"
            run_multifx_install
            ;;
        5)
            uninstall_multifx
            ;;
        6)
            exit 0
            ;;
        *)
            die "Invalid menu option."
            ;;
    esac
}

main() {
    # Keep the old installed uninstaller command working while using one file.
    if [ "${INVOKED_AS}" = "uninstall-pipedal-multifx" ]; then
        require_root
        uninstall_multifx
        return
    fi

    parse_arguments "$@"
    require_root
    case "${ACTION}" in
        menu) show_menu ;;
        multifx) run_multifx_install ;;
        kiosk) install_pipedal_kiosk ;;
        all) install_pipedal_kiosk; run_multifx_install ;;
        uninstall) uninstall_multifx ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
