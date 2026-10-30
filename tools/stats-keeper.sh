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
curl -fsS --retry 2 --retry-delay 20 --max-time 120 -H "x-owner-key: $KEY" "$SITE/stats/backup.json" -o "$NEW" || { echo "$(date): no answer"; exit 0; }
count() { /usr/bin/python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1])).get("players",{})))' "$1" 2>/dev/null || echo -1; }
NOW=$(count "$NEW")
OLD=0
[ -f "$COPY" ] && OLD=$(count "$COPY")
if [ "$NOW" -lt 0 ]; then
    echo "$(date): not a copy of the stats"
elif [ "$NOW" -lt "$OLD" ]; then
    # The server restarted and lost them: give them back, and keep the copy
    curl -fsS --max-time 120 -X POST -H "x-owner-key: $KEY" -H 'Content-Type: application/json' --data-binary @"$COPY" "$SITE/stats/restore" -o /dev/null \
        && echo "$(date): gave back $OLD players (server had $NOW)" || echo "$(date): could not give them back"
else
    mv "$NEW" "$COPY"
    cp "$COPY" "$DIR/$(date +%Y-%m-%d).json"  # one a day, for a month
    find "$DIR" -name '20*.json' -mtime +30 -delete
    echo "$(date): saved $NOW players"
fi
rm -f "$NEW"
