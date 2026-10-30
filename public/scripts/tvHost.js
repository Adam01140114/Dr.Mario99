/**
 * DR. MARIO 99 - TV ROOM (the computer's side)
 * =============================================
 *
 * This page shows every player's board; each player scans the QR code and uses
 * their phone as the controller (controller.html). 1 to 20 players:
 *
 * - This page runs all the games. Each player attacks a target: the next player
 *   still in, going round the circle. A player whose bottle fills up is out and
 *   their board leaves the screen; the rest spread out to fill it. Clearing all
 *   your viruses wins outright; otherwise the last player left wins.
 * - One player plays solo: like single player, a cleared board is the next level.
 * - Single player's PHONE choice opens a room for one phone (startPhoneSolo):
 *   no lobby settings, and the game starts as soon as the phone joins.
 * - A player can choose CONTROLLER on their phone and play with a game
 *   controller on this computer instead (scripts/gamepad.js): pressing A on a
 *   free one, or tapping it in the list on the phone, makes it theirs. In the
 *   lobby, A on your own controller is the same as READY on the phone.
 * - A player can show their own board on their phone (a switch on the phone):
 *   this page sends them a picture of it (Board.snapshot()). With five or more
 *   players every phone shows it, because the boards get small here. From nine
 *   boards the name tags grow and the targets are left to the phones (layout()).
 * - ADD CPU adds computer players (CPU #1, CPU #2...) that take a slot like a
 *   phone; this page plays their boards (scripts/cpuPlayer.js).
 * - TEAMS: 2-8 teams named by colour (TEAMS). Phones pick theirs before READY;
 *   teammates don't attack each other; a team is out when all its players
 *   are; the last team standing, or the first to clear a board, wins.
 * - Presses and pictures go straight between phone and this page over their
 *   Wi-Fi (WebRTC) when possible, through the server otherwise.
 *
 * Uses the page's globals: socket, roomCode, hideRoomCode().
 */

"use strict"
import { attackSent, attackReceived } from "./attackFx.js"
import { startCpu } from "./cpuPlayer.js"

const MAX_PLAYERS = 20
// Teams match: names and colours (same list in controller.html and replays.html)
const TEAMS = [['RED', '#ff4d6d'], ['BLUE', '#4dc3ff'], ['GREEN', '#00ff66'], ['YELLOW', '#ffd60a'], ['PURPLE', '#c77dff'], ['ORANGE', '#ff9f1c'], ['TEAL', '#2ee6d6'], ['PINK', '#ff70d9']]
const TV_KEYS = { left: 'a', right: 'd', rotateLeft: 'w', rotateRight: 'Shift', drop: 's', hold: 'c' }
const TV_REPEAT = { left: 166, right: 166, drop: 60 } // held-key repeat, as on the keyboard (Board.js)
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
const BOARD_W = 960 + 14       // game-element plus its border
const BOARD_H = 576 + 14
const TAG_H = 56               // name tag over each board (index.html: 50px tall + 6px below)
const TAG_H_MANY = 102         // ...with MANY_BOARDS or more (body.tv-many: 96px tall + 6px below)
const MANY_BOARDS = 9
const GAP = 24                 // between boards (index.html: body.tv-mode .ai-boards-row gap)
const EDGE = 16                // room left around the edge of the screen
const STACK_BIAS = 0.04        // stack in more rows when that's at most this much smaller
const STATE_MS = 50            // board pictures to phones, at most 20 a second
const STATE_REFRESH_MS = 1500  // ...and resent now and then, for a phone that just came back

const $ = id => document.getElementById(id)
const glog = (type, details) => window.gameLog && window.gameLog.event(type, details) // scripts/gameLog.js

const tv = window.tvHost = {
    code: null,
    joinOrigin: null,
    lobby: [],          // players in the lobby, from the server
    qrUrl: null,
    seen: new Set(),    // "n:name" already shown, so only new names pop
    started: false,
    finished: false,
    solo: false,
    soloOnly: false,    // single player with the phone as the controller: one phone, starts when it joins
    boardForced: false, // five or more players: every phone shows its own board
    cpus: new Set(),    // players the computer plays
    lobbyTeams: 0,      // teams match in the lobby: how many teams (0 = everyone for themselves)
    teams: null,        // this round's teams: { count, of: player -> team }, or null
    cpuStops: {},       // player -> stops that CPU
    names: {},
    roster: [],         // players in this round
    alive: [],          // players still in
    targets: {},        // attacker -> target
    places: {},         // player -> finishing place
    games: {},          // player -> Game
    holds: {},          // player -> action -> repeat timer
    paused: false,      // someone pressed pause: every board stops (window.gamePaused)
    peers: {},          // player -> { pc, chain, channel }
    sent: {},           // player -> { key, at } last picture sent
    bindings: new Map(),  // controller key -> player
    controllerList: [], // [{ key, name }] controllers on this computer
    watchingPads: false,
    layout,
    sendAttack,
    playerFinished,
    startPhoneSolo: (forFreePlay = false) => startTvRoom(true, forFreePlay),
}

/* ---------- Lobby ---------- */

function startTvRoom(soloOnly = false, forFreePlay = false) {
    tv.soloOnly = soloOnly
    tv.forFreePlay = forFreePlay
    glog('tv-room-opening', { soloOnly })
    document.body.classList.remove('ai-mode')
    hideRoomCode()
    $('tvTitle').textContent = soloOnly ? '📱 PHONE CONTROLLER' : '📺 TV ROOM'
    $('tvCancel').textContent = soloOnly ? 'BACK' : 'CANCEL'
    $('tvLobby').classList.toggle('solo-only', soloOnly)
    $('tvLobby').classList.remove('hidden')
    socket.emit('tvCreateRoom', { solo: soloOnly, pairOnly: forFreePlay })
}

