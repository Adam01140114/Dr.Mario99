/**
 * DR. MARIO 99 - GAME LOGS
 * ========================
 *
 * Everything that happens in a game goes into its own file, so a glitch can be
 * traced afterwards: logs/games/<id>.jsonl, one JSON object per line. Only the
 * newest KEEP games are kept. tools/gamelog.js reads them (see CLAUDE.md).
 *
 * The first line describes the game ({ type: 'game', id, mode, ... }). Every
 * line after it is an event: { t, src, type, ...details }
 *   t     when the server wrote it down (ms since 1970)
 *   ct    when it happened, by the clock of the page or phone that sent it
 *   src   who saw it: 'server', 'tv' (the TV Room page), 'page' (single
 *         player, AI mode, online rooms), 'phone:P2' (that player's phone)
 *
 * Writes are batched (a flush every FLUSH_MS) so busy games don't slow the server.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'logs', 'games');
const MARKERS = path.join(__dirname, 'logs', 'markers.jsonl'); // every 🐞, across games
const KEEP = 100;
const MAX_BYTES = 25 * 1024 * 1024; // one game's file stops growing past this
const FLUSH_MS = 250;
const ID = /^\d{8}-\d{6}-[a-z0-9-]{2,40}$/;

const pending = new Map(); // id -> lines waiting to be written
const bytes = new Map();   // id -> size so far
let flushTimer = null;

const pad = n => String(n).padStart(2, '0');

/** Start a new game's log; returns its id, e.g. 20261028-153012-tv-ABCD-k3f */
function start(mode, details = {}) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const tag = [mode, details.code].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const id = `${stamp}-${tag}-${Math.random().toString(36).slice(2, 5)}`;
    fs.mkdirSync(DIR, { recursive: true });
    bytes.set(id, 0);
    queue(id, { type: 'game', id, mode, startedAt: d.toISOString(), ...details });
    prune();
    return id;
}

/** Write down events for a game (src: who saw them) */
function write(id, src, events) {
    if (!id || !bytes.has(id)) return;
    const t = Date.now();
    for (const e of events) queue(id, { t, src, ...e });
}

function queue(id, entry) {
    let line;
    try {
        line = JSON.stringify(entry);
    } catch (e) {
        line = JSON.stringify({ t: Date.now(), src: 'server', type: 'log-error', error: String(e), entryType: entry && entry.type });
    }
    const size = (bytes.get(id) || 0) + line.length + 1;
    if (size > MAX_BYTES) {
        if (bytes.get(id) <= MAX_BYTES) (pending.get(id) || pending.set(id, []).get(id)).push(JSON.stringify({ t: Date.now(), src: 'server', type: 'log-full', note: 'This game\'s log reached its size limit; later events were not written' }));
        bytes.set(id, size);
        return;
    }
    bytes.set(id, size);
    (pending.get(id) || pending.set(id, []).get(id)).push(line);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
    flushTimer = null;
    for (const [id, lines] of pending) {
        if (!lines.length) continue;
        try {
            fs.appendFileSync(path.join(DIR, id + '.jsonl'), lines.join('\n') + '\n');
        } catch (e) {
            console.warn('[gameLogs] could not write', id, e.message);
        }
    }
    pending.clear();
}

/** Keep only the newest KEEP games (ids start with the date, so they sort by age) */
function prune() {
    let files;
    try {
        files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort();
    } catch (e) {
        return;
    }
    for (const file of files.slice(0, Math.max(0, files.length - KEEP))) {
        try {
            fs.unlinkSync(path.join(DIR, file));
        } catch (e) { /* already gone */ }
        bytes.delete(file.replace(/\.jsonl$/, ''));
    }
}

/** A 🐞: someone flagged a glitch. Goes in the game's log and in the list of all markers */
function mark(id, src, details = {}) {
    write(id, src, [{ type: 'marker', ...details }]);
    try {
        fs.mkdirSync(path.dirname(MARKERS), { recursive: true });
        fs.appendFileSync(MARKERS, JSON.stringify({ t: Date.now(), id, src, ...details }) + '\n');
    } catch (e) { /* the game's log still has it */ }
}

/** The games on disk, newest first: id, size, and the first line (what game it was) */
function list() {
    flush();
    let files = [];
    try {
        files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
    } catch (e) {
        return [];
    }
    return files.map((file) => {
        const full = path.join(DIR, file);
        let head = {};
        try {
            const fd = fs.openSync(full, 'r');
            const buf = Buffer.alloc(16384);
            const n = fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            head = JSON.parse(buf.slice(0, n).toString('utf8').split('\n')[0]);
        } catch (e) { /* unreadable first line */ }
        return { id: file.replace(/\.jsonl$/, ''), size: fs.statSync(full).size, mode: head.mode, startedAt: head.startedAt, code: head.code, players: head.names || head.players };
    });
}

/** A game's whole log as text, or null */
function read(id) {
    if (!ID.test(String(id))) return null;
    flush();
    try {
        return fs.readFileSync(path.join(DIR, id + '.jsonl'), 'utf8');
    } catch (e) {
        return null;
    }
}

const isId = id => ID.test(String(id)) && bytes.has(id);

process.on('exit', flush);

module.exports = { start, write, mark, list, read, flush, isId, DIR };
