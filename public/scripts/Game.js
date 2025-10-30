/**
 * DR. MARIO 99 - MAIN GAME CONTROLLER
 * ===================================
 * 
 * This is the main game controller that manages the entire game instance.
 * It has been consolidated from separate Game.js and Game2.js files to handle
 * both Player 1 and Player 2 dynamically based on the playerNumber parameter.
 * 
 * KEY FEATURES:
 * - Dynamic player assignment (Player 1 or Player 2)
 * - Multiplayer socket communication
 * - Game state management (victory/defeat)
 * - Board creation and management
 * - Dancing virus animations
 * 
 * MULTIPLAYER SYSTEM:
 * - Listens for opponent game events (game over, victory)
 * - Emits player events to server (game over, victory)
 * - Handles room-based communication
 * - Manages win/lose screens for multiplayer
 */

"use strict"
import { PlayingBoard } from "./Board.js"
import { Color, DELAY } from "./components.js"

/**
 * Main Game Controller Class
 * Handles the entire game instance for a single player
 */
export default class Game extends HTMLElement {
    /**
     * Constructor - Creates a new game instance for a specific player
     * @param {number} playerNumber - The player number (1 or 2) for multiplayer games
     */
    constructor(playerNumber = 1) {
        super()
        this.playerNumber = playerNumber
        console.log('Player Number:', this.playerNumber)
    }

    /**
     * Called when the game element is connected to the DOM
     * Initializes the game board, background, animations, and multiplayer listeners
     */
    connectedCallback() {
        this.createBoard()
        this.setBg()
        this.createDancingViruses()
        this.startInterval()
        
        // Add socket listeners for multiplayer events
        this.setupSocketListeners()
    }

    /**
     * Sets up Socket.IO listeners for multiplayer communication
     * Handles opponent game events (victory/defeat) and validates room/player data
     */
    setupSocketListeners() {
        // Listen for opponent game over (opponent lost, you won)
        socket.on('opponentGameOver', (data) => {
            console.log(`Player ${this.playerNumber}: Received opponentGameOver event`);
            console.log(`Player ${this.playerNumber}: Data:`, data);
            console.log(`Player ${this.playerNumber}: Room code check - received: ${data.roomCode}, expected: ${roomCode}`);
            console.log(`Player ${this.playerNumber}: Player number check - received: ${data.playerNumber}, expected: ${this.playerNumber === 1 ? 2 : 1}`);
            
            // Validate that the event is for our room and from the correct opponent
            if (data.roomCode === roomCode && data.playerNumber === (this.playerNumber === 1 ? 2 : 1)) {
                console.log(`Player ${this.playerNumber}: Conditions met! Showing win screen`);
                this.showWinScreen()
            } else {
                console.log(`Player ${this.playerNumber}: Conditions not met, ignoring event`);
            }
        });

        // Listen for opponent win (opponent won, you lost)
        socket.on('opponentWin', (data) => {
            console.log(`Player ${this.playerNumber}: Received opponentWin event`);
            console.log(`Player ${this.playerNumber}: Data:`, data);
            console.log(`Player ${this.playerNumber}: Room code check - received: ${data.roomCode}, expected: ${roomCode}`);
            console.log(`Player ${this.playerNumber}: Player number check - received: ${data.playerNumber}, expected: ${this.playerNumber === 1 ? 2 : 1}`);
            
            // Validate that the event is for our room and from the correct opponent
            if (data.roomCode === roomCode && data.playerNumber === (this.playerNumber === 1 ? 2 : 1)) {
                console.log(`Player ${this.playerNumber}: Conditions met! Showing opponent win screen`);
                this.showOpponentWinScreen()
            } else {
                console.log(`Player ${this.playerNumber}: Conditions not met, ignoring event`);
            }
        });

        // Start next round when both players are ready
        socket.on('startNextRound', (data) => {
            if (!data || data.roomCode !== roomCode) return;
            // Store the shared game data globally
            window.sharedGameData = data.gameData;

            // Reset UI overlay if present
            const existingAlert = document.querySelector('.alert-overlay');
            if (existingAlert) existingAlert.remove();

            // Recreate a fresh board and restart loop
            const lastLevel = this.board ? this.board.level : 0;
            const newLevel = lastLevel; // keep same background cycle
            const score = 0;
            if (this.board) this.board.destroy();
            this.setBg(newLevel);
            this.createBoard(newLevel, score);
            this.createDancingViruses();
            this.startInterval();
        });
    }

