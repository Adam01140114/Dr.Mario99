"use strict";
import Game from "./Game.js";

// Function to create a game for a specific player
function createGame(playerNumber) {
    const game = new Game();
    const gameContainer = document.getElementById(`game${playerNumber}`);
    
    if (gameContainer) {
        gameContainer.append(game);
        console.log(`Game created for Player ${playerNumber}`);
    } else {
        console.error(`Game container for Player ${playerNumber} not found`);
    }
}

// Auto-detect player number based on which game container is visible
function detectPlayerNumber() {
    const game1 = document.getElementById("game1");
    const game2 = document.getElementById("game2");
    
    if (game1 && !game1.classList.contains('hidden')) {
        return 1;
    } else if (game2 && !game2.classList.contains('hidden')) {
        return 2;
    }
    
    // Default to player 1 if neither is visible (fallback)
    return 1;
}

// Create game for the detected player
const playerNumber = detectPlayerNumber();
createGame(playerNumber);
