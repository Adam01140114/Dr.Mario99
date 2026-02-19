/**
 * DR. MARIO 99 - CORE GAME LOGIC AND BOARD MANAGEMENT
 * ===================================================
 * 
 * This file contains the core game logic that was consolidated from separate
 * Board.js and Board2.js files. It now handles both Player 1 and Player 2
 * dynamically based on the playerNumber parameter.
 * 
 * KEY SYSTEMS:
 * - Game board management (8x17 grid)
 * - Pill movement and rotation
 * - Virus spawning and management
 * - Damage system (sending/receiving viruses)
 * - Point accumulation and clearing logic
 * - Multiplayer synchronization
 * 
 * DAMAGE SYSTEM:
 * - Players accumulate points by clearing 4+ in a row
 * - Points are sent to opponent as damage
 * - Damage spawns viruses on opponent's board
 * - Damage is capped at 1 virus maximum per clear
 * 
 * MULTIPLAYER FEATURES:
 * - Player-specific board positioning
 * - Socket-based damage communication
 * - Shared game state synchronization
 */

"use strict"
import { Pill, Virus, randomColor } from "./Shape.js"
import { Color, Direction, Rotation, DELAY } from "./components.js"

// Global game state variables
var pillnum = 1;        // Current pill number
var second = 0;         // Timer for game events
var enemy = 0;          // Enemy player reference

// Pill positioning (global constants)
var pillx1 = 3;  // Left pill X position
var pillx2 = 4;  // Right pill X position

/**
 * CONSOLIDATION NOTES:
 * ====================
 * 
 * The following variables were moved from global scope to instance variables
 * to prevent conflicts between Player 1 and Player 2 instances:
 * 
 * MOVED TO INSTANCE VARIABLES:
 * - realdamage: Damage received from opponent
 * - localpoints: Points accumulated for current clear
 * - player: Player number (1 or 2)
 * - falling: Falling state for pills
 * - spawn: Spawn counter for viruses
 * - hurting1-4: Hurt animation states
 * - pilly, pilly2-4: Pill Y positions
 * - randy, randy2-4: Random Y positions for virus spawning
 * - randx, randx2-4: Random X positions for virus spawning
 * - randcolor, randcolor2-4: Random colors for virus spawning
 * 
 * This consolidation allows the same Board.js file to handle both players
 * without variable conflicts, as each instance maintains its own state.
 */
// var this.randcolor3 = 'bl'; // Moved to instance variables
// var this.randcolor4 = 'bl'; // Moved to instance variables

// Socket.IO connection for multiplayer communication
const socket = io(window.location.origin);

/**
 * Utility function to convert digits to image elements
 * Used for displaying score numbers
 * @param {number} digit - The digit to convert
 * @returns {HTMLElement} Image element with the digit
 */
function digitToImg(digit) {
    digit = parseInt(digit)
    const img = document.createElement("img")
    img.src = "./img/cyfry/" + digit + ".png"
    return img
}

/**
 * Base Board Class
 * Handles the fundamental grid system and field management
 * Extended by PlayingBoard and ThrowingBoard
 */
class Board extends HTMLElement {
    /**
     * Creates a new board instance
     * @param {Game} game - The game instance this board belongs to
     */
    constructor(game) {
        super()
        this.game = game
        this.fieldSize = 24  // Size of each field in pixels
    }

    /**
     * Creates the grid of fields for the board
     * Builds a 2D array of Field objects
     */
    createGrid() {
        this.fields = []
        for (let x = 0; x < this.width; x++) {
            this.fields[x] = []
            for (let y = this.height - 1; y >= 0; y--)
                this.createNewField(x, y)
        }
    }

    /**
     * Creates a new field at the specified coordinates
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     */
    createNewField(x, y) {
        const field = new Field(this, x, y)
        this.fields[x][y] = field
        this.append(field)
    }

    /**
     * Sets the board dimensions based on field size
     */
    setStyles() {
        this.style.width = this.width * this.fieldSize + "px"
        this.style.height = this.height * this.fieldSize + "px"
    }

    /**
     * Checks if coordinates are outside the board boundaries
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {boolean} True if coordinates are out of bounds
     */
    outOfBounds(x, y) {
        if (x < 0 || x >= this.width) return true
        else if (y < 0 || y >= this.height) return true
        else return false
    }
}

/**
 * MAIN PLAYING BOARD CLASS
 * =======================
 * 
 * This is the core game board where all the action happens.
 * Handles pill movement, virus spawning, damage system, and multiplayer logic.
 * 
 * KEY FEATURES:
 * - 8x17 grid for game pieces
 * - Pill movement and rotation
 * - Virus spawning and management
 * - Damage system (sending/receiving)
 * - Point accumulation and clearing
 * - Player-specific positioning
 */