    /**
     * Creates a new game board instance
     * Handles both single player and multiplayer game initialization
     * @param {number} level - The starting level (defaults to 0)
     * @param {number} score - The starting score (defaults to 0)
     */
    createBoard(level, score) {
        // Create the main game board with player-specific configuration
        this.board = new PlayingBoard(this, level, score, this.playerNumber)
        this.append(this.board)
        
        // Check if we have shared game data from multiplayer room
        if (typeof roomCode !== 'undefined' && roomCode && window.sharedGameData) {
            this.initializeWithSharedData();
        } else {
            // Single player or no shared data - request new game data
            socket.emit('requestNewGameData');
        }
    }

    /**
     * Initialize the game with shared data from multiplayer room
     */
    initializeWithSharedData() {
        const gameData = window.sharedGameData;
        console.log(`🟢 CLIENT: Player ${this.playerNumber} initializing with shared data:`, gameData);
        console.log(`🟢 CLIENT: Player ${this.playerNumber} virus positions:`, gameData.virusPositions);
        console.log(`🟢 CLIENT: Player ${this.playerNumber} pill colors (first 10):`, gameData.randomList.slice(0, 10));
        
        // Update virus positions in the board
        if (this.board) {
            this.board.virusPositions = gameData.virusPositions;
            console.log(`🟢 CLIENT: Player ${this.playerNumber} set board virusPositions to:`, this.board.virusPositions);
            
            // Trigger virus spawning with the shared positions
            if (this.board.spawnViruses) {
                console.log(`🟢 CLIENT: Player ${this.playerNumber} calling spawnViruses with shared positions`);
                this.board.spawnViruses();
            }
        }
        
        // Update pill colors globally
        window.myRandomList = [...gameData.randomList];
        window.numberPosition = 1; // Reset position for new game
        console.log(`🟢 CLIENT: Player ${this.playerNumber} set pill colors to:`, window.myRandomList.slice(0, 10));
    }
    /**
     * Creates the dancing virus animations at the bottom of the screen
     * These viruses dance and react to game events (laying down when cleared, etc.)
     */
    createDancingViruses() {
        if (this.dancingViruses)
            this.dancingViruses.destroy()
        this.dancingViruses = new DancingViruses(this)
    }

    /**
     * Starts the main game loop that updates the board every frame
     */
    startInterval() {
        this.interval = setInterval(() => {
            this.board.nextFrame()
        }, DELAY.frame)
    }

    /**
     * Stops the main game loop
     */
    stopInterval() {
        clearInterval(this.interval)
    }

    /**
     * Handles stage completion (all viruses cleared)
     * Different behavior for single player vs multiplayer:
     * - Single player: Shows stage complete screen and advances to next level
     * - Multiplayer: Shows victory screen and notifies opponent
     */
    nextStage() {
        this.board.blockInput = true
        clearInterval(this.interval)
        
        // Check if this is multiplayer mode
        if (typeof roomCode !== 'undefined' && roomCode) {
            // In multiplayer, show victory alert and notify opponent
            this.showVictoryAlert()
            // Emit win event to server
            socket.emit('playerWin', { 
                roomCode: roomCode, 
                playerNumber: this.playerNumber 
            });
        } else {
            // Single player mode - proceed to next level
            this.stageCompletedImg = document.createElement("img")
            this.stageCompletedImg.src = this.getScSrc()
            this.stageCompletedImg.id = 'sc'
            this.appendChild(this.stageCompletedImg)
            let clickedOnce = false
            setTimeout(() => {
                this.nextStageListen = document.addEventListener("keydown", () => {
                    if (clickedOnce) return
                    clickedOnce = true
                    this.stageCompletedImg.remove()
                    const lastLevel = this.board.level
                    const score = this.board.score
                    this.board.destroy()
                    this.setBg(lastLevel + 1)
                    this.createBoard(lastLevel + 1, score)
                    this.createDancingViruses()
                    this.startInterval()
                }, { once: true })
            }, DELAY.nextStageListener)
        }
    }

