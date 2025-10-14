const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
    origin: "*"
}));

const activeRooms = {};
const lobby = [];

// Function to generate random virus positions
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

// Function to generate a random list
function generateRandomList() {
    return Array.from({ length: 20 }, () => Math.floor(Math.random() * 3));
}

// Generate initial virus positions
const virusPositions = generateVirusPositions();

// Function to broadcast server logs to debug console
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

io.on('connection', (socket) => {
    broadcastServerLog('connect', `Client connected: ${socket.id}`);
    
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

    // Handle player game over (lose) events
    socket.on('playerGameOver', (data) => {
        io.to(data.roomCode).emit('opponentGameOver', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
        broadcastServerLog('info', `Player ${data.playerNumber} game over in room ${data.roomCode}`);
    });

    // Handle player win events
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

    // Send virus positions to the client
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
