#!/usr/bin/env bash
set -Eeuo pipefail

# Compatibility entry point for older installation instructions.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SETUP="${SCRIPT_DIR}/mfxinstaller.sh"
[ -x "${LOCAL_SETUP}" ] || LOCAL_SETUP="${SCRIPT_DIR}/vite/mfxinstaller.sh"
INSTALLED_SETUP="/usr/local/sbin/pipedal-multifx-setup"

if [ -x "${INSTALLED_SETUP}" ]; then
    exec "${INSTALLED_SETUP}" uninstall "$@"
fi
if [ -x "${LOCAL_SETUP}" ]; then
    exec "${LOCAL_SETUP}" uninstall "$@"
fi

echo "ERROR: PiPedal MultiFX setup utility was not found." >&2
exit 1
