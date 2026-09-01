// "shazam" — a trusted regular takes ops for five minutes.
//
// The people who hold this room together should not have to wait for a bot or
// a sleeping moderator when something starts. They already have standing; this
// makes it usable.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— who may —');
c('trusted, admin or owner only', /if \(!isTrusted\(nick\) && !isAdmin\(nick\) && !isOwner\(nick\)\) return false/.test(src));
c('and that means the trust list, not voice',
  !/voiceIsSelective/.test(src.slice(src.indexOf('function shazam'), src.indexOf('function shazam') + 900)),
  'everybody in this room has voice, so voice cannot be the test');

console.log('— and it takes itself back —');
c('it is time-boxed', /SHAZAM_MINUTES/.test(src));
c('with an explicit deop', /MODE \$\{chan\} -o \$\{nick\}/.test(src),
  'an op nobody removes is a permanent op handed out by a keyword');
c('unless they had ops of their own', /if \(isAdmin\(nick\) \|\| isOwner\(nick\)\) return;/.test(src));
c('there is a cooldown', /30 \* 60000/.test(src));

console.log('— and it is never quiet —');
c('the room is told', /\[SHAZAM\]\\x03 \$\{nick\} has ops/.test(src));
c('the other mods are told', /took ops in \$\{chan\}/.test(src));
c('and it is logged', /log\('MOD', `Shazam:/.test(src));

console.log('— the trigger —');
c('the bare word works, no prefix', src.includes('/^\\s*shazam\\s*[!.]*$/i.test(msg)'),
  'a regular under attack should not have to remember which bot uses which punctuation');
c('only in our own channels', /isOurChannel\(tgt\)/.test(src.slice(src.indexOf('shazam\\\\s*[!.]*$'), src.indexOf('shazam\\\\s*[!.]*$') + 200)) || /shazam[\s\S]{0,120}isOurChannel/.test(src));
c('it is advertised in help', src.includes('shazam') && src.includes('for 5m of ops'));

console.log('— one list, not two —');
c('!!whitelist points at !!trust', src.includes('one list, one store'));
c('and says why it changed', /which the old whitelist did not/.test(src));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
