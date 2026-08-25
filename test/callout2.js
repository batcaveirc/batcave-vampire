// The Lucifer case, against the ORDER parser: reporting abuse must never
// become an order, and must never be read as abuse by the speaker.
const { parseOrder } = require('../orders.js');
const present = (n) => ['bob','troll42'].some(x => x.toLowerCase() === n.toLowerCase());
const P = (t) => parseOrder(t, 'Dracula', present);
let fails = 0;
const no = (name, text) => { const r = P(text); const ok = r === null;
  if (!ok) fails++; console.log(`  [${ok?'PASS':'FAIL'}] ${name}` + (ok?'':` — parsed as ${JSON.stringify(r)}`)); };
const yes = (name, text, action, target) => { const r = P(text);
  const ok = r && r.action === action && r.target === target;
  if (!ok) fails++; console.log(`  [${ok?'PASS':'FAIL'}] ${name}` + (ok?'':` — got ${JSON.stringify(r)}`)); };

console.log('— reporting abuse is not ordering a kick —');
no('naming the problem',        'Dracula that was racist');
no('reporting without a target','Dracula someone is being racist');
no('describing a past action',  'Dracula you kicked bob for nothing');
no('venting',                   'Dracula this guy is such a troll');
no('third party, not present',  'Dracula kick that racist guy');

console.log('\n— but a real order still lands —');
yes('explicit kick',   'Dracula kick bob',            'kick',  'bob');
yes('explicit ban',    'Dracula ban troll42 for spam','ban',   'troll42');

console.log('\n— the dangerous overlap —');
const r = P('Dracula remove bob');
console.log(`  [note] "remove bob" -> ${JSON.stringify(r)}  (intended: a kick, bob is present)`);
no('"remove" with no present target', 'Dracula remove that racist comment');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails?1:0);
