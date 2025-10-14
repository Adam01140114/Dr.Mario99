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

/**
 * GAME DATA GENERATION SYSTEM
 * ===========================
 * 
 * These functions generate shared game data that ensures fairness
 * between players in multiplayer games.
 */

/**
 * Generates random virus positions for the game board
 * @returns {Array} Array of {x, y} position objects
 */
function generateVirusPositions() {
    const positions = [];
    for (let i = 0; i < 10; i++) {
        positions.push({
            x: Math.floor(Math.random() * 7),
            y: Math.floor(Math.random() * 5)
        });
    }
    return positions;
}

/**
 * Generates a random pill color list for fair multiplayer games
 * @returns {Array} Array of 100 random numbers (0, 1, or 2)
 */
function generateRandomList() {
    return Array.from({ length: 100 }, () => Math.floor(Math.random() * 3));
}

// Store shared pill colors per room for multiplayer synchronization
const roomPillColors = {};

/**
 * SHARED GAME DATA GENERATION
 * ===========================
 * 
 * Generates new game data including virus positions and pill colors.
 * Ensures both players receive the same data for fair gameplay.
 * 
 * @param {string} roomCode - The room code for the game
 * @returns {Object} Game data with virus positions and pill colors
 */
function generateNewGameData(roomCode) {
    virusPositions = generateVirusPositions();
    
    // Generate shared pill colors for this room if not already exists
    if (!roomPillColors[roomCode]) {
        roomPillColors[roomCode] = generateRandomList();
        console.log(`🔵 SERVER: Generated NEW shared pill colors for room ${roomCode}:`, roomPillColors[roomCode].length, 'colors');
        console.log(`🔵 SERVER: First 20 colors for room ${roomCode}:`, roomPillColors[roomCode].slice(0, 20));
    } else {
        console.log(`🔵 SERVER: Using EXISTING shared pill colors for room ${roomCode}:`, roomPillColors[roomCode].length, 'colors');
        console.log(`🔵 SERVER: First 20 colors for room ${roomCode}:`, roomPillColors[roomCode].slice(0, 20));
    }
    
    const randomList = roomPillColors[roomCode];
    console.log('🔵 SERVER: Generated new game data - virus positions:', virusPositions.length, 'shared pill colors:', randomList.length);
    return { virusPositions, randomList };
}

// Generate initial virus positions (will be regenerated for each game)
let virusPositions = generateVirusPositions();

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

// Override console.log to also broadcast to debug console
const originalConsoleLog = console.log;
console.log = function(...args) {
    originalConsoleLog.apply(console, args);
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    broadcastServerLog('log', message);
};

/**
 * SOCKET.IO CONNECTION HANDLER
 * =============================
 * 
 * Handles all client connections and multiplayer events.
 * Manages room creation, player matching, and game synchronization.
 */
