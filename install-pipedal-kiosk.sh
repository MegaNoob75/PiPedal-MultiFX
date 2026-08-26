#!/usr/bin/env bash
set -Eeuo pipefail

# PiPedal MultiFX end-user setup utility.
#
# Normal use:
#   sudo ./install-pipedal-kiosk.sh
#
# Scripted/advanced use:
#   sudo ./install-pipedal-kiosk.sh pipedal
#   sudo ./install-pipedal-kiosk.sh multifx
#   sudo ./install-pipedal-kiosk.sh multifx --tag multifx-v0.4.0
#   sudo ./install-pipedal-kiosk.sh multifx --latest-release
#   sudo ./install-pipedal-kiosk.sh multifx --local /path/to/extracted/package
#   sudo ./install-pipedal-kiosk.sh uninstall
#   sudo ./install-pipedal-kiosk.sh display --user pi
#   sudo ./install-pipedal-kiosk.sh all

MULTIFX_REPOSITORY="${MULTIFX_REPOSITORY:-MegaNoob75/PiPedal-MultiFX}"
MULTIFX_RELEASES_API="https://api.github.com/repos/${MULTIFX_REPOSITORY}/releases"
PIPEDAL_RELEASES_API="https://api.github.com/repos/rerdavies/pipedal/releases"

REACT_DIR="/etc/pipedal/react"
CONTROLLER_CONFIG="/etc/pipedal/controller-config.json"
MFX_LIB_DIR="/usr/local/lib/pipedal-multifx"
MFX_STATE_DIR="/var/lib/pipedal-multifx"
INSTALLER_STATE_DIR="/var/lib/pipedal-multifx-installer"
STOCK_REACT_DIR="${INSTALLER_STATE_DIR}/stock-react"
PIPEDAL_KEY_STATE="${INSTALLER_STATE_DIR}/pipedal-updatekey.asc"
DISPLAY_STATE_DIR="/var/lib/pipedal-touchscreen"
SERVICE_DIR="/etc/systemd/system"
SETUP_COMMAND="/usr/local/sbin/pipedal-multifx-setup"
UNINSTALL_COMMAND="/usr/local/sbin/uninstall-pipedal-multifx"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_FILE="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"
INVOKED_AS="${0##*/}"

ACTION="menu"
MULTIFX_SOURCE="auto"
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
            /tmp/pipedal-install.*|/tmp/pipedal-multifx.*|/tmp/pipedal-transaction.*)
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
    [ "$(id -u)" -eq 0 ] || die "Run this installer with sudo."
}

usage() {
    cat <<'USAGE'
PiPedal MultiFX setup

Usage:
  sudo ./install-pipedal-kiosk.sh [action] [options]

Actions:
  menu        Interactive menu (default)
  pipedal     Install or update the latest official stable PiPedal
  multifx     Install or update PiPedal MultiFX
  uninstall   Remove MultiFX and restore the stock PiPedal UI
  display     Configure the fullscreen touchscreen display
  all         Install/update PiPedal, MultiFX and the touchscreen display
  status      Show installed versions and service diagnostics

Advanced options:
  --tag TAG          Install a specific published MultiFX release
  --latest-release   Include MultiFX prereleases when choosing the newest release
  --local DIRECTORY  Install an extracted MultiFX Raspberry Pi package
  --user USER        Use this normal account for touchscreen auto-login
  --full-upgrade     Run apt-get full-upgrade before the requested action
  -y, --yes          Accept confirmation prompts
  -h, --help         Show this help

The normal menu intentionally installs the latest stable releases. Advanced
release selection is available here without cluttering the touchscreen menu.
USAGE
}

parse_arguments() {
    if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
        ACTION="$1"
        shift
    fi

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --tag)
                [ "$#" -ge 2 ] || die "--tag requires a release tag."
                MULTIFX_SOURCE="tag"
                REQUESTED_TAG="$2"
                shift 2
                ;;
            --latest-release)
                MULTIFX_SOURCE="latest-release"
                shift
                ;;
            --local)
                [ "$#" -ge 2 ] || die "--local requires a directory."
                MULTIFX_SOURCE="local"
                LOCAL_PACKAGE="$2"
                shift 2
                ;;
            --user)
                [ "$#" -ge 2 ] || die "--user requires a username."
                TARGET_USER_OVERRIDE="$2"
                shift 2
                ;;
            --full-upgrade)
                RUN_FULL_UPGRADE=1
                shift
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
        menu|pipedal|multifx|uninstall|display|all|status) ;;
        *) die "Unknown action: ${ACTION}" ;;
    esac
}

