#!/bin/bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Build outside file-provider folders so Finder metadata cannot invalidate signing.
BUILD_DIR="${BUILD_DIR:-${TMPDIR:-/tmp}/highlightdesk-monitoring-build}"
export BUILD_DIR
cd "$PROJECT_ROOT"
zsh mac/build.sh
codesign --verify --deep --strict "$BUILD_DIR/Chatclip.app"
open -n "$BUILD_DIR/Chatclip.app"