socket.on('tvRoomCreated', (data) => {
    tv.code = data.code
    tv.lobby = []
    tv.qrUrl = null
    // A phone cannot reach "localhost": use this computer's Wi-Fi address instead
    const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
    const lan = (data.lanOrigins || [])[0]
    tv.joinOrigin = isLocal && lan ? lan : location.origin
    const warning = $('tvWarning')
    warning.textContent = isLocal && !lan ? 'This computer is not on a network, so phones cannot reach it. Connect it to Wi-Fi and open the TV Room again.' : ''
    warning.classList.toggle('hidden', !(isLocal && !lan))
    $('tvCode').textContent = 'ROOM ' + data.code
    if (!tv.soloOnly) startControllers()
    renderLobby()
})

socket.on('tvLobby', (data) => {
    if (data.code !== tv.code) return
    tv.lobby = data.players
    tv.lobbyTeams = data.teams || 0
    reconcileBindings()
    if (!tv.started) renderLobby()
})

function renderLobby() {
    const players = tv.lobby
    const present = new Set(players.map(p => p.player))
    const connected = players.filter(p => p.connected)
    const slots = $('tvSlots')
    slots.innerHTML = ''
    for (const p of players) {
        const slot = document.createElement('div')
        slot.id = 'tvSlot' + p.player
        slot.className = `tv-slot tv-p${p.player} joined` + (p.connected ? '' : ' offline') + (p.ready ? ' ready' : '')
        const key = p.player + ':' + p.name
        if (!tv.seen.has(key)) {
            tv.seen.add(key)
            slot.classList.add('pop')
        } else {
            slot.style.animation = 'none'
        }
        slot.innerHTML = '<span class="tv-slot-num"></span><span class="tv-slot-name"></span><span class="tv-slot-input"></span><span class="tv-slot-ready"></span>'
        slot.querySelector('.tv-slot-num').textContent = 'P' + p.player
        slot.querySelector('.tv-slot-name').textContent = p.name + (p.connected ? '' : ' (away)')
        // Playing on the phone, or with which controller
        const pad = p.input === 'controller' && tv.controllerList.find(c => c.key === controllerOf(p.player))
        const input = slot.querySelector('.tv-slot-input')
        input.textContent = p.cpu ? '🤖 CPU' : p.input !== 'controller' ? '📱' : pad ? '🎮 ' + pad.name.toUpperCase() : '🎮 PRESS A'
        input.classList.toggle('waiting', p.input === 'controller' && !pad)
        input.classList.toggle('pad', !!pad)
        if (tv.lobbyTeams) {
            const team = document.createElement(p.cpu ? 'button' : 'span')
            team.className = 'tv-slot-team'
            if (p.team != null && TEAMS[p.team]) {
                team.textContent = TEAMS[p.team][0]
                team.style.background = TEAMS[p.team][1]
            } else {
                team.textContent = 'NO TEAM'
                team.classList.add('none')
            }
            // A CPU's team: click to move it to the next one
            if (p.cpu) {
                team.type = 'button'
                team.title = 'Move ' + p.name + ' to the next team'
                team.onclick = () => socket.emit('tvSetCpuTeam', { player: p.player, team: ((p.team != null ? p.team : -1) + 1) % tv.lobbyTeams })
            }
            slot.insertBefore(team, slot.querySelector('.tv-slot-ready'))
        }
        if (p.cpu) {
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'tv-slot-remove'
            remove.title = 'Take ' + p.name + ' out'
            remove.textContent = '✕'
            remove.onclick = () => socket.emit('tvRemoveCpu', { player: p.player })
            slot.appendChild(remove)
        }
        slot.querySelector('.tv-slot-ready').textContent = p.ready ? '✔ READY' : 'NOT READY'
        slots.appendChild(slot)
    }
    // The next open slot: where the QR code sends the next phone
    let open = null
    for (let n = 1; n <= (tv.soloOnly ? 1 : MAX_PLAYERS) && open === null; n++) {
        const p = players.find(q => q.player === n)
        if (!present.has(n) || (p && !p.connected)) open = n
    }
    if (open !== null && !present.has(open)) {
        const waiting = document.createElement('div')
        waiting.className = `tv-slot tv-p${open}`
        waiting.innerHTML = '<span class="tv-slot-num"></span><span class="tv-slot-name">Waiting...</span>'
        waiting.querySelector('.tv-slot-num').textContent = 'P' + open
        slots.appendChild(waiting)
    }
    slots.classList.toggle('many', players.length >= 4)
    slots.classList.toggle('crowded', players.length >= 9)
    $('tvCount').textContent = `${connected.length} / ${MAX_PLAYERS} PLAYERS`

    const qrCard = $('tvQrCard')
    if (open !== null && tv.code) {
        const url = `${tv.joinOrigin}/controller.html?room=${tv.code}&player=${open}` + (tv.soloOnly ? '&solo=1' : '')
        qrCard.classList.remove('hidden')
        qrCard.className = qrCard.className.replace(/\btv-p\d+\b/g, '').trim() + ' tv-p' + open
        $('tvQrLabel').textContent = tv.soloOnly ? 'SCAN WITH YOUR PHONE' : 'PLAYER ' + open + ': SCAN TO JOIN'
        $('tvQrUrl').textContent = url
        if (tv.qrUrl !== url) {
            tv.qrUrl = url
            const img = $('tvQrImg')
            img.classList.add('hidden')
            $('tvQrWait').classList.remove('hidden')
            img.onload = () => {
                img.classList.remove('hidden')
                $('tvQrWait').classList.add('hidden')
            }
            img.src = '/tv/qr.svg?text=' + encodeURIComponent(url)
        }
    } else {
        qrCard.classList.add('hidden')
    }

    // ADD CPU: while there's an empty slot
    $('tvAddCpu').classList.toggle('hidden', tv.soloOnly || players.length >= MAX_PLAYERS)

    // Free for all, or teams (and how many)
    $('tvModeFfa').classList.toggle('on', !tv.lobbyTeams)
    $('tvModeTeams').classList.toggle('on', !!tv.lobbyTeams)
    $('tvTeamCountLabel').classList.toggle('hidden', !tv.lobbyTeams)
    if (tv.lobbyTeams && document.activeElement !== $('tvTeamCount')) $('tvTeamCount').value = tv.lobbyTeams
    const summary = $('tvTeamSummary')
    summary.innerHTML = ''
    if (tv.lobbyTeams) {
        for (let t = 0; t < tv.lobbyTeams; t++) {
            const members = players.filter(p => p.team === t).map(p => p.name)
            const chip = document.createElement('span')
            chip.style.color = TEAMS[t][1]
            chip.textContent = TEAMS[t][0] + ': ' + (members.join(', ') || '-')
            summary.appendChild(chip)
        }
    }

    $('tvSoloNote').textContent = !tv.soloOnly ? ''
        : connected.length ? '✅ ' + connected[0].name + "'s phone is connected. Starting..."
        : "Point your phone's camera at the code. Your phone becomes the controller and the game starts as soon as it connects."

    renderPads()

    const start = $('tvStart')
    start.classList.toggle('hidden', connected.length === 0)
    start.lastChild.textContent = connected.length === 1 ? 'START SOLO' : 'START GAME'
}

