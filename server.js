/**
 * DR. MARIO 99 - MULTIPLAYER SERVER
 * =================================
 * 
 * This server handles all multiplayer communication and game state management.
 * It manages room creation, player matching, game data synchronization,
 * and damage system communication between players.
 * 
 * KEY FEATURES:
 * - Socket.IO real-time communication
 * - Room-based multiplayer system
 * - Shared game data generation
 * - Damage system coordination
 * - Fair pill color synchronization
 * 
 * MULTIPLAYER SYSTEMS:
 * - Lobby system for player matching
 * - Room-based game sessions
 * - Shared virus positions
 * - Synchronized pill color lists
 * - Damage communication between players
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const os = require('os');
const QRCode = require('qrcode');
const analytics = require('./analytics');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const gameLogs = require('./gameLogs');

// Running on a hosting service (Render sets RENDER; NODE_ENV=production also counts)
const PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

// Initialize Express server
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's proxy: the real client address is in X-Forwarded-For
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    // Game messages are tiny and frequent: compressing each one costs more CPU and delay than it saves
    perMessageDeflate: false,
    httpCompression: true,          // long-polling (the fallback) is compressed
    maxHttpBufferSize: 512 * 1024,  // the largest message we accept (a batch of game log events)
    pingInterval: 20000,
    pingTimeout: 25000,
});

// For Render's health check (and uptime monitors): cheap, no static files involved
app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()), sockets: io.engine.clientsCount }));

/**
 * Static files, compressed once and cached. Text files (HTML, scripts, styles,
 * SVG) are compressed with brotli and gzip the first time they're asked for and
 * kept in memory until the file changes, and every response carries an ETag so a
 * returning browser gets a tiny "not modified". Images are cached for a week;
 * pages and scripts are checked each visit, so a new version shows up right away.
 */
const PUBLIC = path.join(__dirname, 'public');
const TEXT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
const compressed = new Map(); // file -> { mtimeMs, etag, raw, br, gz }
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = decodeURIComponent(req.path);
    if (rel.endsWith('/')) rel += 'index.html';
    const type = TEXT_TYPES[path.extname(rel).toLowerCase()];
    if (!type) return next();
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return next();
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) return next();
        let entry = compressed.get(file);
        if (!entry || entry.mtimeMs !== stat.mtimeMs) {
            const raw = fs.readFileSync(file);
            entry = {
                mtimeMs: stat.mtimeMs,
                etag: '"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 20) + '"',
                raw,
                br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
                gz: zlib.gzipSync(raw, { level: 9 }),
            };
            compressed.set(file, entry);
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Cache-Control', 'no-cache'); // always check, usually a 304
        res.setHeader('ETag', entry.etag);
        res.setHeader('Vary', 'Accept-Encoding');
        if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
        const accepts = String(req.headers['accept-encoding'] || '');
        const body = /\bbr\b/.test(accepts) ? (res.setHeader('Content-Encoding', 'br'), entry.br)
            : /\bgzip\b/.test(accepts) ? (res.setHeader('Content-Encoding', 'gzip'), entry.gz)
            : entry.raw;
        res.setHeader('Content-Length', body.length);
        res.end(req.method === 'HEAD' ? undefined : body);
    });
});
// Everything else (images, fonts): straight from disk, cached a week
app.use(express.static(PUBLIC, { maxAge: '7d', etag: true }));

// Game logs (gameLogs.js): the last 100 games, for tracking down glitches and watching
// games back (replays.html). Only from this computer or a device on its own network - a
// request through a proxy (a hosted server) needs the owner's key: ?key= or the x-owner-key
// header (stats.html), matching the hash below or the LOG_KEY environment variable. Only the
// hash is in the code, so this works with nothing to set on the host; a new key just needs a
// new hash (printf %s KEY | shasum -a 256).
const OWNER_KEY_HASH = 'a9e61ada47418c8aa5e7fe3f0ff5b90b67bc65f019351e5239a1f7ad24064199';
const isOwnerKey = key => typeof key === 'string' && key.length > 0
    && (key === process.env.LOG_KEY || crypto.createHash('sha256').update(key).digest('hex') === OWNER_KEY_HASH);
const isPrivateAddress = ip => /^(::1|127\.|::ffff:127\.|10\.|::ffff:10\.|192\.168\.|::ffff:192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip || '');
const canReadLogs = req => (!req.headers['x-forwarded-for'] && isPrivateAddress(req.socket.remoteAddress))
    || isOwnerKey(req.query.key) || isOwnerKey(req.headers['x-owner-key']);
const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
app.get('/replays', (req, res) => res.redirect('/replays.html' + (req.query.key ? '?key=' + encodeURIComponent(req.query.key) : '')));
app.get('/logs/list.json', (req, res) => {
    if (!canReadLogs(req)) return res.status(404).json({ error: 'Game logs are only available on the computer running the game, or on its Wi-Fi' });
    res.json(gameLogs.summariesList());
});
app.get('/logs', (req, res) => {
    if (!canReadLogs(req)) return res.status(404).send('Not found');
    const key = req.query.key ? '?key=' + encodeURIComponent(req.query.key) : '';
    const rows = gameLogs.list().map(g => `<tr><td><a href="/logs/${g.id}${key}">${escapeHtml(g.id)}</a></td><td>${escapeHtml(g.mode)}</td>`
        + `<td>${escapeHtml(g.startedAt && new Date(g.startedAt).toLocaleString())}</td>`
        + `<td>${escapeHtml(g.players ? Object.values(g.players).join(', ') : '')}</td><td>${Math.ceil(g.size / 1024)} KB</td></tr>`).join('');
    res.send(`<!doctype html><meta charset="utf-8"><title>Game logs</title><style>body{font:14px system-ui;margin:24px;background:#16213e;color:#eee}a{color:#4dc3ff}td,th{padding:6px 12px;text-align:left}tr:nth-child(even){background:#1f2b50}</style>`
        + `<h1>Last ${gameLogs.list().length} games</h1><p>Each game's log is one JSON event per line. Tell Claude the id of the game that glitched.</p>`
        + `<table><tr><th>Game</th><th>Mode</th><th>Started</th><th>Players</th><th>Size</th></tr>${rows}</table>`);
});
app.get('/logs/:id', (req, res) => {
    if (!canReadLogs(req)) return res.status(404).send('Not found');
    const text = gameLogs.read(req.params.id);
    if (text == null) return res.status(404).send('No such game');
    res.type('text/plain').send(text);
});

// Player stats (analytics.js, stats.html): for the owner, like the game logs
app.get('/stats', (req, res) => res.redirect('/stats.html' + (req.query.key ? '?key=' + encodeURIComponent(req.query.key) : '')));
// The owner's computer keeps a copy, and gives it back to a server that lost its numbers (tools/stats-keeper.sh)
app.get('/stats/backup.json', (req, res) => {
    if (!canReadLogs(req)) return res.status(404).json({ error: 'not allowed' });
    res.set('Cache-Control', 'no-store').type('application/json').send(analytics.backup());
});
app.post('/stats/restore', (req, res, next) => (canReadLogs(req) ? next() : res.status(404).json({ error: 'not allowed' })),
    express.json({ limit: '100mb' }),
    (req, res) => res.status(analytics.restore(req.body) ? 200 : 409).json({ restored: !!analytics.report().restored }));
app.get('/stats.json', (req, res) => {
    if (!canReadLogs(req)) return res.status(404).json({ error: 'not allowed' });
    res.set('Cache-Control', 'no-store').json(analytics.report(liveGames()));
});

// TV Room shortcut: /tv opens the game and starts a TV Room right away
app.get('/tv', (req, res) => res.redirect('/?tv=new'));

// TV Room: the QR code a phone scans to join (an SVG of the given link)
app.get('/tv/qr.svg', (req, res) => {
    const text = String(req.query.text || '');
    if (!text || text.length > 500) return res.status(400).send('Bad QR text');
    QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }, (err, svg) => {
        if (err) return res.status(500).send('QR failed');
        res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
    });
});

// Enable CORS for all origins
app.use(cors({
    origin: "*"
}));

// Multiplayer state management
const activeRooms = {};  // Track active game rooms
const lobby = [];        // Players waiting for matches
const nextRoundReady = {}; // Track next-round readiness per room
const aiMatches = {}; // Track active AI opponents per room

function stopAiMatch(roomCode) {
    const ai = aiMatches[roomCode];
    if (!ai) return;
    if (ai.damageInterval) clearInterval(ai.damageInterval);
    delete aiMatches[roomCode];
}

function startAiMatch(roomCode, playerSocketId) {
    stopAiMatch(roomCode);
    const aiState = {
        roomCode,
        playerSocketId,
        startedAt: Date.now(),
    };

    // Bot plays "well": steady pressure + occasional combos + rising win pressure over time
    aiState.damageInterval = setInterval(() => {
        const room = activeRooms[roomCode];
        if (!room || !room.players.includes(playerSocketId)) {
            stopAiMatch(roomCode);
            return;
        }

        // Main attack cadence
        if (Math.random() < 0.8) {
            io.to(playerSocketId).emit('p1damage', { p1damage: 4, roomCode }); // 4 points => 1 damage virus
        }

        // Occasional extra combo pellet for stronger play feel
        if (Math.random() < 0.18) {
            setTimeout(() => {
                io.to(playerSocketId).emit('p1damage', { p1damage: 4, roomCode });
            }, 350);
        }

        // Bot has a growing chance to finish the match if player doesn't win quickly
        const elapsedSeconds = (Date.now() - aiState.startedAt) / 1000;
        const winChancePerTick = Math.min(0.01 + elapsedSeconds / 1800, 0.09);
        if (Math.random() < winChancePerTick) {
            io.to(roomCode).emit('opponentWin', {
                roomCode,
                playerNumber: 2
            });
            stopAiMatch(roomCode);
        }
    }, 3200);

    aiMatches[roomCode] = aiState;
}

