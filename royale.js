/**
 * DR. MARIO 99 - FREE PLAY'S 100-PLAYER MATCH: THE OPPONENTS
 * ==========================================================
 *
 * Real players who press FREE PLAY together share a match; the rest of the 100
 * seats are filled with these. A phone couldn't run 99 boards, so they aren't
 * boards: each is a few numbers on the server. Its stack creeps up as it makes
 * mistakes, faster as the match goes on; each attack it sends means it cleared
 * something (the stack drops); each attack it takes pushes the stack up; at
 * the top of the bottle it's out. A better player (skill) slips less and attacks
 * more. Nothing here knows about sockets, so tools/royale-sim.js can run it alone.
 */

const SIZE = 100;
const STACK_TOP = 16;   // a stack this high is out
const HIT = 1.0;        // what one attack adds to a stack
const CLEAR = 0.7;      // what sending an attack takes off it

const FIRST = ['Maya', 'Jordan', 'Ethan', 'Sofia', 'Liam', 'Ava', 'Noah', 'Chloe', 'Lucas', 'Emma', 'Mateo', 'Zoe', 'Oliver', 'Mia',
    'Leo', 'Aria', 'Caleb', 'Nora', 'Isaac', 'Ruby', 'Dylan', 'Hana', 'Marcus', 'Elena', 'Theo', 'Priya', 'Owen', 'Lila', 'Andre', 'Kai',
    'Sam', 'Tessa', 'Jonah', 'Iris', 'Felix', 'Naomi', 'Hugo', 'Layla', 'Omar', 'Clara', 'Ravi', 'Greta', 'Diego', 'Yuki', 'Malik', 'Anya'];

const shuffled = list => {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
};

/** As many different ordinary player names as asked for, none of them in `taken` */
function names(count, taken = new Set()) {
    const out = [];
    const pool = shuffled(FIRST);
    while (out.length < count) {
        const first = pool[out.length % pool.length];
        const round = Math.floor(out.length / pool.length);
        const name = round === 0 ? first : first + (round === 1 ? Math.floor(Math.random() * 90 + 10) : '_' + Math.floor(Math.random() * 900 + 100));
        if (!taken.has(name) && !out.includes(name)) out.push(name);
        else pool.push(first + '_' + Math.floor(Math.random() * 9000 + 1000));
    }
    return out;
}

function newBot() {
    return { skill: Math.random(), stack: 1 + Math.random() * 2, nextAttack: 5 + Math.random() * 12 };
}

const attackGap = (bot, t) => (16 - 7 * bot.skill) / (1 + t / 300) * (0.7 + Math.random() * 0.6);

/**
 * dt seconds pass for one opponent, t seconds into the match.
 * Returns true if it sent an attack (the caller gives it to its target).
 */
function step(bot, t, dt) {
    bot.stack += (0.012 + 0.09 * (1 - bot.skill) * (1 - bot.skill)) * (1 + t / 200) * dt;
    if (t < bot.nextAttack) return false;
    bot.nextAttack = t + attackGap(bot, t);
    bot.stack = Math.max(0, bot.stack - CLEAR);
    return true;
}

const hit = bot => { bot.stack += HIT; };
const isOut = bot => bot.stack >= STACK_TOP;
const virusCount = bot => Math.max(1, Math.round(3 + bot.stack * 0.9));

module.exports = { SIZE, STACK_TOP, names, newBot, step, hit, isOut, virusCount };