function startTvGame() {
    const button = $('tvStart')
    button.disabled = true
    let virusCount = parseInt($('tvVirusCount').value, 10)
    if (isNaN(virusCount) || virusCount <= 0) virusCount = 5
    socket.emit('tvStartGame', { virusCount })
    setTimeout(() => { button.disabled = false }, 2000)
}

$('tvRoom').onclick = () => startTvRoom()
$('tvStart').onclick = startTvGame
$('tvCancel').onclick = () => { location.href = location.pathname }
$('tvAddCpu').onclick = () => socket.emit('tvAddCpu')
// Teams match: how many teams (2-8); FREE FOR ALL turns it off
const teamCount = () => Math.min(TEAMS.length, Math.max(2, parseInt($('tvTeamCount').value, 10) || 2))
$('tvModeFfa').onclick = () => socket.emit('tvSetTeams', { count: 0 })
$('tvModeTeams').onclick = () => socket.emit('tvSetTeams', { count: teamCount() })
$('tvTeamCount').addEventListener('change', () => {
    $('tvTeamCount').value = teamCount()
    socket.emit('tvSetTeams', { count: teamCount() })
})
// Everyone pressed READY on their phone: start without anyone touching the computer
socket.on('tvAutoStart', ({ code }) => {
    if (code === tv.code && !tv.started) startTvGame()
})

// Copy the join link, for a player who can't scan the QR code
$('tvCopyLink').onclick = function () {
    const url = tv.qrUrl
    if (!url) return
    const done = () => {
        this.textContent = '✅ COPIED!'
        this.classList.add('copied')
        clearTimeout(this.resetTimer)
        this.resetTimer = setTimeout(() => {
            this.textContent = '📋 COPY LINK'
            this.classList.remove('copied')
        }, 1800)
    }
    // The clipboard API only works on https or localhost; fall back to a hidden text box
    const fallback = () => {
        const box = document.createElement('textarea')
        box.value = url
        box.style.cssText = 'position:fixed;opacity:0;'
        document.body.appendChild(box)
        box.select()
        try { document.execCommand('copy'); done() } catch (e) { prompt('Copy this link:', url) }
        box.remove()
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, fallback)
    else fallback()
}

/* ---------- Playing ---------- */

// Every player gets a copy of this round's shared data: same viruses, same pills
function useGameData(gameData) {
    window.sharedGameData = gameData
    window.myRandomList = [...gameData.randomList]
    window.numberPosition = 1
    window.tvColorPositions = {}
    for (const n of tv.roster) window.tvColorPositions[n] = 1 // each player walks the same pill list
}

socket.on('tvGameStarted', async (data) => {
    if (data.code !== tv.code) return
    // Free Play with a phone: the phone is paired, now find a match (scripts/partyClient.js)
    if (tv.forFreePlay) {
        tv.phoneFor = data.roster[0]
        $('tvLobby').classList.add('hidden')
        window.party.startFreePlay()
        return
    }
    const first = !tv.started
    tv.started = true
    tv.finished = false
    setPaused(false)
    document.body.classList.add('tv-playing')
    tv.names = data.names
    tv.roster = data.roster.slice()
    tv.alive = data.roster.slice()
    tv.solo = tv.roster.length === 1
    tv.places = {}
    tv.boardForced = !!data.boardForced
    tv.cpus = new Set(data.cpus || [])
    tv.teams = data.teams || null
    tv.sent = {}
    if (window.gameLog) window.gameLog.setId(data.logId)
    glog('round-start', { roster: tv.roster, names: tv.names, cpus: [...tv.cpus], teams: tv.teams, boardForced: tv.boardForced, bindings: Object.fromEntries(tv.bindings), screen: { w: innerWidth, h: innerHeight } })
    closeOverlay()
    if (first) {
        roomCode = data.code
        $('tvLobby').classList.add('hidden')
        $('playbuttons').classList.add('hidden')
        document.body.classList.add('tv-mode', 'in-game')
    }
    useGameData(data.gameData)
    await buildGames()
    assignTargets()
    layout()
})