    /**
     * Handles game over (player lost)
     * Shows defeat screen and notifies opponent in multiplayer mode
     * In single player, allows restarting the game
     */
    endGame() {
        console.log(`Player ${this.playerNumber}: endGame() METHOD CALLED!`);
        this.board.blockInput = true
        clearInterval(this.interval)
        
        // Show defeat alert immediately
        if (typeof showGameAlert === 'function') {
            console.log(`Player ${this.playerNumber}: Showing defeat alert`);
            showGameAlert('💀 GAME OVER!', 'You have been defeated!', false);
        } else {
            // Fallback to old method
            this.gameOverMario = document.createElement("img")
            this.gameOverMario.src = './img/go_dr.png'
            this.gameOverMario.id = 'goMario'
            this.appendChild(this.gameOverMario)
            this.gameOverImg = document.createElement("img")
            this.gameOverImg.src = this.getGoSrc()
            this.gameOverImg.id = 'go'
            this.appendChild(this.gameOverImg)
            let clickedOnce = false
            if (this.board.score > this.board.topScore)
                this.board.newTopScore()
            this.dancingViruses.setMode(DancingMode.LAUGHING)
            
            setTimeout(() => {
                this.gameOverListener = document.addEventListener("keydown", () => {
                    if (clickedOnce) return
                    clickedOnce = true
                    this.gameOverImg.remove()
                    this.board.destroy()
                    this.createBoard()
                    this.setBg()
                    this.startInterval()
                    this.createDancingViruses()
                    this.gameOverMario.remove()
                }, { once: true })
            }, DELAY.endGameListener)
        }
        
        // Emit game over event to server for multiplayer
        if (typeof roomCode !== 'undefined' && roomCode) {
            console.log(`Player ${this.playerNumber}: Emitting playerGameOver event to server`);
            console.log(`Player ${this.playerNumber}: Room code: ${roomCode}, Player number: ${this.playerNumber}`);
            socket.emit('playerGameOver', { 
                roomCode: roomCode, 
                playerNumber: this.playerNumber 
            });
            console.log(`Player ${this.playerNumber}: playerGameOver event emitted successfully`);
        } else {
            console.log(`Player ${this.playerNumber}: Not emitting playerGameOver - roomCode: ${typeof roomCode !== 'undefined' ? roomCode : 'undefined'}`);
        }
    }

    /**
     * Shows victory screen when player wins in multiplayer
     * Called when opponent loses (opponentGameOver event received)
     */
    showWinScreen() {
        // Show custom win alert
        if (typeof showGameAlert === 'function') {
            showGameAlert('🎉 VICTORY!', 'You cleared all the viruses first!', true);
        } else {
            // Fallback to old method
            this.winImg = document.createElement("img")
            this.winImg.src = this.getScSrc()
            this.winImg.id = 'win'
            this.appendChild(this.winImg)
            let clickedOnce = false
            setTimeout(() => {
                this.winListener = document.addEventListener("keydown", () => {
                    if (clickedOnce) return
                    clickedOnce = true
                    this.winImg.remove()
                    window.location.reload()
                }, { once: true })
            }, DELAY.nextStageListener)
        }
    }