/**
 * GAME DATA GENERATION SYSTEM
 * ===========================
 * 
 * These functions generate shared game data that ensures fairness
 * between players in multiplayer games.
 */

/**
 * Generates random virus positions for the game board
 * Uses room code and timestamp to ensure unique positions for each room
 * @param {string} roomCode - The room code to use as seed
 * @returns {Array} Array of {x, y} position objects
 */
/**
 * A seeded random number generator (mulberry32): 32-bit integer maths throughout.
 * The old one multiplied a seed of about 1.8 trillion (it included Date.now())
 * by 1664525, which is past the numbers JavaScript can hold exactly, so it kept
 * coming back 0 - the same virus spot again and again.
 */
function seededRandom(roomCode = '') {
    let seed = Date.now() >>> 0;
    for (let i = 0; i < roomCode.length; i++) seed = Math.imul(seed ^ roomCode.charCodeAt(i), 2654435761) >>> 0;
    return function next() {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Virus spots for a room: all different cells, in all 8 columns, in the bottom
 * 5 rows. Each board colours virus i with colour i % 3 (Board.spawnViruses), so
 * no three of one colour are put in a row - they would be half-cleared already.
 */
function generateVirusPositions(roomCode = '', count = 10) {
    const random = seededRandom(roomCode);
    const width = 8;
    const height = 5;
    const color = new Map(); // "x,y" -> colour index
    const sameRun = (x, y, c) => {
        const run = (dx, dy) => {
            let n = 0;
            for (let i = 1; i < 3; i++) if (color.get(`${x + dx * i},${y + dy * i}`) === c) n++; else break;
            return n;
        };
        return 1 + run(-1, 0) + run(1, 0) >= 3 || 1 + run(0, -1) + run(0, 1) >= 3;
    };
    const positions = [];
    for (let i = 0; i < Math.min(count, width * height); i++) {
        let spot = null;
        for (let tries = 0; tries < 300 && !spot; tries++) {
            const x = Math.floor(random() * width);
            const y = Math.floor(random() * height);
            if (color.has(`${x},${y}`) || (tries < 250 && sameRun(x, y, i % 3))) continue;
            spot = { x, y };
        }
        if (!spot) break; // the bottom rows are full
        color.set(`${spot.x},${spot.y}`, i % 3);
        positions.push(spot);
    }
    return positions;
}

// Generate random list of pill colors (seeded) for a room
function generateRandomList(roomCode = '') {
    const random = seededRandom(roomCode + 'pills');
    return Array.from({ length: 100 }, () => Math.floor(random() * 3));
}

// Store shared game data per room for multiplayer synchronization
const roomPillColors = {};
const roomVirusPositions = {};

/**
 * SHARED GAME DATA GENERATION
 * ===========================
 * 
 * Generates new game data including virus positions and pill colors.
 * Ensures both players receive the same data for fair gameplay.
 * 
 * @param {string} roomCode - The room code for the game
 * @param {boolean} forceNew - Force generation of new data even if room data exists
 * @returns {Object} Game data with virus positions and pill colors
 */
function generateNewGameData(roomCode, forceNew = false) {
    
    // Determine desired virus count from room settings (default 5)
    const room = activeRooms[roomCode] || tvRooms[roomCode] || parties[roomCode];
    const virusCount = (room && room.settings && parseInt(room.settings.virusCount, 10)) || 5;

    // Generate fresh virus positions for each new game
    if (forceNew || !roomVirusPositions[roomCode]) {
        roomVirusPositions[roomCode] = generateVirusPositions(roomCode, Math.max(virusCount, 10));
    } else {
    }
    
    // Generate fresh pill colors for each new game
    if (forceNew || !roomPillColors[roomCode]) {
        roomPillColors[roomCode] = generateRandomList(roomCode);
    } else {
    }
    
    const randomList = roomPillColors[roomCode];
    const virusPositions = roomVirusPositions[roomCode];
    return { virusPositions, randomList, virusCount };
}

// Note: Virus positions are now generated fresh for each game, no global variable needed

/**
 * DEBUG LOGGING SYSTEM
 * ====================
 * 
 * Broadcasts server logs to connected clients for debugging purposes.
 * This helps with multiplayer synchronization debugging.
 */



/**
 * SOCKET.IO CONNECTION HANDLER
 * =============================
 * 
 * Handles all client connections and multiplayer events.
 * Manages room creation, player matching, and game synchronization.
 */
/**
 * Per-socket limits on how many of each message a client may send per second.
 * Normal play stays far below them (a TV with 20 phones sends at most 400 board
 * pictures a second); anything over is dropped, so one client can't flood the
 * server and slow everyone else down.
 */
const RATE_LIMITS = { tvState: 1000, tvInput: 60, partyBoard: 120, partyAttack: 30, log: 12, logPing: 2, default: 40 };
function rateLimit(socket) {
    let windowStart = Date.now();
    let counts = {};
    socket.use(([event], next) => {
        const now = Date.now();
        if (now - windowStart >= 1000) {
            windowStart = now;
            counts = {};
        }
        const limit = RATE_LIMITS[event] || RATE_LIMITS.default;
        counts[event] = (counts[event] || 0) + 1;
        if (counts[event] > limit) return; // dropped
        next();
    });
}

io.on('connection', (socket) => {
    rateLimit(socket);
    registerGameLog(socket);
    registerStats(socket);
    registerTvRoomHandlers(socket);
    registerPartyHandlers(socket);
    
    /**
     * ROOM MANAGEMENT SYSTEM
     * ======================
     * 
     * Handles room creation and joining for multiplayer games.
     */
    socket.on('createRoom', (payload) => {
        // Backward compatible: payload can be a string (roomCode) or an object { roomCode, virusCount }
        const isString = typeof payload === 'string';
        const roomCode = isString ? payload : payload.roomCode;
        const virusCount = isString ? 5 : parseInt(payload.virusCount, 10) || 5;

        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { players: [socket.id], settings: { virusCount } };
            socket.join(roomCode);
            
            // Generate unique virus data for this room immediately when created
            const gameData = generateNewGameData(roomCode, true);
        }
    });

    socket.on('joinRoom', (roomCode) => {
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].players.push(socket.id);
            socket.join(roomCode);
            
            // Check if room is now full (2 players)
            if (activeRooms[roomCode].players.length === 2) {
                
                // Use existing game data that was created when the room was made
                const gameData = generateNewGameData(roomCode, false); // false = use existing data
                
                // Notify both players that the game is ready to start (includes virusCount)
                io.to(roomCode).emit('gameReady', { roomCode, gameData });
            } else {
                // First player - just notify they joined
                io.to(roomCode).emit('roomJoined', roomCode);
            }
            
        } else {
            socket.emit('error', 'Room does not exist.');
        }
    });

    socket.on('startAIMode', (payload = {}) => {
        const virusCount = parseInt(payload.virusCount, 10) || 5;
        let roomCode = generateRoomCode();
        while (activeRooms[roomCode]) {
            roomCode = generateRoomCode();
        }

        activeRooms[roomCode] = {
            players: [socket.id, 'AI_BOT'],
            settings: { virusCount },
            ai: true
        };
        socket.join(roomCode);

        const gameData = generateNewGameData(roomCode, true);
        socket.emit('startAIMode', { roomCode, gameData });
        startAiMatch(roomCode, socket.id);
    });

  
  
  socket.on('single', () => {
    });
  
  
    socket.on('joinLobby', () => {
        lobby.push(socket.id);
        if (lobby.length >= 2) {
            const roomCode = generateRoomCode();
            const player1 = lobby.shift();
            const player2 = lobby.shift();

            // Join both players to the room so win/lose events (opponentGameOver, opponentWin) are received by both
            const socket1 = io.sockets.sockets.get(player1);
            const socket2 = io.sockets.sockets.get(player2);
            if (socket1) socket1.join(roomCode);
            if (socket2) socket2.join(roomCode);

            activeRooms[roomCode] = { players: [player1, player2] };
            io.to(player1).emit('startFreePlay', { player: 1, roomCode });
            io.to(player2).emit('startFreePlay', { player: 2, roomCode });
        }
    });


    // NEXT ROUND FLOW: both players must click "Next Round" to proceed
    socket.on('nextRoundReady', ({ roomCode }) => {
        if (!roomCode || !activeRooms[roomCode]) return;

        // AI matches don't need second-player readiness.
        if (activeRooms[roomCode].ai) {
            if (!activeRooms[roomCode].settings) activeRooms[roomCode].settings = {};
            const current = parseInt(activeRooms[roomCode].settings.virusCount, 10) || 5;
            activeRooms[roomCode].settings.virusCount = current + 1;
            const gameData = generateNewGameData(roomCode, true);
            io.to(roomCode).emit('startNextRound', { roomCode, gameData });
            startAiMatch(roomCode, socket.id);
            return;
        }

        if (!nextRoundReady[roomCode]) nextRoundReady[roomCode] = new Set();
        nextRoundReady[roomCode].add(socket.id);

        // Notify room of current readiness state (optional UI feedback)
        io.to(roomCode).emit('nextRoundStatus', { readyCount: nextRoundReady[roomCode].size });

        // When both players are ready, increment virus count and start next round
        if (nextRoundReady[roomCode].size >= 2) {
            // Reset readiness for room
            nextRoundReady[roomCode].clear();

            // Increment virus count for this room (default 5)
            if (!activeRooms[roomCode].settings) activeRooms[roomCode].settings = {};
            const current = parseInt(activeRooms[roomCode].settings.virusCount, 10) || 5;
            activeRooms[roomCode].settings.virusCount = current + 1;

            // Generate and broadcast fresh shared data for the new round
            const gameData = generateNewGameData(roomCode, true);
            io.to(roomCode).emit('startNextRound', { roomCode, gameData });
        }
    });



	/**
	 * DAMAGE SYSTEM - POINT UPDATES
	 * =============================
	 * 
	 * Handles damage communication between players.
	 * When a player clears 4+ in a row, they send damage to their opponent.
	 */
	socket.on('updatePoints1', (data) => {
        // Player 2 is sending damage to Player 1
        if (data && activeRooms[data.roomCode]) io.to(data.roomCode).emit('p1damage', { p1damage: data.player1points, roomCode: data.roomCode });
    });

    socket.on('updatePoints2', (data) => {
        // Player 1 is sending damage to Player 2
        if (data && activeRooms[data.roomCode]) io.to(data.roomCode).emit('p2damage', { p2damage: data.player2points, roomCode: data.roomCode });
    });

    /**
     * GAME STATE MANAGEMENT
     * =====================
     * 
     * Handles game over and victory events between players.
     * Notifies opponents when a player loses or wins.
     */
    socket.on('playerGameOver', (data) => {
        if (activeRooms[data.roomCode] && activeRooms[data.roomCode].ai) {
            stopAiMatch(data.roomCode);
        }
        io.to(data.roomCode).emit('opponentGameOver', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
    });

    socket.on('playerWin', (data) => {
        if (activeRooms[data.roomCode] && activeRooms[data.roomCode].ai) {
            stopAiMatch(data.roomCode);
        }
        io.to(data.roomCode).emit('opponentWin', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
    });
	
	

    socket.on('requestRandomList', () => {
        // For single player or fallback, generate random list without room code
        socket.emit('receiveRandomList', generateRandomList('singleplayer'));
    });

    /**
     * FRESH GAME DATA REQUEST HANDLER
     * ===============================
     * 
     * Handles requests for fresh game data (virus positions and pill colors).
     * For multiplayer games, ensures both players get the same data.
     */
    socket.on('requestNewGameData', () => {
        // Get the room code from the socket's rooms
        const rooms = Array.from(socket.rooms);
        const roomCode = rooms.find(room => room !== socket.id); // Find room that's not the socket's own ID
        
        
        if (roomCode && roomCode !== 'singleplayer') {
            // For multiplayer games, use the room's shared data
            const gameData = generateNewGameData(roomCode, true);
            socket.emit('receiveNewGameData', gameData);
        } else {
            // Fallback for single player or if no room found
            const gameData = generateNewGameData('singleplayer', true);
            socket.emit('receiveNewGameData', gameData);
        }
    });

    /**
     * RESET SHARED GAME DATA HANDLER
     * ==============================
     * 
     * Handles requests to reset shared game data for a new game.
     * Generates fresh virus positions and pill colors for all players in the room.
     */
    socket.on('resetSharedPillColors', () => {
        const rooms = Array.from(socket.rooms);
        const roomCode = rooms.find(room => room !== socket.id);
        
        
        if (roomCode) {
            // Generate fresh game data for the new game
            const gameData = generateNewGameData(roomCode, true);
            // Send the fresh data to all players in the room
            io.to(roomCode).emit('receiveNewGameData', gameData);
        }
    });

    // Note: Virus positions are now sent through the new game data system
    // when clients request fresh game data via 'requestNewGameData' or 'resetSharedPillColors'


    socket.on('disconnect', () => {
        // Remove from lobby if in lobby
        const lobbyIndex = lobby.indexOf(socket.id);
        if (lobbyIndex !== -1) {
            lobby.splice(lobbyIndex, 1);
        }
        for (let roomCode of Object.keys(aiMatches)) {
            if (aiMatches[roomCode].playerSocketId === socket.id) stopAiMatch(roomCode);
        }
        // Online rooms nobody is in any more: forget them and their game data
        for (const roomCode of Object.keys(activeRooms)) {
            const room = activeRooms[roomCode];
            const people = room.players.filter(id => id !== 'AI_BOT' && id !== socket.id && io.sockets.sockets.has(id));
            if (!people.length) {
                delete activeRooms[roomCode];
                delete nextRoundReady[roomCode];
                delete roomVirusPositions[roomCode];
                delete roomPillColors[roomCode];
            }
        }
    });
});

/**
 * TV ROOM
 * =======
 *
 * The computer (the "host", usually on a TV) shows every player's board; each
 * player scans a QR code and uses their phone as the controller. The host page
 * runs all the games, picks who attacks whom and decides the winner; the server
 * pairs phones with the host and relays presses, results and (when a phone shows
 * its own board) the board pictures.
 *
 * 1 to 20 players. One player plays solo (levels, like single player); five or
 * more always show the game on their phones. Single player's PHONE choice opens
 * a room for one phone (`solo`) that starts as soon as the phone joins.
 *
 * A player can play with a game controller on the TV computer instead of the
 * phone: the phone says so (tvChooseInput), the TV tells everyone which
 * controllers it has and whose they are (tvControllers), and a phone can take
 * one from that list (tvPickController, passed on to the TV). Pressing A on
 * your controller in the lobby counts as READY (tvReadyFor, from the TV).
 *
 * Each phone chooses whether it shows its own board (tvShowGame); with more
 * than TV_PHONE_SCREEN_ABOVE players it always does. The TV can add computer
 * players (tvAddCpu / tvRemoveCpu): CPU #1, CPU #2... take a slot like a phone,
 * are always ready and always want a rematch; the TV page plays their boards.
 *
 * Teams match: the TV sets 2-8 teams (tvSetTeams; 0 = everyone for themselves).
 * Phones pick a team before READY (tvPickTeam); CPUs are put on the smallest
 * team (the TV can move one: tvSetCpuTeam), and anyone without a team when
 * the game starts is too. Teammates don't attack each other; the TV decides
 * the winning team and tells the server (tvGameOver team).
 *
 * Socket rooms: the host is alone in `tvh:<code>`, the phones share `tvp:<code>`.
 */
const tvRooms = {};
const TV_MAX_PLAYERS = 20;
const TV_PHONE_SCREEN_ABOVE = 4; // more players than this: the game always shows on the phones
const TV_ACTIONS = ['left', 'right', 'rotateLeft', 'rotateRight', 'drop', 'hold', 'pause'];
const TV_INPUTS = ['phone', 'controller'];
const TV_MAX_TEAMS = 8;

/** Teams match: put players without a team (just CPUs, or everyone) on the smallest teams */
function tvBalanceTeams(room, everyone) {
    const count = room.settings.teams;
    if (!count) return;
    const size = Array(count).fill(0);
    for (const n of tvSlots()) {
        const p = room.players[n];
        if (!p) continue;
        if (p.team != null && p.team >= count) p.team = null;
        if (p.team != null) size[p.team]++;
    }
    for (const n of tvSlots()) {
        const p = room.players[n];
        if (!p || p.team != null || !(everyone || p.cpu)) continue;
        p.team = size.indexOf(Math.min(...size));
        size[p.team]++;
    }
}

/** Addresses a phone on the same Wi-Fi can reach this computer at, best first */
function lanOrigins(port) {
    const rank = ip => ip.startsWith('192.168.') ? 0
        : ip.startsWith('10.') ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2
        : 3;
    const ips = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const addr of list || []) {
            const family = typeof addr.family === 'string' ? addr.family : `IPv${addr.family}`;
            if (family !== 'IPv4' || addr.internal || addr.address.startsWith('169.254.')) continue;
            ips.push(addr.address);
        }
    }
    return ips.sort((a, b) => rank(a) - rank(b)).map(ip => `http://${ip}:${port}`);
}

