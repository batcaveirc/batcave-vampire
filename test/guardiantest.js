const { Guardian, victimOf } = require('../guardian.js');
const here = ['Vikram','LiBu','Nessie','bob','bobby','argon','pooja','Almond'];
const trusted = new Set(['vikram','libu','nessie','pooja','bobby']);
const isTrusted = (n) => trusted.has(n.toLowerCase());
const V = (msg, from='argon') => victimOf(msg, from, here, isTrusted);
let fails=0; const c=(n,ok,d='')=>{if(!ok)fails++;console.log(`  [${ok?'PASS':'FAIL'}] ${n}${!ok&&d?' — '+d:''}`);};

console.log('— finding who was targeted —');
c('names the trusted target',            V('Vikram ki maa ka gangbang') === 'Vikram', String(V('Vikram ki maa ka gangbang')));
c('target named mid-sentence',           V('shut up you idiot LiBu') === 'LiBu', String(V('shut up you idiot LiBu')));
c('no trusted name -> nobody',           V('you are all idiots') === null, String(V('you are all idiots')));
c('untrusted target -> nobody',          V('bob you are trash') === null, String(V('bob you are trash')));
c('longest name wins over a prefix',     V('bobby you are trash') === 'bobby', String(V('bobby you are trash')));
c('attacker cannot be their own victim', V('Vikram is an idiot','Vikram') === null);
c('substring does not count',            V('poojaX is rubbish') === null, String(V('poojaX is rubbish')));

console.log('\n— when it must refuse —');
const g = new Guardian({minutes:10});
c('refuses when the attacker is one of ours', g.refuse('#c','Vikram','trusted',false) === 'attacker is one of ours');
c('refuses a mod attacker too',              g.refuse('#c','Vikram','mod',false) === 'attacker is one of ours');
c('refuses if they already hold status',     g.refuse('#c','Vikram','stranger',true) === 'already has status');
c('allows a genuine case',                   g.refuse('#c','Vikram','stranger',false) === null);
g.grant('#c','Vikram');
c('will not double-grant',                   g.refuse('#c','Vikram','stranger',false) === 'already guarding');
c('reports it is active',                    g.isActive('#c','Vikram') === true);
g.release('#c','Vikram');
c('release clears it',                       g.isActive('#c','Vikram') === false);
const off = new Guardian({enabled:false});
c('GUARDIAN=off disables it',                off.refuse('#c','Vikram','stranger',false) === 'disabled');

console.log(fails?`\n${fails} FAILED`:'\nALL PASS');
process.exit(fails?1:0);
