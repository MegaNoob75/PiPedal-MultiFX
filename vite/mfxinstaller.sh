#!/usr/bin/env bash
set -Eeuo pipefail

# PiPedal MultiFX end-user setup utility.
# Increment this version whenever installer behavior changes.
INSTALLER_VERSION="1.12"
#
# Normal use:
#   sudo ./mfxinstaller.sh
#
# Scripted/advanced use:
#   sudo ./mfxinstaller.sh pipedal
#   sudo ./mfxinstaller.sh multifx
#   sudo ./mfxinstaller.sh multifx --tag multifx-v0.4.0
#   sudo ./mfxinstaller.sh multifx --latest-release
#   sudo ./mfxinstaller.sh multifx --local /path/to/extracted/package
#   sudo ./mfxinstaller.sh uninstall
#   sudo ./mfxinstaller.sh display --user pi
#   sudo ./mfxinstaller.sh all

MULTIFX_REPOSITORY="${MULTIFX_REPOSITORY:-MegaNoob75/PiPedal-MultiFX}"
MULTIFX_RELEASES_API="https://api.github.com/repos/${MULTIFX_REPOSITORY}/releases"
PIPEDAL_RELEASES_API="https://api.github.com/repos/rerdavies/pipedal/releases"
INSTALLER_RAW_URL="https://raw.githubusercontent.com/${MULTIFX_REPOSITORY}/main/vite/mfxinstaller.sh"

REACT_DIR="/etc/pipedal/react"
CONTROLLER_CONFIG="/etc/pipedal/controller-config.json"
MFX_LIB_DIR="/usr/local/lib/pipedal-multifx"
MFX_STATE_DIR="/var/lib/pipedal-multifx"
INSTALLER_STATE_DIR="/var/lib/pipedal-multifx-installer"
STOCK_REACT_DIR="${INSTALLER_STATE_DIR}/stock-react"
PIPEDAL_KEY_STATE="${INSTALLER_STATE_DIR}/pipedal-updatekey.asc"
YDOTOOL_BACKPORTS_SOURCE="/etc/apt/sources.list.d/pipedal-multifx-trixie-backports.sources"
DISPLAY_STATE_DIR="/var/lib/pipedal-touchscreen"
SERVICE_DIR="/etc/systemd/system"
SETUP_COMMAND="/usr/local/sbin/pipedal-multifx-setup"
UNINSTALL_COMMAND="/usr/local/sbin/uninstall-pipedal-multifx"
INSTALLER_LOCK_FILE="/run/lock/pipedal-multifx-installer.lock"
OPTIMIZATION_STATE_DIR="${INSTALLER_STATE_DIR}/optimizations"
PERFORMANCE_SERVICE="pipedal-performance.service"
PLYMOUTH_THEME_NAME="pipedal-multifx"
PLYMOUTH_THEME_DIR="/usr/share/plymouth/themes/${PLYMOUTH_THEME_NAME}"
PLYMOUTH_LOGO_URL="https://raw.githubusercontent.com/${MULTIFX_REPOSITORY}/main/docs/PiPedal-logo.png"
PLYMOUTH_MULTIFX_LOGO_URL="https://raw.githubusercontent.com/${MULTIFX_REPOSITORY}/main/docs/Pi-MultiFX-logo.png"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_FILE="${SCRIPT_DIR}/$(basename -- "${BASH_SOURCE[0]}")"
INVOKED_AS="${0##*/}"

ACTION="menu"
PIPEDAL_SOURCE="latest-stable"
PIPEDAL_REQUESTED_TAG=""
MULTIFX_SOURCE="auto"
REQUESTED_TAG=""
LOCAL_PACKAGE=""
TARGET_USER_OVERRIDE=""
RUN_FULL_UPGRADE=0
ASSUME_YES=0
APT_UPDATED=0
REBOOT_NEEDED=0
REBOOT_REASON=""
BROWSER_REFRESH=1
MULTIFX_RESET_FOR_DOWNGRADE=0
MULTIFX_CHANGE_IS_DOWNGRADE=0
MULTIFX_CHRONOLOGY_KNOWN=0
TEMP_DIRS=()
ORIGINAL_ARGUMENTS=("$@")

die() {
    echo "ERROR: $*" >&2
    exit 1
}

cleanup() {
    local directory
    for directory in "${TEMP_DIRS[@]:-}"; do
        case "${directory}" in
            /tmp/pipedal-install.*|/tmp/pipedal-multifx.*|/tmp/pipedal-transaction.*|/tmp/pipedal-backup.*)
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

acquire_installer_lock() {
    command -v flock >/dev/null 2>&1 ||
        die "This installer requires flock from the util-linux package."
    exec 9>"${INSTALLER_LOCK_FILE}"
    flock -n 9 ||
        die "Another PiPedal MultiFX setup session is already running."
}

usage() {
    cat <<'USAGE'
PiPedal MultiFX setup

Usage:
  sudo ./mfxinstaller.sh [action] [options]

Actions:
  menu        Interactive menu (default)
  pipedal     Install, upgrade or downgrade PiPedal
  multifx     Install, upgrade or downgrade PiPedal MultiFX
  backup      Back up PiPedal, MultiFX, presets, models and LV2 files
  restore     Restore a backup selected from ~/mfxbackups
  uninstall   Completely remove MultiFX and restore stock PiPedal
  uninstall-pipedal  Completely remove PiPedal and MultiFX
  display     Configure the fullscreen touchscreen display
  optimize    Configure or restore Raspberry Pi performance optimizations
  all         Install/update PiPedal, MultiFX and the touchscreen display
  status      Show installed versions and service diagnostics

Advanced options:
  --pipedal-tag TAG  Install a specific published PiPedal release
  --tag TAG          Install a specific published MultiFX release
  --latest-release   Include MultiFX prereleases when choosing the newest release
  --local DIRECTORY  Install an extracted MultiFX Raspberry Pi package
  --user USER        Use this normal account for touchscreen auto-login
  --full-upgrade     Run apt-get full-upgrade before the requested action
  --no-browser-refresh
                     Let the calling interface handle its own refresh
  -y, --yes          Accept confirmation prompts
  -h, --help         Show this help

The interactive menu lists published versions with the newest stable release
selected by default and marked Latest. Arrow keys, Enter and item numbers work.
USAGE
}

parse_arguments() {
    if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then
        ACTION="$1"
        shift
    fi

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --pipedal-tag)
                [ "$#" -ge 2 ] || die "--pipedal-tag requires a release tag."
                PIPEDAL_SOURCE="tag"
                PIPEDAL_REQUESTED_TAG="$2"
                shift 2
                ;;
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
            --no-browser-refresh)
                BROWSER_REFRESH=0
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
        menu|pipedal|multifx|backup|restore|uninstall|uninstall-pipedal|display|optimize|all|status) ;;
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

confirm_default_yes() {
    local prompt="$1" answer
    [ "${ASSUME_YES}" -eq 0 ] || return 0
    [ -t 0 ] || die "A confirmation is required; rerun with --yes."
    read -r -p "${prompt} [Y/n]: " answer
    case "${answer}" in
        ''|y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

draw_banner() {
    printf '\033[2J\033[H\033[38;5;45m'
    cat <<'BANNER'
+----------------------------------------------------------------+
|  __  __ _____ __  __                                           |
| |  \/  |  ___|\ \/ /      PiPedal MultiFX Setup                |
| | |\/| | |_    \  /       install - protect - perform          |
| | |  | |  _|   /  \                                            |
| |_|  |_|_|    /_/\_\                                           |
+----------------------------------------------------------------+
BANNER
    printf '\033[0m  Installer v%s\n' "${INSTALLER_VERSION}"
}

# Display a scrollable terminal menu. Arrow keys move the highlight, Enter
# accepts it, and users may edit an item number before pressing Enter.
select_menu() {
    local title="$1"
    local default_selected="$2"
    shift 2
    local -a options=("$@")
    local selected="${default_selected}" first=0 key rest digits="" number rows count
    count="${#options[@]}"
    [ "${count}" -gt 0 ] || return 1
    [[ "${selected}" =~ ^[0-9]+$ ]] || selected=0
    [ "${selected}" -lt "${count}" ] || selected=0

    if [ ! -t 0 ] || [ ! -t 1 ]; then
        echo "${title}"
        for ((number=0; number<count; number++)); do
            printf '%2d) %s\n' "$((number + 1))" "${options[number]}"
        done
        read -r -p "Choose [1-${count}]: " number
        [[ "${number}" =~ ^[0-9]+$ ]] &&
            [ "${number}" -ge 1 ] && [ "${number}" -le "${count}" ] || return 1
        MENU_RESULT="$((number - 1))"
        return 0
    fi

    rows="$(tput lines 2>/dev/null || echo 24)"
    rows="$((rows - 13))"
    [ "${rows}" -ge 5 ] || rows=5
    [ "${rows}" -le 16 ] || rows=16

    while true; do
        [ "${selected}" -ge "${first}" ] || first="${selected}"
        [ "${selected}" -lt $((first + rows)) ] || first="$((selected - rows + 1))"
        draw_banner
        printf '\n  %s\n' "${title}"
        printf '  Use Up/Down + Enter, or type an item number.\n\n'
        for ((number=first; number<count && number<first+rows; number++)); do
            if [ "${number}" -eq "${selected}" ]; then
                printf '\033[7m  > %2d) %-54s\033[0m\n' "$((number + 1))" "${options[number]}"
            else
                printf '    %2d) %s\n' "$((number + 1))" "${options[number]}"
            fi
        done
        if [ "${count}" -gt "${rows}" ]; then
            printf '\n  Showing %d-%d of %d\n' "$((first + 1))" \
                "$(( first + rows < count ? first + rows : count ))" "${count}"
        fi
        [ -z "${digits}" ] || printf '  Number: %s\n' "${digits}"

        IFS= read -rsn1 key
        case "${key}" in
            $'\033')
                IFS= read -rsn2 -t 0.1 rest || rest=""
                case "${rest}" in
                    '[A') selected="$(( (selected - 1 + count) % count ))"; digits="" ;;
                    '[B') selected="$(( (selected + 1) % count ))"; digits="" ;;
                esac
                ;;
            '')
                if [ -n "${digits}" ]; then
                    number="$((10#${digits}))"
                    if [ "${number}" -ge 1 ] && [ "${number}" -le "${count}" ]; then
                        MENU_RESULT="$((number - 1))"
                        return 0
                    fi
                    digits=""
                else
                    MENU_RESULT="${selected}"
                    return 0
                fi
                ;;
            [0-9])
                digits="${digits}${key}"
                number="$((10#${digits}))"
                if [ "${number}" -ge 1 ] && [ "${number}" -le "${count}" ]; then
                    selected="$((number - 1))"
                fi
                ;;
            $'\177'|$'\b') digits="${digits%?}" ;;
            q|Q) return 1 ;;
        esac
    done
}

mark_reboot_needed() {
    REBOOT_NEEDED=1
    REBOOT_REASON="$1"
}

offer_reboot_if_needed() {
    [ "${REBOOT_NEEDED}" -eq 1 ] || return 0
    echo
    echo "A reboot is recommended: ${REBOOT_REASON}"
    if confirm "Reboot now?"; then
        systemctl reboot
    else
        echo "Reboot skipped. You can reboot later with: sudo reboot"
    fi
    REBOOT_NEEDED=0
    REBOOT_REASON=""
}

