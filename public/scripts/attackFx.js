/**
 * DR. MARIO 99 - ATTACK EFFECTS
 * =============================
 *
 * The junk a clear sends is easy to miss, so it gets a show, Tetris 99 style:
 * - attackSent(player): a shockwave and "ATTACK!" over the attacker's bottle
 *   (and, when the opponent is on another screen, a comet flying off the top)
 * - attackReceived(player): a comet flies into the target's bottle - from the
 *   attacker's bottle when both are on this screen (TV Room, AI mode), from the
 *   top otherwise - then the bottle flashes red, shakes and says "INCOMING!"
 *
 * Everything is a short-lived element in <body> animated with transform and
 * opacity only, so the browser never has to repaint the boards for it.
 */

"use strict"

const PLAYER_COLORS = { 1: "#ff4d6d", 2: "#4dc3ff" }
const DEFAULT_COLOR = "#00ffff"
const FLIGHT_MS = 520

let stylesAdded = false
function addStyles() {
    if (stylesAdded) return
    stylesAdded = true
    const style = document.createElement("style")
    style.textContent = `
        .fx-layer { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 2500; will-change: transform, opacity; }
        .fx-ring { border-radius: 50%; border: 6px solid var(--fx); box-shadow: 0 0 24px var(--fx), inset 0 0 24px var(--fx); }
        .fx-orb { border-radius: 50%; background: radial-gradient(circle, #fff 0 22%, var(--fx) 45%, transparent 72%); }
        .fx-text {
            font-family: 'Press Start 2P', cursive;
            color: #fff;
            white-space: nowrap;
            text-shadow: 0 0 8px var(--fx), 0 0 18px var(--fx), 3px 3px 0 #000;
            -webkit-text-stroke: 1px #000;
        }
        .fx-flash { background: radial-gradient(ellipse at center, rgba(255, 40, 40, 0.15), rgba(255, 30, 30, 0.55)); border-radius: 6px; }
    `
    document.head.appendChild(style)
}

function playerColor(player) {
    return document.body.classList.contains("tv-mode") ? PLAYER_COLORS[player] || DEFAULT_COLOR : DEFAULT_COLOR
}

/** The bottle (game-board) of a player, if it is on screen */
function bottleOf(player) {
    const container = document.getElementById("game" + player)
    if (!container || container.classList.contains("hidden")) return null
    const board = container.querySelector("game-board")
    if (!board) return null
    const r = board.getBoundingClientRect()
    return r.width ? { el: board, game: container.querySelector("game-element"), rect: r } : null
}

/** A fixed element centred on (x, y), removed when its animation ends */
function spawn(className, x, y, w, h, color, keyframes, options, text) {
    const el = document.createElement("div")
    el.className = "fx-layer " + className
    el.style.width = w + "px"
    el.style.height = h + "px"
    el.style.left = (x - w / 2) + "px"
    el.style.top = (y - h / 2) + "px"
    el.style.setProperty("--fx", color)
    if (text) el.textContent = text
    document.body.appendChild(el)
    const anim = el.animate(keyframes, { fill: "both", ...options })
    anim.onfinish = () => el.remove()
    anim.oncancel = () => el.remove()
    return anim
}

function popText(text, rect, color, size, delay = 0) {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height * 0.35
    const w = rect.width * 2.2
    const h = size * 1.6
    const el = document.createElement("div")
    el.className = "fx-layer fx-text"
    el.style.cssText += `width:${w}px;height:${h}px;left:${cx - w / 2}px;top:${cy - h / 2}px;font-size:${size}px;line-height:${h}px;text-align:center;`
    el.style.setProperty("--fx", color)
    el.textContent = text
    document.body.appendChild(el)
    const anim = el.animate([
        { transform: "scale(0.2) rotate(-8deg)", opacity: 0 },
        { transform: "scale(1.25) rotate(3deg)", opacity: 1, offset: 0.18 },
        { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.32 },
        { transform: "translateY(-18%) scale(1)", opacity: 1, offset: 0.75 },
        { transform: "translateY(-40%) scale(0.9)", opacity: 0 },
    ], { duration: 1100, delay, easing: "ease-out", fill: "both" })
    anim.onfinish = () => el.remove()
}

function shockwave(rect, color) {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const size = rect.width * 0.9
    for (const [delay, scaleTo] of [[0, 2.6], [110, 1.9]]) {
        spawn("fx-ring", cx, cy, size, size, color, [
            { transform: "scale(0.2)", opacity: 1 },
            { transform: `scale(${scaleTo})`, opacity: 0 },
        ], { duration: 520, delay, easing: "cubic-bezier(.2,.7,.3,1)" })
    }
}