confirm() {
    local prompt="$1" answer
    [ "${ASSUME_YES}" -eq 0 ] || return 0
    [ -t 0 ] || die "A confirmation is required; rerun with --yes."
    read -r -p "${prompt} [y/N]: " answer
    case "${answer}" in
        y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
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
    apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg python3 unzip
}

maybe_full_upgrade() {
    [ "${RUN_FULL_UPGRADE}" -eq 1 ] || return 0
    apt_update_once
    apt-get full-upgrade -y
}

github_api() {
    curl -fsSL \
        -H "Accept: application/vnd.github+json" \
        -H "X-GitHub-Api-Version: 2022-11-28" \
        "$1"
}

urlencode() {
    python3 -c \
        'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' \
        "$1"
}

replace_directory_contents() {
    local source="$1" target="$2"
    [ -d "${source}" ] || die "Replacement source is missing: ${source}"
    case "${target}" in
        "${REACT_DIR}"|"${STOCK_REACT_DIR}"|/tmp/pipedal-transaction.*/*) ;;
        *) die "Refusing to replace unexpected directory: ${target}" ;;
    esac
    mkdir -p "${target}"
    find "${target}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    cp -a "${source}/." "${target}/"
}

is_multifx_installed() {
    [ -f "${MFX_LIB_DIR}/pipedal_encoder_bridge.py" ] &&
        [ -f "${REACT_DIR}/index.html" ]
}

install_self() {
    local source="${1:-${SCRIPT_FILE}}" source_dir candidate
    [ -f "${source}" ] || return 0
    source_dir="$(cd -- "$(dirname -- "${source}")" && pwd)"
    mkdir -p "$(dirname -- "${SETUP_COMMAND}")"
    if [ ! "${source}" -ef "${SETUP_COMMAND}" ] 2>/dev/null; then
        install -m 0755 "${source}" "${SETUP_COMMAND}"
    fi
    ln -sfn "${SETUP_COMMAND}" "${UNINSTALL_COMMAND}"

    # Keep PiPedal's package-verification key with the installed setup tool so
    # future updates do not depend on the old extracted release directory.
    for candidate in \
        "${source_dir}/keys/pipedal-updatekey.asc" \
        "${source_dir}/config/updatekey2.asc"; do
        if [ -f "${candidate}" ]; then
            mkdir -p "${INSTALLER_STATE_DIR}"
            install -m 0644 "${candidate}" "${PIPEDAL_KEY_STATE}"
            break
        fi
    done
}

refresh_browser() {
    if command -v ydotool >/dev/null 2>&1 &&
        [ -S /tmp/.ydotool_socket ]; then
        YDOTOOL_SOCKET=/tmp/.ydotool_socket \
            ydotool key 29:1 19:1 19:0 29:0 || true
    fi
}

find_pipedal_key() {
    local candidate
    for candidate in \
        "${PIPEDAL_KEY_STATE}" \
        "${SCRIPT_DIR}/keys/pipedal-updatekey.asc" \
        "${SCRIPT_DIR}/config/updatekey2.asc" \
        "${SCRIPT_DIR}/config/updatekey.asc" \
        /etc/pipedal/config/updatekey2.asc \
        /etc/pipedal/config/updatekey.asc; do
        if [ -f "${candidate}" ]; then
            PIPEDAL_KEY_FILE="${candidate}"
            return 0
        fi
    done
    return 1
}

load_latest_pipedal_release() {
    local release_json parsed architecture
    architecture="$(dpkg --print-architecture)"
    case "${architecture}" in
        arm64|amd64) ;;
        *) die "Official PiPedal packages are not expected for '${architecture}'." ;;
    esac

    echo "Checking the official PiPedal GitHub releases..."
    release_json="$(github_api "${PIPEDAL_RELEASES_API}/latest")" ||
        die "Could not read the latest official PiPedal release."
    parsed="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
release=json.load(sys.stdin)
arch=sys.argv[1]
suffix=f"_{arch}.deb"
deb=None
for asset in release.get("assets", []):
    name=asset.get("name", "")
    if name.startswith("pipedal_") and name.endswith(suffix):
        deb=asset
        break
if deb is None:
    raise SystemExit(f"No PiPedal {arch} .deb package was found.")
signature=next((a for a in release.get("assets", [])
                if a.get("name") == deb["name"] + ".asc"), None)
print(release["tag_name"])
print(deb["name"])
print(deb["browser_download_url"])
print(signature["browser_download_url"] if signature else "")
' "${architecture}")" || die "The latest PiPedal release metadata is invalid."

    PIPEDAL_TAG="$(printf '%s\n' "${parsed}" | sed -n '1p')"
    PIPEDAL_FILE="$(printf '%s\n' "${parsed}" | sed -n '2p')"
    PIPEDAL_URL="$(printf '%s\n' "${parsed}" | sed -n '3p')"
    PIPEDAL_SIGNATURE_URL="$(printf '%s\n' "${parsed}" | sed -n '4p')"
    PIPEDAL_VERSION="${PIPEDAL_TAG#v}"
    [ -n "${PIPEDAL_FILE}" ] && [ -n "${PIPEDAL_URL}" ] ||
        die "The PiPedal release metadata is incomplete."
}

verify_pipedal_package() {
    local package="$1" signature="$2" keyring_dir
    if [ ! -f "${signature}" ] || ! find_pipedal_key; then
        echo "WARNING: The PiPedal signature or public key was unavailable."
        echo "The package was downloaded over HTTPS but was not GPG-verified."
        return 0
    fi

    keyring_dir="$(dirname -- "${package}")/gnupg"
    mkdir -m 0700 "${keyring_dir}"
    GNUPGHOME="${keyring_dir}" gpg --batch --import \
        "${PIPEDAL_KEY_FILE}" >/dev/null 2>&1
    GNUPGHOME="${keyring_dir}" gpg --batch --verify \
        "${signature}" "${package}"
}

ensure_stock_frontend_backup() {
    mkdir -p "${INSTALLER_STATE_DIR}"
    if [ -f "${STOCK_REACT_DIR}/index.html" ]; then
        return 0
    fi
    if [ -f "${MFX_STATE_DIR}/original-react/index.html" ]; then
        echo "Migrating the existing stock PiPedal frontend backup..."
        mkdir -p "${STOCK_REACT_DIR}"
        cp -a "${MFX_STATE_DIR}/original-react/." "${STOCK_REACT_DIR}/"
        return 0
    fi
    is_multifx_installed &&
        die "MultiFX is installed, but no stock PiPedal frontend backup exists."
    [ -f "${REACT_DIR}/index.html" ] ||
        die "The stock PiPedal frontend is missing: ${REACT_DIR}"
    mkdir -p "${STOCK_REACT_DIR}"
    cp -a "${REACT_DIR}/." "${STOCK_REACT_DIR}/"
}

install_or_update_pipedal() {
    local installed_version work_dir package signature="" had_multifx=0
    local saved_multifx=""

    install_download_tools
    load_latest_pipedal_release
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        installed_version="$(dpkg-query -W -f='${Version}' pipedal)"
        echo "Installed PiPedal: ${installed_version}"
        echo "Latest stable PiPedal: ${PIPEDAL_VERSION}"
        if dpkg --compare-versions "${installed_version}" ge \
            "${PIPEDAL_VERSION}"; then
            echo "PiPedal is already current or newer."
            install_self
            return 0
        fi
    fi

    make_temp_dir /tmp/pipedal-install.XXXXXX
    work_dir="${TEMP_DIR}"
    package="${work_dir}/${PIPEDAL_FILE}"
    echo "Downloading ${PIPEDAL_FILE}..."
    curl -fL "${PIPEDAL_URL}" -o "${package}"
    if [ -n "${PIPEDAL_SIGNATURE_URL}" ]; then
        signature="${package}.asc"
        curl -fL "${PIPEDAL_SIGNATURE_URL}" -o "${signature}"
    fi
    verify_pipedal_package "${package}" "${signature}"

    if is_multifx_installed; then
        had_multifx=1
        ensure_stock_frontend_backup
        make_temp_dir /tmp/pipedal-transaction.XXXXXX
        saved_multifx="${TEMP_DIR}/multifx-react"
        mkdir -p "${saved_multifx}"
        cp -a "${REACT_DIR}/." "${saved_multifx}/"
        systemctl stop pipedal-encoder.service 2>/dev/null || true
        replace_directory_contents "${STOCK_REACT_DIR}" "${REACT_DIR}"
    fi

    echo "Installing PiPedal ${PIPEDAL_VERSION}..."
    if ! apt-get install -y "${package}"; then
        if [ "${had_multifx}" -eq 1 ]; then
            replace_directory_contents "${saved_multifx}" "${REACT_DIR}"
            systemctl restart pipedal-encoder.service 2>/dev/null || true
        fi
        die "PiPedal installation failed; the previous MultiFX UI was restored."
    fi

    if [ "${had_multifx}" -eq 1 ]; then
        # Save the newly installed stock UI as the current restore point, then
        # put the user's installed MultiFX UI back in place.
        replace_directory_contents "${REACT_DIR}" "${STOCK_REACT_DIR}"
        replace_directory_contents "${saved_multifx}" "${REACT_DIR}"
        [ ! -e "${CONTROLLER_CONFIG}" ] ||
            ln -sfn "${CONTROLLER_CONFIG}" "${REACT_DIR}/controller-config.json"
        systemctl restart pipedald 2>/dev/null || true
        systemctl restart pipedal-encoder.service 2>/dev/null || true
    fi

    install_self
    echo "PiPedal ${PIPEDAL_VERSION} installation is complete."
}

load_multifx_release() {
    local release_json encoded parsed
    case "${MULTIFX_SOURCE}" in
        tag)
            encoded="$(urlencode "${REQUESTED_TAG}")"
            release_json="$(github_api \
                "${MULTIFX_RELEASES_API}/tags/${encoded}")" ||
                die "No published MultiFX release exists for '${REQUESTED_TAG}'."
            ;;
        latest-release)
            release_json="$(github_api \
                "${MULTIFX_RELEASES_API}?per_page=100")" ||
                die "Could not read the MultiFX releases."
            release_json="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
releases=[r for r in json.load(sys.stdin) if not r.get("draft")]
if not releases: raise SystemExit("No published releases")
print(json.dumps(releases[0], separators=(",", ":")))
')" || die "No published MultiFX release was found."
            ;;
        latest-stable)
            release_json="$(github_api "${MULTIFX_RELEASES_API}/latest")" ||
                die "No stable MultiFX release is published yet."
            ;;
        *) die "Internal MultiFX source error: ${MULTIFX_SOURCE}" ;;
    esac

    parsed="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
release=json.load(sys.stdin)
assets=release.get("assets", [])
zips=[a for a in assets if a.get("name", "").lower().endswith(".zip")]
preferred=[a for a in zips if "multifx" in a.get("name", "").lower()
           and "raspberrypi" in a.get("name", "").lower()]
matches=preferred or [a for a in zips if "multifx" in a.get("name", "").lower()]
if not matches: raise SystemExit("No Raspberry Pi ZIP")
asset=matches[0]
checksum=next((a for a in assets
               if a.get("name") == asset["name"] + ".sha256"), None)
if checksum is None: raise SystemExit("No SHA-256 asset")
print(release["tag_name"])
print(asset["name"])
print(asset["browser_download_url"])
print(checksum["browser_download_url"])
')" || die "The release needs both a MultiFX Raspberry Pi ZIP and its .sha256 file."

    MULTIFX_TAG="$(printf '%s\n' "${parsed}" | sed -n '1p')"
    MULTIFX_FILE="$(printf '%s\n' "${parsed}" | sed -n '2p')"
    MULTIFX_URL="$(printf '%s\n' "${parsed}" | sed -n '3p')"
    MULTIFX_CHECKSUM_URL="$(printf '%s\n' "${parsed}" | sed -n '4p')"
    [[ "${MULTIFX_FILE}" != */* && "${MULTIFX_FILE}" != *\\* ]] ||
        die "Unsafe release asset name: ${MULTIFX_FILE}"
}

