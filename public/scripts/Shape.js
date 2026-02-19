/**
 * DR. MARIO 99 - PILL COLOR SYSTEM AND SHARED RANDOMIZATION
 * =========================================================
 * 
 * This file handles the pill color system that was consolidated from separate
 * Shape.js and Shape2.js files. It now manages pill color generation for both
 * players using a shared randomization system.
 * 
 * KEY FEATURES:
 * - Shared pill color lists for fair multiplayer games
 * - Server-synchronized randomization
 * - Dynamic pill color generation
 * - Deep copy protection against mutation
 * 
 * MULTIPLAYER SYNCHRONIZATION:
 * - Both players receive the same random pill color list from server
 * - Colors are consumed in the same order for fairness
 * - Deep copy prevents accidental mutation of shared data
 * - Position tracking ensures synchronized consumption
 */

"use strict"
import { PlayingBoard } from "./Board.js"
import { Color, Direction, Rotation } from "./components.js"

// Global pill counter
var pill = 0;

/**
 * PILL COLOR SYNCHRONIZATION SYSTEM
 * =================================
 * 
 * These variables manage the shared pill color system:
 * - numberPosition: Current position in the shared color list
 * - number: Current color value being used
 * - myRandomList: The shared color list from the server
 */
// These variables will be set by the Game.js module when shared data is received
let numberPosition = 1;  // Position in the shared color list
let number;              // Current color value
let myRandomList = [];   // Shared color list from server

/**
 * Global tracker to monitor myRandomList changes
 * Helps debug synchronization issues between players
 */
window.trackMyRandomList = function() {
    // Track myRandomList changes
};

/**
 * Multiple script instance detection
 * Prevents duplicate loading that could cause synchronization issues
 */
if (window.shapeScriptLoaded) {
} else {
    window.shapeScriptLoaded = true;
}

/**
 * SHARED GAME DATA SYSTEM
 * =======================
 * 
 * This system handles receiving shared game data from the server,
 * including virus positions and pill color lists for multiplayer games.
 * 
 * KEY FEATURES:
 * - Deep copy protection against mutation
 * - Synchronized pill color lists for fairness
 * - Virus position synchronization
 * - Position reset for new games
 */

// Request new game data (virus positions and pill colors) for each new game
// Only request if not in a multiplayer room with shared data
if (typeof roomCode === 'undefined' || !roomCode || !window.sharedGameData) {
    socket.emit('requestNewGameData');
}
socket.on('receiveNewGameData', (gameData) => {

    // Expose full shared data for other modules (e.g., Board uses virusCount)
    window.sharedGameData = gameData;

    /**
     * CRITICAL: Create a DEEP COPY to prevent mutation
     * This ensures both players have independent copies of the color list
     * and prevents one player from affecting the other's list
     */
    myRandomList = [...gameData.randomList];
    window.trackMyRandomList(); // Track the change

    // Reset pill color position for new game to ensure synchronization
    numberPosition = 1;

    // Update virus positions in the board
    if (window.currentPlayingBoard) {
        window.currentPlayingBoard.virusPositions = gameData.virusPositions;

        // Trigger virus spawning with the new synchronized positions
        if (window.currentPlayingBoard.spawnViruses) {

            window.currentPlayingBoard.spawnViruses();
        }
    }
});

// DISABLED: Old system conflicts with new shared system
// socket.emit('requestRandomList');
// socket.on('receiveRandomList', (receivedList) => {
// 	
// 	myRandomList = receivedList;
// 	window.trackMyRandomList(); // Track the change
// });

//start time

/**
 * POSITION TRACKING SYSTEM - UPDATE NUMBER
 * ========================================
 * 
 * This function manages the position in the shared color list.
 * It ensures both players consume colors in the same order.
 * 
 * KEY FEATURES:
 * - Position tracking for synchronized consumption
 * - Bounds checking to prevent errors
 * - Circular list behavior (loops back to start)
 * - Extensive logging for debugging synchronization
 */