/** A comet: one bright orb and a few trailing ones, flying from -> to in an arc */
function comet(from, to, color, onArrive, scale = 1) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lift = -Math.max(120, Math.abs(dx) * 0.25)
    const path = [0, 0.25, 0.5, 0.75, 1].map(t => ({
        x: dx * t,
        y: dy * t + lift * 4 * t * (1 - t),
    }))
    const trail = [
        { size: 90 * scale, delay: 0, opacity: 1 },
        { size: 66 * scale, delay: 35, opacity: 0.8 },
        { size: 48 * scale, delay: 70, opacity: 0.55 },
        { size: 34 * scale, delay: 105, opacity: 0.35 },
        { size: 24 * scale, delay: 140, opacity: 0.2 },
    ]
    trail.forEach((orb, i) => {
        const anim = spawn("fx-orb", from.x, from.y, orb.size, orb.size, color,
            path.map((p, k) => ({
                transform: `translate(${p.x}px, ${p.y}px) scale(${k === 0 ? 0.4 : 1})`,
                opacity: k === path.length - 1 && i > 0 ? 0 : orb.opacity,
            })),
            { duration: FLIGHT_MS, delay: orb.delay, easing: "cubic-bezier(.45,.05,.55,.95)" })
        if (i === 0 && onArrive) anim.finished.then(onArrive, () => {})
    })
}

function impact(target, color) {
    const r = target.rect
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    // Red flash over the bottle
    spawn("fx-flash", cx, cy, r.width, r.height, color, [
        { opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 },
    ], { duration: 650, easing: "ease-out" })
    // Burst where it lands (top of the bottle)
    spawn("fx-ring", cx, r.top + r.height * 0.08, r.width * 0.7, r.width * 0.7, "#ff3b3b", [
        { transform: "scale(0.2)", opacity: 1 },
        { transform: "scale(2.2)", opacity: 0 },
    ], { duration: 480, easing: "ease-out" })
    // Shake the whole game screen of the player who was hit
    if (target.game && target.game.animate) {
        target.game.animate([
            { transform: "translate(0, 0)" },
            { transform: "translate(-10px, 4px)" },
            { transform: "translate(9px, -3px)" },
            { transform: "translate(-6px, 2px)" },
            { transform: "translate(4px, -1px)" },
            { transform: "translate(0, 0)" },
        ], { duration: 360, easing: "ease-out" })
    }
    popText("INCOMING!", r, "#ff3b3b", Math.max(18, r.width * 0.16))
}

/** Tell that player's phone (TV Room) */
function notifyPhone(player, kind) {
    if (window.tvHost && window.tvHost.started && typeof socket !== "undefined") {
        socket.emit("tvFx", { player, kind })
    }
}

export function attackSent(player) {
    try {
        addStyles()
        notifyPhone(player, "attack")
        const me = bottleOf(player)
        if (!me) return
        const color = playerColor(player)
        shockwave(me.rect, color)
        popText("ATTACK!", me.rect, color, Math.max(20, me.rect.width * 0.2))
        // Opponent on another screen: send the comet off the top
        const other = bottleOf(player === 1 ? 2 : 1)
        if (!other) {
            const from = { x: me.rect.left + me.rect.width / 2, y: me.rect.top + me.rect.height * 0.2 }
            comet(from, { x: from.x + me.rect.width * 0.6, y: -120 }, color, null, me.rect.width / 192)
        }
    } catch (err) {
        // Effects must never break the game
    }
}

export function attackReceived(player) {
    try {
        addStyles()
        const target = bottleOf(player)
        if (!target) return notifyPhone(player, "hit")
        const attacker = player === 1 ? 2 : 1
        const source = bottleOf(attacker)
        const color = source ? playerColor(attacker) : "#ff3b3b"
        const to = { x: target.rect.left + target.rect.width / 2, y: target.rect.top + target.rect.height * 0.08 }
        const from = source
            ? { x: source.rect.left + source.rect.width / 2, y: source.rect.top + source.rect.height * 0.35 }
            : { x: to.x - target.rect.width * 0.6, y: -120 }
        comet(from, to, color, () => {
            const now = bottleOf(player) // the screen may have been rescaled mid-flight
            if (now) impact(now, color)
            notifyPhone(player, "hit") // the target's phone flashes as the junk lands
        }, target.rect.width / 192)
    } catch (err) {
        // Effects must never break the game
    }
}