is_multifx_package_root() {
    local directory="$1"
    [ -f "${directory}/react/index.html" ] &&
        [ -f "${directory}/multifx/controller-config.json" ] &&
        [ -f "${directory}/multifx/pipedal_encoder_bridge.py" ] &&
        [ -f "${directory}/install-pipedal-kiosk.sh" ] &&
        { [ -f "${directory}/systemd/system/pipedal-encoder.service" ] ||
          [ -f "${directory}/multifx/systemd/system/pipedal-encoder.service" ]; } &&
        { [ -f "${directory}/systemd/system/pipedal-ydotoold.service" ] ||
          [ -f "${directory}/multifx/systemd/system/pipedal-ydotoold.service" ]; }
}

find_multifx_package_root() {
    local search_dir="$1" index_file candidate
    if is_multifx_package_root "${search_dir}"; then
        PACKAGE_ROOT="${search_dir}"
        return 0
    fi
    while IFS= read -r index_file; do
        candidate="$(dirname -- "$(dirname -- "${index_file}")")"
        if is_multifx_package_root "${candidate}"; then
            PACKAGE_ROOT="${candidate}"
            return 0
        fi
    done < <(find "${search_dir}" -maxdepth 4 -type f \
        -path '*/react/index.html' -print)
    die "No valid PiPedal MultiFX package was found under ${search_dir}."
}