export class PlayingBoard extends Board {
    /**
     * Creates the main playing board
     * @param {Game} game - The game instance
     * @param {number} level - Starting level (default: 0)
     * @param {number} score - Starting score (default: 0)
     * @param {number} playerNumber - Player number (1 or 2)
     */
    constructor(game, level = 0, score = 0, playerNumber = 1) {
        super(game)
        this.playerNumber = playerNumber

        // Store reference to current PlayingBoard for new game data
        window.currentPlayingBoard = this;

        // Prevent multiple PlayingBoard instances for the same player
        if (window[`playingBoard${playerNumber}Created`]) {
            return;
        }
        window[`playingBoard${playerNumber}Created`] = true;

        // Set player-specific undery values for virus spawning
        // Player 1: undery = 14 (bottom of board)
        // Player 2: undery = 6 (middle of board for visual balance)
        this.undery = this.playerNumber === 1 ? 14 : 6;
        this.undery2 = this.playerNumber === 1 ? 14 : 6;
        this.undery3 = this.playerNumber === 1 ? 14 : 6;
        this.undery4 = this.playerNumber === 1 ? 14 : 6;

        // Initialize instance variables to avoid conflicts between players
        // DAMAGE SYSTEM VARIABLES
        this.localpoints = 0;              // Points accumulated for current clear
        this.realdamage = 0;               // Damage received from opponent
        this.damageProcessed = false;      // Flag to track if damage has been processed

        // GAME STATE VARIABLES
        this.spawn = 0;                    // Spawn counter for viruses
        this.falling = 0;                  // Falling state for pills

        // ANIMATION STATE VARIABLES
        this.hurting1 = 0;                 // Hurt animation state 1
        this.hurting2 = 0;                 // Hurt animation state 2
        this.hurting3 = 0;                 // Hurt animation state 3
        this.hurting4 = 0;                 // Hurt animation state 4

        // VIRUS SPAWNING VARIABLES
        this.randy = 15;                   // Random Y position for virus spawning
        this.randy2 = 15;                  // Random Y position for virus spawning 2
        this.randy3 = 15;                  // Random Y position for virus spawning 3
        this.randy4 = 15;                  // Random Y position for virus spawning 4
        this.randx = 2;                    // Random X position for virus spawning
        this.randx2 = 2;                   // Random X position for virus spawning 2
        this.randx3 = 2;                   // Random X position for virus spawning 3
        this.randx4 = 2;                   // Random X position for virus spawning 4
        this.randcolor = 'bl';             // Random color for virus spawning
        this.randcolor2 = 'bl';            // Random color for virus spawning 2
        this.randcolor3 = 'bl';            // Random color for virus spawning 3
        this.randcolor4 = 'bl';            // Random color for virus spawning 4

        // PILL POSITIONING VARIABLES
        this.pilly = 15;
        this.pilly2 = 15;
        this.pilly3 = 15;
        this.pilly4 = 15;

        // Create the throwing board (where new pills appear)
        this.throwingBoard = new ThrowingBoard(this.game, this, this.playerNumber);

        // Board dimensions (8x17 grid)
        this.width = 8
        this.height = 17
        this.level = level
        this.score = score
        this.virusList = []
        this.game.append(this.throwingBoard)

        // Game state tracking
        this.gameStarted = false; // Flag to track if game has started (viruses spawned)
        this.gameStartTime = Date.now(); // Track when game started

		// Virus positions for multiplayer synchronization
		this.virusPositions = [];
        // Note: Virus positions are now received via 'receiveNewGameData' event
        // and handled in Shape.js for synchronization
    }

    /**
     * Called when the board is connected to the DOM
     * Initializes the game board, sets up listeners, and spawns initial viruses
     */
    connectedCallback() {
        this.createGrid()
        this.setStyles()
        this.createKeyboardListeners()
        this.spawnViruses()
        this.initImageCounters()

		// Add damage listener to PlayingBoard instance
        if (!this.isDamageListenerAdded) {
            this.isDamageListenerAdded = true;

            /**
             * DAMAGE LISTENER SYSTEM
             * ======================
             * 
             * Listens for damage events from the opponent and processes them.
             * Damage is calculated as: floor(opponent_points / 4)
             * Damage is capped at 1 virus maximum per clear.
             */
            socket.on(`p${this.playerNumber}damage`, (data) => {

                // Validate room code to ensure damage is for the correct game
                if (data.roomCode === roomCode) {

                    // Calculate damage: every 4 points = 1 virus
                    const calculatedDamage = Math.floor(data[`p${this.playerNumber}damage`] / 4);

                    if (calculatedDamage > 0) {
                        // Cap damage at 1 virus maximum per clear
                        this.realdamage = Math.min(calculatedDamage, 1);
                        this.damageProcessed = false;
                    } else {
                    }
                } else {
                }
            });
        } else {
        }

    }

    /**
     * Advances to the next level
     * Clears the board and spawns new viruses
     */
    nextLevel() {
        this.level++
        for (let row of this.fields)
            for (let field of row)
                field.clear()
        this.spawnViruses()
        this.initImageCounters()
    }

