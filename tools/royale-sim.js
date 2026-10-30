#!/usr/bin/env node
// How long a 100-player Free Play lasts: runs the opponents alone (royale.js), many times
const royale = require('../royale');
const runs = parseInt(process.argv[2], 10) || 200;
const marks = [75, 50, 25, 10, 2, 1];
const at = Object.fromEntries(marks.map(m => [m, []]));
for (let r = 0; r < runs; r++) {
    let alive = Array.from({ length: royale.SIZE }, () => royale.newBot());
    for (let t = 1; alive.length > 1 && t < 3600; t++) {
        alive.forEach((bot, i) => { if (royale.step(bot, t, 1)) royale.hit(alive[(i + 1) % alive.length]); });
        alive = alive.filter(bot => !royale.isOut(bot));
        for (const m of marks) if (alive.length <= m && at[m].length === r) at[m].push(t);
    }
    for (const m of marks) if (at[m].length === r) at[m].push(0);
}
const median = list => list.slice().sort((a, b) => a - b)[Math.floor(list.length / 2)];
for (const m of marks) console.log(String(m).padStart(3), 'left at', median(at[m]), 's  (range', Math.min(...at[m]), '-', Math.max(...at[m]) + ')');
