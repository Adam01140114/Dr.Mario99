/**
 * DR. MARIO 99 - TV ROOM (the computer's side)
 * =============================================
 *
 * This page shows every player's board; each player scans the QR code and uses
 * their phone as the controller (controller.html). 1 to 8 players:
 *
 * - This page runs all the games. Each player attacks a target: the next player
 *   still in, going round the circle. A player whose bottle fills up is out and
 *   their board leaves the screen; the rest spread out to fill it. Clearing all
 *   your viruses wins outright; otherwise the last player left wins.
 * - One player plays solo: like single player, a cleared board is the next level.
 * - "Show game on phone screen" sends each player a picture of their own board
 *   (Board.snapshot()); it is always on with five or more players.
 * - Presses and pictures go straight between phone and this page over their
 *   Wi-Fi (WebRTC) when possible, through the server otherwise.
 *
 * Uses the page's globals: socket, roomCode, hideRoomCode().
 */

"use strict"
import { attackSent, attackReceived } from "./attackFx.js"

const MAX_PLAYERS = 8
const PHONE_SCREEN_ABOVE = 4   // more players than this: always show the game on the phones
const TV_KEYS = { left: 'a', right: 'd', rotateLeft: 'w', rotateRight: 'Shift', drop: 's', hold: 'c' }
const TV_REPEAT = { left: 166, right: 166, drop: 60 } // held-key repeat, as on the keyboard (Board.js)
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]
const BOARD_W = 960 + 14       // game-element plus its border
const BOARD_H = 576 + 14
const TAG_H = 70               // name tag over each board
const GAP = 40
const STATE_MS = 50            // board pictures to phones, at most 20 a second
const STATE_REFRESH_MS = 1500  // ...and resent now and then, for a phone that just came back

const $ = id => document.getElementById(id)

const tv = window.tvHost = {
    code: null,
    joinOrigin: null,
    lobby: [],          // players in the lobby, from the server
    qrUrl: null,
    seen: new Set(),    // "n:name" already shown, so only new names pop
    showOnPhoneChoice: false,
    started: false,
    finished: false,
    solo: false,
    showOnPhone: false,
    names: {},
    roster: [],         // players in this round
    alive: [],          // players still in
    targets: {},        // attacker -> target
    places: {},         // player -> finishing place
    games: {},          // player -> Game
    holds: {},          // player -> action -> repeat timer
    peers: {},          // player -> { pc, chain, channel }
    sent: {},           // player -> { key, at } last picture sent
    layout,
    sendAttack,
    playerFinished,
}

/* ---------- Lobby ---------- */

function startTvRoom() {
    document.body.classList.remove('ai-mode')
    hideRoomCode()
    $('tvLobby').classList.remove('hidden')
    socket.emit('tvCreateRoom')
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
    renderLobby()
})

