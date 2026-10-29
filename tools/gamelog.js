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
const ROUTINE = new Set(['move', 'move-ignored', 'board', 'key-down', 'key-up', 'input', 'button', 'ping', 'pill', 'landed', 'server-in', 'server-out',
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

const [command, a, b, c] = process.argv.slice(2);
switch (command) {
    case 'list': list(parseInt(a, 10) || 20); break;
    case 'summary': summary(a); break;
    case 'around': around(a, b, parseFloat(c) || 5); break;
    case 'board': board(a, b, c); break;
    case 'grep': grep(a, b); break;
    case 'markers': markers(parseInt(a, 10) || 10); break;
    default:
        console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 20).join('\n').replace(/^ \* ?/gm, ''));
}