const tvSlots = () => Array.from({ length: TV_MAX_PLAYERS }, (_, i) => i + 1);
const tvConnected = room => tvSlots().filter(n => room.players[n] && room.players[n].connected);

function tvPlayerList(room) {
    return tvSlots().filter(n => room.players[n]).map(n => ({
        player: n,
        name: room.players[n].name,
        connected: room.players[n].connected,
        ready: room.ready.has(n),
        input: room.players[n].input,
        inputAt: room.players[n].inputAt,
        showGame: !!room.players[n].showGame,
        cpu: !!room.players[n].cpu,
        team: room.players[n].team != null ? room.players[n].team : null,
    }));
}

function tvNames(room, roster) {
    const names = {};
    for (const n of roster) if (room.players[n]) names[n] = room.players[n].name;
    return names;
}

function tvSendLobby(code) {
    const room = tvRooms[code];
    if (!room) return;
    const lobby = { code, state: room.state, players: tvPlayerList(room), max: TV_MAX_PLAYERS, teams: room.settings.teams || 0 };
    tvLog(room, 'lobby', { state: room.state, players: lobby.players });
    io.to(room.hostId).emit('tvLobby', lobby);
    io.to(`tvp:${code}`).emit('tvLobby', lobby);
}

function closeTvRoom(code) {
    if (!tvRooms[code]) return;
    tvLog(tvRooms[code], 'room-closed', {});
    io.to(`tvp:${code}`).emit('tvRoomClosed', { code });
    delete tvRooms[code];
    delete roomVirusPositions[code];
    delete roomPillColors[code];
}