apt_update_once() {
    if [ "${APT_UPDATED}" -eq 0 ]; then
        apt-get update
        APT_UPDATED=1
    fi
}

package_is_installed() {
    dpkg-query -W -f='${Status}' "$1" 2>/dev/null |
        grep -q 'install ok installed'
}

record_dependency_state_once() {
    local package="$1"
    local installed="${INSTALLER_STATE_DIR}/dependency-${package}.was-installed"
    local absent="${INSTALLER_STATE_DIR}/dependency-${package}.was-absent"
    [ -e "${installed}" ] || [ -e "${absent}" ] || {
        if package_is_installed "${package}"; then
            touch "${installed}"
        else
            touch "${absent}"
        fi
    }
}

ydotool_has_candidate() {
    local candidate
    candidate="$(apt-cache policy ydotool 2>/dev/null |
        sed -n 's/^  Candidate: //p' | head -n1)"
    [ -n "${candidate}" ] && [ "${candidate}" != "(none)" ]
}

ensure_ydotool_available() {
    local codename="" source_created=0
    ydotool_has_candidate && return 0

    if [ -r /etc/os-release ]; then
        # VERSION_CODENAME is distribution-provided data, not executable input.
        codename="$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release |
            tr -d '\"' | head -n1)"
    fi
    if [ "${codename}" != "trixie" ]; then
        die "ydotool is unavailable from the configured package repositories. Enable a repository that supplies ydotool, then run the installer again."
    fi
    [ -r /usr/share/keyrings/debian-archive-keyring.gpg ] ||
        die "The Debian archive keyring is missing; cannot securely enable trixie-backports."

    echo
    echo "ydotool is not included in Debian 13's standard repository."
    echo "It is available from the official Debian trixie-backports repository."
    echo "Enabling official Debian trixie-backports automatically."

    if [ ! -e "${YDOTOOL_BACKPORTS_SOURCE}" ]; then
        cat > "${YDOTOOL_BACKPORTS_SOURCE}" <<'BACKPORTS_SOURCE'
Types: deb
URIs: https://deb.debian.org/debian
Suites: trixie-backports
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
BACKPORTS_SOURCE
        chmod 0644 "${YDOTOOL_BACKPORTS_SOURCE}"
        touch "${INSTALLER_STATE_DIR}/ydotool-backports-source.created-by-installer"
        source_created=1
    fi

    APT_UPDATED=0
    if ! apt_update_once || ! ydotool_has_candidate; then
        if [ "${source_created}" -eq 1 ]; then
            rm -f -- "${YDOTOOL_BACKPORTS_SOURCE}"
            rm -f -- "${INSTALLER_STATE_DIR}/ydotool-backports-source.created-by-installer"
        fi
        die "trixie-backports was configured, but no installable ydotool package was found."
    fi
    echo "Official Debian trixie-backports is now enabled for ydotool."
}

install_multifx_dependencies() {
    local package
    mkdir -p "${INSTALLER_STATE_DIR}"
    apt_update_once
    ensure_ydotool_available
    for package in ydotool python3-mido python3-rtmidi; do
        record_dependency_state_once "${package}"
    done
    apt-get install -y --no-install-recommends \
        ydotool python3-mido python3-rtmidi
}

remove_multifx_dependencies() {
    local package
    local -a remove_packages=()
    for package in ydotool python3-mido python3-rtmidi; do
        if [ -f "${INSTALLER_STATE_DIR}/dependency-${package}.was-absent" ] &&
            package_is_installed "${package}"; then
            remove_packages+=("${package}")
        fi
    done
    if [ "${#remove_packages[@]}" -gt 0 ]; then
        echo "Removing packages installed only for MultiFX..."
        apt-get purge -y "${remove_packages[@]}"
    fi
    if [ -f "${INSTALLER_STATE_DIR}/ydotool-backports-source.created-by-installer" ]; then
        rm -f -- "${YDOTOOL_BACKPORTS_SOURCE}"
        echo "Removed the trixie-backports source added by MultiFX."
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
    [ ! -f /var/run/reboot-required ] ||
        mark_reboot_needed "the operating-system upgrade requested a reboot"
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

installer_version_from_file() {
    local file="$1" version
    [ -f "${file}" ] || return 1
    version="$(sed -n 's/^INSTALLER_VERSION="\([0-9][0-9.]*\)"$/\1/p' \
        "${file}" | head -n 1)"
    [[ "${version}" =~ ^[0-9]+([.][0-9]+)*$ ]] || return 1
    printf '%s\n' "${version}"
}

refresh_installer_before_action() {
    local latest current_version latest_version needs_restart=0 refresh_url
    local -a restart_arguments=("${ORIGINAL_ARGUMENTS[@]}")

    [ "${MFX_INSTALLER_REFRESHED:-0}" != "1" ] || return 0
    make_temp_dir "/tmp/pipedal-installer-refresh.XXXXXX"
    latest="${TEMP_DIR}/mfxinstaller.sh"
    refresh_url="${INSTALLER_RAW_URL}?refresh=$(date +%s)"

    echo "Checking for the newest PiPedal MultiFX installer..."
    if command -v curl >/dev/null 2>&1; then
        curl -fL --connect-timeout 10 --max-time 45 \
            --retry 3 --retry-delay 2 \
            -H 'Cache-Control: no-cache' -H 'Pragma: no-cache' \
            "${refresh_url}" -o "${latest}" ||
            die "Could not download the newest installer. Check the internet connection and try again."
    elif command -v wget >/dev/null 2>&1; then
        wget -q --timeout=45 \
            --header='Cache-Control: no-cache' --header='Pragma: no-cache' \
            -O "${latest}" "${refresh_url}" ||
            die "Could not download the newest installer. Check the internet connection and try again."
    else
        die "curl or wget is required to refresh the installer before use."
    fi

    bash -n "${latest}" || die "The downloaded installer failed its syntax check."
    latest_version="$(installer_version_from_file "${latest}")" ||
        die "The downloaded installer has no valid version number."
    current_version="$(installer_version_from_file "${SCRIPT_FILE}")" ||
        current_version="0"
    if dpkg --compare-versions "${current_version}" gt "${latest_version}"; then
        die "The downloaded installer v${latest_version} is older than the running v${current_version}. Refusing to downgrade the setup tool."
    fi

    cmp -s "${SCRIPT_FILE}" "${latest}" || needs_restart=1
    install_self "${latest}"
    install_home_copy "${latest}"
    if [ "${needs_restart}" -eq 0 ]; then
        echo "Installer v${latest_version} is current."
        return 0
    fi

    echo "Installer updated to v${latest_version}; continuing with the new version."
    if [ "${INVOKED_AS}" = "uninstall-pipedal-multifx" ]; then
        restart_arguments=(uninstall "${ORIGINAL_ARGUMENTS[@]}")
    fi
    rm -rf -- "${TEMP_DIR}"
    exec env MFX_INSTALLER_REFRESHED=1 \
        "${SETUP_COMMAND}" "${restart_arguments[@]}"
}

newest_installer_source() {
    local running="$1" packaged="$2"
    local running_version="0" packaged_version="0"

    running_version="$(installer_version_from_file "${running}")" ||
        running_version="0"
    packaged_version="$(installer_version_from_file "${packaged}")" ||
        packaged_version="0"

    if dpkg --compare-versions "${packaged_version}" gt "${running_version}"; then
        echo "Using newer packaged installer v${packaged_version}." >&2
        printf '%s\n' "${packaged}"
    else
        echo "Keeping installer v${running_version}; packaged installer is v${packaged_version}." >&2
        printf '%s\n' "${running}"
    fi
}

install_home_copy() {
    local source="${1:-${SCRIPT_FILE}}" destination
    [ -f "${source}" ] || return 0
    get_target_user
    destination="${TARGET_HOME}/mfxinstaller.sh"

    if [ "${source}" -ef "${destination}" ] 2>/dev/null; then
        chown "${TARGET_USER}:${TARGET_GROUP}" "${destination}"
        chmod 0755 "${destination}"
    else
        install -o "${TARGET_USER}" -g "${TARGET_GROUP}" -m 0755 \
            "${source}" "${destination}"
    fi
    echo "Home installer updated: ${destination}"
}

refresh_browser() {
    local attempt

    if ! command -v ydotool >/dev/null 2>&1; then
        echo "WARNING: The touchscreen was not refreshed because ydotool is unavailable."
        return 0
    fi

    for attempt in 1 2 3 4 5; do
        if [ -S /tmp/.ydotool_socket ]; then
            sleep 2
            if YDOTOOL_SOCKET=/tmp/.ydotool_socket \
                ydotool key 29:1 19:1 19:0 29:0; then
                echo "PiPedal touchscreen refreshed."
                return 0
            fi
        fi
        sleep 1
    done

    echo "WARNING: MultiFX was updated, but the touchscreen refresh could not be sent."
    echo "Refresh the PiPedal page manually or restart the touchscreen."
    return 0
}

wait_for_service_active() {
    local service="$1" attempt
    for attempt in $(seq 1 20); do
        systemctl is-active --quiet "${service}" && return 0
        sleep 1
    done
    systemctl status "${service}" --no-pager 2>/dev/null || true
    journalctl -u "${service}" -n 20 --no-pager 2>/dev/null || true
    die "${service} did not become active after installation."
}

pipedal_local_url() {
    local exec_line port_spec host port
    exec_line="$(systemctl cat pipedald.service 2>/dev/null |
        sed -n 's/^ExecStart=//p' | tail -n 1)"
    port_spec="$(printf '%s\n' "${exec_line}" | awk '
        { for (i=1; i<=NF; i++) if ($i == "-port" && i < NF) print $(i+1) }
    ' | tail -n 1)"
    port_spec="${port_spec:-80}"

    if [[ "${port_spec}" == *:* ]]; then
        host="${port_spec%:*}"
        port="${port_spec##*:}"
        case "${host}" in
            0.0.0.0|\*) host="127.0.0.1" ;;
        esac
    else
        host="127.0.0.1"
        port="${port_spec}"
    fi
    [[ "${port}" =~ ^[0-9]+$ ]] || return 1
    printf 'http://%s:%s/var/config.json\n' "${host}" "${port}"
}

wait_for_pipedal_web() {
    local url attempt
    url="$(pipedal_local_url)" || {
        echo "WARNING: Could not determine PiPedal's local web address."
        return 0
    }
    for attempt in $(seq 1 15); do
        if curl -fsS --max-time 2 "${url}" -o /dev/null; then
            echo "PiPedal web interface is ready."
            return 0
        fi
        sleep 1
    done
    die "PiPedal is active, but its web interface did not become ready at ${url}."
}

# Debian's ydotool package enables ydotool.service globally as a per-user
# service. MultiFX deliberately runs one system daemon instead, because the
# root controller bridge needs a predictable socket before a desktop user logs
# in. Running both daemons makes them compete for /tmp/.ydotool_socket.
stop_ydotool_user_service_for_user() {
    local user="$1" uid runtime_dir
    [ -n "${user}" ] && id "${user}" >/dev/null 2>&1 || return 0
    uid="$(id -u "${user}")"
    runtime_dir="/run/user/${uid}"
    [ -S "${runtime_dir}/bus" ] || return 0
    runuser -u "${user}" -- env \
        XDG_RUNTIME_DIR="${runtime_dir}" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/bus" \
        systemctl --user daemon-reload 2>/dev/null || true
    runuser -u "${user}" -- env \
        XDG_RUNTIME_DIR="${runtime_dir}" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/bus" \
        systemctl --user stop ydotool.service 2>/dev/null || true
}

