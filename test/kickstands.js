// A moderator's kick must STAND.
//
//   ← Navs was kicked from #batcave by soul
//   @Dracula: [MOD] Navs is protected — kicked by soul. Invited back and
//             bans cleared. 🦇
//   → Navs has joined
//
// A human moderator removed somebody and the bot put her straight back,
// clearing the ban on the way — so no moderator decision stuck. The owner's
// rule: "once they are banned by mod i dont want to invite them back and they
// should stay banned".
//
// The machinery is kept and made unreachable rather than deleted, so turning
// it back on is one secret rather than a rewrite.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'batcave-bot.yml'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

const fn = src.slice(src.indexOf('function isProtectedFromKick'),
                     src.indexOf('function isProtectedFromKick') + 500);

console.log('— a kick stands —');
c('there is a master switch', /const KICK_PROTECT = /.test(src));
c('and it is OFF unless the env says otherwise',
  /process\.env\.KICK_PROTECT \|\| ''/.test(src),
  'defaulting to on would keep undoing kicks');
c('the very first thing the check does is honour it',
  /^function isProtectedFromKick\(nick\) \{\s*\n\s*if \(!KICK_PROTECT\) return false;/m.test(fn),
  fn.split('\n').slice(0, 3).join(' | '));
c('so nobody is protected, whitelisted or not',
  fn.indexOf('!KICK_PROTECT') < fn.indexOf('isTrusted(nick)'));

console.log('— the rescue is unreachable, not deleted —');
c('rescueFromKick still exists', /function rescueFromKick/.test(src),
  'keep the machinery so turning it back on is one secret');
// Asserts the PROPERTY, not the line shape: the rescue only ever runs inside
// a branch guarded by a protection check. The condition became multi-line when
// FLEET_PROTECT was added, and pinning the old single-line form failed for a
// reason that had nothing to do with whether the rescue was still gated.
// ...and the WINDOW is the handler's own extent, not a byte count. The comment
// above was already right about not pinning the line shape, while the slice
// below still pinned a magic 900 characters — so adding a comment inside the
// handler failed this for a reason unrelated to whether the rescue is gated.
const kickFrom = src.indexOf("command === 'KICK'");
const kickTo = src.indexOf("if (command === '", kickFrom + 20);
const kickBlock = src.slice(kickFrom, kickTo > kickFrom ? kickTo : kickFrom + 2500);
c('but it is only ever called behind a protection check',
  /isProtectedFromKick\(victim\)/.test(kickBlock)
    && kickBlock.indexOf('isProtectedFromKick(victim)') < kickBlock.indexOf('rescueFromKick('),
  'the guard must come before the call, not after it');
c('and a PERSON is still only rescued when KICK_PROTECT is on',
  /if \(!KICK_PROTECT\) return false;/.test(src),
  'fleet protection must not quietly restore protection for people');

console.log('— it says so when asked —');
const cmd = src.slice(src.indexOf("case 'protect':"), src.indexOf("case 'protect':") + 1600);
c('!!protect reports that it is off', /Kick-protection is OFF/.test(cmd));
c('and how to turn it back on', /KICK_PROTECT=on/.test(cmd));

console.log('— the deployment passes it —');
c('KICK_PROTECT is in the workflow', /KICK_PROTECT:/.test(wf));
c('with no default value, so it stays off', /KICK_PROTECT: \$\{\{ secrets\.KICK_PROTECT \}\}/.test(wf));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
