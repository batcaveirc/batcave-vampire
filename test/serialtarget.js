// One person, many names, one victim.
//
// Straight from Dracula's own logs:
//   Guardian: opped Lucifer (targeted by Guest4407)
//   Guardian: opped Lucifer (targeted by Turner94)
//   Guardian: opped Lucifer (targeted by cute_pup)
//   Guardian: opped Lucifer (targeted by perfect20)
//
// Not four people who each decided to go after Lucifer. Every defence here is
// aimed at a NICK — warnings, strikes, devoices, the ladder — so each new name
// arrives with a clean record and the count starts again. The victim gets
// armed over and over and the attacker pays nothing. The pattern is only
// visible from the victim's side, which is why nothing caught it.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let f = 0;
const c = (n, ok, d = '') => { if (!ok) f++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the shape —');
c('targeting is tracked per VICTIM', /targetedBy/.test(src),
  'per-attacker tracking is exactly what nick-cycling defeats');
c('a repeated attacker counts once', /hist\.some\(\(e\) => e\.attacker ===/.test(src),
  'otherwise one persistent person trips it alone');
c('it needs three DIFFERENT names', /hist\.length < 3/.test(src));
c('inside a window', /30 \* 60000/.test(src));
c('the response is registered-only', /MODE \$\{chan\} \+R/.test(src));
c('and it lifts itself', /MODE \$\{chan\} -R/.test(src),
  'a lock nobody remembers to remove is how a room dies quietly');
c('the owners are told it is one person', /cycling names/.test(src));

console.log('\n— the counting rule —');
function makeTracker() {
    const m = new Map(); let locked = 0;
    return (victim, attacker, at) => {
        const k = victim.toLowerCase();
        const hist = (m.get(k) || []).filter((e) => at - e.at < 30 * 60000);
        if (!hist.some((e) => e.attacker === attacker.toLowerCase())) hist.push({ at, attacker: attacker.toLowerCase() });
        m.set(k, hist);
        if (hist.length < 3 || at < locked) return false;
        locked = at + 10 * 60000;
        return true;
    };
}
{
    const t = makeTracker();
    c('one attacker does not trip it', !t('Lucifer', 'Guest4407', 0));
    c('two do not either', !t('Lucifer', 'Turner94', 60000));
    c('three different names in the window does', t('Lucifer', 'cute_pup', 120000));
}
{
    const t = makeTracker();
    c('the SAME attacker three times does not trip it',
      !t('Lucifer', 'Guest4407', 0) && !t('Lucifer', 'Guest4407', 1000) && !t('Lucifer', 'Guest4407', 2000),
      'that is one persistent person, which the ordinary ladder already handles');
}
{
    const t = makeTracker();
    c('three attackers on DIFFERENT victims does not trip it',
      !t('Lucifer', 'a', 0) && !t('Amant', 'b', 1000) && !t('Anushka', 'c', 2000),
      'a busy hour is not a campaign');
}
{
    const t = makeTracker();
    c('spread beyond the window does not trip it',
      !t('Lucifer', 'a', 0) && !t('Lucifer', 'b', 31 * 60000) && !t('Lucifer', 'c', 62 * 60000));
}

console.log(f ? `\n${f} FAILED` : '\nALL PASS');
process.exit(f ? 1 : 0);
