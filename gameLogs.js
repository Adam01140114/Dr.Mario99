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
 * Writes are batched (a flush every FLUSH_MS) and done in the background (never
 * blocking the server). LOG_DIR moves the logs, e.g. onto a persistent disk on a
 * host whose own disk is wiped on every deploy.
 * A short summary of each game (players, length, result, errors, 🐞) is kept in
 * logs/index.json, for the list on replays.html.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(__dirname, 'logs');
const DIR = path.join(ROOT, 'games');
const MARKERS = path.join(ROOT, 'markers.jsonl'); // every 🐞, across games
const INDEX = path.join(ROOT, 'index.json');      // a summary of each game
const KEEP = 100;
const MAX_BYTES = 60 * 1024 * 1024; // one game's file stops growing past this (a 20-player game writes up to about 5 MB a minute)
const FLUSH_MS = 250;
const ID = /^\d{8}-\d{6}-[a-z0-9-]{2,40}$/;
// Events that don't make a game longer (a page left open on the result screen keeps sending these)
const IDLE = new Set(['ping', 'page-hidden', 'page-shown', 'page-blur', 'page-focus', 'resize', 'socket-disconnected', 'socket-connected', 'server-in', 'server-out', 'room-closed', 'board-pictures-relayed']);

const pending = new Map(); // id -> lines waiting to be written
const writing = new Map(); // id -> the write in progress (each game's writes stay in order)
const bytes = new Map();   // id -> size so far
let flushTimer = null;
let summaries = {};        // id -> summary (see summarize)
let indexDirty = false;
try { summaries = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { /* no index yet */ }
setInterval(saveIndex, 5000).unref();
// Also every 30 s: when many games start at once, their files don't exist yet when start() prunes
setInterval(prune, 30000).unref();

const pad = n => String(n).padStart(2, '0');

/** Start a new game's log; returns its id, e.g. 20261028-153012-tv-ABCD-k3f */
function start(mode, details = {}) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const tag = [mode, details.code].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const id = `${stamp}-${tag}-${Math.random().toString(36).slice(2, 5)}`;
    fs.mkdirSync(DIR, { recursive: true });
    bytes.set(id, 0);
    const head = { type: 'game', id, mode, startedAt: d.toISOString(), ...details };
    summaries[id] = summarize(null, head);
    indexDirty = true;
    queue(id, head);
    prune();
    return id;
}

/** Write down events for a game (src: who saw them) */
function write(id, src, events) {
    if (!id || !bytes.has(id)) return;
    const t = Date.now();
    const summary = summaries[id];
    for (const e of events) {
        const entry = { t, src, ...e };
        if (summary) summarize(summary, entry);
        queue(id, entry);
    }
    indexDirty = true;
}

/** A game's summary for the replays list, built up as its events come in */
function summarize(summary, e) {
    if (!summary) {
        return {
            id: e.id, mode: e.mode, code: e.code, startedAt: e.startedAt, names: e.names || null, cpus: e.cpus || [], control: e.control,
            teams: e.teams || null, events: 0, errors: 0, problems: 0, markers: 0, endedAt: e.startedAt, result: null,
        };
    }
    summary.events++;
    const at = e.ct || e.t;
    if (at && !IDLE.has(e.type)) summary.endedAt = new Date(at).toISOString();
    if (e.type === 'error' || e.type === 'console-error') summary.errors++;
    if (e.type === 'marker') summary.markers++;
    if (['hitch', 'socket-disconnected', 'input-ignored', 'cpu-gave-up', 'console-warn', 'attack-lost'].includes(e.type)) summary.problems++;
    if (e.type === 'round-start' && e.names) summary.names = e.names;
    if (e.type === 'match-over') summary.result = { winner: e.winner, team: e.team, how: e.how };
    if (e.type === 'solo-game-over' || e.type === 'topped-out' && !summary.result) summary.result = { level: e.level, score: e.score, how: 'topped out' };
    if (e.type === 'result-shown') summary.result = { title: e.title, win: e.win };
    return summary;
}