/** The host of this socket's room, and the room */
function tvHostRoom(socket) {
    const code = socket.data.tvHostOf;
    return code && tvRooms[code] ? { code, room: tvRooms[code] } : {};
}

/** The room this phone is in, and its player number */
function tvPhoneRoom(socket) {
    const me = socket.data.tvPlayer;
    return me && tvRooms[me.code] ? { code: me.code, room: tvRooms[me.code], player: me.player } : {};
}

function tvToPlayer(room, n, event, data) {
    const p = room.players[n];
    if (p && p.connected && p.socketId) io.to(p.socketId).emit(event, data); // CPUs have no phone
}

/** More players than this and the TV boards are small: every phone shows its own board */
const tvBoardForced = room => room.roster.length > TV_PHONE_SCREEN_ABOVE;

function registerTvRoomHandlers(socket) {
    // Host: open a new TV room ({ solo: true }: single player with one phone as the controller)
    socket.on('tvCreateRoom', (payload = {}) => {
        if (socket.data.tvHostOf) closeTvRoom(socket.data.tvHostOf);
        let code = generateRoomCode();
        while (tvRooms[code] || activeRooms[code]) code = generateRoomCode();
        const soloOnly = !!(payload && payload.solo);
        tvRooms[code] = {
            hostId: socket.id, state: 'lobby', players: {}, ready: new Set(), solo: soloOnly, soloOnly,
            pairOnly: soloOnly && !!payload.pairOnly, // Free Play with a phone: this room only pairs the phone; the match has its own log
            roster: [], winner: null, places: {}, rematch: new Set(), settings: { virusCount: 5, teams: 0 },
            controllers: { list: [], bindings: {} },
            logId: null, preLog: (socket.data.preLog || []).map(e => ({ ...e, src: 'tv' })), rounds: 0, // game log: one per round; lobby events wait for the first
        };
        socket.data.preLog = [];
        socket.data.tvHostOf = code;
        socket.join(`tvh:${code}`);
        socket.emit('tvRoomCreated', { code, lanOrigins: lanOrigins(PORT), max: soloOnly ? 1 : TV_MAX_PLAYERS, solo: soloOnly });
        tvSendLobby(code);
    });

    // Phone: take a player slot (also used to come back after the phone slept)
    socket.on('tvJoin', (payload = {}) => {
        const code = String(payload.code || '').toUpperCase();
        const room = tvRooms[code];
        const clientId = String(payload.clientId || '').slice(0, 64);
        const name = String(payload.name || '').trim().replace(/\s+/g, ' ').slice(0, 16);
        if (!room) return socket.emit('tvJoinError', { reason: 'closed', message: 'This TV room is closed. Scan the QR code on the TV again.' });
        if (!name) return socket.emit('tvJoinError', { reason: 'name', message: 'Enter your name.' });

        // Coming back: the same phone gets its old slot
        let slot = tvSlots().find(n => room.players[n] && clientId && room.players[n].clientId === clientId);
        if (!slot) {
            if (room.state !== 'lobby') return socket.emit('tvJoinError', { reason: 'started', message: 'This game already started. Wait for the next QR code on the TV.' });
            const wanted = parseInt(payload.player, 10);
            const max = room.soloOnly ? 1 : TV_MAX_PLAYERS;
            const free = n => !room.players[n] || !room.players[n].connected;
            slot = wanted >= 1 && wanted <= max && free(wanted) ? wanted : tvSlots().slice(0, max).find(free);
            if (!slot) return socket.emit('tvJoinError', { reason: 'full', message: room.soloOnly ? 'Another phone is already the controller for this game.' : `This room is full (${TV_MAX_PLAYERS} players).` });
            if (!room.soloOnly) room.solo = false; // someone new: nobody is playing solo any more
        }

        const previous = room.players[slot];
        if (previous && previous.socketId !== socket.id) {
            const old = io.sockets.sockets.get(previous.socketId);
            if (old && old.data.tvPlayer && old.data.tvPlayer.code === code) {
                old.data.tvPlayer = null;
                old.leave(`tvp:${code}`);
                old.emit('tvJoinError', { reason: 'replaced', message: 'Player ' + slot + ' joined from another phone.' });
            }
            if (room.state === 'lobby') room.ready.delete(slot);
        }
        // Phone or controller: what this phone chose last time (it remembers), else what this slot had
        const input = TV_INPUTS.includes(payload.input) ? payload.input : (previous && previous.input) || 'phone';
        const inputAt = previous && previous.input === input ? previous.inputAt : Date.now();
        const showGame = payload.showGame !== undefined ? !!payload.showGame : !!(previous && previous.showGame);
        const team = previous && previous.clientId === clientId ? previous.team : null; // coming back: same team
        room.players[slot] = { name, clientId, socketId: socket.id, connected: true, input, inputAt, showGame, team };
        analytics.named(socket.data.statsId, name);
        socket.data.tvPlayer = { code, player: slot };
        // What this phone logged before it joined goes in the room's log too
        if (socket.data.preLog && socket.data.preLog.length) {
            const src = 'phone:P' + slot;
            const before = socket.data.preLog.map(e => ({ ...e, src }));
            if (room.logId) gameLogs.write(room.logId, src, before);
            else room.preLog.push(...before);
            socket.data.preLog = [];
        }
        socket.join(`tvp:${code}`);
        socket.emit('tvJoined', {
            code, player: slot, name, state: room.state,
            inGame: room.state !== 'lobby' && room.roster.includes(slot),
            boardForced: room.state !== 'lobby' && tvBoardForced(room),
            eliminated: room.places[slot] && room.state === 'playing' ? { place: room.places[slot], of: room.roster.length } : null,
            result: tvResultFor(room, slot),
            input,
            controllers: room.controllers,
        });
        tvSendLobby(code);
        // Single player with the phone as the controller: start as soon as the phone is in
        if (room.soloOnly && room.state === 'lobby') io.to(room.hostId).emit('tvAutoStart', { code });
    });

    // Phone: "Ready" on the waiting screen (press again to take it back); "Play solo"
    // when nobody else is in. When everyone in is ready, the TV starts the game by itself.
    socket.on('tvReady', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        if (!room || room.state !== 'lobby') return;
        if (payload.ready === false) room.ready.delete(player);
        else room.ready.add(player);
        if (payload.solo && tvConnected(room).length === 1) room.solo = true;
        tvReadyChanged(code);
    });

    // Host: a player pressed A on their controller in the lobby - the same as READY on their phone
    socket.on('tvReadyFor', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        const n = parseInt(payload.player, 10);
        if (!room || room.state !== 'lobby' || !room.players[n] || !room.players[n].connected || room.ready.has(n)) return;
        room.ready.add(n);
        tvReadyChanged(code);
    });

    // Phone: play on this phone, or with a controller on the TV computer
    socket.on('tvChooseInput', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        const p = room && room.players[player];
        if (!p || !TV_INPUTS.includes(payload.input) || p.input === payload.input) return;
        p.input = payload.input;
        p.inputAt = Date.now();
        tvSendLobby(code);
    });

    // Phone: show my own board on this phone, or not
    socket.on('tvShowGame', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        const p = room && room.players[player];
        if (!p || p.showGame === !!payload.on) return;
        p.showGame = !!payload.on;
        tvSendLobby(code);
    });

    // Host: add a computer player in the next empty slot (CPU #1, CPU #2...)
    socket.on('tvAddCpu', () => {
        const { code, room } = tvHostRoom(socket);
        if (!room || room.state !== 'lobby' || room.soloOnly) return;
        const slot = tvSlots().find(n => !room.players[n]);
        if (!slot) return;
        const taken = new Set(tvSlots().filter(n => room.players[n] && room.players[n].cpu).map(n => room.players[n].cpuNumber));
        let number = 1;
        while (taken.has(number)) number++;
        room.players[slot] = { name: `CPU #${number}`, cpu: true, cpuNumber: number, clientId: null, socketId: null, connected: true, input: 'cpu', inputAt: 0, team: null };
        room.ready.add(slot); // a CPU is always ready
        tvBalanceTeams(room, false);
        room.solo = false;
        tvSendLobby(code);
    });

    // Host: teams match with this many teams (0 = everyone for themselves)
    socket.on('tvSetTeams', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        if (!room || room.state !== 'lobby' || room.soloOnly) return;
        const count = parseInt(payload.count, 10);
        room.settings.teams = count >= 2 ? Math.min(count, TV_MAX_TEAMS) : 0;
        if (!room.settings.teams) for (const n of tvSlots()) if (room.players[n]) room.players[n].team = null;
        tvBalanceTeams(room, false); // CPUs onto teams; phones pick their own
        tvSendLobby(code);
    });

    // Phone: join this team (teams match, before the game starts)
    socket.on('tvPickTeam', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        const team = parseInt(payload.team, 10);
        if (!room || room.state !== 'lobby' || !room.players[player] || !(team >= 0 && team < room.settings.teams)) return;
        room.players[player].team = team;
        tvSendLobby(code);
    });

    // Host: move a CPU to another team
    socket.on('tvSetCpuTeam', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        const n = parseInt(payload.player, 10);
        const team = parseInt(payload.team, 10);
        if (!room || room.state !== 'lobby' || !room.players[n] || !room.players[n].cpu || !(team >= 0 && team < room.settings.teams)) return;
        room.players[n].team = team;
        tvSendLobby(code);
    });

    // Host: take a computer player out again
    socket.on('tvRemoveCpu', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        const n = parseInt(payload.player, 10);
        if (!room || room.state !== 'lobby' || !room.players[n] || !room.players[n].cpu) return;
        delete room.players[n];
        room.ready.delete(n);
        tvSendLobby(code);
    });

    // Phone: take this controller (from the list the TV sent); the TV decides
    socket.on('tvPickController', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        const p = room && room.players[player];
        if (!p) return;
        if (p.input !== 'controller') {
            p.input = 'controller';
            p.inputAt = Date.now();
            tvSendLobby(code);
        }
        io.to(room.hostId).emit('tvPickController', { player, key: String(payload.key || '').slice(0, 32) });
    });

    // Host: the controllers on the TV computer and whose they are, for the phones
    socket.on('tvControllers', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        if (!room) return;
        const list = (Array.isArray(payload.list) ? payload.list : []).slice(0, 16)
            .map(c => ({ key: String(c.key || '').slice(0, 32), name: String(c.name || '').slice(0, 40) }));
        const bindings = {};
        for (const c of list) {
            const n = parseInt(payload.bindings && payload.bindings[c.key], 10);
            if (n >= 1 && n <= TV_MAX_PLAYERS) bindings[c.key] = n;
        }
        room.controllers = { list, bindings };
        io.to(`tvp:${code}`).emit('tvControllers', room.controllers);
    });

    // Host: start with everyone who is in (one player = solo)
    socket.on('tvStartGame', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        if (!room || room.state !== 'lobby') return;
        const roster = tvConnected(room);
        if (!roster.length) return;
        for (const n of tvSlots()) if (room.players[n] && !roster.includes(n)) delete room.players[n];
        room.roster = roster;
        room.settings.virusCount = Math.min(Math.max(parseInt(payload.virusCount, 10) || 5, 1), 30);
        startTvRound(code);
    });

    // Phone: a controller button went down or up
    socket.on('tvInput', (payload = {}) => {
        const { room, player } = tvPhoneRoom(socket);
        if (!room || room.state !== 'playing' || !room.roster.includes(player)) return;
        const action = String(payload.action || '');
        if (!TV_ACTIONS.includes(action)) return;
        io.to(room.hostId).emit('tvInput', { player, action, pressed: !!payload.pressed });
    });

    // Host: a player's picture of their own board, for their phone (used when the
    // direct Wi-Fi link to that phone is not open)
    socket.on('tvState', (payload = {}) => {
        const { room } = tvHostRoom(socket);
        if (room && payload.state && typeof payload.state === 'object') tvToPlayer(room, parseInt(payload.player, 10), 'tvState', payload.state);
    });

    // Host: a player's bottle filled up and they are out
    socket.on('tvEliminated', (payload = {}) => {
        const { room } = tvHostRoom(socket);
        const n = parseInt(payload.player, 10);
        if (!room || room.state !== 'playing' || !room.roster.includes(n)) return;
        room.places[n] = parseInt(payload.place, 10) || room.roster.length;
        tvToPlayer(room, n, 'tvEliminated', { place: room.places[n], of: room.roster.length });
    });

    // Host: solo player cleared the board; deal the next level
    socket.on('tvNextLevel', () => {
        const { code, room } = tvHostRoom(socket);
        if (!room || room.state !== 'playing' || room.roster.length !== 1) return;
        socket.emit('tvLevelData', { code, gameData: generateNewGameData(code, true) });
    });

    // Host: the match is over (winner = null for a solo game over)
    socket.on('tvGameOver', (payload = {}) => {
        const { room } = tvHostRoom(socket);
        if (!room || room.state !== 'playing') return;
        const winner = parseInt(payload.winner, 10);
        room.state = 'over';
        room.winner = room.roster.includes(winner) ? winner : null;
        const team = parseInt(payload.team, 10);
        room.winnerTeam = room.teams && team >= 0 && team < room.teams.count ? team : null;
        for (const [n, place] of Object.entries(payload.places || {})) {
            if (room.roster.includes(+n)) room.places[n] = parseInt(place, 10) || room.places[n];
        }
        room.soloStats = room.roster.length === 1 ? { level: parseInt(payload.level, 10) || 0, score: parseInt(payload.score, 10) || 0 } : null;
        // CPUs always want a rematch, so it's up to the people
        room.rematch = new Set(room.roster.filter(n => room.players[n] && room.players[n].cpu));
        for (const n of room.roster) tvToPlayer(room, n, 'tvResult', tvResultFor(room, n));
        if (room.rematch.size) io.to(room.hostId).emit('tvRematch', { players: [...room.rematch] });
    });

    // Host: an effect happened on a player's board; flash their phone
    socket.on('tvFx', (payload = {}) => {
        const { room } = tvHostRoom(socket);
        const kind = ['attack', 'hit', 'level'].includes(payload.kind) ? payload.kind : 'hit';
        const pill = ['bl', 'br', 'yl'].includes(payload.pill) ? payload.pill : null;
        if (room) tvToPlayer(room, parseInt(payload.player, 10), 'tvFx', { kind, pill });
    });

    // Host: play again with the same players (no new QR code)
    socket.on('tvRestart', () => {
        const { code, room } = tvHostRoom(socket);
        if (room && room.state === 'over') startTvRound(code);
    });

    // Phone: "Rematch" on the result screen. When every player asks, the next game starts
    socket.on('tvRematch', () => {
        const { code, room, player } = tvPhoneRoom(socket);
        tvAskRematch(code, room, player);
    });

    // Host: a player pressed A on their controller on the result screen - the same as REMATCH on their phone
    socket.on('tvRematchFor', (payload = {}) => {
        const { code, room } = tvHostRoom(socket);
        tvAskRematch(code, room, parseInt(payload.player, 10));
    });

    function tvAskRematch(code, room, player) {
        if (!room || room.state !== 'over' || !room.roster.includes(player) || room.rematch.has(player)) return;
        room.rematch.add(player);
        const status = { players: [...room.rematch] };
        io.to(room.hostId).emit('tvRematch', status);
        io.to(`tvp:${code}`).emit('tvRematch', status);
        const stillHere = room.roster.filter(n => room.players[n] && room.players[n].connected);
        if (stillHere.every(n => room.rematch.has(n))) startTvRound(code);
    }

    // WebRTC set-up between a phone and the TV page, so presses (and board pictures)
    // travel straight over their Wi-Fi instead of through this server. Only a room's
    // host and its players can reach each other.
    socket.on('tvSignal', (payload = {}) => {
        const signal = { description: payload.description, candidate: payload.candidate };
        const host = tvHostRoom(socket);
        if (host.room) return tvToPlayer(host.room, parseInt(payload.player, 10), 'tvSignal', signal);
        const { room, player } = tvPhoneRoom(socket);
        if (room) io.to(room.hostId).emit('tvSignal', { player, ...signal });
    });

    socket.on('disconnect', () => {
        if (socket.data.tvHostOf) closeTvRoom(socket.data.tvHostOf);
        const { code, room, player } = tvPhoneRoom(socket);
        const p = room && room.players[player];
        if (p && p.socketId === socket.id) {
            p.connected = false;
            if (room.state === 'lobby') room.ready.delete(player);
            if (room.state === 'playing') io.to(room.hostId).emit('tvInput', { player, action: 'all', pressed: false });
            tvSendLobby(code);
        }
    });
}

