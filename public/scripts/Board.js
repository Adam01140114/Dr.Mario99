"use strict"
import { Pill, Virus } from "./Shape.js"
import { Color, Direction, Rotation, DELAY } from "./components.js"


var pillnum = 1;
var second = 0;
// var realdamage = 0; // Moved to instance variable
// var localpoints = 0; // Moved to instance variable
var enemy = 0;
// var player = 1; // Moved to instance variable




// var falling = 0; // Moved to instance variable

// var spawn = 0; // Moved to instance variable



var pillx1 = 3;
var pillx2 = 4;


// var hurting1 = 0; // Moved to instance variables
// var hurting2 = 0; // Moved to instance variables
// var hurting3 = 0; // Moved to instance variables
// var hurting4 = 0; // Moved to instance variables


// var pilly = 15; // Moved to instance variables
// var pilly2 = 15; // Moved to instance variables
// var pilly3 = 15; // Moved to instance variables
// var pilly4 = 15; // Moved to instance variables

// undery values will be set dynamically based on player number

// var randy = 15; // Moved to instance variables
// var randy2 = 15; // Moved to instance variables
// var randy3 = 15; // Moved to instance variables
// var randy4 = 15; // Moved to instance variables

// var this.randx = 2; // Moved to instance variables
// var this.randx2 = 2; // Moved to instance variables
// var this.randx3 = 2; // Moved to instance variables
// var this.randx4 = 2; // Moved to instance variables

// var this.randcolor = 'bl'; // Moved to instance variables
// var this.randcolor2 = 'bl'; // Moved to instance variables
// var this.randcolor3 = 'bl'; // Moved to instance variables
// var this.randcolor4 = 'bl'; // Moved to instance variables


//import { io } from 'socket.io-client';
const socket = io(window.location.origin);


//alert(roomCode);


//flawless exc
function digitToImg(digit) {
    digit = parseInt(digit)
    const img = document.createElement("img")
    img.src = "./img/cyfry/" + digit + ".png"
    return img
}

class Board extends HTMLElement {
    constructor(game) {
        super()
        this.game = game
        this.fieldSize = 24
    }

    createGrid() {
        this.fields = []
        for (let x = 0; x < this.width; x++) {
            this.fields[x] = []
            for (let y = this.height - 1; y >= 0; y--)
                this.createNewField(x, y)
        }
    }

    createNewField(x, y) {
        const field = new Field(this, x, y)
        this.fields[x][y] = field
        this.append(field)
    }

    setStyles() {
        this.style.width = this.width * this.fieldSize + "px"
        this.style.height = this.height * this.fieldSize + "px"
    }

    outOfBounds(x, y) {
        if (x < 0 || x >= this.width) return true
        else if (y < 0 || y >= this.height) return true
        else return false
    }
}



export class PlayingBoard extends Board {
    constructor(game, level = 0, score = 0, playerNumber = 1) {
        console.log(`Player ${playerNumber}: PlayingBoard CONSTRUCTOR CALLED!`);
        super(game)
        this.playerNumber = playerNumber
        
        // Prevent multiple PlayingBoard instances for the same player
        if (window[`playingBoard${playerNumber}Created`]) {
            console.log(`PlayingBoard for Player ${playerNumber} already exists, skipping creation`);
            console.log(`Player ${playerNumber}: CONSTRUCTOR SKIPPED - damage listener will NOT be added!`);
            return;
        }
        window[`playingBoard${playerNumber}Created`] = true;
        
        console.log('Player', this.playerNumber, 'undery:', this.playerNumber === 1 ? 14 : 6)
        
        // Set player-specific undery values as instance variables
        this.undery = this.playerNumber === 1 ? 14 : 6;
        this.undery2 = this.playerNumber === 1 ? 14 : 6;
        this.undery3 = this.playerNumber === 1 ? 14 : 6;
        this.undery4 = this.playerNumber === 1 ? 14 : 6;
        
        // Initialize instance variables to avoid conflicts between players
        this.localpoints = 0;
        this.realdamage = 0;
        this.damageProcessed = false; // Flag to track if damage has been processed
        this.spawn = 0;
        this.falling = 0;
        this.hurting1 = 0;
        this.hurting2 = 0;
        this.hurting3 = 0;
        this.hurting4 = 0;
        this.randy = 15;
        this.randy2 = 15;
        this.randy3 = 15;
        this.randy4 = 15;
        this.randx = 2;
        this.randx2 = 2;
        this.randx3 = 2;
        this.randx4 = 2;
        this.randcolor = 'bl';
        this.randcolor2 = 'bl';
        this.randcolor3 = 'bl';
        this.randcolor4 = 'bl';
        this.pilly = 15;
        this.pilly2 = 15;
        this.pilly3 = 15;
        this.pilly4 = 15;
        
        this.throwingBoard = new ThrowingBoard(this.game, this, this.playerNumber);
		
        this.width = 8
        this.height = 17
        this.level = level
        this.score = score
        this.virusList = []
        this.game.append(this.throwingBoard)
        this.gameStarted = false; // Flag to track if game has started (viruses spawned)
        this.gameStartTime = Date.now(); // Track when game started
		
		
		this.virusPositions = [];
        socket.on('virusPositions', (positions) => {
            this.virusPositions = positions;
            this.spawnViruses(); // Call spawnViruses after receiving positions
        });
    }

