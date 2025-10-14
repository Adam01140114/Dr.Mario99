/**
 * DR. MARIO 99 - GAME CONSTANTS AND ENUMS
 * =======================================
 * 
 * This file contains all the game constants, enums, and configuration values
 * used throughout the Dr. Mario 99 game. These constants ensure consistency
 * across all game components and provide a centralized configuration system.
 * 
 * KEY FEATURES:
 * - Color constants for game pieces
 * - Direction vectors for movement
 * - Rotation states for pills
 * - Timing delays for animations and gameplay
 * 
 * CONSOLIDATION BENEFITS:
 * - Single source of truth for all constants
 * - Easy to modify game behavior
 * - Consistent values across all components
 * - Centralized configuration management
 */

"use strict"

/**
 * COLOR SYSTEM
 * ============
 * 
 * Defines all possible colors for game pieces (viruses and pills).
 * These colors are used throughout the game for visual representation
 * and game logic (matching, clearing, etc.).
 */
export const Color = {
    NONE: "",      // Empty/transparent color
    FIRST: "bl",   // Blue color
    SECOND: "br",  // Brown color  
    THIRD: "yl",   // Yellow color
}

/**
 * DIRECTION SYSTEM
 * ================
 * 
 * Defines movement directions as coordinate offsets.
 * Used for pill movement, rotation, and field navigation.
 * 
 * Coordinate System:
 * - X: Horizontal axis (left/right)
 * - Y: Vertical axis (up/down)
 * - Origin (0,0) is at bottom-left of board
 */
export const Direction = {
    UP: { x: 0, y: 1 },      // Move up (positive Y)
    LEFT: { x: -1, y: 0 },    // Move left (negative X)
    DOWN: { x: 0, y: -1 },    // Move down (negative Y)
    RIGHT: { x: 1, y: 0 },    // Move right (positive X)
}

/**
 * ROTATION SYSTEM
 * ===============
 * 
 * Defines the four possible rotation states for pills.
 * Pills can be rotated in 90-degree increments.
 */
export const Rotation = {
    VERTICAL: 0,              // Pill is vertical (up-down)
    HORIZONTAL: 1,             // Pill is horizontal (left-right)
    VERTICAL_REVERSED: 2,      // Pill is vertical but reversed
    HORIZONTAL_REVERSED: 3,    // Pill is horizontal but reversed
}

/**
 * TIMING SYSTEM
 * =============
 * 
 * Defines all timing delays used throughout the game.
 * These values control animation speed, input responsiveness,
 * and overall game pacing.
 * 
 * All values are in milliseconds.
 */
export const DELAY = {
    frame: 600,                // Main game loop timing
    readInput: 166,            // Input reading frequency
    nextStage: 100,            // Stage transition delay
    gameOver: 100,             // Game over animation delay
    nextStageListener: 2500,   // Stage complete screen duration
    endGameListener: 1000,     // Game over screen duration
    throwFrame: 25,            // Pill throwing animation speed
    gravitation: 90,           // Gravity effect timing
    oxDisappear: 175,          // Clear animation duration
}