resolve_ydotool_service_conflict() {
    local global_state target_user=""
    global_state="$(systemctl --global is-enabled ydotool.service 2>/dev/null || true)"
    [ "${global_state}" = "enabled" ] || [ "${global_state}" = "enabled-runtime" ] ||
        return 0

    echo
    echo "A conflicting Debian ydotool user service is globally enabled."
    echo "MultiFX uses pipedal-ydotoold.service so its root controller bridge"
    echo "has one reliable daemon and one predictable socket."
    echo "Temporarily masking the conflicting user service."

    mkdir -p "${INSTALLER_STATE_DIR}"
    touch "${INSTALLER_STATE_DIR}/ydotool-user-service.masked-by-installer"
    systemctl --global mask ydotool.service
    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        target_user="${SUDO_USER}"
    elif [ -n "${TARGET_USER_OVERRIDE}" ]; then
        target_user="${TARGET_USER_OVERRIDE}"
    fi
    stop_ydotool_user_service_for_user "${target_user}"
    echo "The conflicting user service was stopped and reversibly masked."
}

restore_ydotool_user_service_policy() {
    [ -f "${INSTALLER_STATE_DIR}/ydotool-user-service.masked-by-installer" ] ||
        return 0
    systemctl --global unmask ydotool.service 2>/dev/null || true
    echo "Restored the Debian ydotool user-service policy."
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
    install_embedded_pipedal_key
    PIPEDAL_KEY_FILE="${PIPEDAL_KEY_STATE}"
}

install_embedded_pipedal_key() {
    mkdir -p "${INSTALLER_STATE_DIR}"
    cat > "${PIPEDAL_KEY_STATE}" <<'PIPEDAL_PUBLIC_KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQGNBGba2LoBDADJvrrSCZwY75NgAJPDr1mXna/AZHVKg0LgAjfF196CqeYiLoti
vxmBb7urlYYgHvwwzbqcspazPvsw5NsOxCce1AYwbIxRPvE2JhwLu99CTZZswpaD
Zi7ED6yKUAlSmO5U3A6Isu+5jtFUjnHvMGVgaS2LEuEg3jjpkX15kpOAHkR1dk6X
6t9HXXNeQnmSBiwuTXNebFLlz/yt01RfAcoDeCKOjNDVJYKYIFn7LWSC7UPDCoaa
BMBYlIHxJBAeegzPfQB9IG5zzMB15q09ngRTBn65YXEy/1IFTfjC3rj6fGqbJ+fU
44xDM9Lz8fwlQszmAB1PprpJp6cWvylrS9xlRJiZnS+fF5k90GKLe1SUnk0TNpr+
p/H2RMXZaQDBx2s7ianAQvvgodJ7k0F6wMo6A58+na6hxyES7pgTBf98F6vlkreM
tsM2MLX9uLv9YQVExit6ZANxsqgu+rxBmsZQfiJqAg0OPErV2za4D+vCImznzgS0
nq7ojFs3W2H3uncAEQEAAbQlUGlQZWRhbCBQcm9qZWN0IDxyZXJkYXZpZXNAZ21h
aWwuY29tPokBzgQTAQoAOBYhBC0fOdux+BlBK2ePiOnXCB4I49hcBQJm2ti6AhsD
BQsJCAcCBhUKCQgLAgQWAgMBAh4BAheAAAoJEOnXCB4I49hc470L/2XX37z0N9TS
cqFnhy/BtMmhOsx+7eL9Gdt8YmQ3TXo5UUG5JTy0v7UEzzPq5ifF4VOFx3RWbU+m
ScrWKY7VQfVuz+GTJf5tZIAf8ZjsK8mYbAD7Q/rL/8bopvGzA63xUUIomAaNmgnC
R1F+wHENwHpGF+eWTU1Jy3CoFefYRMpzSvEq2Up9kaYbcKLqa4zWBT84b2T42DDV
b4FaiwnUAYfltUq35eewsBaNxioCIV7ZMC776ZnqO8A4uomhse081AyKhA53uYD9
xCUfwFvJ3FniMAFbK47fOo8QgfC4V1Pn6mvND2ZyNhus+k4vWsY/8yK7ABRgYbaa
Wc8ydENk0k7FII7kquupjqTdbXQ5LIh74lSUH3tHZVCVUyHOXg5cLl+6Q8980AhM
GlxEbBggDUcRv9GM/Vww2fLnFPVBp2pXL+BVcfdfCuAvqmWTAvoE7z84wlRLpf00
KW7QUNJm4hT6Pe1soRzjeqFIC6/70FwJfHDAAhQZMX9zdv2gAN6B4LkBjQRm2ti6
AQwAugaLtCSk6cF+Qtfrfl1boNp09GGHlgtnj6BKDPFi+GnBHDcXq+ahff6nBUrN
bbF/K3eRPWtss0ffdhzW29n+FZu5LIb4iHMi3sZbQPhHrZOUgQysACiqD7Ctu2Ar
aYUaPc7FUrm+LTo+MSrLO8oZ0kcXm0HDRd7H8/rMcuqW8hjx5eJ/ng8ROkNch4Kk
KwQYNILLIRwyvOYQIk5iJFvno6bIAOc5VzjFMfDLXf1H2iFegTAz0albSHgQUtd9
jEhf91RhsUmYnlDDViPnAMlFlo/OQRM+CEdeH6F3J3JfGSS6vEy7VzHFt9+ed2UZ
35t8MNa6VIzw/KiXOy4A7l01SV7mGT++0K3FeQXq8EMI7nwgByARyvwmTNbxgG8P
XFJDAfZIDUsyy2uiwMrTBogR9DF5vqoocCQLdAP95kvorIkFAQugOQ86zGw/mhOz
PIb5pBDxW/D8G0r5kKvtZvz1EiygAJFG2Qp/CvfQJNqVCmamr668s6mYEP4JSGK+
L/YzABEBAAGJAbYEGAEKACAWIQQtHznbsfgZQStnj4jp1wgeCOPYXAUCZtrYugIb
DAAKCRDp1wgeCOPYXLF+C/0RBP7F5SGQlXtE15ups1R85vuWHVPFLHl8I7riEui5
WmHdm4t7j/2yDV1+PbSec8gjPgyfGeshEp/WXfnZLX8LnvrNa/vYn4B2MbTPNfrq
XICVCHUxUfcJ1HcmrC3GtDq7ijrqy5bqvQJwgpH9AkJeYkv9LTKC8yaRU3ZBkrbP
n91QHLW4e4AS7VeC1yrb18HQXLk+3oyhRZO67+OL9r0SLg4u1qGP4FRlLAAxDQvH
hGfpvrN63ZOfjPg/0tGw7Vrl5KiW+nroSNeuE0cwwf6Z5cbitO6yyIw3ynE3B0xj
FXD7fGOJBhWJt9WZfhs51Gl5GdGFcEdDyALHz5NvCFk0QnjxZWZlR4u9qimyn4fX
mDHBVPgW4NshlROVpAl45wsKH9E2OA3adgbM9hVMN8oB9gxla4TR0rlmAZm9GF/b
Bt7N5pG5w98tGpObq/NUgGr7TshpcM1mfoYN45YmBPnNAIV29JlnHeTsgGHWluZs
DIJTINP5eg6wly2M9P1A3RY=
=T0QC
-----END PGP PUBLIC KEY BLOCK-----
PIPEDAL_PUBLIC_KEY
    chmod 0644 "${PIPEDAL_KEY_STATE}"
}

parse_pipedal_release() {
    local release_json="$1" parsed architecture
    architecture="$(dpkg --print-architecture)"
    case "${architecture}" in
        arm64|amd64) ;;
        *) die "Official PiPedal packages are not expected for '${architecture}'." ;;
    esac

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

load_requested_pipedal_release() {
    local release_json encoded
    echo "Checking the official PiPedal GitHub releases..."
    case "${PIPEDAL_SOURCE}" in
        tag)
            encoded="$(urlencode "${PIPEDAL_REQUESTED_TAG}")"
            release_json="$(github_api \
                "${PIPEDAL_RELEASES_API}/tags/${encoded}")" ||
                die "No published PiPedal release exists for '${PIPEDAL_REQUESTED_TAG}'."
            ;;
        latest-stable)
            release_json="$(github_api "${PIPEDAL_RELEASES_API}/latest")" ||
                die "Could not read the latest official PiPedal release."
            ;;
        selected)
            return 0
            ;;
        *) die "Internal PiPedal source error: ${PIPEDAL_SOURCE}" ;;
    esac
    parse_pipedal_release "${release_json}"
}

