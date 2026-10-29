/**
 * DR. MARIO 99 - GAME LOG (this page's side)
 * ==========================================
 *
 * Writes down everything that happens in a game, in detail, so a glitch can be
 * traced afterwards. Events go to the server in batches; it keeps each game in
 * logs/games/<id>.jsonl (gameLogs.js) - the last 100 games.
 *
 * What gets written:
 * - the game: mode, players, the shared viruses and pill list, screen size
 * - every move and what it did (Board.movementFromKey: key, the pill before
 *   and after, whether it landed), each new pill, clears (which cells, which
 *   viruses), junk coming in and dropping, hold, stage clear, topping out
 * - each board once a second while it changes (Board.snapshot() plus the
 *   board's inner state: timers running, input blocked, junk falling)
 * - frames for replays (replays.html): every FRAME_MS, the cells of each board
 *   that changed ('frame', d: "index,char;..."), a full picture every
 *   KEYFRAME_MS ('keyframe', g), and score / viruses / level / next / hold
 *   whenever they change (hud)
 * - errors, rejected promises, console warnings and errors
 * - the connection: drops, reconnects, round trip to the server every 5 s
 * - slow frames (the page froze for 250 ms or more), long tasks, the page
 *   being hidden or losing focus
 * - from the other scripts: TV Room inputs (and why one was ignored),
 *   attacks, eliminations, controllers, CPU decisions... (gameLog.event)
 *
 * The 🐞 button marks the moment something looked wrong (with every board as
 * it is right then), so the log shows exactly where to look.
 *
 * window.gameLog: event(type, details), begin(mode, details), setId(id), mark(note)
 * Uses the page's global: socket.
 */

"use strict"
import { PlayingBoard } from "./Board.js"
import Game from "./Game.js"
import { Virus } from "./Shape.js"

const FLUSH_MS = 500
const SNAPSHOT_MS = 1000
const FRAME_MS = 50
const KEYFRAME_MS = 2000
const PING_MS = 5000
const HITCH_MS = 250

const log = window.gameLog = {
    id: null,         // this game's log id (shown on the result screens)
    active: false,    // a game or TV room is on
    ended: false,     // its result is on screen: no more pings (they'd make the game look longer)
    queue: [],
    event,
    begin,
    setId,
    mark,
}

/** Write something down (it goes to the server with the next batch) */
function event(type, details = {}) {
    if (type === 'result-shown' || type === 'match-over' || type === 'solo-game-over') log.ended = true
    log.queue.push({ ct: Date.now(), type, ...details })
    if (log.queue.length > 5000) log.queue.splice(0, log.queue.length - 5000)
}

/** A new game on this page (single player, AI mode, online room): it gets its own log */
function begin(mode, details = {}) {
    flush()
    log.active = true
    log.ended = false
    log.id = null
    socket.emit('logOpen', { mode, ...details, ...screenInfo() }, (id) => {
        log.id = id
        showLogId()
    })
}

/** TV Room: the server made this round's log */
function setId(id) {
    log.active = true
    log.ended = false
    log.id = id
    showLogId()
}

/** 🐞: something looked wrong just now */
function mark(note = '') {
    const boards = {}
    for (const [n, board] of activeBoards()) boards[n] = boardState(board)
    flush()
    socket.emit('logMark', { note, boards }, (id) => {
        bugToast(`🐞 Marked at ${new Date().toLocaleTimeString()}${id ? ' in game ' + id : ''}. Tell Claude what looked wrong.`)
    })
}

function flush() {
    if (!log.queue.length || typeof socket === 'undefined' || !socket.connected) return
    socket.emit('log', log.queue.splice(0, 1000))
}
setInterval(flush, FLUSH_MS)
window.addEventListener('pagehide', flush)

function screenInfo() {
    return { screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, url: location.pathname + location.search }
}

function showLogId() {
    for (const el of document.querySelectorAll('[data-log-id]')) el.textContent = log.id ? 'Game log: ' + log.id : ''
}

function bugToast(text) {
    let el = document.getElementById('bugToast')
    if (!el) {
        el = document.createElement('div')
        el.id = 'bugToast'
        el.className = 'bug-toast'
        document.body.appendChild(el)
    }
    el.textContent = text
    el.classList.add('show')
    clearTimeout(el.hideTimer)
    el.hideTimer = setTimeout(() => el.classList.remove('show'), 6000)
}
log.toast = bugToast

/* ---------- The boards ---------- */

function activeBoards() {
    const games = (window.tvHost && window.tvHost.started ? window.tvHost.games : window.gameInstances) || {}
    return Object.entries(games).filter(([, g]) => g && g.board && g.board.isConnected).map(([n, g]) => [n, g.board])
}

function pillOf(board) {
    const pill = board.currentPill
    if (!pill || !pill.pieces) return null
    return { cells: pill.pieces.map(piece => piece.field && piece.field.x !== undefined ? [piece.field.x, piece.field.y, piece.color] : null), rot: pill.rotation, placed: !!pill.placed }
}

