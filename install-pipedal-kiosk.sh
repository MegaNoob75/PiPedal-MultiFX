#!/bin/bash
set -euo pipefail

PIPEDAL_API="https://api.github.com/repos/rerdavies/pipedal/releases/latest"
MULTIFX_API="https://api.github.com/repos/MegaNoob75/PiPedal-MultiFX/releases/latest"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Please run this script with sudo:"
        echo "  sudo ./$0"
        exit 1
    fi
}

get_target_user() {
    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        TARGET_USER="${SUDO_USER}"
    else
        TARGET_USER="$(awk -F: '$3 >= 1000 && $3 < 65534 {print $1; exit}' /etc/passwd)"
    fi

    [ -n "${TARGET_USER:-}" ] || { echo "ERROR: Could not determine normal Pi user."; exit 1; }
    TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
    [ -d "${TARGET_HOME}" ] || { echo "ERROR: Could not determine home for ${TARGET_USER}."; exit 1; }
}

ensure_download_tools() {
    apt-get update
    apt-get install -y --no-install-recommends curl ca-certificates python3 unzip
}

get_latest_pipedal_release() {
    echo "Checking GitHub for latest stable PiPedal release..."
    local release_json
    release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${PIPEDAL_API}")"

    PIPEDAL_TAG="$(printf '%s' "${release_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
    PIPEDAL_URL="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
data=json.load(sys.stdin)
for a in data.get("assets", []):
    n=a.get("name", "")
    if n.startswith("pipedal_") and n.endswith("_arm64.deb"):
        print(a["browser_download_url"])
        break
else:
    raise SystemExit("No arm64 PiPedal .deb asset found in latest release.")
')"
    PIPEDAL_VERSION="${PIPEDAL_TAG#v}"
    PIPEDAL_FILE="$(basename "${PIPEDAL_URL}")"
    echo "Latest PiPedal release: ${PIPEDAL_TAG}"
    echo "Package: ${PIPEDAL_FILE}"
}

install_or_update_pipedal() {
    get_latest_pipedal_release
    if dpkg-query -W -f='${Version}' pipedal >/dev/null 2>&1; then
        local installed_version
        installed_version="$(dpkg-query -W -f='${Version}' pipedal)"
        echo "Installed PiPedal version: ${installed_version}"
        if dpkg --compare-versions "${installed_version}" ge "${PIPEDAL_VERSION}"; then
            echo "PiPedal is already current (or newer). Skipping package install."
            return
        fi
    fi

    local download_dir="/tmp/pipedal-install"
    rm -rf "${download_dir}"
    mkdir -p "${download_dir}"
    curl -fL "${PIPEDAL_URL}" -o "${download_dir}/${PIPEDAL_FILE}"
    apt-get install -y "${download_dir}/${PIPEDAL_FILE}"
    rm -rf "${download_dir}"
}

configure_kiosk() {
    get_target_user
    echo "Setting console auto-login..."
    raspi-config nonint do_boot_behaviour B2

    mkdir -p /etc/xdg/labwc
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
    chmod +x /etc/xdg/labwc/autostart

    if [ -f "${TARGET_HOME}/.bash_profile" ] && [ ! -f "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk" ]; then
        cp -a "${TARGET_HOME}/.bash_profile" "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk"
    fi

    cat > "${TARGET_HOME}/.bash_profile" <<'PROFILE'
# PiPedal kiosk login profile.
if [ -f ~/.bashrc ]; then
    . ~/.bashrc
fi
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec labwc
fi
PROFILE
    chown "${TARGET_USER}:$(id -gn "${TARGET_USER}")" "${TARGET_HOME}/.bash_profile"
    [ ! -f "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk" ] || chown "${TARGET_USER}:$(id -gn "${TARGET_USER}")" "${TARGET_HOME}/.bash_profile.pre-pipedal-kiosk"
}

install_pipedal_kiosk() {
    echo "=================================================="
    echo " PiPedal + Chromium Kiosk Setup"
    echo "=================================================="
    apt-get update
    apt-get full-upgrade -y
    apt-get install -y --no-install-recommends labwc chromium squeekboard curl ca-certificates python3 unzip
    install_or_update_pipedal
    configure_kiosk
    echo "PiPedal/kiosk setup is complete."
}

get_latest_multifx_package() {
    echo "Checking GitHub for latest stable PiPedal MultiFX release..."
    local release_json
    release_json="$(curl -fsSL -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "${MULTIFX_API}")"
    MULTIFX_TAG="$(printf '%s' "${release_json}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')"
    MULTIFX_URL="$(printf '%s' "${release_json}" | python3 -c '
import json,sys
data=json.load(sys.stdin)
assets=data.get("assets", [])
preferred=[a for a in assets if a.get("name","").lower().endswith(".zip") and "raspberrypi" in a.get("name","").lower() and "multifx" in a.get("name","").lower()]
fallback=[a for a in assets if a.get("name","").lower().endswith(".zip") and "multifx" in a.get("name","").lower()]
matches=preferred or fallback
if not matches:
    raise SystemExit("No MultiFX release ZIP asset found. Attach the prebuilt ZIP to the GitHub release.")
print(matches[0]["browser_download_url"])
')"
    MULTIFX_FILE="$(basename "${MULTIFX_URL}")"
    echo "Latest MultiFX release: ${MULTIFX_TAG}"
    echo "Package: ${MULTIFX_FILE}"
}

install_multifx_from_local_or_github() {
    if [ -f "${SCRIPT_DIR}/install-multifx.sh" ] && [ -d "${SCRIPT_DIR}/react" ] && [ -d "${SCRIPT_DIR}/multifx" ]; then
        echo "Using local prebuilt MultiFX package..."
        bash "${SCRIPT_DIR}/install-multifx.sh"
        return
    fi

    ensure_download_tools
    get_latest_multifx_package
    local temp_dir installer
    temp_dir="$(mktemp -d /tmp/pipedal-multifx.XXXXXX)"
    curl -fL "${MULTIFX_URL}" -o "${temp_dir}/${MULTIFX_FILE}"
    unzip -q "${temp_dir}/${MULTIFX_FILE}" -d "${temp_dir}/package"
    installer="$(find "${temp_dir}/package" -type f -name install-multifx.sh -print -quit)"
    if [ -z "${installer}" ]; then
        rm -rf "${temp_dir}"
        echo "ERROR: install-multifx.sh was not found inside release ZIP."
        return 1
    fi
    chmod +x "${installer}"
    bash "${installer}"
    rm -rf "${temp_dir}"
}

uninstall_multifx() {
    if [ -x /usr/local/sbin/uninstall-pipedal-multifx ]; then
        /usr/local/sbin/uninstall-pipedal-multifx
    elif [ -f "${SCRIPT_DIR}/uninstall-multifx.sh" ]; then
        bash "${SCRIPT_DIR}/uninstall-multifx.sh"
    else
        echo "ERROR: MultiFX uninstaller not found."
        echo "Put uninstall-multifx.sh beside this script, or install MultiFX first."
        return 1
    fi
}

show_menu() {
    echo
    echo "=================================================="
    echo " PiPedal Pedalboard Setup"
    echo "=================================================="
    echo "1) Install/update PiPedal + Chromium kiosk"
    echo "2) Install/update PiPedal MultiFX UI"
    echo "3) Uninstall PiPedal MultiFX UI"
    echo "4) Install/update PiPedal + kiosk, then MultiFX"
    echo "5) Exit"
    echo "=================================================="
    read -r -p "Choose an option [1-5]: " choice
    case "${choice}" in
        1) install_pipedal_kiosk ;;
        2) install_multifx_from_local_or_github ;;
        3) uninstall_multifx ;;
        4) install_pipedal_kiosk; install_multifx_from_local_or_github ;;
        5) exit 0 ;;
        *) echo "Invalid option."; exit 1 ;;
    esac
}

require_root
show_menu