backup_file_once() {
    local source="$1" name="$2"
    local present="${INSTALLER_STATE_DIR}/${name}.was-present"
    local absent="${INSTALLER_STATE_DIR}/${name}.was-absent"
    local backup="${INSTALLER_STATE_DIR}/${name}.backup"
    [ -e "${present}" ] || [ -e "${absent}" ] || {
        if [ -e "${source}" ]; then
            cp -a "${source}" "${backup}"
            touch "${present}"
        else
            touch "${absent}"
        fi
    }
}

restore_file_backup() {
    local target="$1" name="$2"
    local present="${INSTALLER_STATE_DIR}/${name}.was-present"
    local backup="${INSTALLER_STATE_DIR}/${name}.backup"
    if [ -e "${present}" ] && [ -e "${backup}" ]; then
        rm -f -- "${target}"
        cp -a "${backup}" "${target}"
    else
        rm -f -- "${target}"
    fi
}

backup_service_once() {
    local service="$1"
    local present="${INSTALLER_STATE_DIR}/${service}.was-present"
    local absent="${INSTALLER_STATE_DIR}/${service}.was-absent"
    local legacy="${MFX_STATE_DIR}/service-backups/${service}"
    [ -e "${present}" ] || [ -e "${absent}" ] || {
        if [ -f "${legacy}" ]; then
            cp -a "${legacy}" "${INSTALLER_STATE_DIR}/${service}.backup"
            touch "${present}"
        elif is_multifx_installed; then
            # An older MultiFX installer created the currently installed unit
            # and left no pre-MultiFX unit to restore.
            touch "${absent}"
        else
            backup_file_once "${SERVICE_DIR}/${service}" "${service}"
        fi
    }
}