/** What a board looks like now, and what it's in the middle of */
function boardState(board) {
    let snap = {}
    try { snap = board.snapshot() } catch (e) { snap = { error: String(e) } }
    return {
        ...snap,
        pill: pillOf(board),
        blocked: !!board.blockInput,
        falling: !!board.gravitationInterval,          // pieces dropping after a clear
        throwing: !!board.throwingBoardInterval,       // next pill on its way in
        junk: [board.hurting1, board.hurting2, board.hurting3, board.hurting4].map(h => h ? 1 : 0).join(''),
        junkWaiting: board.realdamage && !board.damageProcessed ? board.realdamage : 0,
        waitSpawn: !!board.pendingSpawnAfterDamage,
    }
}

const lastBoard = {}
setInterval(() => {
    if (!log.active) return
    for (const [n, board] of activeBoards()) {
        const state = boardState(board)
        const key = JSON.stringify(state)
        if (lastBoard[n] === key) continue
        lastBoard[n] = key
        event('board', { p: +n, ...state })
    }
}, SNAPSHOT_MS)

/* ---------- Frames, for watching a game back (replays.html) ---------- */

// One character per cell, top row first - the same as Board.snapshot().g
function gridOf(board) {
    let grid = ''
    for (let y = board.height - 1; y >= 0; y--)
        for (let x = 0; x < board.width; x++)
            grid += board.fields[x][y].spriteCode || '.'
    return grid
}

function hudOf(board) {
    const next = board.throwingBoard && board.throwingBoard.currentPill && board.throwingBoard.currentPill.pieces
    return { s: board.score, v: board.virusCount, l: board.level, n: next && next.length >= 2 ? [next[0].color, next[1].color] : null, h: board.heldPill || null, hu: !!board.holdUsed }
}

const frames = {} // player -> { grid, hud, keyAt, board }
setInterval(() => {
    if (!log.active) return
    const now = Date.now()
    for (const [n, board] of activeBoards()) {
        let grid, hud
        try {
            grid = gridOf(board)
            hud = JSON.stringify(hudOf(board))
        } catch (e) {
            continue
        }
        const last = frames[n]
        const changed = !last || last.grid !== grid
        const hudChanged = !last || last.hud !== hud
        if (!changed && !hudChanged) continue
        const extra = hudChanged ? { hud: JSON.parse(hud) } : {}
        // A new board, or one that's been changing for a while: the whole picture (for seeking)
        if (!last || last.board !== board || now - last.keyAt >= KEYFRAME_MS) {
            event('keyframe', { p: +n, g: grid, ...extra })
            frames[n] = { grid, hud, keyAt: now, board }
            continue
        }
        let diff = ''
        if (changed) for (let i = 0; i < grid.length; i++) if (grid[i] !== last.grid[i]) diff += (diff ? ';' : '') + i + ',' + grid[i]
        event('frame', { p: +n, ...(diff ? { d: diff } : {}), ...extra })
        last.grid = grid
        last.hud = hud
    }
}, FRAME_MS)

/* ---------- Moves and what they did (wrapping the game's own methods) ---------- */

function wrap(proto, name, around) {
    const original = proto[name]
    if (typeof original !== 'function') return
    proto[name] = function (...args) {
        return around.call(this, original, args)
    }
}

wrap(PlayingBoard.prototype, 'movementFromKey', function (original, [key]) {
    const before = pillOf(this)
    const result = original.call(this, key)
    if (before) {
        const after = pillOf(this)
        event('move', { p: this.playerNumber, key, from: before.cells, to: after ? after.cells : null, rot: after ? after.rot : null, landed: !!(after ? after.placed : true) })
    } else {
        event('move-ignored', { p: this.playerNumber, key, why: 'no pill' })
    }
    return result
})

wrap(PlayingBoard.prototype, 'nextFrame', function (original, args) {
    const pill = this.currentPill
    const wasPlaced = !pill || pill.placed
    const result = original.apply(this, args)
    if (pill && !wasPlaced && pill.placed) event('landed', { p: this.playerNumber, cells: pill.pieces.map(piece => piece.field && [piece.field.x, piece.field.y, piece.color]) })
    return result
})

wrap(PlayingBoard.prototype, 'movePillFromThrowingBoard', function (original, args) {
    const result = original.apply(this, args)
    const next = this.throwingBoard && this.throwingBoard.currentPill && this.throwingBoard.currentPill.pieces
    event('pill', { p: this.playerNumber, pill: pillOf(this), next: next ? next.map(piece => piece.color) : null })
    return result
})

wrap(PlayingBoard.prototype, 'clearIfNeeded', function (original, args) {
    const cells = []
    try {
        for (const column of this.fields) for (const field of column) {
            if (field.shouldBeCleared()) cells.push([field.x, field.y, field.color, field.shapePiece && field.shapePiece.shape instanceof Virus ? 'virus' : 'pill'])
        }
    } catch (e) { /* logging must never break the game */ }
    if (cells.length) event('clear', { p: this.playerNumber, cells })
    return original.apply(this, args)
})