function updateNumber() {
    // Use window variables to ensure they're shared across modules
    const currentPosition = window.numberPosition || numberPosition;
    const currentList = window.myRandomList || myRandomList;

    // Check if position is within bounds
    if (currentPosition > 0 && currentPosition <= currentList.length) {
        // Get the color value at the current position
        number = currentList[currentPosition - 1];

        // Advance to next position
		window.numberPosition = currentPosition + 1;
		numberPosition = window.numberPosition;

		// Loop back to start when reaching end of list
		if(window.numberPosition > 100){ // Updated to match new list size
			window.numberPosition = 1;
			numberPosition = 1;

		}

    } else {

        //number = undefined; 
    }
}

// REMOVED: updateNumber(); - This was causing the position to advance before players started using the list 

/**
 * PILL COLOR GENERATION SYSTEM
 * ============================
 * 
 * This is the core function that generates pill colors for both players.
 * It uses the shared random list from the server to ensure fairness.
 * 
 * COLOR MAPPING:
 * - 0 = Color.FIRST (blue)
 * - 1 = Color.SECOND (brown) 
 * - 2 = Color.THIRD (yellow)
 * 
 * SYNCHRONIZATION:
 * - Both players use the same shared list
 * - Colors are consumed in the same order
 * - Position tracking ensures fairness
 * 
 * @returns {string} The color constant for the pill
 */
export function randomColor() {
	// Use window variables to ensure they're shared across modules
	const currentList = window.myRandomList || myRandomList;
	const currentPosition = window.numberPosition || numberPosition;

	// If myRandomList is empty (before server data is received), wait for server data
	if (currentList.length === 0) {

		return Color.FIRST; // Default to blue while waiting for server data
	}

	// Use the server-provided shared random list
	updateNumber(); 
	pill = number;

	// Map number values to color constants
	if(pill == 0){	

		return Color.FIRST
	}

	if(pill == 1){	

		return Color.SECOND
	}

	if(pill == 2){	

		return Color.THIRD
	}
}

class Shape {
    constructor(board) {
        this.board = board
        this.placed = false
    }

    setCenterField(x, y) {
        if (this.board.fields[x][y] === undefined) return
        this.centerField = this.board.fields[x][y]
    }
}

export class Virus extends Shape {
    constructor(board, x, y, color) {
        super(board)
        this.color = color
        this.setCenterField(x, y)
        this.pieces = [
            new ShapePiece(this, this.centerField, this.color),
        ]
        this.pieces[0].place()
    }
}

/**
 * PILL CLASS - DYNAMIC POSITIONING SYSTEM
 * =======================================
 * 
 * This class handles pill creation with dynamic positioning based on board type.
 * It was consolidated from separate Pill classes to handle both PlayingBoard and ThrowingBoard.
 * 
 * KEY FEATURES:
 * - Dynamic positioning based on board dimensions
 * - Fallback color generation using shared random system
 * - Bounds checking for field placement
 * - Support for both game boards (PlayingBoard and ThrowingBoard)
 */
export class Pill extends Shape {
    /**
     * Creates a new pill with dynamic positioning
     * @param {Board} board - The board instance (PlayingBoard or ThrowingBoard)
     * @param {string} color1 - First color (optional, will use random if not provided)
     * @param {string} color2 - Second color (optional, will use random if not provided)
     */
    constructor(board, color1, color2) {
        super(board)

        // Determine if this is a PlayingBoard (8x17) or ThrowingBoard (12x8)
        if (board.width === 8 && board.height === 17) {
            // This is a PlayingBoard - use position (3, 15)
            this.setCenterField(3, 15)
        } else {
            // This is a ThrowingBoard - use position (10, 4)
            this.setCenterField(10, 4)
        }
        this.rotation = Rotation.HORIZONTAL
        this.createPieces(color1, color2)
    }