/** Tear down last round's boards and make one per player */
async function buildGames() {
    const { default: Game } = await import('./Game.js')
    for (const n of Object.keys(tv.games)) removeGame(+n)
    window.gameInstances = {}
    const row = document.querySelector('.ai-boards-row')
    for (const n of tv.roster) {
        tv.holds[n] = {}
        let container = $('game' + n)
        if (!container) {
            container = document.createElement('div')
            container.id = 'game' + n
            row.appendChild(container)
        }
        container.className = 'game-container' + (teamOf(n) != null ? ' team' : '')
        container.style.setProperty('--team', teamOf(n) != null ? TEAMS[teamOf(n)][1] : 'transparent')
        container.innerHTML = ''
        const tag = document.createElement('div')
        tag.className = 'tv-name-tag tv-p' + n
        tag.innerHTML = `<span class="tv-slot-num">P${n}</span><span id="tvName${n}"></span>`
            + `<span class="tv-link hidden" id="tvLink${n}" title="Controller connected straight over the Wi-Fi">⚡</span>`
            + `<span class="tv-pad-tag hidden" id="tvPadTag${n}" title="Playing with a controller"></span>`
            + (tv.cpus.has(n) ? '<span class="tv-cpu-tag" title="The computer plays this board">🤖</span>' : '')
            + (teamOf(n) != null ? `<span class="tv-team-tag" style="background:${TEAMS[teamOf(n)][1]}">TEAM ${TEAMS[teamOf(n)][0]}</span>` : '')
            + `<span class="tv-target" id="tvTarget${n}"></span>`
        tag.querySelector('#tvName' + n).textContent = tv.names[n]
        container.appendChild(tag)
        const game = new Game(n, { isTVControlled: true })
        container.appendChild(game)
        tv.games[n] = game
        window.gameInstances[n] = game
        if (tv.cpus.has(n)) tv.cpuStops[n] = startCpu(game, Math.random())
        showTvLink(n, !!(tv.peers[n] && tv.peers[n].channel && tv.peers[n].channel.readyState === 'open'))
        showPadTag(n)
    }
    window.currentGame = tv.games[tv.roster[0]]
}

function removeGame(n) {
    releaseHolds(n)
    if (tv.cpuStops[n]) tv.cpuStops[n]()
    delete tv.cpuStops[n]
    const game = tv.games[n]
    if (game) game.teardown()
    delete tv.games[n]
    if (window.gameInstances) delete window.gameInstances[n]
    const container = $('game' + n)
    if (!container) return
    container.innerHTML = ''
    // #game1 and #game2 belong to the page (other modes use them): hide those, remove the rest
    if (n <= 2) container.className = 'game-container hidden'
    else container.remove()
}

/** Boards as big as the screen allows, in the rows and columns that fit best */
function layout() {
    const row = document.querySelector('.ai-boards-row')
    if (!row || !document.body.classList.contains('tv-mode')) return
    const count = Math.max(1, row.querySelectorAll(':scope > .game-container:not(.hidden):not(.leaving)').length)
    document.body.classList.toggle('tv-many', count >= MANY_BOARDS)
    const tagH = count >= MANY_BOARDS ? TAG_H_MANY : TAG_H
    // Every way to split them into rows; the biggest boards win. A layout with more rows
    // (two on top, one below) wins when it's nearly as big: it fills the screen better
    // than one long strip.
    const layouts = []
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols)
        const width = cols * BOARD_W + (cols - 1) * GAP
        const height = rows * (BOARD_H + tagH) + (rows - 1) * GAP
        layouts.push({ cols, width, scale: Math.min((window.innerWidth - EDGE) / width, (window.innerHeight - EDGE) / height) })
    }
    const biggest = Math.max(...layouts.map(l => l.scale))
    const best = layouts.filter(l => l.scale >= biggest * (1 - STACK_BIAS)).sort((a, b) => a.cols - b.cols)[0]
    row.style.width = best.width + 'px'
    row.style.transform = `translate(-50%, -50%) scale(${Math.min(1.6, best.scale)})`
    const picked = `${count}:${best.cols}:${best.scale.toFixed(3)}`
    if (tv.lastLayout !== picked) {
        tv.lastLayout = picked
        glog('layout', { boards: count, perRow: best.cols, scale: +best.scale.toFixed(3), screen: { w: innerWidth, h: innerHeight } })
    }
}
window.addEventListener('resize', layout)

/** Each player attacks the next player still in, round the circle */
function assignTargets() {
    tv.targets = {}
    const alive = tv.roster.filter(n => tv.alive.includes(n))
    if (alive.length >= 2) {
        alive.forEach((n, i) => {
            // The next player round the circle who isn't on your team
            for (let k = 1; k < alive.length; k++) {
                const other = alive[(i + k) % alive.length]
                if (teamOf(other) == null || teamOf(other) !== teamOf(n)) {
                    tv.targets[n] = other
                    break
                }
            }
        })
    }
    glog('targets', { targets: tv.targets })
    for (const n of tv.roster) {
        const tag = $('tvTarget' + n)
        // With two left it's obvious who you're attacking
        if (tag) tag.textContent = alive.length >= 3 && tv.targets[n] ? '▸ ' + tv.names[tv.targets[n]] : ''
    }
}

/** A player cleared 4+: their target gets junk (called by Board.js) */
function sendAttack(from, points, color) {
    if (!tv.started || tv.finished) return
    const target = tv.targets[from]
    const game = target && tv.alive.includes(target) && tv.games[target]
    if (!game || !game.board) return glog('attack-lost', { from, target, points, why: 'no target in the game' })
    const counted = game.board.receiveDamage(points, color)
    glog('attack', { from, target, points, color, counted })
    if (counted) {
        attackSent(from, target, color)
        attackReceived(target, from, color)
    }
}

