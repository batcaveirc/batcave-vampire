// The model may report a nickname. It may not remove anybody.
//
//   → diya_gujju_us has joined
//   ⓘ ChanBot gives voice to diya_gujju_us
//   @Dracula: diya_gujju_us: Wrong room, wrong night, wrong crowd.
//   [MOD] diya_gujju_us removed — offensive nickname
//
// "Diya", "Gujju" (Gujarati), "us". An ordinary name, ejected and taunted nine
// seconds after arriving, in a room it had just been voiced in. The prompt
// already tells the model that a wrong flag ejects a real person; it had been
// tuned twice and still did this.
//
// So the test is not "does the model get this nick right" — it is "can the
// model remove anyone at all". It must not. The word list still can.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

// badNick is defined BEFORE screenNick, so slicing to it ran backwards and
// produced an empty string — every assertion then failed for no reason. Slice
// to something that genuinely follows.
const start = src.indexOf('async function screenNick');
const end = src.indexOf('--- Witty AI reply', start);
const screen = src.slice(start, end > start ? end : start + 4000);
if (screen.length < 500) { console.log('  [FAIL] could not slice screenNick'); process.exit(1); }

console.log('— the model reports —');
c('an AI verdict notifies the operators', /\[NICK\]/.test(screen) && /notice\(o,/.test(screen));
c('and says plainly that nobody was touched', /Nobody has been touched/.test(screen));
c('and offers the human a command that actually exists',
  /Dracula kick \$\{nick\}/.test(screen),
  '"!!kick" has never been a command — kick is a spoken order');

console.log('— the model does NOT act —');
c('no kick on an AI verdict',
  !/verdict === true[\s\S]{0,400}kickUser/.test(screen),
  'an opinion must not eject a stranger in their first minute');
c('no ban on an AI verdict',
  !/verdict === true[\s\S]{0,400}banUser/.test(screen));
c('the AI branch returns before any action',
  /verdict === true[\s\S]{0,500}\n        }\n        return;/.test(screen),
  'it must fall out of screenNick, not into the punishment block');

console.log('— the word list still does —');
c('a listed word still kicks', /kickUser\(chan, nick, `\$\{bad\}/.test(screen));
c('and still escalates to a ban on return', /fromList && n > 1[\s\S]{0,80}banUser/.test(screen));
c('only the list can ban, never the model', /Only the word list/.test(screen));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