/** Someone got ready (or took it back): show it, and when everyone in is ready the TV starts by itself */
function tvReadyChanged(code) {
    const room = tvRooms[code];
    if (!room) return;
    tvSendLobby(code);
    const inRoom = tvConnected(room);
    const allReady = inRoom.length > 0 && inRoom.every(n => room.ready.has(n));
    if (allReady && (inRoom.length >= 2 || room.solo)) {
        tvLog(room, 'auto-start', { players: inRoom });
        io.to(room.hostId).emit('tvAutoStart', { code });
    }
}

/** Deal a new game to the room's players (first start, TV "Restart", or everyone asked for a rematch) */
function startTvRound(code) {
    const room = tvRooms[code];
    if (!room) return;
    const roster = room.roster.filter(n => room.players[n] && room.players[n].connected);
    if (!roster.length) return;
    room.roster = roster;
    room.state = 'playing';
    room.winner = null;
    room.places = {};
    room.soloStats = null;
    room.rematch = new Set();
    room.ready = new Set();
    room.winnerTeam = null;
    // Teams match: anyone without a team joins the smallest; with fewer than two teams in it, it's everyone for themselves
    room.teams = null;
    if (room.settings.teams && roster.length > 1) {
        tvBalanceTeams(room, true);
        const of = Object.fromEntries(roster.map(n => [n, room.players[n].team]));
        if (new Set(Object.values(of)).size >= 2) room.teams = { count: room.settings.teams, of };
    }
    const gameData = generateNewGameData(code, true);
    const cpus = roster.filter(n => room.players[n].cpu);
    // Each round gets its own game log; what happened in the lobby before goes at its top
    room.rounds++;
    room.logId = room.pairOnly ? null : gameLogs.start(room.soloOnly ? 'phone' : 'tv', {
        code, round: room.rounds, roster, names: tvNames(room, roster), cpus,
        inputs: Object.fromEntries(roster.map(n => [n, room.players[n].input])),
        showGame: Object.fromEntries(roster.map(n => [n, !!room.players[n].showGame])),
        controllers: room.controllers, settings: room.settings, teams: room.teams, gameData,
    });
    if (room.preLog.length) gameLogs.write(room.logId, 'lobby', room.preLog);
    room.preLog = [];
    for (const n of roster) {
        const socket = io.sockets.sockets.get(room.players[n].socketId);
        if (socket) analytics.played(socket.data.statsId, room.soloOnly ? 'phone' : 'tv');
    }
    const round = { code, names: tvNames(room, roster), roster, cpus, teams: room.teams, boardForced: tvBoardForced(room), logId: room.logId };
    io.to(room.hostId).emit('tvGameStarted', { ...round, gameData });
    io.to(`tvp:${code}`).emit('tvGameStarted', round);
}