    /**
     * Initializes all UI counters and spawns the first pill
     */
    initImageCounters() {
        this.initScore()
        this.initTopScore()
        this.initVirusCount()
        this.initLevelCount()
        this.spawnPill()
    }

    initScore() {
        this.scoreElement = document.createElement("div")
        this.scoreElement.id = 'score'
        this.game.append(this.scoreElement)
        let scoreString = ("0".repeat(7) + this.score).substr(-7)
        this.scoreElement.innerHTML = ''
        for (let digit of scoreString)
            this.scoreElement.appendChild(digitToImg(digit))
    }

    initTopScore() {
        this.topElement = document.createElement("div")
        this.topElement.id = 'top'
        this.game.append(this.topElement)
        for (let i = 0; i < 7; i++) {
            this.topElement.appendChild(digitToImg(0))
        }
        this.readTopScore()
    }

    initVirusCount() {
        this.virusCountElement = document.createElement("div")
        this.virusCountElement.id = 'virusCount'
        this.game.append(this.virusCountElement)
        let virusCountString = ("0".repeat(2) + this.virusCount).substr(-2)
        this.virusCountElement.innerHTML = ''
        for (let digit of virusCountString)
            this.virusCountElement.appendChild(digitToImg(digit))
    }

    initLevelCount() {
        this.levelCountElement = document.createElement("div")
        this.levelCountElement.id = 'levelCount'
        this.game.append(this.levelCountElement)
        let levelCountString = ("0".repeat(2) + this.level).substr(-2)
        this.levelCountElement.innerHTML = ''
        for (let digit of levelCountString)
            this.levelCountElement.appendChild(digitToImg(digit))
    }

    movePillFromThrowingBoard() {
        // Check if currentPill exists and has pieces
        if (this.throwingBoard.currentPill && this.throwingBoard.currentPill.pieces && this.throwingBoard.currentPill.pieces.length >= 2) {
            this.currentPill = new Pill(this, this.throwingBoard.currentPill.pieces[0].color, this.throwingBoard.currentPill.pieces[1].color)
        } else {
            // Fallback: create pill with random colors
            const color1 = randomColor();
            const color2 = randomColor();
            this.currentPill = new Pill(this, color1, color2)
        }
        this.throwingBoard.spawnPill()
        clearInterval(this.throwingBoardInterval)
        this.throwingBoardInterval = null
    }

    increaseScore() {
        this.score += 100
        let scoreString = ("0".repeat(7) + this.score).substr(-7)
        this.scoreElement.innerHTML = ''
        for (let digit of scoreString)
            this.scoreElement.appendChild(digitToImg(digit))
    }

    decreaseVirusCount() {
        this.virusCount--
        let virusCountString = ("0".repeat(2) + this.virusCount).substr(-2)
        this.virusCountElement.innerHTML = ''
        for (let digit of virusCountString)
            this.virusCountElement.appendChild(digitToImg(digit))
    }

    destroy() {
        // Reset creation guards so a fresh board can be created next round
        if (typeof this.playerNumber !== 'undefined') {
            delete window[`playingBoard${this.playerNumber}Created`];
            delete window[`throwingBoard${this.playerNumber}Created`];
        }
        if (window.currentPlayingBoard === this) {
            window.currentPlayingBoard = null;
        }

        this.topElement.remove()
        this.scoreElement.remove()
        this.virusCountElement.remove()
        for (let row of this.fields) {
            for (let field of row) {
                field.remove()
            }
        }
        for (let row of this.throwingBoard.fields) {
            for (let field of row) {
                field.remove()

            }
        }
        this.remove()
    }

    newTopScore() {
        this.topScore = this.score
        localStorage.setItem('top', this.score)
        this.setTopScore(this.score)
    }

    readTopScore() {
        let top = localStorage.getItem('top')
        if (top !== null) {
            this.topScore = top
            this.setTopScore(this.topScore)
            localStorage.clear()
            localStorage.setItem('top', top)
        } else
            this.topScore = 0
    }

    setTopScore(score) {
        let scoreString = ("0".repeat(7) + score).substr(-7)
        this.topElement.innerHTML = ''
        for (let digit of scoreString)
            this.topElement.appendChild(digitToImg(digit))
    }

    createKeyboardListeners() {
        this.intervals = []
        document.addEventListener("keydown", e => {
            e.preventDefault()
           // if (this.blockInput)
               // return
            if (!this.currentPill || this.currentPill.placed)
                return
            if (this.intervals[e.key])
                return
            this.movementFromKey(e.key)
            this.intervals[e.key] = setInterval(() => {
                this.movementFromKey(e.key)
            }, DELAY.readInput)
        })
        document.addEventListener("keyup", e => {
            clearInterval(this.intervals[e.key])
            this.intervals[e.key] = null
        })
    }

