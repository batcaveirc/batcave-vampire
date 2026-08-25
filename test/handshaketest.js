const { Handshake } = require('../handshake.js');
const SECRET = 'a-shared-secret-only-the-bots-hold';
const H = () => new Handshake({ secret: SECRET, peers: ['Renfield'] });
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

console.log('— the real bot gets in —');
let h = H();
let nonce = h.challenge('Renfield');
c('a peer nick is challenged', !!nonce);
c('the right answer verifies', h.verify('Renfield', Handshake.answer(SECRET, nonce)));

console.log('— an impostor does not —');
h = H(); nonce = h.challenge('Renfield');
c('a wrong answer fails', !h.verify('Renfield', 'deadbeef'.repeat(4)));
h = H(); nonce = h.challenge('Renfield');
c('the WRONG SECRET fails', !h.verify('Renfield', Handshake.answer('guessed-secret', nonce)));
h = H(); nonce = h.challenge('Renfield');
c('an empty answer fails', !h.verify('Renfield', ''));
c('someone never challenged cannot verify', !H().verify('Renfield', 'anything'));

console.log('— replay and reuse —');
h = H(); nonce = h.challenge('Renfield');
const good = Handshake.answer(SECRET, nonce);
c('first use works', h.verify('Renfield', good));
c('the SAME answer replayed fails', !h.verify('Renfield', good));
h = H(); nonce = h.challenge('Renfield');
h.verify('Renfield', 'wrong');
c('a wrong guess consumes the nonce (no second try)', !h.verify('Renfield', Handshake.answer(SECRET, nonce)));

console.log('— nonces differ every time —');
h = H();
const seen = new Set();
// One nick gets ONE live nonce: a peer joining several channels fires several
// challenges at once, and issuing a rival nonce each time invalidated the
// answer to the first. Unpredictability is still what matters, so it is
// measured across nicks rather than across repeats of one.
for (let i=0;i<50;i++){ const x=h.challenge('Renfield'); if (x) seen.add(x); }
c('a nick in flight keeps ONE live nonce', seen.size === 1, `${seen.size}`);
const across = new Set();
const many = new Handshake({secret:'s', peers:Array.from({length:50},(_,i)=>`peer${i}`)});
for (let i=0;i<50;i++) across.add(many.challenge(`peer${i}`));
c('50 nicks produced 50 distinct nonces', across.size === 50, `${across.size}`);

console.log('— it must never trust by name alone —');
c('a non-peer nick is never challenged', H().challenge('randomuser') === null);
c('no secret configured means no recognition at all',
  new Handshake({peers:['Renfield']}).challenge('Renfield') === null);
const h2 = new Handshake({peers:['Renfield']});
c('and nothing verifies without one', !h2.verify('Renfield','anything'));

console.log('— expiry —');
h = H(); nonce = h.challenge('Renfield');
h.pending.get('renfield').at = Date.now() - 61000;
c('a minute-old challenge is dead', !h.verify('Renfield', Handshake.answer(SECRET, nonce)));

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