wrap(PlayingBoard.prototype, 'receiveDamage', function (original, [points]) {
    const result = original.call(this, points)
    event('junk-incoming', { p: this.playerNumber, points, counted: !!result, damage: this.realdamage })
    return result
})

wrap(PlayingBoard.prototype, 'spawnRandomDot', function (original, args) {
    const result = original.apply(this, args)
    event('junk-drop', { p: this.playerNumber, x: this.randx, color: this.randcolor, more: [this.hurting2, this.hurting3, this.hurting4] })
    return result
})

wrap(PlayingBoard.prototype, 'hold', function (original, args) {
    const result = original.apply(this, args)
    event('hold', { p: this.playerNumber, ok: !!result, held: this.heldPill || null, pill: pillOf(this) })
    return result
})

wrap(PlayingBoard.prototype, 'spawnViruses', function (original, args) {
    const result = original.apply(this, args)
    event('viruses', { p: this.playerNumber, level: this.level, count: this.virusCount, at: (this.virusPositions || []).slice(0, 40) })
    return result
})

wrap(PlayingBoard.prototype, 'destroy', function (original, args) {
    event('board-removed', { p: this.playerNumber })
    return original.apply(this, args)
})

const gameEvent = (type) => function (original, args) {
    const board = this.board
    event(type, { p: this.playerNumber, level: board && board.level, score: board && board.score, board: board ? boardState(board) : null, args })
    return original.apply(this, args)
}
wrap(Game.prototype, 'nextStage', gameEvent('stage-clear'))
wrap(Game.prototype, 'endGame', gameEvent('topped-out'))
wrap(Game.prototype, 'restart', gameEvent('board-restart'))
wrap(Game.prototype, 'freeze', gameEvent('frozen'))
wrap(Game.prototype, 'teardown', gameEvent('teardown'))
wrap(Game.prototype, 'createBoard', function (original, args) {
    const result = original.apply(this, args)
    event('board-created', { p: this.playerNumber, level: args[0] || 0, score: args[1] || 0, tv: !!this.isTVControlled, aiView: !!this.isAIOpponentView })
    return result
})

/* ---------- Errors ---------- */

window.addEventListener('error', (e) => {
    event('error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno, stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 2000) : null })
})
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    event('error', { message: 'Unhandled promise rejection: ' + (reason && reason.message ? reason.message : String(reason)), stack: reason && reason.stack ? String(reason.stack).slice(0, 2000) : null })
})
for (const level of ['error', 'warn']) {
    const original = console[level]
    console[level] = function (...args) {
        try {
            event('console-' + level, { text: args.map(a => a instanceof Error ? a.stack || a.message : typeof a === 'object' ? safeJson(a) : String(a)).join(' ').slice(0, 2000) })
        } catch (e) { /* never break the console */ }
        return original.apply(this, args)
    }
}
function safeJson(value) {
    try { return JSON.stringify(value).slice(0, 1000) } catch (e) { return String(value) }
}

/* ---------- The connection, the page, and slow frames ---------- */

function watchSocket() {
    if (typeof socket === 'undefined') return setTimeout(watchSocket, 200)
    socket.on('connect', () => { event('socket-connected', { id: socket.id }); flush() })
    socket.on('disconnect', (reason) => event('socket-disconnected', { reason }))
    socket.on('connect_error', (e) => event('socket-error', { message: e && e.message }))
    if (socket.io) socket.io.on('reconnect_attempt', (n) => event('socket-reconnecting', { attempt: n }))
    setInterval(() => {
        if (!log.active || log.ended || !socket.connected) return
        socket.emit('logPing', Date.now(), (sent) => event('ping', { ms: Date.now() - sent }))
    }, PING_MS)
}
watchSocket()

// Keys (real ones, and the ones the controller code sends: synthetic)
for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, (e) => {
        if (log.active && !e.repeat) event(type === 'keydown' ? 'key-down' : 'key-up', { key: e.key, synthetic: !e.isTrusted })
    }, true)
}

document.addEventListener('visibilitychange', () => event('page-' + (document.hidden ? 'hidden' : 'shown')))
window.addEventListener('blur', () => event('page-blur'))
window.addEventListener('focus', () => event('page-focus'))
let resizeTimer = null
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => event('resize', screenInfo().screen), 300)
})

let lastFrame = performance.now()
let wasHidden = document.hidden
function frame(now) {
    const gap = now - lastFrame
    if (log.active && gap >= HITCH_MS && !document.hidden && !wasHidden) event('hitch', { ms: Math.round(gap) })
    lastFrame = now
    wasHidden = document.hidden
    requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => {
        if (!log.active) return
        for (const entry of list.getEntries()) if (entry.duration >= 150) event('long-task', { ms: Math.round(entry.duration) })
    }).observe({ entryTypes: ['longtask'] })
}

event('page-loaded', { ...screenInfo(), ua: navigator.userAgent })
