// "shazam" finds whoever is attacking the caller and removes THEM.
//
// It used to hand the caller ops for five minutes. The owner's design is
// better and this room's own history is the argument: an op set +i on the
// channel and banned the owner's account within minutes of being given ops.
// Nobody needs operator to be defended — they need the attacker gone.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— no ops are handed to anybody —');
// CHANGED ON PURPOSE 2026-10-11 (commit a401e42), owner's redesign: "shazam
// should make the trusted user mod ... if noone is attacking they still get
// modship for 10 mins". So the caller IS opped now — through guardian, which
// times it out — and the no-attacker reply says ops were given instead of
// 'I cannot see anybody attacking you'.
c('the caller gets +o, on a timer', /send\(`MODE \$\{chan\} \+o \$\{nick\}`\)/.test(src)
  && /given \+o in \$\{chan\} for \$\{guardian\.minutes\}m/.test(src));
c('it removes the attacker instead', /removed at \$\{nick\}'s call/.test(src));

console.log('— who it will act on —');
c('never somebody trusted', /!isTrusted\(e\.nick\)/.test(src));
c('never an owner or admin', /!isAdmin\(e\.nick\) && !isOwner\(e\.nick\)/.test(src));
c('never another bot', /PROTECTED_NICKS\.has\(e\.nick\.toLowerCase\(\)\)/.test(src));
c('only somebody still in the room', /present\(e\.nick\)/.test(src));
c('only recent', /6 \* 60000/.test(src));

console.log('— what counts as an attack —');
c('it must be aimed at the caller by name', /aimedAt\(e\.msg/.test(src));
c('banter does not count', /!isBanter\(e\.msg\)/.test(src));
c('nor does laughing', /!hasLaughter\(e\.msg\)/.test(src));
c('and it must be genuinely hostile', /severeAbuse\(e\.msg\)\.severe/.test(src));

console.log('— and when there is nothing —');
c('it says so when nobody is attacking', /Nobody is attacking you I can see/.test(src),
  'a command that silently does nothing reads as broken');
c('the mods are shown the evidence', /Quoted: "\$\{String\(worst\.msg\)/.test(src),
  'a removal nobody can check is a removal nobody can overturn');

console.log('— the replay trap —');
c('history is recorded AFTER the replay guard', src.indexOf('if (!ready) return;') < src.indexOf('rememberSaid2(tgt, nick, msg);'),
  '+H 50:3d replays three days on join; recorded as current, shazam would remove somebody for Saturday');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
