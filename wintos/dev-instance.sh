#!/bin/bash
# A second WintOS for developing and testing WintOS itself, beside the everyday one: its own
# Wave data, Electron folder, daemon port, projects and debug port, and a banner saying so.
# New projects start a plain shell, not Claude. Its heads-ups come from its own plugin store, not yours.
# Batches are off, so a turn shows in Your move at once, as e2e expects; WINTOS_BATCH_EVERY=20 tries them.
D="$HOME/.local/share/wintos-dev"
mkdir -p "$D/data" "$D/config" "$D/projects" "$D/claude/plugins/store"
export WINTOS_INSTANCE=dev WINTOS_PORT=7731 WINTOS_DEBUG_PORT=9224 WINTOS_ROOT="$D/projects" \
    WINTOS_NEW_PROJECT_CMD=none WINTOS_FIX_CMD="$(cd "$(dirname "$0")" && pwd)/e2e/fake-claude.sh" \
    WAVETERM_DATA_HOME="$D/data" WAVETERM_CONFIG_HOME="$D/config" \
    WINTOS_UI_PORT=5174 WINTOS_UI_ORIGINS=http://localhost:5174 WINTOS_REPO_NAMES="$D/config/repos.json" \
    WINTOS_CLAUDE_DIR="$D/claude" \
    WINTOS_BATCH_EVERY="${WINTOS_BATCH_EVERY:-0}"
# Personal settings for this instance only (e.g. WINTOS_GH_ORGS), outside the repo.
[ -r "$HOME/.config/wintos/dev-env" ] && { set -a; . "$HOME/.config/wintos/dev-env"; set +a; }
exec "$(dirname "$0")/dev.sh"
