"use strict";
import Game from "./Game.js";

// Determine which player this is based on the visible game container
let playerNumber = 1; // Default to Player 1
let gameContainer = document.getElementById("game1");

// Check if Player 2 container is visible (not hidden)
if (document.getElementById("game2") && !document.getElementById("game2").classList.contains("hidden")) {
    playerNumber = 2;
    gameContainer = document.getElementById("game2");
}

// Prevent multiple game instances for the same player
if (window[`gameInstance${playerNumber}Created`]) {
    console.log(`Game instance for Player ${playerNumber} already created, skipping...`);
} else {
    window[`gameInstance${playerNumber}Created`] = true;
    console.log(`Creating game instance for Player ${playerNumber}`);

    // Create only the game instance for the current player
    const game = new Game(playerNumber);
    gameContainer.append(game);
}

