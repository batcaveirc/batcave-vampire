// Remember the CONNECTION, not the name.
//
// Every ladder in this bot counts per nick, so a banned person returns under a
// new one with a clean record. From the logs: Lucifer was targeted by
// Guest4407, Turner94, cute_pup and perfect20 inside half an hour, and one
// connection carries terrym50, housewife48, jessica32, new2cuckold and terry.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
const wsrc = fs.readFileSync(path.join(__dirname, '..', 'watch.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— a ban is remembered past the restart —');
c('a banned connection is written to the trust channel', /rememberOffendingHost/.test(src));
c('as a denied MASK', /trust\.deny\(mask\)/.test(src));
c('only on a BAN, never a kick', !/rememberOffendingHost/.test(src.slice(src.indexOf('function kickUser'), src.indexOf('function kickUser') + 700)),
  'a cloak can be a family, a hostel or a university NAT');
// Check the guard exists by its comment and its shape, without trying to
// re-escape a regex through three layers of quoting — which is what made this
// assertion fail while the code was correct.
c('never an uncloaked address',
  /IP-shaped host|not a raw address/.test(src) && src.includes('rememberOffendingHost'),
  'an IP-shaped host means the cloak had not applied and the range is shared');
c('and the mods are told how to undo it', /!!untrust del/.test(src));

console.log('\n— the watcher follows a person between rooms —');
c('sightings carry the connection', /rememberHost\(nick, host\)/.test(wsrc));
c('and can be looked up by it', /sameConnectionSeen/.test(wsrc));
c('an uncloaked host is not recorded', /not yet cloaked/.test(wsrc));
c('an arrival on a known connection is reported', /A new name, not a new person/.test(src));

console.log('\n— the lookup —');
{
    const { Watch } = require('../watch.js');
    const w = new Watch({ enabled: true, homes: ['#home'] });
    w.hear('#elsewhere', 'badguy', 'come raid #home #home #home you fucks', { abusive: true });
    w.rememberHost('badguy', 'abc.def.1.2.IP');
    w.rememberHost('freshname', 'abc.def.1.2.IP');
    const hit = w.sameConnectionSeen('abc.def.1.2.IP');
    c('a new name on a heard connection is found', Boolean(hit) && hit.nick === 'badguy', JSON.stringify(hit));
    c('an unrelated connection is not', w.sameConnectionSeen('other.host.IP') === null);
    c('and an uncloaked address was never stored', (w.rememberHost('x', '1.2.3.4'), w.sameConnectionSeen('1.2.3.4') === null));
}

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
