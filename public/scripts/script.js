/**
 * DR. MARIO 99 - MAIN SCRIPT LOADER
 * =================================
 * 
 * This is the main entry point that was consolidated from separate
 * script.js and script2.js files. It now dynamically determines
 * which player to create based on the visible game container.
 * 
 * KEY FEATURES:
 * - Dynamic player detection based on visible containers
 * - Single game instance per player
 * - Prevention of duplicate instances
 * - Player-specific game creation
 * 
 * CONSOLIDATION BENEFITS:
 * - Single script file for both players
 * - Dynamic player assignment
 * - Reduced code duplication
 * - Centralized game initialization
 */

"use strict";
import Game from "./Game.js";

/**
 * SCRIPT LOADING PROTECTION
 * =========================
 * 
 * Prevents multiple script loads that could cause duplicate game instances
 * and synchronization issues in multiplayer games.
 */
if (window.scriptLoaded) {

} else {
    window.scriptLoaded = true;

    /**
     * DYNAMIC PLAYER DETECTION SYSTEM
     * ===============================
     * 
     * Determines which player this script instance should create based on
     * the visible game container. This allows the same script to handle
     * both Player 1 and Player 2 dynamically.
     */
    let playerNumber = 1; // Default to Player 1
    let gameContainer = document.getElementById("game1");

    // Check if Player 2 container is visible (not hidden)
    if (document.getElementById("game2") && !document.getElementById("game2").classList.contains("hidden")) {
        playerNumber = 2;
        gameContainer = document.getElementById("game2");
    }

    /**
     * GAME INSTANCE CREATION SYSTEM
     * ==============================
     * 
     * Creates only one game instance per player to prevent conflicts
     * and ensure proper multiplayer synchronization.
     */
    if (window[`gameInstance${playerNumber}Created`]) {
        // Game instance already created, skipping...
    } else {
        window[`gameInstance${playerNumber}Created`] = true;

        // Create only the game instance for the current player
        const game = new Game(playerNumber);
        gameContainer.append(game);

        // Store game instance globally for later access
        window.currentGame = game;
    }
}
