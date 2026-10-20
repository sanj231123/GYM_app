#!/usr/bin/env bash
# usage: ./logs.sh [backend|web|db]
cd "$(dirname "$0")"
sudo docker compose logs -f "${1:-backend}"