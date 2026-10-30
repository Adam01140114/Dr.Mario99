/**
 * DR. MARIO 99 - MULTIPLAYER AND FREE PLAY (this page's side)
 * ===========================================================
 *
 * Up to 8 players, each on their own screen. This page runs its own board
 * (keyboard, touch buttons or a controller - no lag, it's all local) and the
 * boards of any CPUs it hosts, and shows everyone else's boards small,
 * from what their screens send (the server's PARTIES section).
 *
 * - MULTIPLAYER: CREATE ROOM (you're the host) or JOIN ROOM with a code or a
 *   link (/?party=CODE). The host adds CPUs, removes players, sets the
 *   viruses and starts the match - and the next one, from the results.
 * - FREE PLAY: matched with another player, or after a few seconds with a CPU
 *   that has an ordinary name (its board runs here, hidden).
 * - In a match: a clear of 4+ sends junk to your target, the next player
 *   still in round the circle; a full bottle is out; clearing your board or
 *   being the last one left wins.
 *
 * window.party: openMenu(), startFreePlay(); attack() / finished() (from
 * Board.js and Game.js); layout().
 * Uses the page's globals: socket.
 */

"use strict"
import { attackSent, attackReceived } from "./attackFx.js"
import { startCpu } from "./cpuPlayer.js"
import { SPRITE_CODES } from "./components.js"

const $ = id => document.getElementById(id)
const glog = (type, details) => window.gameLog && window.gameLog.event(type, details) // scripts/gameLog.js
const PLAYER_COLORS = ['#ff4d6d', '#4dc3ff', '#ffd60a', '#00ff66', '#c77dff', '#ff9f1c', '#2ee6d6', '#ff70d9']
const BOARD_MS = 200     // how often this page sends its boards' changes to the others
const KEYFRAME_MS = 2000 // ...and a full picture this often, for anyone who missed some
const BOARD_W = 960 + 14
const BOARD_H = 576 + 14
const BOTTLE = { x: 383, y: 48, w: 258, h: 505 } // what shows of the board on a phone (index.html: the clip-path)
const HUD_W = 80         // the columns of numbers either side of the bottle on a phone
const HUD_MS = 120

const party = window.party = {
    code: null,
    slot: null,
    hostSlot: null,
    players: [],
    state: null,
    freePlay: false,
    settings: {},
    match: null,     // the match on now: { roster, names, cpus, disguised, targets, alive, games, ... }
    openMenu,
    startFreePlay,
    myBoard: () => { const game = party.match && party.match.games[party.slot]; return game && game.board },
    attack,
    finished,
    layout,
}

const clientId = (() => {
    const make = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
    try {
        let id = localStorage.getItem('partyClientId')
        if (!id) localStorage.setItem('partyClientId', id = make())
        return id
    } catch (e) {
        return make()
    }
})()

function savedName() {
    try { return localStorage.getItem('mpName') || '' } catch (e) { return '' }
}
function saveName(name) {
    try { localStorage.setItem('mpName', name) } catch (e) { /* not remembered */ }
}
function nameFromInput() {
    const name = $('mpName').value.trim().replace(/\s+/g, ' ').slice(0, 16) || savedName() || 'Player ' + Math.floor(100 + Math.random() * 900)
    saveName(name)
    $('mpName').value = name
    return name
}

/* ---------- MULTIPLAYER: create or join ---------- */

function openMenu(code) {
    hide('partyLobby')
    $('mpError').textContent = ''
    $('mpName').value = savedName()
    $('mpJoinRow').classList.toggle('hidden', !code)
    $('mpCode').value = code || ''
    show('mpMenu')
    setTimeout(() => (savedName() ? (code ? $('mpJoinGo') : $('mpCreate')) : $('mpName')).focus(), 50)
}

$('mpCreate').onclick = () => {
    $('mpError').textContent = ''
    socket.emit('partyCreate', { name: nameFromInput(), clientId, virusCount: 5 })
}
$('mpJoin').onclick = () => {
    $('mpJoinRow').classList.remove('hidden')
    $('mpCode').focus()
}
$('mpJoinGo').onclick = () => {
    const code = $('mpCode').value.trim().toUpperCase()
    if (!/^[A-Z]{4}$/.test(code)) return void ($('mpError').textContent = 'Room codes are 4 letters.')
    $('mpError').textContent = ''
    socket.emit('partyJoin', { code, name: nameFromInput(), clientId })
}
$('mpCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mpJoinGo').click() })
$('mpName').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('mpJoinRow').classList.contains('hidden') ? $('mpCreate') : $('mpJoinGo')).click() })
$('mpBack').onclick = () => hide('mpMenu')

