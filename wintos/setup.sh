#!/bin/bash
# Sets WintOS up from this checkout on a Mac: checks what it needs, builds it, puts the `wintos`
# CLI on the PATH, wires the Claude Code hooks, and adds a Spotlight launcher. Safe to run again
# after a pull: it rebuilds and leaves your settings alone.
#   wintos/setup.sh [--plugins <folder>]   also links that folder's plugins (its executable files)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$PWD"
CONFIG="$HOME/.config/wintos"
BIN="$HOME/.local/bin"
PLUGINS_FROM=""
while [ $# -gt 0 ]; do
    case "$1" in
    --plugins) PLUGINS_FROM="${2:?--plugins needs a folder}"; shift 2 ;;
    *) echo "unknown option $1 (usage: wintos/setup.sh [--plugins <folder>])" >&2; exit 2 ;;
    esac
done

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok() { printf '  ✓ %s\n' "$*"; }

step "Checking what WintOS needs"
[ "$(uname -s)" = Darwin ] || fail "WintOS runs on macOS only"
# The quick server build is Apple-silicon only (Taskfile: build:server:quickdev).
[ "$(uname -m)" = arm64 ] || fail "this setup builds for Apple silicon (arm64) only"
need() { command -v "$1" >/dev/null || fail "$1 is missing: $2"; ok "$1"; }
need node "install Node 22 or newer (brew install node)"
need npm "it comes with Node"
need go "brew install go"
need task "brew install go-task"
need jq "brew install jq"
need gh "brew install gh"
need claude "install Claude Code: https://docs.claude.com/en/docs/claude-code"
gh auth status >/dev/null 2>&1 || fail "gh is not logged in: run gh auth login (the PR list reads GitHub through it)"
ok "gh is logged in"

step "Installing packages and building (a few minutes the first time)"
npm install --no-fund --no-audit --loglevel=error
task build:server:quickdev
node wintos/build.mjs
ok "built"

step "Putting the wintos CLI on your PATH"
mkdir -p "$BIN"
ln -sfn "$REPO/wintos/cli/wintos" "$BIN/wintos"
ok "$BIN/wintos → this checkout"
case ":$PATH:" in *":$BIN:"*) ;; *) printf '  ! %s is not on your PATH: add  export PATH="$HOME/.local/bin:$PATH"  to ~/.zshrc\n' "$BIN" ;; esac

step "Settings"
mkdir -p "$CONFIG/plugins"
if [ -e "$CONFIG/env" ]; then
    ok "$CONFIG/env kept as it is (compare with wintos/env.example for new settings)"
else
    cp wintos/env.example "$CONFIG/env"
    ok "$CONFIG/env written from wintos/env.example: fill in what you want, then restart WintOS"
fi
ln -sfn "$REPO/wintos/shell/p10k.zsh" "$CONFIG/p10k.zsh"
# Powerlevel10k users get the WintOS prompt in WintOS terminals only.
grep -qs "wintos/p10k.zsh" "$HOME/.zshrc" || printf '  ! for the WintOS prompt (Powerlevel10k), add to the end of ~/.zshrc:\n    [[ -n $WAVETERM_TABID && -r ~/.config/wintos/p10k.zsh ]] && source ~/.config/wintos/p10k.zsh\n'
if [ -n "$PLUGINS_FROM" ]; then
    [ -d "$PLUGINS_FROM" ] || fail "--plugins: no folder $PLUGINS_FROM"
    # A plugin is an executable file (what WintOS runs); its libraries and tests stay where they are.
    for p in "$PLUGINS_FROM"/*; do
        name="$(basename "$p")"
        [ -f "$p" ] && [ -x "$p" ] && [[ "$name" != test_* && "$name" != _* ]] || continue
        ln -sfn "$(cd "$(dirname "$p")" && pwd)/$name" "$CONFIG/plugins/$name"
        ok "plugin $name"
    done
fi

step "Wiring Claude Code to WintOS"
"$BIN/wintos" hooks install

step "Spotlight launcher"
mkdir -p "$HOME/Applications"
# Spotlight starts apps with almost no PATH, hence the login shell. The [t] keeps pgrep from
# matching its own command line.
osacompile -o "$HOME/Applications/WintOS.app" -e "do shell script \"/bin/zsh -lc 'pgrep -f \\\"remoteDebuggingPor[t] 9223\\\" >/dev/null || (nohup $REPO/wintos/dev.sh > /tmp/wintos.log 2>&1 &)'\""
ok "~/Applications/WintOS.app: start WintOS from Spotlight (⌘Space, WintOS)"

step "Done"
echo "  Start it: Spotlight → WintOS, or  $REPO/wintos/dev.sh"
echo "  Settings: $CONFIG/env (each one is explained there)"
echo "  After a git pull, run this again to rebuild."