socket.on('tvLobby', (data) => {
    if (data.code !== tv.code) return
    tv.lobby = data.players
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
        slot.innerHTML = '<span class="tv-slot-num"></span><span class="tv-slot-name"></span><span class="tv-slot-ready"></span>'
        slot.querySelector('.tv-slot-num').textContent = 'P' + p.player
        slot.querySelector('.tv-slot-name').textContent = p.name + (p.connected ? '' : ' (away)')
        slot.querySelector('.tv-slot-ready').textContent = p.ready ? '✔ READY' : 'NOT READY'
        slots.appendChild(slot)
    }
    // The next open slot: where the QR code sends the next phone
    let open = null
    for (let n = 1; n <= MAX_PLAYERS && open === null; n++) {
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
    $('tvCount').textContent = `${connected.length} / ${MAX_PLAYERS} PLAYERS`

    const qrCard = $('tvQrCard')
    if (open !== null && tv.code) {
        const url = `${tv.joinOrigin}/controller.html?room=${tv.code}&player=${open}`
        qrCard.classList.remove('hidden')
        qrCard.className = qrCard.className.replace(/\btv-p\d\b/g, '').trim() + ' tv-p' + open
        $('tvQrLabel').textContent = 'PLAYER ' + open + ': SCAN TO JOIN'
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

    // Five or more players: the game always shows on the phones
    const forced = connected.length > PHONE_SCREEN_ABOVE
    const box = $('tvShowOnPhone')
    box.disabled = forced
    box.checked = forced || tv.showOnPhoneChoice
    $('tvShowOnPhoneLabel').classList.toggle('locked', forced)
    $('tvShowOnPhoneNote').textContent = forced ? `Always on with ${PHONE_SCREEN_ABOVE + 1} or more players` : ''

    const start = $('tvStart')
    start.classList.toggle('hidden', connected.length === 0)
    start.lastChild.textContent = connected.length === 1 ? 'START SOLO' : 'START GAME'
}

function startTvGame() {
    const button = $('tvStart')
    button.disabled = true
    let virusCount = parseInt($('tvVirusCount').value, 10)
    if (isNaN(virusCount) || virusCount <= 0) virusCount = 5
    socket.emit('tvStartGame', { virusCount, showOnPhone: $('tvShowOnPhone').checked })
    setTimeout(() => { button.disabled = false }, 2000)
}

$('tvRoom').onclick = startTvRoom
$('tvStart').onclick = startTvGame
$('tvCancel').onclick = () => { location.href = location.pathname }
$('tvShowOnPhone').addEventListener('change', (e) => {
    if (!e.target.disabled) tv.showOnPhoneChoice = e.target.checked
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
    const first = !tv.started
    tv.started = true
    tv.finished = false
    tv.names = data.names
    tv.roster = data.roster.slice()
    tv.alive = data.roster.slice()
    tv.solo = tv.roster.length === 1
    tv.places = {}
    tv.showOnPhone = !!data.showOnPhone
    tv.sent = {}
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
        container.className = 'game-container'
        container.innerHTML = ''
        const tag = document.createElement('div')
        tag.className = 'tv-name-tag tv-p' + n
        tag.innerHTML = `<span class="tv-slot-num">P${n}</span><span id="tvName${n}"></span>`
            + `<span class="tv-link hidden" id="tvLink${n}" title="Controller connected straight over the Wi-Fi">⚡</span>`
            + `<span class="tv-target" id="tvTarget${n}"></span>`
        tag.querySelector('#tvName' + n).textContent = tv.names[n]
        container.appendChild(tag)
        const game = new Game(n, { isTVControlled: true })
        container.appendChild(game)
        tv.games[n] = game
        window.gameInstances[n] = game
        showTvLink(n, !!(tv.peers[n] && tv.peers[n].channel && tv.peers[n].channel.readyState === 'open'))
    }
    window.currentGame = tv.games[tv.roster[0]]
}

function removeGame(n) {
    releaseHolds(n)
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
    let best = { scale: 0, width: BOARD_W }
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols)
        const width = cols * BOARD_W + (cols - 1) * GAP
        const height = rows * (BOARD_H + TAG_H) + (rows - 1) * GAP
        const scale = Math.min((window.innerWidth - 32) / width, (window.innerHeight - 32) / height)
        if (scale > best.scale) best = { scale, width }
    }
    row.style.width = best.width + 'px'
    row.style.transform = `translate(-50%, -50%) scale(${Math.min(1.6, best.scale)})`
}
window.addEventListener('resize', layout)

/** Each player attacks the next player still in, round the circle */
function assignTargets() {
    tv.targets = {}
    const alive = tv.roster.filter(n => tv.alive.includes(n))
    if (alive.length >= 2) {
        alive.forEach((n, i) => { tv.targets[n] = alive[(i + 1) % alive.length] })
    }
    for (const n of tv.roster) {
        const tag = $('tvTarget' + n)
        // With two left it's obvious who you're attacking
        if (tag) tag.textContent = alive.length >= 3 && tv.targets[n] ? '▸ ' + tv.names[tv.targets[n]] : ''
    }
}

/** A player cleared 4+: their target gets junk (called by Board.js) */
function sendAttack(from, points) {
    if (!tv.started || tv.finished) return
    const target = tv.targets[from]
    const game = target && tv.alive.includes(target) && tv.games[target]
    if (!game || !game.board) return
    if (game.board.receiveDamage(points)) {
        attackSent(from, target)
        attackReceived(target, from)
    }
}

// A phone button went down or up: move that player's pill, repeating while held.
// Presses arrive over the direct Wi-Fi link when there is one, else through the server.
socket.on('tvInput', handleInput)
function handleInput({ player, action, pressed }) {
    const holds = tv.holds[player]
    if (!holds) return
    if (action === 'all') return releaseHolds(player)
    if (!tv.started || tv.finished || !tv.alive.includes(player)) return
    const key = TV_KEYS[action]
    if (!key) return
    if (!pressed) {
        clearInterval(holds[action])
        delete holds[action]
        return
    }
    if (holds[action]) return
    const move = () => {
        const game = tv.games[player]
        if (game && game.board && !tv.finished) game.board.movementFromKey(key)
    }
    move()
    if (TV_REPEAT[action]) holds[action] = setInterval(move, TV_REPEAT[action])
}

