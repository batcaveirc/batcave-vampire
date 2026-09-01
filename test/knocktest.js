// A door, so uninvited people knock instead of walking in.
//
// Verified against the live server before building any of it: KNOCK exists
// and answers "713 Can't KNOCK on #batcave, channel is not invite only so
// knocking is pointless" — the server saying exactly what the feature needs.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the door —');
c('!!door on sets +i', src.includes('send(`MODE ${chan} +i`)'));
c('!!door off clears it', src.includes('send(`MODE ${chan} -i`)'));
c('it is admin-only', /case 'door': \{\s*\n\s*if \(!admin\)/.test(src));
c('and says the recruiter still works', src.includes('an\n                    + \'INVITE waives +i') || src.includes('INVITE waives +i'),
  'the trade has to be stated: +i stops the curious as well as the raid');

console.log('— the knock —');
c('the 710 numeric is handled', src.includes("command === '710'"));
c('a knock is announced to the room', src.includes('is knocking'));
c('and to the operators with the command', src.includes('!!letin ${who}'));
c('!!letin sends a real INVITE', src.includes('send(`INVITE ${target} ${chan}`)'));

console.log('— who does not get announced —');
c('somebody already denied is not', src.includes('isForfeited(who)'),
  'a removal that can be undone by knocking is not a removal');
c('but the owners still hear about it', src.includes('knocked but is on the deny list'));
c('repeat knocking is ignored', src.includes('5 * 60000'),
  'knocking over and over is itself a way to make noise in a locked room');

console.log('— what the operators are told —');
c('their other names come with it', src.includes('Also seen as:'),
  'the same connection under a new nick is the case this whole day was about');


console.log('\n— the door is open to regulars —');
// +i alone would make every regular wait to be let in, which nobody tolerates.
// +I is the other half: an account that bypasses +i with no invitation.
// EXTBAN=account,R is advertised and "R:Vampire" has been seen used as a ban,
// so R:<account> is the form this network takes.
c('trusted accounts get an invite exception', src.includes('MODE ${chan} +I R:${a}'));
c('and mask entries too', src.includes('MODE ${chan} +I ${m}'));
// Scoped to the door block: there is an unrelated "+i" in the raid lock
// earlier in the file, and comparing against that compared nothing.
{
    const door = src.slice(src.indexOf("case 'door': {"), src.indexOf("case 'letin': {"));
    c('exceptions are set BEFORE the lock',
      door.indexOf('syncInviteExceptions(chan, reply);') < door.indexOf('send(`MODE ${chan} +i`)'),
      'otherwise every regular is briefly locked out of their own room');
}
c('!!door sync refreshes after trust changes', src.includes("arg === 'sync'"));

console.log('\n— but a nick-only trust does NOT get one —');
c('only accounts and masks become exceptions', src.includes('asAccount') && src.includes("name.includes('@')"),
  'an unregistered nick is what an attacker wears; letting one past would undo the door');
c('and that is said out loud', src.includes('Anybody unregistered has to knock'));


console.log('\n— one entry for every registered account —');
// The owner's idea and the strongest part of the design: instead of listing
// people, require an identity. R:* matches everybody logged in, so the
// 200-entry list stays almost empty for the individuals who need naming.
c('R:* is set', src.includes('MODE ${chan} +I R:*'));
c('and it can be turned off', src.includes('OPEN_TO_REGISTERED'));
c('the reason is recorded', src.includes('Every attacker in these logs'),
  'Guest4407, Turner94, cute_pup, perfect20 — all unregistered');

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