# Build a version list from published releases which actually contain a Debian
# package for this machine. The official latest stable release is moved to the
# top and selected by default; prereleases remain available for explicit use.
select_pipedal_version() {
    local latest_json releases_json latest_tag parsed line index=0
    local architecture
    local -a labels=()
    PIPEDAL_CHOICE_TAGS=()
    PIPEDAL_CHOICE_FILES=()
    PIPEDAL_CHOICE_URLS=()
    PIPEDAL_CHOICE_SIGNATURES=()
    install_download_tools
    architecture="$(dpkg --print-architecture)"
    echo "Loading PiPedal versions..."
    latest_json="$(github_api "${PIPEDAL_RELEASES_API}/latest")" ||
        die "Could not read the latest PiPedal release."
    latest_tag="$(printf '%s' "${latest_json}" | python3 -c \
        'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
    releases_json="$(github_api "${PIPEDAL_RELEASES_API}?per_page=100")" ||
        die "Could not read the PiPedal release list."
    parsed="$(printf '%s' "${releases_json}" | python3 -c '
import json,sys
releases=json.load(sys.stdin)
arch=sys.argv[1]
latest=sys.argv[2]
rows=[]
for release in releases:
    if release.get("draft"): continue
    suffix=f"_{arch}.deb"
    deb=next((a for a in release.get("assets", [])
              if a.get("name", "").startswith("pipedal_")
              and a.get("name", "").endswith(suffix)), None)
    if not deb: continue
    sig=next((a for a in release.get("assets", [])
              if a.get("name") == deb["name"] + ".asc"), None)
    tag=release["tag_name"]
    label=tag
    if tag == latest: label += "  [Latest]"
    elif release.get("prerelease"): label += "  [Prerelease]"
    rows.append((0 if tag == latest else 1, label, tag, deb["name"],
                 deb["browser_download_url"],
                 sig["browser_download_url"] if sig else ""))
for row in sorted(enumerate(rows), key=lambda x: (x[1][0], x[0])):
    print("\t".join(row[1][1:]))
' "${architecture}" "${latest_tag}")" || die "PiPedal release metadata is invalid."

    while IFS=$'\t' read -r label tag file url signature; do
        [ -n "${tag}" ] || continue
        labels+=("${label}")
        PIPEDAL_CHOICE_TAGS+=("${tag}")
        PIPEDAL_CHOICE_FILES+=("${file}")
        PIPEDAL_CHOICE_URLS+=("${url}")
        PIPEDAL_CHOICE_SIGNATURES+=("${signature}")
        index="$((index + 1))"
    done <<< "${parsed}"
    [ "${index}" -gt 0 ] || die "No compatible PiPedal packages were found."
    select_menu "Select PiPedal version" 0 "${labels[@]}" || return 1
    index="${MENU_RESULT}"
    PIPEDAL_TAG="${PIPEDAL_CHOICE_TAGS[index]}"
    PIPEDAL_FILE="${PIPEDAL_CHOICE_FILES[index]}"
    PIPEDAL_URL="${PIPEDAL_CHOICE_URLS[index]}"
    PIPEDAL_SIGNATURE_URL="${PIPEDAL_CHOICE_SIGNATURES[index]}"
    PIPEDAL_VERSION="${PIPEDAL_TAG#v}"
    PIPEDAL_SOURCE="selected"
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
    load_requested_pipedal_release
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        installed_version="$(dpkg-query -W -f='${Version}' pipedal)"
        echo "Installed PiPedal: ${installed_version}"
        echo "Selected PiPedal:  ${PIPEDAL_VERSION}"
        if dpkg --compare-versions "${installed_version}" eq \
            "${PIPEDAL_VERSION}"; then
            echo "That PiPedal version is already installed."
            install_self
            install_home_copy
            return 0
        fi
        confirm "Change PiPedal from ${installed_version} to ${PIPEDAL_VERSION}?" || {
            echo "Cancelled."
            return 0
        }
        if dpkg --compare-versions "${installed_version}" gt "${PIPEDAL_VERSION}" &&
            confirm_default_yes "Create a safety backup before downgrading PiPedal?"; then
            create_backup
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
    if ! apt-get install -y --allow-downgrades "${package}"; then
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
    install_home_copy
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

# List only MultiFX releases that have both the Raspberry Pi ZIP and its
# checksum. Releases without permanent package assets cannot be installed
# safely and are omitted until their assets are backfilled.
select_multifx_version() {
    local latest_json releases_json latest_tag parsed label tag published index=0
    local installed_release="" installed_published="" selected_published=""
    local -a labels=()
    MULTIFX_CHOICE_TAGS=()
    MULTIFX_CHOICE_PUBLISHED=()
    install_download_tools
    echo "Loading MultiFX versions..."
    latest_json="$(github_api "${MULTIFX_RELEASES_API}/latest")" ||
        die "No stable MultiFX release is published yet."
    latest_tag="$(printf '%s' "${latest_json}" | python3 -c \
        'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
    releases_json="$(github_api "${MULTIFX_RELEASES_API}?per_page=100")" ||
        die "Could not read the MultiFX release list."
    parsed="$(printf '%s' "${releases_json}" | python3 -c '
import json,sys
releases=json.load(sys.stdin)
latest=sys.argv[1]
rows=[]
for release in releases:
    if release.get("draft"): continue
    assets=release.get("assets", [])
    zips=[a for a in assets if a.get("name", "").lower().endswith(".zip")
          and "multifx" in a.get("name", "").lower()
          and "raspberrypi" in a.get("name", "").lower()]
    if not zips: continue
    package=zips[0]
    checksum=next((a for a in assets
                   if a.get("name") == package["name"] + ".sha256"), None)
    if not checksum: continue
    tag=release["tag_name"]
    label=tag
    if tag == latest: label += "  [Latest]"
    elif release.get("prerelease"): label += "  [Prerelease]"
    rows.append((0 if tag == latest else 1, label, tag,
                 release.get("published_at") or release.get("created_at") or ""))
for row in sorted(enumerate(rows), key=lambda x: (x[1][0], x[0])):
    print("\t".join(row[1][1:]))
' "${latest_tag}")" || die "MultiFX release metadata is invalid."
    while IFS=$'\t' read -r label tag published; do
        [ -n "${tag}" ] || continue
        labels+=("${label}")
        MULTIFX_CHOICE_TAGS+=("${tag}")
        MULTIFX_CHOICE_PUBLISHED+=("${published}")
        index="$((index + 1))"
    done <<< "${parsed}"
    [ "${index}" -gt 0 ] ||
        die "No MultiFX releases have a verified Raspberry Pi package yet."
    select_menu "Select MultiFX version" 0 "${labels[@]}" || return 1
    REQUESTED_TAG="${MULTIFX_CHOICE_TAGS[MENU_RESULT]}"
    selected_published="${MULTIFX_CHOICE_PUBLISHED[MENU_RESULT]}"
    MULTIFX_CHANGE_IS_DOWNGRADE=0
    MULTIFX_CHRONOLOGY_KNOWN=0
    if [ -f "${INSTALLER_STATE_DIR}/installed-release" ]; then
        installed_release="$(cat "${INSTALLER_STATE_DIR}/installed-release")"
        for ((index=0; index<${#MULTIFX_CHOICE_TAGS[@]}; index++)); do
            if [ "${MULTIFX_CHOICE_TAGS[index]}" = "${installed_release}" ]; then
                installed_published="${MULTIFX_CHOICE_PUBLISHED[index]}"
                break
            fi
        done
        if [ -n "${installed_published}" ] && [ -n "${selected_published}" ]; then
            MULTIFX_CHRONOLOGY_KNOWN=1
            [[ "${selected_published}" < "${installed_published}" ]] &&
                MULTIFX_CHANGE_IS_DOWNGRADE=1
        fi
    fi
    MULTIFX_SOURCE="tag"
}

is_multifx_package_root() {
    local directory="$1"
    [ -f "${directory}/react/index.html" ] &&
        [ -f "${directory}/multifx/controller-config.json" ] &&
        [ -f "${directory}/multifx/pipedal_encoder_bridge.py" ] &&
        [ -f "${directory}/mfxinstaller.sh" ] &&
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
    local package_root="$1" release_label="$2" service source_file installer_source
    [ -d /etc/pipedal ] ||
        die "PiPedal is not installed. Use menu option 1 or 5 first."
    [ -d "${REACT_DIR}" ] || die "PiPedal frontend is missing: ${REACT_DIR}"
    is_multifx_package_root "${package_root}" ||
        die "Invalid MultiFX package: ${package_root}"

    install_multifx_dependencies
    remove_legacy_squeekboard
    mkdir -p "${MFX_STATE_DIR}" "${MFX_LIB_DIR}" "${INSTALLER_STATE_DIR}"
    resolve_ydotool_service_conflict
    ensure_stock_frontend_backup

    backup_file_once "${CONTROLLER_CONFIG}" controller-config
    for service in pipedal-encoder.service pipedal-ydotoold.service; do
        backup_service_once "${service}"
    done

    if [ "${MULTIFX_RESET_FOR_DOWNGRADE}" -eq 1 ]; then
        echo "Resetting MultiFX controller/runtime data for older-version compatibility..."
        rm -rf -- "${MFX_STATE_DIR}"
        mkdir -p "${MFX_STATE_DIR}"
        rm -f -- "${CONTROLLER_CONFIG}"
    fi

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

    systemctl daemon-reload
    systemctl enable pipedal-ydotoold.service pipedal-encoder.service
    # PiPedal must finish opening and configuring ALSA before the controller
    # bridge opens the ESP32's MIDI interface. Starting the bridge first can
    # race USB/ALSA enumeration during boot and leave PiPedal underrunning
    # until pipedald is restarted manually.
    systemctl restart pipedald.service
    systemctl restart pipedal-ydotoold.service
    systemctl restart pipedal-encoder.service
    wait_for_service_active pipedald.service
    wait_for_service_active pipedal-ydotoold.service
    wait_for_service_active pipedal-encoder.service
    wait_for_pipedal_web
    printf '%s\n' "${release_label}" > "${INSTALLER_STATE_DIR}/installed-release"
    installer_source="$(newest_installer_source \
        "${SCRIPT_FILE}" "${package_root}/mfxinstaller.sh")"
    install_self "${installer_source}"
    install_home_copy "${installer_source}"
    [ "${BROWSER_REFRESH}" -eq 0 ] || refresh_browser
    echo "PiPedal MultiFX ${release_label} installation is complete."
}

install_multifx_from_github() {
    local work_dir archive checksum_file expected actual installed_release=""
    local is_downgrade=0
    MULTIFX_RESET_FOR_DOWNGRADE=0
    install_download_tools
    load_multifx_release
    if [ -f "${INSTALLER_STATE_DIR}/installed-release" ] &&
        [ "$(cat "${INSTALLER_STATE_DIR}/installed-release")" = "${MULTIFX_TAG}" ]; then
        confirm "${MULTIFX_TAG} is already installed. Reinstall it?" || {
            echo "No changes were made."
            return 0
        }
    fi
    if [ -f "${INSTALLER_STATE_DIR}/installed-release" ]; then
        installed_release="$(cat "${INSTALLER_STATE_DIR}/installed-release")"
        if [ "${MULTIFX_CHRONOLOGY_KNOWN}" -eq 1 ]; then
            is_downgrade="${MULTIFX_CHANGE_IS_DOWNGRADE}"
        elif dpkg --compare-versions "${installed_release#multifx-v}" gt \
            "${MULTIFX_TAG#multifx-v}"; then
            is_downgrade=1
        fi
        if [ "${is_downgrade}" -eq 1 ] &&
            confirm_default_yes "Create a safety backup before downgrading MultiFX?"; then
            create_backup
        fi
        if [ "${is_downgrade}" -eq 1 ]; then
            echo "Older bridges may not understand newer controller/runtime data."
            if confirm_default_yes "Reset MultiFX data to the selected version's defaults?"; then
                MULTIFX_RESET_FOR_DOWNGRADE=1
            fi
        fi
    fi
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
    if unzip -Z1 "${archive}" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
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
                [[ "${release_label}" =~ ^multifx-v[0-9]+\.[0-9]+(\.[0-9]+)?([.-][A-Za-z0-9.-]+)?$ ]] ||
                    die "The package contains an invalid MultiFX release version."
            fi
            install_multifx_payload "${PACKAGE_ROOT}" "${release_label}"
            ;;
        auto)
            if is_multifx_package_root "${SCRIPT_DIR}"; then
                release_label="local package"
                if [ -f "${SCRIPT_DIR}/MULTIFX_RELEASE" ]; then
                    IFS= read -r release_label < "${SCRIPT_DIR}/MULTIFX_RELEASE"
                    [[ "${release_label}" =~ ^multifx-v[0-9]+\.[0-9]+(\.[0-9]+)?([.-][A-Za-z0-9.-]+)?$ ]] ||
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

create_backup() {
    local timestamp archive partial work_dir manifest path relative
    local pipedald_active=0 encoder_active=0
    local -a backup_paths=()
    get_target_user
    BACKUP_DIR="${TARGET_HOME}/mfxbackups"
    mkdir -p "${BACKUP_DIR}"
    chown "${TARGET_USER}:${TARGET_GROUP}" "${BACKUP_DIR}"
    timestamp="$(date '+%Y%m%d-%H%M%S')"
    archive="${BACKUP_DIR}/mfxbackup-${timestamp}.tar.gz"
    partial="${archive}.partial"
    make_temp_dir /tmp/pipedal-backup.XXXXXX
    work_dir="${TEMP_DIR}"
    mkdir -p "${work_dir}/metadata"
    manifest="${work_dir}/metadata/manifest.txt"

    {
        echo "format=1"
        echo "created=$(date --iso-8601=seconds)"
        echo "host=$(hostname)"
        echo "target_user=${TARGET_USER}"
        if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
            echo "pipedal_version=$(dpkg-query -W -f='${Version}' pipedal)"
        else
            echo "pipedal_version=not-installed"
        fi
        if [ -f "${INSTALLER_STATE_DIR}/installed-release" ]; then
            echo "multifx_version=$(cat "${INSTALLER_STATE_DIR}/installed-release")"
        else
            echo "multifx_version=not-installed"
        fi
    } > "${manifest}"

    # PiPedal keeps its configuration and musical data under /etc/pipedal and
    # /var/pipedal. LV2 locations are included because users commonly install
    # additional plugins there, and MultiFX runtime/controller state is kept in
    # its two /var/lib directories.
    for path in \
        /etc/pipedal \
        /var/pipedal \
        "${MFX_STATE_DIR}" \
        "${INSTALLER_STATE_DIR}" \
        "${MFX_LIB_DIR}" \
        "${SERVICE_DIR}/pipedal-encoder.service" \
        "${SERVICE_DIR}/pipedal-ydotoold.service" \
        /usr/lib/lv2 \
        /usr/local/lib/lv2 \
        /usr/share/lv2 \
        /usr/local/share/lv2 \
        /usr/lib/aarch64-linux-gnu/lv2 \
        /usr/lib/x86_64-linux-gnu/lv2 \
        "${DISPLAY_STATE_DIR}" \
        /etc/xdg/labwc \
        "${TARGET_HOME}/.bash_profile" \
        "${TARGET_HOME}/.lv2"; do
        if [ -e "${path}" ] || [ -L "${path}" ]; then
            relative="${path#/}"
            backup_paths+=("${relative}")
            echo "path=${relative}" >> "${manifest}"
        fi
    done
    [ "${#backup_paths[@]}" -gt 0 ] || die "There is no PiPedal or MultiFX data to back up."

    systemctl is-active --quiet pipedald.service 2>/dev/null && pipedald_active=1
    systemctl is-active --quiet pipedal-encoder.service 2>/dev/null && encoder_active=1
    systemctl stop pipedal-encoder.service 2>/dev/null || true
    systemctl stop pipedald.service 2>/dev/null || true
    echo "Creating compressed backup. Large model and LV2 collections may take a while..."
    if tar -czpf "${partial}" -C / "${backup_paths[@]}" \
        -C "${work_dir}" metadata; then
        mv -f -- "${partial}" "${archive}"
    else
        rm -f -- "${partial}"
        [ "${pipedald_active}" -eq 0 ] || systemctl restart pipedald.service || true
        [ "${encoder_active}" -eq 0 ] || systemctl restart pipedal-encoder.service || true
        die "The backup could not be created."
    fi
    [ "${pipedald_active}" -eq 0 ] || systemctl restart pipedald.service || true
    [ "${encoder_active}" -eq 0 ] || systemctl restart pipedal-encoder.service || true
    chown "${TARGET_USER}:${TARGET_GROUP}" "${archive}"
    chmod 0600 "${archive}"
    BACKUP_LAST_FILE="${archive}"
    echo "Backup created: ${archive}"
}

offer_backup_before_removal() {
    if confirm_default_yes "Create a safety backup before removing anything?"; then
        create_backup
    else
        echo "Continuing without a new backup."
    fi
}

restore_backup() {
    local record archive label manifest backup_version current_version="not-installed"
    local pipedald_active=0 encoder_active=0
    local -a archives=() labels=()
    get_target_user
    BACKUP_DIR="${TARGET_HOME}/mfxbackups"
    [ -d "${BACKUP_DIR}" ] || die "No backup directory exists at ${BACKUP_DIR}."
    while IFS= read -r record; do
        [ -n "${record}" ] || continue
        archive="${record#*$'\t'}"
        archives+=("${archive}")
        label="$(basename -- "${archive}")  ($(du -h "${archive}" | awk '{print $1}'))"
        labels+=("${label}")
    done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f \
        -name 'mfxbackup-*.tar.gz' -printf '%T@\t%p\n' | sort -rn)
    [ "${#archives[@]}" -gt 0 ] || die "No mfxbackup files were found in ${BACKUP_DIR}."
    select_menu "Select backup to restore" 0 "${labels[@]}" || return 0
    archive="${archives[MENU_RESULT]}"
    tar -tzf "${archive}" >/dev/null || die "The selected backup is damaged."
    if tar -tzf "${archive}" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
        die "The selected backup contains an unsafe path."
    fi
    manifest="$(tar -xOzf "${archive}" metadata/manifest.txt 2>/dev/null)" ||
        die "The selected file is not a supported MultiFX backup."
    backup_version="$(printf '%s\n' "${manifest}" | sed -n 's/^pipedal_version=//p' | head -n1)"
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        current_version="$(dpkg-query -W -f='${Version}' pipedal)"
    fi
    if [ "${backup_version}" != "not-installed" ] &&
        [ "${current_version}" = "not-installed" ]; then
        die "Install PiPedal ${backup_version} (or another chosen version) before restoring this backup."
    fi
    if [ "${backup_version}" != "${current_version}" ]; then
        echo "WARNING: Backup PiPedal version: ${backup_version}"
        echo "         Installed PiPedal version: ${current_version}"
        echo "Restoring presets across versions can require PiPedal migrations."
        confirm "Restore this backup despite the version difference?" || {
            echo "Cancelled."
            return 0
        }
    fi
    confirm "Overwrite current PiPedal/MultiFX data with $(basename "${archive}")?" || {
        echo "Cancelled."
        return 0
    }

    systemctl is-active --quiet pipedald.service 2>/dev/null && pipedald_active=1
    systemctl is-active --quiet pipedal-encoder.service 2>/dev/null && encoder_active=1
    systemctl stop pipedal-encoder.service 2>/dev/null || true
    systemctl stop pipedald.service 2>/dev/null || true
    echo "Restoring backup..."
    if ! tar -xzpf "${archive}" -C / --exclude='metadata' --exclude='metadata/*'; then
        [ "${pipedald_active}" -eq 0 ] || systemctl restart pipedald.service || true
        [ "${encoder_active}" -eq 0 ] || systemctl restart pipedal-encoder.service || true
        die "The backup restore failed."
    fi
    systemctl daemon-reload
    [ "${pipedald_active}" -eq 0 ] || systemctl restart pipedald.service || true
    if [ "${encoder_active}" -eq 1 ] || [ -f "${SERVICE_DIR}/pipedal-encoder.service" ]; then
        systemctl restart pipedal-encoder.service 2>/dev/null || true
    fi
    refresh_browser
    mark_reboot_needed "restored services, plugins and touchscreen configuration"
    echo "Backup restored from: ${archive}"
}

has_multifx_remnants() {
    is_multifx_installed ||
        [ -e "${MFX_LIB_DIR}" ] ||
        [ -e "${MFX_STATE_DIR}" ] ||
        [ -e "${INSTALLER_STATE_DIR}/installed-release" ] ||
        [ -e "${INSTALLER_STATE_DIR}/controller-config.was-present" ] ||
        [ -e "${INSTALLER_STATE_DIR}/controller-config.was-absent" ] ||
        [ -e "${INSTALLER_STATE_DIR}/dependency-ydotool.was-installed" ] ||
        [ -e "${INSTALLER_STATE_DIR}/dependency-ydotool.was-absent" ] ||
        [ -e "${INSTALLER_STATE_DIR}/ydotool-backports-source.created-by-installer" ] ||
        [ -d "${OPTIMIZATION_STATE_DIR}" ] ||
        [ -e "${CONTROLLER_CONFIG}" ] ||
        [ -e "${SERVICE_DIR}/pipedal-encoder.service" ]
}

# Remove every MultiFX-owned runtime item while leaving the current setup tool
# installed. When PiPedal remains installed, restore the stock frontend and any
# files/services which existed before MultiFX was first installed.
remove_multifx_components() {
    local restore_stock="$1" service encoder_was_present=0 ydotool_was_present=0
    install_self
    [ -f "${INSTALLER_STATE_DIR}/pipedal-encoder.service.was-present" ] &&
        encoder_was_present=1
    [ -f "${INSTALLER_STATE_DIR}/pipedal-ydotoold.service.was-present" ] &&
        ydotool_was_present=1
    systemctl disable --now pipedal-encoder.service 2>/dev/null || true
    systemctl disable --now pipedal-ydotoold.service 2>/dev/null || true
    if [ -d "${OPTIMIZATION_STATE_DIR}" ]; then
        echo "Restoring installer-managed operating-system optimizations..."
        restore_all_optimizations 0
    fi

    if [ "${restore_stock}" -eq 1 ] && is_multifx_installed &&
        [ -d "${REACT_DIR}" ]; then
        [ -f "${STOCK_REACT_DIR}/index.html" ] ||
            die "The stock PiPedal frontend backup is missing; MultiFX was not removed."
        replace_directory_contents "${STOCK_REACT_DIR}" "${REACT_DIR}"
    fi
    if [ -d "${INSTALLER_STATE_DIR}" ]; then
        restore_file_backup "${CONTROLLER_CONFIG}" controller-config
        for service in pipedal-encoder.service pipedal-ydotoold.service; do
            restore_file_backup "${SERVICE_DIR}/${service}" "${service}"
        done
        restore_ydotool_user_service_policy
        remove_multifx_dependencies
    else
        rm -f -- "${CONTROLLER_CONFIG}"
        rm -f -- "${SERVICE_DIR}/pipedal-encoder.service"
        rm -f -- "${SERVICE_DIR}/pipedal-ydotoold.service"
    fi

    rm -rf -- "${MFX_LIB_DIR}"
    rm -rf -- "${MFX_STATE_DIR}"
    rm -rf -- "${INSTALLER_STATE_DIR}"
    rm -f -- "${UNINSTALL_COMMAND}"
    rm -f -- /tmp/.ydotool_socket
    systemctl daemon-reload
    if [ "${ydotool_was_present}" -eq 1 ]; then
        systemctl enable pipedal-ydotoold.service 2>/dev/null || true
        systemctl restart pipedal-ydotoold.service 2>/dev/null || true
    fi
    if [ "${encoder_was_present}" -eq 1 ]; then
        systemctl enable pipedal-encoder.service 2>/dev/null || true
        systemctl restart pipedal-encoder.service 2>/dev/null || true
    fi
    [ "${restore_stock}" -eq 0 ] || systemctl restart pipedald 2>/dev/null || true
}

uninstall_multifx() {
    if ! has_multifx_remnants; then
        echo "No MultiFX installation or runtime remnants were found."
        return 0
    fi
    offer_backup_before_removal
    confirm "Permanently remove MultiFX, its controller configuration and all runtime state?" || {
        echo "Cancelled."
        return 0
    }
    remove_multifx_components 1
    refresh_browser
    echo "MultiFX was completely removed and stock PiPedal was restored."
    echo "The setup tool and files under ~/mfxbackups were kept."
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

restore_display_file() {
    local target="$1" name="$2"
    local present="${DISPLAY_STATE_DIR}/${name}.was-present"
    local backup="${DISPLAY_STATE_DIR}/${name}.backup"
    rm -f -- "${target}"
    if [ -f "${present}" ] && [ -e "${backup}" ]; then
        cp -a "${backup}" "${target}"
    fi
}

remove_touchscreen_configuration() {
    local configured_user profile home group
    [ -d "${DISPLAY_STATE_DIR}" ] || return 0
    configured_user="$(cat "${DISPLAY_STATE_DIR}/configured-user" 2>/dev/null || true)"
    restore_display_file /etc/xdg/labwc/rc.xml labwc-rc.xml
    restore_display_file /etc/xdg/labwc/autostart labwc-autostart
    if [ -n "${configured_user}" ] && id "${configured_user}" >/dev/null 2>&1; then
        home="$(getent passwd "${configured_user}" | cut -d: -f6)"
        group="$(id -gn "${configured_user}")"
        profile="${home}/.bash_profile"
        restore_display_file "${profile}" bash-profile
        [ ! -e "${profile}" ] || chown "${configured_user}:${group}" "${profile}"
    fi
    if command -v raspi-config >/dev/null 2>&1; then
        # Older installer versions did not record the previous boot mode. B1
        # safely returns to a normal console login instead of auto-launching UI.
        raspi-config nonint do_boot_behaviour B1 || true
    fi
    rm -rf -- "${DISPLAY_STATE_DIR}"
}

optimization_unit_exists() {
    systemctl list-unit-files "$1" --no-legend 2>/dev/null |
        grep -q "^$1"
}

record_optimization_unit_state_once() {
    local unit="$1" key state_file active_file state
    key="${unit//[^A-Za-z0-9_.-]/_}"
    state_file="${OPTIMIZATION_STATE_DIR}/unit-${key}.enabled"
    active_file="${OPTIMIZATION_STATE_DIR}/unit-${key}.active"
    if [ ! -e "${state_file}" ]; then
        state="$(systemctl is-enabled "${unit}" 2>/dev/null || true)"
        printf '%s\n' "${state:-not-found}" > "${state_file}"
    fi
    if [ ! -e "${active_file}" ]; then
        state="$(systemctl is-active "${unit}" 2>/dev/null || true)"
        printf '%s\n' "${state:-inactive}" > "${active_file}"
    fi
}

disable_optimization_unit() {
    local unit="$1" mode="${2:-disable}"
    optimization_unit_exists "${unit}" || return 0
    record_optimization_unit_state_once "${unit}"
    if [ "${mode}" = "mask" ]; then
        systemctl mask --now "${unit}" 2>/dev/null ||
            systemctl stop "${unit}" 2>/dev/null || true
    else
        systemctl disable --now "${unit}" 2>/dev/null ||
            systemctl stop "${unit}" 2>/dev/null || true
    fi
}

restore_optimization_unit() {
    local unit="$1" key enabled_file active_file prior_enabled prior_active
    key="${unit//[^A-Za-z0-9_.-]/_}"
    enabled_file="${OPTIMIZATION_STATE_DIR}/unit-${key}.enabled"
    active_file="${OPTIMIZATION_STATE_DIR}/unit-${key}.active"
    [ -f "${enabled_file}" ] || return 0
    prior_enabled="$(cat "${enabled_file}")"
    prior_active="$(cat "${active_file}" 2>/dev/null || echo inactive)"
    systemctl unmask "${unit}" 2>/dev/null || true
    case "${prior_enabled}" in
        enabled|enabled-runtime|linked|linked-runtime|alias)
            systemctl enable "${unit}" 2>/dev/null || true
            ;;
        masked|masked-runtime)
            systemctl mask "${unit}" 2>/dev/null || true
            ;;
        disabled)
            systemctl disable "${unit}" 2>/dev/null || true
            ;;
    esac
    if [ "${prior_active}" = "active" ]; then
        systemctl start "${unit}" 2>/dev/null || true
    else
        systemctl stop "${unit}" 2>/dev/null || true
    fi
}

save_cpu_governors_once() {
    local policy governor
    [ -f "${OPTIMIZATION_STATE_DIR}/cpu-governors" ] && return 0
    : > "${OPTIMIZATION_STATE_DIR}/cpu-governors"
    for policy in /sys/devices/system/cpu/cpufreq/policy*; do
        [ -r "${policy}/scaling_governor" ] || continue
        governor="$(cat "${policy}/scaling_governor")"
        printf '%s\t%s\n' "${policy}" "${governor}" >> \
            "${OPTIMIZATION_STATE_DIR}/cpu-governors"
    done
}

install_pipedal_performance_service() {
    local service_file="${SERVICE_DIR}/${PERFORMANCE_SERVICE}"
    save_cpu_governors_once
    backup_file_once "${service_file}" optimization-performance-service
    cat > "${service_file}" <<'SERVICE'
[Unit]
Description=PiPedal CPU performance profile
Before=pipedald.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'for policy in /sys/devices/system/cpu/cpufreq/policy*; do test ! -w "$policy/scaling_governor" || echo performance > "$policy/scaling_governor"; done'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SERVICE
    chmod 0644 "${service_file}"
    systemctl daemon-reload
    systemctl enable --now "${PERFORMANCE_SERVICE}"
}

configure_pipedal_realtime_limits() {
    local override_dir="${SERVICE_DIR}/pipedald.service.d"
    local override="${override_dir}/90-pipedal-multifx-performance.conf"
    backup_file_once "${override}" optimization-pipedald-performance-override
    mkdir -p "${override_dir}"
    cat > "${override}" <<'OVERRIDE'
[Service]
LimitRTPRIO=95
LimitMEMLOCK=infinity
Nice=-10
OVERRIDE
    chmod 0644 "${override}"
}

configure_low_latency_networking() {
    local nm_config="/etc/NetworkManager/conf.d/90-pipedal-multifx-performance.conf"
    backup_file_once "${nm_config}" optimization-networkmanager-performance
    mkdir -p /etc/NetworkManager/conf.d
    cat > "${nm_config}" <<'NMCONFIG'
[connection]
wifi.powersave=2
NMCONFIG
    chmod 0644 "${nm_config}"
}

configure_low_swappiness() {
    local sysctl_file="/etc/sysctl.d/90-pipedal-multifx-performance.conf"
    backup_file_once "${sysctl_file}" optimization-sysctl-performance
    cat > "${sysctl_file}" <<'SYSCTL'
# Prefer keeping PiPedal/audio working memory in RAM. Keep zram/swap available
# as an emergency safety net instead of disabling it completely.
vm.swappiness=10
SYSCTL
    chmod 0644 "${sysctl_file}"
    sysctl -q -p "${sysctl_file}" || true
}

disable_completed_cloud_init_and_network_wait() {
    local unit dependency cloud_status=""
    local -a cloud_units=(
        cloud-init-local.service
        cloud-init-main.service
        cloud-init-network.service
        cloud-config.service
        cloud-final.service
    )

    if grep -Eqs '^[[:space:]]*[^#].*[[:space:]](nfs|nfs4|cifs)[[:space:]]' /etc/fstab; then
        echo "Network-mounted filesystems were found; keeping network-online waiting enabled."
        return 0
    fi

    while read -r dependency _; do
        case "${dependency}" in
            ""|NetworkManager-wait-online.service|network-online.target|\
            cloud-init-local.service|cloud-init-main.service|\
            cloud-init-network.service|cloud-config.service|cloud-final.service)
                ;;
            *)
                echo "${dependency} requires network-online; keeping the wait service enabled."
                return 0
                ;;
        esac
    done < <(systemctl list-dependencies --reverse --plain --no-legend \
        NetworkManager-wait-online.service 2>/dev/null || true)

    if command -v cloud-init >/dev/null 2>&1; then
        cloud_status="$(cloud-init status 2>/dev/null || true)"
        if ! grep -Eq 'status:[[:space:]]*(done|disabled)' <<< "${cloud_status}"; then
            echo "Cloud-init has not confirmed completion; leaving it and network-online waiting unchanged."
            return 0
        fi
        backup_file_once /etc/cloud/cloud-init.disabled optimization-cloud-init-disabled
        mkdir -p /etc/cloud
        touch /etc/cloud/cloud-init.disabled
        for unit in "${cloud_units[@]}"; do
            disable_optimization_unit "${unit}"
        done
    fi
    disable_optimization_unit NetworkManager-wait-online.service
}

