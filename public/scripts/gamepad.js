/**
 * DR. MARIO 99 - GAME CONTROLLERS (Nintendo Switch Pro Controller)
 * =================================================================
 *
 * Single player can be played with a Pro Controller paired over Bluetooth (or
 * any gamepad the browser knows). Its buttons become the same key presses as
 * the keyboard (Board.js reads a / d / s / w / Shift / c): "down" when a button
 * is pressed and "up" when it is let go, so a held button repeats exactly like
 * a held key, and "press any key" screens (STAGE CLEAR) work too.
 *
 * In the TV Room every controller on the computer is read at once (watchAll):
 * each one's presses come with its key, and tvHost.js gives them to whichever
 * player picked that controller on their phone.
 *
 * Buttons by the letter printed on them:
 *   D-pad / left stick   move, down = drop
 *   A, X                 rotate right (clockwise)
 *   B, Y                 rotate left
 *   L, R, ZL, ZR         hold
 *   A or +               single player: press the button on a message
 *                        (GAME OVER: EXIT) or the connect screen's START
 * Rotate and hold happen once per press (holding the button doesn't keep
 * spinning the pill, as in the real game); moving and dropping repeat.
 *
 * Browsers number the face buttons differently: Chrome (and the WebHID reader
 * below) by position - B at the bottom is 0, A on the right 1 - while Safari
 * gets Nintendo controllers from macOS, which numbers them by letter - A is 0.
 *
 * A browser only shows a controller to a page after one of its buttons is
 * pressed while the page is open, so the connect screen asks for that.
 *
 * Chrome on a Mac never shows a Pro Controller paired over Bluetooth (it reads
 * Nintendo controllers itself instead of through macOS, and misses it; Safari
 * sees it). For that there is WebHID: CONNECT CONTROLLER lets the player pick
 * it in Chrome's list once (once per controller), then this page reads the
 * controller's own reports and fills in a stand-in for a standard Gamepad, so
 * everything works the same. Chrome remembers the choice: after a reload, or
 * when the controller wakes up, it is opened again by itself.
 *
 * window.padInput:
 *   single player   start() / stop() sending presses to the game,
 *                   onChange(fn) to hear when a controller appears or goes
 *   TV Room         controllers(), onListChange(fn), watchAll(fn),
 *                   showPlayer(key, player) (lights a Pro Controller's lamps)
 *   both            nameOf(gamepad), canConnectHid() / connectHid() for
 *                   Chrome's device list, hidError
 */

"use strict"

const glog = (type, details) => window.gameLog && window.gameLog.event(type, details) // scripts/gameLog.js
const PAD_KEYS = { left: 'a', right: 'd', rotateLeft: 'w', rotateRight: 'Shift', drop: 's', hold: 'c' }
const FACE_ACTIONS = { a: 'rotateRight', x: 'rotateRight', b: 'rotateLeft', y: 'rotateLeft' }
const BUTTON_ACTIONS = {
    4: 'hold', 5: 'hold', 6: 'hold', 7: 'hold', // L, R, ZL, ZR
    13: 'drop', 14: 'left', 15: 'right',        // D-pad
}
const ONCE_PER_PRESS = new Set(['rotateLeft', 'rotateRight', 'hold'])
const PLUS = 9
const MINUS = 8
const BY_POSITION = { a: 1, b: 0, x: 3, y: 2 } // Chrome, WebHID
const BY_LETTER = { a: 0, b: 1, x: 2, y: 3 }   // Safari (macOS's GameController), for Nintendo controllers
const STICK = 0.5               // how far the stick must lean to count as a press
const MESSAGE_DELAY = 1000      // a message is up this long before A presses its button, so mashing A doesn't hit EXIT
const PLAYER_LAMPS = [0x01, 0x03, 0x07, 0x0f, 0x09, 0x05, 0x0d, 0x06] // a Pro Controller's 4 lamps for players 1-8, as a Switch lights them

const pad = window.padInput = {
    playing: false,      // single player: sending presses to the game
    held: new Set(),     // ...and the actions down right now
    confirmDown: true,
    target: null,        // the button A / + would press, and since when
    targetSince: 0,
    listeners: new Set(),
    all: null,           // TV Room: fn({ key, action, pressed }), fn({ key, button: 'a' }) and fn({ key, button: 'pause' })
    allHeld: new Map(),  // ...controller key -> actions down
    allA: new Map(),     // ...controller key -> A down
    allPause: new Map(), // ...controller key -> + or - down
    listListeners: new Set(),
    hidError: '',        // why a WebHID controller couldn't be opened
    start,
    stop,
    onChange,
    nameOf,
    canConnectHid,
    connectHid,
    controllers,
    onListChange,
    watchAll,
    showPlayer,
}