/* ---------- Player stats (analytics.js) ---------- */

const SOLO_MODES = ['single', 'ai'];

function registerStats(socket) {
    const connectedAt = Date.now();
    socket.on('hello', (hello) => {
        if (socket.data.statsId !== undefined) return;
        socket.data.statsId = analytics.visit(hello, socket.handshake.headers['user-agent']);
    });
    socket.on('disconnect', () => analytics.left(socket.data.statsId, (Date.now() - connectedAt) / 1000));
}

/** Every game going on right now, for /stats. CPUs are only counted, even the ones with real names */
function liveGames() {
    const games = [];
    const room = (mode, code, state, players) => {
        const list = Object.values(players);
        const people = list.filter(p => !p.cpu);
        if (people.length) games.push({ mode, code, state, players: people.map(p => p.name), cpus: list.length - people.length });
    };
    for (const [code, r] of Object.entries(tvRooms)) room(r.soloOnly ? 'phone' : 'tv', code, r.state, r.players);
    for (const [code, p] of Object.entries(parties)) room(p.freePlay ? 'free-play' : 'multiplayer', code, p.state, p.players);
    for (const socket of io.sockets.sockets.values()) {
        if (socket.data.soloMode) games.push({ mode: socket.data.soloMode, code: null, state: 'playing', players: [null], cpus: 0 });
    }
    return games;
}

/* ---------- Game logs (gameLogs.js) ---------- */

const LOG_QUIET_IN = new Set(['log', 'logOpen', 'logMark', 'logPing', 'tvState', 'partyBoard']); // logged their own way, or too often
// Every event each socket sends and gets goes in its game's log - locally. On a busy live server that's a lot
// of extra work per message, so there it's off unless LOG_VERBOSE is set. Pages record replay frames this often:
const LOG_SOCKET_EVENTS = !PRODUCTION || !!process.env.LOG_VERBOSE;
const LOG_FRAME_MS = PRODUCTION ? 100 : 50;
const LOG_QUIET_OUT = new Set(['tvState', 'serverLog', 'partyBoard']);
const LOG_PAYLOAD = 600; // characters of an event's data kept in the log

/** The server's own note in a TV room's log (kept for the first round while in the lobby) */
function tvLog(room, type, details) {
    if (!room) return;
    const entry = { ct: Date.now(), src: 'server', type, ...details };
    if (room.logId) return gameLogs.write(room.logId, 'server', [entry]);
    room.preLog.push(entry);
    if (room.preLog.length > 3000) room.preLog.shift();
}

/** Which game's log this socket's events belong in, and who it is */
function logTarget(socket) {
    const hosted = socket.data.tvHostOf && tvRooms[socket.data.tvHostOf];
    if (hosted) return { room: hosted, src: 'tv' };
    const me = socket.data.tvPlayer;
    const room = me && tvRooms[me.code];
    if (room) return { room, src: 'phone:P' + me.player };
    return { id: socket.data.logId, src: 'page' };
}

function writeLog(socket, events) {
    const { room, id, src } = logTarget(socket);
    if (room) {
        if (room.logId) return gameLogs.write(room.logId, src, events);
        for (const e of events) room.preLog.push({ src, ...e });
        if (room.preLog.length > 3000) room.preLog.splice(0, room.preLog.length - 3000);
        return;
    }
    if (id) return gameLogs.write(id, src, events);
    // No game yet: keep the last few, so an error just before a game starts is in its log
    const before = socket.data.preLog || (socket.data.preLog = []);
    for (const e of events) before.push({ src, ...e });
    if (before.length > 300) before.splice(0, before.length - 300);
}

const brief = data => {
    try {
        const text = JSON.stringify(data);
        return text && text.length > LOG_PAYLOAD ? text.slice(0, LOG_PAYLOAD) + '…' : text;
    } catch (e) {
        return String(data);
    }
};

function registerGameLog(socket) {
    socket.data.preLog = [];
    socket.emit('logConfig', { frameMs: LOG_FRAME_MS });
    const ua = String(socket.handshake.headers['user-agent'] || '').slice(0, 200);
    writeLog(socket, [{ ct: Date.now(), type: 'socket-connected', socketId: socket.id, ua }]);

    // A page starts a game (single player, AI mode, online room): it gets its own log
    socket.on('logOpen', (meta = {}, ack) => {
        const mode = String(meta.mode || 'game').replace(/[^a-z-]/gi, '').slice(0, 16) || 'game';
        const code = meta.code ? String(meta.code).replace(/[^a-z0-9]/gi, '').slice(0, 8) : undefined;
        const id = gameLogs.start(mode, { ...meta, mode, code, socketId: socket.id, ua });
        const statsMode = mode === 'party' ? (meta.freePlay ? 'free-play' : 'multiplayer') : mode;
        analytics.played(socket.data.statsId, statsMode);
        socket.data.soloMode = SOLO_MODES.includes(mode) ? mode : null;
        if (socket.data.preLog.length) gameLogs.write(id, 'before', socket.data.preLog);
        socket.data.preLog = [];
        socket.data.logId = id;
        if (typeof ack === 'function') ack(id);
    });

    // Events from the page or phone, sent in batches
    socket.on('log', (events) => {
        if (!Array.isArray(events)) return;
        const kept = [];
        for (const e of events.slice(0, 1000)) {
            if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue;
            const text = brief(e);
            kept.push(text && text.length < 20000 ? e : { ct: e.ct, type: e.type, note: 'too big to log' });
        }
        if (events.length > 1000) kept.push({ type: 'log-dropped', count: events.length - 1000 });
        writeLog(socket, kept);
    });

    // 🐞: someone flagged a glitch. On a phone, the TV shows who
    socket.on('logMark', (details = {}, ack) => {
        const { room, id, src } = logTarget(socket);
        const logId = room ? room.logId : id;
        const note = { ct: Date.now(), note: String(details.note || '').slice(0, 300), boards: details.boards };
        if (logId) gameLogs.mark(logId, src, note);
        else writeLog(socket, [{ type: 'marker', ...note }]);
        if (room && src.startsWith('phone')) io.to(room.hostId).emit('tvMarked', { player: socket.data.tvPlayer.player });
        if (typeof ack === 'function') ack(logId || null);
    });

    // Round trip to the server, for spotting a slow connection
    socket.on('logPing', (t, ack) => { if (typeof ack === 'function') ack(t); });

    // Everything else this socket sends and gets, briefly
    let states = 0;
    socket.onAny((event, data) => {
        if (event === 'tvState') states++;
        if (!LOG_SOCKET_EVENTS || LOG_QUIET_IN.has(event)) return;
        writeLog(socket, [{ ct: Date.now(), type: 'server-in', event, data: brief(data) }]);
    });
    socket.onAnyOutgoing((event, data) => {
        if (!LOG_SOCKET_EVENTS || LOG_QUIET_OUT.has(event)) return;
        writeLog(socket, [{ ct: Date.now(), type: 'server-out', event, data: brief(data) }]);
    });
    const stateCount = setInterval(() => {
        if (!states) return;
        writeLog(socket, [{ ct: Date.now(), type: 'board-pictures-relayed', count: states, perSeconds: 10 }]);
        states = 0;
    }, 10000);
    socket.on('disconnect', (reason) => {
        clearInterval(stateCount);
        writeLog(socket, [{ ct: Date.now(), type: 'socket-disconnected', reason }]);
    });
}