// A phone button went down or up: move that player's pill, repeating while held.
// Presses arrive over the direct Wi-Fi link when there is one, else through the server.
socket.on('tvInput', (data) => handleInput(data, 'server'))
function handleInput({ player, action, pressed }, via = '?') {
    if (tv.forFreePlay) return phoneToFreePlay(action, pressed)
    const holds = tv.holds[player]
    const ignored = why => glog('input-ignored', { p: player, action, pressed, via, why })
    if (!holds) return ignored('no game for this player')
    if (action === 'all') {
        glog('input-release-all', { p: player, via })
        return releaseHolds(player)
    }
    if (!tv.started || tv.finished || !tv.alive.includes(player)) return ignored(!tv.started ? 'not started' : tv.finished ? 'match over' : 'player is out')
    if (action === 'pause') {
        if (pressed) setPaused(!tv.paused, player)
        return
    }
    if (tv.paused) return pressed ? ignored('paused') : undefined
    const key = TV_KEYS[action]
    if (!key) return ignored('unknown action')
    glog('input', { p: player, action, pressed, via })
    if (!pressed) {
        clearInterval(holds[action])
        delete holds[action]
        return
    }
    if (holds[action]) return
    const board = () => { const game = tv.games[player]; return game && game.board }
    const pill = board() && board().currentPill
    const move = () => {
        const b = board()
        if (!b || tv.finished) return
        // Held drop only drops the pill it was pressed for: once that pill lands (or junk is
        // falling and there is none yet), stop until the player presses down again.
        if (action === 'drop' && (!pill || b.currentPill !== pill)) {
            clearInterval(holds[action])
            holds[action] = 'spent'
            return
        }
        b.movementFromKey(key)
    }
    move()
    if (TV_REPEAT[action] && !holds[action]) holds[action] = setInterval(move, TV_REPEAT[action])
}

/* ---------- Pause ---------- */
// + or - on a controller, ⏸ on a phone, or PAUSE on the TV: every board stops until
// someone presses one again. Board.js, Game.js and cpuPlayer.js skip their ticks while
// window.gamePaused is on; phones see it in their state ("paused").

function setPaused(paused, player) {
    paused = !!paused && tv.started && !tv.finished
    if (paused === tv.paused) return
    tv.paused = window.gamePaused = paused
    glog(paused ? 'paused' : 'resumed', { p: player || null })
    for (const n of tv.roster) releaseHolds(n)
    document.body.classList.toggle('tv-paused', paused)
    $('tvPauseBy').textContent = paused && player ? 'PAUSED BY ' + playerName(player).toUpperCase() : ''
    $('tvPauseButton').textContent = paused ? '▶ RESUME' : '⏸ PAUSE'
    tv.sent = {} // phones hear about it at once
}
$('tvPauseButton').onclick = (e) => {
    e.currentTarget.blur()
    setPaused(!tv.paused)
}

function releaseHolds(player) {
    for (const id of Object.values(tv.holds[player] || {})) clearInterval(id)
    tv.holds[player] = {}
}

/** Game.js: a board cleared its last virus (won) or filled up (lost) */
function playerFinished(player, won) {
    glog('player-finished', { p: player, won, alive: tv.alive.slice(), finished: tv.finished })
    if (!tv.started || tv.finished || !tv.alive.includes(player)) return
    if (tv.solo) return won ? soloLevelCleared(player) : soloGameOver(player)
    if (won) return endMatch(player, 'cleared')
    eliminate(player)
}

function eliminate(player) {
    const place = tv.alive.length
    tv.places[player] = place
    tv.alive = tv.alive.filter(n => n !== player)
    glog('eliminated', { p: player, place, alive: tv.alive.slice() })
    releaseHolds(player)
    const game = tv.games[player]
    if (game) game.freeze()
    socket.emit('tvEliminated', { player, place })
    if (tv.alive.length === 1) return endMatch(tv.alive[0], 'last', player)
    // Teams match: one team left standing
    if (tv.teams && new Set(tv.alive.map(teamOf)).size === 1) return endMatch(tv.alive[0], 'last', player)

    // Out: grey the board, say so, then take it off the screen and spread the rest out
    const container = $('game' + player)
    const tag = container && container.querySelector('.tv-name-tag')
    if (tag) {
        const out = document.createElement('span')
        out.className = 'tv-out'
        out.textContent = 'OUT #' + place
        tag.appendChild(out)
    }
    if (container) container.classList.add('out')
    assignTargets()
    setTimeout(() => {
        if (!container || !tv.started) return
        container.classList.add('leaving')
        layout()
        setTimeout(() => {
            if (tv.games[player] === game) removeGame(player)
            layout()
        }, 600)
    }, 900)
}

function endMatch(winner, how, lastOut) {
    tv.finished = true
    setPaused(false)
    document.body.classList.remove('tv-playing')
    for (const n of tv.roster) {
        releaseHolds(n)
        if (tv.games[n]) tv.games[n].freeze()
    }
    tv.places[winner] = 1
    const team = teamOf(winner)
    glog('match-over', { winner, team, how, lastOut, places: tv.places })
    socket.emit('tvGameOver', { winner, team, places: tv.places })
    const name = tv.names[winner]
    if (team != null) {
        const teamName = 'TEAM ' + TEAMS[team][0]
        const members = tv.roster.filter(n => teamOf(n) === team).map(n => tv.names[n]).join(', ')
        const reason = how === 'cleared' ? name + ' cleared all the viruses for ' + teamName + '. (' + members + ')'
            : teamName + ' is the last team standing! (' + members + ')'
        return showOverlay({ title: '🏆 VICTORY! 🏆', win: true, name: teamName + ' WINS!', reason, color: TEAMS[team][1] })
    }
    const reason = how === 'cleared' ? name + ' cleared all the viruses first.'
        : tv.roster.length === 2 ? tv.names[lastOut] + "'s bottle filled up."
        : name + ' is the last one standing!'
    showOverlay({ title: '🏆 VICTORY! 🏆', win: true, name: name + ' WINS!', reason })
}

/* ---------- Solo ---------- */

function soloLevelCleared(player) {
    const game = tv.games[player]
    if (!game || !game.board) return
    game.freeze()
    const img = document.createElement('img')
    img.src = game.getScSrc()
    img.id = 'sc'
    game.appendChild(img)
    socket.emit('tvFx', { player, kind: 'level' })
    setTimeout(() => socket.emit('tvNextLevel'), 2500)
}