const isNintendo = gamepad => /pro controller|057e/i.test(gamepad.id)

/**
 * Every controller this page can read: { key, name, gamepad }. The key stays
 * the same while it is connected ('hid1', 'gp0'...); two with the same name
 * are numbered (Pro Controller 1, Pro Controller 2).
 */
function controllers() {
    const fromHid = [...hid.devices.values()].filter(h => h.pad).map(h => ({ key: 'hid' + h.n, gamepad: h.pad }))
    let pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(p => p && p.connected) : []
    // A Pro Controller opened over WebHID can show up here too (Chrome on Windows): WebHID has it
    if (fromHid.length) pads = pads.filter(p => !isNintendo(p))
    const list = [...fromHid, ...pads.map(p => ({ key: 'gp' + p.index, gamepad: p }))]
    const total = {}
    const seen = {}
    for (const c of list) total[nameOf(c.gamepad)] = (total[nameOf(c.gamepad)] || 0) + 1
    for (const c of list) {
        const name = nameOf(c.gamepad)
        seen[name] = (seen[name] || 0) + 1
        c.name = total[name] > 1 ? name + ' ' + seen[name] : name
    }
    return list
}

/** Single player's controller: a Nintendo one if there is one, else the first */
function current(list = controllers()) {
    const found = list.find(c => isNintendo(c.gamepad)) || list[0]
    return found ? found.gamepad : null
}

/** Which index is which face button on this controller, in this browser */
function faceButtons(gamepad) {
    const ua = navigator.userAgent
    const fromMacOS = /AppleWebKit/.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua) // Safari, and every browser on iOS
    return fromMacOS && gamepad.index !== 'hid' && isNintendo(gamepad) ? BY_LETTER : BY_POSITION
}

function nameOf(gamepad) {
    if (!gamepad) return ''
    if (/pro controller|057e.*2009/i.test(gamepad.id)) return 'Pro Controller'
    return gamepad.id.replace(/\s*\(.*\)\s*/g, '').trim() || 'Controller'
}

const isDown = (gamepad, i) => !!(gamepad && gamepad.buttons[i] && gamepad.buttons[i].pressed)

