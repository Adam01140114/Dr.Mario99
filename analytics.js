/**
 * DR. MARIO 99 - PLAYER STATS
 * ===========================
 *
 * How many people play, how often they come back and where they came from; the
 * owner reads it at /stats (public/stats.html). Each browser has a random id in
 * its localStorage (scripts/hello.js) and sends it when it connects; nothing else
 * identifies a person: no IP addresses, no cookies, no third parties.
 *
 * A visitor opened the game; a player started a game (CPUs never count). One
 * person on two devices counts twice. A device can opt out (the switch on the
 * stats page), so the owner's own games don't inflate the numbers.
 *
 * Kept in analytics.json beside the game logs, so it only survives a redeploy
 * when LOG_DIR is on a persistent disk (report().persistent says which).
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : path.join(__dirname, 'logs');
const FILE = path.join(ROOT, 'analytics.json');
const TZ = process.env.STATS_TZ || 'America/Los_Angeles'; // when "today" starts
const KEEP_DAYS = 120;      // who played on which day (for repeat players); longer needs more memory
const MAX_PLAYERS = 200000; // a limit on memory, should anyone make up ids by the thousand
const SAVE_MS = 30000;
const WORD = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const ID = /^[a-zA-Z0-9-]{8,64}$/;
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview/i;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => dayFormat.format(new Date());
const dayBefore = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10);

let state = { since: new Date().toISOString(), players: {}, days: {}, peak: { n: 0, at: null } };
const online = new Map(); // id -> how many connections it has open
let dirty = false;

function emptyDay() {
    return { visitors: new Set(), played: new Set(), plays: {}, seconds: 0, visits: 0, peak: 0 };
}

function dayOf(day = today()) {
    return state.days[day] || (state.days[day] = emptyDay());
}

function load() {
    let saved;
    try {
        saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (e) {
        return; // first run
    }
    for (const day of Object.values(saved.days || {})) {
        day.visitors = new Set(day.visitors);
        day.played = new Set(day.played);
    }
    state = { ...state, ...saved };
}

function serialize() {
    const days = {};
    for (const [key, day] of Object.entries(state.days)) days[key] = { ...day, visitors: [...day.visitors], played: [...day.played] };
    return JSON.stringify({ ...state, days });
}

function save(sync) {
    if (!dirty) return;
    dirty = false;
    const text = serialize();
    const temp = FILE + '.tmp';
    try {
        fs.mkdirSync(ROOT, { recursive: true });
        if (sync === true) {
            fs.writeFileSync(temp, text);
            fs.renameSync(temp, FILE);
            return;
        }
    } catch (e) {
        return; // stopping anyway, or no disk to write on
    }
    fs.promises.writeFile(temp, text).then(() => fs.promises.rename(temp, FILE)).catch(() => { dirty = true; });
}

function prune() {
    const oldest = dayBefore(today(), KEEP_DAYS);
    for (const key of Object.keys(state.days)) if (key < oldest) delete state.days[key];
}

/** A page connected (the 'hello' message). Returns the id to pass to the others, or null */
function visit(hello, userAgent) {
    if (!hello || typeof hello !== 'object' || hello.ignore || BOTS.test(String(userAgent))) return null;
    const id = String(hello.id || '');
    if (!ID.test(id)) return null;
    const key = today();
    let player = state.players[id];
    if (!player) {
        if (Object.keys(state.players).length >= MAX_PLAYERS) return null;
        const src = String(hello.src || 'direct').toLowerCase();
        player = state.players[id] = {
            first: key, last: key, firstPlay: null, plays: 0, name: null,
            src: WORD.test(src) ? src : 'other', phone: !!hello.phone,
            lang: String(hello.lang || '').replace(/[^a-zA-Z-]/g, '').slice(0, 12) || null,
        };
    }
    player.last = key;
    const day = dayOf(key);
    day.visitors.add(id);
    day.visits++;
    online.set(id, (online.get(id) || 0) + 1);
    if (online.size > day.peak) day.peak = online.size;
    if (online.size > state.peak.n) state.peak = { n: online.size, at: new Date().toISOString() };
    dirty = true;
    return id;
}

/** They started a game */
function played(id, mode) {
    const player = id && state.players[id];
    if (!player) return;
    const key = today();
    const day = dayOf(key);
    day.played.add(id);
    day.plays[mode] = (day.plays[mode] || 0) + 1;
    player.plays++;
    player.last = key;
    if (!player.firstPlay) player.firstPlay = key;
    dirty = true;
}

