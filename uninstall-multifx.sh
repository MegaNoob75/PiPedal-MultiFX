#!/bin/bash
set -euo pipefail

REACT_DIR="/etc/pipedal/react"
MFX_LIB_DIR="/usr/local/lib/pipedal-multifx"
MFX_STATE_DIR="/var/lib/pipedal-multifx"
SERVICE_DIR="/etc/systemd/system"

die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo ./uninstall-multifx.sh"

cat <<'BANNER'
==================================================
 PiPedal MultiFX UI Uninstaller
==================================================
This removes MultiFX and restores the frontend that was
present before MultiFX was first installed.
PiPedal itself is NOT uninstalled.
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
rm -f /usr/local/sbin/uninstall-pipedal-multifx

if [ -d "${MFX_STATE_DIR}/original-react" ]; then
    echo "Restoring original PiPedal frontend..."
    mkdir -p "${REACT_DIR}"
    find "${REACT_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
    cp -a "${MFX_STATE_DIR}/original-react/." "${REACT_DIR}/"
else
    echo "WARNING: No original frontend backup was found."
    echo "Current /etc/pipedal/react was left unchanged."
fi

# Preserve /etc/pipedal/controller-config.json deliberately.
# It may contain the user's controller assignments.

systemctl daemon-reload
for service in pipedal-ydotoold.service pipedal-encoder.service; do
    if [ -f "${MFX_STATE_DIR}/service-backups/${service}" ]; then
        systemctl enable "${service}" 2>/dev/null || true
        systemctl restart "${service}" 2>/dev/null || true
    fi
done

# Refresh the browser if the restored ydotool service is available.
if command -v ydotool >/dev/null 2>&1 && [ -S /tmp/.ydotool_socket ]; then
    YDOTOOL_SOCKET=/tmp/.ydotool_socket ydotool key 29:1 19:1 19:0 29:0 || true
fi

rm -rf "${MFX_STATE_DIR}"

echo
echo "=================================================="
echo " PiPedal MultiFX removed. Original frontend restored."
echo "=================================================="