apply_recommended_optimizations() {
    local model="unknown"
    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    [ ! -r /proc/device-tree/model ] ||
        model="$(tr -d '\0' < /proc/device-tree/model)"
    echo "Detected hardware: ${model}"
    case "${model}" in
        *"Raspberry Pi 5"*) ;;
        *)
            confirm "This is not detected as a Raspberry Pi 5. Apply the portable PiPedal optimizations anyway?" || return 0
            ;;
    esac
    confirm_default_yes "Apply the recommended, reversible PiPedal performance optimizations?" || return 0

    disable_completed_cloud_init_and_network_wait
    install_pipedal_performance_service
    configure_pipedal_realtime_limits
    configure_low_latency_networking
    configure_low_swappiness
    systemctl daemon-reload
    if systemctl is-enabled ssh.service >/dev/null 2>&1; then
        echo "SSH remains enabled."
    else
        echo "WARNING: SSH was not enabled before optimization; no SSH setting was changed."
    fi
    touch "${OPTIMIZATION_STATE_DIR}/recommended-applied"
    mark_reboot_needed "recommended PiPedal performance optimizations were applied"
    echo "Recommended optimizations are configured."
}

disable_bluetooth_optimization() {
    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    confirm "Disable Bluetooth services? Do not choose this if a controller uses Bluetooth." || return 0
    disable_optimization_unit bluetooth.service
    disable_optimization_unit hciuart.service
    touch "${OPTIMIZATION_STATE_DIR}/bluetooth-disabled"
    echo "Bluetooth services were disabled."
}

