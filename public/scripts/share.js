/**
 * Invite someone: the phone's share sheet, or the link copied on a computer. The ?ref= shows
 * who it brought in on the stats page (analytics.js).
 */
window.shareGame = async (ref, button) => {
    const url = `${location.origin}/?ref=${ref}`
    const text = 'Come play: a puzzle battle for up to 20 players. Free, no download.'
    const label = button.textContent
    try {
        if (navigator.share) return await navigator.share({ title: document.title, text, url })
        await navigator.clipboard.writeText(url)
        button.textContent = '✅ LINK COPIED'
    } catch (e) {
        if (e && e.name === 'AbortError') return // they closed the share sheet
        button.textContent = url
        return
    }
    setTimeout(() => { button.textContent = label }, 1800)
}
