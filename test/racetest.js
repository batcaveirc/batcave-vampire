const { Handshake } = require('../handshake.js');
let f=0; const c=(n,ok,d='')=>{if(!ok)f++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};
const S='shared-secret';

console.log('— the two-channel race that broke the emoji room —');
const h = new Handshake({ secret:S, peers:['Carmilla','Drusilla','Renfield'] });
// Carmilla joins #batcave AND the emoji room within milliseconds.
const n1 = h.challenge('Carmilla');
const n2 = h.challenge('Carmilla');
c('the second join does NOT issue a rival nonce', n2 === null, `got ${n2}`);
c('the first nonce is still the live one',
  h.verify('Carmilla', Handshake.answer(S, n1)) === true);

console.log('\n— a genuine impostor is still rejected —');
const h2 = new Handshake({ secret:S, peers:['Carmilla'] });
const n3 = h2.challenge('Carmilla');
c('wrong answer fails', h2.verify('Carmilla', Handshake.answer('wrong-key', n3)) === false);
// Deliberate: a wrong key is indistinguishable from a rotation, so the bot
// logs it but does NOT accuse anyone in the channel. Refusing ops is the
// security property; the announcement is cosmetic and once libelled our own bot.
c('an impostor is granted nothing', h2.pending.size === 0);

console.log('\n— rotation still tolerated —');
const h3 = new Handshake({ secret:'new', prevSecret:'old', peers:['Drusilla'] });
const n4 = h3.challenge('Drusilla');
c('a peer still holding the old key gets in',
  h3.verify('Drusilla', Handshake.answer('old', n4)) === true);

console.log('\n— a stale challenge does not block a fresh one forever —');
const h4 = new Handshake({ secret:S, peers:['Renfield'] });
h4.challenge('Renfield');
h4.pending.get('renfield').at = Date.now() - 999999;   // expire it
c('an expired in-flight challenge is replaced', h4.challenge('Renfield') !== null);

console.log(f?`\n${f} FAILED`:'\nALL PASS'); process.exit(f?1:0);
