// Cool mode: the deterministic layers work, the model only watches.
//
// Every removal that cost this room a person in one day came from an AI
// verdict, never from the word list:
//   Lucifer   "Hum usko gayab kardenge"       threat  — Hindi idiom
//   tulip     "kisi or ka head eat kro jaoo"  threat  — "go bother someone else"
//   vergil    a welcome joke with a 😄        harassment
//   Preeti24  "just friendships and bkchodi"  slur    — means idle chat
// Each was patched one phrase at a time, which is losing: the room speaks
// Hinglish and the model reads it literally, so there is always another one.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'action-bot.js'), 'utf8');
let fails = 0;
const c = (n, ok, d = '') => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${!ok && d ? ' — ' + d : ''}`); };

console.log('— the switch —');
c('cool is the DEFAULT', /AI_ACTIVE \|\| 'off'/.test(src),
  'the room should not have to opt out of being policed by a model');
c('a mod can turn it on without a redeploy', /case 'active':/.test(src));
c('and it is admin-only', /case 'active': \{\s*\n\s*if \(!admin\)/.test(src));
c('it is advertised in help', /!!active on\|off/.test(src));

console.log('\n— what cool mode stops —');
const gate = src.slice(src.indexOf('if (!aiActive)'), src.indexOf('if (!aiActive)') + 700);
c('the AI action is skipped', /return;/.test(gate));
c('but the mods are still told', /notice\(m,/.test(gate) && /would/.test(gate));
c('and it says how to turn it on', /!!active on/.test(gate));

console.log('\n— what cool mode must NOT stop —');
// If turning it cool disabled protection, nobody could ever use it.
const aiGateAt = src.indexOf('if (!aiActive)');
for (const [what, marker] of [
    ['the severe word list', 'severeWords'],
    ['solicitation and child safety', 'solicits('],
    ['the raid guard', 'raid'],
    ['auto-ban masks', 'autobanMasks'],
]) {
    const at = src.indexOf(marker);
    c(`${what} is independent of it`, at !== -1 && at < aiGateAt || at > aiGateAt + 700,
      `${marker} not found or entangled with the AI gate`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