function releaseHolds(player) {
    for (const id of Object.values(tv.holds[player] || {})) clearInterval(id)
    tv.holds[player] = {}
}

/** Game.js: a board cleared its last virus (won) or filled up (lost) */
function playerFinished(player, won) {
    if (!tv.started || tv.finished || !tv.alive.includes(player)) return
    if (tv.solo) return won ? soloLevelCleared(player) : soloGameOver(player)
    if (won) return endMatch(player, 'cleared')
    eliminate(player)
}

function eliminate(player) {
    const place = tv.alive.length
    tv.places[player] = place
    tv.alive = tv.alive.filter(n => n !== player)
    releaseHolds(player)
    const game = tv.games[player]
    if (game) game.freeze()
    socket.emit('tvEliminated', { player, place })
    if (tv.alive.length === 1) return endMatch(tv.alive[0], 'last', player)

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
    for (const n of tv.roster) {
        releaseHolds(n)
        if (tv.games[n]) tv.games[n].freeze()
    }
    tv.places[winner] = 1
    socket.emit('tvGameOver', { winner, places: tv.places })
    const name = tv.names[winner]
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
    releaseHolds(player)
    const game = tv.games[player]
    if (game) game.freeze()
    const level = game && game.board ? game.board.level : 0
    const score = game && game.board ? game.board.score : 0
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

function showOverlay({ title, win, name, reason }) {
    closeOverlay()
    const overlay = document.createElement('div')
    overlay.className = 'alert-overlay tv-victory'
    overlay.style.zIndex = '3000'
    const modal = document.createElement('div')
    modal.className = 'alert-modal'

    const titleEl = document.createElement('div')
    titleEl.className = 'alert-title ' + (win ? 'win' : 'lose')
    titleEl.textContent = title
    const nameEl = document.createElement('div')
    nameEl.className = 'alert-message tv-winner-name'
    nameEl.textContent = name
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
    hint.textContent = tv.solo ? 'Press PLAY AGAIN on your phone to play again'
        : tv.roster.length === 2 ? 'Both press REMATCH on your phones to play again'
        : 'Everyone press REMATCH on your phones to play again'

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

    modal.append(titleEl, nameEl, reasonEl, chips, hint, buttons)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    setTimeout(() => restart.focus(), 100)
}

socket.on('tvRematch', ({ players }) => {
    for (const n of tv.roster) {
        const chip = $('tvRematch' + n)
        if (chip) chip.classList.toggle('ready', players.includes(n))
    }
})

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
    if (!tv.started) return
    const now = Date.now()
    for (const n of tv.roster) {
        const game = tv.games[n]
        if (!game || !game.board || !tv.alive.includes(n)) continue
        const snap = game.board.snapshot()
        // Without the phone screen, the phone still shows what's in HOLD
        const state = tv.showOnPhone ? snap : { h: snap.h, hu: snap.hu }
        state.t = tv.alive.length >= 2 && tv.targets[n] ? tv.names[tv.targets[n]] : null
        const key = JSON.stringify(state)
        const last = tv.sent[n]
        if (last && last.key === key && now - last.at < STATE_REFRESH_MS) continue
        tv.sent[n] = { key, at: now }
        sendToPhone(n, state)
    }
}, STATE_MS)

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
                showTvLink(player, true)
                delete tv.sent[player] // send the phone a full picture straight away
            }
            channel.onmessage = (m) => {
                try {
                    const data = JSON.parse(m.data)
                    handleInput({ player, action: String(data.action), pressed: !!data.pressed })
                } catch (err) {}
            }
            channel.onclose = () => {
                if (tv.peers[player] !== peer) return
                peer.channel = null
                showTvLink(player, false)
                handleInput({ player, action: 'all', pressed: false }) // let go of anything held
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
        socket.emit('tvCreateRoom')
    }
})

// /tv (or ?tv=new) opens straight into a new TV Room
if (new URLSearchParams(location.search).get('tv') === 'new') {
    history.replaceState(null, '', location.pathname)
    startTvRoom()
}