    connectedCallback() {
        this.createGrid()
        this.setStyles()
        this.createKeyboardListeners()
        this.spawnViruses()
        this.initImageCounters()
		
		// Add damage listener to PlayingBoard instance
        console.log(`Player ${this.playerNumber}: REACHED DAMAGE LISTENER CODE!`);
        console.log(`Player ${this.playerNumber}: CHECKING DAMAGE LISTENER - isDamageListenerAdded: ${this.isDamageListenerAdded}`);
        if (!this.isDamageListenerAdded) {
            console.log(`Player ${this.playerNumber}: Adding damage listener to PlayingBoard instance`);
            this.isDamageListenerAdded = true;
            
            socket.on(`p${this.playerNumber}damage`, (data) => {
                console.log(`Player ${this.playerNumber}: DAMAGE EVENT RECEIVED!`);
                console.log(`Player ${this.playerNumber}: Raw damage data:`, data);
                console.log(`Player ${this.playerNumber}: Room code check - received: ${data.roomCode}, expected: ${roomCode}`);
                
                if (data.roomCode === roomCode) {
                    console.log(`Player ${this.playerNumber}: Room code matches! Processing damage...`);
                    console.log(`Player ${this.playerNumber}: Damage received: ${data[`p${this.playerNumber}damage`]}`);
                    const calculatedDamage = Math.floor(data[`p${this.playerNumber}damage`] / 4);
                    console.log(`Player ${this.playerNumber}: Calculated realdamage: ${calculatedDamage} (from ${data[`p${this.playerNumber}damage`]} / 4)`);
                    
                    if (calculatedDamage > 0) {
                        this.realdamage = calculatedDamage;
                        this.damageProcessed = false;
                        console.log(`Player ${this.playerNumber}: DAMAGE STORED - realdamage set to ${this.realdamage} in PlayingBoard`);
                        console.log(`Player ${this.playerNumber}: VERIFICATION - this.realdamage is now: ${this.realdamage}`);
                        console.log(`Player ${this.playerNumber}: DAMAGE STORED in PlayingBoard instance with playerNumber: ${this.playerNumber}`);
                        console.log(`Player ${this.playerNumber}: DAMAGE STORED in PlayingBoard instance ID: ${this.constructor.name}-${this.playerNumber}-${Date.now()}`);
                        console.log(`Player ${this.playerNumber}: DAMAGE STORED in PlayingBoard instance reference: ${this}`);
                    } else {
                        console.log(`Player ${this.playerNumber}: Ignoring 0 damage - keeping existing realdamage: ${this.realdamage}`);
                    }
                } else {
                    console.log(`Player ${this.playerNumber}: Room code mismatch! Ignoring damage event.`);
                }
            });
        } else {
            console.log(`Player ${this.playerNumber}: Damage listener already added, skipping...`);
        }
		
    }
	

    nextLevel() {
        this.level++
        for (let row of this.fields)
            for (let field of row)
                field.clear()
        this.spawnViruses()
        this.initImageCounters()
    }

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
        this.currentPill = new Pill(this, this.throwingBoard.currentPill.pieces[0].color, this.throwingBoard.currentPill.pieces[1].color)
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
		
		console.log('hello');
		
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


