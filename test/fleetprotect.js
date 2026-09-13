// Our own bots must survive a moderator with @ — people must not.
//
//   ⓘ Anushka has banned R:Vampire
//   × Anushka kicked you from #batcave
//   ⚠ Cannot join channel (you're banned)
//
// The owner tested that on himself and it worked exactly as IRC intends: the
// ban blocks the rejoin, the kick does the removing. Which means the same two
// commands from anybody holding @ can take Luna or a standby out of the room
// permanently, and nothing would notice — a bot cannot ask to come back.
//
// A moderator's decision about a PERSON still stands. This is only about the
// fleet, which is not a person: kicking it settles no argument, it just
// removes moderation from the room.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'batcave-bot.yml'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the switch —');
c('FLEET_PROTECT exists', /const FLEET_PROTECT = /.test(src));
c('and is ON unless turned off', /FLEET_PROTECT[\s\S]{0,80}\|\| 'on'\)/.test(src),
  'losing the bots silently is the failure this prevents');
c('separate from KICK_PROTECT, which stays off',
  /const KICK_PROTECT[\s\S]{0,120}process\.env\.KICK_PROTECT \|\| ''/.test(src),
  'people stay kicked; bots do not');

console.log('— a kick on one of ours is undone —');
// The handler's own extent, not a byte count. This used to slice a fixed 900
// characters, so adding a COMMENT inside the handler pushed the assertion out of
// the window and failed a test whose subject had not changed at all. That has
// happened more than once in this suite; a window defined by the code's shape
// cannot drift the way a magic number does.
const kickAt = src.indexOf("command === 'KICK'");
const kickEnd = src.indexOf("if (command === '", kickAt + 20);
const kick = src.slice(kickAt, kickEnd > kickAt ? kickEnd : kickAt + 2500);
c('the rescue covers our fleet', /FLEET_PROTECT && isOneOfOurs\(victim\)/.test(kick), kick.slice(0, 200));
c('but never when an OWNER did the kicking', /!isOwner\(nick\)/.test(kick),
  'the owner must always be able to remove their own bot');
c('and never our own kicks', /nick\.toLowerCase\(\) !== currentNick\.toLowerCase\(\)/.test(kick));

console.log('— and the ban that would keep it out —');
// The FLEET_PROTECT ban check specifically, not merely the first thing that
// mentions a +b. A second feature (mirroring bans into ChanServ so they survive
// a channel reset) now also tests `ch === 'b' && adding`, and appears earlier —
// so this slice was reading that block instead and failed on code that had not
// changed. Anchor on the distinguishing condition, and size the window by the
// block rather than by a magic number.
const banAt = src.indexOf("ch === 'b' && adding && FLEET_PROTECT");
const banTo = src.indexOf("if ('ovhbeIkl'.includes(ch))", banAt > 0 ? banAt : 0);
const ban = src.slice(banAt, banTo > banAt ? banTo : banAt + 1600);
c('a +b covering our bots is removed', /send\(`MODE \$\{tgt\} -b \$\{mask\}`\)/.test(ban),
  'a rescue is useless while the ban stands — re-invited, then refused at the door');
c('matched against the fleet, not guessed', /\[\.\.\.FLEET, currentNick/.test(ban));
c('owners are told', /\[FLEET\]/.test(ban));
c('an owner setting a ban is left alone', /!isOwner\(nick\)/.test(ban));
c('and services are never fought', /serv\$\|\^chanbot\$/.test(ban));

console.log('— a ban on a PERSON is still left alone —');
c('only the fleet match triggers a removal', /hitsOurs/.test(ban)
  && /if \(mask && hitsOurs\)/.test(ban),
  'a moderator banning a human is a decision, not a fault');

console.log('— the deployment passes it —');
c('FLEET_PROTECT is in the workflow', /FLEET_PROTECT:/.test(wf),
  'config that is never passed is config that does nothing');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
