#!/bin/bash
# The wintosd behind Herdr: built from this checkout into a folder of its own and run beside
# WintOS's, on its own port and projects folder, so the two never share or fight over a file.
# WintOS's settings (~/.config/wintos/env) apply, except what only one daemon may do: syncing the
# journal stays with WintOS, and so does fixing PRs by itself (below).
set -euo pipefail
cd "$(dirname "$0")/../.."
HOME_DIR="${WINTOS_HERDR_HOME:-$HOME/.local/share/wintos-herdr}"
mkdir -p "$HOME_DIR/projects/.fixer" "$HOME_DIR/dist/plugins"
# The conflict fixer has no off switch but this setting, and its default command is a real Claude:
# off here, so only WintOS's daemon ever fixes a PR by itself.
[ -f "$HOME_DIR/projects/.fixer/settings.json" ] || echo '{"conflicts":false}' >"$HOME_DIR/projects/.fixer/settings.json"

for v in $(env | grep -oE '^(CLAUDE[A-Z_]*|WAVETERM[A-Z_]*)='); do unset "${v%=}"; done
[ -r "$HOME/.config/wintos/env" ] && { set -a; . "$HOME/.config/wintos/env"; set +a; }
unset WINTOS_FIX_CMD WINTOS_FIX_CWD WINTOS_JOURNAL_GIT WINTOS_TOKEN
export WINTOS_INSTANCE=herdr WINTOS_PORT="${WINTOS_HERDR_PORT:-7732}" WINTOS_ROOT="$HOME_DIR/projects"

common=(--bundle --platform=node --target=node20 --format=cjs --log-level=warning)
npx esbuild "${common[@]}" wintos/daemon/main.ts --outfile="$HOME_DIR/dist/wintosd.cjs"
npx esbuild "${common[@]}" wintos/plugins/gh-prs/main.ts --outfile="$HOME_DIR/dist/plugins/gh-prs.cjs"
npx esbuild "${common[@]}" wintos/plugins/calendar/main.ts --outfile="$HOME_DIR/dist/plugins/calendar.cjs"
exec node "$HOME_DIR/dist/wintosd.cjs"