disable_optional_service_group() {
    local label="$1" warning="$2" mode="$3" unit found=0
    shift 3
    local -a units=("$@")
    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    for unit in "${units[@]}"; do
        optimization_unit_exists "${unit}" && found=1
    done
    if [ "${found}" -eq 0 ]; then
        echo "No ${label} services are installed; nothing needs changing."
        return 0
    fi
    echo "${warning}"
    confirm "Disable the detected ${label} services? Packages will be kept for restoration." || return 0
    for unit in "${units[@]}"; do
        disable_optimization_unit "${unit}" "${mode}"
    done
    touch "${OPTIMIZATION_STATE_DIR}/unused-services-disabled"
    echo "Detected ${label} services were disabled without removing packages."
}

disable_unneeded_pipedal_services() {
    local unit description found=0
    local -a disable_units=(
        cups.service cups.socket cups.path cups-browsed.service
        ModemManager.service
    )
    local -a mask_units=(
        packagekit.service packagekit-offline-update.service
        geoclue.service colord.service
    )

    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    echo
    echo "Detected services not required by PiPedal or MultiFX:"
    echo "-----------------------------------------------------"
    for unit in "${disable_units[@]}" "${mask_units[@]}"; do
        optimization_unit_exists "${unit}" || continue
        found=1
        case "${unit}" in
            cups* ) description="printing and printer discovery" ;;
            ModemManager.service) description="cellular modem management" ;;
            packagekit*) description="desktop software-update daemon; APT remains available" ;;
            geoclue.service) description="desktop geolocation" ;;
            colord.service) description="monitor/printer color-profile management" ;;
            *) description="unused background service" ;;
        esac
        printf '  %-42s %s\n' "${unit}" "${description}"
    done
    if [ "${found}" -eq 0 ]; then
        echo "  None found. This Pi is already lean in these areas."
        return 0
    fi
    echo
    echo "SSH, networking, Avahi, PiPedal, MultiFX, Labwc, zram, time sync,"
    echo "system logging, device management, and EEPROM updates are protected."
    confirm "Disable every detected service listed above? Packages will remain installed." || return 0
    for unit in "${disable_units[@]}"; do
        disable_optimization_unit "${unit}" disable
    done
    for unit in "${mask_units[@]}"; do
        disable_optimization_unit "${unit}" mask
    done
    touch "${OPTIMIZATION_STATE_DIR}/unused-services-disabled"
    echo "Detected unnecessary services were disabled and recorded for restoration."
}

