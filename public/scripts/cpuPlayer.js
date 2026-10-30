/**
 * DR. MARIO 99 - CPU PLAYERS (TV Room)
 * ====================================
 *
 * A computer player for the TV Room's ADD CPU, so a game can be filled without
 * more phones. For each new pill it tries every place the pill can land (four
 * turns x eight columns) and scores each one: matching colours lined up (four
 * in a row clears, better still with viruses in it), a different colour
 * buried underneath, and how high the stack gets. Then it turns, moves and
 * drops the pill there one step at a time, like a player, with the same moves
 * as the keyboard (Board.movementFromKey).
 *
 * Each CPU gets its own speed and sometimes takes a worse move, so they don't
 * all play alike and can be beaten.
 */

"use strict"
import { Rotation } from "./components.js"
import { Virus } from "./Shape.js"

const SPAWN_Y = 15   // the row a new pill comes in on (rows count up from the bottom)
const DANGER_Y = 11  // stacking this high gets close to the neck of the bottle
const glog = (type, details) => window.gameLog && window.gameLog.event(type, details) // scripts/gameLog.js
const TURNS = [Rotation.HORIZONTAL, Rotation.VERTICAL, Rotation.HORIZONTAL_REVERSED, Rotation.VERTICAL_REVERSED]

/** Play this TV Room game until it leaves the page; returns a function that stops it */
export function startCpu(game, seed = Math.random()) {
    const stepMs = 140 + Math.round(seed * 90)  // time between moves
    const sloppy = 0.12 + seed * 0.2            // how often it settles for a worse place
    let pill = null
    let plan = null
    let steps = 0
    const timer = setInterval(() => {
        if (!game.isConnected) return clearInterval(timer)
        if (window.gamePaused) return
        const board = game.board
        const current = board && board.currentPill
        if (!current || current.placed || board.blockInput || !current.centerField) return
        if (current !== pill) {
            pill = current
            plan = choosePlace(board, current, sloppy)
            steps = 0
            glog('cpu-plan', { p: game.playerNumber, colors: current.pieces.map(piece => piece.color), plan })
        }
        // No good place, or stuck turning against a wall: just drop it
        if (plan && steps === 40) glog('cpu-gave-up', { p: game.playerNumber, plan, rot: current.rotation, x: current.centerField.x })
        if (!plan || ++steps > 40) return board.movementFromKey('s')
        if (current.rotation !== plan.rotation) {
            const clockwise = (plan.rotation - current.rotation + 4) % 4
            return board.movementFromKey(clockwise === 3 ? 'w' : 'Shift') // the short way round
        }
        const x = current.centerField.x
        if (x < plan.x) return board.movementFromKey('d')
        if (x > plan.x) return board.movementFromKey('a')
        board.movementFromKey('s')
    }, stepMs)
    return () => clearInterval(timer)
}

/** The best place for this pill: { rotation, x } (x of its bottom-left half), or null */
function choosePlace(board, pill, sloppy) {
    const width = board.width
    const height = board.height
    const [first, second] = pill.pieces.map(piece => piece.color)
    // What has landed: a colour, '#' for walls, '' for empty
    const grid = []
    for (let x = 0; x < width; x++) {
        grid[x] = []
        for (let y = 0; y < height; y++) {
            const field = board.fields[x][y]
            grid[x][y] = field.locked ? (field.color || '#') : ''
        }
    }
    const isVirus = (x, y) => {
        const piece = board.fields[x][y].shapePiece
        return !!(piece && piece.shape instanceof Virus)
    }
    const free = (x, y) => x >= 0 && x < width && y >= 0 && y < height && grid[x][y] === ''

    const options = []
    for (const rotation of TURNS) {
        const flat = rotation === Rotation.HORIZONTAL || rotation === Rotation.HORIZONTAL_REVERSED
        const swapped = rotation === Rotation.HORIZONTAL_REVERSED || rotation === Rotation.VERTICAL_REVERSED
        for (let x = 0; x < (flat ? width - 1 : width); x++) {
            // It moves across the top two rows (upright, it can only slide once it is
            // a row down, below the neck of the bottle), so that path has to be open
            let open = true
            for (let col = Math.min(3, x); col <= Math.max(4, flat ? x + 1 : x); col++) {
                if (!free(col, SPAWN_Y) || !free(col, SPAWN_Y - 1)) open = false
            }
            if (!open) continue
            // Drop it
            let y = SPAWN_Y - 1
            while (free(x, y - 1) && (!flat || free(x + 1, y - 1))) y--
            const a = swapped ? second : first   // the bottom-left half
            const b = swapped ? first : second
            const cells = flat ? [{ x, y, color: a }, { x: x + 1, y, color: b }] : [{ x, y, color: a }, { x, y: y + 1, color: b }]
            options.push({ rotation, x, score: scorePlace(grid, cells, isVirus, width, height) + Math.random() * 2 })
        }
    }
    if (!options.length) return null
    options.sort((p, q) => q.score - p.score)
    const pick = Math.random() < sloppy ? Math.floor(Math.random() * Math.min(4, options.length)) : 0
    return { ...options[pick], score: Math.round(options[pick].score), rank: pick + 1, of: options.length }
}

function scorePlace(grid, cells, isVirus, width, height) {
    const g = grid.map(column => column.slice())
    for (const { x, y, color } of cells) g[x][y] = color
    let score = 0
    for (const { x, y, color } of cells) {
        // How many of the same colour line up with this half, and how many of them are viruses
        const run = (dx, dy) => {
            let length = 0
            let viruses = 0
            for (let i = 1; i < Math.max(width, height); i++) {
                const xx = x + dx * i
                const yy = y + dy * i
                if (xx < 0 || xx >= width || yy < 0 || yy >= height || g[xx][yy] !== color) break
                length++
                if (isVirus(xx, yy)) viruses++
            }
            return [length, viruses]
        }
        const [left, leftViruses] = run(-1, 0)
        const [right, rightViruses] = run(1, 0)
        const [down, downViruses] = run(0, -1)
        const [up, upViruses] = run(0, 1)
        for (const [length, viruses] of [[1 + left + right, leftViruses + rightViruses], [1 + down + up, downViruses + upViruses]]) {
            if (length >= 4) score += 60 + viruses * 40
            else if (length > 1) score += (length - 1) * (length - 1) * 6 + viruses * 8
        }
        // Burying a different colour makes it harder to clear later
        const below = y > 0 ? g[x][y - 1] : ''
        if (below && below !== '#' && below !== color) score -= isVirus(x, y - 1) ? 14 : 6
    }
    const top = Math.max(...cells.map(cell => cell.y))
    score -= top * 1.2
    if (top >= DANGER_Y) score -= 80
    return score
}