install_multifx_payload() {
    local package_root="$1" release_label="$2" service source_file
    [ -d /etc/pipedal ] ||
        die "PiPedal is not installed. Use menu option 1 or 5 first."
    [ -d "${REACT_DIR}" ] || die "PiPedal frontend is missing: ${REACT_DIR}"
    is_multifx_package_root "${package_root}" ||
        die "Invalid MultiFX package: ${package_root}"

    apt_update_once
    apt-get install -y --no-install-recommends \
        ydotool python3-mido python3-rtmidi
    mkdir -p "${MFX_STATE_DIR}" "${MFX_LIB_DIR}" "${INSTALLER_STATE_DIR}"
    ensure_stock_frontend_backup

    backup_file_once "${CONTROLLER_CONFIG}" controller-config
    for service in pipedal-encoder.service pipedal-ydotoold.service; do
        backup_service_once "${service}"
    done

    echo "Installing PiPedal MultiFX ${release_label}..."
    systemctl stop pipedal-encoder.service 2>/dev/null || true
    replace_directory_contents "${package_root}/react" "${REACT_DIR}"

    if [ ! -f "${CONTROLLER_CONFIG}" ]; then
        install -m 0644 "${package_root}/multifx/controller-config.json" \
            "${CONTROLLER_CONFIG}"
    fi
    ln -sfn "${CONTROLLER_CONFIG}" "${REACT_DIR}/controller-config.json"
    install -m 0755 "${package_root}/multifx/pipedal_encoder_bridge.py" \
        "${MFX_LIB_DIR}/pipedal_encoder_bridge.py"

    for service in pipedal-ydotoold.service pipedal-encoder.service; do
        source_file="${package_root}/systemd/system/${service}"
        [ -f "${source_file}" ] ||
            source_file="${package_root}/multifx/systemd/system/${service}"
        [ -f "${source_file}" ] || die "Package is missing ${service}."
        install -m 0644 "${source_file}" "${SERVICE_DIR}/${service}"
    done

    printf '%s\n' "${release_label}" > "${INSTALLER_STATE_DIR}/installed-release"
    install_self "${package_root}/install-pipedal-kiosk.sh"
    systemctl daemon-reload
    systemctl enable pipedal-ydotoold.service pipedal-encoder.service
    systemctl restart pipedal-ydotoold.service
    systemctl restart pipedal-encoder.service
    systemctl restart pipedald 2>/dev/null || true
    systemctl is-active --quiet pipedal-encoder.service ||
        die "MultiFX installed, but pipedal-encoder.service did not start."
    refresh_browser
    echo "PiPedal MultiFX ${release_label} installation is complete."
}

