"use strict"
import { PlayingBoard } from "./Board.js"
import { Color, DELAY } from "./components.js"


export default class Game extends HTMLElement {
    constructor(playerNumber = 1) {
        super()
        this.playerNumber = playerNumber
        console.log('Player Number:', this.playerNumber)
    }

    connectedCallback() {
        this.createBoard()
        this.setBg()
        this.createDancingViruses()
        this.startInterval()
        
        // Add socket listeners for multiplayer events
        this.setupSocketListeners()
    }

    setupSocketListeners() {
        // Listen for opponent game over (opponent lost, you won)
        socket.on('opponentGameOver', (data) => {
            console.log(`Player ${this.playerNumber}: Received opponentGameOver event`);
            console.log(`Player ${this.playerNumber}: Data:`, data);
            console.log(`Player ${this.playerNumber}: Room code check - received: ${data.roomCode}, expected: ${roomCode}`);
            console.log(`Player ${this.playerNumber}: Player number check - received: ${data.playerNumber}, expected: ${this.playerNumber === 1 ? 2 : 1}`);
            
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
            
            if (data.roomCode === roomCode && data.playerNumber === (this.playerNumber === 1 ? 2 : 1)) {
                console.log(`Player ${this.playerNumber}: Conditions met! Showing opponent win screen`);
                this.showOpponentWinScreen()
            } else {
                console.log(`Player ${this.playerNumber}: Conditions not met, ignoring event`);
            }
        });
    }

    createBoard(level, score) {
        this.board = new PlayingBoard(this, level, score, this.playerNumber)
        this.append(this.board)
    }
    createDancingViruses() {
        if (this.dancingViruses)
            this.dancingViruses.destroy()
        this.dancingViruses = new DancingViruses(this)
    }

    startInterval() {
        this.interval = setInterval(() => {
            this.board.nextFrame()
        }, DELAY.frame)
    }

    stopInterval() {
        clearInterval(this.interval)
    }

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

    setBg(level = this.board.level) {
        this.style.backgroundImage = "url('./img/bg" + level % 5 + ".png')"
    }
    getBgSrc(level) {
        return "./img/bg" + (level || this.board.level) % 5 + ".png"
    }
    getGoSrc() {
        return "./img/go" + this.board.level % 5 + ".png"
    }
    getScSrc() {
        return "./img/sc" + this.board.level % 5 + ".png"
    }

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

    returnToHomepage() {
        // Reload the page to return to homepage
        window.location.reload();
    }
}
customElements.define("game-element", Game)


const DancingMode = {
    NORMAL: 0,
    LAYING: 1,
    LAUGHING: 2,
    DEAD: 3,
}

class DancingViruses {
    constructor(game) {
        this.game = game
        this.list = [
            new DancingVirus(this.game, Color.THIRD, 0),
            new DancingVirus(this.game, Color.SECOND, 6),
            new DancingVirus(this.game, Color.FIRST, 12),
        ]
        this.appendToGame()
        this.startAnimation()
    }

    startAnimation() {
        setInterval(() => {
            if (this.anyVirusLaying()) return
            this.nextMove()
        }, 1000);
        setTimeout(() => {
            setInterval(() => {
                this.nextAnimation()
            }, 250);
        }, 125)
    }

    lay(color) {
        this.list.filter(el => el.color == color)[0].setMode(DancingMode.LAYING)
    }

    anyVirusLaying() {
        for (let virus of this.list)
            if (virus.mode == DancingMode.LAYING)
                return true
        return false
    }

    appendToGame() {
        for (let virus of this.list)
            this.game.append(virus)
    }

    nextMove() {
        for (let virus of this.list)
            virus.nextMove()
    }

    nextAnimation() {
        for (let virus of this.list)
            virus.nextAnimation()
    }

    nextAnimationLaying() {
        for (let virus of this.list)
            virus.nextAnimationLaying()
    }

    destroy() {
        for (let virus of this.list)
            virus.remove()
    }

    setMode(mode) {
        for (let virus of this.list)
            virus.setMode(mode)
    }
}

class DancingVirus extends HTMLElement {
    constructor(game, color, currentStep) {
        super()
        this.game = game
        this.color = color
        this.currentStep = currentStep
        this.currentAnimation = 0
        this.currentModeCount = 0
        this.mode = DancingMode.NORMAL
        this.animations = {
            0: [2, 1, 2, 3],
            1: [5, 6],
            2: [2, 4],
            3: [],
        }
        this.steps = [
            { x: 5, y: 0 },
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
            { x: 6, y: 1 },
        ]
    }

    connectedCallback() {
        this.display()
    }

    display() {
        this.style.left = 2 * 24 + this.getPosition().x * 24 + 'px'
        this.style.top = 14 * 24 + this.getPosition().y * 24 + 'px'
        this.style.backgroundImage = "url('" + this.getImage() + "')"
    }

    getPosition() {
        return this.steps[this.currentStep]
    }

    getImage() {
        if (this.mode == DancingMode.DEAD) return ''
        return "./img/lupa/" + this.color + "/" + this.animations[this.mode][this.currentAnimation] + ".png"
    }

    nextMove() {
        if (this.mode != DancingMode.NORMAL) return
        if (++this.currentStep == this.steps.length) this.currentStep = 0
        this.style.left = 2 * 24 + this.getPosition().x * 24 + 'px'
        this.style.top = 14 * 24 + this.getPosition().y * 24 + 'px'
    }

    nextAnimation() {
        this.currentModeCount++
        if (this.mode == DancingMode.LAYING && this.currentModeCount >= 10) {
            let anyVirusInColor = false
            for (let virus of this.game.board.virusList.filter(el => el.pieces.length != 0))
                if (virus.color == this.color)
                    anyVirusInColor = true
            if (anyVirusInColor)
                this.setMode(DancingMode.NORMAL)
            else
                this.setMode(DancingMode.DEAD)

            return
        }
        if (++this.currentAnimation == this.animations[this.mode].length) this.currentAnimation = 0
        this.style.backgroundImage = "url('" + this.getImage() + "')"
    }

    setMode(mode) {
        if (this.mode == DancingMode.DEAD && mode == DancingMode.LAUGHING) return
        this.mode = mode
        this.currentAnimation = 0
        this.currentModeCount = 0
        if (mode == DancingMode.LAYING)
            this.currentAnimationLaying = 0
    }
}

customElements.define("dancing-virus", DancingVirus)
