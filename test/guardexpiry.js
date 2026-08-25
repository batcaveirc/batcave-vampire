// The exact bug the owner hit: a 10-minute grant that never ended.
const { Guardian } = require('../guardian.js');
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

const g = new Guardian({ minutes: 10 });
g.grant('#batcave','vikram');

// At the instant the timer fires, `now` has reached `until`.
c('isActive() is already FALSE when the timer fires — the trap',
  g.isActive('#batcave','vikram') === true);           // still true a moment early
const key = '#batcave|vikram';
g.active.get(key).until = Date.now();                   // simulate: expiry reached
c('  …and now isActive() is false', g.isActive('#batcave','vikram') === false);
c('but owes() is still TRUE, so the de-op still happens',
  g.owes('#batcave','vikram') === true);
c('due() reports it as ready to revoke',
  JSON.stringify(g.due()) === JSON.stringify([['#batcave','vikram']]), JSON.stringify(g.due()));

g.release('#batcave','vikram');
c('after release it owes nothing', g.owes('#batcave','vikram') === false);
c('and due() is empty', g.due().length === 0);

// A grant that has NOT expired must not be swept.
const g2 = new Guardian({ minutes: 10 });
g2.grant('#batcave','nessie');
c('a live grant is not swept early', g2.due().length === 0, JSON.stringify(g2.due()));

// Nicks containing the separator must not break key parsing.
const g3 = new Guardian({ minutes: 10 });
g3.grant('#batcave','odd|nick');
g3.active.get('#batcave|odd|nick').until = Date.now() - 1;   // expired
c('a nick containing "|" still parses back correctly',
  JSON.stringify(g3.due()) === JSON.stringify([['#batcave','odd|nick']]), JSON.stringify(g3.due()));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