socket.on('partyError', ({ message }) => {
    $('mpError').textContent = message
    $('partyLobbyError').textContent = message
    hide('freeSearch')
})

// Someone else on the site might press FREE PLAY too: wait a moment for them
socket.on('freePlaySearching', () => { $('freeSearchText').textContent = 'Looking for another player...' })

socket.on('partyJoined', ({ code, slot, rejoined, state }) => {
    party.code = code
    party.slot = slot
    glog('party-joined', { code, slot, rejoined: !!rejoined, state })
    hide('mpMenu')
    if (rejoined && party.match) return // the match carried on here; back in the room
    if (!party.freePlay) show('partyLobby')
})

/* ---------- The room ---------- */

socket.on('partyLobby', (data) => {
    if (data.code !== party.code) return
    party.players = data.players
    party.hostSlot = data.hostSlot
    party.state = data.state
    party.freePlay = data.freePlay
    party.settings = data.settings
    if (party.freePlay) {
        $('freeSearchText').textContent = 'Match found! Get ready...'
        return
    }
    renderLobby()
    renderResultButtons()
})

function isHost() {
    return party.slot != null && party.slot === party.hostSlot
}

function renderLobby() {
    $('partyCode').textContent = party.code
    const link = location.origin + '/?party=' + party.code
    $('partyLink').textContent = link
    const list = $('partyPlayers')
    list.innerHTML = ''
    for (const p of party.players) {
        const row = document.createElement('div')
        row.className = 'party-player' + (p.connected ? '' : ' away')
        row.style.setProperty('--c', PLAYER_COLORS[(p.slot - 1) % 8])
        row.innerHTML = '<span class="dot"></span><span class="name"></span><span class="tags"></span>'
        row.querySelector('.name').textContent = p.name
        row.querySelector('.tags').textContent = [p.host ? '👑 HOST' : '', p.cpu ? '🤖 CPU' : '', p.slot === party.slot ? '(YOU)' : '', p.connected ? '' : 'AWAY'].filter(Boolean).join('  ')
        if (isHost() && p.slot !== party.slot) {
            const kick = document.createElement('button')
            kick.type = 'button'
            kick.className = 'party-kick'
            kick.title = 'Remove ' + p.name
            kick.textContent = '✕'
            kick.onclick = () => socket.emit('partyKick', { slot: p.slot })
            row.appendChild(kick)
        }
        list.appendChild(row)
    }
    $('partyCount').textContent = `${party.players.length} / 8 PLAYERS`
    const host = isHost()
    $('partyHostControls').classList.toggle('hidden', !host)
    $('partyWaiting').classList.toggle('hidden', host)
    const hostName = (party.players.find(p => p.host) || {}).name || 'the host'
    $('partyWaiting').textContent = 'Waiting for ' + hostName + ' to start the match...'
    if (host && document.activeElement !== $('partyViruses')) $('partyViruses').value = party.settings.virusCount || 5
    $('partyStart').disabled = party.players.length < 2
    $('partyAddCpu').disabled = party.players.length >= 8
    $('partyStartHint').textContent = party.players.length < 2 ? 'Share the code, or add a CPU to play now.' : ''
}

$('partyStart').onclick = () => {
    $('partyLobbyError').textContent = ''
    socket.emit('partyStart')
}
$('partyAddCpu').onclick = () => socket.emit('partyAddCpu')
$('partyViruses').addEventListener('change', () => socket.emit('partySettings', { virusCount: $('partyViruses').value }))
$('partyLeave').onclick = () => {
    socket.emit('partyLeave')
    location.href = location.pathname
}
$('partyCopy').onclick = function () {
    const link = $('partyLink').textContent
    const done = () => {
        this.textContent = '✅ COPIED!'
        setTimeout(() => { this.textContent = '📋 COPY INVITE LINK' }, 1800)
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link))
    else prompt('Copy this link:', link)
}

