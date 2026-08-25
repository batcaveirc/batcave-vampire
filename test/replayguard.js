// The ShaZzu incident: nine flood warnings from one rejoin.
const fs = require('fs');
const src = fs.readFileSync('../action-bot.js','utf8');
const fn = src.match(/function isReplay\(tags\)[\s\S]*?\n}/)[0];
const build = (connectTime) => new Function('connectTime', fn + '; return isReplay;')(connectTime);

let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

// Fresh connect: backlog from 10 minutes ago must be recognised as replay.
let isReplay = build(Date.now());
c('a 10-minute-old backlog line is seen as replay', isReplay({time: iso(600000)}) === true);
c('a line from just now is live',                  isReplay({time: iso(500)}) === false);
c('an untagged line is treated as live',           isReplay({time: undefined}) === false);

// The bug: connectTime left at process start, hours before a reconnect.
const stale = build(Date.now() - 6*3600*1000);
c('WITH A STALE connectTime the same backlog reads as LIVE (the bug)',
  stale({time: iso(600000)}) === false);

// After the fix, connect() refreshes it, so the same line is caught.
const refreshed = build(Date.now());
c('after refreshing connectTime it is caught again',
  refreshed({time: iso(600000)}) === true);

// A burst of replayed lines, as the flood detector would have seen them.
const backlog = [9,8,7,6,5,4,3,2,1].map(m => ({time: iso(m*20000)}));
c('the whole replayed burst is filtered, so no flood is inferred',
  backlog.every(t => refreshed(t) === true), 'some lines leaked through');
c('and with the stale reference every one leaked (9 warnings)',
  backlog.every(t => stale(t) === false));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
