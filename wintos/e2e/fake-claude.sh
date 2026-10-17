#!/bin/sh
# The dev instance's fixer command: it sees your real PRs, so it must never touch them.
printf '%s\n' "$@" >> "${WINTOS_ROOT:-/tmp}/.fixer/fake-claude.args"
echo '{"type":"result","result":"dev instance: nothing done"}'
