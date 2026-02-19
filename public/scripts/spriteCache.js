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

    // Dancing virus animation frames used by Game.js
    for (const color of colors) {
        for (let frame = 1; frame <= 6; frame++) {
            paths.push(`./img/lupa/${color}/${frame}.png`)
        }
    }

    gameplayPreloadPromise = preloadSprites(paths).catch(() => [])
    return gameplayPreloadPromise
}