install_multifx_from_github() {
    local work_dir archive checksum_file expected actual
    install_download_tools
    load_multifx_release
    make_temp_dir /tmp/pipedal-multifx.XXXXXX
    work_dir="${TEMP_DIR}"
    archive="${work_dir}/${MULTIFX_FILE}"
    checksum_file="${archive}.sha256"
    echo "Downloading ${MULTIFX_TAG}..."
    curl -fL "${MULTIFX_URL}" -o "${archive}"
    curl -fL "${MULTIFX_CHECKSUM_URL}" -o "${checksum_file}"
    expected="$(grep -Eo '[A-Fa-f0-9]{64}' "${checksum_file}" | head -n 1)"
    [ -n "${expected}" ] || die "The release checksum is invalid."
    actual="$(sha256sum "${archive}" | awk '{print $1}')"
    [ "${actual,,}" = "${expected,,}" ] ||
        die "The MultiFX ZIP checksum does not match."
    unzip -tq "${archive}" >/dev/null || die "The downloaded ZIP is invalid."
    if unzip -Z1 "${archive}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
        die "The downloaded ZIP contains an unsafe path."
    fi
    mkdir -p "${work_dir}/package"
    unzip -q "${archive}" -d "${work_dir}/package"
    find_multifx_package_root "${work_dir}/package"
    install_multifx_payload "${PACKAGE_ROOT}" "${MULTIFX_TAG}"
}

install_or_update_multifx() {
    local release_label
    case "${MULTIFX_SOURCE}" in
        local)
            [ -d "${LOCAL_PACKAGE}" ] ||
                die "Local package directory does not exist: ${LOCAL_PACKAGE}"
            find_multifx_package_root "${LOCAL_PACKAGE}"
            release_label="local package"
            if [ -f "${PACKAGE_ROOT}/MULTIFX_RELEASE" ]; then
                IFS= read -r release_label < "${PACKAGE_ROOT}/MULTIFX_RELEASE"
                [[ "${release_label}" =~ ^multifx-v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] ||
                    die "The package contains an invalid MultiFX release version."
            fi
            install_multifx_payload "${PACKAGE_ROOT}" "${release_label}"
            ;;
        auto)
            if is_multifx_package_root "${SCRIPT_DIR}"; then
                release_label="local package"
                if [ -f "${SCRIPT_DIR}/MULTIFX_RELEASE" ]; then
                    IFS= read -r release_label < "${SCRIPT_DIR}/MULTIFX_RELEASE"
                    [[ "${release_label}" =~ ^multifx-v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] ||
                        die "The package contains an invalid MultiFX release version."
                fi
                install_multifx_payload "${SCRIPT_DIR}" "${release_label}"
            else
                MULTIFX_SOURCE="latest-stable"
                install_multifx_from_github
            fi
            ;;
        *) install_multifx_from_github ;;
    esac
}

