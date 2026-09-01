// One person's names, linked by their connection.
//
// InspIRCd cloaks are a deterministic hash of the real address, so two nicks
// carrying the same cloak are the same connection — available to anybody in
// the room, needing no oper privileges and no real IP.
//
// Mined from Dracula's own logs, 36 cloaks carried more than one nick:
//   u42.9vh.103.103.IP   terrym50, housewife48, jessica32, new2cuckold, terry
//   4h3.d7t.43.49.IP     female24, female33_actress, actresslustyshag, female33_pornstar
//   qjt.bnh.77.103.IP    hotphysiqueguy, hyderabadiilund, zalimmmlunddhyd, hunkbeast
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the index —');
c('nicks are indexed by host', /const nicksOnHost = new Map\(\)/.test(src));
c('it is fed from JOIN/message hosts', /rememberHost\(nick, userHost\)/.test(src));
c('and from WHO replies', /rememberHost\(params\[5\]/.test(src));
c('and from WHOWAS, which reaches past a disconnect', /command === '314'/.test(src),
  'a name change to escape a warning is exactly when the person has just left');

console.log('\n— !!info —');
c('it reports the other names', /also seen on this connection/.test(src));
c('and asks the server for history', /send\(`WHOWAS \$\{who\} 5`\)/.test(src));

console.log('\n— the recruiter stops inviting one person six times —');
const rec = fs.readFileSync(path.join(__dirname, '..', 'recruit.js'), 'utf8');
c('it checks the alts before inviting', /alreadyAskedAnAlt/.test(rec));
c('and counts them as "asked before"', /alreadyAskedAnAlt\(nick\)\) \{ asked\+\+/.test(rec));
c('missing wiring fails OPEN, not closed',
  /typeof this\.deps\.altsOf !== 'function'\) return false/.test(rec),
  'refusing to invite anybody we cannot identify would be far worse than a duplicate');

console.log('\n— the linking rule —');
{
    const hosts = new Map([
        ['terrym50', 'u@u42.9vh.103.103.IP'], ['housewife48', 'x@u42.9vh.103.103.IP'],
        ['jessica32', 'y@u42.9vh.103.103.IP'], ['someoneelse', 'z@other.host.IP'],
    ]);
    const byHost = new Map();
    for (const [n, uh] of hosts) {
        const h = uh.split('@').pop();
        byHost.set(h, (byHost.get(h) || new Set()).add(n));
    }
    const alts = (n) => [...(byHost.get((hosts.get(n) || '').split('@').pop()) || [])].filter((x) => x !== n);
    c('three personas on one cloak are linked', alts('terrym50').sort().join(',') === 'housewife48,jessica32');
    c('and a different cloak is not', alts('someoneelse').length === 0);
    c('an unknown nick links to nobody', alts('neverseen').length === 0);
}
{
    // The trap: cloaks end in the PROVIDER's prefix. Lucifer carries
    // "...4900.2401.IP" and so do ______RahulM45 and _______sahil45M, because
    // 2401:4900: is Reliance Jio and millions of people are on it. A suffix
    // match would link half of India.
    const hosts = new Map([
        ['lucifer', 'webchat@67knht.c4s9.3bnc.4900.2401.IP'],
        ['rahulm45', 'webchat@jju8tq.eok1.s70c.4900.2401.IP'],
        ['sahil45m', 'webchat@jju8tq.eok1.s70c.4900.2401.IP'],
    ]);
    const byHost = new Map();
    for (const [n, uh] of hosts) {
        const h = uh.split('@').pop();
        byHost.set(h, (byHost.get(h) || new Set()).add(n));
    }
    const alts = (n) => [...(byHost.get((hosts.get(n) || '').split('@').pop()) || [])].filter((x) => x !== n);
    c('a shared PROVIDER prefix does not link people', alts('lucifer').length === 0,
      'suffix matching would link everyone on Reliance Jio');
    c('but an identical full cloak still does', alts('rahulm45').join(',') === 'sahil45m');
}


console.log('\n— a rename must link both names —');
// The one place this was missing, and the most important one. A NICK change
// is the moment somebody becomes a different person on paper: the bot watched
// "Lucifer is now known as darkworld" happen in the room and recorded nothing,
// because the handler copied the host across without indexing it.
c('the rename handler records both names', /rememberHost\(nick, h\); rememberHost\(newNick, h\)/.test(src));
c('and logs that it is the same connection', /same connection/.test(src));

console.log('\n— an empty answer must say why —');
// "No alts" printed nothing at all, which is indistinguishable from the
// feature being broken. That is how it was reported.
c('no host on file says so', /no connection on file yet/.test(src));
c('no alts says it is bounded by the restart', /since I last restarted/.test(src));
c('and does not claim it as proof', /not proof they have none/.test(src));

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