	/**
	 * VIRUS SPAWNING SYSTEM - HURT METHOD
	 * ====================================
	 * 
	 * This method spawns viruses on the player's board when they receive damage.
	 * It's called when the opponent clears 4+ in a row and sends damage.
	 * 
	 * VIRUS SPAWNING LOGIC:
	 * 1. Spawn a random virus at a random position
	 * 2. Set hurt animation states for visual feedback
	 * 3. Track spawn count for multiple damage instances
	 * 
	 * @param {number} realdamage - The amount of damage received (capped at 1)
	 */
	hurt(realdamage = null) {
		// Use provided damage or fall back to stored damage
		const actualDamage = realdamage !== null ? realdamage : this.realdamage;

		// Spawn a random virus on the board
		this.spawnRandomDot();

		// Set hurt animation states for visual feedback
		this.hurting1 = 1;

		// Additional hurt animations for multiple spawns
		if (this.spawn > 1){
			this.hurting2 = 1;
		}

		if (this.spawn > 2){
			this.hurting3 = 1;
		}

		if (this.spawn > 3){
			this.hurting4 = 1;
		}

    }

    spawnVirus(color) {
        let x, y
        do {
            x = Math.floor(Math.random() * 8)
            y = Math.floor(Math.random() * this.maxVirusHeight)
        } while (this.fields[x][y].isTaken() || this.fields[x][y].shouldBeCleared(color))
        this.virusList.push(new Virus(this, x, y, color))
    }

	spawnViruses() {

		//number of viruses (use shared setting if available)
		this.virusCount = (window.sharedGameData && parseInt(window.sharedGameData.virusCount, 10)) || 5;
        this.maxVirusHeight = 5
        if (this.level >= 15) this.maxVirusHeight++
        if (this.level >= 17) this.maxVirusHeight++
        if (this.level >= 19) this.maxVirusHeight++
        let color

        // Use synchronized virus positions from server
        for (let i = 0; i < this.virusCount; i++) {
			if (this.lastColor == Color.FIRST) color = Color.SECOND
            else if (this.lastColor == Color.SECOND) color = Color.THIRD
            else color = Color.FIRST
            this.lastColor = color

            const position = this.virusPositions[i];
            if (position) {
                const { x, y } = position;

                this.virusList.push(new Virus(this, x, y, color));
            } else {
            }
        }

        // Mark game as started after viruses are spawned
        this.gameStarted = true;
    }

    movementFromKey(key) {
        //if (this.blockInput){
           // return
		//}

        if (!this.currentPill || this.currentPill.placed){
            return
		}

        if (key == "ArrowLeft" || key == 'a'){
            this.currentPill.move(Direction.LEFT)
			pillx1 -= pillx1
			pillx2 -= pillx2
		}	

        if (key == "ArrowRight" || key == 'd'){
            this.currentPill.move(Direction.RIGHT)
			pillx1 += pillx1
			pillx2 += pillx2
		}

        if (key == "ArrowDown" || key == 's'){
            this.currentPill.moveUntilStopped(Direction.DOWN)
			this.pilly -= this.pilly
			this.pilly2 -= this.pilly2
		}

        if (key == "ArrowUp" || key == 'w'){
            this.currentPill.rotate(Direction.LEFT)

		}

        if (key == "Shift"){
            this.currentPill.rotate(Direction.RIGHT)
		}
    }

    /**
     * VIRUS SPAWNING IMPLEMENTATION - SPAWN RANDOM DOT
     * ================================================
     * 
     * This method spawns random viruses on the board when damage is received.
     * It creates viruses at random positions with random colors.
     * 
     * SPAWNING LOGIC:
     * 1. Select random X position from available slots
     * 2. Select random color from available colors
     * 3. Spawn virus at the selected position
     * 4. Handle multiple virus spawning for multiple damage
     */
    spawnRandomDot() {

        // Available colors for virus spawning
        let colors = ['yl', 'bl', 'br'];
        let availableX = [1, 2, 3, 4, 5, 6, 7];

        /**
         * Helper function to get random X position
         * Removes selected position to avoid duplicates
         */
        function getRandomX() {
            let randomIndex = Math.floor(Math.random() * availableX.length);
            return availableX.splice(randomIndex, 1)[0];
        }

		// Set Y positions for virus spawning (bottom of board)
		this.randy = 15;
		this.undery = 14;

		// Set Y positions for additional viruses
		this.randy2 = 15;
		this.undery2 = 14;

		this.randy3 = 15;
		this.undery3 = 14;

		this.randy4 = 15;
		this.undery4 = 14;

		// Spawn the first virus
		this.randx = getRandomX();
		this.randcolor = colors[Math.floor(Math.random() * colors.length)];
		this.fields[this.randx][this.randy].setColor(this.randcolor);

		// Spawn additional viruses for multiple damage
		if(this.hurting2 == 1){
			this.randx2 = getRandomX();
			this.randcolor2 = colors[Math.floor(Math.random() * colors.length)];
			this.fields[this.randx2][this.randy2].setColor(this.randcolor2);
		}

		if(this.hurting3 == 1){
			this.randx3 = getRandomX();
			this.randcolor3 = colors[Math.floor(Math.random() * colors.length)];
			this.fields[this.randx3][this.randy3].setColor(this.randcolor3);
		}

		if(this.hurting4 == 1){
			this.randx4 = getRandomX();
			this.randcolor4 = colors[Math.floor(Math.random() * colors.length)];
			this.fields[this.randx4][this.randy4].setColor(this.randcolor4);
		}

}