socket.on('partyKicked', () => {
    glog('party-kicked', { code: party.code })
    teardownMatch()
    party.code = null
    hide('partyLobby')
    removeResults()
    // Back to the menu
    document.body.classList.remove('party-mode', 'in-game')
    $('playbuttons').classList.remove('hidden')
    $('touchControls').classList.add('hidden')
    if (window.padInput) window.padInput.stop()
    showNotice('The host removed you from the room.')
})

/* ---------- FREE PLAY ---------- */

function startFreePlay() {
    party.freePlay = true
    $('freeSearchText').textContent = 'Finding a match...'
    show('freeSearch')
    socket.emit('freePlay', { name: savedName() || nameFromInput(), clientId })
}
$('freeCancel').onclick = () => {
    socket.emit('freePlayCancel')
    party.freePlay = false
    hide('freeSearch')
}

/* ---------- A match ---------- */

socket.on('partyStarted', (data) => startMatch(data))

async function startMatch(data) {
    const { default: Game } = await import('./Game.js')
    teardownMatch()
    removeResults()
    for (const id of ['mpMenu', 'partyLobby', 'freeSearch']) hide(id)
    $('playbuttons').classList.add('hidden')
    document.body.classList.add('party-mode', 'in-game')
    party.code = data.code
    party.slot = data.slot
    party.freePlay = !!data.freePlay

    // Everyone gets the same viruses and the same pills; each board here walks the pill list itself
    window.sharedGameData = data.gameData
    window.myRandomList = [...data.gameData.randomList]
    window.numberPosition = 1
    const mine = Object.keys(data.cpus).map(Number).filter(n => data.cpus[n] === data.slot)
    const local = [data.slot, ...mine]
    window.tvColorPositions = Object.fromEntries(local.map(n => [n, 1]))

    const match = party.match = {
        round: data.round, roster: data.roster, names: data.names, cpus: data.cpus, disguised: new Set(data.disguised || []),
        targets: data.targets, alive: new Set(data.roster), local, games: {}, cpuStops: {}, sent: {}, views: {}, places: {},
    }
    window.gameInstances = match.games

    // My board, then the CPUs this page runs (hidden: they show as opponents like anyone else)
    const row = document.querySelector('.ai-boards-row')
    for (const n of local) {
        const container = containerFor(n)
        container.className = 'game-container party-board'
        container.innerHTML = ''
        if (n === data.slot) row.appendChild(container)
        else $('partyCpuBoards').appendChild(container)
        const game = new Game(n, { party: true, cpu: n !== data.slot })
        container.appendChild(game)
        match.games[n] = game
        if (n !== data.slot) match.cpuStops[n] = startCpu(game, Math.random())
    }
    window.currentGame = match.games[data.slot]

    makeOpponents()
    $('touchControls').classList.remove('hidden')
    if (window.padInput) window.padInput.start() // a controller works here too
    if (window.gameLog) window.gameLog.begin('party', { freePlay: party.freePlay, code: data.code, slot: data.slot, round: data.round, roster: data.roster, names: data.names, cpus: mine, freePlay: party.freePlay, gameData: data.gameData })
    glog('party-match-start', { roster: data.roster, names: data.names, targets: data.targets, local })
    match.sender = setInterval(sendBoards, BOARD_MS)
    match.hud = setInterval(updateHud, HUD_MS)
    layout()
    setTimeout(layout, 50)
}

function containerFor(n) {
    let container = $('game' + n)
    if (!container) {
        container = document.createElement('div')
        container.id = 'game' + n
    }
    return container
}

function teardownMatch() {
    const match = party.match
    if (!match) return
    clearInterval(match.sender)
    clearInterval(match.hud)
    for (const stop of Object.values(match.cpuStops)) stop()
    const row = document.querySelector('.ai-boards-row')
    for (const [n, game] of Object.entries(match.games)) {
        game.teardown()
        const container = $('game' + n)
        if (!container) continue
        container.innerHTML = ''
        container.removeAttribute('style')
        // #game1 and #game2 belong to the page (other modes use them)
        if (+n <= 2) {
            container.className = 'game-container hidden'
            row.appendChild(container)
        } else {
            container.remove()
        }
    }
    party.match = null
    $('partyOpponents').innerHTML = ''
}

/* ---------- Sending my boards, showing everyone else's ---------- */

function gridOf(board) {
    let grid = ''
    for (let y = board.height - 1; y >= 0; y--)
        for (let x = 0; x < board.width; x++)
            grid += board.fields[x][y].spriteCode || '.'
    return grid
}