show_unused_services_menu() {
    local -a options=(
        "Disable detected services not needed by PiPedal / MultiFX"
        "Optional: Bluetooth services"
        "Optional: Windows/Samba file sharing servers"
        "Optional: NFS/RPC file sharing servers"
        "Optional: Remote desktop / VNC servers"
        "Back"
    )
    while true; do
        select_menu "Disable unnecessary services" 0 "${options[@]}" || return 0
        case "${MENU_RESULT}" in
            0) disable_unneeded_pipedal_services ;;
            1) disable_bluetooth_optimization ;;
            2) disable_optional_service_group \
                "Samba file-sharing" \
                "Do not choose this if the Pi shares files with Windows or other computers." \
                disable smbd.service nmbd.service winbind.service ;;
            3) disable_optional_service_group \
                "NFS/RPC file-sharing" \
                "Do not choose this if the Pi provides or mounts NFS/network filesystems." \
                disable nfs-server.service rpcbind.service rpcbind.socket ;;
            4) disable_optional_service_group \
                "remote-desktop" \
                "SSH is preserved, but graphical VNC/WayVNC access will stop." \
                disable wayvnc.service vncserver-x11-serviced.service ;;
            5) return 0 ;;
        esac
        pause_for_menu
    done
}

set_boot_config_value() {
    local file="$1" key="$2" value="$3"
    if grep -Eq "^[#[:space:]]*${key}=" "${file}"; then
        sed -i -E "0,/^[#[:space:]]*${key}=.*/s//${key}=${value}/" "${file}"
    else
        printf '\n%s=%s\n' "${key}" "${value}" >> "${file}"
    fi
}

apply_boot_cosmetic_optimizations() {
    local config=/boot/firmware/config.txt
    [ -f "${config}" ] || die "Raspberry Pi boot configuration was not found at ${config}."
    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    confirm "Disable the early splash and unused PoE-fan probe? Do not choose this with a PoE HAT." || return 0
    backup_file_once "${config}" optimization-boot-config
    set_boot_config_value "${config}" disable_splash 1
    set_boot_config_value "${config}" disable_poe_fan 1
    touch "${OPTIMIZATION_STATE_DIR}/boot-cosmetics-applied"
    mark_reboot_needed "Raspberry Pi boot presentation settings changed"
    echo "Boot presentation optimizations were applied."
}

set_kernel_option() {
    local file="$1" option="$2" key="${2%%=*}" escaped_key
    escaped_key="${key//./\\.}"
    if grep -Eq "(^|[[:space:]])${escaped_key}(=|[[:space:]]|$)" "${file}"; then
        sed -i -E "1 s|(^|[[:space:]])${escaped_key}(=[^[:space:]]*)?|\\1${option}|g" "${file}"
    else
        sed -i "1 s|[[:space:]]*$| ${option}|" "${file}"
    fi
}

install_pipedal_plymouth_theme() {
    local theme_file="${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.plymouth"
    local script_file="${PLYMOUTH_THEME_DIR}/${PLYMOUTH_THEME_NAME}.script"
    local logo_file="${PLYMOUTH_THEME_DIR}/pipedal-logo.png"
    local multifx_logo_file="${PLYMOUTH_THEME_DIR}/pi-multifx-logo.png"

    mkdir -p "${PLYMOUTH_THEME_DIR}"
    curl -fL --retry 3 --retry-delay 2 "${PLYMOUTH_LOGO_URL}" -o "${logo_file}"
    curl -fL --retry 3 --retry-delay 2 "${PLYMOUTH_MULTIFX_LOGO_URL}" -o "${multifx_logo_file}"
    chmod 0644 "${logo_file}" "${multifx_logo_file}"

    cat > "${theme_file}" <<THEME
[Plymouth Theme]
Name=PiPedal MultiFX
Description=Text-free PiPedal MultiFX boot and shutdown screen
ModuleName=script

[script]
ImageDir=${PLYMOUTH_THEME_DIR}
ScriptFile=${script_file}
THEME

    cat > "${script_file}" <<'SCRIPT'
Window.SetBackgroundTopColor(0.0, 0.0, 0.0);
Window.SetBackgroundBottomColor(0.0, 0.0, 0.0);

logo_image = Image("pipedal-logo.png");
logo_maximum_width = Window.GetWidth() * 0.52;
if (logo_image.GetWidth() > logo_maximum_width) {
    logo_scale = logo_maximum_width / logo_image.GetWidth();
    logo_image = logo_image.Scale(logo_image.GetWidth() * logo_scale,
                                  logo_image.GetHeight() * logo_scale);
}

multifx_image = Image("pi-multifx-logo.png");
multifx_maximum_width = Window.GetWidth() * 0.38;
if (multifx_image.GetWidth() > multifx_maximum_width) {
    multifx_scale = multifx_maximum_width / multifx_image.GetWidth();
    multifx_image = multifx_image.Scale(multifx_image.GetWidth() * multifx_scale,
                                        multifx_image.GetHeight() * multifx_scale);
}

logo_gap = Window.GetHeight() * 0.035;
group_height = logo_image.GetHeight() + logo_gap + multifx_image.GetHeight();
group_top = Window.GetHeight() / 2 - group_height / 2;

logo_sprite = Sprite(logo_image);
logo_sprite.SetX(Window.GetWidth() / 2 - logo_image.GetWidth() / 2);
logo_sprite.SetY(group_top);
logo_sprite.SetZ(10000);

multifx_sprite = Sprite(multifx_image);
multifx_sprite.SetX(Window.GetWidth() / 2 - multifx_image.GetWidth() / 2);
multifx_sprite.SetY(group_top + logo_image.GetHeight() + logo_gap);
multifx_sprite.SetZ(10000);

# Intentionally ignore all status, question and password callbacks. Routine
# boot and shutdown details remain in the journal instead of on the display.
SCRIPT
    chmod 0644 "${theme_file}" "${script_file}"
}

apply_quiet_branded_splash() {
    local config="/boot/firmware/config.txt"
    local cmdline="/boot/firmware/cmdline.txt"
    local old_theme=""
    local option
    local -a quiet_options=(
        quiet splash loglevel=3 systemd.show_status=false
        rd.systemd.show_status=false udev.log_level=3 rd.udev.log_level=3
        vt.global_cursor_default=0 logo.nologo plymouth.ignore-serial-consoles
    )

    [ -f "${config}" ] || die "Raspberry Pi boot configuration was not found at ${config}."
    [ -f "${cmdline}" ] || die "Raspberry Pi kernel command line was not found at ${cmdline}."
    if [ -f /etc/crypttab ] && grep -Eqs '^[[:space:]]*[^#[:space:]]' /etc/crypttab; then
        die "The text-free splash is not enabled on encrypted-root systems because it could hide an unlock prompt."
    fi
    confirm_default_yes "Install the text-free PiPedal MultiFX boot, reboot and shutdown splash?" || return 0

    mkdir -p "${OPTIMIZATION_STATE_DIR}"
    backup_file_once "${config}" optimization-quiet-splash-config
    backup_file_once "${cmdline}" optimization-quiet-splash-cmdline
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        old_theme="$(plymouth-set-default-theme 2>/dev/null || true)"
    fi
    if [ ! -e "${OPTIMIZATION_STATE_DIR}/plymouth-theme-before" ]; then
        printf '%s\n' "${old_theme}" > "${OPTIMIZATION_STATE_DIR}/plymouth-theme-before"
    fi
    for option in plymouth plymouth-themes; do
        if ! package_is_installed "${option}"; then
            touch "${OPTIMIZATION_STATE_DIR}/package-${option}.was-absent"
        fi
    done

    apt_update_once
    apt-get install -y --no-install-recommends plymouth plymouth-themes
    install_pipedal_plymouth_theme
    plymouth-set-default-theme "${PLYMOUTH_THEME_NAME}"

    set_boot_config_value "${config}" disable_splash 1
    set_boot_config_value "${config}" auto_initramfs 1
    for option in "${quiet_options[@]}"; do
        set_kernel_option "${cmdline}" "${option}"
    done

    update-initramfs -u -k all
    touch "${OPTIMIZATION_STATE_DIR}/quiet-splash-applied"
    mark_reboot_needed "the text-free PiPedal MultiFX splash was installed"
    echo "The display will now show only the PiPedal graphic during normal boot, reboot and shutdown."
    echo "Boot details remain available through journalctl."
}

restore_quiet_branded_splash() {
    local old_theme=""
    [ -f "${OPTIMIZATION_STATE_DIR}/quiet-splash-applied" ] || return 0

    restore_file_backup /boot/firmware/config.txt optimization-quiet-splash-config
    restore_file_backup /boot/firmware/cmdline.txt optimization-quiet-splash-cmdline
    if [ -f "${OPTIMIZATION_STATE_DIR}/plymouth-theme-before" ]; then
        old_theme="$(cat "${OPTIMIZATION_STATE_DIR}/plymouth-theme-before")"
    fi
    if command -v plymouth-set-default-theme >/dev/null 2>&1; then
        if [ -n "${old_theme}" ]; then
            plymouth-set-default-theme "${old_theme}" || true
        elif [ -d /usr/share/plymouth/themes/details ]; then
            plymouth-set-default-theme details || true
        fi
    fi
    rm -rf -- "${PLYMOUTH_THEME_DIR}"
    update-initramfs -u -k all || true
    local -a remove_packages=()
    for old_theme in plymouth-themes plymouth; do
        if [ -f "${OPTIMIZATION_STATE_DIR}/package-${old_theme}.was-absent" ] &&
            package_is_installed "${old_theme}"; then
            remove_packages+=("${old_theme}")
        fi
    done
    if [ "${#remove_packages[@]}" -gt 0 ]; then
        apt-get purge -y "${remove_packages[@]}"
    fi
}

restore_cpu_governors() {
    local policy governor
    [ -f "${OPTIMIZATION_STATE_DIR}/cpu-governors" ] || return 0
    while IFS=$'\t' read -r policy governor; do
        [ -w "${policy}/scaling_governor" ] || continue
        printf '%s\n' "${governor}" > "${policy}/scaling_governor" || true
    done < "${OPTIMIZATION_STATE_DIR}/cpu-governors"
}