function tvResultFor(room, player) {
    if (room.state !== 'over' || !room.roster.includes(player)) return null;
    const teamWon = room.teams && room.winnerTeam != null;
    return {
        won: teamWon ? room.teams.of[player] === room.winnerTeam : room.winner === player,
        winnerName: room.winner ? room.players[room.winner] && room.players[room.winner].name : null,
        team: teamWon ? room.winnerTeam : null,              // the winning team, in a teams match
        myTeam: room.teams ? room.teams.of[player] : null,
        place: room.places[player] || null,
        of: room.roster.length,
        solo: room.roster.length === 1 ? room.soloStats : null,
        names: tvNames(room, room.roster),
        roster: room.roster,
        rematch: [...room.rematch],
    };
}

/**
 * PARTIES (MULTIPLAYER and FREE PLAY)
 * ===================================
 *
 * Up to 8 players, each on their own screen and running their own board
 * (scripts/partyClient.js), so nobody plays with lag. The server keeps the
 * room: who's in, who's the host, who attacks whom, who's out, who won.
 *
 * - MULTIPLAYER: one player creates a room (partyCreate) and is the host;
 *   others join with its 4-letter code or link (partyJoin). The host can add
 *   CPUs (their boards run on the host's screen), remove anyone (partyKick),
 *   set the viruses, and starts the match (partyStart) - and starts the next
 *   one from the results. If the host leaves, the next player takes over.
 * - FREE PLAY: players looking for a game are paired (freePlay). Anyone left
 *   waiting FREE_WAIT_MS plays a CPU with an ordinary name instead, so it
 *   never feels empty; its board runs on that player's screen.
 * - In a match each board sends what changed on it (partyBoard: the changed
 *   cells, a full picture every couple of seconds) and the server passes it
 *   to the others for their opponent views. A clear of 4+ (partyAttack) sends
 *   junk to the attacker's target, the next player still in round the
 *   circle (partyJunk). A full bottle is out (partyOut); clearing your board
 *   wins (partyCleared); the last one left wins (partyOver).
 *
 * Socket rooms: everyone in a party shares `party:<code>`.
 */
const parties = {};
const PARTY_MAX = 8;
const FREE_WAIT_MS = 1500; // only when someone else is around who could press FREE PLAY too
const FREE_START_MS = 300; // from a match being made to it starting, when it's a CPU
const PARTY_GRACE_MS = 8000; // a player who drops mid-match has this long to come back before they're out
const freeQueue = []; // { socketId, name, timer }
// Free Play CPUs get names like these, so the game feels full
const CPU_NAMES = ['Maya', 'Jordan', 'Ethan', 'Sofia', 'Liam', 'Ava', 'Noah', 'Chloe', 'Lucas', 'Emma', 'Mateo', 'Zoe', 'Oliver', 'Mia',
    'Leo', 'Aria', 'Caleb', 'Nora', 'Isaac', 'Ruby', 'Dylan', 'Hana', 'Marcus', 'Elena', 'Theo', 'Priya', 'Owen', 'Lila', 'Andre', 'Kai'];
const partySlots = () => Array.from({ length: PARTY_MAX }, (_, i) => i + 1);
const cleanName = (name, fallback) => String(name || '').trim().replace(/\s+/g, ' ').slice(0, 16) || fallback;

function newCode() {
    let code = generateRoomCode();
    while (activeRooms[code] || tvRooms[code] || parties[code]) code = generateRoomCode();
    return code;
}

function partyList(party) {
    return partySlots().filter(n => party.players[n]).map(n => {
        const p = party.players[n];
        return { slot: n, name: p.name, connected: p.connected, cpu: p.cpu && !p.disguised, host: n === party.hostSlot };
    });
}

function sendPartyLobby(party) {
    io.to('party:' + party.code).emit('partyLobby', {
        code: party.code, state: party.state, hostSlot: party.hostSlot, players: partyList(party),
        settings: party.settings, freePlay: party.freePlay, max: PARTY_MAX,
    });
}

/** The socket that runs this slot's board: the player's own, or (a CPU) the one hosting it */
function partyOwner(party, slot) {
    const p = party.players[slot];
    if (!p) return null;
    if (p.cpu) {
        const host = party.players[p.hostedBy];
        return host && host.connected ? host.socketId : null;
    }
    return p.connected ? p.socketId : null;
}

/** This socket's party, its own slot, and the slots whose boards it runs (itself + CPUs it hosts) */
function partyOf(socket) {
    const me = socket.data.party;
    const party = me && parties[me.code];
    if (!party || !party.players[me.slot] || party.players[me.slot].socketId !== socket.id) return {};
    const owns = new Set([me.slot]);
    for (const n of partySlots()) if (party.players[n] && party.players[n].cpu && party.players[n].hostedBy === me.slot) owns.add(n);
    return { party, slot: me.slot, owns };
}

function addToParty(party, socket, name, clientId) {
    const slot = partySlots().find(n => !party.players[n]);
    if (!slot) return null;
    party.players[slot] = { name, clientId, socketId: socket.id, connected: true };
    analytics.named(socket.data.statsId, name);
    socket.data.party = { code: party.code, slot };
    socket.join('party:' + party.code);
    return slot;
}

function addPartyCpu(party, hostSlot, disguised) {
    const slot = partySlots().find(n => !party.players[n]);
    if (!slot) return null;
    const taken = new Set(partySlots().map(n => party.players[n] && party.players[n].name));
    let name;
    if (disguised) {
        const names = CPU_NAMES.filter(n => !taken.has(n));
        name = names[Math.floor(Math.random() * names.length)] || 'Sam';
    } else {
        let k = 1;
        while (taken.has('CPU #' + k)) k++;
        name = 'CPU #' + k;
    }
    party.players[slot] = { name, cpu: true, disguised: !!disguised, hostedBy: hostSlot, connected: true };
    return slot;
}

function createParty(socket, name, clientId, options = {}) {
    leaveParty(socket);
    const code = newCode();
    const party = parties[code] = {
        code, hostSlot: 1, state: 'lobby', players: {}, freePlay: !!options.freePlay,
        settings: { virusCount: Math.min(Math.max(parseInt(options.virusCount, 10) || 5, 1), 30) },
        roster: [], alive: [], places: {}, targets: {}, round: 0,
    };
    const slot = addToParty(party, socket, name, clientId);
    party.hostSlot = slot;
    return party;
}

/** Each player still in attacks the next one still in, round the circle */
function partyTargets(party) {
    const alive = party.roster.filter(n => party.alive.includes(n));
    party.targets = {};
    if (alive.length >= 2) alive.forEach((n, i) => { party.targets[n] = alive[(i + 1) % alive.length]; });
    return party.targets;
}

function startPartyMatch(party) {
    const roster = partySlots().filter(n => party.players[n] && party.players[n].connected);
    if (roster.length < 2) return false;
    party.state = 'playing';
    party.round++;
    party.roster = roster;
    party.alive = roster.slice();
    party.places = {};
    party.winner = null;
    const gameData = generateNewGameData(party.code, true);
    const names = Object.fromEntries(roster.map(n => [n, party.players[n].name]));
    // CPUs: which player's screen runs each one, and which of them look like people
    const cpus = {};
    const disguised = [];
    for (const n of roster) {
        const p = party.players[n];
        if (!p.cpu) continue;
        cpus[n] = p.hostedBy;
        if (p.disguised) disguised.push(n);
    }
    partyTargets(party);
    for (const n of roster) {
        const p = party.players[n];
        if (p.cpu) continue;
        // A CPU in disguise is only known as one to the screen that runs it
        const mine = Object.fromEntries(Object.entries(cpus).filter(([cpu, host]) => +host === n || !party.players[cpu].disguised));
        io.to(p.socketId).emit('partyStarted', {
            code: party.code, round: party.round, slot: n, roster, names, cpus: mine, disguised: disguised.filter(c => cpus[c] === n),
            targets: party.targets, gameData, freePlay: party.freePlay,
        });
    }
    sendPartyLobby(party);
    return true;
}

function partyEliminate(party, slot) {
    if (party.state !== 'playing' || !party.alive.includes(slot)) return;
    const place = party.alive.length;
    party.places[slot] = place;
    party.alive = party.alive.filter(n => n !== slot);
    partyTargets(party);
    io.to('party:' + party.code).emit('partyEliminated', { slot, place, targets: party.targets });
    if (party.alive.length <= 1) endPartyMatch(party, party.alive[0] || null, 'last');
}

function endPartyMatch(party, winner, how) {
    if (party.state !== 'playing') return;
    party.state = 'over';
    party.winner = winner;
    if (winner) party.places[winner] = 1;
    io.to('party:' + party.code).emit('partyOver', { winner, how, places: party.places, names: Object.fromEntries(party.roster.map(n => [n, party.players[n] ? party.players[n].name : '?'])) });
    sendPartyLobby(party);
}

/** A player leaves (or is removed, or disconnects): out of the match, and the host passes on */
function removeFromParty(party, slot, reason) {
    const p = party.players[slot];
    if (!p) return;
    if (!p.cpu) {
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) {
            sock.leave('party:' + party.code);
            if (sock.data.party && sock.data.party.code === party.code) sock.data.party = null;
            if (reason === 'kicked') sock.emit('partyKicked', { code: party.code });
        }
    }
    delete party.players[slot];
    if (party.state === 'playing') partyEliminate(party, slot);
    // Their CPUs go with them
    for (const n of partySlots()) {
        const q = party.players[n];
        if (q && q.cpu && q.hostedBy === slot) removeFromParty(party, n, 'host left');
    }
    const humans = partySlots().filter(n => party.players[n] && !party.players[n].cpu);
    if (!humans.length) return closeParty(party);
    if (party.hostSlot === slot) {
        party.hostSlot = humans.find(n => party.players[n].connected) || humans[0];
        // CPUs run on the host's screen: the new host takes them over at the next match
        for (const n of partySlots()) if (party.players[n] && party.players[n].cpu) party.players[n].hostedBy = party.hostSlot;
    }
    sendPartyLobby(party);
}

