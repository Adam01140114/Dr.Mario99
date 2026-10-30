/**
 * Tells the server this browser is here (analytics.js), for the player stats at
 * /stats: a random id kept on this device and where it came from. Needs `socket`.
 */
(() => {
    const read = key => { try { return localStorage.getItem(key) } catch (e) { return null } }
    let id = read('playerId')
    if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)
        try { localStorage.setItem('playerId', id) } catch (e) { /* counted anew each visit */ }
    }
    // A link's ?ref= (or utm_source), an invite, or the site that sent them here
    const params = new URLSearchParams(location.search)
    let src = params.get('ref') || params.get('utm_source')
    if (!src && params.get('party')) src = 'invite'
    if (!src && location.pathname.includes('controller')) src = 'tv-qr'
    if (!src && document.referrer) {
        try {
            const host = new URL(document.referrer).hostname.replace(/^www\./, '')
            if (host !== location.hostname) src = host
        } catch (e) { /* no usable referrer */ }
    }
    const hello = () => socket.emit('hello', {
        id,
        src: src || 'direct',
        phone: matchMedia('(pointer: coarse)').matches,
        lang: navigator.language,
        ignore: read('statsIgnore') === '1',
    })
    socket.on('connect', hello)
    if (socket.connected) hello()
})()