    /**
     * Creates the two pieces that make up a pill
     * Handles fallback color generation and bounds checking
     * @param {string} color1 - First color (optional)
     * @param {string} color2 - Second color (optional)
     */
    createPieces(color1, color2) {
        // Use random colors if not provided (fallback to shared random system)
        const actualColor1 = color1 || randomColor();
        const actualColor2 = color2 || randomColor();

        // Get the right field, but check if it exists
        const rightField = this.fieldTo(Direction.RIGHT);
        if (!rightField) {
            // If right field is out of bounds, use center field for both pieces
            this.pieces = [
                new ShapePiece(this, this.centerField, actualColor1),
                new ShapePiece(this, this.centerField, actualColor2),
            ]
        } else {
            this.pieces = [
                new ShapePiece(this, this.centerField, actualColor1),
                new ShapePiece(this, rightField, actualColor2),
            ]
        }

        // Set the visual colors on the board
        this.pieces[0].field.setColor(this.pieces[0].color)
        this.pieces[1].field.setColor(this.pieces[1].color)
    }

    /**
     * Gets the field in a specific direction from the center field
     * Includes bounds checking to prevent out-of-bounds errors
     * @param {Object} direction - Direction object with x, y offsets
     * @returns {Field|false} The target field or false if out of bounds
     */
    fieldTo(direction) {
        if (!this.centerField) {
            return false;
        }
        const x = this.centerField.x + direction.x
        const y = this.centerField.y + direction.y
        if (x >= this.board.width || y >= this.board.height || x < 0 || y < 0) return false
        return this.board.fields[x][y]
    }

    place() {
        this.placed = true
        for (let piece of this.pieces)
            piece.place()
    }

    canRotate(direction) {
        let futureRotation = this.rotation
        if (direction == Direction.RIGHT)
            if (futureRotation++ == 3) futureRotation = 0
        if (direction == Direction.LEFT)
            if (futureRotation-- == 0) futureRotation = 3

        if (futureRotation == Rotation.HORIZONTAL || futureRotation == Rotation.HORIZONTAL_REVERSED) {
            if (this.centerField.x == this.board.width - 1) {
                if (this.centerField.x == this.board.width - 1) {
                    if (!this.fieldTo(Direction.LEFT).locked)
                        return true
                }
            }
        }
        if (futureRotation == Rotation.HORIZONTAL || futureRotation == Rotation.HORIZONTAL_REVERSED) {
            if (!this.fieldTo(Direction.RIGHT)) return false
            if (this.fieldTo(Direction.RIGHT).locked) return false
        }
        if (futureRotation == Rotation.VERTICAL || futureRotation == Rotation.VERTICAL_REVERSED) {
            if (!this.fieldTo(Direction.UP)) return false
            if (this.fieldTo(Direction.UP).locked) return false
        }
        return true
    }

    rotate(direction) {
        this.moveFromWallIfNeeded()
        if (!this.canRotate(direction)) return false
        this.rotatePieces(direction)
        return true
    }

    rotatePieces(direction) {
        const previousFields = this.pieces.map(piece => piece.field)
        this.board.isBatchUpdate = true

        if (direction == Direction.RIGHT)
            if (this.rotation++ == 3) this.rotation = 0
        if (direction == Direction.LEFT)
            if (this.rotation-- == 0) this.rotation = 3

        if (this.rotation == Rotation.HORIZONTAL && this.centerField.x == this.board.width - 1) {
            this.pieces[1].setField(this.fieldTo(Direction.LEFT))
            this.pieces[0].setField(this.centerField)
        } else if (this.rotation == Rotation.HORIZONTAL_REVERSED && this.centerField.x == this.board.width - 1) {
            this.pieces[0].setField(this.centerField)
            this.pieces[1].setField(this.fieldTo(Direction.LEFT))
        } else {
            if (this.rotation == Rotation.VERTICAL) {
                this.pieces[1].setField(this.fieldTo(Direction.UP))
                this.pieces[0].setField(this.centerField)
            } else if (this.rotation == Rotation.HORIZONTAL) {
                this.pieces[1].setField(this.fieldTo(Direction.RIGHT))
                this.pieces[0].setField(this.centerField)
            } else if (this.rotation == Rotation.VERTICAL_REVERSED) {
                this.pieces[0].setField(this.fieldTo(Direction.UP))
                this.pieces[1].setField(this.centerField)
            } else if (this.rotation == Rotation.HORIZONTAL_REVERSED) {
                this.pieces[0].setField(this.fieldTo(Direction.RIGHT))
                this.pieces[1].setField(this.centerField)
            }
        }

        this.board.isBatchUpdate = false
        this.reconcilePieceRendering(previousFields)

    }