    nextFrame() {

		//where the magic happens

		if (this.randy != 0 && this.hurting1 == 1) {
			if((this.fields[this.randx][(this.undery)].color) == Color.NONE){

			//this.virusList.pop(new Virus(this, this.randx, this.randy, this.randcolor))

			this.fields[this.randx][(this.randy)].setColor(Color.NONE);

			//this.virusList.push(new Virus(this, this.randx, this.randy-1, this.randcolor))
			//this.virusList.pop(new Virus(this, this.randx, this.randy-1, this.randcolor))

			this.fields[this.randx][(this.randy-1)].setColor(this.randcolor);	

			this.randy = this.randy - 1;
			this.undery = this.randy - 1;
			}

			if(this.undery == -1){
				this.hurting1 = 0;
			this.spawn = this.spawn - 1;
			this.virusList.push(new Virus(this, this.randx, this.randy, this.randcolor))
			this.virusCount = this.virusCount + 1;

			} else if((this.fields[this.randx][(this.undery)].color) != Color.NONE) {
			this.virusList.push(new Virus(this, this.randx, this.randy, this.randcolor))
				this.hurting1 = 0;
			this.spawn = this.spawn - 1;
			this.virusCount = this.virusCount + 1;
			}

        } 

		if (this.randy2 != 0 && this.hurting2 == 1) {
			if((this.fields[this.randx2][(this.undery2)].color) == Color.NONE){
			this.fields[this.randx2][(this.randy2)].setColor(Color.NONE);
			this.fields[this.randx2][(this.randy2-1)].setColor(this.randcolor2);	
			this.randy2 = this.randy2 - 1;
			this.undery2 = this.randy2 - 1;
			}

			if(this.undery2 == -1){
				this.hurting2 = 0;
			this.spawn = this.spawn - 1;
			this.virusList.push(new Virus(this, this.randx2, this.randy2, this.randcolor2))

			} else if((this.fields[this.randx2][(this.undery2)].color) != Color.NONE) {
			this.virusList.push(new Virus(this, this.randx2, this.randy2, this.randcolor2))
				this.hurting2 = 0;
			this.spawn = this.spawn - 1;
			}

        } 

		if (this.randy3 != 0 && this.hurting3 == 1) {
    if((this.fields[this.randx3][(this.undery3)].color) == Color.NONE){
        this.fields[this.randx3][(this.randy3)].setColor(Color.NONE);
        this.fields[this.randx3][(this.randy3-1)].setColor(this.randcolor3);    
        this.randy3 = this.randy3 - 1;
        this.undery3 = this.randy3 - 1;
    }

    if(this.undery3 == -1){
        this.hurting3 = 0;
		spawn = spawn - 1;
        this.virusList.push(new Virus(this, this.randx3, this.randy3, this.randcolor3));
    } else if((this.fields[this.randx3][(this.undery3)].color) != Color.NONE) {
        this.virusList.push(new Virus(this, this.randx3, this.randy3, this.randcolor3));
        this.hurting3 = 0;
		spawn = spawn - 1;
    }
}

if (this.randy4 != 0 && this.hurting4 == 1) {
    if((this.fields[this.randx4][(this.undery4)].color) == Color.NONE){
        this.fields[this.randx4][(this.randy4)].setColor(Color.NONE);
        this.fields[this.randx4][(this.randy4-1)].setColor(this.randcolor4);    
        this.randy4 = this.randy4 - 1;
        this.undery4 = this.randy4 - 1;
    }

    if(this.undery4 == -1){
        this.hurting4 = 0;
		spawn = spawn - 1;
        this.virusList.push(new Virus(this, this.randx4, this.randy4, this.randcolor4));
    } else if((this.fields[this.randx4][(this.undery4)].color) != Color.NONE) {
        this.virusList.push(new Virus(this, this.randx4, this.randy4, this.randcolor4));
        this.hurting4 = 0;
		spawn = spawn - 1;
    }
}

        if (this.currentPill) {

			//
            let moved = this.currentPill.move(Direction.DOWN)

            if (!moved) {

                this.currentPill.place()
                this.clearIfNeeded()
                this.useGravitation()
                if (this.gameOver()) return
                if (this.stageCompleted()) return
            }

        }

    }