    /**
     * Shows defeat screen when opponent wins in multiplayer
     * Called when opponent wins (opponentWin event received)
     */
    showOpponentWinScreen() {
        // Show custom lose alert
        if (typeof showGameAlert === 'function') {
            showGameAlert('💀 DEFEAT!', 'Your opponent cleared all the viruses first!', false);
        } else {
            // Fallback to old method
            this.opponentWinImg = document.createElement("img")
            this.opponentWinImg.src = this.getGoSrc() // Use game over image for opponent win
            this.opponentWinImg.id = 'opponentWin'
            this.appendChild(this.opponentWinImg)
            let clickedOnce = false
            setTimeout(() => {
                this.opponentWinListener = document.addEventListener("keydown", () => {
                    if (clickedOnce) return
                    clickedOnce = true
                    this.opponentWinImg.remove()
                    window.location.reload()
                }, { once: true })
            }, DELAY.endGameListener)
        }
    }

    /**
     * Sets the background image based on the current level
     * @param {number} level - The level number (defaults to current board level)
     */
    setBg(level = this.board.level) {
        this.style.backgroundImage = "url('./img/bg" + level % 5 + ".png')"
    }
    
    /**
     * Gets the background image source for a given level
     * @param {number} level - The level number
     * @returns {string} The background image path
     */
    getBgSrc(level) {
        return "./img/bg" + (level || this.board.level) % 5 + ".png"
    }
    
    /**
     * Gets the game over image source for the current level
     * @returns {string} The game over image path
     */
    getGoSrc() {
        return "./img/go" + this.board.level % 5 + ".png"
    }
    
    /**
     * Gets the stage complete image source for the current level
     * @returns {string} The stage complete image path
     */
    getScSrc() {
        return "./img/sc" + this.board.level % 5 + ".png"
    }

    /**
     * Shows a custom victory alert for multiplayer wins
     * Creates a styled overlay with victory message and auto-returns to homepage
     */
    showVictoryAlert() {
        // Create victory overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 3000;
            animation: fadeIn 0.5s ease-in-out;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(145deg, #1a1a2e, #16213e);
            border: 4px solid #00ff00;
            border-radius: 25px;
            padding: 50px;
            text-align: center;
            max-width: 600px;
            width: 90%;
            box-shadow: 0 0 50px rgba(0, 255, 0, 0.8);
            animation: victoryGlow 0.6s ease-out;
            position: relative;
            overflow: hidden;
        `;

        const title = document.createElement('div');
        title.style.cssText = `
            font-size: 3rem;
            font-weight: bold;
            margin-bottom: 20px;
            color: #00ff00;
            text-shadow: 0 0 20px #00ff00, 0 0 40px #00ff00;
            animation: victoryPulse 1.5s ease-in-out infinite alternate;
        `;
        title.textContent = '🏆 VICTORY! 🏆';

        const message = document.createElement('div');
        message.style.cssText = `
            font-size: 1.6rem;
            color: #ffffff;
            margin-bottom: 30px;
            line-height: 1.6;
        `;
        message.textContent = 'You cleared all viruses! Your opponent has lost.';

        modal.appendChild(title);
        modal.appendChild(message);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Auto-close after 5 seconds and return to homepage
        setTimeout(() => {
            overlay.remove();
            this.returnToHomepage();
        }, 5000);
    }

    showOpponentWinScreen() {
        // Create loss overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 3000;
            animation: fadeIn 0.5s ease-in-out;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(145deg, #2a1a1a, #3e2a2a);
            border: 4px solid #ff4444;
            border-radius: 25px;
            padding: 50px;
            text-align: center;
            max-width: 600px;
            width: 90%;
            box-shadow: 0 0 50px rgba(255, 68, 68, 0.8);
            animation: defeatGlow 0.6s ease-out;
            position: relative;
            overflow: hidden;
        `;

        const title = document.createElement('div');
        title.style.cssText = `
            font-size: 3rem;
            font-weight: bold;
            margin-bottom: 20px;
            color: #ff4444;
            text-shadow: 0 0 20px #ff4444, 0 0 40px #ff4444;
            animation: defeatPulse 1.5s ease-in-out infinite alternate;
        `;
        title.textContent = '💀 DEFEAT! 💀';

        const message = document.createElement('div');
        message.style.cssText = `
            font-size: 1.6rem;
            color: #ffffff;
            margin-bottom: 30px;
            line-height: 1.6;
        `;
        message.textContent = 'Your opponent cleared all their viruses first. You lost!';

        modal.appendChild(title);
        modal.appendChild(message);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Auto-close after 5 seconds and return to homepage
        setTimeout(() => {
            overlay.remove();
            this.returnToHomepage();
        }, 5000);
    }

    /**
     * Returns to the homepage by reloading the page
     */
    returnToHomepage() {
        // Reload the page to return to homepage
        window.location.reload();
    }
}
customElements.define("game-element", Game)

/**
 * DANCING VIRUS ANIMATION SYSTEM
 * ==============================
 * 
 * The dancing viruses at the bottom of the screen provide visual feedback
 * and entertainment. They react to game events:
 * - NORMAL: Dancing around the screen
 * - LAYING: Laying down when their color is cleared
 * - LAUGHING: Laughing when player loses
 * - DEAD: Disappearing when all viruses of their color are cleared
 */

/**
 * Animation modes for dancing viruses
 */
const DancingMode = {
    NORMAL: 0,    // Normal dancing animation
    LAYING: 1,    // Laying down when color is cleared
    LAUGHING: 2,  // Laughing when player loses
    DEAD: 3,      // Dead/disappeared when all of color cleared
}

/**
 * Manages the collection of dancing viruses
 * Handles their animations and reactions to game events
 */
class DancingViruses {
    /**
     * Creates the dancing virus system
     * @param {Game} game - The game instance
     */
    constructor(game) {
        this.game = game
        // Create three dancing viruses, one for each color
        this.list = [
            new DancingVirus(this.game, Color.THIRD, 0),   // Yellow virus
            new DancingVirus(this.game, Color.SECOND, 6),  // Brown virus  
            new DancingVirus(this.game, Color.FIRST, 12),  // Blue virus
        ]
        this.appendToGame()
        this.startAnimation()
    }

