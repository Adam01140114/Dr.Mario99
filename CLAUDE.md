# Dr. Mario 99

Vanilla JS game (`public/`) with a Node/Socket.IO server (`server.js`). Run it with `npm start` (port 6767). How every part works is in `Project Documentation.txt`; read the section for the area you touch.

It runs live on Render (pushes to `main` deploy). Keep it fast for hundreds of players: send messages to rooms, never `io.emit` to everyone; keep per-frame messages small (diffs); no logging on hot paths; see "RUNNING IT FOR REAL" in the documentation.

## "How many people are playing?"

`/stats` (`public/stats.html`, data from `analytics.js` via `/stats.json`) shows who is online, players per day, how many come back, modes and where players came from. Same access as the game logs: this computer, its Wi-Fi, or `?key=` set to `LOG_KEY`. Pages say hello with a random id on the device (`scripts/hello.js`); no IP addresses or third parties. The numbers live in `analytics.json` next to the logs, so on a host they need a persistent disk (`LOG_DIR`). Tag links you share with `?ref=name`.

## "Something glitched in a game - what happened?"

Every game is logged in detail, so start with the logs, not with guesses:

- `logs/games/<id>.jsonl` holds the last 100 games, one JSON event per line (written by `gameLogs.js`). The first line describes the game (mode, players, inputs, CPUs, the shared viruses and pills). After that, each event has `t` (server time), `ct` (the sender's clock), `src` (`server`, `tv`, `page`, `phone:P2`, `lobby`) and `type`.
- `logs/markers.jsonl` lists every 🐞 a player pressed ("this moment looked wrong"), across games.
- The game ids show on the result screens ("Game log: …"). Ids start with the date and time, so `latest` is usually the game the user means.

Use the reader instead of reading raw files:

```bash
node tools/gamelog.js list                      # newest games; 🐞 = has a marker
node tools/gamelog.js summary latest            # players, timeline, every problem found
node tools/gamelog.js around latest marker 5    # everything 5 s either side of the 🐞
node tools/gamelog.js board latest marker       # every board drawn as it was then
node tools/gamelog.js grep latest input-ignored # events matching a type or text
node tools/gamelog.js audit latest              # find glitches by itself (floating pieces, virus counts, stuck pills...)
```

The user can watch any game back at `/replays` (replays.html), which plays the `keyframe` / `frame` events. To check the game itself after changing gameplay code, run a TV Room with 8 CPUs (ADD CPU PLAYER ×8, START GAME), let it finish, then `audit latest`. For anything about how the TV Room copes with many players, use the full 20.

`<when>` can also be a time of day (`15:42:07`), `+93.5` (seconds into the game) or `error` / `error:2`.

What gets logged:

- **Page or TV:** every move and what it did (`move`: key, pill before and after, landed), `pill`, `clear` (which cells, viruses or pills), `junk-incoming` / `junk-drop`, `hold`, `stage-clear` and `topped-out` (with the board), and `board` (a picture of each board once a second while it changes).
- **Errors and network:** errors and console warnings, `hitch` (the page froze for 250 ms or more), `long-task`, socket drops, `ping`.
- **TV Room:** `input` (every phone or controller press, and `via`: `server`, `direct` (WebRTC), `controller gp0`…), `input-ignored` (with `why`), `attack`, `eliminated`, `match-over`, `layout`, controller pairing, `cpu-plan` / `cpu-gave-up`.
- **Phones:** `button` (`via` direct or server), `direct-link`, `phone-hidden` (the phone slept), reconnects, errors.
- **Server:** every event each socket sent and got (`server-in` / `server-out`), lobby changes, auto start, disconnects.

Clocks: phones and pages use their own clock (`ct`). Order events from one source by `ct`; compare sources with care, or use `t` (the server's receive time, at most about 0.5 s later).

The logs aren't in git (`.gitignore`). On a hosted server, `/logs` and `/logs/<id>` serve them only with `?key=` set to the `LOG_KEY` environment variable; locally they work from this computer.
