#!/usr/bin/env node
/**
 * DR. MARIO 99 - GAME LOG READER
 * ==============================
 *
 * Reads the game logs in logs/games/ (written by gameLogs.js) to find out what
 * happened in a game that glitched. See CLAUDE.md.
 *
 *   node tools/gamelog.js list [count]              newest games, with problems found
 *   node tools/gamelog.js summary <game>            who played, what happened, every problem
 *   node tools/gamelog.js around <game> <when> [s]  everything within s seconds (default 5)
 *   node tools/gamelog.js board <game> <when> [P]   the boards as they were then
 *   node tools/gamelog.js grep <game> <pattern>     events whose type or text matches
 *   node tools/gamelog.js markers [count]           the latest 🐞 marks, across games
 *   node tools/gamelog.js audit <game>              look for glitches: floating pieces, wrong virus
 *                                                   counts, stuck or teleporting pills, junk that never
 *                                                   dropped, broken pills, bad clears, wrong next pill,
 *                                                   CPUs that ended their own game, errors...
 *
 * <game>  a log id (or the start of one), 'latest', or 'marked' (the latest game with a 🐞)
 * <when>  a time of day (15:42:07), 'marker' / 'marker:2' (that game's 1st / 2nd 🐞),
 *         'error' / 'error:2', or +seconds from the start of the game (+93.5)
 */

'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'logs');
const DIR = path.join(ROOT, 'games');
const MARKERS = path.join(ROOT, 'markers.jsonl');

// Everyday events, left out of the summary timeline (counted instead)
const ROUTINE = new Set(['keyframe', 'frame', 'move', 'move-ignored', 'board', 'key-down', 'key-up', 'input', 'button', 'ping', 'pill', 'landed', 'server-in', 'server-out',
    'cpu-plan', 'clear', 'junk-drop', 'hold', 'board-pictures-relayed', 'lobby', 'viruses', 'board-created', 'frozen', 'screen', 'got-tvFx', 'targets', 'page-blur', 'page-focus']);
const PROBLEMS = new Set(['error', 'console-error', 'console-warn', 'hitch', 'long-task', 'socket-disconnected', 'socket-error', 'socket-reconnecting', 'input-ignored',
    'cpu-gave-up', 'log-full', 'log-dropped', 'direct-link-failed', 'attack-lost', 'marker', 'controller-hid-error', 'phone-hidden', 'page-hidden', 'got-tvJoinError']);

function die(message) {
    console.error(message);
    process.exit(1);
}

function gameFiles() {
    try {
        return fs.readdirSync(DIR).filter(f => f.endsWith('.jsonl')).sort().reverse().map(f => f.replace(/\.jsonl$/, ''));
    } catch (e) {
        return [];
    }
}

function load(id) {
    const lines = fs.readFileSync(path.join(DIR, id + '.jsonl'), 'utf8').split('\n').filter(Boolean);
    const events = [];
    for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch (e) { events.push({ type: 'unreadable-line', text: line.slice(0, 200) }); }
    }
    const head = events[0] && events[0].type === 'game' ? events.shift() : { id };
    const start = Date.parse(head.startedAt) || (events[0] && (events[0].ct || events[0].t)) || 0;
    for (const e of events) e.at = e.ct || e.t || start; // when it happened (by the sender's clock)
    events.sort((a, b) => a.at - b.at);
    return { head, events, start };
}

function resolveGame(which) {
    const ids = gameFiles();
    if (!ids.length) die('No game logs yet (' + DIR + ')');
    if (!which || which === 'latest') return ids[0];
    if (which === 'marked') {
        const marked = readMarkers().reverse().find(m => ids.includes(m.id));
        if (!marked) die('No game with a 🐞 marker');
        return marked.id;
    }
    const found = ids.find(id => id === which) || ids.find(id => id.startsWith(which)) || ids.find(id => id.includes(which));
    if (!found) die('No game matching ' + which + '. Try: node tools/gamelog.js list');
    return found;
}