function sendBoards() {
    const match = party.match
    if (!match) return
    const now = Date.now()
    for (const n of match.local) {
        const game = match.games[n]
        const board = game && game.board
        if (!board || !board.fields) continue
        const grid = gridOf(board)
        const hud = board.virusCount + ',' + board.score
        const last = match.sent[n]
        let payload = null
        if (!last || now - last.at >= KEYFRAME_MS) payload = { slot: n, g: grid, h: hud }
        else if (grid !== last.grid || hud !== last.hud) {
            let diff = ''
            for (let i = 0; i < grid.length; i++) if (grid[i] !== last.grid[i]) diff += (diff ? ';' : '') + i + ',' + grid[i]
            payload = { slot: n, ...(diff ? { d: diff } : {}), ...(hud !== last.hud ? { h: hud } : {}) }
        }
        if (!payload) continue
        match.sent[n] = { grid, hud, at: payload.g ? now : last.at }
        socket.emit('partyBoard', payload)
        if (n !== party.slot) showBoard(payload) // my own CPUs: straight into my opponent view
    }
}

socket.on('partyBoard', (payload) => showBoard(payload))

const sprites = SPRITE_CODES.map((name) => {
    const img = new Image()
    img.src = '/img/' + name + '.png'
    return img
})

function makeOpponents() {
    const match = party.match
    const panel = $('partyOpponents')
    panel.innerHTML = ''
    for (const n of match.roster) {
        if (n === party.slot) continue
        const card = document.createElement('div')
        card.className = 'op-card'
        card.id = 'op' + n
        card.style.setProperty('--c', PLAYER_COLORS[(n - 1) % 8])
        card.innerHTML = '<div class="op-name"><span class="op-dot"></span><span class="op-label"></span></div>'
            + '<canvas width="192" height="408"></canvas><div class="op-info"><span class="op-virus">VIRUS --</span><span class="op-target"></span></div><div class="op-status hidden"></div>'
        const isCpu = n in match.cpus && !match.disguised.has(n) // Free Play's CPUs look like anyone else
        card.querySelector('.op-label').textContent = match.names[n]
        if (isCpu) card.querySelector('.op-label').insertAdjacentHTML('afterbegin', '<span class="op-bot">🤖 </span>')
        panel.appendChild(card)
        match.views[n] = { grid: null, ctx: card.querySelector('canvas').getContext('2d'), card }
    }
    showTargets()
}

function showBoard({ slot, g, d, h }) {
    const view = party.match && party.match.views[slot]
    if (!view) return
    if (g) view.grid = g
    else if (d && view.grid) {
        const cells = view.grid.split('')
        for (const part of d.split(';')) {
            const [i, ch] = part.split(',')
            cells[+i] = ch
        }
        view.grid = cells.join('')
    }
    if (h) view.card.querySelector('.op-virus').textContent = 'VIRUS ' + String(h.split(',')[0]).padStart(2, '0')
    if (!view.grid) return
    const ctx = view.ctx
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, 192, 408)
    for (let i = 0; i < view.grid.length; i++) {
        const code = view.grid.charCodeAt(i)
        if (code === 46) continue
        const img = sprites[code - 97]
        if (img && img.complete && img.naturalWidth) ctx.drawImage(img, (i % 8) * 24, Math.floor(i / 8) * 24, 24, 24)
    }
}

/** Who I attack, and who attacks me */
function showTargets() {
    const match = party.match
    if (!match) return
    for (const [n, view] of Object.entries(match.views)) {
        const attacksMe = match.targets[n] === party.slot && match.alive.has(+n)
        const mine = match.targets[party.slot] === +n && match.alive.has(party.slot)
        view.card.classList.toggle('target', mine)
        view.card.querySelector('.op-target').textContent = mine ? '▸ YOUR TARGET' : attacksMe ? '⚔ ATTACKING YOU' : ''
    }
}

/* ---------- Attacks, outs and the result ---------- */

/** Board.js: one of my boards cleared 4+ */
function attack(slot, points, color) {
    const match = party.match
    if (!match || !match.alive.has(slot)) return
    glog('attack', { from: slot, target: match.targets[slot], points, color })
    socket.emit('partyAttack', { slot, points, color })
    if (slot === party.slot) attackSent(slot, match.targets[slot], color)
}

