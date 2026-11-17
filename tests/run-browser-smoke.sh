#!/bin/sh
set -eu
openbox >/tmp/llm-select-openbox.log 2>&1 &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true' EXIT
python tests/browser_smoke.py