    /**
     * Starts the animation system for all dancing viruses
     * Sets up movement and animation intervals
     */
    startAnimation() {
        // Move viruses every second (unless one is laying down)
        setInterval(() => {
            if (this.anyVirusLaying()) return
            this.nextMove()
        }, 1000);
        
        // Animate viruses every 250ms (with slight delay)
        setTimeout(() => {
            setInterval(() => {
                this.nextAnimation()
            }, 250);
        }, 125)
    }

    /**
     * Makes a virus of the specified color lay down
     * Called when that color is cleared from the board
     * @param {string} color - The color of the virus to lay down
     */
    lay(color) {
        this.list.filter(el => el.color == color)[0].setMode(DancingMode.LAYING)
    }

    /**
     * Checks if any virus is currently laying down
     * @returns {boolean} True if any virus is laying down
     */
    anyVirusLaying() {
        for (let virus of this.list)
            if (virus.mode == DancingMode.LAYING)
                return true
        return false
    }

    /**
     * Adds all dancing viruses to the game element
     */
    appendToGame() {
        for (let virus of this.list)
            this.game.append(virus)
    }

    /**
     * Moves all viruses to their next position
     */
    nextMove() {
        for (let virus of this.list)
            virus.nextMove()
    }

    /**
     * Advances animation for all viruses
     */
    nextAnimation() {
        for (let virus of this.list)
            virus.nextAnimation()
    }

    /**
     * Advances laying animation for all viruses
     */
    nextAnimationLaying() {
        for (let virus of this.list)
            virus.nextAnimationLaying()
    }

    /**
     * Removes all dancing viruses from the game
     */
    destroy() {
        for (let virus of this.list)
            virus.remove()
    }

