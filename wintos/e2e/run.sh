#!/bin/bash
# The e2e pass on a clean dev instance, which is left clean again afterwards.
cd "$(dirname "$0")/../.."
# The Mac's idle time is yours, not the run's: the keys it sends are not input, so a minute away
# from the keyboard would read as a break and hold Your move.
WINTOS_NO_IDLE=1 wintos/dev-reset.sh >/dev/null
node wintos/e2e/scenarios.mjs
status=$?
wintos/dev-reset.sh >/dev/null
exit $status
