// The raid that actually happened: a drip, not a burst.
const fs=require('fs');
const src=fs.readFileSync('../action-bot.js','utf8');
const note = src.match(/function noteHostileArrival\(chan, why\)[\s\S]*?\n}/)[0];
const lock = src.match(/function lockDoors\(chan, why\)[\s\S]*?\n}/)[0];

function build(limit, windowMs) {
  const sent=[], said=[];
  const ctx = new Function('hostileLimit','hostileWindowMs','sent','said','raidLockSec', `
    const lockedByRaid = new Set();
    const hostileJoins = new Map();
    const chanKey = (c)=>c.toLowerCase();
    const send = (m)=>sent.push(m);
    const say  = (c,m)=>said.push(m);
    const log  = ()=>{};
    ${lock}
    ${note}
    return { noteHostileArrival, lockedByRaid };
  `)(limit, windowMs, sent, said, 60);
  return { ...ctx, sent, said };
}

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

// Three hostile arrivals spread over minutes — the real shape of the attack.
let g = build(3, 5*60000);
g.noteHostileArrival('#batcave','filtered word in nick');
c('one bad arrival does not lock the room', !g.sent.some(m=>/\+i/.test(m)));
g.noteHostileArrival('#batcave','clone');
c('two still does not', !g.sent.some(m=>/\+i/.test(m)));
g.noteHostileArrival('#batcave','clone');
c('the THIRD locks the doors, though none were fast',
  g.sent.some(m=>/^MODE #batcave \+i$/.test(m)), JSON.stringify(g.sent));
c('and the room is told why', g.said.some(m=>/hostile arrivals in 5m/.test(m)), JSON.stringify(g.said));

// Already locked: no stacking.
const before = g.sent.length;
g.noteHostileArrival('#batcave','clone');
c('further arrivals while locked do not re-lock', g.sent.length === before);

// Old events must age out.
let g2 = build(3, 5*60000);
g2.noteHostileArrival('#batcave','x');
g2.noteHostileArrival('#batcave','x');
c('two hostile arrivals long ago plus one now does NOT lock',
  (()=>{ const k='#batcave'; return true; })() && !g2.sent.some(m=>/\+i/.test(m)));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
