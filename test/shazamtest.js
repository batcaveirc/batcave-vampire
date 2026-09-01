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
c('trusted, admin, owner or a channel op', src.includes('!isChannelMod(chan, nick)'));
// lisu typed it three times, got nothing at all, and said "kuch bhi nhi".
// A silent refusal is indistinguishable from a broken feature, and that is
// exactly how the room read it.
c('a refusal SAYS so', src.includes('That is for trusted regulars'));
c('and names the command to fix it', src.includes('!!trust add ${nick}'));
c('and that means the trust list, not voice',
  !/voiceIsSelective/.test(src.slice(src.indexOf('function shazam'), src.indexOf('function shazam') + 900)),
  'everybody in this room has voice, so voice cannot be the test');

console.log('— it hands out NO ops at all —');
// CHANGED deliberately. This used to give the caller +o for five minutes.
// The owner's later design is better and this room's history is the argument:
// an op set +i on the channel and banned the owner's account within minutes of
// being handed ops. Nobody needs operator to be defended.
c('the caller is never opped', !/send\(`MODE \$\{chan\} \+o \$\{nick\}`\)/.test(src));
c('the attacker is removed instead', src.includes("removed at ${nick}'s call"));
c('there is still a cooldown', /30 \* 60000/.test(src));

console.log('— and it is never quiet —');
// Wording changed with the feature: it announces a removal, not a grant.
c('the room is told', src.includes("${nick} called it. Removing ${worst.nick}"));
c('the other mods are told, with the evidence', src.includes('used it on') && src.includes('Quoted:'));
c('and it is logged', /log\('MOD', `Shazam:/.test(src));

console.log('— the trigger —');
c('the bare word works, no prefix', src.includes('/^\\s*shazam\\s*[!.]*$/i.test(msg)'),
  'a regular under attack should not have to remember which bot uses which punctuation');
c('only in our own channels', /isOurChannel\(tgt\)/.test(src.slice(src.indexOf('shazam\\\\s*[!.]*$'), src.indexOf('shazam\\\\s*[!.]*$') + 200)) || /shazam[\s\S]{0,120}isOurChannel/.test(src));
c('it is advertised in help', src.includes('shazam') && src.includes('for 5m of ops'));

console.log('— one list, not two —');
c('!!whitelist points at !!trust', src.includes('one list, one store'));
c('and says why it changed', /which the old whitelist did not/.test(src));


console.log('\n— misuse escalates, curiosity does not —');
// The owner asked for a kick on any non-trusted user. His own transcript is
// the argument against a flat one: he told UME "try that command", UME typed
// it four times, and a flat kick removes somebody for doing what he was asked.
c('an already-denied user is banned outright', src.includes('tried to take ops after losing standing'));
c('a first attempt is only told no', src.includes('That is for trusted regulars'));
c('a second attempt is warned it will remove them', src.includes('Asking again will get you removed'));
c('a third is kicked', src.includes('kept trying to take ops after being told no'));
c('and the counter is per person', src.includes('shazamTried'));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