uninstall_multifx() {
    local service
    if ! is_multifx_installed; then
        echo "PiPedal MultiFX is not installed."
        return 0
    fi
    [ -f "${STOCK_REACT_DIR}/index.html" ] ||
        die "The stock PiPedal frontend backup is missing; nothing was removed."
    confirm "Remove MultiFX and restore the stock PiPedal interface?" || {
        echo "Cancelled."
        return 0
    }

    systemctl disable --now pipedal-encoder.service 2>/dev/null || true
    systemctl disable --now pipedal-ydotoold.service 2>/dev/null || true
    replace_directory_contents "${STOCK_REACT_DIR}" "${REACT_DIR}"
    restore_file_backup "${CONTROLLER_CONFIG}" controller-config
    for service in pipedal-encoder.service pipedal-ydotoold.service; do
        restore_file_backup "${SERVICE_DIR}/${service}" "${service}"
    done
    rm -rf -- "${MFX_LIB_DIR}"
    rm -f -- "${INSTALLER_STATE_DIR}/installed-release"

    systemctl daemon-reload
    for service in pipedal-ydotoold.service pipedal-encoder.service; do
        if [ -f "${INSTALLER_STATE_DIR}/${service}.was-present" ]; then
            systemctl enable "${service}" 2>/dev/null || true
            systemctl restart "${service}" 2>/dev/null || true
        fi
    done
    systemctl restart pipedald 2>/dev/null || true
    refresh_browser
    echo "MultiFX was removed and the stock PiPedal interface was restored."
    echo "Your saved MultiFX layouts, themes and controller state were preserved."
}

