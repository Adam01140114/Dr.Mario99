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
const gameLogs = require('./gameLogs');

// Initialize Express server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Game logs (gameLogs.js): the last 100 games, for tracking down glitches. Only from this
// computer (or with ?key= matching the LOG_KEY environment variable on a hosted server).
const canReadLogs = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    || (process.env.LOG_KEY && req.query.key === process.env.LOG_KEY);
const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
            io.emit('p1damage', { p1damage: 4, roomCode }); // 4 points => 1 damage virus
        }

        // Occasional extra combo pellet for stronger play feel
        if (Math.random() < 0.18) {
            setTimeout(() => {
                io.emit('p1damage', { p1damage: 4, roomCode });
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
function generateVirusPositions(roomCode = '', count = 10) {
    // Create a simple seeded random number generator
    let seed = 0;
    for (let i = 0; i < roomCode.length; i++) {
        seed += roomCode.charCodeAt(i);
    }
    const timestamp = Date.now();
    seed += timestamp; // Add timestamp for extra uniqueness
    
    console.log(`🔵 SERVER: generateVirusPositions for room ${roomCode} - seed calculation:`);
    console.log(`🔵 SERVER: Room code chars: ${roomCode.split('').map(c => `${c}(${c.charCodeAt(0)})`).join('+')}`);
    console.log(`🔵 SERVER: Char sum: ${roomCode.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)}`);
    console.log(`🔵 SERVER: Timestamp: ${timestamp}`);
    console.log(`🔵 SERVER: Final seed: ${seed}`);
    
    // Simple linear congruential generator
    function seededRandom() {
        seed = (seed * 1664525 + 1013904223) % 2147483648;
        return seed / 2147483648;
    }
    
    const positions = [];
    for (let i = 0; i < count; i++) {
        positions.push({
            x: Math.floor(seededRandom() * 7),
            y: Math.floor(seededRandom() * 5)
        });
    }
    console.log(`🔵 SERVER: Generated virus positions: [${positions.map(p => `(${p.x},${p.y})`).join(', ')}]`);
    return positions;
}

/**
 * Generates a random pill color list for fair multiplayer games
 * Uses room code and timestamp to ensure unique sequences for each room
 * @param {string} roomCode - The room code to use as seed
 * @returns {Array} Array of 100 random numbers (0, 1, or 2)
 */
function generateRandomList(roomCode = '') {
    // Create a simple seeded random number generator
    let seed = 0;
    for (let i = 0; i < roomCode.length; i++) {
        seed += roomCode.charCodeAt(i);
    }
    const timestamp = Date.now();
    seed += timestamp; // Add timestamp for extra uniqueness
    
    console.log(`🔵 SERVER: generateRandomList for room ${roomCode} - seed calculation:`);
    console.log(`🔵 SERVER: Room code chars: ${roomCode.split('').map(c => `${c}(${c.charCodeAt(0)})`).join('+')}`);
    console.log(`🔵 SERVER: Char sum: ${roomCode.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)}`);
    console.log(`🔵 SERVER: Timestamp: ${timestamp}`);
    console.log(`🔵 SERVER: Final seed: ${seed}`);
    
    // Simple linear congruential generator
    function seededRandom() {
        seed = (seed * 1664525 + 1013904223) % 2147483648;
        return seed / 2147483648;
    }
    
    const result = Array.from({ length: 100 }, () => Math.floor(seededRandom() * 3));
    console.log(`🔵 SERVER: Generated pill colors (first 10): [${result.slice(0, 10).join(',')}]`);
    return result;
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
    console.log(`🔵 SERVER: generateNewGameData called for room ${roomCode}, forceNew: ${forceNew}`);
    console.log(`🔵 SERVER: Current roomVirusPositions[${roomCode}]:`, roomVirusPositions[roomCode]);
    console.log(`🔵 SERVER: Current roomPillColors[${roomCode}]:`, roomPillColors[roomCode] ? roomPillColors[roomCode].slice(0, 5) : 'undefined');
    
    // Determine desired virus count from room settings (default 5)
    const room = activeRooms[roomCode] || tvRooms[roomCode];
    const virusCount = (room && room.settings && parseInt(room.settings.virusCount, 10)) || 5;

    // Generate fresh virus positions for each new game
    if (forceNew || !roomVirusPositions[roomCode]) {
        roomVirusPositions[roomCode] = generateVirusPositions(roomCode, Math.max(virusCount, 10));
        console.log(`🔵 SERVER: Generated FRESH shared virus positions for room ${roomCode}:`, roomVirusPositions[roomCode].length, 'positions');
        console.log(`🔵 SERVER: Fresh virus positions:`, roomVirusPositions[roomCode]);
    } else {
        console.log(`🔵 SERVER: Using EXISTING shared virus positions for room ${roomCode}:`, roomVirusPositions[roomCode].length, 'positions');
        console.log(`🔵 SERVER: Existing virus positions:`, roomVirusPositions[roomCode]);
    }
    
    // Generate fresh pill colors for each new game
    if (forceNew || !roomPillColors[roomCode]) {
        roomPillColors[roomCode] = generateRandomList(roomCode);
        console.log(`🔵 SERVER: Generated FRESH shared pill colors for room ${roomCode}:`, roomPillColors[roomCode].length, 'colors');
        console.log(`🔵 SERVER: First 20 colors for room ${roomCode}:`, roomPillColors[roomCode].slice(0, 20));
        console.log(`🔵 SERVER: 🎨 NEW UNIQUE PILL COLORS for room ${roomCode}!`);
    } else {
        console.log(`🔵 SERVER: Using EXISTING shared pill colors for room ${roomCode}:`, roomPillColors[roomCode].length, 'colors');
        console.log(`🔵 SERVER: First 20 colors for room ${roomCode}:`, roomPillColors[roomCode].slice(0, 20));
        console.log(`🔵 SERVER: 🔄 REUSING existing pill colors for room ${roomCode}`);
    }
    
    const randomList = roomPillColors[roomCode];
    const virusPositions = roomVirusPositions[roomCode];
    console.log('🔵 SERVER: Final shared game data - virus positions:', virusPositions.length, 'shared pill colors:', randomList.length);
    console.log('🔵 SERVER: Final virus positions being returned:', virusPositions);
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
function broadcastServerLog(type, message) {
    io.emit('serverLog', { type, message, timestamp: new Date().toISOString() });
}


/**
 * SOCKET.IO CONNECTION HANDLER
 * =============================
 * 
 * Handles all client connections and multiplayer events.
 * Manages room creation, player matching, and game synchronization.
 */
io.on('connection', (socket) => {
    registerGameLog(socket);
    registerTvRoomHandlers(socket);
    
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
            console.log(`🔵 SERVER: Room ${roomCode} created with unique virus data:`, gameData.virusPositions);
            console.log(`🔵 SERVER: Room ${roomCode} virus positions:`, gameData.virusPositions);
            console.log(`🔵 SERVER: Room ${roomCode} created with unique pill colors (first 10):`, gameData.randomList.slice(0, 10));
        }
    });

    socket.on('joinRoom', (roomCode) => {
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].players.push(socket.id);
            socket.join(roomCode);
            
            // Check if room is now full (2 players)
            if (activeRooms[roomCode].players.length === 2) {
                console.log(`🔵 SERVER: Room ${roomCode} is now full with 2 players:`, activeRooms[roomCode].players);
                
                // Use existing game data that was created when the room was made
                const gameData = generateNewGameData(roomCode, false); // false = use existing data
                console.log(`🔵 SERVER: Using existing game data for room ${roomCode}:`, gameData);
                console.log(`🔵 SERVER: Existing virus positions:`, gameData.virusPositions);
                console.log(`🔵 SERVER: Existing pill colors (first 10):`, gameData.randomList.slice(0, 10));
                
                // Notify both players that the game is ready to start (includes virusCount)
                io.to(roomCode).emit('gameReady', { roomCode, gameData });
                console.log(`🔵 SERVER: Sent gameReady event to room ${roomCode} with existing gameData:`, gameData);
            } else {
                console.log(`🔵 SERVER: Room ${roomCode} has ${activeRooms[roomCode].players.length} players, waiting for second player`);
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
        io.emit('p1damage', { p1damage: data.player1points, roomCode: data.roomCode });
    });

    socket.on('updatePoints2', (data) => {
        // Player 1 is sending damage to Player 2
        io.emit('p2damage', { p2damage: data.player2points, roomCode: data.roomCode });
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
            if (aiMatches[roomCode].playerSocketId === socket.id) {
                stopAiMatch(roomCode);
                delete activeRooms[roomCode];
            }
        }
        // Handle room cleanup if needed
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
 * 1 to 8 players. One player plays solo (levels, like single player); five or
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
 * Socket rooms: the host is alone in `tvh:<code>`, the phones share `tvp:<code>`.
 */
const tvRooms = {};
const TV_MAX_PLAYERS = 8;
const TV_PHONE_SCREEN_ABOVE = 4; // more players than this: the game always shows on the phones
const TV_ACTIONS = ['left', 'right', 'rotateLeft', 'rotateRight', 'drop', 'hold'];
const TV_INPUTS = ['phone', 'controller'];

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
    const lobby = { code, state: room.state, players: tvPlayerList(room), max: TV_MAX_PLAYERS };
    tvLog(room, 'lobby', { state: room.state, players: lobby.players });
    io.to(room.hostId).emit('tvLobby', lobby);
    io.to(`tvp:${code}`).emit('tvLobby', lobby);
}

function closeTvRoom(code) {
    if (!tvRooms[code]) return;
    tvLog(tvRooms[code], 'room-closed', {});
    io.to(`tvp:${code}`).emit('tvRoomClosed', { code });
    delete tvRooms[code];
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
            roster: [], winner: null, places: {}, rematch: new Set(), settings: { virusCount: 5 },
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
        room.players[slot] = { name, clientId, socketId: socket.id, connected: true, input, inputAt, showGame };
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
        room.players[slot] = { name: `CPU #${number}`, cpu: true, cpuNumber: number, clientId: null, socketId: null, connected: true, input: 'cpu', inputAt: 0 };
        room.ready.add(slot); // a CPU is always ready
        room.solo = false;
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
        if (room) tvToPlayer(room, parseInt(payload.player, 10), 'tvFx', { kind });
    });

    // Host: play again with the same players (no new QR code)
    socket.on('tvRestart', () => {
        const { code, room } = tvHostRoom(socket);
        if (room && room.state === 'over') startTvRound(code);
    });

    // Phone: "Rematch" on the result screen. When every player asks, the next game starts
    socket.on('tvRematch', () => {
        const { code, room, player } = tvPhoneRoom(socket);
        if (!room || room.state !== 'over' || !room.roster.includes(player)) return;
        room.rematch.add(player);
        const status = { players: [...room.rematch] };
        io.to(room.hostId).emit('tvRematch', status);
        io.to(`tvp:${code}`).emit('tvRematch', status);
        const stillHere = room.roster.filter(n => room.players[n] && room.players[n].connected);
        if (stillHere.every(n => room.rematch.has(n))) startTvRound(code);
    });

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
    const gameData = generateNewGameData(code, true);
    const cpus = roster.filter(n => room.players[n].cpu);
    // Each round gets its own game log; what happened in the lobby before goes at its top
    room.rounds++;
    room.logId = gameLogs.start(room.soloOnly ? 'phone' : 'tv', {
        code, round: room.rounds, roster, names: tvNames(room, roster), cpus,
        inputs: Object.fromEntries(roster.map(n => [n, room.players[n].input])),
        showGame: Object.fromEntries(roster.map(n => [n, !!room.players[n].showGame])),
        controllers: room.controllers, settings: room.settings, gameData,
    });
    if (room.preLog.length) gameLogs.write(room.logId, 'lobby', room.preLog);
    room.preLog = [];
    const round = { code, names: tvNames(room, roster), roster, cpus, boardForced: tvBoardForced(room), logId: room.logId };
    io.to(room.hostId).emit('tvGameStarted', { ...round, gameData });
    io.to(`tvp:${code}`).emit('tvGameStarted', round);
}

/* ---------- Game logs (gameLogs.js) ---------- */

const LOG_QUIET_IN = new Set(['log', 'logOpen', 'logMark', 'logPing', 'tvState']); // logged their own way, or too often
const LOG_QUIET_OUT = new Set(['tvState', 'serverLog']);
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
    const ua = String(socket.handshake.headers['user-agent'] || '').slice(0, 200);
    writeLog(socket, [{ ct: Date.now(), type: 'socket-connected', socketId: socket.id, ua }]);

    // A page starts a game (single player, AI mode, online room): it gets its own log
    socket.on('logOpen', (meta = {}, ack) => {
        const mode = String(meta.mode || 'game').replace(/[^a-z-]/gi, '').slice(0, 16) || 'game';
        const code = meta.code ? String(meta.code).replace(/[^a-z0-9]/gi, '').slice(0, 8) : undefined;
        const id = gameLogs.start(mode, { ...meta, mode, code, socketId: socket.id, ua });
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
        if (LOG_QUIET_IN.has(event)) return;
        writeLog(socket, [{ ct: Date.now(), type: 'server-in', event, data: brief(data) }]);
    });
    socket.onAnyOutgoing((event, data) => {
        if (LOG_QUIET_OUT.has(event)) return;
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
    return {
        won: room.winner === player,
        winnerName: room.winner ? room.players[room.winner] && room.players[room.winner].name : null,
        place: room.places[player] || null,
        of: room.roster.length,
        solo: room.roster.length === 1 ? room.soloStats : null,
        names: tvNames(room, room.roster),
        roster: room.roster,
        rematch: [...room.rematch],
    };
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
