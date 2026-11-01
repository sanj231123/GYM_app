#!/usr/bin/env bash
# GymFit start — containers chalu + website open
cd "$(dirname "$0")"
docker compose start 2>/dev/null || docker compose up -d --build
echo "App chalu: http://localhost:2311"
grep -qi microsoft /proc/version 2>/dev/null && cmd.exe /c start.exe http://localhost:2311 >/dev/null 2>&1 || true