/** The name they typed (the latest one) */
function named(id, name) {
    const player = id && state.players[id];
    if (!player || !name) return;
    player.name = String(name).slice(0, 16);
    dirty = true;
}

function left(id, seconds) {
    if (!id) return;
    const open = (online.get(id) || 1) - 1;
    if (open > 0) online.set(id, open);
    else online.delete(id);
    const day = dayOf();
    day.seconds += Math.min(Math.max(seconds, 0), 6 * 3600); // a tab left open all day isn't a six-hour game
    dirty = true;
}

/** Everyone who did this in the last n days, today included */
function uniqueOver(n, field) {
    const key = today();
    const seen = new Set();
    for (let i = 0; i < n; i++) {
        const day = state.days[dayBefore(key, i)];
        if (day) for (const id of day[field]) seen.add(id);
    }
    return seen.size;
}

/** Of those who first played at least `after` days ago (up to 30 days back), how many played on that later day */
function cameBack(after) {
    const key = today();
    let cohort = 0;
    let returned = 0;
    for (const [id, player] of Object.entries(state.players)) {
        if (!player.firstPlay) continue;
        const then = dayBefore(player.firstPlay, -after);
        if (then > key || player.firstPlay < dayBefore(key, 30 + after)) continue;
        cohort++;
        const day = state.days[then];
        if (day && day.played.has(id)) returned++;
    }
    return { cohort, returned };
}

function report(live = []) {
    const key = today();
    const daily = [];
    for (let i = 29; i >= 0; i--) {
        const date = dayBefore(key, i);
        const day = state.days[date];
        const players = day ? [...day.played] : [];
        const fresh = players.filter(id => state.players[id] && state.players[id].firstPlay === date).length;
        daily.push({ date, visitors: day ? day.visitors.size : 0, new: fresh, returning: players.length - fresh, plays: day ? Object.values(day.plays).reduce((a, b) => a + b, 0) : 0 });
    }
    const modes = {};
    let seconds = 0;
    let visits = 0;
    for (let i = 0; i < 30; i++) {
        const day = state.days[dayBefore(key, i)];
        if (!day) continue;
        for (const [mode, n] of Object.entries(day.plays)) modes[mode] = (modes[mode] || 0) + n;
        if (i < 7) {
            seconds += day.seconds;
            visits += day.visits;
        }
    }
    const sources = {};
    const devices = { phone: 0, computer: 0 };
    const languages = {};
    const all = Object.entries(state.players);
    for (const [, p] of all) {
        const source = sources[p.src] || (sources[p.src] = { visitors: 0, players: 0, repeat: 0 });
        source.visitors++;
        if (p.firstPlay) source.players++;
        if (p.firstPlay && p.last > p.firstPlay) source.repeat++;
        devices[p.phone ? 'phone' : 'computer']++;
        if (p.lang) languages[p.lang] = (languages[p.lang] || 0) + 1;
    }
    const todayDay = state.days[key];
    return {
        since: state.since,
        timezone: TZ,
        persistent: !!process.env.LOG_DIR || !(process.env.RENDER || process.env.NODE_ENV === 'production'),
        now: { online: online.size, games: live },
        peak: state.peak,
        today: { visitors: todayDay ? todayDay.visitors.size : 0, players: todayDay ? todayDay.played.size : 0 },
        week: { visitors: uniqueOver(7, 'visitors'), players: uniqueOver(7, 'played') },
        month: { visitors: uniqueOver(30, 'visitors'), players: uniqueOver(30, 'played') },
        total: { visitors: all.length, players: all.filter(([, p]) => p.firstPlay).length, plays: all.reduce((sum, [, p]) => sum + p.plays, 0) },
        cameBack: { day1: cameBack(1), day7: cameBack(7) },
        avgVisitSeconds: visits ? Math.round(seconds / visits) : 0,
        daily,
        modes,
        sources: Object.entries(sources).map(([name, s]) => ({ name, ...s })).sort((a, b) => b.visitors - a.visitors).slice(0, 20),
        devices,
        languages: Object.entries(languages).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 8),
        recent: all.filter(([, p]) => p.firstPlay).sort(([, a], [, b]) => (b.last > a.last ? 1 : b.last < a.last ? -1 : b.plays - a.plays)).slice(0, 25)
            .map(([id, p]) => ({ name: p.name, src: p.src, phone: p.phone, first: p.first, last: p.last, plays: p.plays, online: online.has(id) })),
    };
}

load();
prune();
setInterval(save, SAVE_MS).unref();
setInterval(prune, 3600000).unref();
process.on('exit', () => save(true));

module.exports = { visit, played, named, left, report };