get_target_user() {
    if [ -n "${TARGET_USER_OVERRIDE}" ]; then
        TARGET_USER="${TARGET_USER_OVERRIDE}"
    elif [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        TARGET_USER="${SUDO_USER}"
    else
        TARGET_USER="$(awk -F: \
            '$3 >= 1000 && $3 < 65534 {print $1; exit}' /etc/passwd)"
    fi
    [ -n "${TARGET_USER:-}" ] ||
        die "No normal login user was found. Use --user USER."
    id "${TARGET_USER}" >/dev/null 2>&1 ||
        die "The requested user does not exist: ${TARGET_USER}"
    TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
    TARGET_GROUP="$(id -gn "${TARGET_USER}")"
    [ -d "${TARGET_HOME}" ] || die "Home directory is missing for ${TARGET_USER}."
}

backup_display_file_once() {
    local source="$1" name="$2"
    local present="${DISPLAY_STATE_DIR}/${name}.was-present"
    local absent="${DISPLAY_STATE_DIR}/${name}.was-absent"
    [ -e "${present}" ] || [ -e "${absent}" ] || {
        if [ -e "${source}" ]; then
            cp -a "${source}" "${DISPLAY_STATE_DIR}/${name}.backup"
            touch "${present}"
        else
            touch "${absent}"
        fi
    }
}

configure_touchscreen_display() {
    local profile
    get_target_user
    command -v raspi-config >/dev/null 2>&1 ||
        die "Touchscreen setup requires Raspberry Pi OS and raspi-config."
    confirm "Configure this Pi to open PiPedal automatically with the on-screen keyboard?" || {
        echo "Cancelled."
        return 0
    }

    apt_update_once
    apt-get install -y --no-install-recommends labwc chromium squeekboard
    [ -x /usr/bin/chromium ] || die "Chromium was not installed at /usr/bin/chromium."
    mkdir -p "${DISPLAY_STATE_DIR}" /etc/xdg/labwc
    profile="${TARGET_HOME}/.bash_profile"
    backup_display_file_once /etc/xdg/labwc/rc.xml labwc-rc.xml
    backup_display_file_once /etc/xdg/labwc/autostart labwc-autostart
    backup_display_file_once "${profile}" bash-profile

    raspi-config nonint do_boot_behaviour B2
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

    cat > "${profile}" <<'PROFILE'
# PiPedal fullscreen touchscreen session.
if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec labwc
fi
PROFILE
    chown "${TARGET_USER}:${TARGET_GROUP}" "${profile}"
    printf '%s\n' "${TARGET_USER}" > "${DISPLAY_STATE_DIR}/configured-user"
    install_self
    echo "Touchscreen display setup is complete for ${TARGET_USER}."
    echo "Reboot the Raspberry Pi when convenient to start it automatically."
}

show_status() {
    local pipedal_version="not installed" multifx_version="not installed"
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        pipedal_version="$(dpkg-query -W -f='${Version}' pipedal)"
    fi
    if [ -f "${INSTALLER_STATE_DIR}/installed-release" ]; then
        multifx_version="$(cat "${INSTALLER_STATE_DIR}/installed-release")"
    elif is_multifx_installed; then
        multifx_version="installed (version unknown)"
    fi
    echo
    echo "PiPedal:            ${pipedal_version}"
    echo "PiPedal MultiFX:    ${multifx_version}"
    if [ -f "${DISPLAY_STATE_DIR}/configured-user" ]; then
        echo "Touchscreen setup:  enabled for $(cat "${DISPLAY_STATE_DIR}/configured-user")"
    else
        echo "Touchscreen setup:  not configured by this installer"
    fi
    echo
    for service in pipedald pipedal-ydotoold pipedal-encoder; do
        if systemctl list-unit-files "${service}.service" --no-legend 2>/dev/null |
            grep -q "${service}.service"; then
            printf '%-21s %s\n' "${service}.service:" \
                "$(systemctl is-active "${service}.service" 2>/dev/null || true)"
        fi
    done
    if systemctl list-unit-files pipedal-encoder.service --no-legend \
        2>/dev/null | grep -q pipedal-encoder.service; then
        echo
        echo "Recent controller bridge messages:"
        journalctl -u pipedal-encoder.service -n 12 --no-pager || true
    fi
}

run_full_setup() {
    install_or_update_pipedal
    install_or_update_multifx
    configure_touchscreen_display
}

pause_for_menu() {
    [ -t 0 ] || return 0
    echo
    read -r -p "Press Enter to return to the menu..." _
}

show_menu() {
    local choice
    while true; do
        echo
        echo "=================================================="
        echo " PiPedal MultiFX Setup"
        echo "=================================================="
        echo "1) Install or update PiPedal"
        echo "2) Install or update MultiFX"
        echo "3) Remove MultiFX and restore original PiPedal"
        echo "4) Set up touchscreen display"
        echo "5) Complete setup: PiPedal + MultiFX + touchscreen"
        echo "6) Status and diagnostics"
        echo "7) Exit"
        echo "=================================================="
        read -r -p "Choose an option [1-7]: " choice
        case "${choice}" in
            1) install_or_update_pipedal; pause_for_menu ;;
            2) MULTIFX_SOURCE="auto"; install_or_update_multifx; pause_for_menu ;;
            3) uninstall_multifx; pause_for_menu ;;
            4) configure_touchscreen_display; pause_for_menu ;;
            5) MULTIFX_SOURCE="auto"; run_full_setup; pause_for_menu ;;
            6) show_status; pause_for_menu ;;
            7) return 0 ;;
            *) echo "Invalid option." ;;
        esac
    done
}

main() {
    if [ "${INVOKED_AS}" = "uninstall-pipedal-multifx" ]; then
        ACTION="uninstall"
    else
        parse_arguments "$@"
    fi
    require_root
    command -v apt-get >/dev/null 2>&1 ||
        die "This installer requires Raspberry Pi OS, Debian or Ubuntu."
    maybe_full_upgrade
    case "${ACTION}" in
        menu) show_menu ;;
        pipedal) install_or_update_pipedal ;;
        multifx) install_or_update_multifx ;;
        uninstall) uninstall_multifx ;;
        display) configure_touchscreen_display ;;
        all) run_full_setup ;;
        status) show_status ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
