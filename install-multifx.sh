#!/bin/bash
set -euo pipefail

REACT_DIR="/etc/pipedal/react"
CONTROLLER_CONFIG="/etc/pipedal/controller-config.json"
MFX_LIB_DIR="/usr/local/lib/pipedal-multifx"
MFX_STATE_DIR="/var/lib/pipedal-multifx"
SERVICE_DIR="/etc/systemd/system"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo ./install-multifx.sh"

cat <<'BANNER'
==================================================
 PiPedal MultiFX UI Installer
==================================================
This adds the MultiFX alternative interface and controller
support to an EXISTING PiPedal installation.
PiPedal itself is not installed or replaced.
BANNER

[ -d /etc/pipedal ] || die "PiPedal does not appear to be installed (/etc/pipedal is missing)."
[ -d "${REACT_DIR}" ] || die "PiPedal frontend directory is missing: ${REACT_DIR}"
[ -d "${SCRIPT_DIR}/react" ] || die "Release package is missing react/."
[ -f "${SCRIPT_DIR}/uninstall-multifx.sh" ] || die "Release package is missing uninstall-multifx.sh."

echo "Installing MultiFX runtime dependencies..."
apt-get update
apt-get install -y --no-install-recommends ydotool python3-mido python3-rtmidi

mkdir -p "${MFX_STATE_DIR}" "${MFX_LIB_DIR}"

if [ ! -d "${MFX_STATE_DIR}/original-react" ]; then
    echo "Backing up current PiPedal frontend..."
    mkdir -p "${MFX_STATE_DIR}/original-react"
    cp -a "${REACT_DIR}/." "${MFX_STATE_DIR}/original-react/"
else
    echo "Keeping existing original frontend backup."
fi

mkdir -p "${MFX_STATE_DIR}/service-backups"
for service in pipedal-encoder.service pipedal-ydotoold.service; do
    if [ -f "${SERVICE_DIR}/${service}" ] && [ ! -f "${MFX_STATE_DIR}/service-backups/${service}" ]; then
        cp -a "${SERVICE_DIR}/${service}" "${MFX_STATE_DIR}/service-backups/${service}"
    fi
done

echo "Installing prebuilt MultiFX frontend..."
find "${REACT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "${SCRIPT_DIR}/react/." "${REACT_DIR}/"

if [ ! -f "${CONTROLLER_CONFIG}" ]; then
    if [ -f "${SCRIPT_DIR}/multifx/controller-config.json" ]; then
        echo "Installing default controller configuration..."
        install -m 0644 "${SCRIPT_DIR}/multifx/controller-config.json" "${CONTROLLER_CONFIG}"
    else
        echo "WARNING: default controller-config.json is not present."
    fi
else
    echo "Keeping existing controller configuration."
fi

if [ -f "${CONTROLLER_CONFIG}" ]; then
    ln -sfn "${CONTROLLER_CONFIG}" "${REACT_DIR}/controller-config.json"
fi

if [ -f "${SCRIPT_DIR}/multifx/pipedal_encoder_bridge.py" ]; then
    echo "Installing MultiFX controller bridge..."
    install -m 0755 "${SCRIPT_DIR}/multifx/pipedal_encoder_bridge.py" "${MFX_LIB_DIR}/pipedal_encoder_bridge.py"
else
    echo "WARNING: pipedal_encoder_bridge.py is not present in this package."
fi

find_service_source() {
    local name="$1"
    if [ -f "${SCRIPT_DIR}/systemd/system/${name}" ]; then
        printf '%s\n' "${SCRIPT_DIR}/systemd/system/${name}"
        return 0
    fi
    if [ -f "${SCRIPT_DIR}/multifx/systemd/system/${name}" ]; then
        printf '%s\n' "${SCRIPT_DIR}/multifx/systemd/system/${name}"
        return 0
    fi
    return 1
}

for service in pipedal-ydotoold.service pipedal-encoder.service; do
    if source_file="$(find_service_source "${service}")"; then
        echo "Installing ${service}..."
        install -m 0644 "${source_file}" "${SERVICE_DIR}/${service}"
    else
        echo "WARNING: ${service} is not present in this package."
    fi
done

systemctl daemon-reload

# `enable --now` does not restart an already-running service. Explicitly
# restart so the just-installed service files and ExecStart are used now.
if [ -f "${SERVICE_DIR}/pipedal-ydotoold.service" ]; then
    systemctl enable pipedal-ydotoold.service
    systemctl restart pipedal-ydotoold.service
fi

if [ -f "${SERVICE_DIR}/pipedal-encoder.service" ] && [ -f "${MFX_LIB_DIR}/pipedal_encoder_bridge.py" ]; then
    systemctl enable pipedal-encoder.service
    systemctl restart pipedal-encoder.service
fi

install -m 0755 "${SCRIPT_DIR}/uninstall-multifx.sh" /usr/local/sbin/uninstall-pipedal-multifx

if command -v ydotool >/dev/null 2>&1 && [ -S /tmp/.ydotool_socket ]; then
    YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool key 29:1 19:1 19:0 29:0 || true
fi

echo
echo "=================================================="
echo " PiPedal MultiFX installation complete."
echo "=================================================="
echo "PiPedal itself was not replaced."
echo "The previous frontend was backed up for uninstall."
