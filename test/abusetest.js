// Severe abuse found WITHOUT a model, because cool mode is the normal state.
//
// The worst message of 2026-08-30 passed the word list and the model's verdict
// on it was discarded on punctuation, so the bot did nothing and the owner
// banned by hand — while the same model removed four newcomers for jokes that
// hour. With the model no longer acting, this layer is the protection.
const { severeAbuse } = require('../abuse.js');
let f = 0;
const c = (n, ok, d = '') => { if (!f && !ok) {} if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };
const present = (n) => ['vikram', 'libu', 'johnny'].includes(String(n).toLowerCase());

console.log('— the message that was missed —');
c('caught now', severeAbuse('Iski Gashti Maa ko pelte hai sab aur uski Nude fingering').severe);

console.log('\n— relational abuse, which a word list cannot see —');
// Every word here is innocent. The ORDER is the abuse.
for (const s of ['teri maa ki chut', 'behen ke lund', 'maa ka bhosda',
                 'chod di teri behen', 'maaki lodi', 'bhen ki gaand',
                 'teri maa ko pelunga'])
  c(`caught: ${s}`, severeAbuse(s).severe);

console.log('\n— real lines from these rooms that must stay untouched —');
// From the 40,264 recorded messages. A filter that removes people wrongly is
// worse than none, and this room has already been through that.
for (const s of ['Koi apni behen ki pic dikhaega??', 'Badi bhen koi',
                 'meri maa ka khana best hai', 'behen ki shaadi hai kal',
                 'maa ko bata diya', 'behen aa rahi hai station pe',
                 'aaahhh bc', 'Bc incidence k ke baad life bdal gaye',
                 'mummy ki yaad aa rahi hai'])
  c(`left alone: ${s.slice(0, 34)}`, !severeAbuse(s).severe);

console.log('\n— sexual language only counts when aimed at somebody here —');
c('aimed at a person present', severeAbuse('vikram send me your nudes', present).severe);
c('but not said in general', !severeAbuse('this site is full of nudes', present).severe,
  'crude in general is a different problem, and the room polices it');

console.log('\n— leetspeak is folded —');
c('m@@ k1 chut', severeAbuse('m@@ k1 chut').severe);

console.log('\n— an empty configuration cannot switch this off —');
// SEVERE_WORDS is a secret and an empty secret has silently meant "allow
// everything" in this project before. This layer is in code for that reason.
c('it needs no configuration at all', severeAbuse('teri maa ki chut').severe);

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
