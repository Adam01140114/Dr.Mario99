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

// Initialize Express server
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Enable CORS for all origins
app.use(cors({
    origin: "*"
}));

// Multiplayer state management
const activeRooms = {};  // Track active game rooms
const lobby = [];        // Players waiting for matches
const nextRoundReady = {}; // Track next-round readiness per room

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
    const virusCount = (activeRooms[roomCode] && activeRooms[roomCode].settings && parseInt(activeRooms[roomCode].settings.virusCount, 10)) || 5;

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

  
  
  socket.on('single', () => {
    });
  
  
    socket.on('joinLobby', () => {
        lobby.push(socket.id);
        if (lobby.length >= 2) {
            const roomCode = generateRoomCode();
            const player1 = lobby.shift();
            const player2 = lobby.shift();

            activeRooms[roomCode] = { players: [player1, player2] };
            io.to(player1).emit('startFreePlay', { player: 1, roomCode });
            io.to(player2).emit('startFreePlay', { player: 2, roomCode });
        }
    });


    // NEXT ROUND FLOW: both players must click "Next Round" to proceed
    socket.on('nextRoundReady', ({ roomCode }) => {
        if (!roomCode || !activeRooms[roomCode]) return;

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
        io.to(data.roomCode).emit('opponentGameOver', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
    });

    socket.on('playerWin', (data) => {
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
        // Handle room cleanup if needed
    });
});

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