socket.on('tvLevelData', ({ code, gameData }) => {
    if (code !== tv.code || !tv.solo || tv.finished) return
    const game = tv.games[tv.roster[0]]
    if (!game || !game.board) return
    const level = game.board.level + 1
    const score = game.board.score
    const sc = game.querySelector('#sc')
    if (sc) sc.remove()
    useGameData(gameData)
    game.restart(level, score)
})

function soloGameOver(player) {
    tv.finished = true
    setPaused(false)
    document.body.classList.remove('tv-playing')
    releaseHolds(player)
    const game = tv.games[player]
    if (game) game.freeze()
    const level = game && game.board ? game.board.level : 0
    const score = game && game.board ? game.board.score : 0
    glog('solo-game-over', { p: player, level, score })
    socket.emit('tvGameOver', { winner: null, places: { [player]: 1 }, level, score })
    showOverlay({
        title: '💀 GAME OVER',
        win: false,
        name: tv.names[player],
        reason: `Reached level ${String(level).padStart(2, '0')} with ${score} points.`,
    })
}

/* ---------- Result screen ---------- */

function closeOverlay() {
    const overlay = document.querySelector('.tv-victory')
    if (overlay) overlay.remove()
}

function showOverlay({ title, win, name, reason, color }) {
    closeOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'alert-overlay tv-victory'
    overlay.style.zIndex = '3000'
    const modal = document.createElement('div')
    modal.className = 'alert-modal'
    const handle = document.createElement('div')
    handle.className = 'tv-drag-handle'
    handle.textContent = '✥ DRAG TO MOVE'
    makeDraggable(modal)

    const titleEl = document.createElement('div')
    titleEl.className = 'alert-title ' + (win ? 'win' : 'lose')
    titleEl.textContent = title
    const nameEl = document.createElement('div')
    nameEl.className = 'alert-message tv-winner-name'
    nameEl.textContent = name
    if (color) nameEl.style.color = color
    const reasonEl = document.createElement('div')
    reasonEl.className = 'alert-message tv-victory-reason'
    reasonEl.textContent = reason

    // Each phone has a Rematch button; when everyone has pressed it, the next game starts
    const chips = document.createElement('div')
    chips.className = 'tv-rematch'
    for (const n of tv.roster) {
        const chip = document.createElement('div')
        chip.id = 'tvRematch' + n
        chip.className = 'tv-rematch-chip tv-p' + n
        chip.textContent = tv.names[n]
        chips.appendChild(chip)
    }
    const hint = document.createElement('div')
    hint.className = 'tv-rematch-hint'
    hint.textContent = tv.solo ? 'Press PLAY AGAIN on your phone (or A on your controller) to play again'
        : tv.roster.length === 2 ? 'Both press REMATCH on your phones (or A on your controllers) to play again'
        : 'Everyone press REMATCH on your phones (or A on your controllers) to play again'

    const buttons = document.createElement('div')
    buttons.className = 'tv-victory-buttons'
    const restart = document.createElement('button')
    restart.className = 'alert-button'
    restart.textContent = 'RESTART'
    // Same room, same players: the server deals new viruses and pills to everyone
    restart.onclick = () => {
        restart.disabled = true
        restart.textContent = 'STARTING...'
        socket.emit('tvRestart')
    }
    const exit = document.createElement('button')
    exit.className = 'alert-button secondary'
    exit.textContent = 'EXIT'
    // Reloading closes the room and goes back to the menu
    exit.onclick = () => { location.href = location.pathname }
    buttons.append(restart, exit)

    const logId = document.createElement('div')
    logId.className = 'log-id'
    logId.dataset.logId = ''
    logId.textContent = window.gameLog && window.gameLog.id ? 'Game log: ' + window.gameLog.id : ''
    modal.append(handle, titleEl, nameEl, reasonEl, chips, hint, buttons, logId)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    setTimeout(() => restart.focus(), 100)
}

/** Drag the result box out of the way (mouse or touch) to look at the boards behind it */
function makeDraggable(box) {
    let drag = null
    box.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return
        const rect = box.getBoundingClientRect()
        const [dx, dy] = box._offset || [0, 0]
        drag = { id: e.pointerId, x: e.clientX - dx, y: e.clientY - dy, base: { left: rect.left - dx, top: rect.top - dy, width: rect.width, height: rect.height } }
        try { box.setPointerCapture(e.pointerId) } catch (err) { /* no live pointer to capture (some touch screens): the drag still works */ }
        box.classList.add('dragging')
        e.preventDefault()
    })
    box.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return
        // Keep a corner of it on the screen so it can always be dragged back
        const { base } = drag
        const dx = Math.min(Math.max(e.clientX - drag.x, 80 - base.left - base.width), window.innerWidth - 80 - base.left)
        const dy = Math.min(Math.max(e.clientY - drag.y, 60 - base.top - base.height), window.innerHeight - 60 - base.top)
        box._offset = [dx, dy]
        box.style.transform = `translate(${dx}px, ${dy}px)`
    })
    const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return
        drag = null
        box.classList.remove('dragging')
    }
    box.addEventListener('pointerup', end)
    box.addEventListener('pointercancel', end)
}

// 🐞 on a phone: show who flagged it
socket.on('tvMarked', ({ player }) => {
    glog('marker-from-phone', { p: player })
    toast(player, `🐞 ${playerName(player)} FLAGGED A GLITCH`)
})

socket.on('tvRematch', ({ players }) => {
    for (const n of tv.roster) {
        const chip = $('tvRematch' + n)
        if (chip) chip.classList.toggle('ready', players.includes(n))
    }
})

/* ---------- Game controllers on this computer (scripts/gamepad.js) ---------- */

