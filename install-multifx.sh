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
[ -d /etc/pipedal ] || die "PiPedal is not installed (/etc/pipedal missing)."
[ -d "${REACT_DIR}" ] || die "PiPedal frontend is missing: ${REACT_DIR}"
[ -d "${SCRIPT_DIR}/react" ] || die "Release package is missing react/."
[ -f "${SCRIPT_DIR}/multifx/controller-config.json" ] || die "Current controller-config.json is missing."
[ -f "${SCRIPT_DIR}/multifx/pipedal_encoder_bridge.py" ] || die "Controller bridge is missing."

echo "Installing PiPedal MultiFX..."
apt-get update
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
cp -a "${SCRIPT_DIR}/react/." "${REACT_DIR}/"

# Keep a human-readable backup before installing the schema-2 factory file.
# The runtime state performs only the documented v0.2.0 -> schema-2 migration;
# obsolete page/tile formats are deliberately not interpreted.
if [ -f "${CONTROLLER_CONFIG}" ]; then
    cp -a "${CONTROLLER_CONFIG}" "${MFX_STATE_DIR}/controller-config.pre-current-schema.json"
fi
install -m 0644 "${SCRIPT_DIR}/multifx/controller-config.json" "${CONTROLLER_CONFIG}"
ln -sfn "${CONTROLLER_CONFIG}" "${REACT_DIR}/controller-config.json"

install -m 0755 "${SCRIPT_DIR}/multifx/pipedal_encoder_bridge.py" "${MFX_LIB_DIR}/pipedal_encoder_bridge.py"
for service in pipedal-ydotoold.service pipedal-encoder.service; do
    source_file="${SCRIPT_DIR}/systemd/system/${service}"
    [ -f "${source_file}" ] || source_file="${SCRIPT_DIR}/multifx/systemd/system/${service}"
    [ -f "${source_file}" ] || die "Missing ${service}"
    install -m 0644 "${source_file}" "${SERVICE_DIR}/${service}"
done

systemctl daemon-reload
systemctl enable pipedal-ydotoold.service pipedal-encoder.service
systemctl restart pipedal-ydotoold.service
systemctl restart pipedal-encoder.service

if [ -f "${SCRIPT_DIR}/uninstall-multifx.sh" ]; then
    install -m 0755 "${SCRIPT_DIR}/uninstall-multifx.sh" /usr/local/sbin/uninstall-pipedal-multifx
fi

if command -v ydotool >/dev/null 2>&1 && [ -S /tmp/.ydotool_socket ]; then
    YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool key 29:1 19:1 19:0 29:0 || true
fi

echo "PiPedal MultiFX installation complete."
