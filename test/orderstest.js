const { parseOrder } = require('../orders.js');
const present = (n) => ['spammer99','troll42','newguy','bob','Lucifer'].some(x => x.toLowerCase() === n.toLowerCase());
const P = (t) => parseOrder(t, 'Dracula', present);
let fails = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  [${ok?'PASS':'FAIL'}] ${name}` + (ok ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};
const A = (a,t,r='') => ({action:a,target:t,reason:r});

console.log('— orders it must understand —');
eq('Dracula kick spammer99',            P('Dracula kick spammer99'), A('kick','spammer99'));
eq('lowercase + comma',                 P('dracula, kick spammer99'), A('kick','spammer99'));
eq('ban with a reason',                 P('dracula ban troll42 for flooding'), A('ban','troll42','flooding'));
eq('name at the end',                   P('kick bob Dracula'), A('kick','bob'));
eq('give voice to newguy',              P('Dracula give voice to newguy'), A('voice','newguy'));
eq('take the voice from bob',           P('Dracula take the voice from bob'), A('devoice','bob'));
eq('mute',                              P('Dracula mute troll42'), A('mute','troll42'));
eq('unban',                             P('Dracula unban bob'), A('unban','bob'));
eq('warn',                              P('Dracula warn bob for spamming'), A('warn','bob','spamming'));

console.log('\n— things it must REFUSE —');
eq('not addressed to the bot',          P('someone should kick spammer99'), null);
eq('a question',                        P('Dracula should we kick spammer99?'), null);
eq("don't",                             P("Dracula don't kick spammer99"), null);
eq('no need to',                        P('Dracula no need to ban troll42'), null);
eq('target not in the room',            P('Dracula kick ghostuser'), null);
eq('no action word',                    P('Dracula what do you think of bob'), null);
eq('no target at all',                  P('Dracula kick him'), null);
eq('bot name only',                     P('Dracula'), null);
eq('talking about a past kick',         P('Dracula why did you kick bob?'), null);

console.log('\n— the ordering trap: longest phrasing wins —');
eq('"give voice to" is not "kick"',     P('Dracula give voice to bob'), A('voice','bob'));
eq('"unban" is not "ban"',              P('Dracula unban troll42'), A('unban','troll42'));
eq('"devoice" is not "voice"',          P('Dracula devoice bob'), A('devoice','bob'));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails?1:0);
