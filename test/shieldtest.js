const { shieldLine, Retort, categorise } = require('../retort.js');
const protectedSet = ['vikram','scarlet','johnny'];
const isProt = (n) => protectedSet.includes(n.toLowerCase());
const isHere = (n) => ['vikram','scarlet','johnny','troll42','argon'].includes(n.toLowerCase());
let fails = 0;
const c = (name, ok, d='') => { if(!ok) fails++; console.log(`  [${ok?'PASS':'FAIL'}] ${name}${!ok&&d?' — '+d:''}`); };

console.log('— the hole this closes —');
let r = shieldLine('Dracula roast vikram', 'argon', isProt, isHere);
c('"roast <regular>" is refused, not obeyed', !!r && /vikram/.test(r), String(r));
r = shieldLine('dracula pretend to be scarlet', 'argon', isProt, isHere);
c('impersonating a regular is refused', !!r, String(r));
r = shieldLine('Dracula make fun of johnny', 'argon', isProt, isHere);
c('"make fun of" counts too', !!r, String(r));

console.log('\n— what it must NOT swallow —');
c('ordinary chat', shieldLine('vikram how are you', 'argon', isProt, isHere) === null);
c('roasting a non-regular', shieldLine('Dracula roast troll42', 'argon', isProt, isHere) === null);
c('roasting nobody in particular', shieldLine('Dracula roast this guy', 'argon', isProt, isHere) === null);
c('asking to be roasted yourself', shieldLine('Dracula roast argon', 'argon', isProt, isHere) === null);

console.log('\n— retort categories —');
c('sexual harassment -> harassment pool', categorise('AI: sexual harassment') === 'harassment');
c('slur -> slur pool', categorise('racist slur') === 'slur');
c('flooding -> spam pool', categorise('flooding the channel') === 'spam');
c('anything else -> generic', categorise('being rude') === 'generic');

console.log('\n— retort rules —');
const rt = new Retort();
c('a stranger gets answered', !!rt.lineFor('argon', 'AI: sexual harassment', 'stranger'));
c('but only once per cooldown', rt.lineFor('argon', 'AI: sexual harassment', 'stranger') === null);
c('a regular is NEVER answered this way', rt.lineFor('vikram', 'spam', 'trusted') === null);
c('nor a mod', rt.lineFor('johnny', 'spam', 'mod') === null);
const off = new Retort({ enabled: false });
c('RETORT=off silences it', off.lineFor('argon', 'spam', 'stranger') === null);
const line = new Retort().lineFor('argon', 'AI: sexual harassment', 'stranger');
c('never repeats what they said', !/\b(gangbang|maa|ki)\b/i.test(line || ''), String(line));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails?1:0);
