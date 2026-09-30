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

// Initialize Express server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

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
 * more always show the game on their phones.
 *
 * Socket rooms: the host is alone in `tvh:<code>`, the phones share `tvp:<code>`.
 */
const tvRooms = {};
const TV_MAX_PLAYERS = 8;
const TV_PHONE_SCREEN_ABOVE = 4; // more players than this: the game always shows on the phones
const TV_ACTIONS = ['left', 'right', 'rotateLeft', 'rotateRight', 'drop', 'hold'];

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
    io.to(room.hostId).emit('tvLobby', lobby);
    io.to(`tvp:${code}`).emit('tvLobby', lobby);
}

function closeTvRoom(code) {
    if (!tvRooms[code]) return;
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
    if (p && p.connected) io.to(p.socketId).emit(event, data);
}

function registerTvRoomHandlers(socket) {
    // Host: open a new TV room
    socket.on('tvCreateRoom', () => {
        if (socket.data.tvHostOf) closeTvRoom(socket.data.tvHostOf);
        let code = generateRoomCode();
        while (tvRooms[code] || activeRooms[code]) code = generateRoomCode();
        tvRooms[code] = {
            hostId: socket.id, state: 'lobby', players: {}, ready: new Set(), solo: false,
            roster: [], winner: null, places: {}, rematch: new Set(), settings: { virusCount: 5, showOnPhone: false },
        };
        socket.data.tvHostOf = code;
        socket.join(`tvh:${code}`);
        socket.emit('tvRoomCreated', { code, lanOrigins: lanOrigins(PORT), max: TV_MAX_PLAYERS });
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
            const free = n => !room.players[n] || !room.players[n].connected;
            slot = wanted >= 1 && wanted <= TV_MAX_PLAYERS && free(wanted) ? wanted : tvSlots().find(free);
            if (!slot) return socket.emit('tvJoinError', { reason: 'full', message: `This room is full (${TV_MAX_PLAYERS} players).` });
            room.solo = false; // someone new: nobody is playing solo any more
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
        room.players[slot] = { name, clientId, socketId: socket.id, connected: true };
        socket.data.tvPlayer = { code, player: slot };
        socket.join(`tvp:${code}`);
        socket.emit('tvJoined', {
            code, player: slot, name, state: room.state,
            inGame: room.state !== 'lobby' && room.roster.includes(slot),
            showOnPhone: room.settings.showOnPhone,
            eliminated: room.places[slot] && room.state === 'playing' ? { place: room.places[slot], of: room.roster.length } : null,
            result: tvResultFor(room, slot),
        });
        tvSendLobby(code);
    });

    // Phone: "Ready" on the waiting screen (press again to take it back); "Play solo"
    // when nobody else is in. When everyone in is ready, the TV starts the game by itself.
    socket.on('tvReady', (payload = {}) => {
        const { code, room, player } = tvPhoneRoom(socket);
        if (!room || room.state !== 'lobby') return;
        if (payload.ready === false) room.ready.delete(player);
        else room.ready.add(player);
        const inRoom = tvConnected(room);
        if (payload.solo && inRoom.length === 1) room.solo = true;
        tvSendLobby(code);
        const allReady = inRoom.length > 0 && inRoom.every(n => room.ready.has(n));
        if (allReady && (inRoom.length >= 2 || room.solo)) io.to(room.hostId).emit('tvAutoStart', { code });
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
        room.settings.showOnPhoneChoice = !!payload.showOnPhone;
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
        room.rematch = new Set();
        for (const n of room.roster) tvToPlayer(room, n, 'tvResult', tvResultFor(room, n));
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
    room.settings.showOnPhone = !!room.settings.showOnPhoneChoice || roster.length > TV_PHONE_SCREEN_ABOVE;
    const gameData = generateNewGameData(code, true);
    const round = { code, names: tvNames(room, roster), roster, showOnPhone: room.settings.showOnPhone };
    io.to(room.hostId).emit('tvGameStarted', { ...round, gameData });
    io.to(`tvp:${code}`).emit('tvGameStarted', round);
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