restore_all_optimizations() {
    local confirm_restore="${1:-1}" unit name
    local -a units=(
        NetworkManager-wait-online.service
        cloud-init-local.service cloud-init-main.service
        cloud-init-network.service cloud-config.service cloud-final.service
        bluetooth.service hciuart.service
        cups.service cups.socket cups.path cups-browsed.service
        ModemManager.service
        packagekit.service packagekit-offline-update.service
        geoclue.service colord.service
        smbd.service nmbd.service winbind.service
        nfs-server.service rpcbind.service rpcbind.socket
        wayvnc.service vncserver-x11-serviced.service
    )
    [ -d "${OPTIMIZATION_STATE_DIR}" ] || {
        echo "No installer-managed optimizations were found."
        return 0
    }
    if [ "${confirm_restore}" -eq 1 ]; then
        confirm "Restore all operating-system settings changed by the optimization menu?" || return 0
    fi

    systemctl disable --now "${PERFORMANCE_SERVICE}" 2>/dev/null || true
    restore_file_backup "${SERVICE_DIR}/${PERFORMANCE_SERVICE}" optimization-performance-service
    restore_file_backup "${SERVICE_DIR}/pipedald.service.d/90-pipedal-multifx-performance.conf" optimization-pipedald-performance-override
    restore_file_backup /etc/NetworkManager/conf.d/90-pipedal-multifx-performance.conf optimization-networkmanager-performance
    restore_file_backup /etc/sysctl.d/90-pipedal-multifx-performance.conf optimization-sysctl-performance
    restore_file_backup /etc/cloud/cloud-init.disabled optimization-cloud-init-disabled
    restore_quiet_branded_splash
    [ ! -e "${INSTALLER_STATE_DIR}/optimization-boot-config.was-present" ] ||
        restore_file_backup /boot/firmware/config.txt optimization-boot-config
    for unit in "${units[@]}"; do
        restore_optimization_unit "${unit}"
    done
    restore_cpu_governors
    systemctl daemon-reload
    rm -rf -- "${OPTIMIZATION_STATE_DIR}"
    for name in \
        optimization-performance-service \
        optimization-pipedald-performance-override \
        optimization-networkmanager-performance \
        optimization-sysctl-performance \
        optimization-cloud-init-disabled \
        optimization-boot-config \
        optimization-quiet-splash-config \
        optimization-quiet-splash-cmdline; do
        rm -f -- \
            "${INSTALLER_STATE_DIR}/${name}.was-present" \
            "${INSTALLER_STATE_DIR}/${name}.was-absent" \
            "${INSTALLER_STATE_DIR}/${name}.backup"
    done
    mark_reboot_needed "PiPedal operating-system optimizations were restored"
    echo "Installer-managed optimizations were restored."
}

show_optimization_status() {
    local ssh_state
    echo
    echo "PiPedal optimization status"
    echo "---------------------------"
    if [ -f "${OPTIMIZATION_STATE_DIR}/recommended-applied" ]; then
        echo "Recommended profile: enabled"
    else
        echo "Recommended profile: not applied"
    fi
    [ ! -f "${OPTIMIZATION_STATE_DIR}/bluetooth-disabled" ] || echo "Bluetooth services: disabled by installer"
    [ ! -f "${OPTIMIZATION_STATE_DIR}/unused-services-disabled" ] || echo "Optional background services: some disabled by installer"
    [ ! -f "${OPTIMIZATION_STATE_DIR}/boot-cosmetics-applied" ] || echo "Boot presentation: optimized"
    [ ! -f "${OPTIMIZATION_STATE_DIR}/quiet-splash-applied" ] || echo "Quiet branded splash: enabled"
    printf 'CPU governor:       '
    cat /sys/devices/system/cpu/cpufreq/policy0/scaling_governor 2>/dev/null || echo unknown
    ssh_state="$(systemctl is-enabled ssh.service 2>/dev/null || true)"
    printf 'SSH service:        %s\n' "${ssh_state:-not-enabled}"
    systemd-analyze 2>/dev/null || true
}

show_optimization_menu() {
    local -a options=(
        "Apply recommended Pi 5 / PiPedal optimizations"
        "Disable unnecessary services (show detected list)"
        "Install text-free PiPedal boot / shutdown splash"
        "Optional: Reduce boot splash / unused PoE probe"
        "Show optimization and boot status"
        "Restore all installer-managed optimizations"
        "Back"
    )
    while true; do
        select_menu "Raspberry Pi optimizations" 0 "${options[@]}" || return 0
        case "${MENU_RESULT}" in
            0) apply_recommended_optimizations ;;
            1) show_unused_services_menu ;;
            2) apply_quiet_branded_splash ;;
            3) apply_boot_cosmetic_optimizations ;;
            4) show_optimization_status ;;
            5) restore_all_optimizations ;;
            6) return 0 ;;
        esac
        offer_reboot_if_needed
        pause_for_menu
    done
}

remove_legacy_squeekboard() {
    local autostart="/etc/xdg/labwc/autostart"
    pkill -x squeekboard 2>/dev/null || true
    if [ -f "${autostart}" ]; then
        sed -i '/^[[:space:]]*squeekboard[[:space:]]*&[[:space:]]*$/d' "${autostart}"
    fi
    if dpkg-query -W -f='${Status}' squeekboard 2>/dev/null |
        grep -q 'install ok installed'; then
        echo "Removing the obsolete Squeekboard system keyboard..."
        apt-get purge -y squeekboard
    fi
}

configure_touchscreen_display() {
    local profile
    get_target_user
    command -v raspi-config >/dev/null 2>&1 ||
        die "Touchscreen setup requires Raspberry Pi OS and raspi-config."
    echo "Configuring automatic PiPedal touchscreen startup..."

    apt_update_once
    apt-get install -y --no-install-recommends labwc chromium
    [ -x /usr/bin/chromium ] || die "Chromium was not installed at /usr/bin/chromium."
    remove_legacy_squeekboard
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
    mark_reboot_needed "touchscreen auto-login and the Labwc session were configured"
}

uninstall_pipedal() {
    local directory
    if ! dpkg-query -W -f='${Status}' pipedal 2>/dev/null | grep -q 'install ok installed' &&
        [ ! -d /etc/pipedal ] && [ ! -d /var/pipedal ] &&
        ! has_multifx_remnants; then
        echo "No PiPedal installation or data remnants were found."
        return 0
    fi
    offer_backup_before_removal
    echo
    echo "This removes PiPedal, MultiFX, presets, models, IRs, configuration,"
    echo "PiPedal's bundled TooB plugins, controller state and touchscreen startup."
    echo "Other independently installed LV2 plugins are not deleted."
    confirm "Permanently remove PiPedal and all PiPedal/MultiFX data?" || {
        echo "Cancelled."
        return 0
    }

    install_self
    if has_multifx_remnants; then
        remove_multifx_components 0
    fi
    rm -rf -- "${INSTALLER_STATE_DIR}"
    systemctl disable --now pipedald.service 2>/dev/null || true
    systemctl disable --now pipedaladmin.service 2>/dev/null || true
    if dpkg-query -W -f='${Status}' pipedal 2>/dev/null | grep -q 'install ok installed'; then
        apt-get purge -y pipedal
    fi

    # These are the application-owned paths used by PiPedal's official
    # installer/uninstaller. /usr/lib/lv2 itself is deliberately retained for
    # unrelated third-party plugins; only PiPedal's bundled TooB directory is
    # removed after the optional backup.
    rm -rf -- /etc/pipedal
    rm -rf -- /var/pipedal
    rm -rf -- /var/lib/pipedal
    rm -rf -- /var/log/pipedal
    rm -rf -- /usr/lib/lv2/ToobAmp.lv2
    for directory in /usr/bin /usr/sbin; do
        find "${directory}" -maxdepth 1 \
            \( -type f -o -type l \) -name 'pipedal*' -delete
    done
    for directory in /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
        [ -d "${directory}" ] || continue
        find "${directory}" -maxdepth 1 \
            \( -type f -o -type l \) -name 'pipedal*.service' -delete
    done
    remove_touchscreen_configuration
    systemctl daemon-reload
    if id pipedal_d >/dev/null 2>&1; then
        userdel pipedal_d 2>/dev/null || true
    fi
    if getent group pipedal_d >/dev/null 2>&1; then
        groupdel pipedal_d 2>/dev/null || true
    fi
    mark_reboot_needed "PiPedal services, accounts and touchscreen startup were removed"
    echo "PiPedal and MultiFX were completely removed."
    echo "The setup tool and files under ~/mfxbackups were kept."
}

show_status() {
    local pipedal_version="not installed" multifx_version="not installed"
    local ydotool_global_state
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        pipedal_version="$(dpkg-query -W -f='${Version}' pipedal)"
    fi
    if [ -f "${INSTALLER_STATE_DIR}/installed-release" ]; then
        multifx_version="$(cat "${INSTALLER_STATE_DIR}/installed-release")"
    elif is_multifx_installed; then
        multifx_version="installed (version unknown)"
    fi
    echo
    echo "Installer:          v${INSTALLER_VERSION}"
    echo "PiPedal:            ${pipedal_version}"
    echo "PiPedal MultiFX:    ${multifx_version}"
    if [ -f "${DISPLAY_STATE_DIR}/configured-user" ]; then
        echo "Touchscreen setup:  enabled for $(cat "${DISPLAY_STATE_DIR}/configured-user")"
        echo "On-screen keyboard: MultiFX"
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
    ydotool_global_state="$(systemctl --global is-enabled ydotool.service 2>/dev/null || true)"
    if [ "${ydotool_global_state}" = "enabled" ] ||
        [ "${ydotool_global_state}" = "enabled-runtime" ]; then
        echo
        echo "WARNING: Debian's ydotool user service is globally enabled."
        echo "Recommendation: rerun the MultiFX installer and approve masking it"
        echo "so only pipedal-ydotoold.service owns the ydotool socket."
    fi
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

interactive_pipedal_install() {
    select_pipedal_version || return 0
    install_or_update_pipedal
}

interactive_multifx_install() {
    select_multifx_version || return 0
    install_or_update_multifx
}

interactive_full_setup() {
    select_pipedal_version || return 0
    select_multifx_version || return 0
    run_full_setup
}

pause_for_menu() {
    [ -t 0 ] || return 0
    echo
    read -r -p "Press Enter to return to the menu..." _
}

show_menu() {
    local -a options=(
        "Install / change PiPedal version"
        "Install / change MultiFX version"
        "Complete setup: PiPedal + MultiFX + touchscreen"
        "Create full backup"
        "Restore backup"
        "Completely remove MultiFX"
        "Completely remove PiPedal + MultiFX"
        "Set up touchscreen display"
        "Raspberry Pi performance optimizations"
        "Status and diagnostics"
        "Exit"
    )
    while true; do
        select_menu "Main menu" 1 "${options[@]}" || return 0
        case "${MENU_RESULT}" in
            0) interactive_pipedal_install ;;
            1) interactive_multifx_install ;;
            2) interactive_full_setup ;;
            3) create_backup ;;
            4) restore_backup ;;
            5) uninstall_multifx ;;
            6) uninstall_pipedal ;;
            7) configure_touchscreen_display ;;
            8) show_optimization_menu ;;
            9) show_status ;;
            10) return 0 ;;
        esac
        offer_reboot_if_needed
        pause_for_menu
    done
}

main() {
    if [ "${INVOKED_AS}" = "uninstall-pipedal-multifx" ]; then
        ACTION="uninstall"
    else
        parse_arguments "$@"
    fi
    require_root
    acquire_installer_lock
    command -v apt-get >/dev/null 2>&1 ||
        die "This installer requires Raspberry Pi OS, Debian or Ubuntu."
    refresh_installer_before_action
    maybe_full_upgrade
    case "${ACTION}" in
        menu) show_menu ;;
        pipedal) install_or_update_pipedal ;;
        multifx) install_or_update_multifx ;;
        backup) create_backup ;;
        restore) restore_backup ;;
        uninstall) uninstall_multifx ;;
        uninstall-pipedal) uninstall_pipedal ;;
        display) configure_touchscreen_display ;;
        optimize) show_optimization_menu ;;
        all) run_full_setup ;;
        status) show_status ;;
    esac
    [ "${ACTION}" = "menu" ] || offer_reboot_if_needed
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
