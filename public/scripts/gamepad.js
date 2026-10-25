/**
 * DR. MARIO 99 - GAME CONTROLLER (Nintendo Switch Pro Controller)
 * ================================================================
 *
 * Single player can be played with a Pro Controller paired over Bluetooth (or
 * any gamepad the browser knows). Its buttons become the same key presses as
 * the keyboard (Board.js reads a / d / s / w / Shift / c): "down" when a button
 * is pressed and "up" when it is let go, so a held button repeats exactly like
 * a held key, and "press any key" screens (STAGE CLEAR) work too.
 *
 * Buttons go by the browser's standard layout, which is by position - on the
 * Pro Controller A is the right button and B the bottom one:
 *   D-pad / left stick   move, down = drop
 *   A, X                 rotate right (clockwise)
 *   B, Y                 rotate left
 *   L, R, ZL, ZR         hold
 *   A or +               press the button on a message (GAME OVER: EXIT) or
 *                        the connect screen's START
 *
 * A browser only shows a controller to a page after one of its buttons is
 * pressed while the page is open, so the connect screen asks for that.
 *
 * window.padInput: start() / stop() sending presses to the game,
 * onChange(fn) to hear when a controller appears or goes, nameOf(gamepad).
 */

"use strict"

const PAD_KEYS = { left: 'a', right: 'd', rotateLeft: 'w', rotateRight: 'Shift', drop: 's', hold: 'c' }
const BUTTON_ACTIONS = {
    0: 'rotateLeft',   // B (bottom)
    1: 'rotateRight',  // A (right)
    2: 'rotateLeft',   // Y (left)
    3: 'rotateRight',  // X (top)
    4: 'hold', 5: 'hold', 6: 'hold', 7: 'hold', // L, R, ZL, ZR
    13: 'drop', 14: 'left', 15: 'right',        // D-pad
}
const CONFIRM_BUTTONS = [1, 9]  // A, +
const STICK = 0.5               // how far the stick must lean to count as a press
const MESSAGE_DELAY = 1000      // a message is up this long before A presses its button, so mashing A doesn't hit EXIT

const pad = window.padInput = {
    playing: false,      // sending presses to the game
    held: new Set(),     // actions down right now
    confirmDown: true,
    target: null,        // the button A / + would press, and since when
    targetSince: 0,
    listeners: new Set(),
    start,
    stop,
    onChange,
    nameOf,
}

/** The controller to use: a Nintendo one if there is one (vendor 057e), else the first */
function current() {
    if (!navigator.getGamepads) return null
    const pads = [...navigator.getGamepads()].filter(p => p && p.connected)
    return pads.find(p => /pro controller|057e/i.test(p.id)) || pads[0] || null
}

function nameOf(gamepad) {
    if (!gamepad) return ''
    if (/pro controller|057e.*2009/i.test(gamepad.id)) return 'Pro Controller'
    return gamepad.id.replace(/\s*\(.*\)\s*/g, '').trim() || 'Controller'
}

/** Send presses to the game (single player was started with the controller) */
function start() {
    pad.playing = true
    wake()
}

function stop() {
    releaseAll()
    pad.playing = false
}

/** fn(gamepad or null) now and whenever the controller changes; returns a function that stops it */
function onChange(fn) {
    pad.listeners.add(fn)
    fn(current())
    wake()
    return () => pad.listeners.delete(fn)
}

/** The button A / + should press now: a message's button, or a visible START on the connect screen */
function confirmTarget() {
    const message = document.querySelector('.alert-overlay')
    if (message) {
        const active = document.activeElement
        return message.contains(active) && active.tagName === 'BUTTON' ? active : message.querySelector('button:not(:disabled)')
    }
    const button = document.querySelector('[data-pad-confirm]:not(:disabled)')
    return button && button.getClientRects().length ? button : null
}

function sendKey(type, action) {
    document.dispatchEvent(new KeyboardEvent(type, { key: PAD_KEYS[action], bubbles: true, cancelable: true }))
}

function releaseAll() {
    for (const action of pad.held) sendKey('keyup', action)
    pad.held = new Set()
}

let frame = null
let lastId = null

function wake() {
    if (!frame) frame = requestAnimationFrame(tick)
}

function tick() {
    frame = null
    const gamepad = current()
    const id = gamepad ? gamepad.index + ':' + gamepad.id : null
    if (id !== lastId) {
        lastId = id
        pad.confirmDown = true // the press that woke the controller up is not an A press
        for (const fn of pad.listeners) fn(gamepad)
    }
    const isDown = i => !!(gamepad && gamepad.buttons[i] && gamepad.buttons[i].pressed)

    const confirm = CONFIRM_BUTTONS.some(isDown)
    const confirmPressed = confirm && !pad.confirmDown
    pad.confirmDown = confirm
    const target = confirmTarget()
    if (target !== pad.target) {
        pad.target = target
        pad.targetSince = performance.now()
    }
    const onMessage = !!(target && target.closest('.alert-overlay'))
    if (target && confirmPressed && performance.now() - pad.targetSince >= (onMessage ? MESSAGE_DELAY : 0)) target.click()

    // While a message is up the controller answers it instead of moving pills
    const now = new Set()
    if (pad.playing && gamepad && !onMessage) {
        for (const [i, action] of Object.entries(BUTTON_ACTIONS)) if (isDown(i)) now.add(action)
        const [x = 0, y = 0] = gamepad.axes
        if (x < -STICK) now.add('left')
        if (x > STICK) now.add('right')
        if (y > STICK) now.add('drop')
    }
    for (const action of now) if (!pad.held.has(action)) sendKey('keydown', action)
    for (const action of pad.held) if (!now.has(action)) sendKey('keyup', action)
    pad.held = now

    if (pad.playing || pad.listeners.size) wake()
}

window.addEventListener('gamepadconnected', wake)
window.addEventListener('gamepaddisconnected', wake)
window.addEventListener('blur', releaseAll)
