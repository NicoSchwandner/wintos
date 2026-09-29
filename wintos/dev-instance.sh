#!/bin/bash
# A second WintOS for developing and testing WintOS itself, beside the everyday one: its own
# Wave data, Electron folder, daemon port, projects and debug port, and a banner saying so.
# New projects start a plain shell, not Claude.
D="$HOME/.local/share/wintos-dev"
mkdir -p "$D/data" "$D/config" "$D/projects"
export WINTOS_INSTANCE=dev WINTOS_PORT=7731 WINTOS_DEBUG_PORT=9224 WINTOS_ROOT="$D/projects" \
    WINTOS_NEW_PROJECT_CMD=none \
    WAVETERM_DATA_HOME="$D/data" WAVETERM_CONFIG_HOME="$D/config" \
    WINTOS_UI_ORIGINS=http://localhost:5174,http://localhost:5175,http://localhost:5176
# Personal settings for this instance only (e.g. WINTOS_GH_ORGS), outside the repo.
[ -r "$HOME/.config/wintos/dev-env" ] && { set -a; . "$HOME/.config/wintos/dev-env"; set +a; }
exec "$(dirname "$0")/dev.sh"