    /**
     * Sets the animation mode for all viruses
     * @param {number} mode - The animation mode to set
     */
    setMode(mode) {
        for (let virus of this.list)
            virus.setMode(mode)
    }
}

/**
 * Individual dancing virus element
 * Handles movement, animation, and reactions to game events
 */
class DancingVirus extends HTMLElement {
    /**
     * Creates a dancing virus
     * @param {Game} game - The game instance
     * @param {string} color - The virus color (bl, br, yl)
     * @param {number} currentStep - Starting position in the dance path
     */
    constructor(game, color, currentStep) {
        super()
        this.game = game
        this.color = color
        this.currentStep = currentStep
        this.currentAnimation = 0
        this.currentModeCount = 0
        this.mode = DancingMode.NORMAL
        
        // Animation frames for each mode
        this.animations = {
            0: [2, 1, 2, 3],  // NORMAL: dancing sequence
            1: [5, 6],        // LAYING: laying down sequence
            2: [2, 4],        // LAUGHING: laughing sequence
            3: [],            // DEAD: no animation (invisible)
        }
        
        // Dance path - the virus follows this circular path
        this.steps = [
            { x: 5, y: 0 },  // Start position
            { x: 4, y: 0 },
            { x: 3, y: 0 },
            { x: 2, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 2 },
            { x: 0, y: 2 },
            { x: 0, y: 3 },
            { x: 1, y: 4 },
            { x: 1, y: 5 },
            { x: 2, y: 5 },
            { x: 3, y: 5 },
            { x: 4, y: 5 },
            { x: 5, y: 5 },
            { x: 6, y: 4 },
            { x: 6, y: 3 },
            { x: 6, y: 2 },
            { x: 6, y: 1 },  // End position (loops back to start)
        ]
    }

    /**
     * Called when the virus element is connected to the DOM
     */
    connectedCallback() {
        this.display()
    }

    /**
     * Updates the virus position and appearance
     */
    display() {
        this.style.left = 2 * 24 + this.getPosition().x * 24 + 'px'
        this.style.top = 14 * 24 + this.getPosition().y * 24 + 'px'
        this.style.backgroundImage = "url('" + this.getImage() + "')"
    }

    /**
     * Gets the current position in the dance path
     * @returns {Object} The current position {x, y}
     */
    getPosition() {
        return this.steps[this.currentStep]
    }

    /**
     * Gets the current animation image path
     * @returns {string} The image path for the current animation frame
     */
    getImage() {
        if (this.mode == DancingMode.DEAD) return ''
        return "./img/lupa/" + this.color + "/" + this.animations[this.mode][this.currentAnimation] + ".png"
    }

    /**
     * Moves the virus to the next position in the dance path
     * Only moves in NORMAL mode
     */
    nextMove() {
        if (this.mode != DancingMode.NORMAL) return
        if (++this.currentStep == this.steps.length) this.currentStep = 0
        this.style.left = 2 * 24 + this.getPosition().x * 24 + 'px'
        this.style.top = 14 * 24 + this.getPosition().y * 24 + 'px'
    }

    /**
     * Advances the animation frame
     * Handles special logic for laying down and checking if color is cleared
     */
    nextAnimation() {
        this.currentModeCount++
        
        // Special handling for laying down mode
        if (this.mode == DancingMode.LAYING && this.currentModeCount >= 10) {
            // Check if any viruses of this color still exist on the board
            let anyVirusInColor = false
            for (let virus of this.game.board.virusList.filter(el => el.pieces.length != 0))
                if (virus.color == this.color)
                    anyVirusInColor = true
            
            // If no viruses of this color remain, virus dies; otherwise returns to normal
            if (anyVirusInColor)
                this.setMode(DancingMode.NORMAL)
            else
                this.setMode(DancingMode.DEAD)

            return
        }
        
        // Advance to next animation frame
        if (++this.currentAnimation == this.animations[this.mode].length) this.currentAnimation = 0
        this.style.backgroundImage = "url('" + this.getImage() + "')"
    }

    /**
     * Sets the animation mode for the virus
     * @param {number} mode - The new animation mode
     */
    setMode(mode) {
        // Dead viruses can't be made to laugh
        if (this.mode == DancingMode.DEAD && mode == DancingMode.LAUGHING) return
        
        this.mode = mode
        this.currentAnimation = 0
        this.currentModeCount = 0
        
        // Special setup for laying down mode
        if (mode == DancingMode.LAYING)
            this.currentAnimationLaying = 0
    }
}

customElements.define("dancing-virus", DancingVirus)