// A player can choose CONTROLLER on their phone instead of playing on it. Pressing A on
// a free controller makes it theirs (the player who has waited longest gets it), or they
// tap it in the list on their phone. A Pro Controller's lamps then show their player
// number. Everyone can have their own; its presses go to handleInput like the phone's.

function startControllers() {
    const input = window.padInput
    if (!input || tv.watchingPads) return
    tv.watchingPads = true
    input.onListChange((list) => {
        tv.controllerList = list.map(c => ({ key: c.key, name: c.name }))
        glog('controllers', { list: tv.controllerList })
        for (const [key, player] of [...tv.bindings]) {
            if (list.some(c => c.key === key)) continue
            unbind(key, false)
            toast(player, `🎮 ${playerName(player)}'S CONTROLLER DISCONNECTED`)
        }
        controllersChanged()
    })
    input.watchAll(onControllerInput)
}

function onControllerInput({ key, action, pressed, button }) {
    const player = tv.bindings.get(key)
    if (button === 'pause') {
        if (player && tv.alive.includes(player)) setPaused(!tv.paused, player)
        return
    }
    if (button === 'a') {
        if (player) {
            pingPlayer(player)
            return readyUp(player)
        }
        const next = waitingForController()[0]
        if (next) {
            bind(key, next)
            readyUp(next)
        }
        return
    }
    if (player) handleInput({ player, action, pressed }, 'controller ' + key)
}

/** Players who chose CONTROLLER and don't have one yet, longest-waiting first */
function waitingForController() {
    const taken = new Set(tv.bindings.values())
    return tv.lobby.filter(p => p.connected && p.input === 'controller' && !taken.has(p.player))
        .sort((a, b) => (a.inputAt || 0) - (b.inputAt || 0))
        .map(p => p.player)
}

function controllerOf(player) {
    for (const [key, p] of tv.bindings) if (p === player) return key
    return null
}

function bind(key, player) {
    for (const [k, p] of [...tv.bindings]) if (k === key || p === player) unbind(k, false)
    tv.bindings.set(key, player)
    glog('controller-paired', { key, name: padName(key), p: player })
    window.padInput.showPlayer(key, player)
    pingPlayer(player)
    controllersChanged()
    toast(player, `🎮 ${padName(key).toUpperCase()} ▸ ${playerName(player)}`)
}

/** A on your own controller: READY in the lobby, REMATCH on the result screen - as on your phone */
function readyUp(player) {
    const p = tv.lobby.find(q => q.player === player)
    if (!tv.started && p && !p.ready) {
        glog('ready-by-controller', { p: player })
        socket.emit('tvReadyFor', { player })
    } else if (tv.finished && tv.roster.includes(player)) {
        glog('rematch-by-controller', { p: player })
        socket.emit('tvRematchFor', { player })
    }
}

const padName = key => (tv.controllerList.find(c => c.key === key) || { name: 'Controller' }).name
const playerName = n => (tv.lobby.find(p => p.player === n) || { name: tv.names[n] || 'P' + n }).name

/** A big banner across the top of the TV for a moment, in the player's colour */
function toast(player, text) {
    let stack = $('tvToasts')
    if (!stack) {
        stack = document.createElement('div')
        stack.id = 'tvToasts'
        stack.className = 'tv-toasts'
        document.body.appendChild(stack)
    }
    const el = document.createElement('div')
    el.className = 'tv-toast tv-p' + player
    el.textContent = text
    stack.appendChild(el)
    const anim = el.animate([
        { opacity: 0, transform: 'scale(0.85)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.1 },
        { opacity: 1, transform: 'scale(1)', offset: 0.85 },
        { opacity: 0, transform: 'scale(1)' },
    ], { duration: 2800, easing: 'ease-out' })
    anim.onfinish = () => el.remove()
}

function unbind(key, announce = true) {
    const player = tv.bindings.get(key)
    if (!player) return
    tv.bindings.delete(key)
    glog('controller-unpaired', { key, p: player })
    handleInput({ player, action: 'all', pressed: false }, 'controller unbound') // let go of anything it was holding
    if (announce) controllersChanged()
}

// A phone tapped a controller in its list: theirs, unless someone else has it
socket.on('tvPickController', ({ player, key }) => {
    const owner = tv.bindings.get(key)
    if (!tv.controllerList.some(c => c.key === key) || (owner && owner !== player)) return sendControllers()
    bind(key, player)
})

/** Someone switched back to their phone, or left the room: their controller is free again */
function reconcileBindings() {
    let changed = false
    for (const [key, player] of [...tv.bindings]) {
        const p = tv.lobby.find(q => q.player === player)
        if (p && p.input === 'controller') continue
        unbind(key, false)
        changed = true
    }
    if (changed) controllersChanged()
}

function controllersChanged() {
    sendControllers()
    for (const n of tv.roster) showPadTag(n)
    if (!tv.started) renderLobby()
}

/** The phones show the list, and which one is whose */
function sendControllers() {
    if (tv.code) socket.emit('tvControllers', { list: tv.controllerList, bindings: Object.fromEntries(tv.bindings) })
}

/** The board's name tag: which controller this player is on */
function showPadTag(n) {
    const tag = $('tvPadTag' + n)
    if (!tag) return
    const key = controllerOf(n)
    tag.classList.toggle('hidden', !key)
    tag.textContent = key ? '🎮 ' + padName(key).toUpperCase() : ''
}

/** A bound controller pressed A: point at its player on the TV */
function pingPlayer(player) {
    const el = tv.started ? document.querySelector('#game' + player + ' .tv-name-tag') : $('tvSlot' + player)
    if (el && el.animate) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 300 })
}

