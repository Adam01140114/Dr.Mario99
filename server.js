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
            activeRooms[roomCode] = { players: [socket.id] };
            socket.join(roomCode);
        }
    });

    socket.on('joinRoom', (roomCode) => {
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].players.push(socket.id);
            socket.join(roomCode);
            io.to(roomCode).emit('roomJoined', roomCode);
        } else {
            socket.emit('error', 'Room does not exist.');
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
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
