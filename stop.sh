#!/usr/bin/env bash
# GymFit stop — containers stop (RAM free, data safe; phir start instant hota hai)
cd "$(dirname "$0")"
docker compose stop
echo "Band ho gaya. Chalu karne ke liye: ./start.sh"