    stageCompleted() {
        // Wait 7 seconds before allowing victory to ensure game is fully loaded
        const currentTime = Date.now();
        const timeSinceStart = currentTime - this.gameStartTime;
        if (timeSinceStart < 7000) { // 7 seconds
            return false;
        }

        // Count all actual viruses currently on the board
        let actualVirusCount = 0;
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const field = this.fields[x][y];
                if (field.shapePiece && field.shapePiece.shape instanceof Virus) {
                    actualVirusCount++;
                }
            }
        }
        return actualVirusCount <= 0;
    }

    spawnPill() {
        if (this.stageCompleted())
            setTimeout(() => {
                this.game.nextStage()
            }, DELAY.nextStage)
        if (this.gameOver())
            setTimeout(() => {
                this.game.endGame()
            }, DELAY.gameOver)

        if (this.stageCompleted() || this.gameOver()) return
        this.lastStateThrowing = true
        this.currentPill = null
        if (!this.throwingBoardInterval) {
            this.throwingBoardInterval = setInterval(() => {
                this.throwingBoard.nextFrame()
            }, DELAY.throwFrame)
        }
    }

    gameOver() {
        if (this.fields[3][15].locked || this.fields[4][15].locked)
            return true
        else
            return false
    }

    clearIfNeeded() {

        let fieldsToClear = []
        for (let line of this.fields) {
            for (let field of line) {
                if (field.shouldBeCleared())
                    fieldsToClear.push(field)
            }
        }
        if (fieldsToClear.length > 0) {
            for (let field of fieldsToClear)
                field.clearAnimated()
        }
    }

    useGravitation() {
    if (this.gravitationInterval) return;
    this.gravitationInterval = setInterval(() => {
        let moved = false;
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const field = this.fields[x][y];
                if (field.isTaken() && field.locked) {
                    let shape = field.shapePiece.shape;
                    if (shape instanceof Pill) {
                        // Temporarily unlock the pieces to move them
                        for (let piece of shape.pieces) {
                            piece.field.locked = false;
                            piece.field.setColor(Color.NONE);
                        }
                        // Move the shape down if possible
                        if (shape.move(Direction.DOWN)) {
                            moved = true;
                        }
                        // Relock the pieces
                        for (let piece of shape.pieces) {
                            piece.field.locked = true;
                            piece.field.setColor(piece.color);
                        }
                    }
                }
            }
        }

        if (!moved) {
            this.clearIfNeeded();
            clearInterval(this.gravitationInterval);
            this.gravitationInterval = null;
            for (let line of this.fields)
                for (let field of line)
                    if (field.shouldBeCleared())
                        return;
            this.spawnPill();
        }
    }, DELAY.gravitation);
}
}
customElements.define("game-board", PlayingBoard)

class Field extends HTMLElement {
    constructor(board, x, y) {
        super()

		this.isDamageListenerAdded = false;

        this.board = board
        this.x = x
        this.y = y
        this.locked = false
        this.beingPassed = false
        this.shapePiece = null
        this.setColor(Color.NONE)
        if (this.y == 16 && this.x != 3 && this.x != 4) this.locked = true
    }

    isTaken() {
        return this.shapePiece != null
    }

    connectedCallback() {
        this.setStyles()
    }