socket.on('partyJunk', ({ slot, from, points, color }) => {
    const game = party.match && party.match.games[slot]
    if (!game || !game.board) return
    const counted = game.board.receiveDamage(points, color)
    glog('junk-incoming-from', { p: slot, from, points, color, counted })
    if (counted && slot === party.slot) attackReceived(slot, from, color)
})

socket.on('partyFx', ({ from, to }) => {
    for (const [n, kind] of [[from, 'attacking'], [to, 'hit']]) {
        const view = party.match && party.match.views[n]
        if (!view || !view.card.animate) continue
        view.card.animate(kind === 'hit'
            ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }]
            : [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 300 })
    }
})

/** Game.js: one of my boards filled up (won = false) or cleared every virus (won = true) */
function finished(slot, won) {
    const match = party.match
    if (!match) return
    const game = match.games[slot]
    if (game) game.freeze()
    glog(won ? 'party-cleared' : 'party-topped-out', { p: slot })
    socket.emit(won ? 'partyCleared' : 'partyOut', { slot })
}

socket.on('partyEliminated', ({ slot, place, targets }) => {
    const match = party.match
    if (!match) return
    match.alive.delete(slot)
    match.targets = targets
    match.places[slot] = place
    glog('eliminated', { p: slot, place, alive: [...match.alive] })
    const game = match.games[slot]
    if (game) game.freeze()
    if (match.cpuStops[slot]) match.cpuStops[slot]()
    const view = match.views[slot]
    if (view) {
        view.card.classList.add('out')
        const status = view.card.querySelector('.op-status')
        status.textContent = 'OUT #' + place
        status.classList.remove('hidden')
    }
    if (slot === party.slot) showNotice(`You're out! #${place}. Watch the rest...`, 3000)
    showTargets()
})

socket.on('partyOver', ({ winner, how, places, names }) => {
    const match = party.match
    glog('match-over', { winner, how, places })
    if (match) {
        clearInterval(match.sender)
        sendBoards() // a last picture of every board
        for (const game of Object.values(match.games)) game.freeze()
        for (const stop of Object.values(match.cpuStops)) stop()
        if (winner && match.views[winner]) {
            const status = match.views[winner].card.querySelector('.op-status')
            status.textContent = '🏆 WINNER'
            status.classList.remove('hidden')
            match.views[winner].card.classList.add('winner')
        }
    }
    if (window.padInput) window.padInput.stop()
    showResults({ winner, how, places, names })
})

function showResults({ winner, how, places, names }) {
    removeResults()
    const won = winner === party.slot
    const overlay = document.createElement('div')
    overlay.className = 'alert-overlay party-results'
    overlay.id = 'partyResults'
    const modal = document.createElement('div')
    modal.className = 'alert-modal'
    const title = document.createElement('div')
    title.className = 'alert-title ' + (won ? 'win' : 'lose')
    title.textContent = won ? '🏆 VICTORY!' : '💀 GAME OVER'
    const message = document.createElement('div')
    message.className = 'alert-message'
    message.textContent = won ? (how === 'cleared' ? 'You cleared every virus first!' : 'You outlasted everyone!')
        : winner ? names[winner] + (how === 'cleared' ? ' cleared every virus first.' : ' is the last one standing.') : 'Nobody won this one.'
    const standings = document.createElement('ol')
    standings.className = 'party-standings'
    const order = Object.keys(names).map(Number).sort((a, b) => (places[a] || 99) - (places[b] || 99))
    for (const n of order) {
        const li = document.createElement('li')
        li.style.color = PLAYER_COLORS[(n - 1) % 8]
        li.textContent = (places[n] ? '#' + places[n] + '  ' : '') + names[n] + (n === party.slot ? ' (YOU)' : '')
        standings.appendChild(li)
    }
    const buttons = document.createElement('div')
    buttons.className = 'party-result-buttons'
    buttons.id = 'partyResultButtons'
    const logId = document.createElement('div')
    logId.className = 'log-id'
    logId.dataset.logId = ''
    logId.textContent = window.gameLog && window.gameLog.id ? 'Game log: ' + window.gameLog.id : ''
    modal.append(title, message, standings, buttons, logId)
    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    if (window.gameLog) window.gameLog.event('result-shown', { title: title.textContent, message: message.textContent, win: won })
    renderResultButtons()
}