/** The game actions a controller is pressing right now */
function actionsOf(gamepad) {
    const now = new Set()
    const face = faceButtons(gamepad)
    for (const [letter, action] of Object.entries(FACE_ACTIONS)) if (isDown(gamepad, face[letter])) now.add(action)
    for (const [i, action] of Object.entries(BUTTON_ACTIONS)) if (isDown(gamepad, i)) now.add(action)
    const [x = 0, y = 0] = gamepad.axes
    if (x < -STICK) now.add('left')
    if (x > STICK) now.add('right')
    if (y > STICK) now.add('drop')
    return now
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

function notify() {
    for (const fn of pad.listeners) fn(current())
}

/** TV Room: fn(controllers()) now and whenever one appears, goes or is renamed; returns a function that stops it */
function onListChange(fn) {
    pad.listListeners.add(fn)
    fn(controllers())
    wake()
    return () => pad.listListeners.delete(fn)
}

/** TV Room: every controller's presses, each with its key; returns a function that stops it */
function watchAll(fn) {
    pad.all = fn
    pad.allHeld = new Map()
    pad.allA = new Map()
    pad.allPause = new Map()
    wake()
    return () => {
        if (pad.all !== fn) return
        for (const [key, held] of pad.allHeld) for (const action of held) fn({ key, action, pressed: false })
        pad.all = null
    }
}

/** Show whose controller this is: a Pro Controller's lamps light up with the player number, others buzz */
function showPlayer(key, player) {
    const entry = [...hid.devices.values()].find(h => 'hid' + h.n === key)
    if (entry) return subcommand(entry.device, 0x30, [PLAYER_LAMPS[(player - 1) % PLAYER_LAMPS.length]])
    const found = controllers().find(c => c.key === key)
    const actuator = found && found.gamepad.vibrationActuator
    if (actuator && actuator.playEffect) {
        actuator.playEffect('dual-rumble', { duration: 250, strongMagnitude: 0.6, weakMagnitude: 0.6 }).catch(() => {})
    }
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
let lastNames = null

function wake() {
    if (!frame) frame = requestAnimationFrame(tick)
}

function tick() {
    frame = null
    const list = controllers()
    const names = list.map(c => c.key + '=' + c.name).join('|')
    if (names !== lastNames) {
        if (lastNames !== null || list.length) glog('controllers-seen', { list: list.map(c => ({ key: c.key, name: c.name, mapping: c.gamepad.mapping })) })
        lastNames = names
        for (const fn of pad.listListeners) fn(list)
    }
    if (pad.playing || pad.listeners.size) readOne(list)
    if (pad.all) readAll(list)
    if (pad.playing || pad.listeners.size || pad.listListeners.size || pad.all) wake()
}

/** Single player: one controller, as key presses */
function readOne(list) {
    const gamepad = current(list)
    const id = gamepad ? gamepad.index + ':' + gamepad.id : null
    if (id !== lastId) {
        lastId = id
        pad.confirmDown = true // the press that woke the controller up is not an A press
        for (const fn of pad.listeners) fn(gamepad)
    }
    const confirm = !!gamepad && (isDown(gamepad, faceButtons(gamepad).a) || isDown(gamepad, PLUS))
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
    const now = pad.playing && gamepad && !onMessage ? actionsOf(gamepad) : new Set()
    for (const action of now) {
        if (pad.held.has(action)) continue
        sendKey('keydown', action)
        if (ONCE_PER_PRESS.has(action)) sendKey('keyup', action) // let go at once, so Board.js doesn't repeat it
    }
    for (const action of pad.held) if (!now.has(action) && !ONCE_PER_PRESS.has(action)) sendKey('keyup', action)
    pad.held = now
}

/** TV Room: each controller's presses and releases, by its key, plus each new press of A */
function readAll(list) {
    const present = new Set()
    for (const { key, gamepad } of list) {
        present.add(key)
        const held = pad.allHeld.get(key) || new Set()
        const now = actionsOf(gamepad)
        pad.allHeld.set(key, now)
        for (const action of now) if (!held.has(action)) pad.all({ key, action, pressed: true })
        for (const action of held) if (!now.has(action)) pad.all({ key, action, pressed: false })
        const a = isDown(gamepad, faceButtons(gamepad).a)
        if (a && !pad.allA.get(key)) pad.all({ key, button: 'a' })
        pad.allA.set(key, a)
        // + or - pauses (or resumes) the TV Room game
        const menu = isDown(gamepad, PLUS) || isDown(gamepad, MINUS)
        if (menu && !pad.allPause.get(key)) pad.all({ key, button: 'pause' })
        pad.allPause.set(key, menu)
    }
    // A controller that went away lets go of everything
    for (const [key, held] of pad.allHeld) {
        if (present.has(key)) continue
        pad.allHeld.delete(key)
        pad.allA.delete(key)
        pad.allPause.delete(key)
        for (const action of held) pad.all({ key, action, pressed: false })
    }
}

window.addEventListener('gamepadconnected', wake)
window.addEventListener('gamepaddisconnected', wake)
window.addEventListener('blur', releaseAll)

/* ---------- The Pro Controller over WebHID (Chrome, Edge) ---------- */

const PRO_CONTROLLER = { vendorId: 0x057e, productId: 0x2009 }
const STICK_CENTER = 2048  // sticks are 12-bit
const STICK_RANGE = 1400   // about how far they go from the center
const hid = { devices: new Map(), next: 1, packet: 0 } // HIDDevice -> { n, device, pad }

// Full input report (0x30, and subcommand replies 0x21): [byte, bit] of each
// standard-layout button, counting from the byte after the report id
const FULL_BUTTONS = [
    [2, 0x04], [2, 0x08], [2, 0x01], [2, 0x02],  // B A Y X
    [4, 0x40], [2, 0x40], [4, 0x80], [2, 0x80],  // L R ZL ZR
    [3, 0x01], [3, 0x02], [3, 0x08], [3, 0x04],  // - + left stick, right stick
    [4, 0x02], [4, 0x01], [4, 0x08], [4, 0x04],  // up down left right
    [3, 0x10], [3, 0x20],                        // home, capture
]
// Simple report (0x3F, before the controller is told to send full reports)
const SIMPLE_BUTTONS = [
    [0, 0x01], [0, 0x02], [0, 0x04], [0, 0x08],
    [0, 0x10], [0, 0x20], [0, 0x40], [0, 0x80],
    [1, 0x01], [1, 0x02], [1, 0x04], [1, 0x08],
]
const HAT = [[12, 7, 0, 1], [15, 1, 2, 3], [13, 3, 4, 5], [14, 5, 6, 7]] // button, then the hat positions that press it

function canConnectHid() {
    return 'hid' in navigator
}

/** CONNECT CONTROLLER (needs the click): Chrome lists the Pro Controllers, the player picks one */
async function connectHid() {
    pad.hidError = ''
    try {
        const [device] = await navigator.hid.requestDevice({ filters: [PRO_CONTROLLER] })
        if (device) await useHidDevice(device)
    } catch (e) {
        pad.hidError = e.message || String(e)
        glog('controller-hid-error', { message: pad.hidError })
    }
    notify()
}

function isProController(device) {
    return device.vendorId === PRO_CONTROLLER.vendorId && device.productId === PRO_CONTROLLER.productId
}

async function useHidDevice(device) {
    if (hid.devices.has(device)) return
    if (!device.opened) await device.open()
    if (hid.devices.has(device)) return
    hid.devices.set(device, { n: hid.next++, device, pad: null }) // the pad appears with its first report
    glog('controller-hid-opened', { key: 'hid' + (hid.next - 1), name: device.productName })
    device.addEventListener('inputreport', readHidReport)
    // Full reports (buttons and sticks, 60 a second), then light the player 1 lamp
    await subcommand(device, 0x03, [0x30])
    await new Promise(r => setTimeout(r, 60))
    await subcommand(device, 0x30, [PLAYER_LAMPS[0]])
}

/** Output report 0x01: packet number, neutral rumble, then the subcommand */
function subcommand(device, id, args) {
    const data = new Uint8Array(48)
    data.set([hid.packet++ & 0x0f, 0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40, id, ...args])
    return device.sendReport(0x01, data).catch(() => {})
}

function readHidReport(e) {
    const entry = hid.devices.get(e.device)
    if (!entry) return
    const d = e.data
    const full = e.reportId === 0x30 || e.reportId === 0x21
    if (!full && e.reportId !== 0x3f) return
    if (!entry.pad) {
        entry.pad = {
            id: (e.device.productName || 'Pro Controller') + ' (WebHID Vendor: 057e Product: 2009)',
            index: 'hid',
            connected: true,
            mapping: 'standard',
            buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
            axes: [0, 0, 0, 0],
        }
        wake()
    }
    const press = (i, down) => {
        entry.pad.buttons[i].pressed = down
        entry.pad.buttons[i].value = down ? 1 : 0
    }
    if (full) {
        FULL_BUTTONS.forEach(([byte, bit], i) => press(i, !!(d.getUint8(byte) & bit)))
        const stick = (at) => {
            const x = d.getUint8(at) | ((d.getUint8(at + 1) & 0x0f) << 8)
            const y = (d.getUint8(at + 1) >> 4) | (d.getUint8(at + 2) << 4)
            const axis = v => Math.max(-1, Math.min(1, (v - STICK_CENTER) / STICK_RANGE))
            return [axis(x), -axis(y)] // the controller counts up for up; the standard layout is down
        }
        entry.pad.axes = [...stick(5), ...stick(8)]
    } else {
        SIMPLE_BUTTONS.forEach(([byte, bit], i) => press(i, !!(d.getUint8(byte) & bit)))
        press(16, !!(d.getUint8(1) & 0x10))
        press(17, !!(d.getUint8(1) & 0x20))
        const hat = d.getUint8(2)
        for (const [i, ...positions] of HAT) press(i, positions.includes(hat))
    }
}

function dropHidDevice(device) {
    if (!hid.devices.has(device)) return
    device.removeEventListener('inputreport', readHidReport)
    glog('controller-hid-closed', { key: 'hid' + hid.devices.get(device).n })
    hid.devices.delete(device)
    wake()
}

// Pro Controllers this site was allowed before: open them again without asking
// (after a reload, or when a controller wakes up and reconnects)
if (canConnectHid()) {
    const reopen = (device) => {
        if (!isProController(device) || hid.devices.has(device)) return
        useHidDevice(device).catch((e) => {
            pad.hidError = e.message || String(e)
            notify()
        })
    }
    navigator.hid.addEventListener('connect', (e) => reopen(e.device))
    navigator.hid.addEventListener('disconnect', (e) => dropHidDevice(e.device))
    navigator.hid.getDevices().then(devices => devices.forEach(reopen), () => {})
}
