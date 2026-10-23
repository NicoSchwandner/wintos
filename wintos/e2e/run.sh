#!/bin/bash
# The e2e pass on a clean dev instance, which is left clean again afterwards.
cd "$(dirname "$0")/../.."
wintos/dev-reset.sh >/dev/null
node wintos/e2e/scenarios.mjs
status=$?
wintos/dev-reset.sh >/dev/null
exit $status
