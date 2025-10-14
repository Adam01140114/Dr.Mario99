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
let numberPosition = 1;  // Position in the shared color list
let number;              // Current color value
let myRandomList = [];   // Shared color list from server

/**
 * Global tracker to monitor myRandomList changes
 * Helps debug synchronization issues between players
 */
window.trackMyRandomList = function() {
    console.log('🔍 GLOBAL TRACKER - myRandomList changed to:', myRandomList.slice(0, 10));
    console.log('🔍 GLOBAL TRACKER - myRandomList length:', myRandomList.length);
    console.log('🔍 GLOBAL TRACKER - myRandomList reference:', myRandomList);
};

/**
 * Multiple script instance detection
 * Prevents duplicate loading that could cause synchronization issues
 */
if (window.shapeScriptLoaded) {
    console.log('🚨 WARNING: Shape.js already loaded! Multiple instances detected!');
} else {
    window.shapeScriptLoaded = true;
    console.log('✅ Shape.js loaded for the first time');
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
socket.emit('requestNewGameData');
socket.on('receiveNewGameData', (gameData) => {
    console.log('🟢 CLIENT: Received new game data:', gameData);
    console.log('🟢 CLIENT: BEFORE assignment - myRandomList:', myRandomList);
    console.log('🟢 CLIENT: BEFORE assignment - gameData.randomList:', gameData.randomList);
    
    /**
     * CRITICAL: Create a DEEP COPY to prevent mutation
     * This ensures both players have independent copies of the color list
     * and prevents one player from affecting the other's list
     */
    myRandomList = [...gameData.randomList];
    window.trackMyRandomList(); // Track the change
    
    console.log('🟢 CLIENT: AFTER assignment - myRandomList:', myRandomList);
    console.log('🟢 CLIENT: VERIFICATION - myRandomList === gameData.randomList:', myRandomList === gameData.randomList);
    console.log('🟢 CLIENT: VERIFICATION - myRandomList[0]:', myRandomList[0], 'gameData.randomList[0]:', gameData.randomList[0]);
    
    // Reset pill color position for new game to ensure synchronization
    numberPosition = 1;
    console.log('🟢 CLIENT: Reset pill color position to 1 for new game');
    console.log(`🟢 CLIENT: Using shared pill color list with ${myRandomList.length} colors:`, myRandomList.slice(0, 20));
    console.log(`🟢 CLIENT: Full pill color list:`, myRandomList);
    
    // Update virus positions in the board
    if (window.currentPlayingBoard) {
        window.currentPlayingBoard.virusPositions = gameData.virusPositions;
        console.log('🟢 CLIENT: Updated virus positions for new game:', gameData.virusPositions);
    }
});

// DISABLED: Old system conflicts with new shared system
// socket.emit('requestRandomList');
// socket.on('receiveRandomList', (receivedList) => {
// 	console.log('🟢 CLIENT: OLD SYSTEM - received random list:', receivedList);
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
    console.log(`🟠 updateNumber() called - numberPosition: ${numberPosition}, myRandomList.length: ${myRandomList.length}`);
    console.log(`🟠 updateNumber() - myRandomList BEFORE access:`, myRandomList.slice(0, 10));
    
    // Check if position is within bounds
    if (numberPosition > 0 && numberPosition <= myRandomList.length) {
        // Get the color value at the current position
        number = myRandomList[numberPosition - 1];
        console.log(`🟠 updateNumber() - got number: ${number} from myRandomList[${numberPosition - 1}]`);
        console.log(`🟠 updateNumber() - myRandomList AFTER access:`, myRandomList.slice(0, 10));
        
        // Advance to next position
		numberPosition = numberPosition + 1;
		
		// Loop back to start when reaching end of list
		if(numberPosition > 100){ // Updated to match new list size
			numberPosition = 1;
		}
		console.log(`🟠 updateNumber() - new numberPosition: ${numberPosition}`);
		
    } else {
        console.log(`🟠 updateNumber() - numberPosition out of bounds: ${numberPosition}`);
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
	// If myRandomList is empty (before server data is received), wait for server data
	if (myRandomList.length === 0) {
		console.log(`🟡 randomColor() - waiting for server data, using default blue`);
		return Color.FIRST; // Default to blue while waiting for server data
	}
	
	// Use the server-provided shared random list
	updateNumber(); 
	pill = number;
	
	console.log(`🟡 randomColor() called - numberPosition: ${numberPosition}, pill: ${pill}, myRandomList[${numberPosition-1}]: ${myRandomList[numberPosition-1]}`);
	console.log(`🟡 randomColor() - current myRandomList:`, myRandomList.slice(0, 10), '...');

	// Map number values to color constants
	if(pill == 0){	
		console.log(`🟡 randomColor() returning Color.FIRST (bl/blue)`);
		return Color.FIRST
	}
	
	if(pill == 1){	
		console.log(`🟡 randomColor() returning Color.SECOND (br/brown)`);
		return Color.SECOND
	}
	
	if(pill == 2){	
		console.log(`🟡 randomColor() returning Color.THIRD (yl/yellow)`);
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
            console.log('Warning: Right field is out of bounds, using center field instead');
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
            console.log('Warning: centerField is undefined in fieldTo method');
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
        this.field.shapePiece = null
        this.field.setColor(Color.NONE)
        this.field = this.board.fields[x][y]
        this.field.shapePiece = this
        this.field.setColor(this.color)
        return true
    }

    setField(field) {
        if (this.destroyed) return false
        this.field.shapePiece = null
        this.field.setColor(Color.NONE)
        this.field = field
        this.field.shapePiece = this
        this.field.setColor(this.color)
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