function renderResultButtons() {
    const buttons = $('partyResultButtons')
    if (!buttons) return
    buttons.innerHTML = ''
    const button = (text, onclick, secondary) => {
        const b = document.createElement('button')
        b.className = 'alert-button' + (secondary ? ' secondary' : '')
        b.type = 'button'
        b.textContent = text
        b.onclick = onclick
        buttons.appendChild(b)
        return b
    }
    if (party.freePlay) {
        button('🔍 FIND ANOTHER MATCH', () => {
            socket.emit('partyLeave')
            teardownMatch()
            removeResults()
            startFreePlay()
        })
    } else if (isHost()) {
        button('▶ PLAY AGAIN', () => socket.emit('partyStart'))
        button('BACK TO THE ROOM', () => {
            teardownMatch()
            removeResults()
            document.body.classList.remove('party-mode', 'in-game')
            renderLobby()
            show('partyLobby')
        }, true)
    } else {
        const wait = document.createElement('div')
        wait.className = 'alert-message party-wait'
        wait.textContent = 'Waiting for ' + ((party.players.find(p => p.host) || {}).name || 'the host') + ' to start the next match...'
        buttons.appendChild(wait)
    }
    const share = button('📣 SHARE THIS GAME', () => window.shareGame('share', share), true)
    button('LEAVE', () => {
        socket.emit('partyLeave')
        location.href = location.pathname
    }, true)
}

function removeResults() {
    const old = $('partyResults')
    if (old) old.remove()
}

/* ---------- Screen layout ---------- */

// My board as big as fits next to (or, on a phone, under) the others' boards
function layout() {
    const match = party.match
    if (!match || !document.body.classList.contains('party-mode')) return
    const container = $('game' + party.slot)
    if (!container) return
    const panel = $('partyOpponents')
    const count = Object.keys(match.views).length
    const phone = innerWidth <= 768 || (innerHeight <= 500 && matchMedia('(pointer: coarse)').matches)
    document.body.classList.toggle('phone-play', phone)
    if (phone) return layoutPhone(container, panel, count)
    const narrow = innerWidth < 900
    let panelW = 0, panelH = 0
    if (narrow) {
        panelH = count ? Math.min(150, innerHeight * 0.22) : 0
        panel.style.cssText = `left:0;right:0;top:0;height:${panelH}px;width:auto`
    } else {
        panelW = count ? Math.round(Math.min(innerWidth * (count === 1 ? 0.3 : 0.38), 620)) : 0
        panel.style.cssText = `top:0;right:0;bottom:0;width:${panelW}px`
    }
    sizeCards(panel, count, narrow ? innerWidth : panelW, narrow ? panelH : innerHeight)
    const touch = narrow && innerWidth <= 768 ? 190 : 0 // the touch buttons along the bottom
    const availW = innerWidth - panelW - 24
    const availH = innerHeight - panelH - touch - 24
    const scale = Math.max(0.2, Math.min(1.3, availW / BOARD_W, availH / BOARD_H))
    container.style.position = 'fixed'
    container.style.margin = '0'
    container.style.transformOrigin = 'top left'
    container.style.transform = `scale(${scale})`
    container.style.left = Math.round(12 + (availW - BOARD_W * scale) / 2) + 'px'
    container.style.top = Math.round(panelH + 12 + (availH - BOARD_H * scale) / 2) + 'px'
}
window.addEventListener('resize', layout)