function saveIndex(sync) {
    if (!indexDirty) return;
    indexDirty = false;
    const text = JSON.stringify(summaries);
    if (sync === true) {
        try { fs.writeFileSync(INDEX, text); } catch (e) { /* stopping anyway */ }
        return;
    }
    fs.promises.mkdir(path.dirname(INDEX), { recursive: true }).then(() => fs.promises.writeFile(INDEX, text)).catch(() => { indexDirty = true; });
}

/** Summary of a game written before this server started (read its file once) */
function summaryFromFile(id) {
    const text = read(id);
    if (!text) return null;
    let summary = null;
    for (const line of text.split('\n')) {
        if (!line) continue;
        try {
            const e = JSON.parse(line);
            summary = summary ? summarize(summary, e) : summarize(null, e.type === 'game' ? e : { id });
        } catch (err) { /* skip a broken line */ }
    }
    if (summary) {
        summaries[id] = summary;
        indexDirty = true;
    }
    return summary;
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

/** Write what's waiting: in the background, or (sync, when the server is stopping) right now */
function flush(sync) {
    flushTimer = null;
    for (const [id, lines] of pending) {
        if (!lines.length) continue;
        const text = lines.join('\n') + '\n';
        const file = path.join(DIR, id + '.jsonl');
        if (sync === true) {
            try { fs.appendFileSync(file, text); } catch (e) { /* stopping anyway */ }
            continue;
        }
        const previous = writing.get(id) || Promise.resolve();
        const next = previous.then(() => fs.promises.appendFile(file, text)).catch((e) => console.warn('[gameLogs] could not write', id, e.message));
        writing.set(id, next);
        next.then(() => { if (writing.get(id) === next) writing.delete(id); });
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
    // Summaries of games whose files are gone
    const kept = new Set(files.map(f => f.replace(/\.jsonl$/, '')));
    for (const id of Object.keys(summaries)) {
        if (!kept.has(id) && !bytes.has(id)) {
            delete summaries[id];
            indexDirty = true;
        }
    }
    for (const file of files.slice(0, Math.max(0, files.length - KEEP))) {
        try {
            fs.unlinkSync(path.join(DIR, file));
        } catch (e) { /* already gone */ }
        const id = file.replace(/\.jsonl$/, '');
        bytes.delete(id);
        delete summaries[id];
        indexDirty = true;
    }
}

/** A 🐞: someone flagged a glitch. Goes in the game's log and in the list of all markers */
function mark(id, src, details = {}) {
    write(id, src, [{ type: 'marker', ...details }]);
    fs.promises.mkdir(path.dirname(MARKERS), { recursive: true })
        .then(() => fs.promises.appendFile(MARKERS, JSON.stringify({ t: Date.now(), id, src, ...details }) + '\n'))
        .catch(() => { /* the game's log still has it */ });
}

/** The games on disk, newest first, with their summaries (for replays.html) */
function summariesList() {
    flush(true);
    let files = [];
    try {
        files = fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
    } catch (e) {
        return [];
    }
    return files.map((file) => {
        const id = file.replace(/\.jsonl$/, '');
        const summary = summaries[id] || summaryFromFile(id) || { id };
        let size = 0;
        try { size = fs.statSync(path.join(DIR, file)).size; } catch (e) { /* gone */ }
        return { ...summary, size };
    });
}

/** The games on disk, newest first: id, size, and the first line (what game it was) */
function list() {
    flush(true);
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
    flush(true);
    try {
        return fs.readFileSync(path.join(DIR, id + '.jsonl'), 'utf8');
    } catch (e) {
        return null;
    }
}

const isId = id => ID.test(String(id)) && bytes.has(id);

process.on('exit', () => {
    flush(true);
    saveIndex(true);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => process.exit(0)); // Render stops the server with SIGTERM

module.exports = { start, write, mark, list, summariesList, read, flush, isId, DIR };