function readMarkers() {
    try {
        return fs.readFileSync(MARKERS, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

const clock = ms => new Date(ms).toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(new Date(ms).getMilliseconds()).padStart(3, '0');
const since = (ms, start) => (ms >= start ? '+' : '') + ((ms - start) / 1000).toFixed(1) + 's';

/** One event as a short line */
function line(e, start) {
    const { at, t, ct, src, type, ...rest } = e;
    let text = JSON.stringify(rest);
    if (text.length > 400) text = text.slice(0, 400) + '…';
    return `${clock(at)} ${since(at, start).padStart(8)}  ${String(src || '').padEnd(9)} ${type.padEnd(22)} ${text === '{}' ? '' : text}`;
}

/** A time in the game: '15:42:07', '+93.5', 'marker:2', 'error' */
function resolveWhen(when, game) {
    const { events, start } = game;
    const m = /^(marker|error)(?::(\d+))?$/.exec(when || '');
    if (m) {
        const list = events.filter(e => (m[1] === 'marker' ? e.type === 'marker' : e.type === 'error' || e.type === 'console-error'));
        const e = list[(parseInt(m[2], 10) || 1) - 1];
        if (!e) die(`No ${m[1]} ${m[2] || 1} in this game (it has ${list.length})`);
        return e.at;
    }
    if (/^\+[\d.]+$/.test(when)) return start + parseFloat(when.slice(1)) * 1000;
    const hms = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(when || '');
    if (hms) {
        const d = new Date(start);
        d.setHours(+hms[1], +hms[2], +(hms[3] || 0), +((hms[4] || '0') + '00').slice(0, 3));
        return d.getTime();
    }
    const parsed = Date.parse(when);
    if (!isNaN(parsed)) return parsed;
    die('Not a time: ' + when);
}

// Board pictures: one character per cell, '.' empty, 'a'+n = SPRITE_CODES[n] (components.js)
const COLORS = ['b', 'r', 'y']; // blue, brown ("r"), yellow
const KINDS = ['dot', 'covid', 'left', 'right', 'up', 'down', 'x', 'o'];
function drawGrid(grid) {
    const rows = [];
    for (let y = 0; y < 17; y++) {
        let row = '';
        for (let x = 0; x < 8; x++) {
            const ch = grid[y * 8 + x];
            if (!ch || ch === '.') { row += ' .'; continue; }
            const n = ch.charCodeAt(0) - 97;
            const color = COLORS[Math.floor(n / 8)] || '?';
            const kind = KINDS[n % 8];
            row += ' ' + (kind === 'covid' ? color.toUpperCase() : kind === 'x' || kind === 'o' ? '*' : color);
        }
        rows.push(String(16 - y).padStart(2) + ' |' + row + ' |');
    }
    rows.push('    ' + '-'.repeat(17));
    rows.push('     0 1 2 3 4 5 6 7   (B R Y = virus, b r y = pill, * = clearing; rows count up from the bottom)');
    return rows.join('\n');
}

function problemsOf(events) {
    return events.filter(e => PROBLEMS.has(e.type) && !(e.type === 'hitch' && e.ms < 400) && !(e.type === 'ping' && e.ms < 300));
}

/* ---------- Commands ---------- */

function list(count = 20) {
    const ids = gameFiles().slice(0, count);
    const marked = new Set(readMarkers().map(m => m.id));
    for (const id of ids) {
        const { head, events, start } = load(id);
        const end = events.length ? events[events.length - 1].at : start;
        const names = head.names ? Object.values(head.names).join(', ') : head.control || '';
        const problems = problemsOf(events);
        const errors = problems.filter(e => e.type === 'error' || e.type === 'console-error').length;
        const result = events.find(e => e.type === 'match-over' || e.type === 'solo-game-over' || e.type === 'result-shown' || e.type === 'topped-out');
        console.log(`${marked.has(id) ? '🐞' : '  '} ${id}  ${String(head.mode || '').padEnd(7)} ${Math.round((end - start) / 1000)}s  ${events.length} events`
            + `${errors ? `  ${errors} ERRORS` : ''}${problems.length ? `  ${problems.length} problems` : ''}  ${names}${result ? '  → ' + result.type : ''}`);
    }
    if (!ids.length) console.log('No game logs yet.');
}

function summary(which) {
    const id = resolveGame(which);
    const game = load(id);
    const { head, events, start } = game;
    const end = events.length ? events[events.length - 1].at : start;
    const { gameData, ...about } = head;
    console.log(`GAME ${id}`);
    console.log(JSON.stringify(about, null, 1));
    if (gameData) console.log(`gameData: ${gameData.virusPositions ? gameData.virusPositions.length : 0} virus positions, ${gameData.randomList ? gameData.randomList.length : 0} pills, ${gameData.virusCount || ''} viruses`);
    console.log(`\nRan ${((end - start) / 1000).toFixed(1)}s, ${events.length} events.`);

    const counts = {};
    for (const e of events) counts[`${e.src || '?'} ${e.type}`] = (counts[`${e.src || '?'} ${e.type}`] || 0) + 1;
    console.log('\nCOUNTS (source event: n)');
    console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n'));

    console.log('\nTIMELINE (routine moves, inputs and board pictures left out)');
    for (const e of events) if (!ROUTINE.has(e.type)) console.log('  ' + line(e, start));

    const problems = problemsOf(events);
    console.log(`\nPROBLEMS (${problems.length})`);
    for (const e of problems) console.log('  ' + line(e, start));
    if (!problems.length) console.log('  none found');
    console.log(`\nNext: node tools/gamelog.js around ${id} <time|marker|error> 5   ·   node tools/gamelog.js board ${id} <time|marker>`);
}

function around(which, when, seconds = 5) {
    const id = resolveGame(which);
    const game = load(id);
    const at = resolveWhen(when, game);
    const span = seconds * 1000;
    console.log(`GAME ${id} · everything from ${clock(at - span)} to ${clock(at + span)} (${since(at, game.start)})`);
    for (const e of game.events) if (Math.abs(e.at - at) <= span) console.log((Math.abs(e.at - at) < 50 ? '>>' : '  ') + line(e, game.start));
}

function board(which, when, player) {
    const id = resolveGame(which);
    const game = load(id);
    const at = resolveWhen(when, game);
    const marker = game.events.find(e => e.type === 'marker' && Math.abs(e.at - at) < 50 && e.boards);
    const latest = {};
    if (marker) {
        for (const [p, state] of Object.entries(marker.boards)) latest[p] = { ...state, at: marker.at, src: 'marker' };
    } else {
        for (const e of game.events) if (e.type === 'board' && e.at <= at) latest[e.p] = e;
        for (const e of game.events) if ((e.type === 'topped-out' || e.type === 'stage-clear') && e.board && e.at <= at) latest[e.p] = { ...e.board, at: e.at };
    }
    const players = Object.keys(latest).filter(p => !player || String(p) === String(player).replace(/^P/i, ''));
    if (!players.length) die('No board pictures before then');
    const names = game.head.names || {};
    for (const p of players) {
        const s = latest[p];
        console.log(`\nP${p} ${names[p] || ''} at ${clock(s.at)} (${since(s.at, game.start)})  score ${s.s}  viruses ${s.v}  level ${s.l}  next ${JSON.stringify(s.n)}  hold ${JSON.stringify(s.h)}${s.hu ? ' (used)' : ''}`);
        console.log(`   pill ${JSON.stringify(s.pill)}  blocked ${s.blocked}  falling ${s.falling}  throwing ${s.throwing}  junk ${s.junk} waiting ${s.junkWaiting}  waitSpawn ${s.waitSpawn}`);
        if (s.g) console.log(drawGrid(s.g));
    }
}

function grep(which, pattern) {
    const id = resolveGame(which);
    const game = load(id);
    const re = new RegExp(pattern, 'i');
    for (const e of game.events) if (re.test(e.type) || re.test(JSON.stringify(e))) console.log(line(e, game.start));
}

function markers(count = 10) {
    const all = readMarkers().slice(-count).reverse();
    for (const m of all) console.log(`${new Date(m.t).toLocaleString()}  ${m.id}  ${m.src}  ${m.note || ''}`);
    if (!all.length) console.log('No 🐞 markers yet.');
}

/* ---------- Audit: look for glitches ---------- */

// A board picture as cells: cells[x][y] = { color, kind } or null (y counts up from the bottom)
function cellsOf(grid) {
    const cells = Array.from({ length: 8 }, () => Array(17).fill(null));
    for (let i = 0; i < grid.length; i++) {
        const ch = grid[i];
        if (ch === '.') continue;
        const n = ch.charCodeAt(0) - 97;
        cells[i % 8][16 - Math.floor(i / 8)] = { color: COLORS[Math.floor(n / 8)], kind: KINDS[n % 8] };
    }
    return cells;
}

/** Pieces with nothing under them although nothing is falling (the moving pill left out) */
function floatingPieces(state) {
    const cells = cellsOf(state.g);
    const pill = new Set(((state.pill && !state.pill.placed && state.pill.cells) || []).filter(Boolean).map(([x, y]) => x + ',' + y));
    const filled = (x, y) => y < 0 || (cells[x][y] && !pill.has(x + ',' + y));
    const out = [];
    for (let x = 0; x < 8; x++) {
        for (let y = 1; y < 17; y++) {
            const c = cells[x][y];
            if (!c || pill.has(x + ',' + y) || c.kind === 'x' || c.kind === 'o') continue;
            // Viruses don't fall - but one high up with nothing under it is junk left in mid-air
            if (c.kind === 'covid' && y < 8) continue;
            if (filled(x, y - 1)) continue;
            // Half of a pill: it holds if its other half is held up
            if (c.kind === 'left' && x < 7 && cells[x + 1][y] && cells[x + 1][y].kind === 'right' && filled(x + 1, y - 1)) continue;
            if (c.kind === 'right' && x > 0 && cells[x - 1][y] && cells[x - 1][y].kind === 'left' && filled(x - 1, y - 1)) continue;
            if (c.kind === 'up' && cells[x][y - 1] && cells[x][y - 1].kind === 'down') continue; // its bottom half is right below
            out.push([x, y, c.color, c.kind]);
        }
    }
    return out;
}

function audit(which) {
    const id = resolveGame(which);
    const game = load(id);
    const { events, start } = game;
    const names = game.head.names || {};
    const who = p => `P${p}${names[p] ? ' ' + names[p] : ''}`;
    const findings = [];
    const find = (at, p, kind, text) => findings.push({ at, p, kind, text });

    const finished = {}; // player -> when they were out or the match ended
    let matchOver = Infinity;
    for (const e of events) {
        if (e.type === 'eliminated') finished[e.p] = e.at;
        if (e.type === 'match-over' || e.type === 'solo-game-over') matchOver = Math.min(matchOver, e.at);
        if (e.type === 'topped-out' && e.src === 'page') finished[e.p] = e.at;
    }
    const playing = (p, at) => at < matchOver && !(finished[p] <= at);
    const logEnd = events.length ? events[events.length - 1].at : start;

    // Board pictures (one a second, with the board's inner state)
    const byPlayer = {};
    for (const e of events) if (e.type === 'board' && e.g) (byPlayer[e.p] = byPlayer[e.p] || []).push(e);
    for (const [p, states] of Object.entries(byPlayer)) {
        let floatRun = 0, countRun = 0, stuckRun = 0;
        const seenFloating = new Set(); // report each stuck piece once
        for (let i = 0; i < states.length; i++) {
            const s = states[i];
            if (!playing(p, s.at)) continue;
            const settled = !s.falling && s.junk === '0000' && !s.blocked && !s.waitSpawn;
            // 1. Floating pieces, two pictures in a row while nothing was falling
            const floating = settled ? floatingPieces(s) : [];
            floatRun = floating.length ? floatRun + 1 : 0;
            const fresh = floating.filter(f => !seenFloating.has(f.join()));
            if (floatRun >= 2 && fresh.length) {
                for (const f of fresh) seenFloating.add(f.join());
                find(s.at, p, 'floating', `${fresh.length} piece(s) hanging in the air with nothing falling: ${JSON.stringify(fresh)}`);
            }
            // 2. The virus counter disagrees with the viruses on the board
            const shown = (s.g.match(/[bjr]/g) || []).length; // 'covid' sprites: index 1, 9, 17 -> b, j, r
            countRun = shown !== s.v ? countRun + 1 : 0;
            if (countRun === 3) find(s.at, p, 'virus-count', `the counter says ${s.v} viruses, the board shows ${shown}`);
            // 3. A pill that doesn't move down for 3 seconds
            const prev = states[i - 1];
            const same = prev && s.pill && prev.pill && !s.pill.placed && JSON.stringify(s.pill.cells) === JSON.stringify(prev.pill.cells);
            stuckRun = same && !s.blocked ? stuckRun + 1 : 0;
            if (stuckRun === 3) find(s.at, p, 'stuck-pill', `the pill hasn't moved for 3 s: ${JSON.stringify(s.pill.cells)}`);
        }
    }

    // 4. Moves that jump more than one cell
    for (const e of events) {
        if (e.type !== 'move' || !e.from || !e.to || e.landed) continue;
        const from = e.from.filter(Boolean), to = e.to.filter(Boolean);
        if (from.length !== to.length) continue;
        const far = to.some(([x, y], i) => Math.abs(x - from[i][0]) + Math.abs(y - from[i][1]) > 2);
        if (far && e.key !== 'c' && e.key !== 'C') find(e.at, e.p, 'teleport', `key ${e.key} moved the pill from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    }

    // 4b. Pills where they can't be: a new pill away from the spawn spot, or a pill on a virus
    const grids = {}; // player -> latest board grid from the replay frames
    for (const e of events) {
        if (e.type === 'keyframe') grids[e.p] = e.g;
        else if (e.type === 'frame' && e.d && grids[e.p]) {
            const g = grids[e.p].split('');
            for (const part of e.d.split(';')) { const [i, ch] = part.split(','); g[+i] = ch; }
            grids[e.p] = g.join('');
        } else if (e.type === 'pill' && e.pill && e.pill.cells) {
            const cells = e.pill.cells.filter(Boolean).map(([x, y]) => x + ',' + y).sort().join(' ');
            if (cells !== '3,15 4,15') find(e.at, e.p, 'spawn', `the new pill came in at ${cells} instead of 3,15 4,15`);
        } else if ((e.type === 'move' && e.to) || (e.type === 'landed' && e.cells)) {
            const grid = grids[e.p];
            if (!grid) continue;
            for (const cell of (e.to || e.cells).filter(Boolean)) {
                const [x, y] = cell;
                const ch = grid[(16 - y) * 8 + x];
                if (ch && 'bjr'.includes(ch)) find(e.at, e.p, 'overlap', `the pill ${e.type === 'move' ? 'moved' : 'landed'} onto a virus at ${x},${y}`);
            }
        }
    }

    // 5. Junk that was counted but never dropped; 6. long waits for the next pill
    const pending = {};
    const lastPill = {};
    for (const e of events) {
        if (e.type === 'junk-incoming' && e.counted) (pending[e.p] = pending[e.p] || []).push(e.at);
        if (e.type === 'junk-drop' && pending[e.p] && pending[e.p].length) pending[e.p].shift();
        if (e.type === 'pill') {
            if (lastPill[e.p] && playing(e.p, e.at) && e.at - lastPill[e.p] > 12000) find(e.at, e.p, 'slow-pill', `${((e.at - lastPill[e.p]) / 1000).toFixed(1)} s since the last pill`);
            lastPill[e.p] = e.at;
        }
    }
    for (const [p, list] of Object.entries(pending)) {
        // Only once the log goes on 20 s past it (the game may still be running)
        for (const at of list) if (at + 20000 < logEnd && playing(p, at + 20000)) find(at, p, 'junk-lost', 'junk was counted but never dropped');
    }

    // 7. The result: a "cleared" win should have no viruses left
    for (const e of events) {
        if (e.type === 'match-over' && e.how === 'cleared') {
            // The board saved at the moment of the win (stage-clear), not a picture from up to a second before
            const won = events.find(x => x.type === 'stage-clear' && x.p === e.winner && Math.abs(x.at - e.at) < 1000 && x.board);
            const shown = won ? (won.board.g.match(/[bjr]/g) || []).length : null;
            if (shown) find(e.at, e.winner, 'result', `won by clearing, but its board still shows ${shown} virus(es)`);
            if (won && won.board.v !== 0) find(e.at, e.winner, 'virus-count', `won by clearing, but its virus counter says ${won.board.v}`);
        }
    }

    // 7b. A pill's turn should match the order of its halves; half a pill needs its other half
    for (const e of events) {
        if (e.type === 'move' && e.to && e.to.filter(Boolean).length === 2) {
            const [a, b] = e.to;
            const ok = { 0: a[1] < b[1], 1: a[0] < b[0], 2: a[1] > b[1], 3: a[0] > b[0] }[e.rot];
            if (ok === false) find(e.at, e.p, 'rotation', `the pill's turn (${e.rot}) doesn't match its halves: ${JSON.stringify(e.to)}`);
        }
    }
    const seenBroken = new Set();
    for (const e of events) {
        if (e.type !== 'board' || e.falling || e.blocked || e.waitSpawn || e.junk !== '0000') continue;
        const cells = cellsOf(e.g);
        const moving = new Set(((e.pill && !e.pill.placed && e.pill.cells) || []).filter(Boolean).map(([x, y]) => x + ',' + y));
        const at = (x, y) => (cells[x] && cells[x][y]) || null;
        for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 17; y++) {
                const c = cells[x][y];
                const other = c && { left: [x + 1, y, 'right'], right: [x - 1, y, 'left'], up: [x, y - 1, 'down'], down: [x, y + 1, 'up'] }[c.kind];
                if (!other || moving.has(x + ',' + y)) continue;
                const partner = at(other[0], other[1]);
                const key = [e.p, x, y, c.kind].join();
                if ((!partner || partner.kind !== other[2]) && !seenBroken.has(key)) {
                    seenBroken.add(key);
                    find(e.at, e.p, 'broken-pill', `half a pill (${c.kind}) at ${x},${y} has no other half`);
                }
            }
        }
    }

    // 7c. Every cleared cell is in a line of 4+ of its colour; the next pill is the one shown
    const shownNext = {};
    for (const e of events) {
        if (e.type === 'clear' && e.cells) {
            const colorAt = new Map(e.cells.map(c => [c[0] + ',' + c[1], c[2]]));
            const line = (x, y, color, dx, dy) => {
                let n = 1;
                for (const s of [1, -1]) for (let i = 1; colorAt.get((x + s * i * dx) + ',' + (y + s * i * dy)) === color; i++) n++;
                return n;
            };
            const bad = e.cells.filter(([x, y, color]) => Math.max(line(x, y, color, 1, 0), line(x, y, color, 0, 1)) < 4);
            if (bad.length) find(e.at, e.p, 'bad-clear', `cleared without a line of 4: ${JSON.stringify(bad)}`);
        }
        if (e.type === 'pill' && e.pill && e.pill.cells) {
            const colors = e.pill.cells.map(c => c && c[2]);
            if (shownNext[e.p] && shownNext[e.p].join() !== colors.join()) find(e.at, e.p, 'next-pill', `showed ${shownNext[e.p]} as next, got ${colors}`);
            shownNext[e.p] = e.next || null;
        }
    }

    // 7c-2. Junk drops in the colour it was shown in
    const shownJunk = {};
    for (const e of events) {
        if (e.type === 'junk-incoming' && e.shown) shownJunk[e.p] = e.shown.slice();
        if (e.type === 'junk-drop' && shownJunk[e.p] && shownJunk[e.p].length) {
            const [, color] = shownJunk[e.p].shift();
            if (color !== e.color) find(e.at, e.p, 'junk-color', `showed ${color} junk coming, ${e.color} dropped`);
        }
    }

    // 7d. A CPU that ended its own game with room left on the top row
    const lastPlan = {};
    for (const e of events) {
        if (e.type === 'cpu-plan') lastPlan[e.p] = e;
        if (e.type !== 'topped-out' || !lastPlan[e.p] || (lastPlan[e.p].plan && lastPlan[e.p].plan.escape) || !e.board) continue;
        const cells = cellsOf(e.board.g);
        for (const cell of (e.board.pill && e.board.pill.cells) || []) if (cell) cells[cell[0]][cell[1]] = null;
        const open = [];
        for (const step of [-1, 1]) {
            for (let x = 3 + step; x >= 0 && x <= 6 && !cells[x][15] && !cells[x + 1][15]; x += step) {
                if (!cells[x][14] && !cells[x + 1][14]) open.push(x);
            }
        }
        if (open.length) find(e.at, e.p, 'cpu-suicide', `topped out (plan ${JSON.stringify(lastPlan[e.p].plan)}) with room to slide to column ${open.join(', ')}`);
    }

    // 8. Errors, warnings, freezes, CPUs that gave up
    for (const e of events) {
        if (e.type === 'error' || e.type === 'console-error') find(e.at, e.p, 'error', e.message || e.text);
        if (e.type === 'console-warn') find(e.at, e.p, 'warning', e.text);
        if (e.type === 'hitch' && e.ms >= 400) find(e.at, null, 'freeze', `the page froze for ${e.ms} ms`);
        if (e.type === 'cpu-gave-up') find(e.at, e.p, 'cpu', `the CPU gave up on its plan ${JSON.stringify(e.plan)} (pill at rot ${e.rot}, x ${e.x})`);
        if (e.type === 'input-ignored' && e.why !== 'match over' && e.why !== 'player is out') find(e.at, e.p, 'input', `${e.action} ignored: ${e.why}`);
    }

    findings.sort((a, b) => a.at - b.at);
    console.log(`AUDIT ${id}: ${findings.length} finding(s)`);
    const kinds = {};
    for (const f of findings) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    if (findings.length) console.log('  ' + Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join(', '));
    for (const f of findings) console.log(`  ${clock(f.at)} ${since(f.at, start).padStart(8)}  ${f.kind.padEnd(11)} ${f.p != null ? who(f.p).padEnd(12) : ''.padEnd(12)} ${f.text}`);
    if (findings.length) console.log(`\nLook closer: node tools/gamelog.js around ${id} <time> 3   ·   board ${id} <time> P<n>`);
}

const [command, a, b, c] = process.argv.slice(2);
switch (command) {
    case 'list': list(parseInt(a, 10) || 20); break;
    case 'summary': summary(a); break;
    case 'around': around(a, b, parseFloat(c) || 5); break;
    case 'board': board(a, b, c); break;
    case 'grep': grep(a, b); break;
    case 'markers': markers(parseInt(a, 10) || 10); break;
    case 'audit': audit(a); break;
    default:
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).join('\n').replace(/^ \* ?/gm, ''));
}