function closeParty(party) {
    delete parties[party.code];
    delete roomVirusPositions[party.code];
    delete roomPillColors[party.code];
}

function leaveParty(socket) {
    const { party, slot } = partyOf(socket);
    if (party) removeFromParty(party, slot, 'left');
    socket.data.party = null;
}

function leaveFreeQueue(socket) {
    const i = freeQueue.findIndex(q => q.socketId === socket.id);
    if (i >= 0) {
        clearTimeout(freeQueue[i].timer);
        freeQueue.splice(i, 1);
    }
}

function registerPartyHandlers(socket) {
    // MULTIPLAYER: make a room; you're the host
    socket.on('partyCreate', (payload = {}) => {
        leaveFreeQueue(socket);
        const party = createParty(socket, cleanName(payload.name, 'Player'), String(payload.clientId || '').slice(0, 64), { virusCount: payload.virusCount });
        socket.emit('partyJoined', { code: party.code, slot: party.hostSlot });
        sendPartyLobby(party);
    });

    // MULTIPLAYER: join a room by its code (or come back to it after losing the connection)
    socket.on('partyJoin', (payload = {}) => {
        leaveFreeQueue(socket);
        const code = String(payload.code || '').toUpperCase().slice(0, 8);
        const party = parties[code];
        const clientId = String(payload.clientId || '').slice(0, 64);
        if (!party) return socket.emit('partyError', { message: 'No room with the code ' + code + '. Check it and try again.' });
        // Coming back: the same browser gets its old spot
        const back = clientId && partySlots().find(n => party.players[n] && !party.players[n].cpu && party.players[n].clientId === clientId);
        if (back) {
            const p = party.players[back];
            clearTimeout(p.dropTimer);
            p.socketId = socket.id;
            p.connected = true;
            socket.data.party = { code, slot: back };
            socket.join('party:' + code);
            socket.emit('partyJoined', { code, slot: back, rejoined: true, state: party.state });
            return sendPartyLobby(party);
        }
        if (party.state !== 'lobby') return socket.emit('partyError', { message: 'That match has already started. Ask the host to let you in next round.' });
        if (party.freePlay) return socket.emit('partyError', { message: "That's a Free Play match. Create your own room instead." });
        leaveParty(socket);
        const slot = addToParty(party, socket, cleanName(payload.name, 'Player'), clientId);
        if (!slot) return socket.emit('partyError', { message: `That room is full (${PARTY_MAX} players).` });
        socket.emit('partyJoined', { code, slot });
        sendPartyLobby(party);
    });

    socket.on('partyLeave', () => leaveParty(socket));

    // Host only: remove a player or CPU
    socket.on('partyKick', (payload = {}) => {
        const { party, slot } = partyOf(socket);
        const target = parseInt(payload.slot, 10);
        if (!party || slot !== party.hostSlot || target === slot || !party.players[target]) return;
        removeFromParty(party, target, 'kicked');
    });

    // Host only: add a CPU (its board runs on the host's screen), and the number of viruses
    socket.on('partyAddCpu', () => {
        const { party, slot } = partyOf(socket);
        if (!party || slot !== party.hostSlot || party.state === 'playing') return;
        if (addPartyCpu(party, slot, false)) sendPartyLobby(party);
    });
    socket.on('partySettings', (payload = {}) => {
        const { party, slot } = partyOf(socket);
        if (!party || slot !== party.hostSlot || party.state === 'playing') return;
        party.settings.virusCount = Math.min(Math.max(parseInt(payload.virusCount, 10) || 5, 1), 30);
        sendPartyLobby(party);
    });

    // Host only: start the match (and the next one, from the results)
    socket.on('partyStart', () => {
        const { party, slot } = partyOf(socket);
        if (!party || slot !== party.hostSlot || party.state === 'playing') return;
        if (!startPartyMatch(party)) socket.emit('partyError', { message: 'You need at least 2 players (add a CPU to play now).' });
    });

    // A board changed: pass it on for the others' opponent views
    socket.on('partyBoard', (payload = {}) => {
        const { party, owns } = partyOf(socket);
        const n = parseInt(payload.slot, 10);
        if (!party || party.state !== 'playing' || !owns.has(n)) return;
        socket.to('party:' + party.code).emit('partyBoard', { slot: n, g: payload.g, d: payload.d, h: payload.h });
    });

    // A clear of 4+: junk for the attacker's target
    socket.on('partyAttack', (payload = {}) => {
        const { party, owns } = partyOf(socket);
        const from = parseInt(payload.slot, 10);
        if (!party || party.state !== 'playing' || !owns.has(from) || !party.alive.includes(from)) return;
        const target = party.targets[from];
        const owner = target && partyOwner(party, target);
        if (!owner) return;
        const color = ['bl', 'br', 'yl'].includes(payload.color) ? payload.color : null;
        io.to(owner).emit('partyJunk', { slot: target, from, points: Math.min(parseInt(payload.points, 10) || 4, 40), color });
        io.to('party:' + party.code).emit('partyFx', { from, to: target });
    });

    // A full bottle: out. A clear board: wins
    socket.on('partyOut', (payload = {}) => {
        const { party, owns } = partyOf(socket);
        const n = parseInt(payload.slot, 10);
        if (party && owns.has(n)) partyEliminate(party, n);
    });
    socket.on('partyCleared', (payload = {}) => {
        const { party, owns } = partyOf(socket);
        const n = parseInt(payload.slot, 10);
        if (party && owns.has(n) && party.alive.includes(n)) endPartyMatch(party, n, 'cleared');
    });

    // FREE PLAY: someone else looking for a game, or a CPU with an ordinary name after FREE_WAIT_MS
    socket.on('freePlay', (payload = {}) => {
        leaveFreeQueue(socket);
        leaveParty(socket);
        const name = cleanName(payload.name, 'Player');
        const clientId = String(payload.clientId || '').slice(0, 64);
        const other = freeQueue.find(q => q.socketId !== socket.id && io.sockets.sockets.get(q.socketId));
        if (other) {
            leaveFreeQueue(io.sockets.sockets.get(other.socketId));
            const otherSocket = io.sockets.sockets.get(other.socketId);
            const party = createParty(otherSocket, other.name, other.clientId, { freePlay: true });
            const slot = addToParty(party, socket, name, clientId);
            otherSocket.emit('partyJoined', { code: party.code, slot: party.hostSlot });
            socket.emit('partyJoined', { code: party.code, slot });
            sendPartyLobby(party);
            setTimeout(() => { if (parties[party.code] && party.state === 'lobby') startPartyMatch(party); }, 1500);
            return;
        }
        const playCpu = () => {
            leaveFreeQueue(socket);
            if (!socket.connected) return;
            const party = createParty(socket, name, clientId, { freePlay: true });
            addPartyCpu(party, party.hostSlot, true);
            socket.emit('partyJoined', { code: party.code, slot: party.hostSlot });
            sendPartyLobby(party);
            setTimeout(() => { if (parties[party.code] && party.state === 'lobby') startPartyMatch(party); }, FREE_START_MS);
        };
        // Everyone else is already in a game (or nobody's here): no point waiting
        const someoneFree = [...io.sockets.sockets.values()].some(s => s.id !== socket.id && !s.data.tvHostOf && !s.data.tvPlayer && !s.data.party);
        if (!someoneFree) return playCpu();
        const entry = { socketId: socket.id, name, clientId, timer: null };
        entry.timer = setTimeout(playCpu, FREE_WAIT_MS);
        freeQueue.push(entry);
        socket.emit('freePlaySearching', { waitMs: FREE_WAIT_MS });
    });
    socket.on('freePlayCancel', () => leaveFreeQueue(socket));

    socket.on('disconnect', () => {
        leaveFreeQueue(socket);
        const { party, slot } = partyOf(socket);
        if (!party) return;
        const p = party.players[slot];
        // In the lobby, gone is gone; in a match, they have PARTY_GRACE_MS to come back
        // (partyJoin with their clientId) before they - and the CPUs they run - are out
        if (party.state !== 'playing') return removeFromParty(party, slot, 'left');
        p.connected = false;
        sendPartyLobby(party);
        p.dropTimer = setTimeout(() => {
            if (p.connected || parties[party.code] !== party) return;
            partyEliminate(party, slot);
            for (const n of partySlots()) if (party.players[n] && party.players[n].cpu && party.players[n].hostedBy === slot) partyEliminate(party, n);
            if (!partySlots().some(n => party.players[n] && !party.players[n].cpu && party.players[n].connected)) closeParty(party);
            else sendPartyLobby(party);
        }, PARTY_GRACE_MS);
    });
}

function generateRoomCode() {
    let result = '';
    let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let charactersLength = characters.length;
    for (let i = 0; i < 4; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

const PORT = process.env.PORT || 6767;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
