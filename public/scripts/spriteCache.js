"use strict"

const spriteCache = new Map()
const spriteLoadPromises = new Map()
let gameplayPreloadPromise = null

function toAbsoluteUrl(src) {
    try {
        return new URL(src, window.location.href).toString()
    } catch (_err) {
        return src
    }
}

export function getSpriteUrl(src) {
    return toAbsoluteUrl(src)
}

export function loadSprite(src) {
    const url = toAbsoluteUrl(src)
    if (spriteCache.has(url)) return Promise.resolve(spriteCache.get(url))
    if (spriteLoadPromises.has(url)) return spriteLoadPromises.get(url)

    const promise = new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = "async"
        img.onload = () => {
            spriteCache.set(url, img)
            spriteLoadPromises.delete(url)
            resolve(img)
        }
        img.onerror = (err) => {
            spriteLoadPromises.delete(url)
            reject(err)
        }
        img.src = url
    })

    spriteLoadPromises.set(url, promise)
    return promise
}

export function preloadSprites(sources) {
    const unique = [...new Set(sources.map(toAbsoluteUrl))]
    return Promise.allSettled(unique.map(loadSprite))
}

export function preloadGameplaySprites() {
    if (gameplayPreloadPromise) return gameplayPreloadPromise

    const colors = ["bl", "br", "yl"]
    const spriteKinds = ["dot", "covid", "left", "right", "up", "down", "x", "o"]
    const paths = []

    for (const color of colors) {
        for (const kind of spriteKinds) {
            paths.push(`./img/${color}_${kind}.png`)
        }
    }

    for (let digit = 0; digit <= 9; digit++) {
        paths.push(`./img/cyfry/${digit}.png`)
    }

    // Dancing virus animation frames
    for (const color of colors) {
        for (let frame = 1; frame <= 6; frame++) {
            paths.push(`./img/lupa/${color}/${frame}.png`)
        }
    }

    // Backgrounds, game over, stage complete
    for (let i = 0; i < 5; i++) {
        paths.push(`./img/bg${i}.png`, `./img/go${i}.png`, `./img/sc${i}.png`)
    }
    paths.push(`./img/go_dr.png`, `./img/logo.png`)

    // Throwing board hands
    paths.push(
        `./img/hands/up_1.png`, `./img/hands/up_2.png`, `./img/hands/up_3.png`,
        `./img/hands/middle11.png`, `./img/hands/middle12.png`,
        `./img/hands/middle21.png`, `./img/hands/middle22.png`,
        `./img/hands/down_1.png`, `./img/hands/down_2.png`
    )

    gameplayPreloadPromise = preloadSprites(paths).catch(() => [])
    return gameplayPreloadPromise
}

