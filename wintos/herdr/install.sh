#!/bin/bash
# Puts WintOS's Herdr mods in place from this checkout: the mod files, the model bundled from
# WintOS's own logic, a layout of its own (Herdr's main, with WintOS in the agents' place) and
# its keys. Run again after an update; Herdr reloads the mods by itself.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
[ -d "$APP" ] || { echo "no Herdr at $APP" >&2; exit 1; }

for mod in wintos/herdr/mods/*/; do
    name="$(basename "$mod")"
    dest="$APP/mods/$name"
    mkdir -p "$dest"
    cp "$mod"* "$dest/"
    printf 'export const CHECKOUT = %s;\nexport const PORT = %s;\n' "\"$PWD\"" "${WINTOS_HERDR_PORT:-7732}" >"$dest/config.js"
    npx esbuild wintos/herdr/model.ts --bundle --format=esm --platform=neutral --log-level=warning --outfile="$dest/model.js"
    herdr-app check "$dest"
done

# Herdr's main layout is Herdr's to change, so WintOS's is a copy of it.
if [ ! -f "$APP/layouts/wintos.json" ]; then
    jq '(.. | objects | select(.id? == "agents") | .content) = {mod: "wintos"}' "$APP/layouts/main.json" >"$APP/layouts/wintos.json"
fi

# ⌃⇥ goes to the next session waiting on you, in the sidebar's order, as in WintOS.
tmp="$(mktemp)"
jq '.global += {"ctrl-tab": "agent.next", "ctrl-shift-tab": "agent.prev", "cmd-alt-d": "wintos.drive", "cmd-alt-z": "wintos.snooze", "cmd-alt-s": "wintos.quiet", "cmd-shift-g": "mod.open:wintos-prs"}' "$APP/keys.json" >"$tmp" && mv "$tmp" "$APP/keys.json"
herdr-app do layout.switch --name wintos >/dev/null
echo "WintOS mods installed in $APP"