    setStyles() {
        this.style.left = this.x * this.board.fieldSize + "px"
        this.style.top = this.board.fieldSize * (this.board.height - 1 - this.y) + 'px'
    }
   /**
    * CORE DAMAGE SYSTEM - CLEAR ANIMATED
    * ===================================
    * 
    * This is the heart of the damage system. When a field is cleared:
    * 1. Points are accumulated for each piece cleared
    * 2. When 4+ points are reached, damage is sent to opponent
    * 3. Points are reset after sending damage
    * 
    * DAMAGE CALCULATION:
    * - Every 4 points = 1 virus sent to opponent
    * - Damage is capped at 1 virus maximum per clear
    * - Points are sent immediately when threshold is reached
    */
   clearAnimated() {

    // Determine what type of piece is being cleared
    const x = this.shapePiece.shape instanceof Virus;
    const o = this.shapePiece.shape instanceof Pill;
    const color = this.shapePiece.color;

    // Clear the field
    this.clear();

    // Accumulate points for each piece cleared
    if (x) {
        this.board.localpoints += 1;
        this.style.backgroundImage = "url('./img/" + color + "_x.png')";
    }
    if (o) {
        this.board.localpoints += 1;
        this.style.backgroundImage = "url('./img/" + color + "_o.png')";
    }

    // DAMAGE THRESHOLD: Send damage when 4+ points are reached
    if (this.board.localpoints >= 4) {

        // Send damage immediately when 4+ points are reached
        socket.emit(`updatePoints${this.board.playerNumber === 1 ? 2 : 1}`, { 
            [`player${this.board.playerNumber === 1 ? 2 : 1}points`]: this.board.localpoints, 
            roomCode: roomCode 
        });

        // Reset points after sending damage
        this.board.localpoints = 0;
    }

    setTimeout(() => {
        this.setColor(Color.NONE);
    }, DELAY.oxDisappear);

}

clear() {
    // Unlock the field and reset its color.
    this.locked = false;
    this.setColor(Color.NONE);
    // Remove this shape from its shape group.
    this.shapePiece.shape.pieces = this.shapePiece.shape.pieces.filter(piece => piece != this.shapePiece);
    // Reset the color of remaining pieces in the group.
    for (let piece of this.shapePiece.shape.pieces) piece.field.setColor();
    // If the shape is a Virus, trigger score increase and decrease the virus count.
    if (this.shapePiece.shape instanceof Virus) {
        this.board.game.dancingViruses.lay(this.shapePiece.color);
        this.board.increaseScore();
        this.board.decreaseVirusCount();
    }
    // Mark the shape as destroyed and nullify it.
    this.shapePiece.destroyed = true;
    this.shapePiece.field = true;
    this.shapePiece = null;
}

shouldBeCleared(selfColor = this.getColor()) {
    // Check horizontally and vertically if there are enough same-colored shapes to clear.
    let horizontal = 0, vertical = 0;
    // Count same-colored shapes to the right.
    for (let i = 1; i <= 7; i++) {
        if (this.x + i >= this.board.width || selfColor != this.board.fields[this.x + i][this.y].getColor()) break;
        horizontal++;
    }
    // Count same-colored shapes to the left.
    for (let i = 1; i <= 7; i++) {
        if (this.x - i < 0 || selfColor != this.board.fields[this.x - i][this.y].getColor()) break;
        horizontal++;
    }
    // Count same-colored shapes upwards.
    for (let i = 1; i <= 15; i++) {
        if (this.y + i >= this.board.height || selfColor != this.board.fields[this.x][this.y + i].getColor()) break;
        vertical++;
    }
    // Count same-colored shapes downwards.
    for (let i = 1; i <= 15; i++) {
        if (this.y - i < 0 || selfColor != this.board.fields[this.x][this.y - i].getColor()) break;
        vertical++;
    }
    // Determine if the shapes should be cleared based on count.
    return selfColor != Color.NONE && (vertical >= 3 || horizontal >= 3);
}

setColor(color = this.color) {
    // Set the color of the current field.
    this.color = color;
    // If the color is NONE, make the field appear empty.
    if (color == Color.NONE) this.style.backgroundImage = "";
    else {
        // Otherwise, set the appropriate image based on the color and shape.
        this.style.backgroundImage = "url('./img/" + color + "_dot.png')";
        if (this.shapePiece && !(this.shapePiece.shape instanceof Virus)) {
            const shape = this.shapePiece.shape;
            // Adjust the image based on the pill's orientation.
            if (shape.pieces && shape.pieces.length == 2) {
                switch (shape.rotation) {
                    case Rotation.HORIZONTAL:
                        shape.pieces[0].field.setPillElement('left');
                        shape.pieces[1].field.setPillElement('right');
                        break;
                    case Rotation.VERTICAL:
                        shape.pieces[0].field.setPillElement('down');
                        shape.pieces[1].field.setPillElement('up');
                        break;
                    case Rotation.HORIZONTAL_REVERSED:
                        shape.pieces[1].field.setPillElement('left');
                        shape.pieces[0].field.setPillElement('right');
                        break;
                    case Rotation.VERTICAL_REVERSED:
                        shape.pieces[1].field.setPillElement('down');
                        shape.pieces[0].field.setPillElement('up');
                        break;
                }
            }
        }

        // If the shape is a Virus, use a specific image.
        if (this.shapePiece && this.shapePiece.shape instanceof Virus) {			

			/*
			//turns fallen pills into pills instead of viruses
			if(this.x == this.randx && this.y == this.randy){
			this.style.backgroundImage = "url('./img/" + color + "_dot.png')";
			} else if(this.x == this.randx2 && this.y == this.randy2){
			this.style.backgroundImage = "url('./img/" + color + "_dot.png')";
			} else if(this.x == this.randx3 && this.y == this.randy3){
			this.style.backgroundImage = "url('./img/" + color + "_dot.png')";
			} else if(this.x == this.randx4 && this.y == this.randy4){
			this.style.backgroundImage = "url('./img/" + color + "_dot.png')";
			} else {
				this.style.backgroundImage = "url('./img/" + color + "_covid.png')";
			}
			*/

            this.style.backgroundImage = "url('./img/" + color + "_covid.png')";

        }

    }
}

    setPillElement(element) {

		this.style.backgroundImage = "url('./img/" + this.color + "_" + element + ".png')"

    }

    getColor() {
        return this.color
    }
}

customElements.define("game-board-field", Field)

