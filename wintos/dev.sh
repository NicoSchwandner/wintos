#!/bin/bash
# Runs WintOS from source with a debug port (9223) for the UI checks in wintos/e2e.
# Launch environments leak: a Wave started from inside a Claude session inherits its
# CLAUDE_CODE_* variables and Claude then silently stops saving transcripts.
cd "$(dirname "$0")/.."
for v in $(env | grep -oE '^(CLAUDE[A-Z_]*|CMUX[A-Z_]*)='); do unset "${v%=}"; done
export WINTOS_ROOT="${WINTOS_ROOT:-$HOME/.local/share/wintos/projects}"
export WAVETERM_ENVFILE=$PWD/.env WAVETERM_NOCONFIRMQUIT=1 \
    WCLOUD_PING_ENDPOINT=https://ping-dev.waveterm.dev/central \
    WCLOUD_ENDPOINT=https://api-dev.waveterm.dev/central \
    WCLOUD_WS_ENDPOINT=wss://wsapi-dev.waveterm.dev
node wintos/build.mjs || exit 1
# Not via npx: npm exports npm_config_* into the child, every Wave shell inherits them, and
# nvm then prints a warning into each new terminal.
exec ./node_modules/.bin/electron-vite dev --remoteDebuggingPort 9223