/** A phone: just the bottle, as big as fits between the other players and the buttons */
function layoutPhone(container, panel, count) {
    const landscape = innerWidth > innerHeight
    document.body.classList.toggle('phone-landscape', landscape)
    const controls = $('touchControls')
    const controlsH = controls.offsetHeight
    document.body.style.setProperty('--party-controls', controlsH + 'px')
    const room = (w, h) => Math.min(h / BOTTLE.h, (w - 2 * HUD_W - 16) / BOTTLE.w)
    let area
    panel.classList.toggle('many', count >= 4)
    if (landscape) {
        const scale = room(innerWidth - 2 * 170, innerHeight - 12)
        const center = BOTTLE.w * scale + 2 * HUD_W + 16
        const side = (innerWidth - center) / 2
        controls.style.setProperty('--party-center', center + 'px')
        area = { x: side, y: 6, w: center, h: innerHeight - 12 }
        const h = innerHeight - controlsH
        panel.style.cssText = `left:0;top:0;width:${side}px;height:${h}px`
        sizeCardsToFit(panel, count, side, h)
    } else {
        const strip = count ? Math.round(Math.min(92, innerHeight * 0.13)) : 0
        area = { x: 0, y: strip + 6, w: innerWidth, h: innerHeight - strip - controlsH - 12 }
        panel.style.cssText = `left:0;right:0;top:0;height:${strip}px`
        const cell = (strip - 12 - (count >= 4 ? 14 : 0)) / 17
        for (const canvas of panel.querySelectorAll('canvas')) {
            canvas.style.width = cell * 8 + 'px'
            canvas.style.height = cell * 17 + 'px'
        }
    }
    const scale = room(area.w, area.h)
    const left = area.x + (area.w - BOTTLE.w * scale) / 2
    const top = area.y + (area.h - BOTTLE.h * scale) / 2
    container.style.position = 'fixed'
    container.style.margin = '0'
    container.style.transformOrigin = 'top left'
    container.style.transform = `scale(${scale})`
    container.style.left = Math.round(left - BOTTLE.x * scale) + 'px'
    container.style.top = Math.round(top - BOTTLE.y * scale) + 'px'
    $('hudLeft').style.cssText = `left:${left - HUD_W - 6}px;top:${top}px;width:${HUD_W}px`
    $('hudRight').style.cssText = `left:${left + BOTTLE.w * scale + 6}px;top:${top}px;width:${HUD_W}px`
    updateHud()
}

/** On a phone: what the board's side panels would show */
function updateHud() {
    const match = party.match
    const game = match && match.games[party.slot]
    if (!game || !game.board || !game.board.fields || !document.body.classList.contains('phone-play')) return
    const { v, s, l, n, h, hu } = game.board.snapshot()
    setText('hudVirus', String(v).padStart(2, '0'))
    setText('hudScore', String(s))
    setText('hudLevel', String(l))
    setPill('hudNext', n)
    setPill('hudHold', h)
    $('hudHold').classList.toggle('used', !!hu)
}

function setText(id, text) {
    const el = $(id)
    if (el.textContent !== text) el.textContent = text
}

function setPill(id, colors) {
    const el = $(id)
    const key = colors ? colors.join() : ''
    if (el.dataset.pill === key) return
    el.dataset.pill = key
    el.innerHTML = ''
    if (colors) colors.forEach((color, i) => {
        const img = document.createElement('img')
        img.alt = ''
        img.src = `./img/${color}_${i ? 'right' : 'left'}.png`
        el.appendChild(img)
    })
}

function sizeCards(panel, count, width, height) {
    if (!count) return
    if (innerWidth >= 900) return sizeCardsToFit(panel, count, width, height)
    setCardCell(panel, Math.min(26, Math.max(3, Math.floor((height - 34) / 17))))
}

function sizeCardsToFit(panel, count, width, height) {
    if (!count) return
    let cell = 4
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols)
        const w = (width - 24 - (cols - 1) * 12) / cols
        const h = (height - 24 - (rows - 1) * 12) / rows - 44
        cell = Math.max(cell, Math.floor(Math.min(w / 8, h / 17)))
    }
    setCardCell(panel, Math.min(cell, 26))
}

function setCardCell(panel, cell) {
    for (const canvas of panel.querySelectorAll('canvas')) {
        canvas.style.width = cell * 8 + 'px'
        canvas.style.height = cell * 17 + 'px'
    }
}

/* ---------- Small helpers ---------- */

function show(id) { $(id).classList.remove('hidden') }
function hide(id) { $(id).classList.add('hidden') }

function showNotice(text, ms = 4000) {
    let el = $('partyNotice')
    if (!el) {
        el = document.createElement('div')
        el.id = 'partyNotice'
        el.className = 'party-notice'
        document.body.appendChild(el)
    }
    el.textContent = text
    el.classList.add('show')
    clearTimeout(el.hideTimer)
    el.hideTimer = setTimeout(() => el.classList.remove('show'), ms)
}

// Lost the connection mid-match: back into the room (the match carries on here meanwhile)
socket.on('connect', () => {
    if (party.code && party.match) socket.emit('partyJoin', { code: party.code, clientId })
})

// A link to a room (/?party=CODE) opens straight into joining it
const linked = new URLSearchParams(location.search).get('party')
if (linked) {
    history.replaceState(null, '', location.pathname)
    openMenu(linked.toUpperCase())
}
