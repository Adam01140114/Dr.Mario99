"use strict"
import { Pill, Virus } from "./Shape2.js"
import { Color, Direction, Rotation, DELAY } from "./components2.js"


var pillnum = 1;
var second = 0;
var realdamage = 0;
var localpoints = 0;
var enemy = 0;
var player = 2;
//import { io } from 'socket.io-client';
const socket = io('localhost:3000/');

function requestRandomNumber(max) {
    return new Promise((resolve) => {
        socket.emit('requestRandomNumber', max, (randomNumber) => {
            resolve(Math.floor(randomNumber * max));
        });
    });
}

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
    constructor(game, level = 0, score = 0) {
        super(game)
		this.throwingBoard = new ThrowingBoard(this.game, this);
		
        this.width = 8
        this.height = 17
        this.level = level
        this.score = score
        this.virusList = []
        this.game.append(this.throwingBoard)
		
		
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
            if (this.blockInput)
                return
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


	hurt() {
        this.virusCount = 1
        this.maxVirusHeight = 10
        if (this.level >= 15) this.maxVirusHeight++
        if (this.level >= 17) this.maxVirusHeight++
        if (this.level >= 19) this.maxVirusHeight++
        let color
        for (let i = 0; i < this.virusCount; i++) {
            if (this.lastColor == Color.FIRST) color = Color.SECOND
            else if (this.lastColor == Color.SECOND) color = Color.THIRD
            else color = Color.FIRST
            this.spawnVirus(color)
            this.lastColor = color
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
        this.virusCount = this.level * 4 + 4;
        this.maxVirusHeight = 10
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
    }
	
	
	
		
		
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	

	
	

    movementFromKey(key) {
        if (this.blockInput)
            return
        if (!this.currentPill || this.currentPill.placed)
            return
        if (key == "ArrowLeft" || key == 'a')
            this.currentPill.move(Direction.LEFT)
        if (key == "ArrowRight" || key == 'd')
            this.currentPill.move(Direction.RIGHT)
        if (key == "ArrowDown" || key == 's')
            this.currentPill.moveUntilStopped(Direction.DOWN)
        if (key == "ArrowUp" || key == 'w')
            this.currentPill.rotate(Direction.LEFT)
        if (key == "Shift")
            this.currentPill.rotate(Direction.RIGHT)
    }

    nextFrame() {
        if (this.currentPill) {
            let moved = this.currentPill.move(Direction.DOWN)
            if (!moved) {
                this.blockInput = true
                this.currentPill.place()
                this.clearIfNeeded()
                this.useGravitation()
                if (this.gameOver()) return
                if (this.stageCompleted()) return
            }
        }
    }

    stageCompleted() {
        return this.virusCount <= 0
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
        if (fieldsToClear.length > 0)
            for (let field of fieldsToClear)
                field.clearAnimated()
    }

    useGravitation() {
        if (this.gravitationInterval) return
        this.gravitationInterval = setInterval(() => {
            let moved = false
            for (let y = 0; y < this.height; y++) {
                for (let x = 0; x < this.width; x++) {
                    const field = this.fields[x][y]
                    if (field.isTaken()) {
                        if (field.locked) {
                            let shape = field.shapePiece.shape
                            if (shape instanceof Pill) {
                                for (let piece of shape.pieces) {
                                    piece.field.locked = false
                                    piece.field.setColor(Color.NONE)
                                }
                                if (shape.move(Direction.DOWN)) {
                                    moved = true
                                }
                                for (let piece of shape.pieces) {
                                    piece.field.locked = true
                                    piece.field.setColor(piece.color)
                                }
                            }
                        }
                    }
                }
            }

            if (!moved) {
                this.clearIfNeeded()
                clearInterval(this.gravitationInterval)
                this.gravitationInterval = null
                for (let line of this.fields)
                    for (let field of line)
                        if (field.shouldBeCleared())
                            return
                this.spawnPill()
				
            }
        }, DELAY.gravitation)
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
    const x = this.shapePiece.shape instanceof Virus;
    const o = this.shapePiece.shape instanceof Pill;
    const color = this.shapePiece.color; // Assuming this.shapePiece.color contains values like Color.FIRST, etc.
    this.clear();
    if (x)
        this.style.backgroundImage = "url('./img/" + color + "_x.png')";
    if (o)
		
        this.style.backgroundImage = "url('./img/" + color + "_o.png')";
		console.log('point aquired');
		localpoints = localpoints + 1;
    setTimeout(() => {
        this.setColor(Color.NONE);
    }, DELAY.oxDisappear);
}


    clear() {
        this.locked = false
        this.setColor(Color.NONE)
        this.shapePiece.shape.pieces = this.shapePiece.shape.pieces.filter(piece => piece != this.shapePiece)
        for (let piece of this.shapePiece.shape.pieces)
            piece.field.setColor()
        if (this.shapePiece.shape instanceof Virus) {
            this.board.game.dancingViruses.lay(this.shapePiece.color)
            this.board.increaseScore()
            this.board.decreaseVirusCount()
        }
        this.shapePiece.destroyed = true
        this.shapePiece.field = true
        this.shapePiece = null
    }

    shouldBeCleared(selfColor = this.getColor()) {
        let horizontal = 0
        let vertical = 0
        for (let i = 1; i <= 7; i++) {
            if (this.x + i >= this.board.width) break
            if (selfColor != this.board.fields[this.x + i][this.y].getColor()) break
            horizontal++
        }
        for (let i = 1; i <= 7; i++) {
            if (this.x - i < 0) break
            if (selfColor != this.board.fields[this.x - i][this.y].getColor()) break
            horizontal++
        }
        for (let i = 1; i <= 15; i++) {
            if (this.y + i >= this.board.height) break
            if (selfColor != this.board.fields[this.x][this.y + i].getColor()) break
            vertical++
        }
        for (let i = 1; i <= 15; i++) {
            if (this.y - i < 0) break
            if (selfColor != this.board.fields[this.x][this.y - i].getColor()) break
            vertical++
        }
        if (selfColor == Color.NONE)
            return false
        else if (vertical >= 3 || horizontal >= 3)
            return true
        else
            return false
    }

    setColor(color = this.color) {
        this.color = color
        if (color == Color.NONE)
            this.style.backgroundImage = ""
        else {
            this.style.backgroundImage = "url('./img/" + color + "_dot.png')"
            if (this.shapePiece && !(this.shapePiece.shape instanceof Virus)) {
                const shape = this.shapePiece.shape
                if (shape.pieces && shape.pieces.length == 2) {
                    switch (shape.rotation) {
                        case Rotation.HORIZONTAL:
                            shape.pieces[0].field.setPillElement('left')
                            shape.pieces[1].field.setPillElement('right')
                            break
                        case Rotation.VERTICAL:
                            shape.pieces[0].field.setPillElement('down')
                            shape.pieces[1].field.setPillElement('up')
                            break
                        case Rotation.HORIZONTAL_REVERSED:
                            shape.pieces[1].field.setPillElement('left')
                            shape.pieces[0].field.setPillElement('right')
                            break
                        case Rotation.VERTICAL_REVERSED:
                            shape.pieces[1].field.setPillElement('down')
                            shape.pieces[0].field.setPillElement('up')
                            break
                    }
                }
            }
            if (this.shapePiece) {
                if (this.shapePiece.shape instanceof Virus)
                    this.style.backgroundImage = "url('./img/" + color + "_covid.png')"
            }
        }
    }
	
	
	
	

    setPillElement(element) {
		
		
		//this.color = "yl"
		this.style.backgroundImage = "url('./img/" + this.color + "_" + element + ".png')"
		
		//console.log(this.color)
		//console.log(element)
		
		
    }
	
	
	
	
	

    getColor() {
        return this.color
    }
}



customElements.define("game-board-field", Field)








class ThrowingBoard extends Board {
    constructor(game, playingBoard) {
        super(game)
		this.playingBoard = playingBoard;
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
		console.log('hey there');
		
		
		if (!this.isDamageListenerAdded) {
            socket.on('p2damage', (data) => {
				console.log(`Damage received: ${data.p2damage}`);
				realdamage = Math.floor(data.p2damage / 4);
				//console.log(realdamage);
			});
        this.isDamageListenerAdded = true;

        }
		
    }
	
	
	
	
    setFrames() {
        this.currentFrame = 0
        this.frames = [
            {
				
                action: (pill) => {
                    pill.rotate(Direction.LEFT)
					console.log('new pill');
					socket.emit('updatePoints1', { player2points: localpoints });
					localpoints = 0;
					if(realdamage > 0){
					for (let i = 0; i < realdamage; i++) {
						console.log('hurt');
						this.playingBoard.hurt();
					}
					realdamage = 0
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




	
	
	
	
	
	//finally dude
    

    nextFrame() {
		
	
        if (this.currentFrame >= this.frames.length - 1) {
            this.game.board.movePillFromThrowingBoard()
            this.game.board.blockInput = false
            return
        }
        const data = this.frames[this.currentFrame++]
        data.action(this.currentPill, this)
    }
}

customElements.define("throwing-board", ThrowingBoard)