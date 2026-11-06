// Clapback — answering an attack on one of ours, in proportion.
//
// The thing this file is really guarding against is over-reaction. A bot that
// kicks over "shut up" is a bot nobody can joke around, and the regulars it is
// defending are the first to notice. So the tiers matter more than the lines:
// mild is a reply and nothing else, abuse goes through the ladder, and only a
// threat is removed on the spot.
const { Clapback, tierOf } = require('../clapback');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const ours = new Set(['hazel', 'vikram', 'darkcloud']);
const isProtected = (n) => ours.has(String(n).toLowerCase());

console.log('— severity is read from what was said —');
c('a mild insult is tier 1', tierOf('shut up hazel') === 1, String(tierOf('shut up hazel')));
c('a plain insult is tier 1', tierOf('hazel is an idiot') === 1);
c('abuse is tier 2', tierOf('hazel you bitch') === 2);
c('a threat is tier 3', tierOf('i will kill hazel') === 3);
c('an ordinary line is tier 0', tierOf('good morning hazel, how are you') === 0);
c('threat beats abuse when both appear', tierOf('shut up you bitch or i will kill you') === 3);

console.log('\n— it only answers attacks on a PROTECTED person —');
const cb = new Clapback({ random: () => 0, now: () => 1000 });
let hit = cb.check('hazel is an idiot', 'troll1', { isProtected });
c('an attack naming a regular is answered', !!hit, JSON.stringify(hit));
c('and names who was attacked', hit && hit.who === 'hazel', hit && hit.who);
c('with a reason the ladder can use', hit && hit.reason === 'attacking a regular', hit && hit.reason);
c('the reply does not contain the insult', hit && !/idiot/i.test(hit.line), hit && hit.line);

hit = cb.check('you are all idiots', 'troll2', { isProtected });
c('an insult aimed at nobody in particular is left to the ladder', hit === null);

hit = cb.check('hazel is an idiot', 'vikram', { isProtected });
c('one of ours is never answered', hit === null, 'regulars rib each other constantly');

hit = cb.check('hazel you bitch', 'troll1', { isProtected });
c('a second clapback at the same person waits (60s)', hit === null,
  'same nick, same minute — answer once, not once per message');

console.log('\n— the severity decides the consequence —');
const mk = () => new Clapback({ random: () => 0, now: () => 5000 });
c('mild asks for nothing', mk().check('shut up hazel', 't1', { isProtected }).tier === 1);
c('abuse asks for the ladder', mk().check('hazel you bitch', 't2', { isProtected }).tier === 2);
c('a threat asks for removal', mk().check('i will kill hazel', 't3', { isProtected }).tier === 3);

console.log('\n— the adult register is available only where it was switched on —');
const clean = mk().check('hazel is an idiot', 't4', { isProtected, nsfw: false });
const adult = mk().check('hazel is an idiot', 't5', { isProtected, nsfw: true });
c('a normal room gets a clean line', clean && !/\b(shit|fuck|bitch)\b/i.test(clean.line), clean && clean.line);
c('an adult room gets the harder register', adult && /\b(shit|fuck|bitch)\b/i.test(adult.line), adult && adult.line);
c('neither ever contains a slur the bot would kick for',
  [clean.line, adult.line].every((l) => !/chutiya|madarchod|bhosdi|randi/i.test(l)));

console.log('\n— the operator\'s severe list counts as abuse —');
c('a word on SEVERE_WORDS is tier 2 even without a regex hit',
  tierOf('hazel is such a frobnicator', new Set(['frobnicator'])) === 2,
  String(tierOf('hazel is such a frobnicator', new Set(['frobnicator']))));

console.log('\n— nick tokens are stripped and normalised —');
c('@hazel is recognised', !!mk().check('@hazel is an idiot', 't6', { isProtected }));
c('HAZEL is recognised', !!mk().check('HAZEL is an idiot', 't7', { isProtected }));
c('a nick inside a sentence is recognised', !!mk().check('honestly, hazel is an idiot', 't8', { isProtected }));

console.log('\n— switched off means switched off —');
c('enabled:false answers nothing',
  new Clapback({ enabled: false }).check('hazel is an idiot', 't9', { isProtected }) === null);

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
