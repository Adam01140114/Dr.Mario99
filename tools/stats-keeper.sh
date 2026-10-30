#!/bin/bash
# Keeps a private copy of the player stats on this computer, and gives it back to a server
# that has lost them (Render wipes its files on a restart). launchd runs it every 10 minutes:
# ~/Library/LaunchAgents/com.drmario99.stats-keeper.plist. See analytics.js.
set -u
HOME_DIR="$HOME/DrMario99"
SITE="https://dr-mario99.onrender.com"
DIR="$HOME_DIR/stats-backups"
COPY="$DIR/analytics.json"
KEY=$(sed 's/.*#key=//' "$HOME_DIR/private-stats-link.txt" | tr -d '\n')
umask 077
mkdir -p "$DIR"
NEW="$DIR/.new.json"
fetch() { curl -fsS --retry 2 --retry-delay 20 --max-time 120 -H "x-owner-key: $KEY" "$SITE/stats/backup.json" -o "$NEW"; }
field() { /usr/bin/python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d["players"]) if sys.argv[2]=="players" else ("yes" if d.get("needsRestore") else "no"))' "$1" "$2" 2>/dev/null || echo bad; }
fetch || { echo "$(date): no answer"; exit 0; }
if [ "$(field "$NEW" needs)" = "yes" ] && [ -f "$COPY" ]; then
    # The server restarted and lost its numbers: give them back before saving anything over them
    curl -fsS --max-time 120 -X POST -H "x-owner-key: $KEY" -H 'Content-Type: application/json' --data-binary @"$COPY" "$SITE/stats/restore" -o /dev/null \
        && echo "$(date): gave back $(field "$COPY" players) players" || { echo "$(date): could not give them back"; rm -f "$NEW"; exit 0; }
    fetch || { echo "$(date): no answer"; exit 0; }
fi
NOW=$(field "$NEW" players)
if [ "$NOW" = "bad" ] || [ "$(field "$NEW" needs)" = "yes" -a -f "$COPY" ]; then
    echo "$(date): keeping the last copy"
    rm -f "$NEW"
    exit 0
fi
mv "$NEW" "$COPY"
cp "$COPY" "$DIR/$(date +%Y-%m-%d).json"  # one a day, for a month
find "$DIR" -name '20*.json' -mtime +30 -delete
echo "$(date): saved $NOW players"