io.on('connection', (socket) => {
    broadcastServerLog('connect', `Client connected: ${socket.id}`);
    
    /**
     * ROOM MANAGEMENT SYSTEM
     * ======================
     * 
     * Handles room creation and joining for multiplayer games.
     */
    socket.on('createRoom', (roomCode) => {
        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { players: [socket.id] };
            socket.join(roomCode);
            broadcastServerLog('info', `Room created: ${roomCode} by ${socket.id}`);
        }
    });

    socket.on('joinRoom', (roomCode) => {
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].players.push(socket.id);
            socket.join(roomCode);
            io.to(roomCode).emit('roomJoined', roomCode);
            broadcastServerLog('info', `Client ${socket.id} joined room: ${roomCode}`);
        } else {
            socket.emit('error', 'Room does not exist.');
            broadcastServerLog('warn', `Client ${socket.id} tried to join non-existent room: ${roomCode}`);
        }
    });

  
  
  socket.on('single', () => {
        console.log("somebody is playing single player");
        broadcastServerLog('info', `Single player game started by ${socket.id}`);
    });
  
  
    socket.on('joinLobby', () => {
        lobby.push(socket.id);
        broadcastServerLog('info', `Client ${socket.id} joined lobby (${lobby.length} players waiting)`);
        if (lobby.length >= 2) {
            const roomCode = generateRoomCode();
            const player1 = lobby.shift();
            const player2 = lobby.shift();

            activeRooms[roomCode] = { players: [player1, player2] };
            io.to(player1).emit('startFreePlay', { player: 1, roomCode });
            io.to(player2).emit('startFreePlay', { player: 2, roomCode });
            broadcastServerLog('info', `Free play room created: ${roomCode} with players ${player1} and ${player2}`);
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
        console.log('Server received updatePoints1:', data);
        console.log(`Server: Player 2 sending ${data.player1points} damage to Player 1 in room ${data.roomCode}`);
        io.emit('p1damage', { p1damage: data.player1points, roomCode: data.roomCode });
        console.log(`Server: Emitted p1damage event with ${data.player1points} damage to room ${data.roomCode}`);
        broadcastServerLog('info', `Player 1 damage update: ${data.player1points} points in room ${data.roomCode}`);
    });

    socket.on('updatePoints2', (data) => {
        // Player 1 is sending damage to Player 2
        console.log('Server received updatePoints2:', data);
        console.log(`Server: Player 1 sending ${data.player2points} damage to Player 2 in room ${data.roomCode}`);
        io.emit('p2damage', { p2damage: data.player2points, roomCode: data.roomCode });
        console.log(`Server: Emitted p2damage event with ${data.player2points} damage to room ${data.roomCode}`);
        broadcastServerLog('info', `Player 2 damage update: ${data.player2points} points in room ${data.roomCode}`);
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
        broadcastServerLog('info', `Player ${data.playerNumber} game over in room ${data.roomCode}`);
    });

    socket.on('playerWin', (data) => {
        io.to(data.roomCode).emit('opponentWin', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
        broadcastServerLog('info', `Player ${data.playerNumber} won in room ${data.roomCode}`);
    });
	
	

    socket.on('requestRandomList', () => {
        socket.emit('receiveRandomList', generateRandomList());
    });

    // Handle request for new game data (virus positions and pill colors)
    socket.on('requestNewGameData', () => {
        // Get the room code from the socket's rooms
        const rooms = Array.from(socket.rooms);
        const roomCode = rooms.find(room => room !== socket.id); // Find room that's not the socket's own ID
        
        console.log(`🔵 SERVER: requestNewGameData from socket ${socket.id}, rooms:`, rooms);
        
        if (roomCode) {
            const gameData = generateNewGameData(roomCode);
            socket.emit('receiveNewGameData', gameData);
            console.log(`🔵 SERVER: Sent shared game data to client ${socket.id} in room ${roomCode}`);
            console.log(`🔵 SERVER: Data sent - pill colors:`, gameData.randomList.slice(0, 10), '...');
        } else {
            // Fallback for single player or if no room found
            const gameData = generateNewGameData('singleplayer');
            socket.emit('receiveNewGameData', gameData);
            console.log(`🔵 SERVER: Sent single player game data to client ${socket.id}`);
            console.log(`🔵 SERVER: Data sent - pill colors:`, gameData.randomList.slice(0, 10), '...');
        }
    });

    // Handle request to reset shared pill colors for a new game
    socket.on('resetSharedPillColors', () => {
        const rooms = Array.from(socket.rooms);
        const roomCode = rooms.find(room => room !== socket.id);
        
        console.log(`🔵 SERVER: resetSharedPillColors from socket ${socket.id}, rooms:`, rooms);
        
        if (roomCode) {
            // Generate new shared pill colors for this room
            roomPillColors[roomCode] = generateRandomList();
            console.log(`🔵 SERVER: Reset shared pill colors for room ${roomCode}:`, roomPillColors[roomCode].length, 'colors');
            console.log(`🔵 SERVER: New pill colors for room ${roomCode}:`, roomPillColors[roomCode].slice(0, 20));
            
            // Send the new colors to all players in the room
            const gameData = {
                virusPositions: generateVirusPositions(),
                randomList: roomPillColors[roomCode]
            };
            io.to(roomCode).emit('receiveNewGameData', gameData);
            console.log(`🔵 SERVER: Broadcasted new shared pill colors to room ${roomCode}`);
            console.log(`🔵 SERVER: Broadcasted data - pill colors:`, gameData.randomList.slice(0, 10), '...');
        }
    });

    // Send initial virus positions to the client
    socket.emit('virusPositions', virusPositions);

    socket.on('testConnection', (data) => {
        console.log('Debug console test connection received:', data);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
        broadcastServerLog('disconnect', `Client disconnected: ${socket.id}`);
        // Remove from lobby if in lobby
        const lobbyIndex = lobby.indexOf(socket.id);
        if (lobbyIndex !== -1) {
            lobby.splice(lobbyIndex, 1);
            broadcastServerLog('info', `Client ${socket.id} removed from lobby`);
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
