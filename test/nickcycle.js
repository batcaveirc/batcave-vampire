'use strict';
// The shuffled rotation cycle: a name must not repeat until every name in the
// pool has been used — the owner's "dont go back to the previous one till the
// rotation is over". Extracts nextInCycle from action-bot.js and drives it the
// way rotation does (each pick becomes the current nick), then checks coverage.
const fs = require('fs');
const path = require('path');

let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const fn = src.slice(src.indexOf('function nextInCycle('),
                     src.indexOf('\n}\n', src.indexOf('function nextInCycle(')) + 2);

// Harness: inject the globals nextInCycle closes over.
const POOL = ['Nosferatu', 'Orlok', 'Alucard', 'Strigoi', 'Moroi', 'Upir', 'Dhampir'];
const harness = new Function('state', `
    let currentNick = state.currentNick;
    let rotationQueue = state.rotationQueue;
    const unusableNames = state.unusableNames;
    const nameBank = () => state.pool;
    Object.defineProperty(globalThis, '_cn', { get: () => currentNick, set: (v) => { currentNick = v; }, configurable: true });
    ${fn}
    return { pick() { return nextInCycle(); }, set cur(v) { currentNick = v; } };
`);

function run(pool, current) {
    const h = harness({ currentNick: current, rotationQueue: [], unusableNames: new Set(), pool });
    return h;
}

console.log('— one full cycle uses every name exactly once —');
let h = run(POOL, 'DarkCloud');
const seen = [];
for (let i = 0; i < POOL.length; i++) {
    const n = h.pick();
    seen.push(n);
    h.cur = n;                       // rotation sets currentNick to the pick
}
c('every pick is a real pool name', seen.every((n) => POOL.includes(n)), JSON.stringify(seen));
c('no name repeats within the cycle', new Set(seen).size === seen.length, JSON.stringify(seen));
c('the whole pool is covered before any repeat',
  new Set(seen).size === POOL.length, `${new Set(seen).size}/${POOL.length}: ${seen}`);

console.log('\n— the next cycle is a fresh shuffle, still no repeats within it —');
const seen2 = [];
for (let i = 0; i < POOL.length; i++) { const n = h.pick(); seen2.push(n); h.cur = n; }
c('second cycle also covers the whole pool', new Set(seen2).size === POOL.length, JSON.stringify(seen2));
c('and it is shuffled independently (order differs from the first, usually)',
  seen.join() !== seen2.join() || POOL.length <= 2,
  'same order twice is possible but unlikely; not a hard failure');

console.log('\n— a struck-off (unusable) name never appears —');
const h3 = harness({ currentNick: 'DarkCloud', rotationQueue: [], unusableNames: new Set(['orlok']), pool: POOL });
const picks = [];
for (let i = 0; i < 12; i++) { const n = h3.pick(); picks.push(n); h3.cur = n; }
c('an unusable name is skipped every time', !picks.map((x) => x.toLowerCase()).includes('orlok'), JSON.stringify(picks));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