function renderPads() {
    const input = window.padInput
    const count = tv.controllerList.length
    const canConnect = !!(input && input.canConnectHid())
    $('tvPadConnect').classList.toggle('hidden', !canConnect)
    $('tvPadCount').textContent = input && input.hidError ? "🎮 Couldn't open the controller (" + input.hidError + ')'
        : count ? `🎮 ${count} CONTROLLER${count > 1 ? 'S' : ''} READY. Choose CONTROLLER on your phone, then press A on yours.`
        : '🎮 Want to use a controller? Pair it with this computer over Bluetooth, then ' + (canConnect ? 'click CONNECT CONTROLLER.' : 'press A on it.')
}

// CONNECT CONTROLLER: Chrome's list of Pro Controllers (once per controller; Chrome remembers)
$('tvPadConnect').onclick = () => window.padInput && window.padInput.connectHid().then(renderPads)

/* ---------- Pictures of each board for the phones ---------- */

function sendToPhone(player, state) {
    const peer = tv.peers[player]
    if (peer && peer.channel && peer.channel.readyState === 'open') {
        try {
            peer.channel.send(JSON.stringify({ type: 'state', state }))
            return
        } catch (e) { /* fall through to the server */ }
    }
    socket.emit('tvState', { player, state })
}

setInterval(() => {
    if (tv.forFreePlay && tv.phoneFor) return sendFreePlayHold()
    if (!tv.started) return
    const now = Date.now()
    for (const n of tv.roster) {
        const game = tv.games[n]
        if (!game || !game.board || !tv.alive.includes(n) || tv.cpus.has(n)) continue
        const snap = game.board.snapshot()
        // The whole board for a phone that shows it; otherwise it still shows what's in HOLD
        const state = tv.boardForced || wantsBoard(n) ? snap : { h: snap.h, hu: snap.hu }
        state.t = tv.alive.length >= 2 && tv.targets[n] ? tv.names[tv.targets[n]] : null
        if (tv.paused) state.paused = true
        const key = JSON.stringify(state)
        const last = tv.sent[n]
        if (last && last.key === key && now - last.at < STATE_REFRESH_MS) continue
        tv.sent[n] = { key, at: now }
        sendToPhone(n, state)
    }
}, STATE_MS)

/** Free Play with a phone: its buttons are key presses on this page's board */
function phoneToFreePlay(action, pressed) {
    const send = (type, key) => document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }))
    if (action === 'all') return Object.values(TV_KEYS).forEach(key => send('keyup', key))
    const key = TV_KEYS[action]
    if (!key) return
    if (['left', 'right', 'drop'].includes(action)) return send(pressed ? 'keydown' : 'keyup', key)
    if (!pressed) return // a turn or a hold is once per press
    send('keydown', key)
    send('keyup', key)
}

/** ...and it still shows what's in HOLD */
function sendFreePlayHold() {
    const board = window.party && window.party.myBoard()
    if (!board || !board.fields) return
    const { h, hu } = board.snapshot()
    const key = JSON.stringify([h, hu])
    if (tv.sent.freePlay === key) return
    tv.sent.freePlay = key
    sendToPhone(tv.phoneFor, { h, hu })
}

/** Teams match: this player's team (an index into TEAMS), or null */
function teamOf(n) {
    return tv.teams && tv.teams.of && tv.teams.of[n] != null ? tv.teams.of[n] : null
}

/** This player switched SHOW MY GAME on, on their phone */
function wantsBoard(n) {
    const p = tv.lobby.find(q => q.player === n)
    return !!(p && p.showGame)
}

/* ---------- Direct links from the phones (WebRTC) ---------- */

function closePeer(player) {
    const peer = tv.peers[player]
    if (!peer) return
    try { peer.pc.close() } catch (e) {}
    delete tv.peers[player]
    showTvLink(player, false)
}

function showTvLink(player, direct) {
    const tag = $('tvLink' + player)
    if (tag) tag.classList.toggle('hidden', !direct)
}

socket.on('tvSignal', ({ player, description, candidate }) => {
    if (!(player >= 1 && player <= MAX_PLAYERS) || !window.RTCPeerConnection) return
    if (description && description.type === 'offer') {
        closePeer(player)
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
        const peer = tv.peers[player] = { pc, chain: Promise.resolve(), channel: null }
        pc.onicecandidate = (e) => { if (e.candidate && tv.peers[player] === peer) socket.emit('tvSignal', { player, candidate: e.candidate }) }
        pc.ondatachannel = (e) => {
            const channel = peer.channel = e.channel
            channel.onopen = () => {
                glog('direct-link', { p: player, open: true })
                showTvLink(player, true)
                delete tv.sent[player] // send the phone a full picture straight away
            }
            channel.onmessage = (m) => {
                try {
                    const data = JSON.parse(m.data)
                    handleInput({ player, action: String(data.action), pressed: !!data.pressed }, 'direct')
                } catch (err) {}
            }
            channel.onclose = () => {
                if (tv.peers[player] !== peer) return
                peer.channel = null
                showTvLink(player, false)
                glog('direct-link', { p: player, open: false })
                handleInput({ player, action: 'all', pressed: false }, 'direct link closed') // let go of anything held
            }
        }
        peer.chain = pc.setRemoteDescription(description)
            .then(() => pc.createAnswer())
            .then(answer => pc.setLocalDescription(answer))
            .then(() => socket.emit('tvSignal', { player, description: pc.localDescription }))
            .catch(() => closePeer(player))
    } else if (candidate && tv.peers[player]) {
        const peer = tv.peers[player]
        peer.chain = peer.chain.then(() => peer.pc.addIceCandidate(candidate)).catch(() => {})
    }
})

/* ---------- Start-up ---------- */

// Lost the server before the game started: the room is gone, so open a new one
socket.on('connect', () => {
    if (tv.code && !tv.started) {
        tv.code = null
        socket.emit('tvCreateRoom', { solo: tv.soloOnly })
    }
})

// /tv (or ?tv=new) opens straight into a new TV Room
if (new URLSearchParams(location.search).get('tv') === 'new') {
    history.replaceState(null, '', location.pathname)
    startTvRoom()
}