	hurt(realdamage = null) {
		

		//alert("spawning pill");
		const actualDamage = realdamage !== null ? realdamage : this.realdamage;
		console.log(`Player ${this.playerNumber}: HURT() METHOD CALLED!`);
		console.log(`Player ${this.playerNumber}: hurt() called - spawn: ${this.spawn}, realdamage: ${actualDamage}`);
		console.log(`Player ${this.playerNumber}: About to call spawnRandomDot()...`);
		this.spawnRandomDot();
			
			
			
		
					
						this.hurting1 = 1;
			
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
		
		//number of viruses
        this.virusCount = 5;
        this.maxVirusHeight = 5
        if (this.level >= 15) this.maxVirusHeight++
        if (this.level >= 17) this.maxVirusHeight++
        if (this.level >= 19) this.maxVirusHeight++
        let color

        // Use pre-generated virus positions
        for (let i = 0; i < this.virusCount; i++) {
			
			
			if (this.lastColor == Color.FIRST) color = Color.SECOND
            else if (this.lastColor == Color.SECOND) color = Color.THIRD
            else color = Color.FIRST
            //this.spawnVirus(color)
            this.lastColor = color
			
			
			
            const position = this.virusPositions[i];
            if (position) {
                const { x, y } = position;
				
				
                //const color = this.lastColor === Color.FIRST ? Color.SECOND : (this.lastColor === Color.SECOND ? Color.THIRD : Color.FIRST);
                this.virusList.push(new Virus(this, x, y, color));
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
	
	
	
    spawnRandomDot() {
        console.log(`Player ${this.playerNumber}: SPAWNRANDOMDOT() METHOD CALLED!`);
        console.log(`Player ${this.playerNumber}: spawnRandomDot() called`);
        let colors = ['yl', 'bl', 'br'];
        let availableX = [1, 2, 3, 4, 5, 6, 7];
        console.log(`Player ${this.playerNumber}: Available colors: ${colors.join(', ')}`);
        console.log(`Player ${this.playerNumber}: Available X positions: ${availableX.join(', ')}`);

        function getRandomX() {
            let randomIndex = Math.floor(Math.random() * availableX.length);
            return availableX.splice(randomIndex, 1)[0];
        }
	
	this.randy = 15;
	this.undery = 14;
	console.log(`Player ${this.playerNumber}: randy set to ${this.randy}, undery set to ${this.undery}`);
	
	this.randy2 = 15;
	this.undery2 = 14;
	
	this.randy3 = 15;
	this.undery3 = 14;
	
	this.randy4 = 15;
	this.undery4 = 14;
	
   

    this.randx = getRandomX();
    this.randcolor = colors[Math.floor(Math.random() * colors.length)];
    console.log(`Player ${this.playerNumber}: VIRUS SPAWNING ATTEMPT!`);
    console.log(`Player ${this.playerNumber}: Spawning virus at position (${this.randx}, ${this.randy}) with color ${this.randcolor}`);
    console.log(`Player ${this.playerNumber}: Board dimensions - width: ${this.width}, height: ${this.height}`);
    console.log(`Player ${this.playerNumber}: Field exists check - fields[${this.randx}][${this.randy}] exists: ${this.fields[this.randx] && this.fields[this.randx][this.randy] ? 'YES' : 'NO'}`);
    console.log(`Player ${this.playerNumber}: About to call setColor() on field...`);
    this.fields[this.randx][this.randy].setColor(this.randcolor);
    console.log(`Player ${this.playerNumber}: VIRUS SPAWNED SUCCESSFULLY!`);
    console.log(`Player ${this.playerNumber}: Virus spawned successfully`);
    
	
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
			
			
			//console.log('pilly: '+ this.pilly + ' randy: ' + this.randy + " hurting: " + hurting);
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
            console.log(`Player ${this.playerNumber}: Clearing ${fieldsToClear.length} fields`);
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
   clearAnimated() {
    console.log(`Player ${this.board.playerNumber}: clearAnimated() called`);
    const x = this.shapePiece.shape instanceof Virus;
    const o = this.shapePiece.shape instanceof Pill;
    const color = this.shapePiece.color; // Assuming this.shapePiece.color contains values like Color.FIRST, etc.
    this.clear();
                if (x) {
                    this.board.localpoints += 1;
                    console.log(`Player ${this.board.playerNumber}: Virus cleared, points: ${this.board.localpoints}`);
                    this.style.backgroundImage = "url('./img/" + color + "_x.png')";
                }
                if (o) {
                    this.board.localpoints += 1;
                    console.log(`Player ${this.board.playerNumber}: Pill cleared, points: ${this.board.localpoints}`);
                    this.style.backgroundImage = "url('./img/" + color + "_o.png')";
                }
    
    // Alert when 4 in a row is cleared
    if (this.board.localpoints >= 4) {
        console.log(`Player ${this.board.playerNumber}: 4 in a row cleared! Points: ${this.board.localpoints}`);
        console.log(`Player ${this.board.playerNumber}: DAMAGE SHOULD BE SENT NOW!`);
        
        // Send damage immediately when 4+ points are reached
        console.log(`Player ${this.board.playerNumber}: Sending damage to opponent...`);
        socket.emit(`updatePoints${this.board.playerNumber === 1 ? 2 : 1}`, { 
            [`player${this.board.playerNumber === 1 ? 2 : 1}points`]: this.board.localpoints, 
            roomCode: roomCode 
        });
        console.log(`Player ${this.board.playerNumber}: Damage sent! Points: ${this.board.localpoints}, Target: Player ${this.board.playerNumber === 1 ? 2 : 1}`);
        
        // Reset points after sending damage
        this.board.localpoints = 0;
        console.log(`Player ${this.board.playerNumber}: Points reset to 0 after sending damage`);
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
        console.log(`Player ${this.playerNumber}: ThrowingBoard created, referencing PlayingBoard instance with playerNumber: ${this.playingBoard.playerNumber}`);
        console.log(`Player ${this.playerNumber}: ThrowingBoard PlayingBoard reference: ${this.playingBoard === this.playingBoard ? 'SAME' : 'DIFFERENT'}`);
        
        // Prevent multiple ThrowingBoard instances
        if (window[`throwingBoard${playerNumber}Created`]) {
            console.log(`Player ${this.playerNumber}: ThrowingBoard already exists, skipping creation`);
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
        this.currentPill = new Pill(this)
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
	
    setFrames() {
        console.log(`Player ${this.playerNumber}: setFrames() METHOD CALLED!`);
        this.currentFrame = 0
        this.frames = [
            {
				
                action: (pill) => {
                    pill.rotate(Direction.LEFT)
					console.log('new pill');
					
					pillx1 = 3;
					pillx2 = 4;
					this.pilly = 15;
					this.pilly2 = 15;


					// When sending points update
					console.log(`Player ${this.playerNumber}: setFrames() - Sending points update. Current localpoints: ${this.localpoints}`);
					socket.emit(`updatePoints${this.playerNumber === 1 ? 2 : 1}`, { [`player${this.playerNumber === 1 ? 2 : 1}points`]: this.localpoints, roomCode: roomCode });
					console.log(`Player ${this.playerNumber}: setFrames() - Points update sent to Player ${this.playerNumber === 1 ? 2 : 1}`);

					this.localpoints = 0;
					console.log(`Player ${this.playerNumber}: setFrames() - Points reset to 0`);
					console.log(`Player ${this.playerNumber}: setFrames() - CHECKING DAMAGE - this.playingBoard.realdamage = ${this.playingBoard.realdamage}`);
					console.log(`Player ${this.playerNumber}: setFrames() - damageProcessed flag = ${this.playingBoard.damageProcessed}`);
					console.log(`Player ${this.playerNumber}: setFrames() - PlayingBoard instance playerNumber: ${this.playingBoard.playerNumber}`);
					console.log(`Player ${this.playerNumber}: setFrames() - PlayingBoard instance ID: ${this.playingBoard.constructor.name}-${this.playingBoard.playerNumber}-${Date.now()}`);
					console.log(`Player ${this.playerNumber}: setFrames() - PlayingBoard instance reference: ${this.playingBoard}`);
					console.log(`Player ${this.playerNumber}: setFrames() - VERIFICATION: this.playingBoard === this.playingBoard: ${this.playingBoard === this.playingBoard}`);
					console.log(`Player ${this.playerNumber}: setFrames() - CRITICAL CHECK: Is this the same PlayingBoard that stored damage?`);
					if(this.playingBoard.realdamage > 0 && !this.playingBoard.damageProcessed){
					// Only send one virus regardless of damage amount
					console.log(`Player ${this.playerNumber}: setFrames() - DAMAGE FOUND! Calling hurt() with realdamage: ${this.playingBoard.realdamage}`);
					console.log(`Player ${this.playerNumber}: setFrames() - hurt - damage limited to 1 virus`);
					this.playingBoard.hurt(this.playingBoard.realdamage);
					this.spawn = this.spawn + 1;
					this.playingBoard.damageProcessed = true; // Mark damage as processed
					this.playingBoard.realdamage = 0
					console.log(`Player ${this.playerNumber}: setFrames() - reset real damage and marked as processed`);
					} else if (this.playingBoard.realdamage > 0 && this.playingBoard.damageProcessed) {
					console.log(`Player ${this.playerNumber}: setFrames() - Damage already processed, skipping`);
					} else {
					console.log(`Player ${this.playerNumber}: setFrames() - No real damage to send (realdamage: ${this.playingBoard.realdamage})`);
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