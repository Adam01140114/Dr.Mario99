#!/bin/bash
# Run once by the owner: takes a private copy of the player stats every 10 minutes from now on,
# by adding a launchd job for this user. To remove it:
#   launchctl bootout gui/$(id -u)/com.drmario99.stats-keeper
#   rm ~/Library/LaunchAgents/com.drmario99.stats-keeper.plist
set -e
HOME_DIR="$HOME/DrMario99"
SOURCE="$(cd "$(dirname "$0")" && pwd)/stats-keeper.sh"
PLIST="$HOME/Library/LaunchAgents/com.drmario99.stats-keeper.plist"
[ -f "$HOME_DIR/private-stats-link.txt" ] || { echo "No $HOME_DIR/private-stats-link.txt"; exit 1; }
mkdir -p "$HOME_DIR/stats-backups" "$HOME/Library/LaunchAgents"
cp "$SOURCE" "$HOME_DIR/stats-keeper.sh"
chmod 700 "$HOME_DIR/stats-keeper.sh" "$HOME_DIR/stats-backups"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.drmario99.stats-keeper</string>
    <key>ProgramArguments</key><array><string>/bin/bash</string><string>$HOME_DIR/stats-keeper.sh</string></array>
    <key>StartInterval</key><integer>600</integer>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$HOME_DIR/stats-backups/keeper.log</string>
    <key>StandardErrorPath</key><string>$HOME_DIR/stats-backups/keeper.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/com.drmario99.stats-keeper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. Copies go to $HOME_DIR/stats-backups, with a log in keeper.log there."
