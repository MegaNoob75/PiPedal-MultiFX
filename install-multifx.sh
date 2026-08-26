#!/usr/bin/env bash
set -Eeuo pipefail

# Compatibility entry point for older installation instructions. All install,
# update, backup and validation logic now lives in the consolidated setup tool.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SETUP="${SCRIPT_DIR}/mfxinstaller.sh"

[ -x "${SETUP}" ] || {
    echo "ERROR: Missing executable setup utility: ${SETUP}" >&2
    exit 1
}

exec "${SETUP}" multifx --local "${SCRIPT_DIR}" "$@"