    moveFromWallIfNeeded() {
        if (this.rotation == Rotation.VERTICAL || this.rotation == Rotation.VERTICAL_REVERSED) {
            if (this.centerField.x == this.board.width - 1)
                this.move(Direction.LEFT)
            else if (this.fieldTo(Direction.RIGHT).locked)
                this.move(Direction.LEFT)
        }
    }

    canMove(direction) {
        for (let piece of this.pieces)
            if (!piece.canMove(direction))
                return false
        return true
    }

    move(direction) {
        let x = this.centerField.x + direction.x
        let y = this.centerField.y + direction.y
        this.lastMoveDirection = direction
        if (!this.canMove(direction)) return false
        this.setCenterField(x, y)
        this.movePieces(direction)
        return true
    }

    movePieces(direction) {
        const previousFields = this.pieces.map(piece => piece.field)
        this.board.isBatchUpdate = true

        let sortedPieces = [...this.pieces]
        if (direction == Direction.LEFT)
            sortedPieces.sort((a, b) => a.field.x - b.field.x)
        if (direction == Direction.RIGHT)
            sortedPieces.sort((a, b) => b.field.x - a.field.x)
        if (direction == Direction.DOWN)
            sortedPieces.sort((a, b) => a.field.y - b.field.y)
        if (direction == Direction.UP)
            sortedPieces.sort((a, b) => b.field.y - a.field.y)
        for (let piece of sortedPieces)
            piece.move(direction)

        this.board.isBatchUpdate = false
        this.reconcilePieceRendering(previousFields)
    }

    reconcilePieceRendering(previousFields) {
        // Clear only vacated fields after all piece positions are final.
        for (let field of previousFields) {
            if (field && !field.shapePiece) field.setColor(Color.NONE)
        }
        // Repaint current piece fields once (avoids interim black-frame flicker).
        for (let piece of this.pieces) {
            if (piece && piece.field) piece.field.setColor(piece.color)
        }
    }

    moveUntilStopped(direction) {
        if (this.movingInterval !== undefined) return
        this.board.blockInput = true
        this.board.game.stopInterval()
        this.movingInterval = setInterval(() => {
            if (!this.board.currentPill.canMove(direction)) {
                this.board.currentPill.place()
                clearInterval(this.movingInterval)
                this.board.game.startInterval()
                return
            }
            this.board.nextFrame()
        }, 17)
    }
}

class ShapePiece {
    constructor(shape, field, color = randomColor()) {
        this.shape = shape
        this.field = field
        this.color = color
        this.destroyed = false
        this.board = this.shape.board
        this.field.shapePiece = this
        this.field.setColor(this.color)
    }

    move(direction) {
        if (this.destroyed) return false
        let x = this.field.x + direction.x
        let y = this.field.y + direction.y
        if (!this.canMoveTo(x, y)) return false
        const previousField = this.field
        previousField.shapePiece = null
        this.field = this.board.fields[x][y]
        this.field.shapePiece = this
        if (!this.board.isBatchUpdate) {
            previousField.setColor(Color.NONE)
            this.field.setColor(this.color)
        }
        return true
    }

    setField(field) {
        if (this.destroyed) return false
        const previousField = this.field
        previousField.shapePiece = null
        this.field = field
        this.field.shapePiece = this
        if (!this.board.isBatchUpdate) {
            previousField.setColor(Color.NONE)
            this.field.setColor(this.color)
        }
    }

    place() {
        if (this.destroyed) return false
        this.board.fields[this.field.x][this.field.y].locked = true
        this.field.shapePiece = this
    }

    canMoveTo(x, y) {
        if (this.destroyed) return false
        if (this.board.outOfBounds(x, y)) return false
        if (this.board.fields[x][y].locked) return false
        return true
    }

    canMove(direction) {
        if (this.destroyed) return false
        if (this.field.locked) return false
        let x = this.field.x + direction.x
        let y = this.field.y + direction.y
        return this.canMoveTo(x, y)
    }
}
