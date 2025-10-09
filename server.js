const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "https://dr-mario99.onrender.com/" },
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({
    origin: 'https://dr-mario99.onrender.com/'
}));

const activeRooms = {};
const lobby = [];
const spectators = {}; // Store spectators waiting for admission
const playerQueues = {}; // Store player queues for auto-pairing

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

io.on('connection', (socket) => {
    socket.on('createRoom', (roomCode) => {
        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { 
                players: [socket.id], 
                virusPositions: generateVirusPositions(),
                creator: socket.id,
                queue: []
            };
            socket.join(roomCode);
            socket.emit('roomCreated', roomCode);
        }
    });

    socket.on('joinRoom', (roomCode) => {
        console.log('🔍 [Server] joinRoom request for room:', roomCode);
        if (activeRooms[roomCode]) {
            const room = activeRooms[roomCode];
            console.log('🔍 [Server] Room found, current players:', room.players.length);
            
            if (room.players.length >= 2) {
                // Room is full, ask for name and add to spectator queue
                console.log('🔍 [Server] Room full, requesting name from Player 3+');
                socket.emit('requestPlayerName', { roomCode });
            } else {
                // Room has space, join directly
                console.log('🔍 [Server] Room has space, adding player directly');
                room.players.push(socket.id);
                socket.join(roomCode);
                const playerNumber = room.players.length;
                console.log('🔍 [Server] Player', playerNumber, 'joined, emitting roomJoined');
                socket.emit('roomJoined', roomCode);
                socket.emit('playerNumber', playerNumber);
                
                if (playerNumber === 2) {
                    // Notify both players that the game is starting
                    // Only emit to the actual players, not spectators
                    console.log('🔍 [Server] 2nd player joined, notifying both players');
                    room.players.forEach(playerId => {
                        console.log('🔍 [Server] Emitting roomJoined to player:', playerId);
                        io.to(playerId).emit('roomJoined', roomCode);
                    });
                    io.to(roomCode).emit('startGame', {
                        virusPositions: room.virusPositions
                    });
                }
            }
        } else {
            console.log('🔍 [Server] Room not found:', roomCode);
            socket.emit('error', 'Room does not exist.');
        }
    });

    // Handle player name submission for 3rd+ players
    socket.on('submitPlayerName', (data) => {
        try {
            const { roomCode, playerName } = data;
            console.log('🔍 [Server] submitPlayerName from Player 3:', playerName, 'for room:', roomCode);
            const room = activeRooms[roomCode];
            
            if (room && room.players.length >= 2) {
                console.log('🔍 [Server] Adding Player 3 to spectator queue');
                // Add to spectator queue
                spectators[socket.id] = { roomCode, playerName, socketId: socket.id };
                
                // Notify room creator about admission request
                const roomCreator = room.creator;
                console.log('🔍 [Server] Room creator:', roomCreator);
                
                if (roomCreator) {
                    console.log('🔍 [Server] Notifying room creator about admission request');
                    io.to(roomCreator).emit('admissionRequest', {
                        playerName,
                        socketId: socket.id,
                        roomCode
                    });
                } else {
                    console.log('🔍 [Server] ERROR: No room creator found!');
                    socket.emit('joinResult', { 
                        success: false, 
                        message: 'Room creator not found',
                        isSpectator: true
                    });
                    return;
                }
                
                console.log('🔍 [Server] Sending joinResult to Player 3');
                socket.emit('joinResult', { 
                    success: true, 
                    message: 'Waiting for room creator approval...',
                    isSpectator: true
                });
            } else {
                console.log('🔍 [Server] ERROR: Room not found or not full');
                socket.emit('joinResult', { 
                    success: false, 
                    message: 'Room not found or not full',
                    isSpectator: true
                });
            }
        } catch (error) {
            console.log('🔍 [Server] ERROR in submitPlayerName:', error);
            socket.emit('joinResult', { 
                success: false, 
                message: 'Server error: ' + error.message,
                isSpectator: true
            });
        }
    });

  
  
  socket.on('single', () => {
        console.log("somebody is playing single player");
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



	socket.on('updatePoints1', (data) => {
		
        io.emit('p1damage', { p1damage: data.player2points, roomCode: data.roomCode });
    });

    socket.on('updatePoints2', (data) => {
        io.emit('p2damage', { p2damage: data.player1points, roomCode: data.roomCode });
    });

    // Handle player game over (lose) events
    socket.on('playerGameOver', (data) => {
        io.to(data.roomCode).emit('opponentGameOver', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
    });

    // Handle player win events
    socket.on('playerWin', (data) => {
        io.to(data.roomCode).emit('opponentWin', { 
            roomCode: data.roomCode, 
            playerNumber: data.playerNumber 
        });
        
        // Handle tournament-style gameplay
        if (activeRooms[data.roomCode] && activeRooms[data.roomCode].players.length > 2) {
            handleTournamentWin(data.roomCode, data.playerNumber);
        }
    });

    // Handle spectator joining
    socket.on('requestJoinRoom', (data) => {
        const { roomCode, playerName } = data;
        
        if (!activeRooms[roomCode]) {
            socket.emit('joinResult', { success: false, message: 'Room not found' });
            return;
        }
        
        if (activeRooms[roomCode].players.length >= 2) {
            // Room is full, add to spectator queue
            spectators[socket.id] = { roomCode, playerName, socketId: socket.id };
            
            // Notify room creator about admission request
            const roomCreator = activeRooms[roomCode].creator;
            io.to(roomCreator).emit('admissionRequest', {
                playerName,
                socketId: socket.id,
                roomCode
            });
            
            socket.emit('joinResult', { 
                success: true, 
                message: 'Waiting for room creator approval...',
                isSpectator: true
            });
        } else {
            // Room has space, join directly
            joinRoom(socket, roomCode, playerName);
        }
    });

    // Handle admission decision
    socket.on('admissionDecision', (data) => {
        try {
            console.log('🔍 [Server] admissionDecision received:', data);
            const { socketId, approved, roomCode } = data;
            const spectator = spectators[socketId];
            
            if (!spectator) {
                console.log('🔍 [Server] ERROR: Spectator not found');
                socket.emit('admissionResult', { success: false, message: 'Spectator not found' });
                return;
            }
            
            if (approved) {
                console.log('🔍 [Server] Approving spectator');
                // Add spectator to room
                delete spectators[socketId];
                const spectatorSocket = io.sockets.sockets.get(socketId);
                if (spectatorSocket) {
                    joinRoom(spectatorSocket, roomCode, spectator.playerName);
                    spectatorSocket.emit('admissionResult', { 
                        success: true, 
                        message: 'Admitted to room!' 
                    });
                } else {
                    console.log('🔍 [Server] ERROR: Spectator socket not found');
                }
            } else {
                console.log('🔍 [Server] Denying spectator');
                // Deny spectator
                delete spectators[socketId];
                const spectatorSocket = io.sockets.sockets.get(socketId);
                if (spectatorSocket) {
                    spectatorSocket.emit('admissionResult', { 
                        success: false, 
                        message: 'Admission denied' 
                    });
                } else {
                    console.log('🔍 [Server] ERROR: Spectator socket not found for denial');
                }
            }
        } catch (error) {
            console.log('🔍 [Server] ERROR in admissionDecision:', error);
            socket.emit('admissionResult', { 
                success: false, 
                message: 'Server error: ' + error.message 
            });
        }
    });
	
	

    socket.on('requestRandomList', () => {
        socket.emit('receiveRandomList', generateRandomList());
    });

    // Send virus positions to the client
    socket.emit('virusPositions', virusPositions);

    socket.on('disconnect', () => {
        console.log('A user disconnected');
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

const PORT = process.env.PORT || 3000;
// Helper function to join a room
function joinRoom(socket, roomCode, playerName) {
    console.log('🔍 [Server] joinRoom function called for:', playerName, 'room:', roomCode);
    if (!activeRooms[roomCode]) {
        console.log('🔍 [Server] Creating new room in joinRoom function');
        activeRooms[roomCode] = { 
            players: [],
            virusPositions: generateVirusPositions(),
            creator: socket.id,
            queue: []
        };
    }
    
    activeRooms[roomCode].players.push(socket.id);
    socket.join(roomCode);
    
    const playerNumber = activeRooms[roomCode].players.length;
    console.log('🔍 [Server] Player number in joinRoom:', playerNumber);
    
    // Only emit roomJoined for the first 2 players
    if (playerNumber <= 2) {
        console.log('🔍 [Server] Emitting roomJoined for player', playerNumber);
        socket.emit('roomJoined', roomCode);
        socket.emit('playerNumber', playerNumber);
        
        // If this is the second player, start the game
        if (playerNumber === 2) {
            console.log('🔍 [Server] Starting game for 2nd player');
            io.to(roomCode).emit('startGame', {
                virusPositions: activeRooms[roomCode].virusPositions
            });
        }
    } else {
        console.log('🔍 [Server] Player 3+ admitted as spectator, no roomJoined event');
        // For spectators (3rd+ players), add them to the queue for next match
        if (!room.queue) {
            room.queue = [];
        }
        room.queue.push(socket.id);
        
        // Send spectator status update
        socket.emit('spectatorStatus', { 
            message: 'You are now in the spectator queue. Waiting for next match...',
            position: room.queue.length
        });
    }
}

// Handle tournament-style win
function handleTournamentWin(roomCode, winnerId) {
    const room = activeRooms[roomCode];
    if (!room || room.players.length <= 2) return;
    
    // Remove winner from current match
    room.players = room.players.filter(id => id !== winnerId);
    
    // If only one player left, they're the final winner
    if (room.players.length === 1) {
        const finalWinner = room.players[0];
        io.to(finalWinner).emit('finalVictory', { message: 'You won the tournament!' });
        // Reset room for new matches
        room.players = [];
        room.queue = [];
    } else {
        // Auto-pair next two players
        const nextPlayers = room.players.splice(0, 2);
        if (nextPlayers.length === 2) {
            io.to(nextPlayers[0]).emit('nextMatch', { opponent: nextPlayers[1] });
            io.to(nextPlayers[1]).emit('nextMatch', { opponent: nextPlayers[0] });
        }
    }
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
