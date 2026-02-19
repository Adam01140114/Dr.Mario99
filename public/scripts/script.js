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
    const visiblePlayers = [];
    const game1 = document.getElementById("game1");
    const game2 = document.getElementById("game2");
    if (game1 && !game1.classList.contains("hidden")) visiblePlayers.push(1);
    if (game2 && !game2.classList.contains("hidden")) visiblePlayers.push(2);
    if (visiblePlayers.length === 0) visiblePlayers.push(1);

    if (!window.gameInstances) window.gameInstances = {};

    for (const playerNumber of visiblePlayers) {
        if (window[`gameInstance${playerNumber}Created`]) continue;
        window[`gameInstance${playerNumber}Created`] = true;

        const gameContainer = document.getElementById(`game${playerNumber}`);
        if (!gameContainer) continue;

        const optionsForPlayer = (window.gameInstanceOptions && window.gameInstanceOptions[playerNumber]) || {};
        const game = new Game(playerNumber, optionsForPlayer);
        gameContainer.append(game);
        window.gameInstances[playerNumber] = game;
        if (playerNumber === 1) window.currentGame = game;
    }
}