class ThrowingBoard extends Board {
    constructor(game, playingBoard, playerNumber = 1) {
        super(game)
        this.playerNumber = playerNumber
        this.playingBoard = playingBoard;

        // Prevent multiple ThrowingBoard instances
        if (window[`throwingBoard${playerNumber}Created`]) {
            return;
        }
        window[`throwingBoard${playerNumber}Created`] = true;

        this.width = 12
        this.height = 8
        this.setFrames()
    }

	spawnPill() {
        this.setArmPosition(Direction.UP)
        if (this.currentPill) {
            this.currentPill.pieces[0].field.clear()
            this.currentPill.pieces[0].field.clear()
        }

        // Get random colors for the pill
        const color1 = randomColor();
        const color2 = randomColor();

        this.currentPill = new Pill(this, color1, color2)
        this.currentFrame = 0
    }

    connectedCallback() {
        this.createGrid()
        this.setStyles()
        this.spawnPill()

		// Damage listener moved to PlayingBoard constructor - this is ThrowingBoard, not PlayingBoard

    }
	//hurt drops

	//balls drop

    /**
     * DAMAGE PROCESSING SYSTEM - SET FRAMES
     * =====================================
     * 
     * This method handles the damage processing when a new pill is spawned.
     * It checks for received damage and spawns viruses accordingly.
     * 
     * DAMAGE PROCESSING LOGIC:
     * 1. Check if damage was received (realdamage > 0)
     * 2. Check if damage hasn't been processed yet (damageProcessed = false)
     * 3. If both conditions are met, spawn virus and mark as processed
     * 4. Reset damage after processing
     */
    setFrames() {
        this.currentFrame = 0
        this.frames = [
            {
                /**
                 * FRAME 0: New pill spawn and damage processing
                 * This is where damage from the opponent is processed
                 */
                action: (pill) => {
                    pill.rotate(Direction.LEFT)

					// Reset pill positioning
					pillx1 = 3;
					pillx2 = 4;
					this.pilly = 15;
					this.pilly2 = 15;

					// Send points update to opponent
					socket.emit(`updatePoints${this.playerNumber === 1 ? 2 : 1}`, { [`player${this.playerNumber === 1 ? 2 : 1}points`]: this.localpoints, roomCode: roomCode });

					// Reset local points
					this.localpoints = 0;

					// DAMAGE PROCESSING: Check for received damage

					// Process damage if available and not already processed
					if(this.playingBoard.realdamage > 0 && !this.playingBoard.damageProcessed){
						// Only send one virus regardless of damage amount
						this.playingBoard.hurt(this.playingBoard.realdamage);
						this.spawn = this.spawn + 1;
						this.playingBoard.damageProcessed = true; // Mark damage as processed
						this.playingBoard.realdamage = 0
					} else if (this.playingBoard.realdamage > 0 && this.playingBoard.damageProcessed) {
					} else {
					}

                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.UP)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill, parent) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.UP)
                    pill.move(Direction.LEFT)
                    parent.setArmPosition(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill, parent) {
                    pill.rotate(Direction.LEFT)
                    parent.setArmPosition(Direction.DOWN)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                    pill.move(Direction.DOWN)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.rotate(Direction.LEFT)
                    pill.move(Direction.LEFT)
                }
            },
            {
                action: function (pill) {
                    pill.move(Direction.DOWN)
                }
            },
            {
                action: function (pill) {
                    pill.move(Direction.DOWN)
                }
            },
            {
                action: function (pill) {
                    pill.move(Direction.DOWN)
                }
            },
            {
                action: function (pill) {
                    pill.move(Direction.DOWN)
                }
            },
        ]
    }

    setArmPosition(dir) {

        for (let x = 10; x <= 11; x++)
            for (let y = 0; y <= 3; y++)
                this.fields[x][y].style.backgroundImage = ''
        switch (dir) {
            case Direction.UP:
                this.fields[11][1].style.backgroundImage = "url('./img/hands/up_3.png')"
                this.fields[11][2].style.backgroundImage = "url('./img/hands/up_2.png')"
                this.fields[11][3].style.backgroundImage = "url('./img/hands/up_1.png')"
                break
            case Direction.LEFT:
                this.fields[10][1].style.backgroundImage = "url('./img/hands/middle21.png')"
                this.fields[10][2].style.backgroundImage = "url('./img/hands/middle11.png')"
                this.fields[11][1].style.backgroundImage = "url('./img/hands/middle22.png')"
                this.fields[11][2].style.backgroundImage = "url('./img/hands/middle12.png')"
                break
            case Direction.DOWN:
                this.fields[11][0].style.backgroundImage = "url('./img/hands/down_2.png')"
                this.fields[11][1].style.backgroundImage = "url('./img/hands/down_1.png')"
                break
        }
    }

    nextFrame() {

        if (this.currentFrame >= this.frames.length - 1) {
            this.game.board.movePillFromThrowingBoard()
            //this.game.board.blockInput = false
            return
        }
        const data = this.frames[this.currentFrame++]
        data.action(this.currentPill, this)
    }
}

customElements.define("throwing-board", ThrowingBoard)