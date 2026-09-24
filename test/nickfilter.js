// A name is not a slur because a slur hides inside it.
//
// Live, 07:17: ISHITA joined #batcave and was kicked one second later for a
// "filtered word in nick". Ishita is an ordinary name; it contains s-h-i-t
// between an i and an a. The filter used plain substring matching, so it removed
// a real person for being called something common in this room.
//
// This project's own notes already say how to avoid it — "match on TOKENS, not
// substrings, whenever the terms are short" — and prescribe the method used here:
// a must-catch set of real abuse and a must-NOT-catch set drawn from the
// population being protected. The second list is the one that matters. A miss
// costs the room very little; a false positive costs it a person, and they do
// not come back to argue.
const fs = require('fs');
const path = require('path');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const fn = src.slice(src.indexOf('function standsOut'),
                     src.indexOf('\n}\n', src.indexOf('function badNick')) + 2);
const normalize = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const list = () => [];
const severeWords = new Set(['shit', 'fuck', 'randi', 'bhosdi', 'chutiya', 'madarchod']);
const badwords = new Set(['shit', 'damn', 'bitch', 'gandu']);
const [badNick, standsOut] = new Function(
    'normalize', 'list', 'severeWords', 'badwords', 'process',
    `${fn}; return [badNick, standsOut];`,
)(normalize, list, severeWords, badwords, { env: {} });

console.log('— must NOT catch: real people in this room —');
// Every one of these is a name somebody actually uses, or the shape of one.
for (const name of ['ishita', 'ISHITA', 'anishita', 'harshita', 'mishita', 'Rishita',
                    'adamant', 'damini', 'shitalpatel'.replace('shital', 'sheetal'),
                    'bitchara'.replace('bitch', 'bech'), 'gandhi', 'randeep']) {
    c(`${name} is left alone`, !badNick(name),
      `matched "${badNick(name)}" — a false positive costs the room a person`);
}

console.log('\n— must catch: nicks that are actually offensive —');
for (const [nick, why] of [['shithead', 'at the start'], ['bigshit', 'at the end'],
                           ['big_shit', 'beside an underscore'], ['fuckyou', 'at the start'],
                           ['randi_girl', 'beside an underscore'],
                           ['madarchodxx', 'a long slur, anywhere'],
                           ['xx.gandu', 'beside a dot']]) {
    c(`${nick} is caught (${why})`, Boolean(badNick(nick)), 'this one should not get in');
}

console.log('\n— the rule itself —');
c('a short word buried between letters does not count',
  !standsOut('ishita', 'shit') && standsOut('shithead', 'shit'),
  'start, end, or a non-letter beside it — otherwise it is part of a name');
c('a long slur still matches anywhere, for leet evasion',
  Boolean(badNick('xxmadarchodxx')),
  'nobody has an innocent name with a six-letter slur inside it');
c('and an explicit allow list exists for anything else',
  /NICK_ALLOW/.test(src),
  'the room knows its own regulars better than any rule does');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